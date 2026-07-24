import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
} from '../../engine/blendSpace'
import type {
  AuthoredBlendSpace,
  BlendSpaceEvaluator,
} from '../../engine/blendSpace'
import type { CompiledWeightBlendProfile } from '../../engine/blendProfile'
import {
  advanceStateMachineTransitionStack,
  createStateMachineTransitionStack,
  resetStateMachineTransitionStack,
  startStateMachineStandardTransition,
  writeStateMachineStateWeights,
} from '../../engine/stateMachineTransitionStack'
import type {
  StateMachineStandardTransition,
  StateMachineTransitionStack,
} from '../../engine/stateMachineTransitionStack'

/*
 * ALS standing grounded locomotion, kept as an executable description of AB_Als_Standing.
 *
 * VERIFIED:
 * - RefreshPose(), RefreshMovementDirection(), and RefreshStandingMovement() are direct ports
 *   of ALS Refactored 4.15's AlsAnimationInstance.cpp.
 * - The stride curves are the rich-curve keys authored in
 *   CF_Als_StrideBlendAmount_{Walk,Run}.uasset.
 * - Player/state/transition metadata is serialized AB_Als_Standing data from abp-graph.json.
 * - The generated Kismet bytecode supplies all 24 transition predicates and their priority.
 * - Each state evaluates the bytecode-bound normalized MultiWayBlend over four of the six
 *   synchronized cached BlendSpace players.
 * - Every cached player evaluates the authored topology from blend-spaces.json.
 * - The Movement States adapter uses the owned UE transition stack, including interrupted
 *   standard blends, reversal duration scaling, scalar state relevance, and per-bone
 *   MoveDirectionChange propagation.
 */

export const ALS_GAITS = ['Walking', 'Running', 'Sprinting'] as const
export type AlsGait = (typeof ALS_GAITS)[number]

export const ALS_ROTATION_MODES = [
  'VelocityDirection',
  'ViewDirection',
  'Aiming',
] as const
export type AlsRotationMode = (typeof ALS_ROTATION_MODES)[number]

export const ALS_MOVEMENT_DIRECTIONS = [
  'Forward',
  'Backward',
  'Left',
  'Right',
] as const
export type AlsMovementDirection = (typeof ALS_MOVEMENT_DIRECTIONS)[number]

export const ALS_HIPS_DIRECTIONS = [
  'Forward',
  'Backward',
  'LeftForward',
  'LeftBackward',
  'RightForward',
  'RightBackward',
] as const
export type AlsHipsDirection = (typeof ALS_HIPS_DIRECTIONS)[number]

export const UE_SMALL_NUMBER = 1e-8
export const UE_KINDA_SMALL_NUMBER = 1e-4

export const ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND = {
  animatedWalkSpeed: 150,
  animatedRunSpeed: 350,
  animatedSprintSpeed: 600,
} as const

/**
 * MS_Als_Normal gameplay limits are intentionally separate from the animated speeds above.
 * Using 175/375/650 as animation denominators is not ALS's play-rate calculation.
 */
export const ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND = {
  VelocityDirection: {
    walkForwardSpeed: 175,
    walkBackwardSpeed: 175,
    runForwardSpeed: 375,
    runBackwardSpeed: 375,
    sprintSpeed: 650,
  },
  ViewDirection: {
    walkForwardSpeed: 175,
    walkBackwardSpeed: 175,
    runForwardSpeed: 375,
    runBackwardSpeed: 375,
    sprintSpeed: 650,
  },
  Aiming: {
    walkForwardSpeed: 165,
    walkBackwardSpeed: 165,
    runForwardSpeed: 375,
    runBackwardSpeed: 375,
    sprintSpeed: 650,
  },
} as const

interface StrideBlendCurveKey {
  readonly time: number
  readonly value: number
  readonly interpolation: 'cubic' | 'linear'
  readonly arriveTangent: number
  readonly leaveTangent: number
}

const STRIDE_BLEND_AMOUNT_WALK_CURVE: readonly StrideBlendCurveKey[] = [
  {
    time: 0,
    value: 0.2,
    interpolation: 'cubic',
    arriveTangent: 0,
    leaveTangent: 0,
  },
  {
    time: 58.3,
    value: 0.54999995,
    interpolation: 'cubic',
    arriveTangent: 0.012879322,
    leaveTangent: 0.012879322,
  },
  {
    time: 150,
    value: 1,
    interpolation: 'linear',
    arriveTangent: 0,
    leaveTangent: 0,
  },
]

const STRIDE_BLEND_AMOUNT_RUN_CURVE: readonly StrideBlendCurveKey[] = [
  {
    time: 0,
    value: 0.2,
    interpolation: 'cubic',
    arriveTangent: 0,
    leaveTangent: 0,
  },
  {
    time: 166.9,
    value: 0.45000002,
    interpolation: 'cubic',
    arriveTangent: 0.0033657213,
    leaveTangent: 0.0033657213,
  },
  {
    time: 350,
    value: 1,
    interpolation: 'linear',
    arriveTangent: 0,
    leaveTangent: 0,
  },
]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount
}

