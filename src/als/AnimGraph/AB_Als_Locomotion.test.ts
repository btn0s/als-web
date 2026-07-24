/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { resetPoseToReference } from '../../engine/poseBuffer'
import { createRigDefinition } from '../../engine/rig'
import { createMutableUePoseNode } from '../../engine/uePoseGraph'
import type { MutableUePoseNode } from '../../engine/uePoseBlend'
import {
  AB_ALS_LOCOMOTION_GRAPH,
  ALS_AIR_LEAN_ADDITIVE_SETTINGS,
  ALS_AIR_LEAN_BLEND_SPACE,
  ALS_JUMP_POSE_GRAPH,
  ALS_JUMP_STATE_TRANSITIONS,
  ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS,
  ALS_LOCOMOTION_INTERNAL_BLEND_METADATA,
  ALS_LOCOMOTION_PLAYER_METADATA,
  ALS_LOCOMOTION_POSE_STATE_ORDER,
  ALS_LOCOMOTION_QUICK_FEET_BLEND_PROFILE,
  ALS_LOCOMOTION_STATE_TRANSITIONS,
  createAlsLocomotionPoseGraphRuntime,
  evaluateAlsLocomotionPoseGraph,
  resolveAlsLocomotionTransition,
} from './AB_Als_Locomotion'
import type {
  AlsLocomotionPoseGraphInput,
  AlsLocomotionSampledClocks,
  AlsLocomotionSampledPoses,
} from './AB_Als_Locomotion'

interface ExtractedNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface ExtractedTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly BlendMode: string
  readonly LogicType: string
  readonly BlendProfile: { readonly ObjectName: string } | null
  readonly StartNotify: number
}

interface ExtractedMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly {
    readonly StateName: string
    readonly StateRootNodeCompiledIndex: number | null
    readonly bAlwaysResetOnEntry: boolean
  }[]
  readonly Transitions: readonly ExtractedTransition[]
}

interface ExtractedGraph {
  readonly assets: {
    readonly AB_Als_Locomotion: {
      readonly compiledNodeCount: number
      readonly bakedNodeCount: number
      readonly serializedNodeCount: number
      readonly unresolvedCompiledNodeIndices: readonly number[]
      readonly nodes: readonly ExtractedNode[]
      readonly stateMachines: readonly ExtractedMachine[]
    }
  }
}

interface ExtractedBlendSpaces {
  readonly blendSpaces: {
    readonly BS_Als_Air_Lean: {
      readonly axes: readonly {
        readonly index: number
        readonly serialized: {
          readonly DisplayName: string
          readonly Min: number
          readonly Max: number
          readonly GridNum: number
        }
      }[]
      readonly samples: readonly {
        readonly animation: { readonly name: string }
        readonly sampleValue: {
          readonly X: number
          readonly Y: number
          readonly Z: number
        }
        readonly rateScale: number
      }[]
      readonly topology: {
        readonly interpolateUsingGrid: boolean
        readonly blendSpaceData: {
          readonly Triangles: readonly Record<string, unknown>[]
        }
        readonly gridSamples: readonly unknown[]
      }
    }
  }
}

interface ExtractedProfiles {
  readonly profiles: {
    readonly QuickFeetBlend: {
      readonly mode: 'WeightFactor'
      readonly entries: readonly {
        readonly bone: string
        readonly blendScale: number
      }[]
    }
  }
}

interface GlbAnimation {
  readonly name: string
  readonly extras?: {
    readonly alsCurves?: readonly { readonly name: string }[]
    readonly additiveType?: string
    readonly refPoseSeq?: string
    readonly refFrameIndex?: number
  }
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedGraph
const blendSpaces = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/blend-spaces.json', import.meta.url),
  'utf8',
)) as ExtractedBlendSpaces
const profiles = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/skeleton-profiles.json', import.meta.url),
  'utf8',
)) as ExtractedProfiles
const asset = graph.assets.AB_Als_Locomotion

function extractedNode(index: number) {
  const result = asset.nodes.find((node) => node.compiledIndex === index)
  if (!result) throw new Error(`Missing AB_Als_Locomotion node ${index}`)
  return result
}

