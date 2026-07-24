import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileBranchFilterMask } from './branchFilter'
import { createRigDefinition } from './rig'

function chain(...names: string[]) {
  const root = new THREE.Bone()
  root.name = names[0]
  let parent = root
  for (const name of names.slice(1)) {
    const bone = new THREE.Bone()
    bone.name = name
    parent.add(bone)
    parent = bone
  }
  return root
}

describe('Unreal branch-filter masks', () => {
  it('ramps positive BlendDepth from the branch root and holds at one', () => {
    const rig = createRigDefinition(chain('root', 'spine_01', 'spine_02', 'spine_03', 'neck'))
    const mask = compileBranchFilterMask(rig, [{
      boneName: 'spine_01',
      blendDepth: 3,
    }])

    expect(mask[0]).toBe(0)
    expect(mask[1]).toBeCloseTo(1 / 3)
    expect(mask[2]).toBeCloseTo(2 / 3)
    expect(mask[3]).toBe(1)
    expect(mask[4]).toBe(1)
  })

  it('applies negative filters in order to carve child branches out of a parent', () => {
    const pelvis = new THREE.Bone()
    pelvis.name = 'pelvis'
    const spine = new THREE.Bone()
    spine.name = 'spine'
    const thigh = new THREE.Bone()
    thigh.name = 'thigh'
    const calf = new THREE.Bone()
    calf.name = 'calf'
    pelvis.add(spine, thigh)
    thigh.add(calf)
    const rig = createRigDefinition(pelvis)

    const mask = compileBranchFilterMask(rig, [
      { boneName: 'pelvis', blendDepth: 0 },
      { boneName: 'thigh', blendDepth: -1 },
    ])

    expect([...mask]).toEqual([1, 1, 0, 0])
  })

  it('rejects malformed output and depth without failing on absent virtual bones', () => {
    const rig = createRigDefinition(chain('root', 'child'))
    expect(compileBranchFilterMask(rig, [{
      boneName: 'VB hand_l_to_ik_hand_gun',
      blendDepth: 0,
    }])).toEqual(new Float32Array(2))
    expect(() => compileBranchFilterMask(
      rig,
      [],
      new Float32Array(1),
    )).toThrow(/bone count/)
    expect(() => compileBranchFilterMask(rig, [{
      boneName: 'root',
      blendDepth: 0.5,
    }])).toThrow(/integer/)
  })
})
