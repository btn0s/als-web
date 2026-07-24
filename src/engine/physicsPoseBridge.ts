import * as THREE from 'three'
import {
  copyPose,
  createPoseBuffer,
} from './poseBuffer'
import type { LocalPoseBuffer } from './poseBuffer'
import {
  createRigDefinition,
} from './rig'
import type {
  RigDefinition,
  VirtualBoneDefinition,
} from './rig'
import {
  createPoseApplicator,
} from './applyPose'
import type { PoseApplicator } from './applyPose'

export interface PhysicsBoneWorldPose {
  readonly translation: Readonly<{
    x: number
    y: number
    z: number
  }>
  readonly rotation: Readonly<{
    x: number
    y: number
    z: number
    w: number
  }>
}

export interface MutablePhysicsBoneWorldPose {
  readonly translation: {
    x: number
    y: number
    z: number
  }
  readonly rotation: {
    x: number
    y: number
    z: number
    w: number
  }
}

export interface PhysicsPoseBridge {
  readonly rig: RigDefinition
  readonly applicator: PoseApplicator
  captureWorldPoses(
    boneNames: readonly string[],
    out?: Map<string, MutablePhysicsBoneWorldPose>,
  ): Map<string, MutablePhysicsBoneWorldPose>
  resolveWorldPoses(
    localPose: LocalPoseBuffer,
    boneNames: readonly string[],
    out?: Map<string, MutablePhysicsBoneWorldPose>,
  ): Map<string, MutablePhysicsBoneWorldPose>
  composeLocalPose(
    animationPose: LocalPoseBuffer,
    physicsWorldPoses: ReadonlyMap<string, PhysicsBoneWorldPose>,
    out?: LocalPoseBuffer,
  ): LocalPoseBuffer
}

function writeWorldPose(
  bone: THREE.Bone,
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  out: MutablePhysicsBoneWorldPose,
) {
  bone.getWorldPosition(position)
  bone.getWorldQuaternion(rotation)
  out.translation.x = position.x
  out.translation.y = position.y
  out.translation.z = position.z
  out.rotation.x = rotation.x
  out.rotation.y = rotation.y
  out.rotation.z = rotation.z
  out.rotation.w = rotation.w
}

function createMutableWorldPose(): MutablePhysicsBoneWorldPose {
  return {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  }
}

function assertCompatiblePose(
  rig: Readonly<RigDefinition>,
  pose: Readonly<LocalPoseBuffer>,
) {
  if (pose.boneCount !== rig.boneCount) {
    throw new Error(
      `Physics pose bridge bone-count mismatch: `
      + `${pose.boneCount} !== ${rig.boneCount}`,
    )
  }
}

/**
 * Converts between the renderer skeleton and skeletal-physics world poses.
 *
 * UE evaluates animation in local pose space, solves bodies in world space,
 * then converts simulated bones back to locals in parent-before-child order.
 * Non-simulated bones retain the current animation target and therefore follow
 * their closest simulated ancestor. This bridge performs that conversion
 * without writing the THREE.Bone graph; the animation applicator remains the
 * sole skeleton writer.
 *
 * This is transform plumbing, not a replacement for Chaos. It preserves the
 * exact poses supplied by a physics backend; any Rapier backend that cannot
 * reproduce PA_Als constraint frames, masses, drives, or solver behavior must
 * remain explicitly NonParity at that backend seam.
 */
