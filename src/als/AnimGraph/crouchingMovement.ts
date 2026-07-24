import { alphaToBlendOption } from '../../engine/alphaBlend'
import type {
  AlsGroundedVelocityBlend,
  AlsHipsDirection,
  AlsMovementDirection,
} from './groundedLocomotion'

/*
 * AB_Als_Crouching / Movement States.
 *
 * VERIFIED from the saved editor graphs and the compiled node/state-machine dump:
 * - six states, initial Move Forward, reinitialize-on-relevance, skip-first-transition update;
 * - all 24 outgoing edges and shared predicates, including their priority order;
 * - 0.7 second Cubic standard blends through SK_Als:MoveDirectionChange;
 * - every state's normalized [Forward, Backward, Left, Right] MultiWayBlend cache order;
 * - SetHipsDirection() runs at OnBecomeRelevant for each state's matching EAlsHipsDirection.
 *
 * UE transition interruption retains the already-active source transition. The runtime preserves
 * that nested pose plan instead of flattening it into one replacement crossfade. The exact
 * FAnimNode_StateMachine transition-stack update order is engine behavior rather than ALS-authored
 * content; keep the status export below until a UE differential capture independently verifies it.
 */

export type {
  AlsGroundedVelocityBlend as AlsCrouchingVelocityBlend,
  AlsHipsDirection,
  AlsMovementDirection,
}

export const ALS_CROUCHING_MOVEMENT_STATE_ORDER = [
  'Forward',
  'Backward',
  'RightForward',
  'RightBackward',
  'LeftForward',
  'LeftBackward',
] as const satisfies readonly AlsHipsDirection[]

export interface AlsCrouchingMovementStateDefinition {
  readonly stateIndex: number
  readonly stateName:
    | 'Move Forward'
    | 'Move Backward'
    | 'Move Right Forward'
    | 'Move Right Backward'
    | 'Move Left Forward'
    | 'Move Left Backward'
  readonly hipsDirection: AlsHipsDirection
  readonly sequence:
    | 'A_Als_Crouch_Walk_Forward'
    | 'A_Als_Crouch_Walk_Backward'
    | 'A_Als_Crouch_Walk_Right_Forward'
    | 'A_Als_Crouch_Walk_Right_Backward'
    | 'A_Als_Crouch_Walk_Left_Forward'
    | 'A_Als_Crouch_Walk_Left_Backward'
  readonly sequencePlayerNodeIndex: number
  readonly saveCachedPoseNodeIndex: number
  readonly multiWayBlendNodeIndex: number
  readonly callFunctionNodeIndex: number
  readonly callFunctionEventStub: string
  readonly stateResultNodeIndex: number
  readonly alwaysResetOnEntry: false
}

export const ALS_CROUCHING_MOVEMENT_STATES: Readonly<
  Record<AlsHipsDirection, AlsCrouchingMovementStateDefinition>
