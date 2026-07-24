import {
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  createMeshSpaceBlendScratch,
  makeDynamicAdditivePose,
} from '../../engine/blend'
import type { MeshSpaceBlendScratch } from '../../engine/blend'
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
import type {
  CompiledWeightBlendProfile,
  WeightBlendProfile,
} from '../../engine/blendProfile'
import {
  applyInertialization,
  createInertialization,
} from '../../engine/inertialization'
import type { Inertialization } from '../../engine/inertialization'
import {
  applyOutputInertialization,
  createOutputInertialization,
  prepareOutputInertialization,
} from '../../engine/inertializationOutput'
import type {
  OutputInertialization,
} from '../../engine/inertializationOutput'
import {
  copyPose,
  resetPoseToReference,
} from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import {
  advanceStateMachineTransitionStack,
  createStateMachineTransitionStack,
  getStateMachineStateWeight,
  resetStateMachineTransitionStack,
  startStateMachineStandardTransition,
  writeStateMachineStateWeights,
} from '../../engine/stateMachineTransitionStack'
import type {
  StateMachineTransitionStack,
} from '../../engine/stateMachineTransitionStack'
import {
  blendTwoCurvesTogether,
  blendTwoPoseNodesTogether,
  blendPoseNodesTogether,
} from '../../engine/uePoseBlend'
import type {
  MutableUePoseNode,
  UePoseNode,
} from '../../engine/uePoseBlend'
import { createMutableUePoseNode } from '../../engine/uePoseGraph'
import type { AlsLocomotionMode } from '../AlsCharacter'
import type {
  AlsRotationMode,
  AlsStance,
} from '../Settings/AlsMovementSettings'
import {
  ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE,
} from './AB_Als_Crouching'
import {
  ALS_IN_AIR_CURVE_OUTPUTS,
  ALS_IN_AIR_GRAPH,
  ALS_IN_AIR_PLAYERS,
  ALS_JUMP_GRAPH_TRANSITIONS,
  ALS_JUMP_STATES_MACHINE,
  ALS_LOCOMOTION_GRAPH_TRANSITIONS,
  ALS_LOCOMOTION_STATES_MACHINE,
  createAlsInAirGraphState,
  enterAlsJumpGraph,
  refreshAlsFallGraph,
  refreshAlsJumpGraph,
  refreshAlsLandMovementGraph,
  resetAlsFallGraphState,
  resetAlsLandMovementGraphState,
  sampleAlsLandGraph,
  selectAlsLocomotionGraphTransition,
} from './inAir'
import type {
  AlsInAirGraphState,
  AlsJumpGraphSample,
  AlsLocomotionGraphState,
  AlsLocomotionGraphTransition,
  AlsLocomotionTransitionInput,
} from './inAir'

/*
 * Retained AB_Als_Locomotion graph.
 *
 * VERIFIED sources:
 * - ALS Refactored 4.15 AB_Als_Locomotion.uasset;
 * - scripts/extract-als/abp-graph.json;
 * - scripts/extract-als/blend-spaces.json;
 * - scripts/extract-als/skeleton-profiles.json;
 * - authored additive metadata in public/assets/skm-als.glb;
 * - UE FAnimNode_StateMachine/FAnimationPotentialTransition conduit traversal.
 *
 * Sequence sampling and sync-group clocks intentionally remain caller-owned. This module starts
 * at the sampled UePoseNode seam, retains every authored blend/additive/state boundary, and emits
 * one allocation-stable UePoseNode after both AB_Als_Locomotion inertialization nodes.
 */

export type AlsLocomotionPoseState =
  Exclude<AlsLocomotionGraphState, 'Land Conduct'>

export const ALS_LOCOMOTION_POSE_STATE_ORDER = [
  'Grounded',
  'Fall',
  'Jump',
  'Land',
  'Land Movement',
] as const satisfies readonly AlsLocomotionPoseState[]

export const AB_ALS_LOCOMOTION_GRAPH = {
  linkedGraph: {
    inputPoses: ['Grounded Input'],
    receiveNotifiesFromLinkedInstances: false,
    propagateNotifiesToLinkedInstances: false,
  },
  root: {
    nodeIndex: 0,
    sourceNodeIndex: 3,
  },
  groundedInput: {
    linkedInputPoseNodeIndex: 1,
    inputName: 'Grounded Input',
    saveCachedPoseNodeIndex: 2,
    cacheName: 'Grounded',
    stateUseCachedPoseNodeIndex: 74,
    landMovementUseCachedPoseNodeIndices: [17, 20],
  },
  poseFlow: {
    root: [76, 4, 3, 0],
    Grounded: [74, 75],
    Fall: [
      69, 70, 68, 71, 72, 61, 62, 65, 64, 63, 66, 67, 60, 73,
    ],
    Jump: [
      58, 33, 32, 39, 37, 36, 35, 38, 34, 31, 59,
    ],
    Land: [28, 29, 27, 26, 25, 30],
    'Land Movement': [23, 22, 21, 20, 19, 17, 18, 24],
  },
  outerStateMachine: ALS_LOCOMOTION_STATES_MACHINE,
  outerInertialization: {
    nodeIndex: 4,
    sourceNodeIndex: 76,
    defaultBlendProfile: null,
    filteredBones: [],
    filteredCurves: [],
    resetOnBecomingRelevant: false,
    forwardRequestsThroughSkippedCachedPoseNodes: true,
  },
  initializeLean: {
    nodeIndex: 3,
    functionName: 'InitializeLean',
    callSite: 'OnBecomeRelevant',
  },
  states: {
    Grounded: {
      stateResultNodeIndex: 75,
      stateIndex: 0,
      alwaysResetOnEntry: false,
      exitFunction: 'StopTransitionAndTurnInPlaceAnimations',
    },
    Fall: {
      stateResultNodeIndex: 73,
      stateIndex: 1,
      alwaysResetOnEntry: false,
      refreshFunctionNodeIndex: 60,
      refreshFunction: 'RefreshInAir',
    },
    Jump: {
      stateResultNodeIndex: 59,
      stateIndex: 2,
      alwaysResetOnEntry: true,
      refreshFunctionNodeIndex: 31,
      refreshFunction: 'RefreshInAir',
      nestedInertializationNodeIndex: 33,
      nestedStateMachine: ALS_JUMP_STATES_MACHINE,
    },
    Land: {
      stateResultNodeIndex: 30,
      stateIndex: 3,
      alwaysResetOnEntry: false,
      refreshFunctionNodeIndex: 25,
      refreshFunction: 'RefreshRotateInPlace',
    },
    'Land Movement': {
      stateResultNodeIndex: 24,
      stateIndex: 4,
      alwaysResetOnEntry: false,
    },
    'Land Conduct': {
      stateIndex: 5,
      conduit: true,
      entryRule: 'LocomotionMode == Grounded',
      stateResultNodeIndex: null,
    },
  },
} as const

