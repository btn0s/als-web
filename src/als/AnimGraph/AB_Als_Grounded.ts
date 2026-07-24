import { alphaToBlendOption } from '../../engine/alphaBlend'
import type { AlsStance } from '../Settings/AlsMovementSettings'

/*
 * The retained portion of AB_Als_Grounded's Grounded States machine that owns
 * the Roll handoff. Standing/crouching child graphs and their stance-change
 * states are already retained by AlsAnimationInstance; this module preserves
 * the outer machine's authored relevancy, conduit, Roll evaluator, and Roll
 * exit transition without introducing a second stance controller.
 *
 * VERIFIED from AB_Als_Grounded.uasset, scripts/extract-als/abp-graph.json,
 * and the PlayRollToGroundedTransitionAnimation generated-class bytecode.
 */

export type AlsGroundedEntryMode = 'FromRoll' | null

export type AlsGroundedRollGraphState =
  | 'Entry Conduit'
  | 'Standing'
  | 'Crouching'
  | 'Roll'

export const ALS_GROUNDED_ROLL_GRAPH_MACHINE = Object.freeze({
  name: 'Grounded States',
  compiledNodeIndex: 33,
  initialState: 'Entry Conduit',
  initialStateIndex: 0,
  maxTransitionsPerFrame: 1,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
  allowConduitEntryStates: true,
})

const standardTransition = {
  automaticRemainingTimeRule: false,
  automaticRuleTriggerTime: -1,
  logic: 'StandardBlend',
} as const

export const ALS_GROUNDED_ROLL_TRANSITIONS = Object.freeze({
  enter: Object.freeze({
    ...standardTransition,
    transitionIndex: 0,
    from: 'Entry Conduit',
    to: 'Roll',
    duration: 0.2,
    blendOption: 'HermiteCubic',
    compiledDelegateIndex: 17,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_1',
  }),
  toCrouching: Object.freeze({
    ...standardTransition,
    transitionIndex: 18,
    from: 'Roll',
    to: 'Crouching',
    duration: 0.6,
    blendOption: 'Cubic',
    compiledDelegateIndex: 7,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_11',
  }),
  toStanding: Object.freeze({
    ...standardTransition,
    transitionIndex: 19,
    from: 'Roll',
    to: 'Standing',
    duration: 0.6,
    blendOption: 'Cubic',
    compiledDelegateIndex: 6,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_12',
  }),
})

export const ALS_GROUNDED_ROLL_STATE = Object.freeze({
  stateIndex: 5,
  stateResultNodeIndex: 22,
  alwaysResetOnEntry: false,
  sequenceEvaluator: Object.freeze({
    compiledNodeIndex: 21,
    clip: 'A_Als_Roll',
    explicitTime: 1.5,
    loop: true,
    teleportToExplicitTime: true,
    reinitializationBehavior: 'ExplicitTime',
    groupName: 'None',
    groupRole: 'CanBeLeader',
    syncMethod: 'DoNotSync',
  }),
  modifyCurve: Object.freeze({
    compiledNodeIndex: 20,
    applyMode: 'Blend',
    alpha: 1,
    values: Object.freeze({
      FootLeftLock: 1,
      FootRightLock: 1,
    }),
  }),
  resetGroundedEntryMode: Object.freeze({
    compiledNodeIndex: 19,
    callSite: 'OnBecomeRelevant',
    callback: 'ResetGroundedEntryMode',
  }),
  stateExitCallback: 'PlayRollToGroundedTransitionAnimation',
  stateExitTransitionAnimation: Object.freeze({
    function: 'PlayTransitionRightAnimation',
    sequences: Object.freeze({
      Standing: 'A_Als_Stand_Transition_Right',
      Crouching: 'A_Als_Crouch_Transition_Right',
    }),
    blendInDuration: 0.2,
    blendOutDuration: 0.2,
    playRate: 1.5,
    startTime: 0.2,
    fromStandingIdleOnly: false,
  }),
})

export interface AlsGroundedRollExitTransition {
  readonly target: AlsStance
  readonly transitionIndex: 18 | 19
  readonly duration: 0.6
  elapsedTime: number
  linearAlpha: number
  blendAlpha: number
}

