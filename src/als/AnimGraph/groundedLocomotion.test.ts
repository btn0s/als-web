/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AuthoredBlendSpace } from '../../engine/blendSpace'
import {
  ALS_ANIMATED_STANDING_SPEEDS_CM_PER_SECOND,
  ALS_GROUNDED_DIRECTION_MACHINE,
  ALS_GROUNDED_DIRECTION_MULTI_WAY_BLEND_TABLE,
  ALS_GROUNDED_DIRECTION_PLAYER,
  ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS,
  ALS_GROUNDED_DIRECTION_STATE_ORDER,
  ALS_GROUNDED_DIRECTION_STATES,
  ALS_GROUNDED_DIRECTION_TRANSITIONS,
  ALS_HIPS_DIRECTIONS,
  ALS_MOVE_DIRECTION_CHANGE_PROFILE_STATUS,
  ALS_NORMAL_STANDING_GAMEPLAY_SPEEDS_CM_PER_SECOND,
  authoredDirectionTransitions,
  calculateMovementDirection,
  createAlsGroundedDirectionRuntime,
  createGroundedLocomotionGraph,
  evaluateGroundedLocomotionGraph,
  readGroundedLocomotionGraph,
  refreshAlsGroundedDirectionRuntime,
  refreshMovementDirection,
  refreshPoseGait,
  resetAlsGroundedDirectionRuntime,
  refreshStandingMovement,
  sampleStrideBlendAmountRun,
  sampleStrideBlendAmountWalk,
  selectGroundedDirectionTransition,
  selectGroundedDirectionState,
  updateGroundedLocomotionGraph,
  updateGroundedLocomotionGraphFromStateWeights,
} from './groundedLocomotion'
import type {
  AlsGait,
  AlsGroundedVelocityBlend,
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

interface ExtractedSkeletonProfiles {
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
    readonly TransitionIndex: number
    readonly rule: {
      readonly compiledDelegateIndex: number
    }
  }[]
}

interface AbpGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly nodes: readonly {
        readonly compiledIndex: number | null
        readonly type: string
        readonly parameters: {
          readonly StateMachineIndexInClass?: number
          readonly MaxTransitionsPerFrame?: number
          readonly MaxTransitionsRequests?: number
          readonly bSkipFirstUpdateTransition?: boolean
          readonly bReinitializeOnBecomingRelevant?: boolean
          readonly bCreateNotifyMetaData?: boolean
          readonly bAllowConduitEntryStates?: boolean
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

const skeletonProfiles = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/skeleton-profiles.json', import.meta.url),
  'utf8',
)) as ExtractedSkeletonProfiles

const abpGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

function denseClipWeights(
  weights: ReturnType<typeof evaluateGroundedLocomotionGraph>,
) {
  const result: Record<string, number> = {}
  for (const entry of weights) {
    result[entry.clip] = (result[entry.clip] ?? 0) + entry.weight
  }
  return result
}

const FORWARD_VELOCITY_BLEND: AlsGroundedVelocityBlend = {
  forwardAmount: 1,
  backwardAmount: 0,
  leftAmount: 0,
  rightAmount: 0,
}

const BACKWARD_VELOCITY_BLEND: AlsGroundedVelocityBlend = {
  forwardAmount: 0,
  backwardAmount: 1,
  leftAmount: 0,
  rightAmount: 0,
}

const LEFT_VELOCITY_BLEND: AlsGroundedVelocityBlend = {
  forwardAmount: 0,
  backwardAmount: 0,
  leftAmount: 1,
  rightAmount: 0,
}

