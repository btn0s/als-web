import {
  alphaToBlendOption,
} from '../../engine/alphaBlend'
import type { AlphaBlendOption } from '../../engine/alphaBlend'
import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
} from '../../engine/blendSpace'
import type {
  AuthoredBlendSpace,
  BlendSpaceEvaluator,
} from '../../engine/blendSpace'
import {
  compileWeightBlendProfile,
} from '../../engine/blendProfile'
import { sampleRichCurve } from '../../engine/richCurve'
import type { RichCurveKey } from '../../engine/richCurve'
import type {
  CompiledWeightBlendProfile,
  WeightBlendProfile,
} from '../../engine/blendProfile'
import type { RigDefinition } from '../../engine/rig'
import {
  remapAngleForCounterClockwiseRotation,
} from '../Settings/AlsTurnInPlaceSettings'
import type { AlsLookState } from '../State/AlsLookState'

/*
 * Pure graph description for AB_Als_View.
 *
 * VERIFIED sources:
 * - scripts/extract-als/abp-graph.json for the baked machine, transitions,
 *   compiled pose links, player defaults, and blend metadata.
 * - AB_Als_View's uncooked editor graph and generated Kismet bytecode for the
 *   seven shared transition expressions and property-access bindings.
 * - BS_Als_Look, CF_Als_LookSideSwitch_In, CF_Als_LookSideSwitch_Out, and
 *   SK_Als:LookDirectionChange for authored BlendSpace/curve/profile content.
 *
 * The linked View Input is deliberately opaque. AB_Als_View owns the Look
 * additive below; it does not contain a separate Aiming state machine or
 * player. ViewState.LookAmount is the sole root blend binding.
 */

export type AlsViewGraphState =
  | 'Look Forward'
  | 'Look Left Back'
  | 'Look Right Back'
  | 'Switch Sides'

export type AlsViewTransitionRule =
  | 'GetInstanceStateWeight(Look Forward) < 1 && RemapAngleForCounterClockwiseRotation(YawAngle) >= 130'
  | 'GetInstanceStateWeight(Look Forward) < 1 && RemapAngleForCounterClockwiseRotation(YawAngle) <= -130'
  | 'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130'
  | 'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130'
  | 'Abs(YawAngle) <= 125 && GetInstanceStateWeight(Look Left Back) < 1'
  | 'Abs(YawAngle) <= 125 && GetInstanceStateWeight(Look Right Back) < 1'
  | 'Abs(YawAngle) <= 125'

export type AlsViewTransitionBlendOption =
  | AlphaBlendOption
  | 'Custom'

export type AlsLookSideSwitchCurve =
  | 'CF_Als_LookSideSwitch_In'
  | 'CF_Als_LookSideSwitch_Out'

export interface AlsViewGraphTransition {
  readonly transitionIndex: number
  readonly from: AlsViewGraphState
  readonly to: AlsViewGraphState
  readonly rule: AlsViewTransitionRule
  readonly priorityOrder: 1 | 2
  readonly duration: number
  readonly blendOption: AlsViewTransitionBlendOption
  readonly customCurve: AlsLookSideSwitchCurve | null
  readonly blendProfile: 'LookDirectionChange' | null
  readonly logic: 'StandardBlend'
  readonly automaticRemainingTimeRule: false
  readonly automaticRuleTriggerTime: -1
  readonly compiledDelegateIndex: number
  readonly compiledDelegateProperty: string
}

type ViewTransitionRow = readonly [
  from: AlsViewGraphState,
  to: AlsViewGraphState,
  rule: AlsViewTransitionRule,
  priorityOrder: 1 | 2,
  duration: number,
  blendOption: AlsViewTransitionBlendOption,
  customCurve: AlsLookSideSwitchCurve | null,
  blendProfile: 'LookDirectionChange' | null,
  compiledDelegateIndex: number,
  compiledDelegateProperty: string,
]