export function createPhysicsPoseBridge(
  skeletonRoot: THREE.Object3D,
  virtualBoneDefinitions: readonly VirtualBoneDefinition[] = [],
): PhysicsPoseBridge {
  const rig = createRigDefinition(
    skeletonRoot,
    virtualBoneDefinitions,
  )
  const applicator = createPoseApplicator(skeletonRoot, rig)
  const indexByName = new Map<string, number>()
  for (let index = 0; index < applicator.bones.length; index++) {
    indexByName.set(rig.boneNames[index], index)
  }

  skeletonRoot.updateWorldMatrix(true, true)

  /*
   * RigDefinition skips non-bone scene nodes when assigning parent indices.
   * Preserve any static transform between the closest parent bone and the
   * immediate Object3D parent so imported armature wrappers remain exact.
   */
  const intermediateParentTransforms = Array.from(
    { length: rig.boneCount },
    () => new THREE.Matrix4(),
  )
  const inverse = new THREE.Matrix4()
  for (
    let boneIndex = 0;
    boneIndex < rig.physicalBoneCount;
    boneIndex++
  ) {
    const bone = applicator.bones[boneIndex]
    const parentBoneIndex = rig.parentIndices[boneIndex]
    if (parentBoneIndex < 0) continue
    const parentBone = applicator.bones[parentBoneIndex]
    const immediateParent = bone.parent
    if (!immediateParent || immediateParent === parentBone) continue
    intermediateParentTransforms[boneIndex].multiplyMatrices(
      inverse.copy(parentBone.matrixWorld).invert(),
      immediateParent.matrixWorld,
    )
  }

  const worldTransforms = Array.from(
    { length: rig.boneCount },
    () => new THREE.Matrix4(),
  )
  const parentTransform = new THREE.Matrix4()
  const localTransform = new THREE.Matrix4()
  const baseWorldTransform = new THREE.Matrix4()
  const physicsWorldTransform = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const worldScale = new THREE.Vector3()
  const capturePosition = new THREE.Vector3()
  const captureRotation = new THREE.Quaternion()
  const aliasedPoseScratch = createPoseBuffer(rig.boneCount)
  const resolvedPoseScratch = createPoseBuffer(rig.boneCount)
  const noPhysicsWorldPoses =
    new Map<string, PhysicsBoneWorldPose>()
  const virtualBoneByIndex = new Map(
    rig.virtualBones.map((definition) => [
      definition.boneIndex,
      definition,
    ]),
  )

  function immediateParentWorldTransform(
    boneIndex: number,
    out: THREE.Matrix4,
  ) {
    const parentBoneIndex = rig.parentIndices[boneIndex]
    if (parentBoneIndex >= 0) {
      return out.multiplyMatrices(
        worldTransforms[parentBoneIndex],
        intermediateParentTransforms[boneIndex],
      )
    }

    const parent = applicator.bones[boneIndex].parent
    if (!parent) return out.identity()
    parent.updateWorldMatrix(true, false)
    return out.copy(parent.matrixWorld)
  }

  function writeLocalTransform(
    pose: LocalPoseBuffer,
    boneIndex: number,
    matrix: THREE.Matrix4,
  ) {
    matrix.decompose(position, rotation, scale)
    position.toArray(pose.positions, boneIndex * 3)
    rotation.normalize().toArray(pose.rotations, boneIndex * 4)
    scale.toArray(pose.scales, boneIndex * 3)
  }

  function composeLocalPose(
    animationPose: LocalPoseBuffer,
    physicsWorldPoses: ReadonlyMap<string, PhysicsBoneWorldPose>,
    out = createPoseBuffer(rig.boneCount),
  ) {
    assertCompatiblePose(rig, animationPose)
    assertCompatiblePose(rig, out)
    const sourcePose = animationPose.data.buffer === out.data.buffer
      ? copyPose(animationPose, aliasedPoseScratch)
      : animationPose
    copyPose(sourcePose, out)
    skeletonRoot.updateWorldMatrix(true, false)

    for (let boneIndex = 0; boneIndex < rig.boneCount; boneIndex++) {
      const virtualBone = virtualBoneByIndex.get(boneIndex)
      if (virtualBone) {
        const sourceWorld =
          worldTransforms[virtualBone.sourceBoneIndex]
        const targetWorld =
          worldTransforms[virtualBone.targetBoneIndex]
        localTransform.multiplyMatrices(
          inverse.copy(sourceWorld).invert(),
          targetWorld,
        )
        writeLocalTransform(out, boneIndex, localTransform)
        worldTransforms[boneIndex].copy(targetWorld)
        continue
      }

      immediateParentWorldTransform(boneIndex, parentTransform)
      const positionOffset = boneIndex * 3
      const rotationOffset = boneIndex * 4
      position.fromArray(sourcePose.positions, positionOffset)
      rotation
        .fromArray(sourcePose.rotations, rotationOffset)
        .normalize()
      scale.fromArray(sourcePose.scales, positionOffset)
      localTransform.compose(position, rotation, scale)
      baseWorldTransform.multiplyMatrices(
        parentTransform,
        localTransform,
      )

      const physicsPose = physicsWorldPoses.get(
        rig.boneNames[boneIndex],
      )
      if (!physicsPose) {
        worldTransforms[boneIndex].copy(baseWorldTransform)
        continue
      }

      baseWorldTransform.decompose(position, rotation, worldScale)
      position.set(
        physicsPose.translation.x,
        physicsPose.translation.y,
        physicsPose.translation.z,
      )
      rotation.set(
        physicsPose.rotation.x,
        physicsPose.rotation.y,
        physicsPose.rotation.z,
        physicsPose.rotation.w,
      ).normalize()
      physicsWorldTransform.compose(position, rotation, worldScale)
      localTransform.multiplyMatrices(
        inverse.copy(parentTransform).invert(),
        physicsWorldTransform,
      )
      writeLocalTransform(out, boneIndex, localTransform)
      worldTransforms[boneIndex].copy(physicsWorldTransform)
    }
    return out
  }

  function retainedOutput(
    boneNames: readonly string[],
    out: Map<string, MutablePhysicsBoneWorldPose>,
  ) {
    const retainedNames = new Set(boneNames)
    for (const name of out.keys()) {
      if (!retainedNames.has(name)) out.delete(name)
    }
  }

  function requirePhysicalBoneIndex(name: string) {
    const boneIndex = indexByName.get(name)
    if (
      boneIndex === undefined
      || boneIndex >= rig.physicalBoneCount
    ) {
      throw new Error(
        `Physics asset references missing bone "${name}"`,
      )
    }
    return boneIndex
  }

  function captureWorldPoses(
    boneNames: readonly string[],
    out = new Map<string, MutablePhysicsBoneWorldPose>(),
  ) {
    skeletonRoot.updateWorldMatrix(true, true)
    retainedOutput(boneNames, out)
    for (const name of boneNames) {
      const boneIndex = requirePhysicalBoneIndex(name)
      const pose = out.get(name) ?? createMutableWorldPose()
      writeWorldPose(
        applicator.bones[boneIndex],
        capturePosition,
        captureRotation,
        pose,
      )
      out.set(name, pose)
    }
    return out
  }

  function resolveWorldPoses(
    localPose: LocalPoseBuffer,
    boneNames: readonly string[],
    out = new Map<string, MutablePhysicsBoneWorldPose>(),
  ) {
    composeLocalPose(
      localPose,
      noPhysicsWorldPoses,
      resolvedPoseScratch,
    )
    retainedOutput(boneNames, out)
    for (const name of boneNames) {
      const boneIndex = requirePhysicalBoneIndex(name)
      const pose = out.get(name) ?? createMutableWorldPose()
      worldTransforms[boneIndex].decompose(
        capturePosition,
        captureRotation,
        scale,
      )
      pose.translation.x = capturePosition.x
      pose.translation.y = capturePosition.y
      pose.translation.z = capturePosition.z
      pose.rotation.x = captureRotation.x
      pose.rotation.y = captureRotation.y
      pose.rotation.z = captureRotation.z
      pose.rotation.w = captureRotation.w
      out.set(name, pose)
    }
    return out
  }

  return {
    rig,
    applicator,
    captureWorldPoses,
    resolveWorldPoses,
    composeLocalPose,
  }
}
