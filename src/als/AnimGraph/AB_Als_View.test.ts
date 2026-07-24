/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateBlendSpace } from '../../engine/blendSpace'
import {
  ALS_LOOK_BLEND_SPACE,
  ALS_LOOK_DIRECTION_CHANGE_PROFILE,
  ALS_LOOK_SIDE_SWITCH_CURVES,
  ALS_LOOK_STATES_MACHINE,
  ALS_VIEW_GRAPH,
  ALS_VIEW_GRAPH_TRANSITIONS,
  ALS_VIEW_PLAYERS,
  createAlsViewGraphRuntime,
  createAlsLookBlendSpaceEvaluator,
  resolveAlsViewPlayerParameters,
  sampleAlsViewTransitionBlend,
  selectAlsViewGraphTransition,
  updateAlsViewGraphRuntime,
} from './AB_Als_View'
import type {
  AlsViewGraphState,
  AlsViewTransitionInput,
} from './AB_Als_View'

interface ExtractedNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface ExtractedTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly StartNotify: number
  readonly EndNotify: number
  readonly InterruptNotify: number
  readonly BlendMode: string
  readonly CustomCurve: {
    readonly ObjectName: string
  } | null
  readonly BlendProfile: {
    readonly ObjectName: string
  } | null
  readonly LogicType: string
}

interface ExtractedStateTransition {
  readonly TransitionIndex: number
  readonly bAutomaticRemainingTimeRule: boolean
  readonly AutomaticRuleTriggerTime: number
  readonly rule: {
    readonly compiledDelegateIndex: number
    readonly compiledDelegateProperty: string
  }
}

interface ExtractedState {
  readonly StateName: string
  readonly Transitions: readonly ExtractedStateTransition[]
  readonly bIsAConduit: boolean
  readonly bAlwaysResetOnEntry: boolean
  readonly StateRootNodeCompiledIndex: number
  readonly PlayerNodeCompiledIndices: readonly number[]
  readonly PlayerNodeProperties: readonly string[]
}

interface ExtractedStateMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly ExtractedState[]
  readonly Transitions: readonly ExtractedTransition[]
}

interface ExtractedAbpGraph {
  readonly assets: {
    readonly AB_Als_View: {
      readonly nodes: readonly ExtractedNode[]
      readonly stateMachines: readonly ExtractedStateMachine[]
      readonly referencedAnimationAssets: readonly {
        readonly className: string
        readonly objectName: string
      }[]
    }
  }
}

interface ExtractedBlendSpaces {
  readonly blendSpaces: Readonly<Record<string, {
    readonly assetPath: string
  }>>
}

interface ExtractedSkeletonProfiles {
  readonly profiles: {
    readonly LookDirectionChange: {
      readonly mode: string
      readonly entries: readonly {
        readonly bone: string
        readonly blendScale: number
      }[]
    }
  }
}

const extractedGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedAbpGraph

const extractedBlendSpaces = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/blend-spaces.json', import.meta.url),
  'utf8',
)) as ExtractedBlendSpaces

const extractedSkeletonProfiles = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/skeleton-profiles.json', import.meta.url),
  'utf8',
)) as ExtractedSkeletonProfiles

const viewAsset = extractedGraph.assets.AB_Als_View
const lookMachine = viewAsset.stateMachines.find(
  (candidate) => candidate.MachineName === 'Look States',
)
if (!lookMachine) throw new Error('AB_Als_View has no Look States machine')

function node(compiledIndex: number) {
  const result = viewAsset.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!result) throw new Error(`Missing compiled View node ${compiledIndex}`)
  return result
}

