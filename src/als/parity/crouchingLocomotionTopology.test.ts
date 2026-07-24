/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Link {
  readonly LinkID: number
}

interface GraphNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: {
    readonly A?: Link
    readonly B?: Link
    readonly Additive?: Link
    readonly Base?: Link
    readonly Source?: Link
    readonly SourcePose?: Link
    readonly AlphaScaleBiasClamp?: {
      readonly bInterpResult: boolean
      readonly InterpSpeedIncreasing: number
      readonly InterpSpeedDecreasing: number
    }
    readonly BlendProfile?: { readonly ObjectName: string } | null
    readonly CachePoseName?: string
    readonly CurveNames?: readonly string[]
    readonly CurveValues?: readonly number[]
    readonly DefaultBlendProfile?: { readonly ObjectName: string } | null
    readonly FilteredBones?: readonly unknown[]
    readonly FilteredCurves?: readonly unknown[]
    readonly GroupName?: string
    readonly Method?: string
    readonly Name?: string
    readonly Poses?: readonly Link[]
    readonly Sequence?: { readonly ObjectName: string }
    readonly StateEntryFunction?: { readonly FunctionName: string }
    readonly StateExitFunction?: { readonly FunctionName: string }
    readonly bAlwaysUpdateChildren?: boolean
    readonly bForwardRequestsThroughSkippedCachedPoseNodes?: boolean
    readonly bLoopAnimation?: boolean
    readonly bNormalizeAlpha?: boolean
    readonly bReinitializeOnBecomingRelevant?: boolean
    readonly bResetChildOnActivation?: boolean
    readonly bResetOnBecomingRelevant?: boolean
    readonly bSkipFirstUpdateTransition?: boolean
    readonly MaxTransitionsPerFrame?: number
  }
}

interface Transition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly StartNotify: number
  readonly BlendMode: string
  readonly BlendProfile: { readonly ObjectName: string } | null
  readonly LogicType: string
}

interface StateMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly {
    readonly StateName: string
    readonly StateRootNodeCompiledIndex: number
    readonly bAlwaysResetOnEntry: boolean
  }[]
  readonly Transitions: readonly Transition[]
}

interface AbpGraph {
  readonly assets: Readonly<Record<string, {
    readonly nodes: readonly GraphNode[]
    readonly stateMachines: readonly StateMachine[]
  }>>
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

const asset = graph.assets.AB_Als_Crouching

function node(compiledIndex: number) {
  const value = asset?.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!value) {
    throw new Error(`AB_Als_Crouching is missing compiled node ${compiledIndex}`)
  }
  return value
}

function machine(name: string) {
  const value = asset?.stateMachines.find(
    (candidate) => candidate.MachineName === name,
  )
  if (!value) {
    throw new Error(`AB_Als_Crouching is missing state machine ${name}`)
  }
  return value
}

