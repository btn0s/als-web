import type { AlsGait, AlsHipsDirection, AlsMovementDirection } from './groundedLocomotion'

/*
 * AB_Als_Standing's outer grounded controller.
 *
 * VERIFIED:
 * - State names, transition order/settings, player settings, curve writes, and per-foot stop
 *   overlays are serialized AB_Als_Standing content.
 * - Transition predicates and state callbacks are recovered from the generated class Kismet
 *   bytecode and property-access library.
 * - ActivatePivot() and ResetPivot() are direct ALS Refactored 4.15 C++ behavior.
 *
 * HYPOTHESIS:
 * - None in the selectors below. Transition blending, interrupted-transition propagation,
 *   relevancy clocks, sync-group advancement, and callback dispatch belong to the engine
 *   runtime. This module reports the authored transition to request; it does not approximate
 *   those Unreal state-machine semantics.
 */

export type AlsTransitionBlendMode = 'HermiteCubic'
export type AlsTransitionLogic = 'StandardBlend' | 'Inertialization'
export type AlsGroundedStateNotify = 'ActivatePivot' | 'StopQuick'

export interface AlsStateTransition<State extends string> {
  readonly transitionIndex: number
  readonly from: State
  readonly to: State
  readonly duration: number
  readonly blendMode: AlsTransitionBlendMode
  readonly logic: AlsTransitionLogic
  readonly automaticRemainingTimeRule: false
  readonly startNotify: AlsGroundedStateNotify | null
  readonly compiledDelegateIndex: number
  readonly compiledDelegateProperty: string
}

export const ALS_MOVEMENT_DETAILS_STATES = [
  'Walk',
  'Run Start From Walk',
  'Run',
  'First Pivot',
  'Second Pivot',
  'Run Start',
] as const
export type AlsMovementDetailsState =
  (typeof ALS_MOVEMENT_DETAILS_STATES)[number]

export const ALS_STANDING_GROUNDED_STATES = ['Idle', 'Move', 'Stop'] as const
export type AlsStandingGroundedState =
  (typeof ALS_STANDING_GROUNDED_STATES)[number]

export const ALS_STOP_STATES = [
  'Entry',
  'Lock Left Foot',
  'Lock Right Foot',
  'Plant Left Foot',
  'Plant Right Foot',
] as const
export type AlsStopState = (typeof ALS_STOP_STATES)[number]

export const ALS_GROUNDED_STATE_PHASES = [
  'Idle',
  'Move',
  'Run Start',
  'First Pivot',
  'Second Pivot',
  'Stop',
] as const
export type AlsGroundedStatePhase =
  (typeof ALS_GROUNDED_STATE_PHASES)[number]

export const ALS_GROUNDED_STATES_INITIAL_SNAPSHOT = {
  standingState: 'Idle',
  movementDetailsState: 'Walk',
  stopState: 'Entry',
} as const

const transitionDefaults = {
  blendMode: 'HermiteCubic',
  automaticRemainingTimeRule: false,
  startNotify: null,
} as const

export const ALS_MOVEMENT_DETAILS_TRANSITIONS = [
  {
    ...transitionDefaults,
    transitionIndex: 0,
    from: 'Walk',
    to: 'Run Start',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 78,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_8',
  },
  {
    ...transitionDefaults,
    transitionIndex: 1,
    from: 'Walk',
    to: 'Run Start From Walk',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 77,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_9',
  },
  {
    ...transitionDefaults,
    transitionIndex: 2,
    from: 'Walk',
    to: 'Run',
    duration: 0.2,
    logic: 'StandardBlend',
    compiledDelegateIndex: 76,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_10',
  },
  {
    ...transitionDefaults,
    transitionIndex: 3,
    from: 'Run Start From Walk',
    to: 'Run',
    duration: 0.1,
    logic: 'StandardBlend',
    compiledDelegateIndex: 75,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_11',
  },
  {
    ...transitionDefaults,
    transitionIndex: 4,
    from: 'Run',
    to: 'First Pivot',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 74,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_12',
  },
  {
    ...transitionDefaults,
    transitionIndex: 5,
    from: 'Run',
    to: 'Walk',
    duration: 0.1,
    logic: 'StandardBlend',
    compiledDelegateIndex: 73,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_13',
  },
  {
    ...transitionDefaults,
    transitionIndex: 6,
    from: 'First Pivot',
    to: 'Second Pivot',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 72,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_14',
  },
  {
    ...transitionDefaults,
    transitionIndex: 7,
    from: 'First Pivot',
    to: 'Run',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 71,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_15',
  },
  {
    ...transitionDefaults,
    transitionIndex: 8,
    from: 'Second Pivot',
    to: 'Run',
    duration: 0.2,
    logic: 'Inertialization',
    compiledDelegateIndex: 70,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_16',
  },
  {
    ...transitionDefaults,
    transitionIndex: 9,
    from: 'Second Pivot',
    to: 'First Pivot',
    duration: 0.1,
    logic: 'Inertialization',
    compiledDelegateIndex: 72,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_14',
  },
  {
    ...transitionDefaults,
    transitionIndex: 10,
    from: 'Run Start',
    to: 'Run',
    duration: 0.2,
    logic: 'StandardBlend',
    compiledDelegateIndex: 69,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_17',
  },
] as const satisfies readonly AlsStateTransition<AlsMovementDetailsState>[]