/*
 * Serialized transition order is evaluation order. The duplicated edges are
 * intentional: a partially blended destination uses a 0.2 s reversal, while
 * the same boundary in a fully weighted state takes the zero-duration edge.
 */
const VIEW_TRANSITION_ROWS: readonly ViewTransitionRow[] = [
  [
    'Look Forward',
    'Look Right Back',
    'GetInstanceStateWeight(Look Forward) < 1 && RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
    1,
    0.2,
    'HermiteCubic',
    null,
    null,
    8,
    'AnimGraphNode_TransitionResult',
  ],
  [
    'Look Forward',
    'Look Left Back',
    'GetInstanceStateWeight(Look Forward) < 1 && RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
    1,
    0.2,
    'HermiteCubic',
    null,
    null,
    7,
    'AnimGraphNode_TransitionResult_1',
  ],
  [
    'Look Forward',
    'Look Right Back',
    'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
    2,
    0,
    'HermiteCubic',
    null,
    null,
    6,
    'AnimGraphNode_TransitionResult_2',
  ],
  [
    'Look Forward',
    'Look Left Back',
    'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
    2,
    0,
    'HermiteCubic',
    null,
    null,
    5,
    'AnimGraphNode_TransitionResult_3',
  ],
  [
    'Look Left Back',
    'Look Forward',
    'Abs(YawAngle) <= 125 && GetInstanceStateWeight(Look Left Back) < 1',
    1,
    0.2,
    'HermiteCubic',
    null,
    null,
    4,
    'AnimGraphNode_TransitionResult_4',
  ],
  [
    'Look Left Back',
    'Switch Sides',
    'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
    1,
    1,
    'Custom',
    'CF_Als_LookSideSwitch_In',
    'LookDirectionChange',
    6,
    'AnimGraphNode_TransitionResult_2',
  ],
  [
    'Look Left Back',
    'Look Forward',
    'Abs(YawAngle) <= 125',
    2,
    0,
    'HermiteCubic',
    null,
    null,
    3,
    'AnimGraphNode_TransitionResult_5',
  ],
  [
    'Look Right Back',
    'Look Forward',
    'Abs(YawAngle) <= 125 && GetInstanceStateWeight(Look Right Back) < 1',
    1,
    0.2,
    'HermiteCubic',
    null,
    null,
    2,
    'AnimGraphNode_TransitionResult_6',
  ],
  [
    'Look Right Back',
    'Switch Sides',
    'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
    1,
    1,
    'Custom',
    'CF_Als_LookSideSwitch_In',
    'LookDirectionChange',
    5,
    'AnimGraphNode_TransitionResult_3',
  ],
  [
    'Look Right Back',
    'Look Forward',
    'Abs(YawAngle) <= 125',
    2,
    0,
    'HermiteCubic',
    null,
    null,
    3,
    'AnimGraphNode_TransitionResult_5',
  ],
  [
    'Switch Sides',
    'Look Right Back',
    'RemapAngleForCounterClockwiseRotation(YawAngle) >= 130',
    1,
    1,
    'Custom',
    'CF_Als_LookSideSwitch_Out',
    'LookDirectionChange',
    6,
    'AnimGraphNode_TransitionResult_2',
  ],
  [
    'Switch Sides',
    'Look Left Back',
    'RemapAngleForCounterClockwiseRotation(YawAngle) <= -130',
    1,
    1,
    'Custom',
    'CF_Als_LookSideSwitch_Out',
    'LookDirectionChange',
    5,
    'AnimGraphNode_TransitionResult_3',
  ],
]

export const ALS_VIEW_GRAPH_TRANSITIONS:
readonly AlsViewGraphTransition[] =
  VIEW_TRANSITION_ROWS.map((row, transitionIndex) => ({
    transitionIndex,
    from: row[0],
    to: row[1],
    rule: row[2],
    priorityOrder: row[3],
    duration: row[4],
    blendOption: row[5],
    customCurve: row[6],
    blendProfile: row[7],
    logic: 'StandardBlend',
    automaticRemainingTimeRule: false,
    automaticRuleTriggerTime: -1,
    compiledDelegateIndex: row[8],
    compiledDelegateProperty: row[9],
  }))

