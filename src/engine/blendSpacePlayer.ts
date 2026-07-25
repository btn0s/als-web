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

/**
 * One evaluated FBlendSampleData entry. `id` is the BlendSpace sample identity, deliberately
 * not an animation asset name: one sequence can occur in more than one sample/player.
 */
export interface BlendSpacePlayerSample extends BlendSpacePlaybackSample {
  readonly id: string
}

export interface BlendSpacePlayerConfig {
  readonly id: string
  /** FAnimNode_BlendSpacePlayer::StartPosition, serialized as normalized phase. */
  readonly startPosition: number
}

export interface BlendSpacePlayerUpdate {
  readonly relevant: boolean
  readonly nodePlayRate: number
  readonly samples: readonly BlendSpacePlayerSample[]
}

export interface TimedBlendSpacePlayerSample extends BlendSpacePlayerSample {
  readonly time: number
  readonly previousTime: number
}

export interface BlendSpacePlayerResult {
  /** The current outer-player tick record. Add this directly to a SyncGroup if needed. */
  readonly syncMember: SyncGroupMember
  readonly markerLeaderId: string | null
  readonly samples: readonly TimedBlendSpacePlayerSample[]
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

/**
 * Stateful UBlendSpace player seam. It owns the internal FBlendSampleData clocks while exposing
 * precisely one outer SyncGroup member. Call `update()` during graph traversal, let the caller
 * synchronize its returned `syncMember`, then call `resolveOuterSync()` before sampling poses.
 * `advance()` is the equivalent convenience path for a player outside a SyncGroup.
 */
export class BlendSpacePlayer {
  readonly syncMember: SyncGroupMember

  private readonly config: BlendSpacePlayerConfig
  private readonly states = new Map<string, BlendSpacePlaybackSampleState>()
  private readonly syncMarkers: SyncMarker[] = []
  private active: Array<BlendSpacePlayerSample & BlendSpacePlaybackSampleState> = []
  private relevant = false
  private markerLeaderId: string | null = null

  constructor(config: BlendSpacePlayerConfig) {
    this.config = config
    this.syncMember = {
      id: config.id,
      duration: 1,
      markers: this.syncMarkers,
      time: wrapNormalized(config.startPosition),
      weight: 0,
      playRate: 0,
      updatedThisFrame: false,
    }
  }

  update(update: BlendSpacePlayerUpdate): BlendSpacePlayerResult {
    if (!update.relevant) {
      this.relevant = false
      this.active = []
      this.markerLeaderId = null
      this.syncMember.weight = 0
      this.syncMember.playRate = 0
      this.syncMember.updatedThisFrame = false
      return this.result()
    }

    this.active = update.samples.map((sample) => {
      const previous = this.states.get(sample.id)
      const state: BlendSpacePlaybackSampleState = {
        ...sample,
        time: previous?.time ?? 0,
        previousTime: previous?.previousTime ?? 0,
      }
      this.states.set(sample.id, state)
      return Object.assign(state, sample)
    })

    // New FBlendSampleData cache entries must first inherit the *previous* outer player marker
    // context. Otherwise a newly highest-weight leader begins from its dormant zero clock and
    // makes the BlendSpace's outer phase jump as soon as leadership changes.
    if (this.relevant) {
      synchronizeBlendSpaceSampleTimes(
        this.syncMember.time,
        this.syncMember.markers,
        this.active,
      )
    }

    const leaderIndex = this.selectStableMarkerLeader()
    const leader = leaderIndex >= 0 ? this.active[leaderIndex] : undefined
    if (!this.relevant) {
      const phase = wrapNormalized(this.config.startPosition)
      initializeBlendSpaceMarkerLeaderTime(this.active, leaderIndex, phase)
      synchronizeBlendSpaceSampleTimes(phase, leader?.markers ?? [], this.active)
      // A fresh tick record cannot emit a notify range from a prior relevance interval.
      for (const sample of this.active) sample.previousTime = sample.time
      this.syncMember.time = phase
    } else {
      this.syncMember.time = resolveBlendSpacePlayerPhase(
        this.active,
        leaderIndex,
        this.syncMember.time,
      )
    }

    this.relevant = true
    this.markerLeaderId = leader?.id ?? null
    this.setSyncMarkers(leader?.markers ?? [])
    this.syncMember.weight = 1
    this.syncMember.playRate = calculateBlendSpaceNormalizedPlayRate(
      update.nodePlayRate,
      calculateBlendSpaceEffectiveLength(this.active),
      leader,
    )
    this.syncMember.updatedThisFrame = true
    return this.result()
  }

  /** Resolve internal sources after an owning SyncGroup has set `syncMember.time`. */
  resolveOuterSync(): BlendSpacePlayerResult {
    if (!this.relevant) return this.result()
    synchronizeBlendSpaceSampleTimes(
      this.syncMember.time,
      this.syncMember.markers,
      this.active,
    )
    return this.result()
  }

  /** Advance an unsynchronized outer player and resolve its internal source clocks. */
  advance(deltaTime: number): BlendSpacePlayerResult {
    if (!this.relevant) return this.result()
    this.syncMember.time = wrapNormalized(
      this.syncMember.time + Math.max(0, deltaTime) * this.syncMember.playRate,
    )
    return this.resolveOuterSync()
  }

  /** Retained FBlendSampleData clocks, including sources from a prior relevance interval. */
  getRetainedSamples(): readonly TimedBlendSpacePlayerSample[] {
    return [...this.states].map(([id, sample]) => ({ ...sample, id }))
  }

  private selectStableMarkerLeader() {
    const selected = selectBlendSpaceMarkerLeader(this.active)
    if (selected < 0 || !this.markerLeaderId) return selected
    const retained = this.active.findIndex((sample) => sample.id === this.markerLeaderId)
    return retained >= 0
      && this.active[retained].weight === this.active[selected].weight
      ? retained
      : selected
  }

  private setSyncMarkers(markers: readonly SyncMarker[]) {
    this.syncMarkers.splice(0, this.syncMarkers.length, ...markers)
  }

  private result(): BlendSpacePlayerResult {
    return {
      syncMember: this.syncMember,
      markerLeaderId: this.markerLeaderId,
      samples: this.active.map((sample) => ({ ...sample })),
    }
  }
}