/*
 * Rotate Left/Right are separate authored Standing States and deliberately stay with the
 * turn-in-place slice. These four transitions are the exact Idle/Move/Stop subgraph requested
 * by this grounded locomotion controller; transitionIndex retains the full asset index.
 */
export const ALS_STANDING_GROUNDED_TRANSITIONS = [
  {
    ...transitionDefaults,
    transitionIndex: 2,
    from: 'Idle',
    to: 'Move',
    duration: 0.2,
    logic: 'StandardBlend',
    compiledDelegateIndex: 6,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_24',
  },
  {
    ...transitionDefaults,
    transitionIndex: 3,
    from: 'Move',
    to: 'Stop',
    duration: 0,
    logic: 'StandardBlend',
    compiledDelegateIndex: 5,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_25',
  },
  {
    ...transitionDefaults,
    transitionIndex: 4,
    from: 'Move',
    to: 'Idle',
    duration: 0.2,
    logic: 'StandardBlend',
    startNotify: 'StopQuick',
    compiledDelegateIndex: 4,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_26',
  },
  {
    ...transitionDefaults,
    transitionIndex: 5,
    from: 'Stop',
    to: 'Idle',
    duration: 0.3,
    logic: 'StandardBlend',
    compiledDelegateIndex: 3,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_27',
  },
] as const satisfies readonly AlsStateTransition<AlsStandingGroundedState>[]

export const ALS_STOP_TRANSITIONS = [
  {
    ...transitionDefaults,
    transitionIndex: 0,
    from: 'Entry',
    to: 'Lock Right Foot',
    duration: 0,
    logic: 'StandardBlend',
    compiledDelegateIndex: 18,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_18',
  },
  {
    ...transitionDefaults,
    transitionIndex: 1,
    from: 'Entry',
    to: 'Lock Left Foot',
    duration: 0,
    logic: 'StandardBlend',
    compiledDelegateIndex: 17,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_19',
  },
  {
    ...transitionDefaults,
    transitionIndex: 2,
    from: 'Entry',
    to: 'Plant Right Foot',
    duration: 0.1,
    logic: 'StandardBlend',
    compiledDelegateIndex: 16,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_20',
  },
  {
    ...transitionDefaults,
    transitionIndex: 3,
    from: 'Entry',
    to: 'Plant Left Foot',
    duration: 0.1,
    logic: 'StandardBlend',
    compiledDelegateIndex: 15,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_21',
  },
] as const satisfies readonly AlsStateTransition<AlsStopState>[]

export interface AlsMovementDetailsTransitionInput {
  /** An invalid gameplay tag is represented by null, matching IsValid(Gait) == false. */
  readonly gait: AlsGait | null
  readonly poseGroundedAmount: number
  readonly unweightedGaitRunningAmount: number
  readonly standingStatesMachineWeight: number
  readonly pivotActive: boolean
  readonly currentStateElapsedTime: number
  readonly relevantAnimationTimeRemaining: number
}

/**
 * The generated transition rules, evaluated in each state's baked transition order.
 */
