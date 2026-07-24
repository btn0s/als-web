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

function richCurveKey(
  time: number,
  value: number,
  interpolationMode: number,
  arriveTangent = 0,
  leaveTangent = 0,
) {
  return [
    time,
    value,
    interpolationMode,
    0,
    0,
    arriveTangent,
    0,
    leaveTangent,
    0,
  ]
}

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
          keys: [
            richCurveKey(0, 1, 0),
            richCurveKey(1, 3, 1),
          ],
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
          keys: [
            richCurveKey(0, 0, 2),
            richCurveKey(0.833333, 1, 0),
          ],
        }],
      },
    })
    const quarterTime = 0.833333 * 0.25
    expect(samplers.PoseCrouching(quarterTime)).toBeCloseTo(0.15625)
    expect(samplers.PoseCrouching(0.833333 * 0.5)).toBeCloseTo(0.5)
  })

  it('uses the authored arriving tangent for ALS landing curves', () => {
    const samplers = compileClipCurveSamplers({
      userData: {
        alsCurves: [{
          name: 'FootstepSoundBlock',
          keys: [
            richCurveKey(0, 1, 2),
            richCurveKey(0.5, -5.364418e-8, 2, -4.793421),
          ],
        }],
      },
    })
    expect(samplers.FootstepSoundBlock(0.25)).toBeCloseTo(
      0.79958878567791,
      8,
    )
  })

  it('rejects lossy or weighted curve metadata instead of approximating it', () => {
    expect(() => compileClipCurveSamplers({
      userData: {
        alsCurves: [{
          name: 'Lossy',
          keys: [[0, 1, 2]],
        }],
      },
    })).toThrow('does not retain all FRichCurveKey fields')

    const weightedKey = richCurveKey(0, 1, 2)
    weightedKey[4] = 3
    expect(() => compileClipCurveSamplers({
      userData: {
        alsCurves: [{
          name: 'Weighted',
          keys: [weightedKey],
        }],
      },
    })).toThrow('uses unsupported weighted tangents')
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
