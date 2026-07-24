/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { RIFLE_OVERLAY_CLIPS } from '../als/AnimGraph/overlayMode'
import { compileClipSampler, sampleClip } from './clipSampler'
import { createPoseBuffer } from './poseBuffer'
import { createRigDefinition } from './rig'

interface AbpSequenceReference {
  readonly ObjectName: string
}

interface AbpPoseLink {
  readonly LinkID: number
  readonly SourceLinkID: number
}

interface AbpNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: {
    readonly A?: AbpPoseLink
    readonly B?: AbpPoseLink
    readonly Additive?: AbpPoseLink
    readonly Base?: AbpPoseLink
    readonly Result?: AbpPoseLink
    readonly Poses?: readonly AbpPoseLink[]
    readonly Alpha?: number
    readonly bNormalizeAlpha?: boolean
    readonly bResetChildOnActivation?: boolean
    readonly Sequence?: AbpSequenceReference
    readonly ExplicitTime?: number
    readonly bTeleportToExplicitTime?: boolean
    readonly ReinitializationBehavior?: string
    readonly GroupName?: string
    readonly GroupRole?: string
    readonly Method?: string
    readonly PlayRate?: number
    readonly AlphaScaleBiasClamp?: {
      readonly bMapRange: boolean
      readonly InRange: { readonly Min: number; readonly Max: number }
      readonly OutRange: { readonly Min: number; readonly Max: number }
      readonly InterpSpeedIncreasing: number
      readonly InterpSpeedDecreasing: number
    }
  }
}

interface AbpGraph {
  readonly assets: Readonly<Record<string, {
    readonly nodes: readonly AbpNode[]
  }>>
}

const abpGraph = JSON.parse(readFileSync(
  new URL('../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

const rifleGraph = abpGraph.assets.AB_Als_Rifle
if (!rifleGraph) throw new Error('Missing AB_Als_Rifle content oracle')

let gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Group
}

function loadAlsGltf() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise<typeof gltf>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject)
  })
}

function node(index: number) {
  const found = rifleGraph.nodes.find((candidate) => candidate.compiledIndex === index)
  if (!found) throw new Error(`Missing AB_Als_Rifle compiled node ${index}`)
  return found
}

function animationName(index: number) {
  const objectName = node(index).parameters.Sequence?.ObjectName
  const match = objectName && /^AnimSequence'([^']+)'$/.exec(objectName)
  if (!match) throw new Error(`AB_Als_Rifle node ${index} has no animation sequence`)
  return match[1]
}

function clip(name: string) {
  const found = gltf.animations.find((animation) => animation.name === name)
  if (!found) throw new Error(`Missing ALS regression clip "${name}"`)
  return found
}

beforeAll(async () => {
  gltf = await loadAlsGltf()
})

