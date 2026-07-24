import type { BoneMask } from './blend'
import type { RigDefinition } from './rig'

export interface WeightBlendProfileEntry {
  readonly bone: string
  readonly blendScale: number
}

export interface WeightBlendProfile {
  readonly mode: 'WeightFactor'
  readonly entries: readonly WeightBlendProfileEntry[]
}

export interface CompiledWeightBlendProfile {
  readonly mode: 'WeightFactor'
  /** One weight multiplier per rig bone; unlisted bones retain Unreal's default factor of 1. */
  readonly blendScales: BoneMask
}

/**
 * Compiles UBlendProfile's WeightFactor mode for the owned pose runtime.
 *
 * ALS's editor utility expands descendant choices into the serialized profile entries, so the
 * extracted table is already the complete per-bone source of truth.
 */
export function compileWeightBlendProfile(
  rig: RigDefinition,
  profile: WeightBlendProfile,
): CompiledWeightBlendProfile {
  const blendScales = new Float32Array(rig.boneCount)
  blendScales.fill(1)
  const boneIndices = new Map(
    rig.boneNames.map((bone, index) => [bone, index] as const),
  )

  for (const entry of profile.entries) {
    const boneIndex = boneIndices.get(entry.bone)
    if (boneIndex === undefined) {
      throw new Error(
        `Weight blend profile references missing bone "${entry.bone}"`,
      )
    }
    if (!Number.isFinite(entry.blendScale) || entry.blendScale < 0) {
      throw new Error(
        `Weight blend profile has invalid scale for "${entry.bone}"`,
      )
    }
    blendScales[boneIndex] = entry.blendScale
  }

  return {
    mode: profile.mode,
    blendScales,
  }
}

/**
 * Produces complementary outgoing/incoming masks for a state transition.
 *
 * This mirrors UBlendProfile::CalculateBoneWeight(WeightFactor) followed by
 * FBlendSampleData::NormalizeDataWeight(): the incoming sample multiplies by the factor, the
 * outgoing sample divides by it, both retain Unreal's non-zero animation-weight floor, and the
 * pair is normalized per bone.
 */
export function resolveWeightBlendProfileMasks(
  profile: CompiledWeightBlendProfile,
  transitionAlpha: number,
  outgoing: BoneMask,
  incoming: BoneMask,
): void {
  if (
    outgoing.length !== profile.blendScales.length
    || incoming.length !== profile.blendScales.length
  ) {
    throw new Error('Weight blend profile mask has an incompatible bone count')
  }

  const alpha = Math.max(0, Math.min(1, transitionAlpha))
  const zeroAnimWeightThreshold = 0.00001
  for (let bone = 0; bone < profile.blendScales.length; bone++) {
    const factor = profile.blendScales[bone]
    // UBlendProfile only allocates PerBoneBlendData for authored profile entries. A scale of one
    // is the serialized default and is removed from the profile, so those bones use the scalar
    // transition weights directly in EvaluateTransitionStandardBlendInternal().
    if (factor === 1) {
      incoming[bone] = alpha
      outgoing[bone] = 1 - alpha
      continue
    }
    const incomingWeight = Math.max(
      alpha * factor,
      zeroAnimWeightThreshold,
    )
    const outgoingWeight = Math.max(
      factor > zeroAnimWeightThreshold
        ? (1 - alpha) / factor
        : 1,
      zeroAnimWeightThreshold,
    )
    const totalWeight = incomingWeight + outgoingWeight
    incoming[bone] = incomingWeight / totalWeight
    outgoing[bone] = outgoingWeight / totalWeight
  }
}
