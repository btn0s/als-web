import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

export interface RootMotionDelta {
  readonly translation: Float32Array
  readonly rotation: Float32Array
  valid: boolean
}

export interface RootMotionExtractor {
  readonly rootBoneIndex: number
  readonly previousPosition: Float32Array
  readonly previousRotation: Float32Array
  readonly delta: RootMotionDelta
  hasPrevious: boolean
}

export function createRootMotionExtractor(
  rig: RigDefinition,
  rootBoneIndex = rig.parentIndices.findIndex((parent) => parent < 0),
): RootMotionExtractor {
  if (rootBoneIndex < 0 || rootBoneIndex >= rig.boneCount) {
    throw new Error('Root-motion extraction requires a valid root bone')
  }
  return {
    rootBoneIndex,
    previousPosition: new Float32Array(3),
    previousRotation: new Float32Array([0, 0, 0, 1]),
    delta: {
      translation: new Float32Array(3),
      rotation: new Float32Array([0, 0, 0, 1]),
      valid: false,
    },
    hasPrevious: false,
  }
}

export function resetRootMotionExtractor(extractor: RootMotionExtractor) {
  extractor.hasPrevious = false
  extractor.delta.translation.fill(0)
  extractor.delta.rotation[0] = 0
  extractor.delta.rotation[1] = 0
  extractor.delta.rotation[2] = 0
  extractor.delta.rotation[3] = 1
  extractor.delta.valid = false
}

/**
 * Extracts the local root delta from the finalized frame pose. ALS's current clips are in-place,
 * so integration only exposes this hook; movement can consume and remove the delta later.
 */
export function extractRootMotionDelta(
  extractor: RootMotionExtractor,
  pose: LocalPoseBuffer,
): RootMotionDelta {
  const p = extractor.rootBoneIndex * 3
  const q = extractor.rootBoneIndex * 4
  const delta = extractor.delta

  if (!extractor.hasPrevious) {
    delta.translation.fill(0)
    delta.rotation[0] = 0
    delta.rotation[1] = 0
    delta.rotation[2] = 0
    delta.rotation[3] = 1
    delta.valid = false
    extractor.hasPrevious = true
  } else {
    delta.translation[0] = pose.positions[p] - extractor.previousPosition[0]
    delta.translation[1] = pose.positions[p + 1] - extractor.previousPosition[1]
    delta.translation[2] = pose.positions[p + 2] - extractor.previousPosition[2]

    const cx = pose.rotations[q]
    const cy = pose.rotations[q + 1]
    const cz = pose.rotations[q + 2]
    const cw = pose.rotations[q + 3]
    const px = -extractor.previousRotation[0]
    const py = -extractor.previousRotation[1]
    const pz = -extractor.previousRotation[2]
    const pw = extractor.previousRotation[3]
    delta.rotation[0] = cw * px + cx * pw + cy * pz - cz * py
    delta.rotation[1] = cw * py - cx * pz + cy * pw + cz * px
    delta.rotation[2] = cw * pz + cx * py - cy * px + cz * pw
    delta.rotation[3] = cw * pw - cx * px - cy * py - cz * pz
    delta.valid = true
  }

  extractor.previousPosition[0] = pose.positions[p]
  extractor.previousPosition[1] = pose.positions[p + 1]
  extractor.previousPosition[2] = pose.positions[p + 2]
  extractor.previousRotation[0] = pose.rotations[q]
  extractor.previousRotation[1] = pose.rotations[q + 1]
  extractor.previousRotation[2] = pose.rotations[q + 2]
  extractor.previousRotation[3] = pose.rotations[q + 3]
  return delta
}
