export const INVALID_ROOT_MOTION_SOURCE_ID = 0
export const MAX_ROOT_MOTION_SOURCE_ID = 0xffff

export type RootMotionSourceStatus =
  | 'Active'
  | 'Finished'
  | 'MarkedForRemoval'

/**
 * The engine-owned part of FRootMotionSource used by this runtime.
 *
 * ALS's FAlsRootMotionSource_Mantling supplies both fields structurally. Its
 * own Time remains authoritative; the group never creates or advances a
 * second action clock.
 */
export interface RootMotionSource {
  readonly Priority: number
  Status: RootMotionSourceStatus
}

export interface RootMotionSourceGroupEntry<
  Source extends RootMotionSource,
> {
  readonly LocalID: number
  readonly Source: Source
}

/**
 * Framework-free FRootMotionSourceGroup storage.
 *
 * Epic documents RootMotionSources as active and
 * PendingAddRootMotionSources as sources added for the next movement update:
 * https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/FRootMotionSourceGroup
 */
export interface RootMotionSourceGroup<
  Source extends RootMotionSource,
> {
  readonly RootMotionSources: RootMotionSourceGroupEntry<Source>[]
  readonly PendingAddRootMotionSources:
    RootMotionSourceGroupEntry<Source>[]
  /** Engine-runtime index; arrays remain the active/pending ordering source. */
  readonly RootMotionSourceByID:
    Map<number, RootMotionSourceGroupEntry<Source>>
}

export interface PrepareRootMotionSourceGroupOptions<
  Source extends RootMotionSource,
> {
  /**
   * FRootMotionSource::PrepareRootMotion() dispatch. The source implementation
   * owns its time and generated movement; this group owns only lifecycle and
   * ordering.
   */
  readonly PrepareRootMotion: (
    Source: Source,
    LocalID: number,
  ) => void
  /**
   * CharacterMovement finish-velocity handling belongs at this same cleanup
   * seam. ALS mantling does not need it, but the callback keeps removal
   * observable and exactly once for future engine sources.
   */
  readonly OnRootMotionSourceRemoved?: (
    Source: Source,
    LocalID: number,
    Status: Exclude<RootMotionSourceStatus, 'Active'>,
  ) => void
}

export interface PrepareRootMotionSourceGroupResult {
  readonly PreparedSourceCount: number
  readonly RemovedSourceCount: number
}

/*
 * UE 5.5's FRootMotionSourceGroup::ApplyRootMotionSource() uses one static
 * uint16 generator, increments before assignment, and skips Invalid (zero).
 * Keep that process-wide identity space separate from montage instance IDs.
 */
let LocalIDGenerator = INVALID_ROOT_MOTION_SOURCE_ID

export function createRootMotionSourceGroup<
  Source extends RootMotionSource,
>(): RootMotionSourceGroup<Source> {
  return {
    RootMotionSources: [],
    PendingAddRootMotionSources: [],
    RootMotionSourceByID: new Map(),
  }
}

function hasRootMotionSourceID<Source extends RootMotionSource>(
  Group: Readonly<RootMotionSourceGroup<Source>>,
  LocalID: number,
) {
  return Group.RootMotionSourceByID.has(LocalID)
}

function nextNonzeroRootMotionSourceID() {
  LocalIDGenerator = LocalIDGenerator >= MAX_ROOT_MOTION_SOURCE_ID
    ? 1
    : LocalIDGenerator + 1
  return LocalIDGenerator
}

function allocateRootMotionSourceID<Source extends RootMotionSource>(
  Group: Readonly<RootMotionSourceGroup<Source>>,
) {
  /*
   * ORIGINAL collision hardening required by this runtime's stable LocalID
   * lookup contract. Epic's UE 5.5 implementation explicitly accepts a
   * possible in-flight duplicate after 2^16-1 applications. We preserve its
   * monotonic uint16 wrap, but scan past IDs still retained by this group.
   */
  for (
    let Attempt = 0;
    Attempt < MAX_ROOT_MOTION_SOURCE_ID;
    Attempt++
  ) {
    const LocalID = nextNonzeroRootMotionSourceID()
    if (!hasRootMotionSourceID(Group, LocalID)) return LocalID
  }

  throw new Error(
    'FRootMotionSourceGroup exhausted all nonzero uint16 LocalIDs',
  )
}

/**
 * FRootMotionSourceGroup::ApplyRootMotionSource().
 *
 * A valid source receives a nonzero LocalID and remains pending until the next
 * prepare boundary. Null mirrors UCharacterMovementComponent's invalid-ID
 * failure result without consuming an ID.
 */
