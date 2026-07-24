import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPose, createPoseApplicator } from './applyPose'
import { compileClipSampler, sampleClip } from './clipSampler'
import {
  createPoseBuffer,
  resetPoseToReference,
} from './poseBuffer'
import { createRigDefinition } from './rig'
import {
  createVirtualBonePoseScratch,
  refreshVirtualBonePose,
} from './virtualBones'

const VIRTUAL_BONE = {
  name: 'VB source_to_target',
  sourceBoneName: 'source',
  targetBoneName: 'target',
} as const

function virtualBoneScene() {
  const root = new THREE.Bone()
  root.name = 'root'
  const source = new THREE.Bone()
  source.name = 'source'
  source.position.set(1, 0, 0)
  source.rotation.z = Math.PI / 4
  const target = new THREE.Bone()
  target.name = 'target'
  target.position.set(3, 2, 0)
  target.rotation.y = 0.3
  root.add(source, target)
  return { root, source, target }
}

function expectWorldTransformsEqual(
  actual: THREE.Object3D,
  expected: THREE.Object3D,
) {
  actual.updateWorldMatrix(true, false)
  expected.updateWorldMatrix(true, false)
  expect(
    actual.getWorldPosition(new THREE.Vector3()).distanceTo(
      expected.getWorldPosition(new THREE.Vector3()),
    ),
  ).toBeLessThan(1e-6)
  expect(
    actual.getWorldQuaternion(new THREE.Quaternion()).angleTo(
      expected.getWorldQuaternion(new THREE.Quaternion()),
    ),
  ).toBeLessThan(1e-6)
}

describe('Unreal virtual bones', () => {
  it('appends authored source-target entries to the compact pose', () => {
    const { root, target } = virtualBoneScene()
    const rig = createRigDefinition(root, [VIRTUAL_BONE])
    const applicator = createPoseApplicator(root, rig)
    const pose = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    refreshVirtualBonePose(
      pose,
      rig,
      createVirtualBonePoseScratch(rig.boneCount),
    )
    applyPose(applicator, pose)

    expect(rig.physicalBoneCount).toBe(3)
    expect(rig.boneCount).toBe(4)
    expect(rig.boneNames).toEqual([
      'root',
      'source',
      'target',
      VIRTUAL_BONE.name,
    ])
    expect([...rig.parentIndices]).toEqual([-1, 0, 0, 1])
    const virtualBone = root.getObjectByName(VIRTUAL_BONE.name)
    expect(virtualBone).toBeInstanceOf(THREE.Bone)
    expect(virtualBone?.parent?.name).toBe('source')
    expectWorldTransformsEqual(virtualBone!, target)
  })

  it('generates virtual locals from each sampled source pose before blending', () => {
    const { root, target } = virtualBoneScene()
    const rig = createRigDefinition(root, [VIRTUAL_BONE])
    const sampler = compileClipSampler(
      new THREE.AnimationClip('source-pose', 1, [
        new THREE.VectorKeyframeTrack(
          'source.position',
          [0, 1],
          [1, 0, 0, 2, 1, 0],
        ),
        new THREE.VectorKeyframeTrack(
          'target.position',
          [0, 1],
          [3, 2, 0, -1, 4, 2],
        ),
      ]),
      rig,
    )
    const pose = sampleClip(
      sampler,
      rig,
      1,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const applicator = createPoseApplicator(root, rig)
    applyPose(applicator, pose)

    expectWorldTransformsEqual(
      root.getObjectByName(VIRTUAL_BONE.name)!,
      target,
    )
  })

  it('keeps the generated local independent after graph layering', () => {
    const { root, source, target } = virtualBoneScene()
    const rig = createRigDefinition(root, [VIRTUAL_BONE])
    const sourcePose = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    refreshVirtualBonePose(
      sourcePose,
      rig,
      createVirtualBonePoseScratch(rig.boneCount),
    )

    // A later graph node changes the source hand without regenerating the virtual local. This is
    // the behavior ALS relies on when node 92 overlays its hand virtual-bone branches.
    sourcePose.positions[3] += 2
    const applicator = createPoseApplicator(root, rig)
    applyPose(applicator, sourcePose)
    root.updateWorldMatrix(true, true)

    const virtualBone = root.getObjectByName(VIRTUAL_BONE.name)!
    expect(
      virtualBone.getWorldPosition(new THREE.Vector3()).distanceTo(
        target.getWorldPosition(new THREE.Vector3()),
      ),
    ).toBeGreaterThan(1)
    expect(
      virtualBone.getWorldPosition(new THREE.Vector3()).distanceTo(
        source.getWorldPosition(new THREE.Vector3()),
      ),
    ).toBeGreaterThan(1)
  })
})