export const ALS_LOOK_STATES_MACHINE = {
  machineName: 'Look States',
  compiledNodeIndex: 17,
  initialState: 'Look Forward',
  initialStateIndex: 0,
  maxTransitionsPerFrame: 3,
  maxTransitionRequests: 32,
  skipFirstUpdateTransition: true,
  reinitializeOnBecomingRelevant: true,
  createNotifyMetadata: true,
  allowConduitEntryStates: false,
  states: [
    {
      name: 'Look Forward',
      stateIndex: 0,
      stateResultNodeIndex: 10,
      playerNodeIndex: 9,
      alwaysResetOnEntry: false,
    },
    {
      name: 'Look Left Back',
      stateIndex: 1,
      stateResultNodeIndex: 16,
      playerNodeIndex: 15,
      alwaysResetOnEntry: false,
    },
    {
      name: 'Look Right Back',
      stateIndex: 2,
      stateResultNodeIndex: 14,
      playerNodeIndex: 13,
      alwaysResetOnEntry: false,
    },
    {
      name: 'Switch Sides',
      stateIndex: 3,
      stateResultNodeIndex: 12,
      playerNodeIndex: 11,
      alwaysResetOnEntry: false,
    },
  ],
} as const

export interface AlsViewTransitionInput {
  /** FAlsLookState::YawAngle, in degrees. */
  readonly yawAngle: number
  /** GetInstanceStateWeight() results for the named Look States states. */
  readonly stateWeights: Readonly<Record<AlsViewGraphState, number>>
}

function viewTransition(index: number) {
  return ALS_VIEW_GRAPH_TRANSITIONS[index]
}

/** Evaluates AB_Als_View's outgoing edges in their serialized priority. */
export function selectAlsViewGraphTransition(
  state: AlsViewGraphState,
  input: AlsViewTransitionInput,
): AlsViewGraphTransition | null {
  const remappedYawAngle =
    remapAngleForCounterClockwiseRotation(input.yawAngle)
  const forward = Math.abs(input.yawAngle) <= 125

  switch (state) {
    case 'Look Forward':
      if (
        input.stateWeights['Look Forward'] < 1
        && remappedYawAngle >= 130
      ) {
        return viewTransition(0)
      }
      if (
        input.stateWeights['Look Forward'] < 1
        && remappedYawAngle <= -130
      ) {
        return viewTransition(1)
      }
      if (remappedYawAngle >= 130) return viewTransition(2)
      return remappedYawAngle <= -130 ? viewTransition(3) : null
    case 'Look Left Back':
      if (
        forward
        && input.stateWeights['Look Left Back'] < 1
      ) {
        return viewTransition(4)
      }
      if (remappedYawAngle >= 130) return viewTransition(5)
      return forward ? viewTransition(6) : null
    case 'Look Right Back':
      if (
        forward
        && input.stateWeights['Look Right Back'] < 1
      ) {
        return viewTransition(7)
      }
      if (remappedYawAngle <= -130) return viewTransition(8)
      return forward ? viewTransition(9) : null
    case 'Switch Sides':
      if (remappedYawAngle >= 130) return viewTransition(10)
      return remappedYawAngle <= -130 ? viewTransition(11) : null
  }
}

export interface AlsLookBlendSpaceAsset extends AuthoredBlendSpace {
  readonly assetPath: 'ALS/Content/ALS/Animations/View/BS_Als_Look.uasset'
  readonly containsRotationOffsetMeshSpaceSamples: true
  readonly previewBasePose: {
    readonly name: 'A_Als_Stand_Pose'
    readonly objectPath: '/ALS/ALS/Animations/Base/A_Als_Stand_Pose'
  }
}

