import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { pickClip } from '../anim/pickClip'
import { advanceLocomotionPhase, STAND, updateLocomotionTargets } from '../player/blendspace'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  buildLocomotionProfile,
} from '../player/locomotionProfile'
import { applyPose, createPoseApplicator } from '../player/pose/applyPose'
import { compileBoneMask } from '../player/pose/blend'
import { compileClipSampler } from '../player/pose/clipSampler'
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
  EvaluatorLayerEntry,
} from '../player/pose/evaluator'
import { createRigDefinition } from '../player/pose/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../player/pose/rootMotion'
import type { RootMotionExtractor } from '../player/pose/rootMotion'
import { evaluateRegionOverlays, REGION_OVERLAY_RULES } from '../player/regionOverlays'
import type { OverlayContext, RegionOverlayRule } from '../player/regionOverlays'
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
// The ALS C++ spec does not own stance transition timing. This is the sibling repo's posture
// rate (Player.tsx POSTURE_DAMP), retained for the shared stand↔crouch feel.
const POSTURE_DAMP_RATE = 10

interface RuntimeClip {
  readonly sampler: CompiledClipSampler
  readonly curves?: ClipCurveSamplers
  readonly entry: EvaluatorLayerEntry
  time: number
}

interface RuntimeOverlay {
  readonly rule: RegionOverlayRule
  readonly clip: RuntimeClip
  readonly entry: EvaluatorLayerEntry
}

interface RuntimeGaitSource extends WeightedCurveSource {
  readonly entry: EvaluatorLayerEntry
}

