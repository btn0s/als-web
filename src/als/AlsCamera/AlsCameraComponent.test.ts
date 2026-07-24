import { describe, expect, it } from 'vitest'
import type { AlsVector3 } from '../State/AlsLocomotionState'
import {
  ALS_CAMERA_SETTINGS,
  type AlsCameraSettings,
} from './AlsCameraSettings'
import {
  activateAlsCameraComponent,
  cameraRotationToQuaternion,
  calculateCameraOffset,
  calculateCameraRotation,
  calculateCameraTrace,
  calculatePivotLagLocation,
  calculatePivotOffset,
  createAlsCameraComponentState,
  quaternionToCameraRotation,
  refreshCameraDeltaTime,
  rotateCameraVector,
  setFieldOfViewOverride,
  setFieldOfViewOverriden,
  setPostProcessWeight,
  setRightShoulder,
  tickAlsCameraComponent,
  type AlsCameraTraceRequest,
} from './AlsCameraComponent'

function expectVector(
  actual: Readonly<AlsVector3>,
  expected: Readonly<AlsVector3>,
  precision = 10,
) {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.z).toBeCloseTo(expected.z, precision)
}

function cameraSettings(
  firstPersonFieldOfView: number,
  thirdPersonFieldOfView: number,
): AlsCameraSettings {
  return {
    ...ALS_CAMERA_SETTINGS,
    firstPerson: {
      ...ALS_CAMERA_SETTINGS.firstPerson,
      fieldOfView: firstPersonFieldOfView,
    },
    thirdPerson: {
      ...ALS_CAMERA_SETTINGS.thirdPerson,
      fieldOfView: thirdPersonFieldOfView,
    },
  }
}

describe('UAlsCameraComponent pure math', () => {
  it('ports FRotator exponential decay and the +175 degree counterclockwise bias', () => {
    const decayed = calculateCameraRotation(
      { pitch: 10, yaw: 170, roll: -30 },
      { pitch: -20, yaw: -170, roll: 45 },
      0.125,
      8,
      true,
    )

    // InvExpApprox(1) => 0.6316758747697975 interpolation amount.
    expect(decayed.pitch).toBeCloseTo(-8.950276243093924, 12)
    expect(decayed.yaw).toBeCloseTo(-177.36648250460405, 12)
    expect(decayed.roll).toBeCloseTo(17.37569060773481, 12)

    const biased = calculateCameraRotation(
      { pitch: 0, yaw: 0, roll: 0 },
      { pitch: 0, yaw: 180, roll: 0 },
      1,
      1,
      true,
    )
    expect(biased.yaw).toBeCloseTo(-113.70165745856356, 12)
  })

  it('decays pivot lag independently in camera-yaw-local XYZ space', () => {
    const result = calculatePivotLagLocation(
      { x: 1, y: 2, z: 3 },
      { x: 5, y: 7, z: 11 },
      90,
      0.1,
      { x: 1, y: 2, z: 3 },
      true,
    )

    // At yaw 90: initial local=(2,-1,3), target local=(7,-5,11). Each component then uses its
    // own InvExpApprox lambda before rotating back to world space.
    expectVector(result, {
      x: 1.7242113538834478,
      y: 2.4752564398412717,
      z: 5.072076144181928,
    }, 12)
  })

  it('uses mesh-local pivot offset, full-rotation camera offset, scale, and cm-to-m conversion', () => {
    expectVector(
      calculatePivotOffset(
        { PivotOffsetX: 100 },
        { pitch: 0, yaw: 90, roll: 0 },
        2,
      ),
      { x: 0, y: 2, z: 0 },
    )
    expectVector(
      calculateCameraOffset(
        { CameraOffsetX: -300 },
        { pitch: 90, yaw: 0, roll: 0 },
        1,
      ),
      { x: 0, y: 0, z: -3 },
    )
    expectVector(
      rotateCameraVector(
        { x: 0, y: 1, z: 0 },
        { pitch: 0, yaw: 0, roll: 90 },
      ),
      { x: 0, y: 0, z: -1 },
    )
  })
})

