/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileClipSampler, sampleClip } from '../../engine/clipSampler'
import { createPoseBuffer } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import { createRigDefinition } from '../../engine/rig'
import {
  ALS_STANCE_TRANSITION_EXIT_DURATION,
  ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION,
  ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE,
} from '../AnimGraph/groundedStance'
import {
  ALS_CONTROL_RIG_FOOT_IK,
  ALS_CONTROL_RIG_FORWARD_SOLVE,
  ALS_CONTROL_RIG_HAND_IK,
} from '../AnimGraph/CR_Als'
import { createAlsAnimationInstance } from '../AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from '../AlsAnimationInstance'

const FPS = 60
const DT = 1 / FPS
const NO_IGNORED_BONES: ReadonlySet<string> = new Set()

// These are exactly the local-pose items written by CR_Als Forward Solve's authored SetScale,
// DistributeRotationSimple, foot BasicIK, and hand BasicIK nodes. Targets and propagated children
// remain in the graph-owned metric; this must never become a limb-prefix exclusion.
const CONTROL_RIG_OWNED_LOCAL_BONES = new Set<string>([
  ALS_CONTROL_RIG_FORWARD_SOLVE.diagonalScaling
    .footRootBoneWhenUsingFootIkBones,
  ALS_CONTROL_RIG_FORWARD_SOLVE.diagonalScaling
    .footRootBoneOtherwise,
  ...ALS_CONTROL_RIG_FORWARD_SOLVE.spineRotationBones,
  ...ALS_CONTROL_RIG_FOOT_IK.feet.flatMap((foot) => [
    foot.pelvisItem,
    foot.thighItem,
    foot.calfItem,
    foot.footItem,
  ]),
  ...ALS_CONTROL_RIG_HAND_IK.flatMap((hand) => [
    hand.itemA,
    hand.itemB,
    hand.effectorItem,
  ]),
])
const FOOT_EFFECTOR_BOUNDARY_POSITION_TOLERANCE_METERS = 1e-4
const FOOT_EFFECTOR_BOUNDARY_ROTATION_TOLERANCE_DEGREES = 0.01

type Stance = 'Standing' | 'Crouching'
type OwnerPath = readonly [blueprint: string, machine: string, state: string]

interface AbpNode {
  readonly compiledIndex: number | null
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly Sequence?: { readonly ObjectName: string }
    readonly ExplicitTime?: number
    readonly StartPosition?: number
    readonly PlayRate?: number
    readonly Method?: string
    readonly bLoopAnimation?: boolean
    readonly bStartFromMatchingPose?: boolean
    readonly bTeleportToExplicitTime?: boolean
    readonly ReinitializationBehavior?: string
  }
}

interface AbpTransition {
  readonly PreviousStateName: string
  readonly NextStateName: string
  readonly CrossfadeDuration: number
  readonly LogicType: string
}

interface AbpMachine {
  readonly MachineName: string
  readonly States: readonly {
    readonly StateName: string
    readonly PlayerNodeCompiledIndices: readonly number[]
  }[]
  readonly Transitions: readonly AbpTransition[]
}

interface AbpAsset {
  readonly nodes: readonly AbpNode[]
  readonly stateMachines: readonly AbpMachine[]
}

interface Gltf {
  readonly animations: THREE.AnimationClip[]
  readonly scene: THREE.Group
}

interface Frame {
  readonly kind: string
  readonly owner: string
  readonly frame: number | null
  readonly time: number
  readonly pose: LocalPoseBuffer
}

interface Peak {
  readonly value: number
  readonly bone: string
}

