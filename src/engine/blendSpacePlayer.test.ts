import { describe, expect, it } from 'vitest'
import {
  calculateBlendSpaceEffectiveLength,
  calculateBlendSpaceNormalizedPlayRate,
  initializeBlendSpaceMarkerLeaderTime,
  resolveBlendSpaceSampleTime,
  resolveBlendSpacePlayerPhase,
  selectBlendSpaceMarkerLeader,
  synchronizeBlendSpaceSampleTimes,
} from './blendSpacePlayer'
import type {
  BlendSpacePlaybackSample,
  BlendSpacePlaybackSampleState,
} from './blendSpacePlayer'

const markers = [
  { name: 'Left', normalizedTime: 0.1 },
  { name: 'Right', normalizedTime: 0.6 },
] as const

function sample(
  weight: number,
  duration: number,
  combinedRateScale = 1,
  syncMarkers: BlendSpacePlaybackSample['markers'] = markers,
): BlendSpacePlaybackSample {
  return {
    weight,
    duration,
    combinedRateScale,
    markers: syncMarkers,
  }
}

describe('UE BlendSpace player playback', () => {
  it('calculates the weighted source length without applying node PlayRate', () => {
    expect(calculateBlendSpaceEffectiveLength([
      sample(0.25, 1.2),
      sample(0.75, 0.8),
    ])).toBeCloseTo(0.9, 12)
    expect(calculateBlendSpaceEffectiveLength([
      sample(0.5, 1.2, 2),
      sample(0.5, 0.8, 0.5),
    ])).toBeCloseTo(1.1, 12)
  })

  it('ignores zero-weight cache entries and renormalizes retained weights', () => {
    expect(calculateBlendSpaceEffectiveLength([
      sample(0.5, 1.2),
      sample(0.5, 0.8),
      sample(0, 100),
    ])).toBeCloseTo(1, 12)
  })

  it('selects the highest-weight marker-capable source with stable ties', () => {
    expect(selectBlendSpaceMarkerLeader([
      sample(0.4, 1, 1, []),
      sample(0.3, 1),
      sample(0.3, 1),
    ])).toBe(1)
    expect(selectBlendSpaceMarkerLeader([sample(1, 1, 1, [])])).toBe(-1)
  })

  it('converts node rate through the marker leader or weighted length', () => {
    const leader = sample(1, 0.8, 1.25)
    expect(calculateBlendSpaceNormalizedPlayRate(1.2, 1, leader))
      .toBeCloseTo(1.875, 12)
    expect(calculateBlendSpaceNormalizedPlayRate(1.2, 0.9))
      .toBeCloseTo(4 / 3, 12)
  })

  it('maps markerless samples from normalized phase and reverses negative rates', () => {
    expect(resolveBlendSpaceSampleTime(0.25, 0.8, 1)).toBeCloseTo(0.2, 12)
    expect(resolveBlendSpaceSampleTime(0.25, 0.8, -1)).toBeCloseTo(0.6, 12)
    expect(resolveBlendSpaceSampleTime(1.25, 0.8, 1)).toBeCloseTo(0.2, 12)
  })

  it('hands the player phase over from each source retained marker clock', () => {
    const walk: BlendSpacePlaybackSampleState = {
      ...sample(0.51, 1.2, 1, [
        { name: 'Left', normalizedTime: 0.1 },
        { name: 'Right', normalizedTime: 0.6 },
      ]),
      time: 0.48,
      previousTime: 0.48,
    }
    const run: BlendSpacePlaybackSampleState = {
      ...sample(0.49, 0.8, 1, [
        { name: 'Left', normalizedTime: 0.2 },
        { name: 'Right', normalizedTime: 0.8 },
      ]),
      time: 0,
      previousTime: 0,
    }
    const samples = [walk, run]

    expect(selectBlendSpaceMarkerLeader(samples)).toBe(0)
    expect(resolveBlendSpacePlayerPhase(samples, 0, 0)).toBeCloseTo(0.4, 12)
    expect(synchronizeBlendSpaceSampleTimes(0.4, walk.markers, samples)).toBe(true)
    expect(run.time / run.duration).toBeCloseTo(0.56, 12)

    walk.weight = 0.49
    run.weight = 0.51
    expect(selectBlendSpaceMarkerLeader(samples)).toBe(1)
    expect(resolveBlendSpacePlayerPhase(samples, 1, 0.4)).toBeCloseTo(0.56, 12)
  })

  it('initializes a newly active leader from the previous marker context', () => {
    const walk: BlendSpacePlaybackSampleState = {
      ...sample(0.49, 1.2, 1, [
        { name: 'Left', normalizedTime: 0.1 },
        { name: 'Right', normalizedTime: 0.6 },
      ]),
      time: 0.48,
      previousTime: 0.48,
    }
    const run: BlendSpacePlaybackSampleState = {
      ...sample(0.51, 0.8, 1, [
        { name: 'Left', normalizedTime: 0.2 },
        { name: 'Right', normalizedTime: 0.8 },
      ]),
      // A source omitted from the prior FBlendSampleData cache has no usable retained clock.
      time: 0.01,
      previousTime: 0.01,
    }
    const samples = [walk, run]

    synchronizeBlendSpaceSampleTimes(0.4, walk.markers, samples)

    expect(run.time / run.duration).toBeCloseTo(0.56, 12)
    expect(resolveBlendSpacePlayerPhase(
      samples,
      selectBlendSpaceMarkerLeader(samples),
      0.4,
    )).toBeCloseTo(0.56, 12)
  })

  it('uses normalized StartPosition on first relevance, not representative markers', () => {
    const walk: BlendSpacePlaybackSampleState = {
      ...sample(0, 1.2, 1, [
        { name: 'Left', normalizedTime: 0.1 },
        { name: 'Right', normalizedTime: 0.6 },
      ]),
      time: 0.24,
      previousTime: 0.24,
    }
    const run: BlendSpacePlaybackSampleState = {
      ...sample(1, 0.8, 1, [
        { name: 'Left', normalizedTime: 0.2 },
        { name: 'Right', normalizedTime: 0.8 },
      ]),
      time: 0.01,
      previousTime: 0.01,
    }
    const samples = [walk, run]
    const leaderIndex = selectBlendSpaceMarkerLeader(samples)

    initializeBlendSpaceMarkerLeaderTime(samples, leaderIndex, 0.2)

    expect(run.time / run.duration).toBeCloseTo(0.2, 12)
    expect(resolveBlendSpacePlayerPhase(samples, leaderIndex, 0))
      .toBeCloseTo(0.2, 12)
  })

  it('freezes inactive internal source clocks', () => {
    const inactive: BlendSpacePlaybackSampleState = {
      ...sample(0, 0.8),
      time: 0.37,
      previousTime: 0.21,
    }

    synchronizeBlendSpaceSampleTimes(0.7, markers, [inactive])

    expect(inactive.time).toBe(0.37)
    expect(inactive.previousTime).toBe(0.21)
  })
})
