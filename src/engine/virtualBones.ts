import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

const TRANSFORM_EPSILON = 1e-8

export interface VirtualBonePoseScratch {
  readonly boneCount: number
  readonly data: Float32Array
  readonly componentPositions: Float32Array
  readonly componentRotations: Float32Array
  readonly componentScales: Float32Array
  readonly temporaryVector: Float32Array
}

export function createVirtualBonePoseScratch(
  boneCount: number,
): VirtualBonePoseScratch {
  if (!Number.isInteger(boneCount) || boneCount < 0) {
    throw new Error('Virtual-bone scratch requires a valid bone count')
  }
  const transformLength = boneCount * 10
  const data = new Float32Array(transformLength + 3)
  const positionEnd = boneCount * 3
  const rotationEnd = positionEnd + boneCount * 4
  return {
    boneCount,
    data,
    componentPositions: data.subarray(0, positionEnd),
    componentRotations: data.subarray(positionEnd, rotationEnd),
    componentScales: data.subarray(rotationEnd, transformLength),
    temporaryVector: data.subarray(transformLength),
  }
}

function writeNormalizedQuaternion(
  output: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const length = Math.hypot(x, y, z, w)
  if (!Number.isFinite(length) || length <= TRANSFORM_EPSILON) {
    throw new Error('Virtual-bone pose contains an invalid quaternion')
  }
  const inverseLength = 1 / length
  output[offset] = x * inverseLength
  output[offset + 1] = y * inverseLength
  output[offset + 2] = z * inverseLength
  output[offset + 3] = w * inverseLength
}

function writeQuaternionProduct(
  output: Float32Array,
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
    output,
    offset,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  )
}

function rotateVector(
  x: number,
  y: number,
  z: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  output: Float32Array,
) {
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  output[0] = x + qw * tx + qy * tz - qz * ty
  output[1] = y + qw * ty + qz * tx - qx * tz
  output[2] = z + qw * tz + qx * ty - qy * tx
  return output
}

function writeComponentTransform(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
  scratch: VirtualBonePoseScratch,
  bone: number,
) {
  const positionOffset = bone * 3
  const rotationOffset = bone * 4
  const parent = rig.parentIndices[bone]
  if (parent < 0) {
    scratch.componentPositions.set(
      pose.positions.subarray(positionOffset, positionOffset + 3),
      positionOffset,
    )
    writeNormalizedQuaternion(
      scratch.componentRotations,
      rotationOffset,
      pose.rotations[rotationOffset],
      pose.rotations[rotationOffset + 1],
      pose.rotations[rotationOffset + 2],
      pose.rotations[rotationOffset + 3],
    )
    scratch.componentScales.set(
      pose.scales.subarray(positionOffset, positionOffset + 3),
      positionOffset,
    )
    return
  }

  const parentPositionOffset = parent * 3
  const parentRotationOffset = parent * 4
  const scaledX =
    pose.positions[positionOffset]
    * scratch.componentScales[parentPositionOffset]
  const scaledY =
    pose.positions[positionOffset + 1]
    * scratch.componentScales[parentPositionOffset + 1]
  const scaledZ =
    pose.positions[positionOffset + 2]
    * scratch.componentScales[parentPositionOffset + 2]
  const rotated = rotateVector(
    scaledX,
    scaledY,
    scaledZ,
    scratch.componentRotations[parentRotationOffset],
    scratch.componentRotations[parentRotationOffset + 1],
    scratch.componentRotations[parentRotationOffset + 2],
    scratch.componentRotations[parentRotationOffset + 3],
    scratch.temporaryVector,
  )
  scratch.componentPositions[positionOffset] =
    scratch.componentPositions[parentPositionOffset] + rotated[0]
  scratch.componentPositions[positionOffset + 1] =
    scratch.componentPositions[parentPositionOffset + 1] + rotated[1]
  scratch.componentPositions[positionOffset + 2] =
    scratch.componentPositions[parentPositionOffset + 2] + rotated[2]
  writeQuaternionProduct(
    scratch.componentRotations,
    rotationOffset,
    scratch.componentRotations[parentRotationOffset],
    scratch.componentRotations[parentRotationOffset + 1],
    scratch.componentRotations[parentRotationOffset + 2],
    scratch.componentRotations[parentRotationOffset + 3],
    pose.rotations[rotationOffset],
    pose.rotations[rotationOffset + 1],
    pose.rotations[rotationOffset + 2],
    pose.rotations[rotationOffset + 3],
  )
  scratch.componentScales[positionOffset] =
    scratch.componentScales[parentPositionOffset]
    * pose.scales[positionOffset]
  scratch.componentScales[positionOffset + 1] =
    scratch.componentScales[parentPositionOffset + 1]
    * pose.scales[positionOffset + 1]
  scratch.componentScales[positionOffset + 2] =
    scratch.componentScales[parentPositionOffset + 2]
    * pose.scales[positionOffset + 2]
}