function extractedMachine(name: string) {
  const result = asset.stateMachines.find(
    (machine) => machine.MachineName === name,
  )
  if (!result) throw new Error(`Missing state machine "${name}"`)
  return result
}

function sequenceName(index: number) {
  const parameters = extractedNode(index).parameters as {
    readonly Sequence?: { readonly ObjectName?: string }
  }
  const objectName = parameters.Sequence?.ObjectName
  const match = objectName?.match(/'([^']+)'/)
  if (!match) throw new Error(`Node ${index} has no sequence`)
  return match[1]
}

function readGlbAnimations() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(
    bytes.toString('utf8', 20, 20 + jsonLength),
  ) as { readonly animations: readonly GlbAnimation[] }
  return json.animations
}

function createTestRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  for (const entry of ALS_LOCOMOTION_QUICK_FEET_BLEND_PROFILE.entries) {
    const bone = new THREE.Bone()
    bone.name = entry.bone
    root.add(bone)
  }
  return createRigDefinition(root)
}

type TestRig = ReturnType<typeof createTestRig>

function poseNode(
  rig: TestRig,
  x = 0,
  curves: Readonly<Record<string, number>> = {},
) {
  const node = createMutableUePoseNode(rig.boneCount)
  resetPoseToReference(node.pose, rig)
  for (let bone = 0; bone < rig.boneCount; bone++) {
    node.pose.positions[bone * 3] = x
  }
  for (const name in curves) node.curves.set(name, curves[name])
  return node
}

function sampledPoses(rig: TestRig) {
  return {
    groundedInput: poseNode(rig),
    fallFastPose: poseNode(rig),
    fallPose: poseNode(rig),
    fallFlailPose: poseNode(rig),
    jumpWalkLeftPose: poseNode(rig),
    jumpRunLeftPose: poseNode(rig),
    jumpWalkRightPose: poseNode(rig),
    jumpRunRightPose: poseNode(rig),
    jumpLoopPose: poseNode(rig),
    jumpFlailPose: poseNode(rig),
    airLeanRawSourcePoses: [
      poseNode(rig),
      poseNode(rig),
      poseNode(rig),
      poseNode(rig),
      poseNode(rig),
    ] as const,
    airLeanReferencePose: poseNode(rig),
    landingPreviewHeavyPose: poseNode(rig),
    landingPreviewLightPose: poseNode(rig),
    landLightPose: poseNode(rig),
    landHeavyPose: poseNode(rig),
    landMovementLightRawPose: poseNode(rig),
    landMovementHeavyRawPose: poseNode(rig),
    landMovementReferencePose: poseNode(rig),
  }
}

function setPoseX(node: MutableUePoseNode, value: number) {
  for (let bone = 0; bone < node.pose.boneCount; bone++) {
    node.pose.positions[bone * 3] = value
  }
}

type FrameOverrides =
  Partial<Omit<AlsLocomotionPoseGraphInput, 'poses' | 'clocks'>>
  & {
    readonly poses?: AlsLocomotionSampledPoses
    readonly clocks?: Partial<AlsLocomotionSampledClocks>
  }

function frame(
  poses: AlsLocomotionSampledPoses,
  overrides: FrameOverrides = {},
): AlsLocomotionPoseGraphInput {
  const { clocks, ...rest } = overrides
  return {
    relevant: true,
    deltaTime: 0,
    locomotionMode: 'Grounded',
    jumped: false,
    stance: 'Standing',
    hasInput: false,
    rotatingLeft: false,
    rotatingRight: false,
    speed: 0,
    verticalVelocity: 0,
    groundPredictionAmount: 0,
    leanRightAmount: 0,
    leanForwardAmount: 0,
    footPlantedAmount: 0,
    jumpPlayRate: 1,
    rotationMode: 'VelocityDirection',
    ...rest,
    clocks: {
      jumpLaunchRemainingTime: 1,
      landRemainingTime: 1,
      landMovementRelevantAnimTimeRemaining: 1,
      ...clocks,
    },
    poses,
  }
}

