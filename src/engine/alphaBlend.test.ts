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

  it('keeps Cubic distinct from HermiteCubic', () => {
    expect(alphaToBlendOption(0.5, 'Cubic')).toBe(0.125)
    expect(alphaToBlendOption(0.5, 'HermiteCubic')).toBe(0.5)
  })

  it('matches the symmetric quadratic in/out curve', () => {
    expect(alphaToBlendOption(0.25, 'QuadraticInOut')).toBe(0.125)
    expect(alphaToBlendOption(0.5, 'QuadraticInOut')).toBe(0.5)
    expect(alphaToBlendOption(0.75, 'QuadraticInOut')).toBe(0.875)
  })
})
