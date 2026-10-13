import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { createRigDefinition } from './rig'
import { createPoseBuffer } from './poseBuffer'
import { createConsumerOverlay, type ConsumerOverlaySource } from './consumerOverlay'

function fixture() {
  const scene = new Group()
  const root = new Bone(); root.name = 'root'
  const pelvis = new Bone(); pelvis.name = 'pelvis'
  const spine = new Bone(); spine.name = 'spine_01'
  const leg = new Bone(); leg.name = 'thigh_l'
  scene.add(root); root.add(pelvis); pelvis.add(spine, leg)
  const rig = createRigDefinition(scene)
  const clip = (name: string, spineY: number, legY: number) => new AnimationClip(name, 1, [
    new VectorKeyframeTrack('spine_01.position', [0, 1], [0, spineY, 0, 0, spineY, 0]),
    new VectorKeyframeTrack('thigh_l.position', [0, 1], [0, legY, 0, 0, legY, 0]),
  ])
  const pose = createPoseBuffer(rig.boneCount)
  return { rig, pose, clips: [clip('idle', 1, -1), clip('reload', 3, -8)], y: (name: string) => pose.positions[rig.boneNames.indexOf(name) * 3 + 1] }
}

describe('consumer overlay source', () => {
  it('masks an upper-body montage without copying its authored leg pose', () => {
    const { rig, pose, clips, y } = fixture()
    const source: ConsumerOverlaySource = { clips, sample: () => ({ pose: { clip: 'idle', time: 0 }, montage: { clip: 'reload', time: 0.5, weight: 1 } }) }
    createConsumerOverlay(rig, source)!(pose)
    expect(y('spine_01')).toBe(3)
    expect(y('thigh_l')).toBe(-1)
  })
  it('samples aim blends independently and rejects an unavailable sequence', () => {
    const { rig, pose, clips, y } = fixture()
    let name = 'reload'
    const source: ConsumerOverlaySource = { clips, sample: () => ({ pose: { clip: 'idle', time: 0 }, aim: { clip: name, time: 0, weight: 0.5 } }) }
    const apply = createConsumerOverlay(rig, source)!
    apply(pose)
    expect(y('spine_01')).toBe(2)
    name = 'missing'
    expect(() => apply(pose)).toThrow('Missing consumer aim sequence')
  })
})
