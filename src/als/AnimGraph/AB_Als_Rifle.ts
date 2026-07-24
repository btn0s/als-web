import animationInstanceSettingsSource
  from '../../../scripts/extract-als/animation-settings.json?raw'
import {
  createInputScaleBiasClampState,
  mapRangeUnclamped,
  refreshInputScaleBiasClampState,
  resetInputScaleBiasClampState,
  type InputScaleBiasClampState,
} from '../../engine/inputScaleBiasClamp'
import {
  createMutableUePoseNode,
  sampleSequencePoseNode,
  type UeSequencePoseSource,
} from '../../engine/uePoseGraph'
import {
  blendPoseNodesTogether,
  blendTwoCurvesTogether,
  blendTwoPoseNodesTogether,
  type MutableUePoseNode,
  type UePoseNode,
} from '../../engine/uePoseBlend'
import {
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  createMeshSpaceBlendScratch,
  makeDynamicAdditivePose,
} from '../../engine/blend'
import {
  advanceStateMachineTransitionStack,
  createStateMachineTransitionStack,
  getStateMachineStateWeight,
  resetStateMachineTransitionStack,
  startStateMachineStandardTransition,
  type StateMachineStandardTransition,
  type StateMachineTransitionStack,
} from '../../engine/stateMachineTransitionStack'
import type {
  CompiledWeightBlendProfile,
} from '../../engine/blendProfile'
import {
  copyPose,
  resetPoseToReference,
} from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import {
  sampleRichCurve,
  type RichCurveInterpolation,
  type RichCurveKey,
} from '../../engine/richCurve'
import type { RigDefinition } from '../../engine/rig'

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

/**
 * VERIFIED from AB_Als_Rifle.uasset compiled nodes 27-48 in
 * scripts/extract-als/abp-graph.json. The reusable Relaxed subgraph returns
 * node 32; the full Rifle runtime applies node 34's A_Als_Idle additive at
 * the state boundary.
 */
export const ALS_RIFLE_RELAXED_GRAPH = {
  stateName: 'Relaxed',
  stateResultNodeIndex: 48,
  moduleOutputNodeIndex: 32,
  applyAdditiveNodeIndex: 34,
  idleAdditiveAlpha: 0.75,
  nodes: {
    node27: {
      type: 'MultiWayBlend',
      inputs: [47, 44],
      alphas: ['StandingAmount', 'CrouchingAmount'],
      normalizeAlpha: true,
    },
    node28: {
      type: 'MultiWayBlend',
      inputs: [39, 42, 36, 35],
      alphas: [
        'VelocityBlendForwardAmount',
        'VelocityBlendBackwardAmount',
        'VelocityBlendLeftAmount',
        'VelocityBlendRightAmount',
      ],
      normalizeAlpha: true,
    },
    node30: {
      type: 'TwoWayBlend',
      inputs: [31, 29],
      alpha: 'GroundPredictionAmount',
      interpolationSpeedIncreasing: 20,
      interpolationSpeedDecreasing: 5,
    },
    node32: {
      type: 'TwoWayBlend',
      inputs: [27, 30],
      alpha: 'InAirAmount',
      interpolationSpeedIncreasing: 0,
      interpolationSpeedDecreasing: 10,
    },
    node40: {
      type: 'TwoWayBlend',
      inputs: [28, 41],
      alpha: 'GaitSprintingAmount',
      interpolationSpeedIncreasing: 0,
      interpolationSpeedDecreasing: 5,
    },
    node41: {
      type: 'TwoWayBlend',
      inputs: [38, 37],
      alpha: 'SprintAccelerationAmount',
      mapRange: {
        inputMinimum: 0,
        inputMaximum: 0.25,
        outputMinimum: 0,
        outputMaximum: 1,
      },
      interpolationSpeedIncreasing: 20,
      interpolationSpeedDecreasing: 0.5,
      resetChildOnActivation: true,
    },
    node43: {
      type: 'TwoWayBlend',
      inputs: [45, 40],
      alpha: 'GaitRunningAmount',
      interpolationSpeedIncreasing: 0,
      interpolationSpeedDecreasing: 5,
    },
    node47: {
      type: 'TwoWayBlend',
      inputs: [46, 43],
      alpha: 'GaitWalkingAmount',
      interpolateResult: false,
    },
  },
  sequenceEvaluators: {
    node29: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.35 },
    node31: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.316667 },
    node35: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.05 },
    node36: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.05 },
    node42: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.05 },
    node44: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.216667 },
    node45: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0.05 },
    node46: { sequence: 'A_Als_Rifle_Poses', explicitTime: 0 },
  },
  sequencePlayers: {
    node37: {
      sequence: 'A_Als_Rifle_Sprint_Impulse_Arms',
      groupName: 'Movement',
      groupRole: 'AlwaysFollower',
      playRate: 0,
    },
    node38: {
      sequence: 'A_Als_Rifle_Sprint_Arms',
      groupName: 'Movement',
      groupRole: 'AlwaysFollower',
      playRate: 0,
    },
    node39: {
      sequence: 'A_Als_Rifle_Run_Arms',
      groupName: 'Movement',
      groupRole: 'AlwaysFollower',
      playRate: 0,
    },
  },
} as const

export interface AlsRifleSequencePlayerSource
  extends UeSequencePoseSource {
  readonly time: number
  readonly loop: boolean
}

export interface AlsRifleRelaxedSources {
  readonly poses: UeSequencePoseSource
  readonly runArms: AlsRifleSequencePlayerSource
  readonly sprintArms: AlsRifleSequencePlayerSource
  readonly sprintImpulseArms: AlsRifleSequencePlayerSource
}

export interface AlsRifleRelaxedVelocityBlend {
  readonly forwardAmount: number
  readonly backwardAmount: number
  readonly leftAmount: number
  readonly rightAmount: number
}

export interface AlsRifleRelaxedStateInput {
  readonly relevant: boolean
  readonly deltaTime: number
  readonly standingAmount: number
  readonly crouchingAmount: number
  readonly gaitWalkingAmount: number
  readonly gaitRunningAmount: number
  readonly gaitSprintingAmount: number
  readonly inAirAmount: number
  readonly groundPredictionAmount: number
  readonly sprintAccelerationAmount: number
  readonly velocityBlend: AlsRifleRelaxedVelocityBlend
}

