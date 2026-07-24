/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AuthoredBlendSpace } from '../../engine/blendSpace'
import {
  ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND,
  ALS_GROUNDED_DIRECTION_PLAYER,
  ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS,
  ALS_GROUNDED_DIRECTION_STATES,
  ALS_GROUNDED_DIRECTION_TRANSITIONS,
  ALS_HIPS_DIRECTIONS,
  ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND,
  authoredDirectionTransitions,
  calculateMovementDirection,
  createGroundedLocomotionGraph,
  evaluateGroundedLocomotionGraph,
  refreshMovementDirection,
  refreshPoseGait,
  refreshStandingMovement,
  sampleStrideBlendAmountRun,
  sampleStrideBlendAmountWalk,
  selectGroundedDirectionState,
} from './groundedLocomotion'
import type {
  AlsGait,
  AlsHipsDirection,
  AlsStandingMovementInput,
} from './groundedLocomotion'

interface ExtractedBlendSpaces {
  readonly blendSpaces: Readonly<Record<string, AuthoredBlendSpace>>
}

interface ExtractedMovementSettings {
  readonly settings: {
    readonly rotationModes: Readonly<Record<string, {
      readonly stances: {
        readonly 'Als.Stance.Standing': {
          readonly WalkForwardSpeed: number
          readonly WalkBackwardSpeed: number
          readonly RunForwardSpeed: number
          readonly RunBackwardSpeed: number
          readonly SprintSpeed: number
        }
      }
    }>>
  }
}

interface AbpTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly StartNotify: number
  readonly BlendMode: string
  readonly BlendProfile: {
    readonly ObjectName: string
  } | null
}

interface AbpState {
  readonly StateName: string
  readonly bAlwaysResetOnEntry: boolean
  readonly Transitions: readonly {
    readonly CanTakeDelegateIndex: number
    readonly TransitionIndex: number
  }[]
}

interface AbpGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly nodes: readonly {
        readonly compiledIndex: number | null
        readonly type: string
        readonly parameters: {
          readonly GroupName?: string
          readonly GroupRole?: string
          readonly Method?: string
          readonly bLoop?: boolean
          readonly bResetPlayTimeWhenBlendSpaceChanges?: boolean
          readonly StartPosition?: number
          readonly BlendSpace?: {
            readonly ObjectName: string
          }
        }
      }[]
      readonly stateMachines: readonly {
        readonly MachineName: string
        readonly InitialState: number
        readonly States: readonly AbpState[]
        readonly Transitions: readonly AbpTransition[]
      }[]
      readonly compiledClassMetadata: {
        readonly AnimNotifies: readonly {
          readonly NotifyName: string
        }[]
      }
    }
  }
}

const blendSpaces = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/blend-spaces.json', import.meta.url),
  'utf8',
)) as ExtractedBlendSpaces

const movementSettings = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/movement-settings.json', import.meta.url),
  'utf8',
)) as ExtractedMovementSettings

const abpGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

function denseClipWeights(
  weights: ReturnType<typeof evaluateGroundedLocomotionGraph>,
) {
  return Object.fromEntries(weights.map((entry) => [entry.clip, entry.weight]))
}

function independentCubic(
  from: number,
  fromTangent: number,
  to: number,
  toTangent: number,
  amount: number,
) {
  const a2 = amount * amount
  const a3 = a2 * amount
  return (
    from * (2 * a3 - 3 * a2 + 1)
    + fromTangent * (a3 - 2 * a2 + amount)
    + to * (-2 * a3 + 3 * a2)
    + toTangent * (a3 - a2)
  )
}

function referencePoseGait(poseGait: number, poseGrounded: number) {
  const amount = Math.min(Math.max(poseGait, 0), 3)
  const unweighted = poseGrounded > 1e-8 ? amount / poseGrounded : amount
  const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)
  return {
    gaitAmount: amount,
    gaitWalkingAmount: clamp01(amount),
    gaitRunningAmount: clamp01(amount - 1),
    gaitSprintingAmount: clamp01(amount - 2),
    unweightedGaitAmount: unweighted,
    unweightedGaitWalkingAmount: clamp01(unweighted),
    unweightedGaitRunningAmount: clamp01(unweighted - 1),
    unweightedGaitSprintingAmount: clamp01(unweighted - 2),
  }
}

