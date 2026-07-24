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

  it('normalizes Unreal WeightFactor incoming and inverse outgoing weights', () => {
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

    expect(incoming[0]).toBeCloseTo(0.25, 7)
    expect(outgoing[0]).toBeCloseTo(0.75, 7)
    expect(incoming[1]).toBeCloseTo(4 / 7, 7)
    expect(outgoing[1]).toBeCloseTo(3 / 7, 7)
    expect(incoming[2]).toBeCloseTo(25 / 28, 7)
    expect(outgoing[2]).toBeCloseTo(3 / 28, 7)
    for (let bone = 0; bone < 3; bone++) {
      expect(outgoing[bone] + incoming[bone]).toBeCloseTo(1, 7)
    }
  })

  it('retains Unreal non-zero weights at both transition boundaries', () => {
    const profile = compileWeightBlendProfile(createTestRig(), {
      mode: 'WeightFactor',
      entries: [
        { bone: 'thigh_l', blendScale: 2 },
        { bone: 'foot_l', blendScale: 0 },
      ],
    })
    const outgoing = new Float32Array(3)
    const incoming = new Float32Array(3)

    resolveWeightBlendProfileMasks(profile, 0, outgoing, incoming)
    expect(incoming[0]).toBe(0)
    expect(incoming[1]).toBeGreaterThan(incoming[0])
    expect(incoming[2]).toBeGreaterThan(0)
    expect(outgoing[2]).toBeGreaterThan(0.999)

    resolveWeightBlendProfileMasks(profile, 1, outgoing, incoming)
    expect(outgoing[0]).toBe(0)
    expect(outgoing[1]).toBeGreaterThan(0)
    expect(outgoing[2]).toBeGreaterThan(0.999)
    expect(incoming[2]).toBeGreaterThan(0)
  })

  it('rejects missing bones instead of silently weakening parity', () => {
    expect(() => compileWeightBlendProfile(createTestRig(), {
      mode: 'WeightFactor',
      entries: [{ bone: 'calf_l', blendScale: 2 }],
    })).toThrow('missing bone "calf_l"')
  })
})
