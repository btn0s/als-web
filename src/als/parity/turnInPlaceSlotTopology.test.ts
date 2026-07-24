/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface GraphNode {
  readonly compiledIndex: number
  readonly type: string
  readonly parameters: {
    readonly Name?: string
    readonly SlotName?: string
    readonly bAlwaysUpdateSourcePose?: boolean
    readonly Source?: { readonly LinkID: number }
    readonly SourcePose?: { readonly LinkID: number }
    readonly CurveNames?: readonly string[]
    readonly CurveValues?: readonly number[]
    readonly Sequence?: { readonly ObjectName: string }
    readonly StateEntryFunction?: { readonly FunctionName: string }
    readonly StateExitFunction?: { readonly FunctionName: string }
  }
}

interface AbpGraph {
  readonly assets: Readonly<Record<string, {
    readonly nodes: readonly GraphNode[]
  }>>
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

function node(asset: string, compiledIndex: number) {
  const value = graph.assets[asset]?.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!value) {
    throw new Error(`${asset} is missing compiled node ${compiledIndex}`)
  }
  return value
}

describe('ALS authored turn-in-place Slot topology', () => {
  it('puts the Transition Slot after Grounded and before downstream locomotion/layering', () => {
    expect(node('AB_Als', 13)).toMatchObject({
      type: 'FAnimNode_Slot',
      parameters: {
        SlotName: 'Transition',
        Source: { LinkID: 6 },
        bAlwaysUpdateSourcePose: false,
      },
    })
  })

  it.each([
    {
      asset: 'AB_Als_Standing',
      slotIndex: 60,
      slotName: 'TurnInPlaceStanding',
      sourceModifyIndex: 63,
      sourceSequenceIndex: 61,
      sourceSequence: "AnimSequence'A_Als_Stand_Pose'",
      yawScaleIndex: 62,
    },
    {
      asset: 'AB_Als_Crouching',
      slotIndex: 28,
      slotName: 'TurnInPlaceCrouching',
      sourceModifyIndex: 30,
      sourceSequenceIndex: 31,
      sourceSequence: "AnimSequence'A_Als_Crouch_Pose'",
      yawScaleIndex: 29,
    },
  ])('pins $asset idle source -> Slot -> RotationYawSpeed scale', (oracle) => {
    expect(node(oracle.asset, oracle.slotIndex)).toMatchObject({
      type: 'FAnimNode_Slot',
      parameters: {
        SlotName: oracle.slotName,
        Source: { LinkID: oracle.sourceModifyIndex },
        bAlwaysUpdateSourcePose: false,
      },
    })
    expect(node(oracle.asset, oracle.sourceModifyIndex)).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        SourcePose: { LinkID: oracle.sourceSequenceIndex },
        CurveNames: ['FootLeftLock', 'FootRightLock', 'AllowTransitions'],
        CurveValues: [1, 1, 1],
      },
    })
    expect(node(oracle.asset, oracle.sourceSequenceIndex)).toMatchObject({
      type: 'FAnimNode_SequenceEvaluator',
      parameters: {
        Sequence: { ObjectName: oracle.sourceSequence },
      },
    })
    expect(node(oracle.asset, oracle.yawScaleIndex)).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        SourcePose: { LinkID: oracle.slotIndex },
        CurveNames: ['RotationYawSpeed'],
      },
    })
  })

  it('stops all transition/turn Slots on stance entry and Idle exit', () => {
    expect(node('AB_Als_Grounded', 24).parameters).toMatchObject({
      Name: 'Crouching To Standing',
      StateEntryFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
    expect(node('AB_Als_Grounded', 26).parameters).toMatchObject({
      Name: 'Standing To Crouching',
      StateEntryFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
    expect(node('AB_Als_Standing', 64).parameters).toMatchObject({
      Name: 'Idle',
      StateExitFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
    expect(node('AB_Als_Crouching', 32).parameters).toMatchObject({
      Name: 'Idle',
      StateExitFunction: {
        FunctionName: 'StopTransitionAndTurnInPlaceAnimations',
      },
    })
  })
})
