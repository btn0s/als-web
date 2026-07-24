/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  accumulatePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
  makeDynamicAdditivePose,
} from '../../engine/blend'
import { evaluateBlendSpace } from '../../engine/blendSpace'
import {
  compileClipSampler,
  sampleClip,
} from '../../engine/clipSampler'
import type { CompiledClipSampler } from '../../engine/clipSampler'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToReference,
} from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import {
  ALS_LOOK_BLEND_SPACE,
  ALS_LOOK_DIRECTION_CHANGE_PROFILE,
  ALS_LOOK_SIDE_SWITCH_CURVES,
  ALS_LOOK_STATES_MACHINE,
  ALS_VIEW_GRAPH,
  ALS_VIEW_GRAPH_TRANSITIONS,
  ALS_VIEW_POSE_CLIP_NAMES,
  ALS_VIEW_PLAYERS,
  createAlsViewGraphRuntime,
  createAlsLookBlendSpaceEvaluator,
  createAlsViewPoseRuntime,
  evaluateAlsViewPoseRuntime,
  isAlsViewPoseBecomingRelevant,
  isAlsViewPoseRelevant,
  refreshAlsViewPoseRuntime,
  resolveAlsViewPlayerParameters,
  sampleAlsViewTransitionBlend,
  selectAlsViewGraphTransition,
  updateAlsViewGraphRuntime,
} from './AB_Als_View'
import type {
  AlsViewGraphState,
  AlsViewPoseClipName,
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

const viewPoseRig = {
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

const viewPoseClipDurations:
Readonly<Record<AlsViewPoseClipName, number>> = {
  A_Als_Look_Forward: 2,
  A_Als_Look_Down: 4,
  A_Als_Look_Up: 6,
}

function createViewPoseSamplers() {
  const samplers = new Map<
    AlsViewPoseClipName,
    CompiledClipSampler
  >()
  for (const clipName of ALS_VIEW_POSE_CLIP_NAMES) {
    samplers.set(
      clipName,
      compileClipSampler(
        new THREE.AnimationClip(
          clipName,
          viewPoseClipDurations[clipName],
          [],
        ),
        viewPoseRig,
      ),
    )
  }
  return samplers
}

function createViewPoseReference() {
  const reference = createPoseBuffer(viewPoseRig.boneCount)
  resetPoseToReference(reference, viewPoseRig)
  reference.positions[0] = 7
  return reference
}

function viewPoseLookState(overrides: Partial<{
  yawAngle: number
  pitchAngle: number
  yawForwardAmount: number
  yawLeftAmount: number
  yawRightAmount: number
}> = {}) {
  return {
    yawAngle: 0,
    pitchAngle: 0,
    yawForwardAmount: 0.2,
    yawLeftAmount: 0.3,
    yawRightAmount: 0.7,
    ...overrides,
  }
}

describe('AB_Als_View retained pose runtime', () => {
  it('requires every authored Look sampler by its exact clip name', () => {
    for (const missingClipName of ALS_VIEW_POSE_CLIP_NAMES) {
      const samplers = createViewPoseSamplers()
      samplers.delete(missingClipName)
      expect(() => createAlsViewPoseRuntime(
        viewPoseRig,
        createViewPoseReference(),
        (clipName) => samplers.get(clipName),
      )).toThrow(
        `AB_Als_View missing sampler: ${missingClipName}`,
      )
    }
  })

  it('rejects a lookup that aliases the wrong authored clip', () => {
    const samplers = createViewPoseSamplers()
    const forward = samplers.get('A_Als_Look_Forward')
    const down = samplers.get('A_Als_Look_Down')
    if (!forward || !down) throw new Error('Missing synthetic Look samplers')
    samplers.set('A_Als_Look_Forward', down)
    samplers.set('A_Als_Look_Down', forward)

    expect(() => createAlsViewPoseRuntime(
      viewPoseRig,
      createViewPoseReference(),
      (clipName) => samplers.get(clipName),
    )).toThrow(
      'AB_Als_View sampler mismatch: expected A_Als_Look_Forward, '
      + 'received A_Als_Look_Down',
    )
  })

  it('validates the A_Als_Stand_Pose reference bone count', () => {
    const samplers = createViewPoseSamplers()
    expect(() => createAlsViewPoseRuntime(
      viewPoseRig,
      createPoseBuffer(viewPoseRig.boneCount - 1),
      (clipName) => samplers.get(clipName),
    )).toThrow(
      'AB_Als_View reference pose bone-count mismatch: 2 !== 3',
    )
  })

  it('owns all four committed players and allocates pose resources once', () => {
    const samplers = createViewPoseSamplers()
    const reference = createViewPoseReference()
    const runtime = createAlsViewPoseRuntime(
      viewPoseRig,
      reference,
      (clipName) => samplers.get(clipName),
    )

    expect(ALS_VIEW_POSE_CLIP_NAMES).toEqual(
      ALS_LOOK_BLEND_SPACE.samples.map(
        (sample) => sample.animation.name,
      ),
    )
    expect(ALS_LOOK_STATES_MACHINE.states.map(
      ({ name }) => ({
        state: runtime.players[name].state,
        playerNodeIndex:
          runtime.players[name].binding.compiledNodeIndex,
        binding: runtime.players[name].binding,
      }),
    )).toEqual(ALS_LOOK_STATES_MACHINE.states.map(
      ({ name, playerNodeIndex }) => ({
        state: name,
        playerNodeIndex,
        binding: ALS_VIEW_PLAYERS[name],
      }),
    ))
    expect(new Set(ALS_LOOK_STATES_MACHINE.states.map(
      ({ name }) => runtime.players[name].evaluator,
    )).size).toBe(4)

    for (const clipName of ALS_VIEW_POSE_CLIP_NAMES) {
      expect(runtime.samplers[clipName]).toBe(
        samplers.get(clipName),
      )
    }
    const poseBuffers = [
      runtime.standReferencePose,
      runtime.samplePose,
      ...Object.values(runtime.statePoses),
      ...runtime.transitionOutputPoses,
      runtime.sourcePose,
      runtime.additivePose,
      runtime.viewInputPose,
      runtime.viewOutputPose,
      runtime.rootOutputPose,
    ]
    expect(poseBuffers.every(
      (pose) => pose.boneCount === viewPoseRig.boneCount,
    )).toBe(true)
    expect(new Set(poseBuffers.map((pose) => pose.data.buffer)).size)
      .toBe(poseBuffers.length)
    expect(runtime.poseAccumulator.boneCount)
      .toBe(viewPoseRig.boneCount)
    expect(runtime.meshSpaceScratch.boneCount)
      .toBe(viewPoseRig.boneCount)
    expect(runtime.transitionOutputPoses).toHaveLength(
      ALS_LOOK_STATES_MACHINE.maxTransitionsPerFrame,
    )
    expect(runtime.transitionAlphaMasks).toHaveLength(
      ALS_LOOK_STATES_MACHINE.maxTransitionsPerFrame,
    )
    expect(runtime.transitionAlphaMasks.every(
      (mask) => mask.length === viewPoseRig.boneCount,
    )).toBe(true)

    expect(runtime.standReferencePose.positions[0]).toBe(7)
    reference.positions[0] = 99
    expect(runtime.standReferencePose.positions[0]).toBe(7)
  })

  it('uses UE relevance, reinitialization, and skip-first-update semantics', () => {
    const samplers = createViewPoseSamplers()
    const runtime = createAlsViewPoseRuntime(
      viewPoseRig,
      createViewPoseReference(),
      (clipName) => samplers.get(clipName),
    )
    const lookState = viewPoseLookState({ yawAngle: 170 })

    expect(isAlsViewPoseRelevant(1e-5)).toBe(false)
    expect(isAlsViewPoseRelevant(1.00001e-5)).toBe(true)
    expect(isAlsViewPoseBecomingRelevant(runtime, 1e-5))
      .toBe(false)
    expect(isAlsViewPoseBecomingRelevant(runtime, 1.00001e-5))
      .toBe(true)
    refreshAlsViewPoseRuntime(
      runtime,
      lookState,
      1.00001e-5,
      0,
    )
    expect(runtime.graph.relevant).toBe(true)
    expect(runtime.graph.currentState).toBe('Look Forward')
    expect(isAlsViewPoseBecomingRelevant(runtime, 1)).toBe(false)

    refreshAlsViewPoseRuntime(runtime, lookState, 1, 0)
    expect(runtime.graph.currentState).toBe('Look Right Back')

    refreshAlsViewPoseRuntime(runtime, lookState, 0, 0)
    expect(runtime.graph.relevant).toBe(false)
    expect(runtime.graph.currentState).toBe('Look Forward')
    expect(ALS_LOOK_STATES_MACHINE.states.every(
      ({ name }) => runtime.players[name].sampleCount === 0,
    )).toBe(true)
    expect(isAlsViewPoseBecomingRelevant(runtime, 1)).toBe(true)
  })

  it('stores each committed pitch sample and exact explicit sampler time', () => {
    const samplers = createViewPoseSamplers()
    const runtime = createAlsViewPoseRuntime(
      viewPoseRig,
      createViewPoseReference(),
      (clipName) => samplers.get(clipName),
    )
    const posesBeforeRefresh = [
      runtime.samplePose,
      runtime.sourcePose,
      runtime.additivePose,
      runtime.viewInputPose,
      runtime.viewOutputPose,
    ].map((pose) => Array.from(pose.data))
    const lookState = viewPoseLookState({ pitchAngle: -45 })

    refreshAlsViewPoseRuntime(runtime, lookState, 1, 1 / 60)
    for (const { name } of ALS_LOOK_STATES_MACHINE.states) {
      const player = runtime.players[name]
      expect(player.pitchAngle).toBe(-45)
      expect(player.sampleCount).toBe(2)
      expect(Array.from(player.sampleIndices.slice(0, 2)))
        .toEqual([1, 0])
      expect(Array.from(player.sampleWeights.slice(0, 2)))
        .toEqual([0.5, 0.5])
      expect(player.explicitTime).toBe(
        resolveAlsViewPlayerParameters(name, lookState)
          .normalizedTime,
      )
      expect(Array.from(player.samplerTimes.slice(0, 2)))
        .toEqual([
          player.explicitTime
            * viewPoseClipDurations.A_Als_Look_Down,
          player.explicitTime
            * viewPoseClipDurations.A_Als_Look_Forward,
        ])
    }
    expect(ALS_LOOK_STATES_MACHINE.states.map(
      ({ name }) => runtime.players[name].explicitTime,
    )).toEqual([0.2, 0.3, 0.7, 0.5])

    refreshAlsViewPoseRuntime(
      runtime,
      viewPoseLookState({ pitchAngle: 45 }),
      1,
      1 / 60,
    )
    for (const { name } of ALS_LOOK_STATES_MACHINE.states) {
      const player = runtime.players[name]
      expect(Array.from(player.sampleIndices.slice(0, 2)))
        .toEqual([0, 2])
      expect(Array.from(player.sampleWeights.slice(0, 2)))
        .toEqual([0.5, 0.5])
    }

    expect([
      runtime.samplePose,
      runtime.sourcePose,
      runtime.additivePose,
      runtime.viewInputPose,
      runtime.viewOutputPose,
    ].map((pose) => Array.from(pose.data))).toEqual(
      posesBeforeRefresh,
    )
  })
})

const animatedViewPoseEndpoints = {
  A_Als_Look_Forward: {
    root: [1.8, 0.2, 0.3],
    neck_01: [0.4, 1.2, 0.2],
    head: [0.1, 0.3, 1],
    position: [8, 2, -1],
  },
  A_Als_Look_Down: {
    root: [0.2, 1.9, -0.3],
    neck_01: [-0.2, 0.3, 1.7],
    head: [1.4, -0.2, 0.4],
    position: [-3, 9, 2],
  },
  A_Als_Look_Up: {
    root: [-0.3, 0.4, 2.2],
    neck_01: [1.8, 0.1, -0.4],
    head: [0.2, 1.6, 0.3],
    position: [4, -2, 11],
  },
} as const

function animatedViewPoseClip(clipName: AlsViewPoseClipName) {
  const duration = viewPoseClipDurations[clipName]
  const endpoint = animatedViewPoseEndpoints[clipName]
  const tracks: THREE.KeyframeTrack[] = []
  for (const boneName of viewPoseRig.boneNames) {
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...endpoint[
        boneName as keyof Pick<
          typeof endpoint,
          'root' | 'neck_01' | 'head'
        >
      ]),
    )
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${boneName}.quaternion`,
      [0, duration],
      [0, 0, 0, 1, ...rotation.toArray()],
    ))
  }
  tracks.push(new THREE.VectorKeyframeTrack(
    'root.position',
    [0, duration],
    [0, 0, 0, ...endpoint.position],
  ))
  return new THREE.AnimationClip(clipName, duration, tracks)
}

function createAnimatedViewPoseFixture() {
  const samplers = new Map<
    AlsViewPoseClipName,
    CompiledClipSampler
  >()
  for (const clipName of ALS_VIEW_POSE_CLIP_NAMES) {
    samplers.set(
      clipName,
      compileClipSampler(
        animatedViewPoseClip(clipName),
        viewPoseRig,
      ),
    )
  }
  const reference = resetPoseToReference(
    createPoseBuffer(viewPoseRig.boneCount),
    viewPoseRig,
  )
  return {
    samplers,
    reference,
    runtime: createAlsViewPoseRuntime(
      viewPoseRig,
      reference,
      (clipName) => samplers.get(clipName),
    ),
  }
}

function requireAnimatedViewPoseSampler(
  samplers: ReadonlyMap<
    AlsViewPoseClipName,
    CompiledClipSampler
  >,
  sampleIndex: number,
) {
  const clipName = ALS_LOOK_BLEND_SPACE.samples[
    sampleIndex
  ].animation.name as AlsViewPoseClipName
  const sampler = samplers.get(clipName)
  if (!sampler) throw new Error(`Missing ${clipName}`)
  return sampler
}

function independentlyEvaluateViewState(
  samplers: ReadonlyMap<
    AlsViewPoseClipName,
    CompiledClipSampler
  >,
  reference: LocalPoseBuffer,
  state: AlsViewGraphState,
  lookState: ReturnType<typeof viewPoseLookState>,
) {
  const samples = evaluateBlendSpace(
    createAlsLookBlendSpaceEvaluator(),
    lookState.pitchAngle,
  )
  const parameters = resolveAlsViewPlayerParameters(
    state,
    lookState,
  )
  const accumulator = createPoseAccumulator(viewPoseRig.boneCount)
  const samplePose = createPoseBuffer(viewPoseRig.boneCount)
  for (let sample = 0; sample < samples.count; sample++) {
    const sampler = requireAnimatedViewPoseSampler(
      samplers,
      samples.sampleIndices[sample],
    )
    sampleClip(
      sampler,
      viewPoseRig,
      parameters.normalizedTime * sampler.clip.duration,
      samplePose,
      ALS_VIEW_PLAYERS[state].loop,
      reference,
    )
    accumulatePose(
      accumulator,
      samplePose,
      samples.weights[sample],
    )
  }
  return finalizePose(
    accumulator,
    reference,
    createPoseBuffer(viewPoseRig.boneCount),
  )
}

function independentlyFlattenViewLeaves(
  samplers: ReadonlyMap<
    AlsViewPoseClipName,
    CompiledClipSampler
  >,
  reference: LocalPoseBuffer,
  lookState: ReturnType<typeof viewPoseLookState>,
  states: readonly AlsViewGraphState[],
  stateWeights: readonly number[],
) {
  const samples = evaluateBlendSpace(
    createAlsLookBlendSpaceEvaluator(),
    lookState.pitchAngle,
  )
  const accumulator = createPoseAccumulator(viewPoseRig.boneCount)
  const samplePose = createPoseBuffer(viewPoseRig.boneCount)
  for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
    const parameters = resolveAlsViewPlayerParameters(
      states[stateIndex],
      lookState,
    )
    for (let sample = 0; sample < samples.count; sample++) {
      const sampler = requireAnimatedViewPoseSampler(
        samplers,
        samples.sampleIndices[sample],
      )
      sampleClip(
        sampler,
        viewPoseRig,
        parameters.normalizedTime * sampler.clip.duration,
        samplePose,
        true,
        reference,
      )
      accumulatePose(
        accumulator,
        samplePose,
        stateWeights[stateIndex] * samples.weights[sample],
      )
    }
  }
  return finalizePose(
    accumulator,
    reference,
    createPoseBuffer(viewPoseRig.boneCount),
  )
}

function expectViewPoseClose(
  actual: LocalPoseBuffer,
  expected: LocalPoseBuffer,
  precision = 5,
) {
  for (let index = 0; index < actual.positions.length; index++) {
    expect(actual.positions[index]).toBeCloseTo(
      expected.positions[index],
      precision,
    )
    expect(actual.scales[index]).toBeCloseTo(
      expected.scales[index],
      precision,
    )
  }
  for (let bone = 0; bone < actual.boneCount; bone++) {
    const offset = bone * 4
    const actualRotation = new THREE.Quaternion().fromArray(
      actual.rotations,
      offset,
    ).normalize()
    const expectedRotation = new THREE.Quaternion().fromArray(
      expected.rotations,
      offset,
    ).normalize()
    expect(actualRotation.angleTo(expectedRotation))
      .toBeLessThan(10 ** -precision)
  }
}

function viewPoseBoneAngle(
  one: LocalPoseBuffer,
  two: LocalPoseBuffer,
  bone: number,
) {
  return new THREE.Quaternion()
    .fromArray(one.rotations, bone * 4)
    .normalize()
    .angleTo(
      new THREE.Quaternion().fromArray(
        two.rotations,
        bone * 4,
      ).normalize(),
    )
}

function animatedViewInputPose(reference: LocalPoseBuffer) {
  const input = copyPose(
    reference,
    createPoseBuffer(reference.boneCount),
  )
  input.positions.set([
    1, 2, 3,
    -1, 0.5, 2,
    0, 1, -2,
  ])
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.7, -0.4, 0.2),
  ).toArray(input.rotations, 0)
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-0.3, 0.8, 0.5),
  ).toArray(input.rotations, 4)
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.2, -0.6, 0.9),
  ).toArray(input.rotations, 8)
  return input
}

describe('AB_Als_View owned pose evaluation', () => {
  it('normalizes each BlendSpace state before the transition node', () => {
    const { runtime, samplers, reference } =
      createAnimatedViewPoseFixture()
    const lookState = viewPoseLookState({ pitchAngle: -45 })
    refreshAlsViewPoseRuntime(runtime, lookState, 1, 1 / 60)
    runtime.graph.poseNode = {
      kind: 'transition',
      source: { kind: 'state', state: 'Look Forward' },
      transition: ALS_VIEW_GRAPH_TRANSITIONS[0],
      elapsed: 0.1,
    }

    evaluateAlsViewPoseRuntime(
      runtime,
      reference,
      1,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    const forward = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Forward',
      lookState,
    )
    const right = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Right Back',
      lookState,
    )
    const nested = copyPose(
      forward,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    blendPoseInPlace(
      nested,
      right,
      sampleAlsViewTransitionBlend(
        ALS_VIEW_GRAPH_TRANSITIONS[0],
        0.1,
      ),
    )
    const flattened = independentlyFlattenViewLeaves(
      samplers,
      reference,
      lookState,
      ['Look Forward', 'Look Right Back'],
      [0.5, 0.5],
    )

    expectViewPoseClose(runtime.statePoses['Look Forward'], forward)
    expectViewPoseClose(runtime.statePoses['Look Right Back'], right)
    expectViewPoseClose(runtime.sourcePose, nested)
    expect(viewPoseBoneAngle(runtime.sourcePose, flattened, 0))
      .toBeGreaterThan(1e-4)
  })

  it('uses pitch topology and each state explicit normalized time', () => {
    const { runtime, samplers, reference } =
      createAnimatedViewPoseFixture()
    const output = createPoseBuffer(viewPoseRig.boneCount)
    const early = viewPoseLookState({
      pitchAngle: 0,
      yawForwardAmount: 0.2,
    })
    refreshAlsViewPoseRuntime(runtime, early, 1, 1 / 60)
    evaluateAlsViewPoseRuntime(runtime, reference, 1, output)
    const earlyExpected = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Forward',
      early,
    )
    expectViewPoseClose(runtime.sourcePose, earlyExpected)
    const earlyRoot = new THREE.Quaternion().fromArray(
      runtime.sourcePose.rotations,
      0,
    )

    const late = viewPoseLookState({
      pitchAngle: 0,
      yawForwardAmount: 0.8,
    })
    refreshAlsViewPoseRuntime(runtime, late, 1, 1 / 60)
    evaluateAlsViewPoseRuntime(runtime, reference, 1, output)
    expectViewPoseClose(
      runtime.sourcePose,
      independentlyEvaluateViewState(
        samplers,
        reference,
        'Look Forward',
        late,
      ),
    )
    expect(earlyRoot.angleTo(
      new THREE.Quaternion().fromArray(
        runtime.sourcePose.rotations,
        0,
      ),
    )).toBeGreaterThan(0.1)

    for (const pitchAngle of [-90, 45, 90]) {
      const lookState = viewPoseLookState({
        pitchAngle,
        yawForwardAmount: 0.35,
      })
      refreshAlsViewPoseRuntime(runtime, lookState, 1, 1 / 60)
      evaluateAlsViewPoseRuntime(runtime, reference, 1, output)
      expectViewPoseClose(
        runtime.sourcePose,
        independentlyEvaluateViewState(
          samplers,
          reference,
          'Look Forward',
          lookState,
        ),
      )
    }
  })

  it('copies an irrelevant View Input byte-for-byte without pose evaluation', () => {
    const { runtime, reference } =
      createAnimatedViewPoseFixture()
    const lookState = viewPoseLookState({ pitchAngle: 45 })
    refreshAlsViewPoseRuntime(runtime, lookState, 1, 1 / 60)
    evaluateAlsViewPoseRuntime(
      runtime,
      reference,
      1,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    const retainedPoses = [
      runtime.samplePose,
      ...Object.values(runtime.statePoses),
      ...runtime.transitionOutputPoses,
      runtime.sourcePose,
      runtime.additivePose,
      runtime.viewInputPose,
      runtime.viewOutputPose,
      runtime.rootOutputPose,
    ]
    const retainedBefore = retainedPoses.map(
      (pose) => pose.data.slice(),
    )
    runtime.players['Look Forward'].sampleCount = 1
    runtime.players['Look Forward'].sampleIndices[0] = 999
    const input = animatedViewInputPose(reference)
    const output = createPoseBuffer(viewPoseRig.boneCount)
    output.data.fill(123)

    evaluateAlsViewPoseRuntime(runtime, input, 0, output)

    expect(new Uint8Array(output.data.buffer)).toEqual(
      new Uint8Array(input.data.buffer),
    )
    for (let pose = 0; pose < retainedPoses.length; pose++) {
      expect(retainedPoses[pose].data).toEqual(retainedBefore[pose])
    }
  })

  it('uses full additive then the root TwoWayBlend and supports input aliasing', () => {
    const { runtime, samplers, reference } =
      createAnimatedViewPoseFixture()
    const lookState = viewPoseLookState({
      pitchAngle: 90,
      yawForwardAmount: 0.7,
    })
    refreshAlsViewPoseRuntime(runtime, lookState, 1, 1 / 60)
    const input = animatedViewInputPose(reference)
    const output = createPoseBuffer(viewPoseRig.boneCount)
    const lookAmount = 0.35

    evaluateAlsViewPoseRuntime(runtime, input, lookAmount, output)

    const source = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Forward',
      lookState,
    )
    const additive = createPoseBuffer(viewPoseRig.boneCount)
    const fullAdditiveOutput = copyPose(
      input,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    const scratch = createMeshSpaceBlendScratch(
      viewPoseRig.boneCount,
    )
    makeDynamicAdditivePose(
      source,
      reference,
      viewPoseRig,
      additive,
      'mesh',
      scratch,
    )
    applyMeshSpaceAdditivePose(
      fullAdditiveOutput,
      additive,
      viewPoseRig,
      1,
      scratch,
    )
    const expected = copyPose(
      input,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    blendPoseInPlace(expected, fullAdditiveOutput, lookAmount)
    const shortcut = copyPose(
      input,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    applyMeshSpaceAdditivePose(
      shortcut,
      additive,
      viewPoseRig,
      lookAmount,
      scratch,
    )

    expectViewPoseClose(runtime.viewOutputPose, fullAdditiveOutput)
    expectViewPoseClose(output, expected)
    expect(viewPoseBoneAngle(output, shortcut, 0))
      .toBeGreaterThan(1e-4)

    const alias = copyPose(
      input,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    evaluateAlsViewPoseRuntime(runtime, alias, lookAmount, alias)
    expectViewPoseClose(alias, expected)
  })

  it('evaluates both side-switch transition boundaries and profile weights', () => {
    const { runtime, samplers, reference } =
      createAnimatedViewPoseFixture()
    const leftLook = viewPoseLookState({
      yawAngle: -170,
      yawForwardAmount: 0.03,
      yawLeftAmount: 0.03,
      yawRightAmount: 0.97,
      pitchAngle: -45,
    })
    refreshAlsViewPoseRuntime(runtime, leftLook, 1, 0)
    refreshAlsViewPoseRuntime(runtime, leftLook, 1, 0)
    const rightLook = viewPoseLookState({
      yawAngle: 170,
      yawForwardAmount: 0.97,
      yawLeftAmount: 0.03,
      yawRightAmount: 0.97,
      pitchAngle: -45,
    })
    refreshAlsViewPoseRuntime(runtime, rightLook, 1, 0.5)
    expect(runtime.graph.activeTransitionIndices).toEqual([5, 10])

    evaluateAlsViewPoseRuntime(
      runtime,
      reference,
      1,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    const left = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Left Back',
      rightLook,
    )
    const sideSwitch = independentlyEvaluateViewState(
      samplers,
      reference,
      'Switch Sides',
      rightLook,
    )
    const right = independentlyEvaluateViewState(
      samplers,
      reference,
      'Look Right Back',
      rightLook,
    )
    expectViewPoseClose(runtime.statePoses['Look Left Back'], left)
    expectViewPoseClose(runtime.statePoses['Switch Sides'], sideSwitch)
    expectViewPoseClose(runtime.statePoses['Look Right Back'], right)

    const profileScales = [1, 2, 2]
    const firstAlpha = sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[5],
      0.5,
    )
    const firstMask = new Float32Array(profileScales.map(
      (scale) => Math.min(1, firstAlpha * scale),
    ))
    const firstOutput = copyPose(
      left,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    blendPoseInPlace(firstOutput, sideSwitch, 1, firstMask)
    expectViewPoseClose(runtime.transitionOutputPoses[0], firstOutput)

    const secondAlpha = sampleAlsViewTransitionBlend(
      ALS_VIEW_GRAPH_TRANSITIONS[10],
      0.5,
    )
    const secondMask = new Float32Array(profileScales.map(
      (scale) => Math.min(1, secondAlpha * scale),
    ))
    const finalOutput = copyPose(
      firstOutput,
      createPoseBuffer(viewPoseRig.boneCount),
    )
    blendPoseInPlace(finalOutput, right, 1, secondMask)
    expectViewPoseClose(runtime.sourcePose, finalOutput)
    expect(viewPoseBoneAngle(runtime.sourcePose, right, 0))
      .toBeGreaterThan(1e-4)
    expect(viewPoseBoneAngle(runtime.sourcePose, right, 1))
      .toBeLessThan(1e-6)
    expect(viewPoseBoneAngle(runtime.sourcePose, right, 2))
      .toBeLessThan(1e-6)
  })

  it('rejects malformed View input and output bone counts', () => {
    const { runtime, reference } =
      createAnimatedViewPoseFixture()
    expect(() => evaluateAlsViewPoseRuntime(
      runtime,
      createPoseBuffer(viewPoseRig.boneCount - 1),
      0,
      createPoseBuffer(viewPoseRig.boneCount),
    )).toThrow(
      'AB_Als_View input pose bone-count mismatch: 2 !== 3',
    )
    expect(() => evaluateAlsViewPoseRuntime(
      runtime,
      reference,
      0,
      createPoseBuffer(viewPoseRig.boneCount - 1),
    )).toThrow(
      'AB_Als_View output pose bone-count mismatch: 2 !== 3',
    )
  })
})
