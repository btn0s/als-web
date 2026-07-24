import { describe, expect, it } from 'vitest'
import {
  advanceSyncGroup,
  createSyncGroup,
  electSyncGroupLeader,
} from './syncGroups'
import type { SyncGroupMember } from './syncGroups'

function member(
  id: string,
  weight: number,
  duration = 1,
  markers: SyncGroupMember['markers'] = [],
): SyncGroupMember {
  return { id, duration, markers, time: 0, weight, playRate: 1 }
}

describe('sync groups', () => {
  it('elects the highest blend-weight member as leader', () => {
    const walk = member('walk', 0.35)
    const run = member('run', 0.65)
    expect(electSyncGroupLeader([walk, run])).toBe(run)
    expect(electSyncGroupLeader([walk, { ...run, canLead: false }])).toBe(walk)
  })

  it('uses the first active follower when every active member is Always Follower', () => {
    const first = { ...member('rifleRun', 0.25), canLead: false }
    const second = { ...member('rifleSprint', 0.75), canLead: false }

    expect(electSyncGroupLeader([first, second])).toBe(first)
  })

  it('maps follower phase between matching markers with asymmetric layouts', () => {
    const leader = member('walk', 0.75, 1, [
      { name: 'Left', normalizedTime: 0.1 },
      { name: 'Right', normalizedTime: 0.6 },
    ])
    const follower = member('run', 0.25, 2, [
      { name: 'Left', normalizedTime: 0.2 },
      { name: 'Right', normalizedTime: 0.8 },
    ])
    leader.time = 0.35
    leader.playRate = 0
    const result = advanceSyncGroup(createSyncGroup('Locomotion', [leader, follower]), 0)

    expect(result.leader).toBe(leader)
    expect(result.usedMarkerSync).toBe(true)
    expect(follower.time / follower.duration).toBeCloseTo(0.5)
  })

  it('syncs a full cycle from a single common marker name', () => {
    const leader = member('leader', 0.75, 1, [
      { name: 'Left', normalizedTime: 0.1 },
    ])
    const follower = member('follower', 0.25, 1, [
      { name: 'Left', normalizedTime: 0.2 },
    ])
    leader.time = 0.6
    leader.playRate = 0

    const result = advanceSyncGroup(
      createSyncGroup('Movement', [leader, follower]),
      0,
    )

    expect(result.usedMarkerSync).toBe(true)
    expect(follower.time).toBeCloseTo(0.7)
  })

  it('length-syncs a markerless follower without disabling marker sync for marked members', () => {
    const leader = member('walk', 0.6, 1, [
      { name: 'Left', normalizedTime: 0.1 },
      { name: 'Right', normalizedTime: 0.6 },
    ])
    const markedFollower = member('run', 0.3, 2, [
      { name: 'Left', normalizedTime: 0.2 },
      { name: 'Right', normalizedTime: 0.8 },
    ])
    const markerlessFollower = member('rifleSprintImpulse', 0.1, 1)
    leader.time = 0.35
    leader.playRate = 0

    const result = advanceSyncGroup(
      createSyncGroup('Movement', [
        leader,
        markedFollower,
        markerlessFollower,
      ]),
      0,
    )

    expect(result.usedMarkerSync).toBe(true)
    expect(markedFollower.time / markedFollower.duration).toBeCloseTo(0.5)
    expect(markerlessFollower.time).toBeCloseTo(0.35)
  })

  it('keeps a zero-weight candidate phase-ready without including it in marker validity', () => {
    const leader = member('walk', 0.7, 1, [
      { name: 'Left', normalizedTime: 0.1 },
      { name: 'Right', normalizedTime: 0.6 },
    ])
    const follower = member('run', 0.3, 1, [
      { name: 'Left', normalizedTime: 0.2 },
      { name: 'Right', normalizedTime: 0.8 },
    ])
    const inactive = member('markerlessCandidate', 0, 2)
    leader.time = 0.35
    leader.playRate = 0

    const result = advanceSyncGroup(
      createSyncGroup('Movement', [leader, follower, inactive]),
      0,
    )

    expect(result.usedMarkerSync).toBe(true)
    expect(follower.time).toBeCloseTo(0.5)
    expect(inactive.time).toBeCloseTo(0.7)
  })

  it('falls back to normalized-time sync for markerless same-length cycles', () => {
    const leader = member('walkForward', 0.6, 1)
    const follower = member('walkBackward', 0.4, 1)
    leader.time = 0.42
    leader.playRate = 0
    const result = advanceSyncGroup(createSyncGroup('Locomotion', [leader, follower]), 0)

    expect(result.usedMarkerSync).toBe(false)
    expect(follower.time).toBeCloseTo(0.42)
  })

  it('wraps reverse leader playback into the clip range', () => {
    const leader = member('leader', 1, 1)
    const follower = member('follower', 0.5, 2)
    leader.time = 0.1
    leader.playRate = -1

    advanceSyncGroup(createSyncGroup('Movement', [leader, follower]), 0.25)

    expect(leader.time).toBeCloseTo(0.85)
    expect(follower.time).toBeCloseTo(1.7)
  })
})
