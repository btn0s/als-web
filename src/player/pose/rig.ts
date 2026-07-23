import * as THREE from 'three'

/** Skeleton topology and reference local transforms, detached from the scene graph. */
export interface RigDefinition {
  readonly boneCount: number
  readonly boneNames: readonly string[]
  readonly parentIndices: Int16Array
  readonly referencePositions: Float32Array
  readonly referenceRotations: Float32Array
  readonly referenceScales: Float32Array
}

/**
 * Captures a stable, parent-before-child bone order. The returned definition owns no Object3D
 * references; scene-graph references belong to the pose applicator and are resolved only once.
 */
export function createRigDefinition(skeletonRoot: THREE.Object3D): RigDefinition {
  const bones: THREE.Bone[] = []
  skeletonRoot.traverse((object) => {
    if (object instanceof THREE.Bone) bones.push(object)
  })

  const boneCount = bones.length
  const boneNames = new Array<string>(boneCount)
  const parentIndices = new Int16Array(boneCount)
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  const indices = new Map<THREE.Object3D, number>()
  const names = new Set<string>()

  for (let i = 0; i < boneCount; i++) {
    const name = bones[i].name
    if (names.has(name)) throw new Error(`Rig contains duplicate bone name "${name}"`)
    names.add(name)
    indices.set(bones[i], i)
  }

  for (let i = 0; i < boneCount; i++) {
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

  return {
    boneCount,
    boneNames,
    parentIndices,
    referencePositions,
    referenceRotations,
    referenceScales,
  }
}

export function findBoneIndex(rig: RigDefinition, name: string): number {
  return rig.boneNames.indexOf(name)
}
