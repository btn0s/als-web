import type { AlphaBlendOption } from '../../engine/alphaBlend'
import { applyAdditivePose } from '../../engine/blend'
import {
  compileBranchFilterMask,
} from '../../engine/branchFilter'
import type { BranchFilter } from '../../engine/branchFilter'
import type {
  CompiledWeightBlendProfile,
  WeightBlendProfile,
} from '../../engine/blendProfile'
import {
  createInputScaleBiasClampState,
  refreshInputScaleBiasClampState,
  resetInputScaleBiasClampState,
} from '../../engine/inputScaleBiasClamp'
import type {
  InputScaleBiasClampState,
} from '../../engine/inputScaleBiasClamp'
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

/*
 * AB_Als_Crouching, excluding the already-ported Movement States internals.
 *
 * VERIFIED sources:
 * - ALS Refactored 4.15 AB_Als_Crouching.uasset;
 * - scripts/extract-als/abp-graph.json;
 * - scripts/extract-als/blend-spaces.json;
 * - scripts/extract-als/skeleton-profiles.json;
 * - UAlsAnimationInstance / UAlsLinkedAnimationInstance.
 *
 * This module retains every authored node boundary needed by a later AlsAnimationInstance
 * integration. It deliberately does not flatten the outer state machine into clip weights.
 */

export type AlsCrouchingGraphState =
  | 'Idle'
  | 'Move'
  | 'Rotate Left'
  | 'Rotate Right'
  | 'Stop'

export type AlsCrouchingTransitionLogic =
  | 'StandardBlend'
  | 'Inertialization'

export type AlsCrouchingTransitionRule =
  | 'MovingSmooth'
  | 'RotatingRight'
  | 'RotatingLeft'
  | 'NotMovingSmoothAndMoveFullyWeighted'
  | 'NotMovingSmooth'
  | 'RotateLeftAutomaticRemainingTime'
  | 'RotateRightAutomaticRemainingTime'
  | 'StopFullyWeighted'

export const ALS_CROUCHING_GRAPH_STATE_ORDER = [
  'Idle',
  'Move',
  'Rotate Left',
  'Rotate Right',
  'Stop',
] as const satisfies readonly AlsCrouchingGraphState[]

export const AB_ALS_CROUCHING_GRAPH = {
  linkedGraph: {
    inputPoses: [],
    receiveNotifiesFromLinkedInstances: false,
    propagateNotifiesToLinkedInstances: false,
  },
  root: {
    nodeIndex: 0,
    sourceNodeIndex: 111,
  },
  poseFlow: {
    root: [33, 34, 2, 111, 0],
    movementCache: [43, 42, 35, 109, 44, 1],
    idle: [31, 30, 28, 29, 26, 27, 25, 32],
    move: [1, 23, 24],
    rotateLeft: [20, 21, 22],
    rotateRight: [17, 18, 19],
    stop: [11, 15, 12, 16],
  },
  movementCache: {
    saveCachedPoseNodeIndex: 1,
    cacheName: 'Movement',
    sourceNodeIndex: 44,
    refreshGroundedMovementNodeIndex: 44,
    refreshGroundedMovementCallSite: 'OnUpdate',
    refreshCrouchingMovementNodeIndex: 109,
    refreshCrouchingMovementCallSite: 'OnUpdate',
    fixedPoseEvaluator: {
      nodeIndex: 45,
      sequence: 'A_Als_Crouch_Walk_Pose',
      explicitTime: 0,
      teleportToExplicitTime: true,
      reinitializationBehavior: 'ExplicitTime',
      syncMethod: 'DoNotSync',
    },
    strideBlend: {
      nodeIndex: 43,
      fixedPoseNodeIndex: 45,
      movementStatesNodeIndex: 108,
      alphaBinding: 'GetParent.CrouchingState.StrideBlendAmount',
      interpolationSpeedIncreasing: 10,
      interpolationSpeedDecreasing: 10,
      resetChildOnActivation: false,
      alwaysUpdateChildren: false,
      mapRange: false,
      clampResult: false,
      interpolateResult: true,
    },
    applyLeanAdditive: {
      nodeIndex: 42,
      baseNodeIndex: 43,
      additiveNodeIndex: 110,
      alpha: 1,
      additiveSpace: 'LocalSpace',
      lodThreshold: -1,
    },
    poseMovingCurve: {
      nodeIndex: 35,
      sourceNodeIndex: 42,
      name: 'PoseMoving',
      value: 1,
      applyMode: 'Blend',
    },
  },
  movementStates: {
    nodeIndex: 108,
    machineName: 'Movement States',
    initialState: 'Move Forward',
    maxTransitionsPerFrame: 3,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: true,
    reinitializeOnBecomingRelevant: true,
    sequencePlayerNodeIndices: [36, 37, 38, 39, 40, 41],
  },
  lean: {
    nodeIndex: 110,
    blendSpace: 'BS_Als_Lean',
    axes: [
      {
        displayName: 'Lean Right Amount',
        minimum: -1,
        maximum: 1,
      },
      {
        displayName: 'Lean Forward Amount',
        minimum: -1,
        maximum: 1,
      },
    ],
    normalizedTime: 0,
    teleportToNormalizedTime: true,
    xBinding: 'GetParent.LeanState.RightAmount',
    yBinding: 'GetParent.LeanState.ForwardAmount',
    playRate: 1,
    playRateBinding: null,
    syncMethod: 'DoNotSync',
    samples: [
      { sequence: 'A_Als_Lean', x: 0, y: 0, rateScale: 1 },
      { sequence: 'A_Als_Lean_Forward', x: 0, y: 1, rateScale: 1 },
      { sequence: 'A_Als_Lean_Backward', x: 0, y: -1, rateScale: 1 },
      { sequence: 'A_Als_Lean_Left', x: -1, y: 0, rateScale: 1 },
      { sequence: 'A_Als_Lean_Right', x: 1, y: 0, rateScale: 1 },
    ],
    triangles: [
      [2, 0, 3],
      [2, 4, 0],
      [0, 1, 3],
      [4, 1, 0],
    ],
    interpolateUsingGrid: false,
    interpolationParameters: [],
    gridSamples: [],
  },
  outerStateMachine: {
    nodeIndex: 33,
    machineName: 'Crouching States',
    initialState: 'Idle',
    maxTransitionsPerFrame: 3,
    maxTransitionRequests: 32,
    skipFirstUpdateTransition: true,
    reinitializeOnBecomingRelevant: true,
    createNotifyMetadata: true,
    allowConduitEntryStates: false,
  },
  inertialization: {
    nodeIndex: 34,
    sourceNodeIndex: 33,
    defaultBlendProfile: null,
    filteredBones: [],
    filteredCurves: [],
    resetOnBecomingRelevant: false,
    forwardRequestsThroughSkippedCachedPoseNodes: true,
  },
  output: {
    poseCrouchingCurveNodeIndex: 2,
    poseCrouchingCurveName: 'PoseCrouching',
    poseCrouchingCurveValue: 1,
    poseCrouchingCurveApplyMode: 'Blend',
    refreshRotateInPlaceNodeIndex: 111,
    refreshRotateInPlaceCallSite: 'OnUpdate',
  },
} as const

