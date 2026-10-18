/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRigDefinition } from '../../engine/rig'
import {
  createMutableUePoseNode,
} from '../../engine/uePoseGraph'
import {
  AB_ALS_STANDING_GRAPH,
  ALS_STANDING_STATE_POSE_GRAPH,
  ALS_STANDING_STATE_TRANSITIONS,
  ALS_STANDING_STATES,
  ALS_STANDING_STOP_GRAPH,
  createAlsStandingGraphRuntime,
  createAlsStandingPoseGraphRuntime,
  evaluateAlsStandingPoseGraph,
  requestAlsStandingPoseGraphInertialization,
  refreshAlsStandingGraphRuntime,
  resetAlsStandingGraphRuntime,
  selectAlsStandingStateTransition,
} from './AB_Als_Standing'
import type {
  AlsAccelerationPoseInputs,
  AlsStandingGraphRuntimeInput,
  AlsStandingPoseGraphInput,
  AlsStopPoseInputs,
} from './AB_Als_Standing'
import {
  ALS_ACCELERATION_PLAYERS,
  ALS_MOVEMENT_DETAILS_STATES,
  ALS_MOVEMENT_DETAILS_TRANSITIONS,
  ALS_STOP_POSE_EVALUATORS,
  ALS_STOP_STATES,
  ALS_STOP_TRANSITIONS,
} from './groundedStates'
import {
  ALS_HIPS_DIRECTIONS,
} from './groundedLocomotion'
import type {
  AlsHipsDirection,
  AlsMovementDirection,
} from './groundedLocomotion'

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
  readonly EndNotify: number
  readonly InterruptNotify: number
  readonly BlendMode: string
  readonly CustomCurve: null
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
    readonly Transitions: readonly {
      readonly TransitionIndex: number
      readonly CanTakeDelegateIndex: number
      readonly bAutomaticRemainingTimeRule: boolean
      readonly AutomaticRuleTriggerTime: number
      readonly rule: {
        readonly compiledDelegateIndex: number
      }
    }[]
  }[]
  readonly Transitions: readonly GraphTransition[]
}

interface ExtractedGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly compiledNodeCount: number
      readonly bakedNodeCount: number
      readonly serializedNodeCount: number
      readonly unresolvedCompiledNodeIndices: readonly number[]
      readonly nodes: readonly GraphNode[]
      readonly stateMachines: readonly GraphStateMachine[]
      readonly compiledClassMetadata: {
        readonly SyncGroupNames: readonly string[]
        readonly AnimNotifies: readonly {
          readonly NotifyName: string
        }[]
      }
    }
  }
}

interface ExtractedProfiles {
  readonly profiles: {
    readonly MoveDirectionChange: {
      readonly mode: 'WeightFactor'
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
const profiles = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/skeleton-profiles.json', import.meta.url),
  'utf8',
)) as ExtractedProfiles
const asset = graph.assets.AB_Als_Standing

function node(compiledIndex: number) {
  const result = asset.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!result) throw new Error(`Missing AB_Als_Standing node ${compiledIndex}`)
  return result
}

function machine(name: string) {
  const result = asset.stateMachines.find(
    (candidate) => candidate.MachineName === name,
  )
  if (!result) throw new Error(`Missing AB_Als_Standing machine ${name}`)
  return result
}

function machineNode(compiledIndex: number) {
  return node(compiledIndex).parameters as {
    readonly StateMachineIndexInClass: number
    readonly MaxTransitionsPerFrame: number
    readonly MaxTransitionsRequests: number
    readonly bSkipFirstUpdateTransition: boolean
    readonly bReinitializeOnBecomingRelevant: boolean
    readonly bCreateNotifyMetaData: boolean
    readonly bAllowConduitEntryStates: boolean
  }
}