export const ALS_JUMP_POSE_GRAPH = {
  'Entry Conduit': {
    stateIndex: 0,
    conduit: true,
    stateResultNodeIndex: null,
  },
  'Left Foot': {
    stateIndex: 1,
    stateResultNodeIndex: 57,
    blendNodeIndex: 54,
    walkPlayerNodeIndex: 56,
    runPlayerNodeIndex: 55,
  },
  'Right Foot': {
    stateIndex: 2,
    stateResultNodeIndex: 53,
    blendNodeIndex: 50,
    walkPlayerNodeIndex: 52,
    runPlayerNodeIndex: 51,
  },
  Loop: {
    stateIndex: 3,
    stateResultNodeIndex: 49,
    sequencePlayerNodeIndex: 48,
  },
  Flail: {
    stateIndex: 4,
    stateResultNodeIndex: 47,
    sequencePlayerNodeIndex: 46,
  },
} as const

export const ALS_AIR_LEAN_BLEND_SPACE = {
  className: 'BlendSpace',
  axes: [
    {
      index: 0,
      serialized: {
        DisplayName: 'Lean Right Amount',
        Min: -1,
        Max: 1,
        GridNum: 2,
      },
    },
    {
      index: 1,
      serialized: {
        DisplayName: 'Lean Forward Amount',
        Min: -1,
        Max: 1,
        GridNum: 2,
      },
    },
  ],
  samples: [
    {
      animation: { name: 'A_Als_Air_Lean' },
      sampleValue: { X: 0, Y: 0, Z: 0 },
      rateScale: 1,
    },
    {
      animation: { name: 'A_Als_Air_Lean_Forward' },
      sampleValue: { X: 0, Y: 1, Z: 0 },
      rateScale: 1,
    },
    {
      animation: { name: 'A_Als_Air_Lean_Backward' },
      sampleValue: { X: 0, Y: -1, Z: 0 },
      rateScale: 1,
    },
    {
      animation: { name: 'A_Als_Air_Lean_Left' },
      sampleValue: { X: -1, Y: 0, Z: 0 },
      rateScale: 1,
    },
    {
      animation: { name: 'A_Als_Air_Lean_Right' },
      sampleValue: { X: 1, Y: 0, Z: 0 },
      rateScale: 1,
    },
  ],
  topology: {
    interpolateUsingGrid: false,
    blendSpaceData: {
      Triangles: [
        {
          SampleIndices: 2,
          'SampleIndices[1]': 0,
          'SampleIndices[2]': 3,
          Vertices: { X: 0.5, Y: 0 },
          'Vertices[1]': { X: 0.5, Y: 0.5 },
          'Vertices[2]': { X: 0, Y: 0.5 },
          EdgeInfo: {
            Normal: { X: 1, Y: 0 },
            NeighbourTriangleIndex: 1,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
          'EdgeInfo[1]': {
            Normal: { X: 0, Y: 1 },
            NeighbourTriangleIndex: 2,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
          'EdgeInfo[2]': {
            Normal: { X: -0.70710677, Y: -0.70710677 },
            NeighbourTriangleIndex: -1,
            AdjacentPerimeterTriangleIndices: 2,
            'AdjacentPerimeterTriangleIndices[1]': 1,
            AdjacentPerimeterVertexIndices: 1,
            'AdjacentPerimeterVertexIndices[1]': 0,
          },
        },
        {
          SampleIndices: 2,
          'SampleIndices[1]': 4,
          'SampleIndices[2]': 0,
          Vertices: { X: 0.5, Y: 0 },
          'Vertices[1]': { X: 1, Y: 0.5 },
          'Vertices[2]': { X: 0.5, Y: 0.5 },
          EdgeInfo: {
            Normal: { X: 0.70710677, Y: -0.70710677 },
            NeighbourTriangleIndex: -1,
            AdjacentPerimeterTriangleIndices: 0,
            'AdjacentPerimeterTriangleIndices[1]': 3,
            AdjacentPerimeterVertexIndices: 2,
            'AdjacentPerimeterVertexIndices[1]': 0,
          },
          'EdgeInfo[1]': {
            Normal: { X: 0, Y: 1 },
            NeighbourTriangleIndex: 3,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
          'EdgeInfo[2]': {
            Normal: { X: -1, Y: 0 },
            NeighbourTriangleIndex: 0,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
        },
        {
          SampleIndices: 0,
          'SampleIndices[1]': 1,
          'SampleIndices[2]': 3,
          Vertices: { X: 0.5, Y: 0.5 },
          'Vertices[1]': { X: 0.5, Y: 1 },
          'Vertices[2]': { X: 0, Y: 0.5 },
          EdgeInfo: {
            Normal: { X: 1, Y: 0 },
            NeighbourTriangleIndex: 3,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
          'EdgeInfo[1]': {
            Normal: { X: -0.70710677, Y: 0.70710677 },
            NeighbourTriangleIndex: -1,
            AdjacentPerimeterTriangleIndices: 3,
            'AdjacentPerimeterTriangleIndices[1]': 0,
            AdjacentPerimeterVertexIndices: 0,
            'AdjacentPerimeterVertexIndices[1]': 2,
          },
          'EdgeInfo[2]': {
            Normal: { X: 0, Y: -1 },
            NeighbourTriangleIndex: 0,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
        },
        {
          SampleIndices: 4,
          'SampleIndices[1]': 1,
          'SampleIndices[2]': 0,
          Vertices: { X: 1, Y: 0.5 },
          'Vertices[1]': { X: 0.5, Y: 1 },
          'Vertices[2]': { X: 0.5, Y: 0.5 },
          EdgeInfo: {
            Normal: { X: 0.70710677, Y: 0.70710677 },
            NeighbourTriangleIndex: -1,
            AdjacentPerimeterTriangleIndices: 1,
            'AdjacentPerimeterTriangleIndices[1]': 2,
            AdjacentPerimeterVertexIndices: 0,
            'AdjacentPerimeterVertexIndices[1]': 1,
          },
          'EdgeInfo[1]': {
            Normal: { X: -1, Y: 0 },
            NeighbourTriangleIndex: 2,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
          'EdgeInfo[2]': {
            Normal: { X: 0, Y: -1 },
            NeighbourTriangleIndex: 1,
            AdjacentPerimeterTriangleIndices: -1,
            'AdjacentPerimeterTriangleIndices[1]': -1,
            AdjacentPerimeterVertexIndices: -1,
            'AdjacentPerimeterVertexIndices[1]': -1,
          },
        },
      ],
    },
    gridSamples: [],
  },
} as const satisfies AuthoredBlendSpace

export const ALS_AIR_LEAN_ADDITIVE_SETTINGS = {
  additiveType: 'AAT_LocalSpaceBase',
  additiveSpace: 'local',
  referenceSequence: 'A_Als_Fall',
  referenceFrameIndex: 0,
} as const

export const ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS = {
  additiveType: 'AAT_RotationOffsetMeshSpace',
  additiveSpace: 'mesh',
  referenceSequence: 'A_Als_Stand_Pose',
  referenceFrameIndex: 0,
} as const

export const ALS_LOCOMOTION_QUICK_FEET_BLEND_PROFILE =
  ALS_CROUCHING_QUICK_FEET_BLEND_PROFILE satisfies WeightBlendProfile

export interface AlsLocomotionSampledPoses {
  /** Linked input node1 / cached Grounded pose. */
  readonly groundedInput: UePoseNode

  readonly fallFastPose: UePoseNode
  readonly fallPose: UePoseNode
  /** A_Als_Flail sampled by Fall node71. */
  readonly fallFlailPose: UePoseNode

  readonly jumpWalkLeftPose: UePoseNode
  readonly jumpRunLeftPose: UePoseNode
  readonly jumpWalkRightPose: UePoseNode
  readonly jumpRunRightPose: UePoseNode
  readonly jumpLoopPose: UePoseNode
  /** A_Als_Flail sampled independently by Jump node46. */
  readonly jumpFlailPose: UePoseNode

  /**
   * Raw, full-pose samples in ALS_AIR_LEAN_BLEND_SPACE sample order. The web pack preserves
   * editor-source tracks; this graph converts every sample to its authored SequencePlayer additive
   * before the BlendSpace mixes them, matching UAnimSequence::GetAnimationPose().
   */
  readonly airLeanRawSourcePoses: readonly [
    UePoseNode,
    UePoseNode,
    UePoseNode,
    UePoseNode,
    UePoseNode,
  ]
  /** A_Als_Fall frame zero, shared by every authored Air Lean sample. */
  readonly airLeanReferencePose: UePoseNode

  /** Explicit-time node37/65 source. */
  readonly landingPreviewHeavyPose: UePoseNode
  /** Explicit-time node36/64 source. */
  readonly landingPreviewLightPose: UePoseNode

  /** Live Land-group node28 source. */
  readonly landLightPose: UePoseNode
  /** Live Land-group node29 source. */
  readonly landHeavyPose: UePoseNode

  /** Raw A_Als_Land_Light_Additive source from node23. */
  readonly landMovementLightRawPose: UePoseNode
  /** Raw A_Als_Land_Heavy_Additive source from node22. */
  readonly landMovementHeavyRawPose: UePoseNode
  /** A_Als_Stand_Pose frame zero, shared by both landing additive clips. */
  readonly landMovementReferencePose: UePoseNode
}

export interface AlsLocomotionSampledClocks {
  /** Relevant Left Foot or Right Foot Jump sequence time remaining. */
  readonly jumpLaunchRemainingTime: number
  /** GetRelevantAnimTimeRemaining(Land), seconds. */
  readonly landRemainingTime: number
  /**
   * Most-relevant Land Movement SequencePlayer's raw accumulated-time remainder. UE's automatic
   * transition rule compares this to CrossfadeDuration because AutomaticRuleTriggerTime is -1.
   */
  readonly landMovementRelevantAnimTimeRemaining: number
}

export interface AlsLocomotionPoseGraphInput {
  readonly relevant: boolean
  readonly deltaTime: number
  readonly locomotionMode: AlsLocomotionMode
  /** One-frame FAlsInAirState.bJumped latch, before RefreshInAir consumes it. */
  readonly jumped: boolean
  readonly stance: AlsStance
  readonly hasInput: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
  /** Metres per second. */
  readonly speed: number
  /** Metres per second. */
  readonly verticalVelocity: number
  readonly groundPredictionAmount: number
  readonly leanRightAmount: number
  readonly leanForwardAmount: number
  readonly footPlantedAmount: number
  readonly jumpPlayRate: number
  readonly rotationMode: AlsRotationMode
  readonly clocks: AlsLocomotionSampledClocks
  readonly poses: AlsLocomotionSampledPoses
}

export type AlsLocomotionLifecycleEvent =
  | {
      readonly kind: 'CallFunction'
      readonly functionName:
        | 'InitializeLean'
        | 'StopTransitionAndTurnInPlaceAnimations'
      readonly callSite: 'OnBecomeRelevant' | 'StateExit'
    }
  | {
      readonly kind: 'StateReset'
      readonly state: 'Jump'
      readonly reason: 'AlwaysResetOnEntry'
    }
  | {
      readonly kind: 'AnimNotify'
      readonly name: 'LandToGrounded'
      readonly callSite: 'TransitionStart'
      readonly transitionIndex: 7
    }

export interface AlsLocomotionInertializationRequest {
  readonly nodeIndex: 4 | 33
  readonly duration: number
  readonly transitionIndex: number
  readonly machineName: 'Locomotion States' | 'Jump States'
}

export interface AlsResolvedLocomotionTransition {
  /** Leaf transition whose blend settings and target state UE actually consumes. */
  readonly transition: AlsLocomotionGraphTransition
  readonly targetState: AlsLocomotionPoseState
  /**
   * FAnimationPotentialTransition::SourceTransitionIndices, leaf first. A conduit path appends its
   * incoming transition after the already-resolved leaf transition.
   */
  readonly sourceTransitionIndices: readonly number[]
  /** FAnimationPotentialTransition::CrossfadeTimeAdjustment. */
  readonly crossfadeTimeAdjustment: number
}

export interface AlsLocomotionPoseGraphNodes {
  readonly grounded: MutableUePoseNode
  readonly fallPair: MutableUePoseNode
  readonly fallBase: MutableUePoseNode
  /** Additive SequencePlayer outputs shared by nodes32/61's authored BlendSpace samples. */
  readonly airLeanSourceAdditives: readonly MutableUePoseNode[]
  readonly fallAirLeanAdditive: MutableUePoseNode
  readonly fallWithAirLean: MutableUePoseNode
  readonly fallLandingPreview: MutableUePoseNode
  readonly fall: MutableUePoseNode
  readonly jumpLeftLaunch: MutableUePoseNode
  readonly jumpRightLaunch: MutableUePoseNode
  readonly jumpStateMachine: MutableUePoseNode
  readonly jumpInertialized: MutableUePoseNode
  readonly jumpAirLeanAdditive: MutableUePoseNode
  readonly jumpWithAirLean: MutableUePoseNode
  readonly jumpLandingPreview: MutableUePoseNode
  readonly jump: MutableUePoseNode
  readonly land: MutableUePoseNode
  /** Additive outputs of node23 and node22 before node21 blends them. */
  readonly landMovementLightAdditive: MutableUePoseNode
  readonly landMovementHeavyAdditive: MutableUePoseNode
  /** Node21 output. */
  readonly landMovementAdditiveBlend: MutableUePoseNode
  readonly landMovementApplied: MutableUePoseNode
  readonly landMovement: MutableUePoseNode
  readonly transitionScratchA: MutableUePoseNode
  readonly transitionScratchB: MutableUePoseNode
  /** Node76 output before node4. */
  readonly outerStateMachine: MutableUePoseNode
  /** Node4/3/0 output. */
  readonly output: MutableUePoseNode
}

export interface AlsLocomotionPoseGraphRuntime {
  readonly rig: RigDefinition
  relevant: boolean
  jumpRelevant: boolean
  jumpSkipFirstUpdate: boolean
  readonly inAirGraphState: AlsInAirGraphState
  readonly outerTransitionStack:
    StateMachineTransitionStack<AlsLocomotionPoseState>
  readonly outerStateWeights: Float32Array
  readonly quickFeetBlendProfile: CompiledWeightBlendProfile
  readonly airLeanBlendSpace: BlendSpaceEvaluator
  readonly airLeanWeights: Float64Array
  readonly meshSpaceScratch: MeshSpaceBlendScratch
  readonly jumpInertialization: Inertialization
  readonly jumpOutputInertialization: OutputInertialization
  readonly outerInertialization: Inertialization
  readonly outerOutputInertialization: OutputInertialization
  readonly nodes: AlsLocomotionPoseGraphNodes
  readonly statePoses: Readonly<
    Record<AlsLocomotionPoseState, MutableUePoseNode>
  >
  readonly lifecycleEvents: AlsLocomotionLifecycleEvent[]
  readonly inertializationRequests:
    AlsLocomotionInertializationRequest[]
  transitionsTakenThisFrame: number
  jumpTransitionsTakenThisFrame: number
  transitionLimitReached: boolean
}

function createReferencePoseNode(rig: RigDefinition) {
  const node = createMutableUePoseNode(rig.boneCount)
  resetPoseToReference(node.pose, rig)
  return node
}

export function createAlsLocomotionPoseGraphRuntime(
  rig: RigDefinition,
): AlsLocomotionPoseGraphRuntime {
  const node = () => createReferencePoseNode(rig)
  const nodes: AlsLocomotionPoseGraphNodes = {
    grounded: node(),
    fallPair: node(),
    fallBase: node(),
    airLeanSourceAdditives:
      ALS_AIR_LEAN_BLEND_SPACE.samples.map(() => node()),
    fallAirLeanAdditive: node(),
    fallWithAirLean: node(),
    fallLandingPreview: node(),
    fall: node(),
    jumpLeftLaunch: node(),
    jumpRightLaunch: node(),
    jumpStateMachine: node(),
    jumpInertialized: node(),
    jumpAirLeanAdditive: node(),
    jumpWithAirLean: node(),
    jumpLandingPreview: node(),
    jump: node(),
    land: node(),
    landMovementLightAdditive: node(),
    landMovementHeavyAdditive: node(),
    landMovementAdditiveBlend: node(),
    landMovementApplied: node(),
    landMovement: node(),
    transitionScratchA: node(),
    transitionScratchB: node(),
    outerStateMachine: node(),
    output: node(),
  }
  return {
    rig,
    relevant: false,
    jumpRelevant: false,
    jumpSkipFirstUpdate: false,
    inAirGraphState: createAlsInAirGraphState(),
    outerTransitionStack:
      createStateMachineTransitionStack<AlsLocomotionPoseState>(
        ALS_LOCOMOTION_STATES_MACHINE.initialState,
        rig.boneCount,
        ALS_LOCOMOTION_STATES_MACHINE.maxTransitionsPerFrame + 1,
      ),
    outerStateWeights:
      new Float32Array(ALS_LOCOMOTION_POSE_STATE_ORDER.length),
    quickFeetBlendProfile: compileWeightBlendProfile(
      rig,
      ALS_LOCOMOTION_QUICK_FEET_BLEND_PROFILE,
    ),
    airLeanBlendSpace: createBlendSpaceEvaluator(
      compileBlendSpace(ALS_AIR_LEAN_BLEND_SPACE),
    ),
    airLeanWeights:
      new Float64Array(ALS_AIR_LEAN_BLEND_SPACE.samples.length),
    meshSpaceScratch: createMeshSpaceBlendScratch(rig.boneCount),
    jumpInertialization: createInertialization(rig.boneCount),
    jumpOutputInertialization: createOutputInertialization(),
    outerInertialization: createInertialization(rig.boneCount),
    outerOutputInertialization: createOutputInertialization(),
    nodes,
    statePoses: {
      Grounded: nodes.grounded,
      Fall: nodes.fall,
      Jump: nodes.jump,
      Land: nodes.land,
      'Land Movement': nodes.landMovement,
    },
    lifecycleEvents: [],
    inertializationRequests: [],
    transitionsTakenThisFrame: 0,
    jumpTransitionsTakenThisFrame: 0,
    transitionLimitReached: false,
  }
}

function copyPoseNode(
  source: UePoseNode,
  output: MutableUePoseNode,
) {
  copyPose(source.pose, output.pose)
  copyCurveValues(source, output)
  return output
}

function copyCurveValues(
  source: UePoseNode,
  output: MutableUePoseNode,
) {
  output.curves.clear()
  for (const [name, value] of source.curves) {
    output.curves.set(name, value)
  }
}

function publishCurves(
  output: MutableUePoseNode,
  curves: Readonly<Record<string, number>>,
) {
  for (const name in curves) output.curves.set(name, curves[name])
}

function accumulateAdditiveCurves(
  output: MutableUePoseNode,
  additive: UePoseNode,
  weight: number,
) {
  if (weight <= 0) return
  for (const [name, value] of additive.curves) {
    output.curves.set(
      name,
      (output.curves.get(name) ?? 0) + value * weight,
    )
  }
}

function clearInertialization(
  inertialization: Inertialization,
  output: OutputInertialization,
) {
  inertialization.translation.directions.fill(0)
  inertialization.translation.magnitudes.fill(0)
  inertialization.translation.speeds.fill(0)
  inertialization.rotation.directions.fill(0)
  inertialization.rotation.magnitudes.fill(0)
  inertialization.rotation.speeds.fill(0)
  inertialization.scale.directions.fill(0)
  inertialization.scale.magnitudes.fill(0)
  inertialization.scale.speeds.fill(0)
  inertialization.previousDeltaTime = 0
  inertialization.historyCount = 0
  inertialization.duration = 0
  inertialization.elapsed = 0
  inertialization.deficit = 0
  inertialization.active = false
  inertialization.pendingDuration = null
  inertialization.requestCount = 0
  output.previousCurves.clear()
  output.olderCurves.clear()
  output.curveDifferences.clear()
  output.previousRootMotionTranslation.fill(0)
  output.previousRootMotionRotation.set([0, 0, 0, 1])
  output.rootMotionVelocityDifference.translationDirection.fill(0)
  output.rootMotionVelocityDifference.translationMagnitude = 0
  output.rootMotionVelocityDifference.rotationDirection.fill(0)
  output.rootMotionVelocityDifference.rotationMagnitude = 0
  output.previousRootMotionValid = false
  output.previousDeltaTime = 0
  output.historyCount = 0
  output.captureRequested = false
}

function applyInertializationNode(
  source: UePoseNode,
  outputNode: MutableUePoseNode,
  inertialization: Inertialization,
  outputInertialization: OutputInertialization,
  deltaTime: number,
) {
  copyPoseNode(source, outputNode)
  prepareOutputInertialization(
    outputInertialization,
    inertialization,
  )
  applyInertialization(inertialization, outputNode.pose, deltaTime)
  applyOutputInertialization(
    outputInertialization,
    outputNode.curves,
    undefined,
    deltaTime,
    inertialization,
  )
}

export interface AlsResolvedLocomotionTransitionInput
  extends Omit<
    AlsLocomotionTransitionInput,
    'landMovementAutomaticRemainingTimeReached'
  > {
  readonly landMovementRelevantAnimTimeRemaining: number
}

function transitionInput(
  input: AlsLocomotionPoseGraphInput,
): AlsResolvedLocomotionTransitionInput {
  return {
    locomotionMode: input.locomotionMode,
    jumped: input.jumped,
    stance: input.stance,
    hasInput: input.hasInput,
    rotatingLeft: input.rotatingLeft,
    rotatingRight: input.rotatingRight,
    speed: input.speed,
    landRemainingTime: input.clocks.landRemainingTime,
    landMovementRelevantAnimTimeRemaining:
      input.clocks.landMovementRelevantAnimTimeRemaining,
  }
}

function landMovementAutomaticCrossfadeTimeAdjustment(
  input: AlsResolvedLocomotionTransitionInput,
) {
  const transition = ALS_LOCOMOTION_GRAPH_TRANSITIONS[11]
  const transitionTriggerTime =
    transition.automaticRuleTriggerTime >= 0
      ? transition.automaticRuleTriggerTime
      : transition.duration
  return transitionTriggerTime
    - input.landMovementRelevantAnimTimeRemaining
}

/**
 * Resolves one FAnimationPotentialTransition. Land Conduct remains a routing node: UE recursively
 * finds the leaf target, retains the leaf transition's settings, appends the incoming conduit edge
 * to SourceTransitionIndices, and increments MaxTransitionsPerFrame only once.
 */
export function resolveAlsLocomotionTransition(
  state: AlsLocomotionPoseState,
  input: AlsResolvedLocomotionTransitionInput,
): AlsResolvedLocomotionTransition | null {
  const automaticCrossfadeTimeAdjustment =
    landMovementAutomaticCrossfadeTimeAdjustment(input)
  const selected = selectAlsLocomotionGraphTransition(state, {
    ...input,
    landMovementAutomaticRemainingTimeReached:
      automaticCrossfadeTimeAdjustment >= 0,
  })
  if (!selected) return null

  if (selected.to !== 'Land Conduct') {
    return {
      transition: selected,
      targetState: selected.to,
      sourceTransitionIndices: [selected.transitionIndex],
      crossfadeTimeAdjustment:
        selected.transitionIndex === 11
          ? automaticCrossfadeTimeAdjustment
          : 0,
    }
  }

  const leaf = ALS_LOCOMOTION_GRAPH_TRANSITIONS[
    input.hasInput ? 14 : 15
  ]
  if (leaf.to === 'Land Conduct') {
    throw new Error('Land Conduct resolved to another conduit')
  }
  return {
    transition: leaf,
    targetState: leaf.to,
    sourceTransitionIndices: [
      leaf.transitionIndex,
      selected.transitionIndex,
    ],
    crossfadeTimeAdjustment: 0,
  }
}

function enterJumpState(
  runtime: AlsLocomotionPoseGraphRuntime,
  footPlantedAmount: number,
) {
  enterAlsJumpGraph(runtime.inAirGraphState, footPlantedAmount)
  clearInertialization(
    runtime.jumpInertialization,
    runtime.jumpOutputInertialization,
  )
  runtime.jumpRelevant = true
  runtime.jumpSkipFirstUpdate = true
  runtime.lifecycleEvents.push({
    kind: 'StateReset',
    state: 'Jump',
    reason: 'AlwaysResetOnEntry',
  })
}

function requestInertialization(
  runtime: AlsLocomotionPoseGraphRuntime,
  request: AlsLocomotionInertializationRequest,
) {
  runtime.inertializationRequests.push(request)
  const inertialization = request.nodeIndex === 33
    ? runtime.jumpInertialization
    : runtime.outerInertialization
  inertialization.requestInertialization(request.duration)
}

function emitTransitionLifecycle(
  runtime: AlsLocomotionPoseGraphRuntime,
  fromState: AlsLocomotionPoseState,
  resolved: AlsResolvedLocomotionTransition,
) {
  if (fromState === 'Grounded') {
    runtime.lifecycleEvents.push({
      kind: 'CallFunction',
      functionName: 'StopTransitionAndTurnInPlaceAnimations',
      callSite: 'StateExit',
    })
  }
  if (resolved.transition.startNotify === 'LandToGrounded') {
    runtime.lifecycleEvents.push({
      kind: 'AnimNotify',
      name: 'LandToGrounded',
      callSite: 'TransitionStart',
      transitionIndex: 7,
    })
  }
}

function hardInitializeState(
  runtime: AlsLocomotionPoseGraphRuntime,
  targetState: AlsLocomotionPoseState,
  input: AlsLocomotionPoseGraphInput,
) {
  resetStateMachineTransitionStack(
    runtime.outerTransitionStack,
    targetState,
  )
  switch (targetState) {
    case 'Fall':
      resetAlsFallGraphState(runtime.inAirGraphState)
      break
    case 'Jump':
      enterJumpState(runtime, input.footPlantedAmount)
      break
    case 'Land Movement':
      resetAlsLandMovementGraphState(runtime.inAirGraphState)
      break
  }
}

function startLocomotionTransition(
  runtime: AlsLocomotionPoseGraphRuntime,
  resolved: AlsResolvedLocomotionTransition,
  input: AlsLocomotionPoseGraphInput,
) {
  const fromState = runtime.outerTransitionStack.currentState
  const transition = resolved.transition
  runtime.transitionsTakenThisFrame++
  emitTransitionLifecycle(runtime, fromState, resolved)
  if (resolved.targetState === 'Jump') {
    enterJumpState(runtime, input.footPlantedAmount)
  }

  if (transition.logic === 'Inertialization') {
    resetStateMachineTransitionStack(
      runtime.outerTransitionStack,
      resolved.targetState,
    )
    requestInertialization(runtime, {
      nodeIndex: 4,
      duration: transition.duration,
      transitionIndex: transition.transitionIndex,
      machineName: 'Locomotion States',
    })
    return
  }

  startStateMachineStandardTransition(
    runtime.outerTransitionStack,
    {
      from: fromState,
      to: resolved.targetState,
      duration: transition.duration,
      blendOption: transition.blendOption,
      crossfadeTimeAdjustment: resolved.crossfadeTimeAdjustment,
      blendProfile: transition.blendProfile === 'QuickFeetBlend'
        ? runtime.quickFeetBlendProfile
        : null,
    },
  )
}

function initializeRelevantGraph(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  runtime.relevant = true
  runtime.jumpRelevant = false
  runtime.jumpSkipFirstUpdate = false
  resetStateMachineTransitionStack(
    runtime.outerTransitionStack,
    ALS_LOCOMOTION_STATES_MACHINE.initialState,
  )
  runtime.lifecycleEvents.push({
    kind: 'CallFunction',
    functionName: 'InitializeLean',
    callSite: 'OnBecomeRelevant',
  })

  if (!ALS_LOCOMOTION_STATES_MACHINE.skipFirstUpdateTransition) return
  const resolved = resolveAlsLocomotionTransition(
    ALS_LOCOMOTION_STATES_MACHINE.initialState,
    transitionInput(input),
  )
  if (!resolved) return

  // UE initializes the valid non-default target at full weight on the relevance edge.
  runtime.transitionsTakenThisFrame = 1
  hardInitializeState(runtime, resolved.targetState, input)
}

function refreshOuterStateMachine(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  const rules = transitionInput(input)

  while (
    runtime.transitionsTakenThisFrame
    < ALS_LOCOMOTION_STATES_MACHINE.maxTransitionsPerFrame
  ) {
    const resolved = resolveAlsLocomotionTransition(
      runtime.outerTransitionStack.currentState,
      rules,
    )
    if (!resolved) break
    startLocomotionTransition(runtime, resolved, input)
  }

  if (
    runtime.transitionsTakenThisFrame
      >= ALS_LOCOMOTION_STATES_MACHINE.maxTransitionsPerFrame
    && resolveAlsLocomotionTransition(
      runtime.outerTransitionStack.currentState,
      rules,
    ) !== null
  ) {
    runtime.transitionLimitReached = true
  }

  // FAnimNode_StateMachine::Update_AnyThread resolves every valid transition before ticking the
  // complete ActiveTransitionArray, including entries created by this update.
  advanceStateMachineTransitionStack(
    runtime.outerTransitionStack,
    input.deltaTime,
  )
}

function stateReferenced(
  runtime: AlsLocomotionPoseGraphRuntime,
  state: AlsLocomotionPoseState,
) {
  if (runtime.outerTransitionStack.currentState === state) return true
  return runtime.outerTransitionStack.activeTransitions.some(
    (transition) =>
      transition.previousState === state
      || transition.nextState === state,
  )
}

function refreshAirLeanAdditive(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
  additive: MutableUePoseNode,
) {
  // GetAnimationPose() emits every authored local-space additive before nodes32/61 blend them.
  // The pack intentionally preserves full editor tracks, so reproduce that SequencePlayer seam.
  const sourcePoses = input.poses.airLeanRawSourcePoses
  for (let index = 0; index < sourcePoses.length; index++) {
    const source = sourcePoses[index]
    if (source.curves.size > 0) {
      throw new Error(
        'BS_Als_Air_Lean raw authored samples must not contain curves',
      )
    }
    const sourceAdditive = runtime.nodes.airLeanSourceAdditives[index]
    makeDynamicAdditivePose(
      source.pose,
      input.poses.airLeanReferencePose.pose,
      runtime.rig,
      sourceAdditive.pose,
      ALS_AIR_LEAN_ADDITIVE_SETTINGS.additiveSpace,
      runtime.meshSpaceScratch,
    )
    sourceAdditive.curves.clear()
  }
  const sparseWeights = evaluateBlendSpace(
    runtime.airLeanBlendSpace,
    input.leanRightAmount,
    input.leanForwardAmount,
  )
  runtime.airLeanWeights.fill(0)
  for (let index = 0; index < sparseWeights.count; index++) {
    runtime.airLeanWeights[sparseWeights.sampleIndices[index]] =
      sparseWeights.weights[index]
  }
  blendPoseNodesTogether(
    runtime.nodes.airLeanSourceAdditives,
    runtime.airLeanWeights,
    additive,
  )
}

function evaluateLandingPreview(
  input: AlsLocomotionPoseGraphInput,
  lightAmount: number,
  output: MutableUePoseNode,
) {
  return blendTwoPoseNodesTogether(
    input.poses.landingPreviewHeavyPose,
    input.poses.landingPreviewLightPose,
    1 - lightAmount,
    output,
  )
}

function evaluateFallState(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  const sample = refreshAlsFallGraph(runtime.inAirGraphState, {
    deltaTime: input.deltaTime,
    verticalVelocity: input.verticalVelocity,
    groundPredictionAmount: input.groundPredictionAmount,
    leanRightAmount: input.leanRightAmount,
    leanForwardAmount: input.leanForwardAmount,
  })
  const nodes = runtime.nodes
  blendTwoPoseNodesTogether(
    input.poses.fallFastPose,
    input.poses.fallPose,
    1 - sample.fallBlendAmount,
    nodes.fallPair,
  )
  blendTwoPoseNodesTogether(
    nodes.fallPair,
    input.poses.fallFlailPose,
    1 - sample.flailBlendAmount,
    nodes.fallBase,
  )
  refreshAirLeanAdditive(
    runtime,
    input,
    nodes.fallAirLeanAdditive,
  )
  copyPoseNode(nodes.fallBase, nodes.fallWithAirLean)
  applyAdditivePose(
    nodes.fallWithAirLean.pose,
    nodes.fallAirLeanAdditive.pose,
    1,
  )
  evaluateLandingPreview(
    input,
    sample.air.landingPreviewLightAmount,
    nodes.fallLandingPreview,
  )
  blendTwoPoseNodesTogether(
    nodes.fallWithAirLean,
    nodes.fallLandingPreview,
    1 - sample.air.groundPredictionAmount,
    nodes.fall,
  )
  publishCurves(nodes.fall, ALS_IN_AIR_CURVE_OUTPUTS.Fall)
}

function evaluateJumpStateMachine(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
  sample: AlsJumpGraphSample,
  previousState: 'Left Foot' | 'Right Foot' | 'Loop' | 'Flail',
) {
  const nodes = runtime.nodes
  blendTwoPoseNodesTogether(
    input.poses.jumpWalkLeftPose,
    input.poses.jumpRunLeftPose,
    1 - sample.launchRunAmount,
    nodes.jumpLeftLaunch,
  )
  blendTwoPoseNodesTogether(
    input.poses.jumpWalkRightPose,
    input.poses.jumpRunRightPose,
    1 - sample.launchRunAmount,
    nodes.jumpRightLaunch,
  )

  switch (sample.state) {
    case 'Left Foot':
      copyPoseNode(nodes.jumpLeftLaunch, nodes.jumpStateMachine)
      break
    case 'Right Foot':
      copyPoseNode(nodes.jumpRightLaunch, nodes.jumpStateMachine)
      break
    case 'Loop':
      blendTwoPoseNodesTogether(
        input.poses.jumpLoopPose,
        input.poses.jumpFlailPose,
        runtime.inAirGraphState.jumpState.loopWeight,
        nodes.jumpStateMachine,
      )
      break
    case 'Flail':
      copyPoseNode(input.poses.jumpFlailPose, nodes.jumpStateMachine)
      break
  }

  if (sample.inertializationRequestDuration !== null) {
    requestInertialization(runtime, {
      nodeIndex: 33,
      duration: sample.inertializationRequestDuration,
      transitionIndex: previousState === 'Right Foot' ? 3 : 2,
      machineName: 'Jump States',
    })
  }
  applyInertializationNode(
    nodes.jumpStateMachine,
    nodes.jumpInertialized,
    runtime.jumpInertialization,
    runtime.jumpOutputInertialization,
    input.deltaTime,
  )
}

function refreshJumpSample(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  const previousState = runtime.inAirGraphState.jumpState.state
  const loopToFlailWasActive =
    runtime.inAirGraphState.jumpState.loopToFlailActive
  const skipTransition = runtime.jumpSkipFirstUpdate
  const sample = refreshAlsJumpGraph(runtime.inAirGraphState, {
    deltaTime: input.deltaTime,
    verticalVelocity: input.verticalVelocity,
    groundPredictionAmount: input.groundPredictionAmount,
    leanRightAmount: input.leanRightAmount,
    leanForwardAmount: input.leanForwardAmount,
    speed: input.speed,
    jumpPlayRate: input.jumpPlayRate,
    launchRemainingTime: skipTransition
      ? Number.POSITIVE_INFINITY
      : input.clocks.jumpLaunchRemainingTime,
  })
  runtime.jumpSkipFirstUpdate = false

  if (!skipTransition) {
    if (sample.inertializationRequestDuration !== null) {
      // Foot -> Loop inertialization and Loop -> Flail literal-true standard blend.
      runtime.jumpTransitionsTakenThisFrame = 2
    } else if (
      previousState === 'Loop'
      && !loopToFlailWasActive
    ) {
      runtime.jumpTransitionsTakenThisFrame = 1
    }
  }
  return sample
}

function evaluateJumpState(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  if (!runtime.jumpRelevant) {
    enterJumpState(runtime, input.footPlantedAmount)
  }
  const previousState = runtime.inAirGraphState.jumpState.state
  const sample = refreshJumpSample(runtime, input)
  evaluateJumpStateMachine(runtime, input, sample, previousState)

  const nodes = runtime.nodes
  refreshAirLeanAdditive(
    runtime,
    input,
    nodes.jumpAirLeanAdditive,
  )
  copyPoseNode(nodes.jumpInertialized, nodes.jumpWithAirLean)
  applyAdditivePose(
    nodes.jumpWithAirLean.pose,
    nodes.jumpAirLeanAdditive.pose,
    1,
  )
  evaluateLandingPreview(
    input,
    sample.air.landingPreviewLightAmount,
    nodes.jumpLandingPreview,
  )
  blendTwoPoseNodesTogether(
    nodes.jumpWithAirLean,
    nodes.jumpLandingPreview,
    1 - sample.air.groundPredictionAmount,
    nodes.jump,
  )
  publishCurves(nodes.jump, ALS_IN_AIR_CURVE_OUTPUTS.Jump)
}

function evaluateLandState(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  const sample = sampleAlsLandGraph({
    verticalVelocity: input.verticalVelocity,
  })
  blendTwoPoseNodesTogether(
    input.poses.landLightPose,
    input.poses.landHeavyPose,
    1 - sample.landHeavyAmount,
    runtime.nodes.land,
  )
  publishCurves(runtime.nodes.land, ALS_IN_AIR_CURVE_OUTPUTS.Land)
}

function evaluateLandMovementState(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  const sample = refreshAlsLandMovementGraph(
    runtime.inAirGraphState,
    {
      deltaTime: input.deltaTime,
      verticalVelocity: input.verticalVelocity,
      rotationMode: input.rotationMode,
    },
  )
  const nodes = runtime.nodes
  /*
   * The curated GLB preserves UAnimSequence's full editor source tracks. Unreal's
   * GetAnimationPose() converts each additive SequencePlayer to its authored additive pose before
   * node21 blends the two player outputs. Deriving one mesh-space delta after blending the full
   * poses changes child rotations, so keep that engine boundary explicit here.
   */
  makeDynamicAdditivePose(
    input.poses.landMovementLightRawPose.pose,
    input.poses.landMovementReferencePose.pose,
    runtime.rig,
    nodes.landMovementLightAdditive.pose,
    ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.additiveSpace,
    runtime.meshSpaceScratch,
  )
  makeDynamicAdditivePose(
    input.poses.landMovementHeavyRawPose.pose,
    input.poses.landMovementReferencePose.pose,
    runtime.rig,
    nodes.landMovementHeavyAdditive.pose,
    ALS_LAND_MOVEMENT_ADDITIVE_SETTINGS.additiveSpace,
    runtime.meshSpaceScratch,
  )
  copyCurveValues(
    input.poses.landMovementLightRawPose,
    nodes.landMovementLightAdditive,
  )
  copyCurveValues(
    input.poses.landMovementHeavyRawPose,
    nodes.landMovementHeavyAdditive,
  )
  blendTwoPoseNodesTogether(
    nodes.landMovementLightAdditive,
    nodes.landMovementHeavyAdditive,
    1 - sample.landHeavyAmount,
    nodes.landMovementAdditiveBlend,
  )

  copyPoseNode(nodes.grounded, nodes.landMovementApplied)
  applyMeshSpaceAdditivePose(
    nodes.landMovementApplied.pose,
    nodes.landMovementAdditiveBlend.pose,
    runtime.rig,
    sample.aimingAdditiveAmount,
    runtime.meshSpaceScratch,
  )
  accumulateAdditiveCurves(
    nodes.landMovementApplied,
    nodes.landMovementAdditiveBlend,
    sample.aimingAdditiveAmount,
  )

  // Node18 is retained even though both branches share Grounded as their base. Applying the two
  // alphas as one product would lose UE's quaternion normalization at node19 then node18.
  blendTwoPoseNodesTogether(
    nodes.grounded,
    nodes.landMovementApplied,
    1 - sample.groundedToAdditiveAmount,
    nodes.landMovement,
  )
}

function evaluateReferencedStatePoses(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
) {
  copyPoseNode(input.poses.groundedInput, runtime.nodes.grounded)
  if (stateReferenced(runtime, 'Fall')) {
    evaluateFallState(runtime, input)
  }
  if (stateReferenced(runtime, 'Jump')) {
    evaluateJumpState(runtime, input)
  } else {
    runtime.jumpRelevant = false
  }
  if (stateReferenced(runtime, 'Land')) {
    evaluateLandState(runtime, input)
  }
  if (stateReferenced(runtime, 'Land Movement')) {
    evaluateLandMovementState(runtime, input)
  }
}

function blendTransitionPoseNodes(
  previous: UePoseNode,
  next: UePoseNode,
  nextPoseMask: Float32Array,
  scalarAlpha: number,
  output: MutableUePoseNode,
) {
  copyPose(previous.pose, output.pose)
  blendPoseInPlace(output.pose, next.pose, 1, nextPoseMask)
  blendTwoCurvesTogether(
    previous.curves,
    next.curves,
    1 - scalarAlpha,
    output.curves,
  )
}

function evaluateOuterStateMachine(
  runtime: AlsLocomotionPoseGraphRuntime,
) {
  const transitions = runtime.outerTransitionStack.activeTransitions
  if (transitions.length === 0) {
    copyPoseNode(
      runtime.statePoses[runtime.outerTransitionStack.currentState],
      runtime.nodes.outerStateMachine,
    )
    return
  }

  let output = runtime.nodes.transitionScratchA
  const first = transitions[0]
  blendTransitionPoseNodes(
    runtime.statePoses[first.previousState],
    runtime.statePoses[first.nextState],
    first.nextPoseMask,
    first.alpha,
    output,
  )
  for (let index = 1; index < transitions.length; index++) {
    const transition = transitions[index]
    const nextOutput = output === runtime.nodes.transitionScratchA
      ? runtime.nodes.transitionScratchB
      : runtime.nodes.transitionScratchA
    blendTransitionPoseNodes(
      output,
      runtime.statePoses[transition.nextState],
      transition.nextPoseMask,
      transition.alpha,
      nextOutput,
    )
    output = nextOutput
  }
  copyPoseNode(output, runtime.nodes.outerStateMachine)
}

/**
 * Updates one AB_Als_Locomotion frame before its SequencePlayers update.
 *
 * Unreal updates the state machine first, then updates the players referenced by its resulting
 * blend tree. Keeping this phase public lets the owned runtime elect sync-group leaders with the
 * exact outer-state weights before sampling those players.
 */
export function updateAlsLocomotionPoseGraph(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
): boolean {
  if (!Number.isFinite(input.deltaTime) || input.deltaTime < 0) {
    throw new Error(
      'AB_Als_Locomotion delta time must be finite and non-negative',
    )
  }

  runtime.lifecycleEvents.length = 0
  runtime.inertializationRequests.length = 0
  runtime.transitionsTakenThisFrame = 0
  runtime.jumpTransitionsTakenThisFrame = 0
  runtime.transitionLimitReached = false

  if (!input.relevant) {
    runtime.relevant = false
    runtime.jumpRelevant = false
    return false
  }

  if (!runtime.relevant) {
    initializeRelevantGraph(runtime, input)
  } else {
    refreshOuterStateMachine(runtime, input)
  }

  writeStateMachineStateWeights(
    runtime.outerTransitionStack,
    ALS_LOCOMOTION_POSE_STATE_ORDER,
    runtime.outerStateWeights,
  )
  return true
}

/**
 * Evaluates AB_Als_Locomotion after {@link updateAlsLocomotionPoseGraph} and the caller-owned
 * SequencePlayers have updated and sampled.
 */
export function evaluateUpdatedAlsLocomotionPoseGraph(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
): MutableUePoseNode {
  if (!input.relevant) return runtime.nodes.output

  evaluateReferencedStatePoses(runtime, input)
  evaluateOuterStateMachine(runtime)
  applyInertializationNode(
    runtime.nodes.outerStateMachine,
    runtime.nodes.output,
    runtime.outerInertialization,
    runtime.outerOutputInertialization,
    input.deltaTime,
  )
  return runtime.nodes.output
}

/**
 * Updates and evaluates one AB_Als_Locomotion frame.
 *
 * This convenience entry point preserves the self-contained graph API used by pure tests. Live
 * animation instances use the split update/evaluate phases so their SequencePlayers update in
 * Unreal's order. All supplied poses must already be sampled at their caller-owned clocks. The
 * returned object is runtime.nodes.output and is reused on every call.
 */
export function evaluateAlsLocomotionPoseGraph(
  runtime: AlsLocomotionPoseGraphRuntime,
  input: AlsLocomotionPoseGraphInput,
): MutableUePoseNode {
  updateAlsLocomotionPoseGraph(runtime, input)
  return evaluateUpdatedAlsLocomotionPoseGraph(runtime, input)
}

export function getAlsLocomotionStateWeight(
  runtime: AlsLocomotionPoseGraphRuntime,
  state: AlsLocomotionPoseState,
) {
  return getStateMachineStateWeight(runtime.outerTransitionStack, state)
}

export const ALS_LOCOMOTION_PLAYER_METADATA = ALS_IN_AIR_PLAYERS
export const ALS_LOCOMOTION_INTERNAL_BLEND_METADATA = ALS_IN_AIR_GRAPH
export const ALS_LOCOMOTION_STATE_TRANSITIONS =
  ALS_LOCOMOTION_GRAPH_TRANSITIONS
export const ALS_JUMP_STATE_TRANSITIONS = ALS_JUMP_GRAPH_TRANSITIONS
