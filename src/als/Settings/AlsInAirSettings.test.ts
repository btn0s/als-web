import { describe, expect, it } from 'vitest'
import {
  ALS_GROUND_PREDICTION_AMOUNT_CURVE,
  ALS_IN_AIR_LEAN_AMOUNT_CURVE,
  ALS_IN_AIR_SETTINGS,
  sampleGroundPredictionAmount,
  sampleInAirLeanAmount,
} from './AlsInAirSettings'

describe('VERIFIED AIS_Als_Default InAir settings', () => {
  it('binds the two exact authored CurveFloat assets', () => {
    expect(ALS_IN_AIR_SETTINGS).toEqual({
      leanAmountCurve: 'CF_Als_LeanAmount_Air',
      groundPredictionAmountCurve: 'CF_Als_GroundPredictionAmount',
    })
    expect(ALS_IN_AIR_LEAN_AMOUNT_CURVE).toHaveLength(5)
    expect(ALS_GROUND_PREDICTION_AMOUNT_CURVE).toHaveLength(2)
  })

  it('samples the authored vertical-velocity lean curve without a substitute heuristic', () => {
    expect(sampleInAirLeanAmount(-4000)).toBe(0)
    expect(sampleInAirLeanAmount(-2251.931)).toBe(-0.93224025)
    expect(sampleInAirLeanAmount(0)).toBe(1)
    expect(sampleInAirLeanAmount(100)).toBe(1)
  })

  it('samples the authored sweep-hit-time ground prediction curve', () => {
    expect(sampleGroundPredictionAmount(-1)).toBe(1)
    expect(sampleGroundPredictionAmount(0)).toBe(1)
    expect(sampleGroundPredictionAmount(1)).toBe(0)
    expect(sampleGroundPredictionAmount(2)).toBe(0)
    expect(sampleGroundPredictionAmount(0.5)).toBeGreaterThan(0)
    expect(sampleGroundPredictionAmount(0.5)).toBeLessThan(1)
  })
})