function objectName(object: { readonly ObjectName: string } | null) {
  return object?.ObjectName.match(/:?(CF_Als_[^']+|LookDirectionChange)'$/)
    ?.[1] ?? null
}

function transitionInput(
  yawAngle: number,
  stateWeights: Partial<Record<AlsViewGraphState, number>> = {},
): AlsViewTransitionInput {
  return {
    yawAngle,
    stateWeights: {
      'Look Forward': 1,
      'Look Left Back': 1,
      'Look Right Back': 1,
      'Switch Sides': 1,
      ...stateWeights,
    },
  }
}

describe('VERIFIED AB_Als_View Look States machine', () => {
  it('pins the authored state order, node ownership, and machine flags', () => {
    expect(lookMachine.InitialState).toBe(0)
    expect(lookMachine.States.map((state) => state.StateName)).toEqual([
      'Look Forward',
      'Look Left Back',
      'Look Right Back',
      'Switch Sides',
    ])
    expect(ALS_LOOK_STATES_MACHINE.states.map((state) => ({
      name: state.name,
      stateResultNodeIndex: state.stateResultNodeIndex,
      playerNodeIndex: state.playerNodeIndex,
      alwaysResetOnEntry: state.alwaysResetOnEntry,
    }))).toEqual(lookMachine.States.map((state) => ({
      name: state.StateName,
      stateResultNodeIndex: state.StateRootNodeCompiledIndex,
      playerNodeIndex: state.PlayerNodeCompiledIndices[0],
      alwaysResetOnEntry: state.bAlwaysResetOnEntry,
    })))
    expect(lookMachine.States.every((state) => !state.bIsAConduit))
      .toBe(true)

    expect(node(ALS_LOOK_STATES_MACHINE.compiledNodeIndex)).toMatchObject({
      type: 'FAnimNode_StateMachine',
      parameters: {
        StateMachineIndexInClass: 0,
        MaxTransitionsPerFrame: 3,
        MaxTransitionsRequests: 32,
        bSkipFirstUpdateTransition: true,
        bReinitializeOnBecomingRelevant: true,
        bCreateNotifyMetaData: true,
        bAllowConduitEntryStates: false,
      },
    })
  })

  it('matches all twelve baked transitions and their shared delegates', () => {
    expect(lookMachine.Transitions).toHaveLength(12)
    expect(ALS_VIEW_GRAPH_TRANSITIONS).toHaveLength(12)
    const stateTransitionByIndex = new Map(
      lookMachine.States.flatMap((state) => state.Transitions).map(
        (transition) => [transition.TransitionIndex, transition],
      ),
    )

    for (
      let transitionIndex = 0;
      transitionIndex < lookMachine.Transitions.length;
      transitionIndex++
    ) {
      const extracted = lookMachine.Transitions[transitionIndex]
      const runtime = ALS_VIEW_GRAPH_TRANSITIONS[transitionIndex]
      const stateTransition = stateTransitionByIndex.get(transitionIndex)
      expect(runtime).toMatchObject({
        transitionIndex,
        from: extracted.PreviousStateName,
        to: extracted.NextStateName,
        duration: extracted.CrossfadeDuration,
        blendOption: extracted.BlendMode.replace(
          'EAlphaBlendOption::',
          '',
        ),
        customCurve: objectName(extracted.CustomCurve),
        blendProfile: objectName(extracted.BlendProfile),
        logic: extracted.LogicType.replace(
          'ETransitionLogicType::TLT_',
          '',
        ),
        automaticRemainingTimeRule:
          stateTransition?.bAutomaticRemainingTimeRule,
        automaticRuleTriggerTime:
          stateTransition?.AutomaticRuleTriggerTime,
        compiledDelegateIndex:
          stateTransition?.rule.compiledDelegateIndex,
        compiledDelegateProperty:
          stateTransition?.rule.compiledDelegateProperty,
      })
      expect(extracted.StartNotify).toBe(-1)
      expect(extracted.EndNotify).toBe(-1)
      expect(extracted.InterruptNotify).toBe(-1)
    }

    expect(ALS_VIEW_GRAPH_TRANSITIONS.map(
      (transition) => transition.priorityOrder,
    )).toEqual([1, 1, 2, 2, 1, 1, 2, 1, 1, 2, 1, 1])
  })

  it('freezes the seven generated-bytecode transition expressions', () => {
    expect(ALS_VIEW_GRAPH_TRANSITIONS.map(
      (transition) => transition.rule,
    )).toEqual([
      (
        'GetInstanceStateWeight(Look Forward) < 1'
        + ' && RemapAngleForCounterClockwiseRotation(YawAngle) >= 130'
      ),
      (
        'GetInstanceStateWeight(Look Forward) < 1'
        + ' && RemapAngleForCounterClockwiseRotation(YawAngle) <= -130'
      ),
      'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
      'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
      (
        'Abs(YawAngle) <= 125'
        + ' && GetInstanceStateWeight(Look Left Back) < 1'
      ),
      'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
      'Abs(YawAngle) <= 125',
      (
        'Abs(YawAngle) <= 125'
        + ' && GetInstanceStateWeight(Look Right Back) < 1'
      ),
      'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
      'Abs(YawAngle) <= 125',
      'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
      'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
    ])
  })

  it('selects steady and partially weighted duplicate edges exactly', () => {
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(130),
    )?.transitionIndex).toBe(2)
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(130, { 'Look Forward': 0.75 }),
    )?.transitionIndex).toBe(0)
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(-130),
    )?.transitionIndex).toBe(3)
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(-130, { 'Look Forward': 0.75 }),
    )?.transitionIndex).toBe(1)

    expect(selectAlsViewGraphTransition(
      'Look Left Back',
      transitionInput(125),
    )?.transitionIndex).toBe(6)
    expect(selectAlsViewGraphTransition(
      'Look Left Back',
      transitionInput(125, { 'Look Left Back': 0.75 }),
    )?.transitionIndex).toBe(4)
    expect(selectAlsViewGraphTransition(
      'Look Right Back',
      transitionInput(125),
    )?.transitionIndex).toBe(9)
    expect(selectAlsViewGraphTransition(
      'Look Right Back',
      transitionInput(125, { 'Look Right Back': 0.75 }),
    )?.transitionIndex).toBe(7)
  })

  it('preserves the 125/130 hysteresis and counter-clockwise near-180 remap', () => {
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(127),
    )).toBeNull()
    expect(selectAlsViewGraphTransition(
      'Look Left Back',
      transitionInput(127),
    )).toBeNull()
    expect(selectAlsViewGraphTransition(
      'Look Left Back',
      transitionInput(130),
    )?.transitionIndex).toBe(5)
    expect(selectAlsViewGraphTransition(
      'Look Right Back',
      transitionInput(-130),
    )?.transitionIndex).toBe(8)
    expect(selectAlsViewGraphTransition(
      'Switch Sides',
      transitionInput(130),
    )?.transitionIndex).toBe(10)
    expect(selectAlsViewGraphTransition(
      'Switch Sides',
      transitionInput(-130),
    )?.transitionIndex).toBe(11)

    // AlsRotation remaps angles above +175 by subtracting 360.
    expect(selectAlsViewGraphTransition(
      'Look Forward',
      transitionInput(176),
    )?.transitionIndex).toBe(3)
  })
})