> = {
  Forward: {
    stateIndex: 0,
    stateName: 'Move Forward',
    hipsDirection: 'Forward',
    sequence: 'A_Als_Crouch_Walk_Forward',
    sequencePlayerNodeIndex: 36,
    saveCachedPoseNodeIndex: 46,
    multiWayBlendNodeIndex: 101,
    callFunctionNodeIndex: 100,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_1',
    stateResultNodeIndex: 107,
    alwaysResetOnEntry: false,
  },
  Backward: {
    stateIndex: 1,
    stateName: 'Move Backward',
    hipsDirection: 'Backward',
    sequence: 'A_Als_Crouch_Walk_Backward',
    sequencePlayerNodeIndex: 37,
    saveCachedPoseNodeIndex: 49,
    multiWayBlendNodeIndex: 93,
    callFunctionNodeIndex: 92,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_2',
    stateResultNodeIndex: 99,
    alwaysResetOnEntry: false,
  },
  RightForward: {
    stateIndex: 2,
    stateName: 'Move Right Forward',
    hipsDirection: 'RightForward',
    sequence: 'A_Als_Crouch_Walk_Right_Forward',
    sequencePlayerNodeIndex: 39,
    saveCachedPoseNodeIndex: 48,
    multiWayBlendNodeIndex: 85,
    callFunctionNodeIndex: 84,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_3',
    stateResultNodeIndex: 91,
    alwaysResetOnEntry: false,
  },
  RightBackward: {
    stateIndex: 3,
    stateName: 'Move Right Backward',
    hipsDirection: 'RightBackward',
    sequence: 'A_Als_Crouch_Walk_Right_Backward',
    sequencePlayerNodeIndex: 40,
    saveCachedPoseNodeIndex: 51,
    multiWayBlendNodeIndex: 76,
    callFunctionNodeIndex: 77,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_4',
    stateResultNodeIndex: 83,
    alwaysResetOnEntry: false,
  },
  LeftForward: {
    stateIndex: 4,
    stateName: 'Move Left Forward',
    hipsDirection: 'LeftForward',
    sequence: 'A_Als_Crouch_Walk_Left_Forward',
    sequencePlayerNodeIndex: 41,
    saveCachedPoseNodeIndex: 47,
    multiWayBlendNodeIndex: 68,
    callFunctionNodeIndex: 69,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_5',
    stateResultNodeIndex: 75,
    alwaysResetOnEntry: false,
  },
  LeftBackward: {
    stateIndex: 5,
    stateName: 'Move Left Backward',
    hipsDirection: 'LeftBackward',
    sequence: 'A_Als_Crouch_Walk_Left_Backward',
    sequencePlayerNodeIndex: 38,
    saveCachedPoseNodeIndex: 50,
    multiWayBlendNodeIndex: 60,
    callFunctionNodeIndex: 61,
    callFunctionEventStub: 'AnimNode_CallFunction_EventStub_6',
    stateResultNodeIndex: 67,
    alwaysResetOnEntry: false,
  },
}

export const ALS_CROUCHING_MOVEMENT_MACHINE = {
  machineName: 'Movement States',
  initialState: 'Forward',
  maxTransitionsPerFrame: 3,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
} as const

export const ALS_CROUCHING_MOVEMENT_PLAYER = {
  syncGroupName: 'Movement',
  syncGroupRole: 'CanBeLeader',
  syncMethod: 'SyncGroup',
  loop: true,
  startPosition: 0,
} as const

export type AlsCrouchingMovementTransitionRule =
  | 'MoveForward'
  | 'MoveBackward'
  | 'MoveLeft'
  | 'MoveRight'
  | 'SetHipsLeft'
  | 'SetHipsRight'
  | 'NeutralRightBackward'
  | 'NeutralLeftBackward'

export interface AlsCrouchingMovementTransition {
  readonly transitionIndex: number
  readonly from: AlsHipsDirection
  readonly to: AlsHipsDirection
  readonly rule: AlsCrouchingMovementTransitionRule
  readonly sharedRuleName:
    | 'Move Forward'
    | 'Move Backward'
    | 'Move Left'
    | 'Move Right'
    | 'Set Hips Left'
    | 'Set Hips Right'
    | null
  readonly priorityOrder: 1 | 2
  readonly duration: 0.7
  readonly blendOption: 'Cubic'
  readonly blendProfile: 'MoveDirectionChange'
  readonly compiledDelegateIndex: number
}

type TransitionRow = readonly [
  from: AlsHipsDirection,
  to: AlsHipsDirection,
  rule: AlsCrouchingMovementTransitionRule,
  sharedRuleName: AlsCrouchingMovementTransition['sharedRuleName'],
  priorityOrder: 1 | 2,
  compiledDelegateIndex: number,
]

