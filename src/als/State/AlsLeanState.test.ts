import { describe, expect, it, vi } from 'vitest'
import {
  ALS_IN_AIR_LEAN_REFERENCE_SPEED,
  ALS_LEAN_INTERPOLATION_SPEED,
  createAlsLeanState,
  refreshGroundedLean,
  refreshInAirLean,
} from './AlsLeanState'

describe('FAlsLeanState parity', () => {
  it('uses the FAlsLeanState and FAlsGeneralAnimationSettings defaults', () => {
    expect(createAlsLeanState()).toEqual({
      rightAmount: 0,
      forwardAmount: 0,
    })
    expect(ALS_LEAN_INTERPOLATION_SPEED).toBe(4)
    // AlsAnimationInstance.cpp uses 350 cm/s; the runtime boundary is metres per second.
    expect(ALS_IN_AIR_LEAN_REFERENCE_SPEED).toBe(3.5)
  })

  it('maps grounded local X to forward and local Y to right on pending update', () => {
    const state = createAlsLeanState()
    const result = refreshGroundedLean(state, {
      relativeAccelerationAmount: { x: 0.25, y: -0.75 },
      pendingUpdate: true,
      deltaTime: 1,
    })

    expect(result).toBe(state)
    expect(state).toEqual({
      rightAmount: -0.75,
      forwardAmount: 0.25,
    })
  })

  it('snaps when interpolation is disabled', () => {
    const state = { rightAmount: 1, forwardAmount: -1 }
    refreshGroundedLean(state, {
      relativeAccelerationAmount: { x: 0.5, y: -0.25 },
      pendingUpdate: false,
      deltaTime: 0.1,
      leanInterpolationSpeed: 0,
    })
    expect(state).toEqual({
      rightAmount: -0.25,
      forwardAmount: 0.5,
    })
  })

  it('uses the exact InvExpApprox interpolation amount', () => {
    const state = { rightAmount: 0.5, forwardAmount: -1 }
    refreshGroundedLean(state, {
      relativeAccelerationAmount: { x: 1, y: -0.5 },
      pendingUpdate: false,
      deltaTime: 0.25,
    })

    const amount = 0.6316758747697974
    expect(state.rightAmount).toBeCloseTo(
      0.5 + (-0.5 - 0.5) * amount,
      15,
    )
    expect(state.forwardAmount).toBeCloseTo(-1 + 2 * amount, 15)
  })

  it('samples the authored in-air curve in cm/s and applies the 350 cm/s reference', () => {
    const leanAmountCurve = vi.fn(() => -0.5)
    const state = createAlsLeanState()
    refreshInAirLean(state, {
      relativeVelocity: { x: 1.75, y: -3.5, z: 10 },
      verticalVelocity: -4,
      leanAmountCurve,
      pendingUpdate: true,
      deltaTime: 1,
    })

    expect(leanAmountCurve).toHaveBeenCalledExactlyOnceWith(-400)
    expect(state.forwardAmount).toBeCloseTo(-0.25, 12)
    expect(state.rightAmount).toBeCloseTo(0.5, 12)
  })

  it.each([-8, -1, 0, 1, 8])(
    'a zero authored curve yields no in-air lean at vertical velocity %s',
    (verticalVelocity) => {
      const state = { rightAmount: 0.4, forwardAmount: -0.2 }
      refreshInAirLean(state, {
        relativeVelocity: { x: 100, y: -100, z: 50 },
        verticalVelocity,
        leanAmountCurve: () => 0,
        pendingUpdate: true,
        deltaTime: 1 / 60,
      })
      expect(state.rightAmount).toBeCloseTo(0, 15)
      expect(state.forwardAmount).toBeCloseTo(0, 15)
    },
  )
})
