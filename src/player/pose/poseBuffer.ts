import type { RigDefinition } from './rig'

/** Structure-of-arrays views backed by one allocation. */
export interface LocalPoseBuffer {
  readonly boneCount: number
  readonly data: Float32Array
  readonly positions: Float32Array
  readonly rotations: Float32Array
  readonly scales: Float32Array
}

export function createPoseBuffer(boneCount: number): LocalPoseBuffer {
  const data = new Float32Array(boneCount * 10)
  const positionEnd = boneCount * 3
  const rotationEnd = positionEnd + boneCount * 4
  return {
    boneCount,
    data,
    positions: data.subarray(0, positionEnd),
    rotations: data.subarray(positionEnd, rotationEnd),
    scales: data.subarray(rotationEnd),
  }
}

function assertCompatible(a: LocalPoseBuffer, b: LocalPoseBuffer) {
  if (a.boneCount !== b.boneCount) {
    throw new Error(`Pose bone-count mismatch: ${a.boneCount} !== ${b.boneCount}`)
  }
}

export function copyPose(source: LocalPoseBuffer, out: LocalPoseBuffer): LocalPoseBuffer {
  assertCompatible(source, out)
  out.data.set(source.data)
  return out
}

export function resetPoseToReference(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
): LocalPoseBuffer {
  if (pose.boneCount !== rig.boneCount) {
    throw new Error(`Pose/rig bone-count mismatch: ${pose.boneCount} !== ${rig.boneCount}`)
  }
  pose.positions.set(rig.referencePositions)
  pose.rotations.set(rig.referenceRotations)
  pose.scales.set(rig.referenceScales)
  return pose
}

/** Identity for three.js additive clips: zero translation/scale delta and identity rotation. */
export function resetPoseToAdditiveIdentity(pose: LocalPoseBuffer): LocalPoseBuffer {
  pose.data.fill(0)
  for (let i = 3; i < pose.rotations.length; i += 4) pose.rotations[i] = 1
  return pose
}