function cubicInterp(
  from: number,
  fromTangent: number,
  to: number,
  toTangent: number,
  amount: number,
) {
  const amountSquared = amount * amount
  const amountCubed = amountSquared * amount
  return (
    (2 * amountCubed - 3 * amountSquared + 1) * from
    + (amountCubed - 2 * amountSquared + amount) * fromTangent
    + (-2 * amountCubed + 3 * amountSquared) * to
    + (amountCubed - amountSquared) * toTangent
  )
}

function sampleStrideBlendCurve(
  keys: readonly StrideBlendCurveKey[],
  speedCmPerSecond: number,
) {
  if (speedCmPerSecond <= keys[0].time) return keys[0].value
  const last = keys[keys.length - 1]
  if (speedCmPerSecond >= last.time) return last.value

  for (let index = 0; index < keys.length - 1; index++) {
    const from = keys[index]
    const to = keys[index + 1]
    if (speedCmPerSecond > to.time) continue

    const duration = to.time - from.time
    const amount = (speedCmPerSecond - from.time) / duration
    if (from.interpolation === 'linear') {
      return lerp(from.value, to.value, amount)
    }
    return cubicInterp(
      from.value,
      from.leaveTangent * duration,
      to.value,
      to.arriveTangent * duration,
      amount,
    )
  }

  return last.value
}

export function sampleStrideBlendAmountWalk(speedCmPerSecond: number) {
  return sampleStrideBlendCurve(
    STRIDE_BLEND_AMOUNT_WALK_CURVE,
    speedCmPerSecond,
  )
}

export function sampleStrideBlendAmountRun(speedCmPerSecond: number) {
  return sampleStrideBlendCurve(
    STRIDE_BLEND_AMOUNT_RUN_CURVE,
    speedCmPerSecond,
  )
}

export interface AlsPoseGaitState {
  readonly gaitAmount: number
  readonly gaitWalkingAmount: number
  readonly gaitRunningAmount: number
  readonly gaitSprintingAmount: number
  readonly unweightedGaitAmount: number
  readonly unweightedGaitWalkingAmount: number
  readonly unweightedGaitRunningAmount: number
  readonly unweightedGaitSprintingAmount: number
}

/** AlsAnimationInstance.cpp RefreshPose(), limited to the gait values consumed here. */
export function refreshPoseGait(
  poseGaitCurveValue: number,
  poseGroundedCurveValue: number,
): AlsPoseGaitState {
  const gaitAmount = clamp(poseGaitCurveValue, 0, 3)
  const unweightedGaitAmount = poseGroundedCurveValue > UE_SMALL_NUMBER
    ? gaitAmount / poseGroundedCurveValue
    : gaitAmount

  return {
    gaitAmount,
    gaitWalkingAmount: clamp01(gaitAmount),
    gaitRunningAmount: clamp01(gaitAmount - 1),
    gaitSprintingAmount: clamp01(gaitAmount - 2),
    unweightedGaitAmount,
    unweightedGaitWalkingAmount: clamp01(unweightedGaitAmount),
    unweightedGaitRunningAmount: clamp01(unweightedGaitAmount - 1),
    unweightedGaitSprintingAmount: clamp01(unweightedGaitAmount - 2),
  }
}

export interface AlsStandingMovementInput {
  /** LocomotionState.Speed, in Unreal's native cm/s. */
  readonly locomotionSpeed: number
  /** LocomotionState.Scale. ALS samples the stride curves at Speed / Scale. */
  readonly locomotionScale: number
  readonly gait: AlsGait
  readonly poseGaitCurveValue: number
  readonly poseGroundedCurveValue: number
}

export interface AlsStandingMovementState {
  readonly speed: number
  readonly strideBlendAmount: number
  readonly walkRunBlendAmount: number
  readonly playRate: number
  readonly poseGait: AlsPoseGaitState
}

/** AlsAnimationInstance.cpp RefreshStandingMovement(), through the locomotion play rate. */
export function refreshStandingMovement(
  input: AlsStandingMovementInput,
): AlsStandingMovementState {
  const speed = input.locomotionSpeed / input.locomotionScale
  const poseGait = refreshPoseGait(
    input.poseGaitCurveValue,
    input.poseGroundedCurveValue,
  )
  const strideBlendAmount = lerp(
    sampleStrideBlendAmountWalk(speed),
    sampleStrideBlendAmountRun(speed),
    poseGait.unweightedGaitRunningAmount,
  )
  const walkRunBlendAmount = input.gait === 'Walking' ? 0 : 1

  const walkRunSpeedAmount = lerp(
    speed / ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND.animatedWalkSpeed,
    speed / ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND.animatedRunSpeed,
    poseGait.unweightedGaitRunningAmount,
  )
  const walkRunSprintSpeedAmount = lerp(
    walkRunSpeedAmount,
    speed / ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND.animatedSprintSpeed,
    poseGait.unweightedGaitSprintingAmount,
  )
  const playRate = clamp(
    walkRunSprintSpeedAmount / strideBlendAmount,
    UE_KINDA_SMALL_NUMBER,
    3,
  )

  return {
    speed,
    strideBlendAmount,
    walkRunBlendAmount,
    playRate,
    poseGait,
  }
}

