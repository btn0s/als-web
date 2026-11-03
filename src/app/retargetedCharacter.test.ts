/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { SkinnedMesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createRetargetedCharacter } from './retargetedCharacter'

it('owns independent target skeletons and restores only its source on disposal', async () => {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const asset = (await new GLTFLoader().parseAsync(bytes.buffer.slice(
    bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  const mesh = (scene: Object3D) => {
    let result: SkinnedMesh | undefined
    scene.traverse(node => { if (node instanceof SkinnedMesh) result = node })
    if (!result) throw new Error('Fixture requires a skinned mesh')
    return result
  }
  const firstSource = clone(asset), secondSource = clone(asset)
  const first = createRetargetedCharacter({ source: firstSource, reference: asset, target: asset, meshLayers: 2 })
  const second = createRetargetedCharacter({ source: secondSource, reference: asset, target: asset })
  const firstMesh = mesh(first.target), secondMesh = mesh(second.target)
  const disposeSkeleton = vi.spyOn(firstMesh.skeleton, 'dispose')
  const disposeGeometry = vi.spyOn(firstMesh.geometry, 'dispose')
  expect(firstMesh.skeleton).not.toBe(secondMesh.skeleton)
  expect(firstMesh.geometry).toBe(mesh(asset).geometry)
  expect(firstMesh.layers.mask).toBe(2)
  expect(mesh(asset).visible).toBe(true)
  expect(mesh(firstSource).visible).toBe(false)
  first.update()
  first.dispose()
  expect(disposeSkeleton).toHaveBeenCalledOnce()
  expect(disposeGeometry).not.toHaveBeenCalled()
  expect(mesh(firstSource).visible).toBe(true)
  expect(mesh(secondSource).visible).toBe(false)
  second.update()
  second.dispose()
  expect(mesh(secondSource).visible).toBe(true)
  vi.restoreAllMocks()
})
