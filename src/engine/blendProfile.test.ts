import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  compileWeightBlendProfile,
  resolveWeightBlendProfileMasks,
} from './blendProfile'
import { createRigDefinition } from './rig'

function createTestRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const thigh = new THREE.Bone()
  thigh.name = 'thigh_l'
  const foot = new THREE.Bone()
  foot.name = 'foot_l'
  root.add(thigh)
  thigh.add(foot)
  return createRigDefinition(root)
}

describe('WeightFactor blend profiles', () => {
  it('keeps unlisted bones at one and compiles exact authored scales', () => {
    const profile = compileWeightBlendProfile(createTestRig(), {
      mode: 'WeightFactor',
      entries: [
        { bone: 'thigh_l', blendScale: 2 },
        { bone: 'foot_l', blendScale: 5 },
      ],
    })

    expect([...profile.blendScales]).toEqual([1, 2, 5])
  })

  it('multiplies transition alpha and returns complementary masks', () => {
    const profile = compileWeightBlendProfile(createTestRig(), {
      mode: 'WeightFactor',
      entries: [
        { bone: 'thigh_l', blendScale: 2 },
        { bone: 'foot_l', blendScale: 5 },
      ],
    })
    const outgoing = new Float32Array(3)
    const incoming = new Float32Array(3)

    resolveWeightBlendProfileMasks(profile, 0.25, outgoing, incoming)

    expect([...incoming]).toEqual([0.25, 0.5, 1])
    expect([...outgoing]).toEqual([0.75, 0.5, 0])
    for (let bone = 0; bone < 3; bone++) {
      expect(outgoing[bone] + incoming[bone]).toBe(1)
    }
  })

  it('rejects missing bones instead of silently weakening parity', () => {
    expect(() => compileWeightBlendProfile(createTestRig(), {
      mode: 'WeightFactor',
      entries: [{ bone: 'calf_l', blendScale: 2 }],
    })).toThrow('missing bone "calf_l"')
  })
})