interface Delta {
  readonly from: Omit<Frame, 'pose'>
  readonly to: Omit<Frame, 'pose'>
  readonly rotationDegrees: Peak
  readonly translationMeters: Peak
  readonly scale: Peak
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as { readonly assets: Readonly<Record<string, AbpAsset>> }

const specs = [
  {
    name: 'Standing To Crouching',
    sourceStance: 'Standing',
    destinationStance: 'Crouching',
    source: ['AB_Als_Standing', 'Standing States', 'Idle'],
    transition: [
      'AB_Als_Grounded',
      'Grounded States',
      'Standing To Crouching',
    ],
    destination: ['AB_Als_Crouching', 'Crouching States', 'Idle'],
  },
  {
    name: 'Crouching To Standing',
    sourceStance: 'Crouching',
    destinationStance: 'Standing',
    source: ['AB_Als_Crouching', 'Crouching States', 'Idle'],
    transition: [
      'AB_Als_Grounded',
      'Grounded States',
      'Crouching To Standing',
    ],
    destination: ['AB_Als_Standing', 'Standing States', 'Idle'],
  },
] as const satisfies readonly {
  readonly name: string
  readonly sourceStance: Stance
  readonly destinationStance: Stance
  readonly source: OwnerPath
  readonly transition: OwnerPath
  readonly destination: OwnerPath
}[]

let glbData: ArrayBuffer

function loadGltf() {
  return new Promise<Gltf>((resolve, reject) => {
    new GLTFLoader().parse(glbData.slice(0), '', resolve, reject)
  })
}

function animationName(objectName: string | undefined) {
  const match = objectName && /^AnimSequence'([^']+)'$/.exec(objectName)
  if (!match) throw new Error('ALS player node has no animation sequence')
  return match[1]
}

function resolveOwner([blueprint, machineName, stateName]: OwnerPath) {
  const asset = graph.assets[blueprint]
  const machine = asset?.stateMachines.find(
    (candidate) => candidate.MachineName === machineName,
  )
  const state = machine?.States.find(
    (candidate) => candidate.StateName === stateName,
  )
  if (!asset || !machine || !state) {
    throw new Error(`Missing ALS graph owner ${blueprint}/${machineName}/${stateName}`)
  }
  if (state.PlayerNodeCompiledIndices.length !== 1) {
    throw new Error(`${stateName} must own exactly one player node`)
  }
  const node = asset.nodes.find(
    (candidate) =>
      candidate.compiledIndex === state.PlayerNodeCompiledIndices[0],
  )
  if (!node) throw new Error(`Missing player node for ${stateName}`)
  return {
    blueprint,
    machine: machineName,
    state: stateName,
    node: node.property,
    nodeType: node.type,
    clip: animationName(node.parameters.Sequence?.ObjectName),
    time: node.parameters.ExplicitTime ?? node.parameters.StartPosition ?? 0,
    parameters: node.parameters,
    machineData: machine,
  }
}

function resolveSpec(spec: typeof specs[number]) {
  const source = resolveOwner(spec.source)
  const transition = resolveOwner(spec.transition)
  const destination = resolveOwner(spec.destination)
  const incoming = transition.machineData.Transitions.find((edge) =>
    edge.PreviousStateName === spec.sourceStance
    && edge.NextStateName === transition.state,
  )
  const outgoing = transition.machineData.Transitions.find((edge) =>
    edge.PreviousStateName === transition.state
    && edge.NextStateName === spec.destinationStance
    && edge.CrossfadeDuration === 0,
  )
  if (!incoming || !outgoing) {
    throw new Error(`${transition.state} has no authored entry/exit edge`)
  }
  return { spec, source, transition, destination, incoming, outgoing }
}

function clip(gltf: Gltf, name: string) {
  const result = gltf.animations.find((candidate) => candidate.name === name)
  if (!result) throw new Error(`Missing ALS GLB clip "${name}"`)
  return result
}

function withoutPose({ pose: _pose, ...frame }: Frame): Omit<Frame, 'pose'> {
  return frame
}