describe('VERIFIED AB_Als_Standing content oracle', () => {
  it('retains the complete linked graph, cache boundaries, and independent inertializers', () => {
    expect(asset).toMatchObject({
      compiledNodeCount: 204,
      bakedNodeCount: 204,
      serializedNodeCount: 204,
      unresolvedCompiledNodeIndices: [],
    })
    expect(AB_ALS_STANDING_GRAPH).toMatchObject({
      root: { nodeIndex: 0, sourceNodeIndex: 203 },
      poseFlow: {
        root: [65, 118, 68, 203, 0],
        movement: [201, 202, 120, 122, 67],
        movementDetails: [117, 119, 143, 142, 121, 66],
        idle: [61, 63, 60, 62, 58, 59, 57, 64],
        move: [66, 55, 56],
        stop: [53, 54],
        rotateLeft: [12, 13, 14],
        rotateRight: [9, 10, 11],
      },
      movementStates: {
        nodeIndex: 201,
        stateMachineIndexInClass: 0,
        maxTransitionsPerFrame: 3,
        maxTransitionRequests: 32,
        skipFirstUpdateTransition: true,
        reinitializeOnBecomingRelevant: true,
        createNotifyMetaData: true,
        allowConduitEntryStates: false,
      },
      movementDetailsStates: {
        nodeIndex: 117,
        stateMachineIndexInClass: 1,
        maxTransitionsPerFrame: 1,
        maxTransitionRequests: 32,
        skipFirstUpdateTransition: false,
        reinitializeOnBecomingRelevant: true,
        createNotifyMetaData: true,
        allowConduitEntryStates: false,
      },
      movementDetailsInertialization: {
        nodeIndex: 119,
        sourceNodeIndex: 117,
      },
      standingStates: {
        nodeIndex: 65,
        stateMachineIndexInClass: 2,
        maxTransitionsPerFrame: 3,
        maxTransitionRequests: 32,
        skipFirstUpdateTransition: true,
        reinitializeOnBecomingRelevant: true,
        createNotifyMetaData: true,
        allowConduitEntryStates: false,
      },
      stopStates: {
        nodeIndex: 53,
        stateMachineIndexInClass: 3,
        maxTransitionsPerFrame: 3,
        maxTransitionRequests: 32,
        skipFirstUpdateTransition: false,
        reinitializeOnBecomingRelevant: true,
        createNotifyMetaData: true,
        allowConduitEntryStates: false,
      },
      standingInertialization: {
        nodeIndex: 118,
        sourceNodeIndex: 65,
      },
    })
    expect(node(119)).toMatchObject({
      type: 'FAnimNode_Inertialization',
      parameters: {
        Source: { LinkID: 117 },
        DefaultBlendProfile: null,
        FilteredBones: [],
        FilteredCurves: [],
        bResetOnBecomingRelevant: false,
        bForwardRequestsThroughSkippedCachedPoseNodes: true,
      },
    })
    expect(node(118)).toMatchObject({
      type: 'FAnimNode_Inertialization',
      parameters: {
        Source: { LinkID: 65 },
        DefaultBlendProfile: null,
        FilteredBones: [],
        FilteredCurves: [],
        bResetOnBecomingRelevant: false,
        bForwardRequestsThroughSkippedCachedPoseNodes: true,
      },
    })
    expect([
      AB_ALS_STANDING_GRAPH.movementStates,
      AB_ALS_STANDING_GRAPH.movementDetailsStates,
      AB_ALS_STANDING_GRAPH.standingStates,
      AB_ALS_STANDING_GRAPH.stopStates,
    ].map((retained) => ({
      index: retained.stateMachineIndexInClass,
      maxTransitions: retained.maxTransitionsPerFrame,
      maxRequests: retained.maxTransitionRequests,
      skipFirst: retained.skipFirstUpdateTransition,
      reinitialize: retained.reinitializeOnBecomingRelevant,
      notifyMetadata: retained.createNotifyMetaData,
      conduitEntry: retained.allowConduitEntryStates,
    }))).toEqual([201, 117, 65, 53].map((compiledIndex) => {
      const extracted = machineNode(compiledIndex)
      return {
        index: extracted.StateMachineIndexInClass,
        maxTransitions: extracted.MaxTransitionsPerFrame,
        maxRequests: extracted.MaxTransitionsRequests,
        skipFirst: extracted.bSkipFirstUpdateTransition,
        reinitialize: extracted.bReinitializeOnBecomingRelevant,
        notifyMetadata: extracted.bCreateNotifyMetaData,
        conduitEntry: extracted.bAllowConduitEntryStates,
      }
    }))
  })

  it('pins all three retained state machines and every authored transition payload', () => {
    const movementDetails = machine('Movement Details States')
    const standing = machine('Standing States')
    const stop = machine('Stop States')

    expect(movementDetails.States.map((state) => state.StateName))
      .toEqual(ALS_MOVEMENT_DETAILS_STATES)
    expect(standing.States.map((state) => state.StateName))
      .toEqual(ALS_STANDING_STATES)
    expect(stop.States.map((state) => state.StateName))
      .toEqual(ALS_STOP_STATES)
    expect([
      movementDetails.InitialState,
      standing.InitialState,
      stop.InitialState,
    ]).toEqual([0, 0, 0])
    expect([
      ...movementDetails.States,
      ...standing.States,
      ...stop.States,
    ].every((state) => state.bAlwaysResetOnEntry === false)).toBe(true)

    expect(ALS_MOVEMENT_DETAILS_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blend: `EAlphaBlendOption::${transition.blendMode}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
      notify: transition.startNotify === null ? -1 : 0,
    }))).toEqual(movementDetails.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blend: transition.BlendMode,
      logic: transition.LogicType,
      notify: transition.StartNotify,
    })))
    expect(ALS_STANDING_STATE_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blend: `EAlphaBlendOption::${transition.blendOption}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
      notify: transition.notify === null ? -1 : 1,
      endNotify: transition.endNotify === null ? -1 : 0,
      interruptNotify: transition.interruptNotify === null ? -1 : 0,
      customCurve: transition.customBlendCurve,
      profile: transition.blendProfile,
    }))).toEqual(standing.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blend: transition.BlendMode,
      logic: transition.LogicType,
      notify: transition.StartNotify,
      endNotify: transition.EndNotify,
      interruptNotify: transition.InterruptNotify,
      customCurve: transition.CustomCurve,
      profile: transition.BlendProfile,
    })))
    expect(ALS_STOP_TRANSITIONS.map((transition) => ({
      from: transition.from,
      to: transition.to,
      duration: transition.duration,
      blend: `EAlphaBlendOption::${transition.blendMode}`,
      logic: `ETransitionLogicType::TLT_${transition.logic}`,
    }))).toEqual(stop.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blend: transition.BlendMode,
      logic: transition.LogicType,
    })))
  })

  it('independently pins delegate order, automatic rules, notifies, and sync groups', () => {
    const standing = machine('Standing States')
    const flattenedDelegates = standing.States.flatMap(
      (state) => state.Transitions.map((transition) => ({
        from: state.StateName,
        transitionIndex: transition.TransitionIndex,
        bakedDelegate: transition.CanTakeDelegateIndex,
        compiledDelegate: transition.rule.compiledDelegateIndex,
        automatic: transition.bAutomaticRemainingTimeRule,
        trigger: transition.AutomaticRuleTriggerTime,
      })),
    )
    expect(flattenedDelegates).toEqual(
      ALS_STANDING_STATE_TRANSITIONS.map((transition) => ({
        from: transition.from,
        transitionIndex: transition.transitionIndex,
        bakedDelegate: transition.bakedDelegateIndex,
        compiledDelegate: transition.compiledRuleNodeIndex,
        automatic: transition.automaticRemainingTimeRule,
        trigger: transition.automaticRuleTriggerTime,
      })),
    )
    expect(asset.compiledClassMetadata.AnimNotifies.map(
      (notify) => notify.NotifyName,
    )).toEqual(['ActivatePivot', 'StopQuick'])
    expect(asset.compiledClassMetadata.SyncGroupNames).toEqual([
      'Secondary Motion',
      'Movement',
      'Run Start',
      'Pivot',
      'First Pivot',
      'Second Pivot',
    ])
    expect(ALS_ACCELERATION_PLAYERS.map((player) => ({
      state: player.state,
      group: player.groupName,
      start: player.startPosition,
      nodes: Object.values(player.compiledIndices),
    }))).toEqual([
      {
        state: 'Run Start From Walk',
        group: 'Run Start',
        start: 0.1,
        nodes: [114, 113, 112, 111],
      },
      {
        state: 'First Pivot',
        group: 'First Pivot',
        start: 0.25,
        nodes: [102, 101, 100, 99],
      },
      {
        state: 'Second Pivot',
        group: 'Second Pivot',
        start: 0.25,
        nodes: [93, 92, 91, 90],
      },
      {
        state: 'Run Start',
        group: 'Run Start',
        start: 0.15,
        nodes: [84, 83, 82, 81],
      },
    ])
  })

  it('pins Idle/Rotate pose nodes and both authored stop-foot overlay trees', () => {
    expect(ALS_STANDING_STATE_POSE_GRAPH).toMatchObject({
      Idle: {
        stateResultNodeIndex: 64,
        sequenceEvaluator: {
          compiledIndex: 61,
          clip: 'A_Als_Stand_Pose',
          explicitTime: 0,
        },
        turnInPlaceSlot: {
          nodeIndex: 60,
          name: 'TurnInPlaceStanding',
        },
      },
      'Rotate Left': {
        stateResultNodeIndex: 14,
        sequencePlayer: {
          nodeIndex: 12,
          sequence: 'A_Als_Rotate_90_Left',
        },
      },
      'Rotate Right': {
        stateResultNodeIndex: 11,
        sequencePlayer: {
          nodeIndex: 9,
          sequence: 'A_Als_Rotate_90_Right',
        },
      },
    })
    for (const state of [
      'Plant Left Foot',
      'Plant Right Foot',
    ] as const) {
      const extracted = ALS_STOP_POSE_EVALUATORS[state]
      const retained = ALS_STANDING_STOP_GRAPH[state]
      expect(node(retained.layeredBoneBlendNodeIndex)).toMatchObject({
        type: 'FAnimNode_LayeredBoneBlend',
        parameters: {
          BlendWeights: [1],
          bMeshSpaceRotationBlend: true,
          bMeshSpaceScaleBlend: false,
          CurveBlendOption: 'ECurveBlendOption::Override',
          bBlendRootMotionBasedOnRootBone: true,
        },
      })
      expect(Object.values(extracted.compiledIndices).sort((a, b) => a - b))
        .toEqual(
          (state === 'Plant Left Foot'
            ? [36, 37, 38, 39, 40, 41]
            : [23, 24, 25, 26, 27, 28]),
        )
    }
  })
})

