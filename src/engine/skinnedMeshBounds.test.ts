import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { captureSkinnedMeshWorldBounds } from './skinnedMeshBounds'

function createSkinnedLine() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([
      0, 0, 0,
      0, 1, 0,
    ], 3),
  )
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], 4),
  )
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([
      1, 0, 0, 0,
      1, 0, 0, 0,
    ], 4),
  )

  const bone = new THREE.Bone()
  bone.name = 'root'
  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = 'test-mesh'
  const scene = new THREE.Group()
  scene.position.x = 3
  scene.add(bone)
  scene.add(mesh)
  scene.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton([bone]), mesh.matrixWorld)
  return { bone, scene }
}

describe('captureSkinnedMeshWorldBounds', () => {
  it('measures current deformed world vertices and selected bone contacts', () => {
    const { bone, scene } = createSkinnedLine()
    bone.position.y = 2

    expect(
      captureSkinnedMeshWorldBounds(scene, new Set(['root'])),
    ).toEqual({
      min: [3, 2, 0],
      max: [3, 3, 0],
      centroid: [3, 2.5, 0],
      vertexCount: 2,
      minimumYByBone: { root: 2 },
    })
  })

  it('returns null when no skinned mesh exists', () => {
    expect(captureSkinnedMeshWorldBounds(new THREE.Group())).toBeNull()
  })
})
