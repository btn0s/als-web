/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_CROUCHING_MOVEMENT_MACHINE,
  ALS_CROUCHING_MOVEMENT_MULTI_WAY_BLEND_TABLE,
  ALS_CROUCHING_MOVEMENT_PLAYER,
  ALS_CROUCHING_MOVEMENT_STATE_ORDER,
  ALS_CROUCHING_MOVEMENT_STATES,
  ALS_CROUCHING_MOVEMENT_TRANSITIONS,
  createAlsCrouchingMovementRuntime,
  evaluateAlsCrouchingMovementState,
  refreshAlsCrouchingMovementRuntime,
  resetAlsCrouchingMovementRuntime,
  selectAlsCrouchingMovementTransition,
} from './crouchingMovement'
import type {
  AlsCrouchingMovementPoseWeights,
  AlsCrouchingVelocityBlend,
  AlsHipsDirection,
} from './crouchingMovement'

interface GraphNode {
  readonly compiledIndex: number | null
  readonly type: string
  readonly parameters: {
    readonly CachePoseName?: string
    readonly CallSite?: string
    readonly Function?: { readonly FunctionName: string }
    readonly GroupName?: string
    readonly GroupRole?: string
    readonly LinkToCachingNode?: { readonly LinkID: number }
    readonly Method?: string
    readonly Poses?: readonly { readonly LinkID: number }[]
    readonly Sequence?: { readonly ObjectName: string }
    readonly bLoopAnimation?: boolean
    readonly bNormalizeAlpha?: boolean
  }
}

interface ExtractedGraph {
  readonly assets: {
    readonly AB_Als_Crouching: {
      readonly nodes: readonly GraphNode[]
      readonly stateMachines: readonly {
        readonly MachineName: string
        readonly InitialState: number
        readonly States: readonly {
          readonly StateName: string
          readonly bAlwaysResetOnEntry: boolean
        }[]
        readonly Transitions: readonly {
          readonly PreviousStateName: string
          readonly NextStateName: string
          readonly CrossfadeDuration: number
          readonly BlendMode: string
          readonly BlendProfile: { readonly ObjectName: string } | null
        }[]
      }[]
    }
  }
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as ExtractedGraph
const asset = graph.assets.AB_Als_Crouching

function node(compiledIndex: number) {
  const value = asset.nodes.find(
    (candidate) => candidate.compiledIndex === compiledIndex,
  )
  if (!value) throw new Error(`Missing compiled crouching node ${compiledIndex}`)
  return value
}

function movementMachine() {
  const value = asset.stateMachines.find(
    (candidate) => candidate.MachineName === 'Movement States',
  )
  if (!value) throw new Error('Missing crouching Movement States machine')
  return value
}

function blend(
  forwardAmount: number,
  backwardAmount: number,
  leftAmount: number,
  rightAmount: number,
): AlsCrouchingVelocityBlend {
  return { forwardAmount, backwardAmount, leftAmount, rightAmount }
}

function dense(weights: AlsCrouchingMovementPoseWeights) {
  return ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
    (direction) => weights[direction],
  )
}

