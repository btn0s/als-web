/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRigDefinition } from '../../engine/rig'
import {
  createMutableUePoseNode,
} from '../../engine/uePoseGraph'
import {
  AB_ALS_CROUCHING_GRAPH,
  ALS_CROUCHING_AUTOMATIC_RULE_STATUS,
  ALS_CROUCHING_GRAPH_STATE_ORDER,
  ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE,
  ALS_CROUCHING_STATE_POSE_GRAPH,
  ALS_CROUCHING_STATE_TRANSITIONS,
  ALS_CROUCHING_STOP_LEFT_BRANCH_FILTERS,
  ALS_CROUCHING_STOP_RIGHT_BRANCH_FILTERS,
  createAlsCrouchingPoseGraphRuntime,
  createAlsCrouchingStateRuntime,
  createAlsCrouchingStateWeights,
  createAlsCrouchingStrideBlendRuntime,
  evaluateAlsCrouchingPoseGraph,
  publishAlsCrouchingOutputCurve,
  refreshAlsCrouchingStateRuntime,
  refreshAlsCrouchingStrideBlend,
  resetAlsCrouchingStateRuntime,
  selectAlsCrouchingStateTransition,
} from './AB_Als_Crouching'
import type {
  AlsCrouchingPoseGraphInput,
  AlsCrouchingStateRuntimeInput,
} from './AB_Als_Crouching'

interface GraphNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface GraphTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly StartNotify: number
  readonly BlendMode: string
  readonly BlendProfile: { readonly ObjectName: string } | null
  readonly LogicType: string
}

interface GraphStateMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly {
    readonly StateName: string
    readonly StateRootNodeCompiledIndex: number
    readonly bAlwaysResetOnEntry: boolean
  }[]
  readonly Transitions: readonly GraphTransition[]
}

interface ExtractedGraph {
  readonly assets: {
    readonly AB_Als_Crouching: {
      readonly compiledNodeCount: number
      readonly bakedNodeCount: number
      readonly serializedNodeCount: number
      readonly unresolvedCompiledNodeIndices: readonly number[]
      readonly nodes: readonly GraphNode[]
      readonly stateMachines: readonly GraphStateMachine[]
    }
  }
}

interface ExtractedBlendSpaces {
  readonly blendSpaces: {
    readonly BS_Als_Lean: {
      readonly axes: readonly {
        readonly serialized: {
          readonly DisplayName: string
          readonly Min: number
          readonly Max: number
        }
      }[]
      readonly samples: readonly {
        readonly animation: { readonly name: string }
        readonly sampleValue: {
          readonly X: number
          readonly Y: number
        }
        readonly rateScale: number
      }[]
      readonly topology: {
        readonly interpolateUsingGrid: boolean
        readonly blendSpaceData: {
          readonly Triangles: readonly Record<string, number>[]
        }
        readonly gridSamples: readonly unknown[]
      }
    }
  }
}

