import * as THREE from 'three'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import { unrealYawDegreesToThreeRadians } from '../../engine/unrealCoordinateSpace'

const SMALL_NUMBER = 1e-8
const KINDA_SMALL_NUMBER = 1e-4
const FIND_BETWEEN_NORMALS_EPSILON = 1e-6
const CENTIMETERS_TO_METERS = 0.01
// FVector::IsNearlyZero() uses 1e-4 cm, and FVector::Normalize() compares
// SizeSquared() with 1e-8 cm². Both become a 1e-6 m length threshold.
const POSITION_KINDA_SMALL_NUMBER = KINDA_SMALL_NUMBER * CENTIMETERS_TO_METERS
const POSITION_SMALL_NUMBER_SQUARED =
  SMALL_NUMBER * CENTIMETERS_TO_METERS * CENTIMETERS_TO_METERS
const RUNTIME_UP = new THREE.Vector3(0, 1, 0)

export type AlsControlRigFootSide = 'left' | 'right'

export interface AlsControlRigFootIkDefinition {
  readonly side: AlsControlRigFootSide
  readonly pelvisItem: 'pelvis'
  readonly thighItem: 'thigh_l' | 'thigh_r'
  readonly calfItem: 'calf_l' | 'calf_r'
  readonly footItem: 'foot_l' | 'foot_r'
  /** Authored CR_Als axis in Unreal's local coordinate basis. */
  readonly primaryAxis: readonly [number, number, number]
  /** Authored CR_Als axis in Unreal's local coordinate basis. */
  readonly secondaryAxis: readonly [number, number, number]
  readonly curveName: 'FootLeftIk' | 'FootRightIk'
}

/**
 * The checked-in CR_Als graph contract, expressed in the units stored in the uasset.
 *
 * Runtime pose values are metres in the glTF basis. Conversion happens once when these constants
 * enter the evaluator; keeping the oracle in centimetres makes drift against CR_Als.json visible.
 */
export const ALS_CONTROL_RIG_FOOT_IK = {
  construction: {
    footHeightItem: 'foot_l',
    legLengthAncestorItem: 'thigh_l',
    legLengthDescendantItem: 'foot_l',
  },
  executionOrder: [
    'RefreshFootOffset',
    'RefreshPelvisOffset',
    'RefreshFootIk',
  ],
  footExecutionOrder: ['left', 'right'],
  trace: {
    traceChannel: 'Visibility',
    traceDistanceUpward: 50,
    traceDistanceDownward: 80,
    footIkAmountThreshold: 0.0001,
    ignoreOwningActor: true,
    drawDebug: false,
  },
  pelvis: {
    amountScale: 0.5,
    relevanceThreshold: 0.0001,
    minimumOffset: -30,
    maximumOffset: 40,
    spring: {
      strength: 2,
      criticalDamping: 1,
      force: 0,
      targetVelocityAmount: 0,
      useCurrentInput: false,
      initializeFromTarget: true,
    },
  },
  footLocation: {
    minimumPelvisToFootDistance: 50,
    maximumLegStretchRatio: 0.99,
    interpolationFrequency: 0.4,
    interpolationDampingRatio: 4,
    interpolationTargetVelocityAmount: 1,
  },
  pole: {
    distance: 40,
    interpolationLambda: 15,
  },
  footRotation: {
    limitOffset: [
      0.001903,
      -0.043578,
      0.043578,
      0.998097,
    ] as const,
    interpolationSpeed: 20,
    swing1LimitAngle: 25,
    swing2LimitAngle: 5,
    twistLimitAngle: 0,
  },
  twoBoneIk: {
    poleVectorKind: 'Location',
    secondaryAxisWeight: 1,
    stretchEnabled: false,
    propagateToChildren: true,
  },
  feet: [
    {
      side: 'left',
      pelvisItem: 'pelvis',
      thighItem: 'thigh_l',
      calfItem: 'calf_l',
      footItem: 'foot_l',
      primaryAxis: [-1, 0, 0],
      secondaryAxis: [0, 1, 0],
      curveName: 'FootLeftIk',
    },
    {
      side: 'right',
      pelvisItem: 'pelvis',
      thighItem: 'thigh_r',
      calfItem: 'calf_r',
      footItem: 'foot_r',
      primaryAxis: [1, 0, 0],
      secondaryAxis: [0, -1, 0],
      curveName: 'FootRightIk',
    },
  ],
} as const

export interface AlsControlRigFootOffsetTraceRequest {
  readonly side: AlsControlRigFootSide
  /** Rig/component-space glTF metres. This object is reused; do not retain it. */
  readonly start: THREE.Vector3
  /** Rig/component-space glTF metres. This object is reused; do not retain it. */
  readonly end: THREE.Vector3
  readonly traceChannel: 'Visibility'
  readonly ignoreOwningActor: true
}

export interface AlsControlRigFootOffsetTraceHit {
  /** Rig/component-space glTF metres. */
  readonly impactPoint: THREE.Vector3
  /** Rig/component-space glTF direction. */
  readonly impactNormal: THREE.Vector3
}

/**
 * Physics seam for FAlsRigUnit_FootOffsetTrace. The live adapter owns rig↔world conversion and
 * actor filtering; returning null is the exact `!Hit.bBlockingHit` path.
 */
export type AlsControlRigFootOffsetTrace = (
  request: AlsControlRigFootOffsetTraceRequest,
) => AlsControlRigFootOffsetTraceHit | null

export interface AlsControlRigFootIkInputState {
  readonly bFootOffsetAllowed: boolean
  /** FAlsControlRigInput values converted to component-space glTF metres. */
  readonly footLeftLocation: THREE.Vector3
  readonly footLeftRotation: THREE.Quaternion
  readonly footRightLocation: THREE.Vector3
  readonly footRightRotation: THREE.Quaternion
}

/** FAlsControlRigInput fields consumed by CR_Als's complete Forward Solve chain. */
export interface AlsControlRigInputState
  extends AlsControlRigFootIkInputState {
  readonly bUseHandIkBones: boolean
  readonly bUseFootIkBones: boolean
  readonly velocityBlendForwardAmount: number
  readonly velocityBlendBackwardAmount: number
  readonly spineYawAngle: number
}

export interface EvaluateAlsControlRigFootIkInput {
  readonly pose: LocalPoseBuffer
  readonly curves: AlsControlRigCurveValues
  readonly rigInput: AlsControlRigFootIkInputState
  readonly deltaTime: number
  readonly trace: AlsControlRigFootOffsetTrace
}

export type AlsControlRigHandSide = 'left' | 'right'

export interface AlsControlRigHandIkDefinition {
  readonly side: AlsControlRigHandSide
  readonly itemA: string
  readonly itemB: string
  readonly effectorItem: string
  readonly targetWhenUsingHandIkBones: string
  readonly targetOtherwise: string
  readonly layerCurveName: string
  readonly handIkCurveName: string
  readonly primaryAxis: readonly [number, number, number]
  readonly secondaryAxis: readonly [number, number, number]
  readonly secondaryAxisWeight: 1
  readonly poleVector: readonly [number, number, number]
  readonly poleVectorKind: 'Location'
  readonly poleVectorSpace: string
  readonly stretchEnabled: false
  readonly stretchStartRatio: 0.75
  readonly stretchMaximumRatio: 1.25
  readonly propagateToChildren: true
}

/**
 * CR_Als.RefreshHandIk's exact authored execution order and Basic IK pins.
 *
 * VERIFIED from scripts/extract-als/control-rig/CR_Als.json and
 * scripts/extract-als/hand-virtual-bones.json. The stretch ratios remain serialized even though
 * bEnableStretch is false.
 */
export const ALS_CONTROL_RIG_HAND_IK = [
  {
    side: 'left',
    itemA: 'upperarm_l',
    itemB: 'lowerarm_l',
    effectorItem: 'hand_l',
    targetWhenUsingHandIkBones: 'VB ik_hand_l',
    targetOtherwise: 'VB hand_l',
    layerCurveName: 'LayerArmLeft',
    handIkCurveName: 'HandLeftIk',
    primaryAxis: [1, 0, 0],
    secondaryAxis: [0, -1, 0],
    secondaryAxisWeight: 1,
    poleVector: [0, -30, 0],
    poleVectorKind: 'Location',
    poleVectorSpace: 'lowerarm_l',
    stretchEnabled: false,
    stretchStartRatio: 0.75,
    stretchMaximumRatio: 1.25,
    propagateToChildren: true,
  },
  {
    side: 'right',
    itemA: 'upperarm_r',
    itemB: 'lowerarm_r',
    effectorItem: 'hand_r',
    targetWhenUsingHandIkBones: 'VB ik_hand_r',
    targetOtherwise: 'VB hand_r',
    layerCurveName: 'LayerArmRight',
    handIkCurveName: 'HandRightIk',
    primaryAxis: [-1, 0, 0],
    secondaryAxis: [0, 1, 0],
    secondaryAxisWeight: 1,
    poleVector: [0, 30, 0],
    poleVectorKind: 'Location',
    poleVectorSpace: 'lowerarm_r',
    stretchEnabled: false,
    stretchStartRatio: 0.75,
    stretchMaximumRatio: 1.25,
    propagateToChildren: true,
  },
] as const satisfies readonly AlsControlRigHandIkDefinition[]

export interface AlsControlRigCurveValues {
  get(name: string): number | undefined
}

export interface EvaluateAlsControlRigHandIkInput {
  readonly pose: LocalPoseBuffer
  readonly curves: AlsControlRigCurveValues
  /** FAlsGeneralAnimationSettings::bUseHandIkBones. The authored default is true. */
  readonly useHandIkBones?: boolean
}

interface MutableTransform {
  readonly position: THREE.Vector3
  readonly rotation: THREE.Quaternion
  readonly scale: THREE.Vector3
}

interface AlsControlRigTransformScratch {
  readonly parentTransform: MutableTransform
  readonly inverseRotation: THREE.Quaternion
  readonly componentVector: THREE.Vector3
  readonly localPosition: THREE.Vector3
  readonly localRotation: THREE.Quaternion
  readonly localScale: THREE.Vector3
}

interface AlsControlRigTransformRuntime {
  readonly rig: RigDefinition
  readonly componentPositions: Float32Array
  readonly componentRotations: Float32Array
  readonly componentScales: Float32Array
  readonly scratch: AlsControlRigTransformScratch
}

interface CompiledHandIkDefinition {
  readonly definition: AlsControlRigHandIkDefinition
  readonly itemAIndex: number
  readonly itemBIndex: number
  readonly effectorItemIndex: number
  readonly targetWhenUsingHandIkBonesIndex: number
  readonly targetOtherwiseIndex: number
  readonly poleVectorSpaceIndex: number
  /** CR_Als local axes converted from Unreal to the glTF pose basis. */
  readonly primaryAxis: readonly [number, number, number]
  readonly secondaryAxis: readonly [number, number, number]
  /** CR_Als local pole location converted from Unreal centimetres to glTF metres. */
  readonly poleVector: readonly [number, number, number]
}

