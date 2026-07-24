/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileBoneMask } from '../../engine/blend'
import { compileClipSampler, sampleClip } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { createPoseEvaluator, evaluatePose } from '../../engine/evaluator'
import type { EvaluatorLayerEntry } from '../../engine/evaluator'
import { createPoseBuffer } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import { createRigDefinition, findBoneIndex } from '../../engine/rig'
import {
  resolveRiflePoseBankTime,
  RIFLE_OVERLAY_CLIPS,
  RIFLE_OVERLAY_REGION_POLICY,
  sampleRifleOverlayPolicyWeight,
} from '../AnimGraph/overlayMode'
import {
  computeWeightTable,
  createWeightTable,
  armRegionWeight,
  legRegionWeight,
} from '../AnimGraph/weightTable'
import type { WeightTableInput } from '../AnimGraph/weightTable'
import { updateLocomotionTargets } from '../AnimGraph/blendspace'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
} from '../Settings/AlsMovementSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from '../Settings/AlsTurnInPlaceSettings'
import {
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from '../State/AlsPoseState'
import { REGION_PREDICATES } from '../Utility/AlsConstants'

const POSE_EPSILON = 1e-5
const CURVE_EPSILON = 1e-5
const YAW_INTEGRAL_EPSILON = 1e-3
const WEIGHT_EPSILON = 1e-6

interface RawAlsCurve {
  readonly name: string
  readonly keys: readonly (readonly [number, number, number])[]
}

interface LoadedAlsGltf {
  animations: THREE.AnimationClip[]
  scene: THREE.Group
}

interface AbpSequenceReference {
  readonly ObjectName: string
  readonly ObjectPath: string
}

interface AbpBranchFilter {
  readonly BoneName: string
  readonly BlendDepth: number
}

interface AbpNode {
  readonly compiledIndex: number | null
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly Name?: string
    readonly CachePoseName?: string
    readonly Sequence?: AbpSequenceReference
    readonly ExplicitTime?: number
    readonly bTeleportToExplicitTime?: boolean
    readonly ReinitializationBehavior?: string
    readonly LayerSetup?: readonly {
      readonly BranchFilters: readonly AbpBranchFilter[]
    }[]
  }
}

interface AbpPoseLink {
  readonly sourceNodeIndex: number
  readonly targetNodeIndex: number
  readonly targetInput: string
  readonly status: string
}

interface AbpAsset {
  readonly nodes: readonly AbpNode[]
  readonly wiring: {
    readonly poseLinks: readonly AbpPoseLink[]
  }
}

interface AbpGraph {
  readonly assets: Readonly<Record<string, AbpAsset>>
}

interface GraphSequenceSelection {
  readonly clipName: string
  readonly explicitTime: number
  readonly node: AbpNode
}

const abpGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as AbpGraph

let gltf: LoadedAlsGltf

function abpAsset(name: string) {
  const asset = abpGraph.assets[name]
  if (!asset) throw new Error(`Missing ALS ABP content-oracle asset "${name}"`)
  return asset
}

function abpNode(asset: AbpAsset, property: string) {
  const node = asset.nodes.find((candidate) => candidate.property === property)
  if (!node) throw new Error(`Missing ALS ABP node "${property}"`)
  return node
}

function abpSourceNode(
  asset: AbpAsset,
  targetProperty: string,
  targetInput: string,
) {
  const target = abpNode(asset, targetProperty)
  if (target.compiledIndex === null) {
    throw new Error(`ALS ABP target "${targetProperty}" has no compiled index`)
  }
  const links = asset.wiring.poseLinks.filter((link) =>
    link.targetNodeIndex === target.compiledIndex
    && link.targetInput === targetInput
    && link.status === 'recovered',
  )
  if (links.length !== 1) {
    throw new Error(
      `Expected one recovered ALS ABP link into ${targetProperty}.${targetInput}, got ${links.length}`,
    )
  }
  const source = asset.nodes.find(
    (candidate) => candidate.compiledIndex === links[0].sourceNodeIndex,
  )
  if (!source) {
    throw new Error(
      `Missing ALS ABP source index ${links[0].sourceNodeIndex} for ${targetProperty}.${targetInput}`,
    )
  }
  return source
}