export const ALS_CROUCHING_STATE_POSE_GRAPH = {
  Idle: {
    stateIndex: 0,
    stateResultNodeIndex: 32,
    alwaysResetOnEntry: false,
    sequenceEvaluator: {
      nodeIndex: 31,
      sequence: 'A_Als_Crouch_Pose',
      explicitTime: 0,
      teleportToExplicitTime: true,
      reinitializationBehavior: 'ExplicitTime',
      syncMethod: 'DoNotSync',
    },
    forcedCurves: {
      nodeIndex: 30,
      applyMode: 'Blend',
      values: {
        FootLeftLock: 1,
        FootRightLock: 1,
        AllowTransitions: 1,
      },
    },
    turnInPlaceSlot: {
      nodeIndex: 28,
      name: 'TurnInPlaceCrouching',
      alwaysUpdateSourcePose: false,
    },
    rotationYawSpeed: {
      nodeIndex: 29,
      applyMode: 'Scale',
      binding: 'GetParent.TurnInPlaceState.PlayRate',
    },
    callFunctions: [
      {
        nodeIndex: 26,
        functionName: 'RefreshTurnInPlace',
        callSite: 'OnUpdate',
      },
      {
        nodeIndex: 27,
        functionName: 'InitializeTurnInPlace',
        callSite: 'OnBecomeRelevant',
      },
      {
        nodeIndex: 25,
        functionName: 'RefreshDynamicTransitions',
        callSite: 'OnUpdate',
      },
    ],
    stateExitFunction: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
  },
  Move: {
    stateIndex: 1,
    stateResultNodeIndex: 24,
    alwaysResetOnEntry: false,
    useCachedPoseNodeIndex: 23,
    cacheName: 'Movement',
    stateEntryFunction: {
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      blendOutDuration: 0.2,
    },
  },
  'Rotate Left': {
    stateIndex: 2,
    stateResultNodeIndex: 22,
    alwaysResetOnEntry: false,
    sequencePlayer: {
      nodeIndex: 20,
      sequence: 'A_Als_Crouch_Rotate_90_Left',
      playRateBinding: 'GetParent.RotateInPlaceState.PlayRate',
      loopBinding: 'GetParent.RotateInPlaceState.bRotatingLeft',
      syncMethod: 'DoNotSync',
      startPosition: 0,
    },
    rotationYawSpeed: {
      nodeIndex: 21,
      applyMode: 'Scale',
      binding: 'GetParent.RotateInPlaceState.PlayRate',
    },
  },
  'Rotate Right': {
    stateIndex: 3,
    stateResultNodeIndex: 19,
    alwaysResetOnEntry: false,
    sequencePlayer: {
      nodeIndex: 17,
      sequence: 'A_Als_Crouch_Rotate_90_Right',
      playRateBinding: 'GetParent.RotateInPlaceState.PlayRate',
      loopBinding: 'GetParent.RotateInPlaceState.bRotatingRight',
      syncMethod: 'DoNotSync',
      startPosition: 0,
    },
    rotationYawSpeed: {
      nodeIndex: 18,
      applyMode: 'Scale',
      binding: 'GetParent.RotateInPlaceState.PlayRate',
    },
  },
  Stop: {
    stateIndex: 4,
    stateResultNodeIndex: 16,
    alwaysResetOnEntry: false,
    useCachedMovementNodeIndex: 11,
    fixedPoseEvaluators: [
      {
        nodeIndex: 14,
        sequence: 'A_Als_Crouch_Walk_Pose',
        explicitTime: 0,
        branch: 'Left',
      },
      {
        nodeIndex: 13,
        sequence: 'A_Als_Crouch_Walk_Pose',
        explicitTime: 0,
        branch: 'Right',
      },
    ],
    layeredBoneBlend: {
      nodeIndex: 15,
      blendMode: 'BranchFilter',
      blendWeights: [1, 1],
      meshSpaceRotationBlend: true,
      meshSpaceScaleBlend: false,
      curveBlendOption: 'Override',
      blendRootMotionBasedOnRootBone: true,
      lodThreshold: -1,
    },
    forcedCurves: {
      nodeIndex: 12,
      applyMode: 'Blend',
      values: {
        FootLeftLock: 1,
        FootRightLock: 1,
      },
    },
    stateEntryFunction: {
      functionName: 'PlayStopTransitionAnimation',
      calls: 'PlayTransitionRightAnimation',
      sequence: 'A_Als_Crouch_Transition_Right',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.2,
      fromStandingIdleOnly: false,
      slotName: 'Transition',
    },
  },
} as const