interface AlsControlRigHandIkScratch
  extends AlsControlRigTransformScratch {
  readonly transformA: MutableTransform
  readonly transformB: MutableTransform
  readonly transformC: MutableTransform
  readonly originalA: MutableTransform
  readonly originalB: MutableTransform
  readonly originalC: MutableTransform
  readonly parentTransform: MutableTransform
  readonly targetRotationA: THREE.Quaternion
  readonly targetRotationB: THREE.Quaternion
  readonly targetRotationC: THREE.Quaternion
  readonly inverseRotation: THREE.Quaternion
  readonly rotationDelta: THREE.Quaternion
  readonly componentVector: THREE.Vector3
  readonly initialDifference: THREE.Vector3
  readonly lengthScale: THREE.Vector3
  readonly poleTarget: THREE.Vector3
  readonly boneBLocation: THREE.Vector3
  readonly baseDirection: THREE.Vector3
  readonly desiredDelta: THREE.Vector3
  readonly desiredDirection: THREE.Vector3
  readonly jointTargetDelta: THREE.Vector3
  readonly jointPlaneNormal: THREE.Vector3
  readonly jointBendDirection: THREE.Vector3
  readonly bestAxis: THREE.Vector3
  readonly axis: THREE.Vector3
  readonly target1: THREE.Vector3
  readonly target2: THREE.Vector3
  readonly localPositionB: THREE.Vector3
  readonly localPositionC: THREE.Vector3
  readonly localPosition: THREE.Vector3
  readonly localRotation: THREE.Quaternion
  readonly localScale: THREE.Vector3
}

export interface AlsControlRigHandIkRuntime {
  readonly rig: RigDefinition
  readonly solvers: readonly CompiledHandIkDefinition[]
  readonly initialComponentPositions: Float32Array
  readonly initialComponentScales: Float32Array
  readonly componentPositions: Float32Array
  readonly componentRotations: Float32Array
  readonly componentScales: Float32Array
  readonly scratch: AlsControlRigHandIkScratch
}

function createTransform(): MutableTransform {
  return {
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  }
}

function createScratch(): AlsControlRigHandIkScratch {
  return {
    transformA: createTransform(),
    transformB: createTransform(),
    transformC: createTransform(),
    originalA: createTransform(),
    originalB: createTransform(),
    originalC: createTransform(),
    parentTransform: createTransform(),
    targetRotationA: new THREE.Quaternion(),
    targetRotationB: new THREE.Quaternion(),
    targetRotationC: new THREE.Quaternion(),
    inverseRotation: new THREE.Quaternion(),
    rotationDelta: new THREE.Quaternion(),
    componentVector: new THREE.Vector3(),
    initialDifference: new THREE.Vector3(),
    lengthScale: new THREE.Vector3(),
    poleTarget: new THREE.Vector3(),
    boneBLocation: new THREE.Vector3(),
    baseDirection: new THREE.Vector3(),
    desiredDelta: new THREE.Vector3(),
    desiredDirection: new THREE.Vector3(),
    jointTargetDelta: new THREE.Vector3(),
    jointPlaneNormal: new THREE.Vector3(),
    jointBendDirection: new THREE.Vector3(),
    bestAxis: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    target1: new THREE.Vector3(),
    target2: new THREE.Vector3(),
    localPositionB: new THREE.Vector3(),
    localPositionC: new THREE.Vector3(),
    localPosition: new THREE.Vector3(),
    localRotation: new THREE.Quaternion(),
    localScale: new THREE.Vector3(),
  }
}

function requireBoneIndex(rig: RigDefinition, boneName: string) {
  const index = rig.boneNames.indexOf(boneName)
  if (index < 0) {
    throw new Error(`CR_Als hand IK requires bone "${boneName}"`)
  }
  return index
}

function compileSolver(
  rig: RigDefinition,
  definition: AlsControlRigHandIkDefinition,
): CompiledHandIkDefinition {
  const itemAIndex = requireBoneIndex(rig, definition.itemA)
  const itemBIndex = requireBoneIndex(rig, definition.itemB)
  const effectorItemIndex = requireBoneIndex(rig, definition.effectorItem)
  if (
    rig.parentIndices[itemBIndex] !== itemAIndex
    || rig.parentIndices[effectorItemIndex] !== itemBIndex
  ) {
    throw new Error(
      `CR_Als ${definition.side} hand IK requires the authored `
      + `${definition.itemA} -> ${definition.itemB} -> `
      + `${definition.effectorItem} chain`,
    )
  }

  return {
    definition,
    itemAIndex,
    itemBIndex,
    effectorItemIndex,
    targetWhenUsingHandIkBonesIndex: requireBoneIndex(
      rig,
      definition.targetWhenUsingHandIkBones,
    ),
    targetOtherwiseIndex: requireBoneIndex(
      rig,
      definition.targetOtherwise,
    ),
    poleVectorSpaceIndex: requireBoneIndex(
      rig,
      definition.poleVectorSpace,
    ),
    primaryAxis: convertUnrealVectorTupleToGltf(
      definition.primaryAxis,
    ),
    secondaryAxis: convertUnrealVectorTupleToGltf(
      definition.secondaryAxis,
    ),
    poleVector: convertUnrealPositionTupleToGltf(
      definition.poleVector,
    ),
  }
}

function normalizeQuaternion(
  quaternion: THREE.Quaternion,
  context: string,
) {
  const lengthSquared = quaternion.lengthSq()
  if (!Number.isFinite(lengthSquared) || lengthSquared <= SMALL_NUMBER) {
    throw new Error(`CR_Als ${context} contains an invalid quaternion`)
  }
  return quaternion.normalize()
}

function isNearlyZero(vector: THREE.Vector3) {
  return Math.abs(vector.x) <= POSITION_KINDA_SMALL_NUMBER
    && Math.abs(vector.y) <= POSITION_KINDA_SMALL_NUMBER
    && Math.abs(vector.z) <= POSITION_KINDA_SMALL_NUMBER
}

function refreshComponentTransformsFromArrays(
  runtime: AlsControlRigTransformRuntime,
  positions: Float32Array,
  rotations: Float32Array,
  scales: Float32Array,
) {
  const {
    rig,
    componentPositions,
    componentRotations,
    componentScales,
    scratch,
  } = runtime

  for (let bone = 0; bone < rig.boneCount; bone++) {
    const parent = rig.parentIndices[bone]
    if (parent >= bone) {
      throw new Error(
        `CR_Als requires parent-before-child compact-pose order at `
        + `"${rig.boneNames[bone]}"`,
      )
    }
    const p = bone * 3
    const q = bone * 4
    scratch.localRotation.set(
      rotations[q],
      rotations[q + 1],
      rotations[q + 2],
      rotations[q + 3],
    )
    normalizeQuaternion(scratch.localRotation, `"${rig.boneNames[bone]}"`)

    if (parent < 0) {
      componentPositions[p] = positions[p]
      componentPositions[p + 1] = positions[p + 1]
      componentPositions[p + 2] = positions[p + 2]
      scratch.localRotation.toArray(componentRotations, q)
      componentScales[p] = scales[p]
      componentScales[p + 1] = scales[p + 1]
      componentScales[p + 2] = scales[p + 2]
      continue
    }

    const parentPositionOffset = parent * 3
    const parentRotationOffset = parent * 4
    scratch.parentTransform.rotation.set(
      componentRotations[parentRotationOffset],
      componentRotations[parentRotationOffset + 1],
      componentRotations[parentRotationOffset + 2],
      componentRotations[parentRotationOffset + 3],
    )
    scratch.componentVector.set(
      positions[p] * componentScales[parentPositionOffset],
      positions[p + 1] * componentScales[parentPositionOffset + 1],
      positions[p + 2] * componentScales[parentPositionOffset + 2],
    )
    scratch.componentVector.applyQuaternion(
      scratch.parentTransform.rotation,
    )
    componentPositions[p] =
      componentPositions[parentPositionOffset]
      + scratch.componentVector.x
    componentPositions[p + 1] =
      componentPositions[parentPositionOffset + 1]
      + scratch.componentVector.y
    componentPositions[p + 2] =
      componentPositions[parentPositionOffset + 2]
      + scratch.componentVector.z
    scratch.localRotation
      .premultiply(scratch.parentTransform.rotation)
      .normalize()
      .toArray(componentRotations, q)
    componentScales[p] =
      componentScales[parentPositionOffset] * scales[p]
    componentScales[p + 1] =
      componentScales[parentPositionOffset + 1] * scales[p + 1]
    componentScales[p + 2] =
      componentScales[parentPositionOffset + 2] * scales[p + 2]
  }
}

function refreshComponentTransforms(
  runtime: AlsControlRigTransformRuntime,
  pose: LocalPoseBuffer,
) {
  refreshComponentTransformsFromArrays(
    runtime,
    pose.positions,
    pose.rotations,
    pose.scales,
  )
}

function loadComponentTransform(
  runtime: AlsControlRigTransformRuntime,
  bone: number,
  out: MutableTransform,
) {
  const p = bone * 3
  const q = bone * 4
  out.position.fromArray(runtime.componentPositions, p)
  out.rotation.fromArray(runtime.componentRotations, q)
  out.scale.fromArray(runtime.componentScales, p)
  return out
}

function copyTransform(source: MutableTransform, out: MutableTransform) {
  out.position.copy(source.position)
  out.rotation.copy(source.rotation)
  out.scale.copy(source.scale)
  return out
}

function transformPosition(
  transform: MutableTransform,
  localPosition: THREE.Vector3,
  out: THREE.Vector3,
) {
  return out
    .copy(localPosition)
    .multiply(transform.scale)
    .applyQuaternion(transform.rotation)
    .add(transform.position)
}

function inverseTransformPosition(
  transform: MutableTransform,
  globalPosition: THREE.Vector3,
  inverseRotation: THREE.Quaternion,
  out: THREE.Vector3,
) {
  if (
    Math.abs(transform.scale.x) <= SMALL_NUMBER
    || Math.abs(transform.scale.y) <= SMALL_NUMBER
    || Math.abs(transform.scale.z) <= SMALL_NUMBER
  ) {
    throw new Error('CR_Als cannot invert a zero component scale')
  }
  inverseRotation.copy(transform.rotation).invert()
  return out
    .subVectors(globalPosition, transform.position)
    .applyQuaternion(inverseRotation)
    .divide(transform.scale)
}

/**
 * FQuat::FindBetweenNormals(), including Unreal's deterministic antiparallel fallback.
 */
function findBetweenNormals(
  from: THREE.Vector3,
  to: THREE.Vector3,
  out: THREE.Quaternion,
) {
  const w = 1 + from.dot(to)
  if (w >= FIND_BETWEEN_NORMALS_EPSILON) {
    out.set(
      from.y * to.z - from.z * to.y,
      from.z * to.x - from.x * to.z,
      from.x * to.y - from.y * to.x,
      w,
    )
  } else if (
    Math.abs(from.x) > Math.abs(from.y)
    && Math.abs(from.x) > Math.abs(from.z)
  ) {
    out.set(-from.z, 0, from.x, 0)
  } else {
    out.set(0, -from.z, from.y, 0)
  }
  return out.normalize()
}

function findBestAxisVectors(
  direction: THREE.Vector3,
  axis1: THREE.Vector3,
  axis2: THREE.Vector3,
) {
  if (
    Math.abs(direction.z) > Math.abs(direction.x)
    && Math.abs(direction.z) > Math.abs(direction.y)
  ) {
    axis1.set(1, 0, 0)
  } else {
    axis1.set(0, 0, 1)
  }
  axis1.addScaledVector(direction, -axis1.dot(direction)).normalize()
  axis2.crossVectors(axis1, direction)
}

