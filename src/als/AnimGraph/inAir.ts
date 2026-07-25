import type { AlphaBlendOption } from '../../engine/alphaBlend'
import { alphaToBlendOption } from '../../engine/alphaBlend'
import type { AlsLocomotionMode } from '../AlsCharacter'
import type {
  AlsRotationMode,
  AlsStance,
} from '../Settings/AlsMovementSettings'
import { fInterpTo } from '../State/AlsRotateInPlaceState'

/*
 * Pure graph description for AB_Als_Locomotion's InAir branch.
 *
 * VERIFIED sources:
 * - scripts/extract-als/abp-graph.json:
 *   $.assets.AB_Als_Locomotion.stateMachines[?(@.MachineName=="Locomotion States")]
 *   $.assets.AB_Als_Locomotion.stateMachines[?(@.MachineName=="Jump States")]
 *   and compiled nodes 18..76.
 * - scripts/extract-als/abp-graph.json transitionRuleGraphs joins each saved
 *   editor graph/result NodeGuid to its generated-class Kismet evaluator after
 *   UAssetAPI binary-equality verification. In particular, the compiled
 *   Jump-foot and Land remaining-time predicates compare <= 0.
 * - AlsAnimationInstance.cpp:985-1125 for the bJumped latch, JumpPlayRate,
 *   VerticalVelocity, GroundPredictionAmount, and InAir lean inputs.
 *
 * Linear values at this repository's boundary remain metres and metres per
 * second. Every authored Blend node range below is kept in Unreal centimetres
 * and converted only when sampled. This module deliberately does not choose a
 * JumpZVelocity or gravity; those are character movement concerns.
 */

const CENTIMETRES_PER_METRE = 100

export type AlsLocomotionGraphState =
  | 'Grounded'
  | 'Fall'
  | 'Jump'
  | 'Land'
  | 'Land Movement'
  | 'Land Conduct'

export type AlsJumpGraphState =
  | 'Entry Conduit'
  | 'Left Foot'
  | 'Right Foot'
  | 'Loop'
  | 'Flail'

export type AlsInAirTransitionLogic =
  | 'StandardBlend'
  | 'Inertialization'

export type AlsLocomotionTransitionRule =
  | 'LocomotionMode == InAir && bJumped'
  | 'LocomotionMode == InAir'
  | 'LocomotionMode == Grounded'
  | 'Stance != Standing'
  | 'GetRelevantAnimTimeRemaining(Land) <= 0'
  | 'bHasInput || bRotatingLeft || bRotatingRight || Speed >= 650'
  | 'AutomaticRemainingTimeRule'
  | 'bHasInput'
  | 'true'

export interface AlsLocomotionGraphTransition {
  readonly transitionIndex: number
  readonly from: AlsLocomotionGraphState
  readonly to: AlsLocomotionGraphState
  readonly rule: AlsLocomotionTransitionRule
  readonly targetConduitEntryRule:
    | 'LocomotionMode == Grounded'
    | null
  readonly duration: number
  readonly blendOption: AlphaBlendOption
  readonly logic: AlsInAirTransitionLogic
  readonly blendProfile: 'QuickFeetBlend' | null
  readonly startNotify: 'LandToGrounded' | null
  readonly automaticRemainingTimeRule: boolean
  readonly automaticRuleTriggerTime: number
  readonly compiledDelegateIndex: number
  readonly compiledDelegateProperty: string
}

type LocomotionTransitionRow = readonly [
  from: AlsLocomotionGraphState,
  to: AlsLocomotionGraphState,
  rule: AlsLocomotionTransitionRule,
  targetConduitEntryRule: 'LocomotionMode == Grounded' | null,
  duration: number,
  blendOption: AlphaBlendOption,
  logic: AlsInAirTransitionLogic,
  blendProfile: 'QuickFeetBlend' | null,
  startNotify: 'LandToGrounded' | null,
  automaticRemainingTimeRule: boolean,
  compiledDelegateIndex: number,
  compiledDelegateProperty: string,
]

/*
 * Serialized transition order is evaluation priority. In particular, Land
 * evaluates crouch, finished, moving, jumped, then generic InAir.
 */