export const ALS_CROUCHING_STOP_LEFT_BRANCH_FILTERS = [
  { boneName: 'thigh_l', blendDepth: 0 },
  { boneName: 'ik_foot_l', blendDepth: 0 },
  { boneName: 'VB foot_l', blendDepth: 0 },
] as const satisfies readonly BranchFilter[]

export const ALS_CROUCHING_STOP_RIGHT_BRANCH_FILTERS = [
  { boneName: 'thigh_r', blendDepth: 0 },
  { boneName: 'ik_foot_r', blendDepth: 0 },
  { boneName: 'VB foot_r', blendDepth: 0 },
] as const satisfies readonly BranchFilter[]

export const ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE = {
  mode: 'WeightFactor',
  entries: [
    { bone: 'thigh_l', blendScale: 5 },
    { bone: 'calf_l', blendScale: 5 },
    { bone: 'calf_twist_01_l', blendScale: 5 },
    { bone: 'foot_l', blendScale: 5 },
    { bone: 'ball_l', blendScale: 5 },
    { bone: 'thigh_twist_01_l', blendScale: 5 },
    { bone: 'thigh_r', blendScale: 5 },
    { bone: 'calf_r', blendScale: 5 },
    { bone: 'calf_twist_01_r', blendScale: 5 },
    { bone: 'foot_r', blendScale: 5 },
    { bone: 'ball_r', blendScale: 5 },
    { bone: 'thigh_twist_01_r', blendScale: 5 },
    { bone: 'ik_foot_root', blendScale: 5 },
    { bone: 'ik_foot_l', blendScale: 5 },
    { bone: 'ik_foot_r', blendScale: 5 },
    { bone: 'VB foot_root', blendScale: 5 },
    { bone: 'VB foot_l', blendScale: 5 },
    { bone: 'VB foot_r', blendScale: 5 },
  ],
} as const satisfies WeightBlendProfile

export interface AlsCrouchingStateTransition {
  readonly transitionIndex: number
  readonly from: AlsCrouchingGraphState
  readonly to: AlsCrouchingGraphState
  readonly rule: AlsCrouchingTransitionRule
  readonly priorityOrder: 1 | 2
  readonly duration: number
  readonly blendOption: AlphaBlendOption
  readonly logic: AlsCrouchingTransitionLogic
  readonly blendProfile: 'QuickFeetBlend' | null
  readonly notify: 'StopQuick' | null
  readonly compiledRuleNodeIndex: number
  readonly bakedDelegateIndex: number
  readonly automaticRemainingTimeRule: boolean
  readonly automaticRuleTriggerTime: -1
}

type TransitionRow = readonly [
  from: AlsCrouchingGraphState,
  to: AlsCrouchingGraphState,
  rule: AlsCrouchingTransitionRule,
  priorityOrder: 1 | 2,
  duration: number,
  logic: AlsCrouchingTransitionLogic,
  blendProfile: 'QuickFeetBlend' | null,
  notify: 'StopQuick' | null,
  compiledRuleNodeIndex: number,
  bakedDelegateIndex: number,
  automaticRemainingTimeRule?: true,
]

