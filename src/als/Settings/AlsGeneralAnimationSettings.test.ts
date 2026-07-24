import { describe, expect, it } from 'vitest'
import {
  ALS_GENERAL_ANIMATION_SETTINGS,
  calculateMovingSmooth,
} from './AlsGeneralAnimationSettings'

describe('FAlsGeneralAnimationSettings parity', () => {
  it('retains ALS Refactored defaults in web boundary units', () => {
    expect(ALS_GENERAL_ANIMATION_SETTINGS).toEqual({
      useHandIkBones: true,
      useFootIkBones: true,
      movingSmoothSpeedThreshold: 1.5,
      leanInterpolationSpeed: 4,
    })
  })

  it('uses input plus velocity or the strict 150 cm/s threshold', () => {
    expect(calculateMovingSmooth({
      hasInput: true,
      hasVelocity: true,
      speed: 0.01,
    })).toBe(true)
    expect(calculateMovingSmooth({
      hasInput: false,
      hasVelocity: true,
      speed: 1.5,
    })).toBe(false)
    expect(calculateMovingSmooth({
      hasInput: false,
      hasVelocity: true,
      speed: 1.500001,
    })).toBe(true)
  })
})