function reachLand(
  runtime: ReturnType<typeof createAlsLocomotionPoseGraphRuntime>,
  poses: AlsLocomotionSampledPoses,
) {
  evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
  evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
    locomotionMode: 'InAir',
  }))
  evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
    locomotionMode: 'Grounded',
    hasInput: false,
  }))
  expect(runtime.outerTransitionStack.currentState).toBe('Land')
}

describe('VERIFIED AB_Als_Locomotion content topology', () => {
  it('retains all recovered nodes and the exact compiled pose-flow order', () => {
    expect(asset).toMatchObject({
      compiledNodeCount: 77,
      bakedNodeCount: 77,
      serializedNodeCount: 77,
      unresolvedCompiledNodeIndices: [],
    })
    expect(AB_ALS_LOCOMOTION_GRAPH).toMatchObject({
      root: { nodeIndex: 0, sourceNodeIndex: 3 },
      groundedInput: {
        linkedInputPoseNodeIndex: 1,
        saveCachedPoseNodeIndex: 2,
        cacheName: 'Grounded',
      },
      poseFlow: {
        root: [76, 4, 3, 0],
        Grounded: [74, 75],
        Fall: [
          69, 70, 68, 71, 72, 61, 62, 65, 64, 63, 66, 67, 60, 73,
        ],
        Jump: [58, 33, 32, 39, 37, 36, 35, 38, 34, 31, 59],
        Land: [28, 29, 27, 26, 25, 30],
        'Land Movement': [23, 22, 21, 20, 19, 17, 18, 24],
      },
    })

    const expectedTypes = {
      root: [
        'FAnimNode_StateMachine',
        'FAnimNode_Inertialization',
        'FAnimNode_CallFunction',
        'FAnimNode_Root',
      ],
      Grounded: ['FAnimNode_UseCachedPose', 'FAnimNode_StateResult'],
      Fall: [
        'FAnimNode_SequencePlayer',
        'FAnimNode_SequencePlayer',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_SequencePlayer',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_BlendSpaceEvaluator',
        'FAnimNode_ApplyAdditive',
        'FAnimNode_SequenceEvaluator',
        'FAnimNode_SequenceEvaluator',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_ModifyCurve',
        'FAnimNode_CallFunction',
        'FAnimNode_StateResult',
      ],
      Jump: [
        'FAnimNode_StateMachine',
        'FAnimNode_Inertialization',
        'FAnimNode_BlendSpaceEvaluator',
        'FAnimNode_ApplyAdditive',
        'FAnimNode_SequenceEvaluator',
        'FAnimNode_SequenceEvaluator',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_ModifyCurve',
        'FAnimNode_CallFunction',
        'FAnimNode_StateResult',
      ],
      Land: [
        'FAnimNode_SequencePlayer',
        'FAnimNode_SequencePlayer',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_ModifyCurve',
        'FAnimNode_CallFunction',
        'FAnimNode_StateResult',
      ],
      'Land Movement': [
        'FAnimNode_SequencePlayer',
        'FAnimNode_SequencePlayer',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_UseCachedPose',
        'FAnimNode_ApplyMeshSpaceAdditive',
        'FAnimNode_UseCachedPose',
        'FAnimNode_TwoWayBlend',
        'FAnimNode_StateResult',
      ],
    } as const
    for (const name of Object.keys(expectedTypes) as (keyof typeof expectedTypes)[]) {
      expect(
        AB_ALS_LOCOMOTION_GRAPH.poseFlow[name]
          .map((index) => extractedNode(index).type),
      ).toEqual(expectedTypes[name])
    }

    expect(extractedNode(4)).toMatchObject({
      type: 'FAnimNode_Inertialization',
      parameters: {
        Source: { LinkID: 76 },
        DefaultBlendProfile: null,
        FilteredBones: [],
        FilteredCurves: [],
        bResetOnBecomingRelevant: false,
        bForwardRequestsThroughSkippedCachedPoseNodes: true,
      },
    })
  })

  it('matches both state machines, all transition payloads, and the conduit', () => {
    const locomotion = extractedMachine('Locomotion States')
    expect(ALS_LOCOMOTION_POSE_STATE_ORDER).toEqual([
      'Grounded',
      'Fall',
      'Jump',
      'Land',
      'Land Movement',
    ])
    expect(locomotion.States.map((state) => ({
      name: state.StateName,
      root: state.StateRootNodeCompiledIndex,
      reset: state.bAlwaysResetOnEntry,
    }))).toEqual([
      { name: 'Grounded', root: 75, reset: false },
      { name: 'Fall', root: 73, reset: false },
      { name: 'Jump', root: 59, reset: true },
      { name: 'Land', root: 30, reset: false },
      { name: 'Land Movement', root: 24, reset: false },
      { name: 'Land Conduct', root: null, reset: false },
    ])
    const stateMachineNode = extractedNode(76).parameters as {
      readonly MaxTransitionsPerFrame: number
      readonly bSkipFirstUpdateTransition: boolean
      readonly bReinitializeOnBecomingRelevant: boolean
    }
    expect(AB_ALS_LOCOMOTION_GRAPH.outerStateMachine).toMatchObject({
      initialState: 'Grounded',
      maxTransitionsPerFrame: stateMachineNode.MaxTransitionsPerFrame,
      maxTransitionRequests: 32,
      skipFirstUpdateTransition:
        stateMachineNode.bSkipFirstUpdateTransition,
      reinitializeOnBecomingRelevant:
        stateMachineNode.bReinitializeOnBecomingRelevant,
    })
    expect(ALS_LOCOMOTION_STATE_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blendMode: `EAlphaBlendOption::${transition.blendOption}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
      profile: transition.blendProfile,
      startNotify: transition.startNotify ? 0 : -1,
    }))).toEqual(locomotion.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blendMode: transition.BlendMode,
      logic: transition.LogicType,
      profile: transition.BlendProfile ? 'QuickFeetBlend' : null,
      startNotify: transition.StartNotify,
    })))

    const jump = extractedMachine('Jump States')
    expect(ALS_JUMP_POSE_GRAPH).toMatchObject({
      'Entry Conduit': { stateIndex: 0, conduit: true },
      'Left Foot': { stateIndex: 1, stateResultNodeIndex: 57 },
      'Right Foot': { stateIndex: 2, stateResultNodeIndex: 53 },
      Loop: { stateIndex: 3, stateResultNodeIndex: 49 },
      Flail: { stateIndex: 4, stateResultNodeIndex: 47 },
    })
    expect(ALS_JUMP_STATE_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blendMode: `EAlphaBlendOption::${transition.blendOption}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
    }))).toEqual(jump.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blendMode: transition.BlendMode,
      logic: transition.LogicType,
    })))
  })

  it('matches the Air Lean topology, QuickFeet profile, clips, curves, and additive metadata', () => {
    const airLean = blendSpaces.blendSpaces.BS_Als_Air_Lean
    expect(ALS_AIR_LEAN_BLEND_SPACE.axes).toEqual(airLean.axes)
    expect(ALS_AIR_LEAN_BLEND_SPACE.samples).toEqual(
      airLean.samples.map((sample) => ({
        animation: { name: sample.animation.name },
        sampleValue: sample.sampleValue,
        rateScale: sample.rateScale,
      })),
    )
    expect(
      ALS_AIR_LEAN_BLEND_SPACE.topology.blendSpaceData.Triangles,
    ).toEqual(airLean.topology.blendSpaceData.Triangles)
    expect(ALS_LOCOMOTION_QUICK_FEET_BLEND_PROFILE).toEqual({
      mode: profiles.profiles.QuickFeetBlend.mode,
      entries: profiles.profiles.QuickFeetBlend.entries,
    })

    const playerNodes = [
      ['fallFast', 69],
      ['fall', 70],
      ['fallFlail', 71],
      ['jumpWalkLeft', 56],
      ['jumpRunLeft', 55],
      ['jumpWalkRight', 52],
      ['jumpRunRight', 51],
      ['jumpLoop', 48],
      ['jumpFlail', 46],
      ['landLight', 28],
      ['landHeavy', 29],
      ['landMovementLight', 23],
      ['landMovementHeavy', 22],
    ] as const
    for (const [name, index] of playerNodes) {
      expect(ALS_LOCOMOTION_PLAYER_METADATA[name].clip)
        .toBe(sequenceName(index))
    }
    expect(ALS_LOCOMOTION_INTERNAL_BLEND_METADATA).toMatchObject({
      air: {
        leanBlendSpace: 'BS_Als_Air_Lean',
        leanEvaluatorNodeIndices: [32, 61],
      },
      landMovement: { additiveType: 'MeshSpace' },
    })

    const animations = readGlbAnimations()
    const airNames = ALS_AIR_LEAN_BLEND_SPACE.samples.map(
      (sample) => sample.animation.name,
    )
    for (const name of airNames) {
      expect(animations.find((animation) => animation.name === name)?.extras)
        .toMatchObject({
          alsCurves: [],
          additiveType: ALS_AIR_LEAN_ADDITIVE_SETTINGS.additiveType,
          refPoseSeq: ALS_AIR_LEAN_ADDITIVE_SETTINGS.referenceSequence,
          refFrameIndex: ALS_AIR_LEAN_ADDITIVE_SETTINGS.referenceFrameIndex,
        })
    }
    for (const name of [
      'A_Als_Land_Light_Additive',
      'A_Als_Land_Heavy_Additive',
    ]) {
      const extras = animations.find(
        (animation) => animation.name === name,
      )?.extras
      expect(extras).toMatchObject({
        additiveType: ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.additiveType,
        refPoseSeq:
          ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.referenceSequence,
        refFrameIndex:
          ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.referenceFrameIndex,
      })
      expect(extras?.alsCurves?.map((curve) => curve.name)).toEqual([
        'FootstepSoundBlock',
        'SprintBlock',
      ])
    }
  })
})

