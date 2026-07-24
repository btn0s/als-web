import { describe, expect, it, vi } from 'vitest'
import {
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS,
  ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS,
  B_Als_CameraShake_Sprint,
  getAlsAnimNotifyCameraShakeName,
  notifyAlsAnimNotifyCameraShake,
} from './AlsAnimNotify_CameraShake'

describe('UAlsAnimNotify_CameraShake', () => {
  it('consumes the exact B_Als_CameraShake_Sprint serialized pattern', () => {
    expect(B_Als_CameraShake_Sprint).toEqual({
      CameraShakeClass: 'B_Als_CameraShake_Sprint_C',
      bSingleInstance: false,
      RootShakePattern: {
        Duration: 0.2,
        BlendInTime: 0.1,
        BlendOutTime: 0.1,
        LocationAmplitudeMultiplier: 1,
        LocationFrequencyMultiplier: 1,
        X: {
          Amplitude: 1,
          Frequency: 1,
          InitialOffsetType: 'Random',
        },
        Y: {
          Amplitude: 1,
          Frequency: 1,
          InitialOffsetType: 'Random',
        },
        Z: {
          Amplitude: 1,
          Frequency: 1,
          InitialOffsetType: 'Random',
        },
        RotationAmplitudeMultiplier: 1,
        RotationFrequencyMultiplier: 1,
        Pitch: {
          Amplitude: 0.1,
          Frequency: 0.1,
          InitialOffsetType: 'Random',
        },
        Yaw: {
          Amplitude: 0.1,
          Frequency: 0.1,
          InitialOffsetType: 'Random',
        },
        Roll: {
          Amplitude: 0.1,
          Frequency: 0.1,
          InitialOffsetType: 'Random',
        },
        FOV: {
          Amplitude: 0,
          Frequency: 1,
          InitialOffsetType: 'Random',
        },
      },
    })
  })

  it('freezes all six shipped events, including the inherited scale default', () => {
    expect(ALS_ANIM_NOTIFY_CAMERA_SHAKE_DEFAULTS).toEqual({
      CameraShakeClass: null,
      CameraShakeScale: 1,
    })
    expect(
      ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS.map((event) => ({
        sequence: event.Sequence,
        time: event.Time,
        threshold: event.TriggerWeightThreshold,
        scale: event.CameraShakeScale,
      })),
    ).toEqual([
      {
        sequence: 'A_Als_Sprint',
        time: expect.closeTo(0.06666667, 7),
        threshold: 0.5,
        scale: 0.5,
      },
      {
        sequence: 'A_Als_Sprint',
        time: expect.closeTo(0.36666667, 7),
        threshold: 0.5,
        scale: 0.5,
      },
      {
        sequence: 'A_Als_Sprint_Acceleration',
        time: expect.closeTo(0.06666667, 7),
        threshold: 0.5,
        scale: 1.25,
      },
      {
        sequence: 'A_Als_Sprint_Acceleration',
        time: expect.closeTo(0.36666667, 7),
        threshold: 0.5,
        scale: 1.25,
      },
      {
        sequence: 'A_Als_Roll',
        time: expect.closeTo(0.10000001, 7),
        threshold: expect.closeTo(0.00001, 10),
        scale: 1,
      },
      {
        sequence: 'A_Als_Roll',
        time: expect.closeTo(0.4666667, 7),
        threshold: expect.closeTo(0.00001, 10),
        scale: 2,
      },
    ])

    for (const event of ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS) {
      expect(event).toMatchObject({
        NotifyName: 'AlsCameraShake',
        MontageTickType: 'EMontageNotifyTickType::Queued',
        NotifyTriggerChance: 1,
        NotifyFilterType: 'ENotifyFilterType::NoFiltering',
        NotifyFilterLOD: 0,
        bTriggerOnDedicatedServer: false,
        bTriggerOnFollower: false,
        CameraShakeClass: 'B_Als_CameraShake_Sprint_C',
      })
    }
  })

  it('mirrors the camera-manager call and the absent-manager early return', () => {
    const StartCameraShake = vi.fn()
    const notify = ALS_ANIM_NOTIFY_CAMERA_SHAKE_EVENTS[2]

    notifyAlsAnimNotifyCameraShake({ StartCameraShake }, notify)
    expect(StartCameraShake).toHaveBeenCalledExactlyOnceWith(
      'B_Als_CameraShake_Sprint_C',
      1.25,
    )

    notifyAlsAnimNotifyCameraShake(null, notify)
    expect(StartCameraShake).toHaveBeenCalledTimes(1)
  })

  it('matches the C++ notify display name', () => {
    expect(
      getAlsAnimNotifyCameraShakeName('B_Als_CameraShake_Sprint_C'),
    ).toBe('Als Camera Shake: B_Als_CameraShake_Sprint_C')
    expect(getAlsAnimNotifyCameraShakeName(null)).toBe('Als Camera Shake: ')
  })
})
