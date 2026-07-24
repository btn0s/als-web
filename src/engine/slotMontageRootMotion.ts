import {
  accumulateRootMotion,
  accumulateRootMotionWithBlend,
  clearRootMotionMovementParams,
  createAuthoredRootMotionDelta,
  createRootMotionMovementParams,
  extractAuthoredRootMotionDelta,
  makeUpRootMotionToFullWeight,
} from './rootMotion'
import type {
  AuthoredRootMotionDelta,
  CompiledAuthoredRootMotion,
  RootMotionMovementParams,
} from './rootMotion'
import type { SlotMontageSample } from './slotMontage'

export type SlotMontageRootMotionMode =
  | 'NoRootMotionExtraction'
  | 'IgnoreRootMotion'
  | 'RootMotionFromEverything'
  | 'RootMotionFromMontagesOnly'

export interface SlotMontageRootMotionBinding {
  /** Stable FAnimMontageInstance::InstanceID owner. */
  readonly sample: Readonly<SlotMontageSample>
  readonly rootMotion: CompiledAuthoredRootMotion
}

export interface SlotMontageRootMotionOptions {
  /** ALS uses UAnimInstance's default RootMotionFromMontagesOnly. */
  readonly rootMotionMode?: SlotMontageRootMotionMode
  /**
   * FAnimInstanceProxy::GetSlotNodeGlobalWeight() by exact Slot name. UE applies this only in
   * RootMotionFromEverything after montage Advance has queued every retained instance.
   */
  readonly slotNodeGlobalWeights?: ReadonlyMap<string, number>
  /** ACharacter::GetAnimRootMotionTranslationScale(). */
  readonly translationScale?: number
}

function clearDelta(out: AuthoredRootMotionDelta) {
  out.translation.fill(0)
  out.rotation[0] = 0
  out.rotation[1] = 0
  out.rotation[2] = 0
  out.rotation[3] = 1
  out.scale.fill(1)
  out.valid = false
  return out
}

function validateBinding(binding: SlotMontageRootMotionBinding) {
  const { sample, rootMotion } = binding
  if (sample.instanceId < 0) {
    throw new Error('Slot root motion requires an initialized montage instance')
  }
  if (sample.clipKey !== rootMotion.clipName) {
    throw new Error(
      `Slot montage instance ${sample.instanceId} clip "${sample.clipKey}" `
      + `does not match root motion "${rootMotion.clipName}"`,
    )
  }
  if (sample.bEnableRootMotion !== rootMotion.bEnableRootMotion) {
    throw new Error(
      `Slot montage instance ${sample.instanceId} root-motion setting `
      + `does not match "${rootMotion.clipName}"`,
    )
  }
}

/**
 * UAnimMontage::ExtractRootMotionFromTrackRange() for one dynamic montage update.
 *
 * The range lives on the generated montage timeline. FAnimSegment handles authored looping, so
 * instance PlayRate advances the range but never scales it a second time during extraction.
 */
export function extractSlotMontageRootMotionDelta(
  binding: SlotMontageRootMotionBinding,
  translationScale = 1,
  out = createAuthoredRootMotionDelta(),
): AuthoredRootMotionDelta {
  validateBinding(binding)
  const { sample, rootMotion } = binding
  if (
    !rootMotion.bEnableRootMotion
    || sample.rootMotionPreviousMontageTime === sample.rootMotionMontageTime
  ) {
    return clearDelta(out)
  }

  return extractAuthoredRootMotionDelta(
    rootMotion,
    sample.rootMotionPreviousMontageTime,
    sample.rootMotionMontageTime,
    {
      loop: sample.loopCount > 1,
      translationScale,
    },
    out,
  )
}

const scratchDelta = createAuthoredRootMotionDelta()

/**
 * UAnimInstance's montage root-motion handoff after all retained instances have advanced.
 *
 * Bindings must follow the global MontageInstances insertion order. The slot clock's
 * advanceSlotMontageClock() output guarantees this using stable instanceId values.
 */
export function accumulateSlotMontageRootMotion(
  bindings: readonly SlotMontageRootMotionBinding[],
  options: SlotMontageRootMotionOptions = {},
  out = createRootMotionMovementParams(),
): RootMotionMovementParams {
  clearRootMotionMovementParams(out)

  let previousInstanceId = -1
  for (const binding of bindings) {
    validateBinding(binding)
    if (binding.sample.instanceId <= previousInstanceId) {
      throw new Error('Slot root-motion bindings must preserve MontageInstances insertion order')
    }
    previousInstanceId = binding.sample.instanceId
  }

  const rootMotionMode = options.rootMotionMode ?? 'RootMotionFromMontagesOnly'
  if (
    rootMotionMode === 'NoRootMotionExtraction'
    || rootMotionMode === 'IgnoreRootMotion'
  ) {
    return out
  }

  if (rootMotionMode === 'RootMotionFromMontagesOnly') {
    let rootMotionInstanceId = -1
    for (const binding of bindings) {
      if (!binding.sample.extractRootMotionFromMontagesOnly) continue
      if (rootMotionInstanceId >= 0) {
        throw new Error('Only one RootMotionMontageInstance may extract per update')
      }
      rootMotionInstanceId = binding.sample.instanceId
      extractSlotMontageRootMotionDelta(
        binding,
        options.translationScale,
        scratchDelta,
      )
      accumulateRootMotion(out, scratchDelta)
    }
    return makeUpRootMotionToFullWeight(out)
  }

  if (rootMotionMode !== 'RootMotionFromEverything') {
    throw new Error(`Unknown slot root-motion mode "${rootMotionMode}"`)
  }

  for (const binding of bindings) {
    extractSlotMontageRootMotionDelta(
      binding,
      options.translationScale,
      scratchDelta,
    )
    if (!scratchDelta.valid) continue

    const slotNodeGlobalWeight = options.slotNodeGlobalWeights?.get(
      binding.sample.slotName,
    )
    if (
      slotNodeGlobalWeight === undefined
      || !Number.isFinite(slotNodeGlobalWeight)
      || slotNodeGlobalWeight < 0
    ) {
      throw new Error(
        `RootMotionFromEverything requires a finite global weight for Slot `
        + `"${binding.sample.slotName}"`,
      )
    }
    accumulateRootMotionWithBlend(
      out,
      scratchDelta,
      binding.sample.weight * slotNodeGlobalWeight,
    )
  }
  return makeUpRootMotionToFullWeight(out)
}
