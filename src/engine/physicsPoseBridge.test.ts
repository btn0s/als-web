import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { applyPose } from './applyPose'
import {
  copyPose,
  createPoseBuffer,
} from './poseBuffer'
import {
  createPhysicsPoseBridge,
} from './physicsPoseBridge'
import type {
  MutablePhysicsBoneWorldPose,
} from './physicsPoseBridge'

interface PhysicsAssetOracle {
  readonly bodies: readonly {
    readonly boneName: string
    readonly shapes: readonly unknown[]
  }[]
  readonly constraints: readonly {
    readonly body1: string
    readonly body2: string
  }[]
  readonly collisionDisablePairs: readonly unknown[]
}

const physicsAsset = JSON.parse(readFileSync(
  new URL('../../scripts/extract-als/physics-asset.json', import.meta.url),
  'utf8',
)) as PhysicsAssetOracle

let alsScene: THREE.Group

beforeAll(async () => {
  const bytes = readFileSync(
    new URL('../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  alsScene = (await new GLTFLoader().parseAsync(data, '')).scene
})

function makeSkeleton() {
  const component = new THREE.Group()
  component.position.set(3, 2, -4)
  component.rotation.set(0.1, -0.6, 0.2)

  const root = new THREE.Bone()
  root.name = 'root'
  root.position.set(0, 0.1, 0)
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  pelvis.position.set(0, 0.9, 0)
  const spineWrapper = new THREE.Group()
  spineWrapper.position.set(0.02, -0.01, 0.03)
  spineWrapper.rotation.set(0.03, -0.04, 0.02)
  const spine = new THREE.Bone()
  spine.name = 'spine'
  spine.position.set(0, 0.45, 0)
  const hand = new THREE.Bone()
  hand.name = 'hand'
  hand.position.set(0.35, 0.3, 0)

  component.add(root)
  root.add(pelvis)
  pelvis.add(spineWrapper)
  spineWrapper.add(spine)
  spine.add(hand)
  component.updateWorldMatrix(true, true)
  return {
    component,
    root,
    pelvis,
    spineWrapper,
    spine,
    hand,
  }
}

function captureLocalPose(
  bridge: ReturnType<typeof createPhysicsPoseBridge>,
) {
  const pose = createPoseBuffer(bridge.rig.boneCount)
  for (
    let boneIndex = 0;
    boneIndex < bridge.rig.boneCount;
    boneIndex++
  ) {
    const bone = bridge.applicator.bones[boneIndex]
    bone.position.toArray(pose.positions, boneIndex * 3)
    bone.quaternion.toArray(pose.rotations, boneIndex * 4)
    bone.scale.toArray(pose.scales, boneIndex * 3)
  }
  return pose
}

function localPoseMatrix(
  pose: ReturnType<typeof createPoseBuffer>,
  boneIndex: number,
) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(
      pose.positions,
      boneIndex * 3,
    ),
    new THREE.Quaternion().fromArray(
      pose.rotations,
      boneIndex * 4,
    ),
    new THREE.Vector3().fromArray(
      pose.scales,
      boneIndex * 3,
    ),
  )
}

function expectVectorClose(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
) {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.z).toBeCloseTo(expected.z, 5)
}

function expectQuaternionEquivalent(
  actual: THREE.Quaternion,
  expected: THREE.Quaternion,
) {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 5)
}

function expectWorldPose(
  actual: MutablePhysicsBoneWorldPose,
  expected: THREE.Matrix4,
) {
  const expectedPosition = new THREE.Vector3()
  const expectedRotation = new THREE.Quaternion()
  const expectedScale = new THREE.Vector3()
  expected.decompose(
    expectedPosition,
    expectedRotation,
    expectedScale,
  )
  expectVectorClose(
    new THREE.Vector3(
      actual.translation.x,
      actual.translation.y,
      actual.translation.z,
    ),
    expectedPosition,
  )
  expectQuaternionEquivalent(
    new THREE.Quaternion(
      actual.rotation.x,
      actual.rotation.y,
      actual.rotation.z,
      actual.rotation.w,
    ),
    expectedRotation,
  )
}

