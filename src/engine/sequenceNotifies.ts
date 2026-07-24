/**
 * The lossless portion of the animation-sequence notify metadata currently emitted in
 * `animation.extras.notifies`.
 *
 * The optional fields are a compile-time enrichment seam for extracted FAnimNotifyEvent data.
 * The shipped GLB currently carries only `name` and `time`, so every omitted field resolves to
 * the UE 5.5 FAnimNotifyEvent constructor default below.
 */
export interface SerializedSequenceNotify {
  readonly name: string
  readonly time: number
  readonly triggerTimeOffset?: number
  readonly endTriggerTimeOffset?: number
  readonly triggerWeightThreshold?: number
  readonly notifyTriggerChance?: number
  readonly triggerOnFollower?: boolean
}

interface SequenceNotifyExtras {
  readonly notifies?: unknown
}

export interface ClipWithSequenceNotifyExtras {
  readonly name: string
  readonly duration: number
  readonly userData?: SequenceNotifyExtras
}

/**
 * Framework-free compiled form of an instantaneous UE FAnimNotifyEvent.
 *
 * NotifyIndex remains the index in animation.extras.notifies so a dispatcher can resolve the
 * class-specific payload without matching duplicate names or rounded times.
 */
export interface CompiledSequenceNotify {
  readonly NotifyIndex: number
  readonly NotifyName: string
  readonly Time: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly Duration: number
  readonly TriggerWeightThreshold: number
  readonly MontageTickType: 'Queued'
  readonly NotifyTriggerChance: 1
  readonly NotifyFilterType: 'NoFiltering'
  readonly NotifyFilterLOD: number
  readonly bCanBeFilteredViaRequest: boolean
  readonly bTriggerOnDedicatedServer: boolean
  readonly bTriggerOnFollower: boolean
  readonly TrackIndex: number
}

export interface CompiledSequenceNotifies {
  readonly clipName: string
  readonly duration: number
  readonly notifies: readonly CompiledSequenceNotify[]
}

export interface SequenceNotifyTickContext {
  /** FAnimTickRecord::bLooping. */
  readonly bAllowLooping: boolean
  /** FAnimNotifyQueue's bSrcIsLeader; true also covers players outside a sync group. */
  readonly bSrcIsLeader: boolean
  /** FAnimTickRecord::EffectiveBlendWeight. */
  readonly InstanceWeight: number
}

/**
 * UE 5.5 `FAnimNotifyEvent::FAnimNotifyEvent()` defaults.
 *
 * Source:
 * - Engine/Source/Runtime/Engine/Public/Animation/AnimTypes.h
 * - Engine/Source/Runtime/Core/Public/Math/VectorRegister.h
 *
 * The extracted sidecar has no trigger offsets, state duration, chance, LOD/server filters, or
 * track index. Keeping those absences visible prevents the runtime from quietly inventing them.
 */
export const UE_SEQUENCE_NOTIFY_DEFAULTS = Object.freeze({
  TriggerTimeOffset: 0,
  EndTriggerTimeOffset: 0,
  Duration: 0,
  TriggerWeightThreshold: 0.00001,
  MontageTickType: 'Queued' as const,
  NotifyTriggerChance: 1 as const,
  NotifyFilterType: 'NoFiltering' as const,
  NotifyFilterLOD: 0,
  bCanBeFilteredViaRequest: true,
  bTriggerOnDedicatedServer: true,
  bTriggerOnFollower: false,
  TrackIndex: 0,
})

