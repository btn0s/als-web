/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import {
  ALS_CONTROL_RIG_HAND_IK,
  createAlsControlRigHandIkRuntime,
  evaluateAlsControlRigHandIk,
  resolveAlsControlRigHandIkWeight,
} from './CR_Als'

type Vector3Tuple = readonly [number, number, number]

interface HandIkOracle {
  readonly controlRigHandIk: {
    readonly useHandIkBonesDefault: boolean
    readonly executionOrder: readonly string[]
    readonly targetSelection: Readonly<Record<
      'left' | 'right',
      {
        readonly whenTrue: string
        readonly whenFalse: string
      }
    >>
    readonly solvers: Readonly<Record<
      'left' | 'right',
      {
        readonly itemA: string
        readonly itemB: string
        readonly effectorItem: string
        readonly weight: string
        readonly primaryAxis: Vector3Tuple
        readonly secondaryAxis: Vector3Tuple
        readonly poleVector: Vector3Tuple
        readonly poleVectorSpace: string
        readonly stretchEnabled: boolean
        readonly stretchStartRatio: number
        readonly stretchMaximumRatio: number
        readonly propagateToChildren: boolean
      }
    >>
  }
}

const oracle = JSON.parse(readFileSync(
  new URL(
    '../../../scripts/extract-als/hand-virtual-bones.json',
    import.meta.url,
  ),
  'utf8',
)) as HandIkOracle

const BONE_NAMES = [
  'root',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'finger_l',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'finger_r',
  'VB ik_hand_l',
  'VB hand_l',
  'VB ik_hand_r',
  'VB hand_r',
] as const

const PARENT_INDICES = new Int16Array([
  -1,
  0,
  1,
  2,
  3,
  0,
  5,
  6,
  7,
  7,
  7,
  3,
  3,
])

const LOCAL_POSITIONS: readonly Vector3Tuple[] = [
  [0, 0, 0],
  [0, 1, 0],
  [1, 0, 0],
  [1, 0, 0],
  [0.25, 0, 0],
  [0, -1, 0],
  [-1, 0, 0],
  [-1, 0, 0],
  [-0.25, 0, 0],
  // The true left target starts at (1, 1, 0), relative to hand_r (-2, -1, 0).
  [3, 2, 0],
  [3, 2, 0.5],
  // The true right target becomes (-1, -1, 0) after left moves to (1, 1, 0).
  [-2, -2, 0],
  [-2, -2, 0.5],
]

function createTestRig() {
  const boneCount = BONE_NAMES.length
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  for (let bone = 0; bone < boneCount; bone++) {
    referencePositions.set(LOCAL_POSITIONS[bone], bone * 3)
    referenceRotations[bone * 4 + 3] = 1
    referenceScales.set([1, 1, 1], bone * 3)
  }
  // This cast keeps the fixture compatible with both the pre-virtual-bone and compact-pose
  // RigDefinition shapes. CR_Als consumes only the shared topology/reference fields.
  return {
    boneCount,
    boneNames: BONE_NAMES,
    parentIndices: PARENT_INDICES,
    referencePositions,
    referenceRotations,
    referenceScales,
  } as unknown as RigDefinition
}

function createTestPose(rig: RigDefinition) {
  return resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
}

interface ComponentTransform {
  readonly position: THREE.Vector3
  readonly rotation: THREE.Quaternion
  readonly scale: THREE.Vector3
}

/**
 * Matrix hierarchy oracle deliberately independent from CR_Als's typed-array component builder.
 */
function componentTransforms(
  rig: RigDefinition,
  pose: LocalPoseBuffer,
) {
  const matrices: THREE.Matrix4[] = []
  const transforms: ComponentTransform[] = []
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(pose.positions, bone * 3),
      new THREE.Quaternion().fromArray(pose.rotations, bone * 4),
      new THREE.Vector3().fromArray(pose.scales, bone * 3),
    )
    const parent = rig.parentIndices[bone]
    matrices[bone] = parent < 0
      ? local
      : new THREE.Matrix4().multiplyMatrices(matrices[parent], local)
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    matrices[bone].decompose(position, rotation, scale)
    transforms[bone] = { position, rotation, scale }
  }
  return transforms
}

function index(rig: RigDefinition, boneName: string) {
  const result = rig.boneNames.indexOf(boneName)
  if (result < 0) throw new Error(`Missing fixture bone "${boneName}"`)
  return result
}

function allHandIkCurves() {
  return new Map([
    ['LayerArmLeft', 1],
    ['HandLeftIk', 1],
    ['LayerArmRight', 1],
    ['HandRightIk', 1],
  ])
}