/**
 * AnimationCore::SolveTwoBoneIK() with bAllowStretching=false.
 */
function solveTwoBonePositions(
  transformA: MutableTransform,
  transformB: MutableTransform,
  transformC: MutableTransform,
  poleTarget: THREE.Vector3,
  lengthA: number,
  lengthB: number,
  scratch: AlsControlRigHandIkScratch,
) {
  const desiredLengthRaw = scratch.desiredDelta
    .subVectors(transformC.position, transformA.position)
    .length()
  let desiredLength = desiredLengthRaw
  if (desiredLength < POSITION_KINDA_SMALL_NUMBER) {
    desiredLength = POSITION_KINDA_SMALL_NUMBER
    scratch.desiredDirection.set(1, 0, 0)
  } else {
    scratch.desiredDirection
      .copy(scratch.desiredDelta)
      .multiplyScalar(1 / desiredLength)
  }

  scratch.jointTargetDelta.subVectors(
    poleTarget,
    transformA.position,
  )
  if (
    scratch.jointTargetDelta.lengthSq()
    < POSITION_KINDA_SMALL_NUMBER * POSITION_KINDA_SMALL_NUMBER
  ) {
    scratch.jointBendDirection.set(0, 1, 0)
    scratch.jointPlaneNormal.set(0, 0, 1)
  } else {
    scratch.jointPlaneNormal.crossVectors(
      scratch.desiredDirection,
      scratch.jointTargetDelta,
    )
    if (
      scratch.jointPlaneNormal.lengthSq()
      < POSITION_KINDA_SMALL_NUMBER * POSITION_KINDA_SMALL_NUMBER
    ) {
      findBestAxisVectors(
        scratch.desiredDirection,
        scratch.jointPlaneNormal,
        scratch.jointBendDirection,
      )
    } else {
      scratch.jointPlaneNormal.normalize()
      scratch.jointBendDirection
        .copy(scratch.jointTargetDelta)
        .addScaledVector(
          scratch.desiredDirection,
          -scratch.jointTargetDelta.dot(scratch.desiredDirection),
        )
        .normalize()
    }
  }

  const maximumLength = lengthA + lengthB
  if (desiredLength >= maximumLength) {
    transformC.position
      .copy(transformA.position)
      .addScaledVector(scratch.desiredDirection, maximumLength)
    transformB.position
      .copy(transformA.position)
      .addScaledVector(scratch.desiredDirection, lengthA)
    return
  }

  const twoAB = 2 * lengthA * desiredLength
  const cosine = twoAB !== 0
    ? (
      lengthA * lengthA
      + desiredLength * desiredLength
      - lengthB * lengthB
    ) / twoAB
    : 0
  const reverseUpperBone = cosine < 0
  const angle = Math.acos(THREE.MathUtils.clamp(cosine, -1, 1))
  const jointLineDistance = lengthA * Math.sin(angle)
  const projectedDistanceSquared =
    lengthA * lengthA - jointLineDistance * jointLineDistance
  let projectedDistance = projectedDistanceSquared > 0
    ? Math.sqrt(projectedDistanceSquared)
    : 0
  if (reverseUpperBone) projectedDistance *= -1

  transformB.position
    .copy(transformA.position)
    .addScaledVector(scratch.desiredDirection, projectedDistance)
    .addScaledVector(scratch.jointBendDirection, jointLineDistance)
}

/**
 * FControlRigMathLibrary::SolveBasicTwoBoneIK() orientation pass.
 */
function orientBasicTwoBoneIk(
  transformA: MutableTransform,
  transformB: MutableTransform,
  transformC: MutableTransform,
  definition: Pick<
    CompiledHandIkDefinition,
    'primaryAxis' | 'secondaryAxis'
  >,
  scratch: AlsControlRigHandIkScratch,
) {
  scratch.boneBLocation.copy(transformB.position)
  scratch.axis
    .fromArray(definition.primaryAxis)
    .applyQuaternion(transformA.rotation)
  scratch.target1
    .subVectors(scratch.boneBLocation, transformA.position)
  if (
    !isNearlyZero(scratch.target1)
    && !isNearlyZero(scratch.axis)
  ) {
    scratch.axis.normalize()
    scratch.target1.normalize()

    // UE 5.5 offsets only the temporary elbow used for orientation when the solved chain is
    // completely extended. The actual solved lower-arm position remains unchanged.
    scratch.baseDirection
      .subVectors(transformC.position, transformA.position)
    if (scratch.baseDirection.lengthSq() > SMALL_NUMBER) {
      scratch.baseDirection.normalize()
      if (
        Math.abs(
          scratch.baseDirection.dot(scratch.target1) - 1,
        ) < KINDA_SMALL_NUMBER
      ) {
        scratch.target2
          .subVectors(scratch.poleTarget, scratch.boneBLocation)
        if (scratch.target2.lengthSq() > SMALL_NUMBER) {
          scratch.boneBLocation.addScaledVector(
            scratch.target2.normalize(),
            POSITION_KINDA_SMALL_NUMBER * 2,
          )
          scratch.target1
            .subVectors(
              scratch.boneBLocation,
              transformA.position,
            )
            .normalize()
        }
      }
    }

    findBetweenNormals(
      scratch.axis,
      scratch.target1,
      scratch.rotationDelta,
    )
    transformA.rotation
      .premultiply(scratch.rotationDelta)
      .normalize()

    scratch.axis
      .fromArray(definition.secondaryAxis)
      .applyQuaternion(transformA.rotation)
    scratch.target2
      .copy(transformC.position)
      .add(transformA.position)
      .multiplyScalar(0.5)
      .subVectors(scratch.boneBLocation, scratch.target2)
    if (
      !isNearlyZero(scratch.target2)
      && !isNearlyZero(scratch.axis)
    ) {
      scratch.target2
        .addScaledVector(
          scratch.target1,
          -scratch.target2.dot(scratch.target1),
        )
      if (scratch.target2.lengthSq() > SMALL_NUMBER) {
        scratch.axis.normalize()
        scratch.target2.normalize()
        findBetweenNormals(
          scratch.axis,
          scratch.target2,
          scratch.rotationDelta,
        )
        transformA.rotation
          .premultiply(scratch.rotationDelta)
          .normalize()
      }
    }
  }

  scratch.axis
    .fromArray(definition.primaryAxis)
    .applyQuaternion(transformB.rotation)
  scratch.target1
    .subVectors(transformC.position, scratch.boneBLocation)
  if (
    !isNearlyZero(scratch.target1)
    && !isNearlyZero(scratch.axis)
  ) {
    scratch.axis.normalize()
    scratch.target1.normalize()
    findBetweenNormals(
      scratch.axis,
      scratch.target1,
      scratch.rotationDelta,
    )
    transformB.rotation
      .premultiply(scratch.rotationDelta)
      .normalize()

    scratch.axis
      .fromArray(definition.secondaryAxis)
      .applyQuaternion(transformB.rotation)
    scratch.target2
      .copy(transformC.position)
      .add(transformA.position)
      .multiplyScalar(0.5)
      .subVectors(scratch.boneBLocation, scratch.target2)
    if (
      !isNearlyZero(scratch.target2)
      && !isNearlyZero(scratch.axis)
    ) {
      scratch.target2
        .addScaledVector(
          scratch.target1,
          -scratch.target2.dot(scratch.target1),
        )
      if (scratch.target2.lengthSq() > SMALL_NUMBER) {
        scratch.axis.normalize()
        scratch.target2.normalize()
        findBetweenNormals(
          scratch.axis,
          scratch.target2,
          scratch.rotationDelta,
        )
        transformB.rotation
          .premultiply(scratch.rotationDelta)
          .normalize()
      }
    }
  }
}

function blendBasicIkResult(
  weight: number,
  scratch: AlsControlRigHandIkScratch,
) {
  const {
    transformA,
    transformB,
    transformC,
    originalA,
    originalB,
    originalC,
  } = scratch
  inverseTransformPosition(
    transformA,
    transformB.position,
    scratch.inverseRotation,
    scratch.localPositionB,
  )
  inverseTransformPosition(
    transformB,
    transformC.position,
    scratch.inverseRotation,
    scratch.localPositionC,
  )

  scratch.targetRotationA.copy(transformA.rotation)
  scratch.targetRotationB.copy(transformB.rotation)
  scratch.targetRotationC.copy(transformC.rotation)
  transformA.rotation
    .copy(originalA.rotation)
    .slerp(scratch.targetRotationA, weight)
    .normalize()
  transformB.rotation
    .copy(originalB.rotation)
    .slerp(scratch.targetRotationB, weight)
    .normalize()
  transformC.rotation
    .copy(originalC.rotation)
    .slerp(scratch.targetRotationC, weight)
    .normalize()
  transformPosition(
    transformA,
    scratch.localPositionB,
    transformB.position,
  )
  transformPosition(
    transformB,
    scratch.localPositionC,
    transformC.position,
  )
}

function writeLocalFromGlobal(
  pose: LocalPoseBuffer,
  bone: number,
  globalTransform: MutableTransform,
  parentTransform: MutableTransform,
  scratch: AlsControlRigTransformScratch,
) {
  inverseTransformPosition(
    parentTransform,
    globalTransform.position,
    scratch.inverseRotation,
    scratch.localPosition,
  )
  scratch.localRotation
    .copy(parentTransform.rotation)
    .invert()
    .multiply(globalTransform.rotation)
  normalizeQuaternion(scratch.localRotation, 'solver output')
  if (
    Math.abs(parentTransform.scale.x) <= SMALL_NUMBER
    || Math.abs(parentTransform.scale.y) <= SMALL_NUMBER
    || Math.abs(parentTransform.scale.z) <= SMALL_NUMBER
  ) {
    throw new Error('CR_Als cannot divide by a zero parent scale')
  }
  scratch.localScale
    .copy(globalTransform.scale)
    .divide(parentTransform.scale)

  scratch.localPosition.toArray(pose.positions, bone * 3)
  scratch.localRotation.toArray(pose.rotations, bone * 4)
  scratch.localScale.toArray(pose.scales, bone * 3)
}

