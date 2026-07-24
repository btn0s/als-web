import * as THREE from 'three'
import { pickClip } from '../engine/pickClip'
import { applyPose, createPoseApplicator } from '../engine/applyPose'
import { compileAuthoredAdditive } from '../engine/authoredAdditive'
import {
  accumulatePose,
  blendPoseInPlace,
  clearPoseAccumulator,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
  makeDynamicAdditivePose,
} from '../engine/blend'
import {
  compileWeightBlendProfile,
} from '../engine/blendProfile'
import type { WeightBlendProfile } from '../engine/blendProfile'
import {
  compileClipSampler,
  resolveClipTime,
  sampleClip,
} from '../engine/clipSampler'
import type {
  CompiledClipSampler,
} from '../engine/clipSampler'
import { compileClipCurveSamplers } from '../engine/curves'
import type {
  ClipCurveSamplers,
  CurveFrame,
} from '../engine/curves'
import {
  createEvaluatorInertializationStage,
  createPoseEvaluator,
  evaluatePose,
} from '../engine/evaluator'
import type {
  EvaluatePoseInput,
  EvaluatorAuthoredAdditiveEntry,
  EvaluatorLayerEntry,
  EvaluatorSlotEntry,
} from '../engine/evaluator'
import {
  applyInertialization,
  createInertialization,
  measureInertializationCorrectionMagnitude,
} from '../engine/inertialization'
import {
  applyOutputInertialization,
  createOutputInertialization,
  prepareOutputInertialization,
} from '../engine/inertializationOutput'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToAdditiveIdentity,
} from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../engine/rootMotion'
import type { RootMotionExtractor } from '../engine/rootMotion'
import {
  advanceSlotMontageGroup,
  blendSlotCurveValue,
  createSlotMontageClock,
  playSlotAnimationAsDynamicMontage,
  stopSlotAnimation,
} from '../engine/slotMontage'
import type { SlotMontageSample } from '../engine/slotMontage'
import {
  advanceStateTransition,
  createStateTransitionClock,
  resetStateTransitionClock,
  startStateTransition,
} from '../engine/stateTransition'
import {
  advanceSyncGroup,
  createSyncGroup,
} from '../engine/syncGroups'
import type {
  SyncMarker,
  SyncGroupMember,
  SyncMarkerTable,
} from '../engine/syncGroups'
import {
  blendPoseNodesTogether,
  blendTwoCurvesTogether,
} from '../engine/uePoseBlend'
import type {
  MutableUePoseNode,
  UePoseNode,
} from '../engine/uePoseBlend'
import {
  createMutableUePoseNode,
  sampleSequencePoseNode,
} from '../engine/uePoseGraph'
import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
} from '../engine/blendSpace'
import type { AuthoredBlendSpace } from '../engine/blendSpace'
import authoredBlendSpacesSource from '../../scripts/extract-als/blend-spaces.json?raw'
import skeletonProfilesSource from '../../scripts/extract-als/skeleton-profiles.json?raw'
import { STAND } from './AnimGraph/blendspace'
import {
  ALS_GROUNDED_DIRECTION_PLAYER,
  createGroundedLocomotionGraph,
  evaluateGroundedLocomotionGraph,
  refreshMovementDirection,
  refreshStandingMovement,
  selectGroundedDirectionTransition,
} from './AnimGraph/groundedLocomotion'
import type {
  AlsGroundedDirectionTransition,
  AlsHipsDirection,
  AlsMovementDirection,
  AlsStandingMovementState,
} from './AnimGraph/groundedLocomotion'
import {
  advanceGroundedStanceTransition,
  ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION,
  ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE,
  createAlsGroundedStanceTransitionState,
  startGroundedStanceTransition,
  useDirectGroundedStanceTransition,
} from './AnimGraph/groundedStance'
import {
  ALS_STANDING_SPRINT_GRAPH,
  createAlsStandingSprintState,
  refreshStandingSprint,
} from './AnimGraph/standingSprint'
import type {
  AlsStandingSprintState,
} from './AnimGraph/standingSprint'
import {
  ALS_LAYER_REGIONS,
  DEFAULT_OVERLAY_CLIP,
  RIFLE_OVERLAY_CLIPS,
} from './AnimGraph/overlayMode'
import type {
  AlsOverlayMode,
} from './AnimGraph/overlayMode'
import {
  createAlsDefaultOverlayGraphRuntime,
  createAlsDefaultOverlayGraphState,
  evaluateAlsDefaultOverlayGraph,
  refreshAlsDefaultOverlayGraph,
} from './AnimGraph/AB_Als_Default'
import {
  createAlsRifleRelaxedRuntime,
  evaluateAlsRifleRelaxedGraph,
  refreshAlsRifleRelaxedState,
  resetAlsRifleRelaxedRuntime,
} from './AnimGraph/AB_Als_Rifle'
import {
  ALS_CROUCHING_GRAPH_STATE_ORDER,
  ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE,
  ALS_CROUCHING_STATE_TRANSITIONS,
  createAlsCrouchingPoseGraphRuntime,
  createAlsCrouchingStateRuntime,
  createAlsCrouchingStrideBlendRuntime,
  evaluateAlsCrouchingPoseGraph,
  publishAlsCrouchingOutputCurve,
  refreshAlsCrouchingStateRuntime,
  refreshAlsCrouchingStrideBlend,
} from './AnimGraph/AB_Als_Crouching'
import {
  ALS_CROUCHING_MOVEMENT_STATE_ORDER,
  createAlsCrouchingMovementPoseWeights,
  createAlsCrouchingMovementRuntime,
  evaluateAlsCrouchingMovementState,
  refreshAlsCrouchingMovementRuntime,
} from './AnimGraph/crouchingMovement'
import {
  composeAlsLayeringFinalCurves,
  createAlsLayeringPoseRuntime,
  evaluateAlsLayeringPose,
} from './AnimGraph/AlsLayering'
import {
  ALS_CONTROL_RIG_HAND_IK,
  createAlsControlRigHandIkRuntime,
  evaluateAlsControlRigHandIk,
} from './AnimGraph/CR_Als'
import type { WeightTable } from './AnimGraph/weightTable'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
} from './Settings/AlsMovementSettings'
import { ALS_GENERAL_ANIMATION_SETTINGS } from './Settings/AlsGeneralAnimationSettings'
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
import type { Velocity3 } from './State/AlsGroundedState'
import {
  createAlsPoseState,
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from './State/AlsPoseState'
import type { AlsPoseState } from './State/AlsPoseState'
import {
  createAlsCrouchingState,
  refreshCrouchingMovement,
} from './State/AlsCrouchingState'
import {
  createAlsLeanState,
  refreshGroundedLean,
} from './State/AlsLeanState'
import {
  advanceRotateInPlaceClipTime,
  createAlsRotateInPlaceState,
  refreshRotateInPlace as refreshRotateInPlaceState,
  resetRotateInPlaceFrame,
} from './State/AlsRotateInPlaceState'
import {
  createAlsTransitionsState,
  queueStopTransitionAndTurnInPlaceAnimations,
  refreshTransitions,
  takeQueuedTransitionStop,
} from './State/AlsTransitionsState'
import {
  createAlsTurnInPlaceState,
  refreshTurnInPlace as refreshTurnInPlaceState,
  resetTurnInPlaceFrame,
  takeQueuedTurnInPlaceAnimation,
} from './State/AlsTurnInPlaceState'
import {
  ALLOW_TRANSITIONS_CURVE_NAME,
  FEET_CROSSING_CURVE_NAME,
  FOOT_LEFT_LOCK_CURVE_NAME,
  FOOT_RIGHT_LOCK_CURVE_NAME,
  GROUNDED_SLOT_GROUP_NAME,
  HIPS_DIRECTION_LOCK_CURVE_NAME,
  POSE_CROUCHING_CURVE_NAME,
  POSE_GAIT_CURVE_NAME,
  POSE_GROUNDED_CURVE_NAME,
  POSE_IN_AIR_CURVE_NAME,
  POSE_MOVING_CURVE_NAME,
  POSE_STANDING_CURVE_NAME,
  ROTATION_YAW_SPEED_CURVE_NAME,
  SPRINT_BLOCK_CURVE_NAME,
  TRANSITION_SLOT_NAME,
  TURN_IN_PLACE_CROUCHING_SLOT_NAME,
  TURN_IN_PLACE_STANDING_SLOT_NAME,
} from './Utility/AlsConstants'
import { ALS_VIRTUAL_BONES } from './Utility/AlsVirtualBones'

interface ExtractedBlendSpaces {
  readonly blendSpaces: Readonly<Record<string, AuthoredBlendSpace>>
}

interface ExtractedSkeletonProfiles {
  readonly profiles: {
    readonly MoveDirectionChange: WeightBlendProfile
  }
}

const AUTHORED_BLEND_SPACES = (
  JSON.parse(authoredBlendSpacesSource) as ExtractedBlendSpaces
).blendSpaces

const MOVE_DIRECTION_CHANGE_PROFILE = (
  JSON.parse(skeletonProfilesSource) as ExtractedSkeletonProfiles
).profiles.MoveDirectionChange

/**
 * The ALS pack's locomotion topology: stand walk/run and crouch walk each have forward,
 * backward, and four diagonals; sprint is the single authored forward cycle.
 */
const CLIP_ROLES = {
  // AB_Als_Standing / Standing States / Idle is an explicit-time SequenceEvaluator at frame 0.
  // A_Als_Idle is the authored additive secondary-motion source owned by the overlay graphs.
  idle: 'A_Als_Stand_Pose',
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

const CROUCHING_ROLE_BY_HIPS_DIRECTION = {
  Forward: 'crouchFwd',
  Backward: 'crouchBwd',
  RightForward: 'crouchRightFwd',
  RightBackward: 'crouchRightBwd',
  LeftForward: 'crouchLeftFwd',
  LeftBackward: 'crouchLeftBwd',
} as const satisfies Record<AlsHipsDirection, ClipRole>

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

const OVERLAY_MODE_INERTIALIZATION_DURATION = 0.2
const SOLO_INERTIALIZATION_DURATION = 0.2
const STANDING_MOVE_BLEND_DURATION = 0.2
const IDLE_ADDITIVE_WEIGHT = 0.75
const STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION = 0.2

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

interface RuntimeGroundedStanceTransitionSource {
  readonly clip: RuntimeClip
  readonly sequencePlayRate: number
  readonly targetCrouchingAmount: number
  readonly fallbackCrouchingAmount: number
}

interface RuntimeOverlaySource {
  readonly key: keyof typeof RIFLE_OVERLAY_CLIPS
  readonly clip: RuntimeClip
  time: number
}

interface RuntimeGaitSource {
  readonly clipKey: string
  readonly fallback: number
  readonly entry: EvaluatorLayerEntry
  weight: number
}

interface RuntimeDirectionTransitionEntries {
  readonly from: EvaluatorLayerEntry
  readonly to: EvaluatorLayerEntry
}

interface RuntimeQueuedTransitionSlot {
  readonly clip: RuntimeClip
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: number
  readonly startTime: number
}

export interface AlsAnimationInstanceControls {
  gait: AlsGait
  moving: boolean
  /** FAlsLocomotionAnimationState::bMovingSmooth, distinct from bMoving. */
  movingSmooth: boolean
  stance: AlsStance
  rotationMode: AlsRotationMode
  overlayMode: AlsOverlayMode
  speed: number
  /** LocomotionState.Scale; defaults to the live character's unit scale. */
  scale?: number
  direction: number
  /** GetRelativeAccelerationAmount(), supplied by the character/physics bridge. */
  relativeAccelerationAmount: { x: number; y: number }
  rotateInPlace: boolean
  viewYawAngle: number
  viewYawSpeed: number
}

export interface AlsAnimationInstanceState {
  crouchingAmount: number
  feetCrossingAmount: number
  footLeftLock: number
  footRightLock: number
  hipsDirectionLockAmount: number
  movementDirection: AlsMovementDirection
  rotationYawSpeed: number
  hipsDirection: AlsHipsDirection
  /**
   * The exact authored state-machine request. Pose evaluation applies SK_Als's WeightFactor
   * MoveDirectionChange profile while this request is active.
   */
  directionTransitionRequest: (
    AlsGroundedDirectionTransition
    & { readonly moveDirectionChangeProfileApplied: true }
  ) | null
  standingMovement: AlsStandingMovementState
  readonly standingSprint: AlsStandingSprintState
  readonly pose: AlsPoseState
}

export interface AlsAnimationInstance {
  playClip: (name: string | null) => boolean
  clearSoloClip: () => void
  /**
   * Exact analog of SetHipsDirection(), called by ALS's authored Movement States graph.
   * Public for parity tests; normal live updates come from the recovered transition delegates.
   */
  setHipsDirection: (hipsDirection: AlsHipsDirection) => void
  readonly state: AlsAnimationInstanceState
  refresh: (delta: number, controls: AlsAnimationInstanceControls) => number
}

function createEntry(
  sampler: CompiledClipSampler,
  curves?: ClipCurveSamplers,
): EvaluatorLayerEntry {
  return { sampler, time: 0, weight: 0, loop: true, curves }
}

/**
 * The state machine's logical weight must remain on the entry so named curves blend like UE.
 * Pose masks carry the faster per-bone WeightFactor alpha, so divide by that logical weight before
 * the evaluator multiplies `entry.weight * entry.mask`.
 */
function normalizeTransitionPoseMask(
  poseMask: Float32Array,
  stateWeight: number,
  out: Float32Array,
) {
  if (stateWeight <= Number.EPSILON) {
    out.fill(0)
    return
  }
  const inverseWeight = 1 / stateWeight
  for (let bone = 0; bone < poseMask.length; bone++) {
    out[bone] = poseMask[bone] * inverseWeight
  }
}

function advanceClip(clip: RuntimeClip, delta: number) {
  const duration = clip.sampler.clip.duration
  clip.time = duration > 0 ? (clip.time + delta) % duration : 0
  clip.entry.time = clip.time
}

function moveToward(current: number, target: number, maximumDelta: number) {
  if (current < target) return Math.min(current + maximumDelta, target)
  return Math.max(current - maximumDelta, target)
}

function hermiteCubic01(value: number) {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
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

function resolveWeightedEntryCurvesDirect(
  output: Map<string, number>,
  entries: readonly EvaluatorLayerEntry[],
  graphWeight = 0,
  graphCurves?: ReadonlyMap<string, number>,
) {
  let totalWeight = Math.max(0, graphWeight)
  for (const entry of entries) {
    if (entry.weight > 0) totalWeight += entry.weight
  }
  if (totalWeight <= Number.EPSILON) return

  for (const entry of entries) {
    if (entry.weight <= 0 || !entry.curves) continue
    const normalizedWeight = entry.weight / totalWeight
    const time = resolveClipTime(
      entry.time,
      entry.sampler.clip.duration,
      entry.loop ?? true,
    )
    for (const [name, sample] of Object.entries(entry.curves)) {
      output.set(
        name,
        (output.get(name) ?? 0) + sample(time) * normalizedWeight,
      )
    }
  }
  if (graphWeight > 0 && graphCurves) {
    const normalizedWeight = graphWeight / totalWeight
    for (const [name, value] of graphCurves) {
      output.set(
        name,
        (output.get(name) ?? 0) + value * normalizedWeight,
      )
    }
  }
}

function copyPoseNode(
  source: UePoseNode,
  output: MutableUePoseNode,
) {
  copyPose(source.pose, output.pose)
  output.curves.clear()
  for (const [name, value] of source.curves) {
    output.curves.set(name, value)
  }
  return output
}

function blendRuntimeGaitCurve(
  sources: readonly RuntimeGaitSource[],
  graphWeight: number,
  graphCurves: ReadonlyMap<string, number>,
  fallback: number,
) {
  let weighted = graphWeight
    * (graphCurves.get(POSE_GAIT_CURVE_NAME) ?? 0)
  let totalWeight = graphWeight
  for (const source of sources) {
    if (source.weight <= 0) continue
    const entry = source.entry
    const sample = entry.curves?.[POSE_GAIT_CURVE_NAME]
    const time = resolveClipTime(
      entry.time,
      entry.sampler.clip.duration,
      entry.loop ?? true,
    )
    weighted += (sample?.(time) ?? source.fallback) * source.weight
    totalWeight += source.weight
  }
  return totalWeight > Number.EPSILON ? weighted / totalWeight : fallback
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
  const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
  const applicator = createPoseApplicator(gltf.scene, rig)
  const evaluator = createPoseEvaluator(rig, { development: import.meta.env.DEV })
  const rigBoneNames = new Set(rig.boneNames)
  const handIkRuntime = ALS_CONTROL_RIG_HAND_IK.every((definition) => (
    rigBoneNames.has(definition.itemA)
    && rigBoneNames.has(definition.itemB)
    && rigBoneNames.has(definition.effectorItem)
    && rigBoneNames.has(definition.targetWhenUsingHandIkBones)
    && rigBoneNames.has(definition.targetOtherwise)
    && rigBoneNames.has(definition.poleVectorSpace)
  ))
    ? createAlsControlRigHandIkRuntime(rig)
    : null
  const missingMoveDirectionBones = MOVE_DIRECTION_CHANGE_PROFILE.entries.filter(
    (entry) => !rigBoneNames.has(entry.bone),
  )
  const missingMoveDirectionBone = missingMoveDirectionBones[0]
  if (rig.boneCount > 0 && missingMoveDirectionBone) {
    throw new Error(
      `MoveDirectionChange profile references missing runtime bone `
      + `"${missingMoveDirectionBone.bone}"`,
    )
  }
  const moveDirectionChangeProfile = rig.boneCount > 0
    ? compileWeightBlendProfile(rig, MOVE_DIRECTION_CHANGE_PROFILE)
    : null
  const quickFeetBlendProfile = rig.boneCount > 0
    ? compileWeightBlendProfile(
        rig,
        ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE,
      )
    : null
  const directionTransitionClock = rig.boneCount > 0
    ? createStateTransitionClock<AlsHipsDirection>('Forward', rig.boneCount)
    : null
  const directionTransitionFromMask = new Float32Array(rig.boneCount)
  const directionTransitionToMask = new Float32Array(rig.boneCount)
  const directionTransitionRootIndex = rig.boneNames.indexOf('root')
  const directionTransitionFootLeftIndex = rig.boneNames.indexOf('foot_l')
  const rootMotion: RootMotionExtractor | undefined =
    rig.boneCount > 0 ? createRootMotionExtractor(rig) : undefined
  const clips = gltf.animations.map((clip): RuntimeClip => {
    const sampler = compileClipSampler(clip, rig)
    const compiledCurves = compileClipCurveSamplers(clip)
    const curves = Object.keys(compiledCurves).length > 0 ? compiledCurves : undefined
    return { sampler, curves, entry: createEntry(sampler, curves), time: 0 }
  })
  const clipsByName = new Map(clips.map((clip) => [clip.sampler.clip.name, clip]))
  const crouchingPoseGraphRuntime =
    createAlsCrouchingPoseGraphRuntime(rig)
  const crouchingGraphOutput = createMutableUePoseNode(rig.boneCount)
  const roles: Partial<Record<ClipRole, RuntimeClip>> = {}
  const roleByClip = new Map<RuntimeClip, ClipRole>()
  for (const [role, clipName] of Object.entries(CLIP_ROLES) as [ClipRole, string][]) {
    const clip = clipsByName.get(clipName)
    if (clip) {
      roles[role] = clip
      roleByClip.set(clip, role)
    }
  }

  const groundedLocomotionGraph = createGroundedLocomotionGraph(
    AUTHORED_BLEND_SPACES,
  )
  const groundedLocomotionClipNames = new Set<string>()
  const groundedLocomotionClips = new Map<string, RuntimeClip>()
  for (const evaluator of Object.values(groundedLocomotionGraph.evaluators)) {
    for (const sample of evaluator.blendSpace.samples) {
      groundedLocomotionClipNames.add(sample.animation.name)
      const clip = clipsByName.get(sample.animation.name)
      if (clip) groundedLocomotionClips.set(sample.animation.name, clip)
    }
  }
  const directionTransitionEntriesByClip = new Map<
    RuntimeClip,
    RuntimeDirectionTransitionEntries
  >()
  for (const clip of groundedLocomotionClips.values()) {
    const from = createEntry(clip.sampler, clip.curves)
    const to = createEntry(clip.sampler, clip.curves)
    from.mask = directionTransitionFromMask
    to.mask = directionTransitionToMask
    directionTransitionEntriesByClip.set(clip, { from, to })
  }
  const sprintAccelerationClip = clipsByName.get(
    ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.clip,
  )
  const baseClips = new Set([
    ...Object.values(roles),
    ...groundedLocomotionClips.values(),
  ])
  if (sprintAccelerationClip) baseClips.add(sprintAccelerationClip)
  // Standing/Crouching Idle evaluate their explicit reference pose through a TurnInPlace Slot.
  const turnInPlaceSourceClips = new Set(
    [roles.idle, roles.crouchIdle].filter(
      (clip): clip is RuntimeClip => clip !== undefined,
    ),
  )
  const baseEntries = [
    ...[...baseClips]
      .filter((clip) => !turnInPlaceSourceClips.has(clip))
      .map((clip) => clip.entry),
    ...[...directionTransitionEntriesByClip.values()].flatMap(
      (entries) => [entries.from, entries.to],
    ),
  ]
  const stanceTransitionClips = {
    Crouching: clipsByName.get(STANCE_TRANSITION_CLIPS.Crouching),
    Standing: clipsByName.get(STANCE_TRANSITION_CLIPS.Standing),
  }
  const stanceStateClips = new Set(
    Object.values(stanceTransitionClips).filter(
      (clip): clip is RuntimeClip => clip !== undefined,
    ),
  )
  for (const clip of stanceStateClips) baseEntries.push(clip.entry)
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
  const crouchingWalkPoseClip = clipsByName.get(
    'A_Als_Crouch_Walk_Pose',
  )
  const crouchingTransitionRightClip = clipsByName.get(
    'A_Als_Crouch_Transition_Right',
  )
  const crouchingMovementClips: Readonly<
    Record<AlsHipsDirection, RuntimeClip | undefined>
  > = {
    Forward: roles.crouchFwd,
    Backward: roles.crouchBwd,
    RightForward: roles.crouchRightFwd,
    RightBackward: roles.crouchRightBwd,
    LeftForward: roles.crouchLeftFwd,
    LeftBackward: roles.crouchLeftBwd,
  }
  const crouchingLeanBlendSpaceDefinition =
    AUTHORED_BLEND_SPACES.BS_Als_Lean
  if (!crouchingLeanBlendSpaceDefinition) {
    throw new Error('Missing authored ALS BlendSpace BS_Als_Lean')
  }
  const crouchingLeanBlendSpace = createBlendSpaceEvaluator(
    compileBlendSpace(crouchingLeanBlendSpaceDefinition),
  )
  const crouchingLeanReferenceClip =
    clipsByName.get('A_Als_Lean_Pose')
  const crouchingLeanSourceClips =
    crouchingLeanBlendSpace.blendSpace.samples.map(
      ({ animation }) => clipsByName.get(animation.name),
    )
  const crouchingLeanSourceComplete =
    crouchingLeanReferenceClip !== undefined
    && crouchingLeanSourceClips.every(
      (clip): clip is RuntimeClip => clip !== undefined,
    )
  if (crouchingLeanSourceComplete) {
    for (const clip of crouchingLeanSourceClips) {
      const additive = compileAuthoredAdditive(clip!.sampler.clip)
      if (
        additive?.additiveSpace !== 'local'
        || additive.refPoseSeq !== 'A_Als_Lean_Pose'
        || additive.refFrameIndex !== 0
      ) {
        throw new Error(
          `${clip!.sampler.clip.name} additive metadata differs from BS_Als_Lean`,
        )
      }
    }
  }
  const crouchingGraphSourceComplete =
    crouchingWalkPoseClip !== undefined
    && crouchingTransitionRightClip !== undefined
    && roles.crouchIdle !== undefined
    && rotateInPlaceClips.Crouching.Left !== undefined
    && rotateInPlaceClips.Crouching.Right !== undefined
    && ALS_CROUCHING_MOVEMENT_STATE_ORDER.every(
      (direction) => crouchingMovementClips[direction] !== undefined,
    )
    && crouchingLeanSourceComplete
  const crouchingMovementSequenceNodes = Object.fromEntries(
    ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
      (direction) => [
        direction,
        createMutableUePoseNode(rig.boneCount),
      ],
    ),
  ) as Record<AlsHipsDirection, MutableUePoseNode>
  const crouchingMovementStateNodes = Object.fromEntries(
    ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
      (direction) => [
        direction,
        createMutableUePoseNode(rig.boneCount),
      ],
    ),
  ) as Record<AlsHipsDirection, MutableUePoseNode>
  const crouchingMovementStateWeights = Object.fromEntries(
    ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
      (direction) => [
        direction,
        createAlsCrouchingMovementPoseWeights(),
      ],
    ),
  ) as Record<
    AlsHipsDirection,
    ReturnType<typeof createAlsCrouchingMovementPoseWeights>
  >
  const crouchingMovementClipWeights =
    createAlsCrouchingMovementPoseWeights()
  const crouchingMovementOutput =
    createMutableUePoseNode(rig.boneCount)
  const crouchingMovementCurveScratch = new Map<string, number>()
  const crouchingFixedWalkPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingIdlePose = createMutableUePoseNode(rig.boneCount)
  const crouchingTurnInPlacePose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingRotateLeftPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingRotateRightPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingStopLeftPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingStopRightPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingLeanAdditive =
    createMutableUePoseNode(rig.boneCount)
  resetPoseToAdditiveIdentity(crouchingLeanAdditive.pose)
  const crouchingLeanReference =
    createMutableUePoseNode(rig.boneCount)
  const crouchingLeanFullPose =
    createMutableUePoseNode(rig.boneCount)
  const crouchingLeanSourceAdditives =
    crouchingLeanBlendSpace.blendSpace.samples.map(
      () => createMutableUePoseNode(rig.boneCount),
    )
  const crouchingLeanWeights = new Float64Array(
    crouchingLeanSourceAdditives.length,
  )
  const crouchingLeanAdditiveScratch =
    createMeshSpaceBlendScratch(rig.boneCount)
  if (crouchingLeanSourceComplete) {
    sampleSequencePoseNode(
      rig,
      crouchingLeanReferenceClip!,
      0,
      false,
      crouchingLeanReference,
    )
    for (
      let index = 0;
      index < crouchingLeanSourceClips.length;
      index++
    ) {
      sampleSequencePoseNode(
        rig,
        crouchingLeanSourceClips[index]!,
        0,
        false,
        crouchingLeanFullPose,
      )
      const additive = crouchingLeanSourceAdditives[index]
      makeDynamicAdditivePose(
        crouchingLeanFullPose.pose,
        crouchingLeanReference.pose,
        rig,
        additive.pose,
        'local',
        crouchingLeanAdditiveScratch,
      )
      additive.curves.clear()
    }
  }
  const crouchingOuterBlendScratch = new Map<string, number>()
  const turnInPlaceClips = new Map(
    (Object.values(ALS_TURN_IN_PLACE_SETTINGS.clips) as Array<
      typeof ALS_TURN_IN_PLACE_SETTINGS.clips[AlsStance]
    >)
      .flatMap((byAngle) => Object.values(byAngle))
      .flatMap((byDirection) => Object.values(byDirection))
      .map((settings) => [settings.clip, clipsByName.get(settings.clip)] as const),
  )
  const turnInPlaceMontageClips = new Set<RuntimeClip>()
  const montageClips = new Set<RuntimeClip>()
  for (const clip of turnInPlaceClips.values()) {
    if (clip) {
      turnInPlaceMontageClips.add(clip)
      montageClips.add(clip)
    }
  }
  for (const byDirection of Object.values(rotateInPlaceClips)) {
    for (const clip of Object.values(byDirection)) {
      if (clip) {
        baseEntries.push(clip.entry)
        montageClips.add(clip)
      }
    }
  }
  if (crouchingTransitionRightClip) {
    montageClips.add(crouchingTransitionRightClip)
  }
  function createTurnInPlaceSlot(
    source: RuntimeClip | undefined,
  ): EvaluatorSlotEntry | undefined {
    if (!source) return undefined
    const sourceEntry = createEntry(source.sampler, source.curves)
    sourceEntry.weight = 1
    sourceEntry.loop = false
    return {
      source: [sourceEntry],
      weight: 0,
      montageWeight: 0,
    }
  }
  const turnInPlaceStandingSlot = createTurnInPlaceSlot(roles.idle)
  const turnInPlaceCrouchingSlot = createTurnInPlaceSlot(roles.crouchIdle)
  const turnInPlaceSlots = [
    turnInPlaceStandingSlot,
    turnInPlaceCrouchingSlot,
  ].filter((slot): slot is EvaluatorSlotEntry => slot !== undefined)
  const rifleOverlaySources = (
    Object.entries(RIFLE_OVERLAY_CLIPS) as [
      keyof typeof RIFLE_OVERLAY_CLIPS,
      string,
    ][]
  ).flatMap(([key, clipName]): RuntimeOverlaySource[] => {
    const clip = clipsByName.get(clipName)
    return clip
      ? [{
          key,
          clip,
          time: 0,
        }]
      : []
  })
  const defaultOverlayClip = clipsByName.get(DEFAULT_OVERLAY_CLIP)

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
  const layeringPoseRuntime = createAlsLayeringPoseRuntime(rig)
  const defaultOverlayGraphState = createAlsDefaultOverlayGraphState()
  const defaultOverlayGraphRuntime = defaultOverlayClip
    ? createAlsDefaultOverlayGraphRuntime(
        rig,
        {
          sampler: defaultOverlayClip.sampler,
          curves: defaultOverlayClip.curves,
        },
        evaluator.referencePose,
      )
    : undefined
  const rifleRelaxedRuntime = createAlsRifleRelaxedRuntime(rig)
  const riflePosesSource = rifleOverlaySources.find(
    ({ key }) => key === 'poses',
  )
  const rifleRunArmsSource = rifleOverlaySources.find(
    ({ key }) => key === 'runArms',
  )
  const rifleSprintArmsSource = rifleOverlaySources.find(
    ({ key }) => key === 'sprintArms',
  )
  const rifleSprintImpulseArmsSource = rifleOverlaySources.find(
    ({ key }) => key === 'sprintImpulseArms',
  )
  const rifleRelaxedSources =
    riflePosesSource
    && rifleRunArmsSource
    && rifleSprintArmsSource
    && rifleSprintImpulseArmsSource
      ? {
          poses: {
            sampler: riflePosesSource.clip.sampler,
            curves: riflePosesSource.clip.curves,
          },
          runArms: {
            sampler: rifleRunArmsSource.clip.sampler,
            curves: rifleRunArmsSource.clip.curves,
            time: 0,
            loop: true,
          },
          sprintArms: {
            sampler: rifleSprintArmsSource.clip.sampler,
            curves: rifleSprintArmsSource.clip.curves,
            time: 0,
            loop: true,
          },
          sprintImpulseArms: {
            sampler: rifleSprintImpulseArmsSource.clip.sampler,
            curves: rifleSprintImpulseArmsSource.clip.curves,
            time: 0,
            loop: true,
          },
        }
      : undefined
  const idleAdditiveClip = clipsByName.get('A_Als_Idle')
  const idleAdditiveMetadata = idleAdditiveClip
    ? compileAuthoredAdditive(idleAdditiveClip.sampler.clip)
    : undefined
  if (idleAdditiveClip && !idleAdditiveMetadata) {
    throw new Error('A_Als_Idle is missing its authored additive metadata')
  }
  if (
    idleAdditiveMetadata
    && (
      idleAdditiveMetadata.additiveSpace !== 'local'
      || idleAdditiveMetadata.refPoseSeq !== 'A_Als_Stand_Pose'
      || idleAdditiveMetadata.refFrameIndex !== 0
    )
  ) {
    throw new Error('A_Als_Idle additive metadata differs from ALS overlay graphs')
  }
  const idleAdditiveEntry: EvaluatorAuthoredAdditiveEntry | undefined =
    idleAdditiveClip && idleAdditiveMetadata
      ? {
          sampler: idleAdditiveClip.sampler,
          curves: idleAdditiveClip.curves,
          referencePose: standReference,
          time: 0,
          weight: 0,
          loop: true,
          additiveSpace: idleAdditiveMetadata.additiveSpace,
        }
      : undefined

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
  for (const clipName of groundedLocomotionClipNames) {
    normalDebugWeights[clipName] = 0
  }
  normalDebugWeights.sprintAcceleration = 0
  for (const hipsDirection of Object.keys(groundedLocomotionGraph.evaluators)) {
    normalDebugWeights[`HipsDirection.${hipsDirection}`] = 0
  }
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
    && groundedLocomotionClips.size === groundedLocomotionClipNames.size
    && sprintAccelerationClip !== undefined
    && turnInPlaceSlots.length === 2
    && [...turnInPlaceClips.values()].every(
      (clip): clip is RuntimeClip => clip !== undefined,
    )
    && crouchingGraphSourceComplete
    && quickFeetBlendProfile !== null
    && defaultOverlayGraphRuntime !== undefined
    && rifleOverlaySources.length === Object.keys(RIFLE_OVERLAY_CLIPS).length
    && rifleRelaxedSources !== undefined
    && idleAdditiveEntry !== undefined
  const gaitFallback = (clip: RuntimeClip) => {
    const role = roleByClip.get(clip)
    return role
      ? ROLE_GAIT_AMOUNT[role]
      : clip === sprintAccelerationClip ? 3 : 0
  }
  const gaitSources = [...baseClips].map((clip): RuntimeGaitSource => ({
    clipKey: clip.sampler.clip.name,
    weight: 0,
    fallback: gaitFallback(clip),
    entry: clip.entry,
  }))
  for (const [clip, entries] of directionTransitionEntriesByClip) {
    gaitSources.push(
      {
        clipKey: clip.sampler.clip.name,
        weight: 0,
        fallback: gaitFallback(clip),
        entry: entries.from,
      },
      {
        clipKey: clip.sampler.clip.name,
        weight: 0,
        fallback: gaitFallback(clip),
        entry: entries.to,
      },
    )
  }
  const locomotionRoles = (Object.keys(CLIP_ROLES) as ClipRole[]).filter(
    (role) => role !== 'idle' && role !== 'crouchIdle',
  )
  const locomotionMembersByRole = new Map<ClipRole, SyncGroupMember>()
  const locomotionMembersByClip = new Map<RuntimeClip, SyncGroupMember>()
  const locomotionMembers: SyncGroupMember[] = []
  const syncClips = new Set<RuntimeClip>()
  const locomotionClips = new Set<RuntimeClip>(groundedLocomotionClips.values())
  if (sprintAccelerationClip) locomotionClips.add(sprintAccelerationClip)
  for (const role of locomotionRoles) {
    const clip = roles[role]
    if (clip) locomotionClips.add(clip)
  }
  for (const clip of locomotionClips) {
    const clipName = clip.sampler.clip.name
    const startPosition = groundedLocomotionClipNames.has(clipName)
      ? ALS_GROUNDED_DIRECTION_PLAYER.startPosition
      : (
          clipName === ALS_STANDING_SPRINT_GRAPH.sprint.clip
          || clipName === ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.clip
        )
          ? ALS_STANDING_SPRINT_GRAPH.sprint.startPosition
          : 0
    const member: SyncGroupMember = {
      id: clipName,
      duration: clip.sampler.clip.duration,
      markers: gltf.syncMarkers?.[clipName] ?? clipSyncMarkers(clip.sampler.clip),
      time: clip.sampler.clip.duration * startPosition,
      weight: 0,
      playRate: 0,
    }
    locomotionMembersByClip.set(clip, member)
    locomotionMembers.push(member)
    syncClips.add(clip)
  }
  for (const role of locomotionRoles) {
    const clip = roles[role]
    const member = clip ? locomotionMembersByClip.get(clip) : undefined
    if (member) locomotionMembersByRole.set(role, member)
  }
  const overlayLocomotionMembers = new Map<RuntimeOverlaySource, SyncGroupMember>()
  for (const source of rifleOverlaySources) {
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
  const locomotionSyncGroup = createSyncGroup('Movement', locomotionMembers)
  const slotSourceCurveEntries = [...turnInPlaceSourceClips].map(
    (clip) => clip.entry,
  )
  const turnInPlaceMontageEntries = [...turnInPlaceMontageClips].map(
    (clip) => clip.entry,
  )
  const mainCurveEntries = [
    ...baseEntries,
    ...slotSourceCurveEntries,
    ...turnInPlaceMontageEntries,
  ]
  let graphFallbackGaitAmount = 0
  let graphGroundedAmount = 1
  let graphMovingAmount = 0
  let graphCrouchingAmount = 0
  let graphFootLeftLock = 0
  let graphFootRightLock = 0
  let graphRotationYawSpeed = 0
  let graphAllowTransitions = 1
  let activeCrouchingGraphWeight = 0
  const locomotionAccumulator = createPoseAccumulator(rig.boneCount)
  const locomotionSlotAccumulator = createPoseAccumulator(rig.boneCount)
  const locomotionSamplePose = createPoseBuffer(rig.boneCount)
  const locomotionSlotPose = createPoseBuffer(rig.boneCount)

  function sampleLocomotionEntry(
    entry: EvaluatorLayerEntry,
    accumulator = locomotionAccumulator,
  ) {
    if (entry.weight <= 0) return
    sampleClip(
      entry.sampler,
      rig,
      entry.time,
      locomotionSamplePose,
      entry.loop,
    )
    accumulatePose(
      accumulator,
      locomotionSamplePose,
      entry.weight,
      entry.mask,
    )
  }

  function evaluateLocomotionSlot(slot: EvaluatorSlotEntry) {
    if (slot.weight <= 0) return
    const montageWeight = clamp01(slot.montageWeight)
    const montage = slot.montage

    if (!montage || montageWeight < 1) {
      clearPoseAccumulator(locomotionSlotAccumulator)
      for (const source of slot.source) {
        sampleLocomotionEntry(source, locomotionSlotAccumulator)
      }
      finalizePose(
        locomotionSlotAccumulator,
        evaluator.referencePose,
        locomotionSlotPose,
      )
      if (montage && montageWeight > 0) {
        sampleClip(
          montage.sampler,
          rig,
          montage.time,
          locomotionSamplePose,
          montage.loop,
        )
        blendPoseInPlace(
          locomotionSlotPose,
          locomotionSamplePose,
          montageWeight,
        )
      }
    } else {
      sampleClip(
        montage.sampler,
        rig,
        montage.time,
        locomotionSlotPose,
        montage.loop,
      )
    }
    accumulatePose(
      locomotionAccumulator,
      locomotionSlotPose,
      slot.weight,
    )
  }

  function resolveLocomotionGraphCurves(
    output: Map<string, number>,
  ) {
    resolveWeightedEntryCurvesDirect(
      output,
      mainCurveEntries,
      activeCrouchingGraphWeight,
      crouchingGraphOutput.curves,
    )

    // These are the explicit graph outputs that enter AB_Als_Grounded's inertialization node.
    // Keeping them on that node's curve container makes pose and curve corrections share one
    // authored request and preserves the downstream AB_Als_Layering curve override.
    output.set(
      POSE_GAIT_CURVE_NAME,
      blendRuntimeGaitCurve(
        gaitSources,
        activeCrouchingGraphWeight,
        crouchingGraphOutput.curves,
        graphFallbackGaitAmount,
      ),
    )
    output.set(POSE_GROUNDED_CURVE_NAME, graphGroundedAmount)
    output.set(POSE_IN_AIR_CURVE_NAME, 1 - graphGroundedAmount)
    output.set(POSE_STANDING_CURVE_NAME, 1 - graphCrouchingAmount)
    output.set(POSE_CROUCHING_CURVE_NAME, graphCrouchingAmount)
    output.set(POSE_MOVING_CURVE_NAME, graphMovingAmount)
    output.set(FOOT_LEFT_LOCK_CURVE_NAME, graphFootLeftLock)
    output.set(FOOT_RIGHT_LOCK_CURVE_NAME, graphFootRightLock)
    output.set(ROTATION_YAW_SPEED_CURVE_NAME, graphRotationYawSpeed)
    output.set(ALLOW_TRANSITIONS_CURVE_NAME, graphAllowTransitions)
  }
  const groundedInertialization = createEvaluatorInertializationStage(
    rig.boneCount,
  )
  const overlayInertialization = createEvaluatorInertializationStage(
    rig.boneCount,
  )
  const transitionMontageEntries: EvaluatorLayerEntry[] = []
  let activeOverlayMode: AlsOverlayMode = 'Default'
  let defaultOverlayGraphSample = refreshAlsDefaultOverlayGraph(
    defaultOverlayGraphState,
    {
      gaitWalkingAmount: 0,
      standingAmount: 1,
      crouchingAmount: 0,
      inAirAmount: 0,
      groundPredictionAmount: 0,
      deltaTime: 0,
    },
  )
  const mainInput: EvaluatePoseInput = {
    base: [],
    locomotionGraph(context) {
      clearPoseAccumulator(locomotionAccumulator)
      for (const entry of baseEntries) sampleLocomotionEntry(entry)
      for (const slot of turnInPlaceSlots) evaluateLocomotionSlot(slot)
      if (activeCrouchingGraphWeight > 0) {
        accumulatePose(
          locomotionAccumulator,
          crouchingGraphOutput.pose,
          activeCrouchingGraphWeight,
        )
      }
      finalizePose(
        locomotionAccumulator,
        context.referencePose,
        context.outputPose,
      )
      context.outputCurves.clear()
      resolveLocomotionGraphCurves(context.outputCurves)
    },
    montages: transitionMontageEntries,
    stagedInertialization: {
      locomotion: groundedInertialization,
      overlay: overlayInertialization,
    },
    overlayGraph(context) {
      if (activeOverlayMode === 'Rifle' && rifleRelaxedSources) {
        const result = evaluateAlsRifleRelaxedGraph(
          rifleRelaxedRuntime,
          rifleRelaxedSources,
        )
        copyPose(result.pose, context.outputPose)
        context.outputCurves.clear()
        for (const [name, value] of result.curves) {
          context.outputCurves.set(name, value)
        }
        return
      }
      if (defaultOverlayGraphRuntime) {
        evaluateAlsDefaultOverlayGraph(
          defaultOverlayGraphRuntime,
          defaultOverlayGraphSample,
          context.outputPose,
          context.outputCurves,
        )
        return
      }
      copyPose(context.referencePose, context.outputPose)
      context.outputCurves.clear()
    },
    overlayAdditives: idleAdditiveEntry ? [idleAdditiveEntry] : [],
    linkedLayer(context) {
      evaluateAlsLayeringPose(
        layeringPoseRuntime,
        {
          locomotionPose: context.locomotionPose,
          overlayPose: context.overlayPose,
          basePose: layeringReference,
          curves: context.overlayCurves,
        },
        context.outputPose,
      )
    },
    rootMotion,
    resolveBlendedCurves(_samples, output) {
      composeAlsLayeringFinalCurves(
        groundedInertialization.curves,
        overlayInertialization.curves,
        output,
      )
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

  function inertializationRequestCount() {
    return evaluator.inertialization.requestCount
      + groundedInertialization.inertialization.requestCount
      + overlayInertialization.inertialization.requestCount
      + crouchingNode34.requestCount
  }

  function inertializationCorrectionMagnitude() {
    return measureInertializationCorrectionMagnitude(evaluator.inertialization)
      + measureInertializationCorrectionMagnitude(
        groundedInertialization.inertialization,
      )
      + measureInertializationCorrectionMagnitude(
        overlayInertialization.inertialization,
      )
      + measureInertializationCorrectionMagnitude(crouchingNode34)
  }

  let soloClip: RuntimeClip | null = null
  const standWeights = [1, 0, 0, 0]
  let crouchMoveWeight = 0
  let moveBlendProgress = 0
  const crouchingStateRuntime = createAlsCrouchingStateRuntime(
    rig.boneCount,
    quickFeetBlendProfile,
  )
  const crouchingMovementRuntime =
    createAlsCrouchingMovementRuntime(
      rig.boneCount,
      moveDirectionChangeProfile,
    )
  const crouchingStrideBlendRuntime =
    createAlsCrouchingStrideBlendRuntime()
  const crouchingState = createAlsCrouchingState()
  const leanState = createAlsLeanState()
  let leanPendingUpdate = true
  const crouchingNode34 = createInertialization(rig.boneCount)
  const crouchingNode34Output = createOutputInertialization()
  let crouchingRotateLeftTime = 0
  let crouchingRotateRightTime = 0
  let queuedTransitionSlot: RuntimeQueuedTransitionSlot | null = null
  let activeTransitionClip: RuntimeClip | null = null
  let stopQuickNotifyCount = 0
  const stanceTransitionState = createAlsStanceTransitionCurveState()
  const groundedStanceTransitionState =
    createAlsGroundedStanceTransitionState()
  let groundedStanceTransitionSource:
    RuntimeGroundedStanceTransitionSource | null = null
  let activeGroundedStanceState:
    RuntimeGroundedStanceTransitionSource | null = null
  let groundedStanceTransitionSourceWeight = 0
  const transitionsState = createAlsTransitionsState()
  const turnInPlaceState = createAlsTurnInPlaceState()
  const slotMontageClock = createSlotMontageClock()
  let activeTurnInPlaceClip: RuntimeClip | null = null
  let turnInPlaceSample: SlotMontageSample | undefined
  const rotateInPlaceState = createAlsRotateInPlaceState()
  let previousStance: AlsStance | null = null
  let previousMovingSmooth: boolean | null = null
  let previousOverlayMode: AlsOverlayMode | null = null
  let movementStatesRelevant = false
  let rotateClip: RuntimeClip | null = null
  let rotateClipTime = 0
  let rotateBlendWeight = 0
  const gaitAmounts = createAlsPoseState()
  const state: AlsAnimationInstanceState = {
    crouchingAmount: 0,
    feetCrossingAmount: 0,
    footLeftLock: 0,
    footRightLock: 0,
    hipsDirectionLockAmount: 0,
    movementDirection: 'Forward',
    rotationYawSpeed: 0,
    hipsDirection: 'Forward',
    directionTransitionRequest: null,
    standingMovement: refreshStandingMovement({
      locomotionSpeed: 0,
      locomotionScale: 1,
      gait: 'Walking',
      poseGaitCurveValue: 0,
      poseGroundedCurveValue: 1,
    }),
    standingSprint: createAlsStandingSprintState(),
    pose: gaitAmounts,
  }
  const velocityBlend = createVelocityBlend()
  const velocityTarget = createVelocityBlend()
  let velocityInitialized = false

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
    clip.entry.time = 0
    soloEntries[0] = clip.entry
    soloClip = clip
    if (rootMotion) resetRootMotionExtractor(rootMotion)
    return true
  }

  function clearSoloClip() {
    playClip(null)
  }

  function setHipsDirection(hipsDirection: AlsHipsDirection) {
    state.hipsDirection = hipsDirection
  }

  function processCrouchingLifecycleEvents() {
    for (const event of crouchingStateRuntime.lifecycleEvents) {
      if (
        event.kind === 'CallFunction'
        && event.functionName === 'InitializeTurnInPlace'
      ) {
        turnInPlaceState.activationDelay = 0
        continue
      }
      if (
        event.kind === 'CallFunction'
        && event.functionName === 'StopTransitionAndTurnInPlaceAnimations'
      ) {
        queueStopTransitionAndTurnInPlaceAnimations(
          transitionsState,
          event.blendOutDuration
            ?? STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION,
        )
        continue
      }
      if (event.kind === 'PlayTransitionRightAnimation') {
        if (crouchingTransitionRightClip) {
          queuedTransitionSlot = {
            clip: crouchingTransitionRightClip,
            blendInDuration: event.blendInDuration,
            blendOutDuration: event.blendOutDuration,
            playRate: event.playRate,
            startTime: event.startTime,
          }
        }
        continue
      }
      // StopQuick is an authored state-machine start notify. ALS has no native receiver for it;
      // retain the event at the live seam without assigning unverified Transition-slot behavior.
      if (event.kind === 'AnimNotify' && event.name === 'StopQuick') {
        stopQuickNotifyCount++
      }
    }
  }

  function accumulateStandingDirectionState(
    hipsDirection: AlsHipsDirection,
    stateWeight: number,
    transitionSide: 'from' | 'to' | null,
    standingMovement: AlsStandingMovementState,
    graphWeight: number,
  ) {
    if (stateWeight <= 0 || graphWeight <= 0) return
    const samples = evaluateGroundedLocomotionGraph(
      groundedLocomotionGraph,
      hipsDirection,
      velocityBlend,
      standingMovement,
    )
    for (const sample of samples) {
      const clip = groundedLocomotionClips.get(sample.clip)
      if (!clip) continue
      const sampleWeight = sample.weight * stateWeight * graphWeight
      const transitionEntries = directionTransitionEntriesByClip.get(clip)
      const entry = transitionSide && transitionEntries
        ? transitionEntries[transitionSide]
        : clip.entry
      entry.weight += sampleWeight
      const member = locomotionMembersByClip.get(clip)
      if (member) {
        member.weight += sampleWeight
        member.playRate = sample.playRate
      }
    }
  }

  function processQueuedTransitionAndTurnInPlaceAnimations() {
    // NativePostUpdateAnimation order: play queued transition, play queued turn, stop queued Slots.
    if (
      queuedTransitionSlot
      && !transitionsState.stopTransitionsQueued
    ) {
      const queued = queuedTransitionSlot
      queued.clip.time = 0
      queued.clip.entry.time = 0
      queued.clip.entry.loop = false
      playSlotAnimationAsDynamicMontage(
        slotMontageClock,
        {
          clipKey: queued.clip.sampler.clip.name,
          clipDuration: queued.clip.sampler.clip.duration,
          slotName: TRANSITION_SLOT_NAME,
          groupName: GROUNDED_SLOT_GROUP_NAME,
          blendInDuration: queued.blendInDuration,
          blendOutDuration: queued.blendOutDuration,
          playRate: queued.playRate,
          loopCount: 1,
          blendOutTriggerTime: 0,
          startTime: queued.startTime,
        },
      )
      activeTransitionClip = queued.clip
      queuedTransitionSlot = null
    }

    const queuedTurn = takeQueuedTurnInPlaceAnimation(
      turnInPlaceState,
      transitionsState.stopTransitionsQueued,
    )
    if (queuedTurn) {
      const clip = turnInPlaceClips.get(queuedTurn.settings.clip)
      if (clip) {
        clip.time = 0
        clip.entry.time = 0
        clip.entry.loop = false
        turnInPlaceSample = playSlotAnimationAsDynamicMontage(
          slotMontageClock,
          {
            clipKey: queuedTurn.settings.clip,
            clipDuration: clip.sampler.clip.duration,
            slotName: queuedTurn.slotName,
            groupName: GROUNDED_SLOT_GROUP_NAME,
            blendInDuration: ALS_TURN_IN_PLACE_SETTINGS.blendDuration,
            blendOutDuration: ALS_TURN_IN_PLACE_SETTINGS.blendDuration,
            playRate: queuedTurn.settings.playRate,
            loopCount: 1,
            blendOutTriggerTime: 0,
            startTime: 0,
          },
        )
        activeTurnInPlaceClip = clip
        activeTransitionClip = null
      }
    }

    const stopBlendOutDuration = takeQueuedTransitionStop(transitionsState)
    if (stopBlendOutDuration === null) return
    stopSlotAnimation(
      slotMontageClock,
      stopBlendOutDuration,
      TRANSITION_SLOT_NAME,
    )
    stopSlotAnimation(
      slotMontageClock,
      stopBlendOutDuration,
      TURN_IN_PLACE_STANDING_SLOT_NAME,
    )
    stopSlotAnimation(
      slotMontageClock,
      stopBlendOutDuration,
      TURN_IN_PLACE_CROUCHING_SLOT_NAME,
    )
  }

  function enterAuthoredStanceState(targetCrouchingAmount: number) {
    const targetStance: AlsStance = targetCrouchingAmount >= 0.5
      ? 'Crouching'
      : 'Standing'
    const clip = stanceTransitionClips[targetStance]
    if (!clip) return false

    // AB_Als_Grounded's transition-state entry delegate calls
    // StopTransitionAndTurnInPlaceAnimations(). The sequence player belongs to the state machine;
    // it never requests the Transition slot or action ownership.
    queueStopTransitionAndTurnInPlaceAnimations(
      transitionsState,
      STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION,
    )
    groundedStanceTransitionSource = null
    clip.time = 0
    clip.entry.time = 0
    clip.entry.loop = false
    activeGroundedStanceState = {
      clip,
      sequencePlayRate: ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE,
      targetCrouchingAmount,
      fallbackCrouchingAmount: stanceTransitionState.crouchingAmount,
    }
    groundedInertialization.inertialization.requestInertialization(
      ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION,
    )
    return true
  }

  function transitionFromAuthoredStanceState(
    targetCrouchingAmount: number,
    delta: number,
  ) {
    const source = activeGroundedStanceState
    if (!source) return false

    // The generic clip loop deliberately skips the graph-owned non-looping sequence. Continue its
    // state clock here before it becomes the source of ALS's authored transition-state -> stance
    // edge; UE keeps evaluating the outgoing state throughout this 0.5s custom-curve blend.
    source.clip.time = Math.min(
      source.clip.sampler.clip.duration,
      source.clip.time
        + Math.max(0, delta) * source.sequencePlayRate,
    )
    source.clip.entry.time = source.clip.time
    source.clip.entry.loop = false
    groundedStanceTransitionSource = {
      clip: source.clip,
      sequencePlayRate: source.sequencePlayRate,
      targetCrouchingAmount,
      fallbackCrouchingAmount: stanceTransitionState.crouchingAmount,
    }
    activeGroundedStanceState = null

    // The state values are 0 -> 1 here because this instance is the transition edge's clock. The
    // outgoing sequence's live PoseCrouching curve is blended separately below.
    startGroundedStanceTransition(
      groundedStanceTransitionState,
      0,
      1,
    )
    return true
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
          inertializationCorrectionMagnitude()
        debugWeights.inertializationRequestCount =
          inertializationRequestCount()
      }
      window.__weightTable = debugWeights
      // Controls may change while the normal graph is dormant. The solo transition request owns
      // the eventual handoff, so do not emit a second overlay request on the first resumed frame.
      previousOverlayMode = controls.overlayMode
      state.rotationYawSpeed = 0
      return 0
    }

    turnInPlaceSample = advanceSlotMontageGroup(
      slotMontageClock,
      GROUNDED_SLOT_GROUP_NAME,
      delta,
    )
    if (
      turnInPlaceSample
      && turnInPlaceSample.status !== 'completed'
    ) {
      if (turnInPlaceSample.slotName === TRANSITION_SLOT_NAME) {
        activeTransitionClip =
          clipsByName.get(turnInPlaceSample.clipKey) ?? null
        activeTurnInPlaceClip = null
      } else {
        activeTurnInPlaceClip =
          turnInPlaceClips.get(turnInPlaceSample.clipKey) ?? null
        activeTransitionClip = null
      }
      const activeSlotClip =
        activeTransitionClip ?? activeTurnInPlaceClip
      if (activeSlotClip) {
        activeSlotClip.time = turnInPlaceSample.sampleTime
        activeSlotClip.entry.time = turnInPlaceSample.sampleTime
        activeSlotClip.entry.loop = false
      }
    } else {
      activeTurnInPlaceClip = null
      activeTransitionClip = null
    }
    refreshTransitions(
      transitionsState,
      turnInPlaceSample && turnInPlaceSample.status !== 'completed'
        ? 1 - turnInPlaceSample.weight
        : 1,
    )

    for (const clip of clips) {
      if (
        !syncClips.has(clip)
        && clip !== activeTurnInPlaceClip
        && clip !== activeTransitionClip
        && clip !== activeGroundedStanceState?.clip
        && clip !== groundedStanceTransitionSource?.clip
        && clip !== roles.idle
        && clip !== roles.crouchIdle
      ) {
        advanceClip(clip, delta)
      }
    }
    if (groundedStanceTransitionSource) {
      const source = groundedStanceTransitionSource
      source.clip.time = Math.min(
        source.clip.sampler.clip.duration,
        source.clip.time
          + Math.max(0, delta) * source.sequencePlayRate,
      )
      source.clip.entry.time = source.clip.time
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
          inertializationCorrectionMagnitude()
        debugWeights.inertializationRequestCount =
          inertializationRequestCount()
      }
      window.__weightTable = debugWeights
      state.rotationYawSpeed = 0
      return 0
    }

    const rawSpeed = Math.max(0, controls.speed)
    refreshGroundedLean(leanState, {
      pendingUpdate: leanPendingUpdate,
      deltaTime: Math.max(0, delta),
      relativeAccelerationAmount: controls.relativeAccelerationAmount,
    })
    leanPendingUpdate = false
    if (crouchingLeanSourceComplete) {
      const leanSamples = evaluateBlendSpace(
        crouchingLeanBlendSpace,
        leanState.rightAmount,
        leanState.forwardAmount,
      )
      crouchingLeanWeights.fill(0)
      for (let index = 0; index < leanSamples.count; index++) {
        crouchingLeanWeights[leanSamples.sampleIndices[index]] =
          leanSamples.weights[index]
      }
      blendPoseNodesTogether(
        crouchingLeanSourceAdditives,
        crouchingLeanWeights,
        crouchingLeanAdditive,
      )
    }
    for (const clip of montageClips) clip.entry.weight = 0
    transitionMontageEntries.length = 0
    if (
      activeTransitionClip
      && turnInPlaceSample?.slotName === TRANSITION_SLOT_NAME
      && turnInPlaceSample.status !== 'completed'
    ) {
      activeTransitionClip.entry.weight = turnInPlaceSample.weight
      activeTransitionClip.entry.time = turnInPlaceSample.sampleTime
      activeTransitionClip.entry.loop = false
      transitionMontageEntries.push(activeTransitionClip.entry)
    }
    for (const clip of stanceStateClips) clip.entry.weight = 0
    const crouching = controls.stance === 'Crouching'
    const targetCrouchingAmount = crouching ? 1 : 0
    const turnInPlaceAllowed = controls.rotationMode === 'ViewDirection'
    const rotateInPlaceAllowed =
      controls.rotationMode === 'Aiming' || controls.rotateInPlace

    // NativeThreadSafeUpdateAnimation refreshes this state before Grounded States evaluates its
    // priority-zero direct stance route.
    resetRotateInPlaceFrame(rotateInPlaceState)
    refreshRotateInPlaceState(rotateInPlaceState, {
      delta,
      moving:
        controls.moving
        || activeTurnInPlaceClip !== null
        || activeGroundedStanceState !== null,
      allowed: rotateInPlaceAllowed,
      viewYawAngle: controls.viewYawAngle,
      viewYawSpeed: controls.viewYawSpeed,
    })
    // ALS naming parity: this is a pure transition predicate, not a React Hook.
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    const directStanceTransition = useDirectGroundedStanceTransition({
      movingSmooth: controls.movingSmooth,
      rotatingLeft: rotateInPlaceState.rotatingLeft,
      rotatingRight: rotateInPlaceState.rotatingRight,
    })

    // The automatic remaining-time rule leaves the authored state on the update after its terminal
    // pose was evaluated. Its serialized exit duration is zero, so this handoff makes no
    // inertialization request.
    if (
      activeGroundedStanceState
      && activeGroundedStanceState.clip.time
        >= activeGroundedStanceState.clip.sampler.clip.duration
    ) {
      activeGroundedStanceState = null
    }

    if (previousStance === null) {
      previousStance = controls.stance
      stanceTransitionState.crouchingAmount = targetCrouchingAmount
      groundedStanceTransitionState.crouchingAmount =
        targetCrouchingAmount
      groundedStanceTransitionState.fromCrouchingAmount =
        targetCrouchingAmount
      groundedStanceTransitionState.toCrouchingAmount =
        targetCrouchingAmount
    } else if (controls.stance !== previousStance) {
      previousStance = controls.stance
      if (directStanceTransition) {
        if (
          !transitionFromAuthoredStanceState(
            targetCrouchingAmount,
            delta,
          )
        ) {
          groundedStanceTransitionSource = null
          startGroundedStanceTransition(
            groundedStanceTransitionState,
            stanceTransitionState.crouchingAmount,
            targetCrouchingAmount,
          )
        }
      } else {
        groundedStanceTransitionSource = null
        groundedStanceTransitionState.active = false
        enterAuthoredStanceState(targetCrouchingAmount)
      }
    } else if (
      directStanceTransition
      && activeGroundedStanceState
    ) {
      transitionFromAuthoredStanceState(
        targetCrouchingAmount,
        delta,
      )
    }

    if (previousMovingSmooth === null) {
      previousMovingSmooth = controls.movingSmooth
    } else {
      if (!previousMovingSmooth && controls.movingSmooth) {
        queueStopTransitionAndTurnInPlaceAnimations(
          transitionsState,
          STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION,
        )
      }
      previousMovingSmooth = controls.movingSmooth
    }

    if (activeGroundedStanceState) {
      const source = activeGroundedStanceState
      source.clip.time = Math.min(
        source.clip.sampler.clip.duration,
        source.clip.time
          + Math.max(0, delta) * source.sequencePlayRate,
      )
      source.clip.entry.time = source.clip.time
      source.clip.entry.loop = false
    }

    const activeTurnInPlaceSample =
      turnInPlaceSample && turnInPlaceSample.status !== 'completed'
        ? turnInPlaceSample
        : undefined
    const turnInPlaceMontageWeight =
      activeTurnInPlaceSample?.weight ?? 0

    const stanceTransition = activeGroundedStanceState
      ? {
          time: activeGroundedStanceState.clip.time,
          curves: activeGroundedStanceState.clip.curves ?? {},
        }
      : undefined
    const groundedStanceTransitionWasActive =
      groundedStanceTransitionState.active
    if (groundedStanceTransitionWasActive) {
      advanceGroundedStanceTransition(
        groundedStanceTransitionState,
        delta,
      )
    }
    const retainedStanceSource = groundedStanceTransitionSource
    if (retainedStanceSource) {
      const sourceTime = retainedStanceSource.clip.time
      const sourceCurves = retainedStanceSource.clip.curves
      const sourceWeight =
        1 - groundedStanceTransitionState.blendAlpha
      const targetWeight =
        groundedStanceTransitionState.blendAlpha
      const sourceCrouchingAmount = clamp01(
        sourceCurves?.[POSE_CROUCHING_CURVE_NAME]?.(sourceTime)
          ?? retainedStanceSource.fallbackCrouchingAmount,
      )
      stanceTransitionState.crouchingAmount =
        sourceCrouchingAmount * sourceWeight
        + retainedStanceSource.targetCrouchingAmount * targetWeight
      stanceTransitionState.footLeftLock =
        clamp01(
          sourceCurves?.[FOOT_LEFT_LOCK_CURVE_NAME]?.(sourceTime) ?? 0,
        ) * sourceWeight
      stanceTransitionState.footRightLock =
        clamp01(
          sourceCurves?.[FOOT_RIGHT_LOCK_CURVE_NAME]?.(sourceTime) ?? 0,
        ) * sourceWeight
    } else if (groundedStanceTransitionWasActive) {
      stanceTransitionState.crouchingAmount =
        groundedStanceTransitionState.crouchingAmount
      stanceTransitionState.footLeftLock = 0
      stanceTransitionState.footRightLock = 0
    } else {
      refreshStanceTransition(
        stanceTransitionState,
        targetCrouchingAmount,
        delta,
        stanceTransition,
      )
    }
    const crouchingAmount = stanceTransitionState.crouchingAmount
    state.crouchingAmount = crouchingAmount
    state.footLeftLock = stanceTransitionState.footLeftLock
    state.footRightLock = stanceTransitionState.footRightLock
    graphCrouchingAmount = crouchingAmount
    graphFootLeftLock = state.footLeftLock
    graphFootRightLock = state.footRightLock
    const locomotionCrouchingAmount = retainedStanceSource
      ? retainedStanceSource.targetCrouchingAmount
      : crouchingAmount

    const crouchingGraphRelevant =
      activeGroundedStanceState === null
      && (
        controls.stance === 'Crouching'
        || locomotionCrouchingAmount > Number.EPSILON
      )
    const previousCrouchingGraphState =
      crouchingStateRuntime.currentState
    refreshAlsCrouchingStateRuntime(
      crouchingStateRuntime,
      {
        relevant: crouchingGraphRelevant,
        deltaTime: Math.max(0, delta),
        movingSmooth: controls.movingSmooth,
        rotatingLeft: rotateInPlaceState.rotatingLeft,
        rotatingRight: rotateInPlaceState.rotatingRight,
        // These two dynamically loop-bound automatic-rule boundaries remain explicit in the
        // retained module until a UE differential establishes the engine comparison.
        rotateLeftAutomaticRemainingTimeReached: false,
        rotateRightAutomaticRemainingTimeReached: false,
      },
    )
    if (
      crouchingStateRuntime.currentState
        !== previousCrouchingGraphState
    ) {
      if (crouchingStateRuntime.currentState === 'Rotate Left') {
        crouchingRotateLeftTime = 0
      } else if (
        crouchingStateRuntime.currentState === 'Rotate Right'
      ) {
        crouchingRotateRightTime = 0
      }
    }
    processCrouchingLifecycleEvents()
    for (const request of crouchingStateRuntime.inertializationRequests) {
      crouchingNode34.requestInertialization(request.duration)
    }

    resetTurnInPlaceFrame(turnInPlaceState)
    const turnInPlaceGraphRelevant =
      controls.stance === 'Crouching'
        ? (
            crouchingGraphRelevant
            && crouchingStateRuntime.stateWeights.Idle > 0
          )
        : activeGroundedStanceState === null
    if (
      turnInPlaceAllowed
      && !rotateInPlaceAllowed
      && !controls.moving
      && turnInPlaceGraphRelevant
    ) {
      refreshTurnInPlaceState(turnInPlaceState, {
        delta,
        transitionsAllowed: transitionsState.transitionsAllowed,
        viewYawAngle: controls.viewYawAngle,
        viewYawSpeed: controls.viewYawSpeed,
        stance: controls.stance,
      })
    } else if (!turnInPlaceAllowed || rotateInPlaceAllowed || controls.moving) {
      turnInPlaceState.activationDelay = 0
    }

    const rotateDirection = rotateInPlaceState.rotatingLeft
      ? 'Left'
      : rotateInPlaceState.rotatingRight ? 'Right' : null
    const selectedRotateClip =
      controls.stance === 'Standing' && rotateDirection
      ? rotateInPlaceClips.Standing[rotateDirection]
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
    const stanceTargetWeight = retainedStanceSource
      ? groundedStanceTransitionState.blendAlpha
      : activeGroundedStanceState ? 0 : 1
    groundedStanceTransitionSourceWeight = retainedStanceSource
      ? 1 - groundedStanceTransitionState.blendAlpha
      : 0
    if (retainedStanceSource) {
      retainedStanceSource.clip.entry.weight =
        groundedStanceTransitionSourceWeight
      retainedStanceSource.clip.entry.time = retainedStanceSource.clip.time
      retainedStanceSource.clip.entry.loop = false
    }
    if (activeGroundedStanceState) {
      activeGroundedStanceState.clip.entry.weight = 1
      activeGroundedStanceState.clip.entry.time =
        activeGroundedStanceState.clip.time
      activeGroundedStanceState.clip.entry.loop = false
    }
    const effectiveRotateBlendWeight =
      rotateBlendWeight
      * (1 - locomotionCrouchingAmount)
      * stanceTargetWeight
    if (rotateClip) {
      rotateClip.entry.weight = effectiveRotateBlendWeight
    }
    const baseWeight = (1 - rotateBlendWeight) * stanceTargetWeight
    const crouchingGraphWeight =
      locomotionCrouchingAmount * stanceTargetWeight
    activeCrouchingGraphWeight = crouchingGraphWeight

    // AB_Als_Standing's Idle <-> Move transitions are discrete 0.2s Hermite transitions. Speed
    // shapes Stride Amount and PlayRate inside Move; it never continuously crossfades Idle into
    // full gait cycles.
    moveBlendProgress = moveToward(
      moveBlendProgress,
      controls.movingSmooth ? 1 : 0,
      Math.max(0, delta) / STANDING_MOVE_BLEND_DURATION,
    )
    const movingAmount = hermiteCubic01(moveBlendProgress)
    graphGroundedAmount = 1
    graphMovingAmount = movingAmount
    standWeights.fill(0)
    standWeights[STAND.IDLE] = 1 - movingAmount
    standWeights[
      controls.gait === 'Walking'
        ? STAND.WALK
        : controls.gait === 'Running' ? STAND.RUN : STAND.SPRINT
    ] = movingAmount
    crouchMoveWeight = movingAmount

    // ALS exposes crouch walk/run maxima of 1.5/2.0m/s. The pack has one crouch walk cycle, so
    // speeds above walk cadence-scale that cycle up to the authored crouch-run movement cap.
    const crouchLimitedSpeed = Math.min(rawSpeed, ALS_AUTHORED_GAIT_SPEEDS.crouching.run)
    const locomotionSpeed = rawSpeed
      + (crouchLimitedSpeed - rawSpeed) * locomotionCrouchingAmount

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

    state.movementDirection = refreshMovementDirection(
      controls.rotationMode,
      controls.gait,
      controls.direction,
    )
    state.directionTransitionRequest = null
    const crouchingMovementRelevant =
      crouchingGraphRelevant
      && (
        crouchingStateRuntime.stateWeights.Move > 0
        || crouchingStateRuntime.stateWeights.Stop > 0
      )
    refreshAlsCrouchingMovementRuntime(
      crouchingMovementRuntime,
      {
        relevant: crouchingMovementRelevant,
        movementDirection: state.movementDirection,
        hipsDirectionLockAmount: state.hipsDirectionLockAmount,
        feetCrossingAmount: state.feetCrossingAmount,
      },
      Math.max(0, delta),
      setHipsDirection,
    )
    refreshCrouchingMovement(
      crouchingState,
      rawSpeed / Math.max(1e-4, controls.scale ?? 1),
    )
    const crouchingStrideBlendAmount =
      refreshAlsCrouchingStrideBlend(
        crouchingStrideBlendRuntime,
        crouchingState.strideBlendAmount,
        Math.max(0, delta),
        crouchingMovementRelevant,
      )
    for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      crouchingMovementClipWeights[direction] = 0
    }
    for (const stateDirection of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const poseWeights = evaluateAlsCrouchingMovementState(
        stateDirection,
        velocityBlend,
        crouchingMovementStateWeights[stateDirection],
      )
      const stateWeight =
        crouchingMovementRuntime.stateWeights[stateDirection]
      for (const clipDirection of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
        crouchingMovementClipWeights[clipDirection] +=
          poseWeights[clipDirection] * stateWeight
      }
    }
    const movementStatesShouldBeRelevant =
      controls.movingSmooth && controls.stance === 'Standing'
    if (movementStatesShouldBeRelevant) {
      const transitionClock = directionTransitionClock!
      if (!movementStatesRelevant) {
        // Movement States has bReinitializeOnBecomingRelevant and
        // bSkipFirstUpdateTransition. Its initial state's OnBecomeRelevant calls
        // SetHipsDirection(Forward).
        movementStatesRelevant = true
        resetStateTransitionClock(transitionClock, 'Forward')
        setHipsDirection('Forward')
      } else {
        // Public SetHipsDirection() is also used by parity tests. In normal graph execution it
        // already agrees with the state clock; a direct external call reinitializes the machine
        // before its next transition query, matching bReinitializeOnBecomingRelevant semantics.
        if (
          !transitionClock.active
          && transitionClock.currentState !== state.hipsDirection
        ) {
          resetStateTransitionClock(transitionClock, state.hipsDirection)
        }
        advanceStateTransition(transitionClock, Math.max(0, delta))
        setHipsDirection(transitionClock.currentState)

        // UE can retain more than one interrupted transition. That exact propagation remains an
        // engine work item, so this verified two-state node accepts another request only after the
        // authored blend reaches its target instead of replacing it with an approximation.
        if (!transitionClock.active) {
          const transition = selectGroundedDirectionTransition({
            hipsDirection: transitionClock.currentState,
            movementDirection: state.movementDirection,
            hipsDirectionLockAmount: state.hipsDirectionLockAmount,
            feetCrossingAmount: state.feetCrossingAmount,
            stateWeight: 1,
          })
          if (transition) {
            const startResult = startStateTransition(transitionClock, {
              from: transition.from,
              to: transition.to,
              duration: transition.duration,
              blendOption: transition.blendOption,
              blendProfile: moveDirectionChangeProfile!,
            })
            if (startResult === 'started' || startResult === 'completed') {
              setHipsDirection(transition.to)
              state.directionTransitionRequest = {
                ...transition,
                moveDirectionChangeProfileApplied: true,
              }
            }
          }
        }
      }
    } else {
      movementStatesRelevant = false
    }

    for (const clip of baseClips) clip.entry.weight = 0
    for (const entries of directionTransitionEntriesByClip.values()) {
      entries.from.weight = 0
      entries.to.weight = 0
    }
    for (const member of locomotionSyncGroup.members) {
      member.weight = 0
    }

    // AB_Als_Crouching now contributes one retained graph node. Its sequence players remain in
    // Movement for marker synchronization, but may not also leak into the flattened base.
    const crouchingMovementOuterWeight =
      crouchingStateRuntime.stateWeights.Move
      + crouchingStateRuntime.stateWeights.Stop
    for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const role = CROUCHING_ROLE_BY_HIPS_DIRECTION[direction]
      const clip = roles[role]
      if (!clip) continue
      const syncMember = locomotionMembersByRole.get(role)
      clip.entry.weight = 0
      if (syncMember) {
        syncMember.weight =
          crouchingMovementClipWeights[direction]
          * crouchingMovementOuterWeight
          * crouchingGraphWeight
      }
    }
    if (roles.crouchIdle) roles.crouchIdle.entry.weight = 0

    const standingAmount = (1 - locomotionCrouchingAmount) * baseWeight
    const idle = roles.idle
    if (idle) idle.entry.weight = (1 - movingAmount) * standingAmount

    const standingMovement = refreshStandingMovement({
      locomotionSpeed: rawSpeed * 100,
      locomotionScale: controls.scale ?? 1,
      gait: controls.gait,
      poseGaitCurveValue: gaitAmounts.amount,
      poseGroundedCurveValue: gaitAmounts.groundedAmount,
    })
    state.standingMovement = standingMovement

    const standingSprint = refreshStandingSprint(state.standingSprint, {
      gait: controls.gait,
      deltaTime: delta,
      sprintBlockCurveValue: state.standingSprint.sprintBlockAmount,
      relativeAccelerationAmountX: controls.relativeAccelerationAmount.x,
      standingPlayRate: standingMovement.playRate,
      relevant: movingAmount > 0 && standingAmount > 0,
    })
    const standingGraphWeight = movingAmount * standingAmount

    if (
      standingGraphWeight > 0
      && standingSprint.moveForwardBaseWeight > 0
    ) {
      const directionGraphWeight =
        standingSprint.moveForwardBaseWeight * standingGraphWeight
      const transitionClock = directionTransitionClock!
      if (transitionClock.active) {
        normalizeTransitionPoseMask(
          transitionClock.fromPoseMask,
          transitionClock.fromStateWeight,
          directionTransitionFromMask,
        )
        normalizeTransitionPoseMask(
          transitionClock.toPoseMask,
          transitionClock.toStateWeight,
          directionTransitionToMask,
        )
        accumulateStandingDirectionState(
          transitionClock.fromState,
          transitionClock.fromStateWeight,
          'from',
          standingMovement,
          directionGraphWeight,
        )
        accumulateStandingDirectionState(
          transitionClock.toState,
          transitionClock.toStateWeight,
          'to',
          standingMovement,
          directionGraphWeight,
        )
      } else {
        accumulateStandingDirectionState(
          transitionClock.currentState,
          1,
          null,
          standingMovement,
          directionGraphWeight,
        )
      }
    }

    const sprint = roles.sprint
    if (sprint) {
      sprint.entry.weight =
        standingSprint.sprintWeight * standingGraphWeight
      const member = locomotionMembersByClip.get(sprint)
      if (member) {
        member.weight = sprint.entry.weight
        member.playRate = standingSprint.sprintPlayRate
      }
    }
    if (sprintAccelerationClip) {
      sprintAccelerationClip.entry.weight =
        standingSprint.sprintAccelerationWeight * standingGraphWeight
      const member = locomotionMembersByClip.get(sprintAccelerationClip)
      if (member) {
        member.weight = sprintAccelerationClip.entry.weight
        member.playRate = standingSprint.sprintAccelerationPlayRate
      }
    }

    const standingTurnInPlaceSlotWeight =
      (1 - movingAmount) * (1 - locomotionCrouchingAmount) * baseWeight
    const crouchingTurnInPlaceSlotWeight =
      crouchingGraphWeight * crouchingStateRuntime.stateWeights.Idle
    const standingTurnInPlaceActive =
      activeTurnInPlaceSample?.slotName === TURN_IN_PLACE_STANDING_SLOT_NAME
      && activeTurnInPlaceClip !== null
    const crouchingTurnInPlaceActive =
      activeTurnInPlaceSample?.slotName === TURN_IN_PLACE_CROUCHING_SLOT_NAME
      && activeTurnInPlaceClip !== null

    if (turnInPlaceStandingSlot) {
      turnInPlaceStandingSlot.weight = standingTurnInPlaceSlotWeight
      turnInPlaceStandingSlot.montage =
        standingTurnInPlaceActive ? activeTurnInPlaceClip!.entry : undefined
      turnInPlaceStandingSlot.montageWeight =
        standingTurnInPlaceActive ? turnInPlaceMontageWeight : 0
    }
    if (turnInPlaceCrouchingSlot) {
      // The retained Crouching graph owns this Slot before node34.
      turnInPlaceCrouchingSlot.weight = 0
      turnInPlaceCrouchingSlot.montage = undefined
      turnInPlaceCrouchingSlot.montageWeight = 0
    }
    if (roles.idle) {
      roles.idle.entry.time = 0
      roles.idle.entry.weight = standingTurnInPlaceSlotWeight
        * (standingTurnInPlaceActive ? 1 - turnInPlaceMontageWeight : 1)
    }
    if (roles.crouchIdle) {
      roles.crouchIdle.entry.time = 0
      roles.crouchIdle.entry.weight = 0
    }
    if (activeTurnInPlaceClip) {
      activeTurnInPlaceClip.entry.weight =
        (
          standingTurnInPlaceActive
            ? standingTurnInPlaceSlotWeight
            : 0
        ) * turnInPlaceMontageWeight
    }

    const fallbackGaitAmount =
      (standWeights[STAND.WALK]
        + standWeights[STAND.RUN] * 2
        + standWeights[STAND.SPRINT] * 3)
        * (1 - locomotionCrouchingAmount)
      + crouchMoveWeight * locomotionCrouchingAmount

    const defaultActive = controls.overlayMode === 'Default'
    const rifleActive = controls.overlayMode === 'Rifle'
    activeOverlayMode = controls.overlayMode
    if (idleAdditiveEntry && idleAdditiveClip) {
      idleAdditiveEntry.time = idleAdditiveClip.time
      // Both authored linked overlays apply A_Als_Idle at node-local alpha 0.75, independently of
      // the locomotion turn slot.
      idleAdditiveEntry.weight =
        defaultActive || rifleActive ? IDLE_ADDITIVE_WEIGHT : 0
    }
    if (previousOverlayMode === null) {
      previousOverlayMode = controls.overlayMode
    } else if (controls.overlayMode !== previousOverlayMode) {
      previousOverlayMode = controls.overlayMode
      if (controls.overlayMode === 'Rifle') {
        // AB_Als_Rifle's outer state machine is authored with
        // bReinitializeOnBecomingRelevant=true.
        resetAlsRifleRelaxedRuntime(rifleRelaxedRuntime)
      }
      // AB_Als_Default and AB_Als_Rifle both author 0.2s GraphBlendOptions for the Overlay linked
      // layer. Their request belongs to AB_Als node 11, never the final output inertializer.
      overlayInertialization.inertialization.requestInertialization(
        OVERLAY_MODE_INERTIALIZATION_DURATION,
      )
    }
    defaultOverlayGraphSample = refreshAlsDefaultOverlayGraph(
      defaultOverlayGraphState,
      {
        gaitWalkingAmount: gaitAmounts.walking,
        standingAmount: gaitAmounts.standingAmount,
        crouchingAmount: gaitAmounts.crouchingAmount,
        inAirAmount: gaitAmounts.inAirAmount,
        groundPredictionAmount: 0,
        deltaTime: delta,
        relevant: defaultActive,
      },
    )

    const rifleGraphState = refreshAlsRifleRelaxedState(
      rifleRelaxedRuntime,
      {
        relevant: rifleActive,
        deltaTime: delta,
        standingAmount: gaitAmounts.standingAmount,
        crouchingAmount: gaitAmounts.crouchingAmount,
        gaitWalkingAmount: gaitAmounts.walking,
        gaitRunningAmount: gaitAmounts.running,
        gaitSprintingAmount: gaitAmounts.sprinting,
        inAirAmount: gaitAmounts.inAirAmount,
        groundPredictionAmount: 0,
        sprintAccelerationAmount:
          state.standingSprint.sprintAccelerationAmount,
        velocityBlend: {
          forwardAmount: velocityBlend.forwardAmount,
          backwardAmount: velocityBlend.backwardAmount,
          leftAmount: velocityBlend.leftAmount,
          rightAmount: velocityBlend.rightAmount,
        },
      },
    )

    for (const source of rifleOverlaySources) {
      const syncMember = overlayLocomotionMembers.get(source)
      if (syncMember) syncMember.weight = 0
    }
    if (rifleActive) {
      const groundedStandingWeight =
        (1 - clamp01(rifleGraphState.inAirAmount))
        * rifleGraphState.stanceWeights[0]
      const runningBranchWeight =
        groundedStandingWeight
        * clamp01(rifleGraphState.gaitWalkingAmount)
        * clamp01(rifleGraphState.gaitRunningAmount)
      const sprintingAmount =
        clamp01(rifleGraphState.gaitSprintingAmount)
      const sprintAccelerationAmount =
        clamp01(rifleGraphState.sprintAccelerationAmount)

      const runArmsMember = rifleRunArmsSource
        ? overlayLocomotionMembers.get(rifleRunArmsSource)
        : undefined
      if (runArmsMember) {
        runArmsMember.weight =
          runningBranchWeight
          * (1 - sprintingAmount)
          * rifleGraphState.velocityBlendWeights[0]
      }

      const sprintArmsMember = rifleSprintArmsSource
        ? overlayLocomotionMembers.get(rifleSprintArmsSource)
        : undefined
      if (sprintArmsMember) {
        if (rifleGraphState.node41ResetChildOnActivation.sprintArms) {
          sprintArmsMember.time = 0
        }
        sprintArmsMember.weight =
          runningBranchWeight
          * sprintingAmount
          * (1 - sprintAccelerationAmount)
      }

      const sprintImpulseArmsMember = rifleSprintImpulseArmsSource
        ? overlayLocomotionMembers.get(rifleSprintImpulseArmsSource)
        : undefined
      if (sprintImpulseArmsMember) {
        if (
          rifleGraphState.node41ResetChildOnActivation.sprintImpulseArms
        ) {
          sprintImpulseArmsMember.time = 0
        }
        sprintImpulseArmsMember.weight =
          runningBranchWeight
          * sprintingAmount
          * sprintAccelerationAmount
      }
    }

    for (const member of locomotionSyncGroup.members) {
      if (
        member.weight <= 0
        || (
          !groundedLocomotionClipNames.has(member.id)
          && member.id !== ALS_STANDING_SPRINT_GRAPH.sprint.clip
          && member.id
            !== ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.clip
        )
      ) {
        member.playRate = standingMovement.playRate
      }
    }
    for (const role of locomotionRoles) {
      if (!role.startsWith('crouch')) continue
      const member = locomotionMembersByRole.get(role)
      if (member) member.playRate = crouchingState.playRate
    }
    const syncResult = advanceSyncGroup(locomotionSyncGroup, delta)
    normalDebugWeights.locomotionCadence = syncResult.leader
      && syncResult.leader.duration > 0
      ? syncResult.leader.playRate / syncResult.leader.duration
      : 0
    for (const [clip, member] of locomotionMembersByClip) {
      clip.entry.time = member.time
      const transitionEntries = directionTransitionEntriesByClip.get(clip)
      if (transitionEntries) {
        transitionEntries.from.time = member.time
        transitionEntries.to.time = member.time
      }
    }
    for (const source of rifleOverlaySources) {
      source.time = source.key === 'poses'
        ? 0
        : overlayLocomotionMembers.get(source)?.time ?? 0
    }
    if (rifleRelaxedSources) {
      rifleRelaxedSources.runArms.time =
        rifleRunArmsSource?.time ?? 0
      rifleRelaxedSources.sprintArms.time =
        rifleSprintArmsSource?.time ?? 0
      rifleRelaxedSources.sprintImpulseArms.time =
        rifleSprintImpulseArmsSource?.time ?? 0
    }

    if (
      crouchingGraphRelevant
      && crouchingWalkPoseClip
      && roles.crouchIdle
      && rotateInPlaceClips.Crouching.Left
      && rotateInPlaceClips.Crouching.Right
    ) {
      sampleSequencePoseNode(
        rig,
        crouchingWalkPoseClip,
        0,
        false,
        crouchingFixedWalkPose,
      )
      sampleSequencePoseNode(
        rig,
        crouchingWalkPoseClip,
        0,
        false,
        crouchingStopLeftPose,
      )
      sampleSequencePoseNode(
        rig,
        crouchingWalkPoseClip,
        0,
        false,
        crouchingStopRightPose,
      )
      sampleSequencePoseNode(
        rig,
        roles.crouchIdle,
        0,
        false,
        crouchingIdlePose,
      )

      for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
        const clip = crouchingMovementClips[direction]!
        sampleSequencePoseNode(
          rig,
          clip,
          clip.entry.time,
          true,
          crouchingMovementSequenceNodes[direction],
        )
      }
      const movementSequencePoses =
        ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
          (direction) => crouchingMovementSequenceNodes[direction],
        )
      for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
        const poseWeights = crouchingMovementStateWeights[direction]
        blendPoseNodesTogether(
          movementSequencePoses,
          ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
            (sourceDirection) => poseWeights[sourceDirection],
          ),
          crouchingMovementStateNodes[direction],
        )
      }

      copyPoseNode(
        crouchingMovementStateNodes[
          crouchingMovementRuntime.baseState
        ],
        crouchingMovementOutput,
      )
      for (const active of crouchingMovementRuntime.activeTransitions) {
        const target =
          crouchingMovementStateNodes[active.nextState]
        blendPoseInPlace(
          crouchingMovementOutput.pose,
          target.pose,
          1,
          active.nextPoseMask,
        )
        blendTwoCurvesTogether(
          crouchingMovementOutput.curves,
          target.curves,
          1 - active.alpha,
          crouchingMovementCurveScratch,
        )
        crouchingMovementOutput.curves.clear()
        for (const [name, value] of crouchingMovementCurveScratch) {
          crouchingMovementOutput.curves.set(name, value)
        }
      }

      const rotateDelta = Math.max(0, delta)
        * rotateInPlaceState.playRate
      const leftDuration =
        rotateInPlaceClips.Crouching.Left.sampler.clip.duration
      const rightDuration =
        rotateInPlaceClips.Crouching.Right.sampler.clip.duration
      if (crouchingStateRuntime.stateWeights['Rotate Left'] > 0) {
        crouchingRotateLeftTime = rotateInPlaceState.rotatingLeft
          ? (
              leftDuration > 0
                ? (
                    crouchingRotateLeftTime + rotateDelta
                  ) % leftDuration
                : 0
            )
          : Math.min(
              leftDuration,
              crouchingRotateLeftTime + rotateDelta,
            )
      }
      if (crouchingStateRuntime.stateWeights['Rotate Right'] > 0) {
        crouchingRotateRightTime = rotateInPlaceState.rotatingRight
          ? (
              rightDuration > 0
                ? (
                    crouchingRotateRightTime + rotateDelta
                  ) % rightDuration
                : 0
            )
          : Math.min(
              rightDuration,
              crouchingRotateRightTime + rotateDelta,
            )
      }
      sampleSequencePoseNode(
        rig,
        rotateInPlaceClips.Crouching.Left,
        crouchingRotateLeftTime,
        rotateInPlaceState.rotatingLeft,
        crouchingRotateLeftPose,
      )
      sampleSequencePoseNode(
        rig,
        rotateInPlaceClips.Crouching.Right,
        crouchingRotateRightTime,
        rotateInPlaceState.rotatingRight,
        crouchingRotateRightPose,
      )

      const activeCrouchingTurn =
        crouchingTurnInPlaceActive && activeTurnInPlaceClip
          ? activeTurnInPlaceClip
          : undefined
      if (activeCrouchingTurn) {
        sampleSequencePoseNode(
          rig,
          activeCrouchingTurn,
          activeCrouchingTurn.time,
          false,
          crouchingTurnInPlacePose,
        )
      }

      const statePoses = evaluateAlsCrouchingPoseGraph(
        crouchingPoseGraphRuntime,
        {
          fixedCrouchWalkPose: crouchingFixedWalkPose,
          movementStatesPose: crouchingMovementOutput,
          leanAdditivePose: crouchingLeanAdditive,
          idlePose: crouchingIdlePose,
          turnInPlaceMontagePose: activeCrouchingTurn
            ? crouchingTurnInPlacePose
            : undefined,
          turnInPlaceMontageWeight: activeCrouchingTurn
            ? turnInPlaceMontageWeight
            : 0,
          turnInPlacePlayRate: turnInPlaceState.playRate,
          rotateLeftPose: crouchingRotateLeftPose,
          rotateRightPose: crouchingRotateRightPose,
          rotateInPlacePlayRate: rotateInPlaceState.playRate,
          stopLeftFixedPose: crouchingStopLeftPose,
          stopRightFixedPose: crouchingStopRightPose,
          strideBlendAlpha: crouchingStrideBlendAmount,
        },
      )

      const activeOuterTransitions =
        crouchingStateRuntime.activeStandardTransitions
      const firstOuterTransition = activeOuterTransitions[0]
      if (!firstOuterTransition) {
        copyPoseNode(
          statePoses[crouchingStateRuntime.currentState],
          crouchingGraphOutput,
        )
      } else {
        copyPoseNode(
          statePoses[firstOuterTransition.previousState],
          crouchingGraphOutput,
        )
        for (const active of activeOuterTransitions) {
          const target = statePoses[active.nextState]
          blendPoseInPlace(
            crouchingGraphOutput.pose,
            target.pose,
            1,
            active.nextPoseMask,
          )
          blendTwoCurvesTogether(
            crouchingGraphOutput.curves,
            target.curves,
            1 - active.alpha,
            crouchingOuterBlendScratch,
          )
          crouchingGraphOutput.curves.clear()
          for (const [name, value] of crouchingOuterBlendScratch) {
            crouchingGraphOutput.curves.set(name, value)
          }
        }
      }

      prepareOutputInertialization(
        crouchingNode34Output,
        crouchingNode34,
      )
      applyInertialization(
        crouchingNode34,
        crouchingGraphOutput.pose,
        Math.max(0, delta),
      )
      applyOutputInertialization(
        crouchingNode34Output,
        crouchingGraphOutput.curves,
        undefined,
        Math.max(0, delta),
        crouchingNode34,
      )
      publishAlsCrouchingOutputCurve(crouchingGraphOutput)
    }

    copyPose(standReference, layeringReference)
    blendPoseInPlace(
      layeringReference,
      crouchReference,
      crouchingAmount,
    )

    graphRotationYawSpeed = 0
    const turnInPlaceSlotWeight =
      standingTurnInPlaceSlotWeight
    const activeTurnInPlaceSlotWeight = standingTurnInPlaceActive
      ? standingTurnInPlaceSlotWeight
      : 0
    const turnInPlaceCurves = activeTurnInPlaceClip?.curves
    const turnInPlaceCurveTime = activeTurnInPlaceClip?.time ?? 0
    const activeTurnInPlaceFootLeftLock = blendSlotCurveValue(
      1,
      turnInPlaceCurves?.[FOOT_LEFT_LOCK_CURVE_NAME]?.(
        turnInPlaceCurveTime,
      ),
      turnInPlaceMontageWeight,
    )
    const activeTurnInPlaceFootRightLock = blendSlotCurveValue(
      1,
      turnInPlaceCurves?.[FOOT_RIGHT_LOCK_CURVE_NAME]?.(
        turnInPlaceCurveTime,
      ),
      turnInPlaceMontageWeight,
    )

    graphFootLeftLock =
      graphFootLeftLock * (1 - turnInPlaceSlotWeight)
      + (turnInPlaceSlotWeight - activeTurnInPlaceSlotWeight)
      + activeTurnInPlaceSlotWeight * activeTurnInPlaceFootLeftLock
    graphFootRightLock =
      graphFootRightLock * (1 - turnInPlaceSlotWeight)
      + (turnInPlaceSlotWeight - activeTurnInPlaceSlotWeight)
      + activeTurnInPlaceSlotWeight * activeTurnInPlaceFootRightLock
    graphAllowTransitions =
      1 - activeTurnInPlaceSlotWeight
      + activeTurnInPlaceSlotWeight * blendSlotCurveValue(
        1,
        undefined,
        turnInPlaceMontageWeight,
      )

    if (activeTurnInPlaceClip) {
      graphRotationYawSpeed =
        blendSlotCurveValue(
          0,
          turnInPlaceCurves?.[ROTATION_YAW_SPEED_CURVE_NAME]?.(
            turnInPlaceCurveTime,
          ),
          turnInPlaceMontageWeight,
        )
        * turnInPlaceState.playRate
        * activeTurnInPlaceSlotWeight
    } else if (rotateClip) {
      const curves = rotateClip.curves
      graphRotationYawSpeed =
        (curves?.[ROTATION_YAW_SPEED_CURVE_NAME]?.(rotateClipTime) ?? 0)
        * rotateInPlaceState.playRate
        * effectiveRotateBlendWeight
      if (curves?.[FOOT_LEFT_LOCK_CURVE_NAME]) {
        graphFootLeftLock = clamp01(
          graphFootLeftLock
          + curves[FOOT_LEFT_LOCK_CURVE_NAME](rotateClipTime)
            * (
              retainedStanceSource
                ? effectiveRotateBlendWeight
                : 1
            ),
        )
      }
      if (curves?.[FOOT_RIGHT_LOCK_CURVE_NAME]) {
        graphFootRightLock = clamp01(
          graphFootRightLock
          + curves[FOOT_RIGHT_LOCK_CURVE_NAME](rotateClipTime)
            * (
              retainedStanceSource
                ? effectiveRotateBlendWeight
                : 1
            ),
        )
      }
    }
    if (crouchingGraphWeight > 0) {
      graphFootLeftLock = clamp01(
        graphFootLeftLock
        + (
          crouchingGraphOutput.curves.get(FOOT_LEFT_LOCK_CURVE_NAME)
          ?? 0
        ) * crouchingGraphWeight,
      )
      graphFootRightLock = clamp01(
        graphFootRightLock
        + (
          crouchingGraphOutput.curves.get(FOOT_RIGHT_LOCK_CURVE_NAME)
          ?? 0
        ) * crouchingGraphWeight,
      )
      graphRotationYawSpeed +=
        (
          crouchingGraphOutput.curves.get(
            ROTATION_YAW_SPEED_CURVE_NAME,
          ) ?? 0
        ) * crouchingGraphWeight
      graphAllowTransitions = clamp01(
        graphAllowTransitions
        + crouchingGraphWeight * (
          (
            crouchingGraphOutput.curves.get(
              ALLOW_TRANSITIONS_CURVE_NAME,
            ) ?? 0
          ) - 1
        ),
      )
      graphMovingAmount =
        movingAmount * (1 - crouchingGraphWeight)
        + (
          crouchingGraphOutput.curves.get(POSE_MOVING_CURVE_NAME)
          ?? 0
        ) * crouchingGraphWeight
    } else {
      graphMovingAmount = movingAmount
    }
    graphFallbackGaitAmount = fallbackGaitAmount
    for (const source of gaitSources) source.weight = source.entry.weight

    const result = evaluatePose(evaluator, mainInput)
    if (handIkRuntime) {
      evaluateAlsControlRigHandIk(handIkRuntime, {
        pose: result.pose,
        curves: result.curves.values,
        useHandIkBones: ALS_GENERAL_ANIMATION_SETTINGS.useHandIkBones,
      })
    }
    applyPose(applicator, result.pose)

    const finalCurves = result.curves.values
    refreshTransitions(
      transitionsState,
      finalCurves.get(ALLOW_TRANSITIONS_CURVE_NAME)
        ?? graphAllowTransitions,
    )
    state.crouchingAmount = clamp01(
      finalCurves.get(POSE_CROUCHING_CURVE_NAME) ?? graphCrouchingAmount,
    )
    state.footLeftLock = clamp01(
      finalCurves.get(FOOT_LEFT_LOCK_CURVE_NAME) ?? graphFootLeftLock,
    )
    state.footRightLock = clamp01(
      finalCurves.get(FOOT_RIGHT_LOCK_CURVE_NAME) ?? graphFootRightLock,
    )
    state.hipsDirectionLockAmount = Math.max(
      -1,
      Math.min(
        1,
        finalCurves.get(HIPS_DIRECTION_LOCK_CURVE_NAME) ?? 0,
      ),
    )
    state.feetCrossingAmount = clamp01(
      finalCurves.get(FEET_CROSSING_CURVE_NAME) ?? 0,
    )
    state.standingSprint.sprintBlockAmount = clamp01(
      finalCurves.get(SPRINT_BLOCK_CURVE_NAME) ?? 0,
    )
    state.rotationYawSpeed =
      finalCurves.get(ROTATION_YAW_SPEED_CURVE_NAME)
      ?? graphRotationYawSpeed
    if (!finalCurves.has(POSE_GAIT_CURVE_NAME)) {
      finalCurves.set(POSE_GAIT_CURVE_NAME, fallbackGaitAmount)
    }
    refreshPose(finalCurves, gaitAmounts)

    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      const clip = roles[role]
      if (clip) {
        const transitionEntries = directionTransitionEntriesByClip.get(clip)
        normalDebugWeights[role] =
          clip.entry.weight
          + (transitionEntries?.from.weight ?? 0)
          + (transitionEntries?.to.weight ?? 0)
        normalDebugWeights[`clipTime.${role}`] = clip.entry.time
        normalDebugWeights[`clipPhase.${role}`] =
          clip.sampler.clip.duration > 0
            ? clip.entry.time / clip.sampler.clip.duration
            : 0
      }
    }
    const crouchingMovementDebugWeight =
      (
        crouchingStateRuntime.stateWeights.Move
        + crouchingStateRuntime.stateWeights.Stop
      )
      * crouchingStrideBlendAmount
      * crouchingGraphWeight
    for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const role = CROUCHING_ROLE_BY_HIPS_DIRECTION[direction]
      normalDebugWeights[role] =
        crouchingMovementClipWeights[direction]
        * crouchingMovementDebugWeight
    }
    normalDebugWeights.crouchIdle =
      crouchingStateRuntime.stateWeights.Idle
      * crouchingGraphWeight
      * (
        crouchingTurnInPlaceActive
          ? 1 - turnInPlaceMontageWeight
          : 1
      )
    for (const [clipName, clip] of groundedLocomotionClips) {
      const transitionEntries = directionTransitionEntriesByClip.get(clip)
      normalDebugWeights[clipName] =
        clip.entry.weight
        + (transitionEntries?.from.weight ?? 0)
        + (transitionEntries?.to.weight ?? 0)
    }
    if (sprintAccelerationClip) {
      normalDebugWeights.sprintAcceleration =
        sprintAccelerationClip.entry.weight
      normalDebugWeights['clipTime.sprintAcceleration'] =
        sprintAccelerationClip.entry.time
      normalDebugWeights['clipPhase.sprintAcceleration'] =
        sprintAccelerationClip.sampler.clip.duration > 0
          ? (
              sprintAccelerationClip.entry.time
              / sprintAccelerationClip.sampler.clip.duration
            )
          : 0
    }
    const transitionClock = directionTransitionClock!
    for (const hipsDirection of Object.keys(groundedLocomotionGraph.evaluators)) {
      normalDebugWeights[`HipsDirection.${hipsDirection}`] =
        transitionClock.active
          ? (
              Number(hipsDirection === transitionClock.fromState)
                * transitionClock.fromStateWeight
              + Number(hipsDirection === transitionClock.toState)
                * transitionClock.toStateWeight
            )
          : Number(hipsDirection === transitionClock.currentState)
    }
    normalDebugWeights.StrideBlendAmount =
      state.standingMovement.strideBlendAmount
    normalDebugWeights.WalkRunBlendAmount =
      state.standingMovement.walkRunBlendAmount
    normalDebugWeights.StandingPlayRate = state.standingMovement.playRate
    normalDebugWeights.SprintBlockAmount =
      state.standingSprint.sprintBlockAmount
    normalDebugWeights.SprintTime = state.standingSprint.sprintTime
    normalDebugWeights.SprintAccelerationAmount =
      state.standingSprint.sprintAccelerationAmount
    normalDebugWeights.SprintBlendAmount =
      state.standingSprint.sprintBlendAmount
    normalDebugWeights.SprintAccelerationBlendAmount = clamp01(
      state.standingSprint.sprintAccelerationBlendAmount,
    )
    normalDebugWeights.groundedAmount = gaitAmounts.groundedAmount
    normalDebugWeights.inAirAmount = gaitAmounts.inAirAmount
    normalDebugWeights.standingAmount = gaitAmounts.standingAmount
    normalDebugWeights.crouchingPoseAmount = gaitAmounts.crouchingAmount
    normalDebugWeights.movingAmount = gaitAmounts.movingAmount
    normalDebugWeights.gaitAmount = gaitAmounts.amount
    normalDebugWeights.gaitWalkingAmount = gaitAmounts.walking
    normalDebugWeights.gaitRunningAmount = gaitAmounts.running
    normalDebugWeights.gaitSprintingAmount = gaitAmounts.sprinting
    normalDebugWeights.unweightedGaitAmount = gaitAmounts.unweightedAmount
    normalDebugWeights.unweightedGaitWalkingAmount =
      gaitAmounts.unweightedWalking
    normalDebugWeights.unweightedGaitRunningAmount =
      gaitAmounts.unweightedRunning
    normalDebugWeights.unweightedGaitSprintingAmount =
      gaitAmounts.unweightedSprinting
    normalDebugWeights.idleAdditive = idleAdditiveEntry?.weight ?? 0
    normalDebugWeights['clipTime.idleAdditive'] =
      idleAdditiveEntry?.time ?? 0
    normalDebugWeights['clipPhase.idleAdditive'] =
      idleAdditiveEntry && idleAdditiveEntry.sampler.clip.duration > 0
        ? idleAdditiveEntry.time / idleAdditiveEntry.sampler.clip.duration
        : 0
    normalDebugWeights['clipTime.defaultOverlay'] = 0
    normalDebugWeights.defaultOverlay = defaultActive ? 1 : 0
    normalDebugWeights.locomotionMarkerSync = syncResult.usedMarkerSync ? 1 : 0
    normalDebugWeights[POSE_CROUCHING_CURVE_NAME] = state.crouchingAmount
    normalDebugWeights.GroundedStanceTransitionDirect =
      Number(directStanceTransition)
    normalDebugWeights.GroundedStanceTransitionActive =
      Number(groundedStanceTransitionState.active)
    normalDebugWeights.GroundedStanceTransitionLinearAlpha =
      groundedStanceTransitionState.linearAlpha
    normalDebugWeights.GroundedStanceTransitionBlendAlpha =
      groundedStanceTransitionState.blendAlpha
    normalDebugWeights.GroundedStanceTransitionClipWeight =
      activeGroundedStanceState
        ? 1
        : groundedStanceTransitionSourceWeight
    normalDebugWeights.GroundedStanceTransitionClipTime =
      (
        activeGroundedStanceState
        ?? groundedStanceTransitionSource
      )?.clip.time ?? 0
    normalDebugWeights.GroundedStanceTransitionSourceWeight =
      groundedStanceTransitionSourceWeight
    normalDebugWeights.CrouchingGraphRelevant =
      Number(crouchingGraphRelevant)
    for (const graphState of ALS_CROUCHING_GRAPH_STATE_ORDER) {
      normalDebugWeights[`CrouchingState${graphState.replaceAll(' ', '')}`] =
        crouchingGraphRelevant
          ? crouchingStateRuntime.stateWeights[graphState]
          : 0
    }
    const activeCrouchingTransition =
      crouchingStateRuntime.activeStandardTransitions[0]
    const activeCrouchingTransitionDefinition =
      activeCrouchingTransition
        ? ALS_CROUCHING_STATE_TRANSITIONS.find((transition) => (
            transition.from === activeCrouchingTransition.previousState
            && transition.to === activeCrouchingTransition.nextState
            && transition.logic === 'StandardBlend'
            && transition.duration > 0
          ))
        : undefined
    normalDebugWeights.CrouchingActiveTransitionIndex =
      activeCrouchingTransitionDefinition?.transitionIndex ?? -1
    normalDebugWeights.CrouchingActiveTransitionLinearAlpha =
      activeCrouchingTransition?.linearAlpha ?? 1
    normalDebugWeights.CrouchingActiveTransitionBlendAlpha =
      activeCrouchingTransition?.alpha ?? 1
    const activeQuickFeetTransition =
      quickFeetBlendProfile
        ? crouchingStateRuntime.activeStandardTransitions.find(
            ({ blendProfile }) => blendProfile === quickFeetBlendProfile,
          )
        : undefined
    normalDebugWeights.CrouchingQuickFeetProfileActive =
      Number(activeQuickFeetTransition !== undefined)
    normalDebugWeights.CrouchingQuickFeetRootIncomingWeight =
      activeQuickFeetTransition && directionTransitionRootIndex >= 0
        ? activeQuickFeetTransition.nextPoseMask[
            directionTransitionRootIndex
          ]
        : 0
    normalDebugWeights.CrouchingQuickFeetFootLeftIncomingWeight =
      activeQuickFeetTransition && directionTransitionFootLeftIndex >= 0
        ? activeQuickFeetTransition.nextPoseMask[
            directionTransitionFootLeftIndex
          ]
        : 0
    normalDebugWeights.CrouchingActiveTransitionCount =
      crouchingStateRuntime.activeStandardTransitions.length
    normalDebugWeights.CrouchingTransitionBlocked = 0
    normalDebugWeights.CrouchingTransitionBlockedIndex = -1
    const activeCrouchingMovementTransition =
      crouchingMovementRuntime.activeTransitions[0]
    normalDebugWeights.CrouchingMovementActiveTransitionCount =
      crouchingMovementRuntime.activeTransitions.length
    normalDebugWeights.CrouchingMovementRootIncomingWeight =
      activeCrouchingMovementTransition
      && directionTransitionRootIndex >= 0
        ? activeCrouchingMovementTransition.nextPoseMask[
            directionTransitionRootIndex
          ]
        : 0
    normalDebugWeights.CrouchingMovementFootLeftIncomingWeight =
      activeCrouchingMovementTransition
      && directionTransitionFootLeftIndex >= 0
        ? activeCrouchingMovementTransition.nextPoseMask[
            directionTransitionFootLeftIndex
          ]
        : 0
    for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      normalDebugWeights[`CrouchingMovementState.${direction}`] =
        crouchingMovementRuntime.stateWeights[direction]
    }
    const automaticRotateRuleBlocked =
      (
        crouchingStateRuntime.currentState === 'Rotate Left'
        && !rotateInPlaceState.rotatingLeft
        && crouchingRotateLeftTime
          >= (
            rotateInPlaceClips.Crouching.Left
              ?.sampler.clip.duration ?? Number.POSITIVE_INFINITY
          )
      )
      || (
        crouchingStateRuntime.currentState === 'Rotate Right'
        && !rotateInPlaceState.rotatingRight
        && crouchingRotateRightTime
          >= (
            rotateInPlaceClips.Crouching.Right
              ?.sampler.clip.duration ?? Number.POSITIVE_INFINITY
          )
      )
    normalDebugWeights.CrouchingAutomaticRuleBlocked =
      Number(automaticRotateRuleBlocked)
    normalDebugWeights.CrouchingStopQuickNotifyCount =
      stopQuickNotifyCount
    normalDebugWeights.CrouchingInertializationRequestCount =
      crouchingNode34.requestCount
    normalDebugWeights.CrouchingInertializationCorrectionMagnitude =
      measureInertializationCorrectionMagnitude(crouchingNode34)
    normalDebugWeights.CrouchingStrideBlendAmount =
      crouchingStrideBlendAmount
    normalDebugWeights.CrouchingPlayRate = crouchingState.playRate
    normalDebugWeights.CrouchingLeanRightAmount =
      leanState.rightAmount
    normalDebugWeights.CrouchingLeanForwardAmount =
      leanState.forwardAmount
    for (
      let index = 0;
      index < crouchingLeanBlendSpace.blendSpace.samples.length;
      index++
    ) {
      const clipName =
        crouchingLeanBlendSpace.blendSpace.samples[index].animation.name
      normalDebugWeights[`CrouchingLean.${clipName}`] =
        crouchingLeanWeights[index]
    }
    normalDebugWeights[FOOT_LEFT_LOCK_CURVE_NAME] = state.footLeftLock
    normalDebugWeights[FOOT_RIGHT_LOCK_CURVE_NAME] = state.footRightLock
    normalDebugWeights[HIPS_DIRECTION_LOCK_CURVE_NAME] =
      state.hipsDirectionLockAmount
    normalDebugWeights[FEET_CROSSING_CURVE_NAME] = state.feetCrossingAmount
    normalDebugWeights[ROTATION_YAW_SPEED_CURVE_NAME] = state.rotationYawSpeed
    normalDebugWeights[ALLOW_TRANSITIONS_CURVE_NAME] =
      finalCurves.get(ALLOW_TRANSITIONS_CURVE_NAME)
      ?? graphAllowTransitions
    normalDebugWeights.TurnInPlaceMontageWeight =
      turnInPlaceMontageWeight
    normalDebugWeights.TurnInPlaceMontageTime =
      activeTurnInPlaceSample?.montageTime ?? 0
    normalDebugWeights.TurnInPlaceSequenceTime =
      activeTurnInPlaceSample?.sampleTime ?? 0
    normalDebugWeights.TurnInPlaceMontageBlendingIn =
      Number(activeTurnInPlaceSample?.status === 'blendingIn')
    normalDebugWeights.TurnInPlaceMontagePlaying =
      Number(activeTurnInPlaceSample?.status === 'playing')
    normalDebugWeights.TurnInPlaceMontageBlendingOut =
      Number(activeTurnInPlaceSample?.status === 'blendingOut')
    normalDebugWeights.TurnInPlaceStandingSlotWeight =
      standingTurnInPlaceSlotWeight
    normalDebugWeights.TurnInPlaceCrouchingSlotWeight =
      crouchingTurnInPlaceSlotWeight
    const transitionSlotActive =
      turnInPlaceSample?.slotName === TRANSITION_SLOT_NAME
      && turnInPlaceSample.status !== 'completed'
    normalDebugWeights.TransitionMontageWeight =
      transitionSlotActive ? (turnInPlaceSample?.weight ?? 0) : 0
    normalDebugWeights.TransitionMontageTime =
      transitionSlotActive ? (turnInPlaceSample?.montageTime ?? 0) : 0
    normalDebugWeights.TransitionSequenceTime =
      transitionSlotActive ? (turnInPlaceSample?.sampleTime ?? 0) : 0
    for (const movementDirection of [
      'Forward',
      'Backward',
      'Left',
      'Right',
    ] as const) {
      normalDebugWeights[`MovementDirection.${movementDirection}`] =
        Number(state.movementDirection === movementDirection)
    }
    normalDebugWeights.GroundedDirectionTransitionIndex =
      state.directionTransitionRequest?.transitionIndex ?? -1
    normalDebugWeights.GroundedDirectionTransitionDuration =
      state.directionTransitionRequest?.duration ?? 0
    normalDebugWeights.GroundedDirectionTransitionActivatePivot =
      Number(state.directionTransitionRequest?.activatePivot ?? false)
    normalDebugWeights.GroundedDirectionTransitionPriority =
      state.directionTransitionRequest?.priorityOrder ?? 0
    normalDebugWeights.MoveDirectionChangeProfileApplied = 1
    normalDebugWeights.GroundedDirectionTransitionActive =
      Number(transitionClock.active)
    normalDebugWeights.GroundedDirectionTransitionLinearAlpha =
      transitionClock.linearAlpha
    normalDebugWeights.GroundedDirectionTransitionBlendAlpha =
      transitionClock.blendAlpha
    normalDebugWeights.GroundedDirectionTransitionFromWeight =
      transitionClock.fromStateWeight
    normalDebugWeights.GroundedDirectionTransitionToWeight =
      transitionClock.toStateWeight
    normalDebugWeights.GroundedDirectionTransitionRootIncomingWeight =
      directionTransitionRootIndex >= 0
        ? transitionClock.toPoseMask[directionTransitionRootIndex]
        : transitionClock.toStateWeight
    normalDebugWeights.GroundedDirectionTransitionFootLeftIncomingWeight =
      directionTransitionFootLeftIndex >= 0
        ? transitionClock.toPoseMask[directionTransitionFootLeftIndex]
        : transitionClock.toStateWeight
    normalDebugWeights.overlayModeRifle = rifleActive ? 1 : 0
    normalDebugWeights.inertializationCorrectionMagnitude =
      inertializationCorrectionMagnitude()
    normalDebugWeights.inertializationRequestCount =
      inertializationRequestCount()
    normalDebugWeights.groundedInertializationRequestCount =
      groundedInertialization.inertialization.requestCount
    normalDebugWeights.overlayInertializationRequestCount =
      overlayInertialization.inertialization.requestCount
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
    if (
      groundedStanceTransitionSource
      && !groundedStanceTransitionState.active
    ) {
      groundedStanceTransitionSource = null
    }
    processQueuedTransitionAndTurnInPlaceAnimations()
    return state.rotationYawSpeed
  }

  return { playClip, clearSoloClip, setHipsDirection, state, refresh }
}

