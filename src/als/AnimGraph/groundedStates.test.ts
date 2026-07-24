/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_ACCELERATION_PLAYER_OPTIONS,
  ALS_ACCELERATION_PLAYERS,
  ALS_GROUNDED_STATE_CALLBACKS,
  ALS_GROUNDED_STATE_CURVE_OUTPUTS,
  ALS_GROUNDED_STATE_PHASES,
  ALS_GROUNDED_STATES_INITIAL_SNAPSHOT,
  ALS_IDLE_POSE_EVALUATOR,
  ALS_MOVEMENT_BLEND_SPACE_PLAYER_OPTIONS,
  ALS_MOVEMENT_BLEND_SPACE_PLAYERS,
  ALS_MOVEMENT_DETAILS_STATES,
  ALS_MOVEMENT_DETAILS_TRANSITIONS,
  ALS_PIVOT_ACTIVATION_SPEED_THRESHOLD_CM_PER_SECOND,
  ALS_SPRINT_PLAYER_OPTIONS,
  ALS_SPRINT_PLAYERS,
  ALS_STANDING_GROUNDED_STATES,
  ALS_STANDING_GROUNDED_TRANSITIONS,
  ALS_STOP_POSE_EVALUATOR_OPTIONS,
  ALS_STOP_POSE_EVALUATORS,
  ALS_STOP_STATES,
  ALS_STOP_TRANSITION_ANIMATIONS,
  ALS_STOP_TRANSITIONS,
  activatePivot,
  evaluateGroundedStatesController,
  projectGroundedStatePhase,
  resetPivot,
  selectMovementDetailsTransition,
  selectStandingGroundedTransition,
  selectStopTransition,
  stopTransitionDirectionForState,
} from './groundedStates'
import type {
  AlsMovementDetailsState,
  AlsMovementDetailsTransitionInput,
  AlsStandingGroundedState,
  AlsStateTransition,
  AlsStopState,
} from './groundedStates'

interface AbpNodeParameters {
  readonly GroupName?: string
  readonly GroupRole?: string
  readonly Method?: string
  readonly PlayRate?: number
  readonly PlayRateBasis?: number
  readonly StartPosition?: number
  readonly bLoop?: boolean
  readonly bLoopAnimation?: boolean
  readonly bResetPlayTimeWhenBlendSpaceChanges?: boolean
  readonly BlendSpace?: { readonly ObjectName: string }
  readonly Sequence?: { readonly ObjectName: string }
  readonly ExplicitTime?: number
  readonly bShouldLoop?: boolean
  readonly bTeleportToExplicitTime?: boolean
  readonly ReinitializationBehavior?: string
  readonly CurveNames?: readonly string[]
  readonly CurveValues?: readonly number[]
  readonly ApplyMode?: string
  readonly BlendMode?: string
  readonly LayerSetup?: readonly {
    readonly BranchFilters: readonly {
      readonly BoneName: string
      readonly BlendDepth: number
    }[]
  }[]
  readonly BlendWeights?: readonly number[]
  readonly bMeshSpaceRotationBlend?: boolean
  readonly bMeshSpaceScaleBlend?: boolean
  readonly CurveBlendOption?: string
  readonly bBlendRootMotionBasedOnRootBone?: boolean
}

interface AbpNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: AbpNodeParameters
}

interface AbpTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly StartNotify: number
  readonly BlendMode: string
  readonly LogicType: string
}

interface AbpStateTransition {
  readonly TransitionIndex: number
  readonly bAutomaticRemainingTimeRule: boolean
  readonly rule: {
    readonly compiledDelegateIndex: number
    readonly compiledDelegateProperty: string
  }
}

interface AbpState {
  readonly StateName: string
  readonly bAlwaysResetOnEntry: boolean
  readonly PlayerNodeCompiledIndices: readonly number[]
  readonly Transitions: readonly AbpStateTransition[]
}

interface AbpStateMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly AbpState[]
  readonly Transitions: readonly AbpTransition[]
}

interface AbpGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly nodes: readonly AbpNode[]
      readonly stateMachines: readonly AbpStateMachine[]
      readonly compiledClassMetadata: {
        readonly AnimNotifies: readonly { readonly NotifyName: string }[]
      }
    }
  }
}

interface GlbAccessor {
  readonly max?: readonly number[]
}

interface GlbAnimation {
  readonly name: string
  readonly samplers: readonly { readonly input: number }[]
  readonly extras?: {
    readonly alsCurves?: readonly { readonly name: string }[]
    readonly notifies?: readonly {
      readonly name: string
      readonly time: number
    }[]
    readonly additiveType?: string
    readonly refPoseSeq?: string
    readonly refFrameIndex?: number
  }
}