const TRANSITION_ROWS: readonly TransitionRow[] = [
  ['Idle', 'Move', 'MovingSmooth', 1, 0.2, 'StandardBlend', null, null, 10, 101],
  ['Idle', 'Rotate Right', 'RotatingRight', 2, 0.2, 'Inertialization', null, null, 9, 102],
  ['Idle', 'Rotate Left', 'RotatingLeft', 2, 0.2, 'Inertialization', null, null, 8, 103],
  ['Move', 'Stop', 'NotMovingSmoothAndMoveFullyWeighted', 1, 0.1, 'StandardBlend', null, null, 7, 104],
  ['Move', 'Idle', 'NotMovingSmooth', 2, 0.2, 'StandardBlend', null, 'StopQuick', 6, 105],
  ['Rotate Left', 'Idle', 'MovingSmooth', 1, 0.4, 'StandardBlend', null, null, 10, 101],
  ['Rotate Left', 'Idle', 'RotateLeftAutomaticRemainingTime', 1, 0, 'StandardBlend', null, null, 5, 106, true],
  ['Rotate Left', 'Rotate Right', 'RotatingRight', 2, 0.2, 'Inertialization', null, null, 9, 102],
  ['Rotate Right', 'Idle', 'MovingSmooth', 1, 0.4, 'StandardBlend', null, null, 10, 101],
  ['Rotate Right', 'Idle', 'RotateRightAutomaticRemainingTime', 1, 0, 'StandardBlend', null, null, 4, 107, true],
  ['Rotate Right', 'Rotate Left', 'RotatingLeft', 2, 0.2, 'Inertialization', null, null, 8, 103],
  ['Stop', 'Idle', 'StopFullyWeighted', 1, 0.5, 'StandardBlend', 'QuickFeetBlend', null, 3, 108],
]

export const ALS_CROUCHING_STATE_TRANSITIONS:
readonly AlsCrouchingStateTransition[] = TRANSITION_ROWS.map(
  ([
    from,
    to,
    rule,
    priorityOrder,
    duration,
    logic,
    blendProfile,
    notify,
    compiledRuleNodeIndex,
    bakedDelegateIndex,
    automaticRemainingTimeRule,
  ], transitionIndex) => ({
    transitionIndex,
    from,
    to,
    rule,
    priorityOrder,
    duration,
    blendOption: 'HermiteCubic',
    logic,
    blendProfile,
    notify,
    compiledRuleNodeIndex,
    bakedDelegateIndex,
    automaticRemainingTimeRule: automaticRemainingTimeRule === true,
    automaticRuleTriggerTime: -1,
  }),
)

export interface AlsCrouchingStateWeights {
  Idle: number
  Move: number
  'Rotate Left': number
  'Rotate Right': number
  Stop: number
}

export function createAlsCrouchingStateWeights(): AlsCrouchingStateWeights {
  return {
    Idle: 1,
    Move: 0,
    'Rotate Left': 0,
    'Rotate Right': 0,
    Stop: 0,
  }
}

export interface AlsCrouchingTransitionInput {
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  readonly stateWeights: Readonly<AlsCrouchingStateWeights>
  /**
   * Explicit UE automatic-rule result. ALS content serializes trigger time -1 but not the engine's
   * remaining-time comparison boundary.
   */
  readonly rotateLeftAutomaticRemainingTimeReached: boolean
  /** See `rotateLeftAutomaticRemainingTimeReached`. */
  readonly rotateRightAutomaticRemainingTimeReached: boolean
}

function matchesTransitionRule(
  rule: AlsCrouchingTransitionRule,
  input: AlsCrouchingTransitionInput,
) {
  switch (rule) {
    case 'MovingSmooth':
      return input.movingSmooth
    case 'RotatingRight':
      return input.rotatingRight
    case 'RotatingLeft':
      return input.rotatingLeft
    case 'NotMovingSmoothAndMoveFullyWeighted':
      return !input.movingSmooth && input.stateWeights.Move >= 1
    case 'NotMovingSmooth':
      return !input.movingSmooth
    case 'RotateLeftAutomaticRemainingTime':
      return input.rotateLeftAutomaticRemainingTimeReached
    case 'RotateRightAutomaticRemainingTime':
      return input.rotateRightAutomaticRemainingTimeReached
    case 'StopFullyWeighted':
      return input.stateWeights.Stop >= 1
  }
}

/** Evaluates each state's outgoing edges in authored priority/baked order. */
export function selectAlsCrouchingStateTransition(
  state: AlsCrouchingGraphState,
  input: AlsCrouchingTransitionInput,
): AlsCrouchingStateTransition | null {
  for (const transition of ALS_CROUCHING_STATE_TRANSITIONS) {
    if (transition.from !== state) continue
    if (matchesTransitionRule(transition.rule, input)) return transition
  }
  return null
}

export type AlsCrouchingLifecycleEvent =
  | {
      readonly kind: 'CallFunction'
      readonly functionName:
        | 'InitializeTurnInPlace'
        | 'StopTransitionAndTurnInPlaceAnimations'
      readonly callSite: 'OnBecomeRelevant' | 'StateEntry' | 'StateExit'
      readonly blendOutDuration?: 0.2
    }
  | {
      readonly kind: 'PlayTransitionRightAnimation'
      readonly callSite: 'StateEntry'
      readonly sequence: 'A_Als_Crouch_Transition_Right'
      readonly slotName: 'Transition'
      readonly blendInDuration: 0.2
      readonly blendOutDuration: 0.2
      readonly playRate: 1.5
      readonly startTime: 0.2
      readonly fromStandingIdleOnly: false
    }
  | {
      readonly kind: 'AnimNotify'
      readonly name: 'StopQuick'
      readonly callSite: 'TransitionStart'
    }

export interface AlsCrouchingInertializationRequest {
  readonly nodeIndex: 34
  readonly transitionIndex: number
  readonly duration: 0.2
}

export type AlsCrouchingActiveStandardTransition =
  StateMachineStandardTransition<AlsCrouchingGraphState>

