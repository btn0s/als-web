/// <reference types="node" />
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { compileClipSampler } from './clipSampler'
import { compileClipCurveSamplers } from './curves'
import { createRigDefinition } from './rig'
import { copyPose } from './poseBuffer'
import { createMutableUePoseNode, sampleSequencePoseNode } from './uePoseGraph'
import { blendPoseNodesTogether, blendTwoPoseNodesTogether } from './uePoseBlend'
import { applyAdditivePose, applyMeshSpaceAdditivePose, createMeshSpaceBlendScratch, makeDynamicAdditivePose } from './blend'
import { createAlsPistolRuntime, evaluateAlsPistolGraph, refreshAlsPistolRuntime, type AlsPistolFullInput } from '../als/AnimGraph/AB_Als_PistolTwoHanded'
import { createAlsPistolOneHandedRuntime } from '../als/AnimGraph/AB_Als_PistolOneHanded'
import { ALS_VIRTUAL_BONES } from '../als/Utility/AlsVirtualBones'
import { createAlsAnimationInstance } from '../als/AlsAnimationInstance'
import { ALS_OVERLAY_MODES } from '../als/AnimGraph/overlayMode'

interface Node {
  compiledIndex: number
  type: string
  parameters: {
    Result?: { LinkID: number }; SourcePose?: { LinkID: number }
    A?: { LinkID: number }; B?: { LinkID: number }
    Base?: { LinkID: number }; Additive?: { LinkID: number }
    Poses?: { LinkID: number }[]
    Sequence?: { ObjectName: string }; ExplicitTime?: number; Alpha?: number
    CurveNames?: string[]; CurveValues?: number[]
  }
}
const graph = JSON.parse(readFileSync(new URL('../../scripts/extract-als/abp-graph.json', import.meta.url), 'utf8')) as {
  assets: Record<string, { nodes: Node[]; stateMachines: { States: { StateName: string; StateRootNodeCompiledIndex: number }[]; Transitions: unknown[] }[] }>
}
const content = JSON.parse(readFileSync(new URL('../../scripts/extract-als/pistol-content.json', import.meta.url), 'utf8')) as {
  assets: Record<string, { source: { binaryEqualityVerified: boolean }; functions: Record<string, unknown>; bindings: { node: string; bindings: Record<string, string[]> }[] }>
}
const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
const load = () => new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
  new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject)
})
let gltf: Awaited<ReturnType<typeof load>>
beforeAll(async () => { gltf = await load() })