function standingWeights(
  values: Partial<Record<(typeof ALS_STANDING_STATES)[number], number>> = {},
) {
  return {
    Idle: 1,
    Move: 0,
    Stop: 0,
    'Rotate Left': 0,
    'Rotate Right': 0,
    ...values,
  }
}

describe('VERIFIED AB_Als_Standing transition delegates', () => {
  it('uses serialized outgoing order when multiple Idle and Move rules overlap', () => {
    expect(selectAlsStandingStateTransition('Idle', {
      movingSmooth: true,
      rotatingLeft: true,
      rotatingRight: true,
      stateWeights: standingWeights(),
      rotateLeftAutomaticRemainingTimeReached: false,
      rotateRightAutomaticRemainingTimeReached: false,
    })?.to).toBe('Rotate Left')

    expect(selectAlsStandingStateTransition('Move', {
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: false,
      stateWeights: standingWeights({ Idle: 0, Move: 1 }),
      rotateLeftAutomaticRemainingTimeReached: false,
      rotateRightAutomaticRemainingTimeReached: false,
    })?.to).toBe('Stop')
    expect(selectAlsStandingStateTransition('Move', {
      movingSmooth: false,
      rotatingLeft: false,
      rotatingRight: false,
      stateWeights: standingWeights({ Idle: 0, Move: 0.99 }),
      rotateLeftAutomaticRemainingTimeReached: false,
      rotateRightAutomaticRemainingTimeReached: false,
    })?.to).toBe('Idle')
  })

  it('prioritizes rotate reversal, then movement, then automatic completion', () => {
    const common = {
      movingSmooth: true,
      rotatingLeft: false,
      rotatingRight: true,
      stateWeights: standingWeights({
        Idle: 0,
        'Rotate Left': 1,
      }),
      rotateLeftAutomaticRemainingTimeReached: true,
      rotateRightAutomaticRemainingTimeReached: false,
    }
    expect(selectAlsStandingStateTransition(
      'Rotate Left',
      common,
    )?.to).toBe('Rotate Right')
    expect(selectAlsStandingStateTransition('Rotate Left', {
      ...common,
      rotatingRight: false,
    })?.duration).toBe(0.2)
    expect(selectAlsStandingStateTransition('Rotate Left', {
      ...common,
      movingSmooth: false,
      rotatingRight: false,
    })?.duration).toBe(0)
  })
})