describe('UAlsCameraComponent trace and TickCamera ordering', () => {
  it('contracts trace distance immediately and recovers exponentially', () => {
    const contraction = calculateCameraTrace({
      cameraTargetLocation: { x: 10, y: 0, z: 0 },
      pivotTargetLocation: { x: 0, y: 0, z: 0 },
      pivotOffset: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      traceOverrideAmount: 0,
      meshScale: 1,
      ownerLocation: { x: 0, y: 0, z: 0 },
      deltaTime: 0.1,
      allowLag: true,
      previousTraceDistanceRatio: 0.8,
      settings: ALS_CAMERA_SETTINGS.thirdPerson,
      trace: () => ({
        traceResult: { x: 2.5, y: 0, z: 0 },
      }),
    })
    expect(contraction.traceDistanceRatio).toBeCloseTo(0.25, 12)
    expectVector(contraction.location, { x: 2.5, y: 0, z: 0 })

    const recovery = calculateCameraTrace({
      cameraTargetLocation: { x: 10, y: 0, z: 0 },
      pivotTargetLocation: { x: 0, y: 0, z: 0 },
      pivotOffset: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      traceOverrideAmount: 0,
      meshScale: 1,
      ownerLocation: { x: 0, y: 0, z: 0 },
      deltaTime: 0.1,
      allowLag: true,
      previousTraceDistanceRatio: contraction.traceDistanceRatio,
      settings: ALS_CAMERA_SETTINGS.thirdPerson,
      trace: () => null,
    })
    expect(recovery.traceDistanceRatio).toBeCloseTo(
      0.4442571385170557,
      12,
    )
    expectVector(recovery.location, {
      x: 4.442571385170557,
      y: 0,
      z: 0,
    })
  })

  it('uses an adjusted penetration trace start for distance smoothing', () => {
    const result = calculateCameraTrace({
      cameraTargetLocation: { x: 10, y: 0, z: 0 },
      pivotTargetLocation: { x: 0, y: 0, z: 0 },
      pivotOffset: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      traceOverrideAmount: 0,
      meshScale: 1,
      ownerLocation: { x: 0, y: 0, z: 0 },
      deltaTime: 1 / 60,
      allowLag: true,
      previousTraceDistanceRatio: 1,
      settings: ALS_CAMERA_SETTINGS.thirdPerson,
      trace: () => ({
        adjustedTraceStart: { x: 1, y: 0, z: 0 },
        traceResult: { x: 3, y: 0, z: 0 },
      }),
    })

    expectVector(result.traceStart, { x: 1, y: 0, z: 0 })
    expect(result.traceDistanceRatio).toBeCloseTo(2 / 9, 12)
    expectVector(result.location, { x: 3, y: 0, z: 0 })
  })

  it('preserves C++ TickCamera order through offsets, trace, first-person blend, and FOV offset', () => {
    const state = createAlsCameraComponentState({
      pivotTargetLocation: { x: 10, y: 0, z: 1 },
      traceDistanceRatio: 1,
    })
    let capturedTrace: AlsCameraTraceRequest | undefined
    const result = tickAlsCameraComponent(state, {
      deltaTime: 0.1,
      pivotTargetLocation: { x: 10, y: 0, z: 1 },
      firstPersonCameraLocation: { x: 10, y: 0, z: 1.7 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 1 },
      ownerLocation: { x: 10, y: 0, z: 0 },
      cameraTargetRotation: { pitch: 90, yaw: 0, roll: 0 },
      meshRotation: { pitch: 0, yaw: 90, roll: 0 },
      settings: cameraSettings(70, 100),
      curves: {
        PivotOffsetX: 100,
        CameraOffsetX: -300,
        TraceOverride: 0.5,
        FirstPersonOverride: 0.25,
        FovOffset: 5,
      },
      trace: (request) => {
        capturedTrace = request
        return {
          traceResult: {
            x: (request.start.x + request.end.x) * 0.5,
            y: (request.start.y + request.end.y) * 0.5,
            z: (request.start.z + request.end.z) * 0.5,
          },
        }
      },
    })

    expect(result.lagAllowed).toBe(true)
    expectVector(result.pivotOffset!, { x: 0, y: 1, z: 0 })
    expectVector(state.pivotLocation, { x: 10, y: 1, z: 1 })
    expectVector(result.cameraOffset!, { x: 0, y: 0, z: -3 })
    expectVector(result.cameraTargetLocation!, { x: 10, y: 1, z: -2 })

    // TraceOverride=.5 lerps shoulder start toward PivotTarget + mesh-local PivotOffset +
    // the unscaled 0.4 m settings offset before the collision adapter sees it.
    expectVector(capturedTrace!.start, { x: 5, y: 0.5, z: 1.2 })
    expectVector(capturedTrace!.end, { x: 10, y: 1, z: -2 })
    expect(capturedTrace!.radius).toBe(0.15)
    expect(capturedTrace!.penetrationAdjustmentRadius).toBe(0.16)
    expectVector(capturedTrace!.ownerLocation, { x: 10, y: 0, z: 0 })
    expect(capturedTrace!.channel).toBe('ECC_Visibility')
    expect(result.trace!.traceDistanceRatio).toBeCloseTo(0.5, 12)
    expectVector(result.trace!.location, { x: 7.5, y: 0.75, z: -0.4 })

    // Collision-corrected third person is blended toward first person only after tracing.
    expectVector(state.cameraLocation, { x: 8.125, y: 0.5625, z: 0.125 })
    // lerp(100,70,.25)=92.5, then authored FovOffset +5.
    expect(state.cameraFieldOfView).toBeCloseTo(97.5, 12)
  })

  it('takes the full first-person fast path before teleport, trace, and FOV offset', () => {
    const state = createAlsCameraComponentState({
      pivotTargetLocation: { x: -100, y: 0, z: 0 },
      traceDistanceRatio: 0.37,
      cameraFieldOfView: 90,
      overrideFieldOfView: true,
      fieldOfViewOverride: -50,
    })
    let traceCalls = 0
    const result = tickAlsCameraComponent(state, {
      deltaTime: 0.1,
      pivotTargetLocation: { x: 20, y: 30, z: 40 },
      firstPersonCameraLocation: { x: 2, y: 3, z: 4 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      ownerLocation: { x: 0, y: 0, z: 0 },
      cameraTargetRotation: { pitch: 10, yaw: 20, roll: 30 },
      meshRotation: { pitch: 0, yaw: 0, roll: 0 },
      curves: {
        FirstPersonOverride: 1 - 1e-5,
        FovOffset: 500,
      },
      trace: () => {
        traceCalls++
        return null
      },
    })

    expect(result.firstPersonFastPath).toBe(true)
    expect(result.trace).toBeNull()
    expect(traceCalls).toBe(0)
    expectVector(state.pivotLagLocation, { x: 20, y: 30, z: 40 })
    expectVector(state.pivotLocation, { x: 20, y: 30, z: 40 })
    expectVector(state.cameraLocation, { x: 2, y: 3, z: 4 })
    expect(state.cameraRotation).toEqual({ pitch: 10, yaw: 20, roll: 30 })
    // SetFieldOfViewOverride clamps to 5 before TickCamera; the fast path then skips FovOffset.
    expect(state.cameraFieldOfView).toBe(5)
    expect(state.traceDistanceRatio).toBe(0.37)
  })

  it('disables every lag stage after a teleport and clamps normal-path FOV', () => {
    const state = createAlsCameraComponentState({
      pivotTargetLocation: { x: 0, y: 0, z: 0 },
      pivotLagLocation: { x: -10, y: 0, z: 0 },
      cameraRotation: { pitch: 0, yaw: -90, roll: 0 },
      traceDistanceRatio: 0.2,
    })
    const result = tickAlsCameraComponent(state, {
      deltaTime: 1 / 60,
      pivotTargetLocation: { x: 2.1, y: 0, z: 0 },
      firstPersonCameraLocation: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      ownerLocation: { x: 0, y: 0, z: 0 },
      cameraTargetRotation: { pitch: 5, yaw: 45, roll: 10 },
      meshRotation: { pitch: 0, yaw: 0, roll: 0 },
      settings: cameraSettings(90, 170),
      curves: {
        RotationLag: 100,
        LocationLagX: 100,
        LocationLagY: 100,
        LocationLagZ: 100,
        FovOffset: 20,
      },
      trace: () => ({
        traceResult: { x: 1, y: 0, z: 0 },
      }),
    })

    expect(result.lagAllowed).toBe(false)
    expect(state.cameraRotation).toEqual({ pitch: 5, yaw: 45, roll: 10 })
    expectVector(state.pivotLagLocation, { x: 2.1, y: 0, z: 0 })
    expectVector(state.cameraLocation, { x: 1, y: 0, z: 0 })
    expect(state.traceDistanceRatio).toBe(1)
    expect(state.cameraFieldOfView).toBe(175)
  })

  it('preserves camera and pivot lag relative to a rotating movement base', () => {
    const movementBaseKey = {}
    const state = createAlsCameraComponentState({
      pivotTargetLocation: { x: 1, y: 0, z: 0 },
      pivotLagLocation: { x: 1, y: 0, z: 0 },
      cameraRotation: { pitch: 0, yaw: 10, roll: 0 },
    })
    const common = {
      deltaTime: 0,
      firstPersonCameraLocation: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      ownerLocation: { x: 0, y: 0, z: 0 },
      meshRotation: { pitch: 0, yaw: 0, roll: 0 },
      curves: {
        RotationLag: 1,
        LocationLagX: 1,
        LocationLagY: 1,
        LocationLagZ: 1,
      },
      trace: () => null,
    } as const

    tickAlsCameraComponent(state, {
      ...common,
      pivotTargetLocation: { x: 1, y: 0, z: 0 },
      cameraTargetRotation: { pitch: 0, yaw: 10, roll: 0 },
      movementBase: {
        key: movementBaseKey,
        boneName: '',
        hasRelativeRotation: true,
        location: { x: 0, y: 0, z: 0 },
        rotation: cameraRotationToQuaternion({
          pitch: 0,
          yaw: 0,
          roll: 0,
        }),
      },
    })

    expectVector(
      state.pivotMovementBaseRelativeLagLocation,
      { x: 1, y: 0, z: 0 },
    )
    expect(
      quaternionToCameraRotation(
        state.cameraMovementBaseRelativeRotation,
      ).yaw,
    ).toBeCloseTo(10, 10)

    tickAlsCameraComponent(state, {
      ...common,
      pivotTargetLocation: { x: 1, y: 1, z: 0 },
      cameraTargetRotation: { pitch: 0, yaw: 100, roll: 0 },
      movementBase: {
        key: movementBaseKey,
        boneName: '',
        hasRelativeRotation: true,
        location: { x: 1, y: 0, z: 0 },
        rotation: cameraRotationToQuaternion({
          pitch: 0,
          yaw: 90,
          roll: 0,
        }),
      },
    })

    expectVector(state.pivotLagLocation, { x: 1, y: 1, z: 0 })
    expect(state.cameraRotation.yaw).toBeCloseTo(100, 10)
    expectVector(
      state.pivotMovementBaseRelativeLagLocation,
      { x: 1, y: 0, z: 0 },
    )
    expect(
      quaternionToCameraRotation(
        state.cameraMovementBaseRelativeRotation,
      ).yaw,
    ).toBeCloseTo(10, 10)
  })

  it('runs Activate as TickCamera(0, false) to prevent startup lag', () => {
    const state = createAlsCameraComponentState({
      pivotTargetLocation: { x: -100, y: 0, z: 0 },
      pivotLagLocation: { x: -100, y: 0, z: 0 },
      cameraRotation: { pitch: 0, yaw: -90, roll: 0 },
    })

    const result = activateAlsCameraComponent(state, {
      pivotTargetLocation: { x: 2, y: 3, z: 4 },
      firstPersonCameraLocation: { x: 2, y: 3, z: 5 },
      thirdPersonTraceStartLocation: { x: 2, y: 3, z: 4 },
      ownerLocation: { x: 2, y: 3, z: 0 },
      cameraTargetRotation: { pitch: 5, yaw: 30, roll: 10 },
      meshRotation: { pitch: 0, yaw: 0, roll: 0 },
      curves: {
        RotationLag: 100,
        LocationLagX: 100,
        LocationLagY: 100,
        LocationLagZ: 100,
      },
      trace: () => null,
    })

    expect(result.lagAllowed).toBe(false)
    expectVector(state.pivotLagLocation, { x: 2, y: 3, z: 4 })
    expect(state.cameraRotation).toEqual({ pitch: 5, yaw: 30, roll: 10 })
  })

  it('round-trips combined-axis FRotator quaternions', () => {
    const source = { pitch: 20, yaw: 30, roll: -15 }
    const roundTrip = quaternionToCameraRotation(
      cameraRotationToQuaternion(source),
    )

    expect(roundTrip.pitch).toBeCloseTo(source.pitch, 10)
    expect(roundTrip.yaw).toBeCloseTo(source.yaw, 10)
    expect(roundTrip.roll).toBeCloseTo(source.roll, 10)
  })

  it('matches independent FRotationMatrix vector math on a combined-axis base', () => {
    const movementBaseKey = {}
    const relativePivot = { x: 1, y: 2, z: 3 }
    const state = createAlsCameraComponentState({
      pivotTargetLocation: relativePivot,
      pivotLagLocation: relativePivot,
    })
    const curves = {
      RotationLag: 1,
      LocationLagX: 1,
      LocationLagY: 1,
      LocationLagZ: 1,
    }
    const common = {
      deltaTime: 0,
      firstPersonCameraLocation: { x: 0, y: 0, z: 0 },
      thirdPersonTraceStartLocation: { x: 0, y: 0, z: 0 },
      ownerLocation: { x: 0, y: 0, z: 0 },
      meshRotation: { pitch: 0, yaw: 0, roll: 0 },
      curves,
      trace: () => null,
    } as const

    tickAlsCameraComponent(state, {
      ...common,
      pivotTargetLocation: relativePivot,
      cameraTargetRotation: { pitch: 0, yaw: 0, roll: 0 },
      movementBase: {
        key: movementBaseKey,
        boneName: '',
        hasRelativeRotation: true,
        location: { x: 0, y: 0, z: 0 },
        rotation: cameraRotationToQuaternion({
          pitch: 0,
          yaw: 0,
          roll: 0,
        }),
      },
    })

    const baseRotation = { pitch: 20, yaw: 30, roll: -15 }
    const baseLocation = { x: 0.25, y: -0.5, z: 1 }
    const rotated = rotateCameraVector(relativePivot, baseRotation)
    const expected = {
      x: baseLocation.x + rotated.x,
      y: baseLocation.y + rotated.y,
      z: baseLocation.z + rotated.z,
    }
    tickAlsCameraComponent(state, {
      ...common,
      pivotTargetLocation: expected,
      cameraTargetRotation: baseRotation,
      movementBase: {
        key: movementBaseKey,
        boneName: '',
        hasRelativeRotation: true,
        location: baseLocation,
        rotation: cameraRotationToQuaternion(baseRotation),
      },
    })

    expectVector(state.pivotLagLocation, expected, 10)
  })

  it('ports component setters and previous-frame time-dilation unscaling', () => {
    const state = createAlsCameraComponentState()
    expect(state.rightShoulder).toBe(true)

    setRightShoulder(state, false)
    setFieldOfViewOverriden(state, true)
    setFieldOfViewOverride(state, 500)
    setPostProcessWeight(state, -2)
    expect(state.rightShoulder).toBe(false)
    expect(state.overrideFieldOfView).toBe(true)
    expect(state.fieldOfViewOverride).toBe(175)
    expect(state.postProcessWeight).toBe(0)

    state.previousGlobalTimeDilation = 0.5
    expect(refreshCameraDeltaTime(state, ALS_CAMERA_SETTINGS, {
      deltaTime: 0.025,
      deltaRealTime: 0.01,
      effectiveGlobalTimeDilation: 0.25,
      customTimeDilation: 0.5,
    })).toBeCloseTo(0.1, 12)
    expect(state.previousGlobalTimeDilation).toBe(0.25)

    state.previousGlobalTimeDilation = 0
    expect(refreshCameraDeltaTime(state, ALS_CAMERA_SETTINGS, {
      deltaTime: 0,
      deltaRealTime: 0.016,
      effectiveGlobalTimeDilation: 1,
      customTimeDilation: 1,
    })).toBe(0.016)
  })
})