export const ALS_LOOK_BLEND_SPACE: AlsLookBlendSpaceAsset = {
  assetPath: 'ALS/Content/ALS/Animations/View/BS_Als_Look.uasset',
  className: 'BlendSpace1D',
  loop: false,
  containsRotationOffsetMeshSpaceSamples: true,
  animLengthSeconds: 1,
  sampleIndexWithMarkers: null,
  previewBasePose: {
    name: 'A_Als_Stand_Pose',
    objectPath: '/ALS/ALS/Animations/Base/A_Als_Stand_Pose',
  },
  axes: [
    {
      index: 0,
      serialized: {
        DisplayName: 'Pitch Angle',
        Min: -90,
        Max: 90,
      },
    },
  ],
  interpolationParameters: [],
  samples: [
    {
      animation: {
        name: 'A_Als_Look_Forward',
        objectPath: '/ALS/ALS/Animations/View/A_Als_Look_Forward',
      },
      sampleValue: { X: 0, Y: 0, Z: 0 },
      rateScale: 1,
    },
    {
      animation: {
        name: 'A_Als_Look_Down',
        objectPath: '/ALS/ALS/Animations/View/A_Als_Look_Down',
      },
      sampleValue: { X: -90, Y: 0, Z: 0 },
      rateScale: 1,
    },
    {
      animation: {
        name: 'A_Als_Look_Up',
        objectPath: '/ALS/ALS/Animations/View/A_Als_Look_Up',
      },
      sampleValue: { X: 90, Y: 0, Z: 0 },
      rateScale: 1,
    },
  ],
  topology: {
    interpolateUsingGrid: false,
    blendSpaceData: {
      Segments: [
        {
          SampleIndices: 1,
          'SampleIndices[1]': 0,
          Vertices: 0,
          'Vertices[1]': 0.5,
        },
        {
          SampleIndices: 0,
          'SampleIndices[1]': 2,
          Vertices: 0.5,
          'Vertices[1]': 1,
        },
      ],
    },
    gridSamples: [],
  },
}

export const ALS_LOOK_BLEND_SPACE_COMPILED =
  compileBlendSpace(ALS_LOOK_BLEND_SPACE)

/** Creates the per-player mutable evaluator state owned by an AnimGraph instance. */
export function createAlsLookBlendSpaceEvaluator(): BlendSpaceEvaluator {
  return createBlendSpaceEvaluator(ALS_LOOK_BLEND_SPACE_COMPILED)
}

export type AlsViewNormalizedTimeBinding =
  | 'LookState.YawForwardAmount'
  | 'LookState.YawLeftAmount'
  | 'LookState.YawRightAmount'

export interface AlsViewBlendSpacePlayer {
  readonly state: AlsViewGraphState
  readonly compiledNodeIndex: 9 | 11 | 13 | 15
  readonly compiledNodeProperty:
    | 'AnimGraphNode_BlendSpaceEvaluator_3'
    | 'AnimGraphNode_BlendSpaceEvaluator_2'
    | 'AnimGraphNode_BlendSpaceEvaluator_1'
    | 'AnimGraphNode_BlendSpaceEvaluator'
  readonly blendSpace: 'BS_Als_Look'
  readonly xBinding: 'LookState.PitchAngle'
  readonly normalizedTimeBinding: AlsViewNormalizedTimeBinding | null
  readonly normalizedTime: number | null
  readonly teleportToNormalizedTime: true
  readonly groupName: null
  readonly groupRole: 'CanBeLeader'
  readonly syncMethod: 'DoNotSync'
  readonly ignoreForRelevancyTest: false
  readonly playRate: 1
  readonly loop: true
  readonly startPosition: 0
  readonly resetPlayTimeWhenBlendSpaceChanges: true
}

