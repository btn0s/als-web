import type { BoneMask } from './blend'
import type { RigDefinition } from './rig'

export interface BranchFilter {
  readonly boneName: string
  readonly blendDepth: number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function descendantDepth(
  rig: RigDefinition,
  boneIndex: number,
  ancestorIndex: number,
) {
  let current = boneIndex
  let depth = 0
  while (current >= 0) {
    if (current === ancestorIndex) return depth
    current = rig.parentIndices[current]
    depth++
  }
  return -1
}

/**
 * Compiles Unreal's FBranchFilter list into the per-bone alpha mask consumed by
 * FAnimNode_LayeredBoneBlend.
 *
 * A zero BlendDepth affects the whole branch at full weight. Positive depths ramp from
 * `1 / BlendDepth` on the named bone to one over that many hierarchy levels; negative depths
 * subtract the same ramp and are how ALS excludes the thigh branches from its pelvis layer.
 * Filters are applied in authored order and clamped after each contribution.
 */
export function compileBranchFilterMask(
  rig: RigDefinition,
  filters: readonly BranchFilter[],
  output: BoneMask = new Float32Array(rig.boneCount),
): BoneMask {
  if (output.length !== rig.boneCount) {
    throw new Error('Branch-filter output has an incompatible bone count')
  }
  output.fill(0)

  for (const filter of filters) {
    if (!Number.isInteger(filter.blendDepth)) {
      throw new Error('Branch-filter BlendDepth must be an integer')
    }
    const ancestorIndex = rig.boneNames.indexOf(filter.boneName)
    // Unreal can target virtual bones that are not materialized in this web rig. Their physical
    // sibling filters still compile normally; a missing target contributes no compact-pose bones.
    if (ancestorIndex < 0) continue

    const direction = filter.blendDepth < 0 ? -1 : 1
    const rampDepth = Math.abs(filter.blendDepth)
    for (let bone = 0; bone < rig.boneCount; bone++) {
      const depth = descendantDepth(rig, bone, ancestorIndex)
      if (depth < 0) continue
      const contribution = rampDepth === 0
        ? direction
        : direction * Math.min(1, (depth + 1) / rampDepth)
      output[bone] = clamp01(output[bone] + contribution)
    }
  }

  return output
}
