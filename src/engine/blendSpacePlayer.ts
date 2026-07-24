import {
  mapFollowerTime,
} from './syncGroups'
import type {
  SyncGroupMember,
  SyncMarker,
} from './syncGroups'

export interface BlendSpacePlaybackSample {
  /** Thresholded and normalized FBlendSampleData::TotalWeight. */
  weight: number
  /** UAnimSequenceBase::GetPlayLength(). */
  readonly duration: number
  /** Sequence RateScale multiplied by FBlendSample::RateScale. */
  readonly combinedRateScale: number
  readonly markers: readonly SyncMarker[]
}

/**
 * Persistent FBlendSampleData playback state.
 *
 * UE copies Time and PreviousTime forward by authored sample identity before selecting the
 * current frame's internal marker leader. A BlendSpace therefore owns one clock per source, not
 * just the node's normalized accumulator.
 */
export interface BlendSpacePlaybackSampleState
  extends BlendSpacePlaybackSample {
  time: number
  previousTime: number
}

function wrapNormalized(value: number) {
  return ((value % 1) + 1) % 1
}

function commonMarkerNamesForPair(
  leader: SyncGroupMember,
  follower: SyncGroupMember,
) {
  const followerNames = new Set(
    follower.markers.map((marker) => marker.name),
  )
  return new Set(
    leader.markers
      .map((marker) => marker.name)
      .filter((name) => followerNames.has(name)),
  )
}

/**
 * UE UBlendSpace::GetAnimationLengthFromSampleData().
 *
 * The node PlayRate is deliberately absent: it scales frame delta after this effective source
 * length is resolved. ALS's extracted sequences and sample points all use RateScale 1, but the
 * engine seam retains the complete formula.
 */
export function calculateBlendSpaceEffectiveLength(
  samples: readonly BlendSpacePlaybackSample[],
): number {
  let weightedLength = 0
  let totalWeight = 0
  for (const sample of samples) {
    if (sample.weight <= 0) continue
    const absoluteRate = Math.abs(sample.combinedRateScale)
    const effectiveRate = absoluteRate > 0 ? absoluteRate : 1
    weightedLength += sample.weight * sample.duration / effectiveRate
    totalWeight += sample.weight
  }
  return totalWeight > Number.EPSILON ? weightedLength / totalWeight : 0
}

/**
 * UBlendSpace::TickAssetPlayer() uses the highest-weight marker-capable internal sample as the
 * BlendSpace's marker leader. Strict comparison leaves an exact tie on current cache order.
 */
export function selectBlendSpaceMarkerLeader(
  samples: readonly BlendSpacePlaybackSample[],
): number {
  let leaderIndex = -1
  let leaderWeight = -Infinity
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]
    if (
      sample.weight <= 0
      || sample.markers.length === 0
      || sample.weight <= leaderWeight
    ) {
      continue
    }
    leaderIndex = index
    leaderWeight = sample.weight
  }
  return leaderIndex
}

/**
 * Converts the conventional node PlayRate into normalized BlendSpace cycles per second.
 * Marker-capable players advance through their internal marker leader; markerless players use
 * UBlendSpace's weighted effective length.
 */
export function calculateBlendSpaceNormalizedPlayRate(
  nodePlayRate: number,
  effectiveLength: number,
  markerLeader?: Pick<
    BlendSpacePlaybackSample,
    'duration' | 'combinedRateScale'
  >,
): number {
  const duration = markerLeader
    ? markerLeader.duration
    : effectiveLength
  if (!(duration > 0)) return 0
  const sourceRate = markerLeader?.combinedRateScale ?? 1
  return nodePlayRate * sourceRate / duration
}

/**
 * UBlendSpace::ResetBlendSamples() markerless path. Rate magnitude is already represented by the
 * player's effective length; a negative combined source rate reverses normalized phase.
 */
export function resolveBlendSpaceSampleTime(
  playerPhase: number,
  sampleDuration: number,
  combinedRateScale: number,
): number {
  const phase = wrapNormalized(playerPhase)
  return (combinedRateScale >= 0 ? phase : 1 - phase) * sampleDuration
}

/**
 * UE begins a marker-synchronized BlendSpace leader tick from the selected FBlendSampleData's
 * retained Time. This handoff matters when walk and run exchange internal leadership: their
 * normalized numeric times differ because their authored marker layouts differ.
 */
export function resolveBlendSpacePlayerPhase(
  samples: readonly BlendSpacePlaybackSampleState[],
  markerLeaderIndex: number,
  fallbackPhase: number,
): number {
  const leader = samples[markerLeaderIndex]
  return leader && leader.duration > 0
    ? wrapNormalized(leader.time / leader.duration)
    : wrapNormalized(fallbackPhase)
}

/**
 * First-relevance path from UBlendSpace::TickAssetPlayer.
 *
 * With no valid node MarkerTickRecord, UE initializes the selected source directly from the
 * node's normalized StartPosition. The representative marker table on the BlendSpace asset is
 * capability metadata, not a prior sync position.
 */
export function initializeBlendSpaceMarkerLeaderTime(
  samples: readonly BlendSpacePlaybackSampleState[],
  markerLeaderIndex: number,
  playerPhase: number,
) {
  const leader = samples[markerLeaderIndex]
  if (!leader || !(leader.duration > 0)) return
  const time = wrapNormalized(playerPhase) * leader.duration
  leader.time = time
  leader.previousTime = time
}

/**
 * Applies the owning BlendSpace node's resolved phase to its active internal samples.
 *
 * Marked samples follow the owner's marker position; markerless sources use UE's normalized
 * length fallback. Inactive samples remain untouched. The caller runs this once against the
 * previous marker context before choosing this frame's leader, which initializes newly active
 * samples the same way UE initializes a new FBlendSampleData cache entry.
 */
export function synchronizeBlendSpaceSampleTimes(
  playerPhase: number,
  playerMarkers: readonly SyncMarker[],
  samples: readonly BlendSpacePlaybackSampleState[],
): boolean {
  const leader: SyncGroupMember = {
    id: 'BlendSpacePlayer',
    duration: 1,
    markers: playerMarkers,
    time: wrapNormalized(playerPhase),
    weight: 1,
    playRate: 0,
  }
  let usedMarkerSync = false

  for (const sample of samples) {
    if (sample.weight <= 0) continue
    sample.previousTime = sample.time
    if (playerMarkers.length > 0 && sample.markers.length > 0) {
      const follower: SyncGroupMember = {
        id: 'BlendSpaceSample',
        duration: sample.duration,
        markers: sample.markers,
        time: sample.time,
        weight: sample.weight,
        playRate: 0,
      }
      const mapped = mapFollowerTime(
        leader,
        follower,
        commonMarkerNamesForPair(leader, follower),
      )
      sample.time = mapped.time
      usedMarkerSync ||= mapped.usedMarkerSync
    } else {
      sample.time = resolveBlendSpaceSampleTime(
        playerPhase,
        sample.duration,
        sample.combinedRateScale,
      )
    }
  }

  return usedMarkerSync
}
