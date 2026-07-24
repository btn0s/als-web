export interface SlotMontageRequest {
  readonly clipKey: string
  /** Source sequence length before the dynamic montage's segment play rate is applied. */
  readonly clipDuration: number
  readonly slotName: string
  readonly groupName: string
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: number
  readonly loopCount: number
  readonly blendOutTriggerTime: number
  /** Position on the rate-scaled montage timeline, not a source-sequence sample time. */
  readonly startTime: number
}

export type SlotMontageStatus =
  | 'blendingIn'
  | 'playing'
  | 'blendingOut'
  | 'completed'

export type SlotMontageBlendOutReason = 'automatic' | 'stopped'

export interface SlotMontageSample {
  readonly clipKey: string
  readonly slotName: string
  readonly groupName: string
  /** Position on the generated montage timeline. */
  montageTime: number
  /** Time passed to the source clip sampler. */
  sampleTime: number
  weight: number
  status: SlotMontageStatus
  blendOutReason: SlotMontageBlendOutReason | null
}

export interface SlotMontageInstance {
  readonly request: SlotMontageRequest
  readonly montageDuration: number
  readonly automaticBlendOutTime: number
  readonly sample: SlotMontageSample
  blendInElapsed: number
  blendOutElapsed: number
  blendOutDuration: number
  blendOutStartWeight: number
}

export interface SlotMontageClock {
  /**
   * Epic permits only one active montage per Slot Group. Replacing this map entry is therefore
   * the clock's ownership boundary.
   *
   * Epic's public API does not specify an outgoing replacement envelope. Until that behavior has
   * an independent oracle, replacement is atomic rather than inventing a second fading instance.
   */
  readonly activeByGroup: Map<string, SlotMontageInstance>
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
  // ALS's settings and calls use forward, positive rates. FAnimSegment supports reverse playback,
  // but its dynamic-montage start/end behavior is outside this primitive until independently
  // verified against Unreal.
  if (request.playRate <= 0) {
    throw new Error('Slot montage playRate must be positive')
  }
  if (!Number.isInteger(request.loopCount) || request.loopCount < 1) {
    throw new Error('Slot montage loopCount must be a positive integer')
  }
  if (request.startTime < 0) {
    throw new Error('Slot montage startTime must be non-negative')
  }
}

function sourceSampleTime(instance: SlotMontageInstance) {
  const { clipDuration, loopCount, playRate } = instance.request
  if (clipDuration <= 0) return 0

  const sourcePosition = clamp(
    instance.sample.montageTime * playRate,
    0,
    clipDuration * loopCount,
  )
  if (instance.sample.montageTime >= instance.montageDuration) {
    return clipDuration
  }
  return sourcePosition % clipDuration
}

function blendInWeight(instance: SlotMontageInstance) {
  const duration = instance.request.blendInDuration
  return duration <= 0 ? 1 : clamp(instance.blendInElapsed / duration, 0, 1)
}

function refreshSample(instance: SlotMontageInstance) {
  const sample = instance.sample
  sample.sampleTime = sourceSampleTime(instance)

  if (sample.status === 'completed') {
    sample.weight = 0
    return sample
  }
  if (sample.status === 'blendingOut') {
    sample.weight = instance.blendOutDuration <= 0
      ? 0
      : instance.blendOutStartWeight * (
        1 - clamp(instance.blendOutElapsed / instance.blendOutDuration, 0, 1)
      )
    return sample
  }

  sample.weight = blendInWeight(instance)
  sample.status = sample.weight >= 1 ? 'playing' : 'blendingIn'
  return sample
}

function complete(instance: SlotMontageInstance) {
  instance.sample.status = 'completed'
  instance.sample.weight = 0
  return refreshSample(instance)
}

function beginBlendOut(
  instance: SlotMontageInstance,
  duration: number,
  reason: SlotMontageBlendOutReason,
) {
  refreshSample(instance)
  instance.blendOutDuration = duration
  instance.blendOutElapsed = 0
  instance.blendOutStartWeight = instance.sample.weight
  instance.sample.status = 'blendingOut'
  instance.sample.blendOutReason = reason
  if (duration <= 0 || instance.blendOutStartWeight <= 0) {
    return complete(instance)
  }
  return refreshSample(instance)
}

