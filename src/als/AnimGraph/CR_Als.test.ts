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
  ALS_CONTROL_RIG_FOOT_IK,
  ALS_CONTROL_RIG_HAND_IK,
  ALS_CONTROL_RIG_IK_FORWARD_SOLVE,
  createAlsControlRigFootIkRuntime,
  createAlsControlRigHandIkRuntime,
  createAlsControlRigIkForwardSolveRuntime,
  evaluateAlsControlRigFootIk,
  evaluateAlsControlRigHandIk,
  evaluateAlsControlRigIkForwardSolve,
  resolveAlsControlRigHandIkWeight,
  type AlsControlRigFootOffsetTrace,
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

interface ControlRigGraphOracle {
  readonly graphs: readonly {
    readonly path: string
    readonly nodes: readonly {
      readonly path: string
      readonly resolvedFunctionName?: string
    }[]
    readonly pins: readonly {
      readonly path: string
      readonly defaultValue?: string
    }[]
    readonly links: readonly {
      readonly source: string
      readonly target: string
    }[]
  }[]
}

const controlRigOracle = JSON.parse(readFileSync(
  new URL(
    '../../../scripts/extract-als/control-rig/CR_Als.json',
    import.meta.url,
  ),
  'utf8',
)) as ControlRigGraphOracle

function controlRigGraph(path: string) {
  const graph = controlRigOracle.graphs.find(
    (candidate) => candidate.path === path,
  )
  if (!graph) throw new Error(`Missing CR_Als oracle graph "${path}"`)
  return graph
}

function controlRigPinDefault(
  graphPath: string,
  pinPath: string,
) {
  const pin = controlRigGraph(graphPath).pins.find(
    (candidate) => candidate.path === pinPath,
  )
  if (!pin) throw new Error(`Missing CR_Als oracle pin "${pinPath}"`)
  return pin.defaultValue
}

function expectControlRigLink(
  graphPath: string,
  source: string,
  target: string,
) {
  expect(controlRigGraph(graphPath).links).toContainEqual({
    source,
    target,
  })
}

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

const FOOT_BONE_NAMES = [
  'root',
  'pelvis',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
] as const

const FOOT_PARENT_INDICES = new Int16Array([
  -1,
  0,
  1,
  2,
  3,
  4,
  1,
  6,
  7,
  8,
])

const FOOT_LOCAL_POSITIONS: readonly Vector3Tuple[] = [
  [0, 0, 0],
  [0, 1, 0],
  [0, -0.1, 0.12],
  [0, -0.4, 0],
  [0, -0.4, 0],
  [0.12, -0.04, 0],
  [0, -0.1, -0.12],
  [0, -0.4, 0],
  [0, -0.4, 0],
  [0.12, -0.04, 0],
]

function createFootTestRig() {
  const boneCount = FOOT_BONE_NAMES.length
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  for (let bone = 0; bone < boneCount; bone++) {
    referencePositions.set(FOOT_LOCAL_POSITIONS[bone], bone * 3)
    referenceRotations[bone * 4 + 3] = 1
    referenceScales.set([1, 1, 1], bone * 3)
  }
  return {
    boneCount,
    boneNames: FOOT_BONE_NAMES,
    parentIndices: FOOT_PARENT_INDICES,
    referencePositions,
    referenceRotations,
    referenceScales,
  } as unknown as RigDefinition
}

function createIkForwardSolveTestRig() {
  const footBoneCount = FOOT_BONE_NAMES.length
  const boneNames = [
    ...FOOT_BONE_NAMES,
    ...BONE_NAMES.slice(1),
  ]
  const boneCount = boneNames.length
  const parentIndices = new Int16Array(boneCount)
  parentIndices.set(FOOT_PARENT_INDICES)
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)

  for (let bone = 0; bone < footBoneCount; bone++) {
    referencePositions.set(FOOT_LOCAL_POSITIONS[bone], bone * 3)
  }
  for (let sourceBone = 1; sourceBone < BONE_NAMES.length; sourceBone++) {
    const bone = footBoneCount + sourceBone - 1
    const sourceParent = PARENT_INDICES[sourceBone]
    parentIndices[bone] = sourceParent === 0
      ? 0
      : footBoneCount + sourceParent - 1
    referencePositions.set(LOCAL_POSITIONS[sourceBone], bone * 3)
  }
  for (let bone = 0; bone < boneCount; bone++) {
    referenceRotations[bone * 4 + 3] = 1
    referenceScales.set([1, 1, 1], bone * 3)
  }

  return {
    boneCount,
    boneNames,
    parentIndices,
    referencePositions,
    referenceRotations,
    referenceScales,
  } as unknown as RigDefinition
}