describe.each(['PistolTwoHanded', 'PistolOneHanded'] as const)('%s shipped content oracle', (mode) => {
  it('ships all four clips, including the actual mesh-additive reference bank', () => {
    for (const suffix of ['Poses', 'Poses_NoCurves', 'Aim', 'Aim_Crouch']) {
      const clip = gltf.animations.find((clip) => clip.name === `A_Als_${mode}_${suffix}`)
      expect(clip?.tracks.length).toBe(136)
      if (suffix.startsWith('Aim')) {
        expect(clip?.userData).toMatchObject({
          additiveType: 'AAT_RotationOffsetMeshSpace', refPoseSeq: `A_Als_${mode}_Poses_NoCurves`,
          refFrameIndex: (mode === 'PistolTwoHanded' ? 6 : 5) + (suffix === 'Aim_Crouch' ? 4 : 0),
        })
      }
    }
    expect(ALS_OVERLAY_MODES).toContain(mode)
    expect(content.assets[`AB_Als_${mode}`].source.binaryEqualityVerified).toBe(true)
    const bindings = content.assets[`AB_Als_${mode}`].bindings
    for (const state of ['Ready', 'Aiming']) {
      expect(bindings.find((entry) => entry.node.includes(`.${state}.AnimGraphNode_TwoWayBlend`))?.bindings.Alpha)
        .toEqual(['GetParent', 'PoseState', 'GaitWalkingAmount'])
    }
    expect(graph.assets[`AB_Als_${mode}`].stateMachines[0].Transitions)
      .toEqual(graph.assets.AB_Als_Rifle.stateMachines[0].Transitions)
  })

  it('pins compiled Ready predicates and transition notify calls independently of runtime constants', () => {
    const functions = content.assets[`AB_Als_${mode}`].functions
    const calls: { StackNode: string; Parameters: { Value?: unknown }[] }[] = []
    const collect = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(collect); return }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.StackNode === 'string' && Array.isArray(record.Parameters)) {
        calls.push(record as unknown as typeof calls[number])
      }
      Object.values(record).forEach(collect)
    }
    collect(functions)
    expect(calls.filter((call) => call.StackNode === 'GreaterEqual_DoubleDouble')
      .map((call) => call.Parameters[1].Value)).toEqual([3, 3])
    const notifies = calls.filter((call) => call.StackNode === 'PlayTransitionRightAnimation')
    expect(notifies).toHaveLength(2)
    expect(notifies.map((call) => call.Parameters[2].Value)).toEqual([1.5, 1.75])
    for (const call of notifies) {
      expect(call.Parameters[0].Value).toBeCloseTo(0.2)
      expect(call.Parameters[1].Value).toBeCloseTo(0.2)
      expect(call.Parameters[3].Value).toBeCloseTo(0.3)
      expect(call.Parameters[4]).toMatchObject({ $type: 'EX_True' })
    }
  })

  it('matches recursively evaluated serialized node wiring before Layering, including curves and virtual bones', () => {
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    const source = (name: string) => {
      const clip = gltf.animations.find((clip) => clip.name === name)
      if (!clip) throw new Error(`Missing ${name}`)
      return { sampler: compileClipSampler(clip, rig), curves: compileClipCurveSamplers(clip) }
    }
    const sources = {
      poses: source(`A_Als_${mode}_Poses`), aim: source(`A_Als_${mode}_Aim`),
      aimCrouch: source(`A_Als_${mode}_Aim_Crouch`), aimReference: source(`A_Als_${mode}_Poses_NoCurves`),
      idle: { ...source('A_Als_Idle'), time: 0.63, loop: true }, idleReference: source('A_Als_Stand_Pose'),
    }
    const asset = graph.assets[`AB_Als_${mode}`]
    const runtime = mode === 'PistolTwoHanded' ? createAlsPistolRuntime(rig) : createAlsPistolOneHandedRuntime(rig)
    const scratch = createMeshSpaceBlendScratch(rig.boneCount)
    const input: AlsPistolFullInput = {
      relevant: true, deltaTime: 0, rotationMode: 'ViewDirection', locomotionMode: 'Grounded', gait: 'Walking',
      transitionsAllowed: true, moving: false, pitchAmount: 0.2, standingAmount: 1,
      crouchingAmount: 0, gaitWalkingAmount: 0, gaitSprintingAmount: 0,
    }
    function oracle(index: number): ReturnType<typeof createMutableUePoseNode> {
      const node = asset.nodes.find((node) => node.compiledIndex === index)!
      const p = node.parameters
      const out = createMutableUePoseNode(rig.boneCount)
      if (p.Result) return oracle(p.Result.LinkID)
      if (p.Sequence) {
        const name = p.Sequence.ObjectName.split("'")[1]
        const time = name === 'A_Als_Idle' ? sources.idle.time : name.includes('_Aim') ? input.pitchAmount : p.ExplicitTime!
        sampleSequencePoseNode(rig, source(name), time, name === 'A_Als_Idle', out)
        return out
      }
      if (p.A && p.B) {
        // Bindings from the independent editor export. Only the nested TH sprint
        // blend differs from Walking; there are no alpha filters on these nodes.
        const alpha = mode === 'PistolTwoHanded' && index === 31 ? input.gaitSprintingAmount : input.gaitWalkingAmount
        return blendTwoPoseNodesTogether(oracle(p.A.LinkID), oracle(p.B.LinkID), 1 - alpha, out)
      }
      if (p.Poses) {
        const weights = [input.standingAmount, input.crouchingAmount]
        const sum = weights[0] + weights[1]
        return blendPoseNodesTogether(p.Poses.map((pose) => oracle(pose.LinkID)), weights.map((w) => w / sum), out)
      }
      if (p.Base && p.Additive) {
        const base = oracle(p.Base.LinkID)
        const additiveNode = asset.nodes.find((node) => node.compiledIndex === p.Additive!.LinkID)!
        const additive = oracle(p.Additive.LinkID)
        const clip = source(additiveNode.parameters.Sequence!.ObjectName.split("'")[1]).sampler.clip
        const reference = createMutableUePoseNode(rig.boneCount)
        if (typeof clip.userData.refPoseSeq !== 'string' || typeof clip.userData.refFrameIndex !== 'number') throw new Error('Missing additive metadata')
        sampleSequencePoseNode(rig, source(clip.userData.refPoseSeq), clip.userData.refFrameIndex / 30, false, reference)
        const delta = createMutableUePoseNode(rig.boneCount)
        const mesh = node.type === 'FAnimNode_ApplyMeshSpaceAdditive'
        makeDynamicAdditivePose(additive.pose, reference.pose, rig, delta.pose, mesh ? 'mesh' : 'local', scratch)
        copyPose(base.pose, out.pose)
        for (const [name, value] of base.curves) out.curves.set(name, value)
        if (mesh) applyMeshSpaceAdditivePose(out.pose, delta.pose, rig, p.Alpha!, scratch)
        else applyAdditivePose(out.pose, delta.pose, p.Alpha!)
        return out
      }
      if (p.SourcePose) {
        const result = oracle(p.SourcePose.LinkID)
        p.CurveNames!.forEach((name, i) => result.curves.set(name, p.CurveValues![i]))
        return result
      }
      throw new Error(`Unsupported oracle node ${index}: ${node.type}`)
    }
    for (const stance of [[1, 0], [0, 1], [0.7, 0.3]]) {
      for (const gait of [0, 0.4, 1]) {
        for (const pitch of [0, 0.5, 1]) {
          Object.assign(input, { standingAmount: stance[0], crouchingAmount: stance[1], gaitWalkingAmount: gait, gaitSprintingAmount: gait, pitchAmount: pitch })
          refreshAlsPistolRuntime(runtime, input)
          evaluateAlsPistolGraph(runtime, input, sources)
          for (const state of asset.stateMachines[0].States) {
            const expected = oracle(state.StateRootNodeCompiledIndex)
            const actual = runtime.statePoses[state.StateName as keyof typeof runtime.statePoses]
            for (const channel of ['positions', 'rotations', 'scales'] as const) {
              expect(Math.max(...actual.pose[channel].map((v, i) => Math.abs(v - expected.pose[channel][i]))), `${state.StateName}.${channel}`).toBeLessThan(2e-6)
            }
            for (const [name, value] of expected.curves) expect(actual.curves.get(name), name).toBeCloseTo(value, 6)
          }
        }
      }
    }
  })

  it('runs through the live animation instance and switches back to Default', async () => {
    vi.stubGlobal('window', {})
    try {
      const model = await load()
      const instance = createAlsAnimationInstance(model)
      const controls = {
        gait: 'Walking' as const, moving: false, movingSmooth: false, stance: 'Standing' as const,
        rotationMode: 'Aiming' as const, overlayMode: mode, speed: 0, direction: 0,
        relativeAccelerationAmount: { x: 0, y: 0 }, rotateInPlace: false, viewYawAngle: 0, viewYawSpeed: 0,
      }
      for (let i = 0; i < 40; i++) instance.refresh(1 / 60, controls)
      const hand = model.scene.getObjectByName('hand_r')!
      const pistol = hand.quaternion.clone()
      for (let i = 0; i < 40; i++) instance.refresh(1 / 60, { ...controls, overlayMode: 'Default' })
      expect(pistol.angleTo(hand.quaternion)).toBeGreaterThan(0.01)
    } finally { vi.unstubAllGlobals() }
  })
})
