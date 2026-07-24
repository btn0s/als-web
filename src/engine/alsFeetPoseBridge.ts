import * as THREE from 'three'
import {
  refreshFeet,
  refreshFeetOnGameThread,
} from '../als/State/AlsFeetState'
import type {
  AlsFeetState,
  AlsQuaternion,
  AlsRefreshFeetInput,
  AlsTransform,
} from '../als/State/AlsFeetState'
import type { PoseApplicator } from './applyPose'
import type { RigDefinition } from './rig'

const REQUIRED_BONE_NAMES = {
  pelvis: 'pelvis',
  footLeft: 'foot_l',
  footRight: 'foot_r',
  footLeftIk: 'ik_foot_l',
  footRightIk: 'ik_foot_r',
  footLeftVirtual: 'VB foot_l',
  footRightVirtual: 'VB foot_r',
} as const

const TRANSFORM_EPSILON = 1e-8

export type AlsFeetPoseBridgeRefreshInput = Omit<
  AlsRefreshFeetInput,
  'componentTransform'
>

export interface AlsFootComponentTarget {
  /** CR_Als component-global position in glTF metres. */
  readonly position: THREE.Vector3
  /** CR_Als component-global rotation in the glTF basis. */
  readonly rotation: THREE.Quaternion
}

export interface AlsFeetComponentTargets {
  readonly left: AlsFootComponentTarget
  readonly right: AlsFootComponentTarget
}

export interface AlsFeetPoseBridge {
  readonly targets: AlsFeetComponentTargets
  /**
   * `NativeUpdateAnimation()` socket capture. Call before evaluating this frame's graph so these
   * transforms come from the skeleton pose published by the preceding frame.
   */
  capturePublishedPose(state: AlsFeetState): void
  /**
   * `NativeThreadSafeUpdateAnimation()` feet refresh. Curve inputs likewise belong to the
   * preceding published frame; the returned component targets feed the current CR_Als solve.
   */
  refresh(
    state: AlsFeetState,
    input: Readonly<AlsFeetPoseBridgeRefreshInput>,
  ): AlsFeetComponentTargets
}

interface MutableVector {
  x: number
  y: number
  z: number
}

interface MutableQuaternion extends MutableVector {
  w: number
}

interface MutableTransform {
  location: MutableVector
  rotation: MutableQuaternion
  scale?: MutableVector
}

function mutableVector(
  x = 0,
  y = 0,
  z = 0,
): MutableVector {
  return { x, y, z }
}

function mutableQuaternion(): MutableQuaternion {
  return { x: 0, y: 0, z: 0, w: 1 }
}

function requireBoneIndex(
  rig: RigDefinition,
  boneName: string,
): number {
  const index = rig.boneNames.indexOf(boneName)
  if (index < 0) {
    throw new Error(`ALS feet pose bridge requires bone "${boneName}"`)
  }
  return index
}

/**
 * C-conjugation for the extractor's reflection basis.
 *
 * The same mapping is its own inverse: q_Als = C q_Gltf C and q_Gltf = C q_Als C.
 */
export function threeQuaternionToAls(
  value: Readonly<THREE.Quaternion>,
  out: AlsQuaternion,
): AlsQuaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w)
  if (!(length > TRANSFORM_EPSILON) || !Number.isFinite(length)) {
    throw new Error('ALS feet pose bridge requires a finite rotation')
  }
  const inverseLength = 1 / length
  out.x = value.x === 0 ? 0 : -value.x * inverseLength
  out.y = value.z === 0 ? 0 : -value.z * inverseLength
  out.z = value.y === 0 ? 0 : -value.y * inverseLength
  out.w = value.w * inverseLength
  return out
}

export function alsQuaternionToThree(
  value: Readonly<AlsQuaternion>,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const length = Math.hypot(value.x, value.y, value.z, value.w)
  if (!(length > TRANSFORM_EPSILON) || !Number.isFinite(length)) {
    throw new Error('ALS feet pose bridge requires a finite rotation')
  }
  const inverseLength = 1 / length
  return out.set(
    value.x === 0 ? 0 : -value.x * inverseLength,
    value.z === 0 ? 0 : -value.z * inverseLength,
    value.y === 0 ? 0 : -value.y * inverseLength,
    value.w * inverseLength,
  )
}

function initializeThighAxis(
  state: AlsFeetState['left'],
  rig: RigDefinition,
  pelvisBoneIndex: number,
  footBoneName: string,
): void {
  let parentBoneIndex = rig.boneNames.indexOf(footBoneName)
  if (parentBoneIndex < 0) return

  // UAlsAnimationInstance::NativeInitializeAnimation(), AlsAnimationInstance.cpp:41-81.
  while (true) {
    const nextParentBoneIndex = rig.parentIndices[parentBoneIndex]
    if (nextParentBoneIndex <= 0) return
    if (nextParentBoneIndex === pelvisBoneIndex) break
    parentBoneIndex = nextParentBoneIndex
  }

  const offset = parentBoneIndex * 3
  const threeX = rig.referencePositions[offset]
  const threeY = rig.referencePositions[offset + 1]
  const threeZ = rig.referencePositions[offset + 2]
  const length = Math.hypot(threeX, threeY, threeZ)
  if (!(length > 0) || !Number.isFinite(length)) return

  state.thighAxis.x = threeX / length
  state.thighAxis.y = threeZ / length
  state.thighAxis.z = threeY / length
}