export const ALS_CROUCHING_AUTOMATIC_RULE_STATUS = {
  kind: 'hypothesis',
  verified:
    'Both rotate-to-idle rules are automatic remaining-time rules with trigger time -1.',
  unresolved:
    'The engine comparison boundary for a dynamically loop-bound sequence player.',
} as const

export interface AlsCrouchingStateRuntime {
  relevant: boolean
  readonly currentState: AlsCrouchingGraphState
  readonly transitionStack:
    StateMachineTransitionStack<AlsCrouchingGraphState>
  readonly stateWeights: AlsCrouchingStateWeights
  readonly stateWeightBuffer: Float32Array
  readonly activeStandardTransitions:
    readonly AlsCrouchingActiveStandardTransition[]
  readonly quickFeetBlendProfile: CompiledWeightBlendProfile | null
  readonly lifecycleEvents: AlsCrouchingLifecycleEvent[]
  readonly inertializationRequests: AlsCrouchingInertializationRequest[]
  transitionsTakenThisFrame: number
  transitionLimitReached: boolean
}

/**
 * Creates node33's exact UE standard-transition stack adapter.
 *
 * The no-argument form is only for scalar state-rule tests. Live pose evaluation must provide
 * the rig's actual bone count and compiled SK_Als:QuickFeetBlend profile so Stop-to-Idle exposes
 * correctly-sized per-bone masks.
 */
export function createAlsCrouchingStateRuntime(
  boneCount = 1,
  quickFeetBlendProfile: CompiledWeightBlendProfile | null = null,
): AlsCrouchingStateRuntime {
  const transitionStack = createStateMachineTransitionStack(
    AB_ALS_CROUCHING_GRAPH.outerStateMachine.initialState,
    boneCount,
    AB_ALS_CROUCHING_GRAPH.outerStateMachine.maxTransitionsPerFrame + 1,
  )
  return {
    relevant: false,
    get currentState() {
      return transitionStack.currentState
    },
    transitionStack,
    stateWeights: createAlsCrouchingStateWeights(),
    stateWeightBuffer: new Float32Array(
      ALS_CROUCHING_GRAPH_STATE_ORDER.length,
    ),
    activeStandardTransitions: transitionStack.activeTransitions,
    quickFeetBlendProfile,
    lifecycleEvents: [],
    inertializationRequests: [],
    transitionsTakenThisFrame: 0,
    transitionLimitReached: false,
  }
}

function resetRuntimeState(runtime: AlsCrouchingStateRuntime) {
  resetStateMachineTransitionStack(
    runtime.transitionStack,
    AB_ALS_CROUCHING_GRAPH.outerStateMachine.initialState,
  )
  refreshStandardTransitionWeights(runtime)
  runtime.lifecycleEvents.length = 0
  runtime.inertializationRequests.length = 0
  runtime.transitionsTakenThisFrame = 0
  runtime.transitionLimitReached = false
}

export function resetAlsCrouchingStateRuntime(
  runtime: AlsCrouchingStateRuntime,
): AlsCrouchingStateRuntime {
  runtime.relevant = false
  resetRuntimeState(runtime)
  return runtime
}

export interface AlsCrouchingStateRuntimeInput {
  readonly relevant: boolean
  readonly deltaTime: number
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  readonly rotateLeftAutomaticRemainingTimeReached: boolean
  readonly rotateRightAutomaticRemainingTimeReached: boolean
}

function emitInitializeTurnInPlace(
  runtime: AlsCrouchingStateRuntime,
) {
  runtime.lifecycleEvents.push({
    kind: 'CallFunction',
    functionName: 'InitializeTurnInPlace',
    callSite: 'OnBecomeRelevant',
  })
}

function emitTransitionLifecycle(
  runtime: AlsCrouchingStateRuntime,
  transition: AlsCrouchingStateTransition,
) {
  if (transition.from === 'Idle') {
    runtime.lifecycleEvents.push({
      kind: 'CallFunction',
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      callSite: 'StateExit',
      blendOutDuration: 0.2,
    })
  }
  if (transition.to === 'Move') {
    runtime.lifecycleEvents.push({
      kind: 'CallFunction',
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      callSite: 'StateEntry',
      blendOutDuration: 0.2,
    })
  } else if (transition.to === 'Stop') {
    runtime.lifecycleEvents.push({
      kind: 'PlayTransitionRightAnimation',
      callSite: 'StateEntry',
      sequence: 'A_Als_Crouch_Transition_Right',
      slotName: 'Transition',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.2,
      fromStandingIdleOnly: false,
    })
  } else if (transition.to === 'Idle') {
    emitInitializeTurnInPlace(runtime)
  }
  if (transition.notify === 'StopQuick') {
    runtime.lifecycleEvents.push({
      kind: 'AnimNotify',
      name: 'StopQuick',
      callSite: 'TransitionStart',
    })
  }
}

function refreshStandardTransitionWeights(
  runtime: AlsCrouchingStateRuntime,
) {
  writeStateMachineStateWeights(
    runtime.transitionStack,
    ALS_CROUCHING_GRAPH_STATE_ORDER,
    runtime.stateWeightBuffer,
  )
  for (
    let index = 0;
    index < ALS_CROUCHING_GRAPH_STATE_ORDER.length;
    index++
  ) {
    runtime.stateWeights[
      ALS_CROUCHING_GRAPH_STATE_ORDER[index]
    ] = runtime.stateWeightBuffer[index]
  }
}