const UE_MAX_NOTIFY_TRAVERSAL_LOOPS = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readOptionalNumber(
  value: unknown,
  fallback: number,
  field: string,
  clipName: string,
  index: number,
) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${clipName} notify ${index} ${field} must be finite`,
    )
  }
  return value
}

function readOptionalBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
  clipName: string,
  index: number,
) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new Error(
      `${clipName} notify ${index} ${field} must be boolean`,
    )
  }
  return value
}

/**
 * Compiles the `[{ name, time }]` GLB contract from
 * `scripts/extract-als/assemble-glb.mjs`.
 *
 * Random trigger chance is deliberately not approximated with `Math.random()`. Missing chance is
 * UE's deterministic default of one; an enriched non-one chance is rejected until the engine owns
 * the same seeded FAnimNotifyQueue random stream as Unreal.
 */
export function compileSequenceNotifies(
  clip: ClipWithSequenceNotifyExtras,
): CompiledSequenceNotifies {
  if (
    typeof clip.name !== 'string'
    || clip.name.length === 0
    || !Number.isFinite(clip.duration)
    || clip.duration < 0
  ) {
    throw new Error('Sequence notify compilation requires a named finite-duration clip')
  }

  const rawNotifies = clip.userData?.notifies
  if (rawNotifies === undefined) {
    return { clipName: clip.name, duration: clip.duration, notifies: [] }
  }
  if (!Array.isArray(rawNotifies)) {
    throw new Error(`${clip.name} animation.extras.notifies must be an array`)
  }

  const notifies: CompiledSequenceNotify[] = []
  for (let index = 0; index < rawNotifies.length; index++) {
    const rawNotify = rawNotifies[index]
    if (!isRecord(rawNotify)) {
      throw new Error(`${clip.name} notify ${index} must be an object`)
    }
    const name = rawNotify.name
    const time = rawNotify.time
    if (
      typeof name !== 'string'
      || name.length === 0
      || typeof time !== 'number'
      || !Number.isFinite(time)
      || time < 0
      || time > clip.duration
    ) {
      throw new Error(`${clip.name} notify ${index} has invalid name or time`)
    }

    const TriggerWeightThreshold = readOptionalNumber(
      rawNotify.triggerWeightThreshold,
      UE_SEQUENCE_NOTIFY_DEFAULTS.TriggerWeightThreshold,
      'triggerWeightThreshold',
      clip.name,
      index,
    )
    if (TriggerWeightThreshold < 0) {
      throw new Error(
        `${clip.name} notify ${index} triggerWeightThreshold must be non-negative`,
      )
    }

    const TriggerTimeOffset = readOptionalNumber(
      rawNotify.triggerTimeOffset,
      UE_SEQUENCE_NOTIFY_DEFAULTS.TriggerTimeOffset,
      'triggerTimeOffset',
      clip.name,
      index,
    )
    const EndTriggerTimeOffset = readOptionalNumber(
      rawNotify.endTriggerTimeOffset,
      UE_SEQUENCE_NOTIFY_DEFAULTS.EndTriggerTimeOffset,
      'endTriggerTimeOffset',
      clip.name,
      index,
    )
    const NotifyTriggerChance = readOptionalNumber(
      rawNotify.notifyTriggerChance,
      UE_SEQUENCE_NOTIFY_DEFAULTS.NotifyTriggerChance,
      'notifyTriggerChance',
      clip.name,
      index,
    )
    if (NotifyTriggerChance !== 1) {
      throw new Error(
        `${clip.name} notify ${index} requires UE's seeded random trigger stream`,
      )
    }

    notifies.push({
      NotifyIndex: index,
      NotifyName: name,
      Time: time,
      TriggerTimeOffset,
      EndTriggerTimeOffset,
      Duration: UE_SEQUENCE_NOTIFY_DEFAULTS.Duration,
      TriggerWeightThreshold,
      MontageTickType: UE_SEQUENCE_NOTIFY_DEFAULTS.MontageTickType,
      NotifyTriggerChance: UE_SEQUENCE_NOTIFY_DEFAULTS.NotifyTriggerChance,
      NotifyFilterType: UE_SEQUENCE_NOTIFY_DEFAULTS.NotifyFilterType,
      NotifyFilterLOD: UE_SEQUENCE_NOTIFY_DEFAULTS.NotifyFilterLOD,
      bCanBeFilteredViaRequest:
        UE_SEQUENCE_NOTIFY_DEFAULTS.bCanBeFilteredViaRequest,
      bTriggerOnDedicatedServer:
        UE_SEQUENCE_NOTIFY_DEFAULTS.bTriggerOnDedicatedServer,
      bTriggerOnFollower: readOptionalBoolean(
        rawNotify.triggerOnFollower,
        UE_SEQUENCE_NOTIFY_DEFAULTS.bTriggerOnFollower,
        'triggerOnFollower',
        clip.name,
        index,
      ),
      TrackIndex: UE_SEQUENCE_NOTIFY_DEFAULTS.TrackIndex,
    })
  }

  return { clipName: clip.name, duration: clip.duration, notifies }
}