export function selectMovementDetailsTransition(
  state: AlsMovementDetailsState,
  input: AlsMovementDetailsTransitionInput,
): AlsStateTransition<AlsMovementDetailsState> | null {
  const running = input.gait === 'Running' || input.gait === 'Sprinting'

  switch (state) {
    case 'Walk':
      if (
        running
        && input.poseGroundedAmount >= 1
        && input.standingStatesMachineWeight < 1
      ) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[0]
      }
      if (
        running
        && input.poseGroundedAmount >= 1
        && input.standingStatesMachineWeight >= 1
      ) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[1]
      }
      if (running && input.poseGroundedAmount < 1) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[2]
      }
      return null

    case 'Run Start From Walk':
      return input.relevantAnimationTimeRemaining <= 0
        ? ALS_MOVEMENT_DETAILS_TRANSITIONS[3]
        : null

    case 'Run':
      if (input.pivotActive) return ALS_MOVEMENT_DETAILS_TRANSITIONS[4]
      if (
        (input.gait === null || input.gait === 'Walking')
        && input.unweightedGaitRunningAmount < 0.2
      ) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[5]
      }
      return null

    case 'First Pivot':
      if (input.pivotActive && input.currentStateElapsedTime > 0.1) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[6]
      }
      return input.relevantAnimationTimeRemaining <= 0
        ? ALS_MOVEMENT_DETAILS_TRANSITIONS[7]
        : null

    case 'Second Pivot':
      if (input.relevantAnimationTimeRemaining <= 0) {
        return ALS_MOVEMENT_DETAILS_TRANSITIONS[8]
      }
      return input.pivotActive && input.currentStateElapsedTime > 0.1
        ? ALS_MOVEMENT_DETAILS_TRANSITIONS[9]
        : null

    case 'Run Start':
      return input.relevantAnimationTimeRemaining <= 0
        ? ALS_MOVEMENT_DETAILS_TRANSITIONS[10]
        : null
  }
}

export interface AlsStandingGroundedTransitionInput {
  readonly movingSmooth: boolean
  readonly moveStateWeight: number
  readonly stopStateWeight: number
}

/**
 * The Idle/Move/Stop rules from Standing States. Move -> Stop intentionally wins over
 * Move -> Idle once Move is full weight because it is the first baked outgoing transition.
 */
export function selectStandingGroundedTransition(
  state: AlsStandingGroundedState,
  input: AlsStandingGroundedTransitionInput,
): AlsStateTransition<AlsStandingGroundedState> | null {
  switch (state) {
    case 'Idle':
      return input.movingSmooth ? ALS_STANDING_GROUNDED_TRANSITIONS[0] : null
    case 'Move':
      if (!input.movingSmooth && input.moveStateWeight >= 1) {
        return ALS_STANDING_GROUNDED_TRANSITIONS[1]
      }
      return !input.movingSmooth
        ? ALS_STANDING_GROUNDED_TRANSITIONS[2]
        : null
    case 'Stop':
      return input.stopStateWeight >= 1
        ? ALS_STANDING_GROUNDED_TRANSITIONS[3]
        : null
  }
}

/**
 * The Stop States entry selector. Lock rules are first in the baked transition order and
 * therefore win at FootPlantedAmount <= -0.5 and > 0.5.
 */
export function selectStopTransition(
  footPlantedAmount: number,
): AlsStateTransition<AlsStopState> {
  if (footPlantedAmount <= -0.5) return ALS_STOP_TRANSITIONS[0]
  if (footPlantedAmount > 0.5) return ALS_STOP_TRANSITIONS[1]
  if (footPlantedAmount <= 0) return ALS_STOP_TRANSITIONS[2]
  return ALS_STOP_TRANSITIONS[3]
}

export const ALS_PIVOT_ACTIVATION_SPEED_THRESHOLD_CM_PER_SECOND = 200

/** UAlsAnimationInstance::ActivatePivot(). */
export function activatePivot(speedCmPerSecond: number) {
  return speedCmPerSecond < ALS_PIVOT_ACTIVATION_SPEED_THRESHOLD_CM_PER_SECOND
}

/** UAlsAnimationInstance::ResetPivot(). */
export function resetPivot() {
  return false
}

