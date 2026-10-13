import {
  alphaToBlendOption,
} from '../../engine/alphaBlend'
import type { AlphaBlendOption } from '../../engine/alphaBlend'
import {
  accumulatePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  clearPoseAccumulator,
  createMeshSpaceBlendScratch,
  createPoseAccumulator,
  finalizePose,
  makeDynamicAdditivePose,
} from '../../engine/blend'
import type {
  MeshSpaceBlendScratch,
  PoseAccumulator,
} from '../../engine/blend'
import {
  compileBlendSpace,
  createBlendSpaceEvaluator,
  evaluateBlendSpace,
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
import { sampleClip } from '../../engine/clipSampler'
import type { CompiledClipSampler } from '../../engine/clipSampler'
import {
  copyPose,
  createPoseBuffer,
  resetPoseToAdditiveIdentity,
} from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
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

interface MutableAlsViewPlayerParameters {
  x: number
  normalizedTime: number
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
  output?: MutableAlsViewPlayerParameters,
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
  const parameters = output ?? { x: 0, normalizedTime: 0 }
  parameters.x = lookState.pitchAngle
  parameters.normalizedTime = normalizedTime
  return parameters
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
      source: AlsViewGraphPoseNode
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
): AlsViewGraphPoseNode {
  if (node.kind === 'state') return node
  node.source = advanceViewGraphPoseNode(node.source, deltaTime)
  node.elapsed = Math.min(
    node.transition.duration,
    node.elapsed + deltaTime,
  )
  return node.elapsed >= node.transition.duration
    ? statePoseNode(node.transition.to)
    : node
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

  runtime.poseNode = advanceViewGraphPoseNode(runtime.poseNode, deltaTime)
  refreshViewGraphWeights(runtime)
  return runtime
}

const ZERO_ANIMWEIGHT_THRESH = 1e-5

export const ALS_VIEW_POSE_CLIP_NAMES = [
  'A_Als_Look_Forward',
  'A_Als_Look_Down',
  'A_Als_Look_Up',
] as const

export type AlsViewPoseClipName =
  (typeof ALS_VIEW_POSE_CLIP_NAMES)[number]

export type AlsViewPoseSamplerLookup = (
  clipName: AlsViewPoseClipName,
) => CompiledClipSampler | undefined

export type AlsViewPoseSamplerRecord = Readonly<
  Record<AlsViewPoseClipName, CompiledClipSampler>
>

export interface AlsViewPosePlayerRuntime {
  readonly state: AlsViewGraphState
  /** Exact serialized FAnimNode_BlendSpaceEvaluator binding. */
  readonly binding: AlsViewBlendSpacePlayer
  /** Mutable BlendSpace evaluator state is owned per player, as it is in UE. */
  readonly evaluator: BlendSpaceEvaluator
  readonly parameters: {
    x: number
    normalizedTime: number
  }
  /** Sparse authored sample indices, valid below sampleCount. */
  readonly sampleIndices: Int32Array
  /** Sparse sample weights parallel to sampleIndices. */
  readonly sampleWeights: Float64Array
  /** Per-sparse-sample sequence times parallel to sampleIndices. */
  readonly samplerTimes: Float64Array
  sampleCount: number
  pitchAngle: number
  /** FAnimNode_BlendSpaceEvaluator::NormalizedTime. */
  explicitTime: number
}

export interface AlsViewPoseRuntime {
  readonly rig: RigDefinition
  readonly graph: AlsViewGraphRuntime
  readonly players: Readonly<
    Record<AlsViewGraphState, AlsViewPosePlayerRuntime>
  >
  readonly samplers: AlsViewPoseSamplerRecord
  /** A_Als_Stand_Pose frame zero, owned by this graph instance. */
  readonly standReferencePose: LocalPoseBuffer
  readonly poseAccumulator: PoseAccumulator
  readonly samplePose: LocalPoseBuffer
  readonly statePoses: Readonly<
    Record<AlsViewGraphState, LocalPoseBuffer>
  >
  readonly transitionOutputPoses: LocalPoseBuffer[]
  readonly transitionAlphaMasks: Float32Array[]
  readonly sourcePose: LocalPoseBuffer
  readonly additivePose: LocalPoseBuffer
  readonly viewInputPose: LocalPoseBuffer
  readonly viewOutputPose: LocalPoseBuffer
  readonly rootOutputPose: LocalPoseBuffer
  readonly meshSpaceScratch: MeshSpaceBlendScratch
}

function createAlsViewPosePlayerRuntime(
  state: AlsViewGraphState,
): AlsViewPosePlayerRuntime {
  const binding = ALS_VIEW_PLAYERS[state]
  return {
    state,
    binding,
    evaluator: createAlsLookBlendSpaceEvaluator(),
    parameters: { x: 0, normalizedTime: binding.normalizedTime ?? 0 },
    sampleIndices: new Int32Array(ALS_LOOK_BLEND_SPACE.samples.length)
      .fill(-1),
    sampleWeights:
      new Float64Array(ALS_LOOK_BLEND_SPACE.samples.length),
    samplerTimes:
      new Float64Array(ALS_LOOK_BLEND_SPACE.samples.length),
    sampleCount: 0,
    pitchAngle: 0,
    explicitTime: binding.normalizedTime ?? 0,
  }
}

function requireAlsViewPoseSampler(
  samplerLookup: AlsViewPoseSamplerLookup,
  clipName: AlsViewPoseClipName,
  rig: RigDefinition,
) {
  const sampler = samplerLookup(clipName)
  if (!sampler) {
    throw new Error(`AB_Als_View missing sampler: ${clipName}`)
  }
  if (sampler.clip.name !== clipName) {
    throw new Error(
      `AB_Als_View sampler mismatch: expected ${clipName}, `
      + `received ${sampler.clip.name}`,
    )
  }
  if (
    !Number.isFinite(sampler.clip.duration)
    || sampler.clip.duration <= 0
  ) {
    throw new Error(
      `AB_Als_View sampler has invalid duration: ${clipName}`,
    )
  }
  if (
    sampler.virtualBoneScratch
    && sampler.virtualBoneScratch.boneCount !== rig.boneCount
  ) {
    throw new Error(
      `AB_Als_View sampler bone-count mismatch: ${clipName}`,
    )
  }
  for (const binding of sampler.bindings) {
    if (binding.boneIndex < 0 || binding.boneIndex >= rig.boneCount) {
      throw new Error(
        `AB_Als_View sampler bone-count mismatch: ${clipName}`,
      )
    }
  }
  return sampler
}

function samplerForAlsViewBlendSpaceSample(
  samplers: AlsViewPoseSamplerRecord,
  sampleIndex: number,
) {
  switch (sampleIndex) {
    case 0: return samplers.A_Als_Look_Forward
    case 1: return samplers.A_Als_Look_Down
    case 2: return samplers.A_Als_Look_Up
    default:
      throw new Error(
        `BS_Als_Look returned invalid sample index ${sampleIndex}`,
      )
  }
}

function createAlsViewStatePoses(
  boneCount: number,
  referencePose: LocalPoseBuffer,
): Record<AlsViewGraphState, LocalPoseBuffer> {
  const createStatePose = () => {
    const pose = createPoseBuffer(boneCount)
    copyPose(referencePose, pose)
    return pose
  }
  return {
    'Look Forward': createStatePose(),
    'Look Left Back': createStatePose(),
    'Look Right Back': createStatePose(),
    'Switch Sides': createStatePose(),
  }
}

export function createAlsViewPoseRuntime(
  rig: RigDefinition,
  referencePose: LocalPoseBuffer,
  samplerLookup: AlsViewPoseSamplerLookup,
): AlsViewPoseRuntime {
  if (referencePose.boneCount !== rig.boneCount) {
    throw new Error(
      'AB_Als_View reference pose bone-count mismatch: '
      + `${referencePose.boneCount} !== ${rig.boneCount}`,
    )
  }

  const samplers: AlsViewPoseSamplerRecord = Object.freeze({
    A_Als_Look_Forward: requireAlsViewPoseSampler(
      samplerLookup,
      'A_Als_Look_Forward',
      rig,
    ),
    A_Als_Look_Down: requireAlsViewPoseSampler(
      samplerLookup,
      'A_Als_Look_Down',
      rig,
    ),
    A_Als_Look_Up: requireAlsViewPoseSampler(
      samplerLookup,
      'A_Als_Look_Up',
      rig,
    ),
  })
  const standReferencePose = createPoseBuffer(rig.boneCount)
  copyPose(referencePose, standReferencePose)
  const samplePose = createPoseBuffer(rig.boneCount)
  const sourcePose = createPoseBuffer(rig.boneCount)
  const additivePose = createPoseBuffer(rig.boneCount)
  const viewInputPose = createPoseBuffer(rig.boneCount)
  const viewOutputPose = createPoseBuffer(rig.boneCount)
  const rootOutputPose = createPoseBuffer(rig.boneCount)
  copyPose(standReferencePose, samplePose)
  copyPose(standReferencePose, sourcePose)
  resetPoseToAdditiveIdentity(additivePose)
  copyPose(standReferencePose, viewInputPose)
  copyPose(standReferencePose, viewOutputPose)
  copyPose(standReferencePose, rootOutputPose)

  return {
    rig,
    graph: createAlsViewGraphRuntime(rig),
    players: Object.freeze({
      'Look Forward':
        createAlsViewPosePlayerRuntime('Look Forward'),
      'Look Left Back':
        createAlsViewPosePlayerRuntime('Look Left Back'),
      'Look Right Back':
        createAlsViewPosePlayerRuntime('Look Right Back'),
      'Switch Sides':
        createAlsViewPosePlayerRuntime('Switch Sides'),
    }),
    samplers,
    standReferencePose,
    poseAccumulator: createPoseAccumulator(rig.boneCount),
    samplePose,
    statePoses: createAlsViewStatePoses(
      rig.boneCount,
      standReferencePose,
    ),
    transitionOutputPoses: Array.from(
      {
        length:
          ALS_LOOK_STATES_MACHINE.maxTransitionsPerFrame,
      },
      () => createPoseBuffer(rig.boneCount),
    ),
    transitionAlphaMasks: Array.from(
      {
        length:
          ALS_LOOK_STATES_MACHINE.maxTransitionsPerFrame,
      },
      () => new Float32Array(rig.boneCount),
    ),
    sourcePose,
    additivePose,
    viewInputPose,
    viewOutputPose,
    rootOutputPose,
    meshSpaceScratch: createMeshSpaceBlendScratch(rig.boneCount),
  }
}

/** FAnimWeight::IsRelevant() at AB_Als_View's root TwoWayBlend. */
export function isAlsViewPoseRelevant(lookAmount: number) {
  return lookAmount > ZERO_ANIMWEIGHT_THRESH
}

export function isAlsViewPoseBecomingRelevant(
  runtime: AlsViewPoseRuntime,
  lookAmount: number,
) {
  return (
    isAlsViewPoseRelevant(lookAmount)
    && !runtime.graph.relevant
  )
}

/**
 * Commits AB_Als_View's retained graph and explicit BlendSpace player data.
 */
export function refreshAlsViewPoseRuntime(
  runtime: AlsViewPoseRuntime,
  lookState: Pick<
    AlsLookState,
    | 'yawAngle'
    | 'pitchAngle'
    | 'yawForwardAmount'
    | 'yawLeftAmount'
    | 'yawRightAmount'
  >,
  lookAmount: number,
  deltaTime: number,
): AlsViewPoseRuntime {
  const relevant = isAlsViewPoseRelevant(lookAmount)
  updateAlsViewGraphRuntime(
    runtime.graph,
    lookState.yawAngle,
    deltaTime,
    relevant,
  )

  if (!relevant) {
    for (
      let stateIndex = 0;
      stateIndex < ALS_LOOK_STATES_MACHINE.states.length;
      stateIndex++
    ) {
      const stateDescriptor =
        ALS_LOOK_STATES_MACHINE.states[stateIndex]
      const player = runtime.players[stateDescriptor.name]
      player.sampleIndices.fill(-1)
      player.sampleWeights.fill(0)
      player.samplerTimes.fill(0)
      player.sampleCount = 0
    }
    return runtime
  }

  for (
    let stateIndex = 0;
    stateIndex < ALS_LOOK_STATES_MACHINE.states.length;
    stateIndex++
  ) {
    const stateDescriptor =
      ALS_LOOK_STATES_MACHINE.states[stateIndex]
    const player = runtime.players[stateDescriptor.name]
    const parameters = resolveAlsViewPlayerParameters(
      player.state,
      lookState,
      player.parameters,
    )
    player.pitchAngle = parameters.x
    player.explicitTime = parameters.normalizedTime
    const samples = evaluateBlendSpace(
      player.evaluator,
      player.pitchAngle,
    )
    player.sampleIndices.fill(-1)
    player.sampleWeights.fill(0)
    player.samplerTimes.fill(0)
    player.sampleCount = samples.count
    for (let index = 0; index < samples.count; index++) {
      const sampleIndex = samples.sampleIndices[index]
      player.sampleIndices[index] = sampleIndex
      player.sampleWeights[index] = samples.weights[index]
      player.samplerTimes[index] =
        player.explicitTime
        * samplerForAlsViewBlendSpaceSample(
          runtime.samplers,
          sampleIndex,
        ).clip.duration
    }
  }
  return runtime
}

function evaluateAlsViewStatePoses(runtime: AlsViewPoseRuntime) {
  for (
    let stateIndex = 0;
    stateIndex < ALS_LOOK_STATES_MACHINE.states.length;
    stateIndex++
  ) {
    const state = ALS_LOOK_STATES_MACHINE.states[stateIndex].name
    const player = runtime.players[state]
    clearPoseAccumulator(runtime.poseAccumulator)
    for (
      let sample = 0;
      sample < player.sampleCount;
      sample++
    ) {
      const sampleIndex = player.sampleIndices[sample]
      sampleClip(
        samplerForAlsViewBlendSpaceSample(
          runtime.samplers,
          sampleIndex,
        ),
        runtime.rig,
        player.samplerTimes[sample],
        runtime.samplePose,
        player.binding.loop,
        runtime.standReferencePose,
      )
      accumulatePose(
        runtime.poseAccumulator,
        runtime.samplePose,
        player.sampleWeights[sample],
      )
    }
    finalizePose(
      runtime.poseAccumulator,
      runtime.standReferencePose,
      runtime.statePoses[state],
    )
  }
}

function evaluateAlsViewGraphPoseNode(
  runtime: AlsViewPoseRuntime,
  node: AlsViewGraphPoseNode,
  output: LocalPoseBuffer,
  transitionDepth: number,
): LocalPoseBuffer {
  if (node.kind === 'state') {
    return copyPose(runtime.statePoses[node.state], output)
  }
  if (transitionDepth >= runtime.transitionOutputPoses.length) {
    // MaxTransitionsPerFrame limits new requests, not blends retained across frames.
    runtime.transitionOutputPoses.push(createPoseBuffer(runtime.rig.boneCount))
    runtime.transitionAlphaMasks.push(new Float32Array(runtime.rig.boneCount))
  }

  const sourceOutput =
    runtime.transitionOutputPoses[transitionDepth]
  evaluateAlsViewGraphPoseNode(
    runtime,
    node.source,
    sourceOutput,
    transitionDepth + 1,
  )
  copyPose(sourceOutput, output)
  const alpha = sampleAlsViewTransitionBlend(
    node.transition,
    node.elapsed,
  )
  if (node.transition.blendProfile === 'LookDirectionChange') {
    const mask = runtime.transitionAlphaMasks[transitionDepth]
    const blendScales =
      runtime.graph.lookDirectionChangeProfile.blendScales
    for (let bone = 0; bone < runtime.rig.boneCount; bone++) {
      mask[bone] = Math.max(
        0,
        Math.min(1, alpha * blendScales[bone]),
      )
    }
    blendPoseInPlace(
      output,
      runtime.statePoses[node.transition.to],
      1,
      mask,
    )
  } else {
    blendPoseInPlace(
      output,
      runtime.statePoses[node.transition.to],
      alpha,
    )
  }
  return output
}

function assertAlsViewPoseBoneCounts(
  runtime: AlsViewPoseRuntime,
  viewInputPose: LocalPoseBuffer,
  outputPose: LocalPoseBuffer,
) {
  if (viewInputPose.boneCount !== runtime.rig.boneCount) {
    throw new Error(
      'AB_Als_View input pose bone-count mismatch: '
      + `${viewInputPose.boneCount} !== ${runtime.rig.boneCount}`,
    )
  }
  if (outputPose.boneCount !== runtime.rig.boneCount) {
    throw new Error(
      'AB_Als_View output pose bone-count mismatch: '
      + `${outputPose.boneCount} !== ${runtime.rig.boneCount}`,
    )
  }
}

export function evaluateAlsViewPoseRuntime(
  runtime: AlsViewPoseRuntime,
  viewInputPose: LocalPoseBuffer,
  lookAmount: number,
  outputPose: LocalPoseBuffer,
): LocalPoseBuffer {
  assertAlsViewPoseBoneCounts(runtime, viewInputPose, outputPose)
  if (!isAlsViewPoseRelevant(lookAmount)) {
    return copyPose(viewInputPose, outputPose)
  }

  evaluateAlsViewStatePoses(runtime)
  evaluateAlsViewGraphPoseNode(
    runtime,
    runtime.graph.poseNode,
    runtime.sourcePose,
    0,
  )
  makeDynamicAdditivePose(
    runtime.sourcePose,
    runtime.standReferencePose,
    runtime.rig,
    runtime.additivePose,
    'mesh',
    runtime.meshSpaceScratch,
  )
  copyPose(viewInputPose, runtime.viewInputPose)
  copyPose(runtime.viewInputPose, runtime.viewOutputPose)
  applyMeshSpaceAdditivePose(
    runtime.viewOutputPose,
    runtime.additivePose,
    runtime.rig,
    1,
    runtime.meshSpaceScratch,
  )
  copyPose(runtime.viewInputPose, runtime.rootOutputPose)
  blendPoseInPlace(
    runtime.rootOutputPose,
    runtime.viewOutputPose,
    lookAmount,
  )
  return copyPose(runtime.rootOutputPose, outputPose)
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
