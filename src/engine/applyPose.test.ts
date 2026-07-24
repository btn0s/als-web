import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPose, createPoseApplicator } from './applyPose'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'

describe('pose application', () => {
  it('writes cached bone references in rig order', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const child = new THREE.Bone()
    child.name = 'child'
    root.add(child)
    const rig = createRigDefinition(root)
    const applicator = createPoseApplicator(root, rig)
    const pose = resetPoseToReference(createPoseBuffer(2), rig)
    pose.positions.set([1, 2, 3], 3)
    pose.rotations.set([0, 0, 1, 0], 4)

    applyPose(applicator, pose)

    expect(child.position.toArray()).toEqual([1, 2, 3])
    expect(child.quaternion.toArray()).toEqual([0, 0, 1, 0])
    expect(applicator.bones[1]).toBe(child)
  })
})
