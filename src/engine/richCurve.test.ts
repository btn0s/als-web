import { describe, expect, it } from 'vitest'
import { sampleRichCurve } from './richCurve'

describe('sampleRichCurve', () => {
  it('clamps outside the authored key range', () => {
    const keys = [
      { time: 1, value: 4, interpolation: 'linear' as const },
      { time: 2, value: 8, interpolation: 'linear' as const },
    ]
    expect(sampleRichCurve(keys, -10)).toBe(4)
    expect(sampleRichCurve(keys, 10)).toBe(8)
  })

  it('uses the previous key interpolation mode for a segment', () => {
    const keys = [
      { time: 0, value: 2, interpolation: 'constant' as const },
      { time: 1, value: 4, interpolation: 'linear' as const },
      { time: 2, value: 8, interpolation: 'linear' as const },
    ]
    expect(sampleRichCurve(keys, 0.5)).toBe(2)
    expect(sampleRichCurve(keys, 1.5)).toBe(6)
  })

  it('matches Unreal unweighted cubic Hermite tangent scaling', () => {
    const keys = [
      {
        time: 2,
        value: 2_000,
        interpolation: 'cubic' as const,
        leaveTangent: -3_642.372,
      },
      {
        time: 3,
        value: 750,
        interpolation: 'linear' as const,
        arriveTangent: 0,
      },
    ]
    expect(sampleRichCurve(keys, 2.5)).toBeCloseTo(919.7035, 4)
  })
})