export interface AlsRifleNode41ResetChildOnActivation {
  sprintArms: boolean
  sprintImpulseArms: boolean
}

export interface AlsRifleRelaxedSampleState {
  relevant: boolean
  standingAmount: number
  crouchingAmount: number
  gaitWalkingAmount: number
  gaitRunningAmount: number
  gaitSprintingAmount: number
  inAirAmount: number
  groundPredictionAmount: number
  mappedSprintAccelerationAmount: number
  sprintAccelerationAmount: number
  readonly stanceWeights: Float32Array
  readonly velocityBlendWeights: Float32Array
  node30Relevant: boolean
  node43Relevant: boolean
  node40Relevant: boolean
  node41Relevant: boolean
  node41SprintArmsRelevant: boolean
  node41SprintImpulseArmsRelevant: boolean
  readonly node41ResetChildOnActivation:
    AlsRifleNode41ResetChildOnActivation
}

export interface AlsRifleRelaxedRuntimeNodes {
  readonly node27: MutableUePoseNode
  readonly node28: MutableUePoseNode
  readonly node29: MutableUePoseNode
  readonly node30: MutableUePoseNode
  readonly node31: MutableUePoseNode
  readonly node32: MutableUePoseNode
  readonly node35: MutableUePoseNode
  readonly node36: MutableUePoseNode
  readonly node37: MutableUePoseNode
  readonly node38: MutableUePoseNode
  readonly node39: MutableUePoseNode
  readonly node40: MutableUePoseNode
  readonly node41: MutableUePoseNode
  readonly node42: MutableUePoseNode
  readonly node43: MutableUePoseNode
  readonly node44: MutableUePoseNode
  readonly node45: MutableUePoseNode
  readonly node46: MutableUePoseNode
  readonly node47: MutableUePoseNode
}

interface AlsRifleRelaxedFilters {
  readonly node30: InputScaleBiasClampState
  readonly node32: InputScaleBiasClampState
  readonly node40: InputScaleBiasClampState
  readonly node41: InputScaleBiasClampState
  readonly node43: InputScaleBiasClampState
}

interface AlsRifleRelaxedBlendInputs {
  readonly node27: readonly [UePoseNode, UePoseNode]
  readonly node28: readonly [
    UePoseNode,
    UePoseNode,
    UePoseNode,
    UePoseNode,
  ]
}

export interface AlsRifleRelaxedEvaluation {
  readonly pose: LocalPoseBuffer
  readonly curves: Map<string, number>
  readonly state: AlsRifleRelaxedSampleState
}

export interface AlsRifleRelaxedRuntime {
  readonly rig: RigDefinition
  readonly nodes: AlsRifleRelaxedRuntimeNodes
  readonly state: AlsRifleRelaxedSampleState
  readonly output: AlsRifleRelaxedEvaluation
  readonly filters: AlsRifleRelaxedFilters
  readonly blendInputs: AlsRifleRelaxedBlendInputs
  node41SprintArmsWasRelevant: boolean
  node41SprintImpulseArmsWasRelevant: boolean
}

function createNodes(boneCount: number): AlsRifleRelaxedRuntimeNodes {
  return {
    node27: createMutableUePoseNode(boneCount),
    node28: createMutableUePoseNode(boneCount),
    node29: createMutableUePoseNode(boneCount),
    node30: createMutableUePoseNode(boneCount),
    node31: createMutableUePoseNode(boneCount),
    node32: createMutableUePoseNode(boneCount),
    node35: createMutableUePoseNode(boneCount),
    node36: createMutableUePoseNode(boneCount),
    node37: createMutableUePoseNode(boneCount),
    node38: createMutableUePoseNode(boneCount),
    node39: createMutableUePoseNode(boneCount),
    node40: createMutableUePoseNode(boneCount),
    node41: createMutableUePoseNode(boneCount),
    node42: createMutableUePoseNode(boneCount),
    node43: createMutableUePoseNode(boneCount),
    node44: createMutableUePoseNode(boneCount),
    node45: createMutableUePoseNode(boneCount),
    node46: createMutableUePoseNode(boneCount),
    node47: createMutableUePoseNode(boneCount),
  }
}

function createSampleState(): AlsRifleRelaxedSampleState {
  return {
    relevant: false,
    standingAmount: 0,
    crouchingAmount: 0,
    gaitWalkingAmount: 0,
    gaitRunningAmount: 0,
    gaitSprintingAmount: 0,
    inAirAmount: 0,
    groundPredictionAmount: 0,
    mappedSprintAccelerationAmount: 0,
    sprintAccelerationAmount: 0,
    stanceWeights: new Float32Array(2),
    velocityBlendWeights: new Float32Array(4),
    node30Relevant: false,
    node43Relevant: false,
    node40Relevant: false,
    node41Relevant: false,
    node41SprintArmsRelevant: false,
    node41SprintImpulseArmsRelevant: false,
    node41ResetChildOnActivation: {
      sprintArms: false,
      sprintImpulseArms: false,
    },
  }
}

export function createAlsRifleRelaxedRuntime(
  rig: RigDefinition,
): AlsRifleRelaxedRuntime {
  const nodes = createNodes(rig.boneCount)
  const state = createSampleState()
  return {
    rig,
    nodes,
    state,
    output: {
      pose: nodes.node32.pose,
      curves: nodes.node32.curves,
      state,
    },
    filters: {
      node30: createInputScaleBiasClampState(),
      node32: createInputScaleBiasClampState(),
      node40: createInputScaleBiasClampState(),
      node41: createInputScaleBiasClampState(),
      node43: createInputScaleBiasClampState(),
    },
    blendInputs: {
      node27: [nodes.node47, nodes.node44],
      node28: [
        nodes.node39,
        nodes.node42,
        nodes.node36,
        nodes.node35,
      ],
    },
    node41SprintArmsWasRelevant: false,
    node41SprintImpulseArmsWasRelevant: false,
  }
}

function clearSampleState(state: AlsRifleRelaxedSampleState) {
  state.relevant = false
  state.standingAmount = 0
  state.crouchingAmount = 0
  state.gaitWalkingAmount = 0
  state.gaitRunningAmount = 0
  state.gaitSprintingAmount = 0
  state.inAirAmount = 0
  state.groundPredictionAmount = 0
  state.mappedSprintAccelerationAmount = 0
  state.sprintAccelerationAmount = 0
  state.stanceWeights.fill(0)
  state.velocityBlendWeights.fill(0)
  state.node30Relevant = false
  state.node43Relevant = false
  state.node40Relevant = false
  state.node41Relevant = false
  state.node41SprintArmsRelevant = false
  state.node41SprintImpulseArmsRelevant = false
  state.node41ResetChildOnActivation.sprintArms = false
  state.node41ResetChildOnActivation.sprintImpulseArms = false
}