function passesQueueFilters(
  notify: CompiledSequenceNotify,
  context: SequenceNotifyTickContext,
) {
  // UE 5.5 FAnimNotifyQueue::AddAnimNotifiesToDest(), in:
  // Engine/Source/Runtime/Engine/Private/Animation/AnimNotifyQueue.cpp.
  return (
    (context.bSrcIsLeader || notify.bTriggerOnFollower)
    && notify.TriggerWeightThreshold <= context.InstanceWeight
  )
}

function gatherFromForwardRange(
  track: CompiledSequenceNotifies,
  previousPosition: number,
  currentPosition: number,
  context: SequenceNotifyTickContext,
  output: CompiledSequenceNotify[],
) {
  // UE 5.5 UAnimSequenceBase::GetAnimNotifiesFromDeltaPositions(), in:
  // Engine/Source/Runtime/Engine/Private/Animation/AnimSequenceBase.cpp.
  // Instantaneous events have NotifyEndTime === NotifyStartTime, reducing its forward overlap
  // predicate to (PreviousPosition, CurrentPosition].
  for (let index = 0; index < track.notifies.length; index++) {
    const notify = track.notifies[index]
    const triggerTime = notify.Time + notify.TriggerTimeOffset
    if (
      triggerTime <= currentPosition
      && triggerTime > previousPosition
      && passesQueueFilters(notify, context)
    ) {
      output.push(notify)
    }
  }
}

/**
 * Appends crossed, queue-filtered notify references into caller-owned storage and returns the
 * number appended. No event wrappers, temporary range arrays, or closures are allocated per tick.
 *
 * This is the forward-only subset of UE 5.5 UAnimSequenceBase::GetAnimNotifies(). Each loop is
 * advanced with non-looping `FAnimationRuntime::AdvanceTime`, harvested, then restarted at zero.
 * Unreal intentionally budgets at most 1000 traversals for a very large delta; this mirrors that
 * behavior instead of allowing an unbounded hitch.
 */
export function gatherSequenceNotifies(
  track: CompiledSequenceNotifies,
  StartTime: number,
  DeltaTime: number,
  context: SequenceNotifyTickContext,
  output: CompiledSequenceNotify[],
): number {
  if (
    !Number.isFinite(StartTime)
    || !Number.isFinite(DeltaTime)
    || !Number.isFinite(context.InstanceWeight)
  ) {
    throw new Error('Sequence notify tick values must be finite')
  }
  if (DeltaTime < 0) {
    throw new Error('Sequence notify runtime currently supports forward traversal only')
  }
  if (
    StartTime < 0
    || StartTime > track.duration
  ) {
    throw new Error(
      `${track.clipName} notify StartTime ${StartTime} is outside its play range`,
    )
  }

  const outputStart = output.length
  if (
    DeltaTime === 0
    || track.duration <= 0
    || track.notifies.length === 0
  ) {
    return 0
  }

  let maxLoopCount = 2
  if (DeltaTime > track.duration) {
    maxLoopCount = Math.min(
      UE_MAX_NOTIFY_TRAVERSAL_LOOPS,
      Math.max(2, Math.trunc(DeltaTime / track.duration)),
    )
  }

  let previousPosition = StartTime
  let desiredDeltaMove = DeltaTime
  for (let loopIndex = 0; loopIndex < maxLoopCount; loopIndex++) {
    // UE 5.5 FAnimationRuntime::AdvanceTime(false, ...), in:
    // Engine/Source/Runtime/Engine/Private/Animation/AnimationRuntime.cpp.
    // Equality with EndTime is ETAA_Default; only moving strictly past it is ETAA_Finished.
    const desiredPosition = previousPosition + desiredDeltaMove
    const currentPosition = Math.min(desiredPosition, track.duration)
    gatherFromForwardRange(
      track,
      previousPosition,
      currentPosition,
      context,
      output,
    )

    const finished = desiredPosition > track.duration
    if (!finished || !context.bAllowLooping) break

    desiredDeltaMove -= currentPosition - previousPosition
    previousPosition = 0
  }

  return output.length - outputStart
}