function referenceStandingMovement(input: AlsStandingMovementInput) {
  const speed = input.locomotionSpeed / input.locomotionScale
  const pose = referencePoseGait(
    input.poseGaitCurveValue,
    input.poseGroundedCurveValue,
  )
  const stride = (
    sampleStrideBlendAmountWalk(speed)
    + (
      sampleStrideBlendAmountRun(speed)
      - sampleStrideBlendAmountWalk(speed)
    ) * pose.unweightedGaitRunningAmount
  )
  const walkRunSpeed = (
    speed / 150
    + (speed / 350 - speed / 150) * pose.unweightedGaitRunningAmount
  )
  const sprintSpeed = (
    walkRunSpeed
    + (speed / 600 - walkRunSpeed) * pose.unweightedGaitSprintingAmount
  )
  return {
    speed,
    strideBlendAmount: stride,
    walkRunBlendAmount: input.gait === 'Walking' ? 0 : 1,
    playRate: Math.min(Math.max(sprintSpeed / stride, 1e-4), 3),
    poseGait: pose,
  }
}

function hipsDirectionFromStateName(stateName: string): AlsHipsDirection {
  const direction = stateName.replace(/^Move /, '').replaceAll(' ', '')
  if (!ALS_HIPS_DIRECTIONS.includes(direction as AlsHipsDirection)) {
    throw new Error(`Unexpected ALS direction state ${stateName}`)
  }
  return direction as AlsHipsDirection
}

describe('VERIFIED ALS standing movement math', () => {
  it('samples the authored stride rich-curve keys and cubic tangents', () => {
    expect(sampleStrideBlendAmountWalk(-100)).toBe(0.2)
    expect(sampleStrideBlendAmountWalk(0)).toBe(0.2)
    expect(sampleStrideBlendAmountWalk(58.3)).toBeCloseTo(0.54999995, 12)
    expect(sampleStrideBlendAmountWalk(150)).toBe(1)
    expect(sampleStrideBlendAmountWalk(1_000)).toBe(1)

    expect(sampleStrideBlendAmountRun(0)).toBe(0.2)
    expect(sampleStrideBlendAmountRun(166.9)).toBeCloseTo(0.45000002, 12)
    expect(sampleStrideBlendAmountRun(350)).toBe(1)

    const walkDuration = 58.3
    expect(sampleStrideBlendAmountWalk(walkDuration * 0.5)).toBeCloseTo(
      independentCubic(
        0.2,
        0,
        0.54999995,
        0.012879322 * walkDuration,
        0.5,
      ),
      12,
    )
    const runDuration = 166.9
    expect(sampleStrideBlendAmountRun(runDuration * 0.5)).toBeCloseTo(
      independentCubic(
        0.2,
        0,
        0.45000002,
        0.0033657213 * runDuration,
        0.5,
      ),
      12,
    )
  })

  it.each([
    [-1, 0],
    [0, 0],
    [1, 1],
    [1.5, 0.5],
    [2, 1],
    [2.5, 0.25],
    [3, 1],
    [4, 0.75],
  ])(
    'matches the line-mirrored RefreshPose gait calculation at (%s, %s)',
    (poseGait, poseGrounded) => {
      expect(refreshPoseGait(poseGait, poseGrounded)).toEqual(
        referencePoseGait(poseGait, poseGrounded),
      )
    },
  )

  it.each([
    [0, 1, 'Walking', 0, 1],
    [75, 1, 'Walking', 1, 1],
    [175, 1, 'Walking', 1, 1],
    [375, 1, 'Running', 2, 1],
    [650, 1, 'Sprinting', 3, 1],
    [375, 1.5, 'Running', 2, 0.5],
  ] as const)(
    'matches RefreshStandingMovement at speed=%s scale=%s gait=%s',
    (
      locomotionSpeed,
      locomotionScale,
      gait,
      poseGaitCurveValue,
      poseGroundedCurveValue,
    ) => {
      const input = {
        locomotionSpeed,
        locomotionScale,
        gait,
        poseGaitCurveValue,
        poseGroundedCurveValue,
      }
      expect(refreshStandingMovement(input)).toEqual(
        referenceStandingMovement(input),
      )
    },
  )

  it('uses animated 150/350/600 denominators, not gameplay 175/375/650 limits', () => {
    expect(ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND).toEqual({
      animatedWalkSpeed: 150,
      animatedRunSpeed: 350,
      animatedSprintSpeed: 600,
    })
    expect(
      ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND.ViewDirection,
    ).toEqual({
      walkForwardSpeed: 175,
      walkBackwardSpeed: 175,
      runForwardSpeed: 375,
      runBackwardSpeed: 375,
      sprintSpeed: 650,
    })

    const state = refreshStandingMovement({
      locomotionSpeed: 150,
      locomotionScale: 1,
      gait: 'Walking',
      poseGaitCurveValue: 1,
      poseGroundedCurveValue: 1,
    })
    expect(state.strideBlendAmount).toBe(1)
    expect(state.playRate).toBe(1)
  })

  it('matches UAlsMath::CalculateMovementDirection branch order and sprint override', () => {
    expect(calculateMovementDirection(-180)).toBe('Backward')
    expect(calculateMovementDirection(-115)).toBe('Left')
    expect(calculateMovementDirection(-75)).toBe('Forward')
    expect(calculateMovementDirection(0)).toBe('Forward')
    expect(calculateMovementDirection(75)).toBe('Forward')
    expect(calculateMovementDirection(115)).toBe('Right')
    expect(calculateMovementDirection(180)).toBe('Backward')

    expect(refreshMovementDirection('VelocityDirection', 'Running', 110))
      .toBe('Forward')
    expect(refreshMovementDirection('ViewDirection', 'Sprinting', -110))
      .toBe('Forward')
    expect(refreshMovementDirection('ViewDirection', 'Running', -110))
      .toBe('Left')
  })
})

