export interface SlotMontageRequest {
  readonly clipKey: string
  /** Source sequence length. The generated montage keeps this authored timeline. */
  readonly clipDuration: number
  readonly slotName: string
  readonly groupName: string
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: number
  readonly loopCount: number
  readonly blendOutTriggerTime: number
  /** Position on the generated montage timeline. */
  readonly startTime: number
  /**
   * FAnimTrack additive classification. Dynamic montages inherit this from their source asset.
   * ALS's transition and turn-in-place sequences are non-additive.
   */
  readonly additiveType?: 'none' | 'localSpaceBase' | 'rotationOffsetMeshSpace'
  /** UAnimSequenceBase::HasRootMotion(), inherited by the generated montage track. */
  readonly bEnableRootMotion?: boolean
}

export type SlotMontageStatus =
  | 'blendingIn'
  | 'playing'
  | 'blendingOut'
  | 'completed'

export type SlotMontageBlendOutReason =
  | 'automatic'
  | 'stopped'
  | 'interrupted'

export interface SlotMontageSample {
  /** FAnimMontageInstance::InstanceID; unique for this play, even when clipKey is reused. */
  readonly instanceId: number
  readonly clipKey: string
  readonly slotName: string
  readonly groupName: string
  readonly additiveType: NonNullable<SlotMontageRequest['additiveType']>
  readonly bEnableRootMotion: boolean
  readonly loopCount: number
  /** Position on the generated montage timeline. */
  montageTime: number
  /** Start of the montage-track range traversed during this update. */
  rootMotionPreviousMontageTime: number
  /**
   * End of the traversed range. Unlike montageTime, this reaches the exact forward endpoint
   * before FAnimMontageInstance backs its visible position off by KINDA_SMALL_NUMBER / 2.
   */
  rootMotionMontageTime: number
  /**
   * This update began with this instance as UAnimInstance::RootMotionMontageInstance.
   * Automatic blend-out may clear the clock owner later in the same Advance().
   */
  extractRootMotionFromMontagesOnly: boolean
  /** Time passed to the source clip sampler. */
  sampleTime: number
  weight: number
  status: SlotMontageStatus
  blendOutReason: SlotMontageBlendOutReason | null
}

export interface SlotMontageInstance {
  /** FAnimMontageInstance::InstanceID. */
  readonly instanceId: number
  readonly request: SlotMontageRequest
  /** Length of the generated UAnimMontage timeline, before instance PlayRate. */
  readonly montageDuration: number
  readonly sample: SlotMontageSample
  playing: boolean
  stopped: boolean
  blendElapsed: number
  blendDuration: number
  blendStartWeight: number
  blendDesiredWeight: 0 | 1
}

export interface SlotMontageClock {
  /** The newest non-stopped montage in each Slot Group, matching ActiveMontagesMap ownership. */
  readonly activeByGroup: Map<string, SlotMontageInstance>
  /**
   * Every live FMontageEvaluationState, including interrupted instances blending out beneath the
   * active owner. Arrays preserve MontageInstances insertion order.
   */
  readonly instancesByGroup: Map<string, SlotMontageInstance[]>
  /** UAnimInstance::RootMotionMontageInstance. Stop() clears this immediately. */
  rootMotionMontageInstance: SlotMontageInstance | null
}

export interface SlotMontageWeightData {
  /** Sum of montage weights clamped to one, as returned by FAnimInstanceProxy::GetSlotWeight. */
  readonly slotNodeWeight: number
  /** Base graph contribution after accounting for non-additive montages. */
  readonly sourceWeight: number
  /** Unclamped montage-weight sum used to normalize evaluation when it exceeds one. */
  readonly totalNodeWeight: number
}

const UE_KINDA_SMALL_NUMBER = 1e-4
const UE_MONTAGE_END_OFFSET = UE_KINDA_SMALL_NUMBER / 2
const UE_INDEX_NONE = -1

// FAnimMontageInstance::Initialize() owns a function-static IncrementInstanceID. Its lifetime is
// the process, not one UAnimInstance, so constructing a new SlotMontageClock must not reset it.
let incrementInstanceId = 0