/**
 * UAlsMath::CalculateMovementDirection(). The overlapping threshold bands deliberately preserve
 * ALS's branch order: Forward wins the 65..75 degree overlaps.
 */
export function calculateMovementDirection(
  angle: number,
  forwardHalfAngle = 70,
  angleThreshold = 5,
): AlsMovementDirection {
  if (
    angle >= -forwardHalfAngle - angleThreshold
    && angle <= forwardHalfAngle + angleThreshold
  ) {
    return 'Forward'
  }
  if (
    angle >= forwardHalfAngle - angleThreshold
    && angle <= 180 - forwardHalfAngle + angleThreshold
  ) {
    return 'Right'
  }
  if (
    angle <= -(forwardHalfAngle - angleThreshold)
    && angle >= -(180 - forwardHalfAngle + angleThreshold)
  ) {
    return 'Left'
  }
  return 'Backward'
}

/** AlsAnimationInstance.cpp RefreshMovementDirection(). */
export function refreshMovementDirection(
  rotationMode: AlsRotationMode,
  gait: AlsGait,
  viewRelativeVelocityYawAngle: number,
): AlsMovementDirection {
  if (rotationMode === 'VelocityDirection' || gait === 'Sprinting') {
    return 'Forward'
  }
  return calculateMovementDirection(viewRelativeVelocityYawAngle)
}

export type AlsWalkRunBlendSpaceName =
  | 'BS_Als_WalkRun_Forward'
  | 'BS_Als_WalkRun_Backward'
  | 'BS_Als_WalkRun_Left_Forward'
  | 'BS_Als_WalkRun_Left_Backward'
  | 'BS_Als_WalkRun_Right_Forward'
  | 'BS_Als_WalkRun_Right_Backward'

export interface AlsGroundedDirectionStateDefinition {
  readonly stateIndex: number
  readonly stateName: string
  readonly hipsDirection: AlsHipsDirection
  readonly blendSpaceName: AlsWalkRunBlendSpaceName
  readonly compiledPlayerNodeIndex: number
  readonly cachePoseName: string
  readonly alwaysResetOnEntry: false
}

export const ALS_GROUNDED_DIRECTION_STATES:
Readonly<Record<AlsHipsDirection, AlsGroundedDirectionStateDefinition>> = {
  Forward: {
    stateIndex: 0,
    stateName: 'Move Forward',
    hipsDirection: 'Forward',
    blendSpaceName: 'BS_Als_WalkRun_Forward',
    compiledPlayerNodeIndex: 127,
    cachePoseName: 'Move Forward Base',
    alwaysResetOnEntry: false,
  },
  Backward: {
    stateIndex: 1,
    stateName: 'Move Backward',
    hipsDirection: 'Backward',
    blendSpaceName: 'BS_Als_WalkRun_Backward',
    compiledPlayerNodeIndex: 128,
    cachePoseName: 'Move Backward',
    alwaysResetOnEntry: false,
  },
  LeftForward: {
    stateIndex: 4,
    stateName: 'Move Left Forward',
    hipsDirection: 'LeftForward',
    blendSpaceName: 'BS_Als_WalkRun_Left_Forward',
    compiledPlayerNodeIndex: 125,
    cachePoseName: 'Move Left Forward',
    alwaysResetOnEntry: false,
  },
  LeftBackward: {
    stateIndex: 5,
    stateName: 'Move Left Backward',
    hipsDirection: 'LeftBackward',
    blendSpaceName: 'BS_Als_WalkRun_Left_Backward',
    compiledPlayerNodeIndex: 126,
    cachePoseName: 'Move Left Backward',
    alwaysResetOnEntry: false,
  },
  RightForward: {
    stateIndex: 2,
    stateName: 'Move Right Forward',
    hipsDirection: 'RightForward',
    blendSpaceName: 'BS_Als_WalkRun_Right_Forward',
    compiledPlayerNodeIndex: 123,
    cachePoseName: 'Move Right Forward',
    alwaysResetOnEntry: false,
  },
  RightBackward: {
    stateIndex: 3,
    stateName: 'Move Right Backward',
    hipsDirection: 'RightBackward',
    blendSpaceName: 'BS_Als_WalkRun_Right_Backward',
    compiledPlayerNodeIndex: 124,
    cachePoseName: 'Move Right Backward',
    alwaysResetOnEntry: false,
  },
}

