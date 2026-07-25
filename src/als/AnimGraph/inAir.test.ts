/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_IN_AIR_CURVE_OUTPUTS,
  ALS_IN_AIR_GRAPH,
  ALS_IN_AIR_PLAYERS,
  ALS_JUMP_GRAPH_TRANSITIONS,
  ALS_JUMP_STATES_MACHINE,
  ALS_LOCOMOTION_GRAPH_TRANSITIONS,
  ALS_LOCOMOTION_STATES_MACHINE,
  createAlsInAirGraphState,
  createAlsJumpStateClock,
  enterAlsJumpGraph,
  refreshAlsFallGraph,
  refreshAlsJumpGraph,
  refreshAlsJumpStateClock,
  refreshAlsLandMovementGraph,
  resetAlsJumpStateClock,
  sampleAlsLandGraph,
  selectAlsJumpGraphTransition,
  selectAlsLocomotionGraphTransition,
} from './inAir'
import type {
  AlsAirGraphInput,
  AlsLocomotionTransitionInput,
} from './inAir'

interface ExtractedNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface ExtractedTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly BlendMode: string
  readonly BlendProfile: {
    readonly ObjectName: string
  } | null
  readonly LogicType: string
  readonly StartNotify: number
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
}

interface ExtractedStateMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly ExtractedState[]
  readonly Transitions: readonly ExtractedTransition[]
}

interface ExtractedTransitionRuleGraph {
  readonly resultNodeGuid: string
  readonly bakedEdgeMapping: {
    readonly status: 'resolved' | 'conduit-entry'
    readonly machine: string
    readonly transitionIndices?: readonly number[]
    readonly compiledDelegateProperties: readonly string[]
  }
  readonly compiledRule: {
    readonly generatedFunction: string
    readonly compiledDelegateProperty: string
    readonly assignment: {
      readonly target: string
      readonly expressionType: string
    }
    readonly constantBearingCalls: readonly {
      readonly function: string
      readonly numericConstants: readonly number[]
      readonly nameConstants: readonly string[]
    }[]
    readonly numericConstants: readonly number[]
    readonly nameConstants: readonly string[]
  } | null
  readonly nodes: readonly {
    readonly function?: string
    readonly sourceState?: string
    readonly propertyPath?: readonly string[]
  }[]
}

interface ExtractedAbpGraph {
  readonly assets: {
    readonly AB_Als_Locomotion: {
      readonly nodes: readonly ExtractedNode[]
      readonly stateMachines: readonly ExtractedStateMachine[]
      readonly transitionRuleBytecodeSource: {
        readonly parser: string
        readonly binaryEqualityVerified: boolean
        readonly ubergraph: string
        readonly targetedRuleCount: number
      }
      readonly transitionRuleGraphs:
        readonly ExtractedTransitionRuleGraph[]
    }
  }
}

const extractedGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedAbpGraph

const locomotionAsset = extractedGraph.assets.AB_Als_Locomotion

function node(compiledIndex: number) {
  const result = locomotionAsset.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!result) {
    throw new Error(`Missing compiled locomotion node ${compiledIndex}`)
  }
  return result
}

function machine(machineName: string) {
  const result = locomotionAsset.stateMachines.find(
    (candidate) => candidate.MachineName === machineName,
  )
  if (!result) throw new Error(`Missing state machine ${machineName}`)
  return result
}

function transitionRuleGraph(compiledDelegateProperty: string) {
  const matches = locomotionAsset.transitionRuleGraphs.filter(
    (graph) => graph.bakedEdgeMapping.compiledDelegateProperties
      .includes(compiledDelegateProperty),
  )
  if (matches.length !== 1) {
    throw new Error(
      `Expected one transition graph for ${compiledDelegateProperty},`
      + ` found ${matches.length}`,
    )
  }
  return matches[0]
}

function baseTransitionInput(
  overrides: Partial<AlsLocomotionTransitionInput> = {},
): AlsLocomotionTransitionInput {
  return {
    locomotionMode: 'Grounded',
    jumped: false,
    stance: 'Standing',
    hasInput: false,
    rotatingLeft: false,
    rotatingRight: false,
    speed: 0,
    landRemainingTime: 1,
    landMovementAutomaticRemainingTimeReached: false,
    ...overrides,
  }
}