function runtimeInput(
  input: Partial<AlsStandingGraphRuntimeInput> = {},
): AlsStandingGraphRuntimeInput {
  return {
    relevant: true,
    deltaTime: 0,
    movementDirection: 'Forward',
    hipsDirectionLockAmount: 0,
    feetCrossingAmount: 1,
    velocityBlend: {
      forwardAmount: 1,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0,
    },
    movingSmooth: false,
    rotatingLeft: false,
    rotatingRight: false,
    rotateInPlacePlayRate: 1,
    gait: 'Walking',
    poseGroundedAmount: 1,
    unweightedGaitRunningAmount: 0,
    standingStatesMachineWeight: 1,
    footPlantedAmount: -1,
    speedCmPerSecond: 0,
    ...input,
  }
}

describe('VERIFIED retained AB_Als_Standing runtime', () => {
  it('reinitializes Idle and consumes the authored outer skip-first-update', () => {
    const runtime = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    expect(runtime.standing.stack.currentState).toBe('Idle')
    expect(runtime.standing.stack.activeTransitions).toHaveLength(0)
    expect(runtime.lifecycleEvents).toEqual([
      {
        kind: 'CallFunction',
        functionName: 'InitializeTurnInPlace',
        callSite: 'OnBecomeRelevant',
      },
      {
        kind: 'CallFunction',
        functionName: 'RefreshRotateInPlace',
        callSite: 'OnUpdate',
      },
      {
        kind: 'CallFunction',
        functionName: 'RefreshTurnInPlace',
        callSite: 'OnUpdate',
      },
      {
        kind: 'CallFunction',
        functionName: 'RefreshDynamicTransitions',
        callSite: 'OnUpdate',
      },
    ])

    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    expect(runtime.standing.stack.currentState).toBe('Move')
    expect(runtime.movementDetails.relevant).toBe(true)
    expect(runtime.direction.relevant).toBe(true)
    expect(runtime.movementDetails.stack.currentState).toBe('Walk')
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'CallFunction',
      functionName: 'InitializeStandingMovement',
      callSite: 'OnBecomeRelevant',
    })
  })

  it('selects Run Start From Walk and advances one synchronized acceleration clock', () => {
    const runtime = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
      gait: 'Running',
    }))
    expect(runtime.movementDetails.stack.currentState)
      .toBe('Run Start From Walk')
    expect(runtime.accelerationClocks['Run Start From Walk']).toMatchObject({
      relevant: true,
      groupName: 'Run Start',
      time: 0.1,
      playRate: 1.25,
      loop: false,
    })

    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.4,
      movingSmooth: true,
      gait: 'Running',
    }))
    expect(runtime.accelerationClocks['Run Start From Walk'].time)
      .toBeCloseTo(0.6, 7)
    expect(runtime.movementDetails.stack.currentState)
      .toBe('Run Start From Walk')
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.4,
      movingSmooth: true,
      gait: 'Running',
    }))
    expect(runtime.accelerationClocks['Run Start From Walk'].time).toBe(1)
    // Automatic remaining time is queried before this frame advances the sequence to its end.
    expect(runtime.movementDetails.stack.currentState)
      .toBe('Run Start From Walk')
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
      gait: 'Running',
    }))
    expect(runtime.movementDetails.stack.currentState).toBe('Run')
  })

  it('turns an authored reversal notify into First/Second Pivot lifecycle', () => {
    const runtime = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
      gait: 'Running',
      poseGroundedAmount: 0,
    }))
    expect(runtime.movementDetails.stack.currentState).toBe('Run')

    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.2,
      movingSmooth: true,
      gait: 'Running',
      movementDirection: 'Backward',
      speedCmPerSecond: 150,
    }))
    expect(runtime.direction.transitionStack.currentState).toBe('Backward')
    expect(runtime.movementDetails.stack.currentState).toBe('First Pivot')
    expect(runtime.pivotActive).toBe(false)
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'AnimNotify',
      name: 'ActivatePivot',
      callSite: 'TransitionStart',
    })
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'CallFunction',
      functionName: 'ResetPivot',
      callSite: 'OnBecomeRelevant',
    })

    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.11,
      movingSmooth: true,
      gait: 'Running',
      movementDirection: 'Forward',
      speedCmPerSecond: 150,
    }))
    expect(runtime.movementDetails.stack.currentState).toBe('Second Pivot')
    expect(runtime.accelerationClocks['Second Pivot'].time)
      .toBeCloseTo(0.3875, 7)
  })

  it('enters the nested stop foot state before blending Stop back to Idle', () => {
    const runtime = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.2,
      movingSmooth: true,
    }))
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: false,
      footPlantedAmount: -0.75,
    }))

    expect(runtime.standing.stack.currentState).toBe('Idle')
    expect(runtime.standing.stack.activeTransitions[0]).toMatchObject({
      previousState: 'Stop',
      nextState: 'Idle',
      crossfadeDuration: 0.3,
    })
    expect(runtime.stop.stack.currentState).toBe('Lock Right Foot')
    expect(runtime.lifecycleEvents).toContainEqual({
      kind: 'PlayStopTransitionAnimation',
      callSite: 'StateEntry',
      direction: 'Right',
      sequence: 'A_Als_Stop_Right',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.4,
      fromStandingIdleOnly: false,
    })
  })

  it('advances a loop-bound rotate clock, then takes the authored automatic edge at its end', () => {
    const runtime = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      rotatingLeft: true,
    }))
    expect(runtime.standing.stack.currentState).toBe('Rotate Left')
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.75,
      rotatingLeft: true,
    }))
    expect(runtime.rotateClocks.left.time).toBeCloseTo(0.75, 7)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.25,
      rotatingLeft: false,
    }))
    expect(runtime.rotateClocks.left.time).toBe(1)
    expect(runtime.standing.stack.currentState).toBe('Rotate Left')
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    expect(runtime.standing.stack.currentState).toBe('Idle')
    expect(runtime.standing.stack.activeTransitions).toHaveLength(0)
  })

  it('advances newly selected outer, Movement Details, and Stop transitions in the same frame', () => {
    const outer = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(outer, runtimeInput())
    refreshAlsStandingGraphRuntime(outer, runtimeInput({
      deltaTime: 0.1,
      movingSmooth: true,
      gait: 'Walking',
    }))
    expect(outer.standing.stack.activeTransitions[0]).toMatchObject({
      previousState: 'Idle',
      nextState: 'Move',
      linearAlpha: 0.5,
      alpha: 0.5,
    })

    const movementDetails = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(movementDetails, runtimeInput())
    refreshAlsStandingGraphRuntime(movementDetails, runtimeInput({
      deltaTime: 0.1,
      movingSmooth: true,
      gait: 'Running',
      poseGroundedAmount: 0,
    }))
    expect(
      movementDetails.movementDetails.stack.activeTransitions[0],
    ).toMatchObject({
      previousState: 'Walk',
      nextState: 'Run',
      linearAlpha: 0.5,
      alpha: 0.5,
    })

    const stop = createAlsStandingGraphRuntime()
    refreshAlsStandingGraphRuntime(stop, runtimeInput())
    refreshAlsStandingGraphRuntime(stop, runtimeInput({
      deltaTime: 0.2,
      movingSmooth: true,
    }))
    refreshAlsStandingGraphRuntime(stop, runtimeInput({
      deltaTime: 0.05,
      movingSmooth: false,
      footPlantedAmount: 0,
    }))
    expect(stop.stop.stack.activeTransitions[0]).toMatchObject({
      previousState: 'Entry',
      nextState: 'Plant Right Foot',
      linearAlpha: 0.5,
      alpha: 0.5,
    })
  })

  it('resets every retained machine and clock without replacing storage', () => {
    const runtime = createAlsStandingGraphRuntime()
    const standingStack = runtime.standing.stack
    const accelerationClock =
      runtime.accelerationClocks['Run Start From Walk']
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
      gait: 'Running',
    }))
    resetAlsStandingGraphRuntime(runtime)
    expect(runtime.relevant).toBe(false)
    expect(runtime.standing.stack).toBe(standingStack)
    expect(runtime.standing.stack.currentState).toBe('Idle')
    expect(runtime.movementDetails.stack.currentState).toBe('Walk')
    expect(runtime.stop.stack.currentState).toBe('Entry')
    expect(runtime.direction.transitionStack.currentState).toBe('Forward')
    expect(runtime.accelerationClocks['Run Start From Walk'])
      .toBe(accelerationClock)
    expect(accelerationClock).toMatchObject({
      relevant: false,
      time: 0.1,
    })
  })
})