describe('VERIFIED AB_Als_Crouching Movement States topology', () => {
  it('matches the extracted six states, initial state, and 24 authored blends', () => {
    const movement = movementMachine()
    expect(ALS_CROUCHING_MOVEMENT_MACHINE).toEqual({
      machineName: 'Movement States',
      initialState: 'Forward',
      maxTransitionsPerFrame: 3,
      skipFirstUpdateTransition: true,
      reinitializeOnBecomingRelevant: true,
    })
    expect(movement.InitialState).toBe(0)
    expect(ALS_CROUCHING_MOVEMENT_STATE_ORDER.map((hipsDirection) => {
      const state = ALS_CROUCHING_MOVEMENT_STATES[hipsDirection]
      return {
        stateName: state.stateName,
        alwaysResetOnEntry: state.alwaysResetOnEntry,
      }
    })).toEqual(movement.States.map((state) => ({
      stateName: state.StateName,
      alwaysResetOnEntry: state.bAlwaysResetOnEntry,
    })))

    expect(ALS_CROUCHING_MOVEMENT_TRANSITIONS).toHaveLength(24)
    expect(ALS_CROUCHING_MOVEMENT_TRANSITIONS.map((transition) => ({
      from: ALS_CROUCHING_MOVEMENT_STATES[transition.from].stateName,
      to: ALS_CROUCHING_MOVEMENT_STATES[transition.to].stateName,
      duration: transition.duration,
      blendOption: `EAlphaBlendOption::${transition.blendOption}`,
      profile: transition.blendProfile,
    }))).toEqual(movement.Transitions.map((transition) => ({
      from: transition.PreviousStateName,
      to: transition.NextStateName,
      duration: transition.CrossfadeDuration,
      blendOption: transition.BlendMode,
      profile: transition.BlendProfile?.ObjectName.includes(
        'MoveDirectionChange',
      )
        ? 'MoveDirectionChange'
        : null,
    })))
  })

  it('matches all six cached cycles and OnBecomeRelevant SetHipsDirection nodes', () => {
    for (const hipsDirection of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const definition = ALS_CROUCHING_MOVEMENT_STATES[hipsDirection]
      expect(node(definition.sequencePlayerNodeIndex).parameters).toMatchObject({
        GroupName: ALS_CROUCHING_MOVEMENT_PLAYER.syncGroupName,
        GroupRole: 'EAnimGroupRole::CanBeLeader',
        Method: 'EAnimSyncMethod::SyncGroup',
        Sequence: {
          ObjectName: `AnimSequence'${definition.sequence}'`,
        },
        bLoopAnimation: true,
      })
      expect(node(definition.saveCachedPoseNodeIndex).parameters.CachePoseName)
        .toBe(definition.stateName)
      expect(node(definition.callFunctionNodeIndex).parameters).toMatchObject({
        CallSite: 'EAnimFunctionCallSite::OnBecomeRelevant',
        Function: {
          FunctionName: definition.callFunctionEventStub,
        },
      })
    }
  })

  it('matches every normalized MultiWay cache mapping', () => {
    for (const hipsDirection of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const multiWay = node(
        ALS_CROUCHING_MOVEMENT_STATES[hipsDirection].multiWayBlendNodeIndex,
      )
      expect(multiWay).toMatchObject({
        type: 'FAnimNode_MultiWayBlend',
        parameters: { bNormalizeAlpha: true },
      })
      expect(multiWay.parameters.Poses?.map((pose) => {
        const useCachedPose = node(pose.LinkID)
        const cacheNode = node(useCachedPose.parameters.LinkToCachingNode!.LinkID)
        const state = ALS_CROUCHING_MOVEMENT_STATE_ORDER.find(
          (candidate) =>
            ALS_CROUCHING_MOVEMENT_STATES[candidate].saveCachedPoseNodeIndex
            === cacheNode.compiledIndex,
        )
        return state
      })).toEqual(ALS_CROUCHING_MOVEMENT_MULTI_WAY_BLEND_TABLE[hipsDirection])
    }
  })
})