function solveHand(
  runtime: AlsControlRigHandIkRuntime,
  pose: LocalPoseBuffer,
  solver: CompiledHandIkDefinition,
  targetIndex: number,
  weight: number,
) {
  if (weight <= SMALL_NUMBER) return
  const { scratch } = runtime
  const {
    transformA,
    transformB,
    transformC,
    originalA,
    originalB,
    originalC,
  } = scratch

  loadComponentTransform(runtime, solver.itemAIndex, originalA)
  loadComponentTransform(runtime, solver.itemBIndex, originalB)
  loadComponentTransform(runtime, solver.effectorItemIndex, originalC)
  copyTransform(originalA, transformA)
  copyTransform(transformA, transformB)
  transformB.position.copy(originalB.position)
  loadComponentTransform(runtime, targetIndex, transformC)

  // PoleVectorKind is Location and TransformPositionNoScale deliberately ignores space scale.
  loadComponentTransform(
    runtime,
    solver.poleVectorSpaceIndex,
    scratch.parentTransform,
  )
  scratch.poleTarget
    .fromArray(solver.poleVector)
    .applyQuaternion(scratch.parentTransform.rotation)
    .add(scratch.parentTransform.position)

  const initialPositions = runtime.initialComponentPositions
  const initialScales = runtime.initialComponentScales
  const itemAPositionOffset = solver.itemAIndex * 3
  const itemBPositionOffset = solver.itemBIndex * 3
  const effectorPositionOffset = solver.effectorItemIndex * 3
  scratch.lengthScale.set(1, 1, 1)
  if (
    initialScales[itemAPositionOffset]
      * initialScales[itemAPositionOffset]
    + initialScales[itemAPositionOffset + 1]
      * initialScales[itemAPositionOffset + 1]
    + initialScales[itemAPositionOffset + 2]
      * initialScales[itemAPositionOffset + 2]
    > SMALL_NUMBER
  ) {
    scratch.lengthScale.set(
      originalA.scale.x / initialScales[itemAPositionOffset],
      originalA.scale.y / initialScales[itemAPositionOffset + 1],
      originalA.scale.z / initialScales[itemAPositionOffset + 2],
    )
  }
  const lengthA = scratch.initialDifference
    .set(
      initialPositions[itemAPositionOffset]
        - initialPositions[itemBPositionOffset],
      initialPositions[itemAPositionOffset + 1]
        - initialPositions[itemBPositionOffset + 1],
      initialPositions[itemAPositionOffset + 2]
        - initialPositions[itemBPositionOffset + 2],
    )
    .multiply(scratch.lengthScale)
    .length()
  scratch.lengthScale.set(1, 1, 1)
  if (
    initialScales[itemBPositionOffset]
      * initialScales[itemBPositionOffset]
    + initialScales[itemBPositionOffset + 1]
      * initialScales[itemBPositionOffset + 1]
    + initialScales[itemBPositionOffset + 2]
      * initialScales[itemBPositionOffset + 2]
    > SMALL_NUMBER
  ) {
    scratch.lengthScale.set(
      transformB.scale.x / initialScales[itemBPositionOffset],
      transformB.scale.y / initialScales[itemBPositionOffset + 1],
      transformB.scale.z / initialScales[itemBPositionOffset + 2],
    )
  }
  const lengthB = scratch.initialDifference
    .set(
      initialPositions[itemBPositionOffset]
        - initialPositions[effectorPositionOffset],
      initialPositions[itemBPositionOffset + 1]
        - initialPositions[effectorPositionOffset + 1],
      initialPositions[itemBPositionOffset + 2]
        - initialPositions[effectorPositionOffset + 2],
    )
    .multiply(scratch.lengthScale)
    .length()
  if (lengthA < SMALL_NUMBER || lengthB < SMALL_NUMBER) return

  solveTwoBonePositions(
    transformA,
    transformB,
    transformC,
    scratch.poleTarget,
    lengthA,
    lengthB,
    scratch,
  )
  orientBasicTwoBoneIk(
    transformA,
    transformB,
    transformC,
    solver,
    scratch,
  )
  if (weight < 1 - SMALL_NUMBER) {
    blendBasicIkResult(weight, scratch)
  }

  const parentIndex = runtime.rig.parentIndices[solver.itemAIndex]
  if (parentIndex < 0) {
    throw new Error('CR_Als hand IK upper arm requires a parent')
  }
  loadComponentTransform(runtime, parentIndex, scratch.parentTransform)
  writeLocalFromGlobal(
    pose,
    solver.itemAIndex,
    transformA,
    scratch.parentTransform,
    scratch,
  )
  writeLocalFromGlobal(
    pose,
    solver.itemBIndex,
    transformB,
    transformA,
    scratch,
  )
  writeLocalFromGlobal(
    pose,
    solver.effectorItemIndex,
    transformC,
    transformB,
    scratch,
  )

  // bPropagateToChildren=true. Rebuilding all compact-pose components naturally carries the
  // unchanged finger and virtual-bone locals forward before the next (right-hand) solver reads.
  refreshComponentTransforms(runtime, pose)
}

export function createAlsControlRigHandIkRuntime(
  rig: RigDefinition,
): AlsControlRigHandIkRuntime {
  const transformLength = rig.boneCount * 3
  const runtime: AlsControlRigHandIkRuntime = {
    rig,
    solvers: ALS_CONTROL_RIG_HAND_IK.map((definition) => (
      compileSolver(rig, definition)
    )),
    initialComponentPositions: new Float32Array(transformLength),
    initialComponentScales: new Float32Array(transformLength),
    componentPositions: new Float32Array(transformLength),
    componentRotations: new Float32Array(rig.boneCount * 4),
    componentScales: new Float32Array(transformLength),
    scratch: createScratch(),
  }
  refreshComponentTransformsFromArrays(
    runtime,
    rig.referencePositions,
    rig.referenceRotations,
    rig.referenceScales,
  )
  runtime.initialComponentPositions.set(runtime.componentPositions)
  runtime.initialComponentScales.set(runtime.componentScales)
  return runtime
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function resolveAlsControlRigHandIkWeight(
  curves: AlsControlRigCurveValues,
  side: AlsControlRigHandSide,
) {
  const definition = ALS_CONTROL_RIG_HAND_IK[
    side === 'left' ? 0 : 1
  ]
  return clamp01(curves.get(definition.layerCurveName) ?? 0)
    * clamp01(curves.get(definition.handIkCurveName) ?? 0)
}

/**
 * Evaluates CR_Als.RefreshHandIk directly against the final compact pose.
 *
 * Call after AB_Als_Layering node 92 and before applyPose(). Virtual-bone locals must already be
 * present from source-clip sampling and graph blending; regenerating them here would erase the
 * cross-hand targets that this stage consumes.
 */
export function evaluateAlsControlRigHandIk(
  runtime: AlsControlRigHandIkRuntime,
  input: EvaluateAlsControlRigHandIkInput,
): LocalPoseBuffer {
  const { pose } = input
  if (
    pose.boneCount !== runtime.rig.boneCount
    || pose.boneCount !== runtime.componentPositions.length / 3
  ) {
    throw new Error('CR_Als hand IK pose has an incompatible bone count')
  }

  refreshComponentTransforms(runtime, pose)
  const useHandIkBones = input.useHandIkBones ?? true
  for (const solver of runtime.solvers) {
    const targetIndex = useHandIkBones
      ? solver.targetWhenUsingHandIkBonesIndex
      : solver.targetOtherwiseIndex
    solveHand(
      runtime,
      pose,
      solver,
      targetIndex,
      resolveAlsControlRigHandIkWeight(
        input.curves,
        solver.definition.side,
      ),
    )
  }
  return pose
}

interface CompiledFootIkDefinition {
  readonly definition: AlsControlRigFootIkDefinition
  readonly pelvisItemIndex: number
  readonly thighItemIndex: number
  readonly calfItemIndex: number
  readonly footItemIndex: number
  /** CR_Als local axes converted from Unreal to the glTF pose basis. */
  readonly primaryAxis: readonly [number, number, number]
  readonly secondaryAxis: readonly [number, number, number]
}

interface AlsControlRigFloatSpringState {
  velocity: number
  previousTarget: number
  valid: boolean
}

export interface AlsControlRigFootIkState {
  readonly side: AlsControlRigFootSide
  /** Whether RefreshFootOffset received a blocking hit during this evaluation. */
  traceHit: boolean
  /** RefreshFootOffset output in glTF metres. */
  footOffsetLocation: number
  /** RefreshFootOffset output in the glTF basis. */
  readonly footOffsetNormal: THREE.Vector3
  /** FAlsRigUnit_ApplyFootOffsetLocation's persistent result, in glTF metres. */
  offsetLocation: number
  offsetLocationInitialized: boolean
  readonly offsetLocationSpring: AlsControlRigFloatSpringState
  /** Last successful FAlsRigUnit_CalculatePoleVector outputs. */
  readonly poleItemBLocation: THREE.Vector3
  readonly poleDirection: THREE.Vector3
  /** FAlsRigVMFunction_ExponentialDecayVector's persistent output. */
  readonly poleLocation: THREE.Vector3
  poleLocationInitialized: boolean
  /** FAlsRigUnit_ApplyFootOffsetRotation's persistent normal. */
  readonly offsetNormal: THREE.Vector3
  offsetNormalInitialized: boolean
  readonly traceRequest: AlsControlRigFootOffsetTraceRequest
}

interface AlsControlRigFootIkScratch
  extends AlsControlRigHandIkScratch {
  readonly footLocation: THREE.Vector3
  readonly legVector: THREE.Vector3
  readonly poleAb: THREE.Vector3
  readonly poleAc: THREE.Vector3
  readonly poleProjection: THREE.Vector3
  readonly poleTarget: THREE.Vector3
  readonly unrealNormal: THREE.Vector3
  readonly unrealCalfRotation: THREE.Quaternion
  readonly unrealTargetRotation: THREE.Quaternion
  readonly unrealOffsetRotation: THREE.Quaternion
  readonly initialLocalRotation: THREE.Quaternion
  readonly targetLocalRotation: THREE.Quaternion
  readonly initialSwing: THREE.Quaternion
  readonly initialTwist: THREE.Quaternion
  readonly targetSwing: THREE.Quaternion
  readonly targetTwist: THREE.Quaternion
  readonly newSwing: THREE.Quaternion
  readonly newTwist: THREE.Quaternion
  readonly twistInverse: THREE.Quaternion
  readonly newLocalRotation: THREE.Quaternion
  readonly limitOffset: THREE.Quaternion
  readonly inverseLimitOffset: THREE.Quaternion
  readonly unrealUp: THREE.Vector3
}

export interface AlsControlRigFootIkRuntime
  extends AlsControlRigTransformRuntime {
  readonly solvers: readonly CompiledFootIkDefinition[]
  readonly pelvisItemIndex: number
  readonly initialComponentPositions: Float32Array
  readonly initialComponentScales: Float32Array
  readonly feet: readonly [
    AlsControlRigFootIkState,
    AlsControlRigFootIkState,
  ]
  /** Construction-derived initial global foot_l height, in glTF metres. */
  footHeight: number
  /** Construction-derived initial thigh_l → foot_l chain length, in glTF metres. */
  legLength: number
  pelvisOffsetAmount: number
  pelvisOffset: number
  pelvisSimulatedResult: number
  readonly pelvisSpring: AlsControlRigFloatSpringState
  readonly scratch: AlsControlRigFootIkScratch
}

function createFloatSpringState(): AlsControlRigFloatSpringState {
  return {
    velocity: 0,
    previousTarget: 0,
    valid: false,
  }
}

function resetFloatSpringState(state: AlsControlRigFloatSpringState) {
  state.velocity = 0
  state.previousTarget = 0
  state.valid = false
}

function createFootIkScratch(): AlsControlRigFootIkScratch {
  return {
    ...createScratch(),
    footLocation: new THREE.Vector3(),
    legVector: new THREE.Vector3(),
    poleAb: new THREE.Vector3(),
    poleAc: new THREE.Vector3(),
    poleProjection: new THREE.Vector3(),
    poleTarget: new THREE.Vector3(),
    unrealNormal: new THREE.Vector3(),
    unrealCalfRotation: new THREE.Quaternion(),
    unrealTargetRotation: new THREE.Quaternion(),
    unrealOffsetRotation: new THREE.Quaternion(),
    initialLocalRotation: new THREE.Quaternion(),
    targetLocalRotation: new THREE.Quaternion(),
    initialSwing: new THREE.Quaternion(),
    initialTwist: new THREE.Quaternion(),
    targetSwing: new THREE.Quaternion(),
    targetTwist: new THREE.Quaternion(),
    newSwing: new THREE.Quaternion(),
    newTwist: new THREE.Quaternion(),
    twistInverse: new THREE.Quaternion(),
    newLocalRotation: new THREE.Quaternion(),
    limitOffset: new THREE.Quaternion(),
    inverseLimitOffset: new THREE.Quaternion(),
    unrealUp: new THREE.Vector3(0, 0, 1),
  }
}

function createFootIkState(
  side: AlsControlRigFootSide,
): AlsControlRigFootIkState {
  return {
    side,
    traceHit: false,
    footOffsetLocation: 0,
    footOffsetNormal: new THREE.Vector3(0, 1, 0),
    offsetLocation: 0,
    offsetLocationInitialized: false,
    offsetLocationSpring: createFloatSpringState(),
    poleItemBLocation: new THREE.Vector3(),
    poleDirection: new THREE.Vector3(1, 0, 0),
    poleLocation: new THREE.Vector3(),
    poleLocationInitialized: false,
    offsetNormal: new THREE.Vector3(0, 1, 0),
    offsetNormalInitialized: false,
    traceRequest: {
      side,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      traceChannel: 'Visibility',
      ignoreOwningActor: true,
    },
  }
}

function requireFootBoneIndex(
  rig: RigDefinition,
  boneName: string,
) {
  const index = rig.boneNames.indexOf(boneName)
  if (index < 0) {
    throw new Error(`CR_Als foot IK requires bone "${boneName}"`)
  }
  return index
}

function convertUnrealVectorTupleToGltf(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return [value[0], value[2], value[1]]
}

function convertUnrealPositionTupleToGltf(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    value[0] * CENTIMETERS_TO_METERS,
    value[2] * CENTIMETERS_TO_METERS,
    value[1] * CENTIMETERS_TO_METERS,
  ]
}

