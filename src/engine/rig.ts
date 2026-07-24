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
  return createRigDefinitionFromBones(
    skeletonRoot,
    bones,
    virtualBoneDefinitions,
  )
}

function createRigDefinitionFromBones(
  skeletonRoot: THREE.Object3D,
  bones: readonly THREE.Bone[],
  virtualBoneDefinitions: readonly VirtualBoneDefinition[],
): RigDefinition {
  const physicalBoneCount = bones.length
  const boneCount = physicalBoneCount + virtualBoneDefinitions.length
  const boneNames = new Array<string>(boneCount)
  const parentIndices = new Int16Array(boneCount)
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  const indices = new Map<THREE.Object3D, number>()
  const names = new Set<string>()

  for (let i = 0; i < physicalBoneCount; i++) {
    const name = bones[i].name
    if (names.has(name)) throw new Error(`Rig contains duplicate bone name "${name}"`)
    names.add(name)
    indices.set(bones[i], i)
  }

  for (let i = 0; i < physicalBoneCount; i++) {
    const bone = bones[i]
    boneNames[i] = bone.name

    let parent = bone.parent
    while (parent && !indices.has(parent)) parent = parent.parent
    parentIndices[i] = parent ? (indices.get(parent) ?? -1) : -1

    const p = i * 3
    const q = i * 4
    referencePositions[p] = bone.position.x
    referencePositions[p + 1] = bone.position.y
    referencePositions[p + 2] = bone.position.z
    referenceRotations[q] = bone.quaternion.x
    referenceRotations[q + 1] = bone.quaternion.y
    referenceRotations[q + 2] = bone.quaternion.z
    referenceRotations[q + 3] = bone.quaternion.w
    referenceScales[p] = bone.scale.x
    referenceScales[p + 1] = bone.scale.y
    referenceScales[p + 2] = bone.scale.z
  }

  skeletonRoot.updateWorldMatrix(true, true)
  const componentTransforms = new Map<string, THREE.Matrix4>()
  for (const bone of bones) {
    componentTransforms.set(bone.name, bone.matrixWorld.clone())
  }
  const virtualBones: CompiledVirtualBoneDefinition[] = []
  const inverseSource = new THREE.Matrix4()
  const relative = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()

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
