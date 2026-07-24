/** Web-native payload queued by ALS's worker-thread transition functions. */
export interface AlsTransitionAnimation {
  readonly clip: string
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: number
  readonly startTime: number
}

/** Framework-free counterpart of FAlsTransitionsState. */
export interface AlsTransitionsState {
  transitionsAllowed: boolean
  queuedTransition: AlsTransitionAnimation | null
  stopTransitionsQueued: boolean
  queuedStopTransitionsBlendOutDuration: number
}

export function createAlsTransitionsState(): AlsTransitionsState {
  return {
    transitionsAllowed: false,
    queuedTransition: null,
    stopTransitionsQueued: false,
    queuedStopTransitionsBlendOutDuration: 0,
  }
}

// FAnimWeight::IsFullWeight(), pinned by the C++ oracle used by AlsFeetState.
const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

/** UAlsAnimationInstance::RefreshTransitions(), cpp:1476-1482. */
export function refreshTransitions(
  state: AlsTransitionsState,
  allowTransitionsCurveValue: number,
): AlsTransitionsState {
  state.transitionsAllowed =
    allowTransitionsCurveValue >= 1 - ZERO_ANIMATION_WEIGHT_THRESHOLD
  return state
}

export interface AlsQueueTransitionInput extends AlsTransitionAnimation {
  readonly fromStandingIdleOnly?: boolean
  readonly moving?: boolean
  readonly standing?: boolean
}

/**
 * UAlsAnimationInstance::PlayTransitionAnimation(), cpp:1416-1438.
 *
 * Returns false only for the source's standing-idle guard. The React/game-thread owner decides
 * when to consume the queued record.
 */
export function queueTransitionAnimation(
  state: AlsTransitionsState,
  input: AlsQueueTransitionInput,
): boolean {
  if (
    input.fromStandingIdleOnly
    && (input.moving || input.standing === false)
  ) {
    return false
  }

  state.queuedTransition = {
    clip: input.clip,
    blendInDuration: input.blendInDuration,
    blendOutDuration: input.blendOutDuration,
    playRate: input.playRate,
    startTime: input.startTime,
  }
  return true
}

/**
 * Game-thread `PlayQueuedTransitionAnimation()`, cpp:1590-1610.
 *
 * A pending stop suppresses playback without clearing the transition, exactly like ALS. A
 * successful take clears all queued transition fields by replacing the record with null.
 */
export function takeQueuedTransitionAnimation(
  state: AlsTransitionsState,
): AlsTransitionAnimation | null {
  if (state.stopTransitionsQueued || !state.queuedTransition) return null
  const transition = state.queuedTransition
  state.queuedTransition = null
  return transition
}

/** UAlsAnimationInstance::StopTransitionAndTurnInPlaceAnimations(), cpp:1465-1474. */
export function queueStopTransitionAndTurnInPlaceAnimations(
  state: AlsTransitionsState,
  blendOutDuration: number,
): AlsTransitionsState {
  state.stopTransitionsQueued = true
  state.queuedStopTransitionsBlendOutDuration = blendOutDuration
  return state
}

/**
 * Game-thread `StopQueuedTransitionAndTurnInPlaceAnimations()`, cpp:1612-1627.
 * Returns the blend-out duration for the Transition and both TurnInPlace slots.
 */
export function takeQueuedTransitionStop(
  state: AlsTransitionsState,
): number | null {
  if (!state.stopTransitionsQueued) return null
  const blendOutDuration = state.queuedStopTransitionsBlendOutDuration
  state.stopTransitionsQueued = false
  state.queuedStopTransitionsBlendOutDuration = 0
  return blendOutDuration
}