function advanceStandardTransition(
  runtime: AlsCrouchingStateRuntime,
  deltaTime: number,
) {
  advanceStateMachineTransitionStack(
    runtime.transitionStack,
    deltaTime,
  )
  refreshStandardTransitionWeights(runtime)
}

function startTransition(
  runtime: AlsCrouchingStateRuntime,
  transition: AlsCrouchingStateTransition,
) {
  runtime.transitionsTakenThisFrame++
  emitTransitionLifecycle(runtime, transition)

  if (transition.logic === 'Inertialization') {
    // UE's state-machine entry is effectively zero-duration here: node34 owns the visual blend.
    // Hard-selecting the destination also retires every older standard transition pose source.
    resetStateMachineTransitionStack(
      runtime.transitionStack,
      transition.to,
    )
    refreshStandardTransitionWeights(runtime)
    runtime.inertializationRequests.push({
      nodeIndex: 34,
      transitionIndex: transition.transitionIndex,
      duration: 0.2,
    })
    return
  }

  startStateMachineStandardTransition(runtime.transitionStack, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blendOption,
    blendProfile: transition.blendProfile === 'QuickFeetBlend'
      ? runtime.quickFeetBlendProfile
      : null,
  })
  // Automatic remaining-time entries authored with duration zero complete at this update
  // boundary, selecting their target and clearing all older entries before another rule scan.
  if (transition.duration <= 0) {
    advanceStateMachineTransitionStack(runtime.transitionStack, 0)
  }
  refreshStandardTransitionWeights(runtime)
}

/**
 * Updates node33 through the shared UE transition-stack primitive. Standard transitions can
 * interrupt and reverse each other while retaining ordered intermediate pose sources; automatic
 * remaining-time stays an explicit caller-provided engine predicate.
 */
export function refreshAlsCrouchingStateRuntime(
  runtime: AlsCrouchingStateRuntime,
  input: AlsCrouchingStateRuntimeInput,
): AlsCrouchingStateRuntime {
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) {
    throw new Error(
      'AB_Als_Crouching delta time must be finite and non-negative',
    )
  }

  runtime.lifecycleEvents.length = 0
  runtime.inertializationRequests.length = 0
  runtime.transitionsTakenThisFrame = 0
  runtime.transitionLimitReached = false

  if (!input.relevant) {
    runtime.relevant = false
    return runtime
  }

  if (!runtime.relevant) {
    resetRuntimeState(runtime)
    runtime.relevant = true
    emitInitializeTurnInPlace(runtime)
    return runtime
  }

  const transitionInput: AlsCrouchingTransitionInput = {
    movingSmooth: input.movingSmooth,
    rotatingLeft: input.rotatingLeft,
    rotatingRight: input.rotatingRight,
    stateWeights: runtime.stateWeights,
    rotateLeftAutomaticRemainingTimeReached:
      input.rotateLeftAutomaticRemainingTimeReached,
    rotateRightAutomaticRemainingTimeReached:
      input.rotateRightAutomaticRemainingTimeReached,
  }

  while (
    runtime.transitionsTakenThisFrame
    < AB_ALS_CROUCHING_GRAPH.outerStateMachine.maxTransitionsPerFrame
  ) {
    const transition = selectAlsCrouchingStateTransition(
      runtime.currentState,
      transitionInput,
    )
    if (!transition) break

    startTransition(runtime, transition)
  }

  if (
    runtime.transitionsTakenThisFrame
      >= AB_ALS_CROUCHING_GRAPH.outerStateMachine.maxTransitionsPerFrame
    && selectAlsCrouchingStateTransition(
      runtime.currentState,
      transitionInput,
    ) !== null
  ) {
    runtime.transitionLimitReached = true
  }

  // FAnimNode_StateMachine resolves rules against the pre-update snapshot, then ticks the whole
  // ActiveTransitionArray. This includes a standard transition created above, so its first
  // evaluated frame already contains this update's delta instead of an extra alpha-zero hold.
  advanceStandardTransition(runtime, input.deltaTime)

  return runtime
}

export interface AlsCrouchingStrideBlendRuntime {
  relevant: boolean
  filteredAlpha: number
  readonly interpolation: InputScaleBiasClampState
}

export function createAlsCrouchingStrideBlendRuntime():
AlsCrouchingStrideBlendRuntime {
  return {
    relevant: false,
    filteredAlpha: 0,
    interpolation: createInputScaleBiasClampState(),
  }
}

export function refreshAlsCrouchingStrideBlend(
  runtime: AlsCrouchingStrideBlendRuntime,
  strideBlendAmount: number,
  deltaTime: number,
  relevant: boolean,
) {
  if (!Number.isFinite(strideBlendAmount)) {
    throw new Error('Crouching stride blend amount must be finite')
  }
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      'Crouching stride blend delta time must be finite and non-negative',
    )
  }
  if (!relevant) {
    runtime.relevant = false
    runtime.filteredAlpha = 0
    resetInputScaleBiasClampState(runtime.interpolation)
    return runtime.filteredAlpha
  }

  runtime.relevant = true
  runtime.filteredAlpha = refreshInputScaleBiasClampState(
    runtime.interpolation,
    strideBlendAmount,
    deltaTime,
    AB_ALS_CROUCHING_GRAPH.movementCache.strideBlend
      .interpolationSpeedIncreasing,
    AB_ALS_CROUCHING_GRAPH.movementCache.strideBlend
      .interpolationSpeedDecreasing,
  )
  return runtime.filteredAlpha
}

