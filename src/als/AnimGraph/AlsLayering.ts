import {
  applyAdditivePose,
  applyMeshSpaceAdditivePose,
  blendPoseInPlace,
  createMeshSpaceBlendScratch,
  makeDynamicAdditivePose,
  type BoneMask,
  type MeshSpaceBlendScratch,
} from '../../engine/blend'
import {
  compileBranchFilterMask,
  type BranchFilter,
} from '../../engine/branchFilter'
import {
  applyLayeredBoneBlend,
  createLayeredBoneBlendScratch,
  type LayeredBoneBlendScratch,
} from '../../engine/layeredBoneBlend'
import {
  copyPose,
  createPoseBuffer,
  type LocalPoseBuffer,
} from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'

export const ALS_LAYERING_REGION_NAMES = [
  'Legs',
  'Pelvis',
  'Spine',
  'Head',
  'ArmLeft',
  'ArmRight',
] as const

export type AlsLayeringRegionName = (typeof ALS_LAYERING_REGION_NAMES)[number]

export type AlsLayeringCachedPoseName =
  | 'Legs'
  | 'Pelvis'
  | 'Spine'
  | 'Head'
  | 'Arm Left'
  | 'Arm Right'
  | 'Overlay'

export type AlsLayeringDynamicAdditiveAlpha =
  | {
    readonly kind: 'full'
    readonly amount: 1
  }
  | {
    readonly kind: 'curve'
    readonly curveName:
      | 'LayerSpineAdditive'
      | 'LayerHeadAdditive'
      | 'LayerArmLeftAdditive'
      | 'LayerArmRightAdditive'
  }

export interface AlsLayeringRegionDefinition {
  readonly name: AlsLayeringRegionName
  readonly cachedPoseName: AlsLayeringCachedPoseName
  readonly slotName: AlsLayeringRegionName
  readonly baseCurveName: string
  readonly additiveCurveName: string | null
  readonly slotCurveName: string
  readonly localSpaceCurveName: string | null
  readonly dynamicAdditiveSpace: 'local' | 'mesh'
  readonly dynamicAdditiveAlpha: AlsLayeringDynamicAdditiveAlpha
  readonly slotNodeIndex: number
  readonly slotBlendNodeIndex: number
  readonly applyDynamicAdditiveNodeIndex: number
  readonly regionBlendNodeIndex: number
  readonly saveCachedPoseNodeIndex: number
}

/**
 * AB_Als_Layering's six independently cached body regions.
 *
 * The graph builds both locomotion dynamic-additive caches first. Legs and Pelvis apply the
 * mesh-space delta at a fixed full alpha; Spine, Head, and both arms use their Layer*Additive
 * curves. Arm deltas are local-space, while every other region uses mesh-space.
 *
 * VERIFIED from Content/ALS/Character/AnimationInstances/AB_Als_Layering.uasset, compiled nodes
 * 0-25 and 61-71 in scripts/extract-als/abp-graph.json. Curve names are the constants declared at
 * Source/ALS/Public/Utility/AlsConstants.h:64-121 and defined at lines 306-425.
 */