export function resetAlsRifleRelaxedRuntime(
  runtime: AlsRifleRelaxedRuntime,
) {
  clearSampleState(runtime.state)
  resetInputScaleBiasClampState(runtime.filters.node30)
  resetInputScaleBiasClampState(runtime.filters.node32)
  resetInputScaleBiasClampState(runtime.filters.node40)
  resetInputScaleBiasClampState(runtime.filters.node41)
  resetInputScaleBiasClampState(runtime.filters.node43)
  runtime.node41SprintArmsWasRelevant = false
  runtime.node41SprintImpulseArmsWasRelevant = false
  return runtime
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function isRelevant(weight: number) {
  return weight > ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function normalizeTwoAlphas(
  first: number,
  second: number,
  out: Float32Array,
) {
  out[0] = clamp01(first)
  out[1] = clamp01(second)
  const total = out[0] + out[1]
  if (total <= ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    out.fill(0)
    return out
  }
  const inverseTotal = 1 / total
  out[0] *= inverseTotal
  out[1] *= inverseTotal
  return out
}

function normalizeFourAlphas(
  first: number,
  second: number,
  third: number,
  fourth: number,
  out: Float32Array,
) {
  out[0] = clamp01(first)
  out[1] = clamp01(second)
  out[2] = clamp01(third)
  out[3] = clamp01(fourth)
  let total = 0
  for (const alpha of out) total += alpha
  if (total <= ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    out.fill(0)
    return out
  }
  const inverseTotal = 1 / total
  for (let index = 0; index < out.length; index++) {
    out[index] *= inverseTotal
  }
  return out
}

function refreshNode41ChildActivation(
  runtime: AlsRifleRelaxedRuntime,
  nodeRelevant: boolean,
) {
  const state = runtime.state
  state.node41ResetChildOnActivation.sprintArms = false
  state.node41ResetChildOnActivation.sprintImpulseArms = false
  state.node41SprintArmsRelevant = false
  state.node41SprintImpulseArmsRelevant = false
  if (!nodeRelevant) return

  const alpha = clamp01(state.sprintAccelerationAmount)
  const sprintArmsRelevant = isRelevant(1 - alpha)
  const sprintImpulseArmsRelevant = isRelevant(alpha)
  state.node41SprintArmsRelevant = sprintArmsRelevant
  state.node41SprintImpulseArmsRelevant = sprintImpulseArmsRelevant
  state.node41ResetChildOnActivation.sprintArms =
    sprintArmsRelevant && !runtime.node41SprintArmsWasRelevant
  state.node41ResetChildOnActivation.sprintImpulseArms =
    sprintImpulseArmsRelevant
    && !runtime.node41SprintImpulseArmsWasRelevant
  runtime.node41SprintArmsWasRelevant = sprintArmsRelevant
  runtime.node41SprintImpulseArmsWasRelevant =
    sprintImpulseArmsRelevant
}

/**
 * Updates AB_Als_Rifle's retained alpha-node state in graph-relevance order.
 * Raw Walking and stance amounts have no filter; every other filter below is
 * serialized on the corresponding Relaxed graph node.
 */
export function refreshAlsRifleRelaxedState(
  runtime: AlsRifleRelaxedRuntime,
  input: Readonly<AlsRifleRelaxedStateInput>,
): AlsRifleRelaxedSampleState {
  const state = runtime.state
  state.relevant = input.relevant
  state.standingAmount = input.standingAmount
  state.crouchingAmount = input.crouchingAmount
  state.gaitWalkingAmount = input.gaitWalkingAmount
  normalizeTwoAlphas(
    input.standingAmount,
    input.crouchingAmount,
    state.stanceWeights,
  )
  normalizeFourAlphas(
    input.velocityBlend.forwardAmount,
    input.velocityBlend.backwardAmount,
    input.velocityBlend.leftAmount,
    input.velocityBlend.rightAmount,
    state.velocityBlendWeights,
  )
  state.node41ResetChildOnActivation.sprintArms = false
  state.node41ResetChildOnActivation.sprintImpulseArms = false
  state.node30Relevant = false
  state.node43Relevant = false
  state.node40Relevant = false
  state.node41Relevant = false
  state.node41SprintArmsRelevant = false
  state.node41SprintImpulseArmsRelevant = false
  if (!input.relevant) return state

  state.inAirAmount = refreshInputScaleBiasClampState(
    runtime.filters.node32,
    input.inAirAmount,
    input.deltaTime,
    0,
    10,
  )
  const inAirAlpha = clamp01(state.inAirAmount)
  const groundedRelevant = isRelevant(1 - inAirAlpha)
  state.node30Relevant = isRelevant(inAirAlpha)

  if (state.node30Relevant) {
    state.groundPredictionAmount = refreshInputScaleBiasClampState(
      runtime.filters.node30,
      input.groundPredictionAmount,
      input.deltaTime,
      20,
      5,
    )
  }

  const standingRelevant =
    groundedRelevant && isRelevant(state.stanceWeights[0])
  state.node43Relevant =
    standingRelevant && isRelevant(clamp01(input.gaitWalkingAmount))
  if (state.node43Relevant) {
    state.gaitRunningAmount = refreshInputScaleBiasClampState(
      runtime.filters.node43,
      input.gaitRunningAmount,
      input.deltaTime,
      0,
      5,
    )
    state.node40Relevant = isRelevant(
      clamp01(state.gaitRunningAmount),
    )
  }

  if (state.node40Relevant) {
    state.gaitSprintingAmount = refreshInputScaleBiasClampState(
      runtime.filters.node40,
      input.gaitSprintingAmount,
      input.deltaTime,
      0,
      5,
    )
    state.node41Relevant = isRelevant(
      clamp01(state.gaitSprintingAmount),
    )
  }

  if (state.node41Relevant) {
    state.mappedSprintAccelerationAmount = mapRangeUnclamped(
      input.sprintAccelerationAmount,
      0,
      0.25,
      0,
      1,
    )
    state.sprintAccelerationAmount =
      refreshInputScaleBiasClampState(
        runtime.filters.node41,
        state.mappedSprintAccelerationAmount,
        input.deltaTime,
        20,
        0.5,
      )
  }
  refreshNode41ChildActivation(runtime, state.node41Relevant)
  return state
}

function blendNormalizedMultiWay(
  rig: RigDefinition,
  sources: readonly UePoseNode[],
  weights: Float32Array,
  out: MutableUePoseNode,
) {
  let total = 0
  for (const weight of weights) total += weight
  if (total <= ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    resetPoseToReference(out.pose, rig)
    out.curves.clear()
    return out
  }
  return blendPoseNodesTogether(sources, weights, out)
}

/**
 * Evaluates Relaxed nodes 28 -> 41 -> 40 -> 43 -> 47 -> 27 and
 * 30 -> 32 exactly. The full state machine evaluates node 34 afterward.
 */
export function evaluateAlsRifleRelaxedGraph(
  runtime: AlsRifleRelaxedRuntime,
  sources: Readonly<AlsRifleRelaxedSources>,
): AlsRifleRelaxedEvaluation {
  const { nodes, state, rig } = runtime

  sampleSequencePoseNode(rig, sources.poses, 0, false, nodes.node46)
  sampleSequencePoseNode(rig, sources.poses, 0.05, false, nodes.node45)
  sampleSequencePoseNode(rig, sources.runArms, sources.runArms.time,
    sources.runArms.loop, nodes.node39)
  sampleSequencePoseNode(rig, sources.poses, 0.05, false, nodes.node42)
  sampleSequencePoseNode(rig, sources.poses, 0.05, false, nodes.node36)
  sampleSequencePoseNode(rig, sources.poses, 0.05, false, nodes.node35)
  sampleSequencePoseNode(rig, sources.sprintArms,
    sources.sprintArms.time, sources.sprintArms.loop, nodes.node38)
  sampleSequencePoseNode(rig, sources.sprintImpulseArms,
    sources.sprintImpulseArms.time, sources.sprintImpulseArms.loop,
    nodes.node37)
  sampleSequencePoseNode(
    rig,
    sources.poses,
    0.216667,
    false,
    nodes.node44,
  )
  sampleSequencePoseNode(
    rig,
    sources.poses,
    0.316667,
    false,
    nodes.node31,
  )
  sampleSequencePoseNode(
    rig,
    sources.poses,
    0.35,
    false,
    nodes.node29,
  )

  blendNormalizedMultiWay(
    rig,
    runtime.blendInputs.node28,
    state.velocityBlendWeights,
    nodes.node28,
  )
  blendTwoPoseNodesTogether(
    nodes.node38,
    nodes.node37,
    1 - clamp01(state.sprintAccelerationAmount),
    nodes.node41,
  )
  blendTwoPoseNodesTogether(
    nodes.node28,
    nodes.node41,
    1 - clamp01(state.gaitSprintingAmount),
    nodes.node40,
  )
  blendTwoPoseNodesTogether(
    nodes.node45,
    nodes.node40,
    1 - clamp01(state.gaitRunningAmount),
    nodes.node43,
  )
  blendTwoPoseNodesTogether(
    nodes.node46,
    nodes.node43,
    1 - clamp01(state.gaitWalkingAmount),
    nodes.node47,
  )
  blendNormalizedMultiWay(
    rig,
    runtime.blendInputs.node27,
    state.stanceWeights,
    nodes.node27,
  )
  blendTwoPoseNodesTogether(
    nodes.node31,
    nodes.node29,
    1 - clamp01(state.groundPredictionAmount),
    nodes.node30,
  )
  blendTwoPoseNodesTogether(
    nodes.node27,
    nodes.node30,
    1 - clamp01(state.inAirAmount),
    nodes.node32,
  )
  return runtime.output
}

/** Complete compiled Rifle States machine plus the outer GameplayTagsBlend. */
export const ALS_RIFLE_GRAPH = {
  rifleStates: {
    stateMachineNodeIndex: 49,
    initialState: 'Relaxed',
    maxTransitionsPerFrame: 3,
    skipFirstUpdateTransition: true,
    reinitializeOnBecomingRelevant: true,
    transitions: [
      {
        index: 0,
        from: 'Relaxed',
        to: 'Ready',
        duration: 0.2,
        blend: 'HermiteCubic',
        notify: 'RelaxedToReady',
      },
      {
        index: 1,
        from: 'Aiming',
        to: 'Ready',
        duration: 1,
        blend: 'Custom',
        customCurve: 'CF_Als_Aim_Out',
      },
      {
        index: 2,
        from: 'Ready',
        to: 'Relaxed',
        duration: 0.75,
        blend: 'Cubic',
        profile: 'QuickFeetBlend',
        notify: 'ReadyToRelaxed',
      },
      {
        index: 3,
        from: 'Ready',
        to: 'Relaxed',
        duration: 0.75,
        blend: 'Cubic',
      },
      {
        index: 4,
        from: 'Ready',
        to: 'Aiming',
        duration: 0.2,
        blend: 'Custom',
        customCurve: 'CF_Als_Aim_In',
      },
      {
        index: 5,
        from: 'Ready',
        to: 'Relaxed',
        duration: 0.2,
        blend: 'HermiteCubic',
        priority: 2,
      },
    ],
  },
  ready: {
    stateResultNodeIndex: 14,
    outputNodeIndex: 9,
    standingTimes: [0.083333, 0.116667],
    crouchingTime: 0.25,
    idleAdditiveAlpha: 0.75,
  },
  aiming: {
    stateResultNodeIndex: 26,
    outputNodeIndex: 17,
    standingTimes: [0.15, 0.183333],
    crouchingTime: 0.283333,
    standingAimReferenceFrame: 5,
    crouchingAimReferenceFrame: 9,
    referenceFrameRate: 30,
    // The serialized evaluators retain their zero defaults, but the compiled
    // property-access paths bind both ExplicitTime pins to
    // GetParent.ViewState.PitchAmount. These clips are one-second aim sweeps.
    aimExplicitTime: 'PitchAmount',
    idleAdditiveAlpha: 0.5,
    meshAdditiveAlpha: 1,
  },
  gameplayTagsBlend: {
    nodeIndex: 53,
    defaultChild: 'Rifle States',
    acceptedActions: ['Mantling', 'GettingUp', 'Rolling'],
    blendTimes: [0.3, 0.3, 0, 0.3],
    blend: 'Linear',
    resetChildOnActivation: false,
    overrides: {
      Mantling: {
        nodeIndex: 50,
        posesTime: 0.383333,
      },
      GettingUp: {
        nodeIndex: 55,
        posesTime: 0.25,
        curves: { LayerArmRight: 3 },
      },
      Rolling: {
        nodeIndex: 54,
        posesTime: 0.316667,
        curves: {
          LayerArmLeft: 3,
          LayerArmLeftAdditive: 0,
          LayerArmRight: 3,
          LayerArmRightAdditive: 0,
        },
      },
    },
  },
} as const

export type AlsRifleState = 'Relaxed' | 'Ready' | 'Aiming'
export type AlsRifleAction =
  | 'Mantling'
  | 'GettingUp'
  | 'Rolling'
  | 'Ragdolling'
  | null
type AlsRifleGameplayTagsBlendChild = 0 | 1 | 2 | 3

interface SerializedRichCurveKey {
  readonly InterpMode: string
  readonly TangentWeightMode: string
  readonly Time: number
  readonly Value: number
  readonly ArriveTangent: number
  readonly LeaveTangent: number
}

interface SerializedAnimationInstanceCurves {
  readonly curves: Readonly<Record<string, {
    readonly channels: Readonly<Record<string, {
      readonly sourceIndex: number
      readonly keys: readonly SerializedRichCurveKey[]
    }>>
  }>>
}

const animationInstanceCurves = JSON.parse(
  animationInstanceSettingsSource,
) as SerializedAnimationInstanceCurves

function compileInterpolation(
  interpolation: string,
): RichCurveInterpolation {
  switch (interpolation) {
    case 'RCIM_Constant':
      return 'constant'
    case 'RCIM_Linear':
      return 'linear'
    case 'RCIM_Cubic':
      return 'cubic'
    default:
      throw new Error(
        `Unsupported AB_Als_Rifle curve interpolation ${interpolation}`,
      )
  }
}

function compileTransitionCurve(
  curveName: 'CF_Als_Aim_In' | 'CF_Als_Aim_Out',
): readonly RichCurveKey[] {
  const channel = animationInstanceCurves.curves[curveName]
    ?.channels.BlendAmount
  if (!channel || channel.sourceIndex !== 0) {
    throw new Error(`Missing authored ${curveName}.BlendAmount curve`)
  }
  return channel.keys.map((key) => {
    if (key.TangentWeightMode !== 'RCTWM_WeightedNone') {
      throw new Error(`Unsupported weighted ${curveName} curve`)
    }
    return {
      time: key.Time,
      value: key.Value,
      interpolation: compileInterpolation(key.InterpMode),
      arriveTangent: key.ArriveTangent,
      leaveTangent: key.LeaveTangent,
    }
  })
}

export const ALS_RIFLE_TRANSITION_CURVES = {
  CF_Als_Aim_In: compileTransitionCurve('CF_Als_Aim_In'),
  CF_Als_Aim_Out: compileTransitionCurve('CF_Als_Aim_Out'),
} as const

export function sampleCF_Als_Aim_In(normalizedTime: number) {
  return sampleRichCurve(
    ALS_RIFLE_TRANSITION_CURVES.CF_Als_Aim_In,
    normalizedTime,
  )
}

export function sampleCF_Als_Aim_Out(normalizedTime: number) {
  return sampleRichCurve(
    ALS_RIFLE_TRANSITION_CURVES.CF_Als_Aim_Out,
    normalizedTime,
  )
}

export interface AlsRifleFullSources extends AlsRifleRelaxedSources {
  readonly idle: AlsRifleSequencePlayerSource
  readonly idleReference: UeSequencePoseSource
  readonly aim: UeSequencePoseSource
  readonly aimCrouch: UeSequencePoseSource
  readonly aimReference: UeSequencePoseSource
}

export interface AlsRifleFullInput extends AlsRifleRelaxedStateInput {
  readonly rotationMode:
    | 'Aiming'
    | 'VelocityDirection'
    | 'ViewDirection'
  readonly locomotionMode: 'Grounded' | 'InAir' | null
  readonly gait: 'Walking' | 'Running' | 'Sprinting'
  readonly transitionsAllowed: boolean
  readonly moving: boolean
  readonly pitchAmount: number
  readonly locomotionAction?: AlsRifleAction
}

export interface AlsRifleLifecycleEvent {
  readonly kind: 'AnimNotify'
  readonly name: 'RelaxedToReady' | 'ReadyToRelaxed'
  readonly callSite: 'TransitionStart'
}

interface AlsRifleRuntimeNodes {
  readonly readyStandingLow: MutableUePoseNode
  readonly readyStandingHigh: MutableUePoseNode
  readonly readyStanding: MutableUePoseNode
  readonly readyCrouching: MutableUePoseNode
  readonly aimingStandingLow: MutableUePoseNode
  readonly aimingStandingHigh: MutableUePoseNode
  readonly aimingStandingBase: MutableUePoseNode
  readonly aimingStanding: MutableUePoseNode
  readonly aimingCrouchingBase: MutableUePoseNode
  readonly aimingCrouching: MutableUePoseNode
  readonly aimRaw: MutableUePoseNode
  readonly aimReference: MutableUePoseNode
  readonly aimAdditive: MutableUePoseNode
  readonly idleRaw: MutableUePoseNode
  readonly idleReference: MutableUePoseNode
  readonly idleAdditive: MutableUePoseNode
  readonly rifleStates: MutableUePoseNode
  readonly rifleTransitionScratchA: MutableUePoseNode
  readonly rifleTransitionScratchB: MutableUePoseNode
  readonly mantling: MutableUePoseNode
  readonly gettingUp: MutableUePoseNode
  readonly rolling: MutableUePoseNode
  readonly actionTransitionScratchA: MutableUePoseNode
  readonly actionTransitionScratchB: MutableUePoseNode
  readonly output: MutableUePoseNode
}

export interface AlsRifleEvaluation {
  readonly pose: LocalPoseBuffer
  readonly curves: Map<string, number>
  state: AlsRifleState
  actionChild: AlsRifleGameplayTagsBlendChild
  readonly lifecycleEvents: readonly AlsRifleLifecycleEvent[]
}

export interface AlsRifleFullRuntime {
  readonly rig: RigDefinition
  readonly relaxed: AlsRifleRelaxedRuntime
  readonly rifleStates: StateMachineTransitionStack<AlsRifleState>
  readonly gameplayTagsBlend:
    StateMachineTransitionStack<AlsRifleGameplayTagsBlendChild>
  readonly statePoses: Record<AlsRifleState, MutableUePoseNode>
  readonly actionPoses: readonly [
    MutableUePoseNode,
    MutableUePoseNode,
    MutableUePoseNode,
    MutableUePoseNode,
  ]
  readonly nodes: AlsRifleRuntimeNodes
  readonly meshScratch: ReturnType<typeof createMeshSpaceBlendScratch>
  readonly lifecycleEvents: AlsRifleLifecycleEvent[]
  readonly quickFeetBlendProfile: CompiledWeightBlendProfile | null
  readonly output: AlsRifleEvaluation
  graphRelevant: boolean
  rifleStatesRelevant: boolean
  firstRifleStatesUpdate: boolean
  stateElapsedTime: number
  transitionsTakenThisFrame: number
}

function createFullRuntimeNodes(boneCount: number): AlsRifleRuntimeNodes {
  const node = () => createMutableUePoseNode(boneCount)
  return {
    readyStandingLow: node(),
    readyStandingHigh: node(),
    readyStanding: node(),
    readyCrouching: node(),
    aimingStandingLow: node(),
    aimingStandingHigh: node(),
    aimingStandingBase: node(),
    aimingStanding: node(),
    aimingCrouchingBase: node(),
    aimingCrouching: node(),
    aimRaw: node(),
    aimReference: node(),
    aimAdditive: node(),
    idleRaw: node(),
    idleReference: node(),
    idleAdditive: node(),
    rifleStates: node(),
    rifleTransitionScratchA: node(),
    rifleTransitionScratchB: node(),
    mantling: node(),
    gettingUp: node(),
    rolling: node(),
    actionTransitionScratchA: node(),
    actionTransitionScratchB: node(),
    output: node(),
  }
}

function copyPoseNode(
  source: UePoseNode,
  output: MutableUePoseNode,
) {
  copyPose(source.pose, output.pose)
  output.curves.clear()
  for (const [name, value] of source.curves) {
    output.curves.set(name, value)
  }
  return output
}

export function createAlsRifleRuntime(
  rig: RigDefinition,
  quickFeetBlendProfile: CompiledWeightBlendProfile | null = null,
): AlsRifleFullRuntime {
  const nodes = createFullRuntimeNodes(rig.boneCount)
  const statePoses = {
    Relaxed: createMutableUePoseNode(rig.boneCount),
    Ready: createMutableUePoseNode(rig.boneCount),
    Aiming: createMutableUePoseNode(rig.boneCount),
  }
  const lifecycleEvents: AlsRifleLifecycleEvent[] = []
  const output: AlsRifleEvaluation = {
    pose: nodes.output.pose,
    curves: nodes.output.curves,
    state: 'Relaxed',
    actionChild: 0,
    lifecycleEvents,
  }
  return {
    rig,
    relaxed: createAlsRifleRelaxedRuntime(rig),
    rifleStates: createStateMachineTransitionStack(
      'Relaxed',
      rig.boneCount,
      ALS_RIFLE_GRAPH.rifleStates.maxTransitionsPerFrame,
    ),
    gameplayTagsBlend: createStateMachineTransitionStack(
      0 as AlsRifleGameplayTagsBlendChild,
      rig.boneCount,
      ALS_RIFLE_GRAPH.gameplayTagsBlend.blendTimes.length,
    ),
    statePoses,
    actionPoses: [
      nodes.rifleStates,
      nodes.mantling,
      nodes.gettingUp,
      nodes.rolling,
    ],
    nodes,
    meshScratch: createMeshSpaceBlendScratch(rig.boneCount),
    lifecycleEvents,
    quickFeetBlendProfile,
    output,
    graphRelevant: false,
    rifleStatesRelevant: false,
    firstRifleStatesUpdate: true,
    stateElapsedTime: 0,
    transitionsTakenThisFrame: 0,
  }
}

export function resetAlsRifleRuntime(runtime: AlsRifleFullRuntime) {
  resetAlsRifleRelaxedRuntime(runtime.relaxed)
  resetStateMachineTransitionStack(runtime.rifleStates, 'Relaxed')
  resetStateMachineTransitionStack(runtime.gameplayTagsBlend, 0)
  runtime.lifecycleEvents.length = 0
  runtime.graphRelevant = false
  runtime.rifleStatesRelevant = false
  runtime.firstRifleStatesUpdate = true
  runtime.stateElapsedTime = 0
  runtime.transitionsTakenThisFrame = 0
  runtime.output.state = 'Relaxed'
  runtime.output.actionChild = 0
  return runtime
}

function gameplayTagsBlendChild(
  action: AlsRifleAction | undefined,
): AlsRifleGameplayTagsBlendChild {
  switch (action) {
    case 'Mantling':
      return 1
    case 'GettingUp':
      return 2
    case 'Rolling':
      return 3
    default:
      return 0
  }
}

function refreshGameplayTagsBlend(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
) {
  if (!input.relevant) {
    runtime.graphRelevant = false
    return
  }
  if (!runtime.graphRelevant) {
    resetStateMachineTransitionStack(runtime.gameplayTagsBlend, 0)
    runtime.graphRelevant = true
  }

  const target = gameplayTagsBlendChild(input.locomotionAction)
  const from = runtime.gameplayTagsBlend.currentState
  if (target !== from) {
    startStateMachineStandardTransition(runtime.gameplayTagsBlend, {
      from,
      to: target,
      duration: ALS_RIFLE_GRAPH.gameplayTagsBlend.blendTimes[target],
      blendOption: ALS_RIFLE_GRAPH.gameplayTagsBlend.blend,
    })
  }
  advanceStateMachineTransitionStack(
    runtime.gameplayTagsBlend,
    Math.max(0, input.deltaTime),
  )
}

function nextRifleTransition(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
): 0 | 1 | 2 | 3 | 4 | 5 | null {
  switch (runtime.rifleStates.currentState) {
    case 'Relaxed':
      return input.rotationMode === 'Aiming' ? 0 : null
    case 'Aiming':
      return input.rotationMode !== 'Aiming' ? 1 : null
    case 'Ready':
      if (
        input.locomotionMode === 'InAir'
        || input.gait === 'Sprinting'
      ) {
        return 5
      }
      if (
        input.transitionsAllowed
        && runtime.stateElapsedTime >= 1.75
      ) {
        return 2
      }
      if (input.moving && runtime.stateElapsedTime >= 1.5) return 3
      return input.rotationMode === 'Aiming' ? 4 : null
  }
}

function takeRifleTransition(
  runtime: AlsRifleFullRuntime,
  transitionIndex: 0 | 1 | 2 | 3 | 4 | 5,
) {
  const transition =
    ALS_RIFLE_GRAPH.rifleStates.transitions[transitionIndex]
  startStateMachineStandardTransition(runtime.rifleStates, {
    from: transition.from,
    to: transition.to,
    duration: transition.duration,
    blendOption: transition.blend === 'Custom'
      ? 'Linear'
      : transition.blend,
    blendProfile: transitionIndex === 2
      ? runtime.quickFeetBlendProfile
      : null,
  })
  runtime.transitionsTakenThisFrame++
  runtime.stateElapsedTime = 0
  if ('notify' in transition) {
    runtime.lifecycleEvents.push({
      kind: 'AnimNotify',
      name: transition.notify,
      callSite: 'TransitionStart',
    })
  }
}

function refreshCustomTransitionAlphas(
  runtime: AlsRifleFullRuntime,
) {
  for (const transition of runtime.rifleStates.activeTransitions) {
    let blendAlpha: number | null = null
    if (
      transition.previousState === 'Aiming'
      && transition.nextState === 'Ready'
    ) {
      blendAlpha = sampleCF_Als_Aim_Out(transition.linearAlpha)
    } else if (
      transition.previousState === 'Ready'
      && transition.nextState === 'Aiming'
    ) {
      blendAlpha = sampleCF_Als_Aim_In(transition.linearAlpha)
    }
    if (blendAlpha === null) continue
    transition.alpha = clamp01(blendAlpha)
    transition.previousPoseMask.fill(1 - transition.alpha)
    transition.nextPoseMask.fill(transition.alpha)
  }
}

function refreshRifleStates(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
) {
  const rifleStatesRelevant = (
    input.relevant
    && getStateMachineStateWeight(runtime.gameplayTagsBlend, 0)
      > ZERO_ANIMATION_WEIGHT_THRESHOLD
  )
  if (!rifleStatesRelevant) {
    runtime.rifleStatesRelevant = false
    refreshAlsRifleRelaxedState(runtime.relaxed, {
      ...input,
      relevant: false,
    })
    return
  }

  if (!runtime.rifleStatesRelevant) {
    resetStateMachineTransitionStack(runtime.rifleStates, 'Relaxed')
    resetAlsRifleRelaxedRuntime(runtime.relaxed)
    runtime.rifleStatesRelevant = true
    runtime.firstRifleStatesUpdate = true
    runtime.stateElapsedTime = 0
  }

  if (!runtime.firstRifleStatesUpdate) {
    while (
      runtime.transitionsTakenThisFrame
        < ALS_RIFLE_GRAPH.rifleStates.maxTransitionsPerFrame
    ) {
      const transitionIndex = nextRifleTransition(runtime, input)
      if (transitionIndex === null) break
      takeRifleTransition(runtime, transitionIndex)
    }
  }
  runtime.firstRifleStatesUpdate = false

  const deltaTime = Math.max(0, input.deltaTime)
  advanceStateMachineTransitionStack(runtime.rifleStates, deltaTime)
  refreshCustomTransitionAlphas(runtime)
  runtime.stateElapsedTime += deltaTime

  const relaxedRelevant = (
    getStateMachineStateWeight(runtime.rifleStates, 'Relaxed')
      > ZERO_ANIMATION_WEIGHT_THRESHOLD
  )
  refreshAlsRifleRelaxedState(runtime.relaxed, {
    ...input,
    relevant: relaxedRelevant,
  })
}

export function refreshAlsRifleRuntime(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
) {
  runtime.lifecycleEvents.length = 0
  runtime.transitionsTakenThisFrame = 0
  refreshGameplayTagsBlend(runtime, input)
  refreshRifleStates(runtime, input)
  runtime.output.state = runtime.rifleStates.currentState
  runtime.output.actionChild = runtime.gameplayTagsBlend.currentState
  return runtime
}

function refreshIdleAdditive(
  runtime: AlsRifleFullRuntime,
  sources: AlsRifleFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.idle,
    sources.idle.time,
    sources.idle.loop,
    nodes.idleRaw,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.idleReference,
    0,
    false,
    nodes.idleReference,
  )
  makeDynamicAdditivePose(
    nodes.idleRaw.pose,
    nodes.idleReference.pose,
    runtime.rig,
    nodes.idleAdditive.pose,
    'local',
    runtime.meshScratch,
  )
}

function evaluateReadyState(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
  sources: AlsRifleFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.ready.standingTimes[0],
    false,
    nodes.readyStandingLow,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.ready.standingTimes[1],
    false,
    nodes.readyStandingHigh,
  )
  blendTwoPoseNodesTogether(
    nodes.readyStandingLow,
    nodes.readyStandingHigh,
    1 - clamp01(input.pitchAmount),
    nodes.readyStanding,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.ready.crouchingTime,
    false,
    nodes.readyCrouching,
  )
  blendNormalizedMultiWay(
    runtime.rig,
    [nodes.readyStanding, nodes.readyCrouching],
    runtime.relaxed.state.stanceWeights,
    runtime.statePoses.Ready,
  )
  applyAdditivePose(
    runtime.statePoses.Ready.pose,
    nodes.idleAdditive.pose,
    ALS_RIFLE_GRAPH.ready.idleAdditiveAlpha,
  )
}