export interface AlsCrouchingPoseGraphNodes {
  /** Node43 output before BS_Als_Lean. */
  readonly movementStrideBlend: MutableUePoseNode
  /** Nodes42/35 output and SaveCachedPose "Movement" value. */
  readonly movement: MutableUePoseNode
  /** Node30 output before the TurnInPlaceCrouching slot. */
  readonly idleSource: MutableUePoseNode
  /** Node29 / Idle state output. */
  readonly idle: MutableUePoseNode
  /** Node21 / Rotate Left state output. */
  readonly rotateLeft: MutableUePoseNode
  /** Node18 / Rotate Right state output. */
  readonly rotateRight: MutableUePoseNode
  /** Node12 / Stop state output. */
  readonly stop: MutableUePoseNode
}

export interface AlsCrouchingPoseGraphRuntime {
  readonly rig: RigDefinition
  readonly nodes: AlsCrouchingPoseGraphNodes
  readonly statePoses: Readonly<
    Record<AlsCrouchingGraphState, MutableUePoseNode>
  >
  readonly stopLeftMask: Float32Array
  readonly stopRightMask: Float32Array
  readonly layeredBoneBlendScratch: LayeredBoneBlendScratch
  readonly turnInPlaceSlotSources: UePoseNode[]
  readonly turnInPlaceSlotWeights: number[]
}