function delta(
  rig: ReturnType<typeof createRigDefinition>,
  from: Frame,
  to: Frame,
  ignoredBoneNames: ReadonlySet<string> = NO_IGNORED_BONES,
): Delta {
  let rotationDegrees: Peak = { value: 0, bone: rig.boneNames[0] ?? '' }
  let translationMeters: Peak = { value: 0, bone: rig.boneNames[0] ?? '' }
  let scale: Peak = { value: 0, bone: rig.boneNames[0] ?? '' }

  for (let bone = 0; bone < rig.boneCount; bone++) {
    if (ignoredBoneNames.has(rig.boneNames[bone])) continue
    const p = bone * 3
    const q = bone * 4
    const translation = Math.hypot(
      to.pose.positions[p] - from.pose.positions[p],
      to.pose.positions[p + 1] - from.pose.positions[p + 1],
      to.pose.positions[p + 2] - from.pose.positions[p + 2],
    )
    const scaleDistance = Math.hypot(
      to.pose.scales[p] - from.pose.scales[p],
      to.pose.scales[p + 1] - from.pose.scales[p + 1],
      to.pose.scales[p + 2] - from.pose.scales[p + 2],
    )
    const dot = Math.abs(
      to.pose.rotations[q] * from.pose.rotations[q]
      + to.pose.rotations[q + 1] * from.pose.rotations[q + 1]
      + to.pose.rotations[q + 2] * from.pose.rotations[q + 2]
      + to.pose.rotations[q + 3] * from.pose.rotations[q + 3],
    )
    const angle = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, dot)))
    const boneName = rig.boneNames[bone]
    if (angle > rotationDegrees.value) {
      rotationDegrees = { value: angle, bone: boneName }
    }
    if (translation > translationMeters.value) {
      translationMeters = { value: translation, bone: boneName }
    }
    if (scaleDistance > scale.value) {
      scale = { value: scaleDistance, bone: boneName }
    }
  }
  return {
    from: withoutPose(from),
    to: withoutPose(to),
    rotationDegrees,
    translationMeters,
    scale,
  }
}

function deltas(
  rig: ReturnType<typeof createRigDefinition>,
  frames: readonly Frame[],
  ignoredBoneNames: ReadonlySet<string> = NO_IGNORED_BONES,
) {
  return frames.slice(1).map((frame, index) =>
    delta(rig, frames[index], frame, ignoredBoneNames)
  )
}

function componentBoneTransform(
  rig: ReturnType<typeof createRigDefinition>,
  frame: Frame,
  boneName: string,
) {
  const boneIndex = rig.boneNames.indexOf(boneName)
  if (boneIndex < 0) throw new Error(`Missing bone "${boneName}"`)
  const hierarchy: number[] = []
  for (let index = boneIndex; index >= 0; index = rig.parentIndices[index]) {
    hierarchy.push(index)
  }
  const matrix = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  for (let index = hierarchy.length - 1; index >= 0; index--) {
    const bone = hierarchy[index]
    local.compose(
      position.fromArray(frame.pose.positions, bone * 3),
      rotation.fromArray(frame.pose.rotations, bone * 4),
      scale.fromArray(frame.pose.scales, bone * 3),
    )
    matrix.multiply(local)
  }
  matrix.decompose(position, rotation, scale)
  return { position: position.clone(), rotation: rotation.clone() }
}

function componentBoneDelta(
  rig: ReturnType<typeof createRigDefinition>,
  from: Frame,
  to: Frame,
  boneName: string,
) {
  const a = componentBoneTransform(rig, from, boneName)
  const b = componentBoneTransform(rig, to, boneName)
  return {
    positionMeters: a.position.distanceTo(b.position),
    rotationDegrees: THREE.MathUtils.radToDeg(a.rotation.angleTo(b.rotation)),
  }
}

function worst(samples: readonly Delta[], metric: keyof Pick<
  Delta,
  'rotationDegrees' | 'translationMeters' | 'scale'
>) {
  return samples.reduce((result, sample) =>
    sample[metric].value > result[metric].value ? sample : result
  )
}

function authoredReport(gltf: Gltf, ownership: ReturnType<typeof resolveSpec>) {
  const rig = createRigDefinition(gltf.scene)
  const samplers = new Map<string, ReturnType<typeof compileClipSampler>>()
  const sample = (
    owner: typeof ownership.source,
    kind: string,
    time: number,
    frame: number | null,
  ): Frame => {
    let sampler = samplers.get(owner.clip)
    if (!sampler) {
      sampler = compileClipSampler(clip(gltf, owner.clip), rig)
      samplers.set(owner.clip, sampler)
    }
    return {
      kind,
      owner: `${owner.blueprint}/${owner.machine}/${owner.state}/${owner.node}`,
      frame,
      time,
      pose: sampleClip(
        sampler,
        rig,
        time,
        createPoseBuffer(rig.boneCount),
        false,
      ),
    }
  }

  const transitionClip = clip(gltf, ownership.transition.clip)
  const playRate = ownership.transition.parameters.PlayRate ?? 0
  const clipStep = playRate / FPS
  const frameCount = Math.ceil(
    (transitionClip.duration - ownership.transition.time) / clipStep,
  )
  const frames = [
    sample(ownership.source, 'source-last', ownership.source.time, null),
    sample(
      ownership.transition,
      'transition-start',
      ownership.transition.time,
      0,
    ),
  ]
  for (let frame = 1; frame <= frameCount; frame++) {
    frames.push(sample(
      ownership.transition,
      'transition-runtime',
      Math.min(
        transitionClip.duration,
        ownership.transition.time + clipStep * frame,
      ),
      frame,
    ))
  }
  frames.push(sample(
    ownership.destination,
    'destination-first',
    ownership.destination.time,
    null,
  ))

  const samples = deltas(rig, frames)
  return {
    boneCount: rig.boneCount,
    clipStep,
    frameCount,
    samples,
    entry: samples[0],
    firstStep: samples[1],
    exit: samples.at(-1)!,
    worstRotation: worst(samples, 'rotationDegrees'),
    worstTranslation: worst(samples, 'translationMeters'),
    worstScale: worst(samples, 'scale'),
  }
}