/**
 * C-conjugation used by assemble-glb.mjs. Since C is a reflection and an involution, this same
 * component mapping converts rotation quaternions in either direction.
 */
function conjugateUnrealGltfQuaternion(
  value: THREE.Quaternion,
  out: THREE.Quaternion,
) {
  return out.set(-value.x, -value.z, -value.y, value.w)
}

function compileFootSolver(
  rig: RigDefinition,
  definition: AlsControlRigFootIkDefinition,
): CompiledFootIkDefinition {
  const pelvisItemIndex = requireFootBoneIndex(
    rig,
    definition.pelvisItem,
  )
  const thighItemIndex = requireFootBoneIndex(
    rig,
    definition.thighItem,
  )
  const calfItemIndex = requireFootBoneIndex(
    rig,
    definition.calfItem,
  )
  const footItemIndex = requireFootBoneIndex(
    rig,
    definition.footItem,
  )
  if (
    rig.parentIndices[thighItemIndex] !== pelvisItemIndex
    || rig.parentIndices[calfItemIndex] !== thighItemIndex
    || rig.parentIndices[footItemIndex] !== calfItemIndex
  ) {
    throw new Error(
      `CR_Als ${definition.side} foot IK requires the authored `
      + `${definition.pelvisItem} -> ${definition.thighItem} -> `
      + `${definition.calfItem} -> ${definition.footItem} topology`,
    )
  }

  return {
    definition,
    pelvisItemIndex,
    thighItemIndex,
    calfItemIndex,
    footItemIndex,
    primaryAxis: convertUnrealVectorTupleToGltf(
      definition.primaryAxis,
    ),
    secondaryAxis: convertUnrealVectorTupleToGltf(
      definition.secondaryAxis,
    ),
  }
}

function calculateInitialChainLength(
  rig: RigDefinition,
  componentPositions: Float32Array,
  ancestorItemIndex: number,
  descendantItemIndex: number,
) {
  let length = 0
  let itemIndex = descendantItemIndex
  while (itemIndex !== ancestorItemIndex) {
    const parentItemIndex = rig.parentIndices[itemIndex]
    if (parentItemIndex < 0) {
      throw new Error(
        `CR_Als "${rig.boneNames[descendantItemIndex]}" is not a `
        + `descendant of "${rig.boneNames[ancestorItemIndex]}"`,
      )
    }
    const itemOffset = itemIndex * 3
    const parentOffset = parentItemIndex * 3
    length += Math.hypot(
      componentPositions[itemOffset]
        - componentPositions[parentOffset],
      componentPositions[itemOffset + 1]
        - componentPositions[parentOffset + 1],
      componentPositions[itemOffset + 2]
        - componentPositions[parentOffset + 2],
    )
    itemIndex = parentItemIndex
  }
  return length
}

export function createAlsControlRigFootIkRuntime(
  rig: RigDefinition,
): AlsControlRigFootIkRuntime {
  const transformLength = rig.boneCount * 3
  const solvers: readonly CompiledFootIkDefinition[] =
    ALS_CONTROL_RIG_FOOT_IK.feet.map((definition) => (
      compileFootSolver(rig, definition)
    ))
  const pelvisItemIndex = solvers[0].pelvisItemIndex
  const runtime: AlsControlRigFootIkRuntime = {
    rig,
    solvers,
    pelvisItemIndex,
    initialComponentPositions: new Float32Array(transformLength),
    initialComponentScales: new Float32Array(transformLength),
    componentPositions: new Float32Array(transformLength),
    componentRotations: new Float32Array(rig.boneCount * 4),
    componentScales: new Float32Array(transformLength),
    feet: [
      createFootIkState('left'),
      createFootIkState('right'),
    ],
    footHeight: 0,
    legLength: 0,
    pelvisOffsetAmount: 0,
    pelvisOffset: 0,
    pelvisSimulatedResult: 0,
    pelvisSpring: createFloatSpringState(),
    scratch: createFootIkScratch(),
  }
  refreshComponentTransformsFromArrays(
    runtime,
    rig.referencePositions,
    rig.referenceRotations,
    rig.referenceScales,
  )
  runtime.initialComponentPositions.set(runtime.componentPositions)
  runtime.initialComponentScales.set(runtime.componentScales)

  const footLeftItemIndex = requireFootBoneIndex(
    rig,
    ALS_CONTROL_RIG_FOOT_IK.construction.footHeightItem,
  )
  runtime.footHeight =
    runtime.initialComponentPositions[footLeftItemIndex * 3 + 1]
  runtime.legLength = calculateInitialChainLength(
    rig,
    runtime.initialComponentPositions,
    requireFootBoneIndex(
      rig,
      ALS_CONTROL_RIG_FOOT_IK.construction.legLengthAncestorItem,
    ),
    requireFootBoneIndex(
      rig,
      ALS_CONTROL_RIG_FOOT_IK.construction.legLengthDescendantItem,
    ),
  )

  const sourceLimitOffset =
    ALS_CONTROL_RIG_FOOT_IK.footRotation.limitOffset
  runtime.scratch.limitOffset.set(
    sourceLimitOffset[0],
    sourceLimitOffset[1],
    sourceLimitOffset[2],
    sourceLimitOffset[3],
  )
  runtime.scratch.inverseLimitOffset
    .copy(runtime.scratch.limitOffset)
    .conjugate()
  return runtime
}

function invExpApprox(value: number) {
  return 1 / (
    1
    + 1.00746054 * value
    + 0.45053901 * value * value
    + 0.25724632 * value * value * value
  )
}

function exponentialDecayAmount(
  deltaTime: number,
  lambda: number,
) {
  return 1 - invExpApprox(lambda * deltaTime)
}

/**
 * UE 5.5 FMath::SpringDamper(), scalar specialization.
 */
function springDamper(
  state: AlsControlRigFloatSpringState,
  current: number,
  target: number,
  targetVelocity: number,
  deltaTime: number,
  undampedFrequency: number,
  dampingRatio: number,
) {
  if (deltaTime <= 0) return current

  const angularFrequency = undampedFrequency * Math.PI * 2
  if (angularFrequency < SMALL_NUMBER) {
    return current + state.velocity * deltaTime
  }
  if (dampingRatio < SMALL_NUMBER) {
    const error = current - target
    const b = state.velocity / angularFrequency
    const angle = angularFrequency * deltaTime
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    const result = target + error * cos + b * sin
    state.velocity =
      state.velocity * cos - error * angularFrequency * sin
    return result
  }

  const smoothingTime = 2 / angularFrequency
  const adjustedTarget =
    target + targetVelocity * dampingRatio * smoothingTime
  const error = current - adjustedTarget
  if (dampingRatio > 1) {
    const dampedFrequency =
      angularFrequency * Math.sqrt(dampingRatio * dampingRatio - 1)
    const c2 = -(
      state.velocity
      + (angularFrequency * dampingRatio - dampedFrequency) * error
    ) / (2 * dampedFrequency)
    const c1 = error - c2
    const a1 = dampedFrequency - dampingRatio * angularFrequency
    const a2 = -(dampedFrequency + dampingRatio * angularFrequency)
    const e1 = invExpApprox(-a1 * deltaTime)
    const e2 = invExpApprox(-a2 * deltaTime)
    state.velocity = e1 * c1 * a1 + e2 * c2 * a2
    return adjustedTarget + e1 * c1 + e2 * c2
  }
  if (dampingRatio < 1) {
    const dampedFrequency =
      angularFrequency * Math.sqrt(1 - dampingRatio * dampingRatio)
    const a = error
    const b = (
      state.velocity + error * dampingRatio * angularFrequency
    ) / dampedFrequency
    const angle = dampedFrequency * deltaTime
    const sin = Math.sin(angle)
    const cos = Math.cos(angle)
    const decay = invExpApprox(
      dampingRatio * angularFrequency * deltaTime,
    )
    let result = decay * (a * cos + b * sin)
    state.velocity = -result * dampingRatio * angularFrequency
    state.velocity += decay * (
      b * dampedFrequency * cos
      - a * dampedFrequency * sin
    )
    result += adjustedTarget
    return result
  }

  const c1 = error
  const c2 = state.velocity + error * angularFrequency
  const decay = invExpApprox(angularFrequency * deltaTime)
  state.velocity = (
    c2
    - c1 * angularFrequency
    - c2 * angularFrequency * deltaTime
  ) * decay
  return adjustedTarget + (c1 + c2 * deltaTime) * decay
}

/**
 * UAlsMath::SpringDampFloat(), including its first-valid-frame target snap.
 */
function springDampFloat(
  state: AlsControlRigFloatSpringState,
  current: number,
  target: number,
  deltaTime: number,
  frequency: number,
  dampingRatio: number,
  targetVelocityAmount: number,
) {
  if (deltaTime <= SMALL_NUMBER) return current
  if (!state.valid) {
    state.velocity = 0
    state.previousTarget = target
    state.valid = true
    return target
  }

  const targetVelocity = (
    target - state.previousTarget
  ) * clamp01(targetVelocityAmount) / deltaTime
  const result = springDamper(
    state,
    current,
    target,
    targetVelocity,
    deltaTime,
    frequency,
    dampingRatio,
  )
  state.previousTarget = target
  return result
}

/**
 * The exact fixed configuration of CR_Als's FRigUnit_SpringInterpV2 pelvis node.
 */
