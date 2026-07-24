import {
  alphaToBlendOption,
} from './alphaBlend'
import type { AlphaBlendOption } from './alphaBlend'
import {
  resolveWeightBlendProfileMasks,
} from './blendProfile'
import type { CompiledWeightBlendProfile } from './blendProfile'

export interface StateTransitionRequest<State> {
  readonly from: State
  readonly to: State
  readonly duration: number
  readonly blendOption: AlphaBlendOption
  readonly blendProfile: CompiledWeightBlendProfile
}

export type StateTransitionStartResult =
  | 'started'
  | 'completed'
  | 'alreadyCurrent'
  | 'blockedActiveTransition'

export type StateTransitionAdvanceResult =
  | 'steady'
  | 'transitioning'
  | 'completed'

/**
 * Mutable, allocation-stable output for a standard state-machine transition.
 *
 * `fromStateWeight` and `toStateWeight` are the shaped, unprofiled state weights used for
 * relevance queries. Pose evaluation must instead accumulate each state once at weight 1 using
 * `fromPoseMask` and `toPoseMask`; multiplying a state weight by its mask would apply the
 * transition alpha twice.
 */
export interface StateTransitionClock<State> {
  readonly boneCount: number
  currentState: State
  fromState: State
  toState: State
  active: boolean
  duration: number
  elapsed: number
  linearAlpha: number
  blendAlpha: number
  fromStateWeight: number
  toStateWeight: number
  readonly fromPoseMask: Float32Array
  readonly toPoseMask: Float32Array
  blendOption: AlphaBlendOption
  blendProfile: CompiledWeightBlendProfile | null
}

/** Restores a state-machine node's bReinitializeOnBecomingRelevant state. */
export function resetStateTransitionClock<State>(
  clock: StateTransitionClock<State>,
  state: State,
): StateTransitionClock<State> {
  clock.currentState = state
  clock.fromState = state
  clock.toState = state
  clock.active = false
  clock.duration = 0
  clock.elapsed = 0
  clock.linearAlpha = 1
  clock.blendAlpha = 1
  clock.fromStateWeight = 0
  clock.toStateWeight = 1
  clock.fromPoseMask.fill(0)
  clock.toPoseMask.fill(1)
  clock.blendOption = 'Linear'
  clock.blendProfile = null
  return clock
}

function validateBlendOption(option: AlphaBlendOption) {
  switch (option) {
    case 'Linear':
    case 'Cubic':
    case 'HermiteCubic':
    case 'QuadraticInOut':
      return
  }
  throw new Error(`State transition has unsupported blend option "${String(option)}"`)
}

function validateRequest<State>(
  clock: StateTransitionClock<State>,
  request: StateTransitionRequest<State>,
) {
  if (!Number.isFinite(request.duration) || request.duration < 0) {
    throw new Error('State transition duration must be finite and non-negative')
  }
  validateBlendOption(request.blendOption)
  if (
    request.blendProfile.mode !== 'WeightFactor'
    || request.blendProfile.blendScales.length !== clock.boneCount
  ) {
    throw new Error('State transition blend profile has an incompatible bone count')
  }
}

function refreshTransition<State>(clock: StateTransitionClock<State>) {
  clock.linearAlpha = clock.duration <= 0
    ? 1
    : Math.max(0, Math.min(1, clock.elapsed / clock.duration))
  clock.blendAlpha = alphaToBlendOption(
    clock.linearAlpha,
    clock.blendOption,
  )
  clock.fromStateWeight = 1 - clock.blendAlpha
  clock.toStateWeight = clock.blendAlpha

  if (!clock.blendProfile) {
    clock.fromPoseMask.fill(clock.fromStateWeight)
    clock.toPoseMask.fill(clock.toStateWeight)
    return
  }
  resolveWeightBlendProfileMasks(
    clock.blendProfile,
    clock.blendAlpha,
    clock.fromPoseMask,
    clock.toPoseMask,
  )
}

/**
 * Creates a standard-blend clock in a steady state. The typed-array masks are owned by the clock
 * and reused for every transition.
 */
export function createStateTransitionClock<State>(
  initialState: State,
  boneCount: number,
): StateTransitionClock<State> {
  if (!Number.isInteger(boneCount) || boneCount <= 0) {
    throw new Error('State transition bone count must be a positive integer')
  }

  const fromPoseMask = new Float32Array(boneCount)
  const toPoseMask = new Float32Array(boneCount)
  toPoseMask.fill(1)

  const clock: StateTransitionClock<State> = {
    boneCount,
    currentState: initialState,
    fromState: initialState,
    toState: initialState,
    active: false,
    duration: 0,
    elapsed: 0,
    linearAlpha: 1,
    blendAlpha: 1,
    fromStateWeight: 0,
    toStateWeight: 1,
    fromPoseMask,
    toPoseMask,
    blendOption: 'Linear',
    blendProfile: null,
  }
  return resetStateTransitionClock(clock, initialState)
}

/**
 * Starts a standard state transition at alpha zero, or resolves a zero-duration request
 * immediately.
 *
 * Epic documents that a new active state can interrupt an in-flight transition, but the public
 * contract and ALS's extracted graph do not expose the multi-transition pose-weight propagation
 * needed to reproduce that result. This two-state primitive therefore reports
 * `blockedActiveTransition` without mutating the active blend. Reversal is supported after the
 * current transition reaches its boundary; replacing an active blend would be an unverified
 * approximation.
 */
export function startStateTransition<State>(
  clock: StateTransitionClock<State>,
  request: StateTransitionRequest<State>,
): StateTransitionStartResult {
  validateRequest(clock, request)
  if (clock.active) return 'blockedActiveTransition'
  if (!Object.is(request.from, clock.currentState)) {
    throw new Error('State transition source does not match the current state')
  }
  if (Object.is(request.from, request.to)) {
    return 'alreadyCurrent'
  }

  clock.currentState = request.to
  clock.fromState = request.from
  clock.toState = request.to
  clock.active = request.duration > 0
  clock.duration = request.duration
  clock.elapsed = 0
  clock.blendOption = request.blendOption
  clock.blendProfile = request.blendProfile
  refreshTransition(clock)

  return clock.active ? 'started' : 'completed'
}

/**
 * Advances the transition and clamps overshoot at the authored duration. Completion retains the
 * final from/to sample (zero/one weights and masks), so callers can evaluate the boundary without
 * a special pose path and start the next transition from `currentState`.
 */
export function advanceStateTransition<State>(
  clock: StateTransitionClock<State>,
  deltaTime: number,
): StateTransitionAdvanceResult {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error('State transition delta time must be finite and non-negative')
  }
  if (!clock.active) return 'steady'

  clock.elapsed = Math.min(clock.duration, clock.elapsed + deltaTime)
  refreshTransition(clock)
  if (clock.elapsed >= clock.duration) {
    clock.active = false
    return 'completed'
  }
  return 'transitioning'
}