const TRANSITION_ROWS: readonly TransitionRow[] = [
  ['Forward', 'RightForward', 'MoveRight', 'Move Right', 1, 59],
  ['Forward', 'LeftForward', 'MoveLeft', 'Move Left', 1, 58],
  ['Forward', 'Backward', 'MoveBackward', 'Move Backward', 1, 57],
  ['Backward', 'RightBackward', 'MoveRight', 'Move Right', 1, 59],
  ['Backward', 'LeftBackward', 'MoveLeft', 'Move Left', 1, 58],
  ['Backward', 'Forward', 'MoveForward', 'Move Forward', 1, 56],
  ['RightForward', 'LeftBackward', 'MoveLeft', 'Move Left', 1, 58],
  ['RightForward', 'RightBackward', 'MoveBackward', 'Move Backward', 1, 57],
  ['RightForward', 'Forward', 'MoveForward', 'Move Forward', 1, 56],
  ['RightForward', 'RightBackward', 'SetHipsLeft', 'Set Hips Left', 2, 55],
  ['RightBackward', 'LeftForward', 'MoveLeft', 'Move Left', 1, 58],
  ['RightBackward', 'RightForward', 'MoveForward', 'Move Forward', 1, 56],
  [
    'RightBackward',
    'RightForward',
    'NeutralRightBackward',
    null,
    1,
    54,
  ],
  ['RightBackward', 'Backward', 'MoveBackward', 'Move Backward', 1, 57],
  ['RightBackward', 'RightForward', 'SetHipsRight', 'Set Hips Right', 2, 53],
  ['LeftForward', 'RightBackward', 'MoveRight', 'Move Right', 1, 59],
  ['LeftForward', 'LeftBackward', 'MoveBackward', 'Move Backward', 1, 57],
  ['LeftForward', 'Forward', 'MoveForward', 'Move Forward', 1, 56],
  ['LeftForward', 'LeftBackward', 'SetHipsRight', 'Set Hips Right', 2, 53],
  ['LeftBackward', 'RightForward', 'MoveRight', 'Move Right', 1, 59],
  ['LeftBackward', 'LeftForward', 'MoveForward', 'Move Forward', 1, 56],
  [
    'LeftBackward',
    'LeftForward',
    'NeutralLeftBackward',
    null,
    1,
    52,
  ],
  ['LeftBackward', 'Backward', 'MoveBackward', 'Move Backward', 1, 57],
  ['LeftBackward', 'LeftForward', 'SetHipsLeft', 'Set Hips Left', 2, 55],
]

export const ALS_CROUCHING_MOVEMENT_TRANSITIONS:
readonly AlsCrouchingMovementTransition[] = TRANSITION_ROWS.map(
  ([
    from,
    to,
    rule,
    sharedRuleName,
    priorityOrder,
    compiledDelegateIndex,
  ], transitionIndex) => ({
    transitionIndex,
    from,
    to,
    rule,
    sharedRuleName,
    priorityOrder,
    duration: 0.7,
    blendOption: 'Cubic',
    blendProfile: 'MoveDirectionChange',
    compiledDelegateIndex,
  }),
)

export type AlsCrouchingMovementMultiWayBlendInputs = readonly [
  forward: AlsHipsDirection,
  backward: AlsHipsDirection,
  left: AlsHipsDirection,
  right: AlsHipsDirection,
]

/**
 * The alpha order is VelocityBlend ForwardAmount, BackwardAmount, LeftAmount, RightAmount.
 */
export const ALS_CROUCHING_MOVEMENT_MULTI_WAY_BLEND_TABLE: Readonly<
  Record<AlsHipsDirection, AlsCrouchingMovementMultiWayBlendInputs>
> = {
  Forward: ['Forward', 'Backward', 'LeftForward', 'RightForward'],
  Backward: ['Forward', 'Backward', 'LeftBackward', 'RightBackward'],
  RightForward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
  RightBackward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
  LeftForward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
  LeftBackward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
}

export interface AlsCrouchingMovementPoseWeights {
  Forward: number
  Backward: number
  RightForward: number
  RightBackward: number
  LeftForward: number
  LeftBackward: number
}

export function createAlsCrouchingMovementPoseWeights():
AlsCrouchingMovementPoseWeights {
  return {
    Forward: 0,
    Backward: 0,
    RightForward: 0,
    RightBackward: 0,
    LeftForward: 0,
    LeftBackward: 0,
  }
}

function clearPoseWeights(weights: AlsCrouchingMovementPoseWeights) {
  for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
    weights[direction] = 0
  }
}

/**
 * Evaluates one state's authored normalized MultiWayBlend into the six synchronized crouch-cycle
 * roles. Cached sequence time and marker synchronization remain the caller's Movement group job.
 */
export function evaluateAlsCrouchingMovementState(
  hipsDirection: AlsHipsDirection,
  velocityBlend: AlsGroundedVelocityBlend,
  result = createAlsCrouchingMovementPoseWeights(),
): AlsCrouchingMovementPoseWeights {
  clearPoseWeights(result)

  const rawAlphas = [
    Math.max(0, velocityBlend.forwardAmount),
    Math.max(0, velocityBlend.backwardAmount),
    Math.max(0, velocityBlend.leftAmount),
    Math.max(0, velocityBlend.rightAmount),
  ] as const
  const alphaTotal = rawAlphas.reduce((total, alpha) => total + alpha, 0)
  if (alphaTotal <= 1e-8) return result

  const poses = ALS_CROUCHING_MOVEMENT_MULTI_WAY_BLEND_TABLE[hipsDirection]
  for (let index = 0; index < poses.length; index++) {
    result[poses[index]] += rawAlphas[index] / alphaTotal
  }
  return result
}

