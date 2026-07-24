import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToAdditiveIdentity,
  resetPoseToReference,
} from './poseBuffer'
import { createRigDefinition } from './rig'

describe('pose buffers', () => {
  it('uses one backing array and resets/copies reference transforms', () => {
    const bone = new THREE.Bone()
    bone.name = 'root'
    bone.position.set(3, 4, 5)
    const rig = createRigDefinition(bone)
    const pose = resetPoseToReference(createPoseBuffer(1), rig)
    const copy = createPoseBuffer(1)

    expect(pose.positions.buffer).toBe(pose.data.buffer)
    expect(pose.rotations.buffer).toBe(pose.data.buffer)
    expect(pose.scales.buffer).toBe(pose.data.buffer)
    copyPose(pose, copy)
    expect([...copy.data]).toEqual([...pose.data])
  })

  it('resets to additive identity', () => {
    const pose = createPoseBuffer(2)
    pose.data.fill(7)
    resetPoseToAdditiveIdentity(pose)

    expect([...pose.positions]).toEqual([0, 0, 0, 0, 0, 0])
    expect([...pose.rotations]).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
    expect([...pose.scales]).toEqual([0, 0, 0, 0, 0, 0])
  })
})