const LOCOMOTION_TRANSITION_ROWS:
readonly LocomotionTransitionRow[] = [
  [
    'Grounded',
    'Jump',
    'LocomotionMode == InAir && bJumped',
    null,
    0.1,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    15,
    'AnimGraphNode_TransitionResult_7',
  ],
  [
    'Grounded',
    'Fall',
    'LocomotionMode == InAir',
    null,
    0.6,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    14,
    'AnimGraphNode_TransitionResult_8',
  ],
  [
    'Fall',
    'Land Conduct',
    'true',
    'LocomotionMode == Grounded',
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    13,
    'AnimGraphNode_TransitionResult_9',
  ],
  [
    'Fall',
    'Grounded',
    'LocomotionMode == Grounded',
    null,
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    12,
    'AnimGraphNode_TransitionResult_10',
  ],
  [
    'Jump',
    'Land Conduct',
    'true',
    'LocomotionMode == Grounded',
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    11,
    'AnimGraphNode_TransitionResult_11',
  ],
  [
    'Jump',
    'Grounded',
    'LocomotionMode == Grounded',
    null,
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    12,
    'AnimGraphNode_TransitionResult_10',
  ],
  [
    'Land',
    'Grounded',
    'Stance != Standing',
    null,
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    10,
    'AnimGraphNode_TransitionResult_12',
  ],
  [
    'Land',
    'Grounded',
    'GetRelevantAnimTimeRemaining(Land) <= 0',
    null,
    0.8,
    'Cubic',
    'StandardBlend',
    'QuickFeetBlend',
    'LandToGrounded',
    false,
    9,
    'AnimGraphNode_TransitionResult_13',
  ],
  [
    'Land',
    'Land Movement',
    'bHasInput || bRotatingLeft || bRotatingRight || Speed >= 650',
    null,
    0.2,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    false,
    8,
    'AnimGraphNode_TransitionResult_14',
  ],
  [
    'Land',
    'Jump',
    'LocomotionMode == InAir && bJumped',
    null,
    0.1,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    15,
    'AnimGraphNode_TransitionResult_7',
  ],
  [
    'Land',
    'Fall',
    'LocomotionMode == InAir',
    null,
    0.6,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    14,
    'AnimGraphNode_TransitionResult_8',
  ],
  [
    'Land Movement',
    'Grounded',
    'AutomaticRemainingTimeRule',
    null,
    0.3,
    'HermiteCubic',
    'StandardBlend',
    null,
    null,
    true,
    7,
    'AnimGraphNode_TransitionResult_15',
  ],
  [
    'Land Movement',
    'Jump',
    'LocomotionMode == InAir && bJumped',
    null,
    0.1,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    15,
    'AnimGraphNode_TransitionResult_7',
  ],
  [
    'Land Movement',
    'Fall',
    'LocomotionMode == InAir',
    null,
    0.6,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    14,
    'AnimGraphNode_TransitionResult_8',
  ],
  [
    'Land Conduct',
    'Land Movement',
    'bHasInput',
    null,
    0.1,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    6,
    'AnimGraphNode_TransitionResult_16',
  ],
  [
    'Land Conduct',
    'Land',
    'true',
    null,
    0.1,
    'HermiteCubic',
    'Inertialization',
    null,
    null,
    false,
    5,
    'AnimGraphNode_TransitionResult_17',
  ],
]

export const ALS_LOCOMOTION_GRAPH_TRANSITIONS:
readonly AlsLocomotionGraphTransition[] =
  LOCOMOTION_TRANSITION_ROWS.map((row, transitionIndex) => ({
    transitionIndex,
    from: row[0],
    to: row[1],
    rule: row[2],
    targetConduitEntryRule: row[3],
    duration: row[4],
    blendOption: row[5],
    logic: row[6],
    blendProfile: row[7],
    startNotify: row[8],
    automaticRemainingTimeRule: row[9],
    automaticRuleTriggerTime: -1,
    compiledDelegateIndex: row[10],
    compiledDelegateProperty: row[11],
  }))

export const ALS_LOCOMOTION_STATES_MACHINE = {
  machineName: 'Locomotion States',
  compiledNodeIndex: 76,
  initialState: 'Grounded',
  maxTransitionsPerFrame: 3,
  maxTransitionRequests: 32,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
  allowConduitEntryStates: false,
  landConductEntryRule: 'LocomotionMode == Grounded',
  jumpAlwaysResetOnEntry: true,
} as const

export type AlsJumpTransitionRule =
  | 'FootPlantedAmount > 0'
  | 'FootPlantedAmount <= 0'
  | 'GetRelevantAnimTimeRemaining(Left Foot) <= 0'
  | 'GetRelevantAnimTimeRemaining(Right Foot) <= 0'
  | 'true'

export interface AlsJumpGraphTransition {
  readonly transitionIndex: number
  readonly from: AlsJumpGraphState
  readonly to: Exclude<AlsJumpGraphState, 'Entry Conduit'>
  readonly rule: AlsJumpTransitionRule
  readonly duration: number
  readonly blendOption: AlphaBlendOption
  readonly logic: AlsInAirTransitionLogic
  readonly compiledDelegateIndex: number
  readonly compiledDelegateProperty: string
}

export const ALS_JUMP_GRAPH_TRANSITIONS:
readonly AlsJumpGraphTransition[] = [
  {
    transitionIndex: 0,
    from: 'Entry Conduit',
    to: 'Right Foot',
    rule: 'FootPlantedAmount > 0',
    duration: 0.2,
    blendOption: 'HermiteCubic',
    logic: 'StandardBlend',
    compiledDelegateIndex: 44,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_1',
  },
  {
    transitionIndex: 1,
    from: 'Entry Conduit',
    to: 'Left Foot',
    rule: 'FootPlantedAmount <= 0',
    duration: 0.2,
    blendOption: 'HermiteCubic',
    logic: 'StandardBlend',
    compiledDelegateIndex: 43,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_2',
  },
  {
    transitionIndex: 2,
    from: 'Left Foot',
    to: 'Loop',
    rule: 'GetRelevantAnimTimeRemaining(Left Foot) <= 0',
    duration: 0.2,
    blendOption: 'HermiteCubic',
    logic: 'Inertialization',
    compiledDelegateIndex: 42,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_3',
  },
  {
    transitionIndex: 3,
    from: 'Right Foot',
    to: 'Loop',
    rule: 'GetRelevantAnimTimeRemaining(Right Foot) <= 0',
    duration: 0.2,
    blendOption: 'HermiteCubic',
    logic: 'Inertialization',
    compiledDelegateIndex: 41,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_4',
  },
  {
    transitionIndex: 4,
    from: 'Loop',
    to: 'Flail',
    rule: 'true',
    duration: 1,
    blendOption: 'HermiteCubic',
    logic: 'StandardBlend',
    compiledDelegateIndex: 40,
    compiledDelegateProperty: 'AnimGraphNode_TransitionResult_5',
  },
]

