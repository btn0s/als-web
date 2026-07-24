import { useFrame } from '@react-three/fiber'
import { folder, useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { pickClip } from '../anim/pickClip'
import { advanceLocomotionPhase, STAND, updateLocomotionTargets } from '../player/blendspace'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  ALS_GAITS,
  ALS_STANCES,
  buildLocomotionProfile,
  resolveDesiredGaitSpeed,
} from '../player/locomotionProfile'
import type { AlsGait, AlsStance } from '../player/locomotionProfile'
import {
  ALS_LAYER_REGIONS,
  ALS_OVERLAY_MODES,
  blendOverlayCurve,
  RIFLE_OVERLAY_CLIPS,
  RIFLE_RELAXED_POSE_TIME,
  resolveArmAdditiveSpaceAmounts,
  resolveRifleOverlaySourceWeights,
} from '../player/overlayMode'
import type {
  AlsLayerRegion,
  AlsOverlayMode,
  OverlayCurveSource,
} from '../player/overlayMode'
import { applyPose, createPoseApplicator } from '../player/pose/applyPose'
import { blendPoseInPlace, compileBoneMask } from '../player/pose/blend'
import { compileClipSampler, sampleClip } from '../player/pose/clipSampler'
import type { CompiledClipSampler } from '../player/pose/clipSampler'
import {
  blendCurveValue,
  compileClipCurveSamplers,
  resolvePoseGaitAmounts,
} from '../player/pose/curves'
import type {
  ClipCurveSamplers,
  PoseGaitAmounts,
  WeightedCurveSource,
} from '../player/pose/curves'
import { createPoseEvaluator, evaluatePose } from '../player/pose/evaluator'
import type {
  EvaluatePoseInput,
  EvaluatorDynamicAdditiveEntry,
  EvaluatorLayerEntry,
} from '../player/pose/evaluator'
import { copyPose, createPoseBuffer } from '../player/pose/poseBuffer'
import { createRigDefinition } from '../player/pose/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../player/pose/rootMotion'
import type { RootMotionExtractor } from '../player/pose/rootMotion'
import { REGION_PREDICATES } from '../player/trackMask'
import {
  computeWeightTable,
  createSixDirectionWeights,
  createWeightTable,
} from '../player/weightTable'
import type { WeightTable, WeightTableInput } from '../player/weightTable'
import {
  createVelocityBlend,
  stepVelocityBlend,
} from '../player/velocityBlend'
import { LEVA_ROOTS } from './levaRoots'

const GAIT_SPEEDS = {
  walk: ALS_AUTHORED_GAIT_SPEEDS.standing.walk,
  run: ALS_AUTHORED_GAIT_SPEEDS.standing.run,
  sprint: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
}

/**
 * The ALS pack's locomotion topology: stand walk/run and crouch walk each have forward,
 * backward, and four diagonals; sprint is the single authored forward cycle.
 */
const CLIP_ROLES = {
  idle: 'A_Als_Idle',
  walkFwd: 'A_Als_Walk_Forward',
  walkBwd: 'A_Als_Walk_Backward',
  walkLeftFwd: 'A_Als_Walk_Left_Forward',
  walkRightFwd: 'A_Als_Walk_Right_Forward',
  walkLeftBwd: 'A_Als_Walk_Left_Backward',
  walkRightBwd: 'A_Als_Walk_Right_Backward',
  runFwd: 'A_Als_Run_Forward',
  runBwd: 'A_Als_Run_Backward',
  runLeftFwd: 'A_Als_Run_Left_Forward',
  runRightFwd: 'A_Als_Run_Right_Forward',
  runLeftBwd: 'A_Als_Run_Left_Backward',
  runRightBwd: 'A_Als_Run_Right_Backward',
  sprint: 'A_Als_Sprint',
  crouchIdle: 'A_Als_Crouch_Pose',
  crouchFwd: 'A_Als_Crouch_Walk_Forward',
  crouchBwd: 'A_Als_Crouch_Walk_Backward',
  crouchLeftFwd: 'A_Als_Crouch_Walk_Left_Forward',
  crouchRightFwd: 'A_Als_Crouch_Walk_Right_Forward',
  crouchLeftBwd: 'A_Als_Crouch_Walk_Left_Backward',
  crouchRightBwd: 'A_Als_Crouch_Walk_Right_Backward',
} as const satisfies Partial<Record<keyof WeightTable, string>>