function applyAimAdditive(
  runtime: AlsRifleFullRuntime,
  aimSource: UeSequencePoseSource,
  aimTime: number,
  referenceSource: UeSequencePoseSource,
  referenceTime: number,
  base: UePoseNode,
  output: MutableUePoseNode,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    aimSource,
    aimTime,
    false,
    nodes.aimRaw,
  )
  sampleSequencePoseNode(
    runtime.rig,
    referenceSource,
    referenceTime,
    false,
    nodes.aimReference,
  )
  makeDynamicAdditivePose(
    nodes.aimRaw.pose,
    nodes.aimReference.pose,
    runtime.rig,
    nodes.aimAdditive.pose,
    'mesh',
    runtime.meshScratch,
  )
  copyPoseNode(base, output)
  applyMeshSpaceAdditivePose(
    output.pose,
    nodes.aimAdditive.pose,
    runtime.rig,
    ALS_RIFLE_GRAPH.aiming.meshAdditiveAlpha,
    runtime.meshScratch,
  )
}

function evaluateAimingState(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
  sources: AlsRifleFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.aiming.standingTimes[0],
    false,
    nodes.aimingStandingLow,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.aiming.standingTimes[1],
    false,
    nodes.aimingStandingHigh,
  )
  blendTwoPoseNodesTogether(
    nodes.aimingStandingLow,
    nodes.aimingStandingHigh,
    1 - clamp01(input.pitchAmount),
    nodes.aimingStandingBase,
  )
  applyAimAdditive(
    runtime,
    sources.aim,
    input.pitchAmount,
    sources.aimReference,
    ALS_RIFLE_GRAPH.aiming.standingAimReferenceFrame
      / ALS_RIFLE_GRAPH.aiming.referenceFrameRate,
    nodes.aimingStandingBase,
    nodes.aimingStanding,
  )

  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.aiming.crouchingTime,
    false,
    nodes.aimingCrouchingBase,
  )
  applyAimAdditive(
    runtime,
    sources.aimCrouch,
    input.pitchAmount,
    sources.aimReference,
    ALS_RIFLE_GRAPH.aiming.crouchingAimReferenceFrame
      / ALS_RIFLE_GRAPH.aiming.referenceFrameRate,
    nodes.aimingCrouchingBase,
    nodes.aimingCrouching,
  )
  blendNormalizedMultiWay(
    runtime.rig,
    [nodes.aimingStanding, nodes.aimingCrouching],
    runtime.relaxed.state.stanceWeights,
    runtime.statePoses.Aiming,
  )
  applyAdditivePose(
    runtime.statePoses.Aiming.pose,
    nodes.idleAdditive.pose,
    ALS_RIFLE_GRAPH.aiming.idleAdditiveAlpha,
  )
}

