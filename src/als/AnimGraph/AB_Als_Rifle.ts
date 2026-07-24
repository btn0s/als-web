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
  blendTwoPoseNodesTogether,
  type MutableUePoseNode,
  type UePoseNode,
} from '../../engine/uePoseBlend'
import { resetPoseToReference } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

/**
 * VERIFIED from AB_Als_Rifle.uasset compiled nodes 27-48 in
 * scripts/extract-als/abp-graph.json. Node 34's A_Als_Idle local additive is
 * intentionally only identified here; the pose evaluator applies it after
 * this module's node 32 output.
 */
export const ALS_RIFLE_RELAXED_GRAPH = {
  stateName: 'Relaxed',
  stateResultNodeIndex: 48,
  moduleOutputNodeIndex: 32,
  evaluatorOwnedApplyAdditiveNodeIndex: 34,
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
 * 30 -> 32 exactly. Node 34's A_Als_Idle additive remains evaluator-owned.
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
