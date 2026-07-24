import {
  createInputScaleBiasClampState,
  refreshInputScaleBiasClampState,
  resetInputScaleBiasClampState,
  type InputScaleBiasClampState,
} from '../../engine/inputScaleBiasClamp'
import { copyPose, type LocalPoseBuffer } from '../../engine/poseBuffer'
import {
  blendPoseNodesTogether,
  blendTwoPoseNodesTogether,
  type MutableUePoseNode,
} from '../../engine/uePoseBlend'
import {
  createMutableUePoseNode,
  sampleSequencePoseNode,
  type UeSequencePoseSource,
} from '../../engine/uePoseGraph'
import type { RigDefinition } from '../../engine/rig'

/**
 * AB_Als_Default's Overlay graph, recovered from its compiled pose links and tagged node data.
 *
 * ApplyAdditive node 1 (`A_Als_Idle`, alpha 0.75) is evaluated by the shared owned evaluator after
 * this base graph. The indices below are the linked layer's compiled node indices.
 */
export const AB_ALS_DEFAULT_OVERLAY_GRAPH = {
  applyIdleAdditive: {
    nodeIndex: 1,
    clip: 'A_Als_Idle',
    alpha: 0.75,
    syncGroup: 'Secondary Motion',
  },
  standingMoving: {
    nodeIndex: 2,
    alphaBinding: 'PoseState.GaitWalkingAmount',
    evaluators: [
      { nodeIndex: 5, explicitTime: 0 },
      { nodeIndex: 6, explicitTime: 0.05 },
    ],
  },
  groundedInAir: {
    nodeIndex: 3,
    alphaBinding: 'PoseState.InAirAmount',
  },
  groundPrediction: {
    nodeIndex: 4,
    alphaBinding: 'InAirState.GroundPredictionAmount',
    interpolationSpeedIncreasing: 20,
    interpolationSpeedDecreasing: 5,
    evaluators: [
      { nodeIndex: 8, explicitTime: 0.05 },
      { nodeIndex: 9, explicitTime: 0 },
    ],
  },
  crouching: {
    nodeIndex: 7,
    explicitTime: 0.083333,
  },
  stance: {
    nodeIndex: 10,
    normalizeAlpha: true,
    alphaBindings: [
      'PoseState.StandingAmount',
      'PoseState.CrouchingAmount',
    ],
  },
} as const

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export interface AlsDefaultOverlayGraphState {
  readonly groundPrediction: InputScaleBiasClampState
  relevant: boolean
}

export function createAlsDefaultOverlayGraphState(): AlsDefaultOverlayGraphState {
  return {
    groundPrediction: createInputScaleBiasClampState(),
    relevant: false,
  }
}

export interface AlsDefaultOverlayGraphInput {
  readonly gaitWalkingAmount: number
  readonly standingAmount: number
  readonly crouchingAmount: number
  readonly inAirAmount: number
  readonly groundPredictionAmount: number
  readonly deltaTime: number
  readonly relevant?: boolean
}

export interface AlsDefaultOverlayGraphSample {
  readonly gaitWalkingAmount: number
  readonly standingAmount: number
  readonly crouchingAmount: number
  readonly inAirAmount: number
  readonly groundPredictionAmount: number
}

/** Updates AB_Als_Default's only stateful graph alpha before pose evaluation. */
export function refreshAlsDefaultOverlayGraph(
  state: AlsDefaultOverlayGraphState,
  input: AlsDefaultOverlayGraphInput,
): AlsDefaultOverlayGraphSample {
  const relevant = input.relevant !== false
  if (!relevant) {
    resetInputScaleBiasClampState(state.groundPrediction)
    state.relevant = false
    return {
      gaitWalkingAmount: 0,
      standingAmount: 1,
      crouchingAmount: 0,
      inAirAmount: 0,
      groundPredictionAmount: 0,
    }
  }

  const settings = AB_ALS_DEFAULT_OVERLAY_GRAPH.groundPrediction
  const groundPredictionAmount = refreshInputScaleBiasClampState(
    state.groundPrediction,
    input.groundPredictionAmount,
    input.deltaTime,
    settings.interpolationSpeedIncreasing,
    settings.interpolationSpeedDecreasing,
  )
  state.relevant = true
  return {
    gaitWalkingAmount: clamp01(input.gaitWalkingAmount),
    standingAmount: Math.max(0, input.standingAmount),
    crouchingAmount: Math.max(0, input.crouchingAmount),
    inAirAmount: clamp01(input.inAirAmount),
    groundPredictionAmount: clamp01(groundPredictionAmount),
  }
}

