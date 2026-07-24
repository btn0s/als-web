import { applyAdditivePose } from '../../engine/blend'
import {
  compileBranchFilterMask,
} from '../../engine/branchFilter'
import type { BranchFilter } from '../../engine/branchFilter'
import type { CompiledWeightBlendProfile } from '../../engine/blendProfile'
import {
  applyInertialization,
  createInertialization,
} from '../../engine/inertialization'
import type { Inertialization } from '../../engine/inertialization'
import {
  createOutputInertialization,
  applyOutputInertialization,
  prepareOutputInertialization,
} from '../../engine/inertializationOutput'
import type {
  OutputInertialization,
} from '../../engine/inertializationOutput'
import {
  applyLayeredBoneBlend,
  createLayeredBoneBlendScratch,
} from '../../engine/layeredBoneBlend'
import type {
  LayeredBoneBlendScratch,
} from '../../engine/layeredBoneBlend'
import { copyPose } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
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
import {
  blendPoseNodesTogether,
  blendTwoPoseNodesTogether,
} from '../../engine/uePoseBlend'
import type {
  MutableUePoseNode,
  UePoseNode,
} from '../../engine/uePoseBlend'
import { createMutableUePoseNode } from '../../engine/uePoseGraph'
import {
  activatePivot,
  ALS_ACCELERATION_PLAYER_OPTIONS,
  ALS_ACCELERATION_PLAYERS,
  ALS_GROUNDED_STATE_CALLBACKS,
  ALS_IDLE_POSE_EVALUATOR,
  ALS_MOVEMENT_DETAILS_STATES,
  ALS_STOP_STATES,
  ALS_STOP_TRANSITION_ANIMATIONS,
  selectMovementDetailsTransition,
  selectStopTransition,
  stopTransitionDirectionForState,
} from './groundedStates'
import type {
  AlsMovementDetailsState,
  AlsMovementDetailsTransitionInput,
  AlsStateTransition,
  AlsStopState,
} from './groundedStates'
import {
  createAlsGroundedDirectionRuntime,
  refreshAlsGroundedDirectionRuntime,
  resetAlsGroundedDirectionRuntime,
} from './groundedLocomotion'
import type {
  AlsGroundedDirectionRuntime,
  AlsGroundedVelocityBlend,
  AlsHipsDirection,
  AlsMovementDirection,
} from './groundedLocomotion'

/*
 * Retained implementation of AB_Als_Standing.
 *
 * VERIFIED:
 * - Node indices, links, state order, transition order/settings, callbacks, player settings,
 *   curve writes, branch filters, and sync groups come from AB_Als_Standing.uasset via
 *   scripts/extract-als/abp-graph.json.
 * - Transition predicates are the generated-class Kismet delegates already frozen in
 *   groundedStates.ts and groundedLocomotion.ts.
 * - Movement States is the exact UE transition-stack runtime from groundedLocomotion.ts.
 * - The two retained inertializers are the authored nodes 119 and 118. They do not share history.
 *
 * Acceleration and sequence leaves are sampled by the caller at the retained clocks exposed
 * here. This is the same engine/content boundary used by uePoseGraph.ts: this module owns graph
 * evaluation, while clip samplers own decoding animation tracks.
 */

export const ALS_STANDING_STATES = [
  'Idle',
  'Move',
  'Stop',
  'Rotate Left',
  'Rotate Right',
] as const
export type AlsStandingState = (typeof ALS_STANDING_STATES)[number]

export const AB_ALS_STANDING_GRAPH = {
  linkedGraph: {
    inputPoses: [],
    receiveNotifiesFromLinkedInstances: false,
    propagateNotifiesToLinkedInstances: false,
  },
  root: {
    nodeIndex: 0,
    sourceNodeIndex: 203,
  },
  poseFlow: {
    root: [65, 118, 68, 203, 0],
    movement: [201, 202, 120, 122, 67],
    movementDetails: [117, 119, 143, 142, 121, 66],
    idle: [61, 63, 60, 62, 58, 59, 57, 64],
    move: [66, 55, 56],
    stop: [53, 54],
    rotateLeft: [12, 13, 14],
    rotateRight: [9, 10, 11],
  },
  caches: {
    Movement: {
      saveNodeIndex: 67,
      sourceNodeIndex: 122,
    },
    'Movement Details': {
      saveNodeIndex: 66,
      sourceNodeIndex: 121,
    },
  },
  callFunctions: {
    refreshRotateInPlace: {
      nodeIndex: 203,
      callSite: 'OnUpdate',
    },
    refreshGroundedMovement: {
      nodeIndex: 121,
      callSite: 'OnUpdate',
    },
    initializeStandingMovement: {
      nodeIndex: 142,
      callSite: 'OnBecomeRelevant',
    },
    refreshStandingMovement: {
      nodeIndex: 143,
      callSite: 'OnUpdate',
    },
  },
  movementStates: {
    nodeIndex: 201,
    stateMachineIndexInClass: 0,
    machineName: 'Movement States',
    initialState: 'Move Forward',
    maxTransitionsPerFrame: 3,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: true,
    reinitializeOnBecomingRelevant: true,
    createNotifyMetaData: true,
    allowConduitEntryStates: false,
  },
  movementDetailsStates: {
    nodeIndex: 117,
    stateMachineIndexInClass: 1,
    machineName: 'Movement Details States',
    initialState: 'Walk',
    maxTransitionsPerFrame: 1,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: false,
    reinitializeOnBecomingRelevant: true,
    createNotifyMetaData: true,
    allowConduitEntryStates: false,
  },
  movementDetailsInertialization: {
    nodeIndex: 119,
    sourceNodeIndex: 117,
    defaultBlendProfile: null,
    filteredBones: [],
    filteredCurves: [],
    resetOnBecomingRelevant: false,
    forwardRequestsThroughSkippedCachedPoseNodes: true,
  },
  standingStates: {
    nodeIndex: 65,
    stateMachineIndexInClass: 2,
    machineName: 'Standing States',
    initialState: 'Idle',
    maxTransitionsPerFrame: 3,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: true,
    reinitializeOnBecomingRelevant: true,
    createNotifyMetaData: true,
    allowConduitEntryStates: false,
  },
  stopStates: {
    nodeIndex: 53,
    stateMachineIndexInClass: 3,
    machineName: 'Stop States',
    initialState: 'Entry',
    maxTransitionsPerFrame: 3,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: false,
    reinitializeOnBecomingRelevant: true,
    createNotifyMetaData: true,
    allowConduitEntryStates: false,
  },
  standingInertialization: {
    nodeIndex: 118,
    sourceNodeIndex: 65,
    defaultBlendProfile: null,
    filteredBones: [],
    filteredCurves: [],
    resetOnBecomingRelevant: false,
    forwardRequestsThroughSkippedCachedPoseNodes: true,
  },
  output: {
    poseStandingCurveNodeIndex: 68,
    poseStandingCurveName: 'PoseStanding',
    poseStandingCurveValue: 1,
    refreshRotateInPlaceNodeIndex: 203,
  },
} as const

export const ALS_STANDING_STATE_POSE_GRAPH = {
  Idle: {
    stateIndex: 0,
    stateResultNodeIndex: 64,
    alwaysResetOnEntry: false,
    sequenceEvaluator: ALS_IDLE_POSE_EVALUATOR,
    forcedCurves: {
      nodeIndex: 63,
      applyMode: 'Blend',
      values: {
        FootLeftLock: 1,
        FootRightLock: 1,
        AllowTransitions: 1,
      },
    },
    turnInPlaceSlot: {
      nodeIndex: 60,
      name: 'TurnInPlaceStanding',
      alwaysUpdateSourcePose: false,
    },
    callFunctions: [
      {
        nodeIndex: 57,
        functionName: 'RefreshDynamicTransitions',
        callSite: 'OnUpdate',
      },
      {
        nodeIndex: 59,
        functionName: 'InitializeTurnInPlace',
        callSite: 'OnBecomeRelevant',
      },
      {
        nodeIndex: 58,
        functionName: 'RefreshTurnInPlace',
        callSite: 'OnUpdate',
      },
    ],
    stateExitFunction: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
    rotationYawSpeed: {
      nodeIndex: 62,
      applyMode: 'Scale',
      binding: 'GetParent.TurnInPlaceState.PlayRate',
    },
  },
  Move: {
    stateIndex: 1,
    stateResultNodeIndex: 56,
    alwaysResetOnEntry: false,
    useCachedPoseNodeIndex: 55,
    cacheName: 'Movement Details',
    stateEntryFunction: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
  },
  Stop: {
    stateIndex: 2,
    stateResultNodeIndex: 54,
    alwaysResetOnEntry: false,
    stateMachineNodeIndex: 53,
    machineName: 'Stop States',
  },
  'Rotate Left': {
    stateIndex: 3,
    stateResultNodeIndex: 14,
    alwaysResetOnEntry: false,
    sequencePlayer: {
      nodeIndex: 12,
      sequence: 'A_Als_Rotate_90_Left',
      duration: 1,
      startPosition: 0,
      playRateBinding: 'GetParent.RotateInPlaceState.PlayRate',
      loopBinding: 'GetParent.RotateInPlaceState.bRotatingLeft',
      syncMethod: 'DoNotSync',
    },
    rotationYawSpeed: {
      nodeIndex: 13,
      applyMode: 'Scale',
      binding: 'GetParent.RotateInPlaceState.PlayRate',
    },
  },
  'Rotate Right': {
    stateIndex: 4,
    stateResultNodeIndex: 11,
    alwaysResetOnEntry: false,
    sequencePlayer: {
      nodeIndex: 9,
      sequence: 'A_Als_Rotate_90_Right',
      duration: 1,
      startPosition: 0,
      playRateBinding: 'GetParent.RotateInPlaceState.PlayRate',
      loopBinding: 'GetParent.RotateInPlaceState.bRotatingRight',
      syncMethod: 'DoNotSync',
    },
    rotationYawSpeed: {
      nodeIndex: 10,
      applyMode: 'Scale',
      binding: 'GetParent.RotateInPlaceState.PlayRate',
    },
  },
} as const

