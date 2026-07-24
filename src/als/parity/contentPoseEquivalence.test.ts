/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyPose, createPoseApplicator } from '../../engine/applyPose'
import { compileClipSampler, sampleClip } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { createPoseBuffer } from '../../engine/poseBuffer'
import { createRigDefinition } from '../../engine/rig'
import {
  RIFLE_OVERLAY_CLIPS,
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

const CURVE_EPSILON = 1e-5
const YAW_INTEGRAL_EPSILON = 1e-3
const WEIGHT_EPSILON = 1e-6
const SOURCE_POSE_POSITION_EPSILON_METERS = 2e-6
const SOURCE_MESH_CONTACT_EPSILON_METERS = 2e-6

/**
 * Extracted from ALS Refactored 4.15 commit b3cbf4305358606746f47778f1c2753cd8e3a35a,
 * Content/ALS/Animations/Base/A_Als_Crouch_Pose.uasset. These are named component-space
 * positions from its AnimDataModel raw tracks after the exact UE-cm/Z-up to glTF-m/Y-up basis
 * conversion. The source pose deliberately plants the right knee and raises the right heel.
 */
const ALS_4_15_CROUCH_POSE_COMPONENT_POSITIONS = {
  pelvis: [0.020789826, 0.4235864, -0.15575754],
  thigh_l: [0.103712985, 0.409078887, -0.120234404],
  calf_l: [0.130257361, 0.531134575, 0.284621168],
  foot_l: [0.14076321, 0.134653483, 0.219278324],
  ball_l: [0.139961304, 0.030118119, 0.385058762],
  thigh_r: [-0.065705809, 0.409080753, -0.181382522],
  calf_r: [-0.286446921, 0.056300693, -0.098038535],
  foot_r: [-0.012380614, 0.198906433, -0.35519464],
  ball_r: [0.053417679, 0.030216078, -0.430197056],
} as const

/**
 * Source pose applied to the shipped rigid SKM_Als geometry. The right `foot_r` section is the
 * raised heel; `ball_r` is its grounded toe section. Standing is retained as an independent
 * same-mesh floor reference.
 */
const ALS_4_15_CROUCH_POSE_CONTACT_Y_METERS = {
  mesh: -0.001400218,
  foot_l: -0.001400218,
  ball_l: 0.001127739,
  foot_r: 0.016329523,
  ball_r: 0.001227183,
  standingMesh: -0.001400179,
} as const

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

interface AbpPoseLinkParameter {
  readonly LinkID: number
  readonly SourceLinkID: number
}

interface AbpNode {
  readonly compiledIndex: number | null
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly Name?: string
    readonly A?: AbpPoseLinkParameter
    readonly B?: AbpPoseLinkParameter
    readonly Base?: AbpPoseLinkParameter
    readonly Additive?: AbpPoseLinkParameter
    readonly Result?: AbpPoseLinkParameter
    readonly Poses?: readonly AbpPoseLinkParameter[]
    readonly Sequence?: AbpSequenceReference
    readonly ExplicitTime?: number
    readonly bTeleportToExplicitTime?: boolean
    readonly ReinitializationBehavior?: string
    readonly GroupName?: string
    readonly GroupRole?: string
    readonly Method?: string
    readonly PlayRate?: number
    readonly Alpha?: number
    readonly bNormalizeAlpha?: boolean
    readonly bResetChildOnActivation?: boolean
    readonly AlphaScaleBiasClamp?: {
      readonly bMapRange: boolean
      readonly InRange: { readonly Min: number; readonly Max: number }
      readonly OutRange: { readonly Min: number; readonly Max: number }
      readonly InterpSpeedIncreasing: number
      readonly InterpSpeedDecreasing: number
    }
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

function abpCompiledNode(asset: AbpAsset, index: number) {
  const node = asset.nodes.find((candidate) => candidate.compiledIndex === index)
  if (!node) throw new Error(`Missing ALS ABP compiled node ${index}`)
  return node
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

const rifleGraph = abpAsset('AB_Als_Rifle')

const rifleGraphSourceClips = {
  poses: abpSequenceName(abpCompiledNode(rifleGraph, 46)),
  runArms: abpSequenceName(abpCompiledNode(rifleGraph, 39)),
  sprintArms: abpSequenceName(abpCompiledNode(rifleGraph, 38)),
  sprintImpulseArms: abpSequenceName(abpCompiledNode(rifleGraph, 37)),
} as const

const graphStanceBaseSelections = {
  Standing: abpStateSequenceSelection(abpAsset('AB_Als_Standing'), 'Idle'),
  Crouching: abpStateSequenceSelection(abpAsset('AB_Als_Crouching'), 'Idle'),
} as const

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

function posedMeshFloor(scene: THREE.Object3D) {
  let mesh = Number.POSITIVE_INFINITY
  const byBone = new Map<string, number>()
  const vertex = new THREE.Vector3()

  scene.updateMatrixWorld(true)
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const positions = object.geometry.getAttribute('position')
    const skinIndices = object.geometry.getAttribute('skinIndex')
    if (!positions || !skinIndices) {
      throw new Error(`${object.name} is missing skinned position data`)
    }

    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions, index)
      object.applyBoneTransform(index, vertex)
      vertex.applyMatrix4(object.matrixWorld)
      mesh = Math.min(mesh, vertex.y)

      const bone = object.skeleton.bones[skinIndices.getX(index)]
      if (!bone) {
        throw new Error(`${object.name} vertex ${index} targets a missing bone`)
      }
      byBone.set(
        bone.name,
        Math.min(byBone.get(bone.name) ?? Number.POSITIVE_INFINITY, vertex.y),
      )
    }
  })

  if (!Number.isFinite(mesh)) throw new Error('SKM_Als has no skinned vertices')
  return { mesh, byBone }
}

