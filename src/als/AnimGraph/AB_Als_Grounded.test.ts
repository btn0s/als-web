import { describe, expect, it } from 'vitest'
import abpGraphSource
  from '../../../scripts/extract-als/abp-graph.json?raw'
import {
  ALS_GROUNDED_ROLL_GRAPH_MACHINE,
  ALS_GROUNDED_ROLL_STATE,
  ALS_GROUNDED_ROLL_TRANSITIONS,
  createAlsGroundedRollGraphRuntime,
  refreshAlsGroundedRollGraph,
  selectAlsGroundedEntryState,
} from './AB_Als_Grounded'

interface ExtractedNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: Record<string, unknown>
}

interface ExtractedState {
  readonly StateName: string
  readonly StateRootNodeCompiledIndex: number | null
  readonly bAlwaysResetOnEntry: boolean
  readonly PlayerNodeCompiledIndices: readonly number[]
}

interface ExtractedTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly BlendMode: string
  readonly LogicType: string
}

interface ExtractedMachine {
  readonly MachineName: string
  readonly InitialState: number
  readonly States: readonly ExtractedState[]
  readonly Transitions: readonly ExtractedTransition[]
}

interface ExtractedAbp {
  readonly assets: {
    readonly AB_Als_Grounded: {
      readonly nodes: readonly ExtractedNode[]
      readonly stateMachines: readonly ExtractedMachine[]
    }
  }
}

const abp = (
  JSON.parse(abpGraphSource) as ExtractedAbp
).assets.AB_Als_Grounded
const machine = abp.stateMachines.find(
  ({ MachineName }) =>
    MachineName === ALS_GROUNDED_ROLL_GRAPH_MACHINE.name,
)
if (!machine) throw new Error('Missing Grounded States')

function node(compiledIndex: number) {
  const result = abp.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!result) {
    throw new Error(
      `Missing AB_Als_Grounded node ${compiledIndex}`,
    )
  }
  return result
}

const refreshInput = (
  overrides: Partial<
    Parameters<typeof refreshAlsGroundedRollGraph>[1]
  > = {},
) => ({
  deltaTime: 0,
  relevant: true,
  stance: 'Standing' as const,
  movingSmooth: false,
  rotatingLeft: false,
  rotatingRight: false,
  poseStandingAmount: 1,
  poseCrouchingAmount: 0,
  groundedEntryMode: null,
  ...overrides,
})

describe('VERIFIED AB_Als_Grounded Roll topology', () => {
  it('pins the authored conduit, Roll state, and two exit transitions', () => {
    expect(machine.InitialState).toBe(
      ALS_GROUNDED_ROLL_GRAPH_MACHINE.initialStateIndex,
    )
    const roll = machine.States[ALS_GROUNDED_ROLL_STATE.stateIndex]
    expect(roll).toMatchObject({
      StateName: 'Roll',
      StateRootNodeCompiledIndex:
        ALS_GROUNDED_ROLL_STATE.stateResultNodeIndex,
      bAlwaysResetOnEntry:
        ALS_GROUNDED_ROLL_STATE.alwaysResetOnEntry,
      PlayerNodeCompiledIndices: [
        ALS_GROUNDED_ROLL_STATE.sequenceEvaluator.compiledNodeIndex,
      ],
    })

    for (const transition of [
      ALS_GROUNDED_ROLL_TRANSITIONS.enter,
      ALS_GROUNDED_ROLL_TRANSITIONS.toCrouching,
      ALS_GROUNDED_ROLL_TRANSITIONS.toStanding,
    ]) {
      expect(
        machine.Transitions[transition.transitionIndex],
      ).toMatchObject({
        PreviousStateName: transition.from,
        NextStateName: transition.to,
        CrossfadeDuration: transition.duration,
        BlendMode:
          `EAlphaBlendOption::${transition.blendOption}`,
        LogicType: 'ETransitionLogicType::TLT_StandardBlend',
      })
    }
  })

  it('pins the endpoint evaluator, forced foot locks, reset, and exit callback', () => {
    expect(
      node(
        ALS_GROUNDED_ROLL_STATE.sequenceEvaluator.compiledNodeIndex,
      ),
    ).toMatchObject({
      type: 'FAnimNode_SequenceEvaluator',
      parameters: {
        GroupName: 'None',
        GroupRole: 'EAnimGroupRole::CanBeLeader',
        Method: 'EAnimSyncMethod::DoNotSync',
        ExplicitTime: 1.5,
        bShouldLoop: true,
        bTeleportToExplicitTime: true,
        ReinitializationBehavior:
          'ESequenceEvalReinit::ExplicitTime',
      },
    })
    expect(
      node(ALS_GROUNDED_ROLL_STATE.modifyCurve.compiledNodeIndex),
    ).toMatchObject({
      type: 'FAnimNode_ModifyCurve',
      parameters: {
        CurveNames: ['FootLeftLock', 'FootRightLock'],
        CurveValues: [1, 1],
        Alpha: 1,
        ApplyMode: 'EModifyCurveApplyMode::Blend',
      },
    })
    expect(
      node(
        ALS_GROUNDED_ROLL_STATE
          .resetGroundedEntryMode.compiledNodeIndex,
      ),
    ).toMatchObject({
      type: 'FAnimNode_CallFunction',
      parameters: {
        CallSite: 'EAnimFunctionCallSite::OnBecomeRelevant',
      },
    })
    expect(
      node(ALS_GROUNDED_ROLL_STATE.stateResultNodeIndex),
    ).toMatchObject({
      type: 'FAnimNode_StateResult',
      parameters: {
        StateExitFunction: {
          FunctionName:
            ALS_GROUNDED_ROLL_STATE.stateExitCallback,
        },
      },
    })
  })

  it('pins the generated PlayTransitionRightAnimation request', () => {
    expect(
      ALS_GROUNDED_ROLL_STATE.stateExitTransitionAnimation,
    ).toEqual({
      function: 'PlayTransitionRightAnimation',
      sequences: {
        Standing: 'A_Als_Stand_Transition_Right',
        Crouching: 'A_Als_Crouch_Transition_Right',
      },
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.2,
      fromStandingIdleOnly: false,
    })
  })
})