describe('ALS authored crouching locomotion topology', () => {
  it('owns a reinitializing six-state Movement States machine', () => {
    expect(node(108)).toMatchObject({
      type: 'FAnimNode_StateMachine',
      parameters: {
        MaxTransitionsPerFrame: 3,
        bSkipFirstUpdateTransition: true,
        bReinitializeOnBecomingRelevant: true,
      },
    })

    const movement = machine('Movement States')
    expect(movement.InitialState).toBe(0)
    expect(movement.States.map((state) => ({
      name: state.StateName,
      reset: state.bAlwaysResetOnEntry,
    }))).toEqual([
      { name: 'Move Forward', reset: false },
      { name: 'Move Backward', reset: false },
      { name: 'Move Right Forward', reset: false },
      { name: 'Move Right Backward', reset: false },
      { name: 'Move Left Forward', reset: false },
      { name: 'Move Left Backward', reset: false },
    ])

    expect(movement.Transitions).toHaveLength(24)
    for (const transition of movement.Transitions) {
      expect(transition).toMatchObject({
        CrossfadeDuration: 0.7,
        BlendMode: 'EAlphaBlendOption::Cubic',
        BlendProfile: {
          ObjectName: "BlendProfile'SK_Als:MoveDirectionChange'",
        },
        LogicType: 'ETransitionLogicType::TLT_StandardBlend',
      })
    }
  })

  it('syncs all six authored crouch cycles in the Movement group', () => {
    const sequenceNodes = [36, 37, 38, 39, 40, 41].map(node)
    expect(sequenceNodes.map(
      (sequenceNode) => sequenceNode.parameters.Sequence?.ObjectName,
    )).toEqual([
      "AnimSequence'A_Als_Crouch_Walk_Forward'",
      "AnimSequence'A_Als_Crouch_Walk_Backward'",
      "AnimSequence'A_Als_Crouch_Walk_Left_Backward'",
      "AnimSequence'A_Als_Crouch_Walk_Right_Forward'",
      "AnimSequence'A_Als_Crouch_Walk_Right_Backward'",
      "AnimSequence'A_Als_Crouch_Walk_Left_Forward'",
    ])
    for (const sequenceNode of sequenceNodes) {
      expect(sequenceNode).toMatchObject({
        type: 'FAnimNode_SequencePlayer',
        parameters: {
          GroupName: 'Movement',
          Method: 'EAnimSyncMethod::SyncGroup',
          bLoopAnimation: true,
        },
      })
    }
  })

  it('normalizes the authored four-pose inputs inside every hips-direction state', () => {
    const statePoseInputs = [
      [101, ['Move Forward', 'Move Backward', 'Move Left Forward', 'Move Right Forward']],
      [93, ['Move Forward', 'Move Backward', 'Move Left Backward', 'Move Right Backward']],
      [85, ['Move Forward', 'Move Backward', 'Move Left Backward', 'Move Right Forward']],
      [76, ['Move Forward', 'Move Backward', 'Move Left Forward', 'Move Right Backward']],
      [68, ['Move Forward', 'Move Backward', 'Move Left Forward', 'Move Right Backward']],
      [60, ['Move Forward', 'Move Backward', 'Move Left Backward', 'Move Right Forward']],
    ] as const

    for (const [multiWayIndex, expectedInputs] of statePoseInputs) {
      const multiWay = node(multiWayIndex)
      expect(multiWay).toMatchObject({
        type: 'FAnimNode_MultiWayBlend',
        parameters: { bNormalizeAlpha: true },
      })
      expect(multiWay.parameters.Poses?.map(
        (pose) => node(pose.LinkID).parameters.CachePoseName,
      )).toEqual(expectedInputs)
    }
  })

  it('blends the fixed crouch-walk pose into Movement States before lean', () => {
    expect(node(45)).toMatchObject({
      type: 'FAnimNode_SequenceEvaluator',
      parameters: {
        Sequence: {
          ObjectName: "AnimSequence'A_Als_Crouch_Walk_Pose'",
        },
      },
    })
    expect(node(43)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 45 },
        B: { LinkID: 108 },
        bResetChildOnActivation: false,
        bAlwaysUpdateChildren: false,
        AlphaScaleBiasClamp: {
          bInterpResult: true,
          InterpSpeedIncreasing: 10,
          InterpSpeedDecreasing: 10,
        },
      },
    })
    expect(node(42)).toMatchObject({
      type: 'FAnimNode_ApplyAdditive',
      parameters: {
        Base: { LinkID: 43 },
        Additive: { LinkID: 110 },
      },
    })
    expect(node(35)).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        SourcePose: { LinkID: 42 },
        CurveNames: ['PoseMoving'],
        CurveValues: [1],
      },
    })
  })

  it('keeps Idle, Move, Rotate, and Stop ownership in Crouching States', () => {
    expect(node(33)).toMatchObject({
      type: 'FAnimNode_StateMachine',
      parameters: {
        MaxTransitionsPerFrame: 3,
        bSkipFirstUpdateTransition: true,
        bReinitializeOnBecomingRelevant: true,
      },
    })

    const crouching = machine('Crouching States')
    expect(crouching.InitialState).toBe(0)
    expect(crouching.States.map((state) => ({
      name: state.StateName,
      reset: state.bAlwaysResetOnEntry,
    }))).toEqual([
      { name: 'Idle', reset: false },
      { name: 'Move', reset: false },
      { name: 'Rotate Left', reset: false },
      { name: 'Rotate Right', reset: false },
      { name: 'Stop', reset: false },
    ])
    expect(crouching.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      logic: transition.LogicType,
      profile: transition.BlendProfile?.ObjectName ?? null,
      startNotify: transition.StartNotify,
    }))).toEqual([
      { from: 'Idle', to: 'Move', duration: 0.2, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Idle', to: 'Rotate Right', duration: 0.2, logic: 'ETransitionLogicType::TLT_Inertialization', profile: null, startNotify: -1 },
      { from: 'Idle', to: 'Rotate Left', duration: 0.2, logic: 'ETransitionLogicType::TLT_Inertialization', profile: null, startNotify: -1 },
      { from: 'Move', to: 'Stop', duration: 0.1, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Move', to: 'Idle', duration: 0.2, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: 0 },
      { from: 'Rotate Left', to: 'Idle', duration: 0.4, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Rotate Left', to: 'Idle', duration: 0, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Rotate Left', to: 'Rotate Right', duration: 0.2, logic: 'ETransitionLogicType::TLT_Inertialization', profile: null, startNotify: -1 },
      { from: 'Rotate Right', to: 'Idle', duration: 0.4, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Rotate Right', to: 'Idle', duration: 0, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: null, startNotify: -1 },
      { from: 'Rotate Right', to: 'Rotate Left', duration: 0.2, logic: 'ETransitionLogicType::TLT_Inertialization', profile: null, startNotify: -1 },
      { from: 'Stop', to: 'Idle', duration: 0.5, logic: 'ETransitionLogicType::TLT_StandardBlend', profile: "BlendProfile'SK_Als:QuickFeetBlend'", startNotify: -1 },
    ])

    expect(node(24).parameters).toMatchObject({
      Name: 'Move',
      StateEntryFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
    expect(node(16).parameters).toMatchObject({
      Name: 'Stop',
      StateEntryFunction: {
        FunctionName: 'PlayStopTransitionAnimation',
      },
    })
    expect(node(32).parameters).toMatchObject({
      Name: 'Idle',
      StateExitFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
  })

  it('runs Crouching States through its own inertializer and publishes PoseCrouching', () => {
    expect(node(34)).toMatchObject({
      type: 'FAnimNode_Inertialization',
      parameters: {
        Source: { LinkID: 33 },
        DefaultBlendProfile: null,
        FilteredBones: [],
        FilteredCurves: [],
        bResetOnBecomingRelevant: false,
        bForwardRequestsThroughSkippedCachedPoseNodes: true,
      },
    })
    expect(node(2)).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        SourcePose: { LinkID: 34 },
        CurveNames: ['PoseCrouching'],
        CurveValues: [1],
      },
    })
  })
})