function expectVectorClose(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  precision = 5,
) {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.z).toBeCloseTo(expected.z, precision)
}

describe('CR_Als hand IK authored parity', () => {
  it('pins target selectors, solve order, axes, poles, stretch, and propagation', () => {
    const authored = oracle.controlRigHandIk
    expect(authored.useHandIkBonesDefault).toBe(true)
    expect(authored.executionOrder).toEqual(['left', 'right'])
    expect(ALS_CONTROL_RIG_HAND_IK.map((solver) => solver.side))
      .toEqual(authored.executionOrder)

    for (const definition of ALS_CONTROL_RIG_HAND_IK) {
      const source = authored.solvers[definition.side]
      const selection = authored.targetSelection[definition.side]
      expect(definition).toMatchObject({
        itemA: source.itemA,
        itemB: source.itemB,
        effectorItem: source.effectorItem,
        targetWhenUsingHandIkBones: selection.whenTrue,
        targetOtherwise: selection.whenFalse,
        primaryAxis: source.primaryAxis,
        secondaryAxis: source.secondaryAxis,
        secondaryAxisWeight: 1,
        poleVector: source.poleVector,
        poleVectorKind: 'Location',
        poleVectorSpace: source.poleVectorSpace,
        stretchEnabled: source.stretchEnabled,
        stretchStartRatio: source.stretchStartRatio,
        stretchMaximumRatio: source.stretchMaximumRatio,
        propagateToChildren: source.propagateToChildren,
      })
    }
  })

  it('clamps each curve independently before multiplying the IK weight', () => {
    expect(resolveAlsControlRigHandIkWeight(new Map([
      ['LayerArmLeft', 2],
      ['HandLeftIk', 0.25],
    ]), 'left')).toBe(0.25)
    expect(resolveAlsControlRigHandIkWeight(new Map([
      ['LayerArmLeft', 0.5],
      ['HandLeftIk', 2],
    ]), 'left')).toBe(0.5)
    expect(resolveAlsControlRigHandIkWeight(new Map([
      ['LayerArmLeft', -1],
      ['HandLeftIk', 1],
    ]), 'left')).toBe(0)
    expect(resolveAlsControlRigHandIkWeight(new Map(), 'right')).toBe(0)
  })
})