describe('VERIFIED ALS content-oracle graph', () => {
  const graph = createGroundedLocomotionGraph(blendSpaces.blendSpaces)

  it('matches all six AB_Als_Standing BlendSpace players and static player settings', () => {
    const players = abpGraph.assets.AB_Als_Standing.nodes.filter(
      (node) =>
        node.type === 'FAnimNode_BlendSpacePlayer'
        && node.parameters.BlendSpace?.ObjectName.includes('WalkRun'),
    )
    const extractedPlayers = Object.fromEntries(players.map((node) => {
      const match = /BlendSpace'([^']+)'/.exec(
        node.parameters.BlendSpace?.ObjectName ?? '',
      )
      if (!match) throw new Error('Malformed ALS BlendSpace object name')
      return [match[1], {
        compiledPlayerNodeIndex: node.compiledIndex,
        groupName: node.parameters.GroupName,
        groupRole: node.parameters.GroupRole?.replace('EAnimGroupRole::', ''),
        method: node.parameters.Method?.replace('EAnimSyncMethod::', ''),
        loop: node.parameters.bLoop,
        reset: node.parameters.bResetPlayTimeWhenBlendSpaceChanges,
        startPosition: node.parameters.StartPosition,
      }]
    }))

    expect(Object.keys(extractedPlayers)).toHaveLength(6)
    for (const direction of ALS_HIPS_DIRECTIONS) {
      const state = ALS_GROUNDED_DIRECTION_STATES[direction]
      expect(extractedPlayers[state.blendSpaceName]).toEqual({
        compiledPlayerNodeIndex: state.compiledPlayerNodeIndex,
        groupName: ALS_GROUNDED_DIRECTION_PLAYER.syncGroupName,
        groupRole: ALS_GROUNDED_DIRECTION_PLAYER.syncGroupRole,
        method: ALS_GROUNDED_DIRECTION_PLAYER.syncMethod,
        loop: ALS_GROUNDED_DIRECTION_PLAYER.loop,
        reset:
          ALS_GROUNDED_DIRECTION_PLAYER.resetPlayTimeWhenBlendSpaceChanges,
        startPosition: ALS_GROUNDED_DIRECTION_PLAYER.startPosition,
      })
    }
  })

  it.each([
    ['Forward', 'A_Als_Walk_Forward', 'A_Als_Run_Forward'],
    ['Backward', 'A_Als_Walk_Backward', 'A_Als_Run_Backward'],
    ['LeftForward', 'A_Als_Walk_Left_Forward', 'A_Als_Run_Left_Forward'],
    ['LeftBackward', 'A_Als_Walk_Left_Backward', 'A_Als_Run_Left_Backward'],
    ['RightForward', 'A_Als_Walk_Right_Forward', 'A_Als_Run_Right_Forward'],
    ['RightBackward', 'A_Als_Walk_Right_Backward', 'A_Als_Run_Right_Backward'],
  ] as const)(
    'selects only the %s authored player and evaluates its Walk/Run corners',
    (direction, walkClip, runClip) => {
      expect(denseClipWeights(evaluateGroundedLocomotionGraph(
        graph,
        direction,
        { strideBlendAmount: 1, walkRunBlendAmount: 0, playRate: 0.75 },
      ))).toEqual({ [walkClip]: 1 })
      expect(denseClipWeights(evaluateGroundedLocomotionGraph(
        graph,
        direction,
        { strideBlendAmount: 1, walkRunBlendAmount: 1, playRate: 1.25 },
      ))).toEqual({ [runClip]: 1 })
    },
  )

  it('uses authored pose samples on the Stride Amount axis instead of an idle crossfade', () => {
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'LeftForward',
      { strideBlendAmount: 0, walkRunBlendAmount: 0, playRate: 1 },
    ))).toEqual({ A_Als_Walk_Left_Pose: 1 })
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'LeftForward',
      { strideBlendAmount: 0, walkRunBlendAmount: 1, playRate: 1 },
    ))).toEqual({ A_Als_Run_Left_Pose: 1 })
  })

  it('preserves the exceptional authored RightBackward GridSamples topology', () => {
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'RightBackward',
      { strideBlendAmount: 0.25, walkRunBlendAmount: 0.25, playRate: 1 },
    ))).toEqual({
      A_Als_Walk_Right_Backward: 0.1875,
      A_Als_Walk_Left_Pose: 0.5625,
      A_Als_Run_Right_Backward: 0.0625,
      A_Als_Run_Left_Pose: 0.1875,
    })
  })

  it('makes steady-state HipsDirection selection one-hot', () => {
    for (const direction of ALS_HIPS_DIRECTIONS) {
      const weights = selectGroundedDirectionState(direction)
      expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0))
        .toBe(1)
      expect(Object.values(weights).filter((weight) => weight === 1))
        .toHaveLength(1)
    }
  })

  it('matches all 24 authored transitions without inventing delegate predicates', () => {
    const machine = abpGraph.assets.AB_Als_Standing.stateMachines.find(
      (candidate) => candidate.MachineName === 'Movement States',
    )
    if (!machine) throw new Error('AB_Als_Standing has no Movement States')
    const notifyNames =
      abpGraph.assets.AB_Als_Standing.compiledClassMetadata.AnimNotifies

    const delegateByTransition = new Map(machine.States.flatMap(
      (state) => state.Transitions.map((transition) => [
        transition.TransitionIndex,
        transition.CanTakeDelegateIndex,
      ] as const),
    ))
    const extracted = machine.Transitions.map((transition, transitionIndex) => ({
      transitionIndex,
      from: hipsDirectionFromStateName(transition.PreviousStateName),
      to: hipsDirectionFromStateName(transition.NextStateName),
      duration: transition.CrossfadeDuration,
      blendOption: transition.BlendMode.replace(
        'EAlphaBlendOption::',
        '',
      ),
      blendProfile: transition.BlendProfile?.ObjectName.includes(
        'MoveDirectionChange',
      ) ? 'MoveDirectionChange' : null,
      activatePivot: transition.StartNotify >= 0
        && notifyNames[transition.StartNotify]?.NotifyName === 'ActivatePivot',
      compiledDelegateIndex: delegateByTransition.get(transitionIndex),
    }))

    expect(machine.InitialState).toBe(0)
    expect(machine.States.every((state) => !state.bAlwaysResetOnEntry)).toBe(true)
    expect(ALS_GROUNDED_DIRECTION_TRANSITIONS).toEqual(extracted)
    expect(ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS.kind)
      .toBe('unrecoverable')

    // Multiple authored edges share endpoints but have different delegate indices. Picking one
    // without the missing bytecode would be a HYPOTHESIS, so the API returns every candidate.
    expect(authoredDirectionTransitions('RightBackward', 'RightForward'))
      .toHaveLength(3)
  })

  it('matches the separate MS_Als_Normal gameplay-speed oracle', () => {
    const tags: Readonly<Record<
      string,
      keyof typeof ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND
    >> = {
      'Als.RotationMode.VelocityDirection': 'VelocityDirection',
      'Als.RotationMode.ViewDirection': 'ViewDirection',
      'Als.RotationMode.Aiming': 'Aiming',
    }
    for (const [tag, mode] of Object.entries(tags)) {
      const authored =
        movementSettings.settings.rotationModes[tag].stances[
          'Als.Stance.Standing'
        ]
      expect(ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND[mode]).toEqual({
        walkForwardSpeed: authored.WalkForwardSpeed,
        walkBackwardSpeed: authored.WalkBackwardSpeed,
        runForwardSpeed: authored.RunForwardSpeed,
        runBackwardSpeed: authored.RunBackwardSpeed,
        sprintSpeed: authored.SprintSpeed,
      })
    }
  })

  it('keeps every evaluated sample on the authored common play rate', () => {
    for (const gait of ['Walking', 'Running', 'Sprinting'] as const) {
      const standing = refreshStandingMovement({
        locomotionSpeed: gait === 'Walking' ? 150 : gait === 'Running' ? 350 : 600,
        locomotionScale: 1,
        gait: gait as AlsGait,
        poseGaitCurveValue: gait === 'Walking' ? 1 : gait === 'Running' ? 2 : 3,
        poseGroundedCurveValue: 1,
      })
      const weights = evaluateGroundedLocomotionGraph(
        graph,
        'Forward',
        standing,
      )
      expect(weights.every((entry) => entry.playRate === standing.playRate))
        .toBe(true)
    }
  })
})