function createInstance(request: SlotMontageRequest): SlotMontageInstance {
  validateRequest(request)

  // CreateSlotAnimationAsDynamicMontage stores InPlayRate on its FAnimSegment. Segment play rate
  // changes the generated montage's length; Montage_Play then starts at InTimeToStartMontageAt.
  const montageDuration = request.clipDuration * request.loopCount / request.playRate
  if (!Number.isFinite(montageDuration)) {
    throw new Error('Slot montage duration must be finite')
  }
  if (request.startTime > montageDuration) {
    // Public Epic documentation names this a montage start position but does not specify
    // out-of-range coercion. Reject it instead of inventing clamp or wrap behavior.
    throw new Error('Slot montage startTime must not exceed its montage duration')
  }

  // Epic's montage contract:
  //   trigger >= 0: montage end - trigger
  //   trigger < 0: use BlendOutTime so the blend finishes at montage end.
  // ALS 4.15 explicitly passes zero, which starts the fade at the end and holds the terminal
  // sequence sample throughout the fade tail.
  const triggerOffset = request.blendOutTriggerTime >= 0
    ? request.blendOutTriggerTime
    : request.blendOutDuration
  const automaticBlendOutTime = clamp(
    montageDuration - triggerOffset,
    0,
    montageDuration,
  )
  const montageTime = request.startTime
  const instance: SlotMontageInstance = {
    request: { ...request },
    montageDuration,
    automaticBlendOutTime,
    sample: {
      clipKey: request.clipKey,
      slotName: request.slotName,
      groupName: request.groupName,
      montageTime,
      sampleTime: 0,
      weight: request.blendInDuration <= 0 ? 1 : 0,
      status: request.blendInDuration <= 0 ? 'playing' : 'blendingIn',
      blendOutReason: null,
    },
    blendInElapsed: 0,
    blendOutElapsed: 0,
    blendOutDuration: request.blendOutDuration,
    blendOutStartWeight: 0,
  }
  refreshSample(instance)

  if (montageDuration <= 0) {
    complete(instance)
    return instance
  }
  if (montageTime >= automaticBlendOutTime) {
    beginBlendOut(instance, request.blendOutDuration, 'automatic')
  }
  return instance
}

function safeDeltaTime(deltaTime: number) {
  return Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
}

function advanceMontagePosition(instance: SlotMontageInstance, deltaTime: number) {
  instance.sample.montageTime = Math.min(
    instance.montageDuration,
    instance.sample.montageTime + deltaTime,
  )
}

function advanceInstance(
  instance: SlotMontageInstance,
  deltaTime: number,
) {
  let remaining = safeDeltaTime(deltaTime)

  if (instance.sample.status === 'completed') return instance.sample

  while (true) {
    if (instance.sample.status === 'blendingOut') {
      const fadeRemaining = Math.max(
        0,
        instance.blendOutDuration - instance.blendOutElapsed,
      )
      const completesFade = remaining >= fadeRemaining
      const step = Math.min(remaining, fadeRemaining)
      advanceMontagePosition(instance, step)
      instance.blendOutElapsed += step
      remaining -= step
      if (completesFade) {
        instance.blendOutElapsed = instance.blendOutDuration
        return complete(instance)
      }
      return refreshSample(instance)
    }

    const timeToTrigger = Math.max(
      0,
      instance.automaticBlendOutTime - instance.sample.montageTime,
    )
    const reachesTrigger = remaining >= timeToTrigger
    const step = Math.min(remaining, timeToTrigger)
    advanceMontagePosition(instance, step)
    instance.blendInElapsed += step
    remaining -= step
    if (reachesTrigger) {
      instance.sample.montageTime = instance.automaticBlendOutTime
    }
    refreshSample(instance)

    if (reachesTrigger) {
      const blendOutSample = beginBlendOut(
        instance,
        instance.request.blendOutDuration,
        'automatic',
      )
      if (blendOutSample.status === 'completed' || remaining <= 0) {
        return blendOutSample
      }
      continue
    }
    return instance.sample
  }
}

export function createSlotMontageClock(): SlotMontageClock {
  return { activeByGroup: new Map() }
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
    clock.activeByGroup.delete(request.groupName)
  } else {
    // Playing another montage in the same Slot Group overrides its single active owner. Public
    // Epic documentation establishes the ownership rule, but not an outgoing crossfade contract.
    clock.activeByGroup.set(request.groupName, instance)
  }
  return instance.sample
}

export function getSlotMontageSample(
  clock: SlotMontageClock,
  groupName: string,
): SlotMontageSample | undefined {
  return clock.activeByGroup.get(groupName)?.sample
}

export function advanceSlotMontageGroup(
  clock: SlotMontageClock,
  groupName: string,
  deltaTime: number,
): SlotMontageSample | undefined {
  const instance = clock.activeByGroup.get(groupName)
  if (!instance) return undefined
  const sample = advanceInstance(instance, deltaTime)
  if (sample.status === 'completed') clock.activeByGroup.delete(groupName)
  return sample
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
  for (const [groupName, instance] of clock.activeByGroup) {
    const sample = advanceInstance(instance, deltaTime)
    output.push(sample)
    if (sample.status === 'completed') clock.activeByGroup.delete(groupName)
  }
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
  for (const [groupName, instance] of clock.activeByGroup) {
    if (slotName !== undefined && instance.request.slotName !== slotName) continue
    const sample = beginBlendOut(instance, blendOutDuration, 'stopped')
    stopped.push(sample)
    if (sample.status === 'completed') clock.activeByGroup.delete(groupName)
  }
  return stopped
}