export const ALS_VIEW_PLAYERS:
Readonly<Record<AlsViewGraphState, AlsViewBlendSpacePlayer>> = {
  'Look Forward': {
    state: 'Look Forward',
    compiledNodeIndex: 9,
    compiledNodeProperty: 'AnimGraphNode_BlendSpaceEvaluator_3',
    blendSpace: 'BS_Als_Look',
    xBinding: 'LookState.PitchAngle',
    normalizedTimeBinding: 'LookState.YawForwardAmount',
    normalizedTime: null,
    teleportToNormalizedTime: true,
    groupName: null,
    groupRole: 'CanBeLeader',
    syncMethod: 'DoNotSync',
    ignoreForRelevancyTest: false,
    playRate: 1,
    loop: true,
    startPosition: 0,
    resetPlayTimeWhenBlendSpaceChanges: true,
  },
  'Look Left Back': {
    state: 'Look Left Back',
    compiledNodeIndex: 15,
    compiledNodeProperty: 'AnimGraphNode_BlendSpaceEvaluator',
    blendSpace: 'BS_Als_Look',
    xBinding: 'LookState.PitchAngle',
    normalizedTimeBinding: 'LookState.YawLeftAmount',
    normalizedTime: null,
    teleportToNormalizedTime: true,
    groupName: null,
    groupRole: 'CanBeLeader',
    syncMethod: 'DoNotSync',
    ignoreForRelevancyTest: false,
    playRate: 1,
    loop: true,
    startPosition: 0,
    resetPlayTimeWhenBlendSpaceChanges: true,
  },
  'Look Right Back': {
    state: 'Look Right Back',
    compiledNodeIndex: 13,
    compiledNodeProperty: 'AnimGraphNode_BlendSpaceEvaluator_1',
    blendSpace: 'BS_Als_Look',
    xBinding: 'LookState.PitchAngle',
    normalizedTimeBinding: 'LookState.YawRightAmount',
    normalizedTime: null,
    teleportToNormalizedTime: true,
    groupName: null,
    groupRole: 'CanBeLeader',
    syncMethod: 'DoNotSync',
    ignoreForRelevancyTest: false,
    playRate: 1,
    loop: true,
    startPosition: 0,
    resetPlayTimeWhenBlendSpaceChanges: true,
  },
  'Switch Sides': {
    state: 'Switch Sides',
    compiledNodeIndex: 11,
    compiledNodeProperty: 'AnimGraphNode_BlendSpaceEvaluator_2',
    blendSpace: 'BS_Als_Look',
    xBinding: 'LookState.PitchAngle',
    normalizedTimeBinding: null,
    normalizedTime: 0.5,
    teleportToNormalizedTime: true,
    groupName: null,
    groupRole: 'CanBeLeader',
    syncMethod: 'DoNotSync',
    ignoreForRelevancyTest: false,
    playRate: 1,
    loop: true,
    startPosition: 0,
    resetPlayTimeWhenBlendSpaceChanges: true,
  },
}

export interface AlsViewPlayerParameters {
  readonly x: number
  readonly normalizedTime: number
}

/**
 * Resolves the exact property-access values consumed by a state's
 * FAnimNode_BlendSpaceEvaluator. Values are not rederived or clamped here.
 */
export function resolveAlsViewPlayerParameters(
  state: AlsViewGraphState,
  lookState: Pick<
    AlsLookState,
    | 'pitchAngle'
    | 'yawForwardAmount'
    | 'yawLeftAmount'
    | 'yawRightAmount'
  >,
): AlsViewPlayerParameters {
  let normalizedTime: number
  switch (state) {
    case 'Look Forward':
      normalizedTime = lookState.yawForwardAmount
      break
    case 'Look Left Back':
      normalizedTime = lookState.yawLeftAmount
      break
    case 'Look Right Back':
      normalizedTime = lookState.yawRightAmount
      break
    case 'Switch Sides':
      normalizedTime = 0.5
      break
  }
  return {
    x: lookState.pitchAngle,
    normalizedTime,
  }
}