const controls: AlsAnimationInstanceControls = {
  gait: 'Walking',
  moving: false,
  movingSmooth: false,
  stance: 'Standing',
  rotationMode: 'ViewDirection',
  overlayMode: 'Default',
  speed: 0,
  direction: 0,
  relativeAccelerationAmount: { x: 0, y: 0 },
  rotateInPlace: false,
  viewYawAngle: 0,
  viewYawSpeed: 0,
}

function scenePose(
  bones: ReadonlyMap<string, THREE.Bone>,
  rig: ReturnType<typeof createRigDefinition>,
) {
  const pose = createPoseBuffer(rig.boneCount)
  for (let index = 0; index < rig.boneCount; index++) {
    const bone = bones.get(rig.boneNames[index])
    if (!bone) throw new Error(`Missing runtime bone "${rig.boneNames[index]}"`)
    bone.position.toArray(pose.positions, index * 3)
    bone.quaternion.toArray(pose.rotations, index * 4)
    bone.scale.toArray(pose.scales, index * 3)
  }
  return pose
}

async function runtimeReport(
  ownership: ReturnType<typeof resolveSpec>,
  expectedFrameCount: number,
) {
  const gltf = await loadGltf()
  const rig = createRigDefinition(gltf.scene)
  const bones = new Map<string, THREE.Bone>()
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(object.name, object)
  })
  const instance = createAlsAnimationInstance(gltf)
  const sourceControls = { ...controls, stance: ownership.spec.sourceStance }
  const targetControls = { ...controls, stance: ownership.spec.destinationStance }
  const capture = (
    kind: string,
    owner: typeof ownership.source,
    frame: number | null,
    time: number,
  ): Frame => ({
    kind,
    owner: `${owner.blueprint}/${owner.machine}/${owner.state}`,
    frame,
    time,
    pose: scenePose(bones, rig),
  })

  instance.refresh(0, sourceControls)
  for (let frame = 0; frame < 119; frame++) instance.refresh(DT, sourceControls)
  const sourcePrevious = capture(
    'source-previous',
    ownership.source,
    null,
    ownership.source.time,
  )
  instance.refresh(DT, sourceControls)
  const frames = [capture(
    'source-last',
    ownership.source,
    null,
    ownership.source.time,
  )]
  const frameStates = []
  for (let frame = 1; frame <= expectedFrameCount + 3; frame++) {
    instance.refresh(DT, targetControls)
    const weights = window.__weightTable
    const clipWeight = weights?.GroundedStanceTransitionClipWeight ?? 0
    frameStates.push({
      frame,
      clipWeight,
      direct: weights?.GroundedStanceTransitionDirect ?? 0,
      poseCrouching: weights?.PoseCrouching ?? 0,
      inertializationRequestCount:
        weights?.inertializationRequestCount ?? 0,
      inertialization:
        weights?.inertializationCorrectionMagnitude ?? 0,
    })
    if (clipWeight <= 0) {
      frames.push(capture(
        'destination-first',
        ownership.destination,
        null,
        ownership.destination.time,
      ))
      break
    }
    frames.push(capture(
      'transition-runtime',
      ownership.transition,
      frame,
      Math.min(
        clip(gltf, ownership.transition.clip).duration,
        ownership.transition.time
          + (ownership.transition.parameters.PlayRate ?? 0) / FPS * frame,
      ),
    ))
  }
  if (frames.at(-1)?.kind !== 'destination-first') {
    throw new Error(`${ownership.transition.clip} did not reach its destination`)
  }

  const samples = deltas(
    rig,
    frames,
    CONTROL_RIG_OWNED_LOCAL_BONES,
  )
  instance.refresh(DT, targetControls)
  const destinationNext = capture(
    'destination-next',
    ownership.destination,
    null,
    ownership.destination.time,
  )
  const footEffectorBoundaries = {
    entry: {
      left: componentBoneDelta(rig, frames[0], frames[1], 'foot_l'),
      right: componentBoneDelta(rig, frames[0], frames[1], 'foot_r'),
    },
    exit: {
      left: componentBoneDelta(
        rig,
        frames.at(-2)!,
        frames.at(-1)!,
        'foot_l',
      ),
      right: componentBoneDelta(
        rig,
        frames.at(-2)!,
        frames.at(-1)!,
        'foot_r',
      ),
    },
  }
  return {
    samples,
    frameStates,
    footEffectorBoundaries,
    observedFrameCount: frames.length - 2,
    sourceCadence: delta(
      rig,
      sourcePrevious,
      frames[0],
      CONTROL_RIG_OWNED_LOCAL_BONES,
    ),
    destinationCadence: delta(
      rig,
      frames.at(-1)!,
      destinationNext,
      CONTROL_RIG_OWNED_LOCAL_BONES,
    ),
    entry: samples[0],
    exit: samples.at(-1)!,
    worstRotation: worst(samples, 'rotationDegrees'),
    worstTranslation: worst(samples, 'translationMeters'),
    worstScale: worst(samples, 'scale'),
  }
}

