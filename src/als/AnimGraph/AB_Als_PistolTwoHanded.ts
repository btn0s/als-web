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
import type { RigDefinition } from '../../engine/rig'

import { sampleCF_Als_Aim_In, sampleCF_Als_Aim_Out } from './AB_Als_Rifle'

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

/** Authored AB_Als_PistolTwoHanded nodes, abp-graph.json. Bindings and Kismet
 * predicates/notifies are frozen in pistol-content.json (binary-equality checked).
 * Ready exits use 3 seconds; standing pose blends use GaitWalkingAmount. */
export const ALS_PISTOL_TWO_HANDED_GRAPH = {
  pistolStates: {
    stateMachineNodeIndex: 37,
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
  relaxed: {
    standingTimes: [0, 0.05, 0.083333],
    crouchingTime: 0.25,
    idleAdditiveAlpha: 0.75,
  },
  ready: {
    stateResultNodeIndex: 14,
    outputNodeIndex: 9,
    standingTimes: [0.116667, 0.15],
    crouchingTime: 0.283333,
    idleAdditiveAlpha: 0.75,
  },
  aiming: {
    stateResultNodeIndex: 26,
    outputNodeIndex: 17,
    standingTimes: [0.183333, 0.216667],
    crouchingTime: 0.316667,
    standingAimReferenceFrame: 6,
    crouchingAimReferenceFrame: 10,
    referenceFrameRate: 30,
    // The serialized evaluators retain their zero defaults, but the compiled
    // property-access paths bind both ExplicitTime pins to
    // GetParent.ViewState.PitchAmount. These clips are one-second aim sweeps.
    aimExplicitTime: 'PitchAmount',
    idleAdditiveAlpha: 0.5,
    meshAdditiveAlpha: 1,
  },
  gameplayTagsBlend: {
    nodeIndex: 41,
    defaultChild: 'Pistol States',
    acceptedActions: ['Mantling', 'GettingUp', 'Rolling'],
    blendTimes: [0.3, 0.3, 0, 0.3],
    blend: 'Linear',
    resetChildOnActivation: false,
    overrides: {
      Mantling: {
        nodeIndex: 38,
        posesTime: 0.116667,
      },
      GettingUp: {
        nodeIndex: 43,
        posesTime: 0.25,
        curves: { LayerArmRight: 3 },
      },
      Rolling: {
        nodeIndex: 42,
        posesTime: 0.083333,
        curves: {
          LayerArmRight: 3,
        },
      },
    },
  },
} as const

export type AlsPistolState = 'Relaxed' | 'Ready' | 'Aiming'
export type AlsPistolAction =
  | 'Mantling'
  | 'GettingUp'
  | 'Rolling'
  | 'Ragdolling'
  | null
type AlsPistolGameplayTagsBlendChild = 0 | 1 | 2 | 3


interface AlsPistolStancePoses {
  readonly standingTimes: readonly number[]
  readonly crouchingTime: number
  readonly idleAdditiveAlpha: number
}
interface AlsPistolActionPose {
  readonly nodeIndex?: number
  readonly posesTime: number
}
interface AlsPistolModifiedActionPose extends AlsPistolActionPose {
  readonly curves: Readonly<Record<string, number>>
}
export interface AlsPistolGraph {
  readonly pistolStates:
    Omit<typeof ALS_PISTOL_TWO_HANDED_GRAPH.pistolStates, 'stateMachineNodeIndex'>
    & { readonly stateMachineNodeIndex: number }
  readonly relaxed: AlsPistolStancePoses
  readonly ready: AlsPistolStancePoses
  readonly aiming: AlsPistolStancePoses & {
    readonly standingAimReferenceFrame: number
    readonly crouchingAimReferenceFrame: number
    readonly referenceFrameRate: number
    readonly meshAdditiveAlpha: number
  }
  readonly gameplayTagsBlend: {
    readonly nodeIndex?: number
    readonly blendTimes: readonly number[]
    readonly blend: 'Linear'
    readonly overrides: {
      readonly Mantling: AlsPistolActionPose
      readonly GettingUp: AlsPistolModifiedActionPose
      readonly Rolling: AlsPistolModifiedActionPose
    }
  }
}
export interface AlsPistolFullInput {
  readonly relevant: boolean
  readonly deltaTime: number
  readonly standingAmount: number
  readonly crouchingAmount: number
  readonly gaitWalkingAmount: number
  readonly gaitSprintingAmount: number
  readonly rotationMode: 'Aiming' | 'VelocityDirection' | 'ViewDirection'
  readonly locomotionMode: 'Grounded' | 'InAir' | null
  readonly gait: 'Walking' | 'Running' | 'Sprinting'
  readonly transitionsAllowed: boolean
  readonly moving: boolean
  readonly pitchAmount: number
  readonly locomotionAction?: AlsPistolAction
}
export interface AlsPistolFullSources {
  readonly poses: UeSequencePoseSource
  readonly idle: UeSequencePoseSource & { readonly time: number; readonly loop: boolean }
  readonly idleReference: UeSequencePoseSource
  readonly aim: UeSequencePoseSource
  readonly aimCrouch: UeSequencePoseSource
  readonly aimReference: UeSequencePoseSource
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}
function normalizeStance(standing: number, crouching: number, out: Float32Array) {
  out[0] = clamp01(standing)
  out[1] = clamp01(crouching)
  const sum = out[0] + out[1]
  if (sum > ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    out[0] /= sum
    out[1] /= sum
  } else {
    out.fill(0)
  }
}
function blendNormalizedMultiWay(
  rig: RigDefinition,
  sources: readonly UePoseNode[],
  weights: Float32Array,
  out: MutableUePoseNode,
) {
  if (weights[0] + weights[1] <= ZERO_ANIMATION_WEIGHT_THRESHOLD) {
    resetPoseToReference(out.pose, rig)
    out.curves.clear()
    return out
  }
  return blendPoseNodesTogether(sources, weights, out)
}
function evaluateRelaxedState(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
  sources: AlsPistolFullSources,
) {
  const { nodes, rig, graph } = runtime
  const times = graph.relaxed.standingTimes
  sampleSequencePoseNode(rig, sources.poses, times[0], false, nodes.relaxedStandingIdle)
  sampleSequencePoseNode(rig, sources.poses, times[1], false, nodes.relaxedStandingMove)
  // Two-handed nodes 31 -> 35: sprint is nested inside Walking. One-handed
  // node 33 has only Idle/Walking. Neither graph authors an InAir branch.
  if (times.length === 3) {
    sampleSequencePoseNode(rig, sources.poses, times[2], false, nodes.relaxedStandingSprint)
    blendTwoPoseNodesTogether(nodes.relaxedStandingMove, nodes.relaxedStandingSprint,
      1 - clamp01(input.gaitSprintingAmount), nodes.relaxedMoving)
  } else copyPoseNode(nodes.relaxedStandingMove, nodes.relaxedMoving)
  blendTwoPoseNodesTogether(nodes.relaxedStandingIdle, nodes.relaxedMoving,
    1 - clamp01(input.gaitWalkingAmount), nodes.relaxedStanding)
  sampleSequencePoseNode(rig, sources.poses, graph.relaxed.crouchingTime, false, nodes.relaxedCrouching)
  blendNormalizedMultiWay(rig, [nodes.relaxedStanding, nodes.relaxedCrouching], runtime.stanceWeights, runtime.statePoses.Relaxed)
  applyAdditivePose(runtime.statePoses.Relaxed.pose, nodes.idleAdditive.pose, graph.relaxed.idleAdditiveAlpha)
}
export interface AlsPistolLifecycleEvent {
  readonly kind: 'AnimNotify'
  readonly name: 'RelaxedToReady' | 'ReadyToRelaxed'
  readonly callSite: 'TransitionStart'
}

interface AlsPistolRuntimeNodes {
  readonly relaxedStandingIdle: MutableUePoseNode
  readonly relaxedStandingMove: MutableUePoseNode
  readonly relaxedStandingSprint: MutableUePoseNode
  readonly relaxedMoving: MutableUePoseNode
  readonly relaxedStanding: MutableUePoseNode
  readonly relaxedCrouching: MutableUePoseNode
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
  readonly pistolStates: MutableUePoseNode
  readonly pistolTransitionScratchA: MutableUePoseNode
  readonly pistolTransitionScratchB: MutableUePoseNode
  readonly mantling: MutableUePoseNode
  readonly gettingUp: MutableUePoseNode
  readonly rolling: MutableUePoseNode
  readonly actionTransitionScratchA: MutableUePoseNode
  readonly actionTransitionScratchB: MutableUePoseNode
  readonly output: MutableUePoseNode
}

export interface AlsPistolEvaluation {
  readonly pose: LocalPoseBuffer
  readonly curves: Map<string, number>
  state: AlsPistolState
  actionChild: AlsPistolGameplayTagsBlendChild
  readonly lifecycleEvents: readonly AlsPistolLifecycleEvent[]
}

export interface AlsPistolFullRuntime {
  readonly rig: RigDefinition
  readonly graph: AlsPistolGraph
  readonly stanceWeights: Float32Array
  readonly pistolStates: StateMachineTransitionStack<AlsPistolState>
  readonly gameplayTagsBlend:
    StateMachineTransitionStack<AlsPistolGameplayTagsBlendChild>
  readonly statePoses: Record<AlsPistolState, MutableUePoseNode>
  readonly actionPoses: readonly [
    MutableUePoseNode,
    MutableUePoseNode,
    MutableUePoseNode,
    MutableUePoseNode,
  ]
  readonly nodes: AlsPistolRuntimeNodes
  readonly meshScratch: ReturnType<typeof createMeshSpaceBlendScratch>
  readonly lifecycleEvents: AlsPistolLifecycleEvent[]
  readonly quickFeetBlendProfile: CompiledWeightBlendProfile | null
  readonly output: AlsPistolEvaluation
  graphRelevant: boolean
  pistolStatesRelevant: boolean
  firstPistolStatesUpdate: boolean
  stateElapsedTime: number
  transitionsTakenThisFrame: number
}

function createFullRuntimeNodes(boneCount: number): AlsPistolRuntimeNodes {
  const node = () => createMutableUePoseNode(boneCount)
  return {
    relaxedStandingIdle: node(),
    relaxedStandingMove: node(),
    relaxedStandingSprint: node(),
    relaxedMoving: node(),
    relaxedStanding: node(),
    relaxedCrouching: node(),
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
    pistolStates: node(),
    pistolTransitionScratchA: node(),
    pistolTransitionScratchB: node(),
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

export function createAlsPistolRuntime(
  rig: RigDefinition,
  quickFeetBlendProfile: CompiledWeightBlendProfile | null = null,
  graph: AlsPistolGraph = ALS_PISTOL_TWO_HANDED_GRAPH,
): AlsPistolFullRuntime {
  const nodes = createFullRuntimeNodes(rig.boneCount)
  const statePoses = {
    Relaxed: createMutableUePoseNode(rig.boneCount),
    Ready: createMutableUePoseNode(rig.boneCount),
    Aiming: createMutableUePoseNode(rig.boneCount),
  }
  const lifecycleEvents: AlsPistolLifecycleEvent[] = []
  const output: AlsPistolEvaluation = {
    pose: nodes.output.pose,
    curves: nodes.output.curves,
    state: 'Relaxed',
    actionChild: 0,
    lifecycleEvents,
  }
  return {
    rig,
    graph,
    stanceWeights: new Float32Array(2),
    pistolStates: createStateMachineTransitionStack(
      'Relaxed',
      rig.boneCount,
      graph.pistolStates.maxTransitionsPerFrame,
    ),
    gameplayTagsBlend: createStateMachineTransitionStack(
      0 as AlsPistolGameplayTagsBlendChild,
      rig.boneCount,
      graph.gameplayTagsBlend.blendTimes.length,
    ),
    statePoses,
    actionPoses: [
      nodes.pistolStates,
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
    pistolStatesRelevant: false,
    firstPistolStatesUpdate: true,
    stateElapsedTime: 0,
    transitionsTakenThisFrame: 0,
  }
}

export function resetAlsPistolRuntime(runtime: AlsPistolFullRuntime) {
  resetStateMachineTransitionStack(runtime.pistolStates, 'Relaxed')
  resetStateMachineTransitionStack(runtime.gameplayTagsBlend, 0)
  runtime.lifecycleEvents.length = 0
  runtime.graphRelevant = false
  runtime.pistolStatesRelevant = false
  runtime.firstPistolStatesUpdate = true
  runtime.stateElapsedTime = 0
  runtime.transitionsTakenThisFrame = 0
  runtime.output.state = 'Relaxed'
  runtime.output.actionChild = 0
  return runtime
}

function gameplayTagsBlendChild(
  action: AlsPistolAction | undefined,
): AlsPistolGameplayTagsBlendChild {
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
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
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
      duration: runtime.graph.gameplayTagsBlend.blendTimes[target],
      blendOption: runtime.graph.gameplayTagsBlend.blend,
    })
  }
  advanceStateMachineTransitionStack(
    runtime.gameplayTagsBlend,
    Math.max(0, input.deltaTime),
  )
}

function nextPistolTransition(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
): 0 | 1 | 2 | 3 | 4 | 5 | null {
  switch (runtime.pistolStates.currentState) {
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
        && runtime.stateElapsedTime >= 3
      ) {
        return 2
      }
      if (input.moving && runtime.stateElapsedTime >= 3) return 3
      return input.rotationMode === 'Aiming' ? 4 : null
  }
}