interface GlbJson {
  readonly accessors: readonly GlbAccessor[]
  readonly animations: readonly GlbAnimation[]
}

const abp = (JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph).assets.AB_Als_Standing

function machine(name: string) {
  const result = abp.stateMachines.find((candidate) => (
    candidate.MachineName === name
  ))
  if (!result) throw new Error(`Missing AB_Als_Standing machine ${name}`)
  return result
}

function node(compiledIndex: number) {
  const result = abp.nodes.find((candidate) => (
    candidate.compiledIndex === compiledIndex
  ))
  if (!result) throw new Error(`Missing AB_Als_Standing node ${compiledIndex}`)
  return result
}

function objectName(value: string | undefined) {
  if (!value) return value
  const match = value.match(/'([^']+)'/)
  return match?.[1] ?? value
}

function normalizeExtractedTransition<State extends string>(
  stateMachine: AbpStateMachine,
  transitionIndex: number,
): AlsStateTransition<State> {
  const transition = stateMachine.Transitions[transitionIndex]
  const stateTransition = stateMachine.States
    .flatMap((state) => state.Transitions)
    .find((candidate) => candidate.TransitionIndex === transitionIndex)
  if (!stateTransition) {
    throw new Error(
      `Missing ${stateMachine.MachineName} baked transition ${transitionIndex}`,
    )
  }

  const notify = transition.StartNotify >= 0
    ? abp.compiledClassMetadata.AnimNotifies[transition.StartNotify].NotifyName
    : null

  return {
    transitionIndex,
    from: transition.PreviousStateName as State,
    to: transition.NextStateName as State,
    duration: transition.CrossfadeDuration,
    blendMode: transition.BlendMode.replace(
      'EAlphaBlendOption::',
      '',
    ) as 'HermiteCubic',
    logic: transition.LogicType === 'ETransitionLogicType::TLT_Inertialization'
      ? 'Inertialization'
      : 'StandardBlend',
    automaticRemainingTimeRule:
      stateTransition.bAutomaticRemainingTimeRule as false,
    startNotify: notify as 'ActivatePivot' | 'StopQuick' | null,
    compiledDelegateIndex: stateTransition.rule.compiledDelegateIndex,
    compiledDelegateProperty: stateTransition.rule.compiledDelegateProperty,
  }
}

function readGlbJson() {
  const glb = readFileSync(new URL('../../../public/assets/skm-als.glb', import.meta.url))
  const jsonChunkLength = glb.readUInt32LE(12)
  return JSON.parse(
    glb.subarray(20, 20 + jsonChunkLength).toString('utf8'),
  ) as GlbJson
}

function animationDuration(glb: GlbJson, clip: string) {
  const animation = glb.animations.find((candidate) => candidate.name === clip)
  if (!animation) throw new Error(`Missing GLB animation ${clip}`)
  return Math.max(...animation.samplers.map(({ input }) => (
    glb.accessors[input].max?.[0] ?? 0
  )))
}

function animation(glb: GlbJson, clip: string) {
  const result = glb.animations.find((candidate) => candidate.name === clip)
  if (!result) throw new Error(`Missing GLB animation ${clip}`)
  return result
}

const transitionInput = (
  overrides: Partial<AlsMovementDetailsTransitionInput> = {},
): AlsMovementDetailsTransitionInput => ({
  gait: 'Running',
  poseGroundedAmount: 1,
  unweightedGaitRunningAmount: 1,
  standingStatesMachineWeight: 1,
  pivotActive: false,
  currentStateElapsedTime: 0,
  relevantAnimationTimeRemaining: 1,
  ...overrides,
})

