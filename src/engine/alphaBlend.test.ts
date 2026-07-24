import { describe, expect, it } from 'vitest'
import { alphaToBlendOption } from './alphaBlend'

describe('Unreal alpha blend options used by ALS', () => {
  it('clamps every option at the input boundary', () => {
    for (const option of [
      'Linear',
      'Cubic',
      'HermiteCubic',
      'QuadraticInOut',
    ] as const) {
      expect(alphaToBlendOption(-1, option)).toBe(0)
      expect(alphaToBlendOption(2, option)).toBe(1)
    }
  })

  it('matches Unreal CubicInterp and SmoothStep for Cubic and HermiteCubic', () => {
    for (const alpha of [0.25, 0.5, 0.75]) {
      const smoothStep = alpha * alpha * (3 - 2 * alpha)
      expect(alphaToBlendOption(alpha, 'Cubic')).toBe(smoothStep)
      expect(alphaToBlendOption(alpha, 'HermiteCubic')).toBe(smoothStep)
    }
  })

  it('matches the symmetric quadratic in/out curve', () => {
    expect(alphaToBlendOption(0.25, 'QuadraticInOut')).toBe(0.125)
    expect(alphaToBlendOption(0.5, 'QuadraticInOut')).toBe(0.5)
    expect(alphaToBlendOption(0.75, 'QuadraticInOut')).toBe(0.875)
  })
})