describe('skeletal physics pose bridge', () => {
  it('accepts the exact PA_Als body topology on SK_Als', () => {
    const bodyNames = physicsAsset.bodies.map(
      ({ boneName }) => boneName,
    )
    expect(bodyNames).toHaveLength(21)
    expect(physicsAsset.bodies.flatMap(({ shapes }) => shapes))
      .toHaveLength(22)
    expect(physicsAsset.constraints).toHaveLength(20)
    expect(physicsAsset.collisionDisablePairs).toHaveLength(49)

    const bridge = createPhysicsPoseBridge(alsScene)
    const captured = bridge.captureWorldPoses(bodyNames)
    expect([...captured.keys()]).toEqual(bodyNames)
    for (const constraint of physicsAsset.constraints) {
      expect(captured.has(constraint.body1)).toBe(true)
      expect(captured.has(constraint.body2)).toBe(true)
    }
    for (const pose of captured.values()) {
      expect(Object.values(pose.translation).every(Number.isFinite))
        .toBe(true)
      expect(Object.values(pose.rotation).every(Number.isFinite))
        .toBe(true)
    }
  })

  it('captures exact bone world transforms for physics seeding', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(skeleton.component)
    const poses = bridge.captureWorldPoses(['pelvis', 'spine'])

    const pelvisPosition = new THREE.Vector3()
    const pelvisRotation = new THREE.Quaternion()
    skeleton.pelvis.getWorldPosition(pelvisPosition)
    skeleton.pelvis.getWorldQuaternion(pelvisRotation)
    expect(poses.get('pelvis')?.translation).toEqual({
      x: pelvisPosition.x,
      y: pelvisPosition.y,
      z: pelvisPosition.z,
    })
    expect(poses.get('pelvis')?.rotation).toEqual({
      x: pelvisRotation.x,
      y: pelvisRotation.y,
      z: pelvisRotation.z,
      w: pelvisRotation.w,
    })
  })

  it('resolves a caller-owned local target pose to world without applying it', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(skeleton.component)
    const targetPose = captureLocalPose(bridge)
    const pelvisIndex = bridge.rig.boneNames.indexOf('pelvis')
    const spineIndex = bridge.rig.boneNames.indexOf('spine')
    targetPose.positions[pelvisIndex * 3] += 0.35
    targetPose.rotations.set(
      new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(0.2, -0.4, 0.1))
        .toArray(),
      pelvisIndex * 4,
    )
    const renderedPelvisPosition = skeleton.pelvis.position.clone()

    const resolved = bridge.resolveWorldPoses(
      targetPose,
      ['pelvis', 'spine'],
    )

    // The resolver does not consume the renderer as scratch storage.
    expectVectorClose(skeleton.pelvis.position, renderedPelvisPosition)
    const expectedPelvisWorld = new THREE.Matrix4()
      .multiplyMatrices(
        skeleton.root.matrixWorld,
        localPoseMatrix(targetPose, pelvisIndex),
      )
    const expectedSpineWorld = new THREE.Matrix4()
      .multiplyMatrices(
        expectedPelvisWorld,
        skeleton.spineWrapper.matrix,
      )
      .multiply(localPoseMatrix(targetPose, spineIndex))
    expectWorldPose(resolved.get('pelvis')!, expectedPelvisWorld)
    expectWorldPose(resolved.get('spine')!, expectedSpineWorld)
  })

  it('converts simulated world bones back to locals without writing the skeleton', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(skeleton.component)
    const animationPose = captureLocalPose(bridge)
    const originalHandLocal = skeleton.hand.position.clone()
    const pelvisPosition = new THREE.Vector3(4, 1.15, -2)
    const pelvisRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.7, 0.2, -0.4))
    const spinePosition = new THREE.Vector3(4.1, 1.65, -1.9)
    const spineRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(-0.1, 0.5, 0.25))
    const physics = new Map([
      ['pelvis', {
        translation: pelvisPosition,
        rotation: pelvisRotation,
      }],
      ['spine', {
        translation: spinePosition,
        rotation: spineRotation,
      }],
    ])

    const physicalPose = bridge.composeLocalPose(
      animationPose,
      physics,
    )

    // Buffer composition is side-effect-free; the previous rendered pose has
    // not been used as an implicit parent frame.
    expectVectorClose(
      skeleton.pelvis.position,
      new THREE.Vector3(0, 0.9, 0),
    )
    applyPose(bridge.applicator, physicalPose)
    skeleton.component.updateWorldMatrix(true, true)

    const actualPosition = new THREE.Vector3()
    const actualRotation = new THREE.Quaternion()
    skeleton.pelvis.getWorldPosition(actualPosition)
    skeleton.pelvis.getWorldQuaternion(actualRotation)
    expectVectorClose(actualPosition, pelvisPosition)
    expectQuaternionEquivalent(actualRotation, pelvisRotation)
    skeleton.spine.getWorldPosition(actualPosition)
    skeleton.spine.getWorldQuaternion(actualRotation)
    expectVectorClose(actualPosition, spinePosition)
    expectQuaternionEquivalent(actualRotation, spineRotation)
    expectVectorClose(skeleton.hand.position, originalHandLocal)
  })

  it('patches one cached world bone while preserving every other authored local', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(skeleton.component)
    const animationPose = captureLocalPose(bridge)
    const out = createPoseBuffer(bridge.rig.boneCount)
    copyPose(animationPose, out)
    const pelvisPosition = new THREE.Vector3(-2, 0.8, 5)
    const pelvisRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(-0.3, 1.1, 0.2))

    bridge.composeLocalPose(
      animationPose,
      new Map([
        ['pelvis', {
          translation: pelvisPosition,
          rotation: pelvisRotation,
        }],
      ]),
      out,
    )

    const pelvisIndex = bridge.rig.boneNames.indexOf('pelvis')
    for (
      let boneIndex = 0;
      boneIndex < bridge.rig.boneCount;
      boneIndex++
    ) {
      if (boneIndex === pelvisIndex) continue
      const positionOffset = boneIndex * 3
      const rotationOffset = boneIndex * 4
      expect(Array.from(out.positions.slice(
        positionOffset,
        positionOffset + 3,
      ))).toEqual(Array.from(animationPose.positions.slice(
        positionOffset,
        positionOffset + 3,
      )))
      expect(Array.from(out.rotations.slice(
        rotationOffset,
        rotationOffset + 4,
      ))).toEqual(Array.from(animationPose.rotations.slice(
        rotationOffset,
        rotationOffset + 4,
      )))
      expect(Array.from(out.scales.slice(
        positionOffset,
        positionOffset + 3,
      ))).toEqual(Array.from(animationPose.scales.slice(
        positionOffset,
        positionOffset + 3,
      )))
    }
  })

  it('retains the animation source when output aliases it', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(skeleton.component)
    const animationPose = captureLocalPose(bridge)
    const expectedInput = createPoseBuffer(bridge.rig.boneCount)
    copyPose(animationPose, expectedInput)
    const pelvisPosition = new THREE.Vector3(2, 1.2, -3)
    const pelvisRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.2, 0.6, -0.3))
    const physics = new Map([
      ['pelvis', {
        translation: pelvisPosition,
        rotation: pelvisRotation,
      }],
    ])
    const expected = bridge.composeLocalPose(
      expectedInput,
      physics,
    )

    expect(bridge.composeLocalPose(
      animationPose,
      physics,
      animationPose,
    )).toBe(animationPose)
    expect(animationPose.data).toEqual(expected.data)
  })

  it('recomputes virtual bones from the simulated component pose', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(
      skeleton.component,
      [{
        name: 'VB root_to_hand',
        sourceBoneName: 'root',
        targetBoneName: 'hand',
      }],
    )
    const animationPose = captureLocalPose(bridge)
    const handPosition = new THREE.Vector3(5, 1.4, -3)
    const handRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.4, -0.3, 0.6))

    const physicalPose = bridge.composeLocalPose(
      animationPose,
      new Map([
        ['hand', {
          translation: handPosition,
          rotation: handRotation,
        }],
      ]),
    )
    applyPose(bridge.applicator, physicalPose)
    skeleton.component.updateWorldMatrix(true, true)

    const virtualBone = bridge.applicator.bones.find(
      ({ name }) => name === 'VB root_to_hand',
    )!
    const actualPosition = new THREE.Vector3()
    const actualRotation = new THREE.Quaternion()
    virtualBone.getWorldPosition(actualPosition)
    virtualBone.getWorldQuaternion(actualRotation)
    expectVectorClose(actualPosition, handPosition)
    expectQuaternionEquivalent(actualRotation, handRotation)
  })

  it('prunes retained output and rejects non-physical asset bones', () => {
    const skeleton = makeSkeleton()
    const bridge = createPhysicsPoseBridge(
      skeleton.component,
      [{
        name: 'VB root_to_hand',
        sourceBoneName: 'root',
        targetBoneName: 'hand',
      }],
    )
    const retained = bridge.captureWorldPoses(
      ['pelvis', 'spine'],
    )
    expect([...retained.keys()]).toEqual(['pelvis', 'spine'])
    bridge.captureWorldPoses(['pelvis'], retained)
    expect([...retained.keys()]).toEqual(['pelvis'])
    expect(() => bridge.captureWorldPoses(['missing']))
      .toThrow('Physics asset references missing bone "missing"')
    expect(() => bridge.captureWorldPoses(['VB root_to_hand']))
      .toThrow(
        'Physics asset references missing bone "VB root_to_hand"',
      )
    expect(() => bridge.composeLocalPose(
      createPoseBuffer(1),
      new Map(),
    )).toThrow('Physics pose bridge bone-count mismatch')
  })
})