beforeAll(async () => {
  gltf = await loadAlsGltf()
})

describe('ALS ABP content oracle: AB_Als_Rifle Relaxed topology', () => {
  it('keeps the exact compiled node tree instead of an inferred region policy', () => {
    const relaxed = abpStateResult(rifleGraph, 'Relaxed')
    expect(relaxed.compiledIndex).toBe(48)
    expect([...abpUpstreamNodeIndices(rifleGraph, relaxed)].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 22 }, (_, index) => index + 27))

    expect(relaxed.parameters.Result).toEqual({ LinkID: 34, SourceLinkID: 48 })
    expect(abpCompiledNode(rifleGraph, 34)).toMatchObject({
      type: 'FAnimNode_ApplyAdditive',
      parameters: {
        Base: { LinkID: 32 },
        Additive: { LinkID: 33 },
        Alpha: 0.75,
      },
    })
    expect(abpCompiledNode(rifleGraph, 32).parameters).toMatchObject({
      A: { LinkID: 27 },
      B: { LinkID: 30 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 10,
      },
    })
    expect(abpCompiledNode(rifleGraph, 27).parameters).toMatchObject({
      Poses: [{ LinkID: 47 }, { LinkID: 44 }],
      bNormalizeAlpha: true,
    })
    expect(abpCompiledNode(rifleGraph, 47).parameters).toMatchObject({
      A: { LinkID: 46 },
      B: { LinkID: 43 },
    })
    expect(abpCompiledNode(rifleGraph, 43).parameters).toMatchObject({
      A: { LinkID: 45 },
      B: { LinkID: 40 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 5,
      },
    })
    expect(abpCompiledNode(rifleGraph, 40).parameters).toMatchObject({
      A: { LinkID: 28 },
      B: { LinkID: 41 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 0,
        InterpSpeedDecreasing: 5,
      },
    })
    expect(abpCompiledNode(rifleGraph, 41).parameters).toMatchObject({
      A: { LinkID: 38 },
      B: { LinkID: 37 },
      bResetChildOnActivation: true,
      AlphaScaleBiasClamp: {
        bMapRange: true,
        InRange: { Min: 0, Max: 0.25 },
        OutRange: { Min: 0, Max: 1 },
        InterpSpeedIncreasing: 20,
        InterpSpeedDecreasing: 0.5,
      },
    })
    expect(abpCompiledNode(rifleGraph, 28).parameters).toMatchObject({
      Poses: [
        { LinkID: 39 },
        { LinkID: 42 },
        { LinkID: 36 },
        { LinkID: 35 },
      ],
      bNormalizeAlpha: true,
    })
    expect(abpCompiledNode(rifleGraph, 30).parameters).toMatchObject({
      A: { LinkID: 31 },
      B: { LinkID: 29 },
      AlphaScaleBiasClamp: {
        InterpSpeedIncreasing: 20,
        InterpSpeedDecreasing: 5,
      },
    })
  })

  it('pins all pose-bank coordinates to their actual Relaxed evaluator nodes', () => {
    const evaluators = [
      [46, 0],
      [45, 0.05],
      [44, 0.216667],
      [42, 0.05],
      [36, 0.05],
      [35, 0.05],
      [31, 0.316667],
      [29, 0.35],
    ] as const

    for (const [index, explicitTime] of evaluators) {
      const selection = abpSequenceSelection(abpCompiledNode(rifleGraph, index))
      expect(selection.clipName).toBe(RIFLE_OVERLAY_CLIPS.poses)
      expect(selection.explicitTime).toBe(explicitTime)
      expect(selection.node.type).toBe('FAnimNode_SequenceEvaluator')
      expect(selection.node.parameters.bTeleportToExplicitTime).toBe(true)
      expect(selection.node.parameters.ReinitializationBehavior)
        .toBe('ESequenceEvalReinit::ExplicitTime')
    }
  })

  it('selects all four authored Rifle assets from the exact player/evaluator nodes', () => {
    expect(RIFLE_OVERLAY_CLIPS).toEqual(rifleGraphSourceClips)
    expect(abpSequenceName(abpCompiledNode(rifleGraph, 33))).toBe('A_Als_Idle')

    for (const index of [37, 38, 39]) {
      expect(abpCompiledNode(rifleGraph, index).parameters).toMatchObject({
        GroupName: 'Movement',
        GroupRole: 'EAnimGroupRole::AlwaysFollower',
        Method: 'EAnimSyncMethod::SyncGroup',
        PlayRate: 0,
      })
    }
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
})

