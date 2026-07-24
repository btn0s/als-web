import { describe, expect, it, vi } from 'vitest'
import {
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS,
  B_Als_CameraShake_Sprint,
  notifyAlsAnimNotifyCameraShake,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import {
  applyCameraLocalShake,
  CAMERA_SHAKE_BASE_DEFAULTS,
  PlayerCameraManager,
} from './PlayerCameraManager'
import type {
  CameraShakeClass,
  FMinimalViewInfo,
} from './PlayerCameraManager'
import {
  createCameraShakePatternUpdateResult,
  createWaveOscillatorCameraShakePatternDefaults,
} from './WaveOscillatorCameraShakePattern'

type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

function rotationMatrix(
  rotation: Readonly<{ pitch: number; yaw: number; roll: number }>,
): Matrix3 {
  const pitch = rotation.pitch * Math.PI / 180
  const yaw = rotation.yaw * Math.PI / 180
  const roll = rotation.roll * Math.PI / 180
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  return [
    cp * cy,
    cp * sy,
    sp,
    sr * sp * cy - cr * sy,
    sr * sp * sy + cr * cy,
    -sr * cp,
    -(cr * sp * cy + sr * sy),
    cy * sr - cr * sp * sy,
    cr * cp,
  ]
}

function multiplyMatrices(first: Matrix3, second: Matrix3): Matrix3 {
  const result = new Array<number>(9)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row * 3 + column] =
        first[row * 3] * second[column]
        + first[row * 3 + 1] * second[3 + column]
        + first[row * 3 + 2] * second[6 + column]
    }
  }
  return result as unknown as Matrix3
}

function view(
  overrides: Partial<{
    location: { x: number; y: number; z: number }
    rotation: { pitch: number; yaw: number; roll: number }
    fov: number
  }> = {},
): FMinimalViewInfo {
  return {
    Location: overrides.location ?? { x: 0, y: 0, z: 0 },
    Rotation: overrides.rotation ?? { pitch: 0, yaw: 0, roll: 0 },
    FOV: overrides.fov ?? 90,
  }
}

