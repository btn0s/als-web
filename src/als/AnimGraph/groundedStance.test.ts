import { describe, expect, it } from 'vitest'
import {
  advanceGroundedStanceTransition,
  ALS_STANCE_CHANGE_CURVE,
  ALS_STANCE_CHANGE_TRANSITION_DURATION,
  ALS_STANCE_TRANSITION_EXIT_DURATION,
  ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION,
  ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE,
  createAlsGroundedStanceTransitionState,
  startGroundedStanceTransition,
  useDirectGroundedStanceTransition,
} from './groundedStance'

describe('AB_Als_Grounded stance routes', () => {
  it('selects the higher-priority direct route only for moving-smooth or rotate-in-place', () => {
    expect(useDirectGroundedStanceTransition({
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: false,
    })).toBe(false)
    expect(useDirectGroundedStanceTransition({
      movingSmooth: true,
      rotatingLeft: false,
      rotatingRight: false,
    })).toBe(true)
    expect(useDirectGroundedStanceTransition({
      movingSmooth: false,
      rotatingLeft: true,
      rotatingRight: false,
    })).toBe(true)
    expect(useDirectGroundedStanceTransition({
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: true,
    })).toBe(true)
  })

  it('retains the authored direct and transition-state timing', () => {
    expect(ALS_STANCE_CHANGE_TRANSITION_DURATION).toBe(0.5)
    expect(ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE).toBe(1.2)
    expect(ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION).toBe(0.3)
    expect(ALS_STANCE_TRANSITION_EXIT_DURATION).toBe(0)
  })

  it('samples the exact CF_Als_StanceChange middle key over the direct blend', () => {
    expect(ALS_STANCE_CHANGE_CURVE[1]).toMatchObject({
      time: 0.4,
      value: 0.4,
      arriveTangent: 2.7303076,
      leaveTangent: 2.7303076,
    })
    const state = createAlsGroundedStanceTransitionState()
    startGroundedStanceTransition(state, 0, 1)

    advanceGroundedStanceTransition(state, 0.2)
    expect(state.linearAlpha).toBeCloseTo(0.4, 12)
    expect(state.blendAlpha).toBeCloseTo(0.4, 7)
    expect(state.crouchingAmount).toBeCloseTo(0.4, 7)
    expect(state.active).toBe(true)

    advanceGroundedStanceTransition(state, 0.3)
    expect(state.crouchingAmount).toBe(1)
    expect(state.active).toBe(false)
  })

  it('starts an interrupted reversal from the currently published stance amount', () => {
    const state = createAlsGroundedStanceTransitionState()
    startGroundedStanceTransition(state, 0, 1)
    advanceGroundedStanceTransition(state, 0.2)
    startGroundedStanceTransition(state, state.crouchingAmount, 0)

    expect(state.fromCrouchingAmount).toBeCloseTo(0.4, 7)
    expect(state.crouchingAmount).toBeCloseTo(0.4, 7)
    advanceGroundedStanceTransition(state, 0.5)
    expect(state.crouchingAmount).toBe(0)
    expect(state.active).toBe(false)
  })
})