describe('VERIFIED AB_Als_Standing content oracle', () => {
  it('freezes all Movement Details topology and compiled delegates', () => {
    const movementDetails = machine('Movement Details States')
    expect(movementDetails.InitialState).toBe(0)
    expect(movementDetails.States[movementDetails.InitialState].StateName).toBe(
      ALS_GROUNDED_STATES_INITIAL_SNAPSHOT.movementDetailsState,
    )
    expect(movementDetails.States.map(({ StateName }) => StateName)).toEqual(
      ALS_MOVEMENT_DETAILS_STATES,
    )
    expect(movementDetails.States.every(({ bAlwaysResetOnEntry }) => (
      !bAlwaysResetOnEntry
    ))).toBe(true)
    expect(movementDetails.Transitions.map((_, index) => (
      normalizeExtractedTransition<AlsMovementDetailsState>(
        movementDetails,
        index,
      )
    ))).toEqual(ALS_MOVEMENT_DETAILS_TRANSITIONS)
  })

  it('freezes the exact Idle/Move/Stop portion of Standing States', () => {
    const standing = machine('Standing States')
    expect(standing.InitialState).toBe(0)
    expect(standing.States[standing.InitialState].StateName).toBe(
      ALS_GROUNDED_STATES_INITIAL_SNAPSHOT.standingState,
    )
    expect(standing.States.slice(0, 3).map(({ StateName }) => StateName)).toEqual(
      ALS_STANDING_GROUNDED_STATES,
    )
    expect(standing.States.every(({ bAlwaysResetOnEntry }) => (
      !bAlwaysResetOnEntry
    ))).toBe(true)
    expect(ALS_STANDING_GROUNDED_TRANSITIONS.map(({ transitionIndex }) => (
      normalizeExtractedTransition<AlsStandingGroundedState>(
        standing,
        transitionIndex,
      )
    ))).toEqual(ALS_STANDING_GROUNDED_TRANSITIONS)
  })

  it('freezes all nested Stop States topology and selection priority', () => {
    const stop = machine('Stop States')
    expect(stop.InitialState).toBe(0)
    expect(stop.States[stop.InitialState].StateName).toBe(
      ALS_GROUNDED_STATES_INITIAL_SNAPSHOT.stopState,
    )
    expect(stop.States.map(({ StateName }) => StateName)).toEqual(ALS_STOP_STATES)
    expect(stop.States.every(({ bAlwaysResetOnEntry }) => (
      !bAlwaysResetOnEntry
    ))).toBe(true)
    expect(stop.Transitions.map((_, index) => (
      normalizeExtractedTransition<AlsStopState>(stop, index)
    ))).toEqual(ALS_STOP_TRANSITIONS)
  })

  it('freezes the two generated animation notify names', () => {
    expect(abp.compiledClassMetadata.AnimNotifies.map(({ NotifyName }) => (
      NotifyName
    ))).toEqual(['ActivatePivot', 'StopQuick'])
  })

  it('freezes the six Movement sync-group BlendSpace players', () => {
    for (const player of ALS_MOVEMENT_BLEND_SPACE_PLAYERS) {
      const extracted = node(player.compiledIndex)
      expect(extracted.type).toBe('FAnimNode_BlendSpacePlayer')
      expect({
        blendSpace: objectName(extracted.parameters.BlendSpace?.ObjectName),
        groupName: extracted.parameters.GroupName,
        groupRole: extracted.parameters.GroupRole?.replace('EAnimGroupRole::', ''),
        syncMethod: extracted.parameters.Method?.replace('EAnimSyncMethod::', ''),
        startPosition: extracted.parameters.StartPosition,
        playRate: extracted.parameters.PlayRate,
        loop: extracted.parameters.bLoop,
        resetPlayTimeWhenBlendSpaceChanges:
          extracted.parameters.bResetPlayTimeWhenBlendSpaceChanges,
      }).toEqual({
        blendSpace: player.blendSpace,
        ...ALS_MOVEMENT_BLEND_SPACE_PLAYER_OPTIONS,
      })
    }
  })

  it('freezes the sprint and sprint-acceleration players', () => {
    for (const player of ALS_SPRINT_PLAYERS) {
      const extracted = node(player.compiledIndex)
      expect(extracted.type).toBe('FAnimNode_SequencePlayer')
      expect({
        clip: objectName(extracted.parameters.Sequence?.ObjectName),
        groupName: extracted.parameters.GroupName,
        groupRole: extracted.parameters.GroupRole?.replace('EAnimGroupRole::', ''),
        syncMethod: extracted.parameters.Method?.replace('EAnimSyncMethod::', ''),
        startPosition: extracted.parameters.StartPosition,
        playRate: extracted.parameters.PlayRate,
        playRateBasis: extracted.parameters.PlayRateBasis,
        loop: extracted.parameters.bLoopAnimation,
      }).toEqual({
        clip: player.clip,
        ...ALS_SPRINT_PLAYER_OPTIONS,
        playRateBasis: player.playRateBasis,
      })
    }
  })

  it('freezes every directional run-start and pivot player', () => {
    const movementDetails = machine('Movement Details States')
    const expectedPlayersByState = Object.fromEntries(
      ALS_ACCELERATION_PLAYERS.map(({ state, compiledIndices }) => [
        state,
        Object.values(compiledIndices),
      ]),
    )
    for (const state of movementDetails.States) {
      expect(state.PlayerNodeCompiledIndices).toEqual(
        expectedPlayersByState[state.StateName] ?? [],
      )
    }

    for (const state of ALS_ACCELERATION_PLAYERS) {
      for (const direction of ['Forward', 'Backward', 'Left', 'Right'] as const) {
        const extracted = node(state.compiledIndices[direction])
        expect(extracted.type).toBe('FAnimNode_SequencePlayer')
        expect({
          clip: objectName(extracted.parameters.Sequence?.ObjectName),
          groupName: extracted.parameters.GroupName,
          groupRole: extracted.parameters.GroupRole?.replace(
            'EAnimGroupRole::',
            '',
          ),
          syncMethod: extracted.parameters.Method?.replace(
            'EAnimSyncMethod::',
            '',
          ),
          startPosition: extracted.parameters.StartPosition,
          playRate: extracted.parameters.PlayRate,
          playRateBasis: extracted.parameters.PlayRateBasis,
          loop: extracted.parameters.bLoopAnimation,
        }).toEqual({
          clip: ALS_ACCELERATION_PLAYER_OPTIONS.clips[direction],
          groupName: state.groupName,
          groupRole: ALS_ACCELERATION_PLAYER_OPTIONS.groupRole,
          syncMethod: ALS_ACCELERATION_PLAYER_OPTIONS.syncMethod,
          startPosition: state.startPosition,
          playRate: ALS_ACCELERATION_PLAYER_OPTIONS.playRate,
          playRateBasis: ALS_ACCELERATION_PLAYER_OPTIONS.playRateBasis,
          loop: ALS_ACCELERATION_PLAYER_OPTIONS.loop,
        })
      }
    }
  })

  it('freezes the standing idle SequenceEvaluator', () => {
    const standing = machine('Standing States')
    expect(standing.States.find(({ StateName }) => (
      StateName === 'Idle'
    ))?.PlayerNodeCompiledIndices).toEqual([ALS_IDLE_POSE_EVALUATOR.compiledIndex])

    const extracted = node(ALS_IDLE_POSE_EVALUATOR.compiledIndex)
    expect(extracted.type).toBe('FAnimNode_SequenceEvaluator')
    expect({
      clip: objectName(extracted.parameters.Sequence?.ObjectName),
      groupName: extracted.parameters.GroupName,
      groupRole: extracted.parameters.GroupRole?.replace('EAnimGroupRole::', ''),
      syncMethod: extracted.parameters.Method?.replace('EAnimSyncMethod::', ''),
      explicitTime: extracted.parameters.ExplicitTime,
      loop: extracted.parameters.bShouldLoop,
      teleportToExplicitTime: extracted.parameters.bTeleportToExplicitTime,
      reinitializationBehavior:
        extracted.parameters.ReinitializationBehavior?.replace(
          'ESequenceEvalReinit::',
          '',
        ),
    }).toEqual({
      clip: ALS_IDLE_POSE_EVALUATOR.clip,
      groupName: ALS_IDLE_POSE_EVALUATOR.groupName,
      groupRole: ALS_IDLE_POSE_EVALUATOR.groupRole,
      syncMethod: ALS_IDLE_POSE_EVALUATOR.syncMethod,
      explicitTime: ALS_IDLE_POSE_EVALUATOR.explicitTime,
      loop: ALS_IDLE_POSE_EVALUATOR.loop,
      teleportToExplicitTime: ALS_IDLE_POSE_EVALUATOR.teleportToExplicitTime,
      reinitializationBehavior:
        ALS_IDLE_POSE_EVALUATOR.reinitializationBehavior,
    })
  })

  it('freezes all twelve stop pose samples and both leg masks', () => {
    const standing = machine('Standing States')
    expect(standing.States.find(({ StateName }) => (
      StateName === 'Stop'
    ))?.PlayerNodeCompiledIndices).toEqual([
      ...Object.values(ALS_STOP_POSE_EVALUATORS['Plant Left Foot'].compiledIndices),
      ...Object.values(ALS_STOP_POSE_EVALUATORS['Plant Right Foot'].compiledIndices),
    ])

    for (const descriptor of Object.values(ALS_STOP_POSE_EVALUATORS)) {
      for (const direction of [
        'Forward',
        'Backward',
        'LeftForward',
        'LeftBackward',
        'RightForward',
        'RightBackward',
      ] as const) {
        const extracted = node(descriptor.compiledIndices[direction])
        expect(extracted.type).toBe('FAnimNode_SequenceEvaluator')
        expect({
          clip: objectName(extracted.parameters.Sequence?.ObjectName),
          explicitTime: extracted.parameters.ExplicitTime,
          groupName: extracted.parameters.GroupName,
          groupRole: extracted.parameters.GroupRole?.replace(
            'EAnimGroupRole::',
            '',
          ),
          syncMethod: extracted.parameters.Method?.replace(
            'EAnimSyncMethod::',
            '',
          ),
          loop: extracted.parameters.bShouldLoop,
          teleportToExplicitTime: extracted.parameters.bTeleportToExplicitTime,
          reinitializationBehavior:
            extracted.parameters.ReinitializationBehavior?.replace(
              'ESequenceEvalReinit::',
              '',
            ),
        }).toEqual({
          clip: ALS_STOP_POSE_EVALUATOR_OPTIONS.clips[direction],
          explicitTime: descriptor.explicitTimes[direction],
          groupName: ALS_STOP_POSE_EVALUATOR_OPTIONS.groupName,
          groupRole: ALS_STOP_POSE_EVALUATOR_OPTIONS.groupRole,
          syncMethod: ALS_STOP_POSE_EVALUATOR_OPTIONS.syncMethod,
          loop: ALS_STOP_POSE_EVALUATOR_OPTIONS.loop,
          teleportToExplicitTime:
            ALS_STOP_POSE_EVALUATOR_OPTIONS.teleportToExplicitTime,
          reinitializationBehavior:
            ALS_STOP_POSE_EVALUATOR_OPTIONS.reinitializationBehavior,
        })
      }

      const layer = node(descriptor.layeredBoneBlend.compiledIndex)
      expect(layer.type).toBe('FAnimNode_LayeredBoneBlend')
      expect({
        blendMode: layer.parameters.BlendMode?.replace(
          'ELayeredBoneBlendMode::',
          '',
        ),
        blendWeight: layer.parameters.BlendWeights?.[0],
        branchFilters: layer.parameters.LayerSetup?.[0].BranchFilters.map(
          ({ BoneName, BlendDepth }) => ({ bone: BoneName, depth: BlendDepth }),
        ),
        meshSpaceRotationBlend: layer.parameters.bMeshSpaceRotationBlend,
        meshSpaceScaleBlend: layer.parameters.bMeshSpaceScaleBlend,
        curveBlendOption: layer.parameters.CurveBlendOption?.replace(
          'ECurveBlendOption::',
          '',
        ),
        blendRootMotionBasedOnRootBone:
          layer.parameters.bBlendRootMotionBasedOnRootBone,
      }).toEqual({
        ...ALS_STOP_POSE_EVALUATOR_OPTIONS.layeredBoneBlend,
        branchFilters: descriptor.layeredBoneBlend.branchFilters.map((bone) => ({
          bone,
          depth: 0,
        })),
      })
    }
  })

  it('freezes each ModifyCurve node owned by this controller', () => {
    const writes = [
      ...ALS_GROUNDED_STATE_CURVE_OUTPUTS.MovementDetails,
      ...ALS_GROUNDED_STATE_CURVE_OUTPUTS.Standing,
      ...ALS_GROUNDED_STATE_CURVE_OUTPUTS.Idle,
      ...Object.values(ALS_GROUNDED_STATE_CURVE_OUTPUTS.Stop).flat(),
    ]

    const writesByCompiledIndex = new Map<number, typeof writes>()
    for (const write of writes) {
      const entries = writesByCompiledIndex.get(write.compiledIndex) ?? []
      writesByCompiledIndex.set(write.compiledIndex, [...entries, write])
    }

    for (const [compiledIndex, expected] of writesByCompiledIndex) {
      const extracted = node(compiledIndex)
      expect(extracted.type).toBe('FAnimNode_ModifyCurve')
      expect(extracted.parameters.CurveNames?.map((curve, index) => ({
        compiledIndex,
        curve,
        value: extracted.parameters.CurveValues?.[index],
        applyMode: extracted.parameters.ApplyMode?.replace(
          'EModifyCurveApplyMode::',
          '',
        ),
      }))).toEqual(expected)
    }
  })

  it('freezes authored clip durations against the shipped ALS GLB', () => {
    const glb = readGlbJson()
    expect(animationDuration(glb, ALS_IDLE_POSE_EVALUATOR.clip)).toBeCloseTo(
      ALS_IDLE_POSE_EVALUATOR.duration,
      6,
    )
    for (const clip of Object.values(ALS_ACCELERATION_PLAYER_OPTIONS.clips)) {
      expect(animationDuration(glb, clip)).toBe(
        ALS_ACCELERATION_PLAYER_OPTIONS.duration,
      )
      const extras = animation(glb, clip).extras
      expect({
        additiveType: extras?.additiveType?.replace('AAT_', ''),
        referencePoseSequence: extras?.refPoseSeq,
        referenceFrameIndex: extras?.refFrameIndex,
        curveNames: extras?.alsCurves?.map(({ name }) => name),
        notifies: extras?.notifies,
      }).toEqual({
        additiveType: ALS_ACCELERATION_PLAYER_OPTIONS.additiveType,
        referencePoseSequence:
          ALS_ACCELERATION_PLAYER_OPTIONS.referencePoseSequence,
        referenceFrameIndex:
          ALS_ACCELERATION_PLAYER_OPTIONS.referenceFrameIndex,
        curveNames: ALS_ACCELERATION_PLAYER_OPTIONS.curveNames,
        notifies: ALS_ACCELERATION_PLAYER_OPTIONS.notifies,
      })
    }
    for (const player of ALS_SPRINT_PLAYERS) {
      expect(animationDuration(glb, player.clip)).toBeCloseTo(player.duration, 6)
    }
    expect(animationDuration(
      glb,
      ALS_STOP_TRANSITION_ANIMATIONS.Left.clip,
    )).toBeCloseTo(ALS_STOP_TRANSITION_ANIMATIONS.Left.duration, 6)
    expect(animationDuration(
      glb,
      ALS_STOP_TRANSITION_ANIMATIONS.Right.clip,
    )).toBeCloseTo(ALS_STOP_TRANSITION_ANIMATIONS.Right.duration, 6)
    for (const clip of [
      ALS_STOP_TRANSITION_ANIMATIONS.Left.clip,
      ALS_STOP_TRANSITION_ANIMATIONS.Right.clip,
    ]) {
      const extras = animation(glb, clip).extras
      expect({
        additiveType: extras?.additiveType?.replace('AAT_', ''),
        referencePoseSequence: extras?.refPoseSeq,
        referenceFrameIndex: extras?.refFrameIndex,
        curveNames: extras?.alsCurves?.map(({ name }) => name),
        notifies: extras?.notifies,
      }).toEqual({
        additiveType: ALS_STOP_TRANSITION_ANIMATIONS.additiveType,
        referencePoseSequence:
          ALS_STOP_TRANSITION_ANIMATIONS.referencePoseSequence,
        referenceFrameIndex:
          ALS_STOP_TRANSITION_ANIMATIONS.referenceFrameIndex,
        curveNames: ALS_STOP_TRANSITION_ANIMATIONS.curveNames,
        notifies: ALS_STOP_TRANSITION_ANIMATIONS.notifies,
      })
    }
  })
})

