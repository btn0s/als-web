import { describe, expect, it } from 'vitest'
import cameraContentSource from '../../../../scripts/extract-als/camera-content.json?raw'
import {
  ALS_CAMERA_CURVE_NAMES,
  CAMERA_CURVES_DEBUG_DISPLAY_NAME,
  CAMERA_SHAPES_DEBUG_DISPLAY_NAME,
  CAMERA_TRACES_DEBUG_DISPLAY_NAME,
} from './AlsCameraConstants'

describe('UAlsCameraConstants', () => {
  it('pins every authored camera curve name in C++ declaration order', () => {
    const extractedCurveNames = (
      JSON.parse(cameraContentSource) as {
        curveNames: readonly { name: string }[]
      }
    ).curveNames.map(({ name }) => name)

    expect(ALS_CAMERA_CURVE_NAMES).toEqual([
      'CameraOffsetX',
      'CameraOffsetY',
      'CameraOffsetZ',
      'FovOffset',
      'PivotOffsetX',
      'PivotOffsetY',
      'PivotOffsetZ',
      'LocationLagX',
      'LocationLagY',
      'LocationLagZ',
      'RotationLag',
      'FirstPersonOverride',
      'TraceOverride',
    ])
    expect(ALS_CAMERA_CURVE_NAMES).toEqual(extractedCurveNames)
  })

  it('pins the three camera debug display names', () => {
    expect([
      CAMERA_CURVES_DEBUG_DISPLAY_NAME,
      CAMERA_SHAPES_DEBUG_DISPLAY_NAME,
      CAMERA_TRACES_DEBUG_DISPLAY_NAME,
    ]).toEqual([
      'ALS.CameraCurves',
      'ALS.CameraShapes',
      'ALS.CameraTraces',
    ])
  })
})