export type AlsStandingTransitionLogic =
  | 'StandardBlend'
  | 'Inertialization'

export type AlsStandingTransitionRule =
  | 'RotatingLeft'
  | 'RotatingRight'
  | 'MovingSmooth'
  | 'NotMovingSmoothAndMoveFullyWeighted'
  | 'NotMovingSmooth'
  | 'StopFullyWeighted'
  | 'RotateLeftAutomaticRemainingTime'
  | 'RotateRightAutomaticRemainingTime'

export interface AlsStandingStateTransition {
  readonly transitionIndex: number
  readonly from: AlsStandingState
  readonly to: AlsStandingState
  readonly rule: AlsStandingTransitionRule
  /** Authored outgoing-array order for this source state; lower values are tested first. */
  readonly bakedPriority: number
  readonly duration: number
  readonly blendOption: 'HermiteCubic'
  readonly logic: AlsStandingTransitionLogic
  readonly automaticRemainingTimeRule: boolean
  readonly automaticRuleTriggerTime: -1
  readonly notify: 'StopQuick' | null
  readonly endNotify: null
  readonly interruptNotify: null
  readonly customBlendCurve: null
  readonly blendProfile: null
  readonly compiledRuleNodeIndex: number
  readonly bakedDelegateIndex: number
}

type StandingTransitionRow = readonly [
  from: AlsStandingState,
  to: AlsStandingState,
  rule: AlsStandingTransitionRule,
  bakedPriority: number,
  duration: number,
  logic: AlsStandingTransitionLogic,
  notify: 'StopQuick' | null,
  compiledRuleNodeIndex: number,
  bakedDelegateIndex: number,
  automaticRemainingTimeRule?: true,
]

const STANDING_TRANSITION_ROWS: readonly StandingTransitionRow[] = [
  ['Idle', 'Rotate Left', 'RotatingLeft', 0, 0.2, 'StandardBlend', null, 8, 195],
  ['Idle', 'Rotate Right', 'RotatingRight', 1, 0.2, 'StandardBlend', null, 7, 196],
  ['Idle', 'Move', 'MovingSmooth', 2, 0.2, 'StandardBlend', null, 6, 197],
  ['Move', 'Stop', 'NotMovingSmoothAndMoveFullyWeighted', 0, 0, 'StandardBlend', null, 5, 198],
  ['Move', 'Idle', 'NotMovingSmooth', 1, 0.2, 'StandardBlend', 'StopQuick', 4, 199],
  ['Stop', 'Idle', 'StopFullyWeighted', 0, 0.3, 'StandardBlend', null, 3, 200],
  ['Rotate Left', 'Rotate Right', 'RotatingRight', 0, 0.2, 'Inertialization', null, 7, 196],
  ['Rotate Left', 'Idle', 'MovingSmooth', 1, 0.2, 'StandardBlend', null, 6, 197],
  ['Rotate Left', 'Idle', 'RotateLeftAutomaticRemainingTime', 2, 0, 'StandardBlend', null, 2, 201, true],
  ['Rotate Right', 'Rotate Left', 'RotatingLeft', 0, 0.2, 'Inertialization', null, 8, 195],
  ['Rotate Right', 'Idle', 'MovingSmooth', 1, 0.2, 'StandardBlend', null, 6, 197],
  ['Rotate Right', 'Idle', 'RotateRightAutomaticRemainingTime', 2, 0, 'StandardBlend', null, 1, 202, true],
]

export const ALS_STANDING_STATE_TRANSITIONS:
readonly AlsStandingStateTransition[] = STANDING_TRANSITION_ROWS.map(
  ([
    from,
    to,
    rule,
    bakedPriority,
    duration,
    logic,
    notify,
    compiledRuleNodeIndex,
    bakedDelegateIndex,
    automaticRemainingTimeRule,
  ], transitionIndex) => ({
    transitionIndex,
    from,
    to,
    rule,
    bakedPriority,
    duration,
    blendOption: 'HermiteCubic',
    logic,
    automaticRemainingTimeRule: automaticRemainingTimeRule === true,
    automaticRuleTriggerTime: -1,
    notify,
    endNotify: null,
    interruptNotify: null,
    customBlendCurve: null,
    blendProfile: null,
    compiledRuleNodeIndex,
    bakedDelegateIndex,
  }),
)

export interface AlsStandingTransitionInput {
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  readonly stateWeights: Readonly<Record<AlsStandingState, number>>
  readonly rotateLeftAutomaticRemainingTimeReached: boolean
  readonly rotateRightAutomaticRemainingTimeReached: boolean
}

function matchesStandingTransitionRule(
  rule: AlsStandingTransitionRule,
  input: AlsStandingTransitionInput,
) {
  switch (rule) {
    case 'RotatingLeft':
      return input.rotatingLeft
    case 'RotatingRight':
      return input.rotatingRight
    case 'MovingSmooth':
      return input.movingSmooth
    case 'NotMovingSmoothAndMoveFullyWeighted':
      return !input.movingSmooth && input.stateWeights.Move >= 1
    case 'NotMovingSmooth':
      return !input.movingSmooth
    case 'StopFullyWeighted':
      return input.stateWeights.Stop >= 1
    case 'RotateLeftAutomaticRemainingTime':
      return input.rotateLeftAutomaticRemainingTimeReached
    case 'RotateRightAutomaticRemainingTime':
      return input.rotateRightAutomaticRemainingTimeReached
  }
}

/** Evaluates each outgoing array in its serialized, generated-class order. */
export function selectAlsStandingStateTransition(
  state: AlsStandingState,
  input: AlsStandingTransitionInput,
): AlsStandingStateTransition | null {
  for (const transition of ALS_STANDING_STATE_TRANSITIONS) {
    if (transition.from !== state) continue
    if (matchesStandingTransitionRule(transition.rule, input)) {
      return transition
    }
  }
  return null
}

export const ALS_STANDING_STOP_LEFT_BRANCH_FILTERS = [
  { boneName: 'thigh_l', blendDepth: 0 },
  { boneName: 'ik_foot_l', blendDepth: 0 },
  { boneName: 'VB foot_l', blendDepth: 0 },
] as const satisfies readonly BranchFilter[]

export const ALS_STANDING_STOP_RIGHT_BRANCH_FILTERS = [
  { boneName: 'thigh_r', blendDepth: 0 },
  { boneName: 'ik_foot_r', blendDepth: 0 },
  { boneName: 'VB foot_r', blendDepth: 0 },
] as const satisfies readonly BranchFilter[]

