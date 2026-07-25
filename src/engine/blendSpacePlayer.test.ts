import { describe, expect, it } from 'vitest'
import {
  calculateBlendSpaceEffectiveLength,
  calculateBlendSpaceNormalizedPlayRate,
  BlendSpacePlayer,
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
  it('initializes first relevance at the node normalized StartPosition', () => {
    const player = new BlendSpacePlayer({ id: 'WalkRunForward', startPosition: 0.2 })
    const result = player.update({
      relevant: true,
      nodePlayRate: 1,
      samples: [{ ...sample(1, 0.8), id: 'forward-run' }],
    })

    expect(result.syncMember.time).toBeCloseTo(0.2, 12)
    expect(result.samples[0].time).toBeCloseTo(0.16, 12)
  })

  it('keys source clocks by owning BlendSpace sample/player, not shared clip identity', () => {
    const first = new BlendSpacePlayer({ id: 'DirectionA', startPosition: 0.2 })
    const second = new BlendSpacePlayer({ id: 'DirectionB', startPosition: 0.7 })
    const sharedClip = { ...sample(1, 1, 1, []), id: 'sample-using-RunForward' }

    first.update({ relevant: true, nodePlayRate: 1, samples: [sharedClip] })
    second.update({ relevant: true, nodePlayRate: 1, samples: [sharedClip] })
    first.advance(0.1)

    expect(first.resolveOuterSync().samples[0].time).toBeCloseTo(0.3, 12)
    expect(second.resolveOuterSync().samples[0].time).toBeCloseTo(0.7, 12)
  })

  it('uses a stable internal marker leader and remaps samples after outer sync', () => {
    const player = new BlendSpacePlayer({ id: 'Movement', startPosition: 0.2 })
    const result = player.update({
      relevant: true,
      nodePlayRate: 1.2,
      samples: [
        {
          ...sample(0.5, 1.2, 1, [
            { name: 'Left', normalizedTime: 0.1 },
            { name: 'Right', normalizedTime: 0.6 },
          ]),
          id: 'walk',
        },
        {
          ...sample(0.5, 0.8, 1.25, [
            { name: 'Left', normalizedTime: 0.2 },
            { name: 'Right', normalizedTime: 0.8 },
          ]),
          id: 'run',
        },
      ],
    })
    // Exact-weight ties retain the first selected source, and its authored source rate drives
    // the outer node rather than the weighted markerless length.
    expect(result.markerLeaderId).toBe('walk')
    expect(result.syncMember.playRate).toBeCloseTo(1, 12)
    result.syncMember.time = 0.4

    const resolved = player.resolveOuterSync()
    expect(resolved.samples.find((entry) => entry.id === 'walk')?.time)
      .toBeCloseTo(0.48, 12)
    expect(resolved.samples.find((entry) => entry.id === 'run')?.time)
      .toBeCloseTo(0.448, 12)
  })

  it('maps a newly elected leader through the prior outer marker context before phase handoff', () => {
    const player = new BlendSpacePlayer({ id: 'Movement', startPosition: 0.2 })
    const walk = {
      ...sample(1, 1.2, 1, [
        { name: 'Left', normalizedTime: 0.1 },
        { name: 'Right', normalizedTime: 0.6 },
      ]),
      id: 'walk',
    }
    const run = {
      ...sample(0, 0.8, 1, [
        { name: 'Left', normalizedTime: 0.2 },
        { name: 'Right', normalizedTime: 0.8 },
      ]),
      id: 'run',
    }
    player.update({ relevant: true, nodePlayRate: 1, samples: [walk, run] })
    player.syncMember.time = 0.4 // 60% from Walk Left (.1) to Right (.6).

    const crossed = player.update({
      relevant: true,
      nodePlayRate: 1,
      samples: [{ ...walk, weight: 0.49 }, { ...run, weight: 0.51 }],
    })

    expect(crossed.markerLeaderId).toBe('run')
    // The same physical marker interval is 56% through Run's .2 -> .8 interval, not its
    // dormant zero clock. This becomes the next outer SyncGroup phase.
    expect(crossed.syncMember.time).toBeCloseTo(0.56, 12)
    expect(crossed.samples.find((entry) => entry.id === 'run')?.time)
      .toBeCloseTo(0.448, 12)
  })

  it('uses weighted effective length for markerless outer playback', () => {
    const player = new BlendSpacePlayer({ id: 'Markerless', startPosition: 0.2 })
    const result = player.update({
      relevant: true,
      nodePlayRate: 1.2,
      samples: [
        { ...sample(0.25, 1.2, 1, []), id: 'walk' },
        { ...sample(0.75, 0.8, 1, []), id: 'run' },
      ],
    })

    expect(result.markerLeaderId).toBeNull()
    expect(result.syncMember.playRate).toBeCloseTo(4 / 3, 12)
    player.advance(0.15)
    expect(player.resolveOuterSync().samples.map((entry) => entry.time))
      .toEqual(expect.arrayContaining([
        expect.closeTo(0.48, 12),
        expect.closeTo(0.32, 12),
      ]))
  })

  it('resets to StartPosition when relevance is lost and regained', () => {
    const player = new BlendSpacePlayer({ id: 'Resettable', startPosition: 0.2 })
    const source = { ...sample(1, 1, 1, []), id: 'run' }
    player.update({ relevant: true, nodePlayRate: 1, samples: [source] })
    player.advance(0.4)
    player.update({ relevant: false, nodePlayRate: 1, samples: [] })
    const reentered = player.update({ relevant: true, nodePlayRate: 1, samples: [source] })

    expect(reentered.syncMember.time).toBeCloseTo(0.2, 12)
    expect(reentered.samples[0].time).toBeCloseTo(0.2, 12)
  })

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
