import type { AlsCharacterSnapshot } from './AlsCharacterSnapshot'
import { unwindDegrees } from './State/AlsLocomotionState'

export interface AlsSnapshotBufferOptions {
  interpolationDelayMs?: number
  maxExtrapolationMs?: number
  capacity?: number
}

export interface AlsSnapshotFrame {
  state: AlsCharacterSnapshot
  /** Every newly crossed, received action, even when one render crosses several packets. */
  actions: AlsCharacterSnapshot[]
  playbackTime: number
}

/** ORIGINAL transport policy, independent of ALS's authored animation graph. One buffer per
 * actor/lifetime. Call reset on respawn/clock epoch change; never share between consumers.
 * Bounded history + monotonic playback prevent reordered/duplicate packets replaying actions.
 */
export class AlsSnapshotBuffer {
  readonly interpolationDelayMs: number
  readonly maxExtrapolationMs: number
  readonly capacity: number
  private snapshots: AlsCharacterSnapshot[] = []
  private playbackTime = -Infinity
  private actionSeq = -1

  constructor(options: AlsSnapshotBufferOptions = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? 125
    this.maxExtrapolationMs = options.maxExtrapolationMs ?? 100
    this.capacity = options.capacity ?? 256
    if (!Number.isFinite(this.interpolationDelayMs) || this.interpolationDelayMs < 0
      || !Number.isFinite(this.maxExtrapolationMs) || this.maxExtrapolationMs < 0
      || !Number.isInteger(this.capacity) || this.capacity < 2) {
      throw new Error('Invalid ALS snapshot buffer options')
    }
  }

  get size() { return this.snapshots.length }

  reset() {
    this.snapshots = []
    this.playbackTime = -Infinity
    this.actionSeq = -1
  }

  push(snapshot: AlsCharacterSnapshot): boolean {
    const numbers = [snapshot.t, ...snapshot.pos, ...snapshot.vel,
      snapshot.actorYaw, snapshot.viewYaw, snapshot.viewPitch,
      snapshot.seq, snapshot.actionSeq]
    if (numbers.some((value) => !Number.isFinite(value))) return false
    const frames = this.snapshots
    const index = frames.findIndex((frame) => frame.t >= snapshot.t)
    if (index >= 0 && frames[index].t === snapshot.t) return false
    // Keep the freshest late packet as the interpolation anchor during starvation, but never
    // roll the rendered clock back. Already-consumed action sequences are ignored by sample().
    if (frames.length && snapshot.t < frames[0].t && snapshot.t <= this.playbackTime) return false
    const copy = structuredClone(snapshot)
    if (index < 0) frames.push(copy)
    else frames.splice(index, 0, copy)
    if (frames.length > this.capacity) frames.splice(0, frames.length - this.capacity)
    return true
  }

  sample(now: number): AlsSnapshotFrame | null {
    if (!Number.isFinite(now) || !this.snapshots.length) return null
    const target = Math.max(this.playbackTime, now - this.interpolationDelayMs)
    const frames = this.snapshots
    if (target < frames[0].t) return null
    this.playbackTime = target
    const actions: AlsCharacterSnapshot[] = []
    let index = 0
    for (let i = 0; i < frames.length && frames[i].t <= target; i++) {
      index = i
      const frame = frames[i]
      if (frame.actionSeq > this.actionSeq) {
        this.actionSeq = frame.actionSeq
        if (frame.action !== 'none') actions.push(structuredClone(frame))
      }
    }
    const a = frames[index]
    const b = frames[index + 1]
    const state = structuredClone(a)
    state.t = target
    if (b) {
      const alpha = (target - a.t) / (b.t - a.t)
      for (let axis = 0; axis < 3; axis++) {
        state.pos[axis] += (b.pos[axis] - a.pos[axis]) * alpha
        state.vel[axis] += (b.vel[axis] - a.vel[axis]) * alpha
      }
      // For rotations about a single yaw axis, this is exactly shortest-path quaternion slerp.
      state.actorYaw = unwindDegrees(a.actorYaw + unwindDegrees(b.actorYaw - a.actorYaw) * alpha)
      state.viewYaw = unwindDegrees(a.viewYaw + unwindDegrees(b.viewYaw - a.viewYaw) * alpha)
      state.viewPitch = a.viewPitch + (b.viewPitch - a.viewPitch) * alpha
      if (state.animation?.rolling && b.animation?.rolling
        && a.actionSeq === b.actionSeq) {
        state.animation.rolling.position +=
          (b.animation.rolling.position - state.animation.rolling.position) * alpha
      }
      if (state.animation?.mantle && b.animation?.mantle
        && a.actionSeq === b.actionSeq) {
        state.animation.mantle.position +=
          (b.animation.mantle.position - state.animation.mantle.position) * alpha
      }
    } else {
      const seconds = Math.min(target - a.t, this.maxExtrapolationMs) / 1000
      for (let axis = 0; axis < 3; axis++) state.pos[axis] += a.vel[axis] * seconds
      if (state.animation?.rolling) {
        state.animation.rolling.position += seconds * state.animation.rolling.playRate
      }
      // Freeze animation locomotion too after starvation; never invent gravity or actions.
      if (target - a.t > this.maxExtrapolationMs) state.vel = [0, 0, 0]
    }
    if (index > 0) frames.splice(0, index)
    return { state, actions, playbackTime: target }
  }
}