export const ALS_LAYERING_REGIONS = [
  {
    name: 'Legs',
    cachedPoseName: 'Legs',
    slotName: 'Legs',
    baseCurveName: 'LayerLegs',
    additiveCurveName: null,
    slotCurveName: 'LayerLegsSlot',
    localSpaceCurveName: null,
    dynamicAdditiveSpace: 'mesh',
    dynamicAdditiveAlpha: { kind: 'full', amount: 1 },
    slotNodeIndex: 0,
    slotBlendNodeIndex: 71,
    applyDynamicAdditiveNodeIndex: 1,
    regionBlendNodeIndex: 2,
    saveCachedPoseNodeIndex: 3,
  },
  {
    name: 'Pelvis',
    cachedPoseName: 'Pelvis',
    slotName: 'Pelvis',
    baseCurveName: 'LayerPelvis',
    additiveCurveName: null,
    slotCurveName: 'LayerPelvisSlot',
    localSpaceCurveName: null,
    dynamicAdditiveSpace: 'mesh',
    dynamicAdditiveAlpha: { kind: 'full', amount: 1 },
    slotNodeIndex: 27,
    slotBlendNodeIndex: 69,
    applyDynamicAdditiveNodeIndex: 6,
    regionBlendNodeIndex: 7,
    saveCachedPoseNodeIndex: 90,
  },
  {
    name: 'Spine',
    cachedPoseName: 'Spine',
    slotName: 'Spine',
    baseCurveName: 'LayerSpine',
    additiveCurveName: 'LayerSpineAdditive',
    slotCurveName: 'LayerSpineSlot',
    localSpaceCurveName: null,
    dynamicAdditiveSpace: 'mesh',
    dynamicAdditiveAlpha: {
      kind: 'curve',
      curveName: 'LayerSpineAdditive',
    },
    slotNodeIndex: 50,
    slotBlendNodeIndex: 67,
    applyDynamicAdditiveNodeIndex: 10,
    regionBlendNodeIndex: 11,
    saveCachedPoseNodeIndex: 22,
  },
  {
    name: 'Head',
    cachedPoseName: 'Head',
    slotName: 'Head',
    baseCurveName: 'LayerHead',
    additiveCurveName: 'LayerHeadAdditive',
    slotCurveName: 'LayerHeadSlot',
    localSpaceCurveName: null,
    dynamicAdditiveSpace: 'mesh',
    dynamicAdditiveAlpha: {
      kind: 'curve',
      curveName: 'LayerHeadAdditive',
    },
    slotNodeIndex: 49,
    slotBlendNodeIndex: 65,
    applyDynamicAdditiveNodeIndex: 14,
    regionBlendNodeIndex: 15,
    saveCachedPoseNodeIndex: 23,
  },
  {
    name: 'ArmLeft',
    cachedPoseName: 'Arm Left',
    slotName: 'ArmLeft',
    baseCurveName: 'LayerArmLeft',
    additiveCurveName: 'LayerArmLeftAdditive',
    slotCurveName: 'LayerArmLeftSlot',
    localSpaceCurveName: 'LayerArmLeftLocalSpace',
    dynamicAdditiveSpace: 'local',
    dynamicAdditiveAlpha: {
      kind: 'curve',
      curveName: 'LayerArmLeftAdditive',
    },
    slotNodeIndex: 31,
    slotBlendNodeIndex: 63,
    applyDynamicAdditiveNodeIndex: 45,
    regionBlendNodeIndex: 18,
    saveCachedPoseNodeIndex: 24,
  },
  {
    name: 'ArmRight',
    cachedPoseName: 'Arm Right',
    slotName: 'ArmRight',
    baseCurveName: 'LayerArmRight',
    additiveCurveName: 'LayerArmRightAdditive',
    slotCurveName: 'LayerArmRightSlot',
    localSpaceCurveName: 'LayerArmRightLocalSpace',
    dynamicAdditiveSpace: 'local',
    dynamicAdditiveAlpha: {
      kind: 'curve',
      curveName: 'LayerArmRightAdditive',
    },
    slotNodeIndex: 29,
    slotBlendNodeIndex: 61,
    applyDynamicAdditiveNodeIndex: 46,
    regionBlendNodeIndex: 20,
    saveCachedPoseNodeIndex: 25,
  },
] as const satisfies readonly AlsLayeringRegionDefinition[]

export interface AlsLayeringState {
  headBlendAmount: number
  headAdditiveBlendAmount: number
  headSlotBlendAmount: number
  armLeftBlendAmount: number
  armLeftAdditiveBlendAmount: number
  armLeftSlotBlendAmount: number
  armLeftLocalSpaceBlendAmount: number
  armLeftMeshSpaceBlendAmount: number
  armRightBlendAmount: number
  armRightAdditiveBlendAmount: number
  armRightSlotBlendAmount: number
  armRightLocalSpaceBlendAmount: number
  armRightMeshSpaceBlendAmount: number
  handLeftBlendAmount: number
  handRightBlendAmount: number
  spineBlendAmount: number
  spineAdditiveBlendAmount: number
  spineSlotBlendAmount: number
  pelvisBlendAmount: number
  pelvisSlotBlendAmount: number
  legsBlendAmount: number
  legsSlotBlendAmount: number
}

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