function abpAnimationName(reference: AbpSequenceReference) {
  const match = /^AnimSequence'([^']+)'$/.exec(reference.ObjectName)
  if (!match) {
    throw new Error(`Unexpected ALS animation object name "${reference.ObjectName}"`)
  }
  return match[1]
}

function abpSequenceName(node: AbpNode) {
  const sequence = node.parameters.Sequence
  if (!sequence) throw new Error(`ALS ABP node "${node.property}" has no sequence`)
  return abpAnimationName(sequence)
}

function abpSequenceSelection(node: AbpNode): GraphSequenceSelection {
  const { Sequence: sequence, ExplicitTime: explicitTime } = node.parameters
  if (!sequence || typeof explicitTime !== 'number') {
    throw new Error(`ALS ABP node "${node.property}" is not a sequence evaluator`)
  }
  return {
    clipName: abpAnimationName(sequence),
    explicitTime,
    node,
  }
}

function abpUpstreamNodeIndices(asset: AbpAsset, target: AbpNode) {
  if (target.compiledIndex === null) {
    throw new Error(`ALS ABP target "${target.property}" has no compiled index`)
  }
  const upstream = new Set<number>()
  const pending = [target.compiledIndex]
  while (pending.length > 0) {
    const targetNodeIndex = pending.pop()!
    if (upstream.has(targetNodeIndex)) continue
    upstream.add(targetNodeIndex)
    for (const link of asset.wiring.poseLinks) {
      if (
        link.targetNodeIndex === targetNodeIndex
        && link.sourceNodeIndex >= 0
        && link.status === 'recovered'
      ) {
        pending.push(link.sourceNodeIndex)
      }
    }
  }
  return upstream
}