export const ALS_JUMP_STATES_MACHINE = {
  machineName: 'Jump States',
  compiledNodeIndex: 58,
  initialState: 'Entry Conduit',
  maxTransitionsPerFrame: 3,
  maxTransitionRequests: 32,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
  allowConduitEntryStates: true,
  launchRemainingTimeThreshold: 0,
} as const

export interface AlsLocomotionTransitionInput {
  readonly locomotionMode: AlsLocomotionMode
  /** FAlsInAirState.bJumped before RefreshInAir() consumes it. */
  readonly jumped: boolean
  readonly stance: AlsStance
  readonly hasInput: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  /** LocomotionState.Speed in the web boundary's metres per second. */
  readonly speed: number
  /** GetRelevantAnimTimeRemaining() for the Land state, in seconds. */
  readonly landRemainingTime: number
  /** Result of UE's serialized automatic rule with trigger time -1. */
  readonly landMovementAutomaticRemainingTimeReached: boolean
}

function locomotionTransition(index: number) {
  return ALS_LOCOMOTION_GRAPH_TRANSITIONS[index]
}

/** Evaluates outgoing edges in AB_Als_Locomotion's serialized priority. */
export function selectAlsLocomotionGraphTransition(
  state: AlsLocomotionGraphState,
  input: AlsLocomotionTransitionInput,
): AlsLocomotionGraphTransition | null {
  switch (state) {
    case 'Grounded':
      if (input.locomotionMode === 'InAir' && input.jumped) {
        return locomotionTransition(0)
      }
      return input.locomotionMode === 'InAir'
        ? locomotionTransition(1)
        : null
    case 'Fall':
      // The first edge is literal true, but its target conduit admits Grounded only.
      return input.locomotionMode === 'Grounded'
        ? locomotionTransition(2)
        : null
    case 'Jump':
      // ALS has no Jump -> Fall edge at the apex.
      return input.locomotionMode === 'Grounded'
        ? locomotionTransition(4)
        : null
    case 'Land':
      if (input.stance !== 'Standing') {
        return locomotionTransition(6)
      }
      if (input.landRemainingTime <= 0) {
        return locomotionTransition(7)
      }
      if (
        input.hasInput
        || input.rotatingLeft
        || input.rotatingRight
        || input.speed * CENTIMETRES_PER_METRE >= 650
      ) {
        return locomotionTransition(8)
      }
      if (input.locomotionMode === 'InAir' && input.jumped) {
        return locomotionTransition(9)
      }
      return input.locomotionMode === 'InAir'
        ? locomotionTransition(10)
        : null
    case 'Land Movement':
      if (input.landMovementAutomaticRemainingTimeReached) {
        return locomotionTransition(11)
      }
      if (input.locomotionMode === 'InAir' && input.jumped) {
        return locomotionTransition(12)
      }
      return input.locomotionMode === 'InAir'
        ? locomotionTransition(13)
        : null
    case 'Land Conduct':
      return input.hasInput
        ? locomotionTransition(14)
        : locomotionTransition(15)
  }
}

export interface AlsJumpTransitionInput {
  readonly footPlantedAmount: number
  readonly launchRemainingTime: number
}

export function selectAlsJumpGraphTransition(
  state: AlsJumpGraphState,
  input: AlsJumpTransitionInput,
): AlsJumpGraphTransition | null {
  switch (state) {
    case 'Entry Conduit':
      return ALS_JUMP_GRAPH_TRANSITIONS[
        input.footPlantedAmount > 0 ? 0 : 1
      ]
    case 'Left Foot':
      return input.launchRemainingTime <= 0
        ? ALS_JUMP_GRAPH_TRANSITIONS[2]
        : null
    case 'Right Foot':
      return input.launchRemainingTime <= 0
        ? ALS_JUMP_GRAPH_TRANSITIONS[3]
        : null
    case 'Loop':
      return ALS_JUMP_GRAPH_TRANSITIONS[4]
    case 'Flail':
      return null
  }
}

/*
 * Compiled pose topology. Values are direct transcriptions of
 * abp-graph.json nodes 18..72, including A/B orientation and unclamped maps.
 */