function blendTransitionPoseNodes<State>(
  previous: UePoseNode,
  next: UePoseNode,
  transition: StateMachineStandardTransition<State>,
  output: MutableUePoseNode,
) {
  copyPose(previous.pose, output.pose)
  blendPoseInPlace(
    output.pose,
    next.pose,
    1,
    transition.nextPoseMask,
  )
  blendTwoCurvesTogether(
    previous.curves,
    next.curves,
    1 - transition.alpha,
    output.curves,
  )
}

function evaluateTransitionStack<State>(
  stack: StateMachineTransitionStack<State>,
  poseForState: (state: State) => UePoseNode,
  scratchA: MutableUePoseNode,
  scratchB: MutableUePoseNode,
  output: MutableUePoseNode,
) {
  const transitions = stack.activeTransitions
  if (transitions.length === 0) {
    copyPoseNode(poseForState(stack.currentState), output)
    return
  }

  let transitionOutput = scratchA
  const first = transitions[0]
  blendTransitionPoseNodes(
    poseForState(first.previousState),
    poseForState(first.nextState),
    first,
    transitionOutput,
  )
  for (let index = 1; index < transitions.length; index++) {
    const transition = transitions[index]
    const nextOutput = transitionOutput === scratchA
      ? scratchB
      : scratchA
    blendTransitionPoseNodes(
      transitionOutput,
      poseForState(transition.nextState),
      transition,
      nextOutput,
    )
    transitionOutput = nextOutput
  }
  copyPoseNode(transitionOutput, output)
}