export interface AlsCrouchingMovementTransitionInput {
  readonly hipsDirection: AlsHipsDirection
  readonly movementDirection: AlsMovementDirection
  /** Previous resolved HipsDirectionLock, clamped by ALS to [-1, 1]. */
  readonly hipsDirectionLockAmount: number
  /** Previous resolved FeetCrossing, clamped by ALS to [0, 1]. */
  readonly feetCrossingAmount: number
  /** GetInstanceStateWeight() for the queried source state. */
  readonly stateWeight: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function matchesTransitionRule(
  rule: AlsCrouchingMovementTransitionRule,
  input: AlsCrouchingMovementTransitionInput,
) {
  const hipsDirectionLockAmount = clamp(
    input.hipsDirectionLockAmount,
    -1,
    1,
  )
  const feetCrossingAmount = clamp(input.feetCrossingAmount, 0, 1)

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
    case 'NeutralLeftBackward':
      return (
        input.stateWeight >= 1
        && Math.abs(hipsDirectionLockAmount) < 0.5
        && feetCrossingAmount <= 0
      )
  }
}

/**
 * Evaluates outgoing edges in baked array order. Priority-one movement/neutral rules therefore
 * win over the priority-two Set Hips rules when both are true.
 */
export function selectAlsCrouchingMovementTransition(
  input: AlsCrouchingMovementTransitionInput,
): AlsCrouchingMovementTransition | null {
  for (const transition of ALS_CROUCHING_MOVEMENT_TRANSITIONS) {
    if (transition.from !== input.hipsDirection) continue
    if (matchesTransitionRule(transition.rule, input)) return transition
  }
  return null
}

export interface AlsCrouchingMovementActiveTransition {
  readonly transition: AlsCrouchingMovementTransition
  elapsed: number
  linearAlpha: number
  blendAlpha: number
}

export interface AlsCrouchingMovementRuntime {
  relevant: boolean
  baseState: AlsHipsDirection
  currentState: AlsHipsDirection
  readonly activeTransitions: AlsCrouchingMovementActiveTransition[]
  readonly stateWeights: AlsCrouchingMovementPoseWeights
  transitionsTakenThisFrame: number
  lastSetHipsDirection: AlsHipsDirection | null
}

export interface AlsCrouchingMovementRuntimeInput {
  readonly relevant: boolean
  readonly movementDirection: AlsMovementDirection
  readonly hipsDirectionLockAmount: number
  readonly feetCrossingAmount: number
}

export type AlsSetHipsDirection = (hipsDirection: AlsHipsDirection) => void

export const ALS_CROUCHING_MOVEMENT_TRANSITION_STACK_STATUS = {
  kind: 'hypothesis',
  verified:
    'ALS retains active transition sources and the authored machine allows three transitions per frame.',
  needsVerification:
    'Differentially capture UE state weights and per-bone poses during a second direction change before the first 0.7 second transition completes.',
} as const

export function createAlsCrouchingMovementRuntime():
AlsCrouchingMovementRuntime {
  const stateWeights = createAlsCrouchingMovementPoseWeights()
  stateWeights.Forward = 1
  return {
    relevant: false,
    baseState: ALS_CROUCHING_MOVEMENT_MACHINE.initialState,
    currentState: ALS_CROUCHING_MOVEMENT_MACHINE.initialState,
    activeTransitions: [],
    stateWeights,
    transitionsTakenThisFrame: 0,
    lastSetHipsDirection: null,
  }
}

function resetRuntime(runtime: AlsCrouchingMovementRuntime) {
  runtime.baseState = ALS_CROUCHING_MOVEMENT_MACHINE.initialState
  runtime.currentState = ALS_CROUCHING_MOVEMENT_MACHINE.initialState
  runtime.activeTransitions.length = 0
  clearPoseWeights(runtime.stateWeights)
  runtime.stateWeights.Forward = 1
  runtime.transitionsTakenThisFrame = 0
  runtime.lastSetHipsDirection = null
}