describe('VERIFIED Movement Details transition decisions', () => {
  it('selects the three Walk exits at their exact grounded/machine-weight cuts', () => {
    expect(selectMovementDetailsTransition('Walk', transitionInput({
      standingStatesMachineWeight: 0.999,
    }))?.transitionIndex).toBe(0)
    expect(selectMovementDetailsTransition('Walk', transitionInput({
      standingStatesMachineWeight: 1,
    }))?.transitionIndex).toBe(1)
    expect(selectMovementDetailsTransition('Walk', transitionInput({
      poseGroundedAmount: 0.999,
    }))?.transitionIndex).toBe(2)
    expect(selectMovementDetailsTransition('Walk', transitionInput({
      gait: 'Walking',
    }))).toBeNull()
  })

  it('uses relevant animation time remaining <= 0 for both run starts', () => {
    expect(selectMovementDetailsTransition(
      'Run Start From Walk',
      transitionInput({ relevantAnimationTimeRemaining: 0 }),
    )?.transitionIndex).toBe(3)
    expect(selectMovementDetailsTransition(
      'Run Start From Walk',
      transitionInput({ relevantAnimationTimeRemaining: Number.EPSILON }),
    )).toBeNull()
    expect(selectMovementDetailsTransition(
      'Run Start',
      transitionInput({ relevantAnimationTimeRemaining: 0 }),
    )?.transitionIndex).toBe(10)
  })

  it('gives Run pivot priority over the walk rule', () => {
    expect(selectMovementDetailsTransition('Run', transitionInput({
      gait: 'Walking',
      pivotActive: true,
      unweightedGaitRunningAmount: 0,
    }))?.transitionIndex).toBe(4)
    expect(selectMovementDetailsTransition('Run', transitionInput({
      gait: 'Walking',
      unweightedGaitRunningAmount: 0.199999,
    }))?.transitionIndex).toBe(5)
    expect(selectMovementDetailsTransition('Run', transitionInput({
      gait: null,
      unweightedGaitRunningAmount: 0.199999,
    }))?.transitionIndex).toBe(5)
    expect(selectMovementDetailsTransition('Run', transitionInput({
      gait: 'Walking',
      unweightedGaitRunningAmount: 0.2,
    }))).toBeNull()
  })

  it('alternates First Pivot only after 0.1 seconds, then exits on time remaining', () => {
    expect(selectMovementDetailsTransition('First Pivot', transitionInput({
      pivotActive: true,
      currentStateElapsedTime: 0.1,
    }))).toBeNull()
    expect(selectMovementDetailsTransition('First Pivot', transitionInput({
      pivotActive: true,
      currentStateElapsedTime: 0.100001,
    }))?.transitionIndex).toBe(6)
    expect(selectMovementDetailsTransition('First Pivot', transitionInput({
      relevantAnimationTimeRemaining: 0,
    }))?.transitionIndex).toBe(7)
    expect(selectMovementDetailsTransition('First Pivot', transitionInput({
      pivotActive: true,
      currentStateElapsedTime: 1,
      relevantAnimationTimeRemaining: 0,
    }))?.transitionIndex).toBe(6)
  })

  it('gives Second Pivot completion priority over another pivot alternation', () => {
    expect(selectMovementDetailsTransition('Second Pivot', transitionInput({
      pivotActive: true,
      currentStateElapsedTime: 1,
      relevantAnimationTimeRemaining: 0,
    }))?.transitionIndex).toBe(8)
    expect(selectMovementDetailsTransition('Second Pivot', transitionInput({
      pivotActive: true,
      currentStateElapsedTime: 0.100001,
    }))?.transitionIndex).toBe(9)
  })
})

