import type { LocalPoseBuffer } from './poseBuffer'
import { copyPose } from './poseBuffer'
import type { RigDefinition } from './rig'

const QUATERNION_EPSILON = 1e-8

/**
 * Reusable component-rotation storage for one two-pose FAnimNode_LayeredBoneBlend operation.
 *
 * three.js does not provide Unreal's animation-runtime node. The component-space path mirrors its
 * transform-atom operations: accumulate local rotations down the hierarchy, apply
 * shortest-hemisphere normalized linear blending, then re-localize against the blended component
 * parent. Translation and scale deliberately remain local-space channels.
 */
export interface LayeredBoneBlendScratch {
  readonly boneCount: number
  readonly data: Float32Array
  readonly baseComponentRotations: Float32Array
  readonly blendComponentRotations: Float32Array
  readonly outputComponentRotations: Float32Array
}

export function createLayeredBoneBlendScratch(
  boneCount: number,
): LayeredBoneBlendScratch {
  if (!Number.isInteger(boneCount) || boneCount < 0) {
    throw new Error('Layered-bone-blend scratch requires a valid bone count')
  }
  const data = new Float32Array(boneCount * 12)
  const rotationLength = boneCount * 4
  return {
    boneCount,
    data,
    baseComponentRotations: data.subarray(0, rotationLength),
    blendComponentRotations: data.subarray(
      rotationLength,
      rotationLength * 2,
    ),
    outputComponentRotations: data.subarray(rotationLength * 2),
  }
}

function assertCompatible(
  base: LocalPoseBuffer,
  blendPose: LocalPoseBuffer,
  rig: RigDefinition,
  mask: Float32Array,
  scratch: LayeredBoneBlendScratch,
) {
  const boneCount = rig.boneCount
  if (
    base.boneCount !== boneCount
    || blendPose.boneCount !== boneCount
    || scratch.boneCount !== boneCount
    || mask.length !== boneCount
    || rig.parentIndices.length !== boneCount
    || base.positions.length !== boneCount * 3
    || base.rotations.length !== boneCount * 4
    || base.scales.length !== boneCount * 3
    || blendPose.positions.length !== boneCount * 3
    || blendPose.rotations.length !== boneCount * 4
    || blendPose.scales.length !== boneCount * 3
    || scratch.baseComponentRotations.length !== boneCount * 4
    || scratch.blendComponentRotations.length !== boneCount * 4
    || scratch.outputComponentRotations.length !== boneCount * 4
  ) {
    throw new Error('Layered-bone-blend input has an incompatible bone count')
  }
  for (let bone = 0; bone < boneCount; bone++) {
    const parent = rig.parentIndices[bone]
    if (parent < -1 || parent >= bone) {
      throw new Error(
        `Layered-bone-blend parent ${parent} must precede bone ${bone}`,
      )
    }
    if (!Number.isFinite(mask[bone])) {
      throw new Error('Layered-bone-blend mask values must be finite')
    }
  }
}

function writeNormalizedQuaternion(
  out: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const length = Math.hypot(x, y, z, w)
  if (!Number.isFinite(length) || length <= QUATERNION_EPSILON) {
    throw new Error(
      'Layered-bone-blend rotations must be finite non-zero quaternions',
    )
  }
  const inverseLength = 1 / length
  out[offset] = x * inverseLength
  out[offset + 1] = y * inverseLength
  out[offset + 2] = z * inverseLength
  out[offset + 3] = w * inverseLength
}

function writeQuaternionProduct(
  out: Float32Array,
  offset: number,
  ax: number,
  ay: number,
  az: number,
  aw: number,
  bx: number,
  by: number,
  bz: number,
  bw: number,
) {
  writeNormalizedQuaternion(
    out,
    offset,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  )
}

function accumulateComponentRotations(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
  out: Float32Array,
) {
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const offset = bone * 4
    const parent = rig.parentIndices[bone]
    if (parent < 0) {
      writeNormalizedQuaternion(
        out,
        offset,
        pose.rotations[offset],
        pose.rotations[offset + 1],
        pose.rotations[offset + 2],
        pose.rotations[offset + 3],
      )
      continue
    }
    const parentOffset = parent * 4
    writeQuaternionProduct(
      out,
      offset,
      out[parentOffset],
      out[parentOffset + 1],
      out[parentOffset + 2],
      out[parentOffset + 3],
      pose.rotations[offset],
      pose.rotations[offset + 1],
      pose.rotations[offset + 2],
      pose.rotations[offset + 3],
    )
  }
}

function blendQuaternionAtom(
  out: Float32Array,
  offset: number,
  a: Float32Array,
  b: Float32Array,
  alpha: number,
) {
  if (alpha <= 0) {
    out[offset] = a[offset]
    out[offset + 1] = a[offset + 1]
    out[offset + 2] = a[offset + 2]
    out[offset + 3] = a[offset + 3]
    return
  }
  if (alpha >= 1) {
    out[offset] = b[offset]
    out[offset + 1] = b[offset + 1]
    out[offset + 2] = b[offset + 2]
    out[offset + 3] = b[offset + 3]
    return
  }
  let bx = b[offset]
  let by = b[offset + 1]
  let bz = b[offset + 2]
  let bw = b[offset + 3]
  const ax = a[offset]
  const ay = a[offset + 1]
  const az = a[offset + 2]
  const aw = a[offset + 3]
  const dot = ax * bx + ay * by + az * bz + aw * bw
  if (dot < 0) {
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }
  const aWeight = 1 - alpha
  const bWeight = alpha
  writeNormalizedQuaternion(
    out,
    offset,
    ax * aWeight + bx * bWeight,
    ay * aWeight + by * bWeight,
    az * aWeight + bz * bWeight,
    aw * aWeight + bw * bWeight,
  )
}