function airInput(
  overrides: Partial<AlsAirGraphInput> = {},
): AlsAirGraphInput {
  return {
    deltaTime: 0,
    verticalVelocity: 0,
    groundPredictionAmount: 0,
    leanRightAmount: 0,
    leanForwardAmount: 0,
    ...overrides,
  }
}

describe('VERIFIED AB_Als_Locomotion InAir state machines', () => {
  it('pins Locomotion States order, flags, and all 16 transitions', () => {
    const authored = machine('Locomotion States')
    expect(authored.InitialState).toBe(0)
    expect(authored.States.map((state) => state.StateName)).toEqual([
      'Grounded',
      'Fall',
      'Jump',
      'Land',
      'Land Movement',
      'Land Conduct',
    ])
    expect(authored.Transitions).toHaveLength(16)
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS).toHaveLength(16)

    const stateTransitionByIndex = new Map(
      authored.States.flatMap((state) => state.Transitions).map(
        (transition) => [transition.TransitionIndex, transition],
      ),
    )
    for (
      let transitionIndex = 0;
      transitionIndex < authored.Transitions.length;
      transitionIndex++
    ) {
      const extracted = authored.Transitions[transitionIndex]
      const runtime =
        ALS_LOCOMOTION_GRAPH_TRANSITIONS[transitionIndex]
      const stateTransition = stateTransitionByIndex.get(transitionIndex)
      expect(stateTransition).toBeDefined()
      expect(runtime).toMatchObject({
        transitionIndex,
        from: extracted.PreviousStateName,
        to: extracted.NextStateName,
        duration: extracted.CrossfadeDuration,
        blendOption: extracted.BlendMode.replace(
          'EAlphaBlendOption::',
          '',
        ),
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
      const profile = extracted.BlendProfile?.ObjectName
        .match(/:([^']+)'$/)?.[1] ?? null
      expect(runtime.blendProfile).toBe(profile)
      expect(runtime.startNotify === null ? -1 : 0).toBe(
        extracted.StartNotify,
      )
    }

    expect(authored.States.find(
      (state) => state.StateName === 'Jump',
    )?.bAlwaysResetOnEntry).toBe(true)
    expect(authored.States.find(
      (state) => state.StateName === 'Land Conduct',
    )?.bIsAConduit).toBe(true)
    expect(node(ALS_LOCOMOTION_STATES_MACHINE.compiledNodeIndex))
      .toMatchObject({
        type: 'FAnimNode_StateMachine',
        parameters: {
          StateMachineIndexInClass: 0,
          MaxTransitionsPerFrame: 3,
          MaxTransitionsRequests: 32,
          bSkipFirstUpdateTransition: true,
          bReinitializeOnBecomingRelevant: true,
          bAllowConduitEntryStates: false,
        },
      })
  })

  it('pins Jump States order, flags, and all five transitions', () => {
    const authored = machine('Jump States')
    expect(authored.InitialState).toBe(0)
    expect(authored.States.map((state) => state.StateName)).toEqual([
      'Entry Conduit',
      'Left Foot',
      'Right Foot',
      'Loop',
      'Flail',
    ])
    expect(authored.Transitions).toHaveLength(5)
    expect(ALS_JUMP_GRAPH_TRANSITIONS).toHaveLength(5)

    const stateTransitionByIndex = new Map(
      authored.States.flatMap((state) => state.Transitions).map(
        (transition) => [transition.TransitionIndex, transition],
      ),
    )
    for (
      let transitionIndex = 0;
      transitionIndex < authored.Transitions.length;
      transitionIndex++
    ) {
      const extracted = authored.Transitions[transitionIndex]
      const runtime = ALS_JUMP_GRAPH_TRANSITIONS[transitionIndex]
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
        logic: extracted.LogicType.replace(
          'ETransitionLogicType::TLT_',
          '',
        ),
        compiledDelegateIndex:
          stateTransition?.rule.compiledDelegateIndex,
        compiledDelegateProperty:
          stateTransition?.rule.compiledDelegateProperty,
      })
    }

    expect(authored.States[0].bIsAConduit).toBe(true)
    expect(node(ALS_JUMP_STATES_MACHINE.compiledNodeIndex))
      .toMatchObject({
        type: 'FAnimNode_StateMachine',
        parameters: {
          StateMachineIndexInClass: 1,
          MaxTransitionsPerFrame: 3,
          MaxTransitionsRequests: 32,
          bSkipFirstUpdateTransition: true,
          bReinitializeOnBecomingRelevant: true,
          bAllowConduitEntryStates: true,
        },
      })
  })

  it('freezes the recovered transition expressions and conduit distinction', () => {
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS.map(
      (transition) => transition.rule,
    )).toEqual([
      'LocomotionMode == InAir && bJumped',
      'LocomotionMode == InAir',
      'true',
      'LocomotionMode == Grounded',
      'true',
      'LocomotionMode == Grounded',
      'Stance != Standing',
      'GetRelevantAnimTimeRemaining(Land) <= 0',
      'bHasInput || bRotatingLeft || bRotatingRight || Speed >= 650',
      'LocomotionMode == InAir && bJumped',
      'LocomotionMode == InAir',
      'AutomaticRemainingTimeRule',
      'LocomotionMode == InAir && bJumped',
      'LocomotionMode == InAir',
      'bHasInput',
      'true',
    ])
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS[2])
      .toMatchObject({
        rule: 'true',
        targetConduitEntryRule: 'LocomotionMode == Grounded',
      })
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS[7])
      .toMatchObject({
        duration: 0.8,
        blendOption: 'Cubic',
        logic: 'StandardBlend',
        blendProfile: 'QuickFeetBlend',
        startNotify: 'LandToGrounded',
      })
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS[11])
      .toMatchObject({
        duration: 0.3,
        automaticRemainingTimeRule: true,
        automaticRuleTriggerTime: -1,
      })

    expect(ALS_JUMP_GRAPH_TRANSITIONS.map(
      (transition) => transition.rule,
    )).toEqual([
      'FootPlantedAmount > 0',
      'FootPlantedAmount <= 0',
      'GetRelevantAnimTimeRemaining(Left Foot) <= 0',
      'GetRelevantAnimTimeRemaining(Right Foot) <= 0',
      'true',
    ])
  })

  it('pins the binary-equal editor-graph to compiled-rule oracle', () => {
    expect(locomotionAsset.transitionRuleBytecodeSource).toEqual({
      parser: 'UAssetAPI 1.1.0',
      binaryEqualityVerified: true,
      ubergraph: 'ExecuteUbergraph_AB_Als_Locomotion',
      targetedRuleCount: 11,
    })
    expect(locomotionAsset.transitionRuleGraphs).toHaveLength(18)
    expect(locomotionAsset.transitionRuleGraphs.filter(
      (graph) => graph.bakedEdgeMapping.status === 'resolved',
    )).toHaveLength(16)
    expect(locomotionAsset.transitionRuleGraphs.filter(
      (graph) => graph.bakedEdgeMapping.status === 'conduit-entry',
    )).toHaveLength(2)

    for (const [
      compiledDelegateProperty,
      compiledFunction,
    ] of [
      ['AnimGraphNode_TransitionResult_1', 'Greater_DoubleDouble'],
      ['AnimGraphNode_TransitionResult_2', 'LessEqual_DoubleDouble'],
      ['AnimGraphNode_TransitionResult_3', 'LessEqual_DoubleDouble'],
      ['AnimGraphNode_TransitionResult_4', 'LessEqual_DoubleDouble'],
      ['AnimGraphNode_TransitionResult_13', 'LessEqual_DoubleDouble'],
    ] as const) {
      const graph = transitionRuleGraph(compiledDelegateProperty)
      expect(graph.compiledRule).toMatchObject({
        compiledDelegateProperty,
        assignment: {
          target: `${compiledDelegateProperty}.bCanEnterTransition`,
          expressionType: 'EX_LocalVariable',
        },
        constantBearingCalls: [{
          function: compiledFunction,
          numericConstants: [0],
          nameConstants: [],
        }],
        numericConstants: [0],
      })
      expect(graph.compiledRule?.generatedFunction.endsWith(
        graph.resultNodeGuid,
      )).toBe(true)
    }

    const leftFootFinished = transitionRuleGraph(
      'AnimGraphNode_TransitionResult_3',
    )
    const rightFootFinished = transitionRuleGraph(
      'AnimGraphNode_TransitionResult_4',
    )
    expect(leftFootFinished.nodes).toContainEqual(expect.objectContaining({
      function: 'GetRelevantAnimTimeRemaining',
      sourceState: 'Left Foot',
    }))
    expect(rightFootFinished.nodes).toContainEqual(expect.objectContaining({
      function: 'GetRelevantAnimTimeRemaining',
      sourceState: 'Right Foot',
    }))
    expect(ALS_JUMP_STATES_MACHINE.launchRemainingTimeThreshold).toBe(
      leftFootFinished.compiledRule?.numericConstants[0],
    )
    expect(rightFootFinished.compiledRule?.numericConstants[0]).toBe(
      ALS_JUMP_STATES_MACHINE.launchRemainingTimeThreshold,
    )

    const landFinished = transitionRuleGraph(
      'AnimGraphNode_TransitionResult_13',
    )
    expect(landFinished.nodes).toContainEqual(expect.objectContaining({
      function: 'GetRelevantAnimTimeRemaining',
      sourceState: 'Land',
    }))
    expect(ALS_LOCOMOTION_GRAPH_TRANSITIONS[7].rule).toBe(
      `GetRelevantAnimTimeRemaining(Land) <= ${
        landFinished.compiledRule?.numericConstants[0]
      }`,
    )

    const landMovement = transitionRuleGraph(
      'AnimGraphNode_TransitionResult_14',
    )
    expect(landMovement.compiledRule).toMatchObject({
      assignment: {
        target:
          'AnimGraphNode_TransitionResult_14.bCanEnterTransition',
      },
      constantBearingCalls: [{
        function: 'GreaterEqual_DoubleDouble',
        numericConstants: [650],
        nameConstants: [],
      }],
      numericConstants: [650],
    })
    expect(landMovement.nodes).toContainEqual(expect.objectContaining({
      function: 'GreaterEqual_DoubleDouble',
    }))
    expect(landMovement.nodes).toContainEqual(expect.objectContaining({
      propertyPath: ['GetParent', 'LocomotionState', 'Speed'],
    }))
  })
})

