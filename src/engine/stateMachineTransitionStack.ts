import {
  alphaToBlendOption,
} from './alphaBlend'
import type { AlphaBlendOption } from './alphaBlend'
import {
  resolveWeightBlendProfileMasks,
} from './blendProfile'
import type { CompiledWeightBlendProfile } from './blendProfile'

const transitionStackStorage = Symbol('stateMachineTransitionStackStorage')

export interface StateMachineStandardTransitionRequest<State> {
  readonly from: State
  readonly to: State
  readonly duration: number
  readonly blendOption: AlphaBlendOption
  readonly blendProfile?: CompiledWeightBlendProfile | null
  /** FAnimationPotentialTransition::CrossfadeTimeAdjustment. */
  readonly crossfadeTimeAdjustment?: number
}

/**
 * One FAnimationActiveTransitionEntry and its reusable standard-blend output.
 *
 * FAnimNode_StateMachine::Evaluate_AnyThread and EvaluateTransitionStandardBlend evaluate entries
 * oldest to newest. Entry zero blends `previousState` to `nextState`; every later entry blends
 * the accumulated result of the preceding entries to its `nextState`. Curves and attributes use
 * scalar `alpha`; EvaluateTransitionStandardBlendInternal uses the masks only for the pose.
 */
export interface StateMachineStandardTransition<State> {
  previousState: State
  nextState: State
  elapsedTime: number
  linearAlpha: number
  alpha: number
  crossfadeDuration: number
  blendOption: AlphaBlendOption
  blendProfile: CompiledWeightBlendProfile | null
  active: boolean
  usesIntermediatePose: boolean
  readonly previousPoseMask: Float32Array
  readonly nextPoseMask: Float32Array
}

interface StateMachineTransitionStackStorage<State> {
  readonly activeTransitions: StateMachineStandardTransition<State>[]
  readonly recycledTransitions: StateMachineStandardTransition<State>[]
}

export interface StateMachineTransitionStack<State> {
  readonly boneCount: number
  currentState: State
  /** FAnimNode_StateMachine::ActiveTransitionArray, oldest transition first. */
  readonly activeTransitions:
    readonly StateMachineStandardTransition<State>[]
  readonly [transitionStackStorage]:
    StateMachineTransitionStackStorage<State>
}

export type StartStateMachineStandardTransitionResult =
  | 'started'
  | 'alreadyCurrent'

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * FAnimationActiveTransitionEntry::CalculateInverseAlpha.
 *
 * Despite its name, UE only uses the polynomial approximation for HermiteCubic. Every other
 * authored blend option uses the clamped fraction directly.
 */
function calculateInverseAlpha(
  blendOption: AlphaBlendOption,
  fraction: number,
) {
  if (blendOption === 'HermiteCubic') {
    const squared = fraction * fraction
    return (
      (4 / 3) * squared * fraction
      - 2 * squared
      + (5 / 3) * fraction
    )
  }
  return clamp01(fraction)
}

function createTransition<State>(
  initialState: State,
  boneCount: number,
): StateMachineStandardTransition<State> {
  const previousPoseMask = new Float32Array(boneCount)
  const nextPoseMask = new Float32Array(boneCount)
  previousPoseMask.fill(1)

  return {
    previousState: initialState,
    nextState: initialState,
    elapsedTime: 0,
    linearAlpha: 0,
    alpha: 0,
    crossfadeDuration: 0,
    blendOption: 'Linear',
    blendProfile: null,
    active: false,
    usesIntermediatePose: false,
    previousPoseMask,
    nextPoseMask,
  }
}

function validateBlendOption(option: AlphaBlendOption) {
  switch (option) {
    case 'Linear':
    case 'Cubic':
    case 'HermiteCubic':
    case 'QuadraticInOut':
      return
  }
  throw new Error(
    `State-machine transition has unsupported blend option "${String(option)}"`,
  )
}

function validateRequest<State>(
  stack: StateMachineTransitionStack<State>,
  request: StateMachineStandardTransitionRequest<State>,
) {
  if (!Number.isFinite(request.duration) || request.duration < 0) {
    throw new Error(
      'State-machine transition duration must be finite and non-negative',
    )
  }
  const crossfadeTimeAdjustment = request.crossfadeTimeAdjustment ?? 0
  if (
    !Number.isFinite(crossfadeTimeAdjustment)
    || crossfadeTimeAdjustment < 0
  ) {
    throw new Error(
      'State-machine crossfade time adjustment must be finite and non-negative',
    )
  }
  validateBlendOption(request.blendOption)

  const profile = request.blendProfile
  if (!profile) return
  if (
    profile.mode !== 'WeightFactor'
    || profile.blendScales.length !== stack.boneCount
  ) {
    throw new Error(
      'State-machine transition blend profile has an incompatible bone count',
    )
  }
  for (const scale of profile.blendScales) {
    if (!Number.isFinite(scale) || scale < 0) {
      throw new Error(
        'State-machine transition blend profile has an invalid weight factor',
      )
    }
  }
}