describe('VERIFIED BS_Als_Look players and authored topology', () => {
  const extractedLookBlendSpace =
    extractedBlendSpaces.blendSpaces.BS_Als_Look
  if (!extractedLookBlendSpace) {
    throw new Error('blend-spaces.json has no BS_Als_Look')
  }

  it('is an exact transcription of the extracted BlendSpace asset', () => {
    expect(ALS_LOOK_BLEND_SPACE).toEqual(extractedLookBlendSpace)
    expect(viewAsset.referencedAnimationAssets.map(
      (asset) => `${asset.className}'${asset.objectName}'`,
    )).toEqual(["BlendSpace1D'BS_Als_Look'"])
  })

  it('evaluates the two authored segments and clamps outside pitch range', () => {
    const evaluator = createAlsLookBlendSpaceEvaluator()
    const sample = (pitchAngle: number) => {
      const result = evaluateBlendSpace(evaluator, pitchAngle)
      return Array.from({ length: result.count }, (_, index) => ({
        animation: ALS_LOOK_BLEND_SPACE.samples[
          result.sampleIndices[index]
        ].animation.name,
        weight: result.weights[index],
      }))
    }

    expect(sample(-180)).toEqual([
      { animation: 'A_Als_Look_Down', weight: 1 },
    ])
    expect(sample(-45)).toEqual([
      { animation: 'A_Als_Look_Down', weight: 0.5 },
      { animation: 'A_Als_Look_Forward', weight: 0.5 },
    ])
    expect(sample(0)).toEqual([
      { animation: 'A_Als_Look_Forward', weight: 1 },
    ])
    expect(sample(45)).toEqual([
      { animation: 'A_Als_Look_Forward', weight: 0.5 },
      { animation: 'A_Als_Look_Up', weight: 0.5 },
    ])
    expect(sample(180)).toEqual([
      { animation: 'A_Als_Look_Up', weight: 1 },
    ])
  })

  it('pins every evaluator binding and resolves its explicit time', () => {
    expect(Object.values(ALS_VIEW_PLAYERS).map((player) => [
      player.state,
      player.compiledNodeIndex,
      player.compiledNodeProperty,
      player.xBinding,
      player.normalizedTimeBinding,
      player.normalizedTime,
    ])).toEqual([
      [
        'Look Forward',
        9,
        'AnimGraphNode_BlendSpaceEvaluator_3',
        'LookState.PitchAngle',
        'LookState.YawForwardAmount',
        null,
      ],
      [
        'Look Left Back',
        15,
        'AnimGraphNode_BlendSpaceEvaluator',
        'LookState.PitchAngle',
        'LookState.YawLeftAmount',
        null,
      ],
      [
        'Look Right Back',
        13,
        'AnimGraphNode_BlendSpaceEvaluator_1',
        'LookState.PitchAngle',
        'LookState.YawRightAmount',
        null,
      ],
      [
        'Switch Sides',
        11,
        'AnimGraphNode_BlendSpaceEvaluator_2',
        'LookState.PitchAngle',
        null,
        0.5,
      ],
    ])

    const lookState = {
      pitchAngle: -42,
      yawForwardAmount: 0.2,
      yawLeftAmount: 0.3,
      yawRightAmount: 0.7,
    }
    expect(resolveAlsViewPlayerParameters(
      'Look Forward',
      lookState,
    )).toEqual({ x: -42, normalizedTime: 0.2 })
    expect(resolveAlsViewPlayerParameters(
      'Look Left Back',
      lookState,
    )).toEqual({ x: -42, normalizedTime: 0.3 })
    expect(resolveAlsViewPlayerParameters(
      'Look Right Back',
      lookState,
    )).toEqual({ x: -42, normalizedTime: 0.7 })
    expect(resolveAlsViewPlayerParameters(
      'Switch Sides',
      lookState,
    )).toEqual({ x: -42, normalizedTime: 0.5 })

    for (const player of Object.values(ALS_VIEW_PLAYERS)) {
      expect(node(player.compiledNodeIndex)).toMatchObject({
        type: 'FAnimNode_BlendSpaceEvaluator',
        parameters: {
          bTeleportToNormalizedTime: true,
          GroupName: 'None',
          GroupRole: 'EAnimGroupRole::CanBeLeader',
          Method: 'EAnimSyncMethod::DoNotSync',
          bIgnoreForRelevancyTest: false,
          PlayRate: 1,
          bLoop: true,
          StartPosition: 0,
          bResetPlayTimeWhenBlendSpaceChanges: true,
        },
      })
    }
  })
})

