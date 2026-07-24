import { describe, expect, it } from 'vitest'
import {
  createAlsStandingState,
  refreshStandingMovement,
} from './AlsStandingState'

function sample(
  speed: number,
  gait: 'Walking' | 'Running' | 'Sprinting',
) {
  const gaitAmount = gait === 'Walking' ? 1 : gait === 'Running' ? 2 : 3
  return refreshStandingMovement(createAlsStandingState(), {
    speed,
    gait,
    unweightedGaitRunningAmount: Math.max(0, Math.min(1, gaitAmount - 1)),
    unweightedGaitSprintingAmount: Math.max(0, Math.min(1, gaitAmount - 2)),
  })
}

describe('RefreshStandingMovement', () => {
  it('plays each cycle at 1x at its C++ animated speed', () => {
    expect(sample(1.5, 'Walking').playRate).toBeCloseTo(1, 7)
    expect(sample(3.5, 'Running').playRate).toBeCloseTo(1, 7)
    expect(sample(6, 'Sprinting').playRate).toBeCloseTo(1, 7)
  })

  it('uses movement speed only as input, not as the clip animated-speed constant', () => {
    expect(sample(1.75, 'Walking').playRate).toBeCloseTo(1.75 / 1.5, 7)
    expect(sample(3.75, 'Running').playRate).toBeCloseTo(3.75 / 3.5, 7)
    expect(sample(6.5, 'Sprinting').playRate).toBeCloseTo(6.5 / 6, 7)
  })

  it('selects the authored walk/run BlendSpace row from the gait tag', () => {
    expect(sample(1, 'Walking').walkRunBlendAmount).toBe(0)
    expect(sample(1, 'Running').walkRunBlendAmount).toBe(1)
    expect(sample(1, 'Sprinting').walkRunBlendAmount).toBe(1)
  })

  it('retains the authored nonzero stride floor and clamps startup playback', () => {
    const stopped = sample(0, 'Walking')
    expect(stopped.strideBlendAmount).toBe(0.2)
    expect(stopped.playRate).toBe(1e-4)

    for (let frame = 1; frame <= 20; frame++) {
      expect(sample(frame / 3, 'Walking').playRate).toBeLessThanOrEqual(3)
    }
  })
})
