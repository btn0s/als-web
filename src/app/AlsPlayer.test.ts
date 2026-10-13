import { describe, expect, it } from 'vitest'
import { createAlsPlayer } from './AlsPlayer'

describe('AlsPlayer', () => {
  it('preserves command identity while respawn replaces the pose and notifies subscribers', () => {
    const player = createAlsPlayer({ spawn: [1, 2, 3] })
    const command = player.command
    const pose = player.pose.current
    const revisions: number[] = []
    const unsubscribe = player.subscribe(() => revisions.push(player.getRevision()))
    player.command.forward = 1
    player.command.aim = true
    player.ragdoll()
    expect(player.command.ragdollSequence).toBe(1)
    player.respawn([4, 5, 6])
    expect(player.command).toBe(command)
    expect(player.pose.current).not.toBe(pose)
    expect(player.spawn).toEqual([4, 5, 6])
    expect(player.command).toMatchObject({ forward: 0, aim: false, ragdollSequence: 0 })
    expect(revisions).toEqual([1])
    unsubscribe()
    player.respawn()
    expect(revisions).toEqual([1])
    expect(player.spawn).toEqual([4, 5, 6])
  })

  it('rejects nonfinite spawn positions without changing the current player', () => {
    expect(() => createAlsPlayer({ spawn: [0, Number.NaN, 0] })).toThrow()
    const player = createAlsPlayer()
    expect(() => player.respawn([0, Infinity, 0])).toThrow()
    expect(player.getRevision()).toBe(0)
    expect(player.spawn).toEqual([0, 0, 0])
  })
})
