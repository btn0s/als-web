/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  applyAdditivePose,
  createMeshSpaceBlendScratch,
  makeDynamicAdditivePose,
} from '../engine/blend'
import { compileClipSampler, sampleClip } from '../engine/clipSampler'
import { compileClipCurveSamplers } from '../engine/curves'
import { createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition, findBoneIndex } from '../engine/rig'
import {
  ALS_RIFLE_RELAXED_GRAPH,
} from './AnimGraph/AB_Als_Rifle'
import {
  createAlsControlRigHandIkRuntime,
  evaluateAlsControlRigHandIk,
} from './AnimGraph/CR_Als'
import {
  createAlsAnimationInstance,
} from './AlsAnimationInstance'
import { ALS_VIRTUAL_BONES } from './Utility/AlsVirtualBones'
import type {
  AlsAnimationInstance,
  AlsAnimationInstanceControls,
} from './AlsAnimationInstance'

const controls: AlsAnimationInstanceControls = {
  gait: 'Running',
  moving: true,
  movingSmooth: true,
  stance: 'Standing',
  rotationMode: 'ViewDirection',
  overlayMode: 'Default',
  speed: 3.75,
  direction: 0,
  relativeAccelerationAmount: { x: 0, y: 0 },
  rotateInPlace: false,
  viewYawAngle: 0,
  viewYawSpeed: 0,
}

let glbData: ArrayBuffer

function loadAlsGltf() {
  return new Promise<{
    animations: THREE.AnimationClip[]
    scene: THREE.Group
  }>((resolve, reject) => {
    new GLTFLoader().parse(glbData.slice(0), '', resolve, reject)
  })
}

function bone(scene: THREE.Object3D, name: string) {
  const value = scene.getObjectByName(name)
  if (!(value instanceof THREE.Bone)) throw new Error(`Missing bone "${name}"`)
  return value
}

function localRotation(scene: THREE.Object3D, name: string) {
  return bone(scene, name).quaternion.clone()
}

function expectMotionAndPeriodicity(
  start: Record<'foot_l' | 'hand_l', THREE.Quaternion>,
  moved: Record<'foot_l' | 'hand_l', THREE.Quaternion>,
  repeated: Record<'foot_l' | 'hand_l', THREE.Quaternion>,
) {
  for (const boneName of ['foot_l', 'hand_l'] as const) {
    expect(
      start[boneName].angleTo(moved[boneName]),
      `${boneName} must move over 0.3s`,
    ).toBeGreaterThan(0.01)
    expect(
      start[boneName].angleTo(repeated[boneName]),
      `${boneName} must repeat after two full cycles`,
    ).toBeLessThan(0.003)
  }
}

function snapshotMotionBones(scene: THREE.Object3D) {
  return {
    foot_l: localRotation(scene, 'foot_l'),
    hand_l: localRotation(scene, 'hand_l'),
  }
}

function snapshotLocalBoneTransforms(scene: THREE.Object3D) {
  const transforms = new Map<
    string,
    { position: THREE.Vector3; rotation: THREE.Quaternion }
  >()
  scene.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    transforms.set(object.name, {
      position: object.position.clone(),
      rotation: object.quaternion.clone(),
    })
  })
  return transforms
}

function maximumLocalBoneDelta(
  from: ReturnType<typeof snapshotLocalBoneTransforms>,
  to: ReturnType<typeof snapshotLocalBoneTransforms>,
) {
  let maximum = 0
  for (const [name, transform] of to) {
    const previous = from.get(name)
    if (!previous) continue
    maximum = Math.max(
      maximum,
      transform.position.distanceTo(previous.position),
      transform.rotation.angleTo(previous.rotation),
    )
  }
  return maximum
}

function requestCount() {
  return window.__weightTable?.inertializationRequestCount
}

function refreshFrames(
  instance: AlsAnimationInstance,
  count: number,
  frameControls = controls,
) {
  for (let frame = 0; frame < count; frame++) {
    instance.refresh(1 / 60, frameControls)
  }
}