describe('ALS content oracle: authored crouching idle pose', () => {
  it('preserves the one-knee component pose and its exact grounded contacts', () => {
    const crouchingSelection = graphStanceBaseSelections.Crouching
    const standingSelection = graphStanceBaseSelections.Standing
    const rig = createRigDefinition(gltf.scene)
    const applicator = createPoseApplicator(gltf.scene, rig)
    const crouchingClip = clip(crouchingSelection.clipName)
    const crouchingSampler = compileClipSampler(crouchingClip, rig)
    const crouchingPose = sampleClip(
      crouchingSampler,
      rig,
      crouchingSelection.explicitTime,
      createPoseBuffer(rig.boneCount),
      false,
    )

    expect(rig.boneCount).toBe(68)
    expect(crouchingClip.tracks).toHaveLength(136)
    expect(crouchingSampler.bindings).toHaveLength(136)
    applyPose(applicator, crouchingPose)
    gltf.scene.updateMatrixWorld(true)
    const componentPositions = new Map<string, THREE.Vector3>()
    for (const [boneName, expectedPosition] of Object.entries(
      ALS_4_15_CROUCH_POSE_COMPONENT_POSITIONS,
    )) {
      const bone = gltf.scene.getObjectByName(boneName)
      if (!(bone instanceof THREE.Bone)) {
        throw new Error(`Missing ALS crouch-pose bone ${boneName}`)
      }
      const componentPosition = bone.getWorldPosition(new THREE.Vector3())
      componentPositions.set(boneName, componentPosition)
      expect(
        componentPosition.distanceTo(new THREE.Vector3(...expectedPosition)),
        `${boneName} component-space position`,
      ).toBeLessThanOrEqual(SOURCE_POSE_POSITION_EPSILON_METERS)
    }

    // This relationship is the visible authored design, not an extraction accident: the right
    // knee is nearly on the floor while the left knee remains above the planted left foot.
    const calfLeft = componentPositions.get('calf_l')!
    const calfRight = componentPositions.get('calf_r')!
    expect(calfLeft.y - calfRight.y).toBeGreaterThan(0.47)

    const crouchingFloor = posedMeshFloor(gltf.scene)
    const standingClip = clip(standingSelection.clipName)
    applyPose(
      applicator,
      sampleClip(
        compileClipSampler(standingClip, rig),
        rig,
        standingSelection.explicitTime,
        createPoseBuffer(rig.boneCount),
        false,
      ),
    )
    const standingFloor = posedMeshFloor(gltf.scene)

    expect(Math.abs(
      crouchingFloor.mesh - ALS_4_15_CROUCH_POSE_CONTACT_Y_METERS.mesh,
    )).toBeLessThanOrEqual(SOURCE_MESH_CONTACT_EPSILON_METERS)
    expect(Math.abs(
      standingFloor.mesh
        - ALS_4_15_CROUCH_POSE_CONTACT_Y_METERS.standingMesh,
    )).toBeLessThanOrEqual(SOURCE_MESH_CONTACT_EPSILON_METERS)
    expect(Math.abs(crouchingFloor.mesh - standingFloor.mesh))
      .toBeLessThanOrEqual(SOURCE_MESH_CONTACT_EPSILON_METERS)
    for (const boneName of ['foot_l', 'ball_l', 'foot_r', 'ball_r'] as const) {
      expect(
        Math.abs(
          crouchingFloor.byBone.get(boneName)!
            - ALS_4_15_CROUCH_POSE_CONTACT_Y_METERS[boneName],
        ),
        `${boneName} skinned-section floor contact`,
      ).toBeLessThanOrEqual(SOURCE_MESH_CONTACT_EPSILON_METERS)
    }
    expect(crouchingFloor.byBone.get('foot_r'))
      .toBeGreaterThan(0.015)
    expect(crouchingFloor.byBone.get('ball_r'))
      .toBeLessThan(0.002)
  })
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