function makeRig() {
  const scene = new THREE.Group()
  const root = new THREE.Bone()
  root.name = 'root'
  scene.add(root)
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  root.add(pelvis)
  const thighLeft = new THREE.Bone()
  thighLeft.name = 'thigh_l'
  pelvis.add(thighLeft)
  const footLeft = new THREE.Bone()
  footLeft.name = 'foot_l'
  thighLeft.add(footLeft)
  const thighRight = new THREE.Bone()
  thighRight.name = 'thigh_r'
  pelvis.add(thighRight)
  const footRight = new THREE.Bone()
  footRight.name = 'foot_r'
  thighRight.add(footRight)
  const ikRoot = new THREE.Bone()
  ikRoot.name = 'ik_foot_root'
  root.add(ikRoot)
  const ikLeft = new THREE.Bone()
  ikLeft.name = 'ik_foot_l'
  ikRoot.add(ikLeft)
  const ikRight = new THREE.Bone()
  ikRight.name = 'ik_foot_r'
  ikRoot.add(ikRight)
  const virtualLeft = new THREE.Bone()
  virtualLeft.name = 'VB foot_l'
  root.add(virtualLeft)
  const virtualRight = new THREE.Bone()
  virtualRight.name = 'VB foot_r'
  root.add(virtualRight)
  return createRigDefinition(scene)
}

