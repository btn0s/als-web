import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
} from '../../engine/blendSpace'
import type {
  AuthoredBlendSpace,
  BlendSpaceEvaluator,
} from '../../engine/blendSpace'

/*
 * ALS standing grounded locomotion, kept as an executable description of AB_Als_Standing.
 *
 * VERIFIED:
 * - RefreshPose(), RefreshMovementDirection(), and RefreshStandingMovement() are direct ports
 *   of ALS Refactored 4.15's AlsAnimationInstance.cpp.
 * - The stride curves are the rich-curve keys authored in
 *   CF_Als_StrideBlendAmount_{Walk,Run}.uasset.
 * - Player/state/transition metadata is serialized AB_Als_Standing data from abp-graph.json.
 * - Each selected player evaluates the authored topology from blend-spaces.json.
 *
 * HYPOTHESIS:
 * - None is encoded here. CUE4Parse preserves the transition delegate indices, but cannot
 *   decompile their boolean expressions. The caller must therefore provide the HipsDirection
 *   selected by the graph; deriving six clip weights from VelocityBlend would invent behavior
 *   that ALS does not use.
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

export const ALS_GROUNDED_DIRECTION_PLAYER = {
  syncGroupName: 'Movement',
  syncGroupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  startPosition: 0.2,
  loop: true,
  resetPlayTimeWhenBlendSpaceChanges: true,
} as const

export type AlsDirectionTransitionBlendOption = 'Cubic' | 'QuadraticInOut'

export interface AlsGroundedDirectionTransition {
  readonly transitionIndex: number
  readonly from: AlsHipsDirection
  readonly to: AlsHipsDirection
  readonly duration: number
  readonly blendOption: AlsDirectionTransitionBlendOption
  readonly blendProfile: 'MoveDirectionChange'
  readonly activatePivot: boolean
  readonly compiledDelegateIndex: number
}

type DirectionTransitionRow = readonly [
  from: AlsHipsDirection,
  to: AlsHipsDirection,
  duration: number,
  blendOption: AlsDirectionTransitionBlendOption,
  activatePivot: boolean,
  compiledDelegateIndex: number,
]

const DIRECTION_TRANSITION_ROWS: readonly DirectionTransitionRow[] = [
  ['Forward', 'RightForward', 0.7, 'Cubic', false, 51],
  ['Forward', 'LeftForward', 0.7, 'Cubic', false, 52],
  ['Forward', 'Backward', 0.5, 'Cubic', true, 53],
  ['Backward', 'RightBackward', 0.7, 'Cubic', false, 51],
  ['Backward', 'LeftBackward', 0.7, 'Cubic', false, 52],
  ['Backward', 'Forward', 0.5, 'Cubic', true, 54],
  ['RightForward', 'LeftBackward', 0.5, 'Cubic', true, 52],
  ['RightForward', 'RightBackward', 0.7, 'Cubic', false, 53],
  ['RightForward', 'Forward', 0.7, 'Cubic', false, 54],
  ['RightForward', 'RightBackward', 0.75, 'QuadraticInOut', false, 55],
  ['RightBackward', 'LeftForward', 0.5, 'Cubic', true, 52],
  ['RightBackward', 'RightForward', 0.75, 'QuadraticInOut', false, 54],
  ['RightBackward', 'RightForward', 0.75, 'QuadraticInOut', false, 56],
  ['RightBackward', 'Backward', 0.7, 'Cubic', false, 53],
  ['RightBackward', 'RightForward', 0.75, 'QuadraticInOut', false, 57],
  ['LeftForward', 'RightBackward', 0.5, 'Cubic', true, 51],
  ['LeftForward', 'LeftBackward', 0.7, 'Cubic', false, 53],
  ['LeftForward', 'Forward', 0.7, 'Cubic', false, 54],
  ['LeftForward', 'LeftBackward', 0.75, 'QuadraticInOut', false, 57],
  ['LeftBackward', 'RightForward', 0.5, 'Cubic', true, 51],
  ['LeftBackward', 'LeftForward', 0.7, 'Cubic', false, 54],
  ['LeftBackward', 'LeftForward', 0.75, 'QuadraticInOut', false, 58],
  ['LeftBackward', 'Backward', 0.7, 'Cubic', false, 53],
  ['LeftBackward', 'LeftForward', 0.75, 'QuadraticInOut', false, 55],
]

export const ALS_GROUNDED_DIRECTION_TRANSITIONS:
readonly AlsGroundedDirectionTransition[] = DIRECTION_TRANSITION_ROWS.map(
  ([
    from,
    to,
    duration,
    blendOption,
    activatePivot,
    compiledDelegateIndex,
  ], transitionIndex) => ({
    transitionIndex,
    from,
    to,
    duration,
    blendOption,
    blendProfile: 'MoveDirectionChange',
    activatePivot,
    compiledDelegateIndex,
  }),
)

export const ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS = {
  kind: 'unrecoverable',
  reason:
    'AB_Als_Standing stores delegate indices but not decompiled transition-rule expressions.',
} as const

export interface AlsGroundedDirectionStateWeights {
  forward: number
  backward: number
  leftForward: number
  leftBackward: number
  rightForward: number
  rightBackward: number
}

/**
 * Exact steady-state selection. Transition-time weights belong to the authored state machine and
 * its per-bone MoveDirectionChange blend profile; they are intentionally not approximated here.
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

/**
 * Evaluates the single WalkRun BlendSpace selected by HipsDirection. This is the web-native form
 * of the six cached BlendSpace players; it does not distribute velocity over all six players.
 */
export function evaluateGroundedLocomotionGraph(
  graph: AlsGroundedLocomotionGraph,
  hipsDirection: AlsHipsDirection,
  standing: Pick<
    AlsStandingMovementState,
    'strideBlendAmount' | 'walkRunBlendAmount' | 'playRate'
  >,
): readonly AlsGroundedLocomotionClipWeight[] {
  const evaluator = graph.evaluators[hipsDirection]
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