export const ALS_STANDING_STOP_GRAPH = {
  'Plant Left Foot': {
    multiWayBlendNodeIndex: 32,
    layeredBoneBlendNodeIndex: 42,
    branchFilters: ALS_STANDING_STOP_LEFT_BRANCH_FILTERS,
    forcedCurveNodeIndex: 43,
    forcedCurve: 'FootLeftLock',
    enumBlendNodes: {
      left: {
        nodeIndex: 34,
        backwardEnumValue: 'LeftBackward',
        blendTimes: [0, 0],
      },
      right: {
        nodeIndex: 33,
        backwardEnumValue: 'RightBackward',
        blendTimes: [0, 0.1],
      },
    },
  },
  'Plant Right Foot': {
    multiWayBlendNodeIndex: 19,
    layeredBoneBlendNodeIndex: 29,
    branchFilters: ALS_STANDING_STOP_RIGHT_BRANCH_FILTERS,
    forcedCurveNodeIndex: 30,
    forcedCurve: 'FootRightLock',
    enumBlendNodes: {
      left: {
        nodeIndex: 21,
        backwardEnumValue: 'LeftBackward',
        blendTimes: [0, 0],
      },
      right: {
        nodeIndex: 20,
        backwardEnumValue: 'RightBackward',
        blendTimes: [0, 0.1],
      },
    },
  },
  layeredBoneBlend: {
    blendWeight: 1,
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendOption: 'Override',
    blendRootMotionBasedOnRootBone: true,
  },
} as const

export type AlsStandingLifecycleEvent =
  | {
      readonly kind: 'CallFunction'
      readonly functionName:
        | 'InitializeStandingMovement'
        | 'RefreshStandingMovement'
        | 'RefreshGroundedMovement'
        | 'RefreshRotateInPlace'
        | 'InitializeTurnInPlace'
        | 'RefreshTurnInPlace'
        | 'RefreshDynamicTransitions'
        | 'ResetPivot'
        | 'StopTransitionAndTurnInPlaceAnimations'
      readonly callSite:
        | 'OnBecomeRelevant'
        | 'OnUpdate'
        | 'StateEntry'
        | 'StateExit'
      readonly blendOutDuration?: 0.2
  }
  | {
      readonly kind: 'PlayStopTransitionAnimation'
      readonly callSite: 'StateEntry'
      readonly direction: 'Left' | 'Right'
      readonly sequence: 'A_Als_Stop_Left' | 'A_Als_Stop_Right'
      readonly blendInDuration: 0.2
      readonly blendOutDuration: 0.2
      readonly playRate: 1.5
      readonly startTime: 0.4
      readonly fromStandingIdleOnly: false
    }
  | {
      readonly kind: 'AnimNotify'
      readonly name: 'ActivatePivot' | 'StopQuick'
      readonly callSite: 'TransitionStart'
    }

export interface AlsStandingInertializationRequest {
  readonly nodeIndex: 118 | 119
  readonly transitionIndex: number
  readonly duration: number
}

interface AlsSequenceClock {
  relevant: boolean
  time: number
}

type AlsAccelerationState =
  (typeof ALS_ACCELERATION_PLAYERS)[number]['state']

interface AlsAccelerationClock extends AlsSequenceClock {
  readonly state: AlsAccelerationState
  readonly groupName: 'Run Start' | 'First Pivot' | 'Second Pivot'
  readonly startPosition: number
  readonly duration: 1
  readonly playRate: 1.25
  readonly loop: false
}

interface AlsEnumBlendClock {
  currentChild: 0 | 1
  previousChild: 0 | 1
  elapsed: number
  duration: number
  alpha: number
}

interface AlsMachineRuntime<State extends string> {
  relevant: boolean
  readonly stack: StateMachineTransitionStack<State>
  readonly stateOrder: readonly State[]
  readonly stateWeightBuffer: Float32Array
  readonly stateWeights: Record<State, number>
  currentStateElapsedTime: number
}

function createStateWeights<State extends string>(
  states: readonly State[],
  initialState: State,
) {
  const weights = {} as Record<State, number>
  for (const state of states) weights[state] = Number(state === initialState)
  return weights
}

function createMachineRuntime<State extends string>(
  states: readonly State[],
  initialState: State,
  boneCount: number,
  preallocatedTransitionCount: number,
): AlsMachineRuntime<State> {
  return {
    relevant: false,
    stack: createStateMachineTransitionStack(
      initialState,
      boneCount,
      preallocatedTransitionCount,
    ),
    stateOrder: states,
    stateWeightBuffer: new Float32Array(states.length),
    stateWeights: createStateWeights(states, initialState),
    currentStateElapsedTime: 0,
  }
}

function refreshMachineWeights<State extends string>(
  runtime: AlsMachineRuntime<State>,
) {
  writeStateMachineStateWeights(
    runtime.stack,
    runtime.stateOrder,
    runtime.stateWeightBuffer,
  )
  for (let index = 0; index < runtime.stateOrder.length; index++) {
    runtime.stateWeights[runtime.stateOrder[index]] =
      runtime.stateWeightBuffer[index]
  }
}

function resetMachineRuntime<State extends string>(
  runtime: AlsMachineRuntime<State>,
  initialState: State,
) {
  resetStateMachineTransitionStack(runtime.stack, initialState)
  runtime.currentStateElapsedTime = 0
  refreshMachineWeights(runtime)
}

export interface AlsStandingGraphRuntime {
  relevant: boolean
  readonly direction: AlsGroundedDirectionRuntime
  readonly movementDetails: AlsMachineRuntime<AlsMovementDetailsState>
  readonly standing: AlsMachineRuntime<AlsStandingState>
  readonly stop: AlsMachineRuntime<AlsStopState>
  pivotActive: boolean
  hipsDirection: AlsHipsDirection
  readonly accelerationClocks:
    Readonly<Record<AlsAccelerationState, AlsAccelerationClock>>
  readonly rotateClocks: {
    readonly left: AlsSequenceClock
    readonly right: AlsSequenceClock
  }
  readonly stopEnumBlends: {
    readonly left: AlsEnumBlendClock
    readonly right: AlsEnumBlendClock
  }
  readonly lifecycleEvents: AlsStandingLifecycleEvent[]
  readonly inertializationRequests: AlsStandingInertializationRequest[]
  standingTransitionsTakenThisFrame: number
  movementDetailsTransitionsTakenThisFrame: number
  stopTransitionsTakenThisFrame: number
}

export function createAlsStandingGraphRuntime(
  boneCount = 1,
  moveDirectionChangeBlendProfile:
    CompiledWeightBlendProfile | null = null,
): AlsStandingGraphRuntime {
  const accelerationClocks = {} as Record<
    AlsAccelerationState,
    AlsAccelerationClock
  >
  for (const player of ALS_ACCELERATION_PLAYERS) {
    accelerationClocks[player.state] = {
      relevant: false,
      state: player.state,
      groupName: player.groupName,
      startPosition: player.startPosition,
      duration: ALS_ACCELERATION_PLAYER_OPTIONS.duration,
      playRate: ALS_ACCELERATION_PLAYER_OPTIONS.playRate,
      loop: ALS_ACCELERATION_PLAYER_OPTIONS.loop,
      time: player.startPosition,
    }
  }

  return {
    relevant: false,
    direction: createAlsGroundedDirectionRuntime(
      boneCount,
      moveDirectionChangeBlendProfile,
    ),
    movementDetails: createMachineRuntime(
      ALS_MOVEMENT_DETAILS_STATES,
      'Walk',
      boneCount,
      AB_ALS_STANDING_GRAPH.movementDetailsStates
        .maxTransitionsPerFrame + 1,
    ),
    standing: createMachineRuntime(
      ALS_STANDING_STATES,
      'Idle',
      boneCount,
      AB_ALS_STANDING_GRAPH.standingStates.maxTransitionsPerFrame + 1,
    ),
    stop: createMachineRuntime(
      ALS_STOP_STATES,
      'Entry',
      boneCount,
      AB_ALS_STANDING_GRAPH.stopStates.maxTransitionsPerFrame + 1,
    ),
    pivotActive: false,
    hipsDirection: 'Forward',
    accelerationClocks,
    rotateClocks: {
      left: { relevant: false, time: 0 },
      right: { relevant: false, time: 0 },
    },
    stopEnumBlends: {
      left: {
        currentChild: 0,
        previousChild: 0,
        elapsed: 0,
        duration: 0,
        alpha: 1,
      },
      right: {
        currentChild: 0,
        previousChild: 0,
        elapsed: 0,
        duration: 0,
        alpha: 1,
      },
    },
    lifecycleEvents: [],
    inertializationRequests: [],
    standingTransitionsTakenThisFrame: 0,
    movementDetailsTransitionsTakenThisFrame: 0,
    stopTransitionsTakenThisFrame: 0,
  }
}

function emitCallFunction(
  runtime: AlsStandingGraphRuntime,
  functionName: Extract<
    AlsStandingLifecycleEvent,
    { readonly kind: 'CallFunction' }
  >['functionName'],
  callSite: Extract<
    AlsStandingLifecycleEvent,
    { readonly kind: 'CallFunction' }
  >['callSite'],
  blendOutDuration?: 0.2,
) {
  runtime.lifecycleEvents.push({
    kind: 'CallFunction',
    functionName,
    callSite,
    ...(blendOutDuration === undefined ? {} : { blendOutDuration }),
  })
}