function stepPelvisSpring(
  runtime: AlsControlRigFootIkRuntime,
  target: number,
  deltaTime: number,
) {
  const spring = ALS_CONTROL_RIG_FOOT_IK.pelvis.spring
  let current = runtime.pelvisSimulatedResult
  if (spring.initializeFromTarget && !runtime.pelvisSpring.valid) {
    current = target
  }
  if (deltaTime > SMALL_NUMBER) {
    const targetVelocity = runtime.pelvisSpring.valid
      ? (
        target - runtime.pelvisSpring.previousTarget
      ) * spring.targetVelocityAmount / deltaTime
      : 0
    current = springDamper(
      runtime.pelvisSpring,
      current,
      target,
      targetVelocity,
      deltaTime,
      spring.strength,
      spring.criticalDamping,
    )
    runtime.pelvisSpring.previousTarget = target
    runtime.pelvisSpring.valid = true
  }
  runtime.pelvisSimulatedResult = current
  return current
}

function curveValue(
  curves: AlsControlRigCurveValues,
  name: string,
) {
  return curves.get(name) ?? 0
}

function footTargetLocation(
  input: AlsControlRigFootIkInputState,
  side: AlsControlRigFootSide,
) {
  return side === 'left'
    ? input.footLeftLocation
    : input.footRightLocation
}

function footTargetRotation(
  input: AlsControlRigFootIkInputState,
  side: AlsControlRigFootSide,
) {
  return side === 'left'
    ? input.footLeftRotation
    : input.footRightRotation
}

/**
 * CR_Als.RefreshFootOffset: left trace and variable writes, then right.
 */
function refreshFootOffset(
  runtime: AlsControlRigFootIkRuntime,
  input: EvaluateAlsControlRigFootIkInput,
) {
  const traceSettings = ALS_CONTROL_RIG_FOOT_IK.trace
  for (let footIndex = 0; footIndex < runtime.feet.length; footIndex++) {
    const state = runtime.feet[footIndex]
    const solver = runtime.solvers[footIndex]
    state.traceHit = false
    const ikAmount = curveValue(
      input.curves,
      solver.definition.curveName,
    )
    const enabled = input.rigInput.bFootOffsetAllowed
      || ikAmount <= traceSettings.footIkAmountThreshold
    if (!enabled) {
      state.footOffsetLocation = 0
      state.footOffsetNormal.set(0, 1, 0)
      continue
    }

    const target = footTargetLocation(
      input.rigInput,
      solver.definition.side,
    )
    state.traceRequest.start.set(
      target.x,
      traceSettings.traceDistanceUpward * CENTIMETERS_TO_METERS,
      target.z,
    )
    state.traceRequest.end.set(
      target.x,
      -traceSettings.traceDistanceDownward * CENTIMETERS_TO_METERS,
      target.z,
    )
    const hit = input.trace(state.traceRequest)
    if (!hit) {
      state.footOffsetLocation = 0
      state.footOffsetNormal.set(0, 1, 0)
      continue
    }

    state.traceHit = true
    state.footOffsetNormal.copy(hit.impactNormal)
    const slopeAngleCos = hit.impactNormal.y
    const slopeOffset = slopeAngleCos > SMALL_NUMBER
      ? runtime.footHeight / slopeAngleCos - runtime.footHeight
      : 0
    state.footOffsetLocation = hit.impactPoint.y + slopeOffset
  }
}

function writeGlobalTransform(
  runtime: AlsControlRigFootIkRuntime,
  pose: LocalPoseBuffer,
  itemIndex: number,
  transform: MutableTransform,
) {
  const parentIndex = runtime.rig.parentIndices[itemIndex]
  if (parentIndex < 0) {
    throw new Error(
      `CR_Als item "${runtime.rig.boneNames[itemIndex]}" requires a parent`,
    )
  }
  loadComponentTransform(
    runtime,
    parentIndex,
    runtime.scratch.parentTransform,
  )
  writeLocalFromGlobal(
    pose,
    itemIndex,
    transform,
    runtime.scratch.parentTransform,
    runtime.scratch,
  )
}

/**
 * CR_Als.RefreshPelvisOffset, including its branch (the spring does not advance below relevance).
 */
function refreshPelvisOffset(
  runtime: AlsControlRigFootIkRuntime,
  input: EvaluateAlsControlRigFootIkInput,
) {
  const settings = ALS_CONTROL_RIG_FOOT_IK.pelvis
  runtime.pelvisOffsetAmount = (
    curveValue(input.curves, 'FootLeftIk')
    + curveValue(input.curves, 'FootRightIk')
  ) * settings.amountScale
  if (!(runtime.pelvisOffsetAmount > settings.relevanceThreshold)) {
    return
  }

  const target = THREE.MathUtils.clamp(
    Math.min(
      runtime.feet[0].footOffsetLocation,
      runtime.feet[1].footOffsetLocation,
    ),
    settings.minimumOffset * CENTIMETERS_TO_METERS,
    settings.maximumOffset * CENTIMETERS_TO_METERS,
  )
  runtime.pelvisOffset = stepPelvisSpring(
    runtime,
    target,
    input.deltaTime,
  )

  const pelvisTransform = loadComponentTransform(
    runtime,
    runtime.pelvisItemIndex,
    runtime.scratch.transformA,
  )
  // FRigUnit_SetTransform skips negligible/negative weights, lerps below full weight, and applies
  // the target verbatim at or above full weight.
  if (runtime.pelvisOffsetAmount < SMALL_NUMBER) return
  const weight = runtime.pelvisOffsetAmount < 1 - SMALL_NUMBER
    ? runtime.pelvisOffsetAmount
    : 1
  pelvisTransform.position.y += runtime.pelvisOffset * weight
  writeGlobalTransform(
    runtime,
    input.pose,
    runtime.pelvisItemIndex,
    pelvisTransform,
  )
  refreshComponentTransforms(runtime, input.pose)
}

function applyFootOffsetLocation(
  runtime: AlsControlRigFootIkRuntime,
  state: AlsControlRigFootIkState,
  solver: CompiledFootIkDefinition,
  targetLocation: THREE.Vector3,
  deltaTime: number,
  out: THREE.Vector3,
) {
  const settings = ALS_CONTROL_RIG_FOOT_IK.footLocation
  const pelvisLocationY =
    runtime.componentPositions[solver.pelvisItemIndex * 3 + 1]
  const maximumFootLocationY = pelvisLocationY
    - settings.minimumPelvisToFootDistance * CENTIMETERS_TO_METERS
  const maximumFootOffset =
    maximumFootLocationY - targetLocation.y
  let targetOffset = Math.min(
    state.footOffsetLocation,
    maximumFootOffset,
  )
  targetOffset = Math.max(targetOffset, runtime.pelvisOffset)

  if (!state.offsetLocationInitialized) {
    state.offsetLocationInitialized = true
    resetFloatSpringState(state.offsetLocationSpring)
    state.offsetLocation = targetOffset
  } else {
    state.offsetLocation = springDampFloat(
      state.offsetLocationSpring,
      state.offsetLocation,
      targetOffset,
      deltaTime,
      settings.interpolationFrequency,
      settings.interpolationDampingRatio,
      settings.interpolationTargetVelocityAmount,
    )
  }

  out.copy(targetLocation)
  out.y += state.offsetLocation
  runtime.scratch.legVector.set(
    out.x - runtime.componentPositions[solver.thighItemIndex * 3],
    out.y - runtime.componentPositions[solver.thighItemIndex * 3 + 1],
    out.z - runtime.componentPositions[solver.thighItemIndex * 3 + 2],
  )
  const legVectorLength = runtime.scratch.legVector.length()
  const maximumLegLength =
    runtime.legLength * settings.maximumLegStretchRatio
  if (
    legVectorLength > maximumLegLength
    && legVectorLength > POSITION_KINDA_SMALL_NUMBER
  ) {
    runtime.scratch.legVector.multiplyScalar(
      maximumLegLength / legVectorLength,
    )
    out.set(
      runtime.componentPositions[solver.thighItemIndex * 3]
        + runtime.scratch.legVector.x,
      runtime.componentPositions[solver.thighItemIndex * 3 + 1]
        + runtime.scratch.legVector.y,
      runtime.componentPositions[solver.thighItemIndex * 3 + 2]
        + runtime.scratch.legVector.z,
    )
  }
}

function tryCalculatePoleVector(
  runtime: AlsControlRigFootIkRuntime,
  state: AlsControlRigFootIkState,
  solver: CompiledFootIkDefinition,
) {
  const positions = runtime.componentPositions
  runtime.scratch.transformA.position.fromArray(
    positions,
    solver.thighItemIndex * 3,
  )
  runtime.scratch.transformB.position.fromArray(
    positions,
    solver.calfItemIndex * 3,
  )
  runtime.scratch.transformC.position.fromArray(
    positions,
    solver.footItemIndex * 3,
  )

  runtime.scratch.poleAb.subVectors(
    runtime.scratch.transformB.position,
    runtime.scratch.transformA.position,
  )
  if (isNearlyZero(runtime.scratch.poleAb)) return false

  runtime.scratch.poleAc.subVectors(
    runtime.scratch.transformC.position,
    runtime.scratch.transformA.position,
  )
  if (
    runtime.scratch.poleAc.lengthSq()
    <= POSITION_SMALL_NUMBER_SQUARED
  ) {
    state.poleItemBLocation.copy(
      runtime.scratch.transformB.position,
    )
    state.poleDirection
      .copy(runtime.scratch.poleAb)
      .normalize()
    return true
  }
  runtime.scratch.poleAc.normalize()
  runtime.scratch.poleProjection
    .copy(runtime.scratch.transformA.position)
    .addScaledVector(
      runtime.scratch.poleAc,
      runtime.scratch.poleAb.dot(runtime.scratch.poleAc),
    )
  runtime.scratch.poleAb.subVectors(
    runtime.scratch.transformB.position,
    runtime.scratch.poleProjection,
  )
  if (
    runtime.scratch.poleAb.lengthSq()
    <= POSITION_SMALL_NUMBER_SQUARED
  ) {
    return false
  }
  state.poleItemBLocation.copy(runtime.scratch.transformB.position)
  state.poleDirection.copy(runtime.scratch.poleAb).normalize()
  return true
}

function refreshPoleLocation(
  runtime: AlsControlRigFootIkRuntime,
  state: AlsControlRigFootIkState,
  solver: CompiledFootIkDefinition,
  deltaTime: number,
) {
  // Failure intentionally leaves the last successful item-B location and direction untouched.
  tryCalculatePoleVector(runtime, state, solver)
  runtime.scratch.poleTarget
    .copy(state.poleItemBLocation)
    .addScaledVector(
      state.poleDirection,
      ALS_CONTROL_RIG_FOOT_IK.pole.distance
        * CENTIMETERS_TO_METERS,
    )
  if (!state.poleLocationInitialized) {
    state.poleLocationInitialized = true
    state.poleLocation.copy(runtime.scratch.poleTarget)
  }
  const amount = exponentialDecayAmount(
    deltaTime,
    ALS_CONTROL_RIG_FOOT_IK.pole.interpolationLambda,
  )
  state.poleLocation.lerp(runtime.scratch.poleTarget, amount)
}

