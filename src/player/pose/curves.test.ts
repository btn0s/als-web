import { describe, expect, it } from 'vitest'
import {
  beginCurveFrame,
  createCurveFrame,
  createKeyframedScalarCurve,
  sampleClipCurves,
} from './curves'

describe('float curves', () => {
  it('samples known keys and exposes stable per-clip frame values', () => {
    const frame = createCurveFrame()
    const footLock = createKeyframedScalarCurve([0, 0.5, 1], [0, 1, 0])

    beginCurveFrame(frame)
    sampleClipCurves(frame, 'walk', { FootLeftLock: footLock }, 0.25)

    expect(frame.byClip.get('walk')?.get('FootLeftLock')).toBeCloseTo(0.5)
    expect(frame.activeClips.has('walk')).toBe(true)
    const values = frame.byClip.get('walk')
    beginCurveFrame(frame)
    expect(frame.byClip.get('walk')).toBe(values)
    expect(frame.activeClips.size).toBe(0)
  })
})
