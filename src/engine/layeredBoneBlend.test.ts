import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyLayeredBoneBlend,
  createLayeredBoneBlendScratch,
} from './layeredBoneBlend'
import {
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from './poseBuffer'
import { createRigDefinition } from './rig'

function twoBoneRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const child = new THREE.Bone()
  child.name = 'child'
  root.add(child)
  return createRigDefinition(root)
}

function referencePose(
  rig: ReturnType<typeof twoBoneRig>,
) {
  return resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
}

function setRotation(
  pose: LocalPoseBuffer,
  bone: number,
  rotation: THREE.Quaternion,
) {
  rotation.toArray(pose.rotations, bone * 4)
}

function rotationAt(pose: LocalPoseBuffer, bone: number) {
  return new THREE.Quaternion().fromArray(pose.rotations, bone * 4)
}

describe('two-pose layered bone blend', () => {
  it('blends rotations in component space when requested', () => {
    const rig = twoBoneRig()
    const rootRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 2,
    )
    const baseLocal = referencePose(rig)
    const baseMesh = referencePose(rig)
    const blendPose = referencePose(rig)
    setRotation(baseLocal, 0, rootRotation)
    setRotation(baseMesh, 0, rootRotation)
    const mask = new Float32Array([0, 0.5])
    const localScratch = createLayeredBoneBlendScratch(rig.boneCount)
    const meshScratch = createLayeredBoneBlendScratch(rig.boneCount)

    applyLayeredBoneBlend(
      baseLocal,
      blendPose,
      rig,
      1,
      mask,
      false,
      localScratch,
    )
    applyLayeredBoneBlend(
      baseMesh,
      blendPose,
      rig,
      1,
      mask,
      true,
      meshScratch,
    )

    const identity = new THREE.Quaternion()
    const expectedMeshChildLocal = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -Math.PI / 4,
    )
    expect(rotationAt(baseLocal, 1).angleTo(identity)).toBeLessThan(1e-6)
    expect(
      rotationAt(baseMesh, 1).angleTo(expectedMeshChildLocal),
    ).toBeLessThan(1e-6)

    const localChildComponent = rotationAt(baseLocal, 0)
      .multiply(rotationAt(baseLocal, 1))
    const meshChildComponent = rotationAt(baseMesh, 0)
      .multiply(rotationAt(baseMesh, 1))
    const expectedLocalComponent = rootRotation
    const expectedMeshComponent = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 4,
    )
    expect(
      localChildComponent.angleTo(expectedLocalComponent),
    ).toBeLessThan(1e-3)
    expect(
      meshChildComponent.angleTo(expectedMeshComponent),
    ).toBeLessThan(1e-3)
  })

  it('keeps translation and scale blending in local space', () => {
    const rig = twoBoneRig()
    const base = referencePose(rig)
    const blendPose = referencePose(rig)
    base.positions.set([1, 2, 3, 4, 5, 6])
    base.scales.set([1, 2, 3, 2, 4, 6])
    blendPose.positions.set([9, 10, 11, 12, 13, 14])
    blendPose.scales.set([5, 6, 7, 10, 12, 14])
    const mask = new Float32Array([0.5, 0.25])

    applyLayeredBoneBlend(
      base,
      blendPose,
      rig,
      0.5,
      mask,
      true,
      createLayeredBoneBlendScratch(rig.boneCount),
    )

    expect([...base.positions]).toEqual([3, 4, 5, 5, 6, 7])
    expect([...base.scales]).toEqual([2, 3, 4, 3, 5, 7])
  })

  it('uses Unreal normalized atom rotation blending rather than SLERP', () => {
    const rig = twoBoneRig()
    const base = referencePose(rig)
    const blendPose = referencePose(rig)
    setRotation(
      blendPose,
      0,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        2 * Math.PI / 3,
      ),
    )

    applyLayeredBoneBlend(
      base,
      blendPose,
      rig,
      0.25,
      new Float32Array([1, 0]),
      false,
      createLayeredBoneBlendScratch(rig.boneCount),
    )

    const rawX = Math.sqrt(3) / 2 * 0.25
    const rawW = 0.75 + 0.5 * 0.25
    const inverseLength = 1 / Math.hypot(rawX, rawW)
    expect(base.rotations[0]).toBeCloseTo(rawX * inverseLength)
    expect(base.rotations[3]).toBeCloseTo(rawW * inverseLength)
    expect(base.rotations[0]).not.toBeCloseTo(Math.sin(Math.PI / 12), 3)
  })

  it('preserves exact all-zero and all-one alpha endpoints', () => {
    const rig = twoBoneRig()
    const source = referencePose(rig)
    const blendPose = referencePose(rig)
    source.positions.set([1, 2, 3, 4, 5, 6])
    source.scales.set([1, 2, 3, 4, 5, 6])
    blendPose.positions.set([7, 8, 9, 10, 11, 12])
    blendPose.scales.set([6, 5, 4, 3, 2, 1])
    setRotation(
      source,
      0,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        0.7,
      ),
    )
    setRotation(
      blendPose,
      1,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -1.1,
      ),
    )
    const sourceSnapshot = [...source.data]
    const blendSnapshot = [...blendPose.data]
    const scratch = createLayeredBoneBlendScratch(rig.boneCount)
    const mask = new Float32Array([1, 1])

    applyLayeredBoneBlend(
      source,
      blendPose,
      rig,
      0,
      mask,
      true,
      scratch,
    )
    expect([...source.data]).toEqual(sourceSnapshot)

    applyLayeredBoneBlend(
      source,
      blendPose,
      rig,
      1,
      mask,
      true,
      scratch,
    )
    expect([...source.data]).toEqual(blendSnapshot)

    const mixed = referencePose(rig)
    const mixedTarget = referencePose(rig)
    mixed.positions.set([1, 2, 3, 4, 5, 6])
    mixedTarget.positions.set([7, 8, 9, 10, 11, 12])
    mixed.scales.set([1, 2, 3, 4, 5, 6])
    mixedTarget.scales.set([6, 5, 4, 3, 2, 1])
    setRotation(
      mixed,
      0,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        0.4,
      ),
    )
    setRotation(
      mixedTarget,
      1,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        0.9,
      ),
    )
    const baseRootPosition = [...mixed.positions.slice(0, 3)]
    const baseRootRotation = [...mixed.rotations.slice(0, 4)]
    const baseRootScale = [...mixed.scales.slice(0, 3)]
    const targetChildPosition = [...mixedTarget.positions.slice(3, 6)]
    const targetChildRotation = [...mixedTarget.rotations.slice(4, 8)]
    const targetChildScale = [...mixedTarget.scales.slice(3, 6)]

    applyLayeredBoneBlend(
      mixed,
      mixedTarget,
      rig,
      1,
      new Float32Array([0, 1]),
      false,
      scratch,
    )
    expect([...mixed.positions.slice(0, 3)]).toEqual(baseRootPosition)
    expect([...mixed.rotations.slice(0, 4)]).toEqual(baseRootRotation)
    expect([...mixed.scales.slice(0, 3)]).toEqual(baseRootScale)
    expect([...mixed.positions.slice(3, 6)]).toEqual(targetChildPosition)
    expect([...mixed.rotations.slice(4, 8)]).toEqual(targetChildRotation)
    expect([...mixed.scales.slice(3, 6)]).toEqual(targetChildScale)
  })

  it('owns reusable component-space storage and validates every input size', () => {
    const rig = twoBoneRig()
    const scratch = createLayeredBoneBlendScratch(rig.boneCount)
    expect(scratch.baseComponentRotations.buffer).toBe(scratch.data.buffer)
    expect(scratch.blendComponentRotations.buffer).toBe(scratch.data.buffer)
    expect(scratch.outputComponentRotations.buffer).toBe(scratch.data.buffer)

    const base = referencePose(rig)
    const blendPose = referencePose(rig)
    expect(() => applyLayeredBoneBlend(
      createPoseBuffer(1),
      blendPose,
      rig,
      1,
      new Float32Array(2),
      false,
      scratch,
    )).toThrow('incompatible bone count')
    expect(() => applyLayeredBoneBlend(
      base,
      createPoseBuffer(1),
      rig,
      1,
      new Float32Array(2),
      false,
      scratch,
    )).toThrow('incompatible bone count')
    expect(() => applyLayeredBoneBlend(
      base,
      blendPose,
      rig,
      1,
      new Float32Array(1),
      false,
      scratch,
    )).toThrow('incompatible bone count')
    expect(() => applyLayeredBoneBlend(
      base,
      blendPose,
      rig,
      1,
      new Float32Array(2),
      false,
      createLayeredBoneBlendScratch(1),
    )).toThrow('incompatible bone count')
    expect(() => applyLayeredBoneBlend(
      base,
      blendPose,
      rig,
      1,
      new Float32Array(2),
      false,
      scratch,
      true,
    )).toThrow('Mesh-space scale blending is not supported')
  })
})