export interface AlsGroundedRollGraphRuntime {
  relevant: boolean
  currentState: AlsGroundedRollGraphState
  firstUpdate: boolean
  lastTransitionIndex: number
  readonly stateWeights: {
    Standing: number
    Crouching: number
    Roll: number
  }
  activeExitTransition: AlsGroundedRollExitTransition | null
}

export interface AlsGroundedRollGraphRefreshInput {
  readonly deltaTime: number
  readonly relevant: boolean
  readonly stance: AlsStance | null
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  readonly poseStandingAmount: number
  readonly poseCrouchingAmount: number
  readonly groundedEntryMode: AlsGroundedEntryMode
}

export interface AlsGroundedRollTransitionAnimationRequest {
  readonly function: 'PlayTransitionRightAnimation'
  readonly sequence:
    | 'A_Als_Stand_Transition_Right'
    | 'A_Als_Crouch_Transition_Right'
  readonly blendInDuration: 0.2
  readonly blendOutDuration: 0.2
  readonly playRate: 1.5
  readonly startTime: 0.2
  readonly fromStandingIdleOnly: false
}

export interface AlsGroundedRollGraphRefreshResult {
  readonly transition:
    | typeof ALS_GROUNDED_ROLL_TRANSITIONS.enter
    | typeof ALS_GROUNDED_ROLL_TRANSITIONS.toCrouching
    | typeof ALS_GROUNDED_ROLL_TRANSITIONS.toStanding
    | null
  readonly resetGroundedEntryMode: boolean
  readonly stateExitTransitionAnimation:
    AlsGroundedRollTransitionAnimationRequest | null
}

function clearWeights(
  runtime: AlsGroundedRollGraphRuntime,
) {
  runtime.stateWeights.Standing = 0
  runtime.stateWeights.Crouching = 0
  runtime.stateWeights.Roll = 0
}

function setFullWeight(
  runtime: AlsGroundedRollGraphRuntime,
  state: Exclude<AlsGroundedRollGraphState, 'Entry Conduit'>,
) {
  clearWeights(runtime)
  runtime.stateWeights[state] = 1
}

function wantsStanding(
  stance: AlsStance | null,
) {
  // The generated rule treats an invalid Stance gameplay tag as Standing.
  return stance === 'Standing' || stance === null
}

export function selectAlsGroundedEntryState(
  input: Pick<
    AlsGroundedRollGraphRefreshInput,
    | 'groundedEntryMode'
    | 'movingSmooth'
    | 'rotatingLeft'
    | 'rotatingRight'
    | 'poseStandingAmount'
    | 'poseCrouchingAmount'
  >,
): Exclude<AlsGroundedRollGraphState, 'Entry Conduit'> {
  const active = (
    input.movingSmooth
    || input.rotatingLeft
    || input.rotatingRight
  )
  if (input.groundedEntryMode === 'FromRoll' && !active) {
    return 'Roll'
  }
  if (input.poseCrouchingAmount >= 0.5) return 'Crouching'
  if (input.poseStandingAmount >= 0.5) return 'Standing'
  return 'Standing'
}

export function createAlsGroundedRollGraphRuntime():
AlsGroundedRollGraphRuntime {
  return {
    relevant: false,
    currentState: ALS_GROUNDED_ROLL_GRAPH_MACHINE.initialState,
    firstUpdate: true,
    lastTransitionIndex: -1,
    stateWeights: {
      Standing: 0,
      Crouching: 0,
      Roll: 0,
    },
    activeExitTransition: null,
  }
}

function resetRuntime(
  runtime: AlsGroundedRollGraphRuntime,
) {
  runtime.currentState =
    ALS_GROUNDED_ROLL_GRAPH_MACHINE.initialState
  runtime.firstUpdate = true
  runtime.lastTransitionIndex = -1
  runtime.activeExitTransition = null
  clearWeights(runtime)
}

