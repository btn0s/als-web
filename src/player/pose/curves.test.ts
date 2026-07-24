import { describe, expect, it } from 'vitest'
import {
  beginCurveFrame,
  blendCurveValue,
  compileClipCurveSamplers,
  createCurveFrame,
  createKeyframedScalarCurve,
  resolvePoseGaitAmounts,
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

  it('compiles GLB extras keys and samples them linearly regardless of interpolation metadata', () => {
    const samplers = compileClipCurveSamplers({
      userData: {
        alsCurves: [{
          name: 'PoseGait',
          keys: [[0, 1, 0], [1, 3, 1]],
        }],
      },
    })
    expect(samplers.PoseGait(0.25)).toBeCloseTo(1.5)
  })

  it('blends authored samples and semantic fallbacks by active graph weight', () => {
    const frame = createCurveFrame()
    sampleClipCurves(frame, 'run', { PoseGait: () => 2 }, 0)
    expect(blendCurveValue(frame, 'PoseGait', [
      { clipKey: 'run', weight: 0.75, fallback: 2 },
      { clipKey: 'idle-without-curves', weight: 0.25, fallback: 0 },
    ])).toBeCloseTo(1.5)
  })

  it('segments PoseGait with ALS walking/running/sprinting overlapping ramps', () => {
    expect(resolvePoseGaitAmounts(2.5)).toEqual({
      amount: 2.5,
      walking: 1,
      running: 1,
      sprinting: 0.5,
    })
  })
})