describe('VERIFIED crouching normalized MultiWay evaluation', () => {
  it('keeps a Forward-state F=.5/L=.5 blend split across Forward and LeftForward', () => {
    expect(evaluateAlsCrouchingMovementState(
      'Forward',
      blend(0.5, 0, 0.5, 0),
    )).toEqual({
      Forward: 0.5,
      Backward: 0,
      RightForward: 0,
      RightBackward: 0,
      LeftForward: 0.5,
      LeftBackward: 0,
    })
  })

  it('maps all four VelocityBlend channels in every hips-direction state', () => {
    const channels = [
      blend(1, 0, 0, 0),
      blend(0, 1, 0, 0),
      blend(0, 0, 1, 0),
      blend(0, 0, 0, 1),
    ] as const

    for (const hipsDirection of ALS_CROUCHING_MOVEMENT_STATE_ORDER) {
      const expectedPoses =
        ALS_CROUCHING_MOVEMENT_MULTI_WAY_BLEND_TABLE[hipsDirection]
      for (let channel = 0; channel < channels.length; channel++) {
        const expected = ALS_CROUCHING_MOVEMENT_STATE_ORDER.map(
          (pose) => Number(pose === expectedPoses[channel]),
        )
        expect(dense(evaluateAlsCrouchingMovementState(
          hipsDirection,
          channels[channel],
        ))).toEqual(expected)
      }
    }
  })

  it('normalizes positive inputs and returns no pose for zero coverage', () => {
    expect(dense(evaluateAlsCrouchingMovementState(
      'Backward',
      blend(2, 1, -5, 1),
    ))).toEqual([0.5, 0.25, 0, 0.25, 0, 0])
    expect(dense(evaluateAlsCrouchingMovementState(
      'Forward',
      blend(0, 0, 0, 0),
    ))).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('VERIFIED crouching transition rules', () => {
  it('selects movement rules in authored edge order', () => {
    const cases: readonly [
      from: AlsHipsDirection,
      movement: 'Forward' | 'Backward' | 'Left' | 'Right',
      transitionIndex: number,
      to: AlsHipsDirection,
    ][] = [
      ['Forward', 'Right', 0, 'RightForward'],
      ['Forward', 'Left', 1, 'LeftForward'],
      ['Forward', 'Backward', 2, 'Backward'],
      ['Backward', 'Right', 3, 'RightBackward'],
      ['Backward', 'Left', 4, 'LeftBackward'],
      ['Backward', 'Forward', 5, 'Forward'],
      ['RightForward', 'Left', 6, 'LeftBackward'],
      ['RightForward', 'Backward', 7, 'RightBackward'],
      ['RightForward', 'Forward', 8, 'Forward'],
      ['RightBackward', 'Left', 10, 'LeftForward'],
      ['RightBackward', 'Forward', 11, 'RightForward'],
      ['RightBackward', 'Backward', 13, 'Backward'],
      ['LeftForward', 'Right', 15, 'RightBackward'],
      ['LeftForward', 'Backward', 16, 'LeftBackward'],
      ['LeftForward', 'Forward', 17, 'Forward'],
      ['LeftBackward', 'Right', 19, 'RightForward'],
      ['LeftBackward', 'Forward', 20, 'LeftForward'],
      ['LeftBackward', 'Backward', 22, 'Backward'],
    ]

    for (const [from, movementDirection, transitionIndex, to] of cases) {
      expect(selectAlsCrouchingMovementTransition({
        hipsDirection: from,
        movementDirection,
        hipsDirectionLockAmount: 0,
        feetCrossingAmount: 1,
        stateWeight: 1,
      })).toMatchObject({ transitionIndex, to })
    }
  })

  it('matches Set Hips and full-relevance neutral guard boundaries', () => {
    expect(selectAlsCrouchingMovementTransition({
      hipsDirection: 'RightForward',
      movementDirection: 'Right',
      hipsDirectionLockAmount: -0.5,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })).toMatchObject({ transitionIndex: 9, rule: 'SetHipsLeft' })
    expect(selectAlsCrouchingMovementTransition({
      hipsDirection: 'LeftForward',
      movementDirection: 'Left',
      hipsDirectionLockAmount: 0.5,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })).toMatchObject({ transitionIndex: 18, rule: 'SetHipsRight' })
    expect(selectAlsCrouchingMovementTransition({
      hipsDirection: 'RightBackward',
      movementDirection: 'Right',
      hipsDirectionLockAmount: 0.499,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })).toMatchObject({
      transitionIndex: 12,
      rule: 'NeutralRightBackward',
    })
    expect(selectAlsCrouchingMovementTransition({
      hipsDirection: 'LeftBackward',
      movementDirection: 'Left',
      hipsDirectionLockAmount: -0.499,
      feetCrossingAmount: 0,
      stateWeight: 1,
    })).toMatchObject({
      transitionIndex: 21,
      rule: 'NeutralLeftBackward',
    })
    expect(selectAlsCrouchingMovementTransition({
      hipsDirection: 'RightBackward',
      movementDirection: 'Right',
      hipsDirectionLockAmount: 0,
      feetCrossingAmount: 0,
      stateWeight: 0.999,
    })).toBeNull()
  })
})

describe('crouching Movement States runtime', () => {
  const forward = {
    relevant: true,
    movementDirection: 'Forward',
    hipsDirectionLockAmount: 0,
    feetCrossingAmount: 1,
  } as const

  it('reinitializes to Forward, calls SetHipsDirection, and skips the first transition update', () => {
    const runtime = createAlsCrouchingMovementRuntime()
    const entered: AlsHipsDirection[] = []
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 1 / 60, (direction) => entered.push(direction))

    expect(runtime).toMatchObject({
      relevant: true,
      baseState: 'Forward',
      currentState: 'Forward',
      transitionsTakenThisFrame: 0,
      lastSetHipsDirection: 'Forward',
    })
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(entered).toEqual(['Forward'])

    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 1 / 60, (direction) => entered.push(direction))
    expect(runtime.currentState).toBe('LeftForward')
    expect(runtime.transitionsTakenThisFrame).toBe(1)
    expect(runtime.activeTransitions).toHaveLength(1)
    expect(entered).toEqual(['Forward', 'LeftForward'])
  })

  it('uses the full 0.7 second Cubic transition boundary', () => {
    const runtime = createAlsCrouchingMovementRuntime()
    refreshAlsCrouchingMovementRuntime(runtime, forward, 0)
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0)

    const active = runtime.activeTransitions[0]
    expect(active).toMatchObject({
      elapsed: 0,
      linearAlpha: 0,
      blendAlpha: 0,
      transition: {
        from: 'Forward',
        to: 'RightForward',
        duration: 0.7,
        blendOption: 'Cubic',
      },
    })

    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0.35)
    expect(active.linearAlpha).toBe(0.5)
    expect(active.blendAlpha).toBe(0.125)
    expect(runtime.stateWeights.Forward).toBe(0.875)
    expect(runtime.stateWeights.RightForward).toBe(0.125)

    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0.35)
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(runtime.baseState).toBe('RightForward')
    expect(runtime.currentState).toBe('RightForward')
    expect(runtime.stateWeights.RightForward).toBe(1)
  })

  it('retains the interrupted source transition as a nested pose plan', () => {
    const runtime = createAlsCrouchingMovementRuntime()
    const entered: AlsHipsDirection[] = []
    refreshAlsCrouchingMovementRuntime(
      runtime,
      forward,
      0,
      (direction) => entered.push(direction),
    )
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0, (direction) => entered.push(direction))
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0.35, (direction) => entered.push(direction))

    expect(runtime.currentState).toBe('LeftBackward')
    expect(runtime.activeTransitions.map((active) => ({
      from: active.transition.from,
      to: active.transition.to,
      blendAlpha: active.blendAlpha,
    }))).toEqual([
      { from: 'Forward', to: 'RightForward', blendAlpha: 0.125 },
      { from: 'RightForward', to: 'LeftBackward', blendAlpha: 0 },
    ])
    expect(runtime.stateWeights).toMatchObject({
      Forward: 0.875,
      RightForward: 0.125,
      LeftBackward: 0,
    })
    expect(entered).toEqual(['Forward', 'RightForward', 'LeftBackward'])

    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0.35)
    expect(runtime.activeTransitions).toHaveLength(1)
    expect(runtime.baseState).toBe('RightForward')
    expect(runtime.stateWeights.RightForward).toBe(0.875)
    expect(runtime.stateWeights.LeftBackward).toBe(0.125)
  })

  it('takes at most the authored three transitions in one frame', () => {
    const runtime = createAlsCrouchingMovementRuntime()
    refreshAlsCrouchingMovementRuntime(runtime, forward, 0)
    runtime.baseState = 'RightForward'
    runtime.currentState = 'RightForward'
    runtime.stateWeights.Forward = 0
    runtime.stateWeights.RightForward = 1

    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Backward',
    }, 0)
    expect(runtime.transitionsTakenThisFrame).toBe(2)
    expect(runtime.currentState).toBe('Backward')
    expect(runtime.transitionsTakenThisFrame)
      .toBeLessThanOrEqual(ALS_CROUCHING_MOVEMENT_MACHINE.maxTransitionsPerFrame)
  })

  it('reinitializes again after losing relevance and validates delta time', () => {
    const runtime = createAlsCrouchingMovementRuntime()
    refreshAlsCrouchingMovementRuntime(runtime, forward, 0)
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Right',
    }, 0)
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      relevant: false,
    }, 0)
    refreshAlsCrouchingMovementRuntime(runtime, {
      ...forward,
      movementDirection: 'Left',
    }, 0)
    expect(runtime.currentState).toBe('Forward')
    expect(runtime.activeTransitions).toHaveLength(0)
    expect(runtime.transitionsTakenThisFrame).toBe(0)
    expect(runtime.lastSetHipsDirection).toBe('Forward')

    expect(resetAlsCrouchingMovementRuntime(runtime)).toBe(runtime)
    expect(runtime.relevant).toBe(false)
    expect(() => refreshAlsCrouchingMovementRuntime(
      runtime,
      forward,
      -0.01,
    )).toThrow('delta time must be finite and non-negative')
  })
})