export function projectGroundedStatePhase(
  standingState: AlsStandingGroundedState,
  movementDetailsState: AlsMovementDetailsState,
): AlsGroundedStatePhase {
  if (standingState === 'Idle') return 'Idle'
  if (standingState === 'Stop') return 'Stop'

  switch (movementDetailsState) {
    case 'Walk':
    case 'Run':
      return 'Move'
    case 'Run Start':
    case 'Run Start From Walk':
      return 'Run Start'
    case 'First Pivot':
      return 'First Pivot'
    case 'Second Pivot':
      return 'Second Pivot'
  }
}

export interface AlsCurveWrite {
  readonly compiledIndex: number
  readonly curve: string
  readonly value: number
  readonly applyMode: 'Blend' | 'Scale'
}

export const ALS_GROUNDED_STATE_CURVE_OUTPUTS = {
  MovementDetails: [
    { compiledIndex: 122, curve: 'PoseMoving', value: 1, applyMode: 'Blend' },
  ],
  Standing: [
    { compiledIndex: 68, curve: 'PoseStanding', value: 1, applyMode: 'Blend' },
  ],
  Idle: [
    { compiledIndex: 63, curve: 'FootLeftLock', value: 1, applyMode: 'Blend' },
    { compiledIndex: 63, curve: 'FootRightLock', value: 1, applyMode: 'Blend' },
    { compiledIndex: 63, curve: 'AllowTransitions', value: 1, applyMode: 'Blend' },
    { compiledIndex: 62, curve: 'RotationYawSpeed', value: 0, applyMode: 'Scale' },
  ],
  Stop: {
    'Entry': [],
    'Lock Left Foot': [
      { compiledIndex: 48, curve: 'FootLeftLock', value: 1, applyMode: 'Blend' },
    ],
    'Lock Right Foot': [
      { compiledIndex: 45, curve: 'FootRightLock', value: 1, applyMode: 'Blend' },
    ],
    'Plant Left Foot': [
      { compiledIndex: 43, curve: 'FootLeftLock', value: 1, applyMode: 'Blend' },
    ],
    'Plant Right Foot': [
      { compiledIndex: 30, curve: 'FootRightLock', value: 1, applyMode: 'Blend' },
    ],
  },
} as const satisfies {
  readonly MovementDetails: readonly AlsCurveWrite[]
  readonly Standing: readonly AlsCurveWrite[]
  readonly Idle: readonly AlsCurveWrite[]
  readonly Stop: Readonly<Record<AlsStopState, readonly AlsCurveWrite[]>>
}

interface AlsSynchronizedPlayerOptions {
  readonly groupName: string
  readonly groupRole: 'CanBeLeader'
  readonly syncMethod: 'SyncGroup'
  readonly startPosition: number
  readonly playRate: number
  readonly loop: boolean
}

export const ALS_MOVEMENT_BLEND_SPACE_PLAYERS = [
  { direction: 'Forward', compiledIndex: 127, blendSpace: 'BS_Als_WalkRun_Forward' },
  { direction: 'Backward', compiledIndex: 128, blendSpace: 'BS_Als_WalkRun_Backward' },
  { direction: 'LeftForward', compiledIndex: 125, blendSpace: 'BS_Als_WalkRun_Left_Forward' },
  { direction: 'LeftBackward', compiledIndex: 126, blendSpace: 'BS_Als_WalkRun_Left_Backward' },
  { direction: 'RightForward', compiledIndex: 123, blendSpace: 'BS_Als_WalkRun_Right_Forward' },
  { direction: 'RightBackward', compiledIndex: 124, blendSpace: 'BS_Als_WalkRun_Right_Backward' },
] as const satisfies readonly {
  readonly direction: AlsHipsDirection
  readonly compiledIndex: number
  readonly blendSpace: string
}[]

export const ALS_MOVEMENT_BLEND_SPACE_PLAYER_OPTIONS = {
  groupName: 'Movement',
  groupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  startPosition: 0.2,
  playRate: 1,
  loop: true,
  resetPlayTimeWhenBlendSpaceChanges: true,
} as const

export const ALS_SPRINT_PLAYERS = [
  {
    compiledIndex: 129,
    clip: 'A_Als_Sprint',
    duration: 0.6,
    playRateBasis: 1,
  },
  {
    compiledIndex: 130,
    clip: 'A_Als_Sprint_Acceleration',
    duration: 0.6,
    playRateBasis: 0.833333,
  },
] as const

