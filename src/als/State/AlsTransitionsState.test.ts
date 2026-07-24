import { describe, expect, it } from 'vitest'
import {
  createAlsTransitionsState,
  queueStopTransitionAndTurnInPlaceAnimations,
  queueTransitionAnimation,
  refreshTransitions,
  takeQueuedTransitionAnimation,
  takeQueuedTransitionStop,
} from './AlsTransitionsState'

const TRANSITION = {
  clip: 'A_Als_Stand_Transition_Left',
  blendInDuration: 0.1,
  blendOutDuration: 0.2,
  playRate: 1.75,
  startTime: 0.3,
} as const

describe('FAlsTransitionsState parity', () => {
  it('initializes every field from AlsTransitionsState.h', () => {
    expect(createAlsTransitionsState()).toEqual({
      transitionsAllowed: false,
      queuedTransition: null,
      stopTransitionsQueued: false,
      queuedStopTransitionsBlendOutDuration: 0,
    })
  })

  it('uses FAnimWeight::IsFullWeight for the AllowTransitions curve', () => {
    const state = createAlsTransitionsState()
    refreshTransitions(state, 1 - 1e-5 - Number.EPSILON)
    expect(state.transitionsAllowed).toBe(false)
    refreshTransitions(state, 1 - 1e-5)
    expect(state.transitionsAllowed).toBe(true)
    refreshTransitions(state, 2)
    expect(state.transitionsAllowed).toBe(true)
  })

  it('enforces only the optional standing-idle guard before queuing', () => {
    const state = createAlsTransitionsState()
    expect(queueTransitionAnimation(state, {
      ...TRANSITION,
      fromStandingIdleOnly: true,
      moving: true,
      standing: true,
    })).toBe(false)
    expect(state.queuedTransition).toBeNull()
    expect(queueTransitionAnimation(state, {
      ...TRANSITION,
      fromStandingIdleOnly: true,
      moving: false,
      standing: false,
    })).toBe(false)
    expect(queueTransitionAnimation(state, {
      ...TRANSITION,
      fromStandingIdleOnly: true,
      moving: false,
      standing: true,
    })).toBe(true)
    expect(state.queuedTransition).toEqual(TRANSITION)
  })

  it('suppresses a queued play while stop is pending, then preserves it for the next take', () => {
    const state = createAlsTransitionsState()
    queueTransitionAnimation(state, TRANSITION)
    queueStopTransitionAndTurnInPlaceAnimations(state, 0.35)

    expect(takeQueuedTransitionAnimation(state)).toBeNull()
    expect(state.queuedTransition).toEqual(TRANSITION)
    expect(takeQueuedTransitionStop(state)).toBe(0.35)
    expect(state.stopTransitionsQueued).toBe(false)
    expect(state.queuedStopTransitionsBlendOutDuration).toBe(0)
    expect(takeQueuedTransitionAnimation(state)).toEqual(TRANSITION)
    expect(state.queuedTransition).toBeNull()
    expect(takeQueuedTransitionStop(state)).toBeNull()
  })
})
