/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  compileClipSampler,
  sampleClip,
} from '../../engine/clipSampler'
import { createPoseBuffer } from '../../engine/poseBuffer'
import {
  createRigDefinition,
  findBoneIndex,
} from '../../engine/rig'

const ALS_STEP_INTERPOLATION_SEQUENCES = new Set([
  'A_Als_Default_Poses',
  'A_Als_Barrel_Poses',
  'A_Als_Box_Poses',
  'A_Als_Feminine_Poses',
  'A_Als_HandsTied_Poses',
  'A_Als_Injured_Poses',
  'A_Als_Masculine_Poses',
  'A_Als_Binoculars_Poses',
  'A_Als_Bow_Poses',
  'A_Als_PistolOneHanded_Poses',
  'A_Als_PistolTwoHanded_Poses',
  'A_Als_Rifle_Poses',
  'A_Als_Torch_Poses',
])

interface LoadedAlsGltf {
  readonly animations: THREE.AnimationClip[]
  readonly scene: THREE.Group
}

function loadAlsGltf() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new Promise<LoadedAlsGltf>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject)
  })
}

describe('ALS UAnimSequence interpolation equivalence', () => {
  let gltf: LoadedAlsGltf

  beforeAll(async () => {
    gltf = await loadAlsGltf()
  })

  it('keeps the exact 13 authored pose banks discrete and every other sequence linear', () => {
    const stepSequences = gltf.animations.filter(
      ({ userData }) => userData.interpolation === 'Step',
    )
    expect(new Set(stepSequences.map(({ name }) => name)))
      .toEqual(ALS_STEP_INTERPOLATION_SEQUENCES)

    for (const clip of gltf.animations) {
      const expectedInterpolation =
        ALS_STEP_INTERPOLATION_SEQUENCES.has(clip.name)
          ? THREE.InterpolateDiscrete
          : THREE.InterpolateLinear
      expect(clip.userData.interpolation).toBe(
        expectedInterpolation === THREE.InterpolateDiscrete
          ? 'Step'
          : 'Linear',
      )
      expect(new Set(
        clip.tracks.map((track) => track.getInterpolation()),
      )).toEqual(new Set([expectedInterpolation]))
    }
  })

  it('holds the authored Default pose-bank key across explicit time 0.05', () => {
    const rig = createRigDefinition(gltf.scene)
    const clip = gltf.animations.find(
      ({ name }) => name === 'A_Als_Default_Poses',
    )
    if (!clip) throw new Error('Missing A_Als_Default_Poses')
    const sampler = compileClipSampler(clip, rig)
    const preceding = createPoseBuffer(rig.boneCount)
    const explicit = createPoseBuffer(rig.boneCount)
    const following = createPoseBuffer(rig.boneCount)
    sampleClip(sampler, rig, 0.04, preceding, false)
    sampleClip(sampler, rig, 0.05, explicit, false)
    sampleClip(sampler, rig, 0.07, following, false)

    const pelvisOffset = findBoneIndex(rig, 'pelvis') * 3
    const distance = (
      left: Float32Array,
      right: Float32Array,
    ) => Math.hypot(
      left[pelvisOffset] - right[pelvisOffset],
      left[pelvisOffset + 1] - right[pelvisOffset + 1],
      left[pelvisOffset + 2] - right[pelvisOffset + 2],
    )

    expect(distance(preceding.positions, explicit.positions)).toBe(0)
    expect(distance(explicit.positions, following.positions))
      .toBeGreaterThan(0.5)
  })
})