export const ALS_IN_AIR_GRAPH = {
  fall: {
    refreshFunction: 'RefreshInAir',
    fallFastBlend: {
      compiledNodeIndex: 68,
      inputMinimum: 0,
      inputMaximum: -1000,
      outputMinimum: 0,
      outputMaximum: 1,
      clampResult: false,
      interpolateResult: true,
      interpolationSpeedIncreasing: 5,
      interpolationSpeedDecreasing: 5,
    },
    flailBlend: {
      compiledNodeIndex: 72,
      inputMinimum: -500,
      inputMaximum: -3000,
      outputMinimum: 0,
      outputMaximum: 1,
      clampResult: false,
      interpolateResult: true,
      interpolationSpeedIncreasing: 5,
      interpolationSpeedDecreasing: 5,
    },
  },
  jump: {
    alwaysResetOnEntry: true,
    refreshFunction: 'RefreshInAir',
    launchBlend: {
      compiledNodeIndices: [54, 50],
      inputMinimum: 200,
      inputMaximum: 500,
      outputMinimum: 0,
      outputMaximum: 1,
      clampResult: false,
      interpolateResult: true,
      interpolationSpeedIncreasing: 5,
      interpolationSpeedDecreasing: 5,
    },
  },
  air: {
    leanBlendSpace: 'BS_Als_Air_Lean',
    leanEvaluatorNodeIndices: [32, 61],
    leanNormalizedTime: 0,
    leanAdditiveType: 'LocalSpace',
    groundPredictionBlend: {
      compiledNodeIndices: [38, 66],
      interpolateResult: true,
      interpolationSpeedIncreasing: 20,
      interpolationSpeedDecreasing: 5,
    },
    landingPreviewBlend: {
      compiledNodeIndices: [35, 63],
      inputMinimum: -1000,
      inputMaximum: -500,
      outputMinimum: 0,
      outputMaximum: 1,
      clampResult: false,
      interpolateResult: false,
    },
  },
  land: {
    refreshFunction: 'RefreshRotateInPlace',
    blend: {
      compiledNodeIndex: 27,
      inputMinimum: -500,
      inputMaximum: -1000,
      outputMinimum: 0,
      outputMaximum: 1,
      clampResult: false,
      interpolateResult: false,
    },
  },
  landMovement: {
    groundedToAdditiveBlend: {
      compiledNodeIndex: 18,
      inputMinimum: 0,
      inputMaximum: -200,
      outputMinimum: 0.25,
      outputMaximum: 1,
      clampResult: true,
      clampMinimum: 0.25,
      clampMaximum: 1,
      interpolateResult: false,
    },
    additiveBlend: {
      compiledNodeIndex: 21,
      inputMinimum: -750,
      inputMaximum: -1500,
      outputMinimum: 0,
      outputMaximum: 0.75,
      clampResult: false,
      interpolateResult: false,
    },
    aimingBlend: {
      compiledNodeIndex: 19,
      inputMinimum: 0,
      inputMaximum: 1,
      outputMinimum: 1,
      outputMaximum: 0.5,
      clampResult: false,
      interpolateResult: true,
      interpolationSpeedIncreasing: 2.5,
      interpolationSpeedDecreasing: 20,
    },
    additiveType: 'MeshSpace',
  },
} as const

/*
 * Sequence/evaluator metadata from the same compiled nodes. JumpPlayRate is a
 * generated-class property-access binding; all other rates are serialized.
 */
export const ALS_IN_AIR_PLAYERS = {
  fallFast: {
    compiledNodeIndex: 69,
    clip: 'A_Als_Fall_Fast',
    group: 'Fall',
    playRate: 1,
    startPosition: 0,
    loop: true,
  },
  fall: {
    compiledNodeIndex: 70,
    clip: 'A_Als_Fall',
    group: 'Fall',
    playRate: 1,
    startPosition: 0,
    loop: true,
  },
  fallFlail: {
    compiledNodeIndex: 71,
    clip: 'A_Als_Flail',
    group: null,
    playRate: 1,
    startPosition: 0,
    loop: true,
  },
  jumpWalkLeft: {
    compiledNodeIndex: 56,
    clip: 'A_Als_Jump_Walk_Left',
    group: 'Jump',
    playRateBinding: 'InAirState.JumpPlayRate',
    startPosition: 0.12,
    loop: false,
  },
  jumpRunLeft: {
    compiledNodeIndex: 55,
    clip: 'A_Als_Jump_Run_Left',
    group: 'Jump',
    playRateBinding: 'InAirState.JumpPlayRate',
    startPosition: 0,
    loop: false,
  },
  jumpWalkRight: {
    compiledNodeIndex: 52,
    clip: 'A_Als_Jump_Walk_Right',
    group: 'Jump',
    playRateBinding: 'InAirState.JumpPlayRate',
    startPosition: 0.12,
    loop: false,
  },
  jumpRunRight: {
    compiledNodeIndex: 51,
    clip: 'A_Als_Jump_Run_Right',
    group: 'Jump',
    playRateBinding: 'InAirState.JumpPlayRate',
    startPosition: 0,
    loop: false,
  },
  jumpLoop: {
    compiledNodeIndex: 48,
    clip: 'A_Als_Jump_Loop',
    group: 'Flail',
    playRateBinding: 'InAirState.JumpPlayRate',
    startPosition: 0,
    loop: true,
  },
  jumpFlail: {
    compiledNodeIndex: 46,
    clip: 'A_Als_Flail',
    group: 'Flail',
    playRate: 1.2,
    startPosition: 0,
    loop: true,
  },
  landingPreviewHeavy: {
    compiledNodeIndices: [37, 65],
    clip: 'A_Als_Land_Heavy',
    explicitTime: 0,
    teleportToExplicitTime: true,
  },
  landingPreviewLight: {
    compiledNodeIndices: [36, 64],
    clip: 'A_Als_Land_Light',
    explicitTime: 0,
    teleportToExplicitTime: true,
  },
  landLight: {
    compiledNodeIndex: 28,
    clip: 'A_Als_Land_Light',
    group: 'Land',
    playRate: 1,
    startPosition: 0,
    loop: false,
  },
  landHeavy: {
    compiledNodeIndex: 29,
    clip: 'A_Als_Land_Heavy',
    group: 'Land',
    playRate: 1,
    startPosition: 0,
    loop: false,
  },
  landMovementLight: {
    compiledNodeIndex: 23,
    clip: 'A_Als_Land_Light_Additive',
    group: 'Land',
    playRate: 1.75,
    startPosition: 0,
    loop: false,
  },
  landMovementHeavy: {
    compiledNodeIndex: 22,
    clip: 'A_Als_Land_Heavy_Additive',
    group: 'Land',
    playRate: 1.5,
    startPosition: 0,
    loop: false,
  },
} as const