export const ALS_LOOK_SIDE_SWITCH_CURVES:
Readonly<Record<AlsLookSideSwitchCurve, readonly RichCurveKey[]>> = {
  CF_Als_LookSideSwitch_In: [
    {
      time: 0,
      value: 0,
      interpolation: 'cubic',
      arriveTangent: 0,
      leaveTangent: 0,
    },
    {
      time: 0.20000000298023224,
      value: 0.20000000298023224,
      interpolation: 'cubic',
      arriveTangent: 2.72149658203125,
      leaveTangent: 2.72149658203125,
    },
    {
      time: 0.5,
      value: 1,
      interpolation: 'linear',
      arriveTangent: 2.718350887298584,
      leaveTangent: 0,
    },
    {
      time: 1,
      value: 1,
      interpolation: 'linear',
      arriveTangent: 0,
      leaveTangent: 0,
    },
  ],
  CF_Als_LookSideSwitch_Out: [
    {
      time: 0,
      value: 0,
      interpolation: 'linear',
      arriveTangent: 0,
      leaveTangent: 0,
    },
    {
      time: 0.20000000298023224,
      value: 0,
      interpolation: 'cubic',
      arriveTangent: 0,
      leaveTangent: 0,
    },
    {
      time: 0.5,
      value: 0.5,
      interpolation: 'cubic',
      arriveTangent: 3.0318171977996826,
      leaveTangent: 3.0318171977996826,
    },
    {
      time: 1,
      value: 1,
      interpolation: 'linear',
      arriveTangent: 0,
      leaveTangent: 0,
    },
  ],
}

export const ALS_LOOK_DIRECTION_CHANGE_PROFILE: WeightBlendProfile = {
  mode: 'WeightFactor',
  entries: [
    { bone: 'neck_01', blendScale: 2 },
    { bone: 'head', blendScale: 2 },
  ],
}

/** Samples the transition's authored FAlphaBlend option at elapsed seconds. */
export function sampleAlsViewTransitionBlend(
  transition: AlsViewGraphTransition,
  elapsed: number,
): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new Error(
      'View transition elapsed time must be finite and non-negative',
    )
  }
  const linearAlpha = transition.duration <= 0
    ? 1
    : Math.min(elapsed / transition.duration, 1)
  if (transition.customCurve) {
    return sampleRichCurve(
      ALS_LOOK_SIDE_SWITCH_CURVES[transition.customCurve],
      linearAlpha,
    )
  }
  if (transition.blendOption === 'Custom') {
    throw new Error('Custom View transition has no authored curve')
  }
  return alphaToBlendOption(linearAlpha, transition.blendOption)
}

type AlsViewGraphPoseNode =
  | {
      readonly kind: 'state'
      readonly state: AlsViewGraphState
    }
  | {
      readonly kind: 'transition'
      readonly source: AlsViewGraphPoseNode
      readonly transition: AlsViewGraphTransition
      elapsed: number
    }

export interface AlsViewGraphRuntime {
  readonly boneCount: number
  readonly lookDirectionChangeProfile: CompiledWeightBlendProfile
  readonly stateWeights: Record<AlsViewGraphState, number>
  readonly statePoseMasks: Record<AlsViewGraphState, Float32Array>
  currentState: AlsViewGraphState
  relevant: boolean
  transitionCount: number
  readonly activeTransitionIndices: number[]
  poseNode: AlsViewGraphPoseNode
}

function createViewStateWeights(): Record<AlsViewGraphState, number> {
  return {
    'Look Forward': 0,
    'Look Left Back': 0,
    'Look Right Back': 0,
    'Switch Sides': 0,
  }
}

function createViewStatePoseMasks(
  boneCount: number,
): Record<AlsViewGraphState, Float32Array> {
  return {
    'Look Forward': new Float32Array(boneCount),
    'Look Left Back': new Float32Array(boneCount),
    'Look Right Back': new Float32Array(boneCount),
    'Switch Sides': new Float32Array(boneCount),
  }
}

function statePoseNode(state: AlsViewGraphState): AlsViewGraphPoseNode {
  return { kind: 'state', state }
}

function transitionAlpha(node: Extract<
  AlsViewGraphPoseNode,
  { readonly kind: 'transition' }
>) {
  return sampleAlsViewTransitionBlend(node.transition, node.elapsed)
}