function curveValue(curves: ReadonlyMap<string, number>, name: string) {
  return curves.get(name) ?? 0
}

/**
 * Pure port of UAlsAnimationInstance::RefreshLayering().
 *
 * Missing AttributeCurve entries resolve to zero, exactly like its local GetCurveValue lambda.
 * The mesh-space arm amounts deliberately remain binary: they are one until the local-space
 * amount satisfies FAnimWeight::IsFullWeight(), whose engine threshold is 1 - 1e-5.
 *
 * Source/ALS/Private/AlsAnimationInstance.cpp:264-311.
 */
export function resolveAlsLayeringState(
  curves: ReadonlyMap<string, number>,
): AlsLayeringState {
  const armLeftLocalSpaceBlendAmount = curveValue(
    curves,
    'LayerArmLeftLocalSpace',
  )
  const armRightLocalSpaceBlendAmount = curveValue(
    curves,
    'LayerArmRightLocalSpace',
  )
  const fullWeightMinimum = 1 - ZERO_ANIMATION_WEIGHT_THRESHOLD

  return {
    headBlendAmount: curveValue(curves, 'LayerHead'),
    headAdditiveBlendAmount: curveValue(curves, 'LayerHeadAdditive'),
    headSlotBlendAmount: curveValue(curves, 'LayerHeadSlot'),
    armLeftBlendAmount: curveValue(curves, 'LayerArmLeft'),
    armLeftAdditiveBlendAmount: curveValue(curves, 'LayerArmLeftAdditive'),
    armLeftSlotBlendAmount: curveValue(curves, 'LayerArmLeftSlot'),
    armLeftLocalSpaceBlendAmount,
    armLeftMeshSpaceBlendAmount:
      armLeftLocalSpaceBlendAmount >= fullWeightMinimum ? 0 : 1,
    armRightBlendAmount: curveValue(curves, 'LayerArmRight'),
    armRightAdditiveBlendAmount: curveValue(curves, 'LayerArmRightAdditive'),
    armRightSlotBlendAmount: curveValue(curves, 'LayerArmRightSlot'),
    armRightLocalSpaceBlendAmount,
    armRightMeshSpaceBlendAmount:
      armRightLocalSpaceBlendAmount >= fullWeightMinimum ? 0 : 1,
    handLeftBlendAmount: curveValue(curves, 'LayerHandLeft'),
    handRightBlendAmount: curveValue(curves, 'LayerHandRight'),
    spineBlendAmount: curveValue(curves, 'LayerSpine'),
    spineAdditiveBlendAmount: curveValue(curves, 'LayerSpineAdditive'),
    spineSlotBlendAmount: curveValue(curves, 'LayerSpineSlot'),
    pelvisBlendAmount: curveValue(curves, 'LayerPelvis'),
    pelvisSlotBlendAmount: curveValue(curves, 'LayerPelvisSlot'),
    legsBlendAmount: curveValue(curves, 'LayerLegs'),
    legsSlotBlendAmount: curveValue(curves, 'LayerLegsSlot'),
  }
}

export type AlsLayeringStateWeightSource =
  | 'armLeftMeshSpaceBlendAmount'
  | 'armRightMeshSpaceBlendAmount'
  | 'armLeftLocalSpaceBlendAmount'
  | 'armRightLocalSpaceBlendAmount'
  | 'handLeftBlendAmount'
  | 'handRightBlendAmount'

export type AlsLayeringWeightSource =
  | {
    readonly kind: 'full'
    readonly amount: 1
  }
  | {
    readonly kind: 'state'
    readonly property: AlsLayeringStateWeightSource
  }