/*
 * FAnimNode_ModifyCurve outputs: Jump/Fall nodes 34/67 and Land node 26.
 * Land Movement has no ModifyCurve node; its Grounded cache and additive clips
 * keep their own authored curves.
 */
export const ALS_IN_AIR_CURVE_OUTPUTS = {
  Jump: {
    PoseStanding: 1,
    PoseInAir: 1,
  },
  Fall: {
    PoseStanding: 1,
    PoseInAir: 1,
  },
  Land: {
    FootLeftIk: 1,
    FootRightIk: 1,
    FootLeftLock: 1,
    FootRightLock: 1,
    PoseStanding: 1,
  },
  'Land Movement': {},
} as const

export interface AlsGraphInterpolatedAlpha {
  value: number
  initialized: boolean
}

function createInterpolatedAlpha(): AlsGraphInterpolatedAlpha {
  return { value: 0, initialized: false }
}

function resetInterpolatedAlpha(state: AlsGraphInterpolatedAlpha) {
  state.value = 0
  state.initialized = false
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function clamp01(value: number) {
  return clamp(value, 0, 1)
}

function mapRangeUnclamped(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
) {
  if (inputMinimum === inputMaximum) return outputMinimum
  return outputMinimum + (
    (value - inputMinimum) / (inputMaximum - inputMinimum)
  ) * (outputMaximum - outputMinimum)
}

function refreshInterpolatedAlpha(
  state: AlsGraphInterpolatedAlpha,
  target: number,
  deltaTime: number,
  interpolationSpeedIncreasing: number,
  interpolationSpeedDecreasing: number,
) {
  if (!state.initialized) {
    state.value = target
    state.initialized = true
    return state.value
  }
  state.value = fInterpTo(
    state.value,
    target,
    Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0,
    target > state.value
      ? interpolationSpeedIncreasing
      : interpolationSpeedDecreasing,
  )
  return state.value
}

export interface AlsJumpStateClock {
  state: Exclude<AlsJumpGraphState, 'Entry Conduit'>
  loopToFlailActive: boolean
  loopToFlailElapsedTime: number
  loopWeight: number
  flailWeight: number
  inertializationRequestDuration: number | null
}

export function createAlsJumpStateClock(): AlsJumpStateClock {
  return {
    state: 'Left Foot',
    loopToFlailActive: false,
    loopToFlailElapsedTime: 0,
    loopWeight: 0,
    flailWeight: 0,
    inertializationRequestDuration: null,
  }
}

/** Resolves Jump States' Entry Conduit in authored transition order. */
export function resetAlsJumpStateClock(
  clock: AlsJumpStateClock,
  footPlantedAmount: number,
): AlsJumpStateClock {
  clock.state = footPlantedAmount > 0 ? 'Right Foot' : 'Left Foot'
  clock.loopToFlailActive = false
  clock.loopToFlailElapsedTime = 0
  clock.loopWeight = 0
  clock.flailWeight = 0
  clock.inertializationRequestDuration = null
  return clock
}

export interface AlsJumpStateClockInput {
  readonly deltaTime: number
  readonly launchRemainingTime: number
}

function advanceAlsJumpLoopToFlailTransition(
  clock: AlsJumpStateClock,
  deltaTime: number,
) {
  const transition = ALS_JUMP_GRAPH_TRANSITIONS[4]
  clock.loopToFlailElapsedTime = Math.min(
    transition.duration,
    clock.loopToFlailElapsedTime + deltaTime,
  )
  const alpha = alphaToBlendOption(
    transition.duration <= 0
      ? 1
      : clock.loopToFlailElapsedTime / transition.duration,
    transition.blendOption,
  )
  clock.loopWeight = 1 - alpha
  clock.flailWeight = alpha
  if (clock.loopToFlailElapsedTime >= transition.duration) {
    clock.state = 'Flail'
    clock.loopToFlailActive = false
    clock.loopWeight = 0
    clock.flailWeight = 1
  }
}

/**
 * Advances Jump States without owning animation time. The caller supplies UE's
 * pre-update GetRelevantAnimTimeRemaining() result. Like FAnimNode_StateMachine::Update_AnyThread,
 * it resolves Foot -> Loop -> Flail first, then advances the newly created 1 second standard
 * transition by this update's delta time.
 */
export function refreshAlsJumpStateClock(
  clock: AlsJumpStateClock,
  input: AlsJumpStateClockInput,
): AlsJumpStateClock {
  clock.inertializationRequestDuration = null
  const deltaTime = Number.isFinite(input.deltaTime)
    ? Math.max(0, input.deltaTime)
    : 0

  if (clock.loopToFlailActive) {
    advanceAlsJumpLoopToFlailTransition(clock, deltaTime)
    return clock
  }

  if (
    (clock.state === 'Left Foot' || clock.state === 'Right Foot')
    && input.launchRemainingTime
      <= ALS_JUMP_STATES_MACHINE.launchRemainingTimeThreshold
  ) {
    const transition = ALS_JUMP_GRAPH_TRANSITIONS[
      clock.state === 'Left Foot' ? 2 : 3
    ]
    clock.state = 'Loop'
    clock.inertializationRequestDuration = transition.duration
    // Loop's literal-true edge is eligible in the same update.
    clock.loopToFlailActive = true
    clock.loopToFlailElapsedTime = 0
    clock.loopWeight = 1
    clock.flailWeight = 0
    advanceAlsJumpLoopToFlailTransition(clock, deltaTime)
  } else if (clock.state === 'Loop') {
    clock.loopToFlailActive = true
    clock.loopToFlailElapsedTime = 0
    clock.loopWeight = 1
    clock.flailWeight = 0
    advanceAlsJumpLoopToFlailTransition(clock, deltaTime)
  } else if (clock.state === 'Flail') {
    clock.loopWeight = 0
    clock.flailWeight = 1
  }

  return clock
}

export interface AlsInAirGraphState {
  readonly fallFastBlend: AlsGraphInterpolatedAlpha
  readonly fallFlailBlend: AlsGraphInterpolatedAlpha
  readonly fallGroundPredictionBlend: AlsGraphInterpolatedAlpha
  readonly jumpLaunchLeftBlend: AlsGraphInterpolatedAlpha
  readonly jumpLaunchRightBlend: AlsGraphInterpolatedAlpha
  readonly jumpGroundPredictionBlend: AlsGraphInterpolatedAlpha
  readonly landMovementAimingBlend: AlsGraphInterpolatedAlpha
  readonly jumpState: AlsJumpStateClock
}

export function createAlsInAirGraphState(): AlsInAirGraphState {
  return {
    fallFastBlend: createInterpolatedAlpha(),
    fallFlailBlend: createInterpolatedAlpha(),
    fallGroundPredictionBlend: createInterpolatedAlpha(),
    jumpLaunchLeftBlend: createInterpolatedAlpha(),
    jumpLaunchRightBlend: createInterpolatedAlpha(),
    jumpGroundPredictionBlend: createInterpolatedAlpha(),
    landMovementAimingBlend: createInterpolatedAlpha(),
    jumpState: createAlsJumpStateClock(),
  }
}

export function resetAlsFallGraphState(
  state: AlsInAirGraphState,
): AlsInAirGraphState {
  resetInterpolatedAlpha(state.fallFastBlend)
  resetInterpolatedAlpha(state.fallFlailBlend)
  resetInterpolatedAlpha(state.fallGroundPredictionBlend)
  return state
}

export function resetAlsLandMovementGraphState(
  state: AlsInAirGraphState,
): AlsInAirGraphState {
  resetInterpolatedAlpha(state.landMovementAimingBlend)
  return state
}

export function resetAlsInAirGraphState(
  state: AlsInAirGraphState,
): AlsInAirGraphState {
  resetAlsFallGraphState(state)
  resetInterpolatedAlpha(state.jumpLaunchLeftBlend)
  resetInterpolatedAlpha(state.jumpLaunchRightBlend)
  resetInterpolatedAlpha(state.jumpGroundPredictionBlend)
  resetAlsLandMovementGraphState(state)
  resetAlsJumpStateClock(state.jumpState, 0)
  return state
}

/** Jump's bAlwaysResetOnEntry behavior. */
export function enterAlsJumpGraph(
  state: AlsInAirGraphState,
  footPlantedAmount: number,
): AlsInAirGraphState {
  resetAlsJumpStateClock(state.jumpState, footPlantedAmount)
  resetInterpolatedAlpha(state.jumpLaunchLeftBlend)
  resetInterpolatedAlpha(state.jumpLaunchRightBlend)
  resetInterpolatedAlpha(state.jumpGroundPredictionBlend)
  return state
}

export interface AlsAirGraphInput {
  readonly deltaTime: number
  /** FAlsInAirState.VerticalVelocity, metres per second. */
  readonly verticalVelocity: number
  readonly groundPredictionAmount: number
  readonly leanRightAmount: number
  readonly leanForwardAmount: number
}

export interface AlsAirPostProcessSample {
  readonly airPoseWeight: number
  readonly airLeanAdditiveWeight: number
  readonly airLeanBlendSpace: 'BS_Als_Air_Lean'
  readonly airLeanX: number
  readonly airLeanY: number
  readonly airLeanNormalizedTime: 0
  readonly landingPreviewLightWeight: number
  readonly landingPreviewHeavyWeight: number
  readonly rawGroundPredictionAmount: number
  readonly groundPredictionAmount: number
  readonly landingPreviewLightAmount: number
}

function refreshAirPostProcess(
  groundPredictionState: AlsGraphInterpolatedAlpha,
  input: AlsAirGraphInput,
): AlsAirPostProcessSample {
  const settings = ALS_IN_AIR_GRAPH.air
  const rawGroundPredictionAmount = refreshInterpolatedAlpha(
    groundPredictionState,
    input.groundPredictionAmount,
    input.deltaTime,
    settings.groundPredictionBlend.interpolationSpeedIncreasing,
    settings.groundPredictionBlend.interpolationSpeedDecreasing,
  )
  const groundPredictionAmount = clamp01(rawGroundPredictionAmount)
  const landingPreviewLightAmount = clamp01(mapRangeUnclamped(
    input.verticalVelocity * CENTIMETRES_PER_METRE,
    settings.landingPreviewBlend.inputMinimum,
    settings.landingPreviewBlend.inputMaximum,
    settings.landingPreviewBlend.outputMinimum,
    settings.landingPreviewBlend.outputMaximum,
  ))

  return {
    airPoseWeight: 1 - groundPredictionAmount,
    airLeanAdditiveWeight: 1 - groundPredictionAmount,
    airLeanBlendSpace: settings.leanBlendSpace,
    airLeanX: input.leanRightAmount,
    airLeanY: input.leanForwardAmount,
    airLeanNormalizedTime: settings.leanNormalizedTime,
    landingPreviewLightWeight:
      groundPredictionAmount * landingPreviewLightAmount,
    landingPreviewHeavyWeight:
      groundPredictionAmount * (1 - landingPreviewLightAmount),
    rawGroundPredictionAmount,
    groundPredictionAmount,
    landingPreviewLightAmount,
  }
}

export interface AlsFallGraphSample {
  readonly fallFastWeight: number
  readonly fallWeight: number
  readonly flailWeight: number
  readonly rawFallBlendAmount: number
  readonly fallBlendAmount: number
  readonly rawFlailBlendAmount: number
  readonly flailBlendAmount: number
  readonly air: AlsAirPostProcessSample
  readonly curves: typeof ALS_IN_AIR_CURVE_OUTPUTS.Fall
}

export function refreshAlsFallGraph(
  state: AlsInAirGraphState,
  input: AlsAirGraphInput,
): AlsFallGraphSample {
  const verticalVelocity = input.verticalVelocity * CENTIMETRES_PER_METRE
  const settings = ALS_IN_AIR_GRAPH.fall
  const rawFallBlendAmount = refreshInterpolatedAlpha(
    state.fallFastBlend,
    mapRangeUnclamped(
      verticalVelocity,
      settings.fallFastBlend.inputMinimum,
      settings.fallFastBlend.inputMaximum,
      settings.fallFastBlend.outputMinimum,
      settings.fallFastBlend.outputMaximum,
    ),
    input.deltaTime,
    settings.fallFastBlend.interpolationSpeedIncreasing,
    settings.fallFastBlend.interpolationSpeedDecreasing,
  )
  const rawFlailBlendAmount = refreshInterpolatedAlpha(
    state.fallFlailBlend,
    mapRangeUnclamped(
      verticalVelocity,
      settings.flailBlend.inputMinimum,
      settings.flailBlend.inputMaximum,
      settings.flailBlend.outputMinimum,
      settings.flailBlend.outputMaximum,
    ),
    input.deltaTime,
    settings.flailBlend.interpolationSpeedIncreasing,
    settings.flailBlend.interpolationSpeedDecreasing,
  )
  const fallBlendAmount = clamp01(rawFallBlendAmount)
  const flailBlendAmount = clamp01(rawFlailBlendAmount)
  const air = refreshAirPostProcess(
    state.fallGroundPredictionBlend,
    input,
  )
  const fallPairWeight = air.airPoseWeight * (1 - flailBlendAmount)

  return {
    fallFastWeight: fallPairWeight * (1 - fallBlendAmount),
    fallWeight: fallPairWeight * fallBlendAmount,
    flailWeight: air.airPoseWeight * flailBlendAmount,
    rawFallBlendAmount,
    fallBlendAmount,
    rawFlailBlendAmount,
    flailBlendAmount,
    air,
    curves: ALS_IN_AIR_CURVE_OUTPUTS.Fall,
  }
}

export interface AlsJumpGraphInput extends AlsAirGraphInput {
  /** LocomotionState.Speed, metres per second. */
  readonly speed: number
  readonly jumpPlayRate: number
  readonly launchRemainingTime: number
}

export interface AlsJumpGraphSample {
  readonly state: Exclude<AlsJumpGraphState, 'Entry Conduit'>
  readonly jumpWalkLeftWeight: number
  readonly jumpRunLeftWeight: number
  readonly jumpWalkRightWeight: number
  readonly jumpRunRightWeight: number
  readonly jumpLoopWeight: number
  readonly flailWeight: number
  readonly rawLaunchRunAmount: number
  readonly launchRunAmount: number
  readonly jumpPlayRate: number
  readonly flailPlayRate: 1.2
  readonly inertializationRequestDuration: number | null
  readonly air: AlsAirPostProcessSample
  readonly curves: typeof ALS_IN_AIR_CURVE_OUTPUTS.Jump
}

export function refreshAlsJumpGraph(
  state: AlsInAirGraphState,
  input: AlsJumpGraphInput,
): AlsJumpGraphSample {
  refreshAlsJumpStateClock(state.jumpState, input)
  const air = refreshAirPostProcess(
    state.jumpGroundPredictionBlend,
    input,
  )
  const launchState = state.jumpState.state
  const launching =
    launchState === 'Left Foot' || launchState === 'Right Foot'
  let rawLaunchRunAmount = 0
  let launchRunAmount = 0
  let jumpWalkLeftWeight = 0
  let jumpRunLeftWeight = 0
  let jumpWalkRightWeight = 0
  let jumpRunRightWeight = 0
  let jumpLoopWeight = 0
  let flailWeight = 0

  if (launching) {
    const settings = ALS_IN_AIR_GRAPH.jump.launchBlend
    const alphaState = launchState === 'Left Foot'
      ? state.jumpLaunchLeftBlend
      : state.jumpLaunchRightBlend
    rawLaunchRunAmount = refreshInterpolatedAlpha(
      alphaState,
      mapRangeUnclamped(
        input.speed * CENTIMETRES_PER_METRE,
        settings.inputMinimum,
        settings.inputMaximum,
        settings.outputMinimum,
        settings.outputMaximum,
      ),
      input.deltaTime,
      settings.interpolationSpeedIncreasing,
      settings.interpolationSpeedDecreasing,
    )
    launchRunAmount = clamp01(rawLaunchRunAmount)
    const walkWeight = air.airPoseWeight * (1 - launchRunAmount)
    const runWeight = air.airPoseWeight * launchRunAmount
    if (launchState === 'Left Foot') {
      jumpWalkLeftWeight = walkWeight
      jumpRunLeftWeight = runWeight
    } else {
      jumpWalkRightWeight = walkWeight
      jumpRunRightWeight = runWeight
    }
  } else {
    jumpLoopWeight = air.airPoseWeight * state.jumpState.loopWeight
    flailWeight = air.airPoseWeight * state.jumpState.flailWeight
  }

  return {
    state: state.jumpState.state,
    jumpWalkLeftWeight,
    jumpRunLeftWeight,
    jumpWalkRightWeight,
    jumpRunRightWeight,
    jumpLoopWeight,
    flailWeight,
    rawLaunchRunAmount,
    launchRunAmount,
    jumpPlayRate: input.jumpPlayRate,
    flailPlayRate: 1.2,
    inertializationRequestDuration:
      state.jumpState.inertializationRequestDuration,
    air,
    curves: ALS_IN_AIR_CURVE_OUTPUTS.Jump,
  }
}

export interface AlsLandGraphInput {
  readonly verticalVelocity: number
}

export interface AlsLandGraphSample {
  readonly landLightWeight: number
  readonly landHeavyWeight: number
  readonly rawLandHeavyAmount: number
  readonly landHeavyAmount: number
  readonly curves: typeof ALS_IN_AIR_CURVE_OUTPUTS.Land
}

export function sampleAlsLandGraph(
  input: AlsLandGraphInput,
): AlsLandGraphSample {
  const settings = ALS_IN_AIR_GRAPH.land.blend
  const rawLandHeavyAmount = mapRangeUnclamped(
    input.verticalVelocity * CENTIMETRES_PER_METRE,
    settings.inputMinimum,
    settings.inputMaximum,
    settings.outputMinimum,
    settings.outputMaximum,
  )
  const landHeavyAmount = clamp01(rawLandHeavyAmount)
  return {
    landLightWeight: 1 - landHeavyAmount,
    landHeavyWeight: landHeavyAmount,
    rawLandHeavyAmount,
    landHeavyAmount,
    curves: ALS_IN_AIR_CURVE_OUTPUTS.Land,
  }
}

export interface AlsLandMovementGraphInput {
  readonly deltaTime: number
  readonly verticalVelocity: number
  readonly rotationMode: AlsRotationMode
}

export interface AlsLandMovementGraphSample {
  /** Effective base-pose weight; both branches use the cached Grounded pose. */
  readonly groundedBaseWeight: 1
  readonly groundedOnlyWeight: number
  readonly landMovementPoseWeight: number
  readonly landLightAdditiveWeight: number
  readonly landHeavyAdditiveWeight: number
  readonly rawLandHeavyAmount: number
  readonly landHeavyAmount: number
  readonly groundedToAdditiveAmount: number
  readonly rawAimingAdditiveAmount: number
  readonly aimingAdditiveAmount: number
  readonly effectiveAdditiveAmount: number
  readonly curves: typeof ALS_IN_AIR_CURVE_OUTPUTS['Land Movement']
}

export function refreshAlsLandMovementGraph(
  state: AlsInAirGraphState,
  input: AlsLandMovementGraphInput,
): AlsLandMovementGraphSample {
  const verticalVelocity = input.verticalVelocity * CENTIMETRES_PER_METRE
  const settings = ALS_IN_AIR_GRAPH.landMovement
  const groundedToAdditiveAmount = clamp(
    mapRangeUnclamped(
      verticalVelocity,
      settings.groundedToAdditiveBlend.inputMinimum,
      settings.groundedToAdditiveBlend.inputMaximum,
      settings.groundedToAdditiveBlend.outputMinimum,
      settings.groundedToAdditiveBlend.outputMaximum,
    ),
    settings.groundedToAdditiveBlend.clampMinimum,
    settings.groundedToAdditiveBlend.clampMaximum,
  )
  const rawLandHeavyAmount = mapRangeUnclamped(
    verticalVelocity,
    settings.additiveBlend.inputMinimum,
    settings.additiveBlend.inputMaximum,
    settings.additiveBlend.outputMinimum,
    settings.additiveBlend.outputMaximum,
  )
  const landHeavyAmount = clamp01(rawLandHeavyAmount)
  const rawAimingAdditiveAmount = refreshInterpolatedAlpha(
    state.landMovementAimingBlend,
    mapRangeUnclamped(
      input.rotationMode === 'Aiming' ? 1 : 0,
      settings.aimingBlend.inputMinimum,
      settings.aimingBlend.inputMaximum,
      settings.aimingBlend.outputMinimum,
      settings.aimingBlend.outputMaximum,
    ),
    input.deltaTime,
    settings.aimingBlend.interpolationSpeedIncreasing,
    settings.aimingBlend.interpolationSpeedDecreasing,
  )
  const aimingAdditiveAmount = clamp01(rawAimingAdditiveAmount)
  const effectiveAdditiveAmount =
    groundedToAdditiveAmount * aimingAdditiveAmount

  return {
    groundedBaseWeight: 1,
    groundedOnlyWeight: 1 - groundedToAdditiveAmount,
    landMovementPoseWeight: groundedToAdditiveAmount,
    landLightAdditiveWeight:
      effectiveAdditiveAmount * (1 - landHeavyAmount),
    landHeavyAdditiveWeight:
      effectiveAdditiveAmount * landHeavyAmount,
    rawLandHeavyAmount,
    landHeavyAmount,
    groundedToAdditiveAmount,
    rawAimingAdditiveAmount,
    aimingAdditiveAmount,
    effectiveAdditiveAmount,
    curves: ALS_IN_AIR_CURVE_OUTPUTS['Land Movement'],
  }
}