function abpStateResult(asset: AbpAsset, stateName: string) {
  const matches = asset.nodes.filter((node) =>
    node.type === 'FAnimNode_StateResult'
    && node.parameters.Name === stateName,
  )
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ALS ABP state result "${stateName}", got ${matches.length}`,
    )
  }
  return matches[0]
}

function abpStateSequenceSelection(asset: AbpAsset, stateName: string) {
  const upstream = abpUpstreamNodeIndices(asset, abpStateResult(asset, stateName))
  const sequences = asset.nodes
    .filter((node) =>
      node.compiledIndex !== null
      && upstream.has(node.compiledIndex)
      && node.parameters.Sequence,
    )
    .map(abpSequenceSelection)
  if (sequences.length !== 1) {
    throw new Error(
      `Expected one ALS ABP sequence upstream of "${stateName}", got ${sequences.length}`,
    )
  }
  return sequences[0]
}

function abpBranchFiltersForCachedPose(asset: AbpAsset, cachePoseName: string) {
  const matches = asset.wiring.poseLinks.flatMap((link) => {
    if (!link.targetInput.startsWith('BlendPoses[')) return []
    const source = asset.nodes.find(
      (node) => node.compiledIndex === link.sourceNodeIndex,
    )
    const target = asset.nodes.find(
      (node) => node.compiledIndex === link.targetNodeIndex,
    )
    if (source?.parameters.CachePoseName !== cachePoseName) return []
    if (target?.type !== 'FAnimNode_LayeredBoneBlend') return []
    const layerIndex = Number(/\[(\d+)\]/.exec(link.targetInput)?.[1])
    const filters = target.parameters.LayerSetup?.[layerIndex]?.BranchFilters
    return filters ? [filters] : []
  })
  if (matches.length === 0) {
    throw new Error(`No ALS branch filters consume cached pose "${cachePoseName}"`)
  }
  return matches
}

function abpHandBranchFilters(asset: AbpAsset) {
  const node = asset.nodes.find((candidate) =>
    candidate.type === 'FAnimNode_LayeredBoneBlend'
    && candidate.parameters.LayerSetup?.some((layer) =>
      layer.BranchFilters.some((filter) =>
        filter.BoneName.includes('_to_ik_hand_gun'),
      ),
    ),
  )
  if (!node?.parameters.LayerSetup) {
    throw new Error('Missing ALS hand/IK branch-filter node')
  }
  return node.parameters.LayerSetup.map((layer) => layer.BranchFilters)
}

const rifleGraph = abpAsset('AB_Als_Rifle')
const rifleGraphSelections = {
  Standing: abpSequenceSelection(abpSourceNode(
    rifleGraph,
    'AnimGraphNode_TwoWayBlend_1',
    'A',
  )),
  Crouching: abpSequenceSelection(abpSourceNode(
    rifleGraph,
    'AnimGraphNode_MultiWayBlend_3',
    'Poses[1]',
  )),
} as const

const rifleGraphSourceClips = {
  poses: rifleGraphSelections.Standing.clipName,
  runArms: abpSequenceName(abpSourceNode(
    rifleGraph,
    'AnimGraphNode_MultiWayBlend',
    'Poses[0]',
  )),
  sprintArms: abpSequenceName(abpSourceNode(
    rifleGraph,
    'AnimGraphNode_TwoWayBlend_2',
    'A',
  )),
} as const

const graphStanceBaseSelections = {
  Standing: abpStateSequenceSelection(abpAsset('AB_Als_Standing'), 'Idle'),
  Crouching: abpStateSequenceSelection(abpAsset('AB_Als_Crouching'), 'Idle'),
} as const

const graphStanceBaseClips = {
  Standing: graphStanceBaseSelections.Standing.clipName,
  Crouching: graphStanceBaseSelections.Crouching.clipName,
} as const

const RIFLE_GRAPH_CASES = [
  {
    stance: 'Standing',
    stateName: 'Relaxed',
    crouchingAmount: 0,
    baseClipName: graphStanceBaseClips.Standing,
    selection: rifleGraphSelections.Standing,
  },
  {
    stance: 'Crouching',
    stateName: 'Ready',
    crouchingAmount: 1,
    baseClipName: graphStanceBaseClips.Crouching,
    selection: rifleGraphSelections.Crouching,
  },
] as const

function loadAlsGltf() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new Promise<LoadedAlsGltf>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject)
  })
}

function clip(name: string) {
  const found = gltf.animations.find((animation) => animation.name === name)
  if (!found) throw new Error(`Missing ALS content-oracle clip "${name}"`)
  return found
}

function rawCurve(animation: THREE.AnimationClip, name: string): RawAlsCurve {
  const extras = animation.userData?.alsCurves
  if (!Array.isArray(extras)) {
    throw new Error(`${animation.name} has no ALS curve sidecar`)
  }
  const found = extras.find((curve) => curve?.name === name)
  if (!found || !Array.isArray(found.keys)) {
    throw new Error(`${animation.name} has no ${name} curve`)
  }
  return found as RawAlsCurve
}

function rifleEntries(
  rig: ReturnType<typeof createRigDefinition>,
  time: number,
): EvaluatorLayerEntry[] {
  const animation = clip(RIFLE_OVERLAY_CLIPS.poses)
  const sampler = compileClipSampler(animation, rig)
  const curves = compileClipCurveSamplers(animation)
  const source = { curves, time, weight: 1 }
  return RIFLE_OVERLAY_REGION_POLICY.map((policy) => ({
    sampler,
    time,
    weight: sampleRifleOverlayPolicyWeight(source, policy),
    loop: false,
    mask: compileBoneMask(rig, REGION_PREDICATES[policy.region]),
  }))
}

function transformComponents(pose: LocalPoseBuffer, bone: number): number[] {
  return [
    ...pose.positions.slice(bone * 3, bone * 3 + 3),
    ...pose.rotations.slice(bone * 4, bone * 4 + 4),
    ...pose.scales.slice(bone * 3, bone * 3 + 3),
  ]
}

function maximumComponentDelta(actual: number[], expected: number[]) {
  return actual.reduce(
    (maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])),
    0,
  )
}

function sampleRawCurve(curve: RawAlsCurve, time: number) {
  const { keys } = curve
  if (time <= keys[0][0]) return keys[0][1]
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1]
  let low = 0
  let high = keys.length - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (keys[middle][0] <= time) low = middle
    else high = middle
  }
  const alpha = (time - keys[low][0]) / (keys[high][0] - keys[low][0])
  const interpolationMode = keys[low][2]
  if (interpolationMode === 1) return keys[low][1]
  const curveAlpha = interpolationMode === 2
    ? alpha * alpha * (3 - 2 * alpha)
    : alpha
  return keys[low][1] + (keys[high][1] - keys[low][1]) * curveAlpha
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

beforeAll(async () => {
  gltf = await loadAlsGltf()
})

describe('ALS ABP content oracle: runtime-selected Rifle facts', () => {
  it.each(RIFLE_GRAPH_CASES)(
    '$stance pose-bank selection traces to the $stateName state graph',
    ({ stateName, crouchingAmount, selection }) => {
      const upstream = abpUpstreamNodeIndices(
        rifleGraph,
        abpStateResult(rifleGraph, stateName),
      )

      expect(selection.node.type).toBe('FAnimNode_SequenceEvaluator')
      expect(selection.node.compiledIndex).not.toBeNull()
      expect(upstream.has(selection.node.compiledIndex!)).toBe(true)
      expect(selection.node.parameters.bTeleportToExplicitTime).toBe(true)
      expect(selection.node.parameters.ReinitializationBehavior)
        .toBe('ESequenceEvalReinit::ExplicitTime')
      expect(resolveRiflePoseBankTime(crouchingAmount))
        .toBeCloseTo(selection.explicitTime, 6)
    },
  )

  it('interpolates between graph-authored Standing and Crouching ExplicitTimes', () => {
    const expectedMidpoint = (
      rifleGraphSelections.Standing.explicitTime
      + rifleGraphSelections.Crouching.explicitTime
    ) * 0.5
    expect(resolveRiflePoseBankTime(0.5)).toBeCloseTo(expectedMidpoint, 6)
  })

  it('selects pose, run-arm, and sprint-arm clips from the Rifle graph wiring', () => {
    expect(rifleGraphSelections.Crouching.clipName)
      .toBe(rifleGraphSelections.Standing.clipName)
    expect(RIFLE_OVERLAY_CLIPS).toEqual(rifleGraphSourceClips)
    for (const clipName of Object.values(rifleGraphSourceClips)) {
      expect(() => clip(clipName)).not.toThrow()
    }
  })

  it.each([
    ['Standing', graphStanceBaseSelections.Standing],
    ['Crouching', graphStanceBaseSelections.Crouching],
  ] as const)(
    '%s idle base clip is the sole sequence upstream of its ABP state result',
    (_, selection) => {
      expect(selection.node.type).toBe('FAnimNode_SequenceEvaluator')
      expect(selection.node.parameters.bTeleportToExplicitTime).toBe(true)
      expect(() => clip(selection.clipName)).not.toThrow()
    },
  )

  it('maps AB_Als_Layering branch roots onto the runtime region predicates', () => {
    const layering = abpAsset('AB_Als_Layering')
    const policyRegions = new Set(
      RIFLE_OVERLAY_REGION_POLICY.map((policy) => policy.region),
    )

    for (const filters of abpBranchFiltersForCachedPose(layering, 'Pelvis')) {
      const included = filters.filter((filter) => filter.BlendDepth >= 0)
      const excluded = filters.filter((filter) => filter.BlendDepth < 0)
      expect(included.length).toBeGreaterThan(0)
      expect(excluded.length).toBeGreaterThan(0)
      for (const filter of included) {
        expect(REGION_PREDICATES.pelvis(filter.BoneName), filter.BoneName).toBe(true)
      }
      for (const filter of excluded) {
        expect(REGION_PREDICATES.pelvis(filter.BoneName), filter.BoneName).toBe(false)
      }
    }

    for (const filters of abpBranchFiltersForCachedPose(layering, 'Spine')) {
      for (const filter of filters) {
        expect(REGION_PREDICATES.spine(filter.BoneName), filter.BoneName).toBe(true)
      }
    }
    for (const filters of abpBranchFiltersForCachedPose(layering, 'Head')) {
      for (const filter of filters) {
        expect(REGION_PREDICATES.head(filter.BoneName), filter.BoneName).toBe(true)
      }
    }
    for (const filters of abpBranchFiltersForCachedPose(layering, 'Arm Left')) {
      for (const filter of filters) {
        expect(REGION_PREDICATES.armLeft(filter.BoneName), filter.BoneName).toBe(true)
      }
    }
    for (const filters of abpBranchFiltersForCachedPose(layering, 'Arm Right')) {
      for (const filter of filters) {
        expect(REGION_PREDICATES.armRight(filter.BoneName), filter.BoneName).toBe(true)
      }
    }

    for (const filters of abpHandBranchFilters(layering)) {
      const side = filters.some((filter) => filter.BoneName.includes('hand_l'))
        ? 'Left'
        : 'Right'
      const predicate = side === 'Left'
        ? REGION_PREDICATES.handLeft
        : REGION_PREDICATES.handRight
      const deformingBones = filters.filter(
        (filter) => !filter.BoneName.startsWith('VB '),
      )
      const ikGunVirtualBones = filters.filter(
        (filter) => filter.BoneName.includes('_to_ik_hand_gun'),
      )

      expect(deformingBones.length).toBeGreaterThan(0)
      for (const filter of deformingBones) {
        expect(predicate(filter.BoneName), filter.BoneName).toBe(true)
      }
      expect(ikGunVirtualBones).toHaveLength(1)
      expect(policyRegions.has(side === 'Left' ? 'ikHandLeft' : 'ikHandRight'))
        .toBe(true)
    }
  })
})

describe('ALS content oracle: crouch under Rifle', () => {
  it('traces pelvis and both thigh locals to the crouching ABP idle clip', () => {
    const rig = createRigDefinition(gltf.scene)
    const selection = rifleGraphSelections.Crouching
    const crouchSampler = compileClipSampler(
      clip(graphStanceBaseClips.Crouching),
      rig,
    )
    const rifleSampler = compileClipSampler(clip(selection.clipName), rig)
    const runtimeBankTime = resolveRiflePoseBankTime(1)
    const crouchPose = sampleClip(
      crouchSampler,
      rig,
      0,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const riflePose = sampleClip(
      rifleSampler,
      rig,
      selection.explicitTime,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const result = evaluatePose(createPoseEvaluator(rig), {
      base: [{ sampler: crouchSampler, time: 0, weight: 1, loop: false }],
      overlays: rifleEntries(rig, runtimeBankTime),
    })

    for (const boneName of ['pelvis', 'thigh_l', 'thigh_r']) {
      const bone = findBoneIndex(rig, boneName)
      const actual = transformComponents(result.pose, bone)
      const expected = transformComponents(crouchPose, bone)
      const wrongSource = transformComponents(riflePose, bone)
      expect(
        maximumComponentDelta(actual, expected),
        `${boneName} did not trace to ${graphStanceBaseClips.Crouching}`,
      ).toBeLessThanOrEqual(POSE_EPSILON)
      expect(maximumComponentDelta(actual, wrongSource), boneName)
        .toBeGreaterThan(0.01)
    }
  })
})

describe('ALS content oracle: Rifle ik_hand_gun bank trace', () => {
  it.each(RIFLE_GRAPH_CASES)(
    '$stance final ik_hand_gun local transform traces to the selected ABP evaluator',
    ({ baseClipName, crouchingAmount, selection }) => {
      const rig = createRigDefinition(gltf.scene)
      const baseSampler = compileClipSampler(clip(baseClipName), rig)
      const rifleSampler = compileClipSampler(clip(selection.clipName), rig)
      const runtimeBankTime = resolveRiflePoseBankTime(crouchingAmount)
      const riflePose = sampleClip(
        rifleSampler,
        rig,
        selection.explicitTime,
        createPoseBuffer(rig.boneCount),
        false,
      )
      const basePose = sampleClip(
        baseSampler,
        rig,
        0,
        createPoseBuffer(rig.boneCount),
        false,
      )
      const result = evaluatePose(createPoseEvaluator(rig), {
        base: [{ sampler: baseSampler, time: 0, weight: 1, loop: false }],
        overlays: rifleEntries(rig, runtimeBankTime),
      })
      const bone = findBoneIndex(rig, 'ik_hand_gun')
      const actual = transformComponents(result.pose, bone)
      const expected = transformComponents(riflePose, bone)

      expect(maximumComponentDelta(actual, expected))
        .toBeLessThanOrEqual(POSE_EPSILON)
      expect(maximumComponentDelta(expected, transformComponents(basePose, bone)))
        .toBeGreaterThan(1e-3)
    },
  )
})

describe('ALS content oracle: stance-transition PoseCrouching', () => {
  it.each([
    ['A_Als_StandToCrouch', 1],
    ['A_Als_CrouchToStand', 0],
  ])('%s crouchingAmount matches its authored PoseCrouching values', (
    clipName,
    targetCrouchingAmount,
  ) => {
    const animation = clip(clipName)
    const raw = rawCurve(animation, 'PoseCrouching')
    const curves = compileClipCurveSamplers(animation)
    const state = createAlsStanceTransitionCurveState()
    const endTime = raw.keys[raw.keys.length - 1][0]
    const times = [0, endTime * 0.25, endTime * 0.5, endTime, animation.duration]

    for (const time of times) {
      refreshStanceTransition(state, targetCrouchingAmount, 0, { time, curves })
      expect(Math.abs(
        state.crouchingAmount - clamp01(sampleRawCurve(raw, time)),
      )).toBeLessThanOrEqual(CURVE_EPSILON)
    }
  })
})

const TURN_CASES = (
  ['Standing', 'Crouching'] as const
).flatMap((stance) => (
  [90, 180] as const
).flatMap((angle) => (
  ['Left', 'Right'] as const
).map((direction) => ({
  stance,
  angle,
  direction,
  settings: ALS_TURN_IN_PLACE_SETTINGS.clips[stance][angle][direction],
}))))

describe('ALS content oracle: turn-in-place RotationYawSpeed integral', () => {
  it.each(TURN_CASES)(
    '$stance $angle $direction integrates to the authored signed yaw',
    ({ direction, settings }) => {
      const animation = clip(settings.clip)
      const raw = rawCurve(animation, 'RotationYawSpeed')
      const sampler = compileClipCurveSamplers(animation).RotationYawSpeed
      if (!sampler) throw new Error(`${animation.name} did not compile RotationYawSpeed`)

      let integratedYaw = 0
      for (let index = 1; index < raw.keys.length; index++) {
        const previousTime = raw.keys[index - 1][0]
        const time = raw.keys[index][0]
        // AlsCharacter.cpp:1798-1809 applies RotationYawSpeed * DeltaTime.
        // The sidecar is linear, so trapezoidal integration is exact at its authored keys.
        integratedYaw += (
          sampler(previousTime) + sampler(time)
        ) * 0.5 * (time - previousTime)
      }

      const expectedYaw = settings.animatedTurnAngle
        * (direction === 'Left' ? -1 : 1)
      expect(Math.abs(integratedYaw - expectedYaw))
        .toBeLessThanOrEqual(YAW_INTEGRAL_EPSILON)
    },
  )
})

const GAIT_CASES = [
  {
    name: 'Standing Walking',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.walk,
    crouchingAmount: 0,
    expectedKey: 'walkFwd',
  },
  {
    name: 'Standing Running',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.run,
    crouchingAmount: 0,
    expectedKey: 'runFwd',
  },
  {
    name: 'Standing Sprinting',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
    crouchingAmount: 0,
    expectedKey: 'sprint',
  },
  {
    name: 'Crouching Walking',
    speed: ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    crouchingAmount: 1,
    expectedKey: 'crouchFwd',
  },
] as const

describe('ALS content oracle: authored gait speed purity and coverage', () => {
  it.each(GAIT_CASES)('$name is pure and sums to authored coverage', ({
    speed,
    crouchingAmount,
    expectedKey,
  }) => {
    const standWeights = [0, 0, 0, 0]
    const crouchMoveWeight = updateLocomotionTargets(
      speed,
      standWeights,
      ALS_AUTHORED_GAIT_SPEEDS.standing,
      ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    )
    const input: WeightTableInput = {
      standWeights,
      crouchMoveWeight,
      crouchingAmount,
      inAirAmount: 0,
      montageGate: 0,
      velocityBlend: {
        forwardAmount: 1,
        backwardAmount: 0,
        leftAmount: 0,
        rightAmount: 0,
      },
    }
    const weights = computeWeightTable(input, createWeightTable())

    expect(Math.abs(weights[expectedKey] - 1)).toBeLessThanOrEqual(WEIGHT_EPSILON)
    expect(Math.abs(legRegionWeight(weights) - 1))
      .toBeLessThanOrEqual(WEIGHT_EPSILON)
    expect(Math.abs(armRegionWeight(weights) - 1))
      .toBeLessThanOrEqual(WEIGHT_EPSILON)
  })
})
