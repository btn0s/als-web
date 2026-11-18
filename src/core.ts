import type { AlsRemoteCharacter } from './als/AlsRemoteCharacter'
import { Matrix4, Quaternion, Vector3, type AnimationClip } from 'three'
import { createAlsAnimationCore, hasCompleteAlsControlRig } from './als/AlsAnimationCore'
import { ALS_GENERAL_ANIMATION_SETTINGS } from './als/Settings/AlsGeneralAnimationSettings'
import { ROTATION_YAW_SPEED_CURVE_NAME } from './als/Utility/AlsConstants'
import { ALS_VIRTUAL_BONES } from './als/Utility/AlsVirtualBones'
import { createAlsFeetPoseBridgeFromMatrices } from './engine/alsFeetPoseBridge'
import { createPoseBuffer, copyPose, resetPoseToReference } from './engine/poseBuffer'
import { compileRigDefinition, type RigBone } from './engine/rig'

export { AlsRemoteCharacter } from './als/AlsRemoteCharacter'
export type { AlsCharacterSnapshot } from './als/AlsCharacterSnapshot'
export { ALS_STANDING_CAPSULE_HALF_HEIGHT } from './als/AlsCharacterAnimation'
export type { LocalPoseBuffer } from './engine/poseBuffer'
export type { RigBone } from './engine/rig'

/** Evaluate ALS against a named skeleton and publish local TRS buffers in rig order. */
export function createAlsAnimation(
  bones: readonly RigBone[],
  animations: AnimationClip[],
) {
  const rig = compileRigDefinition(bones, ALS_VIRTUAL_BONES)
  const pose = resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
  const componentToWorld = new Matrix4()
  const world = Array.from({ length: rig.boneCount }, () => new Matrix4())
  const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  const feetPoseBridge = hasCompleteAlsControlRig(new Set(rig.boneNames))
    ? createAlsFeetPoseBridgeFromMatrices(rig, {
      componentMatrix: () => componentToWorld,
      boneMatrix: index => world[index],
      update: () => {
        for (let i = 0; i < rig.boneCount; i++) {
          const parent = rig.parentIndices[i]
          world[i].compose(
            position.fromArray(pose.positions, i * 3),
            rotation.fromArray(pose.rotations, i * 4),
            scale.fromArray(pose.scales, i * 3),
          ).premultiply(parent < 0 ? componentToWorld : world[parent])
        }
      },
    }, ALS_GENERAL_ANIMATION_SETTINGS.useFootIkBones)
    : undefined
  const graph = createAlsAnimationCore({
    rig, animations, feetPoseBridge,
    componentToWorld: () => componentToWorld,
    publishPose: output => copyPose(output, pose),
  })
  return {
    boneNames: rig.boneNames.slice(0, rig.physicalBoneCount),
    pose,
    jump: graph.jump,
    rotationYawSpeed: () => graph.getCurveValue(ROTATION_YAW_SPEED_CURVE_NAME),
    reset: graph.MarkTeleported,
    refresh(delta: number, driver: AlsRemoteCharacter, model: ArrayLike<number>) {
      componentToWorld.fromArray(model)
      graph.refresh(delta, driver.controls)
    },
  }
}