export interface AlsLayeredBoneBlendLayerDefinition {
  readonly sourcePose: AlsLayeringCachedPoseName
  readonly weightSource: AlsLayeringWeightSource
  readonly branchFilters: readonly BranchFilter[]
}

export interface AlsLayeredBoneBlendNodeDefinition {
  readonly nodeIndex: number
  readonly nodeProperty: string
  readonly basePose: 'Legs' | 'Previous'
  readonly layers: readonly AlsLayeredBoneBlendLayerDefinition[]
  readonly meshSpaceRotationBlend: boolean
  readonly meshSpaceScaleBlend: false
  readonly curveBlendMode: 'Override'
}

/**
 * AB_Als_Layering's complete, evaluation-ordered LayeredBoneBlend chain.
 *
 * Each region cache already contains its Layer* base blend. Consequently Pelvis, Spine, and Head
 * enter at full node weight; the arm space split and hand layers are the only state-driven node
 * weights. Branch-filter order is significant, especially Pelvis's two negative thigh filters.
 *
 * VERIFIED from Content/ALS/Character/AnimationInstances/AB_Als_Layering.uasset compiled nodes
 * 79 -> 80 -> 81 -> 86 -> 87 -> 60 -> 92 in scripts/extract-als/abp-graph.json.
 */