describe('AB_Als_Rifle evaluator content oracle', () => {
  it('pins the exact Relaxed node topology instead of flattening it into region weights', () => {
    expect(node(48)).toMatchObject({
      type: 'FAnimNode_StateResult',
      parameters: { Result: { LinkID: 34 } },
    })
    expect(node(34)).toMatchObject({
      type: 'FAnimNode_ApplyAdditive',
      parameters: {
        Base: { LinkID: 32 },
        Additive: { LinkID: 33 },
        Alpha: 0.75,
      },
    })
    expect(node(32).parameters).toMatchObject({
      A: { LinkID: 27 },
      B: { LinkID: 30 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 10,
      },
    })
    expect(node(27).parameters).toMatchObject({
      Poses: [{ LinkID: 47 }, { LinkID: 44 }],
      bNormalizeAlpha: true,
    })
    expect(node(47).parameters).toMatchObject({
      A: { LinkID: 46 },
      B: { LinkID: 43 },
    })
    expect(node(43).parameters).toMatchObject({
      A: { LinkID: 45 },
      B: { LinkID: 40 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 5,
      },
    })
    expect(node(40).parameters).toMatchObject({
      A: { LinkID: 28 },
      B: { LinkID: 41 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 5,
      },
    })
    expect(node(41).parameters).toMatchObject({
      A: { LinkID: 38 },
      B: { LinkID: 37 },
      bResetChildOnActivation: true,
      AlphaScaleBiasClamp: {
        bMapRange: true,
        InRange: { Min: 0, Max: 0.25 },
        OutRange: { Min: 0, Max: 1 },
        InterpSpeedIncreasing: 20,
        InterpSpeedDecreasing: 0.5,
      },
    })
    expect(node(28).parameters).toMatchObject({
      Poses: [
        { LinkID: 39 },
        { LinkID: 42 },
        { LinkID: 36 },
        { LinkID: 35 },
      ],
      bNormalizeAlpha: true,
    })
    expect(node(30).parameters).toMatchObject({
      A: { LinkID: 31 },
      B: { LinkID: 29 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 20,
        InterpSpeedDecreasing: 5,
      },
    })
  })

  it('pins every Relaxed evaluator/player asset and authored evaluator time', () => {
    expect([
      [46, animationName(46), node(46).parameters.ExplicitTime],
      [45, animationName(45), node(45).parameters.ExplicitTime],
      [44, animationName(44), node(44).parameters.ExplicitTime],
      [42, animationName(42), node(42).parameters.ExplicitTime],
      [36, animationName(36), node(36).parameters.ExplicitTime],
      [35, animationName(35), node(35).parameters.ExplicitTime],
      [31, animationName(31), node(31).parameters.ExplicitTime],
      [29, animationName(29), node(29).parameters.ExplicitTime],
    ]).toEqual([
      [46, RIFLE_OVERLAY_CLIPS.poses, 0],
      [45, RIFLE_OVERLAY_CLIPS.poses, 0.05],
      [44, RIFLE_OVERLAY_CLIPS.poses, 0.216667],
      [42, RIFLE_OVERLAY_CLIPS.poses, 0.05],
      [36, RIFLE_OVERLAY_CLIPS.poses, 0.05],
      [35, RIFLE_OVERLAY_CLIPS.poses, 0.05],
      [31, RIFLE_OVERLAY_CLIPS.poses, 0.316667],
      [29, RIFLE_OVERLAY_CLIPS.poses, 0.35],
    ])

    expect([
      [39, animationName(39)],
      [38, animationName(38)],
      [37, animationName(37)],
    ]).toEqual([
      [39, RIFLE_OVERLAY_CLIPS.runArms],
      [38, RIFLE_OVERLAY_CLIPS.sprintArms],
      [37, RIFLE_OVERLAY_CLIPS.sprintImpulseArms],
    ])

    for (const index of [37, 38, 39]) {
      expect(node(index).parameters).toMatchObject({
        GroupName: 'Movement',
        GroupRole: 'EAnimGroupRole::AlwaysFollower',
        Method: 'EAnimSyncMethod::SyncGroup',
        PlayRate: 0,
      })
    }
    expect(animationName(33)).toBe('A_Als_Idle')
  })

  it('compiles and samples every exact Relaxed source through the owned pose runtime', () => {
    const rig = createRigDefinition(gltf.scene)
    const sources = [
      [46, 0],
      [45, 0.05],
      [44, 0.216667],
      [42, 0.05],
      [36, 0.05],
      [35, 0.05],
      [31, 0.316667],
      [29, 0.35],
      [39, 0],
      [38, 0],
      [37, 0],
      [33, 0],
    ] as const

    for (const [index, time] of sources) {
      const sampler = compileClipSampler(clip(animationName(index)), rig)
      const pose = sampleClip(
        sampler,
        rig,
        time,
        createPoseBuffer(rig.boneCount),
        false,
      )
      expect([...pose.positions, ...pose.rotations, ...pose.scales].every(Number.isFinite))
        .toBe(true)
    }
  })
})