export const ALS_GROUNDED_DIRECTION_STATE_ORDER = [
  'Forward',
  'Backward',
  'RightForward',
  'RightBackward',
  'LeftForward',
  'LeftBackward',
] as const satisfies readonly AlsHipsDirection[]

export const ALS_GROUNDED_DIRECTION_MACHINE = {
  nodeIndex: 201,
  stateMachineIndexInClass: 0,
  machineName: 'Movement States',
  initialState: 'Forward',
  maxTransitionsPerFrame: 3,
  maxTransitionRequests: 32,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
  createNotifyMetadata: true,
  allowConduitEntryStates: false,
} as const

export const ALS_GROUNDED_DIRECTION_PLAYER = {
  syncGroupName: 'Movement',
  syncGroupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  startPosition: 0.2,
  loop: true,
  resetPlayTimeWhenBlendSpaceChanges: true,
} as const

export type AlsDirectionTransitionBlendOption = 'Cubic' | 'QuadraticInOut'

export type AlsGroundedDirectionTransitionRule =
  | 'MoveForward'
  | 'MoveBackward'
  | 'MoveLeft'
  | 'MoveRight'
  | 'SetHipsLeft'
  | 'SetHipsRight'
  | 'NeutralRightBackward'
  | 'NeutralLeftBackward'

export interface AlsGroundedDirectionTransition {
  readonly transitionIndex: number
  readonly from: AlsHipsDirection
  readonly to: AlsHipsDirection
  readonly rule: AlsGroundedDirectionTransitionRule
  readonly priorityOrder: 1 | 2
  readonly duration: number
  readonly blendOption: AlsDirectionTransitionBlendOption
  readonly blendProfile: 'MoveDirectionChange'
  readonly activatePivot: boolean
  readonly compiledDelegateIndex: number
}

type DirectionTransitionRow = readonly [
  from: AlsHipsDirection,
  to: AlsHipsDirection,
  rule: AlsGroundedDirectionTransitionRule,
  priorityOrder: 1 | 2,
  duration: number,
  blendOption: AlsDirectionTransitionBlendOption,
  activatePivot: boolean,
  compiledDelegateIndex: number,
]

const DIRECTION_TRANSITION_ROWS: readonly DirectionTransitionRow[] = [
  ['Forward', 'RightForward', 'MoveRight', 1, 0.7, 'Cubic', false, 152],
  ['Forward', 'LeftForward', 'MoveLeft', 1, 0.7, 'Cubic', false, 151],
  ['Forward', 'Backward', 'MoveBackward', 1, 0.5, 'Cubic', true, 150],
  ['Backward', 'RightBackward', 'MoveRight', 1, 0.7, 'Cubic', false, 152],
  ['Backward', 'LeftBackward', 'MoveLeft', 1, 0.7, 'Cubic', false, 151],
  ['Backward', 'Forward', 'MoveForward', 1, 0.5, 'Cubic', true, 149],
  ['RightForward', 'LeftBackward', 'MoveLeft', 1, 0.5, 'Cubic', true, 151],
  ['RightForward', 'RightBackward', 'MoveBackward', 1, 0.7, 'Cubic', false, 150],
  ['RightForward', 'Forward', 'MoveForward', 1, 0.7, 'Cubic', false, 149],
  ['RightForward', 'RightBackward', 'SetHipsLeft', 2, 0.75, 'QuadraticInOut', false, 148],
  ['RightBackward', 'LeftForward', 'MoveLeft', 1, 0.5, 'Cubic', true, 151],
  ['RightBackward', 'RightForward', 'MoveForward', 1, 0.75, 'QuadraticInOut', false, 149],
  [
    'RightBackward',
    'RightForward',
    'NeutralRightBackward',
    1,
    0.75,
    'QuadraticInOut',
    false,
    147,
  ],
  ['RightBackward', 'Backward', 'MoveBackward', 1, 0.7, 'Cubic', false, 150],
  ['RightBackward', 'RightForward', 'SetHipsRight', 2, 0.75, 'QuadraticInOut', false, 146],
  ['LeftForward', 'RightBackward', 'MoveRight', 1, 0.5, 'Cubic', true, 152],
  ['LeftForward', 'LeftBackward', 'MoveBackward', 1, 0.7, 'Cubic', false, 150],
  ['LeftForward', 'Forward', 'MoveForward', 1, 0.7, 'Cubic', false, 149],
  ['LeftForward', 'LeftBackward', 'SetHipsRight', 2, 0.75, 'QuadraticInOut', false, 146],
  ['LeftBackward', 'RightForward', 'MoveRight', 1, 0.5, 'Cubic', true, 152],
  ['LeftBackward', 'LeftForward', 'MoveForward', 1, 0.7, 'Cubic', false, 149],
  [
    'LeftBackward',
    'LeftForward',
    'NeutralLeftBackward',
    1,
    0.75,
    'QuadraticInOut',
    false,
    145,
  ],
  ['LeftBackward', 'Backward', 'MoveBackward', 1, 0.7, 'Cubic', false, 150],
  ['LeftBackward', 'LeftForward', 'SetHipsLeft', 2, 0.75, 'QuadraticInOut', false, 148],
]