describe('AB_Als_Locomotion retained pose evaluation', () => {
  it('blends raw Air Lean sources before deriving and applying the additive', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    for (const pose of [
      poses.fallFastPose,
      poses.fallPose,
      poses.fallFlailPose,
    ]) setPoseX(pose, 10)
    for (const pose of poses.airLeanRawSourcePoses) setPoseX(pose, 14)
    setPoseX(poses.airLeanReferencePose, 10)
    setPoseX(poses.landingPreviewHeavyPose, 100)
    setPoseX(poses.landingPreviewLightPose, 100)

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
      verticalVelocity: -7.5,
      groundPredictionAmount: 0.25,
    }))

    expect(runtime.nodes.fallAirLeanRawBlend.pose.positions[0])
      .toBeCloseTo(14)
    expect(runtime.nodes.fallAirLeanAdditive.pose.positions[0])
      .toBeCloseTo(4)
    expect(runtime.nodes.fallWithAirLean.pose.positions[0])
      .toBeCloseTo(14)
    expect(runtime.nodes.fall.pose.positions[0]).toBeCloseTo(35.5)
    expect(Object.fromEntries(runtime.nodes.fall.curves)).toEqual({
      PoseStanding: 1,
      PoseInAir: 1,
    })
  })

  it('retains both Land Movement blend nodes and additive-curve accumulation', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    setPoseX(poses.groundedInput, 10)
    setPoseX(poses.landMovementLightRawPose, 14)
    setPoseX(poses.landMovementHeavyRawPose, 18)
    setPoseX(poses.landMovementReferencePose, 10)
    poses.landMovementLightRawPose.curves.set('SprintBlock', 1)

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
    }))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'Grounded',
      hasInput: true,
      verticalVelocity: -1,
      rotationMode: 'Aiming',
    }))

    expect(runtime.outerTransitionStack.currentState)
      .toBe('Land Movement')
    expect(runtime.nodes.landMovementRawBlend.pose.positions[0])
      .toBeCloseTo(14)
    expect(runtime.nodes.landMovementAdditive.pose.positions[0])
      .toBeCloseTo(4)
    expect(runtime.nodes.landMovementApplied.pose.positions[0])
      .toBeCloseTo(12)
    expect(runtime.nodes.landMovement.pose.positions[0])
      .toBeCloseTo(11.25)
    expect(runtime.nodes.landMovement.curves.get('SprintBlock'))
      .toBeCloseTo(0.3125)

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      verticalVelocity: -1,
      rotationMode: 'Aiming',
      clocks: { landMovementRelevantAnimTimeRemaining: 0.3 },
    }))
    expect(runtime.outerTransitionStack.currentState).toBe('Grounded')
    expect(runtime.nodes.outerStateMachine.pose.positions[0])
      .toBeCloseTo(11.25)
    expect(runtime.nodes.outerStateMachine.curves.get('SprintBlock'))
      .toBeCloseTo(0.3125)
  })

  it('forces all authored Land curves after the light/heavy blend', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    reachLand(runtime, poses)
    expect(Object.fromEntries(runtime.nodes.land.curves)).toEqual({
      FootLeftIk: 1,
      FootRightIk: 1,
      FootLeftLock: 1,
      FootRightLock: 1,
      PoseStanding: 1,
    })
  })
})

