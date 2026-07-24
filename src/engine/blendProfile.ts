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
 * WeightFactor multiplies the already-shaped transition alpha and clamps it per bone. These masks
 * can be passed directly to the normalized pose accumulator: each bone always sums to one.
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
  for (let bone = 0; bone < profile.blendScales.length; bone++) {
    const incomingWeight = Math.max(
      0,
      Math.min(1, alpha * profile.blendScales[bone]),
    )
    incoming[bone] = incomingWeight
    outgoing[bone] = 1 - incomingWeight
  }
}
