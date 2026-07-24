import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from './clipSampler'
import { compileAuthoredRootMotion } from './rootMotion'
import { createRigDefinition } from './rig'
import {
  createMutableUePoseNode,
  sampleSequencePoseNode,
} from './uePoseGraph'

function createTwoBoneRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  root.position.set(0.25, 0.5, 0.75)
  root.quaternion.set(0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8))
  root.scale.set(1, 1.25, 1.5)
  const child = new THREE.Bone()
  child.name = 'child'
  child.position.set(0, 5, 0)
  root.add(child)
  return createRigDefinition(root)
}

describe('Unreal sequence pose graph', () => {
  it('routes root-lock reset through the generic sequence leaf without changing child pose or curves', () => {
    const rig = createTwoBoneRig()
    const clip = new THREE.AnimationClip('root-motion', 1, [
      new THREE.VectorKeyframeTrack(
        'root.position',
        [0, 1],
        [10, 20, 30, 20, 30, 40],
      ),
      new THREE.QuaternionKeyframeTrack(
        'root.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0, 1, 0],
      ),
      new THREE.VectorKeyframeTrack(
        'root.scale',
        [0, 1],
        [2, 3, 4, 4, 5, 6],
      ),
      new THREE.VectorKeyframeTrack(
        'child.position',
        [0, 1],
        [0, 5, 0, 2, 7, 4],
      ),
    ])
    const rootMotion = compileAuthoredRootMotion({
      name: clip.name,
      duration: clip.duration,
      userData: {
        bEnableRootMotion: true,
        bForceRootLock: true,
        RootMotionRootLock: 'RefPose',
        rawRootTrack: {
          times: [0, 1],
          translations: [[0, 0, 0], [0, 0, 1]],
          rotations: [[0, 0, 0, 1], [0, 0, 0, 1]],
        },
      },
    })
    if (!rootMotion) throw new Error('Synthetic root motion did not compile')
    const out = createMutableUePoseNode(rig.boneCount)

    sampleSequencePoseNode(
      rig,
      {
        sampler: compileClipSampler(clip, rig),
        curves: { AuthoredCurve: (time) => time * 2 },
        rootMotion,
      },
      0.5,
      false,
      out,
    )

    expect([...out.pose.positions.slice(0, 3)])
      .toEqual([...rig.referencePositions.slice(0, 3)])
    expect([...out.pose.rotations.slice(0, 4)])
      .toEqual([...rig.referenceRotations.slice(0, 4)])
    expect([...out.pose.scales.slice(0, 3)])
      .toEqual([...rig.referenceScales.slice(0, 3)])
    expect([...out.pose.positions.slice(3, 6)]).toEqual([1, 6, 2])
    expect(out.curves.get('AuthoredCurve')).toBe(1)
  })
})