declare global {
  interface Window {
    /** Dev/test hook: last frame's applied clip weights by role (+ overlay rule ids). */
    __weightTable?: Record<string, number>
    /** Dev/test hook: override the Leva speed input (m/s). */
    __setSpeed?: (speed: number) => void
    /** Dev/test hook: play a named source clip solo, or pass null to resume the weight table. */
    __playClip?: (name: string | null) => boolean
  }
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
  const [{ speed, direction, stance }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      speed: {
        value: 0,
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
      stance: {
        value: 'stand',
        options: ['stand', 'crouch'],
        label: 'stance',
      },
    }),
    { order: 1 },
  )
  const controls = useRef({ speed, direction, stance })
  controls.current = { speed, direction, stance }

  useEffect(() => {
    window.__setSpeed = (value: number) => setControls({ speed: value })
    return () => { delete window.__setSpeed }
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
    const overlays = REGION_OVERLAY_RULES.flatMap((rule): RuntimeOverlay[] => {
      const clip = clipsByName.get(rule.clip)
      if (!clip) return []
      // Overlay curves do not participate in the base graph's PoseGait result.
      const entry = createEntry(clip.sampler)
      entry.mask = compileBoneMask(rig, REGION_PREDICATES[rule.region])
      return [{ rule, clip, entry }]
    })
    const fallbackSource = pickClip(gltf.animations)
    const fallbackClip = fallbackSource ? clipsByName.get(fallbackSource.name) : undefined
    const fallbackEntries = fallbackClip ? [fallbackClip.entry] : []
    const soloEntries: EvaluatorLayerEntry[] = fallbackClip ? [fallbackClip.entry] : []
    const overlayRules = overlays.map((overlay) => overlay.rule)
    const normalDebugWeights: Record<string, number> = {
      stanceAlpha: 0,
      gaitAmount: 0,
      gaitWalkingAmount: 0,
      gaitRunningAmount: 0,
      gaitSprintingAmount: 0,
    }
    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) normalDebugWeights[role] = 0
    for (const overlay of overlays) normalDebugWeights[overlay.rule.id] = 0
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
      overlays: overlays.map((overlay) => overlay.entry),
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
      overlays,
      overlayRules,
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
  const posture = useRef(0)
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
  const overlayOut = useRef(REGION_OVERLAY_RULES.map(() => 0))
  const overlayContext = useRef<OverlayContext>({
    idleShare: 1,
    walkShare: 0,
    runShare: 0,
    sprintShare: 0,
    sneak: 0,
    posture: 0,
    crawlBlend: 0,
    jumpBlend: 0,
  })
  const overlayAlphas = useRef({ stance: 1, airborne: 0 })
  const input = useRef<WeightTableInput>({
    standWeights: standWeights.current,
    crouchMoveWeight: 0,
    posture: 0,
    crawlBlend: 0,
    crawlMoveWeight: 0,
    tuckCrawl: 0,
    jumpBlend: 0,
    montageGate: 0,
    windup: 0,
    velocityBlend: velocityBlend.current,
    crouchTint: 0,
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

    const rawSpeed = Math.max(0, controls.current.speed)
    const crouched = controls.current.stance === 'crouch'
    // Deliberate M3 staging trade: StandToCrouch/CrouchToStand clips are present, but until the
    // transition arbiter owns them this posture crossfade is the single non-popping stance path.
    posture.current = damp(posture.current, crouched ? 1 : 0, POSTURE_DAMP_RATE, delta)
    // ALS exposes crouch walk/run maxima of 1.5/2.0m/s. The pack has one crouch walk cycle, so
    // speeds above walk cadence-scale that cycle up to the authored crouch-run movement cap.
    const crouchLimitedSpeed = Math.min(rawSpeed, ALS_AUTHORED_GAIT_SPEEDS.crouching.run)
    const locomotionSpeed =
      rawSpeed + (crouchLimitedSpeed - rawSpeed) * posture.current
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
    weightInput.posture = posture.current
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

    const context = overlayContext.current
    context.idleShare = standWeights.current[STAND.IDLE]
    context.walkShare = standWeights.current[STAND.WALK]
    context.runShare = standWeights.current[STAND.RUN]
    context.sprintShare = standWeights.current[STAND.SPRINT]
    context.posture = posture.current
    overlayAlphas.current.stance = weights.stanceAlpha
    overlayAlphas.current.airborne = weights.jumpArms
    evaluateRegionOverlays(
      runtime.overlayRules,
      context,
      overlayAlphas.current,
      overlayOut.current,
    )
    for (let i = 0; i < runtime.overlays.length; i++) {
      const overlay = runtime.overlays[i]
      overlay.entry.time = overlay.rule.holdAt === undefined
        ? overlay.rule.phaseLock
          ? overlay.clip.sampler.clip.duration * phase.current
          : overlay.clip.time
        : overlay.clip.sampler.clip.duration * overlay.rule.holdAt
      overlay.entry.weight = overlayOut.current[i]
    }

    const result = evaluatePose(runtime.evaluator, runtime.mainInput)
    applyPose(runtime.applicator, result.pose)

    for (const source of runtime.gaitSources) source.weight = source.entry.weight
    const fallbackGaitAmount =
      (standWeights.current[STAND.WALK]
        + standWeights.current[STAND.RUN] * 2
        + standWeights.current[STAND.SPRINT] * 3)
        * (1 - posture.current)
      + crouchMoveWeight.current * posture.current
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
      posture.current,
      {
        walk: runtime.profile.walk.stride,
        run: runtime.profile.run.stride,
        sprint: runtime.profile.sprint.stride,
        crouchWalk: runtime.profile.crouchWalk.stride,
      },
      0,
      0,
      0,
      gaitAmounts.current.amount,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      runtime.normalDebugWeights[role] = weights[role]
    }
    runtime.normalDebugWeights.stanceAlpha = weights.stanceAlpha
    runtime.normalDebugWeights.gaitAmount = gaitAmounts.current.amount
    runtime.normalDebugWeights.gaitWalkingAmount = gaitAmounts.current.walking
    runtime.normalDebugWeights.gaitRunningAmount = gaitAmounts.current.running
    runtime.normalDebugWeights.gaitSprintingAmount = gaitAmounts.current.sprinting
    for (let i = 0; i < runtime.overlays.length; i++) {
      runtime.normalDebugWeights[runtime.overlays[i].rule.id] = overlayOut.current[i]
    }
    window.__weightTable = runtime.normalDebugWeights
  })
}
