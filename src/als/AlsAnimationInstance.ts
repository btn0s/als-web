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
  CurveFrame,
  WeightedCurveSource,
} from '../engine/curves'
import { createPoseEvaluator, evaluatePose } from '../engine/evaluator'
import type {
  EvaluatePoseInput,
  EvaluatorDynamicAdditiveEntry,
  EvaluatorLayerEntry,
} from '../engine/evaluator'
import { measureInertializationCorrectionMagnitude } from '../engine/inertialization'
import { copyPose, createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../engine/rootMotion'
import type { RootMotionExtractor } from '../engine/rootMotion'
import {
  advanceSyncGroup,
  createSyncGroup,
} from '../engine/syncGroups'
import type {
  SyncMarker,
  SyncGroupMember,
  SyncMarkerTable,
} from '../engine/syncGroups'
import { createActionArbiter } from './AnimGraph/actionArbiter'
import {
  calculateLocomotionCadence,
  STAND,
  updateLocomotionTargets,
} from './AnimGraph/blendspace'
import {
  ALS_LAYER_REGIONS,
  blendOverlayCurve,
  RIFLE_OVERLAY_REGION_POLICY,
  RIFLE_OVERLAY_CLIPS,
  resolveArmAdditiveSpaceAmounts,
  resolveRiflePoseBankTime,
  resolveRifleOverlaySourceWeights,
  sampleRifleOverlayPolicyWeight,
} from './AnimGraph/overlayMode'
import type {
  AlsLayerRegion,
  AlsOverlayMode,
  OverlayCurveSource,
  RifleOverlayRegionPolicy,
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
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import { ALS_ROTATE_IN_PLACE_SETTINGS } from './Settings/AlsRotateInPlaceSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from './Settings/AlsTurnInPlaceSettings'
import {
  createVelocityBlend,
  stepVelocityBlend,
} from './State/AlsGroundedState'
import {
  createAlsPoseState,
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from './State/AlsPoseState'
import type { AlsPoseState } from './State/AlsPoseState'
import {
  advanceRotateInPlaceClipTime,
  createAlsRotateInPlaceState,
  refreshRotateInPlace as refreshRotateInPlaceState,
  resetRotateInPlaceFrame,
} from './State/AlsRotateInPlaceState'
import {
  createAlsTurnInPlaceState,
  refreshTurnInPlace as refreshTurnInPlaceState,
  resetTurnInPlaceFrame,
} from './State/AlsTurnInPlaceState'
import {
  FOOT_LEFT_LOCK_CURVE_NAME,
  FOOT_RIGHT_LOCK_CURVE_NAME,
  POSE_CROUCHING_CURVE_NAME,
  POSE_GAIT_CURVE_NAME,
  REGION_PREDICATES,
  ROTATION_YAW_SPEED_CURVE_NAME,
} from './Utility/AlsConstants'

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
const OVERLAY_MODE_INERTIALIZATION_DURATION = 0.2
const SOLO_INERTIALIZATION_DURATION = 0.2

const STANCE_TRANSITION_CLIPS = {
  Crouching: 'A_Als_StandToCrouch',
  Standing: 'A_Als_CrouchToStand',
} as const satisfies Record<AlsStance, string>

const ROTATE_IN_PLACE_CLIPS = {
  Standing: {
    Left: 'A_Als_Rotate_90_Left',
    Right: 'A_Als_Rotate_90_Right',
  },
  Crouching: {
    Left: 'A_Als_Crouch_Rotate_90_Left',
    Right: 'A_Als_Crouch_Rotate_90_Right',
  },
} as const satisfies Record<AlsStance, Record<'Left' | 'Right', string>>

interface RuntimeClip {
  readonly sampler: CompiledClipSampler
  readonly curves?: ClipCurveSamplers
  readonly entry: EvaluatorLayerEntry
  time: number
}

interface RuntimeOverlayEntry {
  readonly source: RuntimeOverlaySource
  readonly policy: RifleOverlayRegionPolicy
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

type AlsMontageKind = 'stance-transition' | 'turn-in-place'

interface RuntimeMontage {
  readonly kind: AlsMontageKind
  readonly clip: RuntimeClip
  /** Dynamic montage sequence rate (PlaySlotAnimationAsDynamicMontage argument). */
  readonly sequencePlayRate: number
  /** AnimGraph multiplier applied to RotationYawSpeed. */
  readonly rotationYawScale: number
  readonly blendDuration: number
}

export interface AlsAnimationInstanceControls {
  gait: AlsGait
  moving: boolean
  stance: AlsStance
  rotationMode: AlsRotationMode
  overlayMode: AlsOverlayMode
  speed: number
  direction: number
  rotateInPlace: boolean
  viewYawAngle: number
  viewYawSpeed: number
}

export interface AlsAnimationInstanceState {
  crouchingAmount: number
  footLeftLock: number
  footRightLock: number
  rotationYawSpeed: number
}

export interface AlsAnimationInstance {
  playClip: (name: string | null) => boolean
  clearSoloClip: () => void
  readonly state: AlsAnimationInstanceState
  refresh: (delta: number, controls: AlsAnimationInstanceControls) => number
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

function moveToward(current: number, target: number, maximumDelta: number) {
  if (current < target) return Math.min(current + maximumDelta, target)
  return Math.max(current - maximumDelta, target)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function clipSyncMarkers(clip: THREE.AnimationClip): readonly SyncMarker[] {
  const markers = clip.userData?.syncMarkers
  if (!Array.isArray(markers) || clip.duration <= 0) return []
  return markers.flatMap((marker): SyncMarker[] => {
    if (
      typeof marker?.name !== 'string'
      || typeof marker?.time !== 'number'
      || !Number.isFinite(marker.time)
    ) {
      return []
    }
    return [{
      name: marker.name,
      normalizedTime: clamp01(marker.time / clip.duration),
    }]
  })
}

/**
 * Resolves the ordinary weighted graph branch into UE's one final named-curve container. ALS's
 * graph-specific Pose, Layer, and turn curves override these generic values at the main graph
 * seam.
 */
function resolveWeightedEntryCurves(
  samples: CurveFrame,
  output: Map<string, number>,
  entries: readonly EvaluatorLayerEntry[],
) {
  let totalWeight = 0
  for (const entry of entries) {
    if (entry.weight > 0) totalWeight += entry.weight
  }
  if (totalWeight <= Number.EPSILON) return

  for (const entry of entries) {
    if (entry.weight <= 0) continue
    const clipKey = entry.curveKey ?? entry.sampler.clip.name
    const values = samples.byClip.get(clipKey)
    if (!values || !samples.activeClips.has(clipKey)) continue
    const normalizedWeight = entry.weight / totalWeight
    for (const [name, value] of values) {
      output.set(name, (output.get(name) ?? 0) + value * normalizedWeight)
    }
  }
}

/**
 * Owns sampling, pose-space composition, and the sole skeleton write for the character. The pure
 * weight table and region rules remain the graph; the React hook only forwards frame delta and
 * current controls into this animation-instance analog.
 */
export function createAlsAnimationInstance(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
  /** Optional normalized marker override; regular GLTF loads consume clip.userData.syncMarkers. */
  syncMarkers?: SyncMarkerTable
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
  const roleByClip = new Map<RuntimeClip, ClipRole>()
  for (const [role, clipName] of Object.entries(CLIP_ROLES) as [ClipRole, string][]) {
    const clip = clipsByName.get(clipName)
    if (clip) {
      roles[role] = clip
      roleByClip.set(clip, role)
    }
  }

  const baseEntries = Object.values(roles).map((clip) => clip.entry)
  const stanceTransitionClips = {
    Crouching: clipsByName.get(STANCE_TRANSITION_CLIPS.Crouching),
    Standing: clipsByName.get(STANCE_TRANSITION_CLIPS.Standing),
  }
  const rotateInPlaceClips = {
    Standing: {
      Left: clipsByName.get(ROTATE_IN_PLACE_CLIPS.Standing.Left),
      Right: clipsByName.get(ROTATE_IN_PLACE_CLIPS.Standing.Right),
    },
    Crouching: {
      Left: clipsByName.get(ROTATE_IN_PLACE_CLIPS.Crouching.Left),
      Right: clipsByName.get(ROTATE_IN_PLACE_CLIPS.Crouching.Right),
    },
  }
  const turnInPlaceClips = new Map(
    (Object.values(ALS_TURN_IN_PLACE_SETTINGS.clips) as Array<
      typeof ALS_TURN_IN_PLACE_SETTINGS.clips[AlsStance]
    >)
      .flatMap((byAngle) => Object.values(byAngle))
      .flatMap((byDirection) => Object.values(byDirection))
      .map((settings) => [settings.clip, clipsByName.get(settings.clip)] as const),
  )
  const montageClips = new Set<RuntimeClip>()
  for (const clip of Object.values(stanceTransitionClips)) {
    if (clip) montageClips.add(clip)
  }
  for (const clip of turnInPlaceClips.values()) {
    if (clip) montageClips.add(clip)
  }
  for (const byDirection of Object.values(rotateInPlaceClips)) {
    for (const clip of Object.values(byDirection)) {
      if (clip) montageClips.add(clip)
    }
  }
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
    RIFLE_OVERLAY_REGION_POLICY.map((policy): RuntimeOverlayEntry => {
      const entry = createEntry(source.clip.sampler)
      entry.mask = compileBoneMask(rig, REGION_PREDICATES[policy.region])
      return { source, policy, entry }
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
  for (const policy of RIFLE_OVERLAY_REGION_POLICY) {
    const layer = policy.layer
    if (!layer?.additiveCurve) continue
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
  const locomotionRoles = (Object.keys(CLIP_ROLES) as ClipRole[]).filter(
    (role) => role !== 'idle' && role !== 'crouchIdle',
  )
  const locomotionMembersByRole = new Map<ClipRole, SyncGroupMember>()
  const locomotionMembers: SyncGroupMember[] = []
  const syncClips = new Set<RuntimeClip>()
  for (const role of locomotionRoles) {
    const clip = roles[role]
    if (!clip) continue
    const clipName = clip.sampler.clip.name
    const member: SyncGroupMember = {
      id: clipName,
      duration: clip.sampler.clip.duration,
      markers: gltf.syncMarkers?.[clipName] ?? clipSyncMarkers(clip.sampler.clip),
      time: 0,
      weight: 0,
      playRate: 0,
    }
    locomotionMembersByRole.set(role, member)
    locomotionMembers.push(member)
    syncClips.add(clip)
  }
  const overlayLocomotionMembers = new Map<RuntimeOverlaySource, SyncGroupMember>()
  for (const source of overlaySources) {
    if (source.key === 'poses') continue
    const clipName = source.clip.sampler.clip.name
    const member: SyncGroupMember = {
      id: clipName,
      duration: source.clip.sampler.clip.duration,
      markers:
        gltf.syncMarkers?.[clipName] ?? clipSyncMarkers(source.clip.sampler.clip),
      canLead: false,
      time: 0,
      weight: 0,
      playRate: 0,
    }
    overlayLocomotionMembers.set(source, member)
    locomotionMembers.push(member)
    syncClips.add(source.clip)
  }
  const locomotionSyncGroup = createSyncGroup('Locomotion', locomotionMembers)
  const mainCurveEntries = [
    ...baseEntries,
    ...[...montageClips].map((clip) => clip.entry),
  ]
  const curveSources: readonly OverlayCurveSource[] = overlaySources
  let graphFallbackGaitAmount = 0
  let graphCrouchingAmount = 0
  let graphFootLeftLock = 0
  let graphFootRightLock = 0
  let graphRotationYawSpeed = 0
  const mainInput: EvaluatePoseInput = {
    base: baseEntries,
    montages: mainCurveEntries.slice(baseEntries.length),
    overlays: overlayEntries.map((overlay) => overlay.entry),
    dynamicAdditives: dynamicAdditives.map((additive) => additive.entry),
    rootMotion,
    resolveBlendedCurves(samples, output) {
      resolveWeightedEntryCurves(samples, output, mainCurveEntries)

      // These are the explicit AnimGraph outputs consumed by ALS. They are resolved before the
      // engine-owned downstream inertialization node so every live consumer sees the same final
      // named-value container as the pose.
      output.set(
        POSE_GAIT_CURVE_NAME,
        blendCurveValue(
          samples,
          POSE_GAIT_CURVE_NAME,
          gaitSources,
          graphFallbackGaitAmount,
        ),
      )
      output.set(POSE_CROUCHING_CURVE_NAME, graphCrouchingAmount)
      output.set(FOOT_LEFT_LOCK_CURVE_NAME, graphFootLeftLock)
      output.set(FOOT_RIGHT_LOCK_CURVE_NAME, graphFootRightLock)
      output.set(ROTATION_YAW_SPEED_CURVE_NAME, graphRotationYawSpeed)

      for (const layer of ALS_LAYER_REGIONS) {
        output.set(
          layer.baseCurve,
          blendOverlayCurve(curveSources, layer.baseCurve),
        )
        if (layer.additiveCurve) {
          output.set(
            layer.additiveCurve,
            blendOverlayCurve(curveSources, layer.additiveCurve),
          )
        }
        if (layer.localSpaceCurve) {
          output.set(
            layer.localSpaceCurve,
            blendOverlayCurve(curveSources, layer.localSpaceCurve),
          )
        }
      }
    },
  }
  const fallbackInput: EvaluatePoseInput = {
    base: fallbackEntries,
    rootMotion,
    resolveBlendedCurves: (samples, output) => {
      resolveWeightedEntryCurves(samples, output, fallbackEntries)
    },
  }
  const soloInput: EvaluatePoseInput = {
    base: soloEntries,
    rootMotion,
    resolveBlendedCurves: (samples, output) => {
      resolveWeightedEntryCurves(samples, output, soloEntries)
    },
  }

  let soloClip: RuntimeClip | null = null
  const standTargets = [1, 0, 0, 0]
  const standWeights = [1, 0, 0, 0]
  let crouchMoveWeight = 0
  const stanceTransitionState = createAlsStanceTransitionCurveState()
  const turnInPlaceState = createAlsTurnInPlaceState()
  const rotateInPlaceState = createAlsRotateInPlaceState()
  const actionArbiter = createActionArbiter<AlsMontageKind>()
  let activeMontage: RuntimeMontage | null = null
  let previousStance: AlsStance | null = null
  let previousOverlayMode: AlsOverlayMode | null = null
  let rotateClip: RuntimeClip | null = null
  let rotateClipTime = 0
  let rotateBlendWeight = 0
  const state: AlsAnimationInstanceState = {
    crouchingAmount: 0,
    footLeftLock: 0,
    footRightLock: 0,
    rotationYawSpeed: 0,
  }
  const velocityBlend = createVelocityBlend()
  const velocityTarget = createVelocityBlend()
  let velocityInitialized = false
  const directionWeights = createSixDirectionWeights()
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
      if (soloClip) {
        evaluator.inertialization.requestInertialization(
          SOLO_INERTIALIZATION_DURATION,
        )
      }
      soloClip = null
      if (rootMotion) resetRootMotionExtractor(rootMotion)
      return true
    }
    const clip = clipsByName.get(name)
    if (!clip) {
      console.warn(`[Animation] Unknown clip "${name}"`)
      return false
    }
    if (clip !== soloClip) {
      evaluator.inertialization.requestInertialization(
        SOLO_INERTIALIZATION_DURATION,
      )
    }
    clip.time = 0
    soloEntries[0] = clip.entry
    soloClip = clip
    if (rootMotion) resetRootMotionExtractor(rootMotion)
    return true
  }

  function clearSoloClip() {
    playClip(null)
  }

  function requestMontage(montage: RuntimeMontage) {
    const accepted = actionArbiter.request({
      kind: montage.kind,
      clip: montage.clip.sampler.clip.name,
      duration: montage.clip.sampler.clip.duration / montage.sequencePlayRate,
      bodyMotion: montage.kind === 'turn-in-place' ? 'kinematic-warp' : 'none',
      interrupt: 'interruptible',
    })
    if (accepted) {
      montage.clip.time = 0
      activeMontage = montage
      evaluator.inertialization.requestInertialization(montage.blendDuration)
    }
    return accepted
  }

  function refresh(delta: number, controls: AlsAnimationInstanceControls) {
    if (rig.boneCount === 0) return 0
    mainInput.deltaTime = delta
    fallbackInput.deltaTime = delta
    soloInput.deltaTime = delta
    if (soloClip) {
      // Solo owns its selected clip clock directly. Sync-group membership only has meaning while
      // the graph is evaluating the group; bypassing it here prevents the early return from
      // freezing locomotion clips that happen to be group members.
      advanceClip(soloClip, delta)
      soloClip.entry.time = soloClip.time
      soloClip.entry.weight = 1
      applyPose(applicator, evaluatePose(evaluator, soloInput).pose)
      const debugWeights = soloDebugWeights.get(soloClip.sampler.clip.name)
      if (debugWeights) {
        debugWeights.clipTime = soloClip.entry.time
        debugWeights.clipPhase = soloClip.sampler.clip.duration > 0
          ? soloClip.entry.time / soloClip.sampler.clip.duration
          : 0
        const role = roleByClip.get(soloClip)
        if (role) {
          debugWeights[`clipTime.${role}`] = debugWeights.clipTime
          debugWeights[`clipPhase.${role}`] = debugWeights.clipPhase
        }
        debugWeights.inertializationCorrectionMagnitude =
          measureInertializationCorrectionMagnitude(evaluator.inertialization)
        debugWeights.inertializationRequestCount =
          evaluator.inertialization.requestCount
      }
      window.__weightTable = debugWeights
      // Controls may change while the normal graph is dormant. The solo transition request owns
      // the eventual handoff, so do not emit a second overlay request on the first resumed frame.
      previousOverlayMode = controls.overlayMode
      state.rotationYawSpeed = 0
      return 0
    }

    for (const clip of clips) {
      if (!syncClips.has(clip)) advanceClip(clip, delta)
    }

    if (!complete) {
      if (!fallbackClip) return 0
      if (syncClips.has(fallbackClip)) advanceClip(fallbackClip, delta)
      fallbackClip.entry.time = fallbackClip.time
      fallbackClip.entry.weight = 1
      applyPose(applicator, evaluatePose(evaluator, fallbackInput).pose)
      const debugWeights = soloDebugWeights.get(fallbackClip.sampler.clip.name)
      if (debugWeights) {
        debugWeights.clipTime = fallbackClip.entry.time
        debugWeights.clipPhase = fallbackClip.sampler.clip.duration > 0
          ? fallbackClip.entry.time / fallbackClip.sampler.clip.duration
          : 0
        debugWeights.inertializationCorrectionMagnitude =
          measureInertializationCorrectionMagnitude(evaluator.inertialization)
        debugWeights.inertializationRequestCount =
          evaluator.inertialization.requestCount
      }
      window.__weightTable = debugWeights
      state.rotationYawSpeed = 0
      return 0
    }

    const rawSpeed = controls.moving
      ? Math.max(0, controls.speed)
      : 0
    for (const clip of montageClips) clip.entry.weight = 0
    const crouching = controls.stance === 'Crouching'
    const targetCrouchingAmount = crouching ? 1 : 0

    if (previousStance === null) {
      previousStance = controls.stance
      stanceTransitionState.crouchingAmount = targetCrouchingAmount
    } else if (controls.stance !== previousStance) {
      previousStance = controls.stance
      const clip = stanceTransitionClips[controls.stance]
      if (clip) {
        requestMontage({
          kind: 'stance-transition',
          clip,
          sequencePlayRate: 1,
          rotationYawScale: 1,
          blendDuration: 0.2,
        })
      }
    }

    const turnInPlaceAllowed = controls.rotationMode === 'ViewDirection'
    const rotateInPlaceAllowed =
      controls.rotationMode === 'Aiming' || controls.rotateInPlace
    resetTurnInPlaceFrame(turnInPlaceState)
    if (
      turnInPlaceAllowed
      && !rotateInPlaceAllowed
      && !controls.moving
      && actionArbiter.active === null
    ) {
      const turnRequest = refreshTurnInPlaceState(turnInPlaceState, {
        delta,
        transitionsAllowed: true,
        viewYawAngle: controls.viewYawAngle,
        viewYawSpeed: controls.viewYawSpeed,
        stance: controls.stance,
      })
      const clip = turnRequest
        ? turnInPlaceClips.get(turnRequest.settings.clip)
        : undefined
      if (turnRequest && clip) {
        requestMontage({
          kind: 'turn-in-place',
          clip,
          // ALS plays the dynamic montage at the asset's base 1.2 rate, then the AnimGraph scales
          // RotationYawSpeed by 1.2 * |QueuedAngle / AnimatedAngle| (cpp:1819-1829).
          sequencePlayRate: turnRequest.settings.playRate,
          rotationYawScale: turnRequest.playRate,
          blendDuration: ALS_TURN_IN_PLACE_SETTINGS.blendDuration,
        })
      }
    } else if (!turnInPlaceAllowed || rotateInPlaceAllowed || controls.moving) {
      turnInPlaceState.activationDelay = 0
    }

    const action = actionArbiter.update(delta)
    let actionBlendWeight = 0
    if (action && activeMontage) {
      const duration = activeMontage.clip.sampler.clip.duration
        / activeMontage.sequencePlayRate
      activeMontage.clip.time = Math.min(
        action.progress * duration * activeMontage.sequencePlayRate,
        activeMontage.clip.sampler.clip.duration,
      )
      actionBlendWeight = 1
      activeMontage.clip.entry.time = activeMontage.clip.time
      activeMontage.clip.entry.weight = actionBlendWeight
      activeMontage.clip.entry.loop = false
    } else if (!actionArbiter.active) {
      if (activeMontage) {
        evaluator.inertialization.requestInertialization(
          activeMontage.blendDuration,
        )
      }
      activeMontage = null
    }

    const stanceTransition = activeMontage?.kind === 'stance-transition'
      && action
      ? {
          time: activeMontage.clip.time,
          curves: activeMontage.clip.curves ?? {},
        }
      : undefined
    refreshStanceTransition(
      stanceTransitionState,
      targetCrouchingAmount,
      delta,
      stanceTransition,
    )
    const crouchingAmount = stanceTransitionState.crouchingAmount
    state.crouchingAmount = crouchingAmount
    state.footLeftLock = stanceTransitionState.footLeftLock
    state.footRightLock = stanceTransitionState.footRightLock
    graphCrouchingAmount = crouchingAmount
    graphFootLeftLock = state.footLeftLock
    graphFootRightLock = state.footRightLock

    resetRotateInPlaceFrame(rotateInPlaceState)
    refreshRotateInPlaceState(rotateInPlaceState, {
      delta,
      moving: controls.moving || action !== null,
      allowed: rotateInPlaceAllowed,
      viewYawAngle: controls.viewYawAngle,
      viewYawSpeed: controls.viewYawSpeed,
    })
    const rotateDirection = rotateInPlaceState.rotatingLeft
      ? 'Left'
      : rotateInPlaceState.rotatingRight ? 'Right' : null
    const selectedRotateClip = rotateDirection
      ? rotateInPlaceClips[controls.stance][rotateDirection]
      : undefined
    if (selectedRotateClip && selectedRotateClip !== rotateClip) {
      rotateClip = selectedRotateClip
      rotateClipTime = 0
    }
    rotateBlendWeight = moveToward(
      rotateBlendWeight,
      selectedRotateClip ? 1 : 0,
      delta / ALS_ROTATE_IN_PLACE_SETTINGS.blendDuration,
    )
    if (rotateClip && rotateBlendWeight > 0) {
      rotateClipTime = advanceRotateInPlaceClipTime(
        rotateClipTime,
        delta,
        rotateInPlaceState.playRate,
        rotateClip.sampler.clip.duration,
      )
      rotateClip.time = rotateClipTime
      rotateClip.entry.time = rotateClipTime
      rotateClip.entry.weight = rotateBlendWeight
      rotateClip.entry.loop = true
    } else if (rotateBlendWeight === 0) {
      rotateClip = null
    }
    const montageWeight = Math.min(1, actionBlendWeight + rotateBlendWeight)
    const baseWeight = 1 - montageWeight
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
      const syncMember = locomotionMembersByRole.get(role)
      clip.entry.weight = weights[role] * baseWeight
      if (syncMember) syncMember.weight = clip.entry.weight
    }

    const fallbackGaitAmount =
      (standWeights[STAND.WALK]
        + standWeights[STAND.RUN] * 2
        + standWeights[STAND.SPRINT] * 3)
        * (1 - crouchingAmount)
      + crouchMoveWeight * crouchingAmount

    const rifleActive = controls.overlayMode === 'Rifle'
    if (previousOverlayMode === null) {
      previousOverlayMode = controls.overlayMode
    } else if (controls.overlayMode !== previousOverlayMode) {
      previousOverlayMode = controls.overlayMode
      // AB_Als linked-layer transition timing is not present in the extracted GLB yet. Use the
      // existing ALS 0.2s transition duration at this explicit data seam until the ABP dump owns it.
      evaluator.inertialization.requestInertialization(
        OVERLAY_MODE_INERTIALIZATION_DURATION,
      )
    }
    resolveRifleOverlaySourceWeights(
      fallbackGaitAmount,
      rifleSourceWeights,
    )
    for (const source of overlaySources) {
      source.weight = rifleActive ? rifleSourceWeights[source.key] : 0
      const syncMember = overlayLocomotionMembers.get(source)
      if (syncMember) syncMember.weight = source.weight
    }

    const locomotionCadence = calculateLocomotionCadence(
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
    for (const member of locomotionSyncGroup.members) {
      member.playRate = locomotionCadence * member.duration
    }
    const syncResult = advanceSyncGroup(locomotionSyncGroup, delta)
    for (const [role, member] of locomotionMembersByRole) {
      const clip = roles[role]
      if (clip) clip.entry.time = member.time
    }
    for (const source of overlaySources) {
      source.time = source.key === 'poses'
        ? resolveRiflePoseBankTime(crouchingAmount)
        : overlayLocomotionMembers.get(source)?.time ?? 0
    }

    for (const overlay of overlayEntries) {
      overlay.entry.time = overlay.source.time
      overlay.entry.weight = overlay.source.weight
        * sampleRifleOverlayPolicyWeight(overlay.source, overlay.policy)
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

    graphRotationYawSpeed = 0
    if (action && activeMontage) {
      const curveTime = activeMontage.clip.time
      const curves = activeMontage.clip.curves
      if (activeMontage.kind === 'turn-in-place') {
        graphRotationYawSpeed =
          (curves?.[ROTATION_YAW_SPEED_CURVE_NAME]?.(curveTime) ?? 0)
          * activeMontage.rotationYawScale
          * actionBlendWeight
      }
      if (curves?.[FOOT_LEFT_LOCK_CURVE_NAME]) {
        graphFootLeftLock = clamp01(
          curves[FOOT_LEFT_LOCK_CURVE_NAME](curveTime),
        )
      }
      if (curves?.[FOOT_RIGHT_LOCK_CURVE_NAME]) {
        graphFootRightLock = clamp01(
          curves[FOOT_RIGHT_LOCK_CURVE_NAME](curveTime),
        )
      }
    } else if (rotateClip) {
      const curves = rotateClip.curves
      graphRotationYawSpeed =
        (curves?.[ROTATION_YAW_SPEED_CURVE_NAME]?.(rotateClipTime) ?? 0)
        * rotateInPlaceState.playRate
        * rotateBlendWeight
      if (curves?.[FOOT_LEFT_LOCK_CURVE_NAME]) {
        graphFootLeftLock = clamp01(
          curves[FOOT_LEFT_LOCK_CURVE_NAME](rotateClipTime),
        )
      }
      if (curves?.[FOOT_RIGHT_LOCK_CURVE_NAME]) {
        graphFootRightLock = clamp01(
          curves[FOOT_RIGHT_LOCK_CURVE_NAME](rotateClipTime),
        )
      }
    }
    graphFallbackGaitAmount = fallbackGaitAmount
    for (const source of gaitSources) source.weight = source.entry.weight

    const result = evaluatePose(evaluator, mainInput)
    applyPose(applicator, result.pose)

    const finalCurves = result.curves.values
    state.crouchingAmount = clamp01(
      finalCurves.get(POSE_CROUCHING_CURVE_NAME) ?? graphCrouchingAmount,
    )
    state.footLeftLock = clamp01(
      finalCurves.get(FOOT_LEFT_LOCK_CURVE_NAME) ?? graphFootLeftLock,
    )
    state.footRightLock = clamp01(
      finalCurves.get(FOOT_RIGHT_LOCK_CURVE_NAME) ?? graphFootRightLock,
    )
    state.rotationYawSpeed =
      finalCurves.get(ROTATION_YAW_SPEED_CURVE_NAME)
      ?? graphRotationYawSpeed
    const gaitAmount = finalCurves.get(POSE_GAIT_CURVE_NAME)
      ?? fallbackGaitAmount
    refreshPose(
      gaitAmount,
      gaitAmounts,
    )

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      normalDebugWeights[role] = weights[role]
      const clip = roles[role]
      if (clip) {
        normalDebugWeights[`clipTime.${role}`] = clip.entry.time
        normalDebugWeights[`clipPhase.${role}`] =
          clip.sampler.clip.duration > 0
            ? clip.entry.time / clip.sampler.clip.duration
            : 0
      }
    }
    normalDebugWeights.groundedAmount = weights.groundedAmount
    normalDebugWeights.gaitAmount = gaitAmounts.amount
    normalDebugWeights.gaitWalkingAmount = gaitAmounts.walking
    normalDebugWeights.gaitRunningAmount = gaitAmounts.running
    normalDebugWeights.gaitSprintingAmount = gaitAmounts.sprinting
    normalDebugWeights.locomotionMarkerSync = syncResult.usedMarkerSync ? 1 : 0
    normalDebugWeights[POSE_CROUCHING_CURVE_NAME] = state.crouchingAmount
    normalDebugWeights[FOOT_LEFT_LOCK_CURVE_NAME] = state.footLeftLock
    normalDebugWeights[FOOT_RIGHT_LOCK_CURVE_NAME] = state.footRightLock
    normalDebugWeights[ROTATION_YAW_SPEED_CURVE_NAME] = state.rotationYawSpeed
    normalDebugWeights.overlayModeRifle = rifleActive ? 1 : 0
    normalDebugWeights.inertializationCorrectionMagnitude =
      measureInertializationCorrectionMagnitude(evaluator.inertialization)
    normalDebugWeights.inertializationRequestCount =
      evaluator.inertialization.requestCount
    for (const layer of ALS_LAYER_REGIONS) {
      normalDebugWeights[layer.baseCurve] =
        finalCurves.get(layer.baseCurve) ?? 0
      if (layer.additiveCurve) {
        normalDebugWeights[layer.additiveCurve] =
          finalCurves.get(layer.additiveCurve) ?? 0
      }
      if (layer.localSpaceCurve) {
        normalDebugWeights[layer.localSpaceCurve] =
          finalCurves.get(layer.localSpaceCurve) ?? 0
      }
    }
    window.__weightTable = normalDebugWeights
    return state.rotationYawSpeed
  }

  return { playClip, clearSoloClip, state, refresh }
}

/** ALS `RefreshVelocityBlend`; re-exported here so the refresh family lives with its class analog. */
export const refreshVelocityBlend = stepVelocityBlend

/** ALS `RefreshTurnInPlace`; pure state implementation lives at its mirrored State path. */
export const refreshTurnInPlace = refreshTurnInPlaceState

/** ALS `RefreshRotateInPlace`; pure state implementation lives at its mirrored State path. */
export const refreshRotateInPlace = refreshRotateInPlaceState

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
