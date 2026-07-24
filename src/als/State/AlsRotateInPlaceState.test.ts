import { describe, expect, it } from 'vitest'
import { mapRotateInPlacePlayRate } from '../Settings/AlsRotateInPlaceSettings'
import {
  advanceRotateInPlaceClipTime,
  createAlsRotateInPlaceState,
  fInterpTo,
  refreshRotateInPlace,
} from './AlsRotateInPlaceState'

describe('ALS rotate in place', () => {
  it('wraps the shared pose-and-curve clock at the authored clip duration', () => {
    expect(advanceRotateInPlaceClipTime(0, 1.1, 1, 1)).toBeCloseTo(0.1)
    expect(advanceRotateInPlaceClipTime(0.5, 1, 2, 0)).toBe(0)
  })

  it('maps 180..460 degrees per second to play rate 1.15..3.0', () => {
    expect(mapRotateInPlacePlayRate(180)).toBeCloseTo(1.15)
    expect(mapRotateInPlacePlayRate(320)).toBeCloseTo(2.075)
    expect(mapRotateInPlacePlayRate(460)).toBeCloseTo(3)
  })

  it('uses the distinct clamped FInterpTo step instead of exponential decay', () => {
    expect(fInterpTo(1, 3, 0.1, 5)).toBe(2)
    expect(fInterpTo(1, 3, 1, 5)).toBe(3)
  })

  it('rotates only outside the strict +/-50 degree thresholds', () => {
    const state = createAlsRotateInPlaceState()
    refreshRotateInPlace(state, {
      delta: 0.1,
      moving: false,
      allowed: true,
      viewYawAngle: -51,
      viewYawSpeed: 460,
    })
    expect(state.rotatingLeft).toBe(true)
    expect(state.rotatingRight).toBe(false)
    expect(state.playRate).toBeCloseTo(2.075)
  })
})