function accumulateViewStateWeights(
  node: AlsViewGraphPoseNode,
  parentWeight: number,
  out: Record<AlsViewGraphState, number>,
) {
  if (node.kind === 'state') {
    out[node.state] += parentWeight
    return
  }

  const alpha = transitionAlpha(node)
  accumulateViewStateWeights(node.source, parentWeight * (1 - alpha), out)
  out[node.transition.to] += parentWeight * alpha
}

function accumulateViewStatePoseWeightsForBone(
  node: AlsViewGraphPoseNode,
  boneIndex: number,
  parentWeight: number,
  profile: CompiledWeightBlendProfile,
  out: Record<AlsViewGraphState, Float32Array>,
) {
  if (node.kind === 'state') {
    out[node.state][boneIndex] += parentWeight
    return
  }

  const profileScale = node.transition.blendProfile
    ? profile.blendScales[boneIndex]
    : 1
  const incomingWeight = Math.max(
    0,
    Math.min(1, transitionAlpha(node) * profileScale),
  )
  accumulateViewStatePoseWeightsForBone(
    node.source,
    boneIndex,
    parentWeight * (1 - incomingWeight),
    profile,
    out,
  )
  out[node.transition.to][boneIndex] += parentWeight * incomingWeight
}

function collectActiveTransitionIndices(
  node: AlsViewGraphPoseNode,
  out: number[],
) {
  if (node.kind === 'state') return
  collectActiveTransitionIndices(node.source, out)
  out.push(node.transition.transitionIndex)
}

function refreshViewGraphWeights(runtime: AlsViewGraphRuntime) {
  for (const state of ALS_LOOK_STATES_MACHINE.states) {
    runtime.stateWeights[state.name] = 0
    runtime.statePoseMasks[state.name].fill(0)
  }

  accumulateViewStateWeights(runtime.poseNode, 1, runtime.stateWeights)
  for (let boneIndex = 0; boneIndex < runtime.boneCount; boneIndex++) {
    accumulateViewStatePoseWeightsForBone(
      runtime.poseNode,
      boneIndex,
      1,
      runtime.lookDirectionChangeProfile,
      runtime.statePoseMasks,
    )
  }

  const activeTransitionIndices = runtime.activeTransitionIndices
  activeTransitionIndices.length = 0
  collectActiveTransitionIndices(runtime.poseNode, activeTransitionIndices)
  runtime.transitionCount = activeTransitionIndices.length
}

function advanceViewGraphPoseNode(
  node: AlsViewGraphPoseNode,
  deltaTime: number,
) {
  if (node.kind === 'state') return
  advanceViewGraphPoseNode(node.source, deltaTime)
  node.elapsed = Math.min(
    node.transition.duration,
    node.elapsed + deltaTime,
  )
}

/**
 * Creates AB_Als_View's retained four-state machine.
 *
 * A transition node owns the complete previous transition graph as its source. This is UE's
 * transition-stack behavior and is load-bearing for the two simultaneous one-second side-switch
 * edges: Left/Right Back -> Switch Sides -> opposite Back. Flattening that chain to a snapshot
 * loses the authored In/Out curve pair and the LookDirectionChange per-bone profile.
 */
export function createAlsViewGraphRuntime(
  rig: RigDefinition,
): AlsViewGraphRuntime {
  const initialState = ALS_LOOK_STATES_MACHINE.initialState
  const runtime: AlsViewGraphRuntime = {
    boneCount: rig.boneCount,
    lookDirectionChangeProfile: compileWeightBlendProfile(
      rig,
      ALS_LOOK_DIRECTION_CHANGE_PROFILE,
    ),
    stateWeights: createViewStateWeights(),
    statePoseMasks: createViewStatePoseMasks(rig.boneCount),
    currentState: initialState,
    relevant: false,
    transitionCount: 0,
    activeTransitionIndices: [],
    poseNode: statePoseNode(initialState),
  }
  refreshViewGraphWeights(runtime)
  return runtime
}

