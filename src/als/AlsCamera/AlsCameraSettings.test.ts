import { describe, expect, it } from 'vitest'
import { ALS_CAMERA_SETTINGS } from './AlsCameraSettings'

describe('UAlsCameraSettings header defaults', () => {
  it('ports every pure camera default and converts centimetres to metres once', () => {
    expect(ALS_CAMERA_SETTINGS).toEqual({
      ignoreTimeDilation: true,
      teleportDistanceThreshold: 2,
      firstPerson: {
        fieldOfView: 90,
        cameraSocketName: 'FirstPersonCamera',
      },
      thirdPerson: {
        fieldOfView: 90,
        firstPivotSocketName: 'root',
        secondPivotSocketName: 'head',
        traceRadius: 0.15,
        traceChannel: 'ECC_Visibility',
        traceShoulderLeftSocketName: 'ThirdPersonTraceShoulderLeft',
        traceShoulderRightSocketName: 'ThirdPersonTraceShoulderRight',
        traceOverrideOffset: { x: 0, y: 0, z: 0.4 },
        enableTraceDistanceSmoothing: true,
        traceDistanceSmoothing: {
          interpolationSpeed: 3,
        },
      },
    })
  })
})