export function createAlsCrouchingPoseGraphRuntime(
  rig: RigDefinition,
): AlsCrouchingPoseGraphRuntime {
  const node = () => createMutableUePoseNode(rig.boneCount)
  const nodes: AlsCrouchingPoseGraphNodes = {
    movementStrideBlend: node(),
    movement: node(),
    idleSource: node(),
    idle: node(),
    rotateLeft: node(),
    rotateRight: node(),
    stop: node(),
  }
  return {
    rig,
    nodes,
    statePoses: {
      Idle: nodes.idle,
      Move: nodes.movement,
      'Rotate Left': nodes.rotateLeft,
      'Rotate Right': nodes.rotateRight,
      Stop: nodes.stop,
    },
    stopLeftMask: compileBranchFilterMask(
      rig,
      ALS_CROUCHING_STOP_LEFT_BRANCH_FILTERS,
    ),
    stopRightMask: compileBranchFilterMask(
      rig,
      ALS_CROUCHING_STOP_RIGHT_BRANCH_FILTERS,
    ),
    layeredBoneBlendScratch:
      createLayeredBoneBlendScratch(rig.boneCount),
    turnInPlaceSlotSources: [],
    turnInPlaceSlotWeights: [],
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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function scaleRotationYawSpeed(
  output: MutableUePoseNode,
  playRate: number,
) {
  output.curves.set(
    'RotationYawSpeed',
    (output.curves.get('RotationYawSpeed') ?? 0) * playRate,
  )
}

export interface AlsCrouchingPoseGraphInput {
  /** Node45, fixed explicit-time crouch-walk pose. */
  readonly fixedCrouchWalkPose: UePoseNode
  /** Node108, complete six-direction Movement States output. */
  readonly movementStatesPose: UePoseNode
  /**
   * Node110, already converted from its authored local-space-base reference into an identity-
   * relative local additive pose. BS_Als_Lean's five source clips have no curves.
   */
  readonly leanAdditivePose: UePoseNode
  /** Node31, A_Als_Crouch_Pose at explicit time zero. */
  readonly idlePose: UePoseNode
  /** Every live non-additive FMontageEvaluationState for TurnInPlaceCrouching. */
  readonly turnInPlaceMontages?: readonly {
    readonly pose: UePoseNode
    readonly weight: number
  }[]
  /** Legacy single-instance adapter retained for pure call sites. */
  readonly turnInPlaceMontagePose?: UePoseNode
  readonly turnInPlaceMontageWeight: number
  readonly turnInPlacePlayRate: number
  /** Node20, with its live sequence-player time supplied by the caller. */
  readonly rotateLeftPose: UePoseNode
  /** Node17, with its live sequence-player time supplied by the caller. */
  readonly rotateRightPose: UePoseNode
  readonly rotateInPlacePlayRate: number
  /** Node14, an independent evaluator of A_Als_Crouch_Walk_Pose at zero. */
  readonly stopLeftFixedPose: UePoseNode
  /** Node13, an independent evaluator of A_Als_Crouch_Walk_Pose at zero. */
  readonly stopRightFixedPose: UePoseNode
  /** Filtered node43 alpha. */
  readonly strideBlendAlpha: number
}

function evaluateMovementCache(
  runtime: AlsCrouchingPoseGraphRuntime,
  input: AlsCrouchingPoseGraphInput,
) {
  const alpha = clamp01(input.strideBlendAlpha)
  blendTwoPoseNodesTogether(
    input.fixedCrouchWalkPose,
    input.movementStatesPose,
    1 - alpha,
    runtime.nodes.movementStrideBlend,
  )
  copyPoseNode(
    runtime.nodes.movementStrideBlend,
    runtime.nodes.movement,
  )
  if (input.leanAdditivePose.curves.size > 0) {
    throw new Error('BS_Als_Lean additive input must not contain curves')
  }
  applyAdditivePose(
    runtime.nodes.movement.pose,
    input.leanAdditivePose.pose,
    AB_ALS_CROUCHING_GRAPH.movementCache.applyLeanAdditive.alpha,
  )
  runtime.nodes.movement.curves.set('PoseMoving', 1)
}

function evaluateIdle(
  runtime: AlsCrouchingPoseGraphRuntime,
  input: AlsCrouchingPoseGraphInput,
) {
  copyPoseNode(input.idlePose, runtime.nodes.idleSource)
  runtime.nodes.idleSource.curves.set('FootLeftLock', 1)
  runtime.nodes.idleSource.curves.set('FootRightLock', 1)
  runtime.nodes.idleSource.curves.set('AllowTransitions', 1)

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
    copyPoseNode(runtime.nodes.idleSource, runtime.nodes.idle)
  } else {
    const normalization = Math.max(1, totalNodeWeight)
    runtime.turnInPlaceSlotSources.length = 0
    runtime.turnInPlaceSlotWeights.length = 0
    const sourceWeight = 1 - totalNodeWeight / normalization
    if (sourceWeight > 0) {
      runtime.turnInPlaceSlotSources.push(runtime.nodes.idleSource)
      runtime.turnInPlaceSlotWeights.push(sourceWeight)
    }
    for (const montage of montages) {
      if (montage.weight <= 0) continue
      runtime.turnInPlaceSlotSources.push(montage.pose)
      runtime.turnInPlaceSlotWeights.push(
        montage.weight / normalization,
      )
    }
    blendPoseNodesTogether(
      runtime.turnInPlaceSlotSources,
      runtime.turnInPlaceSlotWeights,
      runtime.nodes.idle,
    )
  }
  scaleRotationYawSpeed(
    runtime.nodes.idle,
    input.turnInPlacePlayRate,
  )
}

function evaluateRotateStates(
  runtime: AlsCrouchingPoseGraphRuntime,
  input: AlsCrouchingPoseGraphInput,
) {
  copyPoseNode(input.rotateLeftPose, runtime.nodes.rotateLeft)
  copyPoseNode(input.rotateRightPose, runtime.nodes.rotateRight)
  scaleRotationYawSpeed(
    runtime.nodes.rotateLeft,
    input.rotateInPlacePlayRate,
  )
  scaleRotationYawSpeed(
    runtime.nodes.rotateRight,
    input.rotateInPlacePlayRate,
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

function evaluateStop(
  runtime: AlsCrouchingPoseGraphRuntime,
  input: AlsCrouchingPoseGraphInput,
) {
  copyPoseNode(runtime.nodes.movement, runtime.nodes.stop)
  const settings =
    ALS_CROUCHING_STATE_POSE_GRAPH.Stop.layeredBoneBlend
  applyLayeredBoneBlend(
    runtime.nodes.stop.pose,
    input.stopLeftFixedPose.pose,
    runtime.rig,
    settings.blendWeights[0],
    runtime.stopLeftMask,
    settings.meshSpaceRotationBlend,
    runtime.layeredBoneBlendScratch,
    settings.meshSpaceScaleBlend,
  )
  overrideCurves(input.stopLeftFixedPose, runtime.nodes.stop)
  applyLayeredBoneBlend(
    runtime.nodes.stop.pose,
    input.stopRightFixedPose.pose,
    runtime.rig,
    settings.blendWeights[1],
    runtime.stopRightMask,
    settings.meshSpaceRotationBlend,
    runtime.layeredBoneBlendScratch,
    settings.meshSpaceScaleBlend,
  )
  overrideCurves(input.stopRightFixedPose, runtime.nodes.stop)
  runtime.nodes.stop.curves.set('FootLeftLock', 1)
  runtime.nodes.stop.curves.set('FootRightLock', 1)
}

/**
 * Evaluates every retained state source without applying node33's outer transition plan.
 *
 * The returned state nodes are the exact leaves needed by a later generic state-machine executor.
 * Standard transition/profile composition and node34 inertialization therefore remain at their
 * authored outer boundary.
 */
export function evaluateAlsCrouchingPoseGraph(
  runtime: AlsCrouchingPoseGraphRuntime,
  input: AlsCrouchingPoseGraphInput,
) {
  evaluateMovementCache(runtime, input)
  evaluateIdle(runtime, input)
  evaluateRotateStates(runtime, input)
  evaluateStop(runtime, input)
  return runtime.statePoses
}

/** Node2 publishes this curve only after node34 has produced the outer state-machine pose. */
export function publishAlsCrouchingOutputCurve(
  output: MutableUePoseNode,
) {
  output.curves.set(
    AB_ALS_CROUCHING_GRAPH.output.poseCrouchingCurveName,
    AB_ALS_CROUCHING_GRAPH.output.poseCrouchingCurveValue,
  )
  return output
}
