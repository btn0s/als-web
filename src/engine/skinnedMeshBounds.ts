import * as THREE from 'three'

export interface SkinnedMeshWorldBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
  readonly centroid: readonly [number, number, number]
  readonly vertexCount: number
  readonly minimumYByBone: Readonly<Record<string, number>>
}

function tuple3(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}

/**
 * Evaluates deformed vertices instead of trusting bind-pose or conservative
 * geometry bounds. This deliberately expensive path only runs during an
 * explicit diagnostic capture.
 */
export function captureSkinnedMeshWorldBounds(
  root: THREE.Object3D,
  tracedBones: ReadonlySet<string> = new Set(),
  includedMeshes: ReadonlySet<THREE.SkinnedMesh> | null = null,
  visitWorldVertex?: (vertex: THREE.Vector3) => void,
): SkinnedMeshWorldBounds | null {
  const min = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  )
  const max = new THREE.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  )
  const centroid = new THREE.Vector3()
  let vertexCount = 0
  const minimumYByBone: Record<string, number> = {}
  const vertex = new THREE.Vector3()

  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    if (
      !(object instanceof THREE.SkinnedMesh)
      || (includedMeshes && !includedMeshes.has(object))
    ) return
    const positions = object.geometry.getAttribute('position')
    const skinIndices = object.geometry.getAttribute('skinIndex')
    if (!positions || !skinIndices) {
      throw new Error(
        `Skinned-mesh bounds require position and skinIndex on "${object.name}"`,
      )
    }

    object.skeleton.update()
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex++) {
      vertex.fromBufferAttribute(positions, vertexIndex)
      object.applyBoneTransform(vertexIndex, vertex)
      vertex.applyMatrix4(object.matrixWorld)
      min.min(vertex)
      max.max(vertex)
      centroid.add(vertex)
      vertexCount++
      visitWorldVertex?.(vertex)

      const bone = object.skeleton.bones[skinIndices.getX(vertexIndex)]
      if (!bone || !tracedBones.has(bone.name)) continue
      minimumYByBone[bone.name] = Math.min(
        minimumYByBone[bone.name] ?? Number.POSITIVE_INFINITY,
        vertex.y,
      )
    }
  })

  if (!Number.isFinite(min.x)) return null
  return {
    min: tuple3(min),
    max: tuple3(max),
    centroid: tuple3(centroid.multiplyScalar(1 / vertexCount)),
    vertexCount,
    minimumYByBone,
  }
}
