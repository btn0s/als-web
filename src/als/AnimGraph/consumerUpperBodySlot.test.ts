import { describe, it, expect } from 'vitest'
import { AnimationClip, Bone, Group, VectorKeyframeTrack } from 'three'
import { createRigDefinition } from '../../engine/rig'
import { createMutableUePoseNode } from '../../engine/uePoseGraph'
import { resetPoseToReference } from '../../engine/poseBuffer'
import { createConsumerUpperBodySlot } from './consumerUpperBodySlot'
import type { ConsumerUpperBodyMontage } from './consumerOverlayStates'

function fixture() {
  const scene = new Group()
  const root = new Bone(); root.name = 'root'; scene.add(root)
  const rig = createRigDefinition(scene)
  const clip = new AnimationClip('reload', 2, [new VectorKeyframeTrack('root.position', [0, 2], [0, 1, 0, 0, 3, 0])])
  clip.userData.alsCurves = [{ name: 'LayerArmRightSlot', keys: [[0, 1, 0, 0, 0, 0, 0, 0, 0]] }]
  let request: ConsumerUpperBodyMontage | null = { id: '1', clip: 'reload', time: 0.5, playRate: 1, blendIn: 0.2 }
  const slot = createConsumerUpperBodySlot(rig, { states: [], clips: [clip], sampleMontage: () => request })
  const base = createMutableUePoseNode(rig.boneCount)
  resetPoseToReference(base.pose, rig)
  return { slot, base, request: (next: ConsumerUpperBodyMontage | null) => { request = next } }
}

describe('consumer ALS Layering slots', () => {
  it('uses retained montage envelopes and exposes only native upper-body regions', () => {
    const { slot, base } = fixture()
    slot.update(0.1, false)
    const regions = slot.evaluate(base)!
    expect([...regions.keys()]).toEqual(['Spine', 'Head', 'ArmLeft', 'ArmRight'])
    expect(slot.curves(base.curves).get('LayerArmRightSlot')).toBeCloseTo(0.5)
    expect(regions.get('ArmRight')!.pose.positions[1]).toBeCloseTo(0.75)
    slot.update(0.1, false)
    expect(slot.curves(base.curves).get('LayerArmRightSlot')).toBe(1)
  })
  it.each(['Rolling', 'Mantling', 'GettingUp', 'Ragdolling'])('yields to %s without resuming a stale request', () => {
    const { slot, base, request } = fixture()
    slot.update(0.2, false)
    expect(slot.evaluate(base)).toBeDefined()
    slot.update(0.01, true)
    expect(slot.evaluate(base)).toBeUndefined()
    slot.update(0.2, false)
    expect(slot.evaluate(base)).toBeUndefined()
    request({ id: '2', clip: 'reload', time: 0, playRate: 1 })
    slot.update(0.2, false)
    expect(slot.evaluate(base)).toBeDefined()
  })
  it('suppresses already interrupted tails when a native action starts', () => {
    const { slot, base, request } = fixture()
    slot.update(0.2, false)
    request({ id: '2', clip: 'reload', time: 1, playRate: 1, blendIn: 0.2 })
    slot.update(0.05, false)
    slot.update(0.01, true)
    expect(slot.evaluate(base)).toBeUndefined()
    expect(slot.curves(base.curves).get('LayerArmRightSlot') ?? 0).toBe(0)
  })
  it('retains outgoing poses during interruption and cancellation', () => {
    const { slot, base, request } = fixture()
    slot.update(0.2, false)
    request({ id: '2', clip: 'reload', time: 1, playRate: 1, blendIn: 0.2 })
    slot.update(0.05, false)
    expect(slot.curves(base.curves).get('LayerArmRightSlot')).toBeCloseTo(1)
    request(null)
    slot.update(0.05, false)
    expect(slot.evaluate(base)).toBeDefined()
    slot.update(0.3, false)
    expect(slot.evaluate(base)).toBeUndefined()
  })
})
