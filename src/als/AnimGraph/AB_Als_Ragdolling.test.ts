import { describe, expect, it } from 'vitest'
import abpGraph from '../../../scripts/extract-als/abp-graph.json'
import {
  AB_ALS_RAGDOLLING_GRAPH,
  createAlsRagdollingGraphState,
  refreshAlsRagdollingGraph,
} from './AB_Als_Ragdolling'

interface OracleNode {
  readonly compiledIndex: number
  readonly type: string
  readonly parameters: Record<string, unknown>
}

const oracle = abpGraph.assets.AB_Als_Ragdolling
function node(index: number): OracleNode | undefined {
  return oracle.nodes.find(
    ({ compiledIndex }) => compiledIndex === index,
  ) as OracleNode | undefined
}

describe('AB_Als_Ragdolling', () => {
  it('pins the complete six-node authored pose flow', () => {
    expect(oracle.serializedNodeCount).toBe(6)
    expect(oracle.compiledNodeCount).toBe(6)
    expect(oracle.wiring.poseLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeIndex: 2,
        targetNodeIndex: 0,
        targetInput: 'Result',
      }),
      expect.objectContaining({
        sourceNodeIndex: 1,
        targetNodeIndex: 2,
        targetInput: 'BlendPose[0]',
      }),
      expect.objectContaining({
        sourceNodeIndex: 3,
        targetNodeIndex: 2,
        targetInput: 'BlendPose[1]',
      }),
      expect.objectContaining({
        sourceNodeIndex: 5,
        targetNodeIndex: 3,
        targetInput: 'BlendPose[0]',
      }),
      expect.objectContaining({
        sourceNodeIndex: 4,
        targetNodeIndex: 3,
        targetInput: 'BlendPose[1]',
      }),
    ]))
  })

  it('pins both exact gameplay-tag blends', () => {
    expect(node(2)).toMatchObject({
      type: 'FAlsAnimNode_GameplayTagsBlend',
      parameters: {
        Tags: [{ TagName: 'Als.LocomotionAction.Ragdolling' }],
        BlendTime: [0.4, 0.5],
        TransitionType: 'EBlendListTransitionType::StandardBlend',
        BlendType: 'EAlphaBlendOption::Linear',
        bResetChildOnActivation: false,
      },
    })
    expect(node(3)).toMatchObject({
      type: 'FAlsAnimNode_GameplayTagsBlend',
      parameters: {
        Tags: [{ TagName: 'Als.LocomotionAction.Ragdolling' }],
        BlendTime: [0, 0],
        TransitionType: 'EBlendListTransitionType::StandardBlend',
        BlendType: 'EAlphaBlendOption::Linear',
        bResetChildOnActivation: false,
      },
    })
    expect(AB_ALS_RAGDOLLING_GRAPH.outerGameplayTagsBlend).toMatchObject({
      defaultBlendTime: 0.4,
      taggedBlendTime: 0.5,
    })
  })

  it('pins the flail player and final-pose snapshot sources', () => {
    expect(node(4)).toMatchObject({
      type: 'FAnimNode_SequencePlayer',
      parameters: {
        Sequence: {
          ObjectName: "AnimSequence'A_Als_Flail'",
        },
        StartPosition: 0,
        bLoopAnimation: true,
        Method: 'EAnimSyncMethod::DoNotSync',
      },
    })
    expect(node(5)).toMatchObject({
      type: 'FAnimNode_PoseSnapshot',
      parameters: {
        Mode: 'ESnapshotSourceMode::SnapshotPin',
      },
    })
  })

  it('enters through Flail in 0.5 seconds', () => {
    const state = createAlsRagdollingGraphState()

    expect(refreshAlsRagdollingGraph(
      state,
      'Ragdolling',
      0.2,
    )).toEqual({
      linkedInputWeight: 0.6,
      flailWeight: 0.4,
      finalRagdollPoseWeight: 0,
      ragdollingAmount: 0.4,
    })
    expect(refreshAlsRagdollingGraph(
      state,
      'Ragdolling',
      0.3,
    )).toEqual({
      linkedInputWeight: 0,
      flailWeight: 1,
      finalRagdollPoseWeight: 0,
      ragdollingAmount: 1,
    })
  })

  it('switches immediately to FinalRagdollPose and exits in 0.4 seconds', () => {
    const state = createAlsRagdollingGraphState()
    refreshAlsRagdollingGraph(state, 'Ragdolling', 0.5)

    expect(refreshAlsRagdollingGraph(state, null, 0)).toEqual({
      linkedInputWeight: 0,
      flailWeight: 0,
      finalRagdollPoseWeight: 1,
      ragdollingAmount: 1,
    })
    expect(refreshAlsRagdollingGraph(state, 'GettingUp', 0.1)).toEqual({
      linkedInputWeight: 0.25,
      flailWeight: 0,
      finalRagdollPoseWeight: 0.75,
      ragdollingAmount: 0.75,
    })
    expect(refreshAlsRagdollingGraph(state, 'GettingUp', 0.3)).toEqual({
      linkedInputWeight: 1,
      flailWeight: 0,
      finalRagdollPoseWeight: 0,
      ragdollingAmount: 0,
    })
  })

  it('retargets a reversed StandardBlend from its current weight', () => {
    const state = createAlsRagdollingGraphState()
    refreshAlsRagdollingGraph(state, 'Ragdolling', 0.25)
    expect(state.ragdollingAmount).toBe(0.5)

    refreshAlsRagdollingGraph(state, null, 0.2)
    expect(state.ragdollingAmount).toBe(0.25)

    refreshAlsRagdollingGraph(state, 'Ragdolling', 0.25)
    expect(state.ragdollingAmount).toBeCloseTo(0.625, 12)
  })

  it('does not advance a dormant linked graph', () => {
    const state = createAlsRagdollingGraphState()
    const sample = refreshAlsRagdollingGraph(
      state,
      'Ragdolling',
      1,
      false,
    )

    expect(sample.ragdollingAmount).toBe(0)
    expect(state.blendTarget).toBe(0)
  })
})