const RIGHT_VELOCITY_BLEND: AlsGroundedVelocityBlend = {
  forwardAmount: 0,
  backwardAmount: 0,
  leftAmount: 0,
  rightAmount: 1,
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
    [
      'Forward',
      'Forward',
      FORWARD_VELOCITY_BLEND,
      'A_Als_Walk_Forward',
      'A_Als_Run_Forward',
    ],
    [
      'Backward',
      'Forward',
      BACKWARD_VELOCITY_BLEND,
      'A_Als_Walk_Backward',
      'A_Als_Run_Backward',
    ],
    [
      'LeftForward',
      'Forward',
      LEFT_VELOCITY_BLEND,
      'A_Als_Walk_Left_Forward',
      'A_Als_Run_Left_Forward',
    ],
    [
      'LeftBackward',
      'Backward',
      LEFT_VELOCITY_BLEND,
      'A_Als_Walk_Left_Backward',
      'A_Als_Run_Left_Backward',
    ],
    [
      'RightForward',
      'Forward',
      RIGHT_VELOCITY_BLEND,
      'A_Als_Walk_Right_Forward',
      'A_Als_Run_Right_Forward',
    ],
    [
      'RightBackward',
      'Backward',
      RIGHT_VELOCITY_BLEND,
      'A_Als_Walk_Right_Backward',
      'A_Als_Run_Right_Backward',
    ],
  ] as const)(
    'reaches the %s cached player through the authored state table',
    (_player, state, velocityBlend, walkClip, runClip) => {
      expect(denseClipWeights(evaluateGroundedLocomotionGraph(
        graph,
        state,
        velocityBlend,
        { strideBlendAmount: 1, walkRunBlendAmount: 0, playRate: 0.75 },
        1,
        1,
      ))).toEqual({ [walkClip]: 1 })
      expect(denseClipWeights(evaluateGroundedLocomotionGraph(
        graph,
        state,
        velocityBlend,
        { strideBlendAmount: 1, walkRunBlendAmount: 1, playRate: 1.25 },
        1,
        1,
      ))).toEqual({ [runClip]: 1 })
    },
  )

  it('uses authored pose samples on the Stride Amount axis instead of an idle crossfade', () => {
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'Forward',
      LEFT_VELOCITY_BLEND,
      { strideBlendAmount: 0, walkRunBlendAmount: 0, playRate: 1 },
      1,
      1,
    ))).toEqual({ A_Als_Walk_Left_Pose: 1 })
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'Forward',
      LEFT_VELOCITY_BLEND,
      { strideBlendAmount: 0, walkRunBlendAmount: 1, playRate: 1 },
      1,
      1,
    ))).toEqual({ A_Als_Run_Left_Pose: 1 })
  })

  it('retains logical player ownership when two players sample the same clip', () => {
    const weights = evaluateGroundedLocomotionGraph(
      createGroundedLocomotionGraph(blendSpaces.blendSpaces),
      'RightForward',
      {
        forwardAmount: 0,
        backwardAmount: 0,
        leftAmount: 0.5,
        rightAmount: 0.5,
      },
      { strideBlendAmount: 0, walkRunBlendAmount: 1, playRate: 1 },
      0.1,
      1,
    )

    expect(weights).toMatchObject([
      {
        player: 'LeftBackward',
        clip: 'A_Als_Run_Right_Pose',
        weight: 0.5,
      },
      {
        player: 'RightForward',
        clip: 'A_Als_Run_Right_Pose',
        weight: 0.5,
      },
    ])
  })

  it('preserves the exceptional authored RightBackward GridSamples topology', () => {
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'Backward',
      RIGHT_VELOCITY_BLEND,
      { strideBlendAmount: 0.25, walkRunBlendAmount: 0.25, playRate: 1 },
      1,
      1,
    ))).toEqual({
      A_Als_Walk_Right_Backward: 0.1875,
      A_Als_Walk_Left_Pose: 0.5625,
      A_Als_Run_Right_Backward: 0.0625,
      A_Als_Run_Left_Pose: 0.1875,
    })
  })

  it('matches the six state-specific normalized MultiWayBlend cache tables', () => {
    expect(ALS_GROUNDED_DIRECTION_MULTI_WAY_BLEND_TABLE).toEqual({
      Forward: ['Forward', 'Backward', 'LeftForward', 'RightForward'],
      Backward: ['Forward', 'Backward', 'LeftBackward', 'RightBackward'],
      RightForward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
      RightBackward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
      LeftForward: ['Forward', 'Backward', 'LeftForward', 'RightBackward'],
      LeftBackward: ['Forward', 'Backward', 'LeftBackward', 'RightForward'],
    })

    const standing = {
      strideBlendAmount: 1,
      walkRunBlendAmount: 1,
      playRate: 1,
    }
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'RightForward',
      LEFT_VELOCITY_BLEND,
      standing,
      1,
      1,
    ))).toEqual({ A_Als_Run_Left_Backward: 1 })
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'RightBackward',
      LEFT_VELOCITY_BLEND,
      standing,
      1,
      1,
    ))).toEqual({ A_Als_Run_Left_Forward: 1 })
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'LeftForward',
      RIGHT_VELOCITY_BLEND,
      standing,
      1,
      1,
    ))).toEqual({ A_Als_Run_Right_Backward: 1 })
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'LeftBackward',
      RIGHT_VELOCITY_BLEND,
      standing,
      1,
      1,
    ))).toEqual({ A_Als_Run_Right_Forward: 1 })
  })

  it('normalizes the four VelocityBlend alphas before mixing cached players', () => {
    expect(denseClipWeights(evaluateGroundedLocomotionGraph(
      graph,
      'Forward',
      {
        forwardAmount: 2,
        backwardAmount: 1,
        leftAmount: 1,
        rightAmount: 0,
      },
      { strideBlendAmount: 1, walkRunBlendAmount: 1, playRate: 1 },
      1,
      1,
    ))).toEqual({
      A_Als_Run_Forward: 0.5,
      A_Als_Run_Backward: 0.25,
      A_Als_Run_Left_Forward: 0.25,
    })
  })

  it('ticks only cached players above ZERO_ANIMWEIGHT_THRESH', () => {
    const relevanceGraph = createGroundedLocomotionGraph(
      blendSpaces.blendSpaces,
    )
    const standing = {
      strideBlendAmount: 1,
      walkRunBlendAmount: 1,
      playRate: 1,
    }

    evaluateGroundedLocomotionGraph(
      relevanceGraph,
      'Forward',
      {
        forwardAmount: 1e-5,
        backwardAmount: 1,
        leftAmount: 0,
        rightAmount: 0,
      },
      standing,
      0.1,
      1,
    )
    expect(relevanceGraph.evaluators.Forward.axisFilters[0].currentTime).toBe(0)
    expect(relevanceGraph.evaluators.Backward.axisFilters[0].currentTime)
      .toBe(0.1)

    evaluateGroundedLocomotionGraph(
      relevanceGraph,
      'Forward',
      FORWARD_VELOCITY_BLEND,
      standing,
      0.1,
      1,
    )
    expect(relevanceGraph.evaluators.Forward.axisFilters[0].currentTime)
      .toBe(0.1)
    expect(relevanceGraph.evaluators.Backward.axisFilters[0].currentTime)
      .toBe(0.1)
  })

  it('pauses all player filters while the effective parent is irrelevant', () => {
    const parentGraph = createGroundedLocomotionGraph(blendSpaces.blendSpaces)
    const standing = {
      strideBlendAmount: 1,
      walkRunBlendAmount: 1,
      playRate: 1,
    }

    evaluateGroundedLocomotionGraph(
      parentGraph,
      'Forward',
      FORWARD_VELOCITY_BLEND,
      standing,
      0.1,
      1,
    )
    expect(parentGraph.evaluators.Forward.axisFilters[0].currentTime).toBe(0.1)

    for (const parentWeight of [0, 1e-5]) {
      expect(evaluateGroundedLocomotionGraph(
        parentGraph,
        'Forward',
        FORWARD_VELOCITY_BLEND,
        standing,
        0.1,
        parentWeight,
      )).toEqual([])
    }
    expect(parentGraph.evaluators.Forward.axisFilters[0].currentTime).toBe(0.1)

    evaluateGroundedLocomotionGraph(
      parentGraph,
      'Forward',
      FORWARD_VELOCITY_BLEND,
      standing,
      0.1,
      1.00001e-5,
    )
    expect(parentGraph.evaluators.Forward.axisFilters[0].currentTime).toBe(0.2)
  })

  it('updates transition players once and retains the maximum cached-pose path weight', () => {
    const transitionGraph = createGroundedLocomotionGraph(
      blendSpaces.blendSpaces,
    )
    const standing = {
      strideBlendAmount: 1,
      walkRunBlendAmount: 1,
      playRate: 1,
    }
    const velocityBlend = {
      forwardAmount: 0.5,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0.5,
    }

    updateGroundedLocomotionGraph(
      transitionGraph,
      'Forward',
      0.4,
      'Backward',
      0.6,
      velocityBlend,
      standing,
      0.1,
      1,
    )

    expect(transitionGraph.evaluators.Forward.axisFilters[0].currentTime)
      .toBe(0.1)
    expect(transitionGraph.evaluators.RightForward.axisFilters[0].currentTime)
      .toBe(0.1)
    expect(transitionGraph.evaluators.RightBackward.axisFilters[0].currentTime)
      .toBe(0.1)
    expect(transitionGraph.evaluators.Backward.axisFilters[0].currentTime)
      .toBe(0)
    expect([...transitionGraph.playerWeights]).toEqual([
      0.3,
      0,
      0,
      0,
      0.2,
      0.3,
    ])
    expect(denseClipWeights(readGroundedLocomotionGraph(
      transitionGraph,
      'Forward',
      velocityBlend,
      standing,
    ))).toEqual({
      A_Als_Run_Forward: 0.5,
      A_Als_Run_Right_Forward: 0.5,
    })
    expect(denseClipWeights(readGroundedLocomotionGraph(
      transitionGraph,
      'Backward',
      velocityBlend,
      standing,
    ))).toEqual({
      A_Als_Run_Forward: 0.5,
      A_Als_Run_Right_Backward: 0.5,
    })

    updateGroundedLocomotionGraph(
      transitionGraph,
      'Forward',
      0.4,
      'Backward',
      0.6,
      velocityBlend,
      standing,
      0.1,
      1,
    )
    expect(transitionGraph.evaluators.Forward.axisFilters[0].currentTime)
      .toBe(0.2)
  })

  it('updates a retained multi-transition state union once per logical player', () => {
    const transitionGraph = createGroundedLocomotionGraph(
      blendSpaces.blendSpaces,
    )
    const stateWeights = {
      Forward: 0.2,
      Backward: 0.3,
      LeftForward: 0,
      LeftBackward: 0.4,
      RightForward: 0,
      RightBackward: 0,
    }
    const velocityBlend = {
      forwardAmount: 0.5,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0.5,
    }
    const standing = {
      strideBlendAmount: 1,
      walkRunBlendAmount: 1,
      playRate: 1,
    }

    updateGroundedLocomotionGraphFromStateWeights(
      transitionGraph,
      stateWeights,
      velocityBlend,
      standing,
      0.1,
      1,
    )

    expect([...transitionGraph.playerWeights]).toEqual([
      0.2,
      0,
      0,
      0,
      0.2,
      0.15,
    ])
    expect(
      transitionGraph.evaluators.Forward.axisFilters[0].currentTime,
    ).toBe(0.1)
    expect(
      transitionGraph.evaluators.RightForward.axisFilters[0].currentTime,
    ).toBe(0.1)
    expect(
      transitionGraph.evaluators.RightBackward.axisFilters[0].currentTime,
    ).toBe(0.1)

    updateGroundedLocomotionGraphFromStateWeights(
      transitionGraph,
      stateWeights,
      velocityBlend,
      standing,
      0.1,
      1,
    )
    expect(
      transitionGraph.evaluators.Forward.axisFilters[0].currentTime,
    ).toBe(0.2)
  })

  it('uses the complete state, parent, and MultiWay weight for relevance', () => {
    const relevanceGraph = createGroundedLocomotionGraph(
      blendSpaces.blendSpaces,
    )

    updateGroundedLocomotionGraph(
      relevanceGraph,
      'Forward',
      0.01,
      null,
      0,
      {
        forwardAmount: 0.01,
        backwardAmount: 0.99,
        leftAmount: 0,
        rightAmount: 0,
      },
      {
        strideBlendAmount: 1,
        walkRunBlendAmount: 1,
        playRate: 1,
      },
      0.1,
      0.01,
    )

    expect(relevanceGraph.evaluators.Forward.axisFilters[0].currentTime).toBe(0)
    expect(relevanceGraph.evaluators.Backward.axisFilters[0].currentTime)
      .toBe(0.1)
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

  it('matches all 24 serialized transitions and recovered bytecode predicates', () => {
    const machine = abpGraph.assets.AB_Als_Standing.stateMachines.find(
      (candidate) => candidate.MachineName === 'Movement States',
    )
    if (!machine) throw new Error('AB_Als_Standing has no Movement States')
    const notifyNames =
      abpGraph.assets.AB_Als_Standing.compiledClassMetadata.AnimNotifies

    const delegateByTransition = new Map(machine.States.flatMap(
      (state) => state.Transitions.map((transition) => [
        transition.TransitionIndex,
        transition.rule.compiledDelegateIndex,
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
    expect(ALS_GROUNDED_DIRECTION_TRANSITIONS.map(({
      rule: _rule,
      priorityOrder: _priorityOrder,
      ...transition
    }) => transition)).toEqual(extracted)
    expect(ALS_GROUNDED_DIRECTION_SELECTION_RULE_STATUS.kind)
      .toBe('verified')

    expect(authoredDirectionTransitions('RightBackward', 'RightForward'))
      .toHaveLength(3)
    expect(ALS_GROUNDED_DIRECTION_TRANSITIONS.map((transition) => [
      transition.rule,
      transition.priorityOrder,
    ])).toEqual([
      ['MoveRight', 1],
      ['MoveLeft', 1],
      ['MoveBackward', 1],
      ['MoveRight', 1],
      ['MoveLeft', 1],
      ['MoveForward', 1],
      ['MoveLeft', 1],
      ['MoveBackward', 1],
      ['MoveForward', 1],
      ['SetHipsLeft', 2],
      ['MoveLeft', 1],
      ['MoveForward', 1],
      ['NeutralRightBackward', 1],
      ['MoveBackward', 1],
      ['SetHipsRight', 2],
      ['MoveRight', 1],
      ['MoveBackward', 1],
      ['MoveForward', 1],
      ['SetHipsRight', 2],
      ['MoveRight', 1],
      ['MoveForward', 1],
      ['NeutralLeftBackward', 1],
      ['MoveBackward', 1],
      ['SetHipsLeft', 2],
    ])
    expect(ALS_MOVE_DIRECTION_CHANGE_PROFILE_STATUS).toMatchObject({
      kind: 'verified',
      implemented: true,
      blendScale: 2,
    })
    expect(ALS_MOVE_DIRECTION_CHANGE_PROFILE_STATUS.bones).toHaveLength(18)
  })

  it('preserves authored outgoing priority when predicates overlap', () => {
    expect(selectGroundedDirectionTransition({
      hipsDirection: 'RightForward',
      movementDirection: 'Backward',
      hipsDirectionLockAmount: -1,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })?.transitionIndex).toBe(7)
    expect(selectGroundedDirectionTransition({
      hipsDirection: 'RightBackward',
      movementDirection: 'Forward',
      hipsDirectionLockAmount: 0,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })?.transitionIndex).toBe(11)
    expect(selectGroundedDirectionTransition({
      hipsDirection: 'RightBackward',
      movementDirection: 'Backward',
      hipsDirectionLockAmount: 1,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })?.transitionIndex).toBe(13)
  })

  it('matches SetHips and full-weight neutral guard boundaries', () => {
    const rightForward = {
      hipsDirection: 'RightForward' as const,
      movementDirection: 'Right' as const,
      stateWeight: 1,
    }
    expect(selectGroundedDirectionTransition({
      ...rightForward,
      hipsDirectionLockAmount: -0.5,
      feetCrossingAmount: 0,
    })?.transitionIndex).toBe(9)
    expect(selectGroundedDirectionTransition({
      ...rightForward,
      hipsDirectionLockAmount: -0.499999,
      feetCrossingAmount: 0,
    })).toBeNull()
    expect(selectGroundedDirectionTransition({
      ...rightForward,
      hipsDirectionLockAmount: -1,
      feetCrossingAmount: Number.EPSILON,
    })).toBeNull()

    const neutralRightBackward = {
      hipsDirection: 'RightBackward' as const,
      movementDirection: 'Right' as const,
      hipsDirectionLockAmount: 0,
      feetCrossingAmount: 0,
    }
    expect(selectGroundedDirectionTransition({
      ...neutralRightBackward,
      stateWeight: 1,
    })?.transitionIndex).toBe(12)
    expect(selectGroundedDirectionTransition({
      ...neutralRightBackward,
      stateWeight: 0.999999,
    })).toBeNull()
    expect(selectGroundedDirectionTransition({
      ...neutralRightBackward,
      hipsDirectionLockAmount: -0.5,
      stateWeight: 1,
    })).toBeNull()
    expect(selectGroundedDirectionTransition({
      ...neutralRightBackward,
      hipsDirectionLockAmount: 0.5,
      stateWeight: 1,
    })?.transitionIndex).toBe(14)
  })

  it('exposes exact pivot timing and clamps prior resolved curve inputs', () => {
    expect(selectGroundedDirectionTransition({
      hipsDirection: 'Forward',
      movementDirection: 'Backward',
      hipsDirectionLockAmount: 0,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })).toMatchObject({
      transitionIndex: 2,
      duration: 0.5,
      blendOption: 'Cubic',
      activatePivot: true,
    })
    expect(selectGroundedDirectionTransition({
      hipsDirection: 'LeftForward',
      movementDirection: 'Left',
      hipsDirectionLockAmount: 99,
      feetCrossingAmount: -99,
      stateWeight: 1,
    })).toMatchObject({
      transitionIndex: 18,
      rule: 'SetHipsRight',
      duration: 0.75,
      blendOption: 'QuadraticInOut',
      activatePivot: false,
    })
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
        FORWARD_VELOCITY_BLEND,
        standing,
        1,
        1,
      )
      expect(weights.every((entry) => entry.playRate === standing.playRate))
        .toBe(true)
    }
  })
})

describe('VERIFIED AB_Als_Standing Movement States runtime', () => {
  const forward = {
    relevant: true,
    movementDirection: 'Forward',
    hipsDirectionLockAmount: 0,
    feetCrossingAmount: 1,
  } as const
  const authoredProfile = skeletonProfiles.profiles.MoveDirectionChange
  const moveDirectionChangeProfile = {
    mode: authoredProfile.mode,
    blendScales: new Float32Array([
      1,
      ...authoredProfile.entries.map((entry) => entry.blendScale),
    ]),
  } as const

  it('matches node 201 settings and serialized state order', () => {
    const node = abpGraph.assets.AB_Als_Standing.nodes.find(
      (candidate) =>
        candidate.type === 'FAnimNode_StateMachine'
        && candidate.parameters.StateMachineIndexInClass === 0,
    )
    const machine = abpGraph.assets.AB_Als_Standing.stateMachines.find(
      (candidate) => candidate.MachineName === 'Movement States',
    )
    if (!node || !machine) {
      throw new Error('Missing AB_Als_Standing Movement States oracle')
    }

    expect(ALS_GROUNDED_DIRECTION_MACHINE).toEqual({
      nodeIndex: node.compiledIndex,
      stateMachineIndexInClass: node.parameters.StateMachineIndexInClass,
      machineName: machine.MachineName,
      initialState: hipsDirectionFromStateName(
        machine.States[machine.InitialState].StateName,
      ),
      maxTransitionsPerFrame: node.parameters.MaxTransitionsPerFrame,
      maxTransitionRequests: node.parameters.MaxTransitionsRequests,
      skipFirstUpdateTransition:
        node.parameters.bSkipFirstUpdateTransition,
      reinitializeOnBecomingRelevant:
        node.parameters.bReinitializeOnBecomingRelevant,
      createNotifyMetadata: node.parameters.bCreateNotifyMetaData,
      allowConduitEntryStates: node.parameters.bAllowConduitEntryStates,
    })
    expect(ALS_GROUNDED_DIRECTION_STATE_ORDER).toEqual(
      machine.States.map((state) => hipsDirectionFromStateName(
        state.StateName,
      )),
    )
  })

  it('reinitializes Forward, calls SetHipsDirection, and skips the first transition update', () => {
    const runtime = createAlsGroundedDirectionRuntime()
    const entered: AlsHipsDirection[] = []
    const started: number[] = []
    const left = {
      ...forward,
      movementDirection: 'Left',
    } as const

    refreshAlsGroundedDirectionRuntime(
      runtime,
      left,
      1 / 60,
      (direction) => entered.push(direction),
      (transition) => started.push(transition.transitionIndex),
    )
    expect(runtime).toMatchObject({
      relevant: true,
      baseState: 'Forward',
      currentState: 'Forward',
      transitionsTakenThisFrame: 0,
      lastSetHipsDirection: 'Forward',
      lastStartedTransition: null,
      pivotActivatedThisFrame: false,
    })
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(entered).toEqual(['Forward'])
    expect(started).toEqual([])

    refreshAlsGroundedDirectionRuntime(
      runtime,
      left,
      1 / 60,
      (direction) => entered.push(direction),
      (transition) => started.push(transition.transitionIndex),
    )
    expect(runtime.currentState).toBe('LeftForward')
    expect(runtime.activeTransitions[0]).toMatchObject({
      previousState: 'Forward',
      nextState: 'LeftForward',
      crossfadeDuration: 0.7,
      blendOption: 'Cubic',
      usesIntermediatePose: false,
    })
    expect(entered).toEqual(['Forward', 'LeftForward'])
    expect(started).toEqual([1])
  })

  it('propagates the authored MoveDirectionChange profile and ActivatePivot start notify', () => {
    const runtime = createAlsGroundedDirectionRuntime(
      moveDirectionChangeProfile.blendScales.length,
      moveDirectionChangeProfile,
    )
    const started: number[] = []
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)
    refreshAlsGroundedDirectionRuntime(
      runtime,
      {
        ...forward,
        movementDirection: 'Backward',
      },
      0,
      undefined,
      (transition) => started.push(transition.transitionIndex),
    )

    const active = runtime.activeTransitions[0]
    expect(runtime.lastStartedTransition).toMatchObject({
      transitionIndex: 2,
      duration: 0.5,
      activatePivot: true,
    })
    expect(runtime.pivotActivatedThisFrame).toBe(true)
    expect(started).toEqual([2])
    expect(active.blendProfile).toBe(moveDirectionChangeProfile)

    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0.25)
    expect(active).toMatchObject({
      linearAlpha: 0.5,
      alpha: 0.5,
    })
    expect(active.previousPoseMask[0]).toBe(0.5)
    expect(active.nextPoseMask[0]).toBe(0.5)
    expect(active.previousPoseMask[1]).toBeCloseTo(0.2, 7)
    expect(active.nextPoseMask[1]).toBeCloseTo(0.8, 7)
    expect(runtime.stateWeights).toMatchObject({
      Forward: 0.5,
      Backward: 0.5,
    })
  })

  it('rescales an interrupted reversal from the existing target weight', () => {
    const runtime = createAlsGroundedDirectionRuntime()
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0.25)
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)

    expect(runtime.activeTransitions).toHaveLength(2)
    expect(runtime.activeTransitions[1]).toMatchObject({
      previousState: 'Backward',
      nextState: 'Forward',
      crossfadeDuration: 0.25,
      usesIntermediatePose: true,
    })
    expect(runtime.stateWeights.Forward).toBe(0.5)
    expect(runtime.stateWeights.Backward).toBe(0.5)

    refreshAlsGroundedDirectionRuntime(runtime, forward, 0.125)
    expect(runtime.activeTransitions[1].alpha).toBe(0.5)
    expect(runtime.stateWeights.Forward).toBeCloseTo(0.578125, 7)
    expect(runtime.stateWeights.Backward).toBeCloseTo(0.421875, 7)

    refreshAlsGroundedDirectionRuntime(runtime, forward, 0.125)
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(runtime.currentState).toBe('Forward')
    expect(runtime.stateWeights.Forward).toBe(1)
  })

  it('retains interrupted sources and removes only completed older transitions', () => {
    const runtime = createAlsGroundedDirectionRuntime()
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0.35)

    expect(runtime.currentState).toBe('LeftBackward')
    expect(runtime.activeTransitions.map((transition) => ({
      from: transition.previousState,
      to: transition.nextState,
      alpha: transition.alpha,
      intermediate: transition.usesIntermediatePose,
    }))).toEqual([
      {
        from: 'Forward',
        to: 'RightForward',
        alpha: 0.5,
        intermediate: false,
      },
      {
        from: 'RightForward',
        to: 'LeftBackward',
        alpha: 0.7839999999999999,
        intermediate: true,
      },
    ])
    expect(runtime.pivotActivatedThisFrame).toBe(true)

    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0.35)
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(runtime.baseState).toBe('LeftBackward')
  })

  it('advances a newly selected direction transition during its first update', () => {
    const runtime = createAlsGroundedDirectionRuntime()
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0.25)
    expect(runtime.activeTransitions[0]).toMatchObject({
      previousState: 'Forward',
      nextState: 'Backward',
      linearAlpha: 0.5,
      alpha: 0.5,
    })
  })

  it('uses authored QuadraticInOut neutral transitions and resets after relevance loss', () => {
    const runtime = createAlsGroundedDirectionRuntime()
    refreshAlsGroundedDirectionRuntime(runtime, forward, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0.5)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0.7)
    expect(runtime.currentState).toBe('RightBackward')
    expect(runtime.activeTransitions).toHaveLength(0)

    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
      feetCrossingAmount: 0,
    }, 0)
    expect(runtime.lastStartedTransition).toMatchObject({
      transitionIndex: 12,
      rule: 'NeutralRightBackward',
      duration: 0.75,
      blendOption: 'QuadraticInOut',
    })
    expect(runtime.activeTransitions[0]).toMatchObject({
      crossfadeDuration: 0.75,
      blendOption: 'QuadraticInOut',
    })

    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      relevant: false,
    }, 0)
    refreshAlsGroundedDirectionRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0)
    expect(runtime.currentState).toBe('Forward')
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(runtime.lastSetHipsDirection).toBe('Forward')

    expect(resetAlsGroundedDirectionRuntime(runtime)).toBe(runtime)
    expect(runtime.relevant).toBe(false)
    expect(() => refreshAlsGroundedDirectionRuntime(
      runtime,
      forward,
      -0.01,
    )).toThrow('delta time must be finite and non-negative')
  })
})
