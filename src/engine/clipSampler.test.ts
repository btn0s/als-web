import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler, sampleClip } from './clipSampler'
import { createPoseBuffer, resetPoseToReference } from './poseBuffer'
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

  it('uses an authored pose as the fallback for channels absent from a raw source clip', () => {
    const rig = createTwoBoneRig()
    const authoredReference = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    authoredReference.positions.set([10, 11, 12], 0)
    authoredReference.positions.set([20, 21, 22], 3)
    authoredReference.rotations.set([0, 0, Math.SQRT1_2, Math.SQRT1_2], 4)
    const source = new THREE.AnimationClip('partial-source', 1, [
      new THREE.VectorKeyframeTrack(
        'root.position',
        [0, 1],
        [30, 31, 32, 40, 41, 42],
      ),
    ])
    const pose = createPoseBuffer(rig.boneCount)

    sampleClip(
      compileClipSampler(source, rig),
      rig,
      0.5,
      pose,
      false,
      authoredReference,
    )

    expect([...pose.positions.slice(0, 3)]).toEqual([35, 36, 37])
    expect([...pose.positions.slice(3, 6)])
      .toEqual([...authoredReference.positions.slice(3, 6)])
    expect([...pose.rotations.slice(4, 8)])
      .toEqual([...authoredReference.rotations.slice(4, 8)])
    expect([...pose.scales]).toEqual([...authoredReference.scales])
    expect(() => sampleClip(
      compileClipSampler(source, rig),
      rig,
      0,
      pose,
      false,
      createPoseBuffer(1),
    )).toThrow(/bone-count mismatch/)
  })
})

it('reuses immutable bindings across matching rigs with independent virtual-bone scratch', () => {
  const root = new THREE.Bone()
  root.name = 'root'
  const child = new THREE.Bone()
  child.name = 'child'
  root.add(child)
  const virtualBones = [{ name: 'VB root_to_child', sourceBoneName: 'root', targetBoneName: 'child' }]
  const rig = createRigDefinition(root, virtualBones)
  const clip = new THREE.AnimationClip('prewarm', 1, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 0, 0]),
  ])
  const first = compileClipSampler(clip, rig)
  const second = compileClipSampler(clip, createRigDefinition(root, virtualBones))
  expect(second.bindings).toBe(first.bindings)
  expect(second.virtualBoneScratch).not.toBeNull()
  expect(second.virtualBoneScratch).not.toBe(first.virtualBoneScratch)
  const reordered = new THREE.Bone()
  reordered.name = 'child'
  const nested = new THREE.Bone()
  nested.name = 'root'
  reordered.add(nested)
  const third = compileClipSampler(clip, createRigDefinition(reordered))
  expect(third.bindings).not.toBe(first.bindings)
  expect(third.bindings[0].boneIndex).toBe(1)
})

it('shares key searches across equal timelines and reuses repeated samples exactly', () => {
  const rig = createTwoBoneRig()
  const clip = new THREE.AnimationClip('shared', 2, [
    new THREE.VectorKeyframeTrack('root.position', [0, 1, 2], [0, 0, 0, 2, 0, 0, 6, 0, 0]),
    new THREE.VectorKeyframeTrack('child.position', new Float32Array([0, 1, 2]), [0, 5, 0, 0, 7, 0, 0, 9, 0]),
    new THREE.QuaternionKeyframeTrack('child.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 1, 0]),
  ])
  const sampler = compileClipSampler(clip, rig)
  expect(sampler.timelines).toHaveLength(2)

  const fresh = (time: number, fallback: 'reference' | 'additiveIdentity' = 'reference') => {
    const pose = createPoseBuffer(rig.boneCount)
    sampleClip(compileClipSampler(clip, rig), rig, time, pose, false, fallback)
    return [...pose.data]
  }
  const first = fresh(0.5)
  const second = fresh(1.5)
  const additive = fresh(0.5, 'additiveIdentity')
  const pose = createPoseBuffer(rig.boneCount)
  for (const [time, fallback, expected] of [[0.5, 'reference', first], [1.5, 'reference', second], [0.5, 'additiveIdentity', additive], [0.5, 'reference', first]] as const) {
    pose.data.fill(Number.NaN)
    sampleClip(sampler, rig, time, pose, false, fallback)
    expect([...pose.data]).toEqual(expected)
  }
  expect(first[1]).toBeCloseTo(0)
  expect(first[0]).toBeCloseTo(1)
  expect(second[4]).toBeCloseTo(8)
})