function initialScaledSegmentLength(
  runtime: AlsControlRigFootIkRuntime,
  itemAIndex: number,
  itemBIndex: number,
  currentScale: THREE.Vector3,
) {
  const itemAOffset = itemAIndex * 3
  const itemBOffset = itemBIndex * 3
  const initialScales = runtime.initialComponentScales
  runtime.scratch.lengthScale.set(1, 1, 1)
  if (
    initialScales[itemAOffset] * initialScales[itemAOffset]
    + initialScales[itemAOffset + 1]
      * initialScales[itemAOffset + 1]
    + initialScales[itemAOffset + 2]
      * initialScales[itemAOffset + 2]
    > SMALL_NUMBER
  ) {
    runtime.scratch.lengthScale.set(
      currentScale.x / initialScales[itemAOffset],
      currentScale.y / initialScales[itemAOffset + 1],
      currentScale.z / initialScales[itemAOffset + 2],
    )
  }
  return runtime.scratch.initialDifference.set(
    runtime.initialComponentPositions[itemAOffset]
      - runtime.initialComponentPositions[itemBOffset],
    runtime.initialComponentPositions[itemAOffset + 1]
      - runtime.initialComponentPositions[itemBOffset + 1],
    runtime.initialComponentPositions[itemAOffset + 2]
      - runtime.initialComponentPositions[itemBOffset + 2],
  ).multiply(runtime.scratch.lengthScale).length()
}

function solveFootTwoBoneIk(
  runtime: AlsControlRigFootIkRuntime,
  pose: LocalPoseBuffer,
  solver: CompiledFootIkDefinition,
  targetLocation: THREE.Vector3,
  targetRotation: THREE.Quaternion,
  poleLocation: THREE.Vector3,
  weight: number,
) {
  if (weight <= SMALL_NUMBER) return
  const { scratch } = runtime
  loadComponentTransform(runtime, solver.thighItemIndex, scratch.originalA)
  loadComponentTransform(runtime, solver.calfItemIndex, scratch.originalB)
  loadComponentTransform(runtime, solver.footItemIndex, scratch.originalC)
  copyTransform(scratch.originalA, scratch.transformA)
  copyTransform(scratch.transformA, scratch.transformB)
  scratch.transformB.position.copy(scratch.originalB.position)
  scratch.transformC.position.copy(targetLocation)
  scratch.transformC.rotation.copy(targetRotation)
  scratch.transformC.scale.set(1, 1, 1)

  const lengthA = initialScaledSegmentLength(
    runtime,
    solver.thighItemIndex,
    solver.calfItemIndex,
    scratch.transformA.scale,
  )
  const lengthB = initialScaledSegmentLength(
    runtime,
    solver.calfItemIndex,
    solver.footItemIndex,
    scratch.transformB.scale,
  )
  if (lengthA < SMALL_NUMBER || lengthB < SMALL_NUMBER) return

  solveTwoBonePositions(
    scratch.transformA,
    scratch.transformB,
    scratch.transformC,
    poleLocation,
    lengthA,
    lengthB,
    scratch,
  )
  orientBasicTwoBoneIk(
    scratch.transformA,
    scratch.transformB,
    scratch.transformC,
    {
      primaryAxis: solver.primaryAxis,
      secondaryAxis: solver.secondaryAxis,
    },
    scratch,
  )
  if (weight < 1 - SMALL_NUMBER) {
    blendBasicIkResult(weight, scratch)
  }

  writeGlobalTransform(
    runtime,
    pose,
    solver.thighItemIndex,
    scratch.transformA,
  )
  writeLocalFromGlobal(
    pose,
    solver.calfItemIndex,
    scratch.transformB,
    scratch.transformA,
    scratch,
  )
  writeLocalFromGlobal(
    pose,
    solver.footItemIndex,
    scratch.transformC,
    scratch.transformB,
    scratch,
  )
  refreshComponentTransforms(runtime, pose)
}

function findBetweenVectors(
  from: THREE.Vector3,
  to: THREE.Vector3,
  out: THREE.Quaternion,
) {
  const norm = Math.sqrt(from.lengthSq() * to.lengthSq())
  let w = norm + from.dot(to)
  if (w >= FIND_BETWEEN_NORMALS_EPSILON * norm) {
    out.set(
      from.y * to.z - from.z * to.y,
      from.z * to.x - from.x * to.z,
      from.x * to.y - from.y * to.x,
      w,
    )
  } else {
    w = 0
    const x = Math.abs(from.x)
    const y = Math.abs(from.y)
    const z = Math.abs(from.z)
    if (x > y && x > z) {
      // Basis = +Y.
      out.set(-from.z, 0, from.x, w)
    } else {
      // Basis = -X.
      out.set(0, -from.z, from.y, w)
    }
  }
  if (out.lengthSq() <= SMALL_NUMBER) return out.identity()
  return out.normalize()
}

function toSwingTwistX(
  quaternion: THREE.Quaternion,
  swing: THREE.Quaternion,
  twist: THREE.Quaternion,
  twistInverse: THREE.Quaternion,
) {
  twist.set(quaternion.x, 0, 0, quaternion.w)
  if (twist.lengthSq() === 0) twist.identity()
  else twist.normalize()
  swing.copy(quaternion).multiply(
    twistInverse.copy(twist).conjugate(),
  )
}

function applyRotationConstraint(
  initial: number,
  target: number,
  limitAngle: number,
) {
  const limit = Math.sin(THREE.MathUtils.degToRad(limitAngle) * 0.5)
  const minimum = initial >= 0
    ? -limit
    : Math.min(initial, -limit)
  const maximum = initial >= 0
    ? Math.max(initial, limit)
    : limit
  return THREE.MathUtils.clamp(target, minimum, maximum)
}