export const ALS_SPRINT_PLAYER_OPTIONS = {
  groupName: 'Movement',
  groupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  startPosition: 0.166667,
  playRate: 1,
  loop: true,
} as const satisfies AlsSynchronizedPlayerOptions

const accelerationClips = {
  Forward: 'A_Als_Acceleration_Forward',
  Backward: 'A_Als_Acceleration_Backward',
  Left: 'A_Als_Acceleration_Left',
  Right: 'A_Als_Acceleration_Right',
} as const satisfies Readonly<Record<AlsMovementDirection, string>>

export const ALS_ACCELERATION_PLAYERS = [
  {
    state: 'Run Start From Walk',
    groupName: 'Run Start',
    startPosition: 0.1,
    compiledIndices: { Forward: 114, Backward: 113, Left: 112, Right: 111 },
  },
  {
    state: 'First Pivot',
    groupName: 'First Pivot',
    startPosition: 0.25,
    compiledIndices: { Forward: 102, Backward: 101, Left: 100, Right: 99 },
  },
  {
    state: 'Second Pivot',
    groupName: 'Second Pivot',
    startPosition: 0.25,
    compiledIndices: { Forward: 93, Backward: 92, Left: 91, Right: 90 },
  },
  {
    state: 'Run Start',
    groupName: 'Run Start',
    startPosition: 0.15,
    compiledIndices: { Forward: 84, Backward: 83, Left: 82, Right: 81 },
  },
] as const

export const ALS_ACCELERATION_PLAYER_OPTIONS = {
  clips: accelerationClips,
  duration: 1,
  additiveType: 'LocalSpaceBase',
  referencePoseSequence: 'A_Als_Lean_Pose',
  referenceFrameIndex: 0,
  curveNames: [],
  notifies: [],
  groupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  playRateBasis: 1,
  playRate: 1.25,
  loop: false,
} as const

export const ALS_IDLE_POSE_EVALUATOR = {
  compiledIndex: 61,
  clip: 'A_Als_Stand_Pose',
  duration: 0.033333,
  groupName: 'None',
  groupRole: 'CanBeLeader',
  syncMethod: 'DoNotSync',
  explicitTime: 0,
  loop: true,
  teleportToExplicitTime: true,
  reinitializationBehavior: 'ExplicitTime',
} as const

const stopPoseClips = {
  Forward: 'A_Als_Walk_Forward',
  Backward: 'A_Als_Walk_Backward',
  LeftForward: 'A_Als_Walk_Left_Forward',
  LeftBackward: 'A_Als_Walk_Left_Backward',
  RightForward: 'A_Als_Walk_Right_Forward',
  RightBackward: 'A_Als_Walk_Right_Backward',
} as const satisfies Readonly<Record<AlsHipsDirection, string>>

export const ALS_STOP_POSE_EVALUATORS = {
  'Plant Right Foot': {
    compiledIndices: {
      Forward: 28,
      Backward: 27,
      LeftForward: 26,
      LeftBackward: 25,
      RightForward: 24,
      RightBackward: 23,
    },
    explicitTimes: {
      Forward: 0.7,
      Backward: 0.7,
      LeftForward: 0.8,
      LeftBackward: 0.8,
      RightForward: 0.766667,
      RightBackward: 0.7,
    },
    layeredBoneBlend: {
      compiledIndex: 29,
      branchFilters: ['thigh_r', 'ik_foot_r', 'VB foot_r'],
    },
  },
  'Plant Left Foot': {
    compiledIndices: {
      Forward: 41,
      Backward: 40,
      LeftForward: 39,
      LeftBackward: 38,
      RightForward: 37,
      RightBackward: 36,
    },
    explicitTimes: {
      Forward: 0.15,
      Backward: 0.15,
      LeftForward: 0.216667,
      LeftBackward: 0.15,
      RightForward: 0.25,
      RightBackward: 0.25,
    },
    layeredBoneBlend: {
      compiledIndex: 42,
      branchFilters: ['thigh_l', 'ik_foot_l', 'VB foot_l'],
    },
  },
} as const

