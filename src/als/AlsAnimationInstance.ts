import { createConsumerLocomotionStates, type ConsumerLocomotionStates } from './AnimGraph/consumerLocomotionStates'
import { inspectPoseFinite } from '../engine/poseDiagnostics'
import { createConsumerUpperBodySlot } from './AnimGraph/consumerUpperBodySlot'
import { createConsumerOverlayStates, type ConsumerOverlayStates } from './AnimGraph/consumerOverlayStates'
import { ALS_GETTING_UP_MONTAGES, createAlsGettingUpSlotMontageRequest, type AlsGettingUpMontage } from './AnimGraph/gettingUp'
import { createAlsRagdollPose, type AlsRagdollPose } from '../engine/alsRagdollPose'
import { PISTOL_OVERLAY_MODES, isPistolOverlayMode } from './AnimGraph/overlayMode'
import {
  createAlsPistolRuntime, evaluateAlsPistolGraph, refreshAlsPistolRuntime,
  resetAlsPistolRuntime, type AlsPistolFullSources,
} from './AnimGraph/AB_Als_PistolTwoHanded'
import { createAlsPistolOneHandedRuntime, evaluateAlsPistolOneHandedGraph } from './AnimGraph/AB_Als_PistolOneHanded'
import { assertAlsAnimationExtras } from './reference/animationExtrasSequences'
import * as THREE from 'three'
import type { AlphaBlendOption } from '../engine/alphaBlend'
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
import {
  getStateMachineStateWeight,
} from '../engine/stateMachineTransitionStack'
import type {
  EvaluatePoseInput,
  EvaluatorAuthoredAdditiveEntry,
  EvaluatorLayerEntry,
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
  type LocalPoseBuffer,
  createPoseBuffer,
  resetPoseToAdditiveIdentity,
} from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import {
  accumulateRootMotion,
  clearRootMotionMovementParams,
  compileAuthoredRootMotion,
  createRootMotionExtractor,
  createRootMotionMovementParams,
  resetRootMotionExtractor,
} from '../engine/rootMotion'
import type {
  CompiledAuthoredRootMotion,
  RootMotionExtractor,
  RootMotionMovementParams,
} from '../engine/rootMotion'
import {
  accumulateSlotMontageRootMotion,
} from '../engine/slotMontageRootMotion'
import {
  advanceSlotMontageClock,
  canGatherSlotMontageSequenceNotifies,
  calculateSlotMontageWeight,
  createSlotMontageClock,
  getSlotMontageSamples,
  getSlotMontageEvaluationWeight,
  montageSetPosition as setSlotMontagePosition,
  playSlotAnimationAsDynamicMontage,
  playSlotMontage,
  stopSlotAnimation,
} from '../engine/slotMontage'
import {
  compileSequenceNotifies,
  gatherSequenceNotifiesFromDeltaPositions,
} from '../engine/sequenceNotifies'
import type {
  CompiledSequenceNotifies,
  CompiledSequenceNotify,
} from '../engine/sequenceNotifies'
import type {
  SlotMontageNotifyEvent,
  SlotMontageSample,
} from '../engine/slotMontage'
import {
  advanceSyncGroup,
  createSyncGroup,
} from '../engine/syncGroups'
import { BlendSpacePlayer } from '../engine/blendSpacePlayer'
import type {
  BlendSpacePlayerResult,
  BlendSpacePlayerSample,
} from '../engine/blendSpacePlayer'
import type {
  SyncMarker,
  SyncGroupMember,
  SyncMarkerTable,
} from '../engine/syncGroups'
import {
  blendPoseNodesTogether,
  blendTwoCurvesTogether,
  blendTwoPoseNodesTogether,
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
import {
  ALS_HIPS_DIRECTIONS,
  ALS_GROUNDED_DIRECTION_PLAYER,
  createGroundedLocomotionGraph,
  readGroundedLocomotionGraph,
  refreshMovementDirection,
  refreshStandingMovement,
  updateGroundedLocomotionGraphFromStateWeights,
} from './AnimGraph/groundedLocomotion'
import type {
  AlsGroundedDirectionTransition,
  AlsHipsDirection,
  AlsMovementDirection,
  AlsStandingMovementState,
} from './AnimGraph/groundedLocomotion'
import {
  ALS_ACCELERATION_PLAYERS,
  ALS_ACCELERATION_PLAYER_OPTIONS,
  ALS_STOP_POSE_EVALUATORS,
  ALS_STOP_POSE_EVALUATOR_OPTIONS,
  ALS_STOP_TRANSITION_ANIMATIONS,
} from './AnimGraph/groundedStates'
import {
  ALS_ROLLING_MONTAGE,
  ALS_ROLL_SEQUENCE,
} from './AnimGraph/rolling'
import {
  ALS_QUICK_STOP_SETTINGS,
  playQuickStopAnimation as resolveQuickStopAnimation,
} from './AnimGraph/quickStop'
import type {
  AlsGroundedEntryMode as AlsGroundedEntryModeGameplayTag,
} from './Notifies/AlsAnimNotify_SetGroundedEntryMode'
import {
  ALS_GROUNDED_ROLL_STATE,
  createAlsGroundedRollGraphRuntime,
  refreshAlsGroundedRollGraph,
} from './AnimGraph/AB_Als_Grounded'
import {
  createAlsStandingGraphRuntime,
  createAlsStandingPoseGraphRuntime,
  evaluateAlsStandingPoseGraph,
  refreshAlsStandingGraphRuntime,
} from './AnimGraph/AB_Als_Standing'
import type {
  AlsStandingLifecycleEvent,
  AlsStopPoseInputs,
} from './AnimGraph/AB_Als_Standing'
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
  ALS_RIFLE_GRAPH,
  ALS_RIFLE_RELAXED_GRAPH,
  createAlsRifleRuntime,
  evaluateAlsRifleGraph,
  refreshAlsRifleRuntime,
  resetAlsRifleRuntime,
  type AlsRifleFullInput,
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
  ALS_AIR_LEAN_ADDITIVE_SETTINGS,
  ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS,
  ALS_LOCOMOTION_INTERNAL_BLEND_METADATA,
  ALS_LOCOMOTION_PLAYER_METADATA,
  ALS_LOCOMOTION_POSE_STATE_ORDER,
  createAlsLocomotionPoseGraphRuntime,
  evaluateUpdatedAlsLocomotionPoseGraph,
  getAlsLocomotionStateWeight,
  resolveAlsLocomotionTransition,
  updateAlsLocomotionPoseGraph,
} from './AnimGraph/AB_Als_Locomotion'
import type {
  AlsLocomotionPoseGraphInput,
  AlsLocomotionPoseState,
  AlsLocomotionSampledPoses,
} from './AnimGraph/AB_Als_Locomotion'
import {
  ALS_VIEW_POSE_CLIP_NAMES,
  createAlsViewPoseRuntime,
  evaluateAlsViewPoseRuntime,
  isAlsViewPoseBecomingRelevant,
  isAlsViewPoseRelevant,
  refreshAlsViewPoseRuntime,
} from './AnimGraph/AB_Als_View'
import type {
  AlsLocomotionAction,
  AlsLocomotionMode,
  AlsViewMode,
} from './AlsCharacter'
import {
  refreshAlsJumpStateClock,
  sampleAlsLandGraph,
} from './AnimGraph/inAir'
import {
  composeAlsLayeringFinalCurves,
  createAlsLayeringPoseRuntime,
  evaluateAlsLayeringPose,
  resolveAlsLayeringState,
} from './AnimGraph/AlsLayering'
import type { AlsLayeringState } from './AnimGraph/AlsLayering'
import {
  ALS_CONTROL_RIG_FOOT_IK,
  ALS_CONTROL_RIG_FORWARD_SOLVE,
  ALS_CONTROL_RIG_HAND_IK,
  createAlsControlRigForwardSolveRuntime,
  evaluateAlsControlRigForwardSolve,
} from './AnimGraph/CR_Als'
import type {
  AlsControlRigFootOffsetTrace,
  AlsControlRigInputState,
} from './AnimGraph/CR_Als'
import type { WeightTable } from './AnimGraph/weightTable'
import { ALS_GENERAL_ANIMATION_SETTINGS } from './Settings/AlsGeneralAnimationSettings'
import { ALS_CHARACTER_SETTINGS } from './Settings/AlsCharacterSettings'
import {
  sampleRotationYawOffsets,
} from './Settings/AlsGroundedSettings'
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from './Settings/AlsMovementSettings'
import type {
  AlsMantlingMontageNotify,
  AlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from './Settings/AlsTurnInPlaceSettings'
import {
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS,
  notifyAlsAnimNotifyCameraShake,
} from './AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import type {
  AlsAnimNotifyCameraShakeEvent,
  AlsPlayerCameraManager,
} from './AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import {
  ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS,
} from './Notifies/AlsAnimNotify_FootstepEffects'
import type {
  AlsAnimNotifyFootstepEffectsEvent,
} from './Notifies/AlsAnimNotify_FootstepEffects'
import {
  createVelocityBlend,
  stepVelocityBlend,
} from './State/AlsGroundedState'
import type { Velocity3 } from './State/AlsGroundedState'
import { unwindDegrees } from './State/AlsLocomotionState'
import {
  ALS_NO_BASED_MOVEMENT,
  createAlsMovementBaseState,
  refreshMovementBaseOnGameThread,
} from './State/AlsMovementBaseState'
import type {
  AlsBasedMovement,
  AlsMovementBaseState,
} from './State/AlsMovementBaseState'
import {
  ALS_DEFAULT_FOOT_LOCK_ANGLE_LIMIT,
  createAlsFeetState,
} from './State/AlsFeetState'
import type { AlsFeetState } from './State/AlsFeetState'
import {
  createAlsSpineState,
  refreshSpine,
} from './State/AlsSpineState'
import type { AlsSpineState } from './State/AlsSpineState'
import {
  createAlsViewAnimationState,
  refreshView as refreshViewAnimationState,
} from './State/AlsViewAnimationState'
import type {
  AlsViewAnimationState,
} from './State/AlsViewAnimationState'
import {
  createAlsLookState,
  refreshLook,
} from './State/AlsLookState'
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
  refreshInAirLean,
} from './State/AlsLeanState'
import {
  createAlsInAirState,
  jump as requestAlsAnimationJump,
  refreshGroundPrediction,
  refreshInAir,
  refreshInAirOnGameThread,
} from './State/AlsInAirState'
import type {
  AlsGroundPredictionCapsuleSweep,
} from './State/AlsInAirState'
import {
  sampleGroundPredictionAmount,
  sampleInAirLeanAmount,
} from './Settings/AlsInAirSettings'
import {
  createAlsRotateInPlaceState,
  refreshRotateInPlace as refreshRotateInPlaceState,
  resetRotateInPlaceFrame,
} from './State/AlsRotateInPlaceState'
import {
  createAlsTransitionsState,
  queueTransitionAnimation,
  queueStopTransitionAndTurnInPlaceAnimations,
  refreshTransitions,
  takeQueuedTransitionAnimation,
  takeQueuedTransitionStop,
} from './State/AlsTransitionsState'
import type { AlsTransitionsState } from './State/AlsTransitionsState'
import {
  createAlsDynamicTransitionsState,
  refreshDynamicTransitions,
  resetDynamicTransitionsFrame,
} from './State/AlsDynamicTransitionsState'
import type {
  AlsDynamicTransitionsState,
} from './State/AlsDynamicTransitionsState'
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
  LOCOMOTION_SLOT_GROUP_NAME,
  POST_LOCOMOTION_SLOT_NAME,
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
import {
  createAlsFeetPoseBridge,
  initializeAlsFeetThighAxesFromRig,
} from '../engine/alsFeetPoseBridge'
import type {
  AlsFeetComponentTargets,
} from '../engine/alsFeetPoseBridge'

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

const OVERLAY_MODE_INERTIALIZATION_DURATION = 0.2
const SOLO_INERTIALIZATION_DURATION = 0.2
const IDLE_ADDITIVE_WEIGHT = 0.75
const STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION = 0.2
const FOOT_PLANTED_CURVE_NAME = 'FootPlanted'
const FOOT_LEFT_IK_CURVE_NAME = 'FootLeftIk'
const FOOT_RIGHT_IK_CURVE_NAME = 'FootRightIk'
const GROUND_PREDICTION_BLOCK_CURVE_NAME = 'GroundPredictionBlock'
const VIEW_BLOCK_CURVE_NAME = 'ViewBlock'
const ALLOW_AIMING_CURVE_NAME = 'AllowAiming'
const CONTROL_RIG_DEBUG_COMPONENT_LANDMARKS = [
  'root',
  'pelvis',
  'head',
  'foot_l',
  'foot_r',
] as const
const CONTROL_RIG_DEBUG_COMPONENT_AXES = ['X', 'Y', 'Z'] as const
type ControlRigDebugComponentStage = 'Pre' | 'Post'

function controlRigDebugComponentPositionWeightName(
  stage: ControlRigDebugComponentStage,
  boneName: typeof CONTROL_RIG_DEBUG_COMPONENT_LANDMARKS[number],
  axis: typeof CONTROL_RIG_DEBUG_COMPONENT_AXES[number],
) {
  return `ControlRig${stage}ComponentPosition.${boneName}.${axis}`
}

const NO_CONTROL_RIG_FOOT_TRACE: AlsControlRigFootOffsetTrace = () => null

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

const TRANSITION_DIAGNOSTIC_CLIPS = {
  StandingLeft: ALS_QUICK_STOP_SETTINGS.sequences.Standing.Left,
  StandingRight: ALS_QUICK_STOP_SETTINGS.sequences.Standing.Right,
  CrouchingLeft: ALS_QUICK_STOP_SETTINGS.sequences.Crouching.Left,
  CrouchingRight: ALS_QUICK_STOP_SETTINGS.sequences.Crouching.Right,
  StopLeft: ALS_STOP_TRANSITION_ANIMATIONS.Left.clip,
  StopRight: ALS_STOP_TRANSITION_ANIMATIONS.Right.clip,
} as const