interface ExtractedProfiles {
  readonly profiles: {
    readonly QuickFeetBlend: {
      readonly mode: string
      readonly entries: readonly {
        readonly bone: string
        readonly blendScale: number
      }[]
    }
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
const asset = graph.assets.AB_Als_Crouching

function node(compiledIndex: number) {
  const result = asset.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!result) {
    throw new Error(`Missing AB_Als_Crouching node ${compiledIndex}`)
  }
  return result
}

function machine(name: string) {
  const result = asset.stateMachines.find(
    (candidate) => candidate.MachineName === name,
  )
  if (!result) {
    throw new Error(`Missing AB_Als_Crouching state machine ${name}`)
  }
  return result
}

function runtimeInput(
  input: Partial<AlsCrouchingStateRuntimeInput> = {},
): AlsCrouchingStateRuntimeInput {
  return {
    relevant: true,
    deltaTime: 0,
    movingSmooth: false,
    rotatingLeft: false,
    rotatingRight: false,
    rotateLeftAutomaticRemainingTimeReached: false,
    rotateRightAutomaticRemainingTimeReached: false,
    ...input,
  }
}

describe('VERIFIED AB_Als_Crouching topology', () => {
  it('retains the complete recovered linked graph and outer node boundary', () => {
    expect(asset).toMatchObject({
      compiledNodeCount: 112,
      bakedNodeCount: 112,
      serializedNodeCount: 112,
      unresolvedCompiledNodeIndices: [],
    })
    expect(AB_ALS_CROUCHING_GRAPH).toMatchObject({
      linkedGraph: {
        inputPoses: [],
        receiveNotifiesFromLinkedInstances: false,
        propagateNotifiesToLinkedInstances: false,
      },
      root: { nodeIndex: 0, sourceNodeIndex: 111 },
      poseFlow: {
        root: [33, 34, 2, 111, 0],
        movementCache: [43, 42, 35, 109, 44, 1],
        idle: [31, 30, 28, 29, 26, 27, 25, 32],
        move: [1, 23, 24],
        rotateLeft: [20, 21, 22],
        rotateRight: [17, 18, 19],
        stop: [11, 15, 12, 16],
      },
      outerStateMachine: {
        nodeIndex: 33,
        machineName: 'Crouching States',
        initialState: 'Idle',
        maxTransitionsPerFrame: 3,
        maxTransitionRequests: 32,
        skipFirstUpdateTransition: true,
        reinitializeOnBecomingRelevant: true,
      },
      inertialization: {
        nodeIndex: 34,
        sourceNodeIndex: 33,
        defaultBlendProfile: null,
        filteredBones: [],
        filteredCurves: [],
        resetOnBecomingRelevant: false,
        forwardRequestsThroughSkippedCachedPoseNodes: true,
      },
      output: {
        poseCrouchingCurveNodeIndex: 2,
        poseCrouchingCurveName: 'PoseCrouching',
        poseCrouchingCurveValue: 1,
        refreshRotateInPlaceNodeIndex: 111,
      },
    })
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
  })

  it('retains fixed-pose stride blending, Movement input, and lean input seams', () => {
    expect(AB_ALS_CROUCHING_GRAPH.movementCache).toMatchObject({
      saveCachedPoseNodeIndex: 1,
      cacheName: 'Movement',
      fixedPoseEvaluator: {
        nodeIndex: 45,
        sequence: 'A_Als_Crouch_Walk_Pose',
        explicitTime: 0,
      },
      strideBlend: {
        nodeIndex: 43,
        fixedPoseNodeIndex: 45,
        movementStatesNodeIndex: 108,
        interpolationSpeedIncreasing: 10,
        interpolationSpeedDecreasing: 10,
        resetChildOnActivation: false,
        alwaysUpdateChildren: false,
      },
      applyLeanAdditive: {
        nodeIndex: 42,
        baseNodeIndex: 43,
        additiveNodeIndex: 110,
        alpha: 1,
      },
      poseMovingCurve: {
        nodeIndex: 35,
        name: 'PoseMoving',
        value: 1,
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
        Alpha: 1,
      },
    })
  })

  it('pins the exact outer states and all 12 transition payloads', () => {
    const crouching = machine('Crouching States')
    expect(crouching.InitialState).toBe(0)
    expect(crouching.States.map((state) => ({
      state: state.StateName,
      result: state.StateRootNodeCompiledIndex,
      reset: state.bAlwaysResetOnEntry,
    }))).toEqual([
      { state: 'Idle', result: 32, reset: false },
      { state: 'Move', result: 24, reset: false },
      { state: 'Rotate Left', result: 22, reset: false },
      { state: 'Rotate Right', result: 19, reset: false },
      { state: 'Stop', result: 16, reset: false },
    ])
    expect(ALS_CROUCHING_GRAPH_STATE_ORDER)
      .toEqual(crouching.States.map((state) => state.StateName))
    expect(ALS_CROUCHING_STATE_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blendMode: `EAlphaBlendOption::${transition.blendOption}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
      profile: transition.blendProfile,
      startNotify: transition.notify === 'StopQuick' ? 0 : -1,
    }))).toEqual(crouching.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blendMode: transition.BlendMode,
      logic: transition.LogicType,
      profile: transition.BlendProfile?.ObjectName.includes('QuickFeetBlend')
        ? 'QuickFeetBlend'
        : null,
      startNotify: transition.StartNotify,
    })))
    expect(ALS_CROUCHING_STATE_TRANSITIONS.map(
      (transition) => transition.priorityOrder,
    )).toEqual([1, 2, 2, 1, 2, 1, 1, 2, 1, 1, 2, 1])
  })

  it('retains Idle, Rotate, and Stop pose/lifecycle nodes without flattening them', () => {
    expect(ALS_CROUCHING_STATE_POSE_GRAPH).toMatchObject({
      Idle: {
        stateResultNodeIndex: 32,
        sequenceEvaluator: {
          nodeIndex: 31,
          sequence: 'A_Als_Crouch_Pose',
          explicitTime: 0,
        },
        forcedCurves: {
          nodeIndex: 30,
          values: {
            FootLeftLock: 1,
            FootRightLock: 1,
            AllowTransitions: 1,
          },
        },
        turnInPlaceSlot: {
          nodeIndex: 28,
          name: 'TurnInPlaceCrouching',
          alwaysUpdateSourcePose: false,
        },
      },
      Move: {
        stateResultNodeIndex: 24,
        useCachedPoseNodeIndex: 23,
        cacheName: 'Movement',
      },
      'Rotate Left': {
        stateResultNodeIndex: 22,
        sequencePlayer: {
          nodeIndex: 20,
          sequence: 'A_Als_Crouch_Rotate_90_Left',
        },
      },
      'Rotate Right': {
        stateResultNodeIndex: 19,
        sequencePlayer: {
          nodeIndex: 17,
          sequence: 'A_Als_Crouch_Rotate_90_Right',
        },
      },
      Stop: {
        stateResultNodeIndex: 16,
        useCachedMovementNodeIndex: 11,
        fixedPoseEvaluators: [
          { nodeIndex: 14, branch: 'Left' },
          { nodeIndex: 13, branch: 'Right' },
        ],
        layeredBoneBlend: {
          nodeIndex: 15,
          meshSpaceRotationBlend: true,
          meshSpaceScaleBlend: false,
          curveBlendOption: 'Override',
        },
        stateEntryFunction: {
          calls: 'PlayTransitionRightAnimation',
          sequence: 'A_Als_Crouch_Transition_Right',
          blendInDuration: 0.2,
          blendOutDuration: 0.2,
          playRate: 1.5,
          startTime: 0.2,
          fromStandingIdleOnly: false,
          slotName: 'Transition',
        },
      },
    })
    expect(ALS_CROUCHING_STOP_LEFT_BRANCH_FILTERS).toEqual([
      { boneName: 'thigh_l', blendDepth: 0 },
      { boneName: 'ik_foot_l', blendDepth: 0 },
      { boneName: 'VB foot_l', blendDepth: 0 },
    ])
    expect(ALS_CROUCHING_STOP_RIGHT_BRANCH_FILTERS).toEqual([
      { boneName: 'thigh_r', blendDepth: 0 },
      { boneName: 'ik_foot_r', blendDepth: 0 },
      { boneName: 'VB foot_r', blendDepth: 0 },
    ])
  })

  it('matches BS_Als_Lean samples/triangles and QuickFeetBlend', () => {
    const lean = blendSpaces.blendSpaces.BS_Als_Lean
    expect(AB_ALS_CROUCHING_GRAPH.lean.axes).toEqual(
      lean.axes.map((axis) => ({
        displayName: axis.serialized.DisplayName,
        minimum: axis.serialized.Min,
        maximum: axis.serialized.Max,
      })),
    )
    expect(AB_ALS_CROUCHING_GRAPH.lean.samples).toEqual(
      lean.samples.map((sample) => ({
        sequence: sample.animation.name,
        x: sample.sampleValue.X,
        y: sample.sampleValue.Y,
        rateScale: sample.rateScale,
      })),
    )
    expect(AB_ALS_CROUCHING_GRAPH.lean.triangles).toEqual(
      lean.topology.blendSpaceData.Triangles.map((triangle) => [
        triangle.SampleIndices,
        triangle['SampleIndices[1]'],
        triangle['SampleIndices[2]'],
      ]),
    )
    expect(lean.topology).toMatchObject({
      interpolateUsingGrid: false,
      gridSamples: [],
    })
    expect(AB_ALS_CROUCHING_GRAPH.lean).toMatchObject({
      interpolateUsingGrid: false,
      interpolationParameters: [],
      gridSamples: [],
    })
    expect(ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE).toEqual({
      mode: profiles.profiles.QuickFeetBlend.mode,
      entries: profiles.profiles.QuickFeetBlend.entries,
    })
  })
})

describe('VERIFIED Crouching States transition selection', () => {
  it('uses authored priority at the Move and Rotate overlap boundaries', () => {
    const weights = createAlsCrouchingStateWeights()
    weights.Idle = 0
    weights.Move = 1
    expect(selectAlsCrouchingStateTransition('Move', {
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: false,
      stateWeights: weights,
      rotateLeftAutomaticRemainingTimeReached: false,
      rotateRightAutomaticRemainingTimeReached: false,
    })).toMatchObject({
      transitionIndex: 3,
      to: 'Stop',
      priorityOrder: 1,
    })

    weights.Move = 0.999
    expect(selectAlsCrouchingStateTransition('Move', {
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: false,
      stateWeights: weights,
      rotateLeftAutomaticRemainingTimeReached: false,
      rotateRightAutomaticRemainingTimeReached: false,
    })).toMatchObject({
      transitionIndex: 4,
      to: 'Idle',
      priorityOrder: 2,
      notify: 'StopQuick',
    })

    expect(selectAlsCrouchingStateTransition('Rotate Left', {
      movingSmooth: true,
      rotatingLeft: false,
      rotatingRight: true,
      stateWeights: weights,
      rotateLeftAutomaticRemainingTimeReached: true,
      rotateRightAutomaticRemainingTimeReached: false,
    })).toMatchObject({
      transitionIndex: 5,
      rule: 'MovingSmooth',
    })
  })

  it('keeps automatic remaining-time at its explicit caller-owned engine seam', () => {
    expect(ALS_CROUCHING_AUTOMATIC_RULE_STATUS).toMatchObject({
      kind: 'hypothesis',
      unresolved: expect.stringContaining('comparison boundary'),
    })
  })
})

describe('Crouching States retained runtime', () => {
  it('reinitializes to Idle and consumes the authored skip-first update', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    expect(runtime).toMatchObject({
      relevant: true,
      currentState: 'Idle',
      transitionsTakenThisFrame: 0,
    })
    expect(runtime.stateWeights.Idle).toBe(1)
    expect(runtime.lifecycleEvents).toEqual([
      {
        kind: 'CallFunction',
        functionName: 'InitializeTurnInPlace',
        callSite: 'OnBecomeRelevant',
      },
    ])

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    expect(runtime.currentState).toBe('Move')
    expect(runtime.activeStandardTransitions[0]).toMatchObject({
      previousState: 'Idle',
      nextState: 'Move',
      elapsedTime: 0,
      alpha: 0,
      crossfadeDuration: 0.2,
    })
    expect(runtime.lifecycleEvents).toEqual([
      {
        kind: 'CallFunction',
        functionName: 'StopTransitionAndTurnInPlaceAnimations',
        callSite: 'StateExit',
        blendOutDuration: 0.2,
      },
      {
        kind: 'CallFunction',
        functionName: 'StopTransitionAndTurnInPlaceAnimations',
        callSite: 'StateEntry',
        blendOutDuration: 0.2,
      },
    ])

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.1,
      movingSmooth: true,
    }))
    expect(runtime.activeStandardTransitions[0].linearAlpha).toBe(0.5)
    expect(runtime.activeStandardTransitions[0].alpha).toBe(0.5)
    expect(runtime.stateWeights).toMatchObject({ Idle: 0.5, Move: 0.5 })
  })

  it('emits Stop entry and then begins the QuickFeetBlend return at full weight', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
      deltaTime: 0.2,
    }))
    expect(runtime.currentState).toBe('Move')
    expect(runtime.activeStandardTransitions).toHaveLength(0)

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    expect(runtime.currentState).toBe('Stop')
    expect(runtime.activeStandardTransitions[0]).toMatchObject({
      previousState: 'Move',
      nextState: 'Stop',
      crossfadeDuration: 0.1,
    })
    expect(runtime.lifecycleEvents).toEqual([
      {
        kind: 'PlayTransitionRightAnimation',
        callSite: 'StateEntry',
        sequence: 'A_Als_Crouch_Transition_Right',
        slotName: 'Transition',
        blendInDuration: 0.2,
        blendOutDuration: 0.2,
        playRate: 1.5,
        startTime: 0.2,
        fromStandingIdleOnly: false,
      },
    ])

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.1,
    }))
    expect(runtime.currentState).toBe('Stop')
    expect(runtime.activeStandardTransitions).toHaveLength(0)
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    expect(runtime.currentState).toBe('Idle')
    expect(runtime.activeStandardTransitions[0]).toMatchObject({
      previousState: 'Stop',
      nextState: 'Idle',
      crossfadeDuration: 0.5,
    })
  })

  it('resolves the formerly blocked Move-to-Idle reversal with exact stack weights', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
      deltaTime: 0.05,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: false,
    }))
    expect(runtime.activeStandardTransitions).toHaveLength(2)
    expect(runtime.activeStandardTransitions[0]).toMatchObject({
      previousState: 'Idle',
      nextState: 'Move',
      alpha: 0.15625,
      usesIntermediatePose: false,
    })
    expect(runtime.activeStandardTransitions[1]).toMatchObject({
      previousState: 'Move',
      nextState: 'Idle',
      crossfadeDuration: 0.0433349609375,
      alpha: 0,
      usesIntermediatePose: true,
    })
    expect(runtime.stateWeights.Idle).toBeCloseTo(0.84375, 7)
    expect(runtime.stateWeights.Move).toBeCloseTo(0.15625, 7)
    expect(runtime.lifecycleEvents).toEqual([
      {
        kind: 'CallFunction',
        functionName: 'InitializeTurnInPlace',
        callSite: 'OnBecomeRelevant',
      },
      {
        kind: 'AnimNotify',
        name: 'StopQuick',
        callSite: 'TransitionStart',
      },
    ])

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.0433349609375 / 2,
    }))
    expect(runtime.activeStandardTransitions[1].alpha).toBeCloseTo(0.5, 7)
    expect(runtime.stateWeights.Idle).toBeCloseTo(
      0.8534040219271901,
      7,
    )
    expect(runtime.stateWeights.Move).toBeCloseTo(
      0.14659597807280988,
      7,
    )

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.0433349609375 / 2,
    }))
    expect(runtime.activeStandardTransitions).toHaveLength(0)
    expect(runtime.stateWeights.Idle).toBe(1)
    expect(runtime.stateWeights.Move).toBe(0)
  })

  it('publishes QuickFeetBlend masks without changing scalar relevance weights', () => {
    const profile = {
      mode: 'WeightFactor',
      blendScales: new Float32Array([1, 5, 0.5]),
    } as const
    const runtime = createAlsCrouchingStateRuntime(3, profile)
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
      deltaTime: 0.2,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.1,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: 0.25,
    }))

    const active = runtime.activeStandardTransitions[0]
    expect(active.blendProfile).toBe(profile)
    expect(active.alpha).toBe(0.5)
    expect([...active.previousPoseMask]).toEqual([
      0.5,
      expect.closeTo(1 / 26, 7),
      expect.closeTo(0.8, 7),
    ])
    expect([...active.nextPoseMask]).toEqual([
      0.5,
      expect.closeTo(25 / 26, 7),
      expect.closeTo(0.2, 7),
    ])
    expect(runtime.stateWeights.Stop).toBe(0.5)
    expect(runtime.stateWeights.Idle).toBe(0.5)
  })

  it('hard-selects an inertialized target and retires older standard entries', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
      deltaTime: 0.05,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: false,
    }))
    expect(runtime.activeStandardTransitions).toHaveLength(2)

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotatingRight: true,
    }))
    expect(runtime.currentState).toBe('Rotate Right')
    expect(runtime.activeStandardTransitions).toHaveLength(0)
    expect(runtime.stateWeights['Rotate Right']).toBe(1)
    expect(runtime.inertializationRequests).toEqual([
      { nodeIndex: 34, transitionIndex: 1, duration: 0.2 },
    ])
  })

  it('forwards all inertial requests and stops at the authored maximum of three', () => {
    const runtime = createAlsCrouchingStateRuntime()
    const contradictoryRotateInput = runtimeInput({
      rotatingLeft: true,
      rotatingRight: true,
    })
    refreshAlsCrouchingStateRuntime(runtime, contradictoryRotateInput)
    refreshAlsCrouchingStateRuntime(runtime, contradictoryRotateInput)

    expect(runtime.transitionsTakenThisFrame).toBe(3)
    expect(runtime.transitionLimitReached).toBe(true)
    expect(runtime.currentState).toBe('Rotate Right')
    expect(runtime.inertializationRequests).toEqual([
      { nodeIndex: 34, transitionIndex: 1, duration: 0.2 },
      { nodeIndex: 34, transitionIndex: 10, duration: 0.2 },
      { nodeIndex: 34, transitionIndex: 7, duration: 0.2 },
    ])
    expect(runtime.activeStandardTransitions).toHaveLength(0)
  })

  it('takes rotate automatic rules only from the caller-supplied engine predicate', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotatingLeft: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotatingLeft: true,
    }))
    expect(runtime.currentState).toBe('Rotate Left')

    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    expect(runtime.currentState).toBe('Rotate Left')
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotateLeftAutomaticRemainingTimeReached: true,
    }))
    expect(runtime.currentState).toBe('Idle')
    expect(runtime.transitionsTakenThisFrame).toBe(1)
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'CallFunction',
      functionName: 'InitializeTurnInPlace',
      callSite: 'OnBecomeRelevant',
    })
  })

  it('advances a newly selected standard transition during its first update', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput())
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
      deltaTime: 0.1,
    }))
    expect(runtime.activeStandardTransitions[0]).toMatchObject({
      previousState: 'Idle',
      nextState: 'Move',
      linearAlpha: 0.5,
      alpha: 0.5,
    })
    expect(runtime.stateWeights).toMatchObject({
      Idle: 0.5,
      Move: 0.5,
    })
  })

  it('reinitializes after relevance loss and rejects invalid delta time', () => {
    const runtime = createAlsCrouchingStateRuntime()
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotatingRight: true,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      rotatingRight: true,
    }))
    expect(runtime.currentState).toBe('Rotate Right')
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      relevant: false,
    }))
    refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    expect(runtime.currentState).toBe('Idle')
    expect(runtime.transitionsTakenThisFrame).toBe(0)

    expect(resetAlsCrouchingStateRuntime(runtime)).toBe(runtime)
    expect(runtime.relevant).toBe(false)
    expect(() => refreshAlsCrouchingStateRuntime(runtime, runtimeInput({
      deltaTime: -0.01,
    }))).toThrow('delta time must be finite and non-negative')
  })
})

describe('node43 stride alpha', () => {
  it('snaps on relevance and uses the authored 10/10 FInterpTo speeds', () => {
    const runtime = createAlsCrouchingStrideBlendRuntime()
    expect(refreshAlsCrouchingStrideBlend(runtime, 0, 0.1, true)).toBe(0)
    expect(refreshAlsCrouchingStrideBlend(runtime, 1, 0.05, true)).toBe(0.5)
    expect(refreshAlsCrouchingStrideBlend(runtime, 0, 0.05, true)).toBe(0.25)
    expect(refreshAlsCrouchingStrideBlend(runtime, 0, 0.1, false)).toBe(0)
    expect(refreshAlsCrouchingStrideBlend(runtime, 0.75, 0, true)).toBe(0.75)
  })
})

function createTestRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  root.add(pelvis)

  const thighLeft = new THREE.Bone()
  thighLeft.name = 'thigh_l'
  const calfLeft = new THREE.Bone()
  calfLeft.name = 'calf_l'
  thighLeft.add(calfLeft)
  pelvis.add(thighLeft)

  const thighRight = new THREE.Bone()
  thighRight.name = 'thigh_r'
  const calfRight = new THREE.Bone()
  calfRight.name = 'calf_r'
  thighRight.add(calfRight)
  pelvis.add(thighRight)

  for (const name of [
    'ik_foot_l',
    'ik_foot_r',
    'VB foot_l',
    'VB foot_r',
  ]) {
    const bone = new THREE.Bone()
    bone.name = name
    root.add(bone)
  }
  return createRigDefinition(root)
}

function poseNode(
  boneCount: number,
  position: number,
  curves: Readonly<Record<string, number>> = {},
) {
  const node = createMutableUePoseNode(boneCount)
  for (let bone = 0; bone < boneCount; bone++) {
    node.pose.positions[bone * 3] = position
    node.pose.rotations[bone * 4 + 3] = 1
    node.pose.scales[bone * 3] = 1
    node.pose.scales[bone * 3 + 1] = 1
    node.pose.scales[bone * 3 + 2] = 1
  }
  for (const [name, value] of Object.entries(curves)) {
    node.curves.set(name, value)
  }
  return node
}

function additivePoseNode(boneCount: number, position: number) {
  const node = createMutableUePoseNode(boneCount)
  for (let bone = 0; bone < boneCount; bone++) {
    node.pose.positions[bone * 3] = position
    node.pose.rotations[bone * 4 + 3] = 1
  }
  return node
}

describe('retained AB_Als_Crouching pose nodes', () => {
  it('evaluates stride, lean, Idle slot, Rotate curves, and Stop branches in node order', () => {
    const rig = createTestRig()
    const runtime = createAlsCrouchingPoseGraphRuntime(rig)
    const input: AlsCrouchingPoseGraphInput = {
      fixedCrouchWalkPose: poseNode(rig.boneCount, 0, { PoseGait: 1 }),
      movementStatesPose: poseNode(rig.boneCount, 10, {
        MovementCurve: 1,
      }),
      leanAdditivePose: additivePoseNode(rig.boneCount, 1),
      idlePose: poseNode(rig.boneCount, 2),
      turnInPlaceMontagePose: poseNode(rig.boneCount, 4, {
        RotationYawSpeed: 4,
      }),
      turnInPlaceMontageWeight: 0.5,
      turnInPlacePlayRate: 2,
      rotateLeftPose: poseNode(rig.boneCount, 5, {
        RotationYawSpeed: -10,
      }),
      rotateRightPose: poseNode(rig.boneCount, 6, {
        RotationYawSpeed: 10,
      }),
      rotateInPlacePlayRate: 2,
      stopLeftFixedPose: poseNode(rig.boneCount, 20, {
        PoseGait: 1,
      }),
      stopRightFixedPose: poseNode(rig.boneCount, 30, {
        PoseGait: 1,
      }),
      strideBlendAlpha: 0.5,
    }

    const poses = evaluateAlsCrouchingPoseGraph(runtime, input)
    expect(poses.Move.pose.positions[0]).toBeCloseTo(6)
    expect(poses.Move.curves).toMatchObject(new Map([
      ['PoseGait', 0.5],
      ['MovementCurve', 0.5],
      ['PoseMoving', 1],
    ]))

    expect(poses.Idle.pose.positions[0]).toBeCloseTo(3)
    expect(poses.Idle.curves.get('RotationYawSpeed')).toBeCloseTo(4)
    // Node30 precedes the Slot, so an active montage receives half of its curve container here.
    expect(poses.Idle.curves.get('FootLeftLock')).toBeCloseTo(0.5)
    expect(poses.Idle.curves.get('FootRightLock')).toBeCloseTo(0.5)
    expect(poses.Idle.curves.get('AllowTransitions')).toBeCloseTo(0.5)

    expect(poses['Rotate Left'].curves.get('RotationYawSpeed')).toBe(-20)
    expect(poses['Rotate Right'].curves.get('RotationYawSpeed')).toBe(20)

    const rootIndex = rig.boneNames.indexOf('root')
    const thighLeftIndex = rig.boneNames.indexOf('thigh_l')
    const calfLeftIndex = rig.boneNames.indexOf('calf_l')
    const thighRightIndex = rig.boneNames.indexOf('thigh_r')
    const calfRightIndex = rig.boneNames.indexOf('calf_r')
    expect(poses.Stop.pose.positions[rootIndex * 3]).toBeCloseTo(6)
    expect(poses.Stop.pose.positions[thighLeftIndex * 3]).toBeCloseTo(20)
    expect(poses.Stop.pose.positions[calfLeftIndex * 3]).toBeCloseTo(20)
    expect(poses.Stop.pose.positions[thighRightIndex * 3]).toBeCloseTo(30)
    expect(poses.Stop.pose.positions[calfRightIndex * 3]).toBeCloseTo(30)
    expect(poses.Stop.curves).toMatchObject(new Map([
      ['PoseGait', 1],
      ['MovementCurve', 0.5],
      ['PoseMoving', 1],
      ['FootLeftLock', 1],
      ['FootRightLock', 1],
    ]))

    expect(publishAlsCrouchingOutputCurve(poses.Stop))
      .toBe(poses.Stop)
    expect(poses.Stop.curves.get('PoseCrouching')).toBe(1)
  })

  it('normalizes every retained TurnInPlaceCrouching montage pose as one Slot node', () => {
    const rig = createTestRig()
    const runtime = createAlsCrouchingPoseGraphRuntime(rig)
    const source = poseNode(rig.boneCount, 0)
    const poses = evaluateAlsCrouchingPoseGraph(runtime, {
      fixedCrouchWalkPose: source,
      movementStatesPose: source,
      leanAdditivePose: additivePoseNode(rig.boneCount, 0),
      idlePose: source,
      turnInPlaceMontages: [
        {
          pose: poseNode(
            rig.boneCount,
            4,
            { RotationYawSpeed: 8 },
          ),
          weight: 0.75,
        },
        {
          pose: poseNode(
            rig.boneCount,
            8,
            { RotationYawSpeed: 4 },
          ),
          weight: 0.75,
        },
      ],
      turnInPlaceMontageWeight: 0,
      turnInPlacePlayRate: 2,
      rotateLeftPose: source,
      rotateRightPose: source,
      rotateInPlacePlayRate: 1,
      stopLeftFixedPose: source,
      stopRightFixedPose: source,
      strideBlendAlpha: 0,
    })

    expect(poses.Idle.pose.positions[0]).toBeCloseTo(6, 7)
    expect(poses.Idle.curves.get('RotationYawSpeed')).toBeCloseTo(12, 7)
    expect(runtime.turnInPlaceSlotSources).toHaveLength(2)
    expect(runtime.turnInPlaceSlotWeights).toEqual([0.5, 0.5])
  })

  it('rejects non-authored lean curves at the input seam', () => {
    const rig = createTestRig()
    const runtime = createAlsCrouchingPoseGraphRuntime(rig)
    const source = poseNode(rig.boneCount, 0)
    const lean = additivePoseNode(rig.boneCount, 0)
    lean.curves.set('InventedLeanCurve', 1)
    expect(() => evaluateAlsCrouchingPoseGraph(runtime, {
      fixedCrouchWalkPose: source,
      movementStatesPose: source,
      leanAdditivePose: lean,
      idlePose: source,
      turnInPlaceMontageWeight: 0,
      turnInPlacePlayRate: 1,
      rotateLeftPose: source,
      rotateRightPose: source,
      rotateInPlacePlayRate: 1,
      stopLeftFixedPose: source,
      stopRightFixedPose: source,
      strideBlendAlpha: 0,
    })).toThrow('BS_Als_Lean additive input must not contain curves')
  })
})