function emitInitializeTurnInPlace(runtime: AlsStandingGraphRuntime) {
  emitCallFunction(
    runtime,
    'InitializeTurnInPlace',
    'OnBecomeRelevant',
  )
}

function emitStandingTransitionLifecycle(
  runtime: AlsStandingGraphRuntime,
  transition: AlsStandingStateTransition,
) {
  if (transition.from === 'Idle') {
    emitCallFunction(
      runtime,
      'StopTransitionAndTurnInPlaceAnimations',
      'StateExit',
      ALS_GROUNDED_STATE_CALLBACKS.Idle.onExit.blendOutDuration,
    )
  }
  if (transition.to === 'Move') {
    emitCallFunction(
      runtime,
      'StopTransitionAndTurnInPlaceAnimations',
      'StateEntry',
      ALS_GROUNDED_STATE_CALLBACKS.Move.onEnter.blendOutDuration,
    )
  }
  if (transition.to === 'Idle') emitInitializeTurnInPlace(runtime)
  if (transition.notify) {
    runtime.lifecycleEvents.push({
      kind: 'AnimNotify',
      name: transition.notify,
      callSite: 'TransitionStart',
    })
  }
}

function emitMovementDetailsTransitionLifecycle(
  runtime: AlsStandingGraphRuntime,
  transition: AlsStateTransition<AlsMovementDetailsState>,
) {
  if (
    transition.to === 'First Pivot'
    || transition.to === 'Second Pivot'
  ) {
    runtime.pivotActive = false
    emitCallFunction(
      runtime,
      'ResetPivot',
      'OnBecomeRelevant',
    )
  }
}

function emitStopStateEntry(
  runtime: AlsStandingGraphRuntime,
  state: Exclude<AlsStopState, 'Entry'>,
) {
  const direction = stopTransitionDirectionForState(state)
  const settings = ALS_STOP_TRANSITION_ANIMATIONS[direction]
  runtime.lifecycleEvents.push({
    kind: 'PlayStopTransitionAnimation',
    callSite: 'StateEntry',
    direction,
    sequence: settings.clip,
    blendInDuration:
      ALS_STOP_TRANSITION_ANIMATIONS.blendInDuration,
    blendOutDuration:
      ALS_STOP_TRANSITION_ANIMATIONS.blendOutDuration,
    playRate: ALS_STOP_TRANSITION_ANIMATIONS.playRate,
    startTime: ALS_STOP_TRANSITION_ANIMATIONS.startTime,
    fromStandingIdleOnly:
      ALS_STOP_TRANSITION_ANIMATIONS.fromStandingIdleOnly,
  })
}

function resetSequenceClock(
  clock: AlsSequenceClock,
  startPosition: number,
) {
  clock.relevant = false
  clock.time = startPosition
}

function resetEnumBlend(clock: AlsEnumBlendClock) {
  clock.currentChild = 0
  clock.previousChild = 0
  clock.elapsed = 0
  clock.duration = 0
  clock.alpha = 1
}

function resetStandingRuntimeState(runtime: AlsStandingGraphRuntime) {
  resetAlsGroundedDirectionRuntime(runtime.direction)
  resetMachineRuntime(runtime.movementDetails, 'Walk')
  resetMachineRuntime(runtime.standing, 'Idle')
  resetMachineRuntime(runtime.stop, 'Entry')
  runtime.pivotActive = false
  runtime.hipsDirection = 'Forward'
  for (const clock of Object.values(runtime.accelerationClocks)) {
    resetSequenceClock(clock, clock.startPosition)
  }
  resetSequenceClock(runtime.rotateClocks.left, 0)
  resetSequenceClock(runtime.rotateClocks.right, 0)
  resetEnumBlend(runtime.stopEnumBlends.left)
  resetEnumBlend(runtime.stopEnumBlends.right)
  runtime.standingTransitionsTakenThisFrame = 0
  runtime.movementDetailsTransitionsTakenThisFrame = 0
  runtime.stopTransitionsTakenThisFrame = 0
}

export function resetAlsStandingGraphRuntime(
  runtime: AlsStandingGraphRuntime,
) {
  runtime.relevant = false
  runtime.lifecycleEvents.length = 0
  runtime.inertializationRequests.length = 0
  resetStandingRuntimeState(runtime)
  return runtime
}

function refreshSequenceClock(
  clock: AlsSequenceClock,
  relevant: boolean,
  startPosition: number,
  duration: number,
  playRate: number,
  loop: boolean,
  deltaTime: number,
) {
  if (!relevant) {
    clock.relevant = false
    return
  }
  if (!clock.relevant) {
    clock.relevant = true
    clock.time = startPosition
  }

  const nextTime = clock.time + deltaTime * playRate
  if (loop && duration > 0) {
    clock.time = nextTime % duration
  } else {
    clock.time = Math.min(duration, nextTime)
  }
}

function setEnumBlendTarget(
  clock: AlsEnumBlendClock,
  child: 0 | 1,
  targetBlendDuration: number,
) {
  if (child === clock.currentChild) return
  clock.previousChild = clock.currentChild
  clock.currentChild = child
  clock.elapsed = 0
  clock.duration = targetBlendDuration
  clock.alpha = targetBlendDuration <= 0 ? 1 : 0
}

function advanceEnumBlend(
  clock: AlsEnumBlendClock,
  deltaTime: number,
) {
  if (clock.alpha >= 1) return
  clock.elapsed = Math.min(
    clock.duration,
    clock.elapsed + deltaTime,
  )
  clock.alpha = clock.duration <= 0
    ? 1
    : clock.elapsed / clock.duration
}

function requestInertialization(
  runtime: AlsStandingGraphRuntime,
  nodeIndex: 118 | 119,
  transitionIndex: number,
  duration: number,
) {
  runtime.inertializationRequests.push({
    nodeIndex,
    transitionIndex,
    duration,
  })
}

function startStandingTransition(
  runtime: AlsStandingGraphRuntime,
  transition: AlsStandingStateTransition,
) {
  emitStandingTransitionLifecycle(runtime, transition)
  runtime.standingTransitionsTakenThisFrame++
  runtime.standing.currentStateElapsedTime = 0

  if (transition.logic === 'Inertialization') {
    resetStateMachineTransitionStack(
      runtime.standing.stack,
      transition.to,
    )
    refreshMachineWeights(runtime.standing)
    requestInertialization(
      runtime,
      AB_ALS_STANDING_GRAPH.standingInertialization.nodeIndex,
      transition.transitionIndex,
      transition.duration,
    )
    return
  }

  startStateMachineStandardTransition(runtime.standing.stack, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blendOption,
  })
  if (transition.duration <= 0) {
    advanceStateMachineTransitionStack(runtime.standing.stack, 0)
  }
  refreshMachineWeights(runtime.standing)
}

function startMovementDetailsTransition(
  runtime: AlsStandingGraphRuntime,
  transition: AlsStateTransition<AlsMovementDetailsState>,
) {
  emitMovementDetailsTransitionLifecycle(runtime, transition)
  runtime.movementDetailsTransitionsTakenThisFrame++
  runtime.movementDetails.currentStateElapsedTime = 0

  if (transition.logic === 'Inertialization') {
    resetStateMachineTransitionStack(
      runtime.movementDetails.stack,
      transition.to,
    )
    refreshMachineWeights(runtime.movementDetails)
    requestInertialization(
      runtime,
      AB_ALS_STANDING_GRAPH.movementDetailsInertialization.nodeIndex,
      transition.transitionIndex,
      transition.duration,
    )
    return
  }

  startStateMachineStandardTransition(runtime.movementDetails.stack, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blendMode,
  })
  if (transition.duration <= 0) {
    advanceStateMachineTransitionStack(
      runtime.movementDetails.stack,
      0,
    )
  }
  refreshMachineWeights(runtime.movementDetails)
}

function startStopTransition(
  runtime: AlsStandingGraphRuntime,
  transition: AlsStateTransition<AlsStopState>,
) {
  runtime.stopTransitionsTakenThisFrame++
  runtime.stop.currentStateElapsedTime = 0
  startStateMachineStandardTransition(runtime.stop.stack, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blendMode,
  })
  if (transition.duration <= 0) {
    advanceStateMachineTransitionStack(runtime.stop.stack, 0)
  }
  refreshMachineWeights(runtime.stop)
  if (transition.to !== 'Entry') {
    emitStopStateEntry(runtime, transition.to)
  }
}