type ClipRole = keyof typeof CLIP_ROLES

const ROLE_GAIT_AMOUNT: Record<ClipRole, number> = {
  idle: 0,
  walkFwd: 1,
  walkBwd: 1,
  walkLeftFwd: 1,
  walkRightFwd: 1,
  walkLeftBwd: 1,
  walkRightBwd: 1,
  runFwd: 2,
  runBwd: 2,
  runLeftFwd: 2,
  runRightFwd: 2,
  runLeftBwd: 2,
  runRightBwd: 2,
  sprint: 3,
  crouchIdle: 0,
  crouchFwd: 1,
  crouchBwd: 1,
  crouchLeftFwd: 1,
  crouchRightFwd: 1,
  crouchLeftBwd: 1,
  crouchRightBwd: 1,
}

const GAIT_DAMP_RATE = 8
// ALS does not prescribe the Stance transition rate in C++; this preserves the existing feel.
const CROUCHING_AMOUNT_DAMP_RATE = 10

interface RuntimeClip {
  readonly sampler: CompiledClipSampler
  readonly curves?: ClipCurveSamplers
  readonly entry: EvaluatorLayerEntry
  time: number
}

interface RuntimeOverlayEntry {
  readonly source: RuntimeOverlaySource
  readonly layer: AlsLayerRegion
  readonly entry: EvaluatorLayerEntry
}

interface RuntimeOverlaySource {
  readonly key: keyof typeof RIFLE_OVERLAY_CLIPS
  readonly clip: RuntimeClip
  readonly curves?: ClipCurveSamplers
  time: number
  weight: number
}

interface RuntimeDynamicAdditive {
  readonly layer: AlsLayerRegion
  readonly entry: EvaluatorDynamicAdditiveEntry
}

interface RuntimeGaitSource extends WeightedCurveSource {
  readonly entry: EvaluatorLayerEntry
}

function createEntry(
  sampler: CompiledClipSampler,
  curves?: ClipCurveSamplers,
): EvaluatorLayerEntry {
  return { sampler, time: 0, weight: 0, loop: true, curves }
}

function advanceClip(clip: RuntimeClip, delta: number) {
  const duration = clip.sampler.clip.duration
  clip.time = duration > 0 ? (clip.time + delta) % duration : 0
}

function damp(current: number, target: number, rate: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-rate * delta))
}

/**
 * Owns sampling, pose-space composition, and the sole skeleton write for the character. The pure
 * weight table and region rules remain the graph; this hook only translates their outputs into
 * evaluator entries.
 */
