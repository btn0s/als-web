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

  it('maps follower phase between matching markers with asymmetric layouts', () => {
    const leader = member('walk', 0.75, 1, [
      { name: 'LeftFoot', normalizedTime: 0.1 },
      { name: 'RightFoot', normalizedTime: 0.6 },
    ])
    const follower = member('run', 0.25, 2, [
      { name: 'LeftFoot', normalizedTime: 0.2 },
      { name: 'RightFoot', normalizedTime: 0.8 },
    ])
    leader.time = 0.35
    leader.playRate = 0
    const result = advanceSyncGroup(createSyncGroup('Locomotion', [leader, follower]), 0)

    expect(result.leader).toBe(leader)
    expect(result.usedMarkerSync).toBe(true)
    expect(follower.time / follower.duration).toBeCloseTo(0.5)
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
})