/**
 * Generates Unreal virtual-bone locals for one sampled source pose.
 *
 * Virtual bones are generated before pose blending and then behave like ordinary compact-pose
 * bones. They must not be regenerated after LayeredBoneBlend: node 92 intentionally overlays
 * authored virtual-bone locals onto the already-composed hand transforms.
 */
export function refreshVirtualBonePose(
  pose: LocalPoseBuffer,
  rig: RigDefinition,
  scratch: VirtualBonePoseScratch,
): LocalPoseBuffer {
  if (
    pose.boneCount !== rig.boneCount
    || scratch.boneCount !== rig.boneCount
  ) {
    throw new Error('Virtual-bone pose input has an incompatible bone count')
  }

  for (let bone = 0; bone < rig.physicalBoneCount; bone++) {
    writeComponentTransform(pose, rig, scratch, bone)
  }

  for (const virtualBone of rig.virtualBones) {
    const bone = virtualBone.boneIndex
    const positionOffset = bone * 3
    const rotationOffset = bone * 4
    const sourcePositionOffset = virtualBone.sourceBoneIndex * 3
    const sourceRotationOffset = virtualBone.sourceBoneIndex * 4
    const targetPositionOffset = virtualBone.targetBoneIndex * 3
    const targetRotationOffset = virtualBone.targetBoneIndex * 4

    const sourceScaleX = scratch.componentScales[sourcePositionOffset]
    const sourceScaleY = scratch.componentScales[sourcePositionOffset + 1]
    const sourceScaleZ = scratch.componentScales[sourcePositionOffset + 2]
    if (
      Math.abs(sourceScaleX) <= TRANSFORM_EPSILON
      || Math.abs(sourceScaleY) <= TRANSFORM_EPSILON
      || Math.abs(sourceScaleZ) <= TRANSFORM_EPSILON
    ) {
      throw new Error(
        `Virtual bone "${virtualBone.name}" has a zero source scale`,
      )
    }

    const relativePosition = rotateVector(
      scratch.componentPositions[targetPositionOffset]
        - scratch.componentPositions[sourcePositionOffset],
      scratch.componentPositions[targetPositionOffset + 1]
        - scratch.componentPositions[sourcePositionOffset + 1],
      scratch.componentPositions[targetPositionOffset + 2]
        - scratch.componentPositions[sourcePositionOffset + 2],
      -scratch.componentRotations[sourceRotationOffset],
      -scratch.componentRotations[sourceRotationOffset + 1],
      -scratch.componentRotations[sourceRotationOffset + 2],
      scratch.componentRotations[sourceRotationOffset + 3],
      scratch.temporaryVector,
    )
    pose.positions[positionOffset] = relativePosition[0] / sourceScaleX
    pose.positions[positionOffset + 1] = relativePosition[1] / sourceScaleY
    pose.positions[positionOffset + 2] = relativePosition[2] / sourceScaleZ
    writeQuaternionProduct(
      pose.rotations,
      rotationOffset,
      -scratch.componentRotations[sourceRotationOffset],
      -scratch.componentRotations[sourceRotationOffset + 1],
      -scratch.componentRotations[sourceRotationOffset + 2],
      scratch.componentRotations[sourceRotationOffset + 3],
      scratch.componentRotations[targetRotationOffset],
      scratch.componentRotations[targetRotationOffset + 1],
      scratch.componentRotations[targetRotationOffset + 2],
      scratch.componentRotations[targetRotationOffset + 3],
    )
    pose.scales[positionOffset] =
      scratch.componentScales[targetPositionOffset] / sourceScaleX
    pose.scales[positionOffset + 1] =
      scratch.componentScales[targetPositionOffset + 1] / sourceScaleY
    pose.scales[positionOffset + 2] =
      scratch.componentScales[targetPositionOffset + 2] / sourceScaleZ
    writeComponentTransform(pose, rig, scratch, bone)
  }

  return pose
}