describe('VERIFIED Standing and Stop transition decisions', () => {
  it('uses bMovingSmooth for Idle and Move, with full-weight Stop priority', () => {
    expect(selectStandingGroundedTransition('Idle', {
      movingSmooth: true,
      moveStateWeight: 0,
      stopStateWeight: 0,
    })?.transitionIndex).toBe(2)
    expect(selectStandingGroundedTransition('Move', {
      movingSmooth: false,
      moveStateWeight: 0.999,
      stopStateWeight: 0,
    })?.transitionIndex).toBe(4)
    expect(selectStandingGroundedTransition('Move', {
      movingSmooth: false,
      moveStateWeight: 1,
      stopStateWeight: 0,
    })?.transitionIndex).toBe(3)
    expect(selectStandingGroundedTransition('Stop', {
      movingSmooth: false,
      moveStateWeight: 1,
      stopStateWeight: 0.999,
    })).toBeNull()
    expect(selectStandingGroundedTransition('Stop', {
      movingSmooth: false,
      moveStateWeight: 1,
      stopStateWeight: 1,
    })?.transitionIndex).toBe(5)
  })

  it('preserves the exact FootPlantedAmount rule boundaries and baked priority', () => {
    expect(selectStopTransition(-1).to).toBe('Lock Right Foot')
    expect(selectStopTransition(-0.5).to).toBe('Lock Right Foot')
    expect(selectStopTransition(-0.499999).to).toBe('Plant Right Foot')
    expect(selectStopTransition(0).to).toBe('Plant Right Foot')
    expect(selectStopTransition(Number.EPSILON).to).toBe('Plant Left Foot')
    expect(selectStopTransition(0.5).to).toBe('Plant Left Foot')
    expect(selectStopTransition(0.500001).to).toBe('Lock Left Foot')
  })

  it('emits StopQuick only on the authored Move -> Idle path', () => {
    expect(ALS_STANDING_GROUNDED_TRANSITIONS.map((transition) => ({
      transition: `${transition.from} -> ${transition.to}`,
      startNotify: transition.startNotify,
    }))).toEqual([
      { transition: 'Idle -> Move', startNotify: null },
      { transition: 'Move -> Stop', startNotify: null },
      { transition: 'Move -> Idle', startNotify: 'StopQuick' },
      { transition: 'Stop -> Idle', startNotify: null },
    ])
  })
})