function allocateMontageInstanceId() {
  const instanceId = incrementInstanceId
  incrementInstanceId += 1
  return instanceId
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * FAnimNode_Slot's named-curve complement for one source/montage pair.
 *
 * A curve absent from a non-additive montage contributes zero.
 */
export function blendSlotCurveValue(
  sourceValue: number,
  montageValue: number | undefined,
  montageWeight: number,
) {
  const alpha = clamp(montageWeight, 0, 1)
  return sourceValue * (1 - alpha) + (montageValue ?? 0) * alpha
}

/**
 * FAnimInstanceProxy::GetSlotWeight for the retained montage samples of one slot.
 *
 * TotalNodeWeight remains unclamped because SlotEvaluatePose divides every montage weight by it
 * when interrupted envelopes temporarily sum above one.
 */
export function calculateSlotMontageWeight(
  samples: readonly SlotMontageSample[],
): SlotMontageWeightData {
  let totalNodeWeight = 0
  let nonAdditiveTotalWeight = 0
  for (const sample of samples) {
    const weight = Math.max(0, sample.weight)
    totalNodeWeight += weight
    if (sample.additiveType === 'none') nonAdditiveTotalWeight += weight
  }

  const normalization = totalNodeWeight > 1 ? totalNodeWeight : 1
  return {
    totalNodeWeight,
    slotNodeWeight: Math.min(totalNodeWeight, 1),
    sourceWeight: 1 - nonAdditiveTotalWeight / normalization,
  }
}

/** Raw montage weight adjusted exactly as SlotEvaluatePose does when the group sum exceeds one. */
export function getSlotMontageEvaluationWeight(
  sample: SlotMontageSample,
  totalNodeWeight: number,
) {
  return totalNodeWeight > 1
    ? sample.weight / totalNodeWeight
    : sample.weight
}

function validateRequest(request: SlotMontageRequest) {
  if (request.clipKey.length === 0) throw new Error('Slot montage requires a clip key')
  if (request.slotName.length === 0) throw new Error('Slot montage requires a slot name')
  if (request.groupName.length === 0) throw new Error('Slot montage requires a group name')

  for (const [name, value] of [
    ['clipDuration', request.clipDuration],
    ['blendInDuration', request.blendInDuration],
    ['blendOutDuration', request.blendOutDuration],
    ['playRate', request.playRate],
    ['blendOutTriggerTime', request.blendOutTriggerTime],
    ['startTime', request.startTime],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`Slot montage ${name} must be finite`)
  }

  if (request.clipDuration < 0) {
    throw new Error('Slot montage clipDuration must be non-negative')
  }
  if (request.blendInDuration < 0 || request.blendOutDuration < 0) {
    throw new Error('Slot montage blend durations must be non-negative')
  }
  if (!Number.isInteger(request.loopCount) || request.loopCount < 1) {
    throw new Error('Slot montage loopCount must be a positive integer')
  }
  if (
    request.additiveType !== undefined
    && request.additiveType !== 'none'
    && request.additiveType !== 'localSpaceBase'
    && request.additiveType !== 'rotationOffsetMeshSpace'
  ) {
    throw new Error('Slot montage additiveType is invalid')
  }
  if (
    request.bEnableRootMotion !== undefined
    && typeof request.bEnableRootMotion !== 'boolean'
  ) {
    throw new Error('Slot montage bEnableRootMotion must be boolean')
  }
}

function sourceSampleTime(instance: SlotMontageInstance) {
  const { clipDuration, loopCount } = instance.request
  if (clipDuration <= 0) return 0

  const sourcePosition = clamp(instance.sample.montageTime, 0, instance.montageDuration)
  return loopCount > 1 ? sourcePosition % clipDuration : sourcePosition
}

function refreshSample(instance: SlotMontageInstance) {
  const sample = instance.sample
  sample.sampleTime = sourceSampleTime(instance)

  if (sample.status === 'completed') {
    sample.weight = 0
    return sample
  }

  const alpha = instance.blendDuration <= 0
    ? 1
    : clamp(instance.blendElapsed / instance.blendDuration, 0, 1)
  sample.weight = instance.blendStartWeight
    + (instance.blendDesiredWeight - instance.blendStartWeight) * alpha
  sample.status = instance.stopped
    ? 'blendingOut'
    : sample.weight >= 1
      ? 'playing'
      : 'blendingIn'
  return sample
}

function complete(instance: SlotMontageInstance) {
  instance.playing = false
  instance.sample.status = 'completed'
  instance.sample.weight = 0
  return refreshSample(instance)
}

function updateBlend(instance: SlotMontageInstance, deltaTime: number) {
  if (instance.sample.status === 'completed') return instance.sample
  instance.blendElapsed = Math.min(
    instance.blendDuration,
    instance.blendElapsed + deltaTime,
  )
  return refreshSample(instance)
}

function beginBlendOut(
  clock: SlotMontageClock,
  instance: SlotMontageInstance,
  duration: number,
  reason: SlotMontageBlendOutReason,
) {
  if (instance.sample.status === 'completed') return instance.sample
  const wasStopped = instance.stopped

  // FAnimMontageInstance::Stop makes interruption sticky even when the existing envelope is kept.
  if (reason === 'interrupted' || instance.sample.blendOutReason === null) {
    instance.sample.blendOutReason = reason
  }

  if (instance.stopped) {
    // A stopped montage only restarts its fade when the incoming configured blend time is shorter.
    // Unreal intentionally preserves the current blend option; this duration-only path is linear.
    if (duration >= instance.blendDuration) return refreshSample(instance)
  }

  instance.stopped = true
  instance.blendDuration = duration
  instance.blendElapsed = 0
  instance.blendStartWeight = instance.sample.weight
  instance.blendDesiredWeight = 0
  instance.sample.status = 'blendingOut'
  // FAnimMontageInstance::Stop() calls OnMontageInstanceStopped() on the first stop, which clears
  // UAnimInstance::RootMotionMontageInstance before the fade itself has completed.
  if (!wasStopped && clock.rootMotionMontageInstance === instance) {
    clock.rootMotionMontageInstance = null
  }
  if (
    !wasStopped
    && clock.activeByGroup.get(instance.request.groupName) === instance
  ) {
    clock.activeByGroup.delete(instance.request.groupName)
  }
  if (duration <= 0 || instance.blendStartWeight <= 0) {
    instance.sample.weight = 0
    instance.playing = false
  }
  return refreshSample(instance)
}

function createInstance(request: SlotMontageRequest): SlotMontageInstance {
  validateRequest(request)

  // UAnimMontage::CreateSlotAnimationAsDynamicMontage leaves FAnimSegment::AnimPlayRate at 1.
  // InPlayRate belongs to FAnimMontageInstance, so the authored montage timeline is unchanged.
  const montageDuration = request.clipDuration * request.loopCount
  if (!Number.isFinite(montageDuration)) {
    throw new Error('Slot montage duration must be finite')
  }
  // Montage_PlayInternal rejects an empty montage before it constructs and initializes an
  // FAnimMontageInstance. Keep the constructor's INDEX_NONE and do not consume an ID.
  const instanceId = montageDuration > 0
    ? allocateMontageInstanceId()
    : UE_INDEX_NONE
  const montageTime = clamp(request.startTime, 0, montageDuration)
  const instance: SlotMontageInstance = {
    instanceId,
    request: {
      ...request,
      additiveType: request.additiveType ?? 'none',
    },
    montageDuration,
    sample: {
      instanceId,
      clipKey: request.clipKey,
      slotName: request.slotName,
      groupName: request.groupName,
      additiveType: request.additiveType ?? 'none',
      bEnableRootMotion: request.bEnableRootMotion ?? false,
      loopCount: request.loopCount,
      montageTime,
      rootMotionPreviousMontageTime: montageTime,
      rootMotionMontageTime: montageTime,
      extractRootMotionFromMontagesOnly: false,
      sampleTime: 0,
      weight: request.blendInDuration <= 0 ? 1 : 0,
      status: request.blendInDuration <= 0 ? 'playing' : 'blendingIn',
      blendOutReason: null,
    },
    playing: true,
    stopped: false,
    blendElapsed: 0,
    blendDuration: request.blendInDuration,
    blendStartWeight: 0,
    blendDesiredWeight: 1,
  }
  refreshSample(instance)

  if (montageDuration <= 0) {
    complete(instance)
  }
  return instance
}

function safeDeltaTime(deltaTime: number) {
  return Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
}

function advanceMontagePosition(
  clock: SlotMontageClock,
  instance: SlotMontageInstance,
  deltaTime: number,
) {
  if (!instance.playing || deltaTime <= 0) return

  const playRate = instance.request.playRate
  if (Math.abs(playRate) <= Number.EPSILON) return

  instance.sample.montageTime = clamp(
    instance.sample.montageTime + deltaTime * playRate,
    0,
    instance.montageDuration,
  )
  instance.sample.rootMotionMontageTime = instance.sample.montageTime

  const endPosition = playRate >= 0 ? instance.montageDuration : 0
  const playTimeToEnd = Math.abs(
    (endPosition - instance.sample.montageTime) / playRate,
  )

  // FAnimMontageInstance::Advance checks automatic blend-out after moving the montage, while
  // Montage_UpdateWeight has already consumed this frame's full delta. ALS passes trigger zero,
  // so its terminal sample begins fading no earlier than the following weight-update phase.
  if (!instance.stopped) {
    const customTrigger = instance.request.blendOutTriggerTime >= 0
    const triggerTime = customTrigger
      ? instance.request.blendOutTriggerTime
      : instance.request.blendOutDuration
    if (playTimeToEnd <= Math.max(triggerTime, UE_KINDA_SMALL_NUMBER)) {
      beginBlendOut(
        clock,
        instance,
        customTrigger ? instance.request.blendOutDuration : playTimeToEnd,
        'automatic',
      )
    }
  }

  if (instance.sample.montageTime === endPosition) {
    // On the final forward section UE backs Position off by KINDA_SMALL_NUMBER / 2 before
    // evaluation. This keeps looping FAnimSegments on their final authored sample instead of
    // wrapping to frame zero during the fade tail.
    if (playRate > 0) {
      instance.sample.montageTime = Math.max(
        0,
        instance.montageDuration - UE_MONTAGE_END_OFFSET,
      )
    }
    instance.playing = false
  }
}

function advanceInstance(
  clock: SlotMontageClock,
  instance: SlotMontageInstance,
  deltaTime: number,
) {
  const sample = instance.sample
  sample.rootMotionPreviousMontageTime = sample.montageTime
  sample.rootMotionMontageTime = sample.montageTime
  sample.extractRootMotionFromMontagesOnly = (
    instance.playing
    && clock.rootMotionMontageInstance === instance
  )
  if (sample.status === 'completed') {
    sample.extractRootMotionFromMontagesOnly = false
    return sample
  }
  const delta = safeDeltaTime(deltaTime)

  // UAnimInstance::UpdateMontage runs Montage_UpdateWeight for every instance before
  // Montage_Advance. Do not split the delta at blend or position boundaries.
  updateBlend(instance, delta)
  advanceMontagePosition(clock, instance, delta)
  refreshSample(instance)

  if (instance.stopped && instance.sample.weight <= 0) {
    return complete(instance)
  }
  return instance.sample
}

export function createSlotMontageClock(): SlotMontageClock {
  return {
    activeByGroup: new Map(),
    instancesByGroup: new Map(),
    rootMotionMontageInstance: null,
  }
}

function cleanupGroup(clock: SlotMontageClock, groupName: string) {
  const instances = clock.instancesByGroup.get(groupName)
  if (!instances) return

  for (let index = instances.length - 1; index >= 0; index -= 1) {
    if (instances[index].sample.status === 'completed') instances.splice(index, 1)
  }
  if (instances.length === 0) clock.instancesByGroup.delete(groupName)
}

function latestGroupSample(
  clock: SlotMontageClock,
  groupName: string,
) {
  const active = clock.activeByGroup.get(groupName)
  if (active) return active.sample
  const instances = clock.instancesByGroup.get(groupName)
  return instances?.at(-1)?.sample
}

function advanceGroupInstances(
  clock: SlotMontageClock,
  groupName: string,
  deltaTime: number,
  output?: SlotMontageSample[],
) {
  const instances = clock.instancesByGroup.get(groupName)
  if (!instances) return undefined

  let latest: SlotMontageSample | undefined
  for (const instance of instances) {
    const sample = advanceInstance(clock, instance, deltaTime)
    latest = sample
    output?.push(sample)
    if (
      instance.stopped
      && clock.activeByGroup.get(groupName) === instance
    ) {
      clock.activeByGroup.delete(groupName)
    }
  }
  const preferred = latestGroupSample(clock, groupName) ?? latest
  cleanupGroup(clock, groupName)
  return preferred
}

/**
 * Runtime form of UAnimInstance::PlaySlotAnimationAsDynamicMontage.
 *
 * The duration-only overload exposes no blend curve. This primitive therefore uses the linear
 * default represented by Unreal's zero-valued EAlphaBlendOption::Linear.
 *
 * Epic API:
 * https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UAnimInstance/PlaySlotAnimationAsDynamicMontag-
 */
export function playSlotAnimationAsDynamicMontage(
  clock: SlotMontageClock,
  request: SlotMontageRequest,
): SlotMontageSample {
  const instance = createInstance(request)
  if (instance.sample.status === 'completed') {
    return instance.sample
  }

  // Montage_PlayInternal stops every instance in the new montage's group using the incoming
  // montage's blend-in settings. Those interrupted instances remain in MontageEvaluationData
  // until their fades complete, and FAnimNode_Slot evaluates all of them together.
  const groupInstances = clock.instancesByGroup.get(request.groupName) ?? []
  for (const existing of groupInstances) {
    beginBlendOut(clock, existing, request.blendInDuration, 'interrupted')
  }
  clock.activeByGroup.delete(request.groupName)

  // Montage_PlayInternal independently enforces one root-motion montage across every Slot Group.
  if (instance.sample.bEnableRootMotion && clock.rootMotionMontageInstance) {
    beginBlendOut(
      clock,
      clock.rootMotionMontageInstance,
      request.blendInDuration,
      'interrupted',
    )
  }

  for (let index = groupInstances.length - 1; index >= 0; index -= 1) {
    const existing = groupInstances[index]
    if (existing.sample.weight <= 0) {
      complete(existing)
      groupInstances.splice(index, 1)
    }
  }

  groupInstances.push(instance)
  clock.instancesByGroup.set(request.groupName, groupInstances)
  clock.activeByGroup.set(request.groupName, instance)
  if (instance.sample.bEnableRootMotion) {
    clock.rootMotionMontageInstance = instance
  }
  return instance.sample
}

export function getSlotMontageSample(
  clock: SlotMontageClock,
  groupName: string,
): SlotMontageSample | undefined {
  return latestGroupSample(clock, groupName)
}

/** Writes every live montage sample for one group in Unreal's MontageInstances order. */
export function getSlotMontageSamples(
  clock: SlotMontageClock,
  groupName: string,
  output: SlotMontageSample[] = [],
): SlotMontageSample[] {
  output.length = 0
  const instances = clock.instancesByGroup.get(groupName)
  if (!instances) return output
  for (const instance of instances) output.push(instance.sample)
  return output
}

export function advanceSlotMontageGroup(
  clock: SlotMontageClock,
  groupName: string,
  deltaTime: number,
): SlotMontageSample | undefined {
  return advanceGroupInstances(clock, groupName, deltaTime)
}

/** Advances and writes every montage evaluated by one Slot Group. */
export function advanceSlotMontageGroupSamples(
  clock: SlotMontageClock,
  groupName: string,
  deltaTime: number,
  output: SlotMontageSample[] = [],
): SlotMontageSample[] {
  output.length = 0
  advanceGroupInstances(clock, groupName, deltaTime, output)
  return output
}

/**
 * Advances every active Slot Group. Pass a retained output array to keep the per-frame path
 * allocation-stable.
 */
export function advanceSlotMontageClock(
  clock: SlotMontageClock,
  deltaTime: number,
  output: SlotMontageSample[] = [],
): SlotMontageSample[] {
  output.length = 0
  for (const groupName of [...clock.instancesByGroup.keys()]) {
    advanceGroupInstances(clock, groupName, deltaTime, output)
  }
  // MontageInstances is one global insertion-ordered array, while the clock stores per-group
  // arrays for ownership. InstanceID recovers that exact order for root-motion accumulation.
  output.sort((a, b) => a.instanceId - b.instanceId)
  return output
}

/**
 * Runtime form of UAnimInstance::StopSlotAnimation. A named slot stops only its current dynamic
 * montage; omitting the slot mirrors NAME_None and stops every current slot animation.
 *
 * Epic API:
 * https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Animation/Montage/StopSlotAnimation
 */
export function stopSlotAnimation(
  clock: SlotMontageClock,
  blendOutDuration: number,
  slotName?: string,
): SlotMontageSample[] {
  if (!Number.isFinite(blendOutDuration) || blendOutDuration < 0) {
    throw new Error('StopSlotAnimation blend-out duration must be finite and non-negative')
  }

  const stopped: SlotMontageSample[] = []
  for (const [groupName, instance] of [...clock.activeByGroup]) {
    if (slotName !== undefined && instance.request.slotName !== slotName) continue
    const sample = beginBlendOut(
      clock,
      instance,
      blendOutDuration,
      'stopped',
    )
    stopped.push(sample)
    clock.activeByGroup.delete(groupName)
    if (sample.weight <= 0) complete(instance)
    cleanupGroup(clock, groupName)
  }
  return stopped
}