export const ALS_GROUNDED_DIRECTION_TRANSITIONS:
readonly AlsGroundedDirectionTransition[] = DIRECTION_TRANSITION_ROWS.map(
  ([
    from,
    to,
    rule,
    priorityOrder,
    duration,
    blendOption,
    activatePivot,
    compiledDelegateIndex,
  ], transitionIndex) => ({
    transitionIndex,
    from,
    to,
    rule,
    priorityOrder,
    duration,
    blendOption,
    blendProfile: 'MoveDirectionChange',
    activatePivot,
    compiledDelegateIndex,
  }),
)

export const ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS = {
  kind: 'verified',
  source:
    'AB_Als_Standing generated Kismet bytecode, cross-checked against its serialized state machine.',
} as const

export const ALS_MOVE_DIRECTION_CHANGE_PROFILE_STATUS = {
  kind: 'verified',
  implemented: true,
  blendScale: 2,
  bones: [
    'thigh_l',
    'calf_l',
    'calf_twist_01_l',
    'foot_l',
    'ball_l',
    'thigh_twist_01_l',
    'thigh_r',
    'calf_r',
    'calf_twist_01_r',
    'foot_r',
    'ball_r',
    'thigh_twist_01_r',
    'ik_foot_root',
    'ik_foot_l',
    'ik_foot_r',
    'VB foot_root',
    'VB foot_l',
    'VB foot_r',
  ],
} as const

export interface AlsGroundedDirectionTransitionInput {
  readonly hipsDirection: AlsHipsDirection
  readonly movementDirection: AlsMovementDirection
  /** Previous resolved HipsDirectionLock curve; ALS clamps this to [-1, 1]. */
  readonly hipsDirectionLockAmount: number
  /** Previous resolved FeetCrossing curve; ALS clamps this to [0, 1]. */
  readonly feetCrossingAmount: number
  /** GetInstanceStateWeight() for the current Movement States state. */
  readonly stateWeight: number
}

function matchesGroundedDirectionTransitionRule(
  rule: AlsGroundedDirectionTransitionRule,
  input: AlsGroundedDirectionTransitionInput,
) {
  const hipsDirectionLockAmount = clamp(
    input.hipsDirectionLockAmount,
    -1,
    1,
  )
  const feetCrossingAmount = clamp01(input.feetCrossingAmount)

  switch (rule) {
    case 'MoveForward':
      return input.movementDirection === 'Forward'
    case 'MoveBackward':
      return input.movementDirection === 'Backward'
    case 'MoveLeft':
      return input.movementDirection === 'Left'
    case 'MoveRight':
      return input.movementDirection === 'Right'
    case 'SetHipsLeft':
      return hipsDirectionLockAmount <= -0.5 && feetCrossingAmount <= 0
    case 'SetHipsRight':
      return hipsDirectionLockAmount >= 0.5 && feetCrossingAmount <= 0
    case 'NeutralRightBackward':
      return (
        input.stateWeight >= 1
        && Math.abs(hipsDirectionLockAmount) < 0.5
        && feetCrossingAmount <= 0
      )
    case 'NeutralLeftBackward':
      return (
        input.stateWeight >= 1
        && Math.abs(hipsDirectionLockAmount) < 0.5
        && feetCrossingAmount <= 0
      )
  }
}

/**
 * Evaluates the authored outgoing transition array in its baked order. P1 movement/neutral
 * transitions precede P2 SetHips transitions, matching AB_Als_Standing when predicates overlap.
 */
export function selectGroundedDirectionTransition(
  input: AlsGroundedDirectionTransitionInput,
): AlsGroundedDirectionTransition | null {
  for (const transition of ALS_GROUNDED_DIRECTION_TRANSITIONS) {
    if (transition.from !== input.hipsDirection) continue
    if (matchesGroundedDirectionTransitionRule(transition.rule, input)) {
      return transition
    }
  }
  return null
}

export interface AlsGroundedDirectionStateWeights {
  forward: number
  backward: number
  leftForward: number
  leftBackward: number
  rightForward: number
  rightBackward: number
}

/**
 * One-hot convenience view for a settled state. Transition-time callers use
 * `AlsGroundedDirectionRuntime.stateWeights`, whose scalar recurrence is owned by the generic UE
 * transition stack.
 */