export interface AlsDefaultOverlayGraphRuntime {
  readonly rig: RigDefinition
  readonly source: UeSequencePoseSource
  readonly referencePose: LocalPoseBuffer
  readonly standingIdle: MutableUePoseNode
  readonly standingMoving: MutableUePoseNode
  readonly crouching: MutableUePoseNode
  readonly inAir: MutableUePoseNode
  readonly groundPrediction: MutableUePoseNode
  readonly standing: MutableUePoseNode
  readonly stance: MutableUePoseNode
  readonly predictedInAir: MutableUePoseNode
  readonly output: MutableUePoseNode
  readonly stanceNodes: readonly [MutableUePoseNode, MutableUePoseNode]
  readonly stanceWeights: Float32Array
}

export function createAlsDefaultOverlayGraphRuntime(
  rig: RigDefinition,
  source: UeSequencePoseSource,
  referencePose: LocalPoseBuffer,
): AlsDefaultOverlayGraphRuntime {
  if (referencePose.boneCount !== rig.boneCount) {
    throw new Error('AB_Als_Default reference pose has an incompatible bone count')
  }
  const node = () => createMutableUePoseNode(rig.boneCount)
  const standing = node()
  const crouching = node()
  return {
    rig,
    source,
    referencePose,
    standingIdle: node(),
    standingMoving: node(),
    crouching,
    inAir: node(),
    groundPrediction: node(),
    standing,
    stance: node(),
    predictedInAir: node(),
    output: node(),
    stanceNodes: [standing, crouching],
    stanceWeights: new Float32Array(2),
  }
}

function evaluateNormalizedStanceNode(
  runtime: AlsDefaultOverlayGraphRuntime,
  standingAmount: number,
  crouchingAmount: number,
) {
  const sum = standingAmount + crouchingAmount
  if (sum <= ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    copyPose(runtime.referencePose, runtime.stance.pose)
    runtime.stance.curves.clear()
    return
  }
  runtime.stanceWeights[0] = standingAmount / sum
  runtime.stanceWeights[1] = crouchingAmount / sum
  blendPoseNodesTogether(
    runtime.stanceNodes,
    runtime.stanceWeights,
    runtime.stance,
  )
}

/**
 * Evaluates the exact compiled graph topology into retained output storage.
 *
 * Every TwoWay/MultiWay call is a distinct Unreal node boundary; none of the sequence evaluator
 * samples are converted into a continuously scrubbed pose-bank time.
 */
export function evaluateAlsDefaultOverlayGraph(
  runtime: AlsDefaultOverlayGraphRuntime,
  sample: AlsDefaultOverlayGraphSample,
  outputPose: LocalPoseBuffer,
  outputCurves: Map<string, number>,
) {
  const graph = AB_ALS_DEFAULT_OVERLAY_GRAPH
  sampleSequencePoseNode(
    runtime.rig,
    runtime.source,
    graph.standingMoving.evaluators[0].explicitTime,
    true,
    runtime.standingIdle,
  )
  sampleSequencePoseNode(
    runtime.rig,
    runtime.source,
    graph.standingMoving.evaluators[1].explicitTime,
    true,
    runtime.standingMoving,
  )
  sampleSequencePoseNode(
    runtime.rig,
    runtime.source,
    graph.crouching.explicitTime,
    true,
    runtime.crouching,
  )
  sampleSequencePoseNode(
    runtime.rig,
    runtime.source,
    graph.groundPrediction.evaluators[0].explicitTime,
    true,
    runtime.inAir,
  )
  sampleSequencePoseNode(
    runtime.rig,
    runtime.source,
    graph.groundPrediction.evaluators[1].explicitTime,
    true,
    runtime.groundPrediction,
  )

  blendTwoPoseNodesTogether(
    runtime.standingIdle,
    runtime.standingMoving,
    1 - sample.gaitWalkingAmount,
    runtime.standing,
  )
  evaluateNormalizedStanceNode(
    runtime,
    sample.standingAmount,
    sample.crouchingAmount,
  )
  blendTwoPoseNodesTogether(
    runtime.inAir,
    runtime.groundPrediction,
    1 - sample.groundPredictionAmount,
    runtime.predictedInAir,
  )
  blendTwoPoseNodesTogether(
    runtime.stance,
    runtime.predictedInAir,
    1 - sample.inAirAmount,
    runtime.output,
  )

  copyPose(runtime.output.pose, outputPose)
  outputCurves.clear()
  for (const [name, value] of runtime.output.curves) {
    outputCurves.set(name, value)
  }
}