/** ALS `RefreshVelocityBlend`; re-exported here so the refresh family lives with its class analog. */
export const refreshVelocityBlend = stepVelocityBlend

/** ALS `RefreshTurnInPlace`; pure state implementation lives at its mirrored State path. */
export const refreshTurnInPlace = refreshTurnInPlaceState

/** ALS `RefreshRotateInPlace`; pure state implementation lives at its mirrored State path. */
export const refreshRotateInPlace = refreshRotateInPlaceState

/**
 * ALS `GetRelativeAccelerationAmount` (AlsAnimationInstance.cpp:713-733).
 *
 * Linear inputs may use any consistent unit. The clamp deliberately includes local Z before the
 * returned animation state discards it; clamping only XY overstates planar lean while airborne.
 */
export function getRelativeAccelerationAmount(input: {
  readonly actorYaw: number
  readonly acceleration: Readonly<Velocity3>
  readonly velocity: Readonly<Velocity3>
  readonly maxAcceleration: number
  readonly maxBrakingDeceleration: number
}): { x: number; y: number } {
  const dot =
    input.acceleration.x * input.velocity.x
    + input.acceleration.y * input.velocity.y
    + input.acceleration.z * input.velocity.z
  const maximum = dot >= 0
    ? input.maxAcceleration
    : input.maxBrakingDeceleration
  // UE_KINDA_SMALL_NUMBER, Runtime/Core/Public/Math/UnrealMathUtility.h.
  if (maximum <= 1e-4) return { x: 0, y: 0 }

  const cosine = Math.cos(input.actorYaw)
  const sine = Math.sin(input.actorYaw)
  let x =
    input.acceleration.x * cosine
    + input.acceleration.y * sine
  let y =
    -input.acceleration.x * sine
    + input.acceleration.y * cosine
  const z = input.acceleration.z
  const scaledLength = Math.hypot(x, y, z) / maximum
  if (scaledLength > 1) {
    x /= scaledLength
    y /= scaledLength
  }
  return { x: x / maximum, y: y / maximum }
}