export const ALS_LAYERED_BONE_BLEND_NODES = [
  {
    nodeIndex: 79,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_5',
    basePose: 'Legs',
    layers: [{
      sourcePose: 'Pelvis',
      weightSource: { kind: 'full', amount: 1 },
      branchFilters: [
        { boneName: 'pelvis', blendDepth: 0 },
        { boneName: 'thigh_l', blendDepth: -1 },
        { boneName: 'thigh_r', blendDepth: -1 },
      ],
    }],
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 80,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_4',
    basePose: 'Previous',
    layers: [{
      sourcePose: 'Spine',
      weightSource: { kind: 'full', amount: 1 },
      branchFilters: [{ boneName: 'spine_01', blendDepth: 3 }],
    }],
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 81,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_3',
    basePose: 'Previous',
    layers: [{
      sourcePose: 'Head',
      weightSource: { kind: 'full', amount: 1 },
      branchFilters: [{ boneName: 'neck_01', blendDepth: 0 }],
    }],
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 86,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_2',
    basePose: 'Previous',
    layers: [{
      sourcePose: 'Arm Left',
      weightSource: {
        kind: 'state',
        property: 'armLeftMeshSpaceBlendAmount',
      },
      branchFilters: [{ boneName: 'clavicle_l', blendDepth: 1 }],
    }],
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 87,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_1',
    basePose: 'Previous',
    layers: [{
      sourcePose: 'Arm Right',
      weightSource: {
        kind: 'state',
        property: 'armRightMeshSpaceBlendAmount',
      },
      branchFilters: [{ boneName: 'clavicle_r', blendDepth: 1 }],
    }],
    meshSpaceRotationBlend: true,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 60,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend_6',
    basePose: 'Previous',
    layers: [
      {
        sourcePose: 'Arm Left',
        weightSource: {
          kind: 'state',
          property: 'armLeftLocalSpaceBlendAmount',
        },
        branchFilters: [{ boneName: 'clavicle_l', blendDepth: 1 }],
      },
      {
        sourcePose: 'Arm Right',
        weightSource: {
          kind: 'state',
          property: 'armRightLocalSpaceBlendAmount',
        },
        branchFilters: [{ boneName: 'clavicle_r', blendDepth: 1 }],
      },
    ],
    meshSpaceRotationBlend: false,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
  {
    nodeIndex: 92,
    nodeProperty: 'AnimGraphNode_LayeredBoneBlend',
    basePose: 'Previous',
    layers: [
      {
        sourcePose: 'Overlay',
        weightSource: {
          kind: 'state',
          property: 'handLeftBlendAmount',
        },
        branchFilters: [
          { boneName: 'index_01_l', blendDepth: 0 },
          { boneName: 'middle_01_l', blendDepth: 0 },
          { boneName: 'ring_01_l', blendDepth: 0 },
          { boneName: 'pinky_01_l', blendDepth: 0 },
          { boneName: 'thumb_01_l', blendDepth: 0 },
          { boneName: 'VB hand_l_to_hand_r', blendDepth: 0 },
          { boneName: 'VB hand_l_to_ik_hand_gun', blendDepth: 0 },
        ],
      },
      {
        sourcePose: 'Overlay',
        weightSource: {
          kind: 'state',
          property: 'handRightBlendAmount',
        },
        branchFilters: [
          { boneName: 'index_01_r', blendDepth: 0 },
          { boneName: 'middle_01_r', blendDepth: 0 },
          { boneName: 'ring_01_r', blendDepth: 0 },
          { boneName: 'pinky_01_r', blendDepth: 0 },
          { boneName: 'thumb_01_r', blendDepth: 0 },
          { boneName: 'VB hand_r_to_hand_r', blendDepth: 0 },
          { boneName: 'VB hand_r_to_ik_hand_gun', blendDepth: 0 },
        ],
      },
    ],
    meshSpaceRotationBlend: false,
    meshSpaceScaleBlend: false,
    curveBlendMode: 'Override',
  },
] as const satisfies readonly AlsLayeredBoneBlendNodeDefinition[]

export interface AlsLayeredBoneBlendNodeMasks {
  readonly nodeIndex: number
  readonly nodeProperty: string
  readonly layerMasks: readonly BoneMask[]
}

/** Compiles one fresh mask per authored layer, preserving node and layer evaluation order. */
export function createAlsLayeringMasks(
  rig: RigDefinition,
): readonly AlsLayeredBoneBlendNodeMasks[] {
  return ALS_LAYERED_BONE_BLEND_NODES.map((node) => ({
    nodeIndex: node.nodeIndex,
    nodeProperty: node.nodeProperty,
    layerMasks: node.layers.map((layer) => (
      compileBranchFilterMask(rig, layer.branchFilters)
    )),
  }))
}

/**
 * Node 52 disables region slots only on Overlay before the Curves slot runs. Node 73 then
 * accumulates that complete curve container into Locomotion at amount 1, and node 74 overrides
 * the final layered pose's complete curve container with the result. Curves unrelated to Layer*
 * must therefore survive unchanged.
 *
 * FAlsAnimNode_CurvesBlend's Accumulate and Override branches are implemented at
 * Source/ALS/Private/Nodes/AlsAnimNode_CurvesBlend.cpp:58-91.
 */
export const ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES = [
  'LayerHeadSlot',
  'LayerArmLeftSlot',
  'LayerArmRightSlot',
  'LayerSpineSlot',
  'LayerPelvisSlot',
  'LayerLegsSlot',
] as const

export function composeAlsLayeringFinalCurves(
  locomotionCurves: ReadonlyMap<string, number>,
  overlayCurves: ReadonlyMap<string, number>,
  output: Map<string, number> = new Map(),
  curvesSlot?: ReadonlyMap<string, number>,
): Map<string, number> {
  if (output === locomotionCurves || output === overlayCurves) {
    throw new Error('ALS Layering curve output must not alias an input')
  }

  output.clear()
  for (const [curveName, value] of locomotionCurves) {
    output.set(curveName, value)
  }
  for (const [curveName, value] of curvesSlot ?? overlayCurves) {
    if (!curvesSlot && ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES.includes(
      curveName as (typeof ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES)[number],
    )) {
      continue
    }
    output.set(curveName, (output.get(curveName) ?? 0) + value)
  }
  for (const curveName of ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES) {
    if (!output.has(curveName)) output.set(curveName, 0)
  }
  return output
}

export interface AlsLayeringRegionSlotPose {
  readonly pose: LocalPoseBuffer
}

export interface AlsLayeringPoseInput {
  readonly locomotionPose: LocalPoseBuffer
  readonly overlayPose: LocalPoseBuffer
  readonly basePose: LocalPoseBuffer
  readonly curves: ReadonlyMap<string, number>
  /**
   * Optional outputs of the six authored region Slot nodes. When absent, each Slot returns its
   * Overlay source pose, so its surrounding TwoWayBlend is exactly a no-op.
   */
  readonly regionSlots?: ReadonlyMap<
    AlsLayeringRegionName,
    AlsLayeringRegionSlotPose
  >
}

export interface AlsLayeringPoseRuntime {
  readonly rig: RigDefinition
  readonly regionInputPose: LocalPoseBuffer
  readonly regionPoses: ReadonlyMap<AlsLayeringCachedPoseName, LocalPoseBuffer>
  readonly locomotionAdditiveLocalSpace: LocalPoseBuffer
  readonly locomotionAdditiveMeshSpace: LocalPoseBuffer
  readonly meshSpaceScratch: MeshSpaceBlendScratch
  readonly layeredBoneBlendScratch: LayeredBoneBlendScratch
  readonly layeredBoneBlendMasks: readonly AlsLayeredBoneBlendNodeMasks[]
}

export function createAlsLayeringPoseRuntime(
  rig: RigDefinition,
): AlsLayeringPoseRuntime {
  const regionPoses = new Map<AlsLayeringCachedPoseName, LocalPoseBuffer>()
  for (const region of ALS_LAYERING_REGIONS) {
    regionPoses.set(region.cachedPoseName, createPoseBuffer(rig.boneCount))
  }

  return {
    rig,
    regionInputPose: createPoseBuffer(rig.boneCount),
    regionPoses,
    locomotionAdditiveLocalSpace: createPoseBuffer(rig.boneCount),
    locomotionAdditiveMeshSpace: createPoseBuffer(rig.boneCount),
    meshSpaceScratch: createMeshSpaceBlendScratch(rig.boneCount),
    layeredBoneBlendScratch: createLayeredBoneBlendScratch(rig.boneCount),
    layeredBoneBlendMasks: createAlsLayeringMasks(rig),
  }
}

function regionBaseBlendAmount(
  state: AlsLayeringState,
  region: AlsLayeringRegionName,
) {
  switch (region) {
    case 'Legs': return state.legsBlendAmount
    case 'Pelvis': return state.pelvisBlendAmount
    case 'Spine': return state.spineBlendAmount
    case 'Head': return state.headBlendAmount
    case 'ArmLeft': return state.armLeftBlendAmount
    case 'ArmRight': return state.armRightBlendAmount
  }
}

function regionAdditiveBlendAmount(
  state: AlsLayeringState,
  region: AlsLayeringRegionDefinition,
) {
  if (region.dynamicAdditiveAlpha.kind === 'full') {
    return region.dynamicAdditiveAlpha.amount
  }
  switch (region.name) {
    case 'Spine': return state.spineAdditiveBlendAmount
    case 'Head': return state.headAdditiveBlendAmount
    case 'ArmLeft': return state.armLeftAdditiveBlendAmount
    case 'ArmRight': return state.armRightAdditiveBlendAmount
    case 'Legs':
    case 'Pelvis':
      return 1
  }
}

function regionSlotBlendAmount(
  state: AlsLayeringState,
  region: AlsLayeringRegionName,
) {
  switch (region) {
    case 'Legs': return state.legsSlotBlendAmount
    case 'Pelvis': return state.pelvisSlotBlendAmount
    case 'Spine': return state.spineSlotBlendAmount
    case 'Head': return state.headSlotBlendAmount
    case 'ArmLeft': return state.armLeftSlotBlendAmount
    case 'ArmRight': return state.armRightSlotBlendAmount
  }
}

function layeredBoneBlendWeight(
  state: AlsLayeringState,
  source: AlsLayeringWeightSource,
) {
  return source.kind === 'full'
    ? source.amount
    : state[source.property]
}

function requireRegionPose(
  runtime: AlsLayeringPoseRuntime,
  name: AlsLayeringCachedPoseName,
) {
  const pose = runtime.regionPoses.get(name)
  if (!pose) throw new Error(`Missing ALS Layering cached pose "${name}"`)
  return pose
}

/**
 * Evaluates AB_Als_Layering's pose graph in authored node order.
 *
 * The two locomotion dynamic-additive caches are produced once, each region evaluates
 * Overlay -> Slot blend -> dynamic additive -> locomotion/base blend, and the six cached poses
 * then pass through nodes 79, 80, 81, 86, 87, 60, and 92. Curve-container composition is kept in
 * `composeAlsLayeringFinalCurves()` because Unreal's node 74 overrides pose curves only after this
 * transform graph has completed.
 */
export function evaluateAlsLayeringPose(
  runtime: AlsLayeringPoseRuntime,
  input: AlsLayeringPoseInput,
  outputPose: LocalPoseBuffer,
): LocalPoseBuffer {
  const { rig } = runtime
  if (
    input.locomotionPose.boneCount !== rig.boneCount
    || input.overlayPose.boneCount !== rig.boneCount
    || input.basePose.boneCount !== rig.boneCount
    || outputPose.boneCount !== rig.boneCount
  ) {
    throw new Error('ALS Layering pose input has an incompatible bone count')
  }

  const state = resolveAlsLayeringState(input.curves)
  makeDynamicAdditivePose(
    input.locomotionPose,
    input.basePose,
    rig,
    runtime.locomotionAdditiveLocalSpace,
    'local',
    runtime.meshSpaceScratch,
  )
  makeDynamicAdditivePose(
    input.locomotionPose,
    input.basePose,
    rig,
    runtime.locomotionAdditiveMeshSpace,
    'mesh',
    runtime.meshSpaceScratch,
  )

  for (const region of ALS_LAYERING_REGIONS) {
    copyPose(input.overlayPose, runtime.regionInputPose)
    const slot = input.regionSlots?.get(region.name)
    if (slot) {
      blendPoseInPlace(
        runtime.regionInputPose,
        slot.pose,
        regionSlotBlendAmount(state, region.name),
      )
    }

    const additiveAmount = regionAdditiveBlendAmount(state, region)
    if (region.dynamicAdditiveSpace === 'mesh') {
      applyMeshSpaceAdditivePose(
        runtime.regionInputPose,
        runtime.locomotionAdditiveMeshSpace,
        rig,
        additiveAmount,
        runtime.meshSpaceScratch,
      )
    } else {
      applyAdditivePose(
        runtime.regionInputPose,
        runtime.locomotionAdditiveLocalSpace,
        additiveAmount,
      )
    }

    const cachedPose = requireRegionPose(runtime, region.cachedPoseName)
    copyPose(input.locomotionPose, cachedPose)
    blendPoseInPlace(
      cachedPose,
      runtime.regionInputPose,
      regionBaseBlendAmount(state, region.name),
    )
  }

  copyPose(requireRegionPose(runtime, 'Legs'), outputPose)
  for (let nodeIndex = 0; nodeIndex < ALS_LAYERED_BONE_BLEND_NODES.length; nodeIndex++) {
    const node = ALS_LAYERED_BONE_BLEND_NODES[nodeIndex]
    const masks = runtime.layeredBoneBlendMasks[nodeIndex]
    if (masks.nodeIndex !== node.nodeIndex) {
      throw new Error('ALS Layering mask order differs from the authored graph')
    }
    for (let layerIndex = 0; layerIndex < node.layers.length; layerIndex++) {
      const layer = node.layers[layerIndex]
      applyLayeredBoneBlend(
        outputPose,
        layer.sourcePose === 'Overlay'
          ? input.overlayPose
          : requireRegionPose(runtime, layer.sourcePose),
        rig,
        layeredBoneBlendWeight(state, layer.weightSource),
        masks.layerMasks[layerIndex],
        node.meshSpaceRotationBlend,
        runtime.layeredBoneBlendScratch,
        node.meshSpaceScaleBlend,
      )
    }
  }

  return outputPose
}