export function useLocomotionRig(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
}) {
  const [{
    gait,
    moving,
    stance,
    overlayMode,
    speed,
    direction,
  }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      gait: {
        value: 'Running' as AlsGait,
        options: ALS_GAITS,
        label: 'Gait',
      },
      moving: {
        value: false,
        label: 'Moving',
      },
      stance: {
        value: 'Standing' as AlsStance,
        options: ALS_STANCES,
        label: 'Stance',
      },
      overlayMode: {
        value: 'Default' as AlsOverlayMode,
        options: ALS_OVERLAY_MODES,
        label: 'OverlayMode',
      },
      'Debug Overrides': folder({
        speed: {
          value: resolveDesiredGaitSpeed('Running', 'Standing'),
          min: 0,
          max: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
          step: 0.05,
          label: 'speed (m/s)',
        },
        direction: {
          value: 0,
          min: -180,
          max: 180,
          step: 1,
          label: 'direction (deg)',
        },
      }, { collapsed: true }),
    }),
    { order: 1 },
  )
  const controls = useRef({ gait, moving, stance, overlayMode, speed, direction })
  controls.current = { gait, moving, stance, overlayMode, speed, direction }

  useEffect(() => {
    setControls({
      speed: resolveDesiredGaitSpeed(gait as AlsGait, stance as AlsStance),
    })
  }, [gait, stance, setControls])

  useEffect(() => {
    window.__setSpeed = (value: number) => setControls({
      speed: value,
      moving: value > 0,
    })
    window.__setGait = (value: AlsGait) => {
      if (ALS_GAITS.includes(value)) setControls({ gait: value })
    }
    window.__setStance = (value: AlsStance) => {
      if (ALS_STANCES.includes(value)) setControls({ stance: value })
    }
    window.__setOverlayMode = (value: AlsOverlayMode) => {
      if (ALS_OVERLAY_MODES.includes(value)) setControls({ overlayMode: value })
    }
    return () => {
      delete window.__setSpeed
      delete window.__setGait
      delete window.__setStance
      delete window.__setOverlayMode
    }
  }, [setControls])

  const runtime = useMemo(() => {
    const rig = createRigDefinition(gltf.scene)
    const applicator = createPoseApplicator(gltf.scene, rig)
    const evaluator = createPoseEvaluator(rig, { development: import.meta.env.DEV })
    const profile = buildLocomotionProfile(gltf.animations)
    const rootMotion: RootMotionExtractor | undefined =
      rig.boneCount > 0 ? createRootMotionExtractor(rig) : undefined
    const clips = gltf.animations.map((clip): RuntimeClip => {
      const sampler = compileClipSampler(clip, rig)
      const compiledCurves = compileClipCurveSamplers(clip)
      const curves = Object.keys(compiledCurves).length > 0 ? compiledCurves : undefined
      return { sampler, curves, entry: createEntry(sampler, curves), time: 0 }
    })
    const clipsByName = new Map(clips.map((clip) => [clip.sampler.clip.name, clip]))
    const roles: Partial<Record<ClipRole, RuntimeClip>> = {}
    for (const [role, clipName] of Object.entries(CLIP_ROLES) as [ClipRole, string][]) {
      const clip = clipsByName.get(clipName)
      if (clip) roles[role] = clip
    }

    const baseEntries = Object.values(roles).map((clip) => clip.entry)
    const overlaySources = (
      Object.entries(RIFLE_OVERLAY_CLIPS) as [
        keyof typeof RIFLE_OVERLAY_CLIPS,
        string,
      ][]
    ).flatMap(([key, clipName]): RuntimeOverlaySource[] => {
      const clip = clipsByName.get(clipName)
      return clip ? [{ key, clip, curves: clip.curves, time: 0, weight: 0 }] : []
    })
    const overlayEntries = overlaySources.flatMap((source) =>
      ALS_LAYER_REGIONS.map((layer): RuntimeOverlayEntry => {
        const entry = createEntry(source.clip.sampler)
        entry.mask = compileBoneMask(rig, REGION_PREDICATES[layer.region])
        return { source, layer, entry }
      }),
    )

    const standReference = createPoseBuffer(rig.boneCount)
    const crouchReference = createPoseBuffer(rig.boneCount)
    const layeringReference = createPoseBuffer(rig.boneCount)
    const standPose = clipsByName.get('A_Als_Stand_Pose')
    const crouchPose = clipsByName.get('A_Als_Crouch_Pose')
    if (standPose) sampleClip(standPose.sampler, rig, 0, standReference, false)
    else copyPose(evaluator.referencePose, standReference)
    if (crouchPose) sampleClip(crouchPose.sampler, rig, 0, crouchReference, false)
    else copyPose(standReference, crouchReference)
    copyPose(standReference, layeringReference)

    const dynamicAdditives: RuntimeDynamicAdditive[] = []
    for (const layer of ALS_LAYER_REGIONS) {
      if (!layer.additiveCurve) continue
      const mask = compileBoneMask(rig, REGION_PREDICATES[layer.region])
      if (layer.localSpaceCurve) {
        dynamicAdditives.push(
          {
            layer,
            entry: {
              referencePose: layeringReference,
              weight: 0,
              mask,
              additiveSpace: 'mesh',
            },
          },
          {
            layer,
            entry: {
              referencePose: layeringReference,
              weight: 0,
              mask,
              additiveSpace: 'local',
            },
          },
        )
      } else {
        dynamicAdditives.push({
          layer,
          entry: {
            referencePose: layeringReference,
            weight: 0,
            mask,
            additiveSpace: layer.additiveSpace ?? 'mesh',
          },
        })
      }
    }
    const fallbackSource = pickClip(gltf.animations)
    const fallbackClip = fallbackSource ? clipsByName.get(fallbackSource.name) : undefined
    const fallbackEntries = fallbackClip ? [fallbackClip.entry] : []
    const soloEntries: EvaluatorLayerEntry[] = fallbackClip ? [fallbackClip.entry] : []
    const normalDebugWeights: Record<string, number> = {
      groundedAmount: 0,
      gaitAmount: 0,
      gaitWalkingAmount: 0,
      gaitRunningAmount: 0,
      gaitSprintingAmount: 0,
      overlayModeRifle: 0,
    }
    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) normalDebugWeights[role] = 0
    for (const layer of ALS_LAYER_REGIONS) {
      normalDebugWeights[layer.baseCurve] = 0
      if (layer.additiveCurve) normalDebugWeights[layer.additiveCurve] = 0
      if (layer.localSpaceCurve) normalDebugWeights[layer.localSpaceCurve] = 0
    }
    const soloDebugWeights = new Map(
      clips.map((clip) => [clip.sampler.clip.name, { [clip.sampler.clip.name]: 1 }]),
    )
    const complete = rig.boneCount > 0
      && (Object.keys(CLIP_ROLES) as ClipRole[]).every((role) => roles[role])
    const gaitSources = (Object.keys(CLIP_ROLES) as ClipRole[]).flatMap(
      (role): RuntimeGaitSource[] => {
        const clip = roles[role]
        return clip
          ? [{
              clipKey: clip.sampler.clip.name,
              weight: 0,
              fallback: ROLE_GAIT_AMOUNT[role],
              entry: clip.entry,
            }]
          : []
      },
    )
    const mainInput: EvaluatePoseInput = {
      base: baseEntries,
      overlays: overlayEntries.map((overlay) => overlay.entry),
      dynamicAdditives: dynamicAdditives.map((additive) => additive.entry),
      rootMotion,
    }
    const fallbackInput: EvaluatePoseInput = { base: fallbackEntries, rootMotion }
    const soloInput: EvaluatePoseInput = { base: soloEntries, rootMotion }

    return {
      rig,
      applicator,
      evaluator,
      profile,
      rootMotion,
      clips,
      clipsByName,
      roles,
      overlaySources,
      overlayEntries,
      standReference,
      crouchReference,
      layeringReference,
      dynamicAdditives,
      fallbackClip,
      soloEntries,
      normalDebugWeights,
      soloDebugWeights,
      complete,
      gaitSources,
      mainInput,
      fallbackInput,
      soloInput,
    }
  }, [gltf.animations, gltf.scene])

  const soloClip = useRef<RuntimeClip | null>(null)
  useEffect(() => {
    window.__playClip = (name: string | null) => {
      if (name === null) {
        soloClip.current = null
        if (runtime.rootMotion) resetRootMotionExtractor(runtime.rootMotion)
        return true
      }
      const clip = runtime.clipsByName.get(name)
      if (!clip) {
        console.warn(`[Animation] Unknown clip "${name}"`)
        return false
      }
      clip.time = 0
      runtime.soloEntries[0] = clip.entry
      soloClip.current = clip
      if (runtime.rootMotion) resetRootMotionExtractor(runtime.rootMotion)
      return true
    }
    return () => {
      delete window.__playClip
      soloClip.current = null
    }
  }, [runtime])

  const standTargets = useRef([1, 0, 0, 0])
  const standWeights = useRef([1, 0, 0, 0])
  const crouchMoveWeight = useRef(0)
  const crouchingAmount = useRef(0)
  const velocityBlend = useRef(createVelocityBlend())
  const velocityTarget = useRef(createVelocityBlend())
  const velocityInitialized = useRef(false)
  const directionWeights = useRef(createSixDirectionWeights())
  const phase = useRef(0)
  const gaitAmounts = useRef<PoseGaitAmounts>({
    amount: 0,
    walking: 0,
    running: 0,
    sprinting: 0,
  })
  const table = useRef(createWeightTable())
  const rifleSourceWeights = useRef({ poses: 1, runArms: 0, sprintArms: 0 })
  const input = useRef<WeightTableInput>({
    standWeights: standWeights.current,
    crouchMoveWeight: 0,
    crouchingAmount: 0,
    inAirAmount: 0,
    montageGate: 0,
    velocityBlend: velocityBlend.current,
  })

  useFrame((_, delta) => {
    if (runtime.rig.boneCount === 0) return
    for (const clip of runtime.clips) advanceClip(clip, delta)

    const solo = soloClip.current
    if (solo) {
      solo.entry.time = solo.time
      solo.entry.weight = 1
      applyPose(runtime.applicator, evaluatePose(runtime.evaluator, runtime.soloInput).pose)
      window.__weightTable = runtime.soloDebugWeights.get(solo.sampler.clip.name)
      return
    }

    if (!runtime.complete) {
      const fallback = runtime.fallbackClip
      if (!fallback) return
      fallback.entry.time = fallback.time
      fallback.entry.weight = 1
      applyPose(runtime.applicator, evaluatePose(runtime.evaluator, runtime.fallbackInput).pose)
      window.__weightTable = runtime.soloDebugWeights.get(fallback.sampler.clip.name)
      return
    }

    const rawSpeed = controls.current.moving
      ? Math.max(0, controls.current.speed)
      : 0
    const crouching = controls.current.stance === 'Crouching'
    // Deliberate M3 staging trade: StandToCrouch/CrouchToStand clips are present, but until the
    // transition arbiter owns them, this is the single non-popping Stance path.
    crouchingAmount.current = damp(
      crouchingAmount.current,
      crouching ? 1 : 0,
      CROUCHING_AMOUNT_DAMP_RATE,
      delta,
    )
    // ALS exposes crouch walk/run maxima of 1.5/2.0m/s. The pack has one crouch walk cycle, so
    // speeds above walk cadence-scale that cycle up to the authored crouch-run movement cap.
    const crouchLimitedSpeed = Math.min(rawSpeed, ALS_AUTHORED_GAIT_SPEEDS.crouching.run)
    const locomotionSpeed =
      rawSpeed + (crouchLimitedSpeed - rawSpeed) * crouchingAmount.current
    const crouchTarget = updateLocomotionTargets(
      locomotionSpeed,
      standTargets.current,
      GAIT_SPEEDS,
      ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    )
    for (let i = 0; i < standWeights.current.length; i++) {
      standWeights.current[i] = damp(
        standWeights.current[i],
        standTargets.current[i],
        GAIT_DAMP_RATE,
        delta,
      )
    }
    crouchMoveWeight.current = damp(
      crouchMoveWeight.current,
      crouchTarget,
      GAIT_DAMP_RATE,
      delta,
    )

    const directionRadians = THREE.MathUtils.degToRad(controls.current.direction)
    stepVelocityBlend(
      velocityBlend.current,
      {
        x: Math.cos(directionRadians) * locomotionSpeed,
        y: Math.sin(directionRadians) * locomotionSpeed,
        z: 0,
      },
      0,
      delta,
      !velocityInitialized.current,
      velocityTarget.current,
    )
    velocityInitialized.current = true

    const weightInput = input.current
    weightInput.crouchMoveWeight = crouchMoveWeight.current
    weightInput.crouchingAmount = crouchingAmount.current
    const weights = computeWeightTable(
      weightInput,
      table.current,
      directionWeights.current,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      const clip = runtime.roles[role]
      if (!clip) continue
      clip.entry.time = clip.sampler.clip.duration * phase.current
      clip.entry.weight = weights[role]
    }

    const fallbackGaitAmount =
      (standWeights.current[STAND.WALK]
        + standWeights.current[STAND.RUN] * 2
        + standWeights.current[STAND.SPRINT] * 3)
        * (1 - crouchingAmount.current)
      + crouchMoveWeight.current * crouchingAmount.current

    const rifleActive = controls.current.overlayMode === 'Rifle'
    resolveRifleOverlaySourceWeights(
      fallbackGaitAmount,
      rifleSourceWeights.current,
    )
    for (const source of runtime.overlaySources) {
      source.weight = rifleActive ? rifleSourceWeights.current[source.key] : 0
      source.time = source.key === 'poses'
        ? RIFLE_RELAXED_POSE_TIME
        : source.clip.sampler.clip.duration * phase.current
    }
    const curveSources: readonly OverlayCurveSource[] = runtime.overlaySources
    // AB_Als_Rifle's movement states replace the full pose-bank evaluator with arms-only sources.
    // Walking has no authored arms cycle, so its held rifle upper body remains while the lower
    // body LayerPelvis/LayerLegs ownership fades with the locomotion idle share.
    const poseBankLowerBodyGate = standWeights.current[STAND.IDLE]
    for (const overlay of runtime.overlayEntries) {
      const lowerBodyGate =
        overlay.source.key === 'poses'
        && (overlay.layer.region === 'pelvis' || overlay.layer.region === 'legs')
          ? poseBankLowerBodyGate
          : 1
      overlay.entry.time = overlay.source.time
      overlay.entry.weight = overlay.source.weight
        * (overlay.source.curves?.[overlay.layer.baseCurve]?.(overlay.source.time) ?? 0)
        * lowerBodyGate
        * weights.groundedAmount
    }

    copyPose(runtime.standReference, runtime.layeringReference)
    blendPoseInPlace(
      runtime.layeringReference,
      runtime.crouchReference,
      crouchingAmount.current,
    )
    for (const additive of runtime.dynamicAdditives) {
      const layerAmount = blendOverlayCurve(curveSources, additive.layer.baseCurve)
      const additiveAmount = blendOverlayCurve(
        curveSources,
        additive.layer.additiveCurve!,
      )
      const localSpaceAmount = additive.layer.localSpaceCurve
        ? blendOverlayCurve(curveSources, additive.layer.localSpaceCurve)
        : additive.layer.additiveSpace === 'local' ? 1 : 0
      const armSpaceAmounts = additive.layer.localSpaceCurve
        ? resolveArmAdditiveSpaceAmounts(localSpaceAmount)
        : undefined
      const spaceAmount = additive.entry.additiveSpace === 'local'
        ? armSpaceAmounts?.local ?? localSpaceAmount
        : armSpaceAmounts?.mesh ?? 1 - localSpaceAmount
      additive.entry.weight = rifleActive
        ? layerAmount * additiveAmount * spaceAmount * weights.groundedAmount
        : 0
    }

    const result = evaluatePose(runtime.evaluator, runtime.mainInput)
    applyPose(runtime.applicator, result.pose)

    for (const source of runtime.gaitSources) source.weight = source.entry.weight
    const gaitAmount = blendCurveValue(
      result.curves,
      'PoseGait',
      runtime.gaitSources,
      fallbackGaitAmount,
    )
    resolvePoseGaitAmounts(gaitAmount, gaitAmounts.current)

    phase.current = advanceLocomotionPhase(
      phase.current,
      delta,
      locomotionSpeed,
      standWeights.current,
      crouchMoveWeight.current,
      crouchingAmount.current,
      {
        walk: runtime.profile.walk.stride,
        run: runtime.profile.run.stride,
        sprint: runtime.profile.sprint.stride,
        crouchWalk: runtime.profile.crouchWalk.stride,
      },
      gaitAmounts.current.amount,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      runtime.normalDebugWeights[role] = weights[role]
    }
    runtime.normalDebugWeights.groundedAmount = weights.groundedAmount
    runtime.normalDebugWeights.gaitAmount = gaitAmounts.current.amount
    runtime.normalDebugWeights.gaitWalkingAmount = gaitAmounts.current.walking
    runtime.normalDebugWeights.gaitRunningAmount = gaitAmounts.current.running
    runtime.normalDebugWeights.gaitSprintingAmount = gaitAmounts.current.sprinting
    runtime.normalDebugWeights.overlayModeRifle = rifleActive ? 1 : 0
    for (const layer of ALS_LAYER_REGIONS) {
      runtime.normalDebugWeights[layer.baseCurve] = blendOverlayCurve(
        curveSources,
        layer.baseCurve,
      )
      if (layer.additiveCurve) {
        runtime.normalDebugWeights[layer.additiveCurve] = blendOverlayCurve(
          curveSources,
          layer.additiveCurve,
        )
      }
      if (layer.localSpaceCurve) {
        runtime.normalDebugWeights[layer.localSpaceCurve] = blendOverlayCurve(
          curveSources,
          layer.localSpaceCurve,
        )
      }
    }
    window.__weightTable = runtime.normalDebugWeights
  })
}