function poseNode(
  boneCount: number,
  x = 0,
  curves: Readonly<Record<string, number>> = {},
  additive = false,
) {
  const node = createMutableUePoseNode(boneCount)
  for (let bone = 0; bone < boneCount; bone++) {
    node.pose.positions[bone * 3] = x
    node.pose.rotations[bone * 4 + 3] = 1
    const scale = additive ? 0 : 1
    node.pose.scales[bone * 3] = scale
    node.pose.scales[bone * 3 + 1] = scale
    node.pose.scales[bone * 3 + 2] = scale
  }
  for (const [name, value] of Object.entries(curves)) {
    node.curves.set(name, value)
  }
  return node
}

function poseInput(
  boneCount: number,
  input: Partial<AlsStandingPoseGraphInput> = {},
): AlsStandingPoseGraphInput {
  const movementStatePoses = {} as Record<
    AlsHipsDirection,
    ReturnType<typeof poseNode>
  >
  ALS_HIPS_DIRECTIONS.forEach((direction, index) => {
    movementStatePoses[direction] = poseNode(
      boneCount,
      index + 1,
      { MovementCurve: index + 1 },
    )
  })
  const accelerationPoses = {} as Record<
    (typeof ALS_ACCELERATION_PLAYERS)[number]['state'],
    Record<AlsMovementDirection, ReturnType<typeof poseNode>>
  >
  for (const player of ALS_ACCELERATION_PLAYERS) {
    accelerationPoses[player.state] = {
      Forward: poseNode(boneCount, 0.5, {}, true),
      Backward: poseNode(boneCount, 1, {}, true),
      Left: poseNode(boneCount, 1.5, {}, true),
      Right: poseNode(boneCount, 2, {}, true),
    }
  }
  const stopPoses = {} as Record<
    'Plant Left Foot' | 'Plant Right Foot',
    Record<AlsHipsDirection, ReturnType<typeof poseNode>>
  >
  for (const state of [
    'Plant Left Foot',
    'Plant Right Foot',
  ] as const) {
    stopPoses[state] = {} as Record<
      AlsHipsDirection,
      ReturnType<typeof poseNode>
    >
    ALS_HIPS_DIRECTIONS.forEach((direction, index) => {
      stopPoses[state][direction] = poseNode(
        boneCount,
        20 + index,
        { StopCurve: 20 + index },
      )
    })
  }

  return {
    movementStatePoses,
    leanAdditivePose: poseNode(boneCount, 0, {}, true),
    accelerationPoses: accelerationPoses as AlsAccelerationPoseInputs,
    idlePose: poseNode(boneCount, 0, { IdleCurve: 1 }),
    turnInPlaceMontageWeight: 0,
    turnInPlacePlayRate: 1,
    rotateLeftPose: poseNode(
      boneCount,
      10,
      { RotationYawSpeed: 2 },
    ),
    rotateRightPose: poseNode(
      boneCount,
      -10,
      { RotationYawSpeed: 3 },
    ),
    rotateInPlacePlayRate: 1,
    stopPoses: stopPoses as AlsStopPoseInputs,
    velocityBlend: {
      forwardAmount: 1,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0,
    },
    deltaTime: 0,
    ...input,
  }
}