function takePistolTransition(
  runtime: AlsPistolFullRuntime,
  transitionIndex: 0 | 1 | 2 | 3 | 4 | 5,
) {
  const transition =
    runtime.graph.pistolStates.transitions[transitionIndex]
  startStateMachineStandardTransition(runtime.pistolStates, {
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
  runtime: AlsPistolFullRuntime,
) {
  for (const transition of runtime.pistolStates.activeTransitions) {
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

function refreshPistolStates(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
) {
  const pistolStatesRelevant = (
    input.relevant
    && getStateMachineStateWeight(runtime.gameplayTagsBlend, 0)
      > ZERO_ANIMATION_WEIGHT_THRESHOLD
  )
  if (!pistolStatesRelevant) {
    runtime.pistolStatesRelevant = false
    return
  }

  if (!runtime.pistolStatesRelevant) {
    resetStateMachineTransitionStack(runtime.pistolStates, 'Relaxed')
    runtime.pistolStatesRelevant = true
    runtime.firstPistolStatesUpdate = true
    runtime.stateElapsedTime = 0
  }

  if (!runtime.firstPistolStatesUpdate) {
    while (
      runtime.transitionsTakenThisFrame
        < runtime.graph.pistolStates.maxTransitionsPerFrame
    ) {
      const transitionIndex = nextPistolTransition(runtime, input)
      if (transitionIndex === null) break
      takePistolTransition(runtime, transitionIndex)
    }
  }
  runtime.firstPistolStatesUpdate = false

  const deltaTime = Math.max(0, input.deltaTime)
  advanceStateMachineTransitionStack(runtime.pistolStates, deltaTime)
  refreshCustomTransitionAlphas(runtime)
  runtime.stateElapsedTime += deltaTime
}

export function refreshAlsPistolRuntime(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
) {
  normalizeStance(input.standingAmount, input.crouchingAmount, runtime.stanceWeights)
  runtime.lifecycleEvents.length = 0
  runtime.transitionsTakenThisFrame = 0
  refreshGameplayTagsBlend(runtime, input)
  refreshPistolStates(runtime, input)
  runtime.output.state = runtime.pistolStates.currentState
  runtime.output.actionChild = runtime.gameplayTagsBlend.currentState
  return runtime
}

function refreshIdleAdditive(
  runtime: AlsPistolFullRuntime,
  sources: AlsPistolFullSources,
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
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
  sources: AlsPistolFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.ready.standingTimes[0],
    false,
    nodes.readyStandingLow,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.ready.standingTimes[1],
    false,
    nodes.readyStandingHigh,
  )
  blendTwoPoseNodesTogether(
    nodes.readyStandingLow,
    nodes.readyStandingHigh,
    1 - clamp01(input.gaitWalkingAmount),
    nodes.readyStanding,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.ready.crouchingTime,
    false,
    nodes.readyCrouching,
  )
  blendNormalizedMultiWay(
    runtime.rig,
    [nodes.readyStanding, nodes.readyCrouching],
    runtime.stanceWeights,
    runtime.statePoses.Ready,
  )
  applyAdditivePose(
    runtime.statePoses.Ready.pose,
    nodes.idleAdditive.pose,
    runtime.graph.ready.idleAdditiveAlpha,
  )
}

function applyAimAdditive(
  runtime: AlsPistolFullRuntime,
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
    runtime.graph.aiming.meshAdditiveAlpha,
    runtime.meshScratch,
  )
}

function evaluateAimingState(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
  sources: AlsPistolFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.aiming.standingTimes[0],
    false,
    nodes.aimingStandingLow,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.aiming.standingTimes[1],
    false,
    nodes.aimingStandingHigh,
  )
  blendTwoPoseNodesTogether(
    nodes.aimingStandingLow,
    nodes.aimingStandingHigh,
    1 - clamp01(input.gaitWalkingAmount),
    nodes.aimingStandingBase,
  )
  applyAimAdditive(
    runtime,
    sources.aim,
    input.pitchAmount,
    sources.aimReference,
    runtime.graph.aiming.standingAimReferenceFrame
      / runtime.graph.aiming.referenceFrameRate,
    nodes.aimingStandingBase,
    nodes.aimingStanding,
  )

  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.aiming.crouchingTime,
    false,
    nodes.aimingCrouchingBase,
  )
  applyAimAdditive(
    runtime,
    sources.aimCrouch,
    input.pitchAmount,
    sources.aimReference,
    runtime.graph.aiming.crouchingAimReferenceFrame
      / runtime.graph.aiming.referenceFrameRate,
    nodes.aimingCrouchingBase,
    nodes.aimingCrouching,
  )
  blendNormalizedMultiWay(
    runtime.rig,
    [nodes.aimingStanding, nodes.aimingCrouching],
    runtime.stanceWeights,
    runtime.statePoses.Aiming,
  )
  applyAdditivePose(
    runtime.statePoses.Aiming.pose,
    nodes.idleAdditive.pose,
    runtime.graph.aiming.idleAdditiveAlpha,
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

function evaluatePistolStates(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
  sources: AlsPistolFullSources,
) {
  evaluateRelaxedState(runtime, input, sources)
  evaluateReadyState(runtime, input, sources)
  evaluateAimingState(runtime, input, sources)
  evaluateTransitionStack(
    runtime.pistolStates,
    (state) => runtime.statePoses[state],
    runtime.nodes.pistolTransitionScratchA,
    runtime.nodes.pistolTransitionScratchB,
    runtime.nodes.pistolStates,
  )
}

function evaluateActionPoses(
  runtime: AlsPistolFullRuntime,
  sources: AlsPistolFullSources,
) {
  const { nodes } = runtime
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.gameplayTagsBlend.overrides.Mantling.posesTime,
    false,
    nodes.mantling,
  )
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.gameplayTagsBlend.overrides.GettingUp.posesTime,
    false,
    nodes.gettingUp,
  )
  for (
    const [name, value]
    of Object.entries(
      runtime.graph.gameplayTagsBlend.overrides.GettingUp.curves,
    )
  ) {
    nodes.gettingUp.curves.set(name, value)
  }
  sampleSequencePoseNode(
    runtime.rig,
    sources.poses,
    runtime.graph.gameplayTagsBlend.overrides.Rolling.posesTime,
    false,
    nodes.rolling,
  )
  for (
    const [name, value]
    of Object.entries(
      runtime.graph.gameplayTagsBlend.overrides.Rolling.curves,
    )
  ) {
    nodes.rolling.curves.set(name, value)
  }
}

/**
 * Evaluates each state's authored additives before the state-machine boundary,
 * then the outer GameplayTagsBlend.
 */
export function evaluateAlsPistolGraph(
  runtime: AlsPistolFullRuntime,
  input: AlsPistolFullInput,
  sources: AlsPistolFullSources,
): AlsPistolEvaluation {
  refreshIdleAdditive(runtime, sources)
  evaluatePistolStates(runtime, input, sources)
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
