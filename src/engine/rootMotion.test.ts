import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'
import { createRootMotionExtractor, extractRootMotionDelta } from './rootMotion'

describe('root motion extraction', () => {
  it('returns root-track translation delta after the first update', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const pose = resetPoseToReference(createPoseBuffer(1), rig)
    const extractor = createRootMotionExtractor(rig)

    expect(extractRootMotionDelta(extractor, pose).valid).toBe(false)
    pose.positions.set([2, 0, -1])
    const delta = extractRootMotionDelta(extractor, pose)

    expect(delta.valid).toBe(true)
    expect([...delta.translation]).toEqual([2, 0, -1])
  })
})