function advanceMachine<State extends string>(
  runtime: AlsMachineRuntime<State>,
  deltaTime: number,
) {
  runtime.currentStateElapsedTime += deltaTime
  advanceStateMachineTransitionStack(runtime.stack, deltaTime)
  refreshMachineWeights(runtime)
}

function setMachineRelevant<State extends string>(
  runtime: AlsMachineRuntime<State>,
  relevant: boolean,
  initialState: State,
) {
  if (!relevant) {
    runtime.relevant = false
    return false
  }
  if (runtime.relevant) return false
  resetMachineRuntime(runtime, initialState)
  runtime.relevant = true
  return true
}

function currentAccelerationTimeRemaining(
  runtime: AlsStandingGraphRuntime,
) {
  const state = runtime.movementDetails.stack.currentState
  if (
    state !== 'Run Start From Walk'
    && state !== 'First Pivot'
    && state !== 'Second Pivot'
    && state !== 'Run Start'
  ) return Number.POSITIVE_INFINITY
  const clock = runtime.accelerationClocks[state]
  return Math.max(0, clock.duration - clock.time)
}

function refreshAccelerationClocks(
  runtime: AlsStandingGraphRuntime,
  deltaTime: number,
) {
  for (const state of Object.keys(
    runtime.accelerationClocks,
  ) as AlsAccelerationState[]) {
    const clock = runtime.accelerationClocks[state]
    const relevant = runtime.movementDetails.relevant
      && (
        runtime.movementDetails.stack.currentState === state
        || runtime.movementDetails.stateWeights[state] > 0.00001
      )
    refreshSequenceClock(
      clock,
      relevant,
      clock.startPosition,
      clock.duration,
      clock.playRate,
      clock.loop,
      deltaTime,
    )
  }
}

function refreshRotateClocks(
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingGraphRuntimeInput,
) {
  const leftRelevant = runtime.standing.relevant
    && (
      runtime.standing.stack.currentState === 'Rotate Left'
      || runtime.standing.stateWeights['Rotate Left'] > 0.00001
    )
  const rightRelevant = runtime.standing.relevant
    && (
      runtime.standing.stack.currentState === 'Rotate Right'
      || runtime.standing.stateWeights['Rotate Right'] > 0.00001
    )
  refreshSequenceClock(
    runtime.rotateClocks.left,
    leftRelevant,
    ALS_STANDING_STATE_POSE_GRAPH['Rotate Left']
      .sequencePlayer.startPosition,
    ALS_STANDING_STATE_POSE_GRAPH['Rotate Left']
      .sequencePlayer.duration,
    input.rotateInPlacePlayRate,
    input.rotatingLeft,
    input.deltaTime,
  )
  refreshSequenceClock(
    runtime.rotateClocks.right,
    rightRelevant,
    ALS_STANDING_STATE_POSE_GRAPH['Rotate Right']
      .sequencePlayer.startPosition,
    ALS_STANDING_STATE_POSE_GRAPH['Rotate Right']
      .sequencePlayer.duration,
    input.rotateInPlacePlayRate,
    input.rotatingRight,
    input.deltaTime,
  )
}

function refreshStopEnumBlends(
  runtime: AlsStandingGraphRuntime,
  deltaTime: number,
) {
  const leftTarget = runtime.hipsDirection === 'LeftBackward' ? 1 : 0
  const rightTarget =
    runtime.hipsDirection === 'RightBackward' ? 1 : 0
  setEnumBlendTarget(runtime.stopEnumBlends.left, leftTarget, 0)
  setEnumBlendTarget(
    runtime.stopEnumBlends.right,
    rightTarget,
    rightTarget === 1 ? 0.1 : 0,
  )
  advanceEnumBlend(runtime.stopEnumBlends.left, deltaTime)
  advanceEnumBlend(runtime.stopEnumBlends.right, deltaTime)
}

function emitPerUpdateFunctions(runtime: AlsStandingGraphRuntime) {
  emitCallFunction(runtime, 'RefreshRotateInPlace', 'OnUpdate')
  if (runtime.movementDetails.relevant) {
    emitCallFunction(runtime, 'RefreshGroundedMovement', 'OnUpdate')
    emitCallFunction(runtime, 'RefreshStandingMovement', 'OnUpdate')
  }

  const idleRelevant =
    runtime.standing.stack.currentState === 'Idle'
    || runtime.standing.stateWeights.Idle > 0.00001
  if (idleRelevant) {
    emitCallFunction(runtime, 'RefreshTurnInPlace', 'OnUpdate')
    emitCallFunction(runtime, 'RefreshDynamicTransitions', 'OnUpdate')
  }
}

export interface AlsStandingGraphRuntimeInput {
  readonly relevant: boolean
  readonly deltaTime: number
  readonly movementDirection: AlsMovementDirection
  readonly hipsDirectionLockAmount: number
  readonly feetCrossingAmount: number
  readonly velocityBlend: AlsGroundedVelocityBlend
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  readonly rotateInPlacePlayRate: number
  readonly gait: 'Walking' | 'Running' | 'Sprinting' | null
  readonly poseGroundedAmount: number
  readonly unweightedGaitRunningAmount: number
  /** GetInstanceMachineWeight() for node65. */
  readonly standingStatesMachineWeight: number
  readonly footPlantedAmount: number
  readonly speedCmPerSecond: number
}

/**
 * Updates all four AB_Als_Standing state machines in their retained relevance hierarchy.
 *
 * The outer machine is updated first. A transition target is relevant immediately, including
 * an alpha-zero standard-blend target, which is how UE initializes nested players on entry.
 */