describe('VERIFIED View transition blend content', () => {
  it('pins both custom RichCurves, including their user tangents', () => {
    expect(ALS_LOOK_SIDE_SWITCH_CURVES.CF_Als_LookSideSwitch_In)
      .toEqual([
        {
          time: 0,
          value: 0,
          interpolation: 'cubic',
          arriveTangent: 0,
          leaveTangent: 0,
        },
        {
          time: 0.20000000298023224,
          value: 0.20000000298023224,
          interpolation: 'cubic',
          arriveTangent: 2.72149658203125,
          leaveTangent: 2.72149658203125,
        },
        {
          time: 0.5,
          value: 1,
          interpolation: 'linear',
          arriveTangent: 2.718350887298584,
          leaveTangent: 0,
        },
        {
          time: 1,
          value: 1,
          interpolation: 'linear',
          arriveTangent: 0,
          leaveTangent: 0,
        },
      ])
    expect(ALS_LOOK_SIDE_SWITCH_CURVES.CF_Als_LookSideSwitch_Out)
      .toEqual([
        {
          time: 0,
          value: 0,
          interpolation: 'linear',
          arriveTangent: 0,
          leaveTangent: 0,
        },
        {
          time: 0.20000000298023224,
          value: 0,
          interpolation: 'cubic',
          arriveTangent: 0,
          leaveTangent: 0,
        },
        {
          time: 0.5,
          value: 0.5,
          interpolation: 'cubic',
          arriveTangent: 3.0318171977996826,
          leaveTangent: 3.0318171977996826,
        },
        {
          time: 1,
          value: 1,
          interpolation: 'linear',
          arriveTangent: 0,
          leaveTangent: 0,
        },
      ])
  })

  it('samples Hermite, zero-duration, and custom transition blends', () => {
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[0],
      0.05,
    )).toBeCloseTo(0.15625, 12)
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[2],
      0,
    )).toBe(1)
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[5],
      0.2,
    )).toBeCloseTo(0.2, 7)
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[5],
      0.5,
    )).toBe(1)
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[10],
      0.2,
    )).toBe(0)
    expect(sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[10],
      0.5,
    )).toBe(0.5)
  })

  it('matches the extracted LookDirectionChange WeightFactor profile', () => {
    expect(ALS_LOOK_DIRECTION_CHANGE_PROFILE).toEqual({
      mode: extractedSkeletonProfiles.profiles.LookDirectionChange.mode,
      entries: extractedSkeletonProfiles.profiles.LookDirectionChange.entries,
    })
  })
})