function failure(
  ownership: ReturnType<typeof resolveSpec>,
  label: string,
  sample: Delta,
  diagnostic: object,
) {
  return `${ownership.transition.clip} ${label}: ${JSON.stringify({
    ownership: {
      source: {
        blueprint: ownership.source.blueprint,
        machine: ownership.source.machine,
        state: ownership.source.state,
        node: ownership.source.node,
        clip: ownership.source.clip,
        time: ownership.source.time,
      },
      transition: {
        blueprint: ownership.transition.blueprint,
        machine: ownership.transition.machine,
        state: ownership.transition.state,
        node: ownership.transition.node,
        clip: ownership.transition.clip,
        time: ownership.transition.time,
      },
      destination: {
        blueprint: ownership.destination.blueprint,
        machine: ownership.destination.machine,
        state: ownership.destination.state,
        node: ownership.destination.node,
        clip: ownership.destination.clip,
        time: ownership.destination.time,
      },
    },
    sample,
    diagnostic,
  })}`
}

beforeAll(() => {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  glbData = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  ;(globalThis as typeof globalThis & { window: Window }).window =
    globalThis as typeof globalThis & Window
})

describe('ALS authored stance-transition boundaries', () => {
  it.each(specs)('$name discovers exact ALS graph ownership', (spec) => {
    const ownership = resolveSpec(spec)
    expect(ownership.source.nodeType).toBe('FAnimNode_SequenceEvaluator')
    expect(ownership.destination.nodeType).toBe('FAnimNode_SequenceEvaluator')
    expect(ownership.source.parameters.bTeleportToExplicitTime).toBe(true)
    expect(ownership.destination.parameters.bTeleportToExplicitTime).toBe(true)
    expect(ownership.source.parameters.ReinitializationBehavior)
      .toBe('ESequenceEvalReinit::ExplicitTime')
    expect(ownership.destination.parameters.ReinitializationBehavior)
      .toBe('ESequenceEvalReinit::ExplicitTime')
    expect(ownership.transition.nodeType).toBe('FAnimNode_SequencePlayer')
    expect(ownership.transition.parameters.Method)
      .toBe('EAnimSyncMethod::DoNotSync')
    expect(ownership.transition.parameters.bLoopAnimation).toBe(false)
    expect(ownership.transition.parameters.bStartFromMatchingPose).toBe(false)
    expect(ownership.transition.parameters.PlayRate)
      .toBe(ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE)
    expect(ownership.incoming.LogicType)
      .toBe('ETransitionLogicType::TLT_Inertialization')
    expect(ownership.incoming.CrossfadeDuration)
      .toBe(ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION)
    expect(ownership.outgoing.LogicType)
      .toBe('ETransitionLogicType::TLT_StandardBlend')
    expect(ownership.outgoing.CrossfadeDuration)
      .toBe(ALS_STANCE_TRANSITION_EXIT_DURATION)
  })

  it.each(specs)(
    '$name captures source-last, every real-GLB cadence sample, and destination-first',
    async (spec) => {
      const ownership = resolveSpec(spec)
      const authored = authoredReport(await loadGltf(), ownership)
      const runtime = await runtimeReport(ownership, authored.frameCount)
      const diagnostic = {
        authoredWorstRotation: authored.worstRotation,
        authoredWorstTranslation: authored.worstTranslation,
        authoredWorstScale: authored.worstScale,
        runtimeWorstRotation: runtime.worstRotation,
        runtimeWorstTranslation: runtime.worstTranslation,
        runtimeWorstScale: runtime.worstScale,
        footEffectorBoundaries: runtime.footEffectorBoundaries,
      }

      expect(authored.boneCount).toBe(68)
      expect(authored.clipStep).toBeCloseTo(0.02, 12)
      expect(authored.frameCount).toBe(50)
      expect(authored.samples).toHaveLength(52)
      expect(runtime.samples).toHaveLength(51)
      expect(runtime.observedFrameCount).toBe(authored.frameCount)
      expect(runtime.frameStates).toHaveLength(authored.frameCount + 1)
      expect(runtime.frameStates.slice(0, -1).every(
        (frame) => frame.clipWeight === 1 && frame.direct === 0,
      )).toBe(true)
      expect(runtime.frameStates.at(-1)?.clipWeight).toBe(0)
      expect(runtime.frameStates.at(-2)?.poseCrouching).toBe(
        spec.destinationStance === 'Crouching' ? 1 : 0,
      )
      expect(runtime.samples[0].to.time).toBeCloseTo(0.02, 12)
      expect(runtime.samples.at(-2)?.to.time).toBeCloseTo(1, 12)
      expect(runtime.samples.at(-1)?.to.kind).toBe('destination-first')
      expect(runtime.frameStates.at(-1)?.inertializationRequestCount).toBe(
        runtime.frameStates.at(-2)?.inertializationRequestCount,
      )

      // The local thigh/calf/foot rotations are CR_Als's correct compensation: prove the solved
      // component-space effectors remain continuous at both graph boundaries.
      for (const [boundary, feet] of Object.entries(
        runtime.footEffectorBoundaries,
      )) {
        for (const [side, foot] of Object.entries(feet)) {
          expect(
            foot.positionMeters,
            `${ownership.transition.clip} ${boundary} ${side} foot position`,
          ).toBeLessThanOrEqual(
            FOOT_EFFECTOR_BOUNDARY_POSITION_TOLERANCE_METERS,
          )
          expect(
            foot.rotationDegrees,
            `${ownership.transition.clip} ${boundary} ${side} foot rotation`,
          ).toBeLessThanOrEqual(
            FOOT_EFFECTOR_BOUNDARY_ROTATION_TOLERANCE_DEGREES,
          )
        }
      }

      for (const [label, sample] of [
        ['authored entry', authored.entry],
        ['authored exit', authored.exit],
        ['runtime exit', runtime.exit],
      ] as const) {
        expect(
          sample.rotationDegrees.value,
          failure(ownership, label, sample, diagnostic),
        ).toBeLessThan(0.5)
        expect(
          sample.translationMeters.value,
          failure(ownership, label, sample, diagnostic),
        ).toBeLessThan(0.004)
      }
      expect(
        runtime.entry.rotationDegrees.value,
        failure(ownership, 'runtime entry', runtime.entry, diagnostic),
      ).toBeLessThanOrEqual(Math.max(
        runtime.sourceCadence.rotationDegrees.value,
        authored.firstStep.rotationDegrees.value,
      ))
      expect(
        runtime.entry.translationMeters.value,
        failure(ownership, 'runtime entry', runtime.entry, diagnostic),
      ).toBeLessThanOrEqual(Math.max(
        runtime.sourceCadence.translationMeters.value,
        authored.firstStep.translationMeters.value,
      ))
      expect(authored.samples.every((sample) => sample.scale.value === 0))
        .toBe(true)
      expect(runtime.samples.every((sample) => sample.scale.value === 0))
        .toBe(true)
    },
  )
})
