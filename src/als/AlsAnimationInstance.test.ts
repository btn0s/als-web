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
import { AnimationFrameCapture } from '../engine/animationFrameCapture'
import { createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition, findBoneIndex } from '../engine/rig'
import {
  compileAuthoredRootMotion,
  createRootMotionMovementParams,
  extractAuthoredRootMotionDelta,
} from '../engine/rootMotion'
import {
  ALS_ROLLING_MONTAGE,
  ALS_ROLL_SEQUENCE,
} from './AnimGraph/rolling'
import {
  ALS_RIFLE_RELAXED_GRAPH,
} from './AnimGraph/AB_Als_Rifle'
import {
  runRollAnimationPoseDiagnostic,
} from './parity/animationPoseDiagnostic'
import {
  createAlsControlRigHandIkRuntime,
  evaluateAlsControlRigHandIk,
} from './AnimGraph/CR_Als'
import {
  createAlsAnimationInstance,
  getAlsControlRigInput,
  isRotateInPlaceAllowed,
  isTurnInPlaceAllowed,
  shouldMarkAlsTeleported,
} from './AlsAnimationInstance'
import {
  applyRotationYawSpeedAnimationCurve,
  createAlsCharacter,
} from './AlsCharacter'
import type { AlsLocomotionMode } from './AlsCharacter'
import {
  createAlsLocomotionModeChangedLifecycleBridge,
  refreshRapierAlsLocomotionMode,
} from './AlsCharacter.hooks'
import {
  sampleGroundPredictionAmount,
} from './Settings/AlsInAirSettings'
import {
  ALS_MANTLING_SETTINGS,
} from './Settings/AlsMantlingSettings'
import type {
  AlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
import { ALS_VIRTUAL_BONES } from './Utility/AlsVirtualBones'
import type {
  AlsAnimationInstance,
  AlsAnimationInstanceControls,
} from './AlsAnimationInstance'

describe('ALS ViewMode rotation gates', () => {
  it.each([
    ['VelocityDirection', 'ThirdPerson', false, false],
    ['VelocityDirection', 'FirstPerson', true, false],
    ['ViewDirection', 'ThirdPerson', false, true],
    ['ViewDirection', 'FirstPerson', true, false],
    ['Aiming', 'ThirdPerson', true, false],
    ['Aiming', 'FirstPerson', true, false],
  ] as const)('%s / %s', (rotationMode, viewMode, rotate, turn) => {
    expect(isRotateInPlaceAllowed(rotationMode, viewMode)).toBe(rotate)
    expect(isTurnInPlaceAllowed(rotationMode, viewMode)).toBe(turn)
  })
})

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

  it('evaluates the authored View pose after Layering in the live graph', async () => {
    const forwardGltf = await loadAlsGltf()
    const upwardGltf = await loadAlsGltf()
    const forward = createAlsAnimationInstance(forwardGltf)
    const upward = createAlsAnimationInstance(upwardGltf)

    forward.refresh(1 / 60, {
      ...controls,
      actorYawAngle: 0,
      viewPitchAngle: 0,
    })
    upward.refresh(1 / 60, {
      ...controls,
      actorYawAngle: 0,
      viewPitchAngle: 60,
    })

    expect(upward.state.view.lookAmount).toBe(1)
    expect(upward.state.view.pitchAngle).toBe(60)
    expect(
      localRotation(forwardGltf.scene, 'head').angleTo(
        localRotation(upwardGltf.scene, 'head'),
      ),
    ).toBeGreaterThan(0.01)
  })

  it('evaluates the extracted mantle in Locomotion/PostLocomotion before Layering', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const montage = settings.Montage
    const clip = gltf.animations.find(
      (candidate) => candidate.name === montage.Sequence,
    )
    if (!clip) throw new Error(`Missing ${montage.Sequence}`)
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    const rootIndex = findBoneIndex(rig, 'root')
    expect(montage).toMatchObject({
      Name: 'AM_Als_Mantle_Low_Right',
      Sequence: 'A_Als_Mantle_Low_Right',
      PlayLength: 1.5,
      SequenceLength: 1.5,
      SequenceRateScale: 1,
      RateScale: 1,
      BlendIn: {
        BlendTime: 0.20000000298023224,
        BlendOption: 'HermiteCubic',
      },
      BlendOut: {
        BlendTime: 0.20000000298023224,
        BlendOption: 'HermiteCubic',
      },
      BlendOutTriggerTime: 0,
      SlotName: 'PostLocomotion',
      StartPos: 0,
      AnimStartTime: 0,
      AnimEndTime: 1.5,
      AnimPlayRate: 1,
      LoopingCount: 1,
    })
    expect(clip.userData.bEnableRootMotion).toBe(false)

    const instance = createAlsAnimationInstance(gltf)
    const played = instance.mantlingMontage.play(settings, 0.4)
    expect(played).toEqual({
      instanceId: expect.any(Number),
      duration: montage.PlayLength,
    })
    if (!played) throw new Error('Mantle montage was rejected')

    // FAlsRootMotionSource_Mantling writes M - DeltaTime. This rate-one montage advances to M.
    expect(instance.mantlingMontage.montageSetPosition(
      settings,
      0.75,
    )).toBe(true)
    instance.refresh(0.05, {
      ...controls,
      overlayMode: 'Rifle',
    })
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.8, 12)
    expect(window.__weightTable?.PostLocomotionSequenceTime)
      .toBeCloseTo(0.8, 12)
    // HermiteCubic(0.05 / 0.2) = 3t² - 2t³ = 0.15625, not a linear 0.25.
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(0.15625, 7)
    expect(window.__weightTable?.PostLocomotionRootMotionEnabled).toBe(0)

    expect(instance.mantlingMontage.montageSetPosition(
      settings,
      0.65,
    )).toBe(true)
    instance.refresh(0.15, {
      ...controls,
      overlayMode: 'Rifle',
    })
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.8, 12)

    const sampled = createPoseBuffer(rig.boneCount)
    sampleClip(
      compileClipSampler(clip, rig),
      rig,
      0.8,
      sampled,
      false,
    )
    const root = bone(gltf.scene, 'root')
    const authoredRootMotion = compileAuthoredRootMotion(clip)
    if (!authoredRootMotion) {
      throw new Error(`${montage.Sequence} is missing raw root motion`)
    }
    expect(authoredRootMotion).toMatchObject({
      bEnableRootMotion: false,
      bForceRootLock: true,
      RootMotionRootLock: 'RefPose',
      poseReset: { kind: 'referencePose' },
    })

    expect(
      Math.abs(
        sampled.positions[rootIndex * 3 + 1]
          - rig.referencePositions[rootIndex * 3 + 1],
      ),
    ).toBeGreaterThan(0.5)
    expect(root.position.x).toBeCloseTo(
      rig.referencePositions[rootIndex * 3],
      6,
    )
    expect(root.position.y).toBeCloseTo(
      rig.referencePositions[rootIndex * 3 + 1],
      6,
    )
    expect(root.position.z).toBeCloseTo(
      rig.referencePositions[rootIndex * 3 + 2],
      6,
    )

    // Rifle's authored Overlay curves remain live when Layering evaluates after
    // the full-body PostLocomotion pose. Do not use a final hand-angle
    // difference as the oracle: CR_Als can correctly solve the hand back onto
    // the montage target, and the old assertion accidentally pinned the
    // pre-basis-conversion elbow defect.
    expect(window.__weightTable?.LayerArmLeft).toBe(1)
    expect(window.__weightTable?.LayerArmRight).toBe(1)
    expect(window.__weightTable?.LayerHandRight).toBe(1)
    expect(window.__weightTable?.ControlRigExecuted).toBe(1)
  })

  it('advances high mantle by instance PlayRate times authored Montage RateScale', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_High
    const montage = settings.Montage
    const clip = gltf.animations.find(
      (candidate) => candidate.name === montage.Sequence,
    )
    if (!clip) throw new Error(`Missing ${montage.Sequence}`)
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    const rootIndex = findBoneIndex(rig, 'root')
    expect(montage).toMatchObject({
      Name: 'AM_Als_Mantle_High',
      PlayLength: 2.6666667461395264,
      SequenceLength: 2.6666667461395264,
      RateScale: 1.2000000476837158,
      BlendOut: {
        BlendTime: 0.20000000298023224,
        BlendOption: 'Cubic',
      },
    })

    const instance = createAlsAnimationInstance(gltf)
    const played = instance.mantlingMontage.play(settings, 0.4)
    if (!played) throw new Error('High mantle montage was rejected')
    expect(played.duration).toBe(2.6666667461395264)

    // PrepareRootMotion writes M - DeltaTime, then FMontageSubStepper advances by
    // Instance.PlayRate (one) * the serialized UAnimMontage::RateScale.
    expect(instance.mantlingMontage.montageSetPosition(
      settings,
      1.15,
    )).toBe(true)
    instance.refresh(0.1, controls)
    const expectedMontageTime = 1.15 + 0.1 * montage.RateScale
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(expectedMontageTime, 12)
    expect(window.__weightTable?.PostLocomotionSequenceTime)
      .toBeCloseTo(expectedMontageTime, 12)

    const sampled = createPoseBuffer(rig.boneCount)
    sampleClip(
      compileClipSampler(clip, rig),
      rig,
      expectedMontageTime,
      sampled,
      false,
    )
    const root = bone(gltf.scene, 'root')
    const authoredRootMotion = compileAuthoredRootMotion(clip)
    if (!authoredRootMotion) {
      throw new Error(`${montage.Sequence} is missing raw root motion`)
    }
    expect(authoredRootMotion).toMatchObject({
      bEnableRootMotion: false,
      bForceRootLock: true,
      RootMotionRootLock: 'RefPose',
      poseReset: { kind: 'referencePose' },
    })

    expect(
      Math.abs(
        sampled.positions[rootIndex * 3 + 1]
          - rig.referencePositions[rootIndex * 3 + 1],
      ),
    ).toBeGreaterThan(1)
    expect(root.position.x).toBeCloseTo(
      rig.referencePositions[rootIndex * 3],
      6,
    )
    expect(root.position.y).toBeCloseTo(
      rig.referencePositions[rootIndex * 3 + 1],
      6,
    )
    expect(root.position.z).toBeCloseTo(
      rig.referencePositions[rootIndex * 3 + 2],
      6,
    )
  })

  it('places PostLocomotion after Grounded additive Transition montage output', async () => {
    const baselineGltf = await loadAlsGltf()
    const transitionGltf = await loadAlsGltf()
    const baseline = createAlsAnimationInstance(baselineGltf)
    const withTransition = createAlsAnimationInstance(transitionGltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
    }

    withTransition.state.transitions.queuedTransition = {
      clip: 'A_Als_Stand_DynamicTransition_Left',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.8,
    }
    baseline.refresh(0, idleControls)
    withTransition.refresh(0, idleControls)

    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const baselinePlay = baseline.mantlingMontage.play(settings, 0.6)
    const transitionPlay =
      withTransition.mantlingMontage.play(settings, 0.6)
    if (!baselinePlay || !transitionPlay) {
      throw new Error('Mantle montage was rejected')
    }
    baseline.refresh(0.2, idleControls)
    withTransition.refresh(0.2, idleControls)
    expect(window.__weightTable?.TransitionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)

    // The full-weight PostLocomotion slot replaces the complete Locomotion result. If the
    // additive Transition slot were incorrectly applied after it, the two final poses diverge.
    const baseTransforms = snapshotLocalBoneTransforms(baselineGltf.scene)
    const transitionTransforms =
      snapshotLocalBoneTransforms(transitionGltf.scene)
    const postLocomotionDelta = maximumLocalBoneDelta(
      baseTransforms,
      transitionTransforms,
    )

    const upstreamBaselineGltf = await loadAlsGltf()
    const upstreamTransitionGltf = await loadAlsGltf()
    const upstreamBaseline =
      createAlsAnimationInstance(upstreamBaselineGltf)
    const upstreamTransition =
      createAlsAnimationInstance(upstreamTransitionGltf)
    upstreamTransition.state.transitions.queuedTransition = {
      clip: 'A_Als_Stand_DynamicTransition_Left',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0.8,
    }
    upstreamBaseline.refresh(0, idleControls)
    upstreamTransition.refresh(0, idleControls)
    upstreamBaseline.refresh(0.2, idleControls)
    upstreamTransition.refresh(0.2, idleControls)
    const upstreamTransitionDelta = maximumLocalBoneDelta(
      snapshotLocalBoneTransforms(upstreamBaselineGltf.scene),
      snapshotLocalBoneTransforms(upstreamTransitionGltf.scene),
    )
    expect(upstreamTransitionDelta).toBeGreaterThan(0.01)
    expect(postLocomotionDelta)
      .toBeLessThan(upstreamTransitionDelta * 0.01)
  })

  it('drains the exact authored mantle branching points after Advance()', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const montage = settings.Montage
    expect(montage.BranchingPointMarkers).toEqual([
      {
        NotifyIndex: 0,
        TriggerTime: -0.00009999999747378752,
        NotifyEventType: 'Begin',
      },
      {
        NotifyIndex: 0,
        TriggerTime: 0.9665666222572327,
        NotifyEventType: 'End',
      },
      {
        NotifyIndex: 1,
        TriggerTime: 1,
        NotifyEventType: 'Begin',
      },
      {
        NotifyIndex: 1,
        TriggerTime: 1.499899983406067,
        NotifyEventType: 'End',
      },
    ])

    const instance = createAlsAnimationInstance(gltf)
    const played = instance.mantlingMontage.play(settings, 0.95)
    if (!played) throw new Error('Mantle montage was rejected')
    instance.refresh(
      montage.BranchingPointMarkers[1].TriggerTime - 0.95,
      controls,
    )

    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([
      {
        instanceId: played.instanceId,
        mantlingSettings: settings,
        notify: montage.Notifies[0],
        notifyEventType: 'Begin',
        triggerTime: 0.9665666222572327,
      },
      {
        instanceId: played.instanceId,
        mantlingSettings: settings,
        notify: montage.Notifies[0],
        notifyEventType: 'End',
        triggerTime: 0.9665666222572327,
      },
    ])
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([])

    expect(instance.mantlingMontage.montageSetPosition(
      settings,
      0.99,
    )).toBe(true)
    instance.refresh(0.02, controls)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: played.instanceId,
      mantlingSettings: settings,
      notify: montage.Notifies[1],
      notifyEventType: 'Begin',
      triggerTime: 1,
    }])
  })

  it('resolves SetPosition and Stop through the active montage asset', async () => {
    const gltf = await loadAlsGltf()
    const sameAsset = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const differentAsset = ALS_MANTLING_SETTINGS.MS_Als_High
    const instance = createAlsAnimationInstance(gltf)

    const first = instance.mantlingMontage.play(sameAsset, 0.2)
    const replacement =
      instance.mantlingMontage.play(sameAsset, 0.4)
    if (!first || !replacement) {
      throw new Error('Same-asset mantle replacement was rejected')
    }
    expect(replacement.instanceId).not.toBe(first.instanceId)

    // UAnimInstance::ActiveMontagesMap.Add() replaces the asset's pointer
    // with the newest FAnimMontageInstance.
    expect(instance.mantlingMontage.montageSetPosition(
      sameAsset,
      0.8,
    )).toBe(true)
    // A zero-weight montage is not yet relevant to the Slot pose. Advance a
    // real frame so the debug observation cannot accidentally reuse the
    // preceding test's published table.
    instance.refresh(0.05, controls)
    expect(window.__weightTable?.PostLocomotionNewestInstanceId)
      .toBe(replacement.instanceId)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.85, 12)
    expect(instance.mantlingMontage.montageStop(
      sameAsset,
      0.35,
    )).toBe(true)
    expect(instance.mantlingMontage.montageStop(
      sameAsset,
      0.35,
    )).toBe(false)

    const oldAsset =
      instance.mantlingMontage.play(sameAsset, 0.1)
    const newAsset =
      instance.mantlingMontage.play(differentAsset, 0.2)
    if (!oldAsset || !newAsset) {
      throw new Error('Different-asset mantle replacement was rejected')
    }
    expect(instance.mantlingMontage.montageSetPosition(
      sameAsset,
      0.9,
    )).toBe(false)
    expect(instance.mantlingMontage.montageStop(
      sameAsset,
      0.35,
    )).toBe(false)

    expect(instance.mantlingMontage.montageSetPosition(
      differentAsset,
      0.7,
    )).toBe(true)
    instance.refresh(0.05, controls)
    expect(window.__weightTable?.PostLocomotionNewestInstanceId)
      .toBe(newAsset.instanceId)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(
        0.7 + 0.05 * differentAsset.Montage.RateScale,
        12,
      )
    expect(instance.mantlingMontage.montageStop(
      differentAsset,
      0.4,
    )).toBe(true)
  })

  it('retains fades and keeps EarlyBlendOut Stop instance-identity safe', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const instance = createAlsAnimationInstance(gltf)
    const first = instance.mantlingMontage.play(settings, 0.2)
    if (!first) throw new Error('First mantle montage was rejected')
    instance.refresh(0.2, controls)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: first.instanceId,
      mantlingSettings: settings,
      notify: settings.Montage.Notifies[0],
      notifyEventType: 'Begin',
      triggerTime: expect.closeTo(0.4, 12),
    }])

    const second = instance.mantlingMontage.play(settings, 0.4)
    if (!second) throw new Error('Second mantle montage was rejected')
    expect(second.instanceId).not.toBe(first.instanceId)
    instance.refresh(0.1, controls)
    expect(window.__weightTable?.PostLocomotionRetainedInstanceCount)
      .toBe(2)
    expect(window.__weightTable?.PostLocomotionOldestInstanceId)
      .toBe(first.instanceId)
    expect(window.__weightTable?.PostLocomotionNewestInstanceId)
      .toBe(second.instanceId)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: second.instanceId,
      mantlingSettings: settings,
      notify: settings.Montage.Notifies[0],
      notifyEventType: 'Begin',
      triggerTime: expect.closeTo(0.5, 12),
    }])

    expect(instance.mantlingMontage.stopMontageInstance(
      first.instanceId,
      0.35,
    ))
      .toBe(false)
    expect(instance.mantlingMontage.stopMontageInstance(
      second.instanceId,
      0.35,
    ))
      .toBe(true)
    expect(instance.mantlingMontage.stopMontageInstance(
      second.instanceId,
      0.35,
    ))
      .toBe(false)

    // FAnimMontageInstance retains native branching-point states through an
    // interrupted fade, then Terminate() dispatches NotifyEnd for every state
    // whose authored End marker was suppressed by the interruption.
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([])
    instance.refresh(0.11, controls)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: first.instanceId,
      mantlingSettings: settings,
      notify: settings.Montage.Notifies[0],
      notifyEventType: 'End',
      triggerTime: expect.closeTo(0.61, 12),
    }])
    instance.refresh(0.24, controls)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: second.instanceId,
      mantlingSettings: settings,
      notify: settings.Montage.Notifies[0],
      notifyEventType: 'End',
      triggerTime: expect.closeTo(0.85, 12),
    }])
  })

  it('uses the authored montage blend curve for EarlyBlendOut', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const instance = createAlsAnimationInstance(gltf)
    const played = instance.mantlingMontage.play(settings, 0.2)
    if (!played) throw new Error('Mantle montage was rejected')

    instance.refresh(settings.Montage.BlendIn.BlendTime, controls)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(settings.Montage.BlendOut.BlendOption)
      .toBe('HermiteCubic')

    expect(instance.mantlingMontage.stopMontageInstance(
      played.instanceId,
      0.35,
    )).toBe(true)
    instance.refresh(0.35 * 0.25, controls)

    // HermiteCubic(.25) = .15625, so the retained weight is .84375.
    // A linear UAnimInstance::Montage_Stop(float) fade would be .75.
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(0.84375, 7)
  })

  it('does not end an unentered notify state when replaced before its first Advance()', async () => {
    const gltf = await loadAlsGltf()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const instance = createAlsAnimationInstance(gltf)
    const first = instance.mantlingMontage.play(settings, 0.2)
    const second = instance.mantlingMontage.play(settings, 0.3)
    if (!first || !second) throw new Error('Mantle montage was rejected')

    instance.refresh(0.21, controls)
    expect(instance.mantlingMontage.takeNotifyEvents()).toEqual([{
      instanceId: second.instanceId,
      mantlingSettings: settings,
      notify: settings.Montage.Notifies[0],
      notifyEventType: 'Begin',
      triggerTime: expect.closeTo(0.51, 12),
    }])
  })

  it('starts the real AM_Als_Roll montage from the exact landing policy edge', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const character = createAlsCharacter({
      actorYawAngle: -25,
      locomotionMode: 'InAir',
      velocity: { x: 3, y: 0, z: -7 },
    })
    const events: unknown[] = []
    const Character = { current: character }
    const Actions = {
      current: {
        RollingMontage: { current: instance.rollingMontage },
        StartRagdolling() {
          events.push('StartRagdolling')
        },
        OnLocomotionModeChanged(
          PreviousLocomotionMode: AlsLocomotionMode,
        ) {
          events.push([
            'OnLocomotionModeChanged',
            PreviousLocomotionMode,
          ])
        },
      },
    }

    expect(refreshRapierAlsLocomotionMode(
      character,
      true,
      0,
      false,
      createAlsLocomotionModeChangedLifecycleBridge(
        Character,
        Actions,
      ),
    )).toBe('Grounded')

    expect(events).toEqual([
      ['OnLocomotionModeChanged', 'InAir'],
    ])
    expect(character.locomotionMode).toBe('Grounded')
    expect(character.locomotionAction).toBe('Rolling')
    expect(character.stance).toBe('Crouching')
    expect(character.locomotionState.speed).toBe(3)
    expect(character.rollingState.TargetYawAngle).toBe(0)
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(true)
    expect(instance.rollingMontage.IsPlayingRootMotion()).toBe(true)

    instance.refresh(0.025, {
      ...controls,
      locomotionMode: character.locomotionMode,
      locomotionAction: character.locomotionAction,
      stance: character.stance,
      speed: character.locomotionState.speed,
      moving: character.locomotionState.moving,
      velocity: character.locomotionState.velocity,
      direction: character.locomotionState.velocityYawAngle
        - character.actorYawAngle,
    })
    expect(window.__weightTable?.CrouchingGraphRelevant).toBe(1)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.0325, 12)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(0.15625, 7)
    expect(window.__weightTable?.PostLocomotionRootMotionEnabled)
      .toBe(1)
  })

  it('plays AM_Als_Roll through PostLocomotion at the requested instance rate with authored root motion', async () => {
    const gltf = await loadAlsGltf()
    const rollClip = gltf.animations.find(
      ({ name }) => name === ALS_ROLL_SEQUENCE.Name,
    )
    if (!rollClip) throw new Error('Missing A_Als_Roll')
    const authoredRootMotion = compileAuthoredRootMotion(rollClip)
    if (!authoredRootMotion) {
      throw new Error('A_Als_Roll has no authored root motion')
    }
    const root = bone(gltf.scene, 'root')
    const referenceRootPosition = root.position.clone()
    const referenceRootRotation = root.quaternion.clone()
    const referenceRootScale = root.scale.clone()
    const instance = createAlsAnimationInstance(gltf)

    expect(instance.rollingMontage.Montage_IsPlaying(
      'AM_Not_Als_Roll',
    )).toBe(false)
    expect(instance.rollingMontage.Montage_Play(
      'AM_Not_Als_Roll',
      1.3,
    )).toBe(0)
    expect(instance.rollingMontage.Montage_Play(
      ALS_ROLLING_MONTAGE.Name,
      1.3,
    )).toBe(ALS_ROLLING_MONTAGE.PlayLength)
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(true)
    expect(instance.rollingMontage.IsPlayingRootMotion()).toBe(true)
    // StartRollingImplementation installs the action after this positive return.
    // Montage_Play itself does not fake the branching-point begin.
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])

    instance.refresh(0.025, controls)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.0325, 12)
    expect(window.__weightTable?.PostLocomotionSequenceTime)
      .toBeCloseTo(0.0325, 12)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(0.15625, 7)
    expect(window.__weightTable?.PostLocomotionRootMotionEnabled)
      .toBe(1)
    expect(bone(gltf.scene, 'root').position)
      .toEqual(referenceRootPosition)
    expect(
      bone(gltf.scene, 'root').quaternion.angleTo(
        referenceRootRotation,
      ),
    ).toBeLessThan(1e-7)
    expect(
      bone(gltf.scene, 'root').scale.distanceTo(
        referenceRootScale,
      ),
    ).toBeLessThan(1e-7)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([
      {
        instanceId: expect.any(Number),
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetLocomotionAction',
        notifyEventType: 'Begin',
        triggerTime: 0.00009999999747378752,
        LocomotionAction: 'Rolling',
      },
      {
        instanceId: expect.any(Number),
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetRootMotionScale',
        notifyEventType: 'Begin',
        triggerTime: 0.00009999999747378752,
        TranslationScale: 1.3,
      },
    ])

    const expectedRootMotion = extractAuthoredRootMotionDelta(
      authoredRootMotion,
      0,
      0.0325,
    )
    const extractedRootMotion =
      instance.rollingMontage.ConsumeExtractedRootMotion()
    expect(extractedRootMotion.valid).toBe(true)
    for (let component = 0; component < 3; component++) {
      expect(extractedRootMotion.translation[component])
        .toBeCloseTo(
          expectedRootMotion.translation[component],
          7,
        )
    }
    const secondConsumption = createRootMotionMovementParams()
    expect(
      instance.rollingMontage.ConsumeExtractedRootMotion(
        secondConsumption,
      ),
    ).toBe(secondConsumption)
    expect(secondConsumption.valid).toBe(false)
    expect([...secondConsumption.translation]).toEqual([0, 0, 0])
    // The first by-value result remains available to CharacterMovement even
    // though UAnimInstance has consumed its internal accumulator.
    expect(extractedRootMotion.valid).toBe(true)
    instance.refresh(0.075, controls)
    expect(window.__weightTable?.PostLocomotionMontageTime)
      .toBeCloseTo(0.13, 12)
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])
  })

  it('retains every unconsumed Roll delta across multiple animation updates', async () => {
    const gltf = await loadAlsGltf()
    const rollClip = gltf.animations.find(
      ({ name }) => name === ALS_ROLL_SEQUENCE.Name,
    )
    if (!rollClip) throw new Error('Missing A_Als_Roll')
    const authoredRootMotion = compileAuthoredRootMotion(rollClip)
    if (!authoredRootMotion) {
      throw new Error('A_Als_Roll has no authored root motion')
    }
    const instance = createAlsAnimationInstance(gltf)
    expect(instance.rollingMontage.Montage_Play(
      ALS_ROLLING_MONTAGE.Name,
      1.3,
    )).toBeGreaterThan(0)

    // A high-refresh render clock can evaluate twice before the fixed
    // CharacterMovement boundary. Both authored montage ranges remain pending.
    instance.refresh(0.025, controls)
    instance.refresh(0.075, controls)

    const expected = extractAuthoredRootMotionDelta(
      authoredRootMotion,
      0,
      0.13,
    )
    const actual =
      instance.rollingMontage.ConsumeExtractedRootMotion()
    expect(actual.valid).toBe(true)
    for (let component = 0; component < 3; component++) {
      expect(actual.translation[component])
        .toBeCloseTo(expected.translation[component], 7)
    }
    expect(
      instance.rollingMontage.ConsumeExtractedRootMotion().valid,
    ).toBe(false)
  })

  it('matches the authored Roll clip, additive reconstruction, and final graph pose', async () => {
    const runtimeGltf = await loadAlsGltf()
    const oracleGltf = await loadAlsGltf()
    const report = runRollAnimationPoseDiagnostic(
      runtimeGltf,
      oracleGltf,
    )

    expect(report.firstFailingStage).toBeNull()
    expect(report.stages.map(({ name, report: stage }) => ({
      name,
      matches: stage.matches,
    }))).toEqual([
      { name: 'clip sampler', matches: true },
      { name: 'mesh-space dynamic additive', matches: true },
      { name: 'runtime graph publication', matches: true },
    ])
    expect(report.contact.runtimeMinimumY).toBeCloseTo(
      report.contact.expectedGraphMinimumY,
      6,
    )
  })

  it('ends Rolling at the authored marker, emits FromRoll in queued sequence order, and uses no duration timer', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    expect(instance.rollingMontage.Montage_Play(
      ALS_ROLLING_MONTAGE.Name,
      1.3,
    )).toBeGreaterThan(0)

    instance.refresh(0.1, controls)
    instance.rollingMontage.takeNotifyEvents()
    let montageTime = 0.13
    const beforeGroundedEntry =
      ALS_ROLL_SEQUENCE.GroundedEntryModeNotify.Time - 0.00001
    instance.refresh(
      (beforeGroundedEntry - montageTime) / 1.3,
      controls,
    )
    montageTime = beforeGroundedEntry
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])

    const afterActionEnd =
      ALS_ROLLING_MONTAGE.BranchingPointMarkers[1].TriggerTime
      + 0.00001
    instance.refresh(
      (afterActionEnd - montageTime) / 1.3,
      controls,
    )
    montageTime = afterActionEnd
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([
      {
        instanceId: expect.any(Number),
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetLocomotionAction',
        notifyEventType: 'End',
        triggerTime: 0.9334329962730408,
        LocomotionAction: 'Rolling',
      },
      {
        instanceId: expect.any(Number),
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotify_SetGroundedEntryMode',
        notifyEventType: 'Notify',
        triggerTime: 0.9333333373069763,
        GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll',
      },
    ])
    // The authored action state has ended while the montage remains active.
    // A synthetic 1.5 / 1.3-second Roll timer would still own the action here.
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(true)

    const blendOutMontageTime = 1.16
    instance.refresh(
      (blendOutMontageTime - montageTime) / 1.3,
      controls,
    )
    montageTime = blendOutMontageTime
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(true)
    // The default negative BlendOutTriggerTime begins the authored .3 s
    // automatic fade .3 real seconds before the end. Stop() clears Unreal's
    // RootMotionMontageInstance while the retained pose continues blending.
    expect(instance.rollingMontage.IsPlayingRootMotion()).toBe(false)

    instance.refresh(
      (ALS_ROLLING_MONTAGE.PlayLength - montageTime) / 1.3,
      controls,
    )
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([{
      instanceId: expect.any(Number),
      montage: 'AM_Als_Roll',
      sequence: 'A_Als_Roll',
      notifyClass:
        'AlsAnimNotifyState_SetRootMotionScale',
      notifyEventType: 'End',
      triggerTime: 1.5,
      TranslationScale: 1.3,
    }])
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(false)
    instance.refresh(ALS_ROLLING_MONTAGE.BlendOut.BlendTime, controls)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])
  })

  it('re-enters the live grounded graph through the fixed Roll pose and retains its authored exit', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
      locomotionMode: 'Grounded',
      locomotionAction: null,
    }
    instance.refresh(0, idle)
    expect(instance.rollingMontage.Montage_Play(
      ALS_ROLLING_MONTAGE.Name,
      1.3,
    )).toBeGreaterThan(0)

    const rolling = {
      ...idle,
      locomotionAction: 'Rolling' as const,
    }
    instance.refresh(0.1, rolling)
    instance.rollingMontage.takeNotifyEvents()
    let montageTime = 0.13
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(window.__weightTable?.['GroundedOuter.Relevant'])
      .toBe(0)

    const afterFromRoll =
      ALS_ROLLING_MONTAGE.BranchingPointMarkers[1].TriggerTime
      + 0.00001
    instance.refresh(
      (afterFromRoll - montageTime) / 1.3,
      rolling,
    )
    montageTime = afterFromRoll
    const markerEvents =
      instance.rollingMontage.takeNotifyEvents()
    expect(markerEvents.map(({ notifyClass }) => notifyClass))
      .toEqual([
        'AlsAnimNotifyState_SetLocomotionAction',
        'AlsAnimNotify_SetGroundedEntryMode',
      ])
    expect(() => (
      instance.SetGroundedEntryMode as (
        GroundedEntryMode: string | null
      ) => void
    )('Als.GroundedEntryMode.Unsupported')).toThrow(
      'Unsupported GroundedEntryMode gameplay tag',
    )
    instance.SetGroundedEntryMode(
      'Als.GroundedEntryMode.FromRoll',
    )

    // The action change resets GroundedEntryMode first; the queued sequence
    // notify is then applied and survives while the full-weight slot keeps
    // Grounded States irrelevant.
    const beforeVisibleBlendOut = 1.25
    instance.refresh(
      (beforeVisibleBlendOut - montageTime) / 1.3,
      idle,
    )
    montageTime = beforeVisibleBlendOut
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeCloseTo(1, 12)
    expect(window.__weightTable?.['GroundedOuter.Relevant'])
      .toBe(0)
    expect(window.__weightTable?.['GroundedEntryMode.FromRoll'])
      .toBe(1)

    // The following weight-update phase exposes source weight again. The
    // reinitialized conduit skips its authored 0.2 blend and enters Roll at
    // full weight, then its OnBecomeRelevant callback clears the mode.
    instance.refresh(0.05, idle)
    montageTime += 0.05 * 1.3
    expect(window.__weightTable?.PostLocomotionMontageWeight)
      .toBeLessThan(1)
    expect(window.__weightTable?.['GroundedOuter.Relevant'])
      .toBe(1)
    expect(window.__weightTable?.['GroundedOuter.Current.Roll'])
      .toBe(1)
    expect(window.__weightTable?.['GroundedOuter.State.Roll'])
      .toBe(1)
    expect(window.__weightTable?.['GroundedOuter.LastTransitionIndex'])
      .toBe(0)
    expect(window.__weightTable?.['GroundedEntryMode.FromRoll'])
      .toBe(0)

    // Roll's state-exit callback selects the current stance's right
    // transition once, while the outgoing endpoint pose remains in the
    // state-machine transition for the exact 0.6-second Cubic blend.
    instance.refresh(0.3, idle)
    expect(window.__weightTable?.[
      'GroundedOuter.PlayRollToGroundedTransitionAnimation'
    ]).toBe(1)
    expect(window.__weightTable?.[
      'GroundedOuter.RollExitTransitionStanding'
    ]).toBe(1)
    expect(window.__weightTable?.['GroundedOuter.State.Roll'])
      .toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.['GroundedOuter.State.Standing'])
      .toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.[
      'GroundedOuter.RollExitTransitionLinearAlpha'
    ]).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.[
      'GroundedOuter.RollExitTransitionBlendAlpha'
    ]).toBeCloseTo(0.5, 12)

    instance.refresh(0.01, idle)
    expect(window.__weightTable?.[
      'GroundedOuter.PlayRollToGroundedTransitionAnimation'
    ]).toBe(0)
    expect(window.__weightTable?.['GroundedOuter.State.Roll'])
      .toBeGreaterThan(0)
    expect(window.__weightTable?.TransitionMontageTime)
      .toBeCloseTo(0.215, 12)
    expect(montageTime).toBeCloseTo(1.315, 12)
  })

  it('cleans queued and branching Roll states at their distinct interruption seams', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    expect(instance.rollingMontage.Montage_Play(
      ALS_ROLLING_MONTAGE.Name,
      1,
    )).toBeGreaterThan(0)
    instance.refresh(0.1, controls)
    const beginEvents =
      instance.rollingMontage.takeNotifyEvents()
    const instanceId = beginEvents[0]?.instanceId
    expect(instanceId).toEqual(expect.any(Number))
    expect(
      instance.rollingMontage
        .ConsumeExtractedRootMotion().valid,
    ).toBe(true)

    const mantleSettings = ALS_MANTLING_SETTINGS.MS_Als_Low
    expect(instance.mantlingMontage.play(
      mantleSettings,
      0,
    )).not.toBeNull()
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(true)
    instance.refresh(0.05, controls)
    expect(
      instance.rollingMontage
        .ConsumeExtractedRootMotion().valid,
    ).toBe(false)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([{
      instanceId,
      montage: 'AM_Als_Roll',
      sequence: 'A_Als_Roll',
      notifyClass:
        'AlsAnimNotifyState_SetRootMotionScale',
      notifyEventType: 'End',
      triggerTime: expect.closeTo(0.15, 12),
      TranslationScale: 1.3,
    }])

    // The queued sequence state ends as soon as the interrupted source drops
    // from the notify queue. The native action branching state remains owned
    // by its retained FAnimMontageInstance until the incoming .2s blend ends.
    instance.refresh(0.2, controls)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([{
      instanceId,
      montage: 'AM_Als_Roll',
      sequence: 'A_Als_Roll',
      notifyClass:
        'AlsAnimNotifyState_SetLocomotionAction',
      notifyEventType: 'End',
      triggerTime: expect.closeTo(0.35, 12),
      LocomotionAction: 'Rolling',
    }])
    expect(instance.rollingMontage.Montage_IsPlaying(
      ALS_ROLLING_MONTAGE.Name,
    )).toBe(false)
    instance.refresh(0.1, controls)
    expect(instance.rollingMontage.takeNotifyEvents()).toEqual([])
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

  it('diagnoses full turn continuity across irregular render cadence', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const frameCapture = new AnimationFrameCapture(gltf.scene)
    const turnControls = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
      actorYawAngle: 0,
      viewYawAngle: 0,
      viewYawSpeed: 0,
    }
    instance.refresh(0, turnControls)
    let actorYawAngle = 0
    let rotationYawSpeed = instance.getCurveValue('RotationYawSpeed')
    const reportPromise = frameCapture.start(240)
    frameCapture.recordFrame(0, {
      actorYawAngle,
      PublishedRotationYawSpeed: rotationYawSpeed,
      TurnInPlaceMontageWeight:
        window.__weightTable?.TurnInPlaceMontageWeight ?? 0,
    })
    const deltaTimes = [1 / 144, 1 / 60, 1 / 90, 1 / 50]
    for (let frame = 1; frame < 240; frame++) {
      const deltaTime = deltaTimes[(frame - 1) % deltaTimes.length]
      actorYawAngle = applyRotationYawSpeedAnimationCurve(
        actorYawAngle,
        rotationYawSpeed,
        deltaTime,
      )
      turnControls.actorYawAngle = actorYawAngle
      turnControls.viewYawAngle = THREE.MathUtils.euclideanModulo(
        90 - actorYawAngle + 180,
        360,
      ) - 180
      instance.refresh(deltaTime, turnControls)
      rotationYawSpeed = instance.getCurveValue('RotationYawSpeed')
      frameCapture.recordFrame(deltaTime, {
        actorYawAngle,
        PublishedRotationYawSpeed: rotationYawSpeed,
        TurnInPlaceMontageWeight:
          window.__weightTable?.TurnInPlaceMontageWeight ?? 0,
      })
    }
    const report = await reportPromise
    expect(report.diagnostics.turnInPlace).not.toBeNull()
    expect(report.diagnostics.turnInPlace?.maximumIntegrationErrorDegrees)
      .toBeLessThan(1e-9)
    expect(report.diagnostics.turnInPlace?.signedActorYawDegrees)
      .toBeCloseTo(76.76046973786603, 8)
    expect(report.diagnostics.turnInPlace?.signedCurveYawDegrees)
      .toBeCloseTo(76.76046973786603, 8)
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

  it('drives the Rifle Aiming state and gun elevation from PitchAmount', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const aimingControls: AlsAnimationInstanceControls = {
      ...controls,
      overlayMode: 'Rifle',
      rotationMode: 'Aiming',
      viewPitchAngle: 0,
    }
    const gunForward = new THREE.Vector3()
    const gunRotation = new THREE.Quaternion()
    const gunElevation = () => {
      gltf.scene.updateMatrixWorld(true)
      bone(gltf.scene, 'VB hand_r_to_ik_hand_gun')
        .getWorldQuaternion(gunRotation)
      gunForward
        .set(0, 0, 1)
        .applyQuaternion(gunRotation)
      return THREE.MathUtils.radToDeg(Math.asin(gunForward.y))
    }

    refreshFrames(instance, 90, aimingControls)
    expect(window.__weightTable?.RifleStateAiming).toBeCloseTo(1, 7)
    expect(window.__weightTable?.idleAdditive).toBeCloseTo(0.5, 7)
    expect(Math.abs(gunElevation())).toBeLessThan(1)

    instance.refresh(1 / 60, {
      ...aimingControls,
      viewPitchAngle: 45,
    })
    expect(Math.abs(gunElevation() - 45)).toBeLessThan(1)

    instance.refresh(1 / 60, {
      ...aimingControls,
      viewPitchAngle: -45,
    })
    expect(Math.abs(gunElevation() + 45)).toBeLessThan(1)
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
    const StartCameraShake = vi.fn()
    expect(instance.dispatchQueuedAnimEvents({ StartCameraShake }))
      .toBeGreaterThan(0)
    expect(StartCameraShake.mock.calls.every(
      ([, scale]) => scale === 0.5,
    )).toBe(true)
  })

  it('initializes direct Sprint SequencePlayers in seconds and leaves them dormant', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idleControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Walking',
      moving: false,
      movingSmooth: false,
      speed: 0,
    }

    instance.refresh(1, idleControls)

    expect(window.__weightTable?.['clipTime.sprint'])
      .toBeCloseTo(0.166667, 12)
    expect(window.__weightTable?.['clipTime.sprintAcceleration'])
      .toBeCloseTo(0.166667, 12)
    expect(window.__weightTable?.['clipTime.sprint'])
      .not.toBeCloseTo(0.100000204, 7)
    const StartCameraShake = vi.fn()
    expect(instance.dispatchQueuedAnimEvents({ StartCameraShake })).toBe(0)
    expect(StartCameraShake).not.toHaveBeenCalled()
  })

  it('holds queued graph and Roll events, then dispatches Sprint before Roll FIFO', async () => {
    const gltf = await loadAlsGltf()
    const rollClip = gltf.animations.find(
      ({ name }) => name === 'A_Als_Roll',
    )
    if (!rollClip) throw new Error('Missing A_Als_Roll')
    // A fixture exercises the reusable authored Slot substrate until the Rolling action owns its
    // live clock. Mantling normally rejects sequence root motion because its root-motion source
    // owns translation, so this isolated copy exposes the same non-additive pose as Slot input.
    rollClip.userData = {
      ...rollClip.userData,
      bEnableRootMotion: false,
    }
    const instance = createAlsAnimationInstance(gltf)
    const sprintAccelerationControls: AlsAnimationInstanceControls = {
      ...controls,
      gait: 'Sprinting',
      speed: 6.5,
      relativeAccelerationAmount: { x: 0.25, y: 0 },
    }

    refreshFrames(instance, 60, controls)
    instance.refresh(0.1, sprintAccelerationControls)
    instance.refresh(0.1, sprintAccelerationControls)
    // Clear anything encountered while establishing a full-weight acceleration leader.
    instance.dispatchQueuedAnimEvents({ StartCameraShake: () => {} })
    expect(window.__weightTable?.sprintAcceleration)
      .toBeGreaterThan(0.99)
    // At least .25s at the authored acceleration cadence traverses more than the largest
    // .3s gap between its two looping camera notifies.
    instance.refresh(0.1, sprintAccelerationControls)
    instance.refresh(0.1, sprintAccelerationControls)
    instance.refresh(0.05, sprintAccelerationControls)
    const baseSettings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const rollFixture: AlsMantlingSettings = {
      ...baseSettings,
      Name: 'MS_Test_Roll_Notify',
      Montage: {
        ...baseSettings.Montage,
        Name: 'AM_Test_Roll_Notify',
        Sequence: 'A_Als_Roll',
        PlayLength: 1.5,
        SequenceLength: 1.5,
        RateScale: 1,
        StartPos: 0,
        AnimStartTime: 0,
        AnimEndTime: 1.5,
        AnimPlayRate: 1,
        LoopingCount: 1,
        Notifies: [],
        BranchingPointMarkers: [],
      },
    }
    expect(instance.mantlingMontage.play(
      rollFixture,
      0.09,
    )).not.toBeNull()

    const StartCameraShake = vi.fn()
    instance.refresh(0.02, sprintAccelerationControls)
    expect(StartCameraShake).not.toHaveBeenCalled()

    const dispatched = instance.dispatchQueuedAnimEvents({
      StartCameraShake,
    })
    expect(dispatched).toBe(StartCameraShake.mock.calls.length)
    expect(dispatched).toBeGreaterThanOrEqual(2)
    expect(StartCameraShake.mock.calls.at(-1)).toEqual([
      'B_Als_CameraShake_Sprint_C',
      1,
    ])
    expect(StartCameraShake.mock.calls.slice(0, -1).every(
      ([cameraShakeClass, scale]) => (
        cameraShakeClass === 'B_Als_CameraShake_Sprint_C'
        && scale === 1.25
      ),
    )).toBe(true)
    expect(instance.dispatchQueuedAnimEvents({ StartCameraShake })).toBe(0)
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

  it('runs the authored Standing start, pivot, and Stop journey in production', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const moving = {
      ...controls,
      speed: 1.5,
    }

    instance.refresh(0, idle)
    refreshFrames(instance, 60, moving)
    expect(window.__weightTable?.StandingStateMove).toBe(1)
    expect(window.__weightTable?.StandingMovementDetailsStateRun).toBe(1)

    const reversing = {
      ...moving,
      direction: 180,
    }
    instance.refresh(1 / 60, reversing)
    expect(window.__weightTable?.GroundedDirectionTransitionActivatePivot)
      .toBe(1)
    expect(window.__weightTable?.StandingMovementDetailsStateFirstPivot).toBe(1)
    // First Pivot's authored OnBecomeRelevant callback immediately resets the activation latch.
    expect(window.__weightTable?.StandingPivotActive).toBe(0)

    instance.refresh(0, idle)
    expect(window.__weightTable?.StandingStateStop).toBe(1)
    expect(window.__weightTable?.StandingStopTransitionCount).toBe(1)
    expect(window.__weightTable?.StandingStopQuickNotifyCount).toBe(0)
    expect(
      (window.__weightTable?.TransitionQueuedStopLeft ?? 0)
      + (window.__weightTable?.TransitionQueuedStopRight ?? 0),
    ).toBe(1)

    instance.refresh(0.05, idle)
    expect(window.__weightTable?.TransitionMontageWeight).toBeGreaterThan(0)
    expect(window.__weightTable?.TransitionSequenceTime).toBeCloseTo(
      0.4 + 0.05 * 1.5,
      12,
    )
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
    expect(window.__weightTable?.['clipTime.sprint'])
      .toBeCloseTo(0.166667, 12)
    expect(window.__weightTable?.['clipPhase.sprint'])
      .toBeCloseTo(0.166667 / 0.6000000238418579, 6)

    instance.refresh(0.1, controls)
    expect(window.__weightTable?.idle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.runFwd).toBeCloseTo(0.5, 12)

    instance.refresh(0.1, controls)
    expect(window.__weightTable?.idle).toBe(0)
    expect(window.__weightTable?.runFwd).toBe(1)
  })

  it('plays Standing StopQuick through the production Transition slot', async () => {
    const gltf = await loadAlsGltf()
    const instance = createAlsAnimationInstance(gltf)
    const idle = {
      ...controls,
      gait: 'Walking' as const,
      moving: false,
      movingSmooth: false,
      speed: 0,
    }
    const moving = {
      ...controls,
      gait: 'Walking' as const,
      speed: 1.5,
    }
    instance.refresh(0, idle)
    instance.refresh(0.1, moving)
    expect(window.__weightTable?.StandingStateIdle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.StandingStateMove).toBeCloseTo(0.5, 12)

    instance.refresh(0, idle)
    expect(window.__weightTable?.StandingStopQuickNotifyCount).toBe(1)
    expect(window.__weightTable?.TransitionQueuedStandingLeft).toBe(1)

    instance.refresh(0.05, idle)
    expect(window.__weightTable?.TransitionPlayingStandingLeft).toBe(1)
    expect(window.__weightTable?.TransitionMontageWeight).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.TransitionSequenceTime).toBeCloseTo(
      0.3 + 0.05 * 1.75,
      12,
    )
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
    expect(window.__weightTable?.TransitionQueuedCrouchingLeft).toBe(1)
    expect(window.__weightTable?.CrouchingStateIdle).toBeCloseTo(0.5, 12)
    expect(window.__weightTable?.CrouchingStateMove).toBeCloseTo(0.5, 12)

    // UE shortens the new transition because Idle already owns half of the state weight, while
    // the retained Idle-to-Move source continues advancing beneath it.
    instance.refresh(0.05, idleCrouching)
    expect(window.__weightTable?.TransitionPlayingCrouchingLeft).toBe(1)
    expect(window.__weightTable?.TransitionSequenceTime).toBeCloseTo(
      0.3 + 0.05 * 1.75,
      12,
    )
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

  it('advances only WalkRun players visited by the current direction graph', async () => {
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
    expect(advancedPhases[0], phaseKeys[0]).not.toBe(initialPhases[0])
    for (let index = 1; index < phaseKeys.length; index++) {
      expect(advancedPhases[index], phaseKeys[index]).toBe(
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
      .toBeGreaterThan(0)
    expect(preTransitionWeights?.InAirJumpTransitionCount).toBe(0)
    expect(loopTransitionWeights).toBeDefined()
    expect(loopTransitionWeights?.InAirJumpLaunchRemainingTime)
      .toBe(0)
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