describe('VERIFIED AB_Als_View pose topology and scope', () => {
  it('pins the cached input, call-function order, additive, and root gate', () => {
    expect(node(18)).toMatchObject({
      type: 'FAnimNode_SaveCachedPose',
      parameters: {
        Pose: { LinkID: 1 },
        CachePoseName: 'View Input',
      },
    })
    expect(node(24)).toMatchObject({
      type: 'FAnimNode_CallFunction',
      parameters: {
        Source: { LinkID: 17 },
        CallSite: 'EAnimFunctionCallSite::OnUpdate',
      },
    })
    expect(node(23)).toMatchObject({
      type: 'FAnimNode_CallFunction',
      parameters: {
        Source: { LinkID: 24 },
        CallSite: 'EAnimFunctionCallSite::OnBecomeRelevant',
      },
    })
    expect(node(21)).toMatchObject({
      type: 'FAnimNode_ApplyMeshSpaceAdditive',
      parameters: {
        Base: { LinkID: 19 },
        Additive: { LinkID: 23 },
        Alpha: 1,
        LODThreshold: -1,
      },
    })
    expect(node(22)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 20 },
        B: { LinkID: 21 },
        AlphaInputType: 'EAnimAlphaInputType::Float',
        bResetChildOnActivation: false,
        bAlwaysUpdateChildren: false,
        AlphaScaleBiasClamp: {
          bMapRange: false,
          bClampResult: false,
          bInterpResult: false,
        },
      },
    })
    expect(node(0)).toMatchObject({
      type: 'FAnimNode_Root',
      parameters: { Result: { LinkID: 22 } },
    })

    expect(ALS_VIEW_GRAPH).toMatchObject({
      look: {
        refreshFunction: {
          name: 'RefreshLook',
          callSite: 'OnUpdate',
          compiledNodeIndex: 24,
        },
        initializeFunction: {
          name: 'InitializeLook',
          callSite: 'OnBecomeRelevant',
          compiledNodeIndex: 23,
        },
        additiveType: 'MeshSpaceRotationOffset',
      },
      outputBlend: {
        aNodeIndex: 20,
        bNodeIndex: 21,
        alphaBinding: 'ViewState.LookAmount',
      },
    })
  })

  it('records the verified absence of a separate Aiming graph', () => {
    expect(ALS_VIEW_GRAPH.aimingSubgraph.kind).toBe('not-present')
  })
})

