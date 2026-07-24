import * as THREE from 'three'
import { pickClip } from '../engine/pickClip'
import { applyPose, createPoseApplicator } from '../engine/applyPose'
import { blendPoseInPlace, compileBoneMask } from '../engine/blend'
import { compileClipSampler, sampleClip } from '../engine/clipSampler'
import type { CompiledClipSampler } from '../engine/clipSampler'
import {
  blendCurveValue,
  compileClipCurveSamplers,
} from '../engine/curves'
import type {
  ClipCurveSamplers,
  WeightedCurveSource,
} from '../engine/curves'
import { createPoseEvaluator, evaluatePose } from '../engine/evaluator'
import type {
  EvaluatePoseInput,
  EvaluatorDynamicAdditiveEntry,
  EvaluatorLayerEntry,
} from '../engine/evaluator'
import { copyPose, createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../engine/rootMotion'
import type { RootMotionExtractor } from '../engine/rootMotion'
import { advanceLocomotionPhase, STAND, updateLocomotionTargets } from './AnimGraph/blendspace'
import {
  ALS_LAYER_REGIONS,
  blendOverlayCurve,
  RIFLE_OVERLAY_CLIPS,
  RIFLE_RELAXED_POSE_TIME,
  resolveArmAdditiveSpaceAmounts,
  resolveRifleOverlaySourceWeights,
} from './AnimGraph/overlayMode'
import type {
  AlsLayerRegion,
  AlsOverlayMode,
  OverlayCurveSource,
} from './AnimGraph/overlayMode'
import {
  computeWeightTable,
  createSixDirectionWeights,
  createWeightTable,
} from './AnimGraph/weightTable'
import type { WeightTable, WeightTableInput } from './AnimGraph/weightTable'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  buildLocomotionProfile,
} from './Settings/AlsMovementSettings'
import type { AlsGait, AlsStance } from './Settings/AlsMovementSettings'
import {
  createVelocityBlend,
  stepVelocityBlend,
} from './State/AlsGroundedState'
import { createAlsPoseState } from './State/AlsPoseState'
import type { AlsPoseState } from './State/AlsPoseState'
import { POSE_GAIT_CURVE_NAME, REGION_PREDICATES } from './Utility/AlsConstants'

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

export interface AlsAnimationInstanceControls {
  gait: AlsGait
  moving: boolean
  stance: AlsStance
  overlayMode: AlsOverlayMode
  speed: number
  direction: number
}