export function selectGroundedDirectionState(
  hipsDirection: AlsHipsDirection,
): AlsGroundedDirectionStateWeights {
  return {
    forward: Number(hipsDirection === 'Forward'),
    backward: Number(hipsDirection === 'Backward'),
    leftForward: Number(hipsDirection === 'LeftForward'),
    leftBackward: Number(hipsDirection === 'LeftBackward'),
    rightForward: Number(hipsDirection === 'RightForward'),
    rightBackward: Number(hipsDirection === 'RightBackward'),
  }
}

export function authoredDirectionTransitions(
  from: AlsHipsDirection,
  to: AlsHipsDirection,
) {
  return ALS_GROUNDED_DIRECTION_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.to === to,
  )
}

export interface AlsGroundedDirectionPoseWeights {
  Forward: number
  Backward: number
  RightForward: number
  RightBackward: number
  LeftForward: number
  LeftBackward: number
}

export function createAlsGroundedDirectionPoseWeights():
AlsGroundedDirectionPoseWeights {
  return {
    Forward: 0,
    Backward: 0,
    RightForward: 0,
    RightBackward: 0,
    LeftForward: 0,
    LeftBackward: 0,
  }
}

export type AlsGroundedDirectionActiveTransition =
  StateMachineStandardTransition<AlsHipsDirection>

export interface AlsGroundedDirectionRuntime {
  relevant: boolean
  /** Oldest retained pose source in UE's interrupted-transition stack. */
  readonly baseState: AlsHipsDirection
  readonly currentState: AlsHipsDirection
  readonly transitionStack: StateMachineTransitionStack<AlsHipsDirection>
  /** Oldest-to-newest nested standard-blend plan. */
  readonly activeTransitions:
    readonly AlsGroundedDirectionActiveTransition[]
  /** Scalar GetInstanceStateWeight() values; per-bone pose weights live on each transition. */
  readonly stateWeights: AlsGroundedDirectionPoseWeights
  readonly stateWeightBuffer: Float32Array
  readonly moveDirectionChangeBlendProfile:
    CompiledWeightBlendProfile | null
  transitionsTakenThisFrame: number
  lastSetHipsDirection: AlsHipsDirection | null
  lastStartedTransition: AlsGroundedDirectionTransition | null
  pivotActivatedThisFrame: boolean
}

export interface AlsGroundedDirectionRuntimeInput {
  readonly relevant: boolean
  readonly movementDirection: AlsMovementDirection
  readonly hipsDirectionLockAmount: number
  readonly feetCrossingAmount: number
}

export type AlsSetHipsDirection = (
  hipsDirection: AlsHipsDirection,
) => void

export type AlsGroundedDirectionTransitionStarted = (
  transition: AlsGroundedDirectionTransition,
) => void

/**
 * Creates AB_Als_Standing node 201 / Movement States.
 *
 * The no-argument form exists for scalar state-rule tests. Live pose evaluation supplies the
 * SK_Als rig bone count and compiled MoveDirectionChange profile so every retained transition
 * carries the authored WeightFactor masks.
 */
export function createAlsGroundedDirectionRuntime(
  boneCount = 1,
  moveDirectionChangeBlendProfile:
    CompiledWeightBlendProfile | null = null,
): AlsGroundedDirectionRuntime {
  const transitionStack = createStateMachineTransitionStack(
    ALS_GROUNDED_DIRECTION_MACHINE.initialState,
    boneCount,
    ALS_GROUNDED_DIRECTION_MACHINE.maxTransitionsPerFrame + 1,
  )
  const stateWeights = createAlsGroundedDirectionPoseWeights()
  stateWeights.Forward = 1

  return {
    relevant: false,
    get baseState() {
      return transitionStack.activeTransitions[0]?.previousState
        ?? transitionStack.currentState
    },
    get currentState() {
      return transitionStack.currentState
    },
    transitionStack,
    activeTransitions: transitionStack.activeTransitions,
    stateWeights,
    stateWeightBuffer: new Float32Array(
      ALS_GROUNDED_DIRECTION_STATE_ORDER.length,
    ),
    moveDirectionChangeBlendProfile,
    transitionsTakenThisFrame: 0,
    lastSetHipsDirection: null,
    lastStartedTransition: null,
    pivotActivatedThisFrame: false,
  }
}

function refreshGroundedDirectionStateWeights(
  runtime: AlsGroundedDirectionRuntime,
) {
  writeStateMachineStateWeights(
    runtime.transitionStack,
    ALS_GROUNDED_DIRECTION_STATE_ORDER,
    runtime.stateWeightBuffer,
  )
  for (
    let index = 0;
    index < ALS_GROUNDED_DIRECTION_STATE_ORDER.length;
    index++
  ) {
    runtime.stateWeights[
      ALS_GROUNDED_DIRECTION_STATE_ORDER[index]
    ] = runtime.stateWeightBuffer[index]
  }
}

