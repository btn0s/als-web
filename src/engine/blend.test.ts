import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  accumulatePose,
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  clearPoseAccumulator,
  compileBoneMask,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
  makeDynamicAdditivePose,
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

  it('uses conventional replacement alpha for masked normal layers', () => {
    const { rig, reference } = setup()
    const base = copyPose(reference, createPoseBuffer(2))
    const overlay = copyPose(reference, createPoseBuffer(2))
    overlay.positions[0] = 12
    overlay.positions[3] = 20

    blendPoseInPlace(base, overlay, 0.25, compileBoneMask(rig, (name) => name === 'root'))

    expect(base.positions[0]).toBeCloseTo(3)
    expect(base.positions[3]).toBeCloseTo(reference.positions[3])
  })

  it('derives a local dynamic additive that reconstructs its source over the reference', () => {
    const { rig, reference } = setup()
    const source = copyPose(reference, createPoseBuffer(2))
    source.positions[0] = 4
    source.rotations.set([0, 0, Math.SQRT1_2, Math.SQRT1_2], 0)
    const additive = createPoseBuffer(2)
    const reconstructed = copyPose(reference, createPoseBuffer(2))
    const scratch = createMeshSpaceBlendScratch(2)

    makeDynamicAdditivePose(source, reference, rig, additive, 'local', scratch)
    applyAdditivePose(reconstructed, additive, 1)

    expect(reconstructed.positions[0]).toBeCloseTo(4)
    expect(reconstructed.rotations[2]).toBeCloseTo(Math.SQRT1_2)
    expect(reconstructed.rotations[3]).toBeCloseTo(Math.SQRT1_2)
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

  it('reconstructs a raw source from its mesh-space reference on a non-commuting hierarchy', () => {
    const { rig, reference } = setup()
    const source = copyPose(reference, createPoseBuffer(2))
    const referenceRoot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 4, 0, 0),
    )
    const referenceChild = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.PI / 6, 0),
    )
    const sourceRoot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, Math.PI / 3),
    )
    const sourceChild = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-Math.PI / 5, Math.PI / 7, 0),
    )
    referenceRoot.toArray(reference.rotations, 0)
    referenceChild.toArray(reference.rotations, 4)
    sourceRoot.toArray(source.rotations, 0)
    sourceChild.toArray(source.rotations, 4)
    reference.positions.set([1, 2, 3, 4, 5, 6])
    source.positions.set([2, 4, 6, 8, 10, 12])
    reference.scales.set([1, 1, 1, 1, 1, 1])
    source.scales.set([1.2, 0.8, 1.1, 0.9, 1.3, 0.7])
    const additive = createPoseBuffer(2)
    const reconstructed = copyPose(reference, createPoseBuffer(2))
    const scratch = createMeshSpaceBlendScratch(2)

    makeDynamicAdditivePose(
      source,
      reference,
      rig,
      additive,
      'mesh',
      scratch,
    )
    applyMeshSpaceAdditivePose(
      reconstructed,
      additive,
      rig,
      1,
      scratch,
    )

    for (let component = 0; component < source.positions.length; component++) {
      expect(reconstructed.positions[component]).toBeCloseTo(
        source.positions[component],
        6,
      )
      expect(reconstructed.scales[component]).toBeCloseTo(
        source.scales[component],
        6,
      )
    }
    for (let bone = 0; bone < 2; bone++) {
      const offset = bone * 4
      const actual = new THREE.Quaternion().fromArray(
        reconstructed.rotations,
        offset,
      ).normalize()
      const expected = new THREE.Quaternion()
        .fromArray(source.rotations, offset)
        .normalize()
      expect(actual.angleTo(expected)).toBeLessThan(1e-6)
    }
  })
})
