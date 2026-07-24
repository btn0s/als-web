export interface SyncMarker {
  readonly name: string
  readonly normalizedTime: number
}

/** Injection seam for authored Animation Sync Markers once extraction includes them. */
export type SyncMarkerTable = Readonly<Record<string, readonly SyncMarker[]>>

export interface SyncGroupMember {
  readonly id: string
  readonly duration: number
  readonly markers: readonly SyncMarker[]
  /** UE's Never Leader role. Followers still participate in marker matching. */
  readonly canLead?: boolean
  time: number
  weight: number
  /** Conventional clip play rate. Only the elected leader advances independently. */
  playRate: number
}

export interface SyncGroup {
  readonly name: string
  readonly members: SyncGroupMember[]
  leaderId: string | null
}

export interface SyncGroupResult {
  readonly leader: SyncGroupMember | null
  readonly usedMarkerSync: boolean
}

function wrapNormalized(value: number) {
  return ((value % 1) + 1) % 1
}

function normalizedTime(member: SyncGroupMember) {
  return member.duration > 0 ? wrapNormalized(member.time / member.duration) : 0
}

export function createSyncGroup(
  name: string,
  members: SyncGroupMember[] = [],
): SyncGroup {
  return { name, members, leaderId: null }
}

/**
 * Epic's Sync Groups normally elect the highest-weight animation as Leader. Ties retain the
 * current leader to avoid a playhead authority flip caused only by array ordering.
 *
 * https://dev.epicgames.com/documentation/en-us/unreal-engine/sync-groups
 */
export function electSyncGroupLeader(
  members: readonly SyncGroupMember[],
  preferredLeaderId: string | null = null,
): SyncGroupMember | null {
  let leader: SyncGroupMember | null = null
  for (const member of members) {
    if (member.canLead === false || member.weight <= 0) continue
    if (
      !leader
      || member.weight > leader.weight
      || (
        member.weight === leader.weight
        && member.id === preferredLeaderId
      )
    ) {
      leader = member
    }
  }
  return leader
}

function commonMarkerNames(members: readonly SyncGroupMember[]) {
  const active = members.filter((member) => member.weight > 0)
  if (active.length < 2) return new Set<string>()
  const common = new Set(active[0].markers.map((marker) => marker.name))
  for (let i = 1; i < active.length; i++) {
    const names = new Set(active[i].markers.map((marker) => marker.name))
    for (const name of common) {
      if (!names.has(name)) common.delete(name)
    }
  }
  return common
}

function sortedCommonMarkers(
  member: SyncGroupMember,
  commonNames: ReadonlySet<string>,
) {
  return member.markers
    .filter((marker) => commonNames.has(marker.name))
    .map((marker) => ({
      name: marker.name,
      normalizedTime: wrapNormalized(marker.normalizedTime),
    }))
    .sort((a, b) => a.normalizedTime - b.normalizedTime)
}

function leaderMarkerPhase(
  leader: SyncGroupMember,
  commonNames: ReadonlySet<string>,
) {
  const markers = sortedCommonMarkers(leader, commonNames)
  if (markers.length < 2) return null
  const phase = normalizedTime(leader)
  let previousIndex = markers.length - 1
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].normalizedTime <= phase) previousIndex = i
    else break
  }
  const previous = markers[previousIndex]
  const next = markers[(previousIndex + 1) % markers.length]
  const previousTime = previous.normalizedTime
  const nextTime = next.normalizedTime + (previousIndex === markers.length - 1 ? 1 : 0)
  const phaseTime = phase + (phase < previousTime ? 1 : 0)
  const span = nextTime - previousTime
  return {
    previousName: previous.name,
    nextName: next.name,
    alpha: span > 0 ? (phaseTime - previousTime) / span : 0,
  }
}

function followerMarkerPair(
  follower: SyncGroupMember,
  previousName: string,
  nextName: string,
) {
  const markers = follower.markers
    .map((marker) => ({
      name: marker.name,
      normalizedTime: wrapNormalized(marker.normalizedTime),
    }))
    .sort((a, b) => a.normalizedTime - b.normalizedTime)
  let best: { previous: number; next: number } | null = null
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].name !== previousName) continue
    for (let step = 1; step <= markers.length; step++) {
      const next = markers[(i + step) % markers.length]
      if (next.name !== nextName) continue
      const nextTime = next.normalizedTime + (i + step >= markers.length ? 1 : 0)
      const candidate = { previous: markers[i].normalizedTime, next: nextTime }
      if (!best || candidate.next - candidate.previous < best.next - best.previous) {
        best = candidate
      }
      break
    }
  }
  return best
}

/**
 * Maps a follower to the Leader's relative position between the same pair of common markers.
 * Without two common markers, normalized time is the documented derived fallback. It is exact for
 * same-length, same-boundary cycles; for the current markerless ALS GLB it is intentionally also
 * used as UE's scaled-length approximation until authored foot markers are extracted.
 *
 * Epic semantics: only common markers participate, the Leader drives followers, and followers
 * preserve the Leader's relative position between its previous/next marker pair.
 * https://dev.epicgames.com/documentation/en-us/unreal-engine/sync-groups
 */
export function mapFollowerTime(
  leader: SyncGroupMember,
  follower: SyncGroupMember,
  commonNames: ReadonlySet<string>,
): { time: number; usedMarkerSync: boolean } {
  const markerPhase = leaderMarkerPhase(leader, commonNames)
  if (markerPhase) {
    const pair = followerMarkerPair(
      follower,
      markerPhase.previousName,
      markerPhase.nextName,
    )
    if (pair) {
      const normalized = wrapNormalized(
        pair.previous + (pair.next - pair.previous) * markerPhase.alpha,
      )
      return {
        time: normalized * follower.duration,
        usedMarkerSync: true,
      }
    }
  }
  return {
    time: normalizedTime(leader) * follower.duration,
    usedMarkerSync: false,
  }
}

/**
 * Advances one group update. The elected Leader keeps its play rate; every follower's playhead is
 * then derived from the Leader, preventing independently accumulated floating-point/cadence drift.
 */
export function advanceSyncGroup(
  group: SyncGroup,
  deltaTime: number,
): SyncGroupResult {
  const leader = electSyncGroupLeader(group.members, group.leaderId)
  if (!leader) {
    group.leaderId = null
    return { leader: null, usedMarkerSync: false }
  }
  group.leaderId = leader.id
  if (leader.duration > 0) {
    leader.time = (
      leader.time
      + Math.max(0, deltaTime) * leader.playRate
    ) % leader.duration
  } else {
    leader.time = 0
  }

  const commonNames = commonMarkerNames(group.members)
  let usedMarkerSync = commonNames.size >= 2
  for (const follower of group.members) {
    if (follower === leader) continue
    const mapped = mapFollowerTime(leader, follower, commonNames)
    follower.time = mapped.time
    usedMarkerSync &&= mapped.usedMarkerSync
  }
  return { leader, usedMarkerSync }
}