describe('AB_Als_View retained state-machine runtime', () => {
  const rig = {
    boneCount: 3,
    physicalBoneCount: 3,
    boneNames: ['root', 'neck_01', 'head'],
    parentIndices: new Int16Array([-1, 0, 1]),
    referencePositions: new Float32Array(9),
    referenceRotations: new Float32Array([
      0, 0, 0, 1,
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]),
    referenceScales: new Float32Array([
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
    ]),
    virtualBones: [],
  }

  it('keeps both custom side-switch transitions and applies the profile', () => {
    const runtime = createAlsViewGraphRuntime(rig)

    // Become relevant: reinitialize to Look Forward and skip the first transition update.
    updateAlsViewGraphRuntime(runtime, -170, 0, true)
    expect(runtime.currentState).toBe('Look Forward')
    updateAlsViewGraphRuntime(runtime, -170, 0, true)
    expect(runtime.currentState).toBe('Look Left Back')

    updateAlsViewGraphRuntime(runtime, 170, 0.5, true)
    expect(runtime.currentState).toBe('Look Right Back')
    expect(runtime.activeTransitionIndices).toEqual([5, 10])
    expect(runtime.stateWeights['Look Left Back']).toBe(0)
    expect(runtime.stateWeights['Switch Sides']).toBeCloseTo(0.5, 7)
    expect(runtime.stateWeights['Look Right Back']).toBeCloseTo(0.5, 7)

    // Root uses the scalar custom curves; neck/head have WeightFactor=2 and finish early.
    expect(runtime.statePoseMasks['Switch Sides'][0]).toBeCloseTo(0.5, 7)
    expect(runtime.statePoseMasks['Look Right Back'][0]).toBeCloseTo(0.5, 7)
    expect(runtime.statePoseMasks['Switch Sides'][1]).toBe(0)
    expect(runtime.statePoseMasks['Look Right Back'][1]).toBe(1)
    expect(runtime.statePoseMasks['Switch Sides'][2]).toBe(0)
    expect(runtime.statePoseMasks['Look Right Back'][2]).toBe(1)

    updateAlsViewGraphRuntime(runtime, 170, 0.5, true)
    expect(runtime.activeTransitionIndices).toEqual([])
    expect(runtime.stateWeights['Look Right Back']).toBe(1)
  })

  it('reinitializes and skips the first transition when Look becomes relevant', () => {
    const runtime = createAlsViewGraphRuntime(rig)
    updateAlsViewGraphRuntime(runtime, 170, 0, true)
    updateAlsViewGraphRuntime(runtime, 170, 0, true)
    expect(runtime.currentState).toBe('Look Right Back')

    updateAlsViewGraphRuntime(runtime, 170, 0, false)
    expect(runtime.currentState).toBe('Look Forward')
    updateAlsViewGraphRuntime(runtime, -170, 0, true)
    expect(runtime.currentState).toBe('Look Forward')
    updateAlsViewGraphRuntime(runtime, -170, 0, true)
    expect(runtime.currentState).toBe('Look Left Back')
  })
})
