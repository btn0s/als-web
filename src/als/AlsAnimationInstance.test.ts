/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
  getAlsControlRigInput,
  shouldMarkAlsTeleported,
} from './AlsAnimationInstance'
import {
  sampleGroundPredictionAmount,
} from './Settings/AlsInAirSettings'
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
  boneNames: readonly ('foot_l' | 'hand_l')[] = ['foot_l', 'hand_l'],
) {
  for (const boneName of boneNames) {
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
  ignoredBoneNames: ReadonlySet<string> = new Set(),
) {
  let maximum = 0
  for (const [name, transform] of to) {
    if (ignoredBoneNames.has(name)) continue
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

const CONTROL_RIG_FOOT_IK_SOLVED_BONES = new Set([
  'thigh_l',
  'calf_l',
  'foot_l',
  'thigh_r',
  'calf_r',
  'foot_r',
])

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

function refreshForDuration(
  instance: AlsAnimationInstance,
  duration: number,
  frameControls = controls,
) {
  let remaining = Math.max(0, duration)
  while (remaining > 1e-9) {
    const delta = Math.min(1 / 60, remaining)
    instance.refresh(delta, frameControls)
    remaining -= delta
  }
}

function createCurveSentinel(
  name: string,
  curves: Readonly<Record<string, number>>,
) {
  const clip = new THREE.AnimationClip(name, 1, [])
  clip.userData.alsCurves = Object.entries(curves).map(
    ([curveName, value]) => ({
      name: curveName,
      keys: [
        [0, value, 1, 0, 0, 0, 0, 0, 0],
        [1, value, 1, 0, 0, 0, 0, 0, 0],
      ],
    }),
  )
  return clip
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

  it('maps every FAlsControlRigInput field without a web-only substitute', () => {
    const feetTargets = {
      left: {
        position: new THREE.Vector3(1, 2, 3),
        rotation: new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize(),
      },
      right: {
        position: new THREE.Vector3(4, 5, 6),
        rotation: new THREE.Quaternion(0.3, 0.2, 0.1, 0.9).normalize(),
      },
    }
    const input = getAlsControlRigInput({
      locomotionMode: 'Grounded',
      velocityBlendForwardAmount: 0.4,
      velocityBlendBackwardAmount: 0.1,
      feetTargets,
      spineYawAngle: 27,
    })

    expect(input).toEqual({
      bUseHandIkBones: true,
      bUseFootIkBones: true,
      bFootOffsetAllowed: true,
      velocityBlendForwardAmount: 0.4,
      velocityBlendBackwardAmount: 0.1,
      footLeftLocation: feetTargets.left.position,
      footLeftRotation: feetTargets.left.rotation,
      footRightLocation: feetTargets.right.position,
      footRightRotation: feetTargets.right.rotation,
      spineYawAngle: 27,
    })
    expect(getAlsControlRigInput({
      locomotionMode: 'InAir',
      velocityBlendForwardAmount: 0,
      velocityBlendBackwardAmount: 0,
      feetTargets,
      spineYawAngle: 0,
    }).bFootOffsetAllowed).toBe(false)
    expect(getAlsControlRigInput({
      locomotionMode: null,
      velocityBlendForwardAmount: 0,
      velocityBlendBackwardAmount: 0,
      feetTargets,
      spineYawAngle: 0,
    }).bFootOffsetAllowed).toBe(true)
  })

  it('uses CS_Als_Default strict greater-than teleport detection after pending update', () => {
    const previousLocation = { x: 0, y: 0, z: 0 }
    expect(shouldMarkAlsTeleported({
      pendingUpdate: true,
      previousLocation,
      location: { x: 100, y: 0, z: 0 },
    })).toBe(false)
    expect(shouldMarkAlsTeleported({
      pendingUpdate: false,
      previousLocation,
      location: { x: 0.5, y: 0, z: 0 },
    })).toBe(false)
    expect(shouldMarkAlsTeleported({
      pendingUpdate: false,
      previousLocation,
      location: { x: 0.5000001, y: 0, z: 0 },
    })).toBe(true)
  })

  it('exposes current graph curves only on the following Refresh* frame', async () => {
    const gltf = await loadAlsGltf()
    const sentinel = createCurveSentinel('A_Test_PreviousCurveFrame', {
      LayerArmLeft: 0.4,
      LayerArmLeftAdditive: 0.6,
      LayerArmLeftSlot: 0.2,
      LayerArmLeftLocalSpace: 1,
      LayerHandLeft: 0.7,
      PoseGrounded: 0.25,
      PoseInAir: 0.75,
      PoseStanding: 0.25,
      PoseCrouching: 0.75,
      PoseMoving: 0.6,
      PoseGait: 2.25,
      ViewBlock: 0.25,
      AllowAiming: 1,
      HipsDirectionLock: -0.5,
      SprintBlock: 1,
      FootPlanted: 0.7,
      FeetCrossing: 0.25,
      FootLeftIk: 1,
      FootRightIk: 1,
      FootLeftLock: 1,
      FootRightLock: 1,
      AllowTransitions: 1,
      RotationYawSpeed: 123,
    })
    const instance = createAlsAnimationInstance({
      ...gltf,
      animations: [...gltf.animations, sentinel],
    })
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      stance: 'Standing',
      rotationMode: 'Aiming',
      speed: 0,
      actorYawAngle: 0,
    }
    instance.refresh(0, idleControls)
    expect(instance.playClip(sentinel.name)).toBe(true)

    instance.refresh(0.21, idleControls)
    expect(instance.getCurveValue('RotationYawSpeed')).toBe(123)
    expect(instance.state.pose.crouchingAmount).not.toBe(0.75)
    expect(instance.state.hipsDirectionLockAmount).not.toBe(-0.5)

    instance.refresh(0, idleControls)
    expect(instance.getCurveValue('RotationYawSpeed')).toBe(123)
    expect(instance.state.layering).toMatchObject({
      armLeftBlendAmount: 0.4,
      armLeftAdditiveBlendAmount: 0.6,
      armLeftSlotBlendAmount: 0.2,
      armLeftLocalSpaceBlendAmount: 1,
      armLeftMeshSpaceBlendAmount: 0,
      handLeftBlendAmount: 0.7,
    })
    expect(instance.state.pose).toMatchObject({
      groundedAmount: 0.25,
      inAirAmount: 0.75,
      standingAmount: 0.25,
      crouchingAmount: 0.75,
      movingAmount: 0.6,
      amount: 2.25,
    })
    expect(instance.state.crouchingAmount).toBe(0.75)
    expect(instance.state.hipsDirectionLockAmount).toBe(-0.5)
    expect(instance.state.standingSprint.sprintBlockAmount).toBe(1)
    expect(instance.state.feet.footPlantedAmount).toBe(0.7)
    expect(instance.state.feet.feetCrossingAmount).toBe(0.25)
    expect(instance.state.footLeftLock).toBe(1)
    expect(instance.state.footRightLock).toBe(1)
    expect(instance.state.transitions.transitionsAllowed).toBe(true)
  })

  it('runs complete CR_Als and writes each evaluated branch to the skeleton once', async () => {
    for (const branch of ['normal', 'solo', 'fallback'] as const) {
      const gltf = await loadAlsGltf()
      const run = gltf.animations.find(
        (clip) => clip.name === 'A_Als_Run_Forward',
      )
      if (!run) throw new Error('Missing A_Als_Run_Forward')
      const tracedFeet: string[] = []
      const instance = createAlsAnimationInstance({
        animations: branch === 'fallback' ? [run] : gltf.animations,
        scene: gltf.scene,
        controlRigFootTrace: (request) => {
          tracedFeet.push(request.side)
          return null
        },
      })
      if (branch === 'solo') {
        expect(instance.playClip(run.name)).toBe(true)
      }
      const rootPositionSet = vi.spyOn(
        bone(gltf.scene, 'root').position,
        'set',
      )

      instance.refresh(1 / 60, {
        ...controls,
        direction: 45,
      })

      expect(rootPositionSet, branch).toHaveBeenCalledTimes(1)
      rootPositionSet.mockRestore()
      if (branch === 'normal') {
        expect(tracedFeet).toEqual(['left', 'right'])
        expect(window.__weightTable?.ControlRigExecuted).toBe(1)
        expect(window.__weightTable?.ControlRigDiagonalScalingFactor)
          .toBeCloseTo(1, 12)
      }
    }
  })

  it('runs NativePostUpdateAnimation after normal, solo, and fallback publication', async () => {
    for (const branch of ['normal', 'solo', 'fallback'] as const) {
      const gltf = await loadAlsGltf()
      const run = gltf.animations.find(
        (clip) => clip.name === 'A_Als_Run_Forward',
      )
      if (!run) throw new Error('Missing A_Als_Run_Forward')
      const instance = createAlsAnimationInstance({
        animations: branch === 'fallback' ? [run] : gltf.animations,
        scene: gltf.scene,
      })
      if (branch === 'solo') {
        expect(instance.playClip(run.name)).toBe(true)
      }
      const branchControls: AlsAnimationInstanceControls = {
        ...controls,
        gait: 'Walking',
        moving: false,
        movingSmooth: false,
        speed: 0,
      }
      instance.state.transitions.queuedTransition = {
        clip: run.name,
        blendInDuration: 0.2,
        blendOutDuration: 0.2,
        playRate: 1,
        startTime: 0,
      }
      instance.state.transitions.stopTransitionsQueued = true
      instance.state.transitions.queuedStopTransitionsBlendOutDuration = 0.2

      instance.refresh(0, branchControls)

      // NativePost tries playback before the stop. The stop suppresses but does not clear the
      // queued transition, then clears its own latch.
      expect(
        instance.state.transitions.queuedTransition,
        branch,
      ).not.toBeNull()
      expect(
        instance.state.transitions.stopTransitionsQueued,
        branch,
      ).toBe(false)

      instance.refresh(0, branchControls)
      expect(
        instance.state.transitions.queuedTransition,
        branch,
      ).toBeNull()
    }
  })

  it('dispatches idle RefreshDynamicTransitions into the Transition slot queue', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
    }

    // Frame one publishes AllowTransitions. Frame two consumes it, detects the displaced locked
    // foot from the preceding pose, queues the authored dynamic transition, and NativePost plays
    // that same TransitionsState record.
    instance.refresh(0, idleControls)
    expect(instance.getCurveValue('FootLeftIk')).toBe(1)
    const leftFoot = instance.state.feet.left
    leftFoot.lockAmount = 1
    leftFoot.lockLocation.x = leftFoot.targetLocation.x + 1
    leftFoot.lockLocation.y = leftFoot.targetLocation.y
    leftFoot.lockLocation.z = leftFoot.targetLocation.z
    instance.refresh(0, idleControls)

    expect(instance.state.dynamicTransitions.updatedThisFrame).toBe(true)
    expect(instance.state.dynamicTransitions.frameDelay).toBe(2)
    expect(instance.state.transitions.queuedTransition).toBeNull()

    instance.refresh(1 / 60, idleControls)
    expect(window.__weightTable?.TransitionRetainedInstanceCount).toBe(1)
    expect(window.__weightTable?.TransitionMontageWeight).toBeGreaterThan(0)
  })

  it('refreshes feet and movement base from the preceding published frame', async () => {
    const gltf = await loadAlsGltf()
    const clip = gltf.animations.find((candidate) => {
      const sampler = compileClipCurveSamplers(candidate)[
        'FootPlanted'
      ]
      return sampler
        && Math.abs(sampler(candidate.duration * 0.37)) > 0.05
    })
    if (!clip) throw new Error('Missing authored FootPlanted curve')
    const footPlanted = compileClipCurveSamplers(clip).FootPlanted
    const sampleTime = clip.duration * 0.37
    const expected = THREE.MathUtils.clamp(
      footPlanted(sampleTime),
      -1,
      1,
    )
    const support = {}
    const frameControls: AlsAnimationInstanceControls = {
      ...controls,
      basedMovement: {
        primitive: support,
        boneName: '',
        hasRelativeLocation: false,
        relativeRotation: false,
        location: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    }
    const instance = createAlsAnimationInstance(gltf)
    expect(instance.playClip(clip.name)).toBe(true)

    instance.refresh(sampleTime, frameControls)
    expect(instance.state.feet.footPlantedAmount).toBe(0)
    expect(instance.state.movementBase.primitive).toBe(support)
    expect(instance.state.movementBase.baseChanged).toBe(true)

    instance.refresh(0, frameControls)
    expect(instance.state.feet.footPlantedAmount).toBeCloseTo(
      expected,
      12,
    )
    expect(instance.state.movementBase.baseChanged).toBe(false)
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
    refreshForDuration(normal, 0.3, controls)
    const normalMoved = snapshotMotionBones(normalGltf.scene)
    // Twenty-five run cycles at 15/14 play rate span seven complete Idle cycles, so the complete
    // AB_Als_Default linked-layer result returns to the same phase. Advance at live-frame
    // granularity because RefreshFootLock and CR_Als are stateful per-frame systems.
    refreshForDuration(
      normal,
      run.duration * 25 / normal.state.standingMovement.playRate - 0.3,
      controls,
    )
    expectMotionAndPeriodicity(
      normalStart,
      normalMoved,
      snapshotMotionBones(normalGltf.scene),
      ['hand_l'],
    )
    expect(normalStart.foot_l.angleTo(normalMoved.foot_l)).toBeGreaterThan(0.01)
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
    // RefreshLayering consumes the curve frame published above, so the overlay pose becomes
    // visible when the following graph evaluation consumes that retained state.
    instance.refresh(0, idleControls)
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
    expect(window.__weightTable?.AllowTransitions).toBe(1)
    expect(
      window.__weightTable?.TransitionsAllowed,
      'the current graph output must not feed the same-frame RefreshTransitions decision',
    ).toBe(0)
    const inertializationRequests = requestCount()
    instance.refresh(1 / 60, requestTurn)
    expect(window.__weightTable?.TransitionsAllowed).toBe(1)

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
      .toBeCloseTo(sequenceTime, 12)
    expect(window.__weightTable?.TurnInPlaceSequenceTime)
      .toBeCloseTo(sequenceTime, 12)
    expect(window.__weightTable?.idle).toBeCloseTo(1 - montageWeight, 12)
    expect(window.__weightTable?.AllowTransitions)
      .toBeCloseTo(1 - montageWeight, 12)
    const publishedRotationYawSpeed =
      rotationYawSpeed(sequenceTime)
        * (1.2 * 46 / 90)
        * montageWeight
    expect(instance.getCurveValue('RotationYawSpeed')).toBeCloseTo(
      publishedRotationYawSpeed,
      6,
    )
    expect(window.__weightTable?.PublishedRotationYawSpeed).toBeCloseTo(
      publishedRotationYawSpeed,
      6,
    )
    instance.refresh(0, requestTurn)
    expect(instance.getCurveValue('RotationYawSpeed')).toBeCloseTo(
      publishedRotationYawSpeed,
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
    instance.refresh(1 / 60, idle)

    expect(
      window.__weightTable?.TurnInPlaceStandingRetainedInstanceCount,
    ).toBe(2)
    expect(window.__weightTable?.SlotMontageDistinctCurveKeyCount).toBe(2)
    expect(window.__weightTable?.TurnInPlaceStandingOldestInstanceId)
      .not.toBe(window.__weightTable?.TurnInPlaceStandingNewestInstanceId)
    expect(window.__weightTable?.TurnInPlaceStandingOldestSequenceTime)
      .toBeCloseTo(0.04, 12)
    expect(window.__weightTable?.TurnInPlaceStandingNewestSequenceTime)
      .toBeCloseTo(0.02, 12)

    instance.refresh(2 / 1.2 - 1 / 60, idle)

    const terminalSequenceTime = 2 - 0.00005
    expect(window.__weightTable?.TurnInPlaceSequenceTime)
      .toBeCloseTo(terminalSequenceTime, 12)
    expect(window.__weightTable?.TurnInPlaceMontageWeight).toBe(1)
    expect(window.__weightTable?.TurnInPlaceMontageBlendingOut).toBe(1)

    instance.refresh(0.1, idle)
    expect(window.__weightTable?.TurnInPlaceSequenceTime)
      .toBe(terminalSequenceTime)
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
    instance.refresh(1 / 60, idle)
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
    expect(window.__weightTable?.SprintBlendAmount).toBeCloseTo(0.5)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.5)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.sprintAcceleration).toBeCloseTo(0.5)
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
    expect(window.__weightTable?.SprintBlendAmount).toBeCloseTo(0.5)
    expect(window.__weightTable?.sprint).toBeCloseTo(0.5)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.5)
    instance.refresh(0.15, running)
    expect(window.__weightTable?.SprintBlendAmount).toBe(0)
    expect(window.__weightTable?.sprint).toBe(0)
    expect(window.__weightTable?.runFwd).toBe(1)
    expect(requestCount()).toBe(before)
  })

  it('applies the prior resolved SprintBlock curve through the outer MoveForward blend', async () => {
    const gltf = await loadAlsGltf()
    const sentinel = createCurveSentinel('A_Test_SprintBlock', {
      SprintBlock: 1,
    })
    const instance = createAlsAnimationInstance({
      ...gltf,
      animations: [...gltf.animations, sentinel],
    })
    const sprint = {
      ...controls,
      gait: 'Sprinting' as const,
      speed: 6.5,
      relativeAccelerationAmount: { x: 0, y: 0 },
    }
    refreshFrames(instance, 60, sprint)
    expect(window.__weightTable?.sprint).toBe(1)

    expect(instance.playClip(sentinel.name)).toBe(true)
    instance.refresh(0.21, sprint)
    expect(instance.state.standingSprint.sprintBlockAmount).not.toBe(1)
    instance.clearSoloClip()
    instance.refresh(0, sprint)
    expect(instance.state.standingSprint.sprintBlockAmount).toBe(1)
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
    instance.refresh(0, leftControls)
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

  it('samples MovementDirection and RotationYawOffset in ALS view-relative space', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)

    // `direction` is velocity relative to the actor, while viewYawAngle is view relative to the
    // actor. ALS RefreshGroundedMovement subtracts them before querying its authored curves.
    refreshFrames(instance, 60, {
      ...controls,
      direction: 0,
      viewYawAngle: 45,
    })

    expect(instance.state.movementDirection).toBe('Forward')
    expect(window.__weightTable?.RotationYawOffset).toBe(-45)
  })

  it('applies authored pivot timing and the MoveDirectionChange profile', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    instance.refresh(0, controls)

    instance.refresh(1 / 60, { ...controls, direction: 180 })
    instance.refresh(0, { ...controls, direction: 180 })
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
    expect(window.__weightTable?.GroundedDirectionTransitionBlendAlpha).toBe(0.5)
    expect(window.__weightTable?.GroundedDirectionTransitionRootIncomingWeight)
      .toBeCloseTo(0.5, 7)
    expect(window.__weightTable?.GroundedDirectionTransitionFootLeftIncomingWeight)
      .toBeCloseTo(0.8, 7)
    expect(window.__weightTable?.['HipsDirection.Forward']).toBeCloseTo(0.5, 7)
    expect(window.__weightTable?.['HipsDirection.Backward']).toBeCloseTo(0.5, 7)
  })

  it('consumes previous resolved HipsDirectionLock and FeetCrossing values', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const rightControls = { ...controls, direction: 90 }
    instance.refresh(0, rightControls)
    instance.refresh(0, rightControls)
    instance.refresh(0, rightControls)
    instance.refresh(0.7, rightControls)
    expect(instance.state.hipsDirection).toBe('RightForward')

    const publishedHipsDirectionLock =
      window.__weightTable?.PublishedHipsDirectionLock
    const publishedFeetCrossing =
      window.__weightTable?.PublishedFeetCrossing
    expect(publishedHipsDirectionLock).toBeDefined()
    expect(publishedFeetCrossing).toBeDefined()
    instance.refresh(0, rightControls)
    expect(instance.state.hipsDirectionLockAmount)
      .toBe(publishedHipsDirectionLock)
    expect(instance.state.feetCrossingAmount)
      .toBe(publishedFeetCrossing)
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
    expect(window.__weightTable?.PublishedPoseCrouching)
      .toBeCloseTo(0.4, 7)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.6, 7)
    expect(window.__weightTable?.crouchIdle).toBeCloseTo(0.4, 7)
    expect(window.__weightTable?.crouchFwd).toBe(0)
    expect(window.__weightTable?.CrouchingStateIdle).toBe(1)

    movingInstance.refresh(0.3, movingCrouch)
    expect(window.__weightTable?.runFwd).toBe(0)
    expect(window.__weightTable?.crouchIdle).toBe(0)
    expect(window.__weightTable?.crouchFwd).toBeCloseTo(1, 7)
    expect(window.__weightTable?.CrouchingStateMove).toBe(1)
    expect(window.__weightTable?.CrouchingActiveTransitionIndex).toBe(-1)

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

  it('keeps the first crouching-relevant target contribution on authored Idle', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    refreshFrames(instance, 60, controls)

    instance.refresh(0.1, {
      ...controls,
      stance: 'Crouching',
    })

    const weights = window.__weightTable
    expect(weights?.PublishedPoseCrouching).toBeCloseTo(0.06348462, 7)
    expect(weights?.CrouchingStateIdle).toBe(1)
    expect(weights?.crouchIdle).toBeCloseTo(
      weights?.PublishedPoseCrouching ?? 0,
      12,
    )
    expect(weights?.crouchFwd).toBe(0)
  })

  it('retains the interrupted Idle-to-Move pose and emits StopQuick once', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const movingCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      speed: 1.5,
    }

    instance.refresh(0, idleCrouching)
    instance.refresh(0, movingCrouching)
    instance.refresh(0.1, movingCrouching)
    expect(window.__weightTable?.CrouchingStateIdle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.CrouchingStateMove).toBeCloseTo(0.5, 12)

    instance.refresh(0, idleCrouching)
    expect(window.__weightTable?.CrouchingTransitionBlocked).toBe(0)
    expect(window.__weightTable?.CrouchingStopQuickNotifyCount).toBe(1)
    expect(window.__weightTable?.CrouchingStateIdle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.CrouchingStateMove).toBeCloseTo(0.5, 12)

    // UE shortens the new transition because Idle already owns half of the state weight, while
    // the retained Idle-to-Move source continues advancing beneath it.
    instance.refresh(0.05, idleCrouching)
    expect(window.__weightTable?.CrouchingStateIdle).toBeCloseTo(0.578125, 12)
    expect(window.__weightTable?.CrouchingStateMove).toBeCloseTo(0.421875, 12)
    instance.refresh(0.05, idleCrouching)
    expect(window.__weightTable?.CrouchingStateIdle).toBe(1)
    expect(window.__weightTable?.CrouchingStateMove).toBe(0)
    expect(window.__weightTable?.CrouchingStopQuickNotifyCount).toBe(1)
  })

  it('plays the Stop Transition slot and applies QuickFeet on Stop-to-Idle', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const movingCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      speed: 1.5,
    }

    instance.refresh(0, idleCrouching)
    instance.refresh(0, movingCrouching)
    instance.refresh(0.2, movingCrouching)
    expect(window.__weightTable?.CrouchingStateMove).toBe(1)

    instance.refresh(0, idleCrouching)
    expect(window.__weightTable?.CrouchingActiveTransitionIndex).toBe(3)
    instance.refresh(0.05, idleCrouching)
    expect(window.__weightTable?.TransitionMontageWeight).toBeGreaterThan(0)
    expect(window.__weightTable?.TransitionSequenceTime).toBeCloseTo(0.275, 12)
    instance.refresh(0.05, idleCrouching)
    expect(window.__weightTable?.CrouchingActiveTransitionIndex).toBe(-1)
    expect(window.__weightTable?.CrouchingStateStop).toBe(1)

    // Rules resolve before the active Move-to-Stop transition advances, so Stop-to-Idle begins
    // on the next update after Stop first owns the full state weight.
    instance.refresh(0, idleCrouching)
    expect(window.__weightTable?.CrouchingActiveTransitionIndex).toBe(11)
    expect(window.__weightTable?.CrouchingStateStop).toBe(1)

    instance.refresh(0.25, idleCrouching)
    expect(window.__weightTable?.CrouchingQuickFeetProfileActive).toBe(1)
    expect(window.__weightTable?.CrouchingQuickFeetRootIncomingWeight)
      .toBeCloseTo(0.5, 7)
    expect(window.__weightTable?.CrouchingQuickFeetFootLeftIncomingWeight)
      .toBeCloseTo(25 / 26, 7)
    expect(window.__weightTable?.CrouchingStateStop).toBeCloseTo(0.5, 7)
    expect(window.__weightTable?.CrouchingStateIdle).toBeCloseTo(0.5, 7)
  })

  it('applies MoveDirectionChange masks inside crouching Movement States', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const movingCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      speed: 1.5,
    }
    instance.refresh(0, movingCrouching)
    instance.refresh(0, movingCrouching)
    instance.refresh(0.2, movingCrouching)

    const backward = { ...movingCrouching, direction: 180 }
    instance.refresh(0, backward)
    instance.refresh(0.25, backward)

    expect(window.__weightTable?.CrouchingMovementActiveTransitionCount)
      .toBe(1)
    const rootIncoming =
      window.__weightTable?.CrouchingMovementRootIncomingWeight ?? 0
    expect(rootIncoming).toBeCloseTo(0.2915451895, 7)
    expect(window.__weightTable?.CrouchingMovementFootLeftIncomingWeight)
      .toBeCloseTo(4 * rootIncoming / (1 + 3 * rootIncoming), 7)
    expect(window.__weightTable?.['CrouchingMovementState.Forward'])
      .toBeCloseTo(1 - rootIncoming, 7)
    expect(window.__weightTable?.['CrouchingMovementState.Backward'])
      .toBeCloseTo(rootIncoming, 7)
  })

  it('routes crouching rotate transitions through node34 inertialization', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    instance.refresh(0, idleCrouching)
    const before = window.__weightTable
      ?.CrouchingInertializationRequestCount ?? 0

    instance.refresh(1 / 60, {
      ...idleCrouching,
      rotateInPlace: true,
      viewYawAngle: -90,
    })
    expect(window.__weightTable?.CrouchingStateRotateLeft).toBe(1)
    expect(window.__weightTable?.CrouchingInertializationRequestCount)
      .toBe(before + 1)
    expect(window.__weightTable?.CrouchingInertializationCorrectionMagnitude)
      .toBeGreaterThan(0)

    instance.refresh(1 / 60, {
      ...idleCrouching,
      rotateInPlace: true,
      viewYawAngle: 90,
    })
    expect(window.__weightTable?.CrouchingStateRotateRight).toBe(1)
    expect(window.__weightTable?.CrouchingInertializationRequestCount)
      .toBe(before + 2)
  })

  it('surfaces the unresolved loop-bound rotate automatic-rule boundary', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    instance.refresh(0, idleCrouching)
    instance.refresh(0, {
      ...idleCrouching,
      rotateInPlace: true,
      viewYawAngle: -90,
    })
    instance.refresh(2, idleCrouching)

    expect(window.__weightTable?.CrouchingStateRotateLeft).toBe(1)
    expect(window.__weightTable?.CrouchingAutomaticRuleBlocked).toBe(1)
  })

  it('evaluates BS_Als_Lean from the authored additive reference pose', async () => {
    const neutralGltf = await loadAlsGltf()
    const leaningGltf = await loadAlsGltf()
    const neutral = createAlsAnimationInstance(neutralGltf)
    const leaning = createAlsAnimationInstance(leaningGltf)
    const movingCrouching = {
      ...controls,
      gait: 'Walking' as const,
      stance: 'Crouching' as const,
      speed: 1.5,
    }
    const neutralControls = {
      ...movingCrouching,
      relativeAccelerationAmount: { x: 0, y: 0 },
    }
    const leaningControls = {
      ...movingCrouching,
      relativeAccelerationAmount: { x: 1, y: 0 },
    }

    neutral.refresh(0, neutralControls)
    leaning.refresh(0, leaningControls)
    neutral.refresh(0, neutralControls)
    leaning.refresh(0, leaningControls)
    neutral.refresh(0.2, neutralControls)
    const neutralPose = snapshotLocalBoneTransforms(neutralGltf.scene)
    leaning.refresh(0.2, leaningControls)

    expect(window.__weightTable?.CrouchingLeanForwardAmount).toBe(1)
    expect(window.__weightTable?.['CrouchingLean.A_Als_Lean_Forward']).toBe(1)
    expect(window.__weightTable?.['CrouchingLean.A_Als_Lean']).toBe(0)
    expect(maximumLocalBoneDelta(
      neutralPose,
      snapshotLocalBoneTransforms(leaningGltf.scene),
    )).toBeGreaterThan(0.01)
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
      maximumLocalBoneDelta(
        previous,
        snapshotLocalBoneTransforms(gltf.scene),
        CONTROL_RIG_FOOT_IK_SOLVED_BONES,
      ),
      'Standing -> Standing To Crouching must inertialize from the explicit stand pose',
    ).toBeLessThan(0.01)

    refreshFrames(instance, 49, idleCrouching)
    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleCrouching)
    expect(
      maximumLocalBoneDelta(
        previous,
        snapshotLocalBoneTransforms(gltf.scene),
        CONTROL_RIG_FOOT_IK_SOLVED_BONES,
      ),
      'Standing To Crouching -> Crouching is an authored zero-duration exit',
    ).toBeLessThan(0.01)

    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleStanding)
    expect(
      maximumLocalBoneDelta(
        previous,
        snapshotLocalBoneTransforms(gltf.scene),
        CONTROL_RIG_FOOT_IK_SOLVED_BONES,
      ),
      'Crouching -> Crouching To Standing must inertialize from the explicit crouch pose',
    ).toBeLessThan(0.01)

    refreshFrames(instance, 49, idleStanding)
    previous = snapshotLocalBoneTransforms(gltf.scene)
    instance.refresh(1 / 60, idleStanding)
    expect(
      maximumLocalBoneDelta(
        previous,
        snapshotLocalBoneTransforms(gltf.scene),
        CONTROL_RIG_FOOT_IK_SOLVED_BONES,
      ),
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

  it('consumes the accepted jump and refreshes exact ALS in-air state from the live character seam', async () => {
    const gltf = await loadAlsGltf()
    let sweepCount = 0
    let lastSweepEnd: Readonly<{ x: number; y: number; z: number }> | null =
      null
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: (query) => {
        sweepCount++
        lastSweepEnd = query.end
        return {
          validBlockingHit: true,
          time: 0.5,
          impactNormal: { x: 0, y: 0, z: 1 },
        }
      },
    })
    const groundedControls: AlsAnimationInstanceControls = {
      ...controls,
      speed: 3,
      locomotionMode: 'Grounded',
      hasInput: true,
    }
    const inAirControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 1 },
      velocity: { x: 3, y: 0, z: 4.2 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }

    // The first relevant graph frame clears bPendingUpdate, matching the game-thread proxy path.
    instance.refresh(1 / 60, groundedControls)
    instance.jump()
    instance.refresh(1 / 60, inAirControls)

    expect(window.__weightTable?.InAirJumped).toBe(1)
    expect(window.__weightTable?.['LocomotionState.Jump']).toBe(1)
    expect(window.__weightTable?.InAirJumpPlayRate).toBeCloseTo(1.35, 12)
    expect(window.__weightTable?.InAirVerticalVelocity).toBe(4.2)
    expect(window.__weightTable?.InAirGroundPredictionAmount).toBe(0)
    expect(sweepCount).toBe(0)
    const groundPredictionBlock =
      window.__weightTable?.PublishedGroundPredictionBlock ?? 0

    instance.refresh(1 / 60, {
      ...inAirControls,
      velocity: { x: 3, y: 0, z: -5 },
    })

    expect(window.__weightTable?.InAirJumped).toBe(0)
    expect(window.__weightTable?.InAirVerticalVelocity).toBe(-5)
    expect(window.__weightTable?.GroundPredictionBlock)
      .toBe(groundPredictionBlock)
    expect(window.__weightTable?.InAirGroundPredictionAmount)
      .toBeCloseTo(
        sampleGroundPredictionAmount(0.5) * (1 - groundPredictionBlock),
        12,
      )
    expect(sweepCount).toBe(1)
    expect(lastSweepEnd).not.toBeNull()
    expect(lastSweepEnd!.z).toBeLessThan(1)
  })

  it('reinitializes caller-owned SequencePlayers when the graph regains the same state', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: () => null,
    })
    const fallingControls: AlsAnimationInstanceControls = {
      ...controls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 2 },
      velocity: { x: 3, y: 0, z: -8 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }

    refreshFrames(instance, 20, fallingControls)
    const timeBeforeSolo = Math.max(
      window.__weightTable?.['clipTime.fallFast'] ?? 0,
      window.__weightTable?.['clipTime.fall'] ?? 0,
    )
    expect(timeBeforeSolo).toBeGreaterThan(0.2)

    expect(instance.playClip('A_Als_Run_Forward')).toBe(true)
    instance.refresh(0.1, fallingControls)
    instance.clearSoloClip()
    instance.refresh(1 / 60, fallingControls)

    expect(window.__weightTable?.['LocomotionState.Fall']).toBe(1)
    expect(Math.max(
      window.__weightTable?.['clipTime.fallFast'] ?? 0,
      window.__weightTable?.['clipTime.fall'] ?? 0,
    )).toBeCloseTo(1 / 60, 12)
  })

  it('samples Jump Loop on the same frame its exact remaining-time rule selects it', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: () => null,
    })
    const groundedControls: AlsAnimationInstanceControls = {
      ...controls,
      speed: 3,
      locomotionMode: 'Grounded',
      hasInput: true,
    }
    const inAirControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 1 },
      velocity: { x: 3, y: 0, z: 4.2 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }

    instance.refresh(1 / 60, groundedControls)
    instance.jump()

    let preTransitionWeights: Record<string, number> | undefined
    let loopTransitionWeights: Record<string, number> | undefined
    for (let frame = 0; frame < 120; frame++) {
      instance.refresh(1 / 60, inAirControls)
      if (window.__weightTable?.['JumpState.Loop'] === 1) {
        loopTransitionWeights = { ...window.__weightTable }
        break
      }
      preTransitionWeights = { ...window.__weightTable }
    }

    expect(preTransitionWeights).toBeDefined()
    expect(preTransitionWeights?.InAirJumpLaunchRemainingTime)
      .toBeGreaterThan(0.2)
    expect(preTransitionWeights?.InAirJumpTransitionCount).toBe(0)
    expect(loopTransitionWeights).toBeDefined()
    expect(loopTransitionWeights?.InAirJumpLaunchRemainingTime)
      .toBeLessThanOrEqual(0.2)
    expect(loopTransitionWeights?.InAirJumpTransitionCount).toBe(2)
    expect(loopTransitionWeights?.['InAirPlayer.jumpLoop'])
      .toBeGreaterThan(0)
    expect(loopTransitionWeights?.['InAirPlayer.jumpLoop'])
      .toBeLessThan(1)
    expect(loopTransitionWeights?.['InAirPlayer.jumpFlail'])
      .toBeGreaterThan(0)
    expect(
      (loopTransitionWeights?.['InAirPlayer.jumpLoop'] ?? 0)
      + (loopTransitionWeights?.['InAirPlayer.jumpFlail'] ?? 0),
    ).toBeCloseTo(1, 12)
    expect(loopTransitionWeights?.['InAirPlayer.jumpWalkLeft']).toBe(0)
    expect(loopTransitionWeights?.['InAirPlayer.jumpRunLeft']).toBe(0)
    expect(loopTransitionWeights?.['InAirPlayer.jumpWalkRight']).toBe(0)
    expect(loopTransitionWeights?.['InAirPlayer.jumpRunRight']).toBe(0)
  })

  it('takes Fall through the Land conduit and emits LandToGrounded exactly once', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: () => null,
    })
    const groundedControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
      locomotionMode: 'Grounded',
      hasInput: false,
    }
    const fallingControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 2 },
      velocity: { x: 0, y: 0, z: -8 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }

    instance.refresh(1 / 60, groundedControls)
    instance.refresh(1 / 60, fallingControls)
    expect(window.__weightTable?.['LocomotionState.Fall']).toBe(1)

    instance.refresh(1 / 60, groundedControls)
    expect(window.__weightTable?.['LocomotionState.Land']).toBe(1)
    expect(
      (window.__weightTable?.['InAirPlayer.landLight'] ?? 0)
      + (window.__weightTable?.['InAirPlayer.landHeavy'] ?? 0),
    ).toBeCloseTo(1, 12)

    for (let frame = 0; frame < 180; frame++) {
      instance.refresh(1 / 60, groundedControls)
      if ((window.__weightTable?.LandToGroundedNotifyCount ?? 0) > 0) break
    }
    expect(window.__weightTable?.LandToGroundedNotifyCount).toBe(1)

    refreshFrames(instance, 60, groundedControls)
    expect(window.__weightTable?.LandToGroundedNotifyCount).toBe(1)
    expect(window.__weightTable?.['LocomotionState.Grounded']).toBe(1)
  })

  it('weights the shared Land sync group by its outer state blend before leader election', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: () => null,
    })
    const groundedControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
      locomotionMode: 'Grounded',
      hasInput: false,
    }
    const fallingControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 2 },
      velocity: { x: 0, y: 0, z: -8 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }
    const movingControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      moving: true,
      movingSmooth: true,
      speed: 1,
      hasInput: true,
    }

    instance.refresh(1 / 60, groundedControls)
    instance.refresh(1 / 60, fallingControls)
    instance.refresh(1 / 60, groundedControls)
    instance.refresh(1 / 60, movingControls)

    const landLeadingWeights = { ...window.__weightTable }
    const landStateWeight =
      landLeadingWeights['LocomotionState.Land'] ?? 0
    const landMovementStateWeight =
      landLeadingWeights['LocomotionState.LandMovement'] ?? 0
    expect(landStateWeight).toBeGreaterThan(landMovementStateWeight)
    expect(landMovementStateWeight).toBeGreaterThan(0)
    expect(
      (landLeadingWeights['InAirPlayer.landLight'] ?? 0)
      + (landLeadingWeights['InAirPlayer.landHeavy'] ?? 0),
    ).toBeCloseTo(landStateWeight, 12)
    expect(
      (landLeadingWeights['InAirPlayer.landMovementLight'] ?? 0)
      + (landLeadingWeights['InAirPlayer.landMovementHeavy'] ?? 0),
    ).toBeCloseTo(landMovementStateWeight, 12)
    expect(
      (landLeadingWeights['InAirSyncLeader.Land.landLight'] ?? 0)
      + (landLeadingWeights['InAirSyncLeader.Land.landHeavy'] ?? 0),
    ).toBe(1)
    expect(
      (landLeadingWeights[
        'InAirSyncLeader.Land.landMovementLight'
      ] ?? 0)
      + (landLeadingWeights[
        'InAirSyncLeader.Land.landMovementHeavy'
      ] ?? 0),
    ).toBe(0)

    let landMovementLeadingWeights:
      Record<string, number> | undefined
    for (let frame = 0; frame < 12; frame++) {
      instance.refresh(1 / 60, movingControls)
      const weights = window.__weightTable
      if (
        (weights?.['LocomotionState.LandMovement'] ?? 0)
        > (weights?.['LocomotionState.Land'] ?? 0)
      ) {
        landMovementLeadingWeights = weights
          ? { ...weights }
          : undefined
        break
      }
    }

    expect(landMovementLeadingWeights).toBeDefined()
    const laterLandWeight =
      landMovementLeadingWeights?.['LocomotionState.Land'] ?? 0
    const laterLandMovementWeight =
      landMovementLeadingWeights?.[
        'LocomotionState.LandMovement'
      ] ?? 0
    expect(
      (landMovementLeadingWeights?.['InAirPlayer.landLight'] ?? 0)
      + (landMovementLeadingWeights?.['InAirPlayer.landHeavy'] ?? 0),
    ).toBeCloseTo(laterLandWeight, 12)
    expect(
      (
        landMovementLeadingWeights?.[
          'InAirPlayer.landMovementLight'
        ] ?? 0
      )
      + (
        landMovementLeadingWeights?.[
          'InAirPlayer.landMovementHeavy'
        ] ?? 0
      ),
    ).toBeCloseTo(laterLandMovementWeight, 12)
    expect(
      (landMovementLeadingWeights?.[
        'InAirSyncLeader.Land.landLight'
      ] ?? 0)
      + (landMovementLeadingWeights?.[
        'InAirSyncLeader.Land.landHeavy'
      ] ?? 0),
    ).toBe(0)
    expect(
      (
        landMovementLeadingWeights?.[
          'InAirSyncLeader.Land.landMovementLight'
        ] ?? 0
      )
      + (
        landMovementLeadingWeights?.[
          'InAirSyncLeader.Land.landMovementHeavy'
        ] ?? 0
      ),
    ).toBe(1)
  })

  it('takes bHasInput through Land Movement and applies UE automatic-rule overshoot', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep: () => null,
    })
    const groundedControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      speed: 1,
      locomotionMode: 'Grounded',
      hasInput: true,
    }
    const fallingControls: AlsAnimationInstanceControls = {
      ...groundedControls,
      locomotionMode: 'InAir',
      location: { x: 0, y: 0, z: 2 },
      velocity: { x: 1, y: 0, z: -8 },
      capsuleRadius: 0.34,
      capsuleHalfHeight: 0.88,
      walkableFloorAngleCos: Math.SQRT1_2,
    }

    instance.refresh(1 / 60, groundedControls)
    instance.refresh(1 / 60, fallingControls)
    instance.refresh(1 / 60, groundedControls)
    expect(window.__weightTable?.['LocomotionState.LandMovement']).toBe(1)
    expect(
      (window.__weightTable?.['InAirPlayer.landMovementLight'] ?? 0)
      + (window.__weightTable?.['InAirPlayer.landMovementHeavy'] ?? 0),
    ).toBeCloseTo(1, 12)

    let beforeAutomaticTransition: Record<string, number> | undefined
    let automaticTransition: Record<string, number> | undefined
    for (let frame = 0; frame < 180; frame++) {
      instance.refresh(1 / 60, groundedControls)
      const weights = window.__weightTable
      if (
        (weights?.InAirLandMovementCrossfadeDuration ?? 0) > 0
      ) {
        automaticTransition = { ...weights }
        break
      }
      beforeAutomaticTransition = weights ? { ...weights } : undefined
    }

    expect(beforeAutomaticTransition).toBeDefined()
    expect(beforeAutomaticTransition?.InAirLandMovementRemainingTime)
      .toBeGreaterThan(0.3)
    expect(automaticTransition).toBeDefined()
    expect(automaticTransition?.InAirLandMovementRemainingTime)
      .toBeLessThanOrEqual(0.3)
    expect(automaticTransition?.InAirLandMovementCrossfadeDuration)
      .toBeCloseTo(
        automaticTransition?.InAirLandMovementRemainingTime ?? 0,
        12,
      )
    expect(automaticTransition?.InAirLandMovementCrossfadeElapsedTime)
      .toBeCloseTo(1 / 60, 12)
    expect(automaticTransition?.['LocomotionState.Grounded'])
      .toBeGreaterThan(0)
  })
})