describe('AlsAnimationInstance playback regression', () => {
  beforeAll(() => {
    const bytes = readFileSync(
      new URL('../../public/assets/skm-als.glb', import.meta.url),
    )
    glbData = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
    ;(globalThis as typeof globalThis & { window: Window }).window =
      globalThis as typeof globalThis & Window
  })

  it('advances and repeats the authored run on solo and normal paths', async () => {
    const soloGltf = await loadAlsGltf()
    const run = soloGltf.animations.find(
      (clip) => clip.name === 'A_Als_Run_Forward',
    )
    if (!run) throw new Error('Missing A_Als_Run_Forward')
    const solo = createAlsAnimationInstance(soloGltf)
    expect(solo.playClip(run.name)).toBe(true)
    solo.refresh(0, controls)
    const soloStart = snapshotMotionBones(soloGltf.scene)
    solo.refresh(0.3, controls)
    const soloMoved = snapshotMotionBones(soloGltf.scene)
    solo.refresh(run.duration * 2 - 0.3, controls)
    expectMotionAndPeriodicity(
      soloStart,
      soloMoved,
      snapshotMotionBones(soloGltf.scene),
    )

    const normalGltf = await loadAlsGltf()
    const normal = createAlsAnimationInstance(normalGltf)
    refreshFrames(normal, 120)
    const normalStart = snapshotMotionBones(normalGltf.scene)
    normal.refresh(0.3, controls)
    const normalMoved = snapshotMotionBones(normalGltf.scene)
    // Twenty-five run cycles at 15/14 play rate span seven complete Idle cycles, so the complete
    // AB_Als_Default linked-layer result returns to the same phase.
    normal.refresh(
      run.duration * 25 / normal.state.standingMovement.playRate - 0.3,
      controls,
    )
    expectMotionAndPeriodicity(
      normalStart,
      normalMoved,
      snapshotMotionBones(normalGltf.scene),
    )
  })

  it('holds the standing base at explicit time zero while Default secondary motion advances', async () => {
    const gltf = await loadAlsGltf()
    const standPose = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Stand_Pose',
    )
    if (!standPose) throw new Error('Missing A_Als_Stand_Pose')
    const instance = createAlsAnimationInstance(gltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
    }

    instance.refresh(0, idleControls)
    const start = localRotation(gltf.scene, 'spine_03')
    instance.refresh(0.3, idleControls)
    expect(window.__weightTable?.idle).toBe(1)
    expect(window.__weightTable?.['clipTime.idle']).toBe(0)
    expect(window.__weightTable?.idleAdditive).toBeCloseTo(0.75, 7)
    expect(window.__weightTable?.['clipTime.idleAdditive']).toBeCloseTo(0.3, 7)
    expect(
      start.angleTo(localRotation(gltf.scene, 'spine_03')),
      'AB_Als_Default must add A_Als_Idle secondary motion over the explicit stand pose',
    ).toBeGreaterThan(0.01)
  })

  it('keeps linked-overlay secondary motion live above the turn-in-place slot', async () => {
    const idleTurn = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
      viewYawAngle: 90,
      viewYawSpeed: 0,
    }

    for (const overlayMode of ['Default', 'Rifle'] as const) {
      const gltf = await loadAlsGltf()
      const instance = createAlsAnimationInstance(gltf)
      const turnControls = { ...idleTurn, overlayMode }
      refreshFrames(instance, 30, turnControls)

      expect(
        window.__weightTable?.idle,
        `${overlayMode} turn must replace only the locomotion slot source`,
      ).toBe(0)
      expect(window.__weightTable?.idleAdditive).toBeCloseTo(0.75, 7)
      expect(window.__weightTable?.defaultOverlay).toBe(
        overlayMode === 'Default' ? 1 : 0,
      )
      expect(window.__weightTable?.overlayModeRifle).toBe(
        overlayMode === 'Rifle' ? 1 : 0,
      )

      const secondaryMotionTime =
        window.__weightTable?.['clipTime.idleAdditive'] ?? 0
      instance.refresh(1 / 60, turnControls)
      expect(window.__weightTable?.['clipTime.idleAdditive'])
        .toBeGreaterThan(secondaryMotionTime)
    }
  })

  it('defers turn playback one frame, then applies the authored Slot blend and sequence rate', async () => {
    const gltf = await loadAlsGltf()
    const turn = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Turn_90_Right',
    )
    if (!turn) throw new Error('Missing A_Als_Turn_90_Right')
    const rotationYawSpeed = compileClipCurveSamplers(
      turn,
    ).RotationYawSpeed
    if (!rotationYawSpeed) {
      throw new Error('A_Als_Turn_90_Right is missing RotationYawSpeed')
    }
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
      viewYawAngle: 0,
      viewYawSpeed: 0,
    }
    const requestTurn = { ...idle, viewYawAngle: 46 }

    instance.refresh(0, idle)
    const inertializationRequests = requestCount()
    instance.refresh(1 / 60, requestTurn)

    // RefreshTurnInPlace queues during graph update; NativePostUpdateAnimation plays after this
    // pose has already been evaluated.
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(0)
    expect(window.__weightTable?.idle).toBe(1)
    expect(requestCount()).toBe(inertializationRequests)

    instance.refresh(1 / 60, requestTurn)
    const montageWeight = (1 / 60) / 0.2
    const sequenceTime = 1 / 60 * 1.2
    expect(window.__weightTable?.TurnInPlaceMontageBlendingIn).toBe(1)
    expect(window.__weightTable?.TurnInPlaceMontageWeight)
      .toBeCloseTo(montageWeight, 12)
    expect(window.__weightTable?.TurnInPlaceMontageTime)
      .toBeCloseTo(1 / 60, 12)
    expect(window.__weightTable?.TurnInPlaceSequenceTime)
      .toBeCloseTo(sequenceTime, 12)
    expect(window.__weightTable?.idle).toBeCloseTo(1 - montageWeight, 12)
    expect(window.__weightTable?.AllowTransitions)
      .toBeCloseTo(1 - montageWeight, 12)
    expect(instance.state.rotationYawSpeed).toBeCloseTo(
      rotationYawSpeed(sequenceTime)
        * (1.2 * 46 / 90)
        * montageWeight,
      6,
    )
    expect(window.__weightTable?.idleAdditive).toBeCloseTo(0.75, 7)
    expect(requestCount()).toBe(inertializationRequests)
  })

  it('retains the terminal turn sample through the authored 0.2s automatic fade without global inertialization', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
      viewYawAngle: 0,
      viewYawSpeed: 0,
    }
    const requestTurn = { ...idle, viewYawAngle: 46 }

    instance.refresh(0, idle)
    instance.refresh(1 / 60, requestTurn)
    const inertializationRequests = requestCount()
    instance.refresh(1 / 60, requestTurn)
    instance.refresh(2 / 1.2 - 1 / 60, idle)

    expect(window.__weightTable?.TurnInPlaceSequenceTime).toBeCloseTo(2, 12)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(1)
    expect(window.__weightTable?.TurnInPlaceMontageBlendingOut).toBe(1)

    instance.refresh(0.1, idle)
    expect(window.__weightTable?.TurnInPlaceSequenceTime).toBe(2)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.AllowTransitions).toBeCloseTo(0.5, 12)

    instance.refresh(0.1, idle)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(0)
    expect(window.__weightTable?.TurnInPlaceSequenceTime).toBe(0)
    expect(window.__weightTable?.idle).toBe(1)
    expect(window.__weightTable?.AllowTransitions).toBe(1)
    expect(requestCount()).toBe(inertializationRequests)
  })

  it('stops the Grounded turn Slot over 0.2s when an authored stance state becomes relevant', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
      viewYawAngle: 0,
      viewYawSpeed: 0,
    }
    const requestTurn = { ...idle, viewYawAngle: 46 }
    const crouching = { ...idle, stance: 'Crouching' as const }

    instance.refresh(0, idle)
    instance.refresh(1 / 60, requestTurn)
    instance.refresh(1 / 60, requestTurn)
    instance.refresh(0.2 - 1 / 60, idle)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(1)
    const requestsBeforeStanceEntry = requestCount()

    // The state entry queues StopTransitionAndTurnInPlaceAnimations(); its post-update stop begins
    // after this frame's graph evaluation.
    instance.refresh(0, crouching)
    expect(window.__weightTable?.TurnInPlaceMontagePlaying).toBe(1)
    expect(requestCount()).toBe(requestsBeforeStanceEntry! + 1)

    instance.refresh(0.1, crouching)
    expect(window.__weightTable?.TurnInPlaceMontageBlendingOut).toBe(1)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(window.__weightTable?.idleAdditive).toBeCloseTo(0.75, 7)

    instance.refresh(0.1, crouching)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(0)
    expect(requestCount()).toBe(requestsBeforeStanceEntry! + 1)
  })

  it('requests inertialization once per actual mode change, never again on stable frames', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    instance.refresh(0, controls)
    expect(requestCount()).toBe(0)

    const rifleControls = { ...controls, overlayMode: 'Rifle' as const }
    instance.refresh(1 / 60, rifleControls)
    expect(requestCount()).toBe(1)
    instance.refresh(1 / 60, rifleControls)
    expect(requestCount()).toBe(1)

    expect(instance.playClip('A_Als_Run_Forward')).toBe(true)
    instance.refresh(1 / 60, controls)
    expect(requestCount()).toBe(2)
    instance.refresh(1 / 60, controls)
    expect(requestCount()).toBe(2)

    instance.clearSoloClip()
    instance.refresh(1 / 60, controls)
    expect(requestCount()).toBe(3)
    instance.refresh(1 / 60, controls)
    expect(requestCount()).toBe(3)
  })

  it('publishes the downstream-inertialized Layer curves instead of raw graph values', async () => {
    const gltf = await loadAlsGltf()
    const riflePoses = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Rifle_Poses',
    )
    if (!riflePoses) throw new Error('Missing A_Als_Rifle_Poses')
    const authoredLayerArmLeftAdditive = compileClipCurveSamplers(
      riflePoses,
    ).LayerArmLeftAdditive?.(
      ALS_RIFLE_RELAXED_GRAPH.sequenceEvaluators.node46.explicitTime,
    )
    if (authoredLayerArmLeftAdditive === undefined) {
      throw new Error('A_Als_Rifle_Poses is missing LayerArmLeftAdditive')
    }
    expect(authoredLayerArmLeftAdditive).toBe(0)

    const instance = createAlsAnimationInstance(gltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    instance.refresh(1 / 60, idleControls)
    expect(window.__weightTable?.LayerArmLeftAdditive).toBe(1)

    const rifleControls = {
      ...idleControls,
      overlayMode: 'Rifle' as const,
    }
    // At zero elapsed time UE's downstream inertialization node reproduces the outgoing curve
    // container even though the incoming linked layer already resolves its authored zero.
    instance.refresh(0, rifleControls)
    expect(window.__weightTable?.LayerArmLeftAdditive).toBeCloseTo(1, 8)

    refreshFrames(instance, 30, rifleControls)
    expect(window.__weightTable?.LayerArmLeftAdditive).toBeCloseTo(
      authoredLayerArmLeftAdditive,
      5,
    )
  })

  it('keeps the settled Rifle left arm on its authored synchronized source', async () => {
    const gltf = await loadAlsGltf()
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    const rifleRun = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Rifle_Run_Arms',
    )
    if (!rifleRun) throw new Error('Missing A_Als_Rifle_Run_Arms')
    const idle = gltf.animations.find((clip) => clip.name === 'A_Als_Idle')
    const stand = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Stand_Pose',
    )
    if (!idle || !stand) throw new Error('Missing Idle additive references')
    const instance = createAlsAnimationInstance(gltf)
    const rifleControls = { ...controls, overlayMode: 'Rifle' as const }
    refreshFrames(instance, 120, rifleControls)

    const phase = window.__weightTable?.['clipPhase.runFwd']
    if (phase === undefined) throw new Error('Missing run clip-phase diagnostic')
    const authoredPose = sampleClip(
      compileClipSampler(rifleRun, rig),
      rig,
      phase * rifleRun.duration,
      createPoseBuffer(rig.boneCount),
    )
    const standPose = sampleClip(
      compileClipSampler(stand, rig),
      rig,
      0,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const idlePose = sampleClip(
      compileClipSampler(idle, rig),
      rig,
      window.__weightTable?.['clipTime.idleAdditive'] ?? 0,
      createPoseBuffer(rig.boneCount),
      true,
      standPose,
    )
    const idleDelta = createPoseBuffer(rig.boneCount)
    makeDynamicAdditivePose(
      idlePose,
      standPose,
      rig,
      idleDelta,
      'local',
      createMeshSpaceBlendScratch(rig.boneCount),
    )
    applyAdditivePose(authoredPose, idleDelta, 0.75)
    const authoredCurves = new Map<string, number>()
    const rifleRunCurves = compileClipCurveSamplers(rifleRun)
    const rifleRunTime = phase * rifleRun.duration
    for (const name in rifleRunCurves) {
      authoredCurves.set(name, rifleRunCurves[name](rifleRunTime))
    }
    evaluateAlsControlRigHandIk(
      createAlsControlRigHandIkRuntime(rig),
      {
        pose: authoredPose,
        curves: authoredCurves,
        useHandIkBones: true,
      },
    )
    for (const boneName of ['upperarm_l', 'lowerarm_l', 'hand_l']) {
      const index = findBoneIndex(rig, boneName)
      const expected = new THREE.Quaternion().fromArray(
        authoredPose.rotations,
        index * 4,
      )
      expect(localRotation(gltf.scene, boneName).angleTo(expected)).toBeLessThan(0.003)
    }
    expect(
      window.__weightTable?.inertializationCorrectionMagnitude,
    ).toBe(0)
  })

  it('drives the rifle attachment from node 92 virtual-bone output', async () => {
    const gltf = await loadAlsGltf()
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    const rifleRun = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Rifle_Run_Arms',
    )
    const idle = gltf.animations.find((clip) => clip.name === 'A_Als_Idle')
    const stand = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Stand_Pose',
    )
    if (!rifleRun || !idle || !stand) {
      throw new Error('Missing Rifle virtual-bone source clips')
    }
    const instance = createAlsAnimationInstance(gltf)
    refreshFrames(
      instance,
      120,
      { ...controls, overlayMode: 'Rifle' as const },
    )

    const phase = window.__weightTable?.['clipPhase.runFwd']
    if (phase === undefined) throw new Error('Missing run clip-phase diagnostic')
    const expectedOverlayPose = sampleClip(
      compileClipSampler(rifleRun, rig),
      rig,
      phase * rifleRun.duration,
      createPoseBuffer(rig.boneCount),
    )
    const standPose = sampleClip(
      compileClipSampler(stand, rig),
      rig,
      0,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const idlePose = sampleClip(
      compileClipSampler(idle, rig),
      rig,
      window.__weightTable?.['clipTime.idleAdditive'] ?? 0,
      createPoseBuffer(rig.boneCount),
      true,
      standPose,
    )
    const idleDelta = createPoseBuffer(rig.boneCount)
    makeDynamicAdditivePose(
      idlePose,
      standPose,
      rig,
      idleDelta,
      'local',
      createMeshSpaceBlendScratch(rig.boneCount),
    )
    applyAdditivePose(expectedOverlayPose, idleDelta, 0.75)

    const attachmentName = 'VB hand_r_to_ik_hand_gun'
    const attachment = bone(gltf.scene, attachmentName)
    const attachmentIndex = findBoneIndex(rig, attachmentName)
    const expectedPosition = new THREE.Vector3().fromArray(
      expectedOverlayPose.positions,
      attachmentIndex * 3,
    )
    const expectedRotation = new THREE.Quaternion().fromArray(
      expectedOverlayPose.rotations,
      attachmentIndex * 4,
    )
    expect(attachment.parent?.name).toBe('hand_r')
    expect(attachment.position.distanceTo(expectedPosition)).toBeLessThan(2e-4)
    expect(attachment.quaternion.angleTo(expectedRotation)).toBeLessThan(2e-4)
    expect(
      attachment.position.distanceTo(bone(gltf.scene, 'ik_hand_gun').position),
    ).toBeGreaterThan(0.05)
  })

  it('drives settled Running from the selected authored WalkRun player and exact play rate', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    refreshFrames(instance, 60, controls)

    expect(instance.state.hipsDirection).toBe('Forward')
    expect(instance.state.standingMovement.strideBlendAmount).toBe(1)
    expect(instance.state.standingMovement.walkRunBlendAmount).toBe(1)
    expect(instance.state.standingMovement.playRate).toBeCloseTo(375 / 350, 12)
    expect(window.__weightTable?.idle).toBe(0)
    expect(window.__weightTable?.runFwd).toBe(1)
    expect(window.__weightTable?.walkFwd).toBe(0)
    expect(window.__weightTable?.A_Als_Run_Forward).toBe(1)
    expect(window.__weightTable?.A_Als_Run_Backward).toBe(0)
    expect(window.__weightTable?.['HipsDirection.Forward']).toBe(1)
    expect(window.__weightTable?.StandingPlayRate).toBeCloseTo(375 / 350, 12)
  })

  it('uses authored zero-stride pose samples instead of blending low speed with Idle', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const lowSpeed = {
      ...controls,
      gait: 'Walking' as const,
      speed: 0.5,
      direction: 180,
    }
    refreshFrames(instance, 60, lowSpeed)

    const stride = instance.state.standingMovement.strideBlendAmount
    expect(stride).toBeGreaterThan(0.2)
    expect(stride).toBeLessThan(1)
    expect(instance.state.movementDirection).toBe('Backward')
    expect(instance.state.hipsDirection).toBe('Backward')
    expect(window.__weightTable?.idle).toBe(0)
    expect(window.__weightTable?.A_Als_Walk_Backward).toBeCloseTo(stride, 12)
    expect(window.__weightTable?.A_Als_Walk_Forward_Pose).toBeCloseTo(
      1 - stride,
      12,
    )
    expect(window.__weightTable?.A_Als_Walk_Forward).toBe(0)
  })

  it('retains the SetHipsDirection analog seam and keeps Sprint separate', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const leftControls = { ...controls, direction: -90 }

    instance.refresh(0, leftControls)
    instance.setHipsDirection('LeftForward')
    refreshFrames(instance, 60, leftControls)
    expect(window.__weightTable?.runLeftFwd).toBe(1)
    expect(window.__weightTable?.runFwd).toBe(0)
    expect(window.__weightTable?.['HipsDirection.LeftForward']).toBe(1)

    const sprint = {
      ...controls,
      gait: 'Sprinting' as const,
      speed: 6.5,
    }
    refreshFrames(instance, 60, sprint)
    expect(window.__weightTable?.sprint).toBe(1)
    expect(window.__weightTable?.runLeftFwd).toBe(0)
    expect(instance.state.pose.amount).toBe(3)
    expect(instance.state.standingMovement.playRate).toBeCloseTo(650 / 600, 12)
  })

  it('evaluates the authored sprint tag, acceleration, and exit blends without inertialization', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    refreshFrames(instance, 60, controls)
    const sprint = {
      ...controls,
      gait: 'Sprinting' as const,
      speed: 6.5,
      relativeAccelerationAmount: { x: 0.25, y: 0 },
    }
    const before = requestCount()

    instance.refresh(0.1, sprint)
    expect(instance.state.standingSprint.sprintTime).toBeCloseTo(0.1)
    expect(instance.state.standingSprint.sprintAccelerationAmount).toBe(0.25)
    expect(window.__weightTable?.SprintBlendAmount).toBeCloseTo(0.125)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.875)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.sprintAcceleration).toBeCloseTo(0.125)
    expect(requestCount()).toBe(before)

    instance.refresh(0.1, sprint)
    expect(window.__weightTable?.SprintBlendAmount).toBe(1)
    expect(window.__weightTable?.runFwd).toBe(0)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.sprintAcceleration).toBe(1)

    instance.refresh(0.3, sprint)
    expect(instance.state.standingSprint.sprintTime).toBeCloseTo(0.5)
    expect(instance.state.standingSprint.sprintAccelerationAmount).toBe(0)
    expect(window.__weightTable?.sprint).toBe(1)
    expect(window.__weightTable?.sprintAcceleration).toBe(0)

    const running = {
      ...controls,
      relativeAccelerationAmount: { x: 0, y: 0 },
    }
    instance.refresh(0.15, running)
    expect(window.__weightTable?.SprintBlendAmount).toBeCloseTo(0.875)
    expect(window.__weightTable?.sprint).toBeCloseTo(0.875)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.125)
    instance.refresh(0.15, running)
    expect(window.__weightTable?.SprintBlendAmount).toBe(0)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.runFwd).toBe(1)
    expect(requestCount()).toBe(before)
  })

  it('applies the prior resolved SprintBlock curve through the outer MoveForward blend', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const sprint = {
      ...controls,
      gait: 'Sprinting' as const,
      speed: 6.5,
      relativeAccelerationAmount: { x: 0, y: 0 },
    }
    refreshFrames(instance, 60, sprint)
    expect(window.__weightTable?.sprint).toBe(1)

    // RefreshStandingMovement reads the previous graph evaluation's named curve container.
    instance.state.standingSprint.sprintBlockAmount = 1
    instance.refresh(0, sprint)
    expect(window.__weightTable?.runFwd).toBe(1)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.sprintAcceleration).toBe(0)
  })

  it('runs RefreshMovementDirection and the recovered state predicates automatically', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const leftControls = { ...controls, direction: -90 }

    // Movement States reinitializes to Forward and skips transitions on its first relevant frame.
    instance.refresh(0, leftControls)
    expect(instance.state.movementDirection).toBe('Left')
    expect(instance.state.hipsDirection).toBe('Forward')
    expect(instance.state.directionTransitionRequest).toBeNull()

    instance.refresh(1 / 60, leftControls)
    expect(instance.state.hipsDirection).toBe('LeftForward')
    expect(instance.state.directionTransitionRequest).toMatchObject({
      transitionIndex: 1,
      from: 'Forward',
      to: 'LeftForward',
      rule: 'MoveLeft',
      duration: 0.7,
      blendOption: 'Cubic',
      activatePivot: false,
      moveDirectionChangeProfileApplied: true,
    })
    expect(window.__weightTable?.['MovementDirection.Left']).toBe(1)
    expect(window.__weightTable?.GroundedDirectionTransitionIndex).toBe(1)
  })

  it('uses the authored normalized MultiWayBlend instead of one directional player', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const diagonalControls = { ...controls, direction: 45 }
    refreshFrames(instance, 60, diagonalControls)

    // 45 degrees remains the Forward hips state, whose Right input is Move Right Forward.
    expect(instance.state.hipsDirection).toBe('Forward')
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.5, 8)
    expect(window.__weightTable?.runRightFwd).toBeCloseTo(0.5, 8)
    expect(window.__weightTable?.runBwd).toBe(0)
    expect(window.__weightTable?.runRightBwd).toBe(0)
  })

  it('applies authored pivot timing and the MoveDirectionChange profile', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    instance.refresh(0, controls)

    instance.refresh(1 / 60, { ...controls, direction: 180 })
    expect(instance.state.hipsDirection).toBe('Backward')
    expect(instance.state.directionTransitionRequest).toMatchObject({
      transitionIndex: 2,
      from: 'Forward',
      to: 'Backward',
      duration: 0.5,
      blendOption: 'Cubic',
      activatePivot: true,
      moveDirectionChangeProfileApplied: true,
    })
    expect(window.__weightTable?.GroundedDirectionTransitionDuration).toBe(0.5)
    expect(window.__weightTable?.GroundedDirectionTransitionActivatePivot).toBe(1)
    expect(window.__weightTable?.MoveDirectionChangeProfileApplied).toBe(1)

    instance.refresh(0.25, { ...controls, direction: 180 })
    expect(window.__weightTable?.GroundedDirectionTransitionActive).toBe(1)
    expect(window.__weightTable?.GroundedDirectionTransitionLinearAlpha).toBe(0.5)
    expect(window.__weightTable?.GroundedDirectionTransitionBlendAlpha).toBe(0.125)
    expect(window.__weightTable?.GroundedDirectionTransitionRootIncomingWeight)
      .toBeCloseTo(0.125, 7)
    expect(window.__weightTable?.GroundedDirectionTransitionFootLeftIncomingWeight)
      .toBeCloseTo(0.25, 7)
    expect(window.__weightTable?.['HipsDirection.Forward']).toBeCloseTo(0.875, 7)
    expect(window.__weightTable?.['HipsDirection.Backward']).toBeCloseTo(0.125, 7)
  })

  it('consumes previous resolved HipsDirectionLock and FeetCrossing values', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const rightControls = { ...controls, direction: 90 }
    instance.refresh(0, rightControls)

    instance.setHipsDirection('RightForward')
    instance.state.hipsDirectionLockAmount = -0.5
    instance.state.feetCrossingAmount = 0
    instance.refresh(1 / 60, rightControls)
    expect(instance.state.hipsDirection).toBe('RightBackward')
    expect(instance.state.directionTransitionRequest).toMatchObject({
      transitionIndex: 9,
      rule: 'SetHipsLeft',
      duration: 0.75,
      blendOption: 'QuadraticInOut',
      activatePivot: false,
    })
  })

  it('uses the authored 0.2s Hermite Idle-to-Move transition, independent of speed', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    instance.refresh(0, idle)
    expect(window.__weightTable?.['clipPhase.runFwd']).toBeCloseTo(0.2, 6)
    expect(window.__weightTable?.['clipPhase.sprint']).toBeCloseTo(0.166667, 6)

    instance.refresh(0.1, controls)
    expect(window.__weightTable?.idle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.5, 12)

    instance.refresh(0.1, controls)
    expect(window.__weightTable?.idle).toBe(0)
    expect(window.__weightTable?.runFwd).toBe(1)
  })

  it('keeps locomotion live through ALS moving stance changes and reserves the full-body clip for idle', async () => {
    const movingGltf = await loadAlsGltf()
    const movingInstance = createAlsAnimationInstance(movingGltf)
    refreshFrames(movingInstance, 60, controls)

    const movingCrouch = {
      ...controls,
      stance: 'Crouching' as const,
    }
    movingInstance.refresh(0.2, movingCrouch)

    expect(window.__weightTable?.GroundedStanceTransitionDirect).toBe(1)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(0)
    expect(window.__weightTable?.GroundedStanceTransitionLinearAlpha)
      .toBeCloseTo(0.4, 12)
    expect(window.__weightTable?.PoseCrouching).toBeCloseTo(0.4, 7)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.6, 7)
    expect(window.__weightTable?.crouchFwd).toBeCloseTo(0.4, 7)

    movingInstance.refresh(0.3, movingCrouch)
    expect(window.__weightTable?.runFwd).toBe(0)
    expect(window.__weightTable?.crouchFwd).toBeCloseTo(1, 7)

    const idleGltf = await loadAlsGltf()
    const idleInstance = createAlsAnimationInstance(idleGltf)
    const idleStanding = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    idleInstance.refresh(0, idleStanding)
    idleInstance.refresh(0, {
      ...idleStanding,
      stance: 'Crouching',
    })

    expect(window.__weightTable?.GroundedStanceTransitionDirect).toBe(0)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(window.__weightTable?.idle).toBe(0)
    expect(window.__weightTable?.crouchIdle).toBe(0)
  })

  it('keeps both stationary authored stance-state boundaries pose-continuous', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleStanding = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const idleCrouching = {
      ...idleStanding,
      stance: 'Crouching' as const,
    }

    refreshFrames(instance, 60, idleStanding)
    let previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleCrouching)
    expect(
      maximumLocalBoneDelta(previous, snapshotLocalBoneTransforms(gltf.scene)),
      'Standing -> Standing To Crouching must inertialize from the explicit stand pose',
    ).toBeLessThan(0.01)

    refreshFrames(instance, 49, idleCrouching)
    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleCrouching)
    expect(
      maximumLocalBoneDelta(previous, snapshotLocalBoneTransforms(gltf.scene)),
      'Standing To Crouching -> Crouching is an authored zero-duration exit',
    ).toBeLessThan(0.01)

    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleStanding)
    expect(
      maximumLocalBoneDelta(previous, snapshotLocalBoneTransforms(gltf.scene)),
      'Crouching -> Crouching To Standing must inertialize from the explicit crouch pose',
    ).toBeLessThan(0.01)

    refreshFrames(instance, 49, idleStanding)
    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleStanding)
    expect(
      maximumLocalBoneDelta(previous, snapshotLocalBoneTransforms(gltf.scene)),
      'Crouching To Standing -> Standing must land on explicit A_Als_Stand_Pose time zero',
    ).toBeLessThan(0.01)
  })

  it('ticks the dedicated stance SequencePlayers for 50 frames and exits without another inertialization request', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleStanding = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const idleCrouching = {
      ...idleStanding,
      stance: 'Crouching' as const,
    }

    instance.refresh(1 / 60, idleStanding)
    const enterCrouchRequestCount = requestCount()
    instance.refresh(1 / 60, idleCrouching)
    expect(window.__weightTable?.GroundedStanceTransitionClipTime)
      .toBeCloseTo(0.02, 12)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(requestCount()).toBe(enterCrouchRequestCount! + 1)

    refreshFrames(instance, 49, idleCrouching)
    expect(window.__weightTable?.GroundedStanceTransitionClipTime).toBe(1)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(window.__weightTable?.PoseCrouching).toBe(1)
    const crouchExitRequestCount = requestCount()

    instance.refresh(1 / 60, idleCrouching)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(0)
    expect(window.__weightTable?.crouchIdle).toBe(1)
    expect(requestCount()).toBe(crouchExitRequestCount)

    const enterStandingRequestCount = requestCount()
    instance.refresh(1 / 60, idleStanding)
    expect(window.__weightTable?.GroundedStanceTransitionClipTime)
      .toBeCloseTo(0.02, 12)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(requestCount()).toBe(enterStandingRequestCount! + 1)

    refreshFrames(instance, 49, idleStanding)
    expect(window.__weightTable?.GroundedStanceTransitionClipTime).toBe(1)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(1)
    expect(window.__weightTable?.PoseCrouching).toBe(0)
    const standingExitRequestCount = requestCount()

    instance.refresh(1 / 60, idleStanding)
    expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(0)
    expect(window.__weightTable?.idle).toBe(1)
    expect(requestCount()).toBe(standingExitRequestCount)
  })

  it('keeps the authored stance-transition pose continuous when movement takes the direct route', async () => {
    const idleStanding = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const idleCrouching = {
      ...idleStanding,
      stance: 'Crouching' as const,
    }
    const movingCrouching = {
      ...controls,
      stance: 'Crouching' as const,
    }
    const scenarios = [
      {
        from: idleStanding,
        to: idleCrouching,
        movingTo: movingCrouching,
        targetRole: 'crouchFwd',
      },
      {
        from: idleCrouching,
        to: idleStanding,
        movingTo: controls,
        targetRole: 'runFwd',
      },
    ] as const

    for (const scenario of scenarios) {
      const gltf = await loadAlsGltf()
      const instance = createAlsAnimationInstance(gltf)
      instance.refresh(0, scenario.from)
      instance.refresh(0, scenario.to)
      refreshFrames(instance, 10, scenario.to)
      const calfBefore = localRotation(gltf.scene, 'calf_l')
      const handIkBefore = bone(gltf.scene, 'ik_hand_gun').position.clone()
      const inertializationRequestsBefore = requestCount()

      instance.refresh(1 / 60, scenario.movingTo)

      expect(
        calfBefore.angleTo(localRotation(gltf.scene, 'calf_l')),
        `${scenario.targetRole}: the outgoing transition state must remain the source pose`,
      ).toBeLessThan(THREE.MathUtils.degToRad(10))
      expect(
        handIkBefore.distanceTo(bone(gltf.scene, 'ik_hand_gun').position),
        'the authored IK hierarchy must not snap to the target locomotion state',
      ).toBeLessThan(0.05)
      expect(window.__weightTable?.GroundedStanceTransitionSourceWeight)
        .toBeGreaterThan(0.99)
      expect(window.__weightTable?.GroundedStanceTransitionClipWeight)
        .toBe(window.__weightTable?.GroundedStanceTransitionSourceWeight)
      expect(requestCount()).toBe(inertializationRequestsBefore)

      refreshFrames(instance, 29, scenario.movingTo)
      expect(window.__weightTable?.GroundedStanceTransitionSourceWeight).toBe(0)
      expect(window.__weightTable?.GroundedStanceTransitionClipWeight).toBe(0)
      expect(window.__weightTable?.[scenario.targetRole]).toBeCloseTo(1, 7)
    }
  })

  it('consumes the real GLB Left/Right extras for marker-relative gait sync', async () => {
    const gltf = await loadAlsGltf()
    const walk = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Walk_Forward',
    )
    expect(walk?.userData.syncMarkers).toEqual([
      { name: 'Left', time: 0.0833333 },
      { name: 'Right', time: 0.65 },
    ])

    const instance = createAlsAnimationInstance(gltf)
    const blendControls = { ...controls, speed: 2.75 }
    refreshFrames(instance, 30, blendControls)
    expect(window.__weightTable?.locomotionMarkerSync).toBe(1)
  })

  it('keeps all six upstream WalkRun player sources advancing in the Movement sync group', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const phaseKeys = [
      'clipPhase.runFwd',
      'clipPhase.runBwd',
      'clipPhase.runLeftFwd',
      'clipPhase.runLeftBwd',
      'clipPhase.runRightFwd',
      'clipPhase.runRightBwd',
    ] as const

    instance.refresh(0, controls)
    const initialPhases = phaseKeys.map((key) => window.__weightTable?.[key])
    refreshFrames(instance, 10, controls)
    const advancedPhases = phaseKeys.map((key) => window.__weightTable?.[key])
    for (let index = 0; index < phaseKeys.length; index++) {
      expect(advancedPhases[index], phaseKeys[index]).not.toBe(
        initialPhases[index],
      )
    }
  })
})