function translationShake(
  cameraShakeClass: string,
  bSingleInstance = false,
): CameraShakeClass {
  const defaults = createWaveOscillatorCameraShakePatternDefaults()
  return {
    CameraShakeClass: cameraShakeClass,
    bSingleInstance,
    RootShakePattern: {
      ...defaults,
      Duration: 0.2,
      BlendInTime: 0,
      BlendOutTime: 0,
      X: {
        Amplitude: 1,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      Y: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      Z: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      RotationAmplitudeMultiplier: 0,
      Pitch: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      Yaw: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      Roll: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
      FOV: {
        Amplitude: 0,
        Frequency: 1,
        InitialOffsetType: 'Zero',
      },
    },
  }
}

describe('VERIFIED UE 5.5 camera-local shake application', () => {
  it('freezes UCameraShakeBase defaults used by B_Als_CameraShake_Sprint', () => {
    expect(CAMERA_SHAKE_BASE_DEFAULTS).toEqual({
      bSingleInstance: false,
      ShakeScale: 1,
      PlaySpace: 'CameraLocal',
    })
  })

  it('rotates translation and post-applies rotation in camera-local space', () => {
    const cameraView = view({
      rotation: { pitch: 0, yaw: 90, roll: 0 },
    })
    const result = createCameraShakePatternUpdateResult()
    result.Location.x = 1
    result.Rotation.pitch = 10

    expect(applyCameraLocalShake(cameraView, result)).toBe(cameraView)
    expect(cameraView.Location.x).toBeCloseTo(0, 12)
    expect(cameraView.Location.y).toBeCloseTo(1, 12)
    expect(cameraView.Location.z).toBeCloseTo(0, 12)
    expect(cameraView.Rotation.pitch).toBeCloseTo(10, 12)
    expect(cameraView.Rotation.yaw).toBeCloseTo(90, 12)
    expect(cameraView.Rotation.roll).toBeCloseTo(0, 12)
  })

  it('matches independent OffsetRot * CameraRot row-matrix composition', () => {
    const baseRotation = { pitch: 27, yaw: -123, roll: 41 }
    const offsetRotation = { pitch: 4, yaw: -7, roll: 9 }
    const cameraView = view({ rotation: { ...baseRotation } })
    const result = createCameraShakePatternUpdateResult()
    result.Rotation.pitch = offsetRotation.pitch
    result.Rotation.yaw = offsetRotation.yaw
    result.Rotation.roll = offsetRotation.roll

    applyCameraLocalShake(cameraView, result)
    const expected = multiplyMatrices(
      rotationMatrix(offsetRotation),
      rotationMatrix(baseRotation),
    )
    const actual = rotationMatrix(cameraView.Rotation)
    for (let index = 0; index < expected.length; index++) {
      expect(actual[index]).toBeCloseTo(expected[index], 12)
    }
  })

  it('applies the engine pitch limit before camera-local composition', () => {
    const cameraView = view({
      rotation: { pitch: 89.85, yaw: 0, roll: 0 },
    })
    const result = createCameraShakePatternUpdateResult()
    result.Rotation.pitch = 0.1

    applyCameraLocalShake(cameraView, result)
    expect(result.Rotation.pitch).toBeCloseTo(0.05, 10)
    expect(cameraView.Rotation.pitch).toBeCloseTo(89.9, 10)
  })
})

describe('VERIFIED UE 5.5 APlayerCameraManager camera-shake subset', () => {
  it('runs the authored ALS notify through StartCameraShake scale', () => {
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [B_Als_CameraShake_Sprint],
      RandomSource: () => 0,
    })
    const notify = ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS[0]
    notifyAlsAnimNotifyCameraShake(manager, notify)

    expect(manager.ActiveCameraShakes).toHaveLength(1)
    expect(manager.ActiveCameraShakes[0].ShakeScale).toBe(0.5)

    const cameraView = view()
    manager.UpdateAndApplyCameraShakes(0.05, cameraView)
    const expectedLocation =
      Math.sin(0.05 * 2 * Math.PI) * 0.5 * 0.5
    const expectedRotation =
      0.1 * Math.sin(0.05 * 0.1 * 2 * Math.PI) * 0.5 * 0.5
    expect(cameraView.Location).toEqual({
      x: expect.closeTo(expectedLocation, 12),
      y: expect.closeTo(expectedLocation, 12),
      z: expect.closeTo(expectedLocation, 12),
    })
    expect(cameraView.Rotation).toEqual({
      pitch: expect.closeTo(expectedRotation, 12),
      yaw: expect.closeTo(expectedRotation, 12),
      roll: expect.closeTo(expectedRotation, 12),
    })
  })

  it('allows concurrent instances when bSingleInstance keeps its engine default', () => {
    const shakeClass = translationShake('Concurrent_C')
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [shakeClass],
    })
    const first = manager.StartCameraShake('Concurrent_C')
    const second = manager.StartCameraShake('Concurrent_C')
    expect(first).not.toBe(second)
    expect(manager.ActiveCameraShakes).toHaveLength(2)

    const cameraView = view()
    manager.UpdateAndApplyCameraShakes(0.05, cameraView)
    expect(cameraView.Location.x).toBeCloseTo(
      2 * Math.sin(0.05 * 2 * Math.PI),
      12,
    )

    manager.UpdateAndApplyCameraShakes(0.15, cameraView)
    expect(manager.ActiveCameraShakes).toHaveLength(0)
  })

  it('restarts a single instance without drawing new oscillator phases', () => {
    const shakeClass: CameraShakeClass = {
      ...B_Als_CameraShake_Sprint,
      CameraShakeClass: 'Single_C',
      bSingleInstance: true,
    }
    const randomSource = vi.fn(() => 0)
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [shakeClass],
      RandomSource: randomSource,
    })
    const first = manager.StartCameraShake('Single_C')
    expect(randomSource).toHaveBeenCalledTimes(7)
    manager.UpdateAndApplyCameraShakes(0.05, view())

    const restarted = manager.StartCameraShake('Single_C', 2)
    expect(restarted).toBe(first)
    expect(restarted?.ShakeScale).toBe(2)
    expect(randomSource).toHaveBeenCalledTimes(7)
    expect(manager.ActiveCameraShakes).toHaveLength(1)
  })

  it('pauses at zero modifier alpha and clamps negative total scale to zero', () => {
    const shakeClass = translationShake('Scale_C')
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [shakeClass],
    })
    manager.StartCameraShake('Scale_C', -2)
    const cameraView = view()

    manager.UpdateAndApplyCameraShakes(0.1, cameraView, 0)
    expect(cameraView.Location.x).toBe(0)
    expect(manager.ActiveCameraShakes).toHaveLength(1)

    manager.UpdateAndApplyCameraShakes(0.05, cameraView)
    expect(cameraView.Location.x).toBe(0)
    expect(manager.ActiveCameraShakes).toHaveLength(1)
  })

  it('returns null for absent classes and immediately tears down stopped shakes', () => {
    const shakeClass = translationShake('Known_C')
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [shakeClass],
    })
    expect(manager.StartCameraShake(null)).toBeNull()
    expect(manager.StartCameraShake('Missing_C')).toBeNull()
    expect(manager.StartCameraShake('Known_C', 1, 'CameraLocal'))
      .not.toBeNull()

    const instance = manager.ActiveCameraShakes[0]
    manager.StopCameraShake(instance)
    expect(manager.ActiveCameraShakes).toHaveLength(0)
  })
})
