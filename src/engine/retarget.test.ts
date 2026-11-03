import { describe, expect, it } from 'vitest'
import { Bone, Group, Quaternion, Vector3 } from 'three'
import { createRigDefinition } from './rig'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { applyPose, createPoseApplicator } from './applyPose'
import { createCompiledRetargeter, detectRetargetFacing, type RetargetProfile } from './retarget'

function rig(extraBones: boolean) {
  const scene = new Group()
  const add = (parent: Group | Bone, name: string, x: number, y: number) => {
    const bone = new Bone(); bone.name = name; bone.position.set(x, y, 0); parent.add(bone); return bone
  }
  const root = add(scene, 'root', 0, 0)
  const pelvis = add(root, 'pelvis', 0, 1)
  const neck = add(pelvis, 'neck_01', 0, 0.6)
  add(neck, 'clavicle_l', 0.15, 0)
  add(neck, 'clavicle_r', -0.15, 0)
  const hand = add(neck, 'hand_l', 0.5, 0)
  const fingerParent = extraBones ? add(hand, 'middle_metacarpal_l', 0.05, 0) : hand
  const finger = add(fingerParent, 'middle_01_l', extraBones ? 0.05 : 0.1, 0)
  if (extraBones) fingerParent.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
  add(hand, 'pinky_01_l', 0.1, -0.03)
  add(hand, 'index_01_l', 0.1, 0.03)
  return { scene, hand, finger }
}
const profile: RetargetProfile = {
  facing: [0, 0, 0, 1], mapping: 'identity', rootMotionBone: 'root', pelvisMotionBone: 'pelvis',
  anatomicalFrames: [{ bone: 'hand_l', childBone: 'middle_01_l', secondaryAxis: ['pinky_01_l', 'index_01_l'] }],
}
describe('Tripo hierarchy retargeting', () => {
  it('preserves common-bone world motion across an inserted target metacarpal', () => {
    const source = rig(false), target = rig(true)
    target.scene.updateMatrixWorld(true)
    const reference = target.finger.getWorldQuaternion(new Quaternion())
    const sourceRig = createRigDefinition(source.scene), targetRig = createRigDefinition(target.scene)
    const sourcePose = resetPoseToReference(createPoseBuffer(sourceRig.boneCount), sourceRig)
    const targetPose = createPoseBuffer(targetRig.boneCount)
    const retarget = createCompiledRetargeter(sourceRig, targetRig, profile)
    const angle = 0.65
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)
    rotation.toArray(sourcePose.rotations, sourceRig.boneNames.indexOf('hand_l') * 4)
    retarget.apply(sourcePose, targetPose)
    applyPose(createPoseApplicator(target.scene, targetRig), targetPose)
    target.scene.updateMatrixWorld(true)
    const actual = target.finger.getWorldQuaternion(new Quaternion())
    expect(actual.angleTo(rotation.clone().multiply(reference))).toBeLessThan(0.0001)
    expect(retarget.diagnostics.unmappedTargetBones).toContain('middle_metacarpal_l')
    expect(retarget.diagnostics.maxReferenceDirectionErrorDegrees).toBeLessThan(0.0001)
  })
  it('keeps heading and pitch motion aligned across opposite bind facings', () => {
    const source = rig(false), target = rig(true)
    const root = target.scene.getObjectByName('root')!
    root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    const display = new Group(); display.rotation.y = Math.PI; display.add(target.scene)
    const sourceRig = createRigDefinition(source.scene), targetRig = createRigDefinition(target.scene)
    const sourcePose = resetPoseToReference(createPoseBuffer(sourceRig.boneCount), sourceRig)
    const targetPose = createPoseBuffer(targetRig.boneCount)
    const retarget = createCompiledRetargeter(sourceRig, targetRig, { ...profile, facing: [0, 1, 0, 0] })
    retarget.apply(sourcePose, targetPose)
    applyPose(createPoseApplicator(target.scene, targetRig), targetPose)
    display.updateMatrixWorld(true)
    expect(target.hand.getWorldPosition(new Vector3()).distanceTo(source.hand.getWorldPosition(new Vector3()))).toBeLessThan(0.0001)
    const reference = target.finger.getWorldQuaternion(new Quaternion())
    const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6)
    pitch.toArray(sourcePose.rotations, sourceRig.boneNames.indexOf('hand_l') * 4)
    retarget.apply(sourcePose, targetPose)
    applyPose(createPoseApplicator(target.scene, targetRig), targetPose)
    display.updateMatrixWorld(true)
    expect(target.finger.getWorldQuaternion(new Quaternion()).angleTo(pitch.multiply(reference))).toBeLessThan(0.0001)
  })

  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI])('detects and cancels bind facing %s', angle => {
    const source = rig(false), target = rig(true)
    target.scene.getObjectByName('root')!.rotation.y = angle
    const sourceRig = createRigDefinition(source.scene), targetRig = createRigDefinition(target.scene)
    const facing = detectRetargetFacing(sourceRig, targetRig)
    const display = new Group()
    display.quaternion.fromArray(facing).invert()
    display.add(target.scene)
    const sourcePose = resetPoseToReference(createPoseBuffer(sourceRig.boneCount), sourceRig)
    const targetPose = createPoseBuffer(targetRig.boneCount)
    const retarget = createCompiledRetargeter(sourceRig, targetRig, { ...profile, facing })
    const applicator = createPoseApplicator(target.scene, targetRig)
    retarget.apply(sourcePose, targetPose)
    applyPose(applicator, targetPose)
    display.updateMatrixWorld(true)
    expect(target.hand.getWorldPosition(new Vector3()).distanceTo(source.hand.getWorldPosition(new Vector3()))).toBeLessThan(0.0001)
    const reference = target.finger.getWorldQuaternion(new Quaternion())
    const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6)
    pitch.toArray(sourcePose.rotations, sourceRig.boneNames.indexOf('hand_l') * 4)
    retarget.apply(sourcePose, targetPose)
    applyPose(applicator, targetPose)
    display.updateMatrixWorld(true)
    expect(target.finger.getWorldQuaternion(new Quaternion()).angleTo(pitch.multiply(reference))).toBeLessThan(0.0001)
  })

})