interface RuntimeClip {
  readonly sampler: CompiledClipSampler
  readonly curves?: ClipCurveSamplers
  readonly rootMotion?: CompiledAuthoredRootMotion
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

interface RuntimeSlotMontageBinding {
  readonly instanceId: number
  readonly clip: RuntimeClip
  readonly entry: EvaluatorLayerEntry
  readonly authoredAdditiveEntry?: EvaluatorAuthoredAdditiveEntry
  readonly pose: MutableUePoseNode
  sample: SlotMontageSample
}

interface RuntimeMantlingMontageInstance {
  readonly settings: AlsMantlingSettings
  readonly sample: SlotMontageSample
  readonly activeNotifyIndices: Set<number>
  interrupted: boolean
}

interface RuntimeRollingMontageInstance {
  readonly sample: SlotMontageSample
  readonly activeNotifyIndices: Set<number>
  rootMotionScaleActive: boolean
  interrupted: boolean
}

interface RuntimeLocomotionSequencePlayer {
  readonly key: keyof typeof ALS_LOCOMOTION_PLAYER_METADATA
  readonly clip: RuntimeClip | undefined
  readonly node: MutableUePoseNode
  readonly group: 'Fall' | 'Jump' | 'Flail' | 'Land' | null
  readonly loop: boolean
  readonly startPosition: number
  playRate: number
  time: number
  weight: number
}

interface RuntimeLocomotionSyncGroup {
  readonly members: RuntimeLocomotionSequencePlayer[]
  leaderKey: RuntimeLocomotionSequencePlayer['key'] | null
}

interface RuntimeCameraShakeNotifyTrack {
  readonly track: CompiledSequenceNotifies
  readonly payloadByNotify:
    ReadonlyMap<CompiledSequenceNotify, AlsAnimNotifyCameraShakeEvent>
}

interface RuntimeFootstepEffectsNotifyTrack {
  readonly track: CompiledSequenceNotifies
  readonly payloadByNotify: ReadonlyMap<
    CompiledSequenceNotify,
    AlsAnimNotifyFootstepEffectsEvent
  >
}

export interface AlsAnimationInstanceControls {
  gait: AlsGait
  moving: boolean
  /** FAlsLocomotionAnimationState::bMovingSmooth, distinct from bMoving. */
  movingSmooth: boolean
  stance: AlsStance
  rotationMode: AlsRotationMode
  viewMode?: AlsViewMode
  viewPitchAngle?: number
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
  locomotionYawSpeed?: number
  inputYawAngle?: number
  targetYawAngle?: number
  /** AAlsCharacter::LocomotionMode, supplied by the live character bridge. */
  locomotionMode?: AlsLocomotionMode
  /**
   * AAlsCharacter::LocomotionAction. NativeUpdateAnimation resets
   * GroundedEntryMode whenever this tag changes.
   */
  locomotionAction?: AlsLocomotionAction
  /** FAlsLocomotionState::bHasInput. Live frames always provide this exact value. */
  hasInput?: boolean
  /** FAlsLocomotionState::Location in metres and ALS coordinates. */
  location?: Readonly<Velocity3>
  /** Current AAlsCharacter actor yaw in degrees. */
  actorYawAngle?: number
  /** Current CharacterMovement supporting primitive snapshot. */
  basedMovement?: Readonly<AlsBasedMovement>
  /** FAlsLocomotionState::Velocity in metres per second and ALS coordinates. */
  velocity?: Readonly<Velocity3>
  /** Scaled capsule dimensions used by RefreshGroundPrediction(). */
  capsuleRadius?: number
  capsuleHalfHeight?: number
  walkableFloorAngleCos?: number
}

/** UAlsAnimationInstance rotation-in-place predicate. */
export function isRotateInPlaceAllowed(
  rotationMode: AlsRotationMode,
  viewMode: AlsViewMode,
) {
  return rotationMode === 'Aiming' || viewMode === 'FirstPerson'
}

/** UAlsAnimationInstance turn-in-place predicate. */
export function isTurnInPlaceAllowed(
  rotationMode: AlsRotationMode,
  viewMode: AlsViewMode,
) {
  return rotationMode === 'ViewDirection' && viewMode !== 'FirstPerson'
}

export interface AlsAnimationInstanceState {
  readonly layering: AlsLayeringState
  readonly movementBase: AlsMovementBaseState
  readonly feet: AlsFeetState
  readonly view: AlsViewAnimationState
  readonly spine: AlsSpineState
  readonly transitions: AlsTransitionsState
  readonly dynamicTransitions: AlsDynamicTransitionsState
  crouchingAmount: number
  feetCrossingAmount: number
  footLeftLock: number
  footRightLock: number
  hipsDirectionLockAmount: number
  movementDirection: AlsMovementDirection
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

export interface AlsMantlingMontagePlayResult {
  /** FAnimMontageInstance::InstanceID. Zero is a valid first retained instance. */
  readonly instanceId: number
  /** Montage_Play()'s successful MontageLength return value at the default play rate. */
  readonly duration: number
}

export interface AlsMantlingMontageNotifyEvent {
  readonly instanceId: number
  readonly mantlingSettings: AlsMantlingSettings
  readonly notify: AlsMantlingMontageNotify
  readonly notifyEventType: 'Begin' | 'End'
  /** Montage position that dispatched this marker, active-state update, or termination teardown. */
  readonly triggerTime: number
}

export type AlsRollingMontageNotifyEvent =
  | {
      readonly instanceId: number
      readonly montage: 'AM_Als_Roll'
      readonly sequence: 'A_Als_Roll'
      readonly notifyClass:
        'AlsAnimNotifyState_SetLocomotionAction'
      readonly notifyEventType: 'Begin' | 'End'
      readonly triggerTime: number
      readonly LocomotionAction: 'Rolling'
    }
  | {
      readonly instanceId: number
      readonly montage: 'AM_Als_Roll'
      readonly sequence: 'A_Als_Roll'
      readonly notifyClass:
        'AlsAnimNotifyState_SetRootMotionScale'
      readonly notifyEventType: 'Begin' | 'End'
      readonly triggerTime: number
      readonly TranslationScale: number
    }
  | {
      readonly instanceId: number
      readonly montage: 'AM_Als_Roll'
      readonly sequence: 'A_Als_Roll'
      readonly notifyClass: 'AlsAnimNotify_SetGroundedEntryMode'
      readonly notifyEventType: 'Notify'
      readonly triggerTime: number
      readonly GroundedEntryMode:
        'Als.GroundedEntryMode.FromRoll'
    }

/**
 * Character-facing `UAnimInstance` Roll seam.
 *
 * `Montage_Play()` only starts the retained authored montage. Character policy
 * installs Rolling after the positive return value, and the montage's native
 * branching-point state owns the eventual exit.
 */
export interface AlsRollingMontageBridge {
  readonly Montage_IsPlaying: (Montage: string) => boolean
  /** `ACharacter::IsPlayingRootMotion()` for the retained montage owner. */
  readonly IsPlayingRootMotion: () => boolean
  readonly Montage_Play: (
    Montage: string,
    PlayRate: number,
  ) => number
  readonly takeNotifyEvents:
    () => readonly AlsRollingMontageNotifyEvent[]
  /**
   * Full-consumption web analog of
   * `UAnimInstance::ConsumeExtractedRootMotion(1.0f)`.
   *
   * The result is unscaled montage root motion. ACharacter applies its
   * notify-owned AnimRootMotionTranslationScale to translation afterward.
   * A second call before another animation refresh returns invalid identity.
   */
  readonly ConsumeExtractedRootMotion: (
    Out?: RootMotionMovementParams,
  ) => RootMotionMovementParams
}

/**
 * Character-facing UAnimInstance mantle seam.
 *
 * Character movement owns FAlsRootMotionSource_Mantling's authoritative time. It sets
 * `M - DeltaTime` before the animation update; this retained montage clock then advances once
 * using the authored UAnimMontage::RateScale, exactly like FMontageSubStepper.
 */
export interface AlsMantlingMontageBridge {
  readonly play: (
    settings: AlsMantlingSettings,
    startTime: number,
  ) => AlsMantlingMontagePlayResult | null
  readonly montageSetPosition: (
    settings: AlsMantlingSettings,
    position: number,
  ) => boolean
  /** Asset-addressed UAnimInstance::Montage_Stop(). */
  readonly montageStop: (
    settings: AlsMantlingSettings,
    blendOutDuration: number,
  ) => boolean
  /**
   * Identity-addressed FAnimMontageInstance::Stop(), used by
   * UAlsAnimNotifyState_EarlyBlendOut's MontageInstanceID payload.
   */
  readonly stopMontageInstance: (
    instanceId: number,
    blendOutDuration: number,
  ) => boolean
  /** Drains branching-point events produced by the most recent animation advances. */
  readonly takeNotifyEvents: () => readonly AlsMantlingMontageNotifyEvent[]
}

export interface AlsGetUpMontageNotifyEvent {
  readonly notifyEventType: 'Begin' | 'End'
  readonly LocomotionAction: 'GettingUp'
}
export interface AlsGetUpMontageBridge {
  Montage_Play(Montage: string): number
  takeNotifyEvents(): readonly AlsGetUpMontageNotifyEvent[]
}
export interface AlsAnimationInstance {
  /** Borrowed diagnostic buffers, valid until the next refresh. Do not mutate. */
  inspectPose(stage: 'overlay' | 'locomotion' | 'final'): {
    boneNames: readonly string[]
    pose: LocalPoseBuffer
    curves: ReadonlyMap<string, number>
  }
  readonly getUpMontage: AlsGetUpMontageBridge
  readonly ragdolling: AlsRagdollPose
  StopMontages: (blendOutDuration: number) => void
  /** Read-only action presentation clocks for snapshot recording. */
  getRollingSnapshot: () => { position: number; playRate: number } | undefined
  setRollingPosition: (position: number) => void
  /** Read-only mantle presentation clock for snapshot recording. */
  getMantlingSnapshot: () => { settings: string; position: number } | undefined
  playClip: (name: string | null) => boolean
  clearSoloClip: () => void
  /**
   * Exact analog of SetHipsDirection(), called by ALS's authored Movement States graph.
   * Public for parity tests; normal live updates come from the recovered transition delegates.
   */
  setHipsDirection: (hipsDirection: AlsHipsDirection) => void
  /** Exact UAlsAnimationInstance::SetGroundedEntryMode() notify target. */
  SetGroundedEntryMode: (
    NewGroundedEntryMode: AlsGroundedEntryModeGameplayTag,
  ) => void
  /** Exact UAlsAnimationInstance::Jump() request latch. */
  jump: () => void
  /** USkeletalMeshComponent::GetAnimInstance()->GetCurveValue() on the published graph frame. */
  getCurveValue: (name: string) => number
  /**
   * UAnimInstance queued-notify dispatch seam.
   *
   * Refresh only gathers events. The frame pipeline calls this after pose publication and before
   * the camera tick so animation evaluation never reaches into camera or React state.
   */
  dispatchQueuedAnimEvents: (sink: AlsPlayerCameraManager) => number
  /**
   * Queued `UAlsAnimNotify_FootstepEffects` payload dispatch.
   *
   * The hook invokes this after the final pose is published so the notify policy traces from the
   * post-Control-Rig foot transform, matching `USkeletalMeshComponent::GetSocketTransform()`.
   */
  dispatchQueuedFootstepEffectsEvents: (
    sink: (
      event: Readonly<AlsAnimNotifyFootstepEffectsEvent>,
    ) => void,
  ) => number
  readonly mantlingMontage: AlsMantlingMontageBridge
  readonly rollingMontage: AlsRollingMontageBridge
  readonly state: AlsAnimationInstanceState
  refresh: (
    delta: number,
    controls: AlsAnimationInstanceControls,
    captureControlRigComponentPositions?: boolean,
  ) => void
}

function createEntry(
  sampler: CompiledClipSampler,
  curves?: ClipCurveSamplers,
  rootMotion?: CompiledAuthoredRootMotion,
): EvaluatorLayerEntry {
  return {
    sampler,
    rootMotion,
    time: 0,
    weight: 0,
    loop: true,
    curves,
  }
}

function advanceClip(clip: RuntimeClip, delta: number) {
  const duration = clip.sampler.clip.duration
  clip.time = duration > 0 ? (clip.time + delta) % duration : 0
  clip.entry.time = clip.time
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function hasCompleteAlsControlRig(
  boneNames: ReadonlySet<string>,
): boolean {
  const forwardSolve = ALS_CONTROL_RIG_FORWARD_SOLVE
  return (
    boneNames.has(
      forwardSolve.diagonalScaling.footRootBoneWhenUsingFootIkBones,
    )
    && boneNames.has(
      forwardSolve.diagonalScaling.footRootBoneOtherwise,
    )
    && forwardSolve.spineRotationBones.every((name) => boneNames.has(name))
    && ALS_CONTROL_RIG_FOOT_IK.feet.every((definition) => (
      boneNames.has(definition.pelvisItem)
      && boneNames.has(definition.thighItem)
      && boneNames.has(definition.calfItem)
      && boneNames.has(definition.footItem)
    ))
    && ALS_CONTROL_RIG_HAND_IK.every((definition) => (
      boneNames.has(definition.itemA)
      && boneNames.has(definition.itemB)
      && boneNames.has(definition.effectorItem)
      && boneNames.has(definition.targetWhenUsingHandIkBones)
      && boneNames.has(definition.targetOtherwise)
      && boneNames.has(definition.poleVectorSpace)
    ))
    && boneNames.has('ik_foot_l')
    && boneNames.has('ik_foot_r')
  )
}

export function shouldMarkAlsTeleported(input: {
  readonly pendingUpdate: boolean
  readonly previousLocation: Readonly<Velocity3>
  readonly location: Readonly<Velocity3>
  readonly threshold?: number
}): boolean {
  if (input.pendingUpdate) return false
  const deltaX = input.location.x - input.previousLocation.x
  const deltaY = input.location.y - input.previousLocation.y
  const deltaZ = input.location.z - input.previousLocation.z
  const threshold =
    input.threshold ?? ALS_CHARACTER_SETTINGS.teleportDistanceThreshold
  return (
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
    > threshold * threshold
  )
}

/** Exact `UAlsAnimationInstance::GetControlRigInput()` field mapping. */
export function getAlsControlRigInput(input: {
  readonly locomotionMode: AlsLocomotionMode
  readonly velocityBlendForwardAmount: number
  readonly velocityBlendBackwardAmount: number
  readonly feetTargets: AlsFeetComponentTargets
  readonly spineYawAngle: number
}): AlsControlRigInputState {
  return {
    bUseHandIkBones: ALS_GENERAL_ANIMATION_SETTINGS.useHandIkBones,
    bUseFootIkBones: ALS_GENERAL_ANIMATION_SETTINGS.useFootIkBones,
    bFootOffsetAllowed: input.locomotionMode !== 'InAir',
    velocityBlendForwardAmount: input.velocityBlendForwardAmount,
    velocityBlendBackwardAmount: input.velocityBlendBackwardAmount,
    footLeftLocation: input.feetTargets.left.position,
    footLeftRotation: input.feetTargets.left.rotation,
    footRightLocation: input.feetTargets.right.position,
    footRightRotation: input.feetTargets.right.rotation,
    spineYawAngle: input.spineYawAngle,
  }
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
  graphs: readonly {
    readonly weight: number
    readonly curves: ReadonlyMap<string, number>
  }[] = [],
) {
  let totalWeight = 0
  for (const entry of entries) {
    if (entry.weight > 0) totalWeight += entry.weight
  }
  for (const graph of graphs) {
    totalWeight += Math.max(0, graph.weight)
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
  for (const graph of graphs) {
    if (graph.weight <= 0) continue
    const normalizedWeight = graph.weight / totalWeight
    for (const [name, value] of graph.curves) {
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

function compileCameraShakeNotifyTracks(
  animations: readonly THREE.AnimationClip[],
) {
  const eventsBySequence = new Map<
    string,
    AlsAnimNotifyCameraShakeEvent[]
  >()
  for (const event of ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS) {
    const events = eventsBySequence.get(event.Sequence)
    if (events) events.push(event)
    else eventsBySequence.set(event.Sequence, [event])
  }

  const tracks = new Map<string, RuntimeCameraShakeNotifyTrack>()
  for (const [sequenceName, events] of eventsBySequence) {
    const animation = animations.find(({ name }) => name === sequenceName)
    if (!animation) continue
    const track = compileSequenceNotifies(
      animation,
      events.map((event) => ({
        name: event.NotifyName,
        time: event.Time,
        triggerWeightThreshold: event.TriggerWeightThreshold,
        notifyTriggerChance: event.NotifyTriggerChance,
        triggerOnFollower: event.bTriggerOnFollower,
        triggerOnDedicatedServer: event.bTriggerOnDedicatedServer,
      })),
    )
    const payloadByNotify = new Map<
      CompiledSequenceNotify,
      AlsAnimNotifyCameraShakeEvent
    >()
    for (const event of events) {
      const notify = track.notifies.find((candidate) => (
        candidate.NotifyName === event.NotifyName
        && Math.abs(candidate.Time - event.Time) <= 1e-6
      ))
      if (!notify) {
        throw new Error(
          `${sequenceName} is missing authored ${event.NotifyName} at ${event.Time}`,
        )
      }
      payloadByNotify.set(notify, event)
    }
    tracks.set(sequenceName, { track, payloadByNotify })
  }
  return tracks
}

function compileFootstepEffectsNotifyTracks(
  animations: readonly THREE.AnimationClip[],
) {
  const eventsBySequence = new Map<
    string,
    AlsAnimNotifyFootstepEffectsEvent[]
  >()
  for (const event of ALS_ANIM_NOTIFY_FOOTSTEP_EFFECTS_EVENTS) {
    const events = eventsBySequence.get(event.Sequence)
    if (events) events.push(event)
    else eventsBySequence.set(event.Sequence, [event])
  }

  const tracks = new Map<string, RuntimeFootstepEffectsNotifyTrack>()
  for (const [sequenceName, events] of eventsBySequence) {
    const animation = animations.find(({ name }) => name === sequenceName)
    if (!animation) continue
    const track = compileSequenceNotifies(
      animation,
      events.map((event) => ({
        notifyIndex: event.EventIndex,
        name: event.NotifyName,
        time: event.Time,
        triggerWeightThreshold: event.TriggerWeightThreshold,
        notifyTriggerChance: event.NotifyTriggerChance,
        triggerOnFollower: event.bTriggerOnFollower,
        triggerOnDedicatedServer: event.bTriggerOnDedicatedServer,
      })),
    )
    const payloadByNotify = new Map<
      CompiledSequenceNotify,
      AlsAnimNotifyFootstepEffectsEvent
    >()
    for (const event of events) {
      const notify = track.notifies[event.EventIndex]
      if (
        !notify
        || notify.NotifyName !== event.NotifyName
        || Math.abs(notify.Time - event.Time) > 1e-6
      ) {
        throw new Error(
          `${sequenceName} notify ${event.EventIndex} is not authored `
          + `${event.NotifyName} at ${event.Time}`,
        )
      }
      payloadByNotify.set(notify, event)
    }
    tracks.set(sequenceName, { track, payloadByNotify })
  }
  return tracks
}

function compileRollSequenceNotifyTrack(
  animation: THREE.AnimationClip | undefined,
) {
  if (!animation) return undefined
  const rootMotionScale = ALS_ROLL_SEQUENCE.RootMotionScaleNotify
  const groundedEntry = ALS_ROLL_SEQUENCE.GroundedEntryModeNotify
  const track = compileSequenceNotifies(animation, [
    {
      name: rootMotionScale.NotifyName,
      time: rootMotionScale.StartTime,
      triggerTimeOffset: rootMotionScale.TriggerTimeOffset,
      endTriggerTimeOffset: rootMotionScale.EndTriggerTimeOffset,
      triggerWeightThreshold:
        rootMotionScale.TriggerWeightThreshold,
    },
    {
      name: groundedEntry.NotifyName,
      time: groundedEntry.Time,
      triggerTimeOffset: groundedEntry.TriggerTimeOffset,
      triggerWeightThreshold:
        groundedEntry.TriggerWeightThreshold,
    },
  ])
  for (const expected of [
    {
      name: rootMotionScale.NotifyName,
      time: rootMotionScale.StartTime,
    },
    {
      name: groundedEntry.NotifyName,
      time: groundedEntry.Time,
    },
  ]) {
    if (!track.notifies.some((notify) => (
      notify.NotifyName === expected.name
      && Math.abs(notify.Time - expected.time) <= 1e-6
    ))) {
      throw new Error(
        `${animation.name} is missing authored ${expected.name} `
        + `at ${expected.time}`,
      )
    }
  }
  return track
}

/**
 * Owns sampling, pose-space composition, and the sole skeleton write for the character. The pure
 * weight table and region rules remain the graph; the React hook only forwards frame delta and
 * current controls into this animation-instance analog.
 */
export function createAlsAnimationInstance(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
  overlayStates?: ConsumerOverlayStates
  locomotionStates?: ConsumerLocomotionStates
  /** Optional normalized marker override; regular GLTF loads consume clip.userData.syncMarkers. */
  syncMarkers?: SyncMarkerTable
  /** Only the locally inspected actor owns the standalone global diagnostics. */
  publishDiagnostics?: boolean
  /** Backend adapter for UAlsAnimationInstance::RefreshGroundPrediction(). */
  groundPredictionSweep?: AlsGroundPredictionCapsuleSweep
  /** Backend adapter for CR_Als FAlsRigUnit_FootOffsetTrace. */
  controlRigFootTrace?: AlsControlRigFootOffsetTrace
  exposeDebugGlobals?: boolean
}): AlsAnimationInstance {
  assertAlsAnimationExtras(gltf.animations)
  const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
  const consumerLocomotion = createConsumerLocomotionStates(rig, gltf.locomotionStates)
  const applicator = createPoseApplicator(gltf.scene, rig)
  const ragdolling = createAlsRagdollPose(gltf.scene, gltf.animations)
  const evaluator = createPoseEvaluator(rig, { development: import.meta.env.DEV })
  const rigBoneNames = new Set(rig.boneNames)
  const controlRigRuntime = hasCompleteAlsControlRig(rigBoneNames)
    ? createAlsControlRigForwardSolveRuntime(rig)
    : null
  const controlRigDebugComponentLandmarks = controlRigRuntime
    ? CONTROL_RIG_DEBUG_COMPONENT_LANDMARKS.flatMap((boneName) => {
        const boneIndex = rig.boneNames.indexOf(boneName)
        return boneIndex < 0 ? [] : [{ boneName, boneIndex }]
      })
    : []
  const feetPoseBridge = controlRigRuntime
    ? createAlsFeetPoseBridge(
        rig,
        applicator,
        gltf.scene,
        ALS_GENERAL_ANIMATION_SETTINGS.useFootIkBones,
      )
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
  const directionTransitionRootIndex = rig.boneNames.indexOf('root')
  const directionTransitionFootLeftIndex = rig.boneNames.indexOf('foot_l')
  const rootMotion: RootMotionExtractor | undefined =
    rig.boneCount > 0 ? createRootMotionExtractor(rig) : undefined
  const clips = gltf.animations.map((clip): RuntimeClip => {
    const sampler = compileClipSampler(clip, rig)
    const compiledCurves = compileClipCurveSamplers(clip)
    const curves = Object.keys(compiledCurves).length > 0 ? compiledCurves : undefined
    const authoredRootMotion = compileAuthoredRootMotion(clip)
    return {
      sampler,
      curves,
      rootMotion: authoredRootMotion,
      entry: createEntry(sampler, curves, authoredRootMotion),
      time: 0,
    }
  })
  const clipsByName = new Map(clips.map((clip) => [clip.sampler.clip.name, clip]))
  const cameraShakeNotifyTracks = compileCameraShakeNotifyTracks(
    gltf.animations,
  )
  const footstepEffectsNotifyTracks =
    compileFootstepEffectsNotifyTracks(gltf.animations)
  const queuedNotifySequenceNames = new Set([
    ...cameraShakeNotifyTracks.keys(),
    ...footstepEffectsNotifyTracks.keys(),
  ])
  const rollClip = clipsByName.get(ALS_ROLLING_MONTAGE.Sequence)
  const rollSequenceNotifyTrack = compileRollSequenceNotifyTrack(
    rollClip?.sampler.clip,
  )
  const rollAuthoredRootMotion: CompiledAuthoredRootMotion | undefined =
    rollClip?.rootMotion
  const groundedRollPose = createMutableUePoseNode(rig.boneCount)
  if (rollClip && rollAuthoredRootMotion) {
    // FAnimNode_SequenceEvaluator owns bShouldLoop=true, but explicit-time
    // evaluation clamps its authored 1.5-second endpoint instead of advancing
    // a looping player clock.
    sampleSequencePoseNode(
      rig,
      {
        sampler: rollClip.sampler,
        curves: rollClip.curves,
        rootMotion: rollAuthoredRootMotion,
      },
      ALS_GROUNDED_ROLL_STATE.sequenceEvaluator.explicitTime,
      false,
      groundedRollPose,
    )
  } else {
    copyPose(evaluator.referencePose, groundedRollPose.pose)
  }
  groundedRollPose.curves.set(FOOT_LEFT_LOCK_CURVE_NAME, 1)
  groundedRollPose.curves.set(FOOT_RIGHT_LOCK_CURVE_NAME, 1)
  const groundedRollGraphOutput =
    createMutableUePoseNode(rig.boneCount)
  const groundedRollGraphRuntime =
    createAlsGroundedRollGraphRuntime()
  const locomotionPoseGraphRuntime =
    createAlsLocomotionPoseGraphRuntime(rig)
  const locomotionGroundedBaseInput =
    createMutableUePoseNode(rig.boneCount)
  const locomotionGroundedInput =
    createMutableUePoseNode(rig.boneCount)
  const standingGraphRuntime = createAlsStandingGraphRuntime(
    rig.boneCount,
    moveDirectionChangeProfile,
  )
  const standingPoseGraphRuntime =
    createAlsStandingPoseGraphRuntime(rig)
  const standingGraphOutput = createMutableUePoseNode(rig.boneCount)

  function createLocomotionSequencePlayer(
    key: RuntimeLocomotionSequencePlayer['key'],
  ): RuntimeLocomotionSequencePlayer {
    const metadata = ALS_LOCOMOTION_PLAYER_METADATA[key]
    if (!('loop' in metadata)) {
      throw new Error(`${String(key)} is not an ALS SequencePlayer`)
    }
    const clip = clipsByName.get(metadata.clip)
    const node = createMutableUePoseNode(rig.boneCount)
    if (clip) {
      sampleSequencePoseNode(
        rig,
        clip,
        metadata.startPosition,
        metadata.loop,
        node,
      )
    } else {
      copyPose(evaluator.referencePose, node.pose)
    }
    return {
      key,
      clip,
      node,
      group: metadata.group,
      loop: metadata.loop,
      startPosition: metadata.startPosition,
      playRate: 'playRate' in metadata ? metadata.playRate : 1,
      time: metadata.startPosition,
      weight: 0,
    }
  }

  const fallFastPlayer = createLocomotionSequencePlayer('fallFast')
  const fallPlayer = createLocomotionSequencePlayer('fall')
  const fallFlailPlayer = createLocomotionSequencePlayer('fallFlail')
  const jumpWalkLeftPlayer =
    createLocomotionSequencePlayer('jumpWalkLeft')
  const jumpRunLeftPlayer =
    createLocomotionSequencePlayer('jumpRunLeft')
  const jumpWalkRightPlayer =
    createLocomotionSequencePlayer('jumpWalkRight')
  const jumpRunRightPlayer =
    createLocomotionSequencePlayer('jumpRunRight')
  const jumpLoopPlayer = createLocomotionSequencePlayer('jumpLoop')
  const jumpFlailPlayer = createLocomotionSequencePlayer('jumpFlail')
  const landLightPlayer = createLocomotionSequencePlayer('landLight')
  const landHeavyPlayer = createLocomotionSequencePlayer('landHeavy')
  const landMovementLightPlayer =
    createLocomotionSequencePlayer('landMovementLight')
  const landMovementHeavyPlayer =
    createLocomotionSequencePlayer('landMovementHeavy')
  const locomotionSequencePlayers = [
    fallFastPlayer,
    fallPlayer,
    fallFlailPlayer,
    jumpWalkLeftPlayer,
    jumpRunLeftPlayer,
    jumpWalkRightPlayer,
    jumpRunRightPlayer,
    jumpLoopPlayer,
    jumpFlailPlayer,
    landLightPlayer,
    landHeavyPlayer,
    landMovementLightPlayer,
    landMovementHeavyPlayer,
  ] as const
  const locomotionSyncGroups: Readonly<
    Record<'Fall' | 'Jump' | 'Flail' | 'Land', RuntimeLocomotionSyncGroup>
  > = {
    Fall: {
      members: [fallFastPlayer, fallPlayer],
      leaderKey: null,
    },
    Jump: {
      members: [
        jumpWalkLeftPlayer,
        jumpRunLeftPlayer,
        jumpWalkRightPlayer,
        jumpRunRightPlayer,
      ],
      leaderKey: null,
    },
    Flail: {
      members: [jumpLoopPlayer, jumpFlailPlayer],
      leaderKey: null,
    },
    Land: {
      members: [
        landLightPlayer,
        landHeavyPlayer,
        landMovementLightPlayer,
        landMovementHeavyPlayer,
      ],
      leaderKey: null,
    },
  }

  function sampleExplicitLocomotionPose(
    clipName: string,
  ) {
    const node = createMutableUePoseNode(rig.boneCount)
    const clip = clipsByName.get(clipName)
    if (clip) sampleSequencePoseNode(rig, clip, 0, false, node)
    else copyPose(evaluator.referencePose, node.pose)
    return node
  }

  const airLeanRawSourcePoses =
    locomotionPoseGraphRuntime.airLeanBlendSpace.blendSpace.samples.map(
      ({ animation }) => sampleExplicitLocomotionPose(animation.name),
    ) as [
      MutableUePoseNode,
      MutableUePoseNode,
      MutableUePoseNode,
      MutableUePoseNode,
      MutableUePoseNode,
    ]
  const airLeanReferencePose = sampleExplicitLocomotionPose(
    ALS_AIR_LEAN_ADDITIVE_SETTINGS.referenceSequence,
  )
  const landingPreviewHeavyPose = sampleExplicitLocomotionPose(
    ALS_LOCOMOTION_PLAYER_METADATA.landingPreviewHeavy.clip,
  )
  const landingPreviewLightPose = sampleExplicitLocomotionPose(
    ALS_LOCOMOTION_PLAYER_METADATA.landingPreviewLight.clip,
  )
  const landMovementReferencePose = sampleExplicitLocomotionPose(
    ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.referenceSequence,
  )
  const locomotionSampledPoses: AlsLocomotionSampledPoses = {
    groundedInput: locomotionGroundedInput,
    fallFastPose: fallFastPlayer.node,
    fallPose: fallPlayer.node,
    fallFlailPose: fallFlailPlayer.node,
    jumpWalkLeftPose: jumpWalkLeftPlayer.node,
    jumpRunLeftPose: jumpRunLeftPlayer.node,
    jumpWalkRightPose: jumpWalkRightPlayer.node,
    jumpRunRightPose: jumpRunRightPlayer.node,
    jumpLoopPose: jumpLoopPlayer.node,
    jumpFlailPose: jumpFlailPlayer.node,
    airLeanRawSourcePoses,
    airLeanReferencePose,
    landingPreviewHeavyPose,
    landingPreviewLightPose,
    landLightPose: landLightPlayer.node,
    landHeavyPose: landHeavyPlayer.node,
    landMovementLightRawPose: landMovementLightPlayer.node,
    landMovementHeavyRawPose: landMovementHeavyPlayer.node,
    landMovementReferencePose,
  }
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
  const groundedLocomotionPlayers = Object.fromEntries(
    ALS_HIPS_DIRECTIONS.map((direction) => [
      direction,
      new BlendSpacePlayer({
        id: `MovementPlayer.${direction}`,
        startPosition: ALS_GROUNDED_DIRECTION_PLAYER.startPosition,
      }),
    ]),
  ) as Record<AlsHipsDirection, BlendSpacePlayer>
  const groundedLocomotionPlayerResults = Object.fromEntries(
    ALS_HIPS_DIRECTIONS.map((direction) => [
      direction,
      groundedLocomotionPlayers[direction].update({
        relevant: false,
        nodePlayRate: 0,
        samples: [],
      }),
    ]),
  ) as Record<AlsHipsDirection, BlendSpacePlayerResult>
  const groundedLocomotionClipNames = new Set<string>()
  const groundedLocomotionClips = new Map<string, RuntimeClip>()
  for (const evaluator of Object.values(groundedLocomotionGraph.evaluators)) {
    for (const sample of evaluator.blendSpace.samples) {
      groundedLocomotionClipNames.add(sample.animation.name)
      const clip = clipsByName.get(sample.animation.name)
      if (clip) groundedLocomotionClips.set(sample.animation.name, clip)
    }
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
  const standingStopTransitionClips = {
    Left: clipsByName.get(ALS_STOP_TRANSITION_ANIMATIONS.Left.clip),
    Right: clipsByName.get(ALS_STOP_TRANSITION_ANIMATIONS.Right.clip),
  }
  const crouchingWalkPoseClip = clipsByName.get(
    'A_Als_Crouch_Walk_Pose',
  )
  const crouchingTransitionRightClip = clipsByName.get(
    'A_Als_Crouch_Transition_Right',
  )
  const crouchingTransitionLeftClip = clipsByName.get(
    'A_Als_Crouch_Transition_Left',
  )
  const standingTransitionRightClip = clipsByName.get(
    'A_Als_Stand_Transition_Right',
  )
  const standingTransitionLeftClip = clipsByName.get(
    'A_Als_Stand_Transition_Left',
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
  const standingMovementStatePoses = Object.fromEntries(
    ALS_HIPS_DIRECTIONS.map((direction) => [
      direction,
      createMutableUePoseNode(rig.boneCount),
    ]),
  ) as Record<AlsHipsDirection, MutableUePoseNode>
  const standingMovementSamplePoses = Object.fromEntries(
    ALS_HIPS_DIRECTIONS.map((direction) => [
      direction,
      groundedLocomotionGraph.evaluators[
        direction
      ].blendSpace.samples.map(() => createMutableUePoseNode(rig.boneCount)),
    ]),
  ) as Record<AlsHipsDirection, MutableUePoseNode[]>
  const standingMoveForwardBasePose =
    createMutableUePoseNode(rig.boneCount)
  const standingSprintPose =
    createMutableUePoseNode(rig.boneCount)
  const standingSprintAccelerationPose =
    createMutableUePoseNode(rig.boneCount)
  const standingMovementPoseSources: UePoseNode[] = []
  const standingMovementPoseWeights: number[] = []
  const accelerationDirections = [
    'Forward',
    'Backward',
    'Left',
    'Right',
  ] as const satisfies readonly AlsMovementDirection[]
  const standingAccelerationClips = Object.fromEntries(
    accelerationDirections.map((direction) => [
      direction,
      clipsByName.get(ALS_ACCELERATION_PLAYER_OPTIONS.clips[direction]),
    ]),
  ) as Record<AlsMovementDirection, RuntimeClip | undefined>
  const standingAccelerationPoses = Object.fromEntries(
    ALS_ACCELERATION_PLAYERS.map((player) => [
      player.state,
      Object.fromEntries(
        accelerationDirections.map((direction) => [
          direction,
          createMutableUePoseNode(rig.boneCount),
        ]),
      ),
    ]),
  ) as unknown as Record<
    (typeof ALS_ACCELERATION_PLAYERS)[number]['state'],
    Record<AlsMovementDirection, MutableUePoseNode>
  >
  const standingAccelerationFullPose =
    createMutableUePoseNode(rig.boneCount)
  const standingAccelerationAdditiveScratch =
    createMeshSpaceBlendScratch(rig.boneCount)
  const standingAccelerationSourceComplete =
    accelerationDirections.every(
      (direction) => standingAccelerationClips[direction] !== undefined,
    )
  if (standingAccelerationSourceComplete) {
    for (const direction of accelerationDirections) {
      const clip = standingAccelerationClips[direction]!
      const additive = compileAuthoredAdditive(clip.sampler.clip)
      if (
        additive?.additiveSpace !== 'local'
        || additive.refPoseSeq
          !== ALS_ACCELERATION_PLAYER_OPTIONS.referencePoseSequence
        || additive.refFrameIndex
          !== ALS_ACCELERATION_PLAYER_OPTIONS.referenceFrameIndex
      ) {
        throw new Error(
          `${clip.sampler.clip.name} additive metadata differs from AB_Als_Standing`,
        )
      }
    }
  }
  const standingStopPoses = Object.fromEntries(
    (
      ['Plant Left Foot', 'Plant Right Foot'] as const
    ).map((stopState) => [
      stopState,
      Object.fromEntries(
        ALS_HIPS_DIRECTIONS.map((direction) => {
          const node = createMutableUePoseNode(rig.boneCount)
          const clip = clipsByName.get(
            ALS_STOP_POSE_EVALUATOR_OPTIONS.clips[direction],
          )
          if (clip) {
            sampleSequencePoseNode(
              rig,
              clip,
              ALS_STOP_POSE_EVALUATORS[stopState]
                .explicitTimes[direction],
              ALS_STOP_POSE_EVALUATOR_OPTIONS.loop,
              node,
            )
          } else {
            copyPose(evaluator.referencePose, node.pose)
          }
          return [direction, node]
        }),
      ),
    ]),
  ) as unknown as AlsStopPoseInputs
  const standingIdlePose = createMutableUePoseNode(rig.boneCount)
  const standingRotateLeftPose =
    createMutableUePoseNode(rig.boneCount)
  const standingRotateRightPose =
    createMutableUePoseNode(rig.boneCount)
  if (roles.idle) {
    sampleSequencePoseNode(
      rig,
      roles.idle,
      0,
      false,
      standingIdlePose,
    )
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
  const montageClips = new Set<RuntimeClip>()
  for (const clip of turnInPlaceClips.values()) {
    if (clip) {
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
  for (const clip of Object.values(standingStopTransitionClips)) {
    if (clip) montageClips.add(clip)
  }
  if (crouchingTransitionRightClip) {
    montageClips.add(crouchingTransitionRightClip)
  }
  if (crouchingTransitionLeftClip) {
    montageClips.add(crouchingTransitionLeftClip)
  }
  if (standingTransitionRightClip) {
    montageClips.add(standingTransitionRightClip)
  }
  if (standingTransitionLeftClip) {
    montageClips.add(standingTransitionLeftClip)
  }
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
  const viewPoseRuntime = ALS_VIEW_POSE_CLIP_NAMES.every(
    (clipName) => clipsByName.has(clipName),
  )
    ? createAlsViewPoseRuntime(
        rig,
        standReference,
        (clipName) => clipsByName.get(clipName)?.sampler,
      )
    : undefined
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
  const customOverlays = createConsumerOverlayStates(rig, gltf.animations, gltf.overlayStates, quickFeetBlendProfile)
  const upperBodySlot = createConsumerUpperBodySlot(rig, gltf.overlayStates)
  const rifleRuntime = createAlsRifleRuntime(
    rig,
    quickFeetBlendProfile,
  )
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
  const rifleAimReferenceClip = clipsByName.get(
    'A_Als_Rifle_Poses_NoCurves',
  )
  const rifleAimClip = clipsByName.get('A_Als_Rifle_Aim')
  const rifleAimCrouchClip = clipsByName.get(
    'A_Als_Rifle_Aim_Crouch',
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
  const pistolOverlays = Object.fromEntries(PISTOL_OVERLAY_MODES.map((mode) => {
    const runtime = mode === 'PistolTwoHanded'
      ? createAlsPistolRuntime(rig, quickFeetBlendProfile)
      : createAlsPistolOneHandedRuntime(rig, quickFeetBlendProfile)
    const poses = clipsByName.get(`A_Als_${mode}_Poses`)
    const aim = clipsByName.get(`A_Als_${mode}_Aim`)
    const aimCrouch = clipsByName.get(`A_Als_${mode}_Aim_Crouch`)
    const aimReference = clipsByName.get(`A_Als_${mode}_Poses_NoCurves`)
    const sources: AlsPistolFullSources | undefined = poses && aim && aimCrouch
      && aimReference && idleAdditiveClip && standPose
      ? {
          poses, aim, aimCrouch, aimReference,
          idle: { ...idleAdditiveClip, time: 0, loop: true },
          idleReference: standPose,
        }
      : undefined
    for (const [clip, frame] of [
      [aim, runtime.graph.aiming.standingAimReferenceFrame],
      [aimCrouch, runtime.graph.aiming.crouchingAimReferenceFrame],
    ] as const) {
      if (!clip) continue
      const metadata = compileAuthoredAdditive(clip.sampler.clip)
      if (metadata?.additiveSpace !== 'mesh'
        || metadata.refPoseSeq !== `A_Als_${mode}_Poses_NoCurves`
        || metadata.refFrameIndex !== frame) {
        throw new Error(`${mode} aim metadata differs from ALS`)
      }
    }
    return [mode, { runtime, sources }] as const
  }))
  const rifleAimMetadata = rifleAimClip
    ? compileAuthoredAdditive(rifleAimClip.sampler.clip)
    : undefined
  const rifleAimCrouchMetadata = rifleAimCrouchClip
    ? compileAuthoredAdditive(rifleAimCrouchClip.sampler.clip)
    : undefined
  if (
    (
      rifleAimClip
      && (
        rifleAimMetadata?.additiveSpace !== 'mesh'
        || rifleAimMetadata.refPoseSeq
          !== 'A_Als_Rifle_Poses_NoCurves'
        || rifleAimMetadata.refFrameIndex !== 5
      )
    )
    || (
      rifleAimCrouchClip
      && (
        rifleAimCrouchMetadata?.additiveSpace !== 'mesh'
        || rifleAimCrouchMetadata.refPoseSeq
          !== 'A_Als_Rifle_Poses_NoCurves'
        || rifleAimCrouchMetadata.refFrameIndex !== 9
      )
    )
  ) {
    throw new Error(
      'AB_Als_Rifle aim additive metadata differs from ALS',
    )
  }
  const rifleSources =
    rifleRelaxedSources
    && idleAdditiveClip
    && standPose
    && rifleAimReferenceClip
    && rifleAimClip
    && rifleAimCrouchClip
      ? {
          ...rifleRelaxedSources,
          idle: {
            sampler: idleAdditiveClip.sampler,
            curves: idleAdditiveClip.curves,
            time: 0,
            loop: true,
          },
          idleReference: {
            sampler: standPose.sampler,
            curves: standPose.curves,
          },
          aim: {
            sampler: rifleAimClip.sampler,
            curves: rifleAimClip.curves,
          },
          aimCrouch: {
            sampler: rifleAimCrouchClip.sampler,
            curves: rifleAimCrouchClip.curves,
          },
          aimReference: {
            sampler: rifleAimReferenceClip.sampler,
            curves: rifleAimReferenceClip.curves,
          },
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
  let controlRigComponentDebugPublished = false
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
  const locomotionPoseGraphSourceComplete =
    locomotionSequencePlayers.every((player) => player.clip !== undefined)
    && locomotionPoseGraphRuntime.airLeanBlendSpace.blendSpace.samples.every(
      ({ animation }) => clipsByName.has(animation.name),
    )
    && clipsByName.has(ALS_AIR_LEAN_ADDITIVE_SETTINGS.referenceSequence)
    && clipsByName.has(
      ALS_LOCOMOTION_PLAYER_METADATA.landingPreviewHeavy.clip,
    )
    && clipsByName.has(
      ALS_LOCOMOTION_PLAYER_METADATA.landingPreviewLight.clip,
    )
    && clipsByName.has(
      ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.referenceSequence,
    )
  const complete = rig.boneCount > 0
    && (Object.keys(CLIP_ROLES) as ClipRole[]).every((role) => roles[role])
    && groundedLocomotionClips.size === groundedLocomotionClipNames.size
    && sprintAccelerationClip !== undefined
    && roles.idle !== undefined
    && roles.crouchIdle !== undefined
    && [...turnInPlaceClips.values()].every(
      (clip): clip is RuntimeClip => clip !== undefined,
    )
    && standingAccelerationSourceComplete
    && Object.values(standingStopTransitionClips).every(
      (clip): clip is RuntimeClip => clip !== undefined,
    )
    && standingTransitionRightClip !== undefined
    && standingTransitionLeftClip !== undefined
    && crouchingTransitionLeftClip !== undefined
    && rollClip !== undefined
    && rollAuthoredRootMotion !== undefined
    && crouchingGraphSourceComplete
    && quickFeetBlendProfile !== null
    && defaultOverlayGraphRuntime !== undefined
    && rifleOverlaySources.length === Object.keys(RIFLE_OVERLAY_CLIPS).length
    && rifleSources !== undefined
    && PISTOL_OVERLAY_MODES.every((mode) => pistolOverlays[mode].sources !== undefined)
    && idleAdditiveEntry !== undefined
    && locomotionPoseGraphSourceComplete
  const locomotionRoles = (Object.keys(CLIP_ROLES) as ClipRole[]).filter(
    (role) => role !== 'idle' && role !== 'crouchIdle',
  )
  const locomotionMembersByRole = new Map<ClipRole, SyncGroupMember>()
  const locomotionMembersByClip = new Map<RuntimeClip, SyncGroupMember>()
  const groundedLocomotionPlayerMembers = new Set(
    ALS_HIPS_DIRECTIONS.map(
      (direction) => groundedLocomotionPlayers[direction].syncMember,
    ),
  )
  const locomotionMembers: SyncGroupMember[] = [
    ...groundedLocomotionPlayerMembers,
  ]
  // Source clips are still graph-owned clocks, so the generic clip loop must not advance them.
  // They are not Movement tick records: each owning BlendSpace player contributes one record.
  const syncClips = new Set<RuntimeClip>(groundedLocomotionClips.values())
  const locomotionClips = new Set<RuntimeClip>()
  if (sprintAccelerationClip) locomotionClips.add(sprintAccelerationClip)
  for (const role of locomotionRoles) {
    const clip = roles[role]
    if (
      clip
      && !groundedLocomotionClipNames.has(clip.sampler.clip.name)
    ) {
      locomotionClips.add(clip)
    }
  }
  for (const clip of locomotionClips) {
    const clipName = clip.sampler.clip.name
    const startTime = clipName === ALS_STANDING_SPRINT_GRAPH.sprint.clip
        // FAnimNode_SequencePlayer serializes StartPosition in sequence seconds.
        ? ALS_STANDING_SPRINT_GRAPH.sprint.startPosition
        : clipName === ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.clip
          ? ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.startPosition
          : 0
    const member: SyncGroupMember = {
      id: clipName,
      duration: clip.sampler.clip.duration,
      markers: gltf.syncMarkers?.[clipName] ?? clipSyncMarkers(clip.sampler.clip),
      time: startTime,
      weight: 0,
      playRate: 0,
      updatedThisFrame: false,
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
      updatedThisFrame: false,
      time: 0,
      weight: 0,
      playRate: 0,
    }
    overlayLocomotionMembers.set(source, member)
    locomotionMembers.push(member)
    syncClips.add(source.clip)
  }
  const locomotionSyncGroup = createSyncGroup('Movement', locomotionMembers)
  const groundedLocomotionPlayerSources = Object.fromEntries(
    ALS_HIPS_DIRECTIONS.map((direction) => [
      direction,
      groundedLocomotionGraph.evaluators[
        direction
      ].blendSpace.samples.map((sample, sampleIndex) => {
        const clip = groundedLocomotionClips.get(sample.animation.name)
        return {
          id: String(sampleIndex),
          clip,
          name: sample.animation.name,
          duration: clip?.sampler.clip.duration ?? 0,
          combinedRateScale: sample.rateScale,
          markers: clip
            ? (
                gltf.syncMarkers?.[sample.animation.name]
                ?? clipSyncMarkers(clip.sampler.clip)
              )
            : [],
        }
      }),
    ]),
  )
  const groundedLocomotionClipDebugWeights = new Map(
    [...groundedLocomotionClipNames].map((clipName) => [clipName, 0]),
  )
  const groundedLocomotionClipDebugTimes = new Map(
    [...groundedLocomotionClipNames].map((clipName) => [clipName, 0]),
  )

  function refreshGroundedLocomotionPlayers(
    nodePlayRate: number,
  ) {
    for (
      let playerIndex = 0;
      playerIndex < ALS_HIPS_DIRECTIONS.length;
      playerIndex++
    ) {
      const direction = ALS_HIPS_DIRECTIONS[playerIndex]
      const evaluator = groundedLocomotionGraph.evaluators[direction]
      const sources = groundedLocomotionPlayerSources[direction]
      const samples: BlendSpacePlayerSample[] = []
      if (groundedLocomotionGraph.relevantPlayers[playerIndex] !== 0) {
        for (let index = 0; index < evaluator.result.count; index++) {
          const sampleIndex = evaluator.result.sampleIndices[index]
          const source = sources[sampleIndex]
          if (!source?.clip) continue
          samples.push({
            id: source.id,
            weight: evaluator.result.weights[index],
            duration: source.duration,
            combinedRateScale: source.combinedRateScale,
            markers: source.markers,
          })
        }
      }
      const result = groundedLocomotionPlayers[direction].update({
        relevant: groundedLocomotionGraph.relevantPlayers[playerIndex] !== 0,
        nodePlayRate,
        samples,
      })
      result.syncMember.weight =
        groundedLocomotionGraph.playerWeights[playerIndex]
      groundedLocomotionPlayerResults[direction] = result
    }
  }

  function resolveGroundedLocomotionPlayerTimes() {
    groundedLocomotionClipDebugTimes.forEach(
      (_, clipName) => groundedLocomotionClipDebugTimes.set(clipName, 0),
    )
    const timeScores = new Map<string, number>()
    for (const direction of ALS_HIPS_DIRECTIONS) {
      const player = groundedLocomotionPlayers[direction]
      const result = player.resolveOuterSync()
      groundedLocomotionPlayerResults[direction] = result
      const sources = groundedLocomotionPlayerSources[direction]
      for (const sample of result.samples) {
        const source = sources[Number(sample.id)]
        if (!source) continue
        const score = result.syncMember.weight * sample.weight
        if (score >= (timeScores.get(source.name) ?? -1)) {
          timeScores.set(source.name, score)
          groundedLocomotionClipDebugTimes.set(source.name, sample.time)
        }
      }
    }
  }
  const mainCurveEntries = [...baseEntries]
  let graphFallbackGaitAmount = 0
  let graphGroundedAmount = 1
  let graphMovingAmount = 0
  let graphCrouchingAmount = 0
  let graphFootLeftLock = 0
  let graphFootRightLock = 0
  let graphRotationYawSpeed = 0
  let graphAllowTransitions = 1
  let activeStandingGraphWeight = 0
  let activeCrouchingGraphWeight = 0
  const locomotionResolvedGraphCurves = new Map<string, number>()
  const locomotionAccumulator = createPoseAccumulator(rig.boneCount)
  const locomotionSamplePose = createPoseBuffer(rig.boneCount)

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

  function resolveLocomotionGraphCurves(
    output: Map<string, number>,
  ) {
    resolveWeightedEntryCurvesDirect(
      output,
      mainCurveEntries,
      [
        {
          weight: activeStandingGraphWeight,
          curves: standingGraphOutput.curves,
        },
        {
          weight: activeCrouchingGraphWeight,
          curves: crouchingGraphOutput.curves,
        },
      ],
    )

    // These are the explicit graph outputs that enter AB_Als_Grounded's inertialization node.
    // Keeping them on that node's curve container makes pose and curve corrections share one
    // authored request and preserves the downstream AB_Als_Layering curve override.
    output.set(
      POSE_GAIT_CURVE_NAME,
      output.get(POSE_GAIT_CURVE_NAME) ?? graphFallbackGaitAmount,
    )
    output.set(POSE_GROUNDED_CURVE_NAME, graphGroundedAmount)
    output.set(POSE_IN_AIR_CURVE_NAME, 1 - graphGroundedAmount)
    output.set(POSE_STANDING_CURVE_NAME, 1 - graphCrouchingAmount)
    output.set(POSE_CROUCHING_CURVE_NAME, graphCrouchingAmount)
    output.set(POSE_MOVING_CURVE_NAME, graphMovingAmount)
    // AB_Als_Grounded node 310 writes these graph curves at full weight. They are not clip
    // curves: the preceding published values drive RefreshFeet() and the current values drive
    // CR_Als, including while Jump/Fall states retain the Grounded cached pose as their source.
    output.set(FOOT_LEFT_IK_CURVE_NAME, 1)
    output.set(FOOT_RIGHT_IK_CURVE_NAME, 1)
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
  const transitionMontageAdditiveEntries:
    EvaluatorAuthoredAdditiveEntry[] = []
  const postLocomotionMontageEntries: EvaluatorLayerEntry[] = []
  const postLocomotionSlotCurveScratch = new Map<string, number>()
  let activeLocomotionGraphInput:
    AlsLocomotionPoseGraphInput | null = null
  let activeRifleGraphInput: AlsRifleFullInput | null = null
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
      if (activeStandingGraphWeight > 0) {
        accumulatePose(
          locomotionAccumulator,
          standingGraphOutput.pose,
          activeStandingGraphWeight,
        )
      }
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
        locomotionGroundedBaseInput.pose,
      )
      locomotionGroundedBaseInput.curves.clear()
      resolveLocomotionGraphCurves(
        locomotionGroundedBaseInput.curves,
      )
      const rollWeight =
        groundedRollGraphRuntime.stateWeights.Roll
      if (rollWeight >= 1 - 1e-5) {
        copyPoseNode(
          groundedRollPose,
          locomotionGroundedInput,
        )
      } else if (rollWeight > 1e-5) {
        blendTwoPoseNodesTogether(
          groundedRollPose,
          locomotionGroundedBaseInput,
          rollWeight,
          groundedRollGraphOutput,
        )
        copyPoseNode(
          groundedRollGraphOutput,
          locomotionGroundedInput,
        )
      } else {
        copyPoseNode(
          locomotionGroundedBaseInput,
          locomotionGroundedInput,
        )
      }
      const input = activeLocomotionGraphInput
      if (!input) {
        copyPose(locomotionGroundedInput.pose, context.outputPose)
        context.outputCurves.clear()
        for (const [name, value] of locomotionGroundedInput.curves) {
          context.outputCurves.set(name, value)
        }
        return
      }
      const output = evaluateUpdatedAlsLocomotionPoseGraph(
        locomotionPoseGraphRuntime,
        input,
      )
      copyPose(output.pose, context.outputPose)
      context.outputCurves.clear()
      for (const [name, value] of output.curves) {
        context.outputCurves.set(name, value)
      }
    },
    montages: transitionMontageEntries,
    preOverlayAdditives: transitionMontageAdditiveEntries,
    postLocomotionMontages: postLocomotionMontageEntries,
    stagedInertialization: {
      locomotion: groundedInertialization,
      overlay: overlayInertialization,
    },
    overlayGraph(context) {
      const custom = customOverlays.get(activeOverlayMode)
      if (custom && activeRifleGraphInput) {
        const result = custom.evaluate(activeRifleGraphInput)
        copyPose(result.pose, context.outputPose)
        context.outputCurves.clear()
        for (const [name, value] of result.curves) context.outputCurves.set(name, value)
        return
      }
      if (isPistolOverlayMode(activeOverlayMode) && activeRifleGraphInput) {
        const { runtime, sources } = pistolOverlays[activeOverlayMode]
        if (sources) {
          // Secondary Motion uses the same clock as the authored Idle player.
          const timedSources = { ...sources, idle: { ...sources.idle, time: idleAdditiveClip?.time ?? 0 } }
          const result = activeOverlayMode === 'PistolTwoHanded'
            ? evaluateAlsPistolGraph(runtime, activeRifleGraphInput, timedSources)
            : evaluateAlsPistolOneHandedGraph(runtime, activeRifleGraphInput, timedSources)
          copyPose(result.pose, context.outputPose)
          context.outputCurves.clear()
          for (const [name, value] of result.curves) context.outputCurves.set(name, value)
          return
        }
      }
      if (
        activeOverlayMode === 'Rifle'
        && rifleSources
        && activeRifleGraphInput
      ) {
        const result = evaluateAlsRifleGraph(
          rifleRuntime,
          activeRifleGraphInput,
          rifleSources,
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
      gltf.locomotionStates?.onEvaluatePose?.({ stage: 'layering-reference', rig, pose: layeringReference, curves: publishedCurves })
      gltf.locomotionStates?.onEvaluatePose?.({ stage: 'overlay-input', rig, pose: context.overlayPose, curves: overlayInertialization.curves })
      gltf.locomotionStates?.onEvaluatePose?.({ stage: 'layering-input', rig, pose: context.locomotionPose, curves: publishedCurves })
      evaluateAlsLayeringPose(
        layeringPoseRuntime,
        {
          locomotionPose: context.locomotionPose,
          overlayPose: context.overlayPose,
          basePose: layeringReference,
          curves: publishedCurves,
          regionSlots: upperBodySlot.evaluate({ pose: context.overlayPose, curves: overlayInertialization.curves }),
        },
        context.outputPose,
      )
      gltf.locomotionStates?.onEvaluatePose?.({ stage: 'layering-output', rig, pose: context.outputPose, curves: publishedCurves })
      if (viewPoseRuntime) {
        evaluateAlsViewPoseRuntime(
          viewPoseRuntime,
          context.outputPose,
          viewAnimationState.lookAmount,
          context.outputPose,
        )
      }
      gltf.locomotionStates?.onEvaluatePose?.({ stage: 'view-output', rig, pose: context.outputPose, curves: publishedCurves })
    },
    rootMotion,
    resolveBlendedCurves(_samples, output) {
      resolveSlotCurves(
        groundedInertialization.curves,
        transitionSlotBindings,
        transitionSlotCurveScratch,
      )
      resolveSlotCurves(
        transitionSlotCurveScratch,
        postLocomotionSlotBindings,
        postLocomotionSlotCurveScratch,
      )
      composeAlsLayeringFinalCurves(
        postLocomotionSlotCurveScratch,
        overlayInertialization.curves,
        output,
        upperBodySlot.curves(overlayInertialization.curves),
      )
      consumerLocomotion.applyLayeringCurves(output)
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
  const inAirState = createAlsInAirState()
  const movementBaseState = createAlsMovementBaseState()
  const feetState = initializeAlsFeetThighAxesFromRig(
    createAlsFeetState(),
    rig,
  )
  const spineState = createAlsSpineState()
  const viewAnimationState = createAlsViewAnimationState()
  const lookState = createAlsLookState()
  const publishedCurves = new Map<string, number>()
  const locomotionLocation: Velocity3 = { x: 0, y: 0, z: 0 }
  let pendingUpdate = true
  let worldTime = 0
  let teleportedTime = Number.NEGATIVE_INFINITY
  let previousFootPlantedAmount = 0
  let previousGroundPredictionBlockAmount = 0
  let landToGroundedNotifyCount = 0
  const crouchingNode34 = createInertialization(rig.boneCount)
  const crouchingNode34Output = createOutputInertialization()
  let crouchingRotateLeftTime = 0
  let crouchingRotateRightTime = 0
  let crouchingStopQuickNotifyCount = 0
  let standingStopQuickNotifyCount = 0
  const stanceTransitionState = createAlsStanceTransitionCurveState()
  const groundedStanceTransitionState =
    createAlsGroundedStanceTransitionState()
  let groundedStanceTransitionSource:
    RuntimeGroundedStanceTransitionSource | null = null
  let activeGroundedStanceState:
    RuntimeGroundedStanceTransitionSource | null = null
  let groundedStanceTransitionSourceWeight = 0
  const transitionsState = createAlsTransitionsState()
  const dynamicTransitionsState = createAlsDynamicTransitionsState()
  const turnInPlaceState = createAlsTurnInPlaceState()
  const slotMontageClock = createSlotMontageClock()
  const slotMontageSamples: SlotMontageSample[] = []
  const slotMontageNotifyEvents: SlotMontageNotifyEvent[] = []
  const locomotionSlotMontageSamples: SlotMontageSample[] = []
  const gatheredSequenceNotifies: CompiledSequenceNotify[] = []
  const pendingQueuedAnimEvents: AlsAnimNotifyCameraShakeEvent[] = []
  const pendingQueuedFootstepEffectsEvents:
    AlsAnimNotifyFootstepEffectsEvent[] = []
  const locomotionPreviousTimes = new Map<SyncGroupMember, number>()
  const locomotionSequencePreviousTimes = new Map<
    RuntimeLocomotionSequencePlayer,
    number
  >()
  const slotMontageBindings = new Map<
    number,
    RuntimeSlotMontageBinding
  >()
  const mantlingMontageInstances = new Map<
    number,
    RuntimeMantlingMontageInstance
  >()
  const rollingMontageInstances = new Map<
    number,
    RuntimeRollingMontageInstance
  >()
  const getUpMontageInstances = new Map<number, {
    montage: AlsGettingUpMontage; sample: SlotMontageSample; activeNotifyIndices: Set<number>
  }>()
  const pendingGetUpNotifyEvents: AlsGetUpMontageNotifyEvent[] = []
  const pendingMantlingNotifyEvents: AlsMantlingMontageNotifyEvent[] =
    []
  const pendingRollingNotifyEvents: AlsRollingMontageNotifyEvent[] =
    []
  const mantlingLastMarkerTimeByInstance = new Map<number, number>()
  const rollingLastMarkerTimeByInstance = new Map<number, number>()
  const rollingGatheredSequenceNotifies: CompiledSequenceNotify[] = []
  const extractedRollingRootMotion =
    createRootMotionMovementParams()
  const extractedRollingRootMotionFrame =
    createRootMotionMovementParams()
  const transitionSlotBindings: RuntimeSlotMontageBinding[] = []
  const transitionSlotCurveScratch = new Map<string, number>()
  const postLocomotionSlotBindings: RuntimeSlotMontageBinding[] = []
  const standingTurnInPlaceMontages: {
    pose: UePoseNode
    weight: number
  }[] = []
  const crouchingTurnInPlaceMontages: {
    pose: UePoseNode
    weight: number
  }[] = []
  let activeTurnInPlaceClip: RuntimeClip | null = null
  let turnInPlaceSample: SlotMontageSample | undefined
  const rotateInPlaceState = createAlsRotateInPlaceState()
  let groundedEntryMode: 'FromRoll' | null = null
  let pendingGroundedEntryMode:
    'FromRoll' | null | undefined
  let currentLocomotionAction: AlsLocomotionAction = null
  let previousStance: AlsStance | null = null
  let previousMovingSmooth: boolean | null = null
  let previousOverlayMode: AlsOverlayMode | null = null

  function queueCameraShakeNotifiesFromRange(
    runtimeTrack: RuntimeCameraShakeNotifyTrack,
    previousTime: number,
    currentTime: number,
    context: {
      readonly bAllowLooping: boolean
      readonly bSrcIsLeader: boolean
      readonly InstanceWeight: number
    },
  ) {
    gatheredSequenceNotifies.length = 0
    gatherSequenceNotifiesFromDeltaPositions(
      runtimeTrack.track,
      previousTime,
      currentTime,
      context,
      gatheredSequenceNotifies,
    )
    for (const notify of gatheredSequenceNotifies) {
      const payload = runtimeTrack.payloadByNotify.get(notify)
      if (payload) pendingQueuedAnimEvents.push(payload)
    }
  }

  function dispatchQueuedAnimEvents(
    sink: AlsPlayerCameraManager,
  ) {
    const queuedEventCount = pendingQueuedAnimEvents.length
    let deliveredEventCount = 0
    try {
      for (let index = 0; index < queuedEventCount; index++) {
        notifyAlsAnimNotifyCameraShake(
          sink,
          pendingQueuedAnimEvents[index],
        )
        deliveredEventCount++
      }
    } finally {
      // If a sink fails, retry only the undelivered suffix. Already-delivered queued notifies
      // cannot legally fire twice on the next frame.
      pendingQueuedAnimEvents.splice(0, deliveredEventCount)
    }
    return deliveredEventCount
  }

  function queueFootstepEffectsNotifiesFromRange(
    runtimeTrack: RuntimeFootstepEffectsNotifyTrack,
    previousTime: number,
    currentTime: number,
    context: {
      readonly bAllowLooping: boolean
      readonly bSrcIsLeader: boolean
      readonly InstanceWeight: number
    },
  ) {
    gatheredSequenceNotifies.length = 0
    gatherSequenceNotifiesFromDeltaPositions(
      runtimeTrack.track,
      previousTime,
      currentTime,
      context,
      gatheredSequenceNotifies,
    )
    for (const notify of gatheredSequenceNotifies) {
      const payload = runtimeTrack.payloadByNotify.get(notify)
      if (payload) pendingQueuedFootstepEffectsEvents.push(payload)
    }
  }

  function queueFootstepEffectsForClipRange(
    clip: RuntimeClip,
    previousTime: number,
    currentTime: number,
    bAllowLooping: boolean,
    InstanceWeight: number,
  ) {
    const runtimeTrack = footstepEffectsNotifyTracks.get(
      clip.sampler.clip.name,
    )
    if (!runtimeTrack) return
    queueFootstepEffectsNotifiesFromRange(
      runtimeTrack,
      previousTime,
      currentTime,
      {
        bAllowLooping,
        bSrcIsLeader: true,
        InstanceWeight,
      },
    )
  }

  function dispatchQueuedFootstepEffectsEvents(
    sink: (
      event: Readonly<AlsAnimNotifyFootstepEffectsEvent>,
    ) => void,
  ) {
    const queuedEventCount =
      pendingQueuedFootstepEffectsEvents.length
    let deliveredEventCount = 0
    try {
      for (let index = 0; index < queuedEventCount; index++) {
        sink(pendingQueuedFootstepEffectsEvents[index])
        deliveredEventCount++
      }
    } finally {
      // Match the camera queue: a failing sink retries only the undelivered suffix.
      pendingQueuedFootstepEffectsEvents.splice(
        0,
        deliveredEventCount,
      )
    }
    return deliveredEventCount
  }
  const gaitAmounts = createAlsPoseState()
  const layeringState = resolveAlsLayeringState(publishedCurves)
  const state: AlsAnimationInstanceState = {
    layering: layeringState,
    movementBase: movementBaseState,
    feet: feetState,
    view: viewAnimationState,
    spine: spineState,
    transitions: transitionsState,
    dynamicTransitions: dynamicTransitionsState,
    crouchingAmount: 0,
    feetCrossingAmount: 0,
    footLeftLock: 0,
    footRightLock: 0,
    hipsDirectionLockAmount: 0,
    movementDirection: 'Forward',
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

  function SetGroundedEntryMode(
    NewGroundedEntryMode: AlsGroundedEntryModeGameplayTag,
  ) {
    // Notify dispatch occurs after the worker-thread graph update. Retain the
    // value for the next NativeUpdateAnimation boundary.
    if (NewGroundedEntryMode === null) {
      pendingGroundedEntryMode = null
      return
    }
    if (
      NewGroundedEntryMode
      !== 'Als.GroundedEntryMode.FromRoll'
    ) {
      throw new Error(
        `Unsupported GroundedEntryMode gameplay tag: ${
          String(NewGroundedEntryMode)
        }`,
      )
    }
    pendingGroundedEntryMode = 'FromRoll'
  }

  function jump() {
    requestAlsAnimationJump(inAirState)
  }

  function refreshDynamicTransitionsFromGraph(
    controls: AlsAnimationInstanceControls,
  ) {
    return refreshDynamicTransitions(
      dynamicTransitionsState,
      {
        stance: controls.stance,
        scale: controls.scale ?? 1,
        leftFoot: feetState.left,
        rightFoot: feetState.right,
        transitions: transitionsState,
      },
    )
  }

  function PlayQuickStopAnimation(
    controls: AlsAnimationInstanceControls,
  ) {
    const request = resolveQuickStopAnimation({
      rotationMode: controls.rotationMode,
      stance: controls.stance,
      hasInput: controls.hasInput ?? false,
      inputYawAngle: controls.inputYawAngle ?? 0,
      targetYawAngle: controls.targetYawAngle ?? 0,
      actorYawAngle: controls.actorYawAngle ?? 0,
    })
    const clip = clipsByName.get(request.clip)
    if (!clip) return
    queueTransitionAnimation(transitionsState, {
      clip: clip.sampler.clip.name,
      blendInDuration: request.blendInDuration,
      blendOutDuration: request.blendOutDuration,
      playRate: request.playRate,
      startTime: request.startTime,
    })
  }

  function processCrouchingLifecycleEvents(
    controls: AlsAnimationInstanceControls,
  ) {
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
          queueTransitionAnimation(transitionsState, {
            clip: crouchingTransitionRightClip.sampler.clip.name,
            blendInDuration: event.blendInDuration,
            blendOutDuration: event.blendOutDuration,
            playRate: event.playRate,
            startTime: event.startTime,
          })
        }
        continue
      }
      if (event.kind === 'AnimNotify' && event.name === 'StopQuick') {
        crouchingStopQuickNotifyCount++
        PlayQuickStopAnimation(controls)
      }
    }
  }

  function processRifleLifecycleEvents(
    controls: AlsAnimationInstanceControls,
    events = rifleRuntime.lifecycleEvents,
  ) {
    for (const event of events) {
      if (
        event.kind !== 'AnimNotify'
        || (
          event.name !== 'RelaxedToReady'
          && event.name !== 'ReadyToRelaxed'
        )
      ) {
        continue
      }

      // AB_Als_Rifle's transition-start notifies call
      // PlayTransitionLeftAnimation() with its native defaults.
      const clip = controls.stance === 'Crouching'
        ? crouchingTransitionLeftClip
        : standingTransitionLeftClip
      if (!clip) continue
      queueTransitionAnimation(transitionsState, {
        clip: clip.sampler.clip.name,
        blendInDuration: 0.2,
        blendOutDuration: 0.2,
        playRate: 1,
        startTime: 0,
      })
    }
  }

  function processStandingLifecycleEvent(
    event: AlsStandingLifecycleEvent,
    controls: AlsAnimationInstanceControls,
  ) {
    if (event.kind === 'CallFunction') {
      if (event.functionName === 'InitializeStandingMovement') {
        state.standingSprint.sprintTime = 0
        standingGraphRuntime.pivotActive = false
      } else if (event.functionName === 'InitializeTurnInPlace') {
        turnInPlaceState.activationDelay = 0
      } else if (event.functionName === 'RefreshDynamicTransitions') {
        refreshDynamicTransitionsFromGraph(controls)
      } else if (
        event.functionName
          === 'StopTransitionAndTurnInPlaceAnimations'
      ) {
        queueStopTransitionAndTurnInPlaceAnimations(
          transitionsState,
          event.blendOutDuration
            ?? STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION,
        )
      }
      return
    }

    if (event.kind === 'PlayStopTransitionAnimation') {
      const clip = standingStopTransitionClips[event.direction]
      if (clip) {
        queueTransitionAnimation(transitionsState, {
          clip: clip.sampler.clip.name,
          blendInDuration: event.blendInDuration,
          blendOutDuration: event.blendOutDuration,
          playRate: event.playRate,
          startTime: event.startTime,
        })
      }
      return
    }

    if (event.name === 'StopQuick') {
      standingStopQuickNotifyCount++
      PlayQuickStopAnimation(controls)
    }
  }

  function processStandingLifecycleEvents(
    controls: AlsAnimationInstanceControls,
  ) {
    for (const event of standingGraphRuntime.lifecycleEvents) {
      processStandingLifecycleEvent(event, controls)
    }
  }

  function slotAdditiveTypeForClip(
    clip: RuntimeClip,
  ): SlotMontageSample['additiveType'] {
    const additive = compileAuthoredAdditive(clip.sampler.clip)
    if (!additive) return 'none'
    return additive.additiveSpace === 'mesh'
      ? 'rotationOffsetMeshSpace'
      : 'localSpaceBase'
  }

  function createSlotMontageBinding(
    sample: SlotMontageSample,
  ): RuntimeSlotMontageBinding {
    const clip = clipsByName.get(sample.clipKey)
    if (!clip) {
      throw new Error(
        `Slot montage instance ${sample.instanceId} references missing clip `
        + `"${sample.clipKey}"`,
      )
    }

    const expectedAdditiveType = slotAdditiveTypeForClip(clip)
    if (sample.additiveType !== expectedAdditiveType) {
      throw new Error(
        `Slot montage instance ${sample.instanceId} classified `
        + `"${sample.clipKey}" as ${sample.additiveType}; authored ALS content is `
        + expectedAdditiveType,
      )
    }

    const curveKey =
      `Slot.${sample.slotName}.${sample.instanceId}.${sample.clipKey}`
    const entry: EvaluatorLayerEntry = {
      sampler: clip.sampler,
      rootMotion: clip.rootMotion,
      curves: clip.curves,
      curveKey,
      time: sample.sampleTime,
      weight: sample.weight,
      loop: false,
    }
    const additive = compileAuthoredAdditive(clip.sampler.clip)
    let authoredAdditiveEntry:
      EvaluatorAuthoredAdditiveEntry | undefined
    if (additive) {
      if (additive.refFrameIndex !== 0) {
        throw new Error(
          `Slot montage "${sample.clipKey}" requires unsupported authored `
          + `reference frame ${additive.refFrameIndex}`,
        )
      }
      const referencePose = additive.refPoseSeq === 'A_Als_Stand_Pose'
        ? standReference
        : additive.refPoseSeq === 'A_Als_Crouch_Pose'
          ? crouchReference
          : undefined
      if (!referencePose) {
        throw new Error(
          `Slot montage "${sample.clipKey}" references unavailable pose `
          + `"${additive.refPoseSeq}"`,
        )
      }
      authoredAdditiveEntry = {
        sampler: clip.sampler,
        curves: clip.curves,
        curveKey,
        referencePose,
        additiveSpace: additive.additiveSpace,
        time: sample.sampleTime,
        weight: sample.weight,
        loop: false,
      }
    }

    return {
      instanceId: sample.instanceId,
      clip,
      entry,
      authoredAdditiveEntry,
      pose: createMutableUePoseNode(rig.boneCount),
      sample,
    }
  }

  function refreshSlotMontageBindings() {
    standingTurnInPlaceMontages.length = 0
    crouchingTurnInPlaceMontages.length = 0
    transitionSlotBindings.length = 0
    postLocomotionSlotBindings.length = 0
    transitionMontageEntries.length = 0
    transitionMontageAdditiveEntries.length = 0
    postLocomotionMontageEntries.length = 0

    const liveInstanceIds = new Set<number>()
    for (const sample of slotMontageSamples) {
      if (sample.status === 'completed' || sample.weight <= 0) continue
      liveInstanceIds.add(sample.instanceId)
      let binding = slotMontageBindings.get(sample.instanceId)
      if (!binding) {
        binding = createSlotMontageBinding(sample)
        slotMontageBindings.set(sample.instanceId, binding)
      } else if (binding.clip.sampler.clip.name !== sample.clipKey) {
        throw new Error(
          `Slot montage instance ${sample.instanceId} changed source clip`,
        )
      }
      binding.sample = sample
      binding.entry.time = sample.sampleTime
      binding.entry.weight = sample.weight
      binding.entry.loop = false
      if (binding.authoredAdditiveEntry) {
        binding.authoredAdditiveEntry.time = sample.sampleTime
        binding.authoredAdditiveEntry.weight = sample.weight
        binding.authoredAdditiveEntry.loop = false
      } else {
        sampleSequencePoseNode(
          rig,
          binding.clip,
          sample.sampleTime,
          false,
          binding.pose,
        )
      }

      if (sample.slotName === TRANSITION_SLOT_NAME) {
        transitionSlotBindings.push(binding)
      } else if (
        sample.slotName === POST_LOCOMOTION_SLOT_NAME
        && sample.groupName === LOCOMOTION_SLOT_GROUP_NAME
      ) {
        postLocomotionSlotBindings.push(binding)
      } else if (
        sample.slotName === TURN_IN_PLACE_STANDING_SLOT_NAME
      ) {
        standingTurnInPlaceMontages.push({
          pose: binding.pose,
          weight: sample.weight,
        })
      } else if (
        sample.slotName === TURN_IN_PLACE_CROUCHING_SLOT_NAME
      ) {
        crouchingTurnInPlaceMontages.push({
          pose: binding.pose,
          weight: sample.weight,
        })
      }
    }

    for (const instanceId of slotMontageBindings.keys()) {
      if (!liveInstanceIds.has(instanceId)) {
        slotMontageBindings.delete(instanceId)
      }
    }

    const transitionSamples = transitionSlotBindings.map(
      (binding) => binding.sample,
    )
    const weightData = calculateSlotMontageWeight(transitionSamples)
    for (const binding of transitionSlotBindings) {
      const evaluationWeight = getSlotMontageEvaluationWeight(
        binding.sample,
        weightData.totalNodeWeight,
      )
      if (binding.authoredAdditiveEntry) {
        binding.authoredAdditiveEntry.weight = evaluationWeight
        transitionMontageAdditiveEntries.push(
          binding.authoredAdditiveEntry,
        )
      } else {
        binding.entry.weight = evaluationWeight
        transitionMontageEntries.push(binding.entry)
      }
    }

    const postLocomotionWeightData = calculateSlotMontageWeight(
      postLocomotionSlotBindings.map((binding) => binding.sample),
    )
    for (const binding of postLocomotionSlotBindings) {
      if (binding.authoredAdditiveEntry) {
        throw new Error(
          `ALS PostLocomotion montage "${binding.sample.clipKey}" must be `
          + 'non-additive',
        )
      }
      binding.entry.weight = getSlotMontageEvaluationWeight(
        binding.sample,
        postLocomotionWeightData.totalNodeWeight,
      )
      postLocomotionMontageEntries.push(binding.entry)
    }

    turnInPlaceSample = [...slotMontageSamples]
      .reverse()
      .find((sample) => (
        sample.status !== 'completed'
        && (
          sample.slotName === TURN_IN_PLACE_STANDING_SLOT_NAME
          || sample.slotName === TURN_IN_PLACE_CROUCHING_SLOT_NAME
        )
      ))
    activeTurnInPlaceClip = turnInPlaceSample
      ? turnInPlaceClips.get(turnInPlaceSample.clipKey) ?? null
      : null
  }

  function resolveSlotCurves(
    source: ReadonlyMap<string, number>,
    bindings: readonly RuntimeSlotMontageBinding[],
    output: Map<string, number>,
  ) {
    output.clear()
    const samples = bindings.map(
      (binding) => binding.sample,
    )
    if (samples.length === 0) {
      for (const [name, value] of source) output.set(name, value)
      return
    }

    const weightData = calculateSlotMontageWeight(samples)
    for (const [name, value] of source) {
      output.set(name, value * weightData.sourceWeight)
    }
    for (const binding of bindings) {
      const evaluationWeight = getSlotMontageEvaluationWeight(
        binding.sample,
        weightData.totalNodeWeight,
      )
      if (binding.authoredAdditiveEntry) continue
      for (const [name, sampler] of Object.entries(
        binding.clip.curves ?? {},
      )) {
        output.set(
          name,
          (output.get(name) ?? 0)
            + sampler(binding.sample.sampleTime) * evaluationWeight,
        )
      }
    }
    for (const binding of bindings) {
      if (!binding.authoredAdditiveEntry) continue
      const evaluationWeight = getSlotMontageEvaluationWeight(
        binding.sample,
        weightData.totalNodeWeight,
      )
      for (const [name, sampler] of Object.entries(
        binding.clip.curves ?? {},
      )) {
        output.set(
          name,
          (output.get(name) ?? 0)
            + sampler(binding.sample.sampleTime) * evaluationWeight,
        )
      }
    }
  }

  function playMantlingMontage(
    settings: AlsMantlingSettings,
    startTime: number,
  ): AlsMantlingMontagePlayResult | null {
    const montage = settings.Montage
    const clip = clipsByName.get(montage.Sequence)
    if (!clip) return null
    if (montage.SlotName !== POST_LOCOMOTION_SLOT_NAME) {
      throw new Error(
        `${montage.Name} must use ALS's ${POST_LOCOMOTION_SLOT_NAME} Slot`,
      )
    }
    if (clip.sampler.clip.duration !== montage.SequenceLength) {
      throw new Error(
        `${montage.Name} sequence length does not match `
        + `"${montage.Sequence}"`,
      )
    }
    if (slotAdditiveTypeForClip(clip) !== 'none') {
      throw new Error(`${montage.Name} must be a non-additive montage`)
    }
    if (clip.sampler.clip.userData?.bEnableRootMotion !== false) {
      throw new Error(
        `${montage.Name} must leave animation root motion disabled; `
        + 'FAlsRootMotionSource_Mantling owns movement',
      )
    }

    const sample = playSlotMontage(slotMontageClock, {
      clipKey: montage.Sequence,
      clipDuration: montage.SequenceLength,
      slotName: montage.SlotName,
      groupName: LOCOMOTION_SLOT_GROUP_NAME,
      blendInDuration: montage.BlendIn.BlendTime,
      blendOutDuration: montage.BlendOut.BlendTime,
      blendInOption: montage.BlendIn.BlendOption,
      blendOutOption: montage.BlendOut.BlendOption,
      // Montage_Play(Montage) uses instance PlayRate 1, while FMontageSubStepper advances by
      // Instance.PlayRate * Montage.RateScale. Preserve the serialized float exactly.
      playRate: montage.RateScale,
      blendOutTriggerTime: montage.BlendOutTriggerTime,
      startTime,
      additiveType: 'none',
      bEnableRootMotion: false,
      montageDuration: montage.PlayLength,
      segment: {
        StartPos: montage.StartPos,
        AnimStartTime: montage.AnimStartTime,
        AnimEndTime: montage.AnimEndTime,
        AnimPlayRate: montage.AnimPlayRate,
        LoopingCount: montage.LoopingCount,
        SequenceRateScale: montage.SequenceRateScale,
      },
      BranchingPointMarkers: montage.BranchingPointMarkers,
    })
    if (sample.instanceId < 0 || sample.status === 'completed') return null

    // Montage_PlayInternal interrupts every older instance in the Slot Group. Unreal retains
    // their ActiveStateBranchingPoints unchanged during the fade because interrupted instances
    // suppress HandleEvents(); Terminate() dispatches their remaining NotifyEnd callbacks.
    for (const instance of mantlingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') {
        instance.interrupted = true
      }
    }
    for (const instance of rollingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') {
        instance.interrupted = true
      }
    }

    mantlingMontageInstances.set(sample.instanceId, {
      settings,
      sample,
      // FAnimMontageInstance::Initialize leaves ActiveStateBranchingPoints empty. The first
      // Advance() populates it through UpdateActiveStateBranchingPoints(), even when Montage_Play
      // begins inside a notify state.
      activeNotifyIndices: new Set(),
      interrupted: false,
    })
    return {
      instanceId: sample.instanceId,
      duration: montage.PlayLength,
    }
  }

  function getActiveMantlingMontageInstance() {
    const active = slotMontageClock.activeByGroup.get(
      LOCOMOTION_SLOT_GROUP_NAME,
    )?.sample
    if (
      !active
      || active.slotName !== POST_LOCOMOTION_SLOT_NAME
    ) {
      return undefined
    }
    return mantlingMontageInstances.get(active.instanceId)
  }

  function setMantlingMontagePosition(
    settings: AlsMantlingSettings,
    position: number,
  ) {
    const active = getActiveMantlingMontageInstance()
    if (active?.settings.Montage !== settings.Montage) return false
    return setSlotMontagePosition(
      slotMontageClock,
      active.sample.instanceId,
      position,
    ) !== undefined
  }

  function stopActiveMantlingMontage(
    instanceId: number,
    blendOutDuration: number,
    blendOutOption: AlphaBlendOption = 'Linear',
  ) {
    const stopped = stopSlotAnimation(
      slotMontageClock,
      blendOutDuration,
      POST_LOCOMOTION_SLOT_NAME,
      blendOutOption,
    ).some((sample) => sample.instanceId === instanceId)
    if (stopped) {
      // UAnimInstance::Montage_Stop calls FAnimMontageInstance::Stop(..., true). Keep active
      // state branching points frozen until the retained fade reaches Terminate().
      const instance = mantlingMontageInstances.get(instanceId)
      if (instance) instance.interrupted = true
    }
    return stopped
  }

  function stopMantlingMontage(
    settings: AlsMantlingSettings,
    blendOutDuration: number,
  ) {
    const active = getActiveMantlingMontageInstance()
    if (active?.settings.Montage !== settings.Montage) return false
    return stopActiveMantlingMontage(
      active.sample.instanceId,
      blendOutDuration,
    )
  }

  function stopMantlingMontageInstance(
    instanceId: number,
    blendOutDuration: number,
  ) {
    const active = getActiveMantlingMontageInstance()
    if (active?.sample.instanceId !== instanceId) return false
    return stopActiveMantlingMontage(
      instanceId,
      blendOutDuration,
      active.settings.Montage.BlendOut.BlendOption,
    )
  }

  function takeMantlingNotifyEvents() {
    if (pendingMantlingNotifyEvents.length === 0) return []
    return pendingMantlingNotifyEvents.splice(
      0,
      pendingMantlingNotifyEvents.length,
    )
  }

  function isMantlingNotifyActive(
    instance: RuntimeMantlingMontageInstance,
    notifyIndex: number,
    montageTime: number,
  ) {
    const markers = instance.settings.Montage.BranchingPointMarkers
    const begin = markers.find((marker) => (
      marker.NotifyIndex === notifyIndex
      && marker.NotifyEventType === 'Begin'
    ))
    const end = markers.find((marker) => (
      marker.NotifyIndex === notifyIndex
      && marker.NotifyEventType === 'End'
    ))
    return Boolean(
      begin
      && end
      // FAnimMontageInstance::UpdateActiveStateBranchingPoints uses this exact half-open test.
      && montageTime > begin.TriggerTime
      && montageTime <= end.TriggerTime,
    )
  }

  function dispatchMantlingNotifyEvent(
    instanceId: number,
    instance: RuntimeMantlingMontageInstance,
    notifyIndex: number,
    notifyEventType: 'Begin' | 'End',
    triggerTime: number,
  ) {
    const notify = instance.settings.Montage.Notifies[notifyIndex]
    if (!notify) {
      throw new Error(
        `${instance.settings.Montage.Name} references missing notify `
        + `${notifyIndex}`,
      )
    }
    if (notifyEventType === 'Begin') {
      instance.activeNotifyIndices.add(notifyIndex)
    } else {
      instance.activeNotifyIndices.delete(notifyIndex)
    }
    pendingMantlingNotifyEvents.push({
      instanceId,
      mantlingSettings: instance.settings,
      notify,
      notifyEventType,
      triggerTime,
    })
  }

  function updateActiveMantlingNotifyStates(
    instanceId: number,
    instance: RuntimeMantlingMontageInstance,
    montageTime: number,
  ) {
    // UpdateActiveStateBranchingPoints ends no-longer-active states first, in reverse active
    // order, before it begins newly active states in authored notify-index order.
    const activeNotifyIndices = [
      ...instance.activeNotifyIndices,
    ].reverse()
    for (const notifyIndex of activeNotifyIndices) {
      if (!isMantlingNotifyActive(instance, notifyIndex, montageTime)) {
        dispatchMantlingNotifyEvent(
          instanceId,
          instance,
          notifyIndex,
          'End',
          montageTime,
        )
      }
    }
    for (
      let notifyIndex = 0;
      notifyIndex < instance.settings.Montage.Notifies.length;
      notifyIndex += 1
    ) {
      if (
        !instance.activeNotifyIndices.has(notifyIndex)
        && isMantlingNotifyActive(instance, notifyIndex, montageTime)
      ) {
        dispatchMantlingNotifyEvent(
          instanceId,
          instance,
          notifyIndex,
          'Begin',
          montageTime,
        )
      }
    }
  }

  function collectMantlingNotifyEvents() {
    mantlingLastMarkerTimeByInstance.clear()
    for (const event of slotMontageNotifyEvents) {
      const instance = mantlingMontageInstances.get(event.instanceId)
      if (!instance || instance.interrupted) continue

      // HandleEvents updates the active-state set at each branching-point substep before it
      // dispatches the immediate marker itself.
      updateActiveMantlingNotifyStates(
        event.instanceId,
        instance,
        event.marker.TriggerTime,
      )
      dispatchMantlingNotifyEvent(
        event.instanceId,
        instance,
        event.marker.NotifyIndex,
        event.marker.NotifyEventType,
        event.marker.TriggerTime,
      )
      mantlingLastMarkerTimeByInstance.set(
        event.instanceId,
        event.marker.TriggerTime,
      )
    }

    for (const [instanceId, instance] of mantlingMontageInstances) {
      if (
        !instance.interrupted
        && instance.sample.rootMotionPreviousMontageTime
          !== instance.sample.rootMotionMontageTime
        // When Advance ends exactly on a branching point, HandleEvents ran once for that marker;
        // there is no second final-position call that could reactivate a state at its End bound.
        && mantlingLastMarkerTimeByInstance.get(instanceId)
          !== instance.sample.montageTime
      ) {
        // Advance also calls HandleEvents at the final moved position after any marker substeps.
        updateActiveMantlingNotifyStates(
          instanceId,
          instance,
          instance.sample.montageTime,
        )
      }
    }

    getSlotMontageSamples(
      slotMontageClock,
      LOCOMOTION_SLOT_GROUP_NAME,
      locomotionSlotMontageSamples,
    )
    for (const [instanceId, instance] of mantlingMontageInstances) {
      if (
        !locomotionSlotMontageSamples.some(
          (sample) => sample.instanceId === instanceId,
        )
      ) {
        // FAnimMontageInstance::Terminate iterates ActiveStateBranchingPoints in reverse and
        // calls BranchingPointNotifyEnd. This is load-bearing for mantling: StopMantling()
        // deliberately does not clear LocomotionAction because this notify-state teardown owns it.
        const activeNotifyIndices = [
          ...instance.activeNotifyIndices,
        ].reverse()
        for (const notifyIndex of activeNotifyIndices) {
          dispatchMantlingNotifyEvent(
            instanceId,
            instance,
            notifyIndex,
            'End',
            // Terminate() has no crossed marker; expose its retained montage position instead.
            instance.sample.montageTime,
          )
        }
        mantlingMontageInstances.delete(instanceId)
      }
    }
  }

  function playGetUpMontage(name: string) {
    const montage = Object.values(ALS_GETTING_UP_MONTAGES).find(m => m.Name === name)
    if (!montage || !clipsByName.has(montage.Sequence)) return 0
    const sample = playSlotMontage(slotMontageClock,
      createAlsGettingUpSlotMontageRequest(montage === ALS_GETTING_UP_MONTAGES.Back))
    if (sample.instanceId < 0 || sample.status === 'completed') return 0
    for (const instance of mantlingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') instance.interrupted = true
    }
    for (const instance of rollingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') instance.interrupted = true
    }
    getUpMontageInstances.set(sample.instanceId, { montage, sample, activeNotifyIndices: new Set() })
    return montage.SequenceLength
  }

  function collectGetUpNotifyEvents() {
    // The authored Begin marker is -0.0001 s, before Montage_Play's zero start.
    // UE's active-state update enters that already-overlapping state on the first tick.
    for (const instance of getUpMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') continue
      for (const marker of instance.montage.BranchingPointMarkers) {
        if (marker.NotifyEventType !== 'Begin') continue
        const end = instance.montage.BranchingPointMarkers.find(m =>
          m.NotifyIndex === marker.NotifyIndex && m.NotifyEventType === 'End')!
        const previous = instance.sample.rootMotionPreviousMontageTime
        if (previous >= marker.TriggerTime && previous < end.TriggerTime
          && !instance.activeNotifyIndices.has(marker.NotifyIndex)) {
          instance.activeNotifyIndices.add(marker.NotifyIndex)
          pendingGetUpNotifyEvents.push({ notifyEventType: 'Begin', LocomotionAction: 'GettingUp' })
        }
      }
    }
    for (const event of slotMontageNotifyEvents) {
      const instance = getUpMontageInstances.get(event.instanceId)
      if (!instance || instance.sample.blendOutReason === 'interrupted') continue
      const { NotifyIndex, NotifyEventType } = event.marker
      if (NotifyEventType === 'Begin') instance.activeNotifyIndices.add(NotifyIndex)
      else instance.activeNotifyIndices.delete(NotifyIndex)
      pendingGetUpNotifyEvents.push({ notifyEventType: NotifyEventType, LocomotionAction: 'GettingUp' })
    }
    // FAnimMontageInstance::Terminate ends every still-active state, including interruption.
    for (const [id, instance] of getUpMontageInstances) {
      if (instance.sample.status !== 'completed') continue
      for (const _index of instance.activeNotifyIndices) {
        pendingGetUpNotifyEvents.push({ notifyEventType: 'End', LocomotionAction: 'GettingUp' })
      }
      getUpMontageInstances.delete(id)
    }
  }

  function isRollingMontagePlaying(Montage: string) {
    if (Montage !== ALS_ROLLING_MONTAGE.Name) return false
    for (const { sample } of rollingMontageInstances.values()) {
      if (sample.status !== 'completed') return true
    }
    return false
  }

  function playRollingMontage(
    Montage: string,
    PlayRate: number,
  ) {
    if (
      Montage !== ALS_ROLLING_MONTAGE.Name
      || !Number.isFinite(PlayRate)
      || !rollClip
      || !rollAuthoredRootMotion
    ) {
      return 0
    }
    if (
      rollClip.sampler.clip.duration
        !== ALS_ROLLING_MONTAGE.SequenceLength
      || ALS_ROLLING_MONTAGE.SlotName
        !== POST_LOCOMOTION_SLOT_NAME
      || slotAdditiveTypeForClip(rollClip) !== 'none'
      || rollAuthoredRootMotion.duration
        !== ALS_ROLL_SEQUENCE.SequenceLength
      || rollAuthoredRootMotion.bEnableRootMotion
        !== ALS_ROLL_SEQUENCE.rootMotion.bEnableRootMotion
      || rollAuthoredRootMotion.bForceRootLock
        !== ALS_ROLL_SEQUENCE.rootMotion.bForceRootLock
      || rollAuthoredRootMotion.RootMotionRootLock
        !== ALS_ROLL_SEQUENCE.rootMotion.RootMotionRootLock
    ) {
      throw new Error(
        `${ALS_ROLLING_MONTAGE.Name} does not match its authored `
        + 'PostLocomotion sequence',
      )
    }

    const sample = playSlotMontage(slotMontageClock, {
      clipKey: ALS_ROLLING_MONTAGE.Sequence,
      clipDuration: ALS_ROLLING_MONTAGE.SequenceLength,
      slotName: ALS_ROLLING_MONTAGE.SlotName,
      groupName: ALS_ROLLING_MONTAGE.GroupName,
      blendInDuration: ALS_ROLLING_MONTAGE.BlendIn.BlendTime,
      blendOutDuration: ALS_ROLLING_MONTAGE.BlendOut.BlendTime,
      blendInOption: ALS_ROLLING_MONTAGE.BlendIn.BlendOption,
      blendOutOption: ALS_ROLLING_MONTAGE.BlendOut.BlendOption,
      // FAnimMontageInstance advances by Instance.PlayRate * UAnimMontage::RateScale.
      playRate: PlayRate * ALS_ROLLING_MONTAGE.RateScale,
      blendOutTriggerTime: ALS_ROLLING_MONTAGE.BlendOutTriggerTime,
      startTime: 0,
      additiveType: 'none',
      bEnableRootMotion:
        ALS_ROLL_SEQUENCE.rootMotion.bEnableRootMotion,
      montageDuration: ALS_ROLLING_MONTAGE.PlayLength,
      segment: {
        StartPos: ALS_ROLLING_MONTAGE.StartPos,
        AnimStartTime: ALS_ROLLING_MONTAGE.AnimStartTime,
        AnimEndTime: ALS_ROLLING_MONTAGE.AnimEndTime,
        AnimPlayRate: ALS_ROLLING_MONTAGE.AnimPlayRate,
        LoopingCount: ALS_ROLLING_MONTAGE.LoopingCount,
        SequenceRateScale:
          ALS_ROLLING_MONTAGE.SequenceRateScale,
      },
      BranchingPointMarkers:
        ALS_ROLLING_MONTAGE.BranchingPointMarkers,
    })
    if (sample.instanceId < 0 || sample.status === 'completed') {
      return 0
    }

    for (const instance of mantlingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') {
        instance.interrupted = true
      }
    }
    for (const instance of rollingMontageInstances.values()) {
      if (instance.sample.blendOutReason === 'interrupted') {
        instance.interrupted = true
      }
    }
    rollingMontageInstances.set(sample.instanceId, {
      sample,
      activeNotifyIndices: new Set(),
      rootMotionScaleActive: false,
      interrupted: false,
    })

    // Montage_Play() defaults to EMontagePlayReturnType::MontageLength.
    // Character only installs Rolling after this positive authored length.
    return ALS_ROLLING_MONTAGE.PlayLength
  }

  function takeRollingNotifyEvents() {
    if (pendingRollingNotifyEvents.length === 0) return []
    return pendingRollingNotifyEvents.splice(
      0,
      pendingRollingNotifyEvents.length,
    )
  }

  function dispatchRollingLocomotionActionEvent(
    instanceId: number,
    instance: RuntimeRollingMontageInstance,
    notifyIndex: number,
    notifyEventType: 'Begin' | 'End',
    triggerTime: number,
  ) {
    const notify = ALS_ROLLING_MONTAGE.Notifies[notifyIndex]
    if (!notify) {
      throw new Error(
        `${ALS_ROLLING_MONTAGE.Name} references missing notify `
        + `${notifyIndex}`,
      )
    }
    if (notifyEventType === 'Begin') {
      instance.activeNotifyIndices.add(notifyIndex)
    } else {
      instance.activeNotifyIndices.delete(notifyIndex)
    }
    pendingRollingNotifyEvents.push({
      instanceId,
      montage: ALS_ROLLING_MONTAGE.Name,
      sequence: ALS_ROLL_SEQUENCE.Name,
      notifyClass: notify.StateClassType,
      notifyEventType,
      triggerTime,
      LocomotionAction: notify.LocomotionAction,
    })
  }

  function isRollingLocomotionActionNotifyActive(
    notifyIndex: number,
    montageTime: number,
  ) {
    const begin = ALS_ROLLING_MONTAGE.BranchingPointMarkers.find(
      (marker) => (
        marker.NotifyIndex === notifyIndex
        && marker.NotifyEventType === 'Begin'
      ),
    )
    const end = ALS_ROLLING_MONTAGE.BranchingPointMarkers.find(
      (marker) => (
        marker.NotifyIndex === notifyIndex
        && marker.NotifyEventType === 'End'
      ),
    )
    return Boolean(
      begin
      && end
      && montageTime > begin.TriggerTime
      && montageTime <= end.TriggerTime,
    )
  }

  function updateActiveRollingLocomotionActionNotifyStates(
    instanceId: number,
    instance: RuntimeRollingMontageInstance,
    montageTime: number,
  ) {
    for (const notifyIndex of [
      ...instance.activeNotifyIndices,
    ].reverse()) {
      if (
        !isRollingLocomotionActionNotifyActive(
          notifyIndex,
          montageTime,
        )
      ) {
        dispatchRollingLocomotionActionEvent(
          instanceId,
          instance,
          notifyIndex,
          'End',
          montageTime,
        )
      }
    }
    for (
      let notifyIndex = 0;
      notifyIndex < ALS_ROLLING_MONTAGE.Notifies.length;
      notifyIndex += 1
    ) {
      if (
        !instance.activeNotifyIndices.has(notifyIndex)
        && isRollingLocomotionActionNotifyActive(
          notifyIndex,
          montageTime,
        )
      ) {
        dispatchRollingLocomotionActionEvent(
          instanceId,
          instance,
          notifyIndex,
          'Begin',
          montageTime,
        )
      }
    }
  }

  function dispatchRollingRootMotionScaleEvent(
    instanceId: number,
    instance: RuntimeRollingMontageInstance,
    notifyEventType: 'Begin' | 'End',
    triggerTime: number,
  ) {
    instance.rootMotionScaleActive = notifyEventType === 'Begin'
    const notify = ALS_ROLL_SEQUENCE.RootMotionScaleNotify
    pendingRollingNotifyEvents.push({
      instanceId,
      montage: ALS_ROLLING_MONTAGE.Name,
      sequence: ALS_ROLL_SEQUENCE.Name,
      notifyClass: notify.StateClassType,
      notifyEventType,
      triggerTime,
      TranslationScale: notify.TranslationScale,
    })
  }

  function collectRollingSequenceNotifyEvents(
    instanceId: number,
    instance: RuntimeRollingMontageInstance,
  ) {
    const sample = instance.sample
    const rootMotionScale =
      ALS_ROLL_SEQUENCE.RootMotionScaleNotify
    if (instance.interrupted) {
      if (instance.rootMotionScaleActive) {
        dispatchRollingRootMotionScaleEvent(
          instanceId,
          instance,
          'End',
          sample.sourceNotifyCurrentTime,
        )
      }
      return
    }
    const startTriggerTime =
      rootMotionScale.StartTime
      + rootMotionScale.TriggerTimeOffset
    const endTriggerTime =
      rootMotionScale.EndTime
      + rootMotionScale.EndTriggerTimeOffset
    if (
      !instance.rootMotionScaleActive
      && sample.notifyWeight
        >= rootMotionScale.TriggerWeightThreshold
      && sample.sourceNotifyCurrentTime > startTriggerTime
      && sample.sourceNotifyPreviousTime < endTriggerTime
    ) {
      dispatchRollingRootMotionScaleEvent(
        instanceId,
        instance,
        'Begin',
        startTriggerTime,
      )
    }
    if (
      rollSequenceNotifyTrack
      && (
        sample.notifyPreviousWeight > 0
        || sample.weight > 0
      )
      && canGatherSlotMontageSequenceNotifies(sample)
    ) {
      rollingGatheredSequenceNotifies.length = 0
      gatherSequenceNotifiesFromDeltaPositions(
        rollSequenceNotifyTrack,
        sample.sourceNotifyPreviousTime,
        sample.sourceNotifyCurrentTime,
        {
          bAllowLooping: false,
          bSrcIsLeader: true,
          InstanceWeight: sample.notifyWeight,
        },
        rollingGatheredSequenceNotifies,
      )
      for (const notify of rollingGatheredSequenceNotifies) {
        if (
          notify.NotifyName
            === ALS_ROLL_SEQUENCE.GroundedEntryModeNotify.NotifyName
        ) {
          const groundedEntry =
            ALS_ROLL_SEQUENCE.GroundedEntryModeNotify
          pendingRollingNotifyEvents.push({
            instanceId,
            montage: ALS_ROLLING_MONTAGE.Name,
            sequence: ALS_ROLL_SEQUENCE.Name,
            notifyClass: groundedEntry.NotifyClassType,
            notifyEventType: 'Notify',
            triggerTime:
              notify.Time + notify.TriggerTimeOffset,
            GroundedEntryMode:
              groundedEntry.GroundedEntryMode,
          })
        }
      }
    }

    if (
      instance.rootMotionScaleActive
      && sample.sourceNotifyPreviousTime < endTriggerTime
      && sample.sourceNotifyCurrentTime >= endTriggerTime
    ) {
      dispatchRollingRootMotionScaleEvent(
        instanceId,
        instance,
        'End',
        endTriggerTime,
      )
    }
  }

  function refreshExtractedRollingRootMotion() {
    const bindings = rollAuthoredRootMotion
      ? slotMontageSamples.flatMap((sample) => (
          rollingMontageInstances.has(sample.instanceId)
            ? [{
                sample,
                rootMotion: rollAuthoredRootMotion,
              }]
            : []
        ))
      : []
    accumulateSlotMontageRootMotion(
      bindings,
      // UAnimInstance extracts the authored transform unchanged. The
      // character applies AnimRootMotionTranslationScale after consumption.
      {},
      extractedRollingRootMotionFrame,
    )
    // The browser render clock may update animation more than once before
    // CharacterMovement's fixed step consumes it. UAnimInstance retains every
    // extracted delta until ConsumeExtractedRootMotion(), so compose rather
    // than overwrite those unconsumed frame ranges.
    accumulateRootMotion(
      extractedRollingRootMotion,
      extractedRollingRootMotionFrame,
    )
  }

  function ConsumeExtractedRollingRootMotion(
    Out = createRootMotionMovementParams(),
  ) {
    if (Out === extractedRollingRootMotion) {
      throw new Error(
        'ConsumeExtractedRootMotion output must not alias its source',
      )
    }
    clearRootMotionMovementParams(Out)
    if (extractedRollingRootMotion.valid) {
      Out.translation.set(extractedRollingRootMotion.translation)
      Out.rotation.set(extractedRollingRootMotion.rotation)
      Out.scale.set(extractedRollingRootMotion.scale)
      Out.valid = true
      Out.blendWeight = extractedRollingRootMotion.blendWeight
    }
    clearRootMotionMovementParams(extractedRollingRootMotion)
    return Out
  }

  function collectRollingNotifyEvents() {
    rollingLastMarkerTimeByInstance.clear()
    for (const event of slotMontageNotifyEvents) {
      const instance = rollingMontageInstances.get(event.instanceId)
      if (!instance || instance.interrupted) continue
      updateActiveRollingLocomotionActionNotifyStates(
        event.instanceId,
        instance,
        event.marker.TriggerTime,
      )
      dispatchRollingLocomotionActionEvent(
        event.instanceId,
        instance,
        event.marker.NotifyIndex,
        event.marker.NotifyEventType,
        event.marker.TriggerTime,
      )
      rollingLastMarkerTimeByInstance.set(
        event.instanceId,
        event.marker.TriggerTime,
      )
    }

    for (const [instanceId, instance] of rollingMontageInstances) {
      if (
        !instance.interrupted
        && instance.sample.rootMotionPreviousMontageTime
          !== instance.sample.rootMotionMontageTime
        && rollingLastMarkerTimeByInstance.get(instanceId)
          !== instance.sample.montageTime
      ) {
        updateActiveRollingLocomotionActionNotifyStates(
          instanceId,
          instance,
          instance.sample.montageTime,
        )
      }
      collectRollingSequenceNotifyEvents(instanceId, instance)
    }

    getSlotMontageSamples(
      slotMontageClock,
      LOCOMOTION_SLOT_GROUP_NAME,
      locomotionSlotMontageSamples,
    )
    for (const [instanceId, instance] of rollingMontageInstances) {
      if (
        locomotionSlotMontageSamples.some(
          (sample) => sample.instanceId === instanceId,
        )
      ) {
        continue
      }
      if (instance.rootMotionScaleActive) {
        dispatchRollingRootMotionScaleEvent(
          instanceId,
          instance,
          'End',
          instance.sample.sourceNotifyCurrentTime,
        )
      }
      for (const notifyIndex of [
        ...instance.activeNotifyIndices,
      ].reverse()) {
        dispatchRollingLocomotionActionEvent(
          instanceId,
          instance,
          notifyIndex,
          'End',
          instance.sample.montageTime,
        )
      }
      rollingMontageInstances.delete(instanceId)
    }
  }

  function processQueuedTransitionAndTurnInPlaceAnimations() {
    // NativePostUpdateAnimation order: play queued transition, play queued turn, stop queued Slots.
    const queuedTransition = takeQueuedTransitionAnimation(
      transitionsState,
    )
    if (queuedTransition) {
      const clip = clipsByName.get(queuedTransition.clip)
      if (clip) {
        clip.time = 0
        clip.entry.time = 0
        clip.entry.loop = false
        playSlotAnimationAsDynamicMontage(
          slotMontageClock,
          {
            clipKey: clip.sampler.clip.name,
            clipDuration: clip.sampler.clip.duration,
            slotName: TRANSITION_SLOT_NAME,
            groupName: GROUNDED_SLOT_GROUP_NAME,
            blendInDuration: queuedTransition.blendInDuration,
            blendOutDuration: queuedTransition.blendOutDuration,
            playRate: queuedTransition.playRate,
            loopCount: 1,
            blendOutTriggerTime: 0,
            startTime: queuedTransition.startTime,
            additiveType: slotAdditiveTypeForClip(clip),
            bEnableRootMotion:
              clip.sampler.clip.userData?.bEnableRootMotion === true,
          },
        )
      }
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
        playSlotAnimationAsDynamicMontage(
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
            additiveType: slotAdditiveTypeForClip(clip),
            bEnableRootMotion:
              clip.sampler.clip.userData?.bEnableRootMotion === true,
          },
        )
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

  function nativePostUpdateAnimation() {
    processQueuedTransitionAndTurnInPlaceAnimations()
    pendingUpdate = false
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
    const previousTime = source.clip.time

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
    queueFootstepEffectsForClipRange(
      source.clip,
      previousTime,
      source.clip.time,
      false,
      1,
    )
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

  function resetLocomotionPlayer(
    player: RuntimeLocomotionSequencePlayer,
  ) {
    player.time = player.startPosition
    player.weight = 0
    if (player.clip) {
      sampleSequencePoseNode(
        rig,
        player.clip,
        player.time,
        player.loop,
        player.node,
      )
    }
  }

  function resetLocomotionGroup(
    group: RuntimeLocomotionSyncGroup,
  ) {
    group.leaderKey = null
    for (const player of group.members) resetLocomotionPlayer(player)
  }

  function resetLocomotionPlayers(
    group: RuntimeLocomotionSyncGroup,
    players: readonly RuntimeLocomotionSequencePlayer[],
  ) {
    if (players.some((player) => player.key === group.leaderKey)) {
      group.leaderKey = null
    }
    for (const player of players) resetLocomotionPlayer(player)
  }

  function advanceLocomotionPlayer(
    player: RuntimeLocomotionSequencePlayer,
    delta: number,
  ) {
    const duration = player.clip?.sampler.clip.duration ?? 0
    if (duration <= 0) {
      player.time = 0
      return
    }
    const nextTime = player.time + Math.max(0, delta) * player.playRate
    player.time = player.loop
      ? ((nextTime % duration) + duration) % duration
      : Math.max(0, Math.min(duration, nextTime))
  }

  function advanceLocomotionSyncGroup(
    group: RuntimeLocomotionSyncGroup,
    delta: number,
  ) {
    let leader: RuntimeLocomotionSequencePlayer | null = null
    for (const player of group.members) {
      if (player.weight <= 0) continue
      if (
        !leader
        || player.weight > leader.weight
        || (
          player.weight === leader.weight
          && player.key === group.leaderKey
        )
      ) {
        leader = player
      }
    }
    if (!leader) {
      group.leaderKey = null
      return
    }

    group.leaderKey = leader.key
    advanceLocomotionPlayer(leader, delta)
    const leaderDuration = leader.clip?.sampler.clip.duration ?? 0
    const normalizedTime =
      leaderDuration > 0 ? leader.time / leaderDuration : 0
    for (const follower of group.members) {
      if (follower === leader || follower.weight <= 0) continue
      const duration = follower.clip?.sampler.clip.duration ?? 0
      follower.time = Math.max(0, Math.min(duration, normalizedTime * duration))
    }
  }

  function sampleLocomotionSequencePlayers() {
    for (const player of locomotionSequencePlayers) {
      if (!player.clip) continue
      sampleSequencePoseNode(
        rig,
        player.clip,
        player.time,
        player.loop,
        player.node,
      )
    }
  }

  function mapRangeClamped(
    value: number,
    inputMinimum: number,
    inputMaximum: number,
    outputMinimum: number,
    outputMaximum: number,
  ) {
    if (inputMinimum === inputMaximum) return outputMinimum
    const alpha = clamp01(
      (value - inputMinimum) / (inputMaximum - inputMinimum),
    )
    return outputMinimum + (outputMaximum - outputMinimum) * alpha
  }

  function nextGraphInterpolatedAmount(
    state: { readonly value: number; readonly initialized: boolean },
    target: number,
    delta: number,
    interpolationSpeedIncreasing: number,
    interpolationSpeedDecreasing: number,
  ) {
    if (!state.initialized) return target
    const speed = target > state.value
      ? interpolationSpeedIncreasing
      : interpolationSpeedDecreasing
    if (speed <= 0) return target
    return state.value
      + (target - state.value) * clamp01(Math.max(0, delta) * speed)
  }

  function mostRelevantRemainingTime(
    players: readonly RuntimeLocomotionSequencePlayer[],
  ) {
    let maximumWeight = 0
    let remainingTime = Number.POSITIVE_INFINITY
    for (const player of players) {
      if (player.weight <= maximumWeight || !player.clip) continue
      maximumWeight = player.weight
      remainingTime = Math.max(
        0,
        player.clip.sampler.clip.duration - player.time,
      )
    }
    return remainingTime
  }

  function predictLocomotionPoseState(
    input: AlsLocomotionPoseGraphInput,
  ) {
    let predictedState = locomotionPoseGraphRuntime.relevant
      ? locomotionPoseGraphRuntime.outerTransitionStack.currentState
      : 'Grounded' as AlsLocomotionPoseState
    for (
      let transitionCount = 0;
      transitionCount < 3;
      transitionCount++
    ) {
      const resolved = resolveAlsLocomotionTransition(
        predictedState,
        {
          locomotionMode: input.locomotionMode,
          jumped: input.jumped,
          stance: input.stance,
          hasInput: input.hasInput,
          rotatingLeft: input.rotatingLeft,
          rotatingRight: input.rotatingRight,
          speed: input.speed,
          landRemainingTime: input.clocks.landRemainingTime,
          landMovementRelevantAnimTimeRemaining:
            input.clocks.landMovementRelevantAnimTimeRemaining,
        },
      )
      if (!resolved) break
      predictedState = resolved.targetState
    }
    return predictedState
  }

  function resetLocomotionPlayersForEntry(
    previousState: AlsLocomotionPoseState,
    nextState: AlsLocomotionPoseState,
  ) {
    if (previousState === nextState) return
    const alreadyActive = getAlsLocomotionStateWeight(
      locomotionPoseGraphRuntime,
      nextState,
    ) > 0
    if (alreadyActive && nextState !== 'Jump') return

    if (nextState === 'Fall') {
      resetLocomotionGroup(locomotionSyncGroups.Fall)
      resetLocomotionPlayer(fallFlailPlayer)
    } else if (nextState === 'Jump') {
      resetLocomotionGroup(locomotionSyncGroups.Jump)
      resetLocomotionGroup(locomotionSyncGroups.Flail)
    } else if (nextState === 'Land') {
      resetLocomotionPlayers(
        locomotionSyncGroups.Land,
        [landLightPlayer, landHeavyPlayer],
      )
    } else if (nextState === 'Land Movement') {
      resetLocomotionPlayers(
        locomotionSyncGroups.Land,
        [landMovementLightPlayer, landMovementHeavyPlayer],
      )
    }
  }

  function reinitializeLocomotionSequencePlayers() {
    for (const player of locomotionSequencePlayers) {
      resetLocomotionPlayer(player)
    }
    for (const group of Object.values(locomotionSyncGroups)) {
      group.leaderKey = null
    }
  }

  function refreshLocomotionPlayerWeights(
    referencedStates: ReadonlySet<AlsLocomotionPoseState>,
    input: AlsLocomotionPoseGraphInput,
  ) {
    for (const player of locomotionSequencePlayers) player.weight = 0

    if (referencedStates.has('Fall')) {
      const stateWeight = getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Fall',
      )
      const verticalVelocity = input.verticalVelocity * 100
      const fallSettings =
        ALS_LOCOMOTION_INTERNAL_BLEND_METADATA.fall
      const fallTarget = mapRangeClamped(
        verticalVelocity,
        fallSettings.fallFastBlend.inputMinimum,
        fallSettings.fallFastBlend.inputMaximum,
        fallSettings.fallFastBlend.outputMinimum,
        fallSettings.fallFastBlend.outputMaximum,
      )
      const flailTarget = mapRangeClamped(
        verticalVelocity,
        fallSettings.flailBlend.inputMinimum,
        fallSettings.flailBlend.inputMaximum,
        fallSettings.flailBlend.outputMinimum,
        fallSettings.flailBlend.outputMaximum,
      )
      const fallAmount = clamp01(nextGraphInterpolatedAmount(
        locomotionPoseGraphRuntime.inAirGraphState.fallFastBlend,
        fallTarget,
        input.deltaTime,
        fallSettings.fallFastBlend.interpolationSpeedIncreasing,
        fallSettings.fallFastBlend.interpolationSpeedDecreasing,
      ))
      const flailAmount = clamp01(nextGraphInterpolatedAmount(
        locomotionPoseGraphRuntime.inAirGraphState.fallFlailBlend,
        flailTarget,
        input.deltaTime,
        fallSettings.flailBlend.interpolationSpeedIncreasing,
        fallSettings.flailBlend.interpolationSpeedDecreasing,
      ))
      fallFastPlayer.weight =
        stateWeight * (1 - fallAmount) * (1 - flailAmount)
      fallPlayer.weight =
        stateWeight * fallAmount * (1 - flailAmount)
      fallFlailPlayer.weight = stateWeight * flailAmount
    }

    if (referencedStates.has('Jump')) {
      const stateWeight = getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Jump',
      )
      jumpWalkLeftPlayer.playRate = input.jumpPlayRate
      jumpRunLeftPlayer.playRate = input.jumpPlayRate
      jumpWalkRightPlayer.playRate = input.jumpPlayRate
      jumpRunRightPlayer.playRate = input.jumpPlayRate
      jumpLoopPlayer.playRate = input.jumpPlayRate
      const currentJumpClock =
        locomotionPoseGraphRuntime.inAirGraphState.jumpState
      const samplingJumpClock = { ...currentJumpClock }
      let jumpState = locomotionPoseGraphRuntime.jumpRelevant
        ? samplingJumpClock.state
        : input.footPlantedAmount > 0 ? 'Right Foot' : 'Left Foot'
      if (
        locomotionPoseGraphRuntime.jumpRelevant
        && !locomotionPoseGraphRuntime.jumpSkipFirstUpdate
      ) {
        refreshAlsJumpStateClock(samplingJumpClock, {
          deltaTime: input.deltaTime,
          launchRemainingTime: input.clocks.jumpLaunchRemainingTime,
        })
        jumpState = samplingJumpClock.state
      }
      if (jumpState === 'Left Foot' || jumpState === 'Right Foot') {
        const launchSettings =
          ALS_LOCOMOTION_INTERNAL_BLEND_METADATA.jump.launchBlend
        const runTarget = mapRangeClamped(
          input.speed * 100,
          launchSettings.inputMinimum,
          launchSettings.inputMaximum,
          launchSettings.outputMinimum,
          launchSettings.outputMaximum,
        )
        const launchState = jumpState === 'Left Foot'
          ? locomotionPoseGraphRuntime.inAirGraphState.jumpLaunchLeftBlend
          : locomotionPoseGraphRuntime.inAirGraphState.jumpLaunchRightBlend
        const runAmount = clamp01(nextGraphInterpolatedAmount(
          launchState,
          runTarget,
          input.deltaTime,
          launchSettings.interpolationSpeedIncreasing,
          launchSettings.interpolationSpeedDecreasing,
        ))
        const walkPlayer = jumpState === 'Left Foot'
          ? jumpWalkLeftPlayer
          : jumpWalkRightPlayer
        const runPlayer = jumpState === 'Left Foot'
          ? jumpRunLeftPlayer
          : jumpRunRightPlayer
        walkPlayer.weight = stateWeight * (1 - runAmount)
        runPlayer.weight = stateWeight * runAmount
      } else {
        jumpLoopPlayer.weight =
          stateWeight * samplingJumpClock.loopWeight
        jumpFlailPlayer.weight =
          stateWeight * samplingJumpClock.flailWeight
        if (jumpState === 'Loop' && !samplingJumpClock.loopToFlailActive) {
          jumpLoopPlayer.weight = stateWeight
        } else if (jumpState === 'Flail') {
          jumpFlailPlayer.weight = stateWeight
        }
      }
    }

    if (referencedStates.has('Land')) {
      const stateWeight = getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Land',
      )
      const land = sampleAlsLandGraph({
        verticalVelocity: input.verticalVelocity,
      })
      landLightPlayer.weight = stateWeight * land.landLightWeight
      landHeavyPlayer.weight = stateWeight * land.landHeavyWeight
    }

    if (referencedStates.has('Land Movement')) {
      const stateWeight = getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Land Movement',
      )
      const settings =
        ALS_LOCOMOTION_INTERNAL_BLEND_METADATA.landMovement.additiveBlend
      const heavyAmount = clamp01(mapRangeClamped(
        input.verticalVelocity * 100,
        settings.inputMinimum,
        settings.inputMaximum,
        settings.outputMinimum,
        settings.outputMaximum,
      ))
      landMovementLightPlayer.weight =
        stateWeight * (1 - heavyAmount)
      landMovementHeavyPlayer.weight =
        stateWeight * heavyAmount
    }
  }

  function advanceLocomotionPlayers(
    input: AlsLocomotionPoseGraphInput,
  ) {
    const referencedStates = new Set<AlsLocomotionPoseState>([
      locomotionPoseGraphRuntime.outerTransitionStack.currentState,
    ])
    for (
      const transition
      of locomotionPoseGraphRuntime.outerTransitionStack.activeTransitions
    ) {
      referencedStates.add(transition.previousState)
      referencedStates.add(transition.nextState)
    }
    refreshLocomotionPlayerWeights(referencedStates, input)
    locomotionSequencePreviousTimes.clear()
    for (const player of locomotionSequencePlayers) {
      if (
        player.weight > 0
        && player.clip
        && footstepEffectsNotifyTracks.has(
          player.clip.sampler.clip.name,
        )
      ) {
        locomotionSequencePreviousTimes.set(player, player.time)
      }
    }
    advanceLocomotionSyncGroup(locomotionSyncGroups.Fall, input.deltaTime)
    advanceLocomotionSyncGroup(locomotionSyncGroups.Jump, input.deltaTime)
    advanceLocomotionSyncGroup(locomotionSyncGroups.Flail, input.deltaTime)
    advanceLocomotionSyncGroup(locomotionSyncGroups.Land, input.deltaTime)
    if (fallFlailPlayer.weight > 0) {
      advanceLocomotionPlayer(fallFlailPlayer, input.deltaTime)
    }
    for (const group of Object.values(locomotionSyncGroups)) {
      for (const player of group.members) {
        const previousTime =
          locomotionSequencePreviousTimes.get(player)
        const sequenceName = player.clip?.sampler.clip.name
        const runtimeTrack = sequenceName
          ? footstepEffectsNotifyTracks.get(sequenceName)
          : undefined
        if (previousTime === undefined || !runtimeTrack) continue
        queueFootstepEffectsNotifiesFromRange(
          runtimeTrack,
          previousTime,
          player.time,
          {
            bAllowLooping: player.loop,
            bSrcIsLeader: group.leaderKey === player.key,
            InstanceWeight: player.weight,
          },
        )
      }
    }
    sampleLocomotionSequencePlayers()
  }

  function processLocomotionLifecycleEvents() {
    for (const event of locomotionPoseGraphRuntime.lifecycleEvents) {
      if (
        event.kind === 'CallFunction'
        && event.functionName === 'StopTransitionAndTurnInPlaceAnimations'
      ) {
        queueStopTransitionAndTurnInPlaceAnimations(
          transitionsState,
          STOP_TRANSITION_AND_TURN_IN_PLACE_BLEND_OUT_DURATION,
        )
      } else if (
        event.kind === 'AnimNotify'
        && event.name === 'LandToGrounded'
      ) {
        landToGroundedNotifyCount++
      }
    }
  }

  function applyEvaluatedGraphPose(
    result: ReturnType<typeof evaluatePose>,
    locomotionMode: AlsLocomotionMode,
    deltaTime: number,
    captureControlRigComponentPositions = false,
  ) {
    if (import.meta.env.DEV) inspectPoseFinite("layering", result.pose, rig.boneNames)
    const finalCurves = result.curves.values
    gltf.locomotionStates?.onEvaluatePose?.({ stage: 'control-rig-input', rig, pose: result.pose, curves: finalCurves })
    if (controlRigRuntime && feetPoseBridge) {
      evaluateAlsControlRigForwardSolve(controlRigRuntime, {
        isGameWorld: true,
        pose: result.pose,
        curves: finalCurves,
        rigInput: getAlsControlRigInput({
          locomotionMode,
          velocityBlendForwardAmount: velocityBlend.forwardAmount,
          velocityBlendBackwardAmount: velocityBlend.backwardAmount,
          feetTargets: feetPoseBridge.targets,
          spineYawAngle: spineState.yawAngle,
        }),
        deltaTime: Math.max(0, deltaTime),
        trace: gltf.controlRigFootTrace ?? NO_CONTROL_RIG_FOOT_TRACE,
        captureComponentPositionSnapshots:
          captureControlRigComponentPositions,
      })
    }

    gltf.locomotionStates?.onEvaluatePose?.({ stage: 'control-rig-output', rig, pose: result.pose, curves: finalCurves })
    ragdolling.evaluate(result.pose, deltaTime)
    if (import.meta.env.DEV) inspectPoseFinite("control-rig", result.pose, rig.boneNames)
    applyPose(applicator, result.pose)
    publishedCurves.clear()
    for (const [name, value] of finalCurves) {
      publishedCurves.set(name, value)
    }
    return finalCurves
  }

  function refresh(
    delta: number,
    controls: AlsAnimationInstanceControls,
    captureControlRigComponentPositions = false,
  ) {
    if (rig.boneCount === 0) return
    const deltaTime = Math.max(0, delta)
    const pendingUpdateThisFrame = pendingUpdate
    const nextLocomotionAction = controls.locomotionAction ?? null
    if (currentLocomotionAction !== nextLocomotionAction) {
      currentLocomotionAction = nextLocomotionAction
      // UAlsAnimationInstance::NativeUpdateAnimation resets this property
      // whenever AAlsCharacter's LocomotionAction tag changes.
      groundedEntryMode = null
    }
    // Queued sequence notifies dispatch after the preceding animation update.
    // Applying them after the action-change reset preserves ALS's same-frame
    // Rolling End -> FromRoll ordering.
    if (pendingGroundedEntryMode !== undefined) {
      groundedEntryMode = pendingGroundedEntryMode
      pendingGroundedEntryMode = undefined
    }
    const locomotionMode = controls.locomotionMode === undefined
      ? 'Grounded'
      : controls.locomotionMode
    const hasInput = controls.hasInput ?? false
    worldTime += deltaTime

    // NativeUpdateAnimation(): PreviousLocation → MovementBase → View → Locomotion → InAir →
    // Feet → teleport detection. The live bridge has already captured the character-owned View
    // and Locomotion fields into controls at the same post-physics boundary.
    const previousLocation = {
      x: locomotionLocation.x,
      y: locomotionLocation.y,
      z: locomotionLocation.z,
    }
    refreshMovementBaseOnGameThread(
      movementBaseState,
      controls.basedMovement ?? ALS_NO_BASED_MOVEMENT,
    )
    const location = controls.location
    if (location) {
      locomotionLocation.x = location.x
      locomotionLocation.y = location.y
      locomotionLocation.z = location.z
    }
    refreshInAirOnGameThread(inAirState, pendingUpdateThisFrame)
    feetPoseBridge?.capturePublishedPose(feetState)
    if (location) {
      if (shouldMarkAlsTeleported({
        pendingUpdate: pendingUpdateThisFrame,
        previousLocation,
        location: locomotionLocation,
      })) {
        teleportedTime = worldTime
      }
    }

    // NativeThreadSafeUpdateAnimation(): UAnimInstanceProxy exposes the preceding published
    // curve frame here. Those values refresh ALS state before the current graph is evaluated.
    resetDynamicTransitionsFrame(dynamicTransitionsState)
    resetRotateInPlaceFrame(rotateInPlaceState)
    resetTurnInPlaceFrame(turnInPlaceState)
    Object.assign(
      layeringState,
      resolveAlsLayeringState(publishedCurves),
    )
    refreshPose(publishedCurves, gaitAmounts)
    const viewRefresh = refreshViewAnimationState(viewAnimationState, {
      viewBlockAmount: publishedCurves.get(VIEW_BLOCK_CURVE_NAME) ?? 0,
      allowAimingAmount: publishedCurves.get(ALLOW_AIMING_CURVE_NAME) ?? 0,
      locomotionAction: controls.locomotionAction,
      viewYawAngle: (controls.actorYawAngle ?? 0) + controls.viewYawAngle,
      viewPitchAngle: controls.viewPitchAngle ?? 0,
      locomotionYawAngle: controls.actorYawAngle ?? 0,
      viewYawSpeed: controls.viewYawSpeed,
    })
    refreshSpine(spineState, {
      spineRotationAllowed: controls.rotationMode === 'Aiming',
      spineBlendAmount: viewRefresh.spineBlendAmount,
      viewYawAngle: viewAnimationState.yawAngle,
      viewYawSpeed: viewAnimationState.yawSpeed,
      deltaTime,
      pendingUpdate: pendingUpdateThisFrame,
      actorYawAngle: controls.actorYawAngle ?? 0,
      movementBaseHasRelativeRotation:
        movementBaseState.hasRelativeRotation,
      movementBaseDeltaRotationYaw:
        movementBaseState.deltaRotation.yaw,
    })
    previousFootPlantedAmount = Math.max(
      -1,
      Math.min(
        1,
        publishedCurves.get(FOOT_PLANTED_CURVE_NAME) ?? 0,
      ),
    )
    feetPoseBridge?.refresh(feetState, {
      deltaTime,
      pendingUpdate: pendingUpdateThisFrame,
      timeSinceTeleported: worldTime - teleportedTime,
      baseChanged: movementBaseState.baseChanged,
      movementBase: movementBaseState,
      movingSmooth: controls.movingSmooth && !consumerLocomotion.allowsMovingFootLock(),
      grounded: locomotionMode === 'Grounded',
      disableFootLock: false,
      footLockAngleLimit: ALS_DEFAULT_FOOT_LOCK_ANGLE_LIMIT,
      footPlantedCurveAmount:
        publishedCurves.get(FOOT_PLANTED_CURVE_NAME) ?? 0,
      feetCrossingCurveAmount:
        publishedCurves.get(FEET_CROSSING_CURVE_NAME) ?? 0,
      footLeftIkCurveAmount:
        publishedCurves.get(FOOT_LEFT_IK_CURVE_NAME) ?? 0,
      footRightIkCurveAmount:
        publishedCurves.get(FOOT_RIGHT_IK_CURVE_NAME) ?? 0,
      footLeftLockCurveAmount:
        publishedCurves.get(FOOT_LEFT_LOCK_CURVE_NAME) ?? 0,
      footRightLockCurveAmount:
        publishedCurves.get(FOOT_RIGHT_LOCK_CURVE_NAME) ?? 0,
    })
    refreshTransitions(
      transitionsState,
      publishedCurves.get(ALLOW_TRANSITIONS_CURVE_NAME) ?? 0,
    )

    previousGroundPredictionBlockAmount = clamp01(
      publishedCurves.get(GROUND_PREDICTION_BLOCK_CURVE_NAME) ?? 0,
    )
    state.hipsDirectionLockAmount = Math.max(
      -1,
      Math.min(
        1,
        publishedCurves.get(HIPS_DIRECTION_LOCK_CURVE_NAME) ?? 0,
      ),
    )
    state.standingSprint.sprintBlockAmount = clamp01(
      publishedCurves.get(SPRINT_BLOCK_CURVE_NAME) ?? 0,
    )
    state.crouchingAmount = gaitAmounts.crouchingAmount
    state.footLeftLock = feetState.left.lockAmount
    state.footRightLock = feetState.right.lockAmount
    state.feetCrossingAmount = feetState.feetCrossingAmount
    mainInput.deltaTime = delta
    fallbackInput.deltaTime = delta
    soloInput.deltaTime = delta
    const jumpedThisFrame = inAirState.jumped
    if (!locomotionPoseGraphRuntime.relevant) {
      // AB_Als_Locomotion node3 calls InitializeLean on becoming relevant before its state update
      // functions refresh the same values for this frame.
      leanState.rightAmount = 0
      leanState.forwardAmount = 0
    }
    if (locomotionMode === 'InAir') {
      const velocity = controls.velocity
      const location = controls.location
      const capsuleRadius = controls.capsuleRadius
      const capsuleHalfHeight = controls.capsuleHalfHeight
      const walkableFloorAngleCos = controls.walkableFloorAngleCos
      if (
        !velocity
        || !location
        || capsuleRadius === undefined
        || capsuleHalfHeight === undefined
        || walkableFloorAngleCos === undefined
        || !gltf.groundPredictionSweep
      ) {
        throw new Error(
          'Live InAir evaluation requires the ALS character state and ground-prediction sweep',
        )
      }
      refreshInAir(inAirState, {
        speed: Math.max(0, controls.speed),
        verticalVelocity: velocity.z,
      })
      refreshGroundPrediction(inAirState, {
        location,
        velocity,
        scale: controls.scale ?? 1,
        capsuleRadius,
        capsuleHalfHeight,
        walkableFloorAngleCos,
        groundPredictionBlockCurveValue:
          previousGroundPredictionBlockAmount,
        groundPredictionAmountCurve: sampleGroundPredictionAmount,
        sweepCapsule: gltf.groundPredictionSweep,
      })
      const directionRadians = THREE.MathUtils.degToRad(
        controls.direction,
      )
      refreshInAirLean(leanState, {
        pendingUpdate: pendingUpdateThisFrame,
        deltaTime: Math.max(0, delta),
        relativeVelocity: {
          x: Math.cos(directionRadians) * Math.max(0, controls.speed),
          y: Math.sin(directionRadians) * Math.max(0, controls.speed),
          z: velocity.z,
        },
        verticalVelocity: inAirState.verticalVelocity,
        leanAmountCurve: sampleInAirLeanAmount,
      })
    }
    if (soloClip) {
      // Solo owns its selected clip clock directly. Sync-group membership only has meaning while
      // the graph is evaluating the group; bypassing it here prevents the early return from
      // freezing locomotion clips that happen to be group members.
      advanceClip(soloClip, delta)
      soloClip.entry.time = soloClip.time
      soloClip.entry.weight = 1
      const soloResult = evaluatePose(evaluator, soloInput)
      applyEvaluatedGraphPose(
        soloResult,
        locomotionMode,
        delta,
      )
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
      if (gltf.exposeDebugGlobals !== false && gltf.publishDiagnostics !== false) window.__weightTable = debugWeights
      // Controls may change while the normal graph is dormant. The solo transition request owns
      // the eventual handoff, so do not emit a second overlay request on the first resumed frame.
      previousOverlayMode = controls.overlayMode
      locomotionPoseGraphRuntime.relevant = false
      velocityInitialized = false
      nativePostUpdateAnimation()
      return
    }

    advanceSlotMontageClock(
      slotMontageClock,
      delta,
      slotMontageSamples,
      slotMontageNotifyEvents,
    )
    refreshExtractedRollingRootMotion()
    collectMantlingNotifyEvents()
    collectRollingNotifyEvents()
    collectGetUpNotifyEvents()
    refreshSlotMontageBindings()

    for (const clip of clips) {
      if (
        !syncClips.has(clip)
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
      const previousTime = source.clip.time
      source.clip.time = Math.min(
        source.clip.sampler.clip.duration,
        source.clip.time
          + Math.max(0, delta) * source.sequencePlayRate,
      )
      source.clip.entry.time = source.clip.time
      queueFootstepEffectsForClipRange(
        source.clip,
        previousTime,
        source.clip.time,
        false,
        groundedStanceTransitionSourceWeight,
      )
    }

    if (!complete) {
      if (!fallbackClip) {
        nativePostUpdateAnimation()
        return
      }
      if (syncClips.has(fallbackClip)) advanceClip(fallbackClip, delta)
      fallbackClip.entry.time = fallbackClip.time
      fallbackClip.entry.weight = 1
      const fallbackResult = evaluatePose(evaluator, fallbackInput)
      applyEvaluatedGraphPose(
        fallbackResult,
        locomotionMode,
        delta,
      )
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
      if (gltf.exposeDebugGlobals !== false && gltf.publishDiagnostics !== false) window.__weightTable = debugWeights
      nativePostUpdateAnimation()
      return
    }

    const rawSpeed = Math.max(0, controls.speed)
    const directionRadians = THREE.MathUtils.degToRad(
      controls.direction,
    )
    const velocity = controls.velocity ?? {
      x: Math.cos(directionRadians) * rawSpeed,
      y: Math.sin(directionRadians) * rawSpeed,
      z: 0,
    }
    refreshVelocityBlend(
      velocityBlend,
      velocity,
      THREE.MathUtils.degToRad(controls.actorYawAngle ?? 0),
      delta,
      !velocityInitialized,
      velocityTarget,
    )
    velocityInitialized = true
    if (locomotionMode === 'Grounded') {
      refreshGroundedLean(leanState, {
        pendingUpdate: pendingUpdateThisFrame,
        deltaTime: Math.max(0, delta),
        relativeAccelerationAmount: controls.relativeAccelerationAmount,
      })
    }
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
    for (const clip of stanceStateClips) clip.entry.weight = 0
    const crouching = controls.stance === 'Crouching'
    const targetCrouchingAmount = crouching ? 1 : 0
    const viewMode = controls.viewMode ?? 'ThirdPerson'
    const turnInPlaceAllowed = isTurnInPlaceAllowed(
      controls.rotationMode,
      viewMode,
    )
    const rotateInPlaceAllowed =
      isRotateInPlaceAllowed(controls.rotationMode, viewMode)
      || controls.rotateInPlace

    // NativeThreadSafeUpdateAnimation refreshes this state before Grounded States evaluates its
    // priority-zero direct stance route.
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
      const previousTime = source.clip.time
      source.clip.time = Math.min(
        source.clip.sampler.clip.duration,
        source.clip.time
          + Math.max(0, delta) * source.sequencePlayRate,
      )
      source.clip.entry.time = source.clip.time
      source.clip.entry.loop = false
      queueFootstepEffectsForClipRange(
        source.clip,
        previousTime,
        source.clip.time,
        false,
        1,
      )
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
    graphCrouchingAmount = crouchingAmount
    graphFootLeftLock = stanceTransitionState.footLeftLock
    graphFootRightLock = stanceTransitionState.footRightLock
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
    processCrouchingLifecycleEvents(controls)
    if (
      crouchingGraphRelevant
      && crouchingStateRuntime.stateWeights.Idle > Number.EPSILON
    ) {
      refreshDynamicTransitionsFromGraph(controls)
    }
    for (const request of crouchingStateRuntime.inertializationRequests) {
      crouchingNode34.requestInertialization(request.duration)
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
    const standingGraphWeight =
      (1 - locomotionCrouchingAmount) * stanceTargetWeight
    const crouchingGraphWeight =
      locomotionCrouchingAmount * stanceTargetWeight
    activeStandingGraphWeight = standingGraphWeight
    activeCrouchingGraphWeight = crouchingGraphWeight

    graphGroundedAmount = 1

    const viewRelativeVelocityYawAngle = unwindDegrees(
      controls.direction - controls.viewYawAngle,
    )
    state.movementDirection = refreshMovementDirection(
      controls.rotationMode,
      controls.gait,
      viewRelativeVelocityYawAngle,
    )
    state.directionTransitionRequest = null

    const standingMovement = refreshStandingMovement({
      locomotionSpeed: rawSpeed * 100,
      locomotionScale: controls.scale ?? 1,
      gait: controls.gait,
      poseGaitCurveValue: gaitAmounts.amount,
      poseGroundedCurveValue: gaitAmounts.groundedAmount,
    })
    state.standingMovement = standingMovement
    const rotationYawOffsets = sampleRotationYawOffsets(
      viewRelativeVelocityYawAngle,
    )
    const standingRotateLeftPreviousTime =
      standingGraphRuntime.rotateClocks.left.time
    const standingRotateRightPreviousTime =
      standingGraphRuntime.rotateClocks.right.time
    refreshAlsStandingGraphRuntime(
      standingGraphRuntime,
      {
        relevant:
          activeGroundedStanceState === null
          && standingGraphWeight > Number.EPSILON,
        deltaTime: Math.max(0, delta),
        movementDirection: state.movementDirection,
        hipsDirectionLockAmount: state.hipsDirectionLockAmount,
        feetCrossingAmount: state.feetCrossingAmount,
        velocityBlend,
        movingSmooth: controls.movingSmooth,
        rotatingLeft: rotateInPlaceState.rotatingLeft,
        rotatingRight: rotateInPlaceState.rotatingRight,
        rotateInPlacePlayRate: rotateInPlaceState.playRate,
        gait: controls.gait,
        poseGroundedAmount: gaitAmounts.groundedAmount,
        unweightedGaitRunningAmount:
          gaitAmounts.unweightedRunning,
        standingStatesMachineWeight: standingGraphWeight,
        footPlantedAmount: previousFootPlantedAmount,
        speedCmPerSecond: rawSpeed * 100,
      },
    )
    if (
      standingGraphRuntime.rotateClocks.left.relevant
      && rotateInPlaceClips.Standing.Left
    ) {
      queueFootstepEffectsForClipRange(
        rotateInPlaceClips.Standing.Left,
        standingRotateLeftPreviousTime,
        standingGraphRuntime.rotateClocks.left.time,
        rotateInPlaceState.rotatingLeft,
        standingGraphRuntime.standing.stateWeights['Rotate Left']
          * standingGraphWeight,
      )
    }
    if (
      standingGraphRuntime.rotateClocks.right.relevant
      && rotateInPlaceClips.Standing.Right
    ) {
      queueFootstepEffectsForClipRange(
        rotateInPlaceClips.Standing.Right,
        standingRotateRightPreviousTime,
        standingGraphRuntime.rotateClocks.right.time,
        rotateInPlaceState.rotatingRight,
        standingGraphRuntime.standing.stateWeights['Rotate Right']
          * standingGraphWeight,
      )
    }
    processStandingLifecycleEvents(controls)
    state.hipsDirection = standingGraphRuntime.hipsDirection
    const standingDirectionTransition =
      standingGraphRuntime.direction.lastStartedTransition
    if (standingDirectionTransition) {
      state.directionTransitionRequest = {
        ...standingDirectionTransition,
        moveDirectionChangeProfileApplied: true,
      }
    }
    const standingSprint = refreshStandingSprint(
      state.standingSprint,
      {
        gait: controls.gait,
        deltaTime: Math.max(0, delta),
        sprintBlockCurveValue:
          state.standingSprint.sprintBlockAmount,
        relativeAccelerationAmountX:
          controls.relativeAccelerationAmount.x,
        standingPlayRate: standingMovement.playRate,
        relevant: standingGraphRuntime.movementDetails.relevant,
      },
    )

    const turnInPlaceGraphRelevant =
      controls.stance === 'Crouching'
        ? (
            crouchingGraphRelevant
            && crouchingStateRuntime.stateWeights.Idle > 0
          )
        : (
            standingGraphRuntime.relevant
            && standingGraphRuntime.standing.stateWeights.Idle > 0
          )
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
    } else if (
      !turnInPlaceAllowed
      || rotateInPlaceAllowed
      || controls.moving
    ) {
      turnInPlaceState.activationDelay = 0
    }

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
    for (const clip of baseClips) clip.entry.weight = 0
    for (const member of locomotionSyncGroup.members) {
      member.weight = 0
      member.updatedThisFrame = false
    }
    groundedLocomotionClipDebugWeights.forEach(
      (_, clipName) => groundedLocomotionClipDebugWeights.set(clipName, 0),
    )

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
        syncMember.updatedThisFrame = (
          crouchingMovementRelevant
          && crouchingMovementClipWeights[direction] > 0
        )
      }
    }
    if (roles.crouchIdle) roles.crouchIdle.entry.weight = 0

    const standingMovementSubtreeWeight =
      standingGraphWeight
      * (
        standingGraphRuntime.standing.stateWeights.Move
        + standingGraphRuntime.standing.stateWeights.Stop
      )
    updateGroundedLocomotionGraphFromStateWeights(
      groundedLocomotionGraph,
      standingGraphRuntime.direction.stateWeights,
      velocityBlend,
      standingMovement,
      Math.max(0, delta),
      standingMovementSubtreeWeight,
      {
        Forward: standingSprint.moveForwardBaseWeight,
      },
    )
    refreshGroundedLocomotionPlayers(standingMovement.playRate)
    if (standingGraphRuntime.movementDetails.relevant) {
      for (const hipsDirection of ALS_HIPS_DIRECTIONS) {
        const directionStateWeight =
          standingGraphRuntime.direction.stateWeights[hipsDirection]
        if (directionStateWeight <= 0) continue
        const samples = readGroundedLocomotionGraph(
          groundedLocomotionGraph,
          hipsDirection,
          velocityBlend,
          standingMovement,
        )
        const forwardGraphWeight = hipsDirection === 'Forward'
          ? standingSprint.moveForwardBaseWeight
          : 1
        for (const sample of samples) {
          const finalWeight =
            sample.weight
            * forwardGraphWeight
            * directionStateWeight
            * standingMovementSubtreeWeight
          groundedLocomotionClipDebugWeights.set(
            sample.clip,
            (groundedLocomotionClipDebugWeights.get(sample.clip) ?? 0)
              + finalWeight,
          )
        }
      }
    }

    const forwardDirectionWeight =
      standingGraphRuntime.direction.stateWeights.Forward
    const sprint = roles.sprint
    if (sprint) {
      sprint.entry.weight = 0
      const member = locomotionMembersByClip.get(sprint)
      if (member) {
        // SequencePlayer visitation belongs to the local Sprint/Acceleration graph. Effective
        // notify weight additionally includes the enclosing direction and state-machine weights;
        // keeping those two facts separate preserves a visited zero-weight tick record.
        member.weight =
          standingSprint.sprintWeight
          * forwardDirectionWeight
          * standingMovementSubtreeWeight
        member.updatedThisFrame = (
          standingSprint.sprintWeight > 0
          && forwardDirectionWeight > 0
          && standingGraphRuntime.movementDetails.relevant
        )
        member.playRate = standingSprint.sprintPlayRate
      }
    }
    if (sprintAccelerationClip) {
      sprintAccelerationClip.entry.weight = 0
      const member = locomotionMembersByClip.get(sprintAccelerationClip)
      if (member) {
        member.weight =
          standingSprint.sprintAccelerationWeight
          * forwardDirectionWeight
          * standingMovementSubtreeWeight
        member.updatedThisFrame = (
          standingSprint.sprintAccelerationWeight > 0
          && forwardDirectionWeight > 0
          && standingGraphRuntime.movementDetails.relevant
        )
        member.playRate = standingSprint.sprintAccelerationPlayRate
      }
    }

    const standingTurnInPlaceSlotWeight =
      standingGraphWeight
      * standingGraphRuntime.standing.stateWeights.Idle
    const crouchingTurnInPlaceSlotWeight =
      crouchingGraphWeight * crouchingStateRuntime.stateWeights.Idle
    const standingTurnInPlaceWeightData =
      calculateSlotMontageWeight(
        slotMontageSamples.filter((sample) => (
          sample.status !== 'completed'
          && sample.slotName === TURN_IN_PLACE_STANDING_SLOT_NAME
        )),
      )
    const crouchingTurnInPlaceWeightData =
      calculateSlotMontageWeight(
        slotMontageSamples.filter((sample) => (
          sample.status !== 'completed'
          && sample.slotName === TURN_IN_PLACE_CROUCHING_SLOT_NAME
        )),
      )
    if (roles.idle) {
      roles.idle.entry.time = 0
      roles.idle.entry.weight = 0
    }
    if (roles.crouchIdle) {
      roles.crouchIdle.entry.time = 0
      roles.crouchIdle.entry.weight = 0
    }
    if (activeTurnInPlaceClip) {
      activeTurnInPlaceClip.entry.weight = 0
    }

    const fallbackGaitAmount = controls.movingSmooth
      ? controls.gait === 'Walking'
        ? 1
        : controls.gait === 'Running' ? 2 : 3
      : 0

    const defaultActive = controls.overlayMode === 'Default'
    const rifleActive = controls.overlayMode === 'Rifle'
    activeOverlayMode = controls.overlayMode
    if (idleAdditiveEntry && idleAdditiveClip) {
      idleAdditiveEntry.time = idleAdditiveClip.time
      // AB_Als_Default's node 1 remains evaluator-owned. AB_Als_Rifle applies
      // the same source inside each state before its outer transitions because
      // Aiming uses a distinct authored alpha.
      idleAdditiveEntry.weight =
        defaultActive ? IDLE_ADDITIVE_WEIGHT : 0
    }
    if (previousOverlayMode === null) {
      previousOverlayMode = controls.overlayMode
    } else if (controls.overlayMode !== previousOverlayMode) {
      previousOverlayMode = controls.overlayMode
      customOverlays.get(controls.overlayMode)?.reset()
      if (isPistolOverlayMode(controls.overlayMode)) {
        resetAlsPistolRuntime(pistolOverlays[controls.overlayMode].runtime)
      }
      if (controls.overlayMode === 'Rifle') {
        resetAlsRifleRuntime(rifleRuntime)
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
        groundPredictionAmount: inAirState.groundPredictionAmount,
        deltaTime: delta,
        relevant: defaultActive,
      },
    )

    activeRifleGraphInput = {
      relevant: rifleActive,
      deltaTime: delta,
      rotationMode: controls.rotationMode,
      locomotionMode,
      locomotionAction: controls.locomotionAction ?? null,
      gait: controls.gait,
      transitionsAllowed: transitionsState.transitionsAllowed,
      moving: controls.moving,
      pitchAmount: viewAnimationState.pitchAmount,
      standingAmount: gaitAmounts.standingAmount,
      crouchingAmount: gaitAmounts.crouchingAmount,
      gaitWalkingAmount: gaitAmounts.walking,
      gaitRunningAmount: gaitAmounts.running,
      gaitSprintingAmount: gaitAmounts.sprinting,
      inAirAmount: gaitAmounts.inAirAmount,
      groundPredictionAmount: inAirState.groundPredictionAmount,
      sprintAccelerationAmount:
        state.standingSprint.sprintAccelerationAmount,
      velocityBlend: {
        forwardAmount: velocityBlend.forwardAmount,
        backwardAmount: velocityBlend.backwardAmount,
        leftAmount: velocityBlend.leftAmount,
        rightAmount: velocityBlend.rightAmount,
      },
    }
    upperBodySlot.update(delta, !!controls.locomotionAction, controls.overlayMode)
    refreshAlsRifleRuntime(rifleRuntime, activeRifleGraphInput)
    processRifleLifecycleEvents(controls)
    for (const mode of PISTOL_OVERLAY_MODES) {
      const { runtime } = pistolOverlays[mode]
      refreshAlsPistolRuntime(runtime, {
        ...activeRifleGraphInput,
        relevant: controls.overlayMode === mode,
      })
      // Pistol notifies call PlayTransitionRightAnimation with authored rates,
      // start time 0.3, and bFromStandingIdleOnly=true (pistol-content.json).
      for (const event of runtime.lifecycleEvents) {
        if (controls.stance !== 'Standing' || controls.moving) continue
        if (!standingTransitionRightClip) continue
        queueTransitionAnimation(transitionsState, {
          clip: standingTransitionRightClip.sampler.clip.name,
          blendInDuration: 0.2,
          blendOutDuration: 0.2,
          playRate: event.name === 'RelaxedToReady' ? 1.75 : 1.5,
          startTime: 0.3,
        })
      }
    }
    for (const [mode, overlay] of customOverlays) {
      overlay.update({ ...activeRifleGraphInput, relevant: mode === controls.overlayMode })
      if (overlay.template === 'Rifle') processRifleLifecycleEvents(controls, overlay.runtime.lifecycleEvents)
      else for (const event of overlay.runtime.lifecycleEvents) {
        if (controls.stance !== 'Standing' || controls.moving || !standingTransitionRightClip) continue
        queueTransitionAnimation(transitionsState, {
          clip: standingTransitionRightClip.sampler.clip.name,
          blendInDuration: 0.2, blendOutDuration: 0.2,
          playRate: event.name === 'RelaxedToReady' ? 1.75 : 1.5, startTime: 0.3,
        })
      }
    }
    const rifleGraphState = rifleRuntime.relaxed.state

    for (const source of rifleOverlaySources) {
      const syncMember = overlayLocomotionMembers.get(source)
      if (syncMember) syncMember.weight = 0
    }
    if (rifleActive && rifleGraphState.relevant) {
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
        runArmsMember.updatedThisFrame = runArmsMember.weight > 0
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
        sprintArmsMember.updatedThisFrame =
          sprintArmsMember.weight > 0
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
        sprintImpulseArmsMember.updatedThisFrame =
          sprintImpulseArmsMember.weight > 0
      }
    }

    for (const member of locomotionSyncGroup.members) {
      if (groundedLocomotionPlayerMembers.has(member)) continue
      if (
        member.updatedThisFrame !== true
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
    locomotionPreviousTimes.clear()
    for (const sequenceName of queuedNotifySequenceNames) {
      const clip = clipsByName.get(sequenceName)
      const member = clip
        ? locomotionMembersByClip.get(clip)
        : undefined
      if (member?.updatedThisFrame) {
        locomotionPreviousTimes.set(member, member.time)
      }
    }
    const syncResult = advanceSyncGroup(locomotionSyncGroup, delta)
    resolveGroundedLocomotionPlayerTimes()
    // FAnimNotifyQueue receives graph tick-record candidates before Slot source candidates.
    // Only the elected Movement leader may emit these authored bTriggerOnFollower=false events.
    for (const [sequenceName, runtimeTrack] of cameraShakeNotifyTracks) {
      const clip = clipsByName.get(sequenceName)
      const member = clip
        ? locomotionMembersByClip.get(clip)
        : undefined
      const previousTime = member
        ? locomotionPreviousTimes.get(member)
        : undefined
      if (!member || previousTime === undefined) continue
      queueCameraShakeNotifiesFromRange(
        runtimeTrack,
        previousTime,
        member.time,
        {
          bAllowLooping: true,
          bSrcIsLeader: syncResult.leader === member,
          InstanceWeight: member.weight,
        },
      )
    }
    for (
      const [sequenceName, runtimeTrack]
      of footstepEffectsNotifyTracks
    ) {
      const clip = clipsByName.get(sequenceName)
      const member = clip
        ? locomotionMembersByClip.get(clip)
        : undefined
      const previousTime = member
        ? locomotionPreviousTimes.get(member)
        : undefined
      if (!member || previousTime === undefined) continue
      queueFootstepEffectsNotifiesFromRange(
        runtimeTrack,
        previousTime,
        member.time,
        {
          bAllowLooping: true,
          bSrcIsLeader: syncResult.leader === member,
          InstanceWeight: member.weight,
        },
      )
    }
    // Each BlendSpace sample owns a source-sequence clock. Its outer player is the Movement
    // SyncGroup member; internal sample weight remains part of FAnimTickRecord's effective weight.
    for (const direction of ALS_HIPS_DIRECTIONS) {
      const result = groundedLocomotionPlayerResults[direction]
      const sources = groundedLocomotionPlayerSources[direction]
      for (const sample of result.samples) {
        const source = sources[Number(sample.id)]
        if (!source) continue
        const runtimeTrack =
          footstepEffectsNotifyTracks.get(source.name)
        if (!runtimeTrack) continue
        queueFootstepEffectsNotifiesFromRange(
          runtimeTrack,
          sample.previousTime,
          sample.time,
          {
            bAllowLooping: true,
            bSrcIsLeader:
              syncResult.leader === result.syncMember,
            InstanceWeight:
              result.syncMember.weight * sample.weight,
          },
        )
      }
    }
    // PostLocomotion is a local Slot relevance gate. NotifyWeight already owns the sequence
    // threshold, so the final Slot/global graph weight must not be applied a second time.
    for (const sample of slotMontageSamples) {
      if (
        sample.slotName !== POST_LOCOMOTION_SLOT_NAME
        || sample.groupName !== LOCOMOTION_SLOT_GROUP_NAME
        || (
          sample.notifyPreviousWeight <= 0
          && sample.weight <= 0
        )
        || !canGatherSlotMontageSequenceNotifies(sample)
      ) {
        continue
      }
      const runtimeTrack = cameraShakeNotifyTracks.get(sample.clipKey)
      if (!runtimeTrack) continue
      queueCameraShakeNotifiesFromRange(
        runtimeTrack,
        sample.sourceNotifyPreviousTime,
        sample.sourceNotifyCurrentTime,
        {
          bAllowLooping: sample.loopCount > 1,
          bSrcIsLeader: true,
          InstanceWeight: sample.notifyWeight,
        },
      )
    }
    // Transition, TurnInPlace, Mantle, and Roll all use the same montage-source notify path.
    // Unlike camera shake, ALS footstep effects are authored in both Grounded and Locomotion
    // slot groups, so do not narrow this pass to PostLocomotion.
    for (const sample of slotMontageSamples) {
      if (
        (
          sample.notifyPreviousWeight <= 0
          && sample.weight <= 0
        )
        || !canGatherSlotMontageSequenceNotifies(sample)
      ) {
        continue
      }
      const runtimeTrack =
        footstepEffectsNotifyTracks.get(sample.clipKey)
      if (!runtimeTrack) continue
      queueFootstepEffectsNotifiesFromRange(
        runtimeTrack,
        sample.sourceNotifyPreviousTime,
        sample.sourceNotifyCurrentTime,
        {
          bAllowLooping: sample.loopCount > 1,
          bSrcIsLeader: true,
          InstanceWeight: sample.notifyWeight,
        },
      )
    }
    normalDebugWeights.locomotionCadence = syncResult.leader
      && syncResult.leader.duration > 0
      ? syncResult.leader.playRate / syncResult.leader.duration
      : 0
    for (const [clip, member] of locomotionMembersByClip) {
      clip.entry.time = member.time
    }
    for (const source of rifleOverlaySources) {
      source.time = source.key === 'poses'
        ? 0
        : overlayLocomotionMembers.get(source)?.time ?? 0
    }
    const movementPhase = syncResult.leader && syncResult.leader.duration > 0
      ? syncResult.leader.time / syncResult.leader.duration : 0
    for (const overlay of customOverlays.values()) overlay.setTime(movementPhase, idleAdditiveClip?.time ?? 0)
    if (rifleSources) {
      rifleSources.runArms.time =
        rifleRunArmsSource?.time ?? 0
      rifleSources.sprintArms.time =
        rifleSprintArmsSource?.time ?? 0
      rifleSources.sprintImpulseArms.time =
        rifleSprintImpulseArmsSource?.time ?? 0
      rifleSources.idle.time = idleAdditiveClip?.time ?? 0
    }

    if (
      standingGraphRuntime.relevant
      && roles.sprint
      && sprintAccelerationClip
      && rotateInPlaceClips.Standing.Left
      && rotateInPlaceClips.Standing.Right
      && standingAccelerationSourceComplete
    ) {
      for (const direction of ALS_HIPS_DIRECTIONS) {
        const sources = groundedLocomotionPlayerSources[direction]
        for (const sample of groundedLocomotionPlayerResults[direction].samples) {
          const sampleIndex = Number(sample.id)
          const source = sources[sampleIndex]
          if (!source?.clip) continue
          sampleSequencePoseNode(
            rig,
            source.clip,
            sample.time,
            true,
            standingMovementSamplePoses[direction][sampleIndex],
          )
        }
      }
      sampleSequencePoseNode(
        rig,
        roles.sprint,
        locomotionMembersByClip.get(roles.sprint)?.time ?? 0,
        true,
        standingSprintPose,
      )
      sampleSequencePoseNode(
        rig,
        sprintAccelerationClip,
        locomotionMembersByClip.get(sprintAccelerationClip)?.time ?? 0,
        true,
        standingSprintAccelerationPose,
      )

      for (const hipsDirection of ALS_HIPS_DIRECTIONS) {
        standingMovementPoseSources.length = 0
        standingMovementPoseWeights.length = 0
        const samples = readGroundedLocomotionGraph(
          groundedLocomotionGraph,
          hipsDirection,
          velocityBlend,
          standingMovement,
        )
        for (const sample of samples) {
          const pose =
            standingMovementSamplePoses[sample.player][sample.sampleIndex]
          if (!pose || sample.weight <= 0) continue
          standingMovementPoseSources.push(pose)
          standingMovementPoseWeights.push(sample.weight)
        }
        const basePose = hipsDirection === 'Forward'
          ? standingMoveForwardBasePose
          : standingMovementStatePoses[hipsDirection]
        if (standingMovementPoseSources.length > 0) {
          blendPoseNodesTogether(
            standingMovementPoseSources,
            standingMovementPoseWeights,
            basePose,
          )
        } else {
          copyPoseNode(standingIdlePose, basePose)
        }

        if (hipsDirection === 'Forward') {
          blendPoseNodesTogether(
            [
              standingMoveForwardBasePose,
              standingSprintPose,
              standingSprintAccelerationPose,
            ],
            [
              standingSprint.moveForwardBaseWeight,
              standingSprint.sprintWeight,
              standingSprint.sprintAccelerationWeight,
            ],
            standingMovementStatePoses.Forward,
          )
        }

        const rotationYawOffset = hipsDirection === 'Forward'
          ? rotationYawOffsets.forwardAngle
          : hipsDirection === 'Backward'
            ? rotationYawOffsets.backwardAngle
            : hipsDirection.startsWith('Left')
              ? rotationYawOffsets.leftAngle
              : rotationYawOffsets.rightAngle
        standingMovementStatePoses[hipsDirection].curves.set(
          'RotationYawOffset',
          rotationYawOffset,
        )
      }

      for (const player of ALS_ACCELERATION_PLAYERS) {
        const clock = standingGraphRuntime.accelerationClocks[
          player.state
        ]
        for (const direction of accelerationDirections) {
          sampleSequencePoseNode(
            rig,
            standingAccelerationClips[direction]!,
            clock.time,
            clock.loop,
            standingAccelerationFullPose,
          )
          const additive =
            standingAccelerationPoses[player.state][direction]
          makeDynamicAdditivePose(
            standingAccelerationFullPose.pose,
            crouchingLeanReference.pose,
            rig,
            additive.pose,
            'local',
            standingAccelerationAdditiveScratch,
          )
          additive.curves.clear()
        }
      }

      sampleSequencePoseNode(
        rig,
        rotateInPlaceClips.Standing.Left,
        standingGraphRuntime.rotateClocks.left.time,
        rotateInPlaceState.rotatingLeft,
        standingRotateLeftPose,
      )
      sampleSequencePoseNode(
        rig,
        rotateInPlaceClips.Standing.Right,
        standingGraphRuntime.rotateClocks.right.time,
        rotateInPlaceState.rotatingRight,
        standingRotateRightPose,
      )
      const output = evaluateAlsStandingPoseGraph(
        standingPoseGraphRuntime,
        standingGraphRuntime,
        {
          movementStatePoses: standingMovementStatePoses,
          leanAdditivePose: crouchingLeanAdditive,
          accelerationPoses: standingAccelerationPoses,
          idlePose: standingIdlePose,
          turnInPlaceMontages: standingTurnInPlaceMontages,
          turnInPlaceMontageWeight,
          turnInPlacePlayRate: turnInPlaceState.playRate,
          rotateLeftPose: standingRotateLeftPose,
          rotateRightPose: standingRotateRightPose,
          rotateInPlacePlayRate: rotateInPlaceState.playRate,
          stopPoses: standingStopPoses,
          velocityBlend,
          deltaTime: Math.max(0, delta),
        },
      )
      copyPoseNode(output, standingGraphOutput)
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

      const crouchingRotateLeftPreviousTime =
        crouchingRotateLeftTime
      const crouchingRotateRightPreviousTime =
        crouchingRotateRightTime
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
      if (crouchingStateRuntime.stateWeights['Rotate Left'] > 0) {
        queueFootstepEffectsForClipRange(
          rotateInPlaceClips.Crouching.Left,
          crouchingRotateLeftPreviousTime,
          crouchingRotateLeftTime,
          rotateInPlaceState.rotatingLeft,
          crouchingStateRuntime.stateWeights['Rotate Left']
            * crouchingGraphWeight,
        )
      }
      if (crouchingStateRuntime.stateWeights['Rotate Right'] > 0) {
        queueFootstepEffectsForClipRange(
          rotateInPlaceClips.Crouching.Right,
          crouchingRotateRightPreviousTime,
          crouchingRotateRightTime,
          rotateInPlaceState.rotatingRight,
          crouchingStateRuntime.stateWeights['Rotate Right']
            * crouchingGraphWeight,
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

      const statePoses = evaluateAlsCrouchingPoseGraph(
        crouchingPoseGraphRuntime,
        {
          fixedCrouchWalkPose: crouchingFixedWalkPose,
          movementStatesPose: crouchingMovementOutput,
          leanAdditivePose: crouchingLeanAdditive,
          idlePose: crouchingIdlePose,
          turnInPlaceMontages: crouchingTurnInPlaceMontages,
          turnInPlaceMontageWeight,
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

    consumerLocomotion.evaluate(controls, Math.max(0, delta), standingGraphOutput, crouchingGraphOutput, { Standing: activeStandingGraphWeight, Crouching: activeCrouchingGraphWeight })
    if (idleAdditiveEntry && controls.overlayMode === 'Default') {
      idleAdditiveEntry.weight = IDLE_ADDITIVE_WEIGHT * consumerLocomotion.defaultIdleAdditiveScale()
    }

    copyPose(standReference, layeringReference)
    blendPoseInPlace(
      layeringReference,
      crouchReference,
      gaitAmounts.crouchingAmount,
    )

    locomotionResolvedGraphCurves.clear()
    resolveWeightedEntryCurvesDirect(
      locomotionResolvedGraphCurves,
      mainCurveEntries,
      [
        {
          weight: activeStandingGraphWeight,
          curves: standingGraphOutput.curves,
        },
        {
          weight: activeCrouchingGraphWeight,
          curves: crouchingGraphOutput.curves,
        },
      ],
    )
    graphFootLeftLock = clamp01(
      locomotionResolvedGraphCurves.get(
        FOOT_LEFT_LOCK_CURVE_NAME,
      ) ?? graphFootLeftLock,
    )
    graphFootRightLock = clamp01(
      locomotionResolvedGraphCurves.get(
        FOOT_RIGHT_LOCK_CURVE_NAME,
      ) ?? graphFootRightLock,
    )
    graphRotationYawSpeed =
      locomotionResolvedGraphCurves.get(
        ROTATION_YAW_SPEED_CURVE_NAME,
      ) ?? 0
    graphAllowTransitions = clamp01(
      locomotionResolvedGraphCurves.get(
        ALLOW_TRANSITIONS_CURVE_NAME,
      ) ?? 1,
    )
    graphMovingAmount = clamp01(
      locomotionResolvedGraphCurves.get(
        POSE_MOVING_CURVE_NAME,
      ) ?? 0,
    )
    graphFallbackGaitAmount = fallbackGaitAmount

    if (!locomotionPoseGraphRuntime.relevant) {
      // AB_Als_Locomotion has bReinitializeOnBecomingRelevant. Its caller-owned
      // SequencePlayers initialize with the graph even when the stale and newly selected outer
      // states have the same name (for example Fall -> solo -> Fall). Reinitialize before
      // GetRelevantAnimTimeRemaining() feeds this frame's automatic transition rules.
      reinitializeLocomotionSequencePlayers()
    }
    const jumpLaunchRemainingTime = mostRelevantRemainingTime([
      jumpWalkLeftPlayer,
      jumpRunLeftPlayer,
      jumpWalkRightPlayer,
      jumpRunRightPlayer,
    ])
    const landRemainingTime = mostRelevantRemainingTime([
      landLightPlayer,
      landHeavyPlayer,
    ])
    const landMovementRelevantAnimTimeRemaining =
      mostRelevantRemainingTime([
        landMovementLightPlayer,
        landMovementHeavyPlayer,
      ])
    activeLocomotionGraphInput = {
      relevant: true,
      deltaTime: Math.max(0, delta),
      locomotionMode,
      jumped: jumpedThisFrame,
      stance: controls.stance,
      hasInput,
      rotatingLeft: rotateInPlaceState.rotatingLeft,
      rotatingRight: rotateInPlaceState.rotatingRight,
      speed: rawSpeed,
      verticalVelocity: inAirState.verticalVelocity,
      groundPredictionAmount: inAirState.groundPredictionAmount,
      leanRightAmount: leanState.rightAmount,
      leanForwardAmount: leanState.forwardAmount,
      footPlantedAmount: previousFootPlantedAmount,
      jumpPlayRate: inAirState.jumpPlayRate,
      rotationMode: controls.rotationMode,
      clocks: {
        jumpLaunchRemainingTime,
        landRemainingTime,
        landMovementRelevantAnimTimeRemaining,
      },
      poses: locomotionSampledPoses,
    }
    const previousLocomotionState =
      locomotionPoseGraphRuntime.outerTransitionStack.currentState
    const predictedLocomotionState = predictLocomotionPoseState(
      activeLocomotionGraphInput,
    )
    resetLocomotionPlayersForEntry(
      previousLocomotionState,
      predictedLocomotionState,
    )
    updateAlsLocomotionPoseGraph(
      locomotionPoseGraphRuntime,
      activeLocomotionGraphInput,
    )
    const groundedPostLocomotionWeightData =
      calculateSlotMontageWeight(
        postLocomotionSlotBindings.map(
          (binding) => binding.sample,
        ),
      )
    const groundedGraphRelevanceWeight = (
      getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Grounded',
      )
      + getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        'Land Movement',
      )
    ) * groundedPostLocomotionWeightData.sourceWeight
    const groundedRollGraphRefresh =
      refreshAlsGroundedRollGraph(
        groundedRollGraphRuntime,
        {
          deltaTime,
          relevant: groundedGraphRelevanceWeight > 1e-5,
          stance: controls.stance,
          movingSmooth: controls.movingSmooth,
          rotatingLeft: rotateInPlaceState.rotatingLeft,
          rotatingRight: rotateInPlaceState.rotatingRight,
          poseStandingAmount: gaitAmounts.standingAmount,
          poseCrouchingAmount: gaitAmounts.crouchingAmount,
          groundedEntryMode,
        },
      )
    if (groundedRollGraphRefresh.resetGroundedEntryMode) {
      groundedEntryMode = null
    }
    const rollExitRequest =
      groundedRollGraphRefresh.stateExitTransitionAnimation
    if (rollExitRequest) {
      const clip = clipsByName.get(rollExitRequest.sequence)
      if (!clip) {
        throw new Error(
          `Missing authored Roll exit sequence `
          + `"${rollExitRequest.sequence}"`,
        )
      }
      queueTransitionAnimation(transitionsState, {
        clip: clip.sampler.clip.name,
        blendInDuration: rollExitRequest.blendInDuration,
        blendOutDuration: rollExitRequest.blendOutDuration,
        playRate: rollExitRequest.playRate,
        startTime: rollExitRequest.startTime,
        fromStandingIdleOnly:
          rollExitRequest.fromStandingIdleOnly,
        moving: controls.moving,
        standing: controls.stance === 'Standing',
      })
    }
    advanceLocomotionPlayers(activeLocomotionGraphInput)

    if (viewPoseRuntime) {
      if (
        isAlsViewPoseBecomingRelevant(
          viewPoseRuntime,
          viewAnimationState.lookAmount,
        )
      ) {
        // AB_Als_View's OnBecomeRelevant event calls InitializeLook before
        // the state machine's OnUpdate event calls RefreshLook.
        lookState.initializationRequired = true
      }
      if (isAlsViewPoseRelevant(viewAnimationState.lookAmount)) {
        refreshLook(lookState, {
          rotationMode: controls.rotationMode,
          actorYawAngle: controls.actorYawAngle ?? 0,
          movementBaseHasRelativeRotation:
            movementBaseState.hasRelativeRotation,
          movementBaseDeltaRotationYaw:
            movementBaseState.deltaRotation.yaw,
          hasInput,
          inputYawAngle: controls.inputYawAngle ?? 0,
          targetYawAngle: controls.targetYawAngle ?? 0,
          viewYawAngle: viewAnimationState.yawAngle,
          viewPitchAngle: viewAnimationState.pitchAngle,
          locomotionYawSpeed: controls.locomotionYawSpeed ?? 0,
          deltaTime,
        })
      }
      refreshAlsViewPoseRuntime(
        viewPoseRuntime,
        lookState,
        viewAnimationState.lookAmount,
        deltaTime,
      )
    }

    const result = evaluatePose(evaluator, mainInput)
    processLocomotionLifecycleEvents()
    if (!result.curves.values.has(POSE_GAIT_CURVE_NAME)) {
      result.curves.values.set(POSE_GAIT_CURVE_NAME, fallbackGaitAmount)
    }
    const finalCurves = applyEvaluatedGraphPose(
      result,
      locomotionMode,
      delta,
      captureControlRigComponentPositions,
    )
    for (const role of Object.keys(CLIP_ROLES) as ClipRole[]) {
      const clip = roles[role]
      if (clip) {
        const clipName = clip.sampler.clip.name
        const isGroundedLocomotionSource =
          groundedLocomotionClipNames.has(clipName)
        const roleWeight = role === 'idle'
          ? (
              standingGraphWeight
              * standingGraphRuntime.standing.stateWeights.Idle
              * standingTurnInPlaceWeightData.sourceWeight
            )
          : isGroundedLocomotionSource
            ? groundedLocomotionClipDebugWeights.get(clipName) ?? 0
          : (
              locomotionMembersByClip.get(clip)?.weight
              ?? clip.entry.weight
            )
        const roleTime = isGroundedLocomotionSource
          ? groundedLocomotionClipDebugTimes.get(clipName) ?? 0
          : clip.entry.time
        normalDebugWeights[role] =
          Math.abs(roleWeight) <= Number.EPSILON ? 0 : roleWeight
        normalDebugWeights[`clipTime.${role}`] = roleTime
        normalDebugWeights[`clipPhase.${role}`] =
          clip.sampler.clip.duration > 0
            ? roleTime / clip.sampler.clip.duration
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
      * crouchingTurnInPlaceWeightData.sourceWeight
    for (const clipName of groundedLocomotionClips.keys()) {
      normalDebugWeights[clipName] =
        groundedLocomotionClipDebugWeights.get(clipName) ?? 0
    }
    if (sprintAccelerationClip) {
      normalDebugWeights.sprintAcceleration =
        locomotionMembersByClip.get(sprintAccelerationClip)?.weight
        ?? 0
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
    for (const hipsDirection of Object.keys(groundedLocomotionGraph.evaluators)) {
      normalDebugWeights[`HipsDirection.${hipsDirection}`] =
        standingGraphRuntime.direction.stateWeights[
          hipsDirection as AlsHipsDirection
        ]
    }
    for (const direction of ALS_HIPS_DIRECTIONS) {
      const player = groundedLocomotionPlayers[direction]
      const member = player.syncMember
      const result = groundedLocomotionPlayerResults[direction]
      normalDebugWeights[`MovementPlayer.${direction}.weight`] = member.weight
      normalDebugWeights[`MovementPlayer.${direction}.phase`] = member.time
      normalDebugWeights[`MovementPlayer.${direction}.playRate`] =
        member.playRate
      normalDebugWeights[
        `MovementPlayer.${direction}.markerLeaderSampleIndex`
      ] = result.markerLeaderId === null
        ? -1
        : Number(result.markerLeaderId)
      const sources = groundedLocomotionPlayerSources[direction]
      for (const sample of player.getRetainedSamples()) {
        const source = sources[Number(sample.id)]
        if (!source) continue
        normalDebugWeights[
          `MovementPlayer.${direction}.Sample.${source.name}.time`
        ] = sample.time
        normalDebugWeights[
          `MovementPlayer.${direction}.Sample.${source.name}.phase`
        ] = sample.duration > 0 ? sample.time / sample.duration : 0
      }
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
    const rifleStatesChildWeight = rifleActive
      ? getStateMachineStateWeight(
          rifleRuntime.gameplayTagsBlend,
          0,
        )
      : 0
    const rifleRelaxedWeight = getStateMachineStateWeight(
      rifleRuntime.rifleStates,
      'Relaxed',
    )
    const rifleReadyWeight = getStateMachineStateWeight(
      rifleRuntime.rifleStates,
      'Ready',
    )
    const rifleAimingWeight = getStateMachineStateWeight(
      rifleRuntime.rifleStates,
      'Aiming',
    )
    const rifleIdleAdditiveWeight = rifleStatesChildWeight * (
      rifleRelaxedWeight
        * ALS_RIFLE_RELAXED_GRAPH.idleAdditiveAlpha
      + rifleReadyWeight
        * ALS_RIFLE_GRAPH.ready.idleAdditiveAlpha
      + rifleAimingWeight
        * ALS_RIFLE_GRAPH.aiming.idleAdditiveAlpha
    )
    normalDebugWeights.idleAdditive =
      (idleAdditiveEntry?.weight ?? 0) + rifleIdleAdditiveWeight
    normalDebugWeights['clipTime.idleAdditive'] =
      idleAdditiveEntry?.time ?? 0
    normalDebugWeights['clipPhase.idleAdditive'] =
      idleAdditiveEntry && idleAdditiveEntry.sampler.clip.duration > 0
        ? idleAdditiveEntry.time / idleAdditiveEntry.sampler.clip.duration
        : 0
    normalDebugWeights['clipTime.defaultOverlay'] = 0
    normalDebugWeights.defaultOverlay = defaultActive ? 1 : 0
    normalDebugWeights.RifleStateRelaxed =
      rifleStatesChildWeight * rifleRelaxedWeight
    normalDebugWeights.RifleStateReady =
      rifleStatesChildWeight * rifleReadyWeight
    normalDebugWeights.RifleStateAiming =
      rifleStatesChildWeight * rifleAimingWeight
    normalDebugWeights.RifleActionChild =
      rifleRuntime.output.actionChild
    normalDebugWeights.RifleTransitionsTakenThisFrame =
      rifleRuntime.transitionsTakenThisFrame
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
      crouchingStopQuickNotifyCount
    normalDebugWeights.StandingStopQuickNotifyCount =
      standingStopQuickNotifyCount
    for (const [prefix, stateWeights] of [
      ['StandingState', standingGraphRuntime.standing.stateWeights],
      [
        'StandingMovementDetailsState',
        standingGraphRuntime.movementDetails.stateWeights,
      ],
      ['StandingStopState', standingGraphRuntime.stop.stateWeights],
    ] as const) {
      for (const [graphState, weight] of Object.entries(stateWeights)) {
        normalDebugWeights[
          `${prefix}${graphState.replaceAll(' ', '')}`
        ] = weight
      }
    }
    normalDebugWeights.StandingTransitionCount =
      standingGraphRuntime.standingTransitionsTakenThisFrame
    normalDebugWeights.StandingMovementDetailsTransitionCount =
      standingGraphRuntime.movementDetailsTransitionsTakenThisFrame
    normalDebugWeights.StandingStopTransitionCount =
      standingGraphRuntime.stopTransitionsTakenThisFrame
    normalDebugWeights.StandingPivotActive =
      Number(standingGraphRuntime.pivotActive)
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
    normalDebugWeights[ROTATION_YAW_SPEED_CURVE_NAME] =
      finalCurves.get(ROTATION_YAW_SPEED_CURVE_NAME)
      ?? graphRotationYawSpeed
    normalDebugWeights.PublishedRotationYawSpeed =
      finalCurves.get(ROTATION_YAW_SPEED_CURVE_NAME)
      ?? graphRotationYawSpeed
    normalDebugWeights.PublishedPoseCrouching = clamp01(
      finalCurves.get(POSE_CROUCHING_CURVE_NAME) ?? graphCrouchingAmount,
    )
    normalDebugWeights.PublishedFootLeftLock = clamp01(
      finalCurves.get(FOOT_LEFT_LOCK_CURVE_NAME) ?? graphFootLeftLock,
    )
    normalDebugWeights.PublishedFootRightLock = clamp01(
      finalCurves.get(FOOT_RIGHT_LOCK_CURVE_NAME) ?? graphFootRightLock,
    )
    normalDebugWeights.PublishedHipsDirectionLock = Math.max(
      -1,
      Math.min(
        1,
        finalCurves.get(HIPS_DIRECTION_LOCK_CURVE_NAME) ?? 0,
      ),
    )
    normalDebugWeights.PublishedSprintBlock = clamp01(
      finalCurves.get(SPRINT_BLOCK_CURVE_NAME) ?? 0,
    )
    normalDebugWeights.RotationYawOffset =
      finalCurves.get('RotationYawOffset') ?? 0
    normalDebugWeights[ALLOW_TRANSITIONS_CURVE_NAME] =
      finalCurves.get(ALLOW_TRANSITIONS_CURVE_NAME)
      ?? graphAllowTransitions
    normalDebugWeights.TransitionsAllowed =
      Number(transitionsState.transitionsAllowed)
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
    const activeTransitionSample =
      transitionSlotBindings.at(-1)?.sample
    const transitionSlotWeightData = calculateSlotMontageWeight(
      transitionSlotBindings.map((binding) => binding.sample),
    )
    normalDebugWeights.TransitionMontageWeight =
      transitionSlotWeightData.slotNodeWeight
    normalDebugWeights.TransitionMontageTime =
      activeTransitionSample?.montageTime ?? 0
    normalDebugWeights.TransitionSequenceTime =
      activeTransitionSample?.sampleTime ?? 0
    normalDebugWeights.TransitionQueued =
      Number(transitionsState.queuedTransition !== null)
    normalDebugWeights.TransitionStopQueued =
      Number(transitionsState.stopTransitionsQueued)
    normalDebugWeights.TransitionQueuedPlayRate =
      transitionsState.queuedTransition?.playRate ?? 0
    normalDebugWeights.TransitionQueuedStartTime =
      transitionsState.queuedTransition?.startTime ?? 0
    for (const [name, clip] of Object.entries(
      TRANSITION_DIAGNOSTIC_CLIPS,
    )) {
      normalDebugWeights[`TransitionQueued${name}`] =
        Number(transitionsState.queuedTransition?.clip === clip)
      normalDebugWeights[`TransitionPlaying${name}`] =
        Number(activeTransitionSample?.clipKey === clip)
    }
    const postLocomotionWeightData = calculateSlotMontageWeight(
      postLocomotionSlotBindings.map((binding) => binding.sample),
    )
    const activePostLocomotionSample =
      postLocomotionSlotBindings.at(-1)?.sample
    normalDebugWeights.PostLocomotionMontageWeight =
      postLocomotionWeightData.slotNodeWeight
    normalDebugWeights.PostLocomotionMontageTime =
      activePostLocomotionSample?.montageTime ?? 0
    normalDebugWeights.PostLocomotionSequenceTime =
      activePostLocomotionSample?.sampleTime ?? 0
    normalDebugWeights.PostLocomotionMontageBlendingIn =
      Number(activePostLocomotionSample?.status === 'blendingIn')
    normalDebugWeights.PostLocomotionMontagePlaying =
      Number(activePostLocomotionSample?.status === 'playing')
    normalDebugWeights.PostLocomotionMontageBlendingOut =
      Number(activePostLocomotionSample?.status === 'blendingOut')
    normalDebugWeights.PostLocomotionRootMotionEnabled =
      Number(activePostLocomotionSample?.bEnableRootMotion ?? false)
    normalDebugWeights.PostLocomotionRetainedInstanceCount =
      postLocomotionSlotBindings.length
    normalDebugWeights.PostLocomotionOldestInstanceId =
      postLocomotionSlotBindings.at(0)?.instanceId ?? -1
    normalDebugWeights.PostLocomotionNewestInstanceId =
      postLocomotionSlotBindings.at(-1)?.instanceId ?? -1
    normalDebugWeights['GroundedOuter.Relevant'] =
      Number(groundedRollGraphRuntime.relevant)
    normalDebugWeights['GroundedOuter.State.Roll'] =
      groundedRollGraphRuntime.stateWeights.Roll
    normalDebugWeights['GroundedOuter.State.Standing'] =
      groundedRollGraphRuntime.stateWeights.Standing
    normalDebugWeights['GroundedOuter.State.Crouching'] =
      groundedRollGraphRuntime.stateWeights.Crouching
    normalDebugWeights['GroundedOuter.Current.Roll'] =
      Number(groundedRollGraphRuntime.currentState === 'Roll')
    normalDebugWeights['GroundedOuter.LastTransitionIndex'] =
      groundedRollGraphRuntime.lastTransitionIndex
    normalDebugWeights[
      'GroundedOuter.PlayRollToGroundedTransitionAnimation'
    ] = Number(
      groundedRollGraphRefresh
        .stateExitTransitionAnimation !== null,
    )
    normalDebugWeights[
      'GroundedOuter.RollExitTransitionStanding'
    ] = Number(
      groundedRollGraphRefresh
        .stateExitTransitionAnimation?.sequence
        === 'A_Als_Stand_Transition_Right',
    )
    normalDebugWeights[
      'GroundedOuter.RollExitTransitionCrouching'
    ] = Number(
      groundedRollGraphRefresh
        .stateExitTransitionAnimation?.sequence
        === 'A_Als_Crouch_Transition_Right',
    )
    normalDebugWeights[
      'GroundedOuter.RollExitTransitionLinearAlpha'
    ] = groundedRollGraphRuntime.activeExitTransition
      ?.linearAlpha ?? 1
    normalDebugWeights[
      'GroundedOuter.RollExitTransitionBlendAlpha'
    ] = groundedRollGraphRuntime.activeExitTransition
      ?.blendAlpha ?? 1
    normalDebugWeights['GroundedEntryMode.FromRoll'] =
      Number(groundedEntryMode === 'FromRoll')
    normalDebugWeights.SlotMontageRetainedInstanceCount =
      slotMontageBindings.size
    normalDebugWeights.TransitionRetainedInstanceCount =
      transitionSlotBindings.length
    normalDebugWeights.TurnInPlaceStandingRetainedInstanceCount =
      standingTurnInPlaceMontages.length
    normalDebugWeights.TurnInPlaceCrouchingRetainedInstanceCount =
      crouchingTurnInPlaceMontages.length
    const standingTurnInPlaceBindings = [...slotMontageBindings.values()]
      .filter((binding) => (
        binding.sample.slotName === TURN_IN_PLACE_STANDING_SLOT_NAME
      ))
      .sort((a, b) => a.instanceId - b.instanceId)
    const oldestStandingTurnInPlaceBinding =
      standingTurnInPlaceBindings.at(0)
    const newestStandingTurnInPlaceBinding =
      standingTurnInPlaceBindings.at(-1)
    normalDebugWeights.TurnInPlaceStandingOldestInstanceId =
      oldestStandingTurnInPlaceBinding?.instanceId ?? -1
    normalDebugWeights.TurnInPlaceStandingNewestInstanceId =
      newestStandingTurnInPlaceBinding?.instanceId ?? -1
    normalDebugWeights.TurnInPlaceStandingOldestSequenceTime =
      oldestStandingTurnInPlaceBinding?.sample.sampleTime ?? 0
    normalDebugWeights.TurnInPlaceStandingNewestSequenceTime =
      newestStandingTurnInPlaceBinding?.sample.sampleTime ?? 0
    normalDebugWeights.SlotMontageDistinctCurveKeyCount =
      new Set(
        [...slotMontageBindings.values()].map(
          (binding) => binding.entry.curveKey,
        ),
      ).size
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
    const activeDirectionTransition =
      standingGraphRuntime.direction.activeTransitions.at(-1)
    normalDebugWeights.GroundedDirectionTransitionActive =
      Number(activeDirectionTransition !== undefined)
    normalDebugWeights.GroundedDirectionTransitionLinearAlpha =
      activeDirectionTransition?.linearAlpha ?? 1
    normalDebugWeights.GroundedDirectionTransitionBlendAlpha =
      activeDirectionTransition?.alpha ?? 1
    normalDebugWeights.GroundedDirectionTransitionFromWeight =
      activeDirectionTransition
        ? standingGraphRuntime.direction.stateWeights[
            activeDirectionTransition.previousState
          ]
        : 1
    normalDebugWeights.GroundedDirectionTransitionToWeight =
      activeDirectionTransition
        ? standingGraphRuntime.direction.stateWeights[
            activeDirectionTransition.nextState
          ]
        : 0
    normalDebugWeights.GroundedDirectionTransitionRootIncomingWeight =
      activeDirectionTransition && directionTransitionRootIndex >= 0
        ? activeDirectionTransition.nextPoseMask[
            directionTransitionRootIndex
          ]
        : 0
    normalDebugWeights.GroundedDirectionTransitionFootLeftIncomingWeight =
      activeDirectionTransition && directionTransitionFootLeftIndex >= 0
        ? activeDirectionTransition.nextPoseMask[
            directionTransitionFootLeftIndex
          ]
        : 0
    normalDebugWeights.overlayModeRifle = rifleActive ? 1 : 0
    normalDebugWeights.inertializationCorrectionMagnitude =
      inertializationCorrectionMagnitude()
    normalDebugWeights.inertializationRequestCount =
      inertializationRequestCount()
    normalDebugWeights.groundedInertializationRequestCount =
      groundedInertialization.inertialization.requestCount
    normalDebugWeights.overlayInertializationRequestCount =
      overlayInertialization.inertialization.requestCount
    for (const locomotionState of ALS_LOCOMOTION_POSE_STATE_ORDER) {
      normalDebugWeights[
        `LocomotionState.${locomotionState.replaceAll(' ', '')}`
      ] = getAlsLocomotionStateWeight(
        locomotionPoseGraphRuntime,
        locomotionState,
      )
    }
    for (const player of locomotionSequencePlayers) {
      normalDebugWeights[`InAirPlayer.${player.key}`] = player.weight
      normalDebugWeights[`clipTime.${player.key}`] = player.time
      normalDebugWeights[`clipPhase.${player.key}`] =
        player.clip && player.clip.sampler.clip.duration > 0
          ? player.time / player.clip.sampler.clip.duration
          : 0
    }
    for (const [groupName, group] of Object.entries(
      locomotionSyncGroups,
    )) {
      for (const player of group.members) {
        normalDebugWeights[
          `InAirSyncLeader.${groupName}.${player.key}`
        ] = Number(group.leaderKey === player.key)
      }
    }
    const jumpGraphState =
      locomotionPoseGraphRuntime.inAirGraphState.jumpState
    for (const jumpState of [
      'Left Foot',
      'Right Foot',
      'Loop',
      'Flail',
    ] as const) {
      normalDebugWeights[
        `JumpState.${jumpState.replaceAll(' ', '')}`
      ] = Number(jumpGraphState.state === jumpState)
    }
    normalDebugWeights.InAirJumped = Number(jumpedThisFrame)
    normalDebugWeights.InAirJumpPlayRate = inAirState.jumpPlayRate
    normalDebugWeights.InAirVerticalVelocity =
      inAirState.verticalVelocity
    normalDebugWeights.InAirGroundPredictionAmount =
      inAirState.groundPredictionAmount
    normalDebugWeights.GroundPredictionBlock =
      previousGroundPredictionBlockAmount
    normalDebugWeights.PublishedGroundPredictionBlock = clamp01(
      finalCurves.get(GROUND_PREDICTION_BLOCK_CURVE_NAME) ?? 0,
    )
    normalDebugWeights.FootPlanted = previousFootPlantedAmount
    normalDebugWeights.PublishedFootPlanted = Math.max(
      -1,
      Math.min(
        1,
        finalCurves.get(FOOT_PLANTED_CURVE_NAME) ?? 0,
      ),
    )
    normalDebugWeights.PublishedFeetCrossing = clamp01(
      finalCurves.get(FEET_CROSSING_CURVE_NAME) ?? 0,
    )
    normalDebugWeights.ControlRigExecuted =
      Number(controlRigRuntime?.executed ?? false)
    if (
      captureControlRigComponentPositions
      && controlRigRuntime?.executed
    ) {
      for (const [stage, positions] of [
        [
          'Pre',
          controlRigRuntime.preForwardSolveComponentPositions,
        ],
        [
          'Post',
          controlRigRuntime.postForwardSolveComponentPositions,
        ],
      ] as const) {
        for (
          const { boneName, boneIndex }
          of controlRigDebugComponentLandmarks
        ) {
          for (
            let axisIndex = 0 as 0 | 1 | 2;
            axisIndex < CONTROL_RIG_DEBUG_COMPONENT_AXES.length;
            axisIndex++
          ) {
            const axis = CONTROL_RIG_DEBUG_COMPONENT_AXES[axisIndex]
            normalDebugWeights[
              controlRigDebugComponentPositionWeightName(
                stage,
                boneName,
                axis,
              )
            ] = positions[boneIndex * 3 + axisIndex]
          }
        }
      }
      controlRigComponentDebugPublished = true
    } else if (controlRigComponentDebugPublished) {
      for (const stage of ['Pre', 'Post'] as const) {
        for (
          const { boneName }
          of controlRigDebugComponentLandmarks
        ) {
          for (const axis of CONTROL_RIG_DEBUG_COMPONENT_AXES) {
            delete normalDebugWeights[
              controlRigDebugComponentPositionWeightName(
                stage,
                boneName,
                axis,
              )
            ]
          }
        }
      }
      controlRigComponentDebugPublished = false
    }
    normalDebugWeights.ControlRigDiagonalScalingFactor =
      controlRigRuntime?.diagonalScalingFactor ?? 0
    normalDebugWeights.ControlRigSpineRotationApplied =
      Number(controlRigRuntime?.spineRotationApplied ?? false)
    const controlRigFootLeft = controlRigRuntime?.footIk.feet[0]
    const controlRigFootRight = controlRigRuntime?.footIk.feet[1]
    normalDebugWeights.ControlRigPelvisOffset =
      controlRigRuntime?.footIk.pelvisOffset ?? 0
    normalDebugWeights.ControlRigFootLeftTraceHit =
      Number(controlRigFootLeft?.traceHit ?? false)
    normalDebugWeights.ControlRigFootRightTraceHit =
      Number(controlRigFootRight?.traceHit ?? false)
    normalDebugWeights.ControlRigFootLeftTraceOffset =
      controlRigFootLeft?.footOffsetLocation ?? 0
    normalDebugWeights.ControlRigFootRightTraceOffset =
      controlRigFootRight?.footOffsetLocation ?? 0
    normalDebugWeights.ControlRigFootLeftAppliedOffset =
      controlRigFootLeft?.offsetLocation ?? 0
    normalDebugWeights.ControlRigFootRightAppliedOffset =
      controlRigFootRight?.offsetLocation ?? 0
    normalDebugWeights.ControlRigFootLeftIkWeight =
      finalCurves.get(FOOT_LEFT_IK_CURVE_NAME) ?? 0
    normalDebugWeights.ControlRigFootRightIkWeight =
      finalCurves.get(FOOT_RIGHT_IK_CURVE_NAME) ?? 0
    normalDebugWeights.PublishedCurveFrameSize = publishedCurves.size
    normalDebugWeights.MovementBaseChanged =
      Number(movementBaseState.baseChanged)
    normalDebugWeights.FeetFootPlantedAmount =
      feetState.footPlantedAmount
    normalDebugWeights.FeetCrossingAmount =
      feetState.feetCrossingAmount
    normalDebugWeights.SpineYawAngle = spineState.yawAngle
    normalDebugWeights.TimeSinceTeleported =
      worldTime - teleportedTime
    normalDebugWeights.InAirLeanRightAmount = leanState.rightAmount
    normalDebugWeights.InAirLeanForwardAmount = leanState.forwardAmount
    normalDebugWeights.InAirJumpLaunchRemainingTime =
      jumpLaunchRemainingTime
    normalDebugWeights.InAirLandRemainingTime = landRemainingTime
    normalDebugWeights.InAirLandMovementRemainingTime =
      landMovementRelevantAnimTimeRemaining
    normalDebugWeights.InAirTransitionCount =
      locomotionPoseGraphRuntime.transitionsTakenThisFrame
    normalDebugWeights.InAirJumpTransitionCount =
      locomotionPoseGraphRuntime.jumpTransitionsTakenThisFrame
    const landMovementToGroundedTransition =
      locomotionPoseGraphRuntime.outerTransitionStack.activeTransitions.find(
        (transition) =>
          transition.previousState === 'Land Movement'
          && transition.nextState === 'Grounded',
      )
    normalDebugWeights.InAirLandMovementCrossfadeDuration =
      landMovementToGroundedTransition?.crossfadeDuration ?? 0
    normalDebugWeights.InAirLandMovementCrossfadeElapsedTime =
      landMovementToGroundedTransition?.elapsedTime ?? 0
    normalDebugWeights.LandToGroundedNotifyCount =
      landToGroundedNotifyCount
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
    if (gltf.exposeDebugGlobals !== false && gltf.publishDiagnostics !== false) window.__weightTable = normalDebugWeights
    if (
      groundedStanceTransitionSource
      && !groundedStanceTransitionState.active
    ) {
      groundedStanceTransitionSource = null
    }
    nativePostUpdateAnimation()
  }

  return {
    inspectPose: (stage) => ({
      boneNames: rig.boneNames,
      pose: stage === 'overlay' ? evaluator.overlayPose : stage === 'locomotion' ? evaluator.basePose : evaluator.outputPose,
      curves: stage === 'overlay' ? overlayInertialization.curves : stage === 'locomotion' ? postLocomotionSlotCurveScratch : publishedCurves,
    }),
    ragdolling,
    getUpMontage: {
      Montage_Play: playGetUpMontage,
      takeNotifyEvents: () => pendingGetUpNotifyEvents.splice(0),
    },
    StopMontages: (duration) => {
      upperBodySlot.stop(duration)
      const mantle = getActiveMantlingMontageInstance()
      if (mantle) stopActiveMantlingMontage(mantle.sample.instanceId, duration)
      for (const slotName of [POST_LOCOMOTION_SLOT_NAME, TRANSITION_SLOT_NAME,
        TURN_IN_PLACE_STANDING_SLOT_NAME, TURN_IN_PLACE_CROUCHING_SLOT_NAME]) {
        stopSlotAnimation(slotMontageClock, duration, slotName)
      }
      clearSoloClip()
    },
    playClip,
    clearSoloClip,
    setHipsDirection,
    SetGroundedEntryMode,
    jump,
    getRollingSnapshot: () => {
      const active = slotMontageClock.activeByGroup.get(LOCOMOTION_SLOT_GROUP_NAME)
      return active && rollingMontageInstances.has(active.sample.instanceId) ? {
        position: active.sample.montageTime, playRate: active.request.playRate,
      } : undefined
    },
    setRollingPosition: (position) => {
      const active = slotMontageClock.activeByGroup.get(LOCOMOTION_SLOT_GROUP_NAME)
      if (active && rollingMontageInstances.has(active.sample.instanceId)) {
        setSlotMontagePosition(slotMontageClock, active.sample.instanceId, position)
      }
    },
    getMantlingSnapshot: () => {
      const instance = getActiveMantlingMontageInstance()
      return instance ? {
        settings: instance.settings.Name,
        position: instance.sample.montageTime,
      } : undefined
    },
    getCurveValue: (name) => publishedCurves.get(name) ?? 0,
    dispatchQueuedAnimEvents,
    dispatchQueuedFootstepEffectsEvents,
    mantlingMontage: Object.freeze({
      play: playMantlingMontage,
      montageSetPosition: setMantlingMontagePosition,
      montageStop: stopMantlingMontage,
      stopMontageInstance: stopMantlingMontageInstance,
      takeNotifyEvents: takeMantlingNotifyEvents,
    }),
    rollingMontage: Object.freeze({
      Montage_IsPlaying: isRollingMontagePlaying,
      IsPlayingRootMotion: () =>
        slotMontageClock.rootMotionMontageInstance !== null,
      Montage_Play: playRollingMontage,
      takeNotifyEvents: takeRollingNotifyEvents,
      ConsumeExtractedRootMotion:
        ConsumeExtractedRollingRootMotion,
    }),
    state,
    refresh,
  }
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