/**
 * UBlendProfile::CalculateBoneWeight followed by
 * FBlendSampleData::NormalizeDataWeight.
 */
function refreshPoseMasks<State>(
  transition: StateMachineStandardTransition<State>,
) {
  const { alpha, blendProfile, previousPoseMask, nextPoseMask } = transition
  if (!blendProfile) {
    previousPoseMask.fill(1 - alpha)
    nextPoseMask.fill(alpha)
    return
  }
  resolveWeightBlendProfileMasks(
    blendProfile,
    alpha,
    previousPoseMask,
    nextPoseMask,
  )
}

function refreshTransition<State>(
  transition: StateMachineStandardTransition<State>,
) {
  transition.linearAlpha = transition.crossfadeDuration > 0
    ? clamp01(transition.elapsedTime / transition.crossfadeDuration)
    : 0
  transition.alpha = alphaToBlendOption(
    transition.linearAlpha,
    transition.blendOption,
  )
  refreshPoseMasks(transition)
}

function takeTransition<State>(
  stack: StateMachineTransitionStack<State>,
) {
  const storage = stack[transitionStackStorage]
  return storage.recycledTransitions.pop()
    ?? createTransition(stack.currentState, stack.boneCount)
}

function recycleOldestTransitions<State>(
  stack: StateMachineTransitionStack<State>,
  count: number,
) {
  const storage = stack[transitionStackStorage]
  for (let index = 0; index < count; index++) {
    const transition = storage.activeTransitions.shift()
    if (!transition) break
    transition.active = false
    transition.usesIntermediatePose = false
    storage.recycledTransitions.push(transition)
  }
  for (
    let index = 0;
    index < storage.activeTransitions.length;
    index++
  ) {
    storage.activeTransitions[index].usesIntermediatePose = index > 0
  }
}

/**
 * Creates allocation-conscious state for UE standard transitions. Transition objects and their
 * typed-array pose masks are recycled; advancing and querying the stack allocate nothing.
 */
export function createStateMachineTransitionStack<State>(
  initialState: State,
  boneCount: number,
  preallocatedTransitionCount = 4,
): StateMachineTransitionStack<State> {
  if (!Number.isInteger(boneCount) || boneCount <= 0) {
    throw new Error(
      'State-machine transition bone count must be a positive integer',
    )
  }
  if (
    !Number.isInteger(preallocatedTransitionCount)
    || preallocatedTransitionCount < 0
  ) {
    throw new Error(
      'State-machine preallocated transition count must be a non-negative integer',
    )
  }

  const storage: StateMachineTransitionStackStorage<State> = {
    activeTransitions: [],
    recycledTransitions: [],
  }
  for (
    let index = 0;
    index < preallocatedTransitionCount;
    index++
  ) {
    storage.recycledTransitions.push(
      createTransition(initialState, boneCount),
    )
  }

  return {
    boneCount,
    currentState: initialState,
    activeTransitions: storage.activeTransitions,
    [transitionStackStorage]: storage,
  }
}

export function resetStateMachineTransitionStack<State>(
  stack: StateMachineTransitionStack<State>,
  state: State,
) {
  const storage = stack[transitionStackStorage]
  while (storage.activeTransitions.length > 0) {
    const transition = storage.activeTransitions.pop()
    if (!transition) break
    transition.active = false
    transition.usesIntermediatePose = false
    storage.recycledTransitions.push(transition)
  }
  stack.currentState = state
  return stack
}

/**
 * FAnimNode_StateMachine::GetStateWeight.
 *
 * These are scalar relevance/update weights. A WeightFactor blend profile changes pose masks,
 * never this state-weight recurrence.
 */