export function applyRootMotionSource<Source extends RootMotionSource>(
  Group: RootMotionSourceGroup<Source>,
  Source: Source | null | undefined,
): number {
  if (Source == null) return INVALID_ROOT_MOTION_SOURCE_ID

  const LocalID = allocateRootMotionSourceID(Group)
  const Entry = { LocalID, Source }
  Group.PendingAddRootMotionSources.push(Entry)
  Group.RootMotionSourceByID.set(LocalID, Entry)
  return LocalID
}

/**
 * FRootMotionSourceGroup::GetRootMotionSourceByID().
 *
 * Unreal searches active sources first and pending sources second. Finished
 * and MarkedForRemoval sources remain discoverable until movement cleanup.
 */
export function getRootMotionSourceByID<
  Source extends RootMotionSource,
>(
  Group: Readonly<RootMotionSourceGroup<Source>>,
  LocalID: number,
): Source | null {
  if (LocalID === INVALID_ROOT_MOTION_SOURCE_ID) return null
  return Group.RootMotionSourceByID.get(LocalID)?.Source ?? null
}

/**
 * FRootMotionSourceGroup::RemoveRootMotionSourceByID().
 *
 * Removal is a status change, not an array deletion. The source stays
 * available to GetRootMotionSourceByID() until the next movement update.
 */
export function removeRootMotionSourceByID<
  Source extends RootMotionSource,
>(
  Group: RootMotionSourceGroup<Source>,
  LocalID: number,
): boolean {
  if (LocalID === INVALID_ROOT_MOTION_SOURCE_ID) return false

  const Entry = Group.RootMotionSourceByID.get(LocalID)
  if (Entry === undefined) return false
  Entry.Source.Status = 'MarkedForRemoval'
  return true
}

function cleanUpRootMotionSources<Source extends RootMotionSource>(
  Group: RootMotionSourceGroup<Source>,
  Entries: RootMotionSourceGroupEntry<Source>[],
  OnRootMotionSourceRemoved:
    PrepareRootMotionSourceGroupOptions<
      Source
    >['OnRootMotionSourceRemoved'],
) {
  let WriteIndex = 0
  let RemovedSourceCount = 0

  for (const Entry of Entries) {
    const Status = Entry.Source.Status
    if (Status === 'Finished' || Status === 'MarkedForRemoval') {
      RemovedSourceCount++
      OnRootMotionSourceRemoved?.(
        Entry.Source,
        Entry.LocalID,
        Status,
      )
      Group.RootMotionSourceByID.delete(Entry.LocalID)
      continue
    }

    Entries[WriteIndex] = Entry
    WriteIndex++
  }

  Entries.length = WriteIndex
  return RemovedSourceCount
}

/**
 * UCharacterMovementComponent::PerformMovement() cleanup/prepare boundary.
 *
 * UE 5.5 calls CleanUpInvalidRootMotion() before force handling, then
 * FRootMotionSourceGroup::PrepareRootMotion() promotes pending sources,
 * StableSorts by descending Priority, and dispatches PrepareRootMotion().
 * A source that becomes Finished during dispatch therefore remains retained
 * through this update and is removed at the start of the next one.
 */
export function prepareRootMotionSourceGroup<
  Source extends RootMotionSource,
>(
  Group: RootMotionSourceGroup<Source>,
  Options: Readonly<PrepareRootMotionSourceGroupOptions<Source>>,
): PrepareRootMotionSourceGroupResult {
  let RemovedSourceCount = cleanUpRootMotionSources(
    Group,
    Group.RootMotionSources,
    Options.OnRootMotionSourceRemoved,
  )
  RemovedSourceCount += cleanUpRootMotionSources(
    Group,
    Group.PendingAddRootMotionSources,
    Options.OnRootMotionSourceRemoved,
  )

  Group.RootMotionSources.push(
    ...Group.PendingAddRootMotionSources,
  )
  Group.PendingAddRootMotionSources.length = 0

  // Array.prototype.sort() is stable in ES2019+, matching UE's StableSort().
  Group.RootMotionSources.sort(
    (Left, Right) => Right.Source.Priority - Left.Source.Priority,
  )

  for (const Entry of Group.RootMotionSources) {
    Options.PrepareRootMotion(Entry.Source, Entry.LocalID)
  }

  return {
    PreparedSourceCount: Group.RootMotionSources.length,
    RemovedSourceCount,
  }
}
