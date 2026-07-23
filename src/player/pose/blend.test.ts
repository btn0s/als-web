import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  accumulatePose,
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  clearPoseAccumulator,
  compileBoneMask,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
} from './blend'
import { copyPose, createPoseBuffer, resetPoseToReference } from './poseBuffer'
import { createRigDefinition } from './rig'

function setup() {
  const root = new THREE.Bone()
  root.name = 'root'
  const hand = new THREE.Bone()
  hand.name = 'hand_l'
  root.add(hand)
  const rig = createRigDefinition(root)
  const reference = resetPoseToReference(createPoseBuffer(2), rig)
  return { rig, reference }
}

describe('pose blending', () => {
  it('produces a normalized 50/50 blend', () => {
    const { reference } = setup()
    const a = copyPose(reference, createPoseBuffer(2))
    const b = copyPose(reference, createPoseBuffer(2))
    b.positions[0] = 10
    const accumulator = createPoseAccumulator(2)
    const out = createPoseBuffer(2)

    accumulatePose(accumulator, a, 0.5)
    accumulatePose(accumulator, b, 0.5)
    finalizePose(accumulator, reference, out)

    expect(out.positions[0]).toBeCloseTo(5)
  })

  it('keeps opposite quaternion representations in the same hemisphere', () => {
    const { reference } = setup()
    const a = copyPose(reference, createPoseBuffer(2))
    const b = copyPose(reference, createPoseBuffer(2))
    a.rotations.set([0, 0, 0, 1], 0)
    b.rotations.set([0, 0, 0, -1], 0)
    const accumulator = createPoseAccumulator(2)
    const out = createPoseBuffer(2)

    accumulatePose(accumulator, a, 0.5)
    accumulatePose(accumulator, b, 0.5)
    finalizePose(accumulator, reference, out)

    expect(Math.abs(out.rotations[3])).toBeCloseTo(1)
    expect(out.rotations[0]).toBeCloseTo(0)
  })

  it('applies a compiled mask without touching unmasked bones', () => {
    const { rig, reference } = setup()
    const base = copyPose(reference, createPoseBuffer(2))
    const overlay = copyPose(reference, createPoseBuffer(2))
    overlay.positions[0] = 10
    overlay.positions[3] = 20
    const mask = compileBoneMask(rig, (name) => name === 'root')
    const accumulator = clearPoseAccumulator(createPoseAccumulator(2))
    const out = createPoseBuffer(2)

    accumulatePose(accumulator, base, 1)
    accumulatePose(accumulator, overlay, 1, mask)
    finalizePose(accumulator, reference, out)

    expect(out.positions[0]).toBeCloseTo(5)
    expect(out.positions[3]).toBeCloseTo(base.positions[3])
  })

  it('leaves the base bit-identical when additive alpha is zero', () => {
    const { reference } = setup()
    const base = copyPose(reference, createPoseBuffer(2))
    base.positions[0] = 4
    const before = [...base.data]
    const additive = createPoseBuffer(2)
    additive.data.fill(2)

    applyAdditivePose(base, additive, 0)

    expect([...base.data]).toEqual(before)
  })

  it('supports mesh-space additive rotation and converts back to local pose', () => {
    const { rig, reference } = setup()
    const base = copyPose(reference, createPoseBuffer(2))
    const additive = createPoseBuffer(2)
    additive.rotations.set([0, 0, Math.SQRT1_2, Math.SQRT1_2], 0)
    additive.rotations.set([0, 0, 0, 1], 4)

    applyMeshSpaceAdditivePose(
      base,
      additive,
      rig,
      1,
      createMeshSpaceBlendScratch(2),
    )

    expect(base.rotations[2]).toBeCloseTo(Math.SQRT1_2)
    expect(base.rotations[3]).toBeCloseTo(Math.SQRT1_2)
  })
})
