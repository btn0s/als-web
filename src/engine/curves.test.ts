import { describe, expect, it } from 'vitest'
import {
  accumulateAdditiveCurveValues,
  beginCurveFrame,
  blendCurveValue,
  compileClipCurveSamplers,
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

  it('compiles GLB extras keys and samples mode-0 segments linearly', () => {
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

  it('reconstructs the two-key cubic PoseCrouching ramp from GLB interpolation mode 2', () => {
    const samplers = compileClipCurveSamplers({
      userData: {
        alsCurves: [{
          name: 'PoseCrouching',
          keys: [[0, 0, 2], [0.833333, 1, 0]],
        }],
      },
    })
    const quarterTime = 0.833333 * 0.25
    expect(samplers.PoseCrouching(quarterTime)).toBeCloseTo(0.15625)
    expect(samplers.PoseCrouching(0.833333 * 0.5)).toBeCloseTo(0.5)
  })

  it('blends authored samples and semantic fallbacks by active graph weight', () => {
    const frame = createCurveFrame()
    sampleClipCurves(frame, 'run', { PoseGait: () => 2 }, 0)
    expect(blendCurveValue(frame, 'PoseGait', [
      { clipKey: 'run', weight: 0.75, fallback: 2 },
      { clipKey: 'idle-without-curves', weight: 0.25, fallback: 0 },
    ])).toBeCloseTo(1.5)
  })

  it('accumulates additive curve deltas without normalizing away their weights', () => {
    const frame = createCurveFrame()
    beginCurveFrame(frame)
    sampleClipCurves(frame, 'transition', {
      AllowTransitions: () => -1,
      FootLeftLock: () => -1,
      FootstepSoundBlock: () => 1,
    }, 0)
    sampleClipCurves(frame, 'secondary', {
      AllowTransitions: () => -0.25,
    }, 0)
    const output = new Map<string, number>([
      ['AllowTransitions', 1],
      ['FootLeftLock', 1],
    ])

    accumulateAdditiveCurveValues(frame, output, [
      { clipKey: 'transition', weight: 0.5 },
      { clipKey: 'secondary', weight: 0.4 },
      { clipKey: 'missing-curve-source', weight: 1 },
    ])

    expect(output.get('AllowTransitions')).toBeCloseTo(0.4)
    expect(output.get('FootLeftLock')).toBeCloseTo(0.5)
    expect(output.get('FootstepSoundBlock')).toBeCloseTo(0.5)
    expect(output.has('MissingCurve')).toBe(false)
  })

  it('ignores retained samples after their clip becomes inactive', () => {
    const frame = createCurveFrame()
    sampleClipCurves(frame, 'transition', { AllowTransitions: () => -1 }, 0)
    beginCurveFrame(frame)
    const output = new Map([['AllowTransitions', 1]])

    accumulateAdditiveCurveValues(frame, output, [
      { clipKey: 'transition', weight: 1 },
    ])

    expect(output.get('AllowTransitions')).toBe(1)
  })
})