/** ALS `RefreshPose` exact curve pass-through and gait ramps (cpp:313-351). */
export function refreshPose(
  curves: ReadonlyMap<string, number>,
  out: AlsPoseState = createAlsPoseState(),
): AlsPoseState {
  const getCurveValue = (name: string) => curves.get(name) ?? 0
  out.groundedAmount = getCurveValue(POSE_GROUNDED_CURVE_NAME)
  out.inAirAmount = getCurveValue(POSE_IN_AIR_CURVE_NAME)
  out.standingAmount = getCurveValue(POSE_STANDING_CURVE_NAME)
  out.crouchingAmount = getCurveValue(POSE_CROUCHING_CURVE_NAME)
  out.movingAmount = getCurveValue(POSE_MOVING_CURVE_NAME)

  const clamped = Math.max(
    0,
    Math.min(3, getCurveValue(POSE_GAIT_CURVE_NAME)),
  )
  out.amount = clamped
  out.walking = Math.max(0, Math.min(1, clamped))
  out.running = Math.max(0, Math.min(1, clamped - 1))
  out.sprinting = Math.max(0, Math.min(1, clamped - 2))
  // UE_SMALL_NUMBER, not KINDA_SMALL_NUMBER: the two thresholds differ by four orders.
  out.unweightedAmount =
    out.groundedAmount > 1e-8
      ? out.amount / out.groundedAmount
      : out.amount
  out.unweightedWalking = Math.max(0, Math.min(1, out.unweightedAmount))
  out.unweightedRunning = Math.max(
    0,
    Math.min(1, out.unweightedAmount - 1),
  )
  out.unweightedSprinting = Math.max(
    0,
    Math.min(1, out.unweightedAmount - 2),
  )
  return out
}