export interface AlsAnimationInstance {
  playClip: (name: string | null) => boolean
  clearSoloClip: () => void
  refresh: (delta: number, controls: AlsAnimationInstanceControls) => void
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
 * weight table and region rules remain the graph; the React hook only forwards frame delta and
 * current controls into this animation-instance analog.
 */
export function createAlsAnimationInstance(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
}): AlsAnimationInstance {
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

  let soloClip: RuntimeClip | null = null
  const standTargets = [1, 0, 0, 0]
  const standWeights = [1, 0, 0, 0]
  let crouchMoveWeight = 0
  let crouchingAmount = 0
  const velocityBlend = createVelocityBlend()
  const velocityTarget = createVelocityBlend()
  let velocityInitialized = false
  const directionWeights = createSixDirectionWeights()
  let phase = 0
  const gaitAmounts = createAlsPoseState()
  const table = createWeightTable()
  const rifleSourceWeights = { poses: 1, runArms: 0, sprintArms: 0 }
  const input: WeightTableInput = {
    standWeights,
    crouchMoveWeight: 0,
    crouchingAmount: 0,
    inAirAmount: 0,
    montageGate: 0,
    velocityBlend,
  }

  function playClip(name: string | null) {
    if (name === null) {
      soloClip = null
      if (rootMotion) resetRootMotionExtractor(rootMotion)
      return true
    }
    const clip = clipsByName.get(name)
    if (!clip) {
      console.warn(`[Animation] Unknown clip "${name}"`)
      return false
    }
    clip.time = 0
    soloEntries[0] = clip.entry
    soloClip = clip
    if (rootMotion) resetRootMotionExtractor(rootMotion)
    return true
  }

  function clearSoloClip() {
    soloClip = null
  }

  function refresh(delta: number, controls: AlsAnimationInstanceControls) {
    if (rig.boneCount === 0) return
    for (const clip of clips) advanceClip(clip, delta)

    if (soloClip) {
      soloClip.entry.time = soloClip.time
      soloClip.entry.weight = 1
      applyPose(applicator, evaluatePose(evaluator, soloInput).pose)
      window.__weightTable = soloDebugWeights.get(soloClip.sampler.clip.name)
      return
    }

    if (!complete) {
      if (!fallbackClip) return
      fallbackClip.entry.time = fallbackClip.time
      fallbackClip.entry.weight = 1
      applyPose(applicator, evaluatePose(evaluator, fallbackInput).pose)
      window.__weightTable = soloDebugWeights.get(fallbackClip.sampler.clip.name)
      return
    }

    const rawSpeed = controls.moving
      ? Math.max(0, controls.speed)
      : 0
    const crouching = controls.stance === 'Crouching'
    // Deliberate M3 staging trade: StandToCrouch/CrouchToStand clips are present, but until the
    // transition arbiter owns them, this is the single non-popping Stance path.
    crouchingAmount = damp(
      crouchingAmount,
      crouching ? 1 : 0,
      CROUCHING_AMOUNT_DAMP_RATE,
      delta,
    )
    // ALS exposes crouch walk/run maxima of 1.5/2.0m/s. The pack has one crouch walk cycle, so
    // speeds above walk cadence-scale that cycle up to the authored crouch-run movement cap.
    const crouchLimitedSpeed = Math.min(rawSpeed, ALS_AUTHORED_GAIT_SPEEDS.crouching.run)
    const locomotionSpeed =
      rawSpeed + (crouchLimitedSpeed - rawSpeed) * crouchingAmount
    const crouchTarget = updateLocomotionTargets(
      locomotionSpeed,
      standTargets,
      GAIT_SPEEDS,
      ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    )
    for (let i = 0; i < standWeights.length; i++) {
      standWeights[i] = damp(
        standWeights[i],
        standTargets[i],
        GAIT_DAMP_RATE,
        delta,
      )
    }
    crouchMoveWeight = damp(
      crouchMoveWeight,
      crouchTarget,
      GAIT_DAMP_RATE,
      delta,
    )

    const directionRadians = THREE.MathUtils.degToRad(controls.direction)
    refreshVelocityBlend(
      velocityBlend,
      {
        x: Math.cos(directionRadians) * locomotionSpeed,
        y: Math.sin(directionRadians) * locomotionSpeed,
        z: 0,
      },
      0,
      delta,
      !velocityInitialized,
      velocityTarget,
    )
    velocityInitialized = true

    input.crouchMoveWeight = crouchMoveWeight
    input.crouchingAmount = crouchingAmount
    const weights = computeWeightTable(
      input,
      table,
      directionWeights,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      const clip = roles[role]
      if (!clip) continue
      clip.entry.time = clip.sampler.clip.duration * phase
      clip.entry.weight = weights[role]
    }

    const fallbackGaitAmount =
      (standWeights[STAND.WALK]
        + standWeights[STAND.RUN] * 2
        + standWeights[STAND.SPRINT] * 3)
        * (1 - crouchingAmount)
      + crouchMoveWeight * crouchingAmount

    const rifleActive = controls.overlayMode === 'Rifle'
    resolveRifleOverlaySourceWeights(
      fallbackGaitAmount,
      rifleSourceWeights,
    )
    for (const source of overlaySources) {
      source.weight = rifleActive ? rifleSourceWeights[source.key] : 0
      source.time = source.key === 'poses'
        ? RIFLE_RELAXED_POSE_TIME
        : source.clip.sampler.clip.duration * phase
    }
    const curveSources: readonly OverlayCurveSource[] = overlaySources
    // AB_Als_Rifle's movement states replace the full pose-bank evaluator with arms-only sources.
    // Walking has no authored arms cycle, so its held rifle upper body remains while the lower
    // body LayerPelvis/LayerLegs ownership fades with the locomotion idle share.
    const poseBankLowerBodyGate = standWeights[STAND.IDLE]
    for (const overlay of overlayEntries) {
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

    copyPose(standReference, layeringReference)
    blendPoseInPlace(
      layeringReference,
      crouchReference,
      crouchingAmount,
    )
    for (const additive of dynamicAdditives) {
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

    const result = evaluatePose(evaluator, mainInput)
    applyPose(applicator, result.pose)

    for (const source of gaitSources) source.weight = source.entry.weight
    const gaitAmount = blendCurveValue(
      result.curves,
      POSE_GAIT_CURVE_NAME,
      gaitSources,
      fallbackGaitAmount,
    )
    refreshPose(gaitAmount, gaitAmounts)

    phase = advanceLocomotionPhase(
      phase,
      delta,
      locomotionSpeed,
      standWeights,
      crouchMoveWeight,
      crouchingAmount,
      {
        walk: profile.walk.stride,
        run: profile.run.stride,
        sprint: profile.sprint.stride,
        crouchWalk: profile.crouchWalk.stride,
      },
      gaitAmounts.amount,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      normalDebugWeights[role] = weights[role]
    }
    normalDebugWeights.groundedAmount = weights.groundedAmount
    normalDebugWeights.gaitAmount = gaitAmounts.amount
    normalDebugWeights.gaitWalkingAmount = gaitAmounts.walking
    normalDebugWeights.gaitRunningAmount = gaitAmounts.running
    normalDebugWeights.gaitSprintingAmount = gaitAmounts.sprinting
    normalDebugWeights.overlayModeRifle = rifleActive ? 1 : 0
    for (const layer of ALS_LAYER_REGIONS) {
      normalDebugWeights[layer.baseCurve] = blendOverlayCurve(
        curveSources,
        layer.baseCurve,
      )
      if (layer.additiveCurve) {
        normalDebugWeights[layer.additiveCurve] = blendOverlayCurve(
          curveSources,
          layer.additiveCurve,
        )
      }
      if (layer.localSpaceCurve) {
        normalDebugWeights[layer.localSpaceCurve] = blendOverlayCurve(
          curveSources,
          layer.localSpaceCurve,
        )
      }
    }
    window.__weightTable = normalDebugWeights
  }

  return { playClip, clearSoloClip, refresh }
}

/** ALS `RefreshVelocityBlend`; re-exported here so the refresh family lives with its class analog. */
export const refreshVelocityBlend = stepVelocityBlend

/** ALS `RefreshPose` gait ramps (AlsAnimationInstance.cpp:313-351). */
export function refreshPose(
  gaitAmount: number,
  out: AlsPoseState = createAlsPoseState(),
): AlsPoseState {
  const clamped = Math.max(0, Math.min(3, gaitAmount))
  out.amount = clamped
  out.walking = Math.max(0, Math.min(1, clamped))
  out.running = Math.max(0, Math.min(1, clamped - 1))
  out.sprinting = Math.max(0, Math.min(1, clamped - 2))
  return out
}
