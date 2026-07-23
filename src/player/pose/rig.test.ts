import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRigDefinition, findBoneIndex } from './rig'

describe('createRigDefinition', () => {
  it('captures bone order, nearest bone parents, and reference local transforms', () => {
    const scene = new THREE.Group()
    const root = new THREE.Bone()
    root.name = 'root'
    root.position.set(1, 2, 3)
    const spacer = new THREE.Group()
    const child = new THREE.Bone()
    child.name = 'child'
    child.scale.set(2, 3, 4)
    scene.add(root)
    root.add(spacer)
    spacer.add(child)

    const rig = createRigDefinition(scene)

    expect(rig.boneNames).toEqual(['root', 'child'])
    expect([...rig.parentIndices]).toEqual([-1, 0])
    expect([...rig.referencePositions.slice(0, 3)]).toEqual([1, 2, 3])
    expect([...rig.referenceScales.slice(3, 6)]).toEqual([2, 3, 4])
    expect(findBoneIndex(rig, 'child')).toBe(1)
  })
})