describe('VERIFIED grounded phase, pivot, callbacks, and controller surface', () => {
  it('projects the nested state machines onto the requested six ALS phases', () => {
    expect(ALS_GROUNDED_STATE_PHASES).toEqual([
      'Idle',
      'Move',
      'Run Start',
      'First Pivot',
      'Second Pivot',
      'Stop',
    ])
    expect(projectGroundedStatePhase('Idle', 'Run')).toBe('Idle')
    expect(projectGroundedStatePhase('Move', 'Walk')).toBe('Move')
    expect(projectGroundedStatePhase('Move', 'Run')).toBe('Move')
    expect(projectGroundedStatePhase('Move', 'Run Start')).toBe('Run Start')
    expect(projectGroundedStatePhase(
      'Move',
      'Run Start From Walk',
    )).toBe('Run Start')
    expect(projectGroundedStatePhase('Move', 'First Pivot')).toBe('First Pivot')
    expect(projectGroundedStatePhase('Move', 'Second Pivot')).toBe(
      'Second Pivot',
    )
    expect(projectGroundedStatePhase('Stop', 'Walk')).toBe('Stop')
  })

  it('ports ActivatePivot and ResetPivot at the exact 200 cm/s boundary', () => {
    expect(ALS_PIVOT_ACTIVATION_SPEED_THRESHOLD_CM_PER_SECOND).toBe(200)
    expect(activatePivot(199.999999)).toBe(true)
    expect(activatePivot(200)).toBe(false)
    expect(resetPivot()).toBe(false)
  })

  it('freezes stop animation requests and state callback ownership', () => {
    expect(ALS_STOP_TRANSITION_ANIMATIONS).toEqual({
      Left: { clip: 'A_Als_Stop_Left', duration: 2.333333 },
      Right: { clip: 'A_Als_Stop_Right', duration: 2.333333 },
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.4,
      fromStandingIdleOnly: false,
      additiveType: 'RotationOffsetMeshSpace',
      referencePoseSequence: 'A_Als_Stand_Pose',
      referenceFrameIndex: 0,
      curveNames: [
        'AllowTransitions',
        'FootLeftLock',
        'FootRightLock',
        'FootstepSoundBlock',
      ],
      notifies: [
        { name: 'BMAnimNotifyFootstep', time: 0.833333 },
        { name: 'BMAnimNotifyFootstep', time: 1.36667 },
      ],
    })
    expect(stopTransitionDirectionForState('Lock Left Foot')).toBe('Left')
    expect(stopTransitionDirectionForState('Plant Left Foot')).toBe('Left')
    expect(stopTransitionDirectionForState('Lock Right Foot')).toBe('Right')
    expect(stopTransitionDirectionForState('Plant Right Foot')).toBe('Right')
    expect(ALS_GROUNDED_STATE_CALLBACKS['First Pivot']).toEqual({
      onBecomeRelevant: { functionName: 'ResetPivot' },
    })
    expect(ALS_GROUNDED_STATE_CALLBACKS['Second Pivot']).toEqual({
      onBecomeRelevant: { functionName: 'ResetPivot' },
    })
  })

  it('only evaluates nested machines while their owning state is active', () => {
    const input = {
      movementDetails: transitionInput({ relevantAnimationTimeRemaining: 0 }),
      standing: {
        movingSmooth: false,
        moveStateWeight: 1,
        stopStateWeight: 0,
      },
      footPlantedAmount: 0.75,
    }

    expect(evaluateGroundedStatesController({
      standingState: 'Idle',
      movementDetailsState: 'Run Start',
      stopState: 'Entry',
    }, input)).toMatchObject({
      phase: 'Idle',
      movementDetailsTransition: null,
      stopTransition: null,
    })
    expect(evaluateGroundedStatesController({
      standingState: 'Move',
      movementDetailsState: 'Run Start',
      stopState: 'Entry',
    }, input)).toMatchObject({
      phase: 'Run Start',
      movementDetailsTransition: { transitionIndex: 10 },
      stopTransition: null,
    })
    expect(evaluateGroundedStatesController({
      standingState: 'Stop',
      movementDetailsState: 'Run',
      stopState: 'Entry',
    }, input)).toMatchObject({
      phase: 'Stop',
      movementDetailsTransition: null,
      stopTransition: { to: 'Lock Left Foot' },
    })
    expect(evaluateGroundedStatesController({
      standingState: 'Stop',
      movementDetailsState: 'Run',
      stopState: 'Lock Left Foot',
    }, input).stopTransition).toBeNull()
  })
})
