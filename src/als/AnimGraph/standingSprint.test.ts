/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_STANDING_SPRINT_GRAPH,
  createAlsStandingSprintState,
  refreshStandingSprint,
} from './standingSprint'

interface ExtractedNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface ExtractedGraph {
  readonly assets: {
    readonly AB_Als_Standing: {
      readonly nodes: readonly ExtractedNode[]
    }
  }
}

const extractedGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedGraph

function node(index: number) {
  const result = extractedGraph.assets.AB_Als_Standing.nodes.find(
    (candidate) => candidate.compiledIndex === index,
  )
  if (!result) throw new Error(`Missing compiled standing node ${index}`)
  return result
}

function step(
  state = createAlsStandingSprintState(),
  overrides: Partial<Parameters<typeof refreshStandingSprint>[1]> = {},
) {
  return refreshStandingSprint(state, {
    gait: 'Sprinting',
    deltaTime: 0,
    sprintBlockCurveValue: 0,
    relativeAccelerationAmountX: 0,
    standingPlayRate: 1,
    ...overrides,
  })
}

describe('VERIFIED ALS standing sprint graph', () => {
  it('matches the recovered node topology and authored constants', () => {
    const sprint = node(ALS_STANDING_SPRINT_GRAPH.sprint.compiledNodeIndex)
    const acceleration = node(
      ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.compiledNodeIndex,
    )
    const accelerationBlend = node(
      ALS_STANDING_SPRINT_GRAPH.sprintAccelerationBlend.compiledNodeIndex,
    )
    const blockBlend = node(
      ALS_STANDING_SPRINT_GRAPH.sprintBlockBlend.compiledNodeIndex,
    )
    const gaitBlend = node(
      ALS_STANDING_SPRINT_GRAPH.gaitBlend.compiledNodeIndex,
    )

    expect(sprint).toMatchObject({
      type: 'FAnimNode_SequencePlayer',
      parameters: {
        Sequence: { ObjectName: "AnimSequence'A_Als_Sprint'" },
        StartPosition: 0.166667,
        PlayRateBasis: 1,
      },
    })
    expect(acceleration).toMatchObject({
      type: 'FAnimNode_SequencePlayer',
      parameters: {
        Sequence: {
          ObjectName: "AnimSequence'A_Als_Sprint_Acceleration'",
        },
        StartPosition: 0.166667,
        PlayRateBasis: 0.833333,
      },
    })
    expect(accelerationBlend).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 129 },
        B: { LinkID: 130 },
        bResetChildOnActivation: true,
        AlphaScaleBiasClamp: {
          bMapRange: true,
          bInterpResult: true,
          InRange: { Min: 0, Max: 0.25 },
          OutRange: { Min: 0, Max: 1 },
          InterpSpeedIncreasing: 20,
          InterpSpeedDecreasing: 4,
        },
      },
    })
    expect(gaitBlend).toMatchObject({
      type: 'FAlsAnimNode_GameplayTagsBlend',
      parameters: {
        Tags: [{ TagName: 'Als.Gait.Sprinting' }],
        BlendPose: [{ LinkID: 141 }, { LinkID: 131 }],
        BlendTime: [0.3, 0.2],
        TransitionType: 'EBlendListTransitionType::StandardBlend',
        BlendType: 'EAlphaBlendOption::Cubic',
        bResetChildOnActivation: false,
      },
    })
    expect(blockBlend).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 144 },
        B: { LinkID: 140 },
        bResetChildOnActivation: false,
      },
    })
  })

  it('ports the 0.5 second sprint acceleration window and pending-update branch', () => {
    const state = createAlsStandingSprintState()
    step(state, {
      deltaTime: 0.1,
      relativeAccelerationAmountX: 0.2,
    })
    expect(state.sprintTime).toBeCloseTo(0.1)
    expect(state.sprintAccelerationAmount).toBe(0.2)

    step(state, {
      deltaTime: 0.399999,
      relativeAccelerationAmountX: 0.5,
    })
    expect(state.sprintAccelerationAmount).toBe(0.5)
    step(state, {
      deltaTime: 0.000002,
      relativeAccelerationAmountX: 0.5,
    })
    expect(state.sprintTime).toBeGreaterThanOrEqual(0.5)
    expect(state.sprintAccelerationAmount).toBe(0)

    const pending = createAlsStandingSprintState()
    step(pending, {
      pendingUpdate: true,
      relativeAccelerationAmountX: 1,
    })
    expect(pending.sprintTime).toBe(0.5)
    expect(pending.sprintAccelerationAmount).toBe(0)

    step(state, {
      gait: 'Running',
      deltaTime: 1,
      relativeAccelerationAmountX: 1,
    })
    expect(state.sprintTime).toBe(0)
    expect(state.sprintAccelerationAmount).toBe(0)
  })

  it('uses the authored asymmetric Cubic gait-tag blend times', () => {
    const state = createAlsStandingSprintState()
    const halfwayIn = step(state, { deltaTime: 0.1 })
    expect(halfwayIn.sprintBlendAmount).toBeCloseTo(0.5)
    expect(halfwayIn.moveForwardBaseWeight).toBeCloseTo(0.5)

    const entered = step(state, { deltaTime: 0.1 })
    expect(entered.sprintBlendAmount).toBe(1)

    const halfwayOut = step(state, {
      gait: 'Running',
      deltaTime: 0.15,
    })
    expect(halfwayOut.sprintBlendAmount).toBeCloseTo(0.5)
    expect(halfwayOut.moveForwardBaseWeight).toBeCloseTo(0.5)

    const exited = step(state, {
      gait: 'Running',
      deltaTime: 0.15,
    })
    expect(exited.sprintBlendAmount).toBe(0)
    expect(exited.moveForwardBaseWeight).toBe(1)
  })

  it('maps and interpolates SprintAccelerationAmount before the blend alpha clamps', () => {
    const state = createAlsStandingSprintState()
    const initial = step(state, {
      deltaTime: 0,
      relativeAccelerationAmountX: 0.25,
    })
    expect(state.sprintAccelerationBlendAmount).toBe(1)
    expect(initial.sprintAccelerationBlendAmount).toBe(1)

    const decreasing = step(state, {
      deltaTime: 0.1,
      relativeAccelerationAmountX: 0,
    })
    expect(state.sprintAccelerationBlendAmount).toBeCloseTo(0.6)
    expect(decreasing.sprintAccelerationBlendAmount).toBeCloseTo(0.6)

    const increasing = step(state, {
      deltaTime: 0.05,
      relativeAccelerationAmountX: 1,
    })
    expect(state.sprintAccelerationBlendAmount).toBe(4)
    expect(increasing.sprintAccelerationBlendAmount).toBe(1)

    const negative = createAlsStandingSprintState()
    const clamped = step(negative, {
      relativeAccelerationAmountX: -1,
    })
    expect(negative.sprintAccelerationBlendAmount).toBe(-4)
    expect(clamped.sprintAccelerationBlendAmount).toBe(0)
  })

  it('composes SprintBlock outside the tag and acceleration blends', () => {
    const state = createAlsStandingSprintState()
    step(state, {
      deltaTime: 0.2,
      relativeAccelerationAmountX: 0.125,
    })
    const sample = step(state, {
      sprintBlockCurveValue: 0.25,
      relativeAccelerationAmountX: 0.125,
    })

    expect(sample.sprintBlendAmount).toBe(1)
    expect(sample.sprintAccelerationBlendAmount).toBe(0.5)
    expect(sample.moveForwardBaseWeight).toBe(0.25)
    expect(sample.sprintWeight).toBe(0.375)
    expect(sample.sprintAccelerationWeight).toBe(0.375)
    expect(
      sample.moveForwardBaseWeight
      + sample.sprintWeight
      + sample.sprintAccelerationWeight,
    ).toBe(1)

    expect(step(state, { sprintBlockCurveValue: 99 }))
      .toMatchObject({
        moveForwardBaseWeight: 1,
        sprintWeight: 0,
        sprintAccelerationWeight: 0,
        sprintBlockAmount: 1,
      })
  })

  it('divides the bound PlayRate by each authored SequencePlayer basis', () => {
    const sample = step(undefined, { standingPlayRate: 1.25 })
    expect(sample.sprintPlayRate).toBe(1.25)
    expect(sample.sprintAccelerationPlayRate).toBeCloseTo(
      1.25 / 0.833333,
      12,
    )
  })

  it('retains graph-node state while the Move Forward cache is irrelevant', () => {
    const state = createAlsStandingSprintState()
    const irrelevant = step(state, {
      deltaTime: 1,
      relevant: false,
      relativeAccelerationAmountX: 1,
    })

    expect(state.sprintTime).toBeGreaterThan(0.5)
    expect(state.sprintAccelerationAmount).toBe(0)
    expect(irrelevant.sprintBlendAmount).toBe(0)
    expect(state.sprintAccelerationBlendInitialized).toBe(false)
  })
})
