import * as THREE from 'three'
import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

export interface PoseApplicator {
  readonly bones: readonly THREE.Bone[]
}

/** Resolves the rig's scene references once; frame application never traverses the graph. */
export function createPoseApplicator(
  skeletonRoot: THREE.Object3D,
  rig: RigDefinition,
): PoseApplicator {
  const byName = new Map<string, THREE.Bone>()
  skeletonRoot.traverse((object) => {
    if (object instanceof THREE.Bone && !byName.has(object.name)) byName.set(object.name, object)
  })

  for (const virtualBone of rig.virtualBones) {
    const existing = byName.get(virtualBone.name)
    if (existing) {
      if (
        existing.userData.alsVirtualBone === true
        && existing.parent?.name === virtualBone.sourceBoneName
      ) {
        continue
      }
      throw new Error(
        `Rig virtual bone "${virtualBone.name}" conflicts with the skeleton`,
      )
    }
    const parent = byName.get(virtualBone.sourceBoneName)
    if (!parent) {
      throw new Error(
        `Rig virtual bone "${virtualBone.name}" has missing scene parent `
        + `"${virtualBone.sourceBoneName}"`,
      )
    }
    const bone = new THREE.Bone()
    bone.name = virtualBone.name
    bone.userData.alsVirtualBone = true
    parent.add(bone)
    byName.set(bone.name, bone)
  }

  const bones = rig.boneNames.map((name) => {
    const bone = byName.get(name)
    if (!bone) throw new Error(`Rig bone "${name}" is missing from the skeleton`)
    return bone
  })
  return { bones }
}

/** Writes every local transform exactly once in rig order. */
export function applyPose(applicator: PoseApplicator, pose: LocalPoseBuffer) {
  if (applicator.bones.length !== pose.boneCount) {
    throw new Error('Pose applicator has an incompatible bone count')
  }

  for (let boneIndex = 0; boneIndex < pose.boneCount; boneIndex++) {
    const bone = applicator.bones[boneIndex]
    const p = boneIndex * 3
    const q = boneIndex * 4
    bone.position.set(pose.positions[p], pose.positions[p + 1], pose.positions[p + 2])
    bone.quaternion.set(
      pose.rotations[q],
      pose.rotations[q + 1],
      pose.rotations[q + 2],
      pose.rotations[q + 3],
    )
    bone.scale.set(pose.scales[p], pose.scales[p + 1], pose.scales[p + 2])
  }
}