export function refreshAlsStandingGraphRuntime(
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingGraphRuntimeInput,
) {
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) {
    throw new Error(
      'AB_Als_Standing delta time must be finite and non-negative',
    )
  }
  if (
    !Number.isFinite(input.rotateInPlacePlayRate)
    || input.rotateInPlacePlayRate < 0
  ) {
    throw new Error(
      'AB_Als_Standing rotate-in-place play rate must be finite and non-negative',
    )
  }

  runtime.lifecycleEvents.length = 0
  runtime.inertializationRequests.length = 0
  runtime.standingTransitionsTakenThisFrame = 0
  runtime.movementDetailsTransitionsTakenThisFrame = 0
  runtime.stopTransitionsTakenThisFrame = 0

  if (!input.relevant) {
    runtime.relevant = false
    runtime.standing.relevant = false
    runtime.movementDetails.relevant = false
    runtime.stop.relevant = false
    refreshAlsGroundedDirectionRuntime(
      runtime.direction,
      {
        relevant: false,
        movementDirection: input.movementDirection,
        hipsDirectionLockAmount: input.hipsDirectionLockAmount,
        feetCrossingAmount: input.feetCrossingAmount,
      },
      input.deltaTime,
    )
    return runtime
  }

  if (!runtime.relevant) {
    resetStandingRuntimeState(runtime)
    runtime.relevant = true
    runtime.standing.relevant = true
    emitInitializeTurnInPlace(runtime)
    emitPerUpdateFunctions(runtime)
    return runtime
  }

  // FAnimNode_StateMachine::Update_AnyThread resolves rules before updating any asset player or
  // active transition. Automatic remaining-time rules therefore observe the previous player
  // clock, while every standard transition created below is still advanced by this frame's delta.
  while (
    runtime.standingTransitionsTakenThisFrame
    < AB_ALS_STANDING_GRAPH.standingStates.maxTransitionsPerFrame
  ) {
    const transition = selectAlsStandingStateTransition(
      runtime.standing.stack.currentState,
      {
        movingSmooth: input.movingSmooth,
        rotatingLeft: input.rotatingLeft,
        rotatingRight: input.rotatingRight,
        stateWeights: runtime.standing.stateWeights,
        rotateLeftAutomaticRemainingTimeReached:
          runtime.rotateClocks.left.relevant
          && !input.rotatingLeft
          && runtime.rotateClocks.left.time
            >= ALS_STANDING_STATE_POSE_GRAPH['Rotate Left']
              .sequencePlayer.duration,
        rotateRightAutomaticRemainingTimeReached:
          runtime.rotateClocks.right.relevant
          && !input.rotatingRight
          && runtime.rotateClocks.right.time
            >= ALS_STANDING_STATE_POSE_GRAPH['Rotate Right']
              .sequencePlayer.duration,
      },
    )
    if (!transition) break
    startStandingTransition(runtime, transition)
  }
  advanceMachine(runtime.standing, input.deltaTime)
  refreshRotateClocks(runtime, input)

  const movementDetailsRelevant =
    runtime.standing.stack.currentState === 'Move'
    || runtime.standing.stack.currentState === 'Stop'
    || runtime.standing.stateWeights.Move > 0.00001
    || runtime.standing.stateWeights.Stop > 0.00001
  const movementDetailsBecameRelevant = setMachineRelevant(
    runtime.movementDetails,
    movementDetailsRelevant,
    'Walk',
  )
  if (movementDetailsBecameRelevant) {
    emitCallFunction(
      runtime,
      'InitializeStandingMovement',
      'OnBecomeRelevant',
    )
  }

  refreshAlsGroundedDirectionRuntime(
    runtime.direction,
    {
      relevant: runtime.movementDetails.relevant,
      movementDirection: input.movementDirection,
      hipsDirectionLockAmount: input.hipsDirectionLockAmount,
      feetCrossingAmount: input.feetCrossingAmount,
    },
    input.deltaTime,
    (hipsDirection) => {
      runtime.hipsDirection = hipsDirection
    },
    (transition) => {
      if (!transition.activatePivot) return
      runtime.pivotActive = activatePivot(input.speedCmPerSecond)
      runtime.lifecycleEvents.push({
        kind: 'AnimNotify',
        name: 'ActivatePivot',
        callSite: 'TransitionStart',
      })
    },
  )

  if (runtime.movementDetails.relevant) {
    const movementInput: AlsMovementDetailsTransitionInput = {
      gait: input.gait,
      poseGroundedAmount: input.poseGroundedAmount,
      unweightedGaitRunningAmount:
        input.unweightedGaitRunningAmount,
      standingStatesMachineWeight:
        input.standingStatesMachineWeight,
      pivotActive: runtime.pivotActive,
      currentStateElapsedTime:
        runtime.movementDetails.currentStateElapsedTime,
      relevantAnimationTimeRemaining:
        currentAccelerationTimeRemaining(runtime),
    }
    while (
      runtime.movementDetailsTransitionsTakenThisFrame
      < AB_ALS_STANDING_GRAPH.movementDetailsStates
        .maxTransitionsPerFrame
    ) {
      const transition = selectMovementDetailsTransition(
        runtime.movementDetails.stack.currentState,
        movementInput,
      )
      if (!transition) break
      startMovementDetailsTransition(runtime, transition)
    }
    advanceMachine(runtime.movementDetails, input.deltaTime)
  }
  // Incoming acceleration players initialize at their authored start position and receive this
  // update exactly once after the rule scan, matching UpdateAssetPlayer ordering.
  refreshAccelerationClocks(runtime, input.deltaTime)

  const stopRelevant =
    runtime.standing.stack.currentState === 'Stop'
    || runtime.standing.stateWeights.Stop > 0.00001
  setMachineRelevant(
    runtime.stop,
    stopRelevant,
    'Entry',
  )
  if (runtime.stop.relevant) {
    while (
      runtime.stopTransitionsTakenThisFrame
      < AB_ALS_STANDING_GRAPH.stopStates.maxTransitionsPerFrame
    ) {
      if (runtime.stop.stack.currentState !== 'Entry') break
      startStopTransition(
        runtime,
        selectStopTransition(input.footPlantedAmount),
      )
    }
    advanceMachine(runtime.stop, input.deltaTime)
  }

  if (runtime.stop.relevant) {
    refreshStopEnumBlends(runtime, input.deltaTime)
  }
  emitPerUpdateFunctions(runtime)
  return runtime
}

interface AlsRetainedInertialization {
  readonly pose: Inertialization
  readonly output: OutputInertialization
}

function createRetainedInertialization(
  boneCount: number,
): AlsRetainedInertialization {
  return {
    pose: createInertialization(boneCount),
    output: createOutputInertialization(),
  }
}

export interface AlsStandingPoseGraphNodes {
  /** Node201, after its complete retained Movement States transition stack. */
  readonly movementStates: MutableUePoseNode
  /** Nodes120/122 and SaveCachedPose "Movement". */
  readonly movement: MutableUePoseNode
  readonly accelerationBlends: Readonly<
    Record<AlsAccelerationState, MutableUePoseNode>
  >
  readonly accelerationStates: Readonly<
    Record<AlsAccelerationState, MutableUePoseNode>
  >
  /** Node117 before node119. */
  readonly movementDetailsStateMachine: MutableUePoseNode
  /** Node119 through node121 and SaveCachedPose "Movement Details". */
  readonly movementDetails: MutableUePoseNode
  readonly idleSource: MutableUePoseNode
  readonly idle: MutableUePoseNode
  readonly rotateLeft: MutableUePoseNode
  readonly rotateRight: MutableUePoseNode
  readonly stopLeftDirection: MutableUePoseNode
  readonly stopRightDirection: MutableUePoseNode
  readonly stopPlantLeftOverlay: MutableUePoseNode
  readonly stopPlantRightOverlay: MutableUePoseNode
  readonly stopPlantLeft: MutableUePoseNode
  readonly stopPlantRight: MutableUePoseNode
  readonly stopLockLeft: MutableUePoseNode
  readonly stopLockRight: MutableUePoseNode
  readonly stopStateMachine: MutableUePoseNode
  /** Node65 before node118. */
  readonly standingStateMachine: MutableUePoseNode
  /** Node118 followed by node68 PoseStanding. */
  readonly output: MutableUePoseNode
}

export interface AlsStandingPoseGraphRuntime {
  readonly rig: RigDefinition
  readonly nodes: AlsStandingPoseGraphNodes
  readonly movementDetailsStatePoses: Readonly<
    Record<AlsMovementDetailsState, UePoseNode>
  >
  readonly stopStatePoses: Readonly<Record<AlsStopState, UePoseNode>>
  readonly standingStatePoses: Readonly<Record<AlsStandingState, UePoseNode>>
  readonly stopLeftMask: Float32Array
  readonly stopRightMask: Float32Array
  readonly layeredBoneBlendScratch: LayeredBoneBlendScratch
  readonly curveBlendScratch: Map<string, number>
  readonly turnInPlaceSlotSources: UePoseNode[]
  readonly turnInPlaceSlotWeights: number[]
  readonly movementDetailsInertialization:
    AlsRetainedInertialization
  readonly standingInertialization: AlsRetainedInertialization
}