function evaluateRifleStates(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
  sources: AlsRifleFullSources,
) {
  evaluateAlsRifleRelaxedGraph(runtime.relaxed, sources)
  copyPoseNode(
    runtime.relaxed.output,
    runtime.statePoses.Relaxed,
  )
  applyAdditivePose(
    runtime.statePoses.Relaxed.pose,
    runtime.nodes.idleAdditive.pose,
    ALS_RIFLE_RELAXED_GRAPH.idleAdditiveAlpha,
  )
  evaluateReadyState(runtime, input, sources)
  evaluateAimingState(runtime, input, sources)
  evaluateTransitionStack(
    runtime.rifleStates,
    (state) => runtime.statePoses[state],
    runtime.nodes.rifleTransitionScratchA,
    runtime.nodes.rifleTransitionScratchB,
    runtime.nodes.rifleStates,
  )
}

function evaluateActionPoses(
  runtime: AlsRifleFullRuntime,
  sources: AlsRifleFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.gameplayTagsBlend.overrides.Mantling.posesTime,
    false,
    nodes.mantling,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.gameplayTagsBlend.overrides.GettingUp.posesTime,
    false,
    nodes.gettingUp,
  )
  for (
    const [name, value]
    of Object.entries(
      ALS_RIFLE_GRAPH.gameplayTagsBlend.overrides.GettingUp.curves,
    )
  ) {
    nodes.gettingUp.curves.set(name, value)
  }
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    ALS_RIFLE_GRAPH.gameplayTagsBlend.overrides.Rolling.posesTime,
    false,
    nodes.rolling,
  )
  for (
    const [name, value]
    of Object.entries(
      ALS_RIFLE_GRAPH.gameplayTagsBlend.overrides.Rolling.curves,
    )
  ) {
    nodes.rolling.curves.set(name, value)
  }
}

/**
 * Evaluates each state's authored additives before the state-machine boundary,
 * then the outer GameplayTagsBlend.
 */
export function evaluateAlsRifleGraph(
  runtime: AlsRifleFullRuntime,
  input: AlsRifleFullInput,
  sources: AlsRifleFullSources,
): AlsRifleEvaluation {
  refreshIdleAdditive(runtime, sources)
  evaluateRifleStates(runtime, input, sources)
  evaluateActionPoses(runtime, sources)
  evaluateTransitionStack(
    runtime.gameplayTagsBlend,
    (child) => runtime.actionPoses[child],
    runtime.nodes.actionTransitionScratchA,
    runtime.nodes.actionTransitionScratchB,
    runtime.nodes.output,
  )
  return runtime.output
}