describe('VERIFIED compiled InAir pose graph', () => {
  it('pins Fall, Flail, prediction, and landing map orientations', () => {
    expect(node(68)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 69 },
        B: { LinkID: 70 },
        AlphaScaleBiasClamp: {
          bMapRange: true,
          bClampResult: false,
          bInterpResult: true,
          InRange: { Min: 0, Max: -1000 },
          OutRange: { Min: 0, Max: 1 },
          InterpSpeedIncreasing: 5,
          InterpSpeedDecreasing: 5,
        },
      },
    })
    expect(node(72)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 68 },
        B: { LinkID: 71 },
        AlphaScaleBiasClamp: {
          bMapRange: true,
          bClampResult: false,
          bInterpResult: true,
          InRange: { Min: -500, Max: -3000 },
          OutRange: { Min: 0, Max: 1 },
          InterpSpeedIncreasing: 5,
          InterpSpeedDecreasing: 5,
        },
      },
    })
    for (const compiledIndex of [38, 66]) {
      expect(node(compiledIndex)).toMatchObject({
        type: 'FAnimNode_TwoWayBlend',
        parameters: {
          AlphaScaleBiasClamp: {
            bMapRange: false,
            bClampResult: false,
            bInterpResult: true,
            InterpSpeedIncreasing: 20,
            InterpSpeedDecreasing: 5,
          },
        },
      })
    }
    expect(node(35)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 37 },
        B: { LinkID: 36 },
        AlphaScaleBiasClamp: {
          InRange: { Min: -1000, Max: -500 },
          OutRange: { Min: 0, Max: 1 },
          bClampResult: false,
          bInterpResult: false,
        },
      },
    })
    expect(node(63)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 65 },
        B: { LinkID: 64 },
      },
    })
    expect(node(27)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 28 },
        B: { LinkID: 29 },
        AlphaScaleBiasClamp: {
          InRange: { Min: -500, Max: -1000 },
          OutRange: { Min: 0, Max: 1 },
          bInterpResult: false,
        },
      },
    })
  })

  it('pins launch and moving-land mappings, including the 0.25 clamp', () => {
    for (const compiledIndex of [50, 54]) {
      expect(node(compiledIndex)).toMatchObject({
        type: 'FAnimNode_TwoWayBlend',
        parameters: {
          AlphaScaleBiasClamp: {
            InRange: { Min: 200, Max: 500 },
            OutRange: { Min: 0, Max: 1 },
            bClampResult: false,
            bInterpResult: true,
            InterpSpeedIncreasing: 5,
            InterpSpeedDecreasing: 5,
          },
        },
      })
    }
    expect(node(18)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 17 },
        B: { LinkID: 19 },
        AlphaScaleBiasClamp: {
          InRange: { Min: 0, Max: -200 },
          OutRange: { Min: 0.25, Max: 1 },
          bClampResult: true,
          ClampMin: 0.25,
          ClampMax: 1,
          bInterpResult: false,
        },
      },
    })
    expect(node(21)).toMatchObject({
      type: 'FAnimNode_TwoWayBlend',
      parameters: {
        A: { LinkID: 23 },
        B: { LinkID: 22 },
        AlphaScaleBiasClamp: {
          InRange: { Min: -750, Max: -1500 },
          OutRange: { Min: 0, Max: 0.75 },
          bClampResult: false,
          bInterpResult: false,
        },
      },
    })
    expect(node(19)).toMatchObject({
      type: 'FAnimNode_ApplyMeshSpaceAdditive',
      parameters: {
        Base: { LinkID: 20 },
        Additive: { LinkID: 21 },
        AlphaScaleBiasClamp: {
          InRange: { Min: 0, Max: 1 },
          OutRange: { Min: 1, Max: 0.5 },
          bClampResult: false,
          bInterpResult: true,
          InterpSpeedIncreasing: 2.5,
          InterpSpeedDecreasing: 20,
        },
      },
    })
  })

  it('pins sequence players, sync groups, starts, rates, and looping', () => {
    for (const player of Object.values(ALS_IN_AIR_PLAYERS)) {
      if ('compiledNodeIndex' in player) {
        const extracted = node(player.compiledNodeIndex)
        expect(extracted.parameters).toMatchObject({
          Sequence: {
            ObjectName: `AnimSequence'${player.clip}'`,
          },
        })
        if ('group' in player) {
          expect(extracted.parameters.GroupName).toBe(
            player.group ?? 'None',
          )
        }
        if ('playRate' in player) {
          expect(extracted.parameters.PlayRate).toBe(player.playRate)
        }
        if ('startPosition' in player) {
          expect(extracted.parameters.StartPosition).toBe(
            player.startPosition,
          )
        }
        if ('loop' in player) {
          expect(extracted.parameters.bLoopAnimation).toBe(player.loop)
        }
      } else {
        for (const compiledIndex of player.compiledNodeIndices) {
          expect(node(compiledIndex)).toMatchObject({
            type: 'FAnimNode_SequenceEvaluator',
            parameters: {
              Sequence: {
                ObjectName: `AnimSequence'${player.clip}'`,
              },
              ExplicitTime: player.explicitTime,
              bTeleportToExplicitTime:
                player.teleportToExplicitTime,
            },
          })
        }
      }
    }
  })

  it('pins air-lean evaluators and explicit ModifyCurve outputs', () => {
    for (const compiledIndex of [32, 61]) {
      expect(node(compiledIndex)).toMatchObject({
        type: 'FAnimNode_BlendSpaceEvaluator',
        parameters: {
          NormalizedTime: 0,
          bTeleportToNormalizedTime: true,
          GroupName: 'None',
          Method: 'EAnimSyncMethod::DoNotSync',
          BlendSpace: {
            ObjectName: "BlendSpace'BS_Als_Air_Lean'",
          },
        },
      })
    }
    for (const compiledIndex of [34, 67]) {
      expect(node(compiledIndex)).toMatchObject({
        type: 'FAnimNode_ModifyCurve',
        parameters: {
          CurveNames: ['PoseStanding', 'PoseInAir'],
          CurveValues: [1, 1],
        },
      })
    }
    expect(node(26)).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        CurveNames: [
          'FootLeftIk',
          'FootRightIk',
          'FootLeftLock',
          'FootRightLock',
          'PoseStanding',
        ],
        CurveValues: [1, 1, 1, 1, 1],
      },
    })
    expect(ALS_IN_AIR_CURVE_OUTPUTS).toEqual({
      Jump: { PoseStanding: 1, PoseInAir: 1 },
      Fall: { PoseStanding: 1, PoseInAir: 1 },
      Land: {
        FootLeftIk: 1,
        FootRightIk: 1,
        FootLeftLock: 1,
        FootRightLock: 1,
        PoseStanding: 1,
      },
      'Land Movement': {},
    })
  })
})

