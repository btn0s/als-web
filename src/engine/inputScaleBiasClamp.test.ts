import { describe, expect, it } from 'vitest'
import {
  createInputScaleBiasClampState,
  fInterpTo,
  mapRangeUnclamped,
  refreshInputScaleBiasClampState,
  resetInputScaleBiasClampState,
} from './inputScaleBiasClamp'

describe('FInputScaleBiasClampState', () => {
  it('maps outside the input range without clamping', () => {
    expect(mapRangeUnclamped(0.5, 0, 0.25, 0, 1)).toBe(2)
  })

  it('snaps on first relevance and then uses asymmetric FInterpTo speeds', () => {
    const state = createInputScaleBiasClampState()
    expect(refreshInputScaleBiasClampState(state, 1, 1 / 60, 20, 5)).toBe(1)
    expect(refreshInputScaleBiasClampState(state, 0, 0.1, 20, 5)).toBe(0.5)
    expect(refreshInputScaleBiasClampState(state, 1, 0.01, 20, 5)).toBe(0.6)
    expect(resetInputScaleBiasClampState(state)).toEqual({
      value: 0,
      initialized: false,
    })
  })

  it('matches FInterpTo zero-speed snap and bounded proportional step', () => {
    expect(fInterpTo(0, 1, 0.01, 0)).toBe(1)
    expect(fInterpTo(0, 1, 0.01, 20)).toBe(0.2)
    expect(fInterpTo(0, 1, 1, 20)).toBe(1)
  })
})
