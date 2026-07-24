export interface SyncMarker {
  readonly name: string
  readonly normalizedTime: number
}

/** Authored per-clip marker table, with times normalized by the GLB adapter. */
export type SyncMarkerTable = Readonly<Record<string, readonly SyncMarker[]>>

export interface SyncGroupMember {
  readonly id: string
  readonly duration: number
  readonly markers: readonly SyncMarker[]
  /**
   * UE's Always Follower role. If every active member is Always Follower, the first member still
   * becomes leader so that the group has a playback authority.
   */
  readonly canLead?: boolean
  /**
   * Whether graph traversal emitted an FAnimTickRecord for this player this frame.
   *
   * Effective weight cannot stand in for visitation: BlendList nodes may update a zero-weight
   * child, while an entirely dormant SequencePlayer must retain its authored StartPosition.
   */
  updatedThisFrame?: boolean
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
  /** Whether the group leader had at least one marker name valid across marked active members. */
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
 * Epic's Sync Groups elect the highest-scoring tick record as Leader.
 *
 * Equal-score ordering is deliberately not policy here. JavaScript's stable iteration happens to
 * retain candidate order, while Unreal's sort does not promise a tie identity; callers may only
 * depend on the elected record having the maximum score.
 *
 * https://dev.epicgames.com/documentation/en-us/unreal-engine/sync-groups
 */
export function electSyncGroupLeader(
  members: readonly SyncGroupMember[],
): SyncGroupMember | null {
  let leader: SyncGroupMember | null = null
  let followerFallback: SyncGroupMember | null = null
  for (const member of members) {
    if (member.updatedThisFrame === false) continue
    followerFallback ??= member
    if (member.canLead === false) continue
    if (
      !leader
      || member.weight > leader.weight
    ) {
      leader = member
    }
  }
  return leader ?? followerFallback
}

/**
 * UE starts with the elected leader's names and filters them only against active players that
 * actually have markers. A markerless follower length-syncs by itself; it does not disable marker
 * sync for the rest of the group.
 */
function commonMarkerNames(
  leader: SyncGroupMember,
  members: readonly SyncGroupMember[],
) {
  const common = new Set(leader.markers.map((marker) => marker.name))
  for (const member of members) {
    if (
      member === leader
      || member.updatedThisFrame === false
      || member.markers.length === 0
    ) {
      continue
    }
    const names = new Set(member.markers.map((marker) => marker.name))
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
  if (markers.length === 0) return null
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
 * Without a usable marker pair for this follower, normalized time is UE's scaled-length fallback.
 * Markerless followers therefore length-sync individually while marked members remain marker
 * synchronized.
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
  if (follower.duration <= 0) return { time: 0, usedMarkerSync: false }
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
  const leader = electSyncGroupLeader(group.members)
  if (!leader) {
    group.leaderId = null
    return { leader: null, usedMarkerSync: false }
  }
  group.leaderId = leader.id
  if (leader.duration > 0) {
    leader.time = wrapNormalized((
      leader.time
      + Math.max(0, deltaTime) * leader.playRate
    ) / leader.duration) * leader.duration
  } else {
    leader.time = 0
  }

  const commonNames = commonMarkerNames(leader, group.members)
  const usedMarkerSync = commonNames.size > 0
  for (const follower of group.members) {
    if (
      follower === leader
      || follower.updatedThisFrame === false
    ) {
      continue
    }
    const mapped = mapFollowerTime(leader, follower, commonNames)
    follower.time = mapped.time
  }
  return { leader, usedMarkerSync }
}