describe('CR_Als pose-buffer hand IK', () => {
  it('solves left then rebuilds propagated virtual targets before solving right', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    const before = componentTransforms(rig, pose)
    const originalFingerLeft = pose.data.slice(
      index(rig, 'finger_l') * 3,
      index(rig, 'finger_l') * 3 + 3,
    )
    const originalFingerRight = pose.data.slice(
      index(rig, 'finger_r') * 3,
      index(rig, 'finger_r') * 3 + 3,
    )

    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      { pose, curves: allHandIkCurves() },
    )
    const after = componentTransforms(rig, pose)

    const handLeft = after[index(rig, 'hand_l')]
    const handRight = after[index(rig, 'hand_r')]
    const targetLeftAfterRight = after[index(rig, 'VB ik_hand_l')]
    const targetRight = after[index(rig, 'VB ik_hand_r')]

    // Left captured its target at (1, 1, 0). Right then moved hand_r, which propagated the
    // left-target virtual bone onward; CR_Als does not circle back for a second left solve.
    expectVectorClose(handLeft.position, new THREE.Vector3(1, 1, 0))
    expectVectorClose(targetLeftAfterRight.position, new THREE.Vector3(2, 1, 0))
    expectVectorClose(handRight.position, targetRight.position)
    expectVectorClose(handRight.position, new THREE.Vector3(-1, -1, 0))

    // Propagation changes child globals while preserving their authored local transforms.
    expect([...pose.positions.slice(
      index(rig, 'finger_l') * 3,
      index(rig, 'finger_l') * 3 + 3,
    )]).toEqual([...originalFingerLeft])
    expect([...pose.positions.slice(
      index(rig, 'finger_r') * 3,
      index(rig, 'finger_r') * 3 + 3,
    )]).toEqual([...originalFingerRight])
    expect(
      after[index(rig, 'finger_l')].position.distanceTo(
        before[index(rig, 'finger_l')].position,
      ),
    ).toBeGreaterThan(0.1)
    expect(
      after[index(rig, 'finger_r')].position.distanceTo(
        before[index(rig, 'finger_r')].position,
      ),
    ).toBeGreaterThan(0.1)
  })

  it('aligns each authored primary and secondary axis at full weight', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      { pose, curves: allHandIkCurves() },
    )
    const transforms = componentTransforms(rig, pose)

    for (const definition of ALS_CONTROL_RIG_HAND_IK) {
      const upper = transforms[index(rig, definition.itemA)]
      const lower = transforms[index(rig, definition.itemB)]
      const hand = transforms[index(rig, definition.effectorItem)]
      const upperDirection = lower.position.clone()
        .sub(upper.position)
        .normalize()
      const lowerDirection = hand.position.clone()
        .sub(lower.position)
        .normalize()
      const bendDirection = lower.position.clone()
        .sub(
          hand.position.clone()
            .add(upper.position)
            .multiplyScalar(0.5),
        )
      const upperBendDirection = bendDirection.clone()
        .addScaledVector(
          upperDirection,
          -bendDirection.dot(upperDirection),
        )
        .normalize()
      const lowerBendDirection = bendDirection.clone()
        .addScaledVector(
          lowerDirection,
          -bendDirection.dot(lowerDirection),
        )
        .normalize()

      const upperPrimary = new THREE.Vector3()
        .fromArray(definition.primaryAxis)
        .applyQuaternion(upper.rotation)
        .normalize()
      const lowerPrimary = new THREE.Vector3()
        .fromArray(definition.primaryAxis)
        .applyQuaternion(lower.rotation)
        .normalize()
      const upperSecondary = new THREE.Vector3()
        .fromArray(definition.secondaryAxis)
        .applyQuaternion(upper.rotation)
        .normalize()
      const lowerSecondary = new THREE.Vector3()
        .fromArray(definition.secondaryAxis)
        .applyQuaternion(lower.rotation)
        .normalize()

      expect(upperPrimary.dot(upperDirection), definition.side)
        .toBeGreaterThan(0.99999)
      expect(lowerPrimary.dot(lowerDirection), definition.side)
        .toBeGreaterThan(0.99999)
      expect(upperSecondary.dot(upperBendDirection), definition.side)
        .toBeGreaterThan(0.99999)
      expect(lowerSecondary.dot(lowerBendDirection), definition.side)
        .toBeGreaterThan(0.99999)
    }
  })

  it('uses the bUseHandIkBones=false virtual targets when requested', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      {
        pose,
        curves: new Map([
          ['LayerArmLeft', 1],
          ['HandLeftIk', 1],
        ]),
        useHandIkBones: false,
      },
    )
    const transforms = componentTransforms(rig, pose)
    expectVectorClose(
      transforms[index(rig, 'hand_l')].position,
      new THREE.Vector3(1, 1, 0.5),
    )
  })

  it('clamps an unreachable target to the initial two-segment length without stretching', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    const farTarget = index(rig, 'VB ik_hand_l') * 3
    pose.positions[farTarget] = 100
    pose.positions[farTarget + 1] = 100
    pose.positions[farTarget + 2] = 100

    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      {
        pose,
        curves: new Map([
          ['LayerArmLeft', 1],
          ['HandLeftIk', 1],
        ]),
      },
    )
    const transforms = componentTransforms(rig, pose)
    expect(
      transforms[index(rig, 'hand_l')].position.distanceTo(
        transforms[index(rig, 'upperarm_l')].position,
      ),
    ).toBeCloseTo(2, 5)
  })

  it('scales reference lengths by current / initial component scale like UE 5.5', () => {
    const rig = createTestRig()
    const upperLeft = index(rig, 'upperarm_l')
    rig.referenceScales.set([2, 2, 2], upperLeft * 3)
    const runtime = createAlsControlRigHandIkRuntime(rig)
    const pose = createTestPose(rig)
    pose.scales.set([3, 3, 3], upperLeft * 3)
    const farTarget = index(rig, 'VB ik_hand_l') * 3
    pose.positions[farTarget] = 100
    pose.positions[farTarget + 1] = 100
    pose.positions[farTarget + 2] = 100

    evaluateAlsControlRigHandIk(runtime, {
      pose,
      curves: new Map([
        ['LayerArmLeft', 1],
        ['HandLeftIk', 1],
      ]),
    })
    const transforms = componentTransforms(rig, pose)
    expect(
      transforms[index(rig, 'hand_l')].position.distanceTo(
        transforms[upperLeft].position,
      ),
    ).toBeCloseTo(6, 5)
  })

  it('leaves every local transform bit-identical when both curve products are zero', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    const before = pose.data.slice()
    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      { pose, curves: new Map() },
    )
    expect(pose.data).toEqual(before)
  })

  it('returns the supplied pose buffer for pipeline chaining', () => {
    const rig = createTestRig()
    const pose = createTestPose(rig)
    expect(evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      { pose, curves: new Map() },
    )).toBe(pose)
  })
})