function resetGroundedDirectionRuntimeState(
  runtime: AlsGroundedDirectionRuntime,
) {
  resetStateMachineTransitionStack(
    runtime.transitionStack,
    ALS_GROUNDED_DIRECTION_MACHINE.initialState,
  )
  refreshGroundedDirectionStateWeights(runtime)
  runtime.transitionsTakenThisFrame = 0
  runtime.lastSetHipsDirection = null
  runtime.lastStartedTransition = null
  runtime.pivotActivatedThisFrame = false
}

export function resetAlsGroundedDirectionRuntime(
  runtime: AlsGroundedDirectionRuntime,
): AlsGroundedDirectionRuntime {
  runtime.relevant = false
  resetGroundedDirectionRuntimeState(runtime)
  return runtime
}

function emitSetHipsDirection(
  runtime: AlsGroundedDirectionRuntime,
  hipsDirection: AlsHipsDirection,
  setHipsDirection: AlsSetHipsDirection | undefined,
) {
  runtime.lastSetHipsDirection = hipsDirection
  setHipsDirection?.(hipsDirection)
}

function startGroundedDirectionTransition(
  runtime: AlsGroundedDirectionRuntime,
  transition: AlsGroundedDirectionTransition,
  setHipsDirection: AlsSetHipsDirection | undefined,
  transitionStarted:
    AlsGroundedDirectionTransitionStarted | undefined,
) {
  startStateMachineStandardTransition(runtime.transitionStack, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blendOption,
    blendProfile: runtime.moveDirectionChangeBlendProfile,
  })
  runtime.transitionsTakenThisFrame++
  runtime.lastStartedTransition = transition
  runtime.pivotActivatedThisFrame ||= transition.activatePivot
  refreshGroundedDirectionStateWeights(runtime)

  // Each state authors SetHipsDirection() at OnBecomeRelevant. ActivatePivot is a transition
  // start notify, so the transition callback observes it on the same update that pushed the
  // FAnimationActiveTransitionEntry.
  emitSetHipsDirection(runtime, transition.to, setHipsDirection)
  transitionStarted?.(transition)
}

/**
 * Updates AB_Als_Standing's six-state Movement States machine.
 *
 * A rising relevance edge reinitializes Forward, invokes its OnBecomeRelevant
 * SetHipsDirection(), and consumes bSkipFirstUpdateTransition. Later updates advance every
 * retained transition oldest-to-newest, then follow at most three authored outgoing edges.
 */
export function refreshAlsGroundedDirectionRuntime(
  runtime: AlsGroundedDirectionRuntime,
  input: AlsGroundedDirectionRuntimeInput,
  deltaTime: number,
  setHipsDirection?: AlsSetHipsDirection,
  transitionStarted?: AlsGroundedDirectionTransitionStarted,
): AlsGroundedDirectionRuntime {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      'Standing Movement States delta time must be finite and non-negative',
    )
  }

  runtime.transitionsTakenThisFrame = 0
  runtime.lastSetHipsDirection = null
  runtime.lastStartedTransition = null
  runtime.pivotActivatedThisFrame = false

  if (!input.relevant) {
    runtime.relevant = false
    return runtime
  }

  if (!runtime.relevant) {
    resetGroundedDirectionRuntimeState(runtime)
    runtime.relevant = true
    emitSetHipsDirection(
      runtime,
      ALS_GROUNDED_DIRECTION_MACHINE.initialState,
      setHipsDirection,
    )
    return runtime
  }

  advanceStateMachineTransitionStack(
    runtime.transitionStack,
    deltaTime,
  )
  refreshGroundedDirectionStateWeights(runtime)

  while (
    runtime.transitionsTakenThisFrame
    < ALS_GROUNDED_DIRECTION_MACHINE.maxTransitionsPerFrame
  ) {
    const transition = selectGroundedDirectionTransition({
      hipsDirection: runtime.currentState,
      movementDirection: input.movementDirection,
      hipsDirectionLockAmount: input.hipsDirectionLockAmount,
      feetCrossingAmount: input.feetCrossingAmount,
      stateWeight: runtime.stateWeights[runtime.currentState],
    })
    if (!transition) break

    startGroundedDirectionTransition(
      runtime,
      transition,
      setHipsDirection,
      transitionStarted,
    )
  }

  return runtime
}

export interface AlsGroundedVelocityBlend {
  readonly forwardAmount: number
  readonly backwardAmount: number
  readonly leftAmount: number
  readonly rightAmount: number
}

export type AlsGroundedDirectionMultiWayBlendInputs = readonly [
  forward: AlsHipsDirection,
  backward: AlsHipsDirection,
  left: AlsHipsDirection,
  right: AlsHipsDirection,
]