/** Exact reference-hierarchy thigh-axis initialization for both ALS feet. */
export function initializeAlsFeetThighAxesFromRig(
  state: AlsFeetState,
  rig: RigDefinition,
): AlsFeetState {
  const pelvisBoneIndex = rig.boneNames.indexOf(
    REQUIRED_BONE_NAMES.pelvis,
  )
  initializeThighAxis(
    state.left,
    rig,
    pelvisBoneIndex,
    REQUIRED_BONE_NAMES.footLeft,
  )
  initializeThighAxis(
    state.right,
    rig,
    pelvisBoneIndex,
    REQUIRED_BONE_NAMES.footRight,
  )
  return state
}

/**
 * Bridges the published three.js skeleton to ALS's game-thread foot snapshot, then maps the exact
 * `FAlsFeetState::Final*` values back to CR_Als component space.
 */
export function createAlsFeetPoseBridge(
  rig: RigDefinition,
  applicator: PoseApplicator,
  component: THREE.Object3D,
  useFootIkBones = true,
): AlsFeetPoseBridge {
  if (applicator.bones.length !== rig.boneCount) {
    throw new Error('ALS feet pose bridge received an incompatible pose applicator')
  }

  const pelvisBoneIndex = requireBoneIndex(
    rig,
    REQUIRED_BONE_NAMES.pelvis,
  )
  const footLeftBoneIndex = requireBoneIndex(
    rig,
    useFootIkBones
      ? REQUIRED_BONE_NAMES.footLeftIk
      : REQUIRED_BONE_NAMES.footLeftVirtual,
  )
  const footRightBoneIndex = requireBoneIndex(
    rig,
    useFootIkBones
      ? REQUIRED_BONE_NAMES.footRightIk
      : REQUIRED_BONE_NAMES.footRightVirtual,
  )

  const componentTransform: MutableTransform = {
    location: mutableVector(),
    rotation: mutableQuaternion(),
    scale: mutableVector(1, 1, 1),
  }
  const pelvisRotation = mutableQuaternion()
  const leftTarget: MutableTransform = {
    location: mutableVector(),
    rotation: mutableQuaternion(),
  }
  const rightTarget: MutableTransform = {
    location: mutableVector(),
    rotation: mutableQuaternion(),
  }
  const targets: AlsFeetComponentTargets = {
    left: {
      position: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
    },
    right: {
      position: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
    },
  }

  const componentWorldPosition = new THREE.Vector3()
  const componentWorldRotation = new THREE.Quaternion()
  const componentWorldScale = new THREE.Vector3()
  const boneWorldPosition = new THREE.Vector3()
  const boneWorldRotation = new THREE.Quaternion()
  const boneWorldScale = new THREE.Vector3()
  const pelvisComponentMatrix = new THREE.Matrix4()
  const componentWorldInverse = new THREE.Matrix4()
  const pelvisComponentPosition = new THREE.Vector3()
  const pelvisComponentRotation = new THREE.Quaternion()
  const pelvisComponentScale = new THREE.Vector3()
  let captured = false

  const captureWorldBone = (
    boneIndex: number,
    target: MutableTransform,
  ) => {
    applicator.bones[boneIndex].matrixWorld.decompose(
      boneWorldPosition,
      boneWorldRotation,
      boneWorldScale,
    )
    target.location.x = boneWorldPosition.x
    target.location.y = boneWorldPosition.z
    target.location.z = boneWorldPosition.y
    threeQuaternionToAls(boneWorldRotation, target.rotation)
  }

  const writeTarget = (
    state: AlsFeetState['left'],
    target: AlsFootComponentTarget,
  ) => {
    target.position.set(
      state.finalLocation.x,
      state.finalLocation.z,
      state.finalLocation.y,
    )
    alsQuaternionToThree(state.finalRotation, target.rotation)
  }

  return {
    targets,
    capturePublishedPose(state) {
      component.updateWorldMatrix(true, true)
      const determinant = component.matrixWorld.determinant()
      if (
        !Number.isFinite(determinant)
        || Math.abs(determinant) <= TRANSFORM_EPSILON
      ) {
        throw new Error(
          'ALS feet pose bridge component transform must be finite and invertible',
        )
      }

      component.matrixWorld.decompose(
        componentWorldPosition,
        componentWorldRotation,
        componentWorldScale,
      )
      componentTransform.location.x = componentWorldPosition.x
      componentTransform.location.y = componentWorldPosition.z
      componentTransform.location.z = componentWorldPosition.y
      threeQuaternionToAls(
        componentWorldRotation,
        componentTransform.rotation,
      )
      componentTransform.scale!.x = componentWorldScale.x
      componentTransform.scale!.y = componentWorldScale.z
      componentTransform.scale!.z = componentWorldScale.y

      componentWorldInverse.copy(component.matrixWorld).invert()
      pelvisComponentMatrix.multiplyMatrices(
        componentWorldInverse,
        applicator.bones[pelvisBoneIndex].matrixWorld,
      )
      pelvisComponentMatrix.decompose(
        pelvisComponentPosition,
        pelvisComponentRotation,
        pelvisComponentScale,
      )
      threeQuaternionToAls(
        pelvisComponentRotation,
        pelvisRotation,
      )
      captureWorldBone(footLeftBoneIndex, leftTarget)
      captureWorldBone(footRightBoneIndex, rightTarget)
      refreshFeetOnGameThread(state, {
        pelvisRotation,
        leftTarget,
        rightTarget,
      })
      captured = true
    },
    refresh(state, input) {
      if (!captured) {
        throw new Error(
          'ALS feet pose bridge requires a published-pose capture before refresh',
        )
      }
      refreshFeet(state, {
        ...input,
        componentTransform: componentTransform as AlsTransform,
      })
      writeTarget(state.left, targets.left)
      writeTarget(state.right, targets.right)
      return targets
    },
  }
}
