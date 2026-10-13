import { describe, expect, it } from 'vitest'
import { AlsSnapshotBuffer } from './AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from './AlsCharacterSnapshot'

function snapshot(t: number, patch: Partial<AlsCharacterSnapshot> = {}): AlsCharacterSnapshot {
  return { t, pos: [t / 100, 1, 0], vel: [10, 0, 0], actorYaw: 0, viewYaw: 0,
    viewPitch: 0, gait: 'walking', stance: 'standing', rotationMode: 'viewDirection',
    locomotionMode: 'grounded', action: 'none', actionSeq: 0, overlay: 'default',
    aiming: false, seq: t, ...patch }
}

describe('AlsSnapshotBuffer', () => {
  it('orders arrivals, rejects duplicates, and waits for the delayed first timestamp', () => {
    const buffer = new AlsSnapshotBuffer()
    buffer.push(snapshot(100)); buffer.push(snapshot(0)); buffer.push(snapshot(50))
    expect(buffer.push(snapshot(50))).toBe(false)
    expect(buffer.sample(124)).toBeNull()
    const frame = buffer.sample(150)!
    expect(frame.playbackTime).toBe(25)
    expect(frame.state.pos).toEqual([0.25, 1, 0])
  })
  it('lerps velocity and pitch but steps discrete tags at the boundary', () => {
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0 })
    buffer.push(snapshot(0))
    buffer.push(snapshot(100, { vel: [20, 2, 4], viewPitch: 60, gait: 'sprinting',
      stance: 'crouching', overlay: 'rifle', aiming: true, locomotionMode: 'inAir' }))
    expect(buffer.sample(50)!.state).toMatchObject({ vel: [15, 1, 2], viewPitch: 30,
      gait: 'walking', stance: 'standing', overlay: 'default', aiming: false })
    expect(buffer.sample(100)!.state).toMatchObject({ gait: 'sprinting', stance: 'crouching',
      overlay: 'rifle', aiming: true, locomotionMode: 'inAir' })
  })
  it('takes the shortest yaw path through both sides of the wrap', () => {
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0 })
    buffer.push(snapshot(0, { actorYaw: 170, viewYaw: -170 }))
    buffer.push(snapshot(100, { actorYaw: -170, viewYaw: 170 }))
    const state = buffer.sample(50)!.state
    expect(Math.abs(state.actorYaw)).toBe(180)
    expect(Math.abs(state.viewYaw)).toBe(180)
  })
  it('delivers crossed actions once per sequence even across render gaps and duplicate actions', () => {
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0 })
    buffer.push(snapshot(0))
    buffer.push(snapshot(100, { action: 'roll', actionSeq: 1 }))
    buffer.push(snapshot(150, { action: 'roll', actionSeq: 1 }))
    buffer.push(snapshot(200, { action: 'mantle', actionSeq: 2 }))
    buffer.push(snapshot(250, { action: 'none', actionSeq: 2 }))
    expect(buffer.sample(99)!.actions).toEqual([])
    expect(buffer.sample(260)!.actions.map((frame) => frame.action)).toEqual(['roll', 'mantle'])
    expect(buffer.sample(270)!.actions).toEqual([])
    expect(buffer.sample(120)!.playbackTime).toBe(270)
    expect(buffer.push(snapshot(100, { action: 'roll', actionSeq: 1 }))).toBe(false)
  })
  it('interpolates through packet gaps and bounds extrapolation during loss', () => {
    const buffer = new AlsSnapshotBuffer({ interpolationDelayMs: 0, maxExtrapolationMs: 100 })
    buffer.push(snapshot(0)); buffer.push(snapshot(1000))
    expect(buffer.sample(500)!.state.pos[0]).toBe(5)
    expect(buffer.sample(1050)!.state.pos[0]).toBe(10.5)
    const starved = buffer.sample(9000)!.state
    expect(starved.pos[0]).toBe(11)
    expect(starved.vel).toEqual([0, 0, 0])
    buffer.push(snapshot(8990, { action: 'roll', actionSeq: 1 }))
    expect(buffer.sample(9010)!.actions).toHaveLength(1)
    expect(buffer.sample(9020)!.actions).toHaveLength(0)
  })
  it('owns packet memory, bounds history, and resets clock/action epochs explicitly', () => {
    const buffer = new AlsSnapshotBuffer({ capacity: 2, interpolationDelayMs: 0 })
    const packet = snapshot(0)
    buffer.push(packet); packet.pos[0] = 999
    expect(buffer.sample(0)!.state.pos[0]).toBe(0)
    buffer.push(snapshot(10)); buffer.push(snapshot(20))
    expect(buffer.size).toBe(2)
    buffer.reset()
    expect(buffer.sample(0)).toBeNull()
    buffer.push(snapshot(0, { action: 'roll', actionSeq: 1 }))
    expect(buffer.sample(0)!.actions).toHaveLength(1)
  })
  it('rejects non-finite data and invalid configuration', () => {
    expect(() => new AlsSnapshotBuffer({ capacity: 1 })).toThrow()
    expect(() => new AlsSnapshotBuffer({ interpolationDelayMs: NaN })).toThrow()
    const buffer = new AlsSnapshotBuffer()
    expect(buffer.push(snapshot(NaN))).toBe(false)
    expect(buffer.push(snapshot(0, { actorYaw: Infinity }))).toBe(false)
    expect(buffer.sample(NaN)).toBeNull()
  })
})