/**
 * AB_Als_Standing nodes 153..200. Each state feeds the same normalized alphas
 * [ForwardAmount, BackwardAmount, LeftAmount, RightAmount] into a state-specific cache order.
 */
export const ALS_GROUNDED_DIRECTION_MULTI_WAY_BLEND_TABLE: Readonly<
  Record<AlsHipsDirection, AlsGroundedDirectionMultiWayBlendInputs>
> = {
  Forward: ['Forward', 'Backward', 'LeftForward', 'RightForward'],
  Backward: ['Forward', 'Backward', 'LeftBackward', 'RightBackward'],
  RightForward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
  RightBackward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
  LeftForward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
  LeftBackward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
}

export interface AlsGroundedLocomotionGraph {
  readonly evaluators: Readonly<Record<AlsHipsDirection, BlendSpaceEvaluator>>
}

export function createGroundedLocomotionGraph(
  blendSpaces: Readonly<Record<string, AuthoredBlendSpace>>,
): AlsGroundedLocomotionGraph {
  const createEvaluator = (hipsDirection: AlsHipsDirection) => {
    const name = ALS_GROUNDED_DIRECTION_STATES[hipsDirection].blendSpaceName
    const authored = blendSpaces[name]
    if (!authored) throw new Error(`Missing authored ALS BlendSpace ${name}`)
    return createBlendSpaceEvaluator(compileBlendSpace(authored))
  }

  return {
    evaluators: {
      Forward: createEvaluator('Forward'),
      Backward: createEvaluator('Backward'),
      LeftForward: createEvaluator('LeftForward'),
      LeftBackward: createEvaluator('LeftBackward'),
      RightForward: createEvaluator('RightForward'),
      RightBackward: createEvaluator('RightBackward'),
    },
  }
}

export interface AlsGroundedLocomotionClipWeight {
  readonly clip: string
  readonly objectPath?: string
  readonly weight: number
  readonly playRate: number
  readonly rateScale: number
}

function evaluateGroundedLocomotionPlayer(
  graph: AlsGroundedLocomotionGraph,
  player: AlsHipsDirection,
  standing: Pick<
    AlsStandingMovementState,
    'strideBlendAmount' | 'walkRunBlendAmount' | 'playRate'
  >,
) {
  const evaluator = graph.evaluators[player]
  const weights = evaluateBlendSpace(
    evaluator,
    standing.strideBlendAmount,
    standing.walkRunBlendAmount,
  )
  const samples = evaluator.blendSpace.samples
  const result: AlsGroundedLocomotionClipWeight[] = []

  for (let index = 0; index < weights.count; index++) {
    const sample = samples[weights.sampleIndices[index]]
    result.push({
      clip: sample.animation.name,
      objectPath: sample.animation.objectPath,
      weight: weights.weights[index],
      playRate: standing.playRate * sample.rateScale,
      rateScale: sample.rateScale,
    })
  }

  return result
}

/**
 * Evaluates AB_Als_Standing's state-local normalized MultiWayBlend. All six cached players keep
 * their sync clocks upstream; the current state chooses which four cached poses are combined.
 */
export function evaluateGroundedLocomotionGraph(
  graph: AlsGroundedLocomotionGraph,
  hipsDirection: AlsHipsDirection,
  velocityBlend: AlsGroundedVelocityBlend,
  standing: Pick<
    AlsStandingMovementState,
    'strideBlendAmount' | 'walkRunBlendAmount' | 'playRate'
  >,
): readonly AlsGroundedLocomotionClipWeight[] {
  const rawAlphas = [
    velocityBlend.forwardAmount,
    velocityBlend.backwardAmount,
    velocityBlend.leftAmount,
    velocityBlend.rightAmount,
  ] as const
  const alphaTotal = rawAlphas.reduce(
    (total, alpha) => total + Math.max(0, alpha),
    0,
  )
  if (alphaTotal <= UE_SMALL_NUMBER) return []

  const players = ALS_GROUNDED_DIRECTION_MULTI_WAY_BLEND_TABLE[hipsDirection]
  const resultByClip = new Map<string, AlsGroundedLocomotionClipWeight>()

  for (let inputIndex = 0; inputIndex < players.length; inputIndex++) {
    const inputAlpha = Math.max(0, rawAlphas[inputIndex]) / alphaTotal
    if (inputAlpha <= UE_SMALL_NUMBER) continue

    for (const sample of evaluateGroundedLocomotionPlayer(
      graph,
      players[inputIndex],
      standing,
    )) {
      const weight = sample.weight * inputAlpha
      const previous = resultByClip.get(sample.clip)
      if (previous) {
        resultByClip.set(sample.clip, {
          ...previous,
          weight: previous.weight + weight,
        })
      } else {
        resultByClip.set(sample.clip, { ...sample, weight })
      }
    }
  }

  return [...resultByClip.values()]
}