function advanceExitTransition(
  runtime: AlsGroundedRollGraphRuntime,
  deltaTime: number,
) {
  const active = runtime.activeExitTransition
  if (!active) return
  active.elapsedTime = Math.min(
    active.duration,
    active.elapsedTime + deltaTime,
  )
  active.linearAlpha = active.duration <= 0
    ? 1
    : active.elapsedTime / active.duration
  active.blendAlpha = alphaToBlendOption(
    active.linearAlpha,
    'Cubic',
  )
  clearWeights(runtime)
  runtime.stateWeights.Roll = 1 - active.blendAlpha
  runtime.stateWeights[active.target] = active.blendAlpha
  if (active.elapsedTime >= active.duration) {
    runtime.activeExitTransition = null
    setFullWeight(runtime, active.target)
  }
}

function createExitTransitionAnimationRequest(
  target: AlsStance,
): AlsGroundedRollTransitionAnimationRequest {
  const request =
    ALS_GROUNDED_ROLL_STATE.stateExitTransitionAnimation
  return {
    function: request.function,
    sequence: request.sequences[target],
    blendInDuration: request.blendInDuration,
    blendOutDuration: request.blendOutDuration,
    playRate: request.playRate,
    startTime: request.startTime,
    fromStandingIdleOnly: request.fromStandingIdleOnly,
  }
}

/**
 * Retains the exact cross-frame Roll portion of Grounded States.
 *
 * The PostLocomotion slot controls `relevant`: a full-weight Roll makes the
 * source graph irrelevant. When the montage begins blending out, the machine
 * reinitializes through Entry Conduit, consumes FromRoll, and evaluates the
 * fixed Roll pose. The following update starts the authored 0.6-second Cubic
 * exit while its outgoing Roll pose remains retained.
 */
export function refreshAlsGroundedRollGraph(
  runtime: AlsGroundedRollGraphRuntime,
  input: AlsGroundedRollGraphRefreshInput,
): AlsGroundedRollGraphRefreshResult {
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) {
    throw new Error(
      'Grounded States deltaTime must be finite and non-negative',
    )
  }

  if (!input.relevant) {
    runtime.relevant = false
    clearWeights(runtime)
    return {
      transition: null,
      resetGroundedEntryMode: false,
      stateExitTransitionAnimation: null,
    }
  }

  if (!runtime.relevant) {
    resetRuntime(runtime)
    runtime.relevant = true
    const entryState = selectAlsGroundedEntryState(input)
    runtime.currentState = entryState
    runtime.firstUpdate = false
    setFullWeight(runtime, entryState)
    const transition = entryState === 'Roll'
      ? ALS_GROUNDED_ROLL_TRANSITIONS.enter
      : null
    runtime.lastTransitionIndex =
      transition?.transitionIndex ?? (
        entryState === 'Crouching' ? 1 : 2
      )
    return {
      transition,
      // Standing, Crouching, and Roll each call ResetGroundedEntryMode
      // from an OnBecomeRelevant FAnimNode_CallFunction.
      resetGroundedEntryMode: true,
      stateExitTransitionAnimation: null,
    }
  }

  if (runtime.activeExitTransition) {
    advanceExitTransition(runtime, input.deltaTime)
    return {
      transition: null,
      resetGroundedEntryMode: false,
      stateExitTransitionAnimation: null,
    }
  }

  if (runtime.currentState === 'Roll') {
    const target: AlsStance = input.stance === 'Crouching'
      ? 'Crouching'
      : 'Standing'
    const transition = target === 'Crouching'
      ? ALS_GROUNDED_ROLL_TRANSITIONS.toCrouching
      : ALS_GROUNDED_ROLL_TRANSITIONS.toStanding
    runtime.currentState = target
    runtime.lastTransitionIndex = transition.transitionIndex
    runtime.activeExitTransition = {
      target,
      transitionIndex: transition.transitionIndex,
      duration: transition.duration,
      elapsedTime: 0,
      linearAlpha: 0,
      blendAlpha: 0,
    }
    advanceExitTransition(runtime, input.deltaTime)
    return {
      transition,
      resetGroundedEntryMode: true,
      stateExitTransitionAnimation:
        createExitTransitionAnimationRequest(target),
    }
  }

  const target = wantsStanding(input.stance)
    ? 'Standing'
    : 'Crouching'
  runtime.currentState = target
  setFullWeight(runtime, target)
  return {
    transition: null,
    resetGroundedEntryMode: false,
    stateExitTransitionAnimation: null,
  }
}