export function createAlsStandingPoseGraphRuntime(
  rig: RigDefinition,
): AlsStandingPoseGraphRuntime {
  const node = () => createMutableUePoseNode(rig.boneCount)
  const accelerationBlends = {
    'Run Start From Walk': node(),
    'First Pivot': node(),
    'Second Pivot': node(),
    'Run Start': node(),
  } as const
  const accelerationStates = {
    'Run Start From Walk': node(),
    'First Pivot': node(),
    'Second Pivot': node(),
    'Run Start': node(),
  } as const
  const nodes: AlsStandingPoseGraphNodes = {
    movementStates: node(),
    movement: node(),
    accelerationBlends,
    accelerationStates,
    movementDetailsStateMachine: node(),
    movementDetails: node(),
    idleSource: node(),
    idle: node(),
    rotateLeft: node(),
    rotateRight: node(),
    stopLeftDirection: node(),
    stopRightDirection: node(),
    stopPlantLeftOverlay: node(),
    stopPlantRightOverlay: node(),
    stopPlantLeft: node(),
    stopPlantRight: node(),
    stopLockLeft: node(),
    stopLockRight: node(),
    stopStateMachine: node(),
    standingStateMachine: node(),
    output: node(),
  }

  return {
    rig,
    nodes,
    movementDetailsStatePoses: {
      Walk: nodes.movement,
      'Run Start From Walk':
        accelerationStates['Run Start From Walk'],
      Run: nodes.movement,
      'First Pivot': accelerationStates['First Pivot'],
      'Second Pivot': accelerationStates['Second Pivot'],
      'Run Start': accelerationStates['Run Start'],
    },
    stopStatePoses: {
      Entry: nodes.movementDetails,
      'Lock Left Foot': nodes.stopLockLeft,
      'Lock Right Foot': nodes.stopLockRight,
      'Plant Left Foot': nodes.stopPlantLeft,
      'Plant Right Foot': nodes.stopPlantRight,
    },
    standingStatePoses: {
      Idle: nodes.idle,
      Move: nodes.movementDetails,
      Stop: nodes.stopStateMachine,
      'Rotate Left': nodes.rotateLeft,
      'Rotate Right': nodes.rotateRight,
    },
    stopLeftMask: compileBranchFilterMask(
      rig,
      ALS_STANDING_STOP_LEFT_BRANCH_FILTERS,
    ),
    stopRightMask: compileBranchFilterMask(
      rig,
      ALS_STANDING_STOP_RIGHT_BRANCH_FILTERS,
    ),
    layeredBoneBlendScratch:
      createLayeredBoneBlendScratch(rig.boneCount),
    curveBlendScratch: new Map(),
    turnInPlaceSlotSources: [],
    turnInPlaceSlotWeights: [],
    movementDetailsInertialization:
      createRetainedInertialization(rig.boneCount),
    standingInertialization:
      createRetainedInertialization(rig.boneCount),
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

function blendCurvesInPlace(
  output: MutableUePoseNode,
  incoming: UePoseNode,
  incomingWeight: number,
  scratch: Map<string, number>,
) {
  const alpha = Math.max(0, Math.min(1, incomingWeight))
  scratch.clear()
  for (const [name, value] of output.curves) {
    scratch.set(name, value * (1 - alpha))
  }
  for (const [name, value] of incoming.curves) {
    scratch.set(
      name,
      (scratch.get(name) ?? 0) + value * alpha,
    )
  }
  output.curves.clear()
  for (const [name, value] of scratch) output.curves.set(name, value)
}

function blendTransitionTargetInPlace<State extends string>(
  graph: AlsStandingPoseGraphRuntime,
  output: MutableUePoseNode,
  incoming: UePoseNode,
  transition: StateMachineStandardTransition<State>,
) {
  applyLayeredBoneBlend(
    output.pose,
    incoming.pose,
    graph.rig,
    1,
    transition.nextPoseMask,
    false,
    graph.layeredBoneBlendScratch,
  )
  blendCurvesInPlace(
    output,
    incoming,
    transition.alpha,
    graph.curveBlendScratch,
  )
}

/**
 * FAnimNode_StateMachine::Evaluate_AnyThread: oldest transition first, then each interrupted
 * transition blends the retained accumulated pose into its destination.
 */
function evaluateStateMachinePose<State extends string>(
  graph: AlsStandingPoseGraphRuntime,
  stack: StateMachineTransitionStack<State>,
  statePoses: Readonly<Record<State, UePoseNode>>,
  output: MutableUePoseNode,
) {
  const transitions = stack.activeTransitions
  if (transitions.length === 0) {
    return copyPoseNode(statePoses[stack.currentState], output)
  }

  copyPoseNode(
    statePoses[transitions[0].previousState],
    output,
  )
  for (const transition of transitions) {
    blendTransitionTargetInPlace(
      graph,
      output,
      statePoses[transition.nextState],
      transition,
    )
  }
  return output
}

function applyRetainedInertialization(
  state: AlsRetainedInertialization,
  node: MutableUePoseNode,
  deltaTime: number,
) {
  prepareOutputInertialization(state.output, state.pose)
  applyInertialization(state.pose, node.pose, deltaTime)
  applyOutputInertialization(
    state.output,
    node.curves,
    undefined,
    deltaTime,
    state.pose,
  )
  return node
}

function normalizedVelocityWeights(
  velocityBlend: AlsGroundedVelocityBlend,
) {
  const raw = [
    Math.max(0, velocityBlend.forwardAmount),
    Math.max(0, velocityBlend.backwardAmount),
    Math.max(0, velocityBlend.leftAmount),
    Math.max(0, velocityBlend.rightAmount),
  ] as const
  const total = raw[0] + raw[1] + raw[2] + raw[3]
  if (total <= 0.00001) {
    throw new Error(
      'AB_Als_Standing normalized MultiWayBlend requires a non-zero VelocityBlend',
    )
  }
  return new Float32Array([
    raw[0] / total,
    raw[1] / total,
    raw[2] / total,
    raw[3] / total,
  ])
}

function assertCurveFreeAdditive(
  node: UePoseNode,
  name: string,
) {
  if (node.curves.size > 0) {
    throw new Error(`${name} additive input must not contain curves`)
  }
}

export type AlsAccelerationPoseInputs = Readonly<
  Record<
    AlsAccelerationState,
    Readonly<Record<AlsMovementDirection, UePoseNode>>
  >
>

type AlsStopPlantState = 'Plant Left Foot' | 'Plant Right Foot'

export type AlsStopPoseInputs = Readonly<
  Record<
    AlsStopPlantState,
    Readonly<Record<AlsHipsDirection, UePoseNode>>
  >
>

export interface AlsStandingPoseGraphInput {
  /**
   * Nodes200/192/184/176/168/160 after their state-local normalized MultiWayBlend and
   * RotationYawOffset curve write. Their transition plan is runtime.direction.
   */
  readonly movementStatePoses:
    Readonly<Record<AlsHipsDirection, UePoseNode>>
  /** Node202 BS_Als_Lean, converted to an identity-relative local additive pose. */
  readonly leanAdditivePose: UePoseNode
  /**
   * Nodes79/87/96/109 directional acceleration blends, supplied as their four synchronized
   * sequence-player samples at runtime.accelerationClocks[state].time.
   */
  readonly accelerationPoses: AlsAccelerationPoseInputs
  /** Node61 A_Als_Stand_Pose at explicit time zero. */
  readonly idlePose: UePoseNode
  /** Every live non-additive FMontageEvaluationState for TurnInPlaceStanding. */
  readonly turnInPlaceMontages?: readonly {
    readonly pose: UePoseNode
    readonly weight: number
  }[]
  /** Legacy single-instance adapter retained for pure call sites. */
  readonly turnInPlaceMontagePose?: UePoseNode
  readonly turnInPlaceMontageWeight: number
  readonly turnInPlacePlayRate: number
  /** Nodes12 and 9 sampled at runtime.rotateClocks.{left,right}.time. */
  readonly rotateLeftPose: UePoseNode
  readonly rotateRightPose: UePoseNode
  readonly rotateInPlacePlayRate: number
  /** Nodes23..28 and 36..41 at their authored explicit times. */
  readonly stopPoses: AlsStopPoseInputs
  readonly velocityBlend: AlsGroundedVelocityBlend
  readonly deltaTime: number
}

function evaluateMovement(
  graph: AlsStandingPoseGraphRuntime,
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingPoseGraphInput,
) {
  evaluateStateMachinePose(
    graph,
    runtime.direction.transitionStack,
    input.movementStatePoses,
    graph.nodes.movementStates,
  )
  copyPoseNode(graph.nodes.movementStates, graph.nodes.movement)
  assertCurveFreeAdditive(input.leanAdditivePose, 'BS_Als_Lean')
  applyAdditivePose(
    graph.nodes.movement.pose,
    input.leanAdditivePose.pose,
    1,
  )
  graph.nodes.movement.curves.set('PoseMoving', 1)
}

const ACCELERATION_DIRECTIONS = [
  'Forward',
  'Backward',
  'Left',
  'Right',
] as const satisfies readonly AlsMovementDirection[]

function evaluateAccelerationStates(
  graph: AlsStandingPoseGraphRuntime,
  input: AlsStandingPoseGraphInput,
  velocityWeights: Float32Array,
) {
  for (const state of Object.keys(
    graph.nodes.accelerationStates,
  ) as AlsAccelerationState[]) {
    const sources = ACCELERATION_DIRECTIONS.map(
      (direction) => input.accelerationPoses[state][direction],
    )
    for (const source of sources) {
      assertCurveFreeAdditive(source, `${state} acceleration`)
    }
    const additive = graph.nodes.accelerationBlends[state]
    blendPoseNodesTogether(sources, velocityWeights, additive)
    copyPoseNode(
      graph.nodes.movement,
      graph.nodes.accelerationStates[state],
    )
    applyAdditivePose(
      graph.nodes.accelerationStates[state].pose,
      additive.pose,
      1,
    )
  }
}

function evaluateMovementDetails(
  graph: AlsStandingPoseGraphRuntime,
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingPoseGraphInput,
  velocityWeights: Float32Array,
) {
  evaluateMovement(graph, runtime, input)
  evaluateAccelerationStates(graph, input, velocityWeights)
  evaluateStateMachinePose(
    graph,
    runtime.movementDetails.stack,
    graph.movementDetailsStatePoses,
    graph.nodes.movementDetailsStateMachine,
  )
  copyPoseNode(
    graph.nodes.movementDetailsStateMachine,
    graph.nodes.movementDetails,
  )
  for (const request of runtime.inertializationRequests) {
    if (
      request.nodeIndex
      === AB_ALS_STANDING_GRAPH.movementDetailsInertialization.nodeIndex
    ) {
      graph.movementDetailsInertialization.pose
        .requestInertialization(request.duration)
    }
  }
  applyRetainedInertialization(
    graph.movementDetailsInertialization,
    graph.nodes.movementDetails,
    input.deltaTime,
  )
}

function enumBlendPose(
  clock: AlsEnumBlendClock,
  forward: UePoseNode,
  backward: UePoseNode,
  output: MutableUePoseNode,
) {
  const poses = [forward, backward] as const
  if (
    clock.alpha >= 1
    || clock.currentChild === clock.previousChild
  ) {
    return copyPoseNode(poses[clock.currentChild], output)
  }
  return blendTwoPoseNodesTogether(
    poses[clock.previousChild],
    poses[clock.currentChild],
    1 - clock.alpha,
    output,
  )
}

function overrideCurves(
  source: UePoseNode,
  output: MutableUePoseNode,
) {
  for (const [name, value] of source.curves) {
    output.curves.set(name, value)
  }
}

function evaluateStopPlant(
  graph: AlsStandingPoseGraphRuntime,
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingPoseGraphInput,
  state: AlsStopPlantState,
  velocityWeights: Float32Array,
) {
  const poses = input.stopPoses[state]
  enumBlendPose(
    runtime.stopEnumBlends.left,
    poses.LeftForward,
    poses.LeftBackward,
    graph.nodes.stopLeftDirection,
  )
  enumBlendPose(
    runtime.stopEnumBlends.right,
    poses.RightForward,
    poses.RightBackward,
    graph.nodes.stopRightDirection,
  )
  const overlay = state === 'Plant Left Foot'
    ? graph.nodes.stopPlantLeftOverlay
    : graph.nodes.stopPlantRightOverlay
  blendPoseNodesTogether(
    [
      poses.Forward,
      poses.Backward,
      graph.nodes.stopLeftDirection,
      graph.nodes.stopRightDirection,
    ],
    velocityWeights,
    overlay,
  )

  const output = state === 'Plant Left Foot'
    ? graph.nodes.stopPlantLeft
    : graph.nodes.stopPlantRight
  copyPoseNode(graph.nodes.movementDetails, output)
  const mask = state === 'Plant Left Foot'
    ? graph.stopLeftMask
    : graph.stopRightMask
  applyLayeredBoneBlend(
    output.pose,
    overlay.pose,
    graph.rig,
    ALS_STANDING_STOP_GRAPH.layeredBoneBlend.blendWeight,
    mask,
    ALS_STANDING_STOP_GRAPH.layeredBoneBlend
      .meshSpaceRotationBlend,
    graph.layeredBoneBlendScratch,
    ALS_STANDING_STOP_GRAPH.layeredBoneBlend
      .meshSpaceScaleBlend,
  )
  // ECurveBlendOption::Override belongs to the complete layer, not to individual branch bones.
  overrideCurves(overlay, output)
  output.curves.set(
    ALS_STANDING_STOP_GRAPH[state].forcedCurve,
    1,
  )
}

function evaluateStopStates(
  graph: AlsStandingPoseGraphRuntime,
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingPoseGraphInput,
  velocityWeights: Float32Array,
) {
  copyPoseNode(
    graph.nodes.movementDetails,
    graph.nodes.stopLockLeft,
  )
  graph.nodes.stopLockLeft.curves.set('FootLeftLock', 1)
  copyPoseNode(
    graph.nodes.movementDetails,
    graph.nodes.stopLockRight,
  )
  graph.nodes.stopLockRight.curves.set('FootRightLock', 1)
  evaluateStopPlant(
    graph,
    runtime,
    input,
    'Plant Left Foot',
    velocityWeights,
  )
  evaluateStopPlant(
    graph,
    runtime,
    input,
    'Plant Right Foot',
    velocityWeights,
  )
  evaluateStateMachinePose(
    graph,
    runtime.stop.stack,
    graph.stopStatePoses,
    graph.nodes.stopStateMachine,
  )
}

function evaluateIdle(
  graph: AlsStandingPoseGraphRuntime,
  input: AlsStandingPoseGraphInput,
) {
  copyPoseNode(input.idlePose, graph.nodes.idleSource)
  graph.nodes.idleSource.curves.set('FootLeftLock', 1)
  graph.nodes.idleSource.curves.set('FootRightLock', 1)
  graph.nodes.idleSource.curves.set('AllowTransitions', 1)

  const montages = input.turnInPlaceMontages
    ?? (
      input.turnInPlaceMontagePose
        ? [{
            pose: input.turnInPlaceMontagePose,
            weight: input.turnInPlaceMontageWeight,
          }]
        : []
    )
  let totalNodeWeight = 0
  for (const montage of montages) {
    totalNodeWeight += Math.max(0, montage.weight)
  }
  if (totalNodeWeight <= 0) {
    copyPoseNode(graph.nodes.idleSource, graph.nodes.idle)
  } else {
    const normalization = Math.max(1, totalNodeWeight)
    graph.turnInPlaceSlotSources.length = 0
    graph.turnInPlaceSlotWeights.length = 0
    const sourceWeight = 1 - totalNodeWeight / normalization
    if (sourceWeight > 0) {
      graph.turnInPlaceSlotSources.push(graph.nodes.idleSource)
      graph.turnInPlaceSlotWeights.push(sourceWeight)
    }
    for (const montage of montages) {
      if (montage.weight <= 0) continue
      graph.turnInPlaceSlotSources.push(montage.pose)
      graph.turnInPlaceSlotWeights.push(
        montage.weight / normalization,
      )
    }
    blendPoseNodesTogether(
      graph.turnInPlaceSlotSources,
      graph.turnInPlaceSlotWeights,
      graph.nodes.idle,
    )
  }
  graph.nodes.idle.curves.set(
    'RotationYawSpeed',
    (graph.nodes.idle.curves.get('RotationYawSpeed') ?? 0)
      * input.turnInPlacePlayRate,
  )
}

function evaluateRotateStates(
  graph: AlsStandingPoseGraphRuntime,
  input: AlsStandingPoseGraphInput,
) {
  copyPoseNode(input.rotateLeftPose, graph.nodes.rotateLeft)
  copyPoseNode(input.rotateRightPose, graph.nodes.rotateRight)
  graph.nodes.rotateLeft.curves.set(
    'RotationYawSpeed',
    (graph.nodes.rotateLeft.curves.get('RotationYawSpeed') ?? 0)
      * input.rotateInPlacePlayRate,
  )
  graph.nodes.rotateRight.curves.set(
    'RotationYawSpeed',
    (graph.nodes.rotateRight.curves.get('RotationYawSpeed') ?? 0)
      * input.rotateInPlacePlayRate,
  )
}

/**
 * Evaluates the complete retained AB_Als_Standing pose tree through node68.
 *
 * The caller samples sequence leaves at this runtime's clocks before calling. No clip weights are
 * flattened: Movement States, Movement Details States, Stop States, Standing States, both
 * inertializers, the foot overlays, additives, slot, and named curves retain their authored
 * boundaries.
 */
export function evaluateAlsStandingPoseGraph(
  graph: AlsStandingPoseGraphRuntime,
  runtime: AlsStandingGraphRuntime,
  input: AlsStandingPoseGraphInput,
) {
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) {
    throw new Error(
      'AB_Als_Standing pose delta time must be finite and non-negative',
    )
  }
  if (!runtime.relevant) {
    throw new Error(
      'AB_Als_Standing pose graph cannot evaluate while irrelevant',
    )
  }

  const velocityWeights =
    runtime.movementDetails.relevant || runtime.stop.relevant
      ? normalizedVelocityWeights(input.velocityBlend)
      : new Float32Array([1, 0, 0, 0])
  if (runtime.movementDetails.relevant) {
    evaluateMovementDetails(
      graph,
      runtime,
      input,
      velocityWeights,
    )
  }
  if (runtime.stop.relevant) {
    evaluateStopStates(
      graph,
      runtime,
      input,
      velocityWeights,
    )
  }
  evaluateIdle(graph, input)
  evaluateRotateStates(graph, input)
  evaluateStateMachinePose(
    graph,
    runtime.standing.stack,
    graph.standingStatePoses,
    graph.nodes.standingStateMachine,
  )
  copyPoseNode(
    graph.nodes.standingStateMachine,
    graph.nodes.output,
  )
  for (const request of runtime.inertializationRequests) {
    if (
      request.nodeIndex
      === AB_ALS_STANDING_GRAPH.standingInertialization.nodeIndex
    ) {
      graph.standingInertialization.pose
        .requestInertialization(request.duration)
    }
  }
  applyRetainedInertialization(
    graph.standingInertialization,
    graph.nodes.output,
    input.deltaTime,
  )
  graph.nodes.output.curves.set(
    AB_ALS_STANDING_GRAPH.output.poseStandingCurveName,
    AB_ALS_STANDING_GRAPH.output.poseStandingCurveValue,
  )
  return graph.nodes.output
}
