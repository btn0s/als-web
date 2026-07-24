import * as THREE from 'three'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'

const SMALL_NUMBER = 1e-8
const KINDA_SMALL_NUMBER = 1e-4
const FIND_BETWEEN_NORMALS_EPSILON = 1e-6

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

interface CompiledHandIkDefinition {
  readonly definition: AlsControlRigHandIkDefinition
  readonly itemAIndex: number
  readonly itemBIndex: number
  readonly effectorItemIndex: number
  readonly targetWhenUsingHandIkBonesIndex: number
  readonly targetOtherwiseIndex: number
  readonly poleVectorSpaceIndex: number
}

interface AlsControlRigHandIkScratch {
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
  return Math.abs(vector.x) <= KINDA_SMALL_NUMBER
    && Math.abs(vector.y) <= KINDA_SMALL_NUMBER
    && Math.abs(vector.z) <= KINDA_SMALL_NUMBER
}

function refreshComponentTransformsFromArrays(
  runtime: AlsControlRigHandIkRuntime,
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
  runtime: AlsControlRigHandIkRuntime,
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
  runtime: AlsControlRigHandIkRuntime,
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
    throw new Error('CR_Als hand IK cannot invert a zero component scale')
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
  } else if (Math.abs(from.x) > Math.abs(from.y)) {
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
  if (desiredLength < KINDA_SMALL_NUMBER) {
    desiredLength = KINDA_SMALL_NUMBER
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
    < KINDA_SMALL_NUMBER * KINDA_SMALL_NUMBER
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
      < KINDA_SMALL_NUMBER * KINDA_SMALL_NUMBER
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
  definition: AlsControlRigHandIkDefinition,
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
            KINDA_SMALL_NUMBER * 2,
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
  scratch: AlsControlRigHandIkScratch,
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
    throw new Error('CR_Als hand IK cannot divide by a zero parent scale')
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
    .fromArray(solver.definition.poleVector)
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
    solver.definition,
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