export function getStateMachineStateWeight<State>(
  stack: StateMachineTransitionStack<State>,
  state: State,
) {
  const transitions = stack[transitionStackStorage].activeTransitions
  if (transitions.length === 0) {
    return Object.is(state, stack.currentState) ? 1 : 0
  }

  let totalWeight = 0
  for (let index = 0; index < transitions.length; index++) {
    const transition = transitions[index]
    const sourceWeight = 1 - transition.alpha

    if (index > 0) {
      totalWeight *= sourceWeight
    } else if (Object.is(transition.previousState, state)) {
      totalWeight += sourceWeight
    }

    if (Object.is(transition.nextState, state)) {
      totalWeight += transition.alpha
    }
  }
  return clamp01(totalWeight)
}

/** Writes UE scalar state weights into caller-owned memory. */
export function writeStateMachineStateWeights<State>(
  stack: StateMachineTransitionStack<State>,
  states: readonly State[],
  output: Float32Array,
) {
  if (output.length !== states.length) {
    throw new Error(
      'State-machine state-weight output has an incompatible length',
    )
  }
  for (let index = 0; index < states.length; index++) {
    output[index] = getStateMachineStateWeight(stack, states[index])
  }
  return output
}

/**
 * Pushes an FAnimationActiveTransitionEntry.
 *
 * FAnimNode_StateMachine::Update_AnyThread first queries the target's existing state weight, then
 * scans newest-to-oldest for an entry whose PreviousState is that target. UE's legacy
 * ExistingTransitionForNextState constructor parameter is intentionally unused, but the scan and
 * constructor call are retained here in the same order.
 */
export function startStateMachineStandardTransition<State>(
  stack: StateMachineTransitionStack<State>,
  request: StateMachineStandardTransitionRequest<State>,
): StartStateMachineStandardTransitionResult {
  validateRequest(stack, request)
  if (!Object.is(request.from, stack.currentState)) {
    throw new Error(
      'State-machine transition source does not match the current state',
    )
  }
  if (Object.is(request.from, request.to)) return 'alreadyCurrent'

  const storage = stack[transitionStackStorage]
  const existingWeightOfNextState = getStateMachineStateWeight(
    stack,
    request.to,
  )
  let existingTransitionForNextState:
    StateMachineStandardTransition<State> | null = null
  for (
    let index = storage.activeTransitions.length - 1;
    index >= 0;
    index--
  ) {
    if (
      Object.is(
        storage.activeTransitions[index].previousState,
        request.to,
      )
    ) {
      existingTransitionForNextState = storage.activeTransitions[index]
      break
    }
  }

  const transition = takeTransition(stack)
  transition.previousState = request.from
  transition.nextState = request.to
  transition.elapsedTime = 0
  transition.linearAlpha = 0
  transition.alpha = 0
  transition.blendOption = request.blendOption
  transition.blendProfile = request.blendProfile ?? null
  transition.active = true
  transition.usesIntermediatePose = storage.activeTransitions.length > 0

  const scaler = 1 - existingWeightOfNextState
  const baseDuration = Math.max(
    request.duration - (request.crossfadeTimeAdjustment ?? 0),
    0,
  )
  transition.crossfadeDuration = (
    baseDuration
    * calculateInverseAlpha(request.blendOption, scaler)
  )
  refreshTransition(transition)

  // The pointer was removed from UE's newer constructor overload because it has no effect.
  void existingTransitionForNextState

  storage.activeTransitions.push(transition)
  stack.currentState = request.to
  return 'started'
}

/**
 * FAnimationActiveTransitionEntry::Update plus FAnimNode_StateMachine::Update_AnyThread cleanup.
 *
 * All entries advance oldest-to-newest. Cleanup scans newest-to-oldest; the first finished entry
 * removes itself and every older entry, preserving any newer transitions still in flight.
 *
 * @returns the number of transitions removed from the front of ActiveTransitionArray.
 */
export function advanceStateMachineTransitionStack<State>(
  stack: StateMachineTransitionStack<State>,
  deltaTime: number,
) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      'State-machine transition delta time must be finite and non-negative',
    )
  }

  const transitions = stack[transitionStackStorage].activeTransitions
  for (const transition of transitions) {
    transition.elapsedTime += deltaTime
    refreshTransition(transition)
    if (
      transition.crossfadeDuration <= 0
      || transition.elapsedTime >= transition.crossfadeDuration
    ) {
      transition.active = false
    }
  }

  for (let index = transitions.length - 1; index >= 0; index--) {
    if (!transitions[index].active) {
      const removedTransitionCount = index + 1
      recycleOldestTransitions(stack, removedTransitionCount)
      return removedTransitionCount
    }
  }
  return 0
}