function effectiveAlpha(
  weight: number,
  mask: Float32Array,
  bone: number,
) {
  return Math.max(0, Math.min(1, weight * mask[bone]))
}

function blendLocalChannels(
  base: LocalPoseBuffer,
  blendPose: LocalPoseBuffer,
  weight: number,
  mask: Float32Array,
) {
  for (let bone = 0; bone < base.boneCount; bone++) {
    const alpha = effectiveAlpha(weight, mask, bone)
    const positionOffset = bone * 3
    for (let component = 0; component < 3; component++) {
      const offset = positionOffset + component
      base.positions[offset] += (
        blendPose.positions[offset] - base.positions[offset]
      ) * alpha
      base.scales[offset] += (
        blendPose.scales[offset] - base.scales[offset]
      ) * alpha
    }
  }
}

function blendLocalRotations(
  base: LocalPoseBuffer,
  blendPose: LocalPoseBuffer,
  weight: number,
  mask: Float32Array,
  scratch: LayeredBoneBlendScratch,
) {
  // Use scratch output so this remains correct when base and blendPose alias.
  for (let bone = 0; bone < base.boneCount; bone++) {
    const offset = bone * 4
    blendQuaternionAtom(
      scratch.outputComponentRotations,
      offset,
      base.rotations,
      blendPose.rotations,
      effectiveAlpha(weight, mask, bone),
    )
  }
  base.rotations.set(scratch.outputComponentRotations)
}

function blendMeshSpaceRotations(
  base: LocalPoseBuffer,
  blendPose: LocalPoseBuffer,
  rig: RigDefinition,
  weight: number,
  mask: Float32Array,
  scratch: LayeredBoneBlendScratch,
) {
  accumulateComponentRotations(
    base,
    rig,
    scratch.baseComponentRotations,
  )
  accumulateComponentRotations(
    blendPose,
    rig,
    scratch.blendComponentRotations,
  )
  for (let bone = 0; bone < rig.boneCount; bone++) {
    blendQuaternionAtom(
      scratch.outputComponentRotations,
      bone * 4,
      scratch.baseComponentRotations,
      scratch.blendComponentRotations,
      effectiveAlpha(weight, mask, bone),
    )
  }

  for (let bone = 0; bone < rig.boneCount; bone++) {
    const offset = bone * 4
    const parent = rig.parentIndices[bone]
    if (parent < 0) {
      base.rotations[offset] = scratch.outputComponentRotations[offset]
      base.rotations[offset + 1] =
        scratch.outputComponentRotations[offset + 1]
      base.rotations[offset + 2] =
        scratch.outputComponentRotations[offset + 2]
      base.rotations[offset + 3] =
        scratch.outputComponentRotations[offset + 3]
      continue
    }
    const parentOffset = parent * 4
    writeQuaternionProduct(
      base.rotations,
      offset,
      -scratch.outputComponentRotations[parentOffset],
      -scratch.outputComponentRotations[parentOffset + 1],
      -scratch.outputComponentRotations[parentOffset + 2],
      scratch.outputComponentRotations[parentOffset + 3],
      scratch.outputComponentRotations[offset],
      scratch.outputComponentRotations[offset + 1],
      scratch.outputComponentRotations[offset + 2],
      scratch.outputComponentRotations[offset + 3],
    )
  }
}

/**
 * Applies one two-pose UE FAnimNode_LayeredBoneBlend operation in place.
 *
 * `mask` is the node's already-compiled float per-bone weight. ALS sets
 * bMeshSpaceScaleBlend=false on every recovered node; requesting true is rejected rather than
 * silently approximated.
 */
export function applyLayeredBoneBlend(
  base: LocalPoseBuffer,
  blendPose: LocalPoseBuffer,
  rig: RigDefinition,
  weight: number,
  mask: Float32Array,
  meshSpaceRotationBlend: boolean,
  scratch: LayeredBoneBlendScratch,
  meshSpaceScaleBlend = false,
): LocalPoseBuffer {
  if (meshSpaceScaleBlend) {
    throw new Error('Mesh-space scale blending is not supported')
  }
  if (!Number.isFinite(weight)) {
    throw new Error('Layered-bone-blend weight must be finite')
  }
  assertCompatible(base, blendPose, rig, mask, scratch)

  let allZero = true
  let allOne = true
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const alpha = effectiveAlpha(weight, mask, bone)
    allZero &&= alpha === 0
    allOne &&= alpha === 1
  }
  if (allZero) return base
  if (allOne) return copyPose(blendPose, base)

  if (meshSpaceRotationBlend) {
    blendMeshSpaceRotations(
      base,
      blendPose,
      rig,
      weight,
      mask,
      scratch,
    )
  } else {
    blendLocalRotations(base, blendPose, weight, mask, scratch)
  }
  blendLocalChannels(base, blendPose, weight, mask)
  return base
}