export const ALS_STOP_POSE_EVALUATOR_OPTIONS = {
  clips: stopPoseClips,
  groupName: 'None',
  groupRole: 'CanBeLeader',
  syncMethod: 'DoNotSync',
  loop: true,
  teleportToExplicitTime: true,
  reinitializationBehavior: 'ExplicitTime',
  layeredBoneBlend: {
    blendMode: 'BranchFilter',
    blendWeight: 1,
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendOption: 'Override',
    blendRootMotionBasedOnRootBone: true,
  },
} as const

export type AlsStopTransitionDirection = 'Left' | 'Right'

export const ALS_STOP_TRANSITION_ANIMATIONS = {
  Left: {
    clip: 'A_Als_Stop_Left',
    duration: 2.333333,
  },
  Right: {
    clip: 'A_Als_Stop_Right',
    duration: 2.333333,
  },
  blendInDuration: 0.2,
  blendOutDuration: 0.2,
  playRate: 1.5,
  startTime: 0.4,
  fromStandingIdleOnly: false,
  additiveType: 'RotationOffsetMeshSpace',
  referencePoseSequence: 'A_Als_Stand_Pose',
  referenceFrameIndex: 0,
  curveNames: [
    'AllowTransitions',
    'FootLeftLock',
    'FootRightLock',
    'FootstepSoundBlock',
  ],
  notifies: [
    { name: 'BMAnimNotifyFootstep', time: 0.833333 },
    { name: 'BMAnimNotifyFootstep', time: 1.36667 },
  ],
} as const

export function stopTransitionDirectionForState(
  state: Exclude<AlsStopState, 'Entry'>,
): AlsStopTransitionDirection {
  switch (state) {
    case 'Lock Left Foot':
    case 'Plant Left Foot':
      return 'Left'
    case 'Lock Right Foot':
    case 'Plant Right Foot':
      return 'Right'
  }
}

export const ALS_GROUNDED_STATE_CALLBACKS = {
  Idle: {
    onExit: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
  },
  Move: {
    onEnter: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
  },
  'First Pivot': {
    onBecomeRelevant: { functionName: 'ResetPivot' },
  },
  'Second Pivot': {
    onBecomeRelevant: { functionName: 'ResetPivot' },
  },
  'Lock Left Foot': {
    onEnter: { functionName: 'PlayStopLeftTransitionAnimation' },
  },
  'Plant Left Foot': {
    onEnter: { functionName: 'PlayStopLeftTransitionAnimation' },
  },
  'Lock Right Foot': {
    onEnter: { functionName: 'PlayStopRightTransitionAnimation' },
  },
  'Plant Right Foot': {
    onEnter: { functionName: 'PlayStopRightTransitionAnimation' },
  },
} as const

export interface AlsGroundedStatesSnapshot {
  readonly standingState: AlsStandingGroundedState
  readonly movementDetailsState: AlsMovementDetailsState
  readonly stopState: AlsStopState
}

export interface AlsGroundedStatesControllerInput {
  readonly movementDetails: AlsMovementDetailsTransitionInput
  readonly standing: AlsStandingGroundedTransitionInput
  readonly footPlantedAmount: number
}

export interface AlsGroundedStatesDecision {
  readonly phase: AlsGroundedStatePhase
  readonly standingTransition: AlsStateTransition<AlsStandingGroundedState> | null
  readonly movementDetailsTransition:
    AlsStateTransition<AlsMovementDetailsState> | null
  readonly stopTransition: AlsStateTransition<AlsStopState> | null
}

/**
 * Pure graph decision surface. The owner supplies Unreal-equivalent state weights and clocks;
 * the result identifies the authored transition each active machine requests this update.
 */
export function evaluateGroundedStatesController(
  snapshot: AlsGroundedStatesSnapshot,
  input: AlsGroundedStatesControllerInput,
): AlsGroundedStatesDecision {
  return {
    phase: projectGroundedStatePhase(
      snapshot.standingState,
      snapshot.movementDetailsState,
    ),
    standingTransition: selectStandingGroundedTransition(
      snapshot.standingState,
      input.standing,
    ),
    movementDetailsTransition: snapshot.standingState === 'Move'
      ? selectMovementDetailsTransition(
        snapshot.movementDetailsState,
        input.movementDetails,
      )
      : null,
    stopTransition: snapshot.standingState === 'Stop'
      && snapshot.stopState === 'Entry'
      ? selectStopTransition(input.footPlantedAmount)
      : null,
  }
}
