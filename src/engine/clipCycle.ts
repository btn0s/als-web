import type { AnimationClip } from 'three'

/** A cyclic view of a clip exported with a terminal hold for non-looping playback.
 * The caller supplies the last authored sample time; no timing is inferred from resampling. */
export function createClipCycle(clip: AnimationClip, lastSampleTime: number): AnimationClip {
  if (!Number.isFinite(lastSampleTime) || lastSampleTime < 0 || lastSampleTime >= clip.duration) {
    throw new Error('Invalid cyclic clip last sample time')
  }
  const cycle = clip.clone()
  for (const track of cycle.tracks) {
    if (track.times.length <= 1) continue
    const size = track.getValueSize()
    let last = track.times.length - 1
    while (last > 0 && track.times[last] > lastSampleTime + 1e-5) last--
    if (Math.abs(track.times[last] - lastSampleTime) > 1e-5) {
      throw new Error(`Missing cyclic clip last authored sample: ${track.name}`)
    }
    const times = new Float32Array(last + 2)
    const values = new Float32Array((last + 2) * size)
    times.set(track.times.subarray(0, last + 1))
    values.set(track.values.subarray(0, (last + 1) * size))
    times[last + 1] = clip.duration
    values.set(track.values.subarray(0, size), (last + 1) * size)
    track.times = times
    track.values = values
  }
  return cycle
}