describe('AB_Als_Locomotion exact state/frame behavior', () => {
  it('resolves conduits to the leaf transition and never evaluates the conduit as a state', () => {
    const rules = {
      locomotionMode: 'Grounded' as const,
      jumped: false,
      stance: 'Standing' as const,
      hasInput: true,
      rotatingLeft: false,
      rotatingRight: false,
      speed: 0,
      landRemainingTime: 1,
      landMovementRelevantAnimTimeRemaining: 1,
    }
    expect(resolveAlsLocomotionTransition('Fall', rules)).toMatchObject({
      transition: { transitionIndex: 14, logic: 'Inertialization' },
      targetState: 'Land Movement',
      sourceTransitionIndices: [14, 2],
    })
    expect(resolveAlsLocomotionTransition('Jump', {
      ...rules,
      hasInput: false,
    })).toMatchObject({
      transition: { transitionIndex: 15, logic: 'Inertialization' },
      targetState: 'Land',
      sourceTransitionIndices: [15, 4],
      crossfadeTimeAdjustment: 0,
    })
  })

  it('applies UE automatic-rule frame overshoot to the Land Movement crossfade', () => {
    const rules = {
      locomotionMode: 'Grounded' as const,
      jumped: false,
      stance: 'Standing' as const,
      hasInput: false,
      rotatingLeft: false,
      rotatingRight: false,
      speed: 0,
      landRemainingTime: 1,
      landMovementRelevantAnimTimeRemaining: 0.300001,
    }
    expect(resolveAlsLocomotionTransition(
      'Land Movement',
      rules,
    )).toBeNull()
    const resolved = resolveAlsLocomotionTransition(
      'Land Movement',
      {
        ...rules,
        landMovementRelevantAnimTimeRemaining: 0.25,
      },
    )
    expect(resolved).toMatchObject({
      transition: { transitionIndex: 11 },
      targetState: 'Grounded',
    })
    expect(resolved?.crossfadeTimeAdjustment).toBeCloseTo(0.05)

    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
    }))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'Grounded',
      hasInput: true,
    }))
    expect(runtime.outerTransitionStack.currentState)
      .toBe('Land Movement')

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      clocks: { landMovementRelevantAnimTimeRemaining: 0.25 },
    }))
    expect(runtime.outerTransitionStack.activeTransitions[0]
      ?.crossfadeDuration).toBeCloseTo(0.25)
  })

  it('skip-first initializes Jump, resets its nested graph, and reports the correct foot edge', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    const output = evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
      jumped: true,
      footPlantedAmount: 1,
    }))
    expect(output).toBe(runtime.nodes.output)
    expect(runtime.outerTransitionStack.currentState).toBe('Jump')
    expect(runtime.transitionsTakenThisFrame).toBe(1)
    expect(runtime.inAirGraphState.jumpState.state).toBe('Right Foot')
    expect(runtime.inertializationRequests).toEqual([])
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'StateReset',
      state: 'Jump',
      reason: 'AlwaysResetOnEntry',
    })

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
      clocks: { jumpLaunchRemainingTime: 0.2 },
    }))
    expect(runtime.inAirGraphState.jumpState).toMatchObject({
      state: 'Loop',
      loopToFlailActive: true,
      loopWeight: 1,
      flailWeight: 0,
    })
    expect(runtime.jumpTransitionsTakenThisFrame).toBe(2)
    expect(runtime.inertializationRequests).toEqual([{
      nodeIndex: 33,
      duration: 0.2,
      transitionIndex: 3,
      machineName: 'Jump States',
    }])

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      deltaTime: 0.1,
      locomotionMode: 'InAir',
      clocks: { jumpLaunchRemainingTime: 0.2 },
    }))
    expect(runtime.jumpTransitionsTakenThisFrame).toBe(0)
    expect(runtime.inertializationRequests).toEqual([])

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'Grounded',
    }))
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
      jumped: true,
      footPlantedAmount: -1,
    }))
    expect(runtime.outerTransitionStack.currentState).toBe('Jump')
    expect(runtime.inAirGraphState.jumpState.state).toBe('Left Foot')
    expect(runtime.lifecycleEvents.filter(
      (event) => event.kind === 'StateReset',
    )).toHaveLength(1)
  })

  it('uses QuickFeet only for pose masks and emits LandToGrounded once at transition start', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    setPoseX(poses.landLightPose, 0)
    setPoseX(poses.landHeavyPose, 0)
    setPoseX(poses.groundedInput, 10)
    poses.groundedInput.curves.set('GroundedOnly', 1)
    reachLand(runtime, poses)
    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      deltaTime: 0.2,
    }))

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      clocks: { landRemainingTime: 0.1 },
    }))
    expect(runtime.outerTransitionStack.activeTransitions).toHaveLength(1)
    expect(runtime.lifecycleEvents.filter(
      (event) => event.kind === 'AnimNotify',
    )).toEqual([{
      kind: 'AnimNotify',
      name: 'LandToGrounded',
      callSite: 'TransitionStart',
      transitionIndex: 7,
    }])

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      deltaTime: 0.4,
    }))
    const transition = runtime.outerTransitionStack.activeTransitions[0]
    expect(transition.alpha).toBeCloseTo(0.5)
    const thigh = rig.boneNames.indexOf('thigh_l')
    expect(runtime.nodes.outerStateMachine.pose.positions[0])
      .toBeCloseTo(5)
    expect(runtime.nodes.outerStateMachine.pose.positions[thigh * 3])
      .toBeGreaterThan(9)
    expect(runtime.nodes.outerStateMachine.curves.get('GroundedOnly'))
      .toBeCloseTo(0.5)
    expect(runtime.lifecycleEvents.filter(
      (event) => event.kind === 'AnimNotify',
    )).toHaveLength(0)
  })

  it('advances a newly selected standard transition in the same UE update', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    reachLand(runtime, poses)

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      deltaTime: 0.2,
      clocks: { landRemainingTime: 0.1 },
    }))

    const transition = runtime.outerTransitionStack.activeTransitions[0]
    expect(transition.elapsedTime).toBeCloseTo(0.2, 12)
    expect(transition.linearAlpha).toBeCloseTo(0.25, 12)
    expect(transition.alpha).toBeCloseTo(0.15625, 12)
  })

  it('clears an interrupted standard stack on same-frame Land-to-Grounded-to-Jump', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    reachLand(runtime, poses)

    evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      locomotionMode: 'InAir',
      jumped: true,
      clocks: { landRemainingTime: 0.1 },
    }))
    expect(runtime.transitionsTakenThisFrame).toBe(2)
    expect(runtime.outerTransitionStack.currentState).toBe('Jump')
    expect(runtime.outerTransitionStack.activeTransitions).toHaveLength(0)
    expect(runtime.inertializationRequests).toEqual([{
      nodeIndex: 4,
      duration: 0.1,
      transitionIndex: 0,
      machineName: 'Locomotion States',
    }])
    expect(runtime.lifecycleEvents.filter(
      (event) => event.kind === 'AnimNotify',
    )).toHaveLength(1)
  })

  it('reuses one output and rejects invalid frame deltas', () => {
    const rig = createTestRig()
    const poses = sampledPoses(rig)
    const runtime = createAlsLocomotionPoseGraphRuntime(rig)
    const first = evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
    const second = evaluateAlsLocomotionPoseGraph(runtime, frame(poses))
    expect(second).toBe(first)
    expect(() => evaluateAlsLocomotionPoseGraph(runtime, frame(poses, {
      deltaTime: Number.NaN,
    }))).toThrow('finite and non-negative')
  })
})
