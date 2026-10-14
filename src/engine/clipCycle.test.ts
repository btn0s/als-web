import { describe, expect, it } from 'vitest'
import { AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack } from 'three'
import { createClipCycle } from './clipCycle'

describe('explicit cyclic clip view', () => {
  it('replaces only the terminal hold and preserves the canonical nonloop clip', () => {
    const source = new AnimationClip('move', 1, [new VectorKeyframeTrack('root.position', [0, 0.5, 0.75, 1], [0, 0, 0, 2, 0, 0, 2, 0, 0, 2, 0, 0])])
    const cycle = createClipCycle(source, 0.5)
    expect([...cycle.tracks[0].times]).toEqual([0, 0.5, 1])
    expect([...cycle.tracks[0].values]).toEqual([0, 0, 0, 2, 0, 0, 0, 0, 0])
    expect([...source.tracks[0].times]).toEqual([0, 0.5, 0.75, 1])
    expect(source.tracks[0].values[9]).toBe(2)
    expect(cycle.duration).toBe(1)
    expect(cycle.name).toBe('move')
  })
  it('preserves constant tracks and quaternion sample width and interpolation', () => {
    const source = new AnimationClip('move', 1, [
      new VectorKeyframeTrack('root.position', [0], [1, 2, 3]),
      new QuaternionKeyframeTrack('root.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0]),
    ])
    const cycle = createClipCycle(source, 0.5)
    expect([...cycle.tracks[0].values]).toEqual([1, 2, 3])
    expect([...cycle.tracks[1].values.slice(-4)]).toEqual([0, 0, 0, 1])
    expect(cycle.tracks[1].getInterpolation()).toBe(source.tracks[1].getInterpolation())
  })
  it('rejects a guessed endpoint absent from the exported samples', () => {
    const source = new AnimationClip('move', 1, [new VectorKeyframeTrack('root.position', [0, 0.5, 1], [0, 0, 0, 2, 0, 0, 2, 0, 0])])
    expect(() => createClipCycle(source, 0.4)).toThrow('Missing cyclic clip last authored sample')
    expect(() => createClipCycle(source, 1)).toThrow('Invalid cyclic clip last sample time')
  })
})