export function resetAlsCrouchingMovementRuntime(
  runtime: AlsCrouchingMovementRuntime,
): AlsCrouchingMovementRuntime {
  runtime.relevant = false
  resetRuntime(runtime)
  return runtime
}

function emitSetHipsDirection(
  runtime: AlsCrouchingMovementRuntime,
  hipsDirection: AlsHipsDirection,
  setHipsDirection: AlsSetHipsDirection | undefined,
) {
  runtime.lastSetHipsDirection = hipsDirection
  setHipsDirection?.(hipsDirection)
}

function refreshStateWeights(runtime: AlsCrouchingMovementRuntime) {
  clearPoseWeights(runtime.stateWeights)
  runtime.stateWeights[runtime.baseState] = 1

  for (const active of runtime.activeTransitions) {
    const sourceAmount = 1 - active.blendAlpha
    for (const direction of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      runtime.stateWeights[direction] *= sourceAmount
    }
    runtime.stateWeights[active.transition.to] += active.blendAlpha
  }
}

function advanceTransitions(
  runtime: AlsCrouchingMovementRuntime,
  deltaTime: number,
) {
  let lastCompletedIndex = -1
  for (let index = 0; index < runtime.activeTransitions.length; index++) {
    const active = runtime.activeTransitions[index]
    active.elapsed = Math.min(
      active.transition.duration,
      active.elapsed + deltaTime,
    )
    active.linearAlpha = active.elapsed / active.transition.duration
    active.blendAlpha = alphaToBlendOption(
      active.linearAlpha,
      active.transition.blendOption,
    )
    if (active.linearAlpha >= 1) lastCompletedIndex = index
  }

  if (lastCompletedIndex >= 0) {
    runtime.baseState =
      runtime.activeTransitions[lastCompletedIndex].transition.to
    runtime.activeTransitions.splice(0, lastCompletedIndex + 1)
  }
  refreshStateWeights(runtime)
}

function startTransition(
  runtime: AlsCrouchingMovementRuntime,
  transition: AlsCrouchingMovementTransition,
  setHipsDirection: AlsSetHipsDirection | undefined,
) {
  runtime.activeTransitions.push({
    transition,
    elapsed: 0,
    linearAlpha: 0,
    blendAlpha: 0,
  })
  runtime.currentState = transition.to
  runtime.transitionsTakenThisFrame++
  refreshStateWeights(runtime)
  emitSetHipsDirection(runtime, transition.to, setHipsDirection)
}

/**
 * Updates the authored state machine. A rising relevance edge reinitializes to Forward, invokes
 * SetHipsDirection(Forward), and consumes that frame's bSkipFirstUpdateTransition behavior.
 *
 * `activeTransitions` is an oldest-to-newest nested pose plan. Pose evaluation should evaluate the
 * base state, then apply every transition's target state through MoveDirectionChange at
 * `blendAlpha`; flattening the plan into scalar clip weights would lose per-bone blend semantics.
 */
export function refreshAlsCrouchingMovementRuntime(
  runtime: AlsCrouchingMovementRuntime,
  input: AlsCrouchingMovementRuntimeInput,
  deltaTime: number,
  setHipsDirection?: AlsSetHipsDirection,
): AlsCrouchingMovementRuntime {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      'Crouching Movement States delta time must be finite and non-negative',
    )
  }

  runtime.transitionsTakenThisFrame = 0
  runtime.lastSetHipsDirection = null

  if (!input.relevant) {
    runtime.relevant = false
    return runtime
  }

  if (!runtime.relevant) {
    resetRuntime(runtime)
    runtime.relevant = true
    emitSetHipsDirection(
      runtime,
      ALS_CROUCHING_MOVEMENT_MACHINE.initialState,
      setHipsDirection,
    )
    return runtime
  }

  advanceTransitions(runtime, deltaTime)

  while (
    runtime.transitionsTakenThisFrame
    < ALS_CROUCHING_MOVEMENT_MACHINE.maxTransitionsPerFrame
  ) {
    const transition = selectAlsCrouchingMovementTransition({
      hipsDirection: runtime.currentState,
      movementDirection: input.movementDirection,
      hipsDirectionLockAmount: input.hipsDirectionLockAmount,
      feetCrossingAmount: input.feetCrossingAmount,
      stateWeight: runtime.stateWeights[runtime.currentState],
    })
    if (!transition) break
    startTransition(runtime, transition, setHipsDirection)
  }

  return runtime
}
