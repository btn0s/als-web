import * as THREE from 'three'

export interface VirtualBoneDefinition {
  readonly name: string
  readonly sourceBoneName: string
  readonly targetBoneName: string
}

export interface CompiledVirtualBoneDefinition
  extends VirtualBoneDefinition {
  readonly boneIndex: number
  readonly sourceBoneIndex: number
  readonly targetBoneIndex: number
}

/** Skeleton topology and reference local transforms, detached from the scene graph. */
export interface RigDefinition {
  readonly boneCount: number
  readonly physicalBoneCount: number
  readonly boneNames: readonly string[]
  readonly parentIndices: Int16Array
  readonly referencePositions: Float32Array
  readonly referenceRotations: Float32Array
  readonly referenceScales: Float32Array
  readonly virtualBones: readonly CompiledVirtualBoneDefinition[]
}

/**
 * Captures a stable, parent-before-child bone order. The returned definition owns no Object3D
 * references; scene-graph references belong to the pose applicator and are resolved only once.
 */
export function createRigDefinition(
  skeletonRoot: THREE.Object3D,
  virtualBoneDefinitions: readonly VirtualBoneDefinition[] = [],
): RigDefinition {
  const bones: THREE.Bone[] = []
  skeletonRoot.traverse((object) => {
    if (
      object instanceof THREE.Bone
      && object.userData.alsVirtualBone !== true
    ) {
      bones.push(object)
    }
  })
  const indices = new Map<THREE.Object3D, number>(bones.map((bone, i) => [bone, i]))
  skeletonRoot.updateWorldMatrix(true, true)
  return compileRigDefinition(bones.map(bone => {
    let parent = bone.parent
    while (parent && !indices.has(parent)) parent = parent.parent
    return {
      name: bone.name,
      parent: parent ? indices.get(parent)! : -1,
      translation: bone.position.toArray(),
      rotation: bone.quaternion.toArray(),
      scale: bone.scale.toArray(),
      referenceWorld: bone.matrixWorld,
    }
  }), virtualBoneDefinitions)
}

export interface RigBone {
  readonly name: string
  readonly parent: number
  readonly translation: ArrayLike<number>
  readonly rotation: ArrayLike<number>
  readonly scale: ArrayLike<number>
}

export function compileRigDefinition(
  bones: readonly (RigBone & { referenceWorld?: THREE.Matrix4 })[],
  virtualBoneDefinitions: readonly VirtualBoneDefinition[] = [],
): RigDefinition {
  const physicalBoneCount = bones.length
  const boneCount = physicalBoneCount + virtualBoneDefinitions.length
  const boneNames = new Array<string>(boneCount)
  const parentIndices = new Int16Array(boneCount)
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  const names = new Set<string>()
  const componentTransforms = new Map<string, THREE.Matrix4>()
  const orderedTransforms: THREE.Matrix4[] = []
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()

  for (const [i, bone] of bones.entries()) {
    if (names.has(bone.name)) throw new Error(`Rig contains duplicate bone name "${bone.name}"`)
    if (!Number.isInteger(bone.parent) || bone.parent < -1 || bone.parent >= i) {
      throw new Error(`Rig bone "${bone.name}" must follow its parent`)
    }
    names.add(bone.name)
    boneNames[i] = bone.name
    parentIndices[i] = bone.parent
    referencePositions.set(bone.translation, i * 3)
    referenceRotations.set(bone.rotation, i * 4)
    referenceScales.set(bone.scale, i * 3)
    const matrix = bone.referenceWorld ?? new THREE.Matrix4().compose(
      position.fromArray(bone.translation),
      rotation.fromArray(bone.rotation),
      scale.fromArray(bone.scale),
    )
    if (!bone.referenceWorld && bone.parent >= 0) matrix.premultiply(orderedTransforms[bone.parent])
    orderedTransforms.push(matrix)
    componentTransforms.set(bone.name, matrix)
  }

  const virtualBones: CompiledVirtualBoneDefinition[] = []
  const inverseSource = new THREE.Matrix4()
  const relative = new THREE.Matrix4()

  for (
    let virtualBoneOrder = 0;
    virtualBoneOrder < virtualBoneDefinitions.length;
    virtualBoneOrder++
  ) {
    const definition = virtualBoneDefinitions[virtualBoneOrder]
    if (names.has(definition.name)) {
      throw new Error(`Rig contains duplicate bone name "${definition.name}"`)
    }
    const sourceBoneIndex = boneNames.indexOf(definition.sourceBoneName)
    const targetBoneIndex = boneNames.indexOf(definition.targetBoneName)
    if (sourceBoneIndex < 0) {
      throw new Error(
        `Virtual bone "${definition.name}" has missing source `
        + `"${definition.sourceBoneName}"`,
      )
    }
    if (targetBoneIndex < 0) {
      throw new Error(
        `Virtual bone "${definition.name}" has missing target `
        + `"${definition.targetBoneName}"`,
      )
    }
    const sourceComponent = componentTransforms.get(
      definition.sourceBoneName,
    )
    const targetComponent = componentTransforms.get(
      definition.targetBoneName,
    )
    if (!sourceComponent || !targetComponent) {
      throw new Error(
        `Virtual bone "${definition.name}" dependencies must precede it`,
      )
    }

    const boneIndex = physicalBoneCount + virtualBoneOrder
    boneNames[boneIndex] = definition.name
    parentIndices[boneIndex] = sourceBoneIndex
    inverseSource.copy(sourceComponent).invert()
    relative.multiplyMatrices(inverseSource, targetComponent)
    relative.decompose(position, rotation, scale)
    position.toArray(referencePositions, boneIndex * 3)
    rotation.toArray(referenceRotations, boneIndex * 4)
    scale.toArray(referenceScales, boneIndex * 3)
    names.add(definition.name)
    componentTransforms.set(definition.name, targetComponent.clone())
    virtualBones.push({
      ...definition,
      boneIndex,
      sourceBoneIndex,
      targetBoneIndex,
    })
  }

  return {
    boneCount,
    physicalBoneCount,
    boneNames,
    parentIndices,
    referencePositions,
    referenceRotations,
    referenceScales,
    virtualBones,
  }
}

export function findBoneIndex(rig: RigDefinition, name: string): number {
  return rig.boneNames.indexOf(name)
}