describe('VERIFIED outer Locomotion States decisions', () => {
  it('takes Jump before Fall only for the one-frame bJumped latch', () => {
    expect(selectAlsLocomotionGraphTransition(
      'Grounded',
      baseTransitionInput({
        locomotionMode: 'InAir',
        jumped: true,
      }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[0])
    expect(selectAlsLocomotionGraphTransition(
      'Grounded',
      baseTransitionInput({ locomotionMode: 'InAir' }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[1])
  })

  it('keeps Jump through the apex and lands through the conduit', () => {
    expect(selectAlsLocomotionGraphTransition(
      'Jump',
      baseTransitionInput({ locomotionMode: 'InAir' }),
    )).toBeNull()
    expect(selectAlsLocomotionGraphTransition(
      'Jump',
      baseTransitionInput({ locomotionMode: 'Grounded' }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[4])
    expect(selectAlsLocomotionGraphTransition(
      'Fall',
      baseTransitionInput({ locomotionMode: 'Grounded' }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[2])
    expect(selectAlsLocomotionGraphTransition(
      'Land Conduct',
      baseTransitionInput({ hasInput: true }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[14])
    expect(selectAlsLocomotionGraphTransition(
      'Land Conduct',
      baseTransitionInput({ hasInput: false }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[15])
  })

  it('uses the exact Land <=0 and 650 cm/s boundaries', () => {
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({ landRemainingTime: Number.EPSILON }),
    )).toBeNull()
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({ landRemainingTime: 0 }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[7])
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({ speed: 6.49999 }),
    )).toBeNull()
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({ speed: 6.5 }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[8])
  })

  it('preserves Land priority and Land Movement automatic-rule priority', () => {
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({
        stance: 'Crouching',
        landRemainingTime: 0,
        hasInput: true,
        locomotionMode: 'InAir',
        jumped: true,
      }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[6])
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({
        hasInput: true,
        locomotionMode: 'InAir',
        jumped: true,
      }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[8])
    expect(selectAlsLocomotionGraphTransition(
      'Land',
      baseTransitionInput({
        locomotionMode: 'InAir',
        jumped: true,
      }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[9])
    expect(selectAlsLocomotionGraphTransition(
      'Land Movement',
      baseTransitionInput({
        landMovementAutomaticRemainingTimeReached: true,
        locomotionMode: 'InAir',
        jumped: true,
      }),
    )).toBe(ALS_LOCOMOTION_GRAPH_TRANSITIONS[11])
  })
})

describe('VERIFIED nested Jump States decisions and weights', () => {
  it('uses FootPlantedAmount sign and the exact <=0 exit rule', () => {
    expect(selectAlsJumpGraphTransition('Entry Conduit', {
      footPlantedAmount: Number.EPSILON,
      launchRemainingTime: 1,
    })).toBe(ALS_JUMP_GRAPH_TRANSITIONS[0])
    expect(selectAlsJumpGraphTransition('Entry Conduit', {
      footPlantedAmount: 0,
      launchRemainingTime: 1,
    })).toBe(ALS_JUMP_GRAPH_TRANSITIONS[1])
    expect(selectAlsJumpGraphTransition('Left Foot', {
      footPlantedAmount: 0,
      launchRemainingTime: Number.EPSILON,
    })).toBeNull()
    expect(selectAlsJumpGraphTransition('Left Foot', {
      footPlantedAmount: 0,
      launchRemainingTime: 0,
    })).toBe(ALS_JUMP_GRAPH_TRANSITIONS[2])
    expect(selectAlsJumpGraphTransition('Loop', {
      footPlantedAmount: 0,
      launchRemainingTime: 1,
    })).toBe(ALS_JUMP_GRAPH_TRANSITIONS[4])
  })

  it('selects the foot, requests launch inertialization once, then blends Loop to Flail', () => {
    const clock = resetAlsJumpStateClock(
      createAlsJumpStateClock(),
      1,
    )
    expect(clock.state).toBe('Right Foot')

    refreshAlsJumpStateClock(clock, {
      deltaTime: 1,
      launchRemainingTime: Number.EPSILON,
    })
    expect(clock.state).toBe('Right Foot')

    refreshAlsJumpStateClock(clock, {
      deltaTime: 0.25,
      launchRemainingTime: 0,
    })
    expect(clock).toMatchObject({
      state: 'Loop',
      loopToFlailActive: true,
      loopToFlailElapsedTime: 0.25,
      loopWeight: 0.84375,
      flailWeight: 0.15625,
      inertializationRequestDuration: 0.2,
    })

    refreshAlsJumpStateClock(clock, {
      deltaTime: 0.25,
      launchRemainingTime: 0,
    })
    expect(clock.loopWeight).toBeCloseTo(0.5)
    expect(clock.flailWeight).toBeCloseTo(0.5)
    expect(clock.inertializationRequestDuration).toBeNull()

    refreshAlsJumpStateClock(clock, {
      deltaTime: 0.5,
      launchRemainingTime: 0,
    })
    expect(clock).toMatchObject({
      state: 'Flail',
      loopToFlailActive: false,
      loopWeight: 0,
      flailWeight: 1,
    })
  })

  it('maps repository m/s to the authored 200..500 cm/s launch blend', () => {
    const state = createAlsInAirGraphState()
    enterAlsJumpGraph(state, 0.25)
    const right = refreshAlsJumpGraph(state, {
      ...airInput(),
      speed: 3.5,
      jumpPlayRate: 1.35,
      launchRemainingTime: 1,
    })
    expect(right).toMatchObject({
      state: 'Right Foot',
      jumpWalkLeftWeight: 0,
      jumpRunLeftWeight: 0,
      jumpWalkRightWeight: 0.5,
      jumpRunRightWeight: 0.5,
      jumpLoopWeight: 0,
      flailWeight: 0,
      rawLaunchRunAmount: 0.5,
      launchRunAmount: 0.5,
      jumpPlayRate: 1.35,
      flailPlayRate: 1.2,
      curves: ALS_IN_AIR_CURVE_OUTPUTS.Jump,
    })

    enterAlsJumpGraph(state, -0.25)
    const left = refreshAlsJumpGraph(state, {
      ...airInput(),
      speed: 2,
      jumpPlayRate: 1.2,
      launchRemainingTime: 1,
    })
    expect(left).toMatchObject({
      state: 'Left Foot',
      jumpWalkLeftWeight: 1,
      jumpRunLeftWeight: 0,
      jumpWalkRightWeight: 0,
      jumpRunRightWeight: 0,
    })
  })
})

describe('VERIFIED Fall, prediction, and landing samples', () => {
  it('composes Fall Fast, Fall, and Flail from the authored maps', () => {
    const result = refreshAlsFallGraph(
      createAlsInAirGraphState(),
      airInput({ verticalVelocity: -10 }),
    )
    expect(result).toMatchObject({
      rawFallBlendAmount: 1,
      fallBlendAmount: 1,
      rawFlailBlendAmount: 0.2,
      flailBlendAmount: 0.2,
      fallFastWeight: 0,
      fallWeight: 0.8,
      flailWeight: 0.2,
      curves: ALS_IN_AIR_CURVE_OUTPUTS.Fall,
    })
    expect(
      result.fallFastWeight
      + result.fallWeight
      + result.flailWeight,
    ).toBeCloseTo(1)
  })

  it('uses FInterpTo and asymmetric 20/5 ground-prediction speeds', () => {
    const state = createAlsInAirGraphState()
    refreshAlsFallGraph(state, airInput())
    const falling = refreshAlsFallGraph(
      state,
      airInput({ deltaTime: 0.1, verticalVelocity: -10 }),
    )
    expect(falling.rawFallBlendAmount).toBeCloseTo(0.5)
    expect(falling.rawFlailBlendAmount).toBeCloseTo(0)

    const predicting = refreshAlsFallGraph(state, airInput({
      deltaTime: 0.025,
      verticalVelocity: -10,
      groundPredictionAmount: 1,
    }))
    expect(predicting.air.groundPredictionAmount).toBeCloseTo(0.5)

    const clearing = refreshAlsFallGraph(state, airInput({
      deltaTime: 0.1,
      verticalVelocity: -10,
      groundPredictionAmount: 0,
    }))
    expect(clearing.air.groundPredictionAmount).toBeCloseTo(0.25)
  })

  it('blends the frozen Heavy/Light landing poses under prediction', () => {
    const result = refreshAlsFallGraph(
      createAlsInAirGraphState(),
      airInput({
        verticalVelocity: -7.5,
        groundPredictionAmount: 1,
        leanRightAmount: 0.5,
        leanForwardAmount: -0.25,
      }),
    )
    expect(result.air).toEqual({
      airPoseWeight: 0,
      airLeanAdditiveWeight: 0,
      airLeanBlendSpace: 'BS_Als_Air_Lean',
      airLeanX: 0.5,
      airLeanY: -0.25,
      airLeanNormalizedTime: 0,
      landingPreviewLightWeight: 0.5,
      landingPreviewHeavyWeight: 0.5,
      rawGroundPredictionAmount: 1,
      groundPredictionAmount: 1,
      landingPreviewLightAmount: 0.5,
    })
  })

  it('maps static Land Light/Heavy and emits all five forced curves', () => {
    expect(sampleAlsLandGraph({ verticalVelocity: -5 }))
      .toMatchObject({
        landLightWeight: 1,
        landHeavyWeight: 0,
        landHeavyAmount: 0,
        curves: ALS_IN_AIR_CURVE_OUTPUTS.Land,
      })
    expect(sampleAlsLandGraph({ verticalVelocity: -7.5 }))
      .toMatchObject({
        landLightWeight: 0.5,
        landHeavyWeight: 0.5,
        landHeavyAmount: 0.5,
      })
    expect(sampleAlsLandGraph({ verticalVelocity: -10 }))
      .toMatchObject({
        landLightWeight: 0,
        landHeavyWeight: 1,
        landHeavyAmount: 1,
      })
  })

  it('composes moving Land outer, mesh-additive, and Aiming alphas', () => {
    const state = createAlsInAirGraphState()
    const light = refreshAlsLandMovementGraph(state, {
      deltaTime: 0,
      verticalVelocity: 1,
      rotationMode: 'ViewDirection',
    })
    expect(light).toMatchObject({
      groundedBaseWeight: 1,
      groundedOnlyWeight: 0.75,
      landMovementPoseWeight: 0.25,
      landLightAdditiveWeight: 0.25,
      landHeavyAdditiveWeight: 0,
      groundedToAdditiveAmount: 0.25,
      aimingAdditiveAmount: 1,
      effectiveAdditiveAmount: 0.25,
      curves: ALS_IN_AIR_CURVE_OUTPUTS['Land Movement'],
    })

    const heavyAiming = refreshAlsLandMovementGraph(state, {
      deltaTime: 0.1,
      verticalVelocity: -17.5,
      rotationMode: 'Aiming',
    })
    expect(heavyAiming).toMatchObject({
      groundedBaseWeight: 1,
      groundedOnlyWeight: 0,
      landMovementPoseWeight: 1,
      landLightAdditiveWeight: 0,
      landHeavyAdditiveWeight: 0.5,
      rawLandHeavyAmount: 1,
      landHeavyAmount: 1,
      groundedToAdditiveAmount: 1,
      aimingAdditiveAmount: 0.5,
      effectiveAdditiveAmount: 0.5,
    })

    const leavingAim = refreshAlsLandMovementGraph(state, {
      deltaTime: 0.1,
      verticalVelocity: -17.5,
      rotationMode: 'ViewDirection',
    })
    expect(leavingAim.aimingAdditiveAmount).toBeCloseTo(0.625)
    expect(leavingAim.landHeavyAdditiveWeight).toBeCloseTo(0.625)
  })

  it('matches every frozen graph mapping constant used by the samplers', () => {
    expect(ALS_IN_AIR_GRAPH).toMatchObject({
      fall: {
        fallFastBlend: {
          inputMinimum: 0,
          inputMaximum: -1000,
          interpolationSpeedIncreasing: 5,
          interpolationSpeedDecreasing: 5,
        },
        flailBlend: {
          inputMinimum: -500,
          inputMaximum: -3000,
          interpolationSpeedIncreasing: 5,
          interpolationSpeedDecreasing: 5,
        },
      },
      jump: {
        launchBlend: {
          inputMinimum: 200,
          inputMaximum: 500,
          interpolationSpeedIncreasing: 5,
          interpolationSpeedDecreasing: 5,
        },
      },
      air: {
        groundPredictionBlend: {
          interpolationSpeedIncreasing: 20,
          interpolationSpeedDecreasing: 5,
        },
        landingPreviewBlend: {
          inputMinimum: -1000,
          inputMaximum: -500,
        },
      },
      land: {
        blend: {
          inputMinimum: -500,
          inputMaximum: -1000,
        },
      },
      landMovement: {
        groundedToAdditiveBlend: {
          inputMinimum: 0,
          inputMaximum: -200,
          outputMinimum: 0.25,
          outputMaximum: 1,
          clampMinimum: 0.25,
        },
        additiveBlend: {
          inputMinimum: -750,
          inputMaximum: -1500,
          outputMaximum: 0.75,
        },
        aimingBlend: {
          outputMinimum: 1,
          outputMaximum: 0.5,
          interpolationSpeedIncreasing: 2.5,
          interpolationSpeedDecreasing: 20,
        },
      },
    })
  })
})
