/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileAuthoredAdditive } from './authoredAdditive'

const TRANSITION_CLIPS = [
  'A_Als_Stand_Transition_Left',
  'A_Als_Stand_Transition_Right',
  'A_Als_Crouch_Transition_Left',
  'A_Als_Crouch_Transition_Right',
  'A_Als_Stand_DynamicTransition_Left',
  'A_Als_Stand_DynamicTransition_Right',
  'A_Als_Crouch_DynamicTransition_Left',
  'A_Als_Crouch_DynamicTransition_Right',
] as const

let animations: THREE.AnimationClip[]

function loadAlsAnimations() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    new GLTFLoader().parse(
      data,
      '',
      (gltf) => resolve(gltf.animations),
      reject,
    )
  })
}

describe('authored additive metadata', () => {
  beforeAll(async () => {
    animations = await loadAlsAnimations()
  })

  it.each(TRANSITION_CLIPS)(
    'VERIFIED — compiles %s from the GLB animation extras',
    (name) => {
      const animation = animations.find((clip) => clip.name === name)
      if (!animation) throw new Error(`Missing additive oracle clip "${name}"`)

      expect(compileAuthoredAdditive(animation)).toEqual({
        clipName: name,
        additiveType: 'AAT_RotationOffsetMeshSpace',
        additiveSpace: 'mesh',
        refPoseSeq: 'A_Als_Stand_Pose',
        refFrameIndex: 0,
      })
    },
  )

  it('maps Unreal local- and mesh-space types without renaming their source metadata', () => {
    expect(compileAuthoredAdditive({
      name: 'local',
      userData: {
        additiveType: 'AAT_LocalSpaceBase',
        refPoseSeq: 'A_Als_Stand_Pose',
        refFrameIndex: 2,
      },
    })).toEqual({
      clipName: 'local',
      additiveType: 'AAT_LocalSpaceBase',
      additiveSpace: 'local',
      refPoseSeq: 'A_Als_Stand_Pose',
      refFrameIndex: 2,
    })
    expect(compileAuthoredAdditive({
      name: 'mesh',
      userData: {
        additiveType: 'AAT_RotationOffsetMeshSpace',
        refPoseSeq: 'A_Als_Stand_Pose',
        refFrameIndex: 0,
      },
    })).toEqual({
      clipName: 'mesh',
      additiveType: 'AAT_RotationOffsetMeshSpace',
      additiveSpace: 'mesh',
      refPoseSeq: 'A_Als_Stand_Pose',
      refFrameIndex: 0,
    })
  })

  it('leaves non-additive clips unresolved and does not eagerly resolve reference sequences', () => {
    expect(compileAuthoredAdditive({ name: 'plain' })).toBeUndefined()
    expect(compileAuthoredAdditive({
      name: 'explicit-none',
      userData: {
        additiveType: 'AAT_None',
        refPoseSeq: '',
        refFrameIndex: 0,
      },
    })).toBeUndefined()
    expect(compileAuthoredAdditive({
      name: 'deferred-reference',
      userData: {
        additiveType: 'AAT_LocalSpaceBase',
        refPoseSeq: 'Reference_Not_In_The_Runtime_Pack',
        refFrameIndex: 0,
      },
    })?.refPoseSeq).toBe('Reference_Not_In_The_Runtime_Pack')
  })

  it.each([
    {
      name: 'partial',
      userData: { refPoseSeq: 'reference', refFrameIndex: 0 },
    },
    {
      name: 'unknown-type',
      userData: {
        additiveType: 'AAT_Unknown',
        refPoseSeq: 'reference',
        refFrameIndex: 0,
      },
    },
    {
      name: 'missing-reference',
      userData: {
        additiveType: 'AAT_LocalSpaceBase',
        refFrameIndex: 0,
      },
    },
    {
      name: 'empty-reference',
      userData: {
        additiveType: 'AAT_LocalSpaceBase',
        refPoseSeq: '',
        refFrameIndex: 0,
      },
    },
    {
      name: 'fractional-frame',
      userData: {
        additiveType: 'AAT_RotationOffsetMeshSpace',
        refPoseSeq: 'reference',
        refFrameIndex: 0.5,
      },
    },
    {
      name: 'negative-frame',
      userData: {
        additiveType: 'AAT_RotationOffsetMeshSpace',
        refPoseSeq: 'reference',
        refFrameIndex: -1,
      },
    },
  ])('rejects malformed metadata for $name', (clip) => {
    expect(() => compileAuthoredAdditive(clip)).toThrow()
  })
})
