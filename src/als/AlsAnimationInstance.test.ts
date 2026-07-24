/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileClipSampler, sampleClip } from '../engine/clipSampler'
import { compileClipCurveSamplers } from '../engine/curves'
import { createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition, findBoneIndex } from '../engine/rig'
import {
  RIFLE_RELAXED_POSE_TIME,
} from './AnimGraph/overlayMode'
import {
  createAlsAnimationInstance,
} from './AlsAnimationInstance'
import type {
  AlsAnimationInstance,
  AlsAnimationInstanceControls,
} from './AlsAnimationInstance'

const controls: AlsAnimationInstanceControls = {
  gait: 'Running',
  moving: true,
  stance: 'Standing',
  rotationMode: 'ViewDirection',
  overlayMode: 'Default',
  speed: 3.75,
  direction: 0,
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
    normal.refresh(run.duration * 2 - 0.3, controls)
    expectMotionAndPeriodicity(
      normalStart,
      normalMoved,
      snapshotMotionBones(normalGltf.scene),
    )
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
    const authoredLayerHead = compileClipCurveSamplers(
      riflePoses,
    ).LayerHead?.(RIFLE_RELAXED_POSE_TIME)
    if (authoredLayerHead === undefined) {
      throw new Error('A_Als_Rifle_Poses is missing LayerHead')
    }
    expect(authoredLayerHead).toBeGreaterThan(0.5)

    const instance = createAlsAnimationInstance(gltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      speed: 0,
    }
    instance.refresh(1 / 60, idleControls)
    expect(window.__weightTable?.LayerHead).toBe(0)

    const rifleControls = {
      ...idleControls,
      overlayMode: 'Rifle' as const,
    }
    // At zero elapsed time UE's downstream inertialization node reproduces the outgoing curve
    // container even though the incoming linked layer already resolves its authored non-zero.
    instance.refresh(0, rifleControls)
    expect(window.__weightTable?.LayerHead).toBeCloseTo(0, 8)

    refreshFrames(instance, 30, rifleControls)
    expect(window.__weightTable?.LayerHead).toBeCloseTo(
      authoredLayerHead,
      5,
    )
  })

  it('keeps the settled Rifle left arm on its authored synchronized source', async () => {
    const gltf = await loadAlsGltf()
    const rig = createRigDefinition(gltf.scene)
    const rifleRun = gltf.animations.find(
      (clip) => clip.name === 'A_Als_Rifle_Run_Arms',
    )
    if (!rifleRun) throw new Error('Missing A_Als_Rifle_Run_Arms')
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
})