function footTestInput(
  pose: LocalPoseBuffer,
  curves: ReadonlyMap<string, number>,
  trace: AlsControlRigFootOffsetTrace,
  overrides: Partial<{
    deltaTime: number
    bFootOffsetAllowed: boolean
    footLeftLocation: THREE.Vector3
    footLeftRotation: THREE.Quaternion
    footRightLocation: THREE.Vector3
    footRightRotation: THREE.Quaternion
  }> = {},
) {
  return {
    pose,
    curves,
    deltaTime: overrides.deltaTime ?? 1 / 60,
    trace,
    rigInput: {
      bFootOffsetAllowed: overrides.bFootOffsetAllowed ?? true,
      footLeftLocation:
        overrides.footLeftLocation
        ?? new THREE.Vector3(0, 0.1, 0.12),
      footLeftRotation:
        overrides.footLeftRotation
        ?? new THREE.Quaternion(),
      footRightLocation:
        overrides.footRightLocation
        ?? new THREE.Vector3(0, 0.1, -0.12),
      footRightRotation:
        overrides.footRightRotation
        ?? new THREE.Quaternion(),
    },
  }
}

function groundTrace(
  leftHeight: number,
  rightHeight = leftHeight,
  normal = new THREE.Vector3(0, 1, 0),
): AlsControlRigFootOffsetTrace {
  return (request) => ({
    impactPoint: new THREE.Vector3(
      request.start.x,
      request.side === 'left' ? leftHeight : rightHeight,
      request.start.z,
    ),
    impactNormal: normal,
  })
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

describe('CR_Als foot IK authored graph parity', () => {
  it('pins construction, graph order, trace, pelvis, solve, and rotation constants', () => {
    const construction = 'RigVMModel'
    const trace =
      'RigVMFunctionLibrary/TraceFootOffset/New Function_ContainedGraph'
    const pelvis =
      'RigVMFunctionLibrary/RefreshPelvisOffset/ContainedGraph'
    const apply =
      'RigVMFunctionLibrary/ApplyFootIk/New Function_ContainedGraph'
    const refresh =
      'RigVMFunctionLibrary/RefreshFootIk/ContainedGraph'

    expect(controlRigPinDefault(
      construction,
      'GetTransform/Item/Name',
    )).toBe(ALS_CONTROL_RIG_FOOT_IK.construction.footHeightItem)
    expect(controlRigPinDefault(
      construction,
      'AlsRigUnit_ChainLength/AncestorItem/Name',
    )).toBe(
      ALS_CONTROL_RIG_FOOT_IK.construction.legLengthAncestorItem,
    )
    expect(controlRigPinDefault(
      construction,
      'AlsRigUnit_ChainLength/DescendantItem/Name',
    )).toBe(
      ALS_CONTROL_RIG_FOOT_IK.construction.legLengthDescendantItem,
    )
    expectControlRigLink(
      construction,
      'RefreshFootOffset.Input',
      'RefreshPelvisOffset.Input',
    )
    expectControlRigLink(
      construction,
      'RefreshPelvisOffset.Input',
      'RefreshFootIk.Input',
    )

    expect(Number(controlRigPinDefault(
      trace,
      'AlsRigUnit_FootOffset/TraceDistanceUpward',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.trace.traceDistanceUpward)
    expect(Number(controlRigPinDefault(
      trace,
      'AlsRigUnit_FootOffset/TraceDistanceDownward',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.trace.traceDistanceDownward)
    expect(controlRigPinDefault(
      trace,
      'AlsRigUnit_FootOffset/TraceChannel',
    )).toBe('ECC_Visibility')
    expect(controlRigPinDefault(
      trace,
      'AlsRigUnit_FootOffset/bDrawDebug',
    )).toBe('False')
    expect(Number(controlRigPinDefault(
      trace,
      'LessEqual_1/B',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.trace.footIkAmountThreshold)

    expect(Number(controlRigPinDefault(
      pelvis,
      'Clamp/Minimum',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pelvis.minimumOffset)
    expect(Number(controlRigPinDefault(
      pelvis,
      'Clamp/Maximum',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pelvis.maximumOffset)
    expect(Number(controlRigPinDefault(
      pelvis,
      'MathFloatMul_2/B',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pelvis.amountScale)
    expect(Number(controlRigPinDefault(
      pelvis,
      'Greater_1/B',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pelvis.relevanceThreshold)
    expect(Number(controlRigPinDefault(
      pelvis,
      'SpringInterpV2_1_1/Strength',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pelvis.spring.strength)
    expect(Number(controlRigPinDefault(
      pelvis,
      'SpringInterpV2_1_1/CriticalDamping',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.pelvis.spring.criticalDamping,
    )
    expect(Number(controlRigPinDefault(
      pelvis,
      'SpringInterpV2_1_1/TargetVelocityAmount',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.pelvis.spring.targetVelocityAmount,
    )
    expect(controlRigPinDefault(
      pelvis,
      'SpringInterpV2_1_1/bUseCurrentInput',
    )).toBe('false')
    expect(controlRigPinDefault(
      pelvis,
      'SpringInterpV2_1_1/bInitializeFromTarget',
    )).toBe('true')

    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation/MaxLegStretchRatio',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footLocation.maximumLegStretchRatio,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation/MinPelvisToFootDistanceZ',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footLocation
        .minimumPelvisToFootDistance,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationFrequency',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footLocation.interpolationFrequency,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationDampingRatio',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footLocation
        .interpolationDampingRatio,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation/OffsetInterpolationTargetVelocityAmount',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footLocation
        .interpolationTargetVelocityAmount,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'MathVectorScale_2/Factor',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pole.distance)
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigVMFunction_ExponentialDecayVector/Lambda',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.pole.interpolationLambda)
    expect(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetRotation/LimitOffset',
    )).toBe('(X=0.001903,Y=-0.043578,Z=0.043578,W=0.998097)')
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetRotation/Swing1LimitAngle',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footRotation.swing1LimitAngle,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetRotation/Swing2LimitAngle',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footRotation.swing2LimitAngle,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetRotation/TwistLimitAngle',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footRotation.twistLimitAngle,
    )
    expect(Number(controlRigPinDefault(
      apply,
      'AlsRigUnit_ApplyFootOffsetRotation/OffsetInterpolationSpeed',
    ))).toBe(
      ALS_CONTROL_RIG_FOOT_IK.footRotation.interpolationSpeed,
    )
    expect(controlRigPinDefault(
      apply,
      'TwoBoneIKSimplePerItem/PoleVectorKind',
    )).toBe(ALS_CONTROL_RIG_FOOT_IK.twoBoneIk.poleVectorKind)
    expect(Number(controlRigPinDefault(
      apply,
      'TwoBoneIKSimplePerItem/SecondaryAxisWeight',
    ))).toBe(ALS_CONTROL_RIG_FOOT_IK.twoBoneIk.secondaryAxisWeight)
    expect(controlRigPinDefault(
      apply,
      'TwoBoneIKSimplePerItem/bEnableStretch',
    )).toBe('false')
    expect(controlRigPinDefault(
      apply,
      'TwoBoneIKSimplePerItem/bPropagateToChildren',
    )).toBe('true')
    expectControlRigLink(
      apply,
      'Entry.Input',
      'AlsRigUnit_ApplyFootOffsetLocation.ExecuteContext',
    )
    expectControlRigLink(
      apply,
      'AlsRigUnit_ApplyFootOffsetLocation.ExecuteContext',
      'TwoBoneIKSimplePerItem.ExecuteContext',
    )
    expectControlRigLink(
      apply,
      'TwoBoneIKSimplePerItem.ExecuteContext',
      'AlsRigUnit_ApplyFootOffsetRotation.ExecuteContext',
    )

    expect(ALS_CONTROL_RIG_FOOT_IK.feet.map((foot) => foot.side))
      .toEqual(['left', 'right'])
    for (
      let footIndex = 0;
      footIndex < ALS_CONTROL_RIG_FOOT_IK.feet.length;
      footIndex++
    ) {
      const definition = ALS_CONTROL_RIG_FOOT_IK.feet[footIndex]
      const node = footIndex === 0 ? 'ApplyFootIk' : 'ApplyFootIk_1'
      const curveNode = footIndex === 0
        ? 'GetCurveValue_2'
        : 'GetCurveValue_2_1'
      expect(controlRigPinDefault(
        refresh,
        `${node}/PelvisItem/Name`,
      )).toBe(definition.pelvisItem)
      expect(controlRigPinDefault(
        refresh,
        `${node}/ThighItem/Name`,
      )).toBe(definition.thighItem)
      expect(controlRigPinDefault(
        refresh,
        `${node}/CalfItem/Name`,
      )).toBe(definition.calfItem)
      expect(controlRigPinDefault(
        refresh,
        `${node}/FootItem/Name`,
      )).toBe(definition.footItem)
      expect(Number(controlRigPinDefault(
        refresh,
        `${node}/PrimaryAxis/X`,
      ))).toBe(definition.primaryAxis[0])
      expect(Number(controlRigPinDefault(
        refresh,
        `${node}/SecondaryAxis/Y`,
      ))).toBe(definition.secondaryAxis[1])
      expect(controlRigPinDefault(
        refresh,
        `${curveNode}/Curve`,
      )).toBe(definition.curveName)
    }
    expectControlRigLink(refresh, 'Entry.Input', 'ApplyFootIk.Input')
    expectControlRigLink(
      refresh,
      'ApplyFootIk.Input',
      'ApplyFootIk_1.Input',
    )
  })

  it('derives the authored foot height and shared left-leg chain length', () => {
    const runtime = createAlsControlRigFootIkRuntime(
      createFootTestRig(),
    )
    expect(runtime.footHeight).toBeCloseTo(0.1, 6)
    expect(runtime.legLength).toBeCloseTo(0.8, 6)
  })
})

describe('CR_Als pure foot offset and pelvis stage', () => {
  it('traces left then right from absolute +50 cm to -80 cm in rig space', () => {
    const rig = createFootTestRig()
    const pose = createTestPose(rig)
    const requests: {
      side: string
      start: THREE.Vector3
      end: THREE.Vector3
    }[] = []
    evaluateAlsControlRigFootIk(
      createAlsControlRigFootIkRuntime(rig),
      footTestInput(
        pose,
        new Map([
          ['FootLeftIk', 1],
          ['FootRightIk', 1],
        ]),
        (request) => {
          requests.push({
            side: request.side,
            start: request.start.clone(),
            end: request.end.clone(),
          })
          return {
            impactPoint: new THREE.Vector3(
              request.start.x,
              0,
              request.start.z,
            ),
            impactNormal: new THREE.Vector3(0, 1, 0),
          }
        },
      ),
    )

    expect(requests.map((request) => request.side))
      .toEqual(['left', 'right'])
    expectVectorClose(
      requests[0].start,
      new THREE.Vector3(0, 0.5, 0.12),
    )
    expectVectorClose(
      requests[0].end,
      new THREE.Vector3(0, -0.8, 0.12),
    )
    expectVectorClose(
      requests[1].start,
      new THREE.Vector3(0, 0.5, -0.12),
    )
  })

  it('uses the authored allowed-or-negligible trace gate and resets disabled output', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    const sides: string[] = []
    const trace: AlsControlRigFootOffsetTrace = (request) => {
      sides.push(request.side)
      return {
        impactPoint: new THREE.Vector3(0, 0.2, 0),
        impactNormal: new THREE.Vector3(0, 1, 0),
      }
    }

    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(
        pose,
        new Map([
          ['FootLeftIk', 0],
          ['FootRightIk', 1],
        ]),
        trace,
        { bFootOffsetAllowed: false },
      ),
    )
    expect(sides).toEqual(['left'])
    expect(runtime.feet[0].footOffsetLocation).toBeCloseTo(0.2)
    expect(runtime.feet[1].footOffsetLocation).toBe(0)
    expect(runtime.feet[1].footOffsetNormal.toArray())
      .toEqual([0, 1, 0])
  })

  it('applies slope-height correction and accepts every blocking hit normal', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    const normal = new THREE.Vector3(
      0,
      Math.SQRT1_2,
      Math.SQRT1_2,
    )
    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(
        pose,
        new Map(),
        groundTrace(0, 0, normal),
      ),
    )
    const expected =
      runtime.footHeight / normal.y - runtime.footHeight
    expect(runtime.feet[0].footOffsetLocation)
      .toBeCloseTo(expected, 7)
    expectVectorClose(runtime.feet[0].footOffsetNormal, normal, 7)
  })

  it('uses min(left,right), clamps to -30/+40 cm, and weights the pelvis write', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(
        pose,
        new Map([
          ['FootLeftIk', 1],
          ['FootRightIk', 0],
        ]),
        groundTrace(-1, 0.8),
      ),
    )
    const transforms = componentTransforms(rig, pose)

    expect(runtime.pelvisOffsetAmount).toBe(0.5)
    expect(runtime.pelvisOffset).toBeCloseTo(-0.3, 7)
    // The stored spring result is -0.3 m; FRigUnit_SetTranslation writes at curve-average 0.5.
    expect(transforms[index(rig, 'pelvis')].position.y)
      .toBeCloseTo(0.85, 6)
  })

  it('keeps every local transform bit-identical at zero weights while advancing foot state', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    const before = pose.data.slice()
    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(pose, new Map(), groundTrace(0.1)),
    )

    expect(pose.data).toEqual(before)
    expect(runtime.pelvisOffsetAmount).toBe(0)
    expect(runtime.feet[0].offsetLocationInitialized).toBe(true)
    expect(runtime.feet[0].poleLocationInitialized).toBe(true)
    expect(runtime.feet[0].offsetNormalInitialized).toBe(true)
  })

  it('snaps each foot-location unit twice before starting its authored spring damper', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    const curves = new Map<string, number>()

    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(pose, curves, groundTrace(0)),
    )
    expect(runtime.feet[0].offsetLocation).toBeCloseTo(0, 7)
    expect(runtime.feet[0].offsetLocationSpring.valid).toBe(false)

    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(pose, curves, groundTrace(0.1)),
    )
    expect(runtime.feet[0].offsetLocation).toBeCloseTo(0.1, 7)
    expect(runtime.feet[0].offsetLocationSpring.valid).toBe(true)

    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(pose, curves, groundTrace(0.2)),
    )
    expect(runtime.feet[0].offsetLocation).toBeGreaterThan(0.1)
    expect(runtime.feet[0].offsetLocation).toBeLessThan(0.2)
  })

  it('runs the exact no-stretch solve and propagates unchanged child locals', () => {
    const rig = createFootTestRig()
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const pose = createTestPose(rig)
    const ballLeft = index(rig, 'ball_l')
    const ballLeftLocal = pose.positions.slice(
      ballLeft * 3,
      ballLeft * 3 + 3,
    )
    evaluateAlsControlRigFootIk(
      runtime,
      footTestInput(
        pose,
        new Map([
          ['FootLeftIk', 1],
          ['FootRightIk', 1],
        ]),
        groundTrace(0),
      ),
    )
    const transforms = componentTransforms(rig, pose)
    const thighLeft = transforms[index(rig, 'thigh_l')].position
    const footLeft = transforms[index(rig, 'foot_l')].position

    expect(footLeft.distanceTo(thighLeft))
      .toBeCloseTo(runtime.legLength * 0.99, 5)
    expect([...pose.positions.slice(
      ballLeft * 3,
      ballLeft * 3 + 3,
    )]).toEqual([...ballLeftLocal])
  })

  it('conjugates the authored Unreal axes into the glTF pose basis', () => {
    const rig = createFootTestRig()
    const pose = createTestPose(rig)
    evaluateAlsControlRigFootIk(
      createAlsControlRigFootIkRuntime(rig),
      footTestInput(
        pose,
        new Map([
          ['FootLeftIk', 1],
          ['FootRightIk', 1],
        ]),
        groundTrace(0),
      ),
    )
    const transforms = componentTransforms(rig, pose)

    for (const side of ['l', 'r'] as const) {
      const thigh = transforms[index(rig, `thigh_${side}`)]
      const calf = transforms[index(rig, `calf_${side}`)]
      const foot = transforms[index(rig, `foot_${side}`)]
      const primary = new THREE.Vector3(
        side === 'l' ? -1 : 1,
        0,
        0,
      )
      const secondary = new THREE.Vector3(
        0,
        0,
        side === 'l' ? 1 : -1,
      )
      const upperDirection = calf.position.clone()
        .sub(thigh.position)
        .normalize()
      const lowerDirection = foot.position.clone()
        .sub(calf.position)
        .normalize()
      expect(
        primary.clone().applyQuaternion(thigh.rotation)
          .dot(upperDirection),
      ).toBeGreaterThan(0.99999)
      expect(
        primary.clone().applyQuaternion(calf.rotation)
          .dot(lowerDirection),
      ).toBeGreaterThan(0.99999)

      const bend = calf.position.clone().sub(
        foot.position.clone().add(thigh.position).multiplyScalar(0.5),
      )
      const upperBend = bend.clone()
        .addScaledVector(
          upperDirection,
          -bend.dot(upperDirection),
        )
        .normalize()
      expect(
        secondary.clone().applyQuaternion(thigh.rotation)
          .dot(upperBend),
      ).toBeGreaterThan(0.99999)
    }
  })

  it('returns the supplied pose buffer for post-pose pipeline chaining', () => {
    const rig = createFootTestRig()
    const pose = createTestPose(rig)
    expect(evaluateAlsControlRigFootIk(
      createAlsControlRigFootIkRuntime(rig),
      footTestInput(pose, new Map(), () => null),
    )).toBe(pose)
  })
})

describe('CR_Als IK forward-solve tail', () => {
  it('pins the contiguous foot, pelvis, foot IK, then hand IK graph order', () => {
    expect(ALS_CONTROL_RIG_IK_FORWARD_SOLVE.executionOrder).toEqual([
      'RefreshFootOffset',
      'RefreshPelvisOffset',
      'RefreshFootIk',
      'RefreshHandIk',
    ])
    expectControlRigLink(
      'RigVMModel',
      'RefreshFootOffset.Input',
      'RefreshPelvisOffset.Input',
    )
    expectControlRigLink(
      'RigVMModel',
      'RefreshPelvisOffset.Input',
      'RefreshFootIk.Input',
    )
    expectControlRigLink(
      'RigVMModel',
      'RefreshFootIk.Input',
      'RefreshHandIk.Input',
    )
  })

  it('runs both foot traces before mutating the arms for hand IK', () => {
    const rig = createIkForwardSolveTestRig()
    const runtime = createAlsControlRigIkForwardSolveRuntime(rig)
    const pose = createTestPose(rig)
    const upperArmLeft = index(rig, 'upperarm_l')
    const upperArmRight = index(rig, 'upperarm_r')
    const armRotationsBefore = [
      ...pose.rotations.slice(
        upperArmLeft * 4,
        upperArmLeft * 4 + 4,
      ),
      ...pose.rotations.slice(
        upperArmRight * 4,
        upperArmRight * 4 + 4,
      ),
    ]
    const tracedSides: string[] = []
    const curves = new Map([
      ['FootLeftIk', 1],
      ['FootRightIk', 1],
      ...allHandIkCurves(),
    ])
    const input = footTestInput(
      pose,
      curves,
      (traceRequest) => {
        tracedSides.push(traceRequest.side)
        expect([
          ...pose.rotations.slice(
            upperArmLeft * 4,
            upperArmLeft * 4 + 4,
          ),
          ...pose.rotations.slice(
            upperArmRight * 4,
            upperArmRight * 4 + 4,
          ),
        ]).toEqual(armRotationsBefore)
        return {
          impactPoint: new THREE.Vector3(
            traceRequest.start.x,
            0,
            traceRequest.start.z,
          ),
          impactNormal: new THREE.Vector3(0, 1, 0),
        }
      },
    )

    expect(evaluateAlsControlRigIkForwardSolve(runtime, input))
      .toBe(pose)
    expect(tracedSides).toEqual(['left', 'right'])
    expect([
      ...pose.rotations.slice(
        upperArmLeft * 4,
        upperArmLeft * 4 + 4,
      ),
      ...pose.rotations.slice(
        upperArmRight * 4,
        upperArmRight * 4 + 4,
      ),
    ]).not.toEqual(armRotationsBefore)
  })
})