describe('AB_Als_Grounded Roll retained runtime', () => {
  it('selects FromRoll only while the entry conduit is idle', () => {
    expect(selectAlsGroundedEntryState(refreshInput({
      groundedEntryMode: 'FromRoll',
    }))).toBe('Roll')
    expect(selectAlsGroundedEntryState(refreshInput({
      groundedEntryMode: 'FromRoll',
      movingSmooth: true,
    }))).toBe('Standing')
    expect(selectAlsGroundedEntryState(refreshInput({
      groundedEntryMode: 'FromRoll',
      rotatingLeft: true,
      poseStandingAmount: 0,
      poseCrouchingAmount: 1,
    }))).toBe('Crouching')
  })

  it('reinitializes into Roll, skips its entry blend, and retains its 0.6-second Cubic exit', () => {
    const runtime = createAlsGroundedRollGraphRuntime()
    refreshAlsGroundedRollGraph(runtime, refreshInput({
      relevant: false,
    }))

    const entered = refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({ groundedEntryMode: 'FromRoll' }),
    )
    expect(entered.transition).toBe(
      ALS_GROUNDED_ROLL_TRANSITIONS.enter,
    )
    expect(entered.resetGroundedEntryMode).toBe(true)
    expect(runtime.currentState).toBe('Roll')
    expect(runtime.stateWeights).toEqual({
      Standing: 0,
      Crouching: 0,
      Roll: 1,
    })

    const exited = refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({ deltaTime: 0.3 }),
    )
    expect(exited.transition).toBe(
      ALS_GROUNDED_ROLL_TRANSITIONS.toStanding,
    )
    expect(exited.stateExitTransitionAnimation).toEqual({
      function: 'PlayTransitionRightAnimation',
      sequence: 'A_Als_Stand_Transition_Right',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.2,
      fromStandingIdleOnly: false,
    })
    expect(runtime.stateWeights.Roll).toBeCloseTo(0.5, 12)
    expect(runtime.stateWeights.Standing).toBeCloseTo(0.5, 12)

    const retained = refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({
        deltaTime: 0.15,
        stance: 'Crouching',
      }),
    )
    expect(retained.stateExitTransitionAnimation).toBeNull()
    expect(runtime.activeExitTransition?.target).toBe('Standing')
    expect(runtime.stateWeights.Roll).toBeCloseTo(0.15625, 12)
    expect(runtime.stateWeights.Standing).toBeCloseTo(0.84375, 12)

    refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({
        deltaTime: 0.15,
        stance: 'Crouching',
      }),
    )
    expect(runtime.activeExitTransition).toBeNull()
    expect(runtime.stateWeights).toEqual({
      Standing: 1,
      Crouching: 0,
      Roll: 0,
    })
  })

  it('freezes the crouching right-transition selection on Roll exit', () => {
    const runtime = createAlsGroundedRollGraphRuntime()
    refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({
        stance: 'Crouching',
        poseStandingAmount: 0,
        poseCrouchingAmount: 1,
        groundedEntryMode: 'FromRoll',
      }),
    )
    const exited = refreshAlsGroundedRollGraph(
      runtime,
      refreshInput({
        stance: 'Crouching',
        poseStandingAmount: 0,
        poseCrouchingAmount: 1,
      }),
    )
    expect(exited.transition).toBe(
      ALS_GROUNDED_ROLL_TRANSITIONS.toCrouching,
    )
    expect(exited.stateExitTransitionAnimation?.sequence)
      .toBe('A_Als_Crouch_Transition_Right')
  })
})
