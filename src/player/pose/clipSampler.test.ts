import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler, sampleClip } from './clipSampler'
import { createPoseBuffer } from './poseBuffer'
import { createRigDefinition } from './rig'

function createTwoBoneRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const child = new THREE.Bone()
  child.name = 'child'
  child.position.set(0, 5, 0)
  root.add(child)
  return createRigDefinition(root)
}

describe('clip sampler', () => {
  it('binary-searches keys, lerps vectors, slerps quaternions, and preserves ref fallback', () => {
    const rig = createTwoBoneRig()
    const clip = new THREE.AnimationClip('known', 2, [
      new THREE.VectorKeyframeTrack('root.position', [0, 1, 2], [
        0, 0, 0,
        2, 0, 0,
        6, 0, 0,
      ]),
      new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 2], [
        0, 0, 0, 1,
        0, 0, 1, 0,
      ]),
    ])
    const pose = createPoseBuffer(rig.boneCount)

    sampleClip(compileClipSampler(clip, rig), rig, 1.5, pose, false)

    expect(pose.positions[0]).toBeCloseTo(4)
    expect(pose.rotations[2]).toBeCloseTo(Math.sin(3 * Math.PI / 8))
    expect(pose.rotations[3]).toBeCloseTo(Math.cos(3 * Math.PI / 8))
    expect([...pose.positions.slice(3, 6)]).toEqual([0, 5, 0])
  })

  it('wraps looping clips and ignores tracks that do not bind to rig bones', () => {
    const rig = createTwoBoneRig()
    const clip = new THREE.AnimationClip('loop', 1, [
      new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 10, 0, 0]),
      new THREE.VectorKeyframeTrack('missing.position', [0, 1], [20, 0, 0, 30, 0, 0]),
    ])
    const sampler = compileClipSampler(clip, rig)
    const pose = createPoseBuffer(rig.boneCount)

    sampleClip(sampler, rig, 1.25, pose)

    expect(sampler.bindings).toHaveLength(1)
    expect(pose.positions[0]).toBeCloseTo(2.5)
  })
})