function ueSign(value: number) {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

function applyFootOffsetRotation(
  runtime: AlsControlRigFootIkRuntime,
  state: AlsControlRigFootIkState,
  solver: CompiledFootIkDefinition,
  targetRotation: THREE.Quaternion,
  deltaTime: number,
  out: THREE.Quaternion,
) {
  const settings = ALS_CONTROL_RIG_FOOT_IK.footRotation
  if (!state.offsetNormalInitialized) {
    state.offsetNormalInitialized = true
    state.offsetNormal.copy(state.footOffsetNormal)
  }
  state.offsetNormal.lerp(
    state.footOffsetNormal,
    exponentialDecayAmount(
      deltaTime,
      settings.interpolationSpeed,
    ),
  )

  loadComponentTransform(
    runtime,
    solver.calfItemIndex,
    runtime.scratch.transformB,
  )
  // The rotation constraint is authored in Unreal quaternion component space. Convert the
  // already-basis-conjugated pose values back, run the source line-for-line, then conjugate once.
  runtime.scratch.unrealNormal.set(
    state.offsetNormal.x,
    state.offsetNormal.z,
    state.offsetNormal.y,
  )
  conjugateUnrealGltfQuaternion(
    runtime.scratch.transformB.rotation,
    runtime.scratch.unrealCalfRotation,
  )
  conjugateUnrealGltfQuaternion(
    targetRotation,
    runtime.scratch.unrealTargetRotation,
  )
  findBetweenVectors(
    runtime.scratch.unrealUp,
    runtime.scratch.unrealNormal,
    runtime.scratch.unrealOffsetRotation,
  )

  runtime.scratch.initialLocalRotation
    .copy(runtime.scratch.unrealCalfRotation)
    .conjugate()
    .multiply(runtime.scratch.unrealTargetRotation)
    .multiply(runtime.scratch.limitOffset)
  runtime.scratch.targetLocalRotation
    .copy(runtime.scratch.unrealCalfRotation)
    .conjugate()
    .multiply(runtime.scratch.unrealOffsetRotation)
    .multiply(runtime.scratch.unrealTargetRotation)
    .multiply(runtime.scratch.limitOffset)

  toSwingTwistX(
    runtime.scratch.initialLocalRotation,
    runtime.scratch.initialSwing,
    runtime.scratch.initialTwist,
    runtime.scratch.twistInverse,
  )
  toSwingTwistX(
    runtime.scratch.targetLocalRotation,
    runtime.scratch.targetSwing,
    runtime.scratch.targetTwist,
    runtime.scratch.twistInverse,
  )

  const swingY = applyRotationConstraint(
    runtime.scratch.initialSwing.y,
    runtime.scratch.targetSwing.y,
    settings.swing2LimitAngle,
  )
  const swingZ = applyRotationConstraint(
    runtime.scratch.initialSwing.z,
    runtime.scratch.targetSwing.z,
    settings.swing1LimitAngle,
  )
  runtime.scratch.newSwing.set(
    0,
    swingY,
    swingZ,
    ueSign(runtime.scratch.targetSwing.w) * Math.sqrt(
      Math.max(0, 1 - swingY * swingY - swingZ * swingZ),
    ),
  )
  const twistX = applyRotationConstraint(
    runtime.scratch.initialTwist.x,
    runtime.scratch.targetTwist.x,
    settings.twistLimitAngle,
  )
  runtime.scratch.newTwist.set(
    twistX,
    0,
    0,
    ueSign(runtime.scratch.targetTwist.w) * Math.sqrt(
      Math.max(0, 1 - twistX * twistX),
    ),
  )
  runtime.scratch.newLocalRotation
    .copy(runtime.scratch.newSwing)
    .multiply(runtime.scratch.newTwist)
  runtime.scratch.unrealCalfRotation
    .multiply(runtime.scratch.newLocalRotation)
    .multiply(runtime.scratch.inverseLimitOffset)
    .normalize()
  return conjugateUnrealGltfQuaternion(
    runtime.scratch.unrealCalfRotation,
    out,
  )
}

function setFootRotation(
  runtime: AlsControlRigFootIkRuntime,
  pose: LocalPoseBuffer,
  solver: CompiledFootIkDefinition,
  rotation: THREE.Quaternion,
  weight: number,
) {
  if (weight < SMALL_NUMBER) return
  const transform = loadComponentTransform(
    runtime,
    solver.footItemIndex,
    runtime.scratch.transformC,
  )
  if (weight < 1 - SMALL_NUMBER) {
    transform.rotation.slerp(rotation, weight)
  } else {
    transform.rotation.copy(rotation)
  }
  writeGlobalTransform(
    runtime,
    pose,
    solver.footItemIndex,
    transform,
  )
  refreshComponentTransforms(runtime, pose)
}

/**
 * CR_Als.RefreshFootIk: ApplyFootIk(left) completes before ApplyFootIk(right) begins.
 */
function refreshFootIk(
  runtime: AlsControlRigFootIkRuntime,
  input: EvaluateAlsControlRigFootIkInput,
) {
  for (let footIndex = 0; footIndex < runtime.feet.length; footIndex++) {
    const state = runtime.feet[footIndex]
    const solver = runtime.solvers[footIndex]
    const targetLocation = footTargetLocation(
      input.rigInput,
      solver.definition.side,
    )
    const targetRotation = footTargetRotation(
      input.rigInput,
      solver.definition.side,
    )
    const weight = curveValue(
      input.curves,
      solver.definition.curveName,
    )

    applyFootOffsetLocation(
      runtime,
      state,
      solver,
      targetLocation,
      input.deltaTime,
      runtime.scratch.footLocation,
    )
    refreshPoleLocation(
      runtime,
      state,
      solver,
      input.deltaTime,
    )
    // ApplyFootOffsetLocation and both persistent interpolation nodes execute even when the
    // TwoBoneIK unit's raw curve weight takes its early return.
    solveFootTwoBoneIk(
      runtime,
      input.pose,
      solver,
      runtime.scratch.footLocation,
      targetRotation,
      state.poleLocation,
      weight,
    )
    applyFootOffsetRotation(
      runtime,
      state,
      solver,
      targetRotation,
      input.deltaTime,
      runtime.scratch.targetRotationC,
    )
    setFootRotation(
      runtime,
      input.pose,
      solver,
      runtime.scratch.targetRotationC,
      weight,
    )
  }
}

/**
 * Pure pose-buffer port of CR_Als's ground-foot section.
 *
 * The caller supplies FAlsControlRigInput's foot targets in glTF component space and the line
 * trace seam. The function mutates only the supplied pose/runtime and follows the authored
 * RefreshFootOffset → RefreshPelvisOffset → RefreshFootIk order.
 */
export function evaluateAlsControlRigFootIk(
  runtime: AlsControlRigFootIkRuntime,
  input: EvaluateAlsControlRigFootIkInput,
): LocalPoseBuffer {
  if (
    input.pose.boneCount !== runtime.rig.boneCount
    || input.pose.boneCount !== runtime.componentPositions.length / 3
  ) {
    throw new Error('CR_Als foot IK pose has an incompatible bone count')
  }

  refreshComponentTransforms(runtime, input.pose)
  refreshFootOffset(runtime, input)
  refreshPelvisOffset(runtime, input)
  refreshFootIk(runtime, input)
  return input.pose
}

/** CR_Als's IsGameWorld-gated Forward Solve, in authored RigVM execution-link order. */
export const ALS_CONTROL_RIG_FORWARD_SOLVE = {
  gate: {
    function: 'FAlsRigVMFunction_IsGameWorld',
    block: 'True',
  },
  executionOrder: [
    'RefreshDiagonalScaling',
    'RefreshSpineRotation',
    'RefreshFootOffset',
    'RefreshPelvisOffset',
    'RefreshFootIk',
    'RefreshHandIk',
  ],
  diagonalScaling: {
    footRootBoneWhenUsingFootIkBones: 'ik_foot_root',
    footRootBoneOtherwise: 'VB foot_root',
    curveName: 'PoseMoving',
    /** Authored Unreal scale axes. Runtime C-basis axes are (0.4, 0, 0.4). */
    scaleOffset: [0.4, 0.4, 0] as const,
  },
  /** Default__CR_Als_C.SpineRotationBones, preserving authored array order. */
  spineRotationBones: [
    'pelvis',
    'spine_01',
    'spine_02',
    'spine_03',
  ],
} as const

export interface AlsControlRigForwardSolveRuntime {
  readonly footIk: AlsControlRigFootIkRuntime
  readonly handIk: AlsControlRigHandIkRuntime
  /** Component-space positions immediately before the six authored Forward Solve stages. */
  readonly preForwardSolveComponentPositions: Float32Array
  /** Component-space positions after all six authored Forward Solve stages. */
  readonly postForwardSolveComponentPositions: Float32Array
  readonly footRootBoneWhenUsingFootIkBonesIndex: number
  readonly footRootBoneOtherwiseIndex: number
  readonly spineRotationBoneIndices: readonly number[]
  readonly spineTargetRotation: THREE.Quaternion
  readonly spineDeltaRotation: THREE.Quaternion
  diagonalScalingFactor: number
  spineRotationApplied: boolean
  executed: boolean
}

export interface EvaluateAlsControlRigForwardSolveInput
  extends Omit<EvaluateAlsControlRigFootIkInput, 'rigInput'> {
  readonly isGameWorld: boolean
  readonly rigInput: AlsControlRigInputState
  /** Opt-in diagnostics; avoids a second component-hierarchy refresh during normal play. */
  readonly captureComponentPositionSnapshots?: boolean
}

function requireForwardSolveBoneIndex(
  rig: RigDefinition,
  boneName: string,
) {
  const index = rig.boneNames.indexOf(boneName)
  if (index < 0) {
    throw new Error(
      `CR_Als Forward Solve requires bone "${boneName}"`,
    )
  }
  return index
}

export function createAlsControlRigForwardSolveRuntime(
  rig: RigDefinition,
): AlsControlRigForwardSolveRuntime {
  const diagonalScaling = ALS_CONTROL_RIG_FORWARD_SOLVE.diagonalScaling
  const componentPositionCount = rig.boneCount * 3
  return {
    footIk: createAlsControlRigFootIkRuntime(rig),
    handIk: createAlsControlRigHandIkRuntime(rig),
    preForwardSolveComponentPositions:
      new Float32Array(componentPositionCount),
    postForwardSolveComponentPositions:
      new Float32Array(componentPositionCount),
    footRootBoneWhenUsingFootIkBonesIndex:
      requireForwardSolveBoneIndex(
        rig,
        diagonalScaling.footRootBoneWhenUsingFootIkBones,
      ),
    footRootBoneOtherwiseIndex: requireForwardSolveBoneIndex(
      rig,
      diagonalScaling.footRootBoneOtherwise,
    ),
    spineRotationBoneIndices:
      ALS_CONTROL_RIG_FORWARD_SOLVE.spineRotationBones.map(
        (boneName) => requireForwardSolveBoneIndex(rig, boneName),
      ),
    spineTargetRotation: new THREE.Quaternion(),
    spineDeltaRotation: new THREE.Quaternion(),
    diagonalScalingFactor: 0,
    spineRotationApplied: false,
    executed: false,
  }
}

/**
 * Exact scalar graph upstream of RefreshDiagonalScaling's authored (0.4, 0.4, 0) scale offset.
 */
export function calculateAlsControlRigDiagonalScalingFactor(
  velocityBlendForwardAmount: number,
  velocityBlendBackwardAmount: number,
): number {
  return 1 - Math.abs(
    2 * (
      velocityBlendForwardAmount
      + velocityBlendBackwardAmount
      - 0.5
    ),
  )
}

/**
 * RefreshDiagonalScaling. GetTransform and SetScale both use the current local transform;
 * SetScale is weighted directly by PoseMoving and propagates to children.
 */
function refreshDiagonalScaling(
  runtime: AlsControlRigForwardSolveRuntime,
  input: EvaluateAlsControlRigForwardSolveInput,
) {
  runtime.diagonalScalingFactor =
    calculateAlsControlRigDiagonalScalingFactor(
      input.rigInput.velocityBlendForwardAmount,
      input.rigInput.velocityBlendBackwardAmount,
    )
  const weight = curveValue(
    input.curves,
    ALS_CONTROL_RIG_FORWARD_SOLVE.diagonalScaling.curveName,
  )
  if (weight < SMALL_NUMBER) return

  // FRigUnit_SetTransform blends only the partial-weight range; a full-or-higher weight writes
  // the complete target. CR_Als connects PoseMoving directly and has no Clamp01 node.
  const writeWeight = weight < 1 - SMALL_NUMBER ? weight : 1
  const footRootBoneIndex = input.rigInput.bUseFootIkBones
    ? runtime.footRootBoneWhenUsingFootIkBonesIndex
    : runtime.footRootBoneOtherwiseIndex
  const scaleOffset = footRootBoneIndex * 3
  const scaledFactor = runtime.diagonalScalingFactor * writeWeight
  input.pose.scales[scaleOffset] += 0.4 * scaledFactor
  input.pose.scales[scaleOffset + 2] += 0.4 * scaledFactor
  refreshComponentTransforms(runtime.footIk, input.pose)
}

function isAlsIdentityQuaternion(
  rotation: Readonly<THREE.Quaternion>,
  tolerance: number,
) {
  return Math.abs(rotation.x) <= tolerance
    && Math.abs(rotation.y) <= tolerance
    && Math.abs(rotation.z) <= tolerance
    && (
      Math.abs(rotation.w - 1) <= tolerance
      || Math.abs(rotation.w + 1) <= tolerance
    )
}

/**
 * RefreshSpineRotation plus FAlsRigUnit_DistributeRotationSimple. The unit premultiplies the
 * same 1/N global delta in array order, with SetGlobalTransform's default child propagation.
 */
function refreshSpineRotation(
  runtime: AlsControlRigForwardSolveRuntime,
  input: EvaluateAlsControlRigForwardSolveInput,
) {
  runtime.spineRotationApplied = false
  const itemCount = runtime.spineRotationBoneIndices.length
  if (itemCount <= 0) return

  runtime.spineTargetRotation.setFromAxisAngle(
    RUNTIME_UP,
    unrealYawDegreesToThreeRadians(input.rigInput.spineYawAngle),
  )
  if (
    isAlsIdentityQuaternion(
      runtime.spineTargetRotation,
      KINDA_SMALL_NUMBER,
    )
  ) {
    return
  }

  runtime.spineDeltaRotation.identity().slerp(
    runtime.spineTargetRotation,
    1 / itemCount,
  )
  if (
    isAlsIdentityQuaternion(
      runtime.spineDeltaRotation,
      KINDA_SMALL_NUMBER,
    )
  ) {
    return
  }

  for (const itemIndex of runtime.spineRotationBoneIndices) {
    loadComponentTransform(
      runtime.footIk,
      itemIndex,
      runtime.footIk.scratch.transformC,
    )
    runtime.footIk.scratch.transformC.rotation
      .premultiply(runtime.spineDeltaRotation)
      .normalize()
    writeGlobalTransform(
      runtime.footIk,
      input.pose,
      itemIndex,
      runtime.footIk.scratch.transformC,
    )
    refreshComponentTransforms(runtime.footIk, input.pose)
  }
  runtime.spineRotationApplied = true
}

/**
 * Runs all six stages of CR_Als's Forward Solve against one final pose and curve buffer.
 *
 * The caller supplies the same-frame final AnimGraph curves plus FAlsControlRigInput. In UE, the
 * foot locations/rotations come from FAlsFeetState::Final* values refreshed from the prior
 * published skeletal frame.
 */
export function evaluateAlsControlRigForwardSolve(
  runtime: AlsControlRigForwardSolveRuntime,
  input: EvaluateAlsControlRigForwardSolveInput,
): LocalPoseBuffer {
  if (input.pose.boneCount !== runtime.footIk.rig.boneCount) {
    throw new Error(
      'CR_Als Forward Solve pose has an incompatible bone count',
    )
  }
  runtime.executed = false
  if (!input.isGameWorld) return input.pose

  refreshComponentTransforms(runtime.footIk, input.pose)
  if (input.captureComponentPositionSnapshots) {
    runtime.preForwardSolveComponentPositions.set(
      runtime.footIk.componentPositions,
    )
  }
  refreshDiagonalScaling(runtime, input)
  refreshSpineRotation(runtime, input)
  evaluateAlsControlRigFootIk(runtime.footIk, input)
  evaluateAlsControlRigHandIk(runtime.handIk, {
    pose: input.pose,
    curves: input.curves,
    useHandIkBones: input.rigInput.bUseHandIkBones,
  })
  if (input.captureComponentPositionSnapshots) {
    refreshComponentTransforms(runtime.footIk, input.pose)
    runtime.postForwardSolveComponentPositions.set(
      runtime.footIk.componentPositions,
    )
  }
  runtime.executed = true
  return input.pose
}