describe('VERIFIED retained AB_Als_Standing pose evaluation', () => {
  it('evaluates authored Idle curves, slot complement, yaw scaling, and PoseStanding', () => {
    const rig = makeRig()
    const runtime = createAlsStandingGraphRuntime(rig.boneCount)
    const poseGraph = createAlsStandingPoseGraphRuntime(rig)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    const input = poseInput(rig.boneCount, {
      turnInPlaceMontagePose: poseNode(
        rig.boneCount,
        4,
        { RotationYawSpeed: 8 },
      ),
      turnInPlaceMontageWeight: 0.25,
      turnInPlacePlayRate: 2,
    })
    const output = evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      input,
    )
    expect(output.pose.positions[0]).toBeCloseTo(1, 7)
    expect(output.curves.get('FootLeftLock')).toBeCloseTo(0.75, 7)
    expect(output.curves.get('FootRightLock')).toBeCloseTo(0.75, 7)
    expect(output.curves.get('AllowTransitions')).toBeCloseTo(0.75, 7)
    expect(output.curves.get('RotationYawSpeed')).toBe(4)
    expect(output.curves.get('PoseStanding')).toBe(1)
  })

  it('normalizes every retained TurnInPlaceStanding montage pose as one Slot node', () => {
    const rig = makeRig()
    const runtime = createAlsStandingGraphRuntime(rig.boneCount)
    const poseGraph = createAlsStandingPoseGraphRuntime(rig)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    const output = evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount, {
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
        turnInPlacePlayRate: 2,
      }),
    )

    expect(output.pose.positions[0]).toBeCloseTo(6, 7)
    expect(output.curves.get('RotationYawSpeed')).toBeCloseTo(12, 7)
    expect(poseGraph.turnInPlaceSlotSources).toHaveLength(2)
    expect(poseGraph.turnInPlaceSlotWeights).toEqual([0.5, 0.5])
  })

  it('retains direction and Movement Details transitions before applying acceleration additive', () => {
    const rig = makeRig()
    const profile = {
      mode: profiles.profiles.MoveDirectionChange.mode,
      blendScales: new Float32Array(rig.boneCount).fill(1),
    } as const
    const runtime = createAlsStandingGraphRuntime(
      rig.boneCount,
      profile,
    )
    const poseGraph = createAlsStandingPoseGraphRuntime(rig)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
      gait: 'Running',
    }))
    const output = evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount),
    )
    // Run Start From Walk applies Forward acceleration (0.5) over Forward movement (1).
    expect(poseGraph.nodes.movement.pose.positions[0]).toBe(1)
    expect(
      poseGraph.nodes.accelerationStates['Run Start From Walk']
        .pose.positions[0],
    ).toBeCloseTo(1.5, 7)
    // The outer Idle->Move standard blend starts at alpha zero on the transition frame.
    expect(output.pose.positions[0]).toBe(0)
    expect(
      runtime.direction.transitionStack.boneCount,
    ).toBe(rig.boneCount)
    expect(runtime.direction.moveDirectionChangeBlendProfile).toBe(profile)
  })

  it('overlays only the authored planted-foot branches and uses Override curves', () => {
    const rig = makeRig()
    const runtime = createAlsStandingGraphRuntime(rig.boneCount)
    const poseGraph = createAlsStandingPoseGraphRuntime(rig)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: true,
    }))
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.2,
      movingSmooth: true,
    }))
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      movingSmooth: false,
      footPlantedAmount: 0.25,
    }))
    expect(runtime.stop.stack.currentState).toBe('Plant Left Foot')

    const output = evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount),
    )
    const rootIndex = rig.boneNames.indexOf('root')
    const thighLeftIndex = rig.boneNames.indexOf('thigh_l')
    const thighRightIndex = rig.boneNames.indexOf('thigh_r')
    expect(
      poseGraph.nodes.stopPlantLeft.pose.positions[rootIndex * 3],
    ).toBe(1)
    expect(
      poseGraph.nodes.stopPlantLeft.pose.positions[thighLeftIndex * 3],
    ).toBe(20)
    expect(
      poseGraph.nodes.stopPlantLeft.pose.positions[thighRightIndex * 3],
    ).toBe(1)
    expect(poseGraph.nodes.stopPlantLeft.curves.get('StopCurve')).toBe(20)
    expect(poseGraph.nodes.stopPlantLeft.curves.get('FootLeftLock')).toBe(1)
    expect(output.curves.get('PoseStanding')).toBe(1)
  })

  it('keeps node118 history across an authored rotate reversal', () => {
    const rig = makeRig()
    const runtime = createAlsStandingGraphRuntime(rig.boneCount)
    const poseGraph = createAlsStandingPoseGraphRuntime(rig)
    refreshAlsStandingGraphRuntime(runtime, runtimeInput())
    evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount, { deltaTime: 1 / 60 }),
    )
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      rotatingLeft: true,
    }))
    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      deltaTime: 0.2,
      rotatingLeft: true,
    }))
    evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount, { deltaTime: 0.2 }),
    )

    refreshAlsStandingGraphRuntime(runtime, runtimeInput({
      rotatingRight: true,
    }))
    expect(runtime.inertializationRequests).toContainEqual({
      nodeIndex: 118,
      transitionIndex: 6,
      duration: 0.2,
    })
    requestAlsStandingPoseGraphInertialization(poseGraph, runtime)
    const output = evaluateAlsStandingPoseGraph(
      poseGraph,
      runtime,
      poseInput(rig.boneCount, { deltaTime: 1 / 60 }),
    )
    expect(output.pose.positions[0]).toBeGreaterThan(-10)
    expect(poseGraph.standingInertialization.pose.active).toBe(true)
  })
})
