import { describe, expect, it } from 'vitest'
import {
  B_Als_CameraShake_Sprint,
  notifyAlsAnimNotifyCameraShake,
} from '../als/AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import {
  createAlsCameraComponentState,
} from '../als/AlsCamera/AlsCameraComponent'
import {
  AlsCameraShakeRequestQueue,
  createAlsCameraShakeRequest,
  createAlsCameraViewBridgeState,
  drainAlsCameraShakeRequests,
  getAlsLocomotionActionTag,
  refreshAlsCameraViewBridge,
} from './alsCameraBridge'
import { PlayerCameraManager } from './PlayerCameraManager'

describe('ALS live camera bridge', () => {
  it.each([
    [null, null],
    ['Mantling', 'Als.LocomotionAction.Mantling'],
    ['Ragdolling', 'Als.LocomotionAction.Ragdolling'],
    ['GettingUp', 'Als.LocomotionAction.GettingUp'],
    ['Rolling', 'Als.LocomotionAction.Rolling'],
  ] as const)(
    'copies locomotion action %s as its exact gameplay tag',
    (action, expectedTag) => {
      expect(getAlsLocomotionActionTag(action)).toBe(expectedTag)
    },
  )

  it('queues the exact notify payload in FIFO order for the later crossing seam', () => {
    const queue = new AlsCameraShakeRequestQueue()
    notifyAlsAnimNotifyCameraShake(queue, {
      CameraShakeClass: 'First_C',
      CameraShakeScale: 0.5,
    })
    notifyAlsAnimNotifyCameraShake(queue, {
      CameraShakeClass: null,
      CameraShakeScale: 2,
    })
    expect(queue.Num).toBe(2)

    const request = createAlsCameraShakeRequest({
      CameraShakeClass: 'Unchanged_C',
      CameraShakeScale: -1,
    })
    expect(queue.Dequeue(request)).toBe(true)
    expect(request).toEqual({
      CameraShakeClass: 'First_C',
      CameraShakeScale: 0.5,
    })
    expect(queue.Num).toBe(1)

    expect(queue.Dequeue(request)).toBe(true)
    expect(request).toEqual({
      CameraShakeClass: null,
      CameraShakeScale: 2,
    })
    expect(queue.Num).toBe(0)

    expect(queue.Dequeue(request)).toBe(false)
    expect(request).toEqual({
      CameraShakeClass: null,
      CameraShakeScale: 2,
    })

    queue.StartCameraShake('AfterDrain_C', 3)
    expect(queue.Dequeue(request)).toBe(true)
    expect(request).toEqual({
      CameraShakeClass: 'AfterDrain_C',
      CameraShakeScale: 3,
    })

    queue.StartCameraShake('Discarded_C', 4)
    queue.Reset()
    expect(queue.Num).toBe(0)
    expect(queue.Dequeue(request)).toBe(false)
  })

  it('drains queued requests into PlayerCameraManager in publish order', () => {
    const queue = new AlsCameraShakeRequestQueue()
    queue.StartCameraShake('B_Als_CameraShake_Sprint_C', 0.5)
    queue.StartCameraShake('B_Als_CameraShake_Sprint_C', 2)
    const requestScratch = createAlsCameraShakeRequest()
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [B_Als_CameraShake_Sprint],
      RandomSource: () => 0,
    })

    expect(drainAlsCameraShakeRequests(
      queue,
      manager,
      requestScratch,
    )).toBe(2)
    expect(queue.Num).toBe(0)
    expect(manager.ActiveCameraShakes.map(
      (instance) => instance.ShakeScale,
    )).toEqual([0.5, 2])
    expect(drainAlsCameraShakeRequests(
      queue,
      manager,
      requestScratch,
    )).toBe(0)
  })

  it('reuses its output while preserving metres, rotation, and horizontal FOV', () => {
    const bridge = createAlsCameraViewBridgeState()
    const viewInfo = bridge.viewInfo
    const renderView = bridge.renderView
    const renderLocation = renderView.cameraLocation
    const renderRotation = renderView.cameraRotation
    const component = createAlsCameraComponentState({
      cameraLocation: { x: 1.25, y: -2.5, z: 0.75 },
      cameraRotation: { pitch: -12, yaw: 167, roll: 3 },
      cameraFieldOfView: 73,
    })
    const manager = new PlayerCameraManager()

    const first = refreshAlsCameraViewBridge(
      bridge,
      manager,
      component,
      1 / 60,
    )
    expect(bridge.viewInfo.Location).toEqual({
      x: 125,
      y: -250,
      z: 75,
    })
    expect(first).toEqual({
      cameraLocation: { x: 1.25, y: -2.5, z: 0.75 },
      cameraRotation: { pitch: -12, yaw: 167, roll: 3 },
      cameraFieldOfView: 73,
    })

    const second = refreshAlsCameraViewBridge(
      bridge,
      manager,
      component,
      1 / 60,
    )
    expect(second).toBe(first)
    expect(bridge.viewInfo).toBe(viewInfo)
    expect(second).toBe(renderView)
    expect(second.cameraLocation).toBe(renderLocation)
    expect(second.cameraRotation).toBe(renderRotation)
  })

  it('applies the player-camera modifier after the raw component view without feedback', () => {
    const manager = new PlayerCameraManager({
      CameraShakeClasses: [B_Als_CameraShake_Sprint],
      RandomSource: () => 0,
    })
    manager.StartCameraShake('B_Als_CameraShake_Sprint_C', 0.5)
    const component = createAlsCameraComponentState({
      cameraLocation: { x: 1, y: 2, z: 3 },
      cameraRotation: { pitch: 0, yaw: 0, roll: 0 },
      cameraFieldOfView: 80,
    })
    const bridge = createAlsCameraViewBridgeState()

    const result = refreshAlsCameraViewBridge(
      bridge,
      manager,
      component,
      0.05,
    )

    const blendWeight = 0.05 / 0.1
    const locationOffsetCentimetres =
      Math.sin(0.05 * 2 * Math.PI) * 0.5 * blendWeight
    const rotationOffsetDegrees =
      0.1 * Math.sin(0.05 * 0.1 * 2 * Math.PI)
      * 0.5 * blendWeight
    expect(result.cameraLocation.x).toBeCloseTo(
      1 + locationOffsetCentimetres * 0.01,
      12,
    )
    expect(result.cameraLocation.y).toBeCloseTo(
      2 + locationOffsetCentimetres * 0.01,
      12,
    )
    expect(result.cameraLocation.z).toBeCloseTo(
      3 + locationOffsetCentimetres * 0.01,
      12,
    )
    expect(result.cameraRotation.pitch).toBeCloseTo(
      rotationOffsetDegrees,
      12,
    )
    expect(result.cameraRotation.yaw).toBeCloseTo(
      rotationOffsetDegrees,
      12,
    )
    expect(result.cameraRotation.roll).toBeCloseTo(
      rotationOffsetDegrees,
      12,
    )
    expect(result.cameraFieldOfView).toBe(80)

    expect(component.cameraLocation).toEqual({ x: 1, y: 2, z: 3 })
    expect(component.cameraRotation).toEqual({
      pitch: 0,
      yaw: 0,
      roll: 0,
    })
    expect(component.cameraFieldOfView).toBe(80)
  })
})