function resetAlsViewGraphRuntime(runtime: AlsViewGraphRuntime) {
  runtime.currentState = ALS_LOOK_STATES_MACHINE.initialState
  runtime.poseNode = statePoseNode(runtime.currentState)
  runtime.transitionCount = 0
  const activeTransitionIndices = runtime.activeTransitionIndices
  activeTransitionIndices.length = 0
  refreshViewGraphWeights(runtime)
}

/**
 * Updates the exact AB_Als_View state-machine topology.
 *
 * `relevant` maps the root TwoWayBlend's child relevance to
 * bReinitializeOnBecomingRelevant + bSkipFirstUpdateTransition. The serialized
 * MaxTransitionsPerFrame=3 allows the two authored side-switch transitions to be installed in
 * one update before their clocks advance together.
 */
export function updateAlsViewGraphRuntime(
  runtime: AlsViewGraphRuntime,
  yawAngle: number,
  deltaTime: number,
  relevant: boolean,
): AlsViewGraphRuntime {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error('View graph delta time must be finite and non-negative')
  }

  if (!relevant) {
    runtime.relevant = false
    resetAlsViewGraphRuntime(runtime)
    return runtime
  }

  if (!runtime.relevant) {
    runtime.relevant = true
    resetAlsViewGraphRuntime(runtime)
    return runtime
  }

  for (
    let transitionRequest = 0;
    transitionRequest < ALS_LOOK_STATES_MACHINE.maxTransitionsPerFrame;
    transitionRequest++
  ) {
    refreshViewGraphWeights(runtime)
    const transition = selectAlsViewGraphTransition(runtime.currentState, {
      yawAngle,
      stateWeights: runtime.stateWeights,
    })
    if (!transition) break

    runtime.currentState = transition.to
    if (transition.duration <= 0) {
      runtime.poseNode = statePoseNode(transition.to)
    } else {
      runtime.poseNode = {
        kind: 'transition',
        source: runtime.poseNode,
        transition,
        elapsed: 0,
      }
    }
  }

  advanceViewGraphPoseNode(runtime.poseNode, deltaTime)
  if (
    runtime.poseNode.kind === 'transition'
    && runtime.poseNode.elapsed >= runtime.poseNode.transition.duration
  ) {
    runtime.poseNode = statePoseNode(runtime.poseNode.transition.to)
  }
  refreshViewGraphWeights(runtime)
  return runtime
}

export const ALS_VIEW_GRAPH = {
  targetSkeleton: 'SK_Als',
  linkedInputPose: {
    name: 'View Input',
    compiledNodeIndex: 1,
  },
  cachedInputPose: {
    name: 'View Input',
    saveNodeIndex: 18,
    baseUseNodeIndex: 19,
    unmodifiedUseNodeIndex: 20,
  },
  look: {
    stateMachineNodeIndex: 17,
    refreshFunction: {
      name: 'RefreshLook',
      callSite: 'OnUpdate',
      compiledNodeIndex: 24,
    },
    initializeFunction: {
      name: 'InitializeLook',
      callSite: 'OnBecomeRelevant',
      compiledNodeIndex: 23,
    },
    blendSpace: 'BS_Als_Look',
    additiveType: 'MeshSpaceRotationOffset',
  },
  applyMeshSpaceAdditive: {
    compiledNodeIndex: 21,
    baseNodeIndex: 19,
    additiveNodeIndex: 23,
    alpha: 1,
    lodThreshold: -1,
  },
  outputBlend: {
    compiledNodeIndex: 22,
    aNodeIndex: 20,
    bNodeIndex: 21,
    alphaBinding: 'ViewState.LookAmount',
    mapRange: false,
    clampResult: false,
    interpolateResult: false,
    resetChildOnActivation: false,
    alwaysUpdateChildren: false,
  },
  aimingSubgraph: {
    kind: 'not-present',
    note:
      'AB_Als_View contains no Aiming state machine/player; '
      + 'its only authored root gate is ViewState.LookAmount.',
  },
} as const
