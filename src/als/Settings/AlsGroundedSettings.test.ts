import { describe, expect, it } from 'vitest'
import {
  ALS_GROUNDED_SETTINGS,
  ALS_ROTATION_YAW_OFFSET_BACKWARD_CURVE,
  ALS_ROTATION_YAW_OFFSET_FORWARD_CURVE,
  ALS_ROTATION_YAW_OFFSET_LEFT_CURVE,
  ALS_ROTATION_YAW_OFFSET_RIGHT_CURVE,
  sampleRotationYawOffsets,
} from './AlsGroundedSettings'

describe('VERIFIED AIS_Als_Default Grounded settings', () => {
  it('binds all four settings references and preserves the shared forward/backward asset', () => {
    expect(ALS_GROUNDED_SETTINGS).toEqual({
      rotationYawOffsetForwardCurve:
        'CF_Als_RotationYawOffset_ForwardBackward',
      rotationYawOffsetBackwardCurve:
        'CF_Als_RotationYawOffset_ForwardBackward',
      rotationYawOffsetLeftCurve: 'CF_Als_RotationYawOffset_Left',
      rotationYawOffsetRightCurve: 'CF_Als_RotationYawOffset_Right',
    })
    expect(ALS_ROTATION_YAW_OFFSET_FORWARD_CURVE)
      .toEqual(ALS_ROTATION_YAW_OFFSET_BACKWARD_CURVE)
    expect(ALS_ROTATION_YAW_OFFSET_FORWARD_CURVE).toHaveLength(9)
    expect(ALS_ROTATION_YAW_OFFSET_LEFT_CURVE).toHaveLength(9)
    expect(ALS_ROTATION_YAW_OFFSET_RIGHT_CURVE).toHaveLength(9)
  })

  it('samples the exact authored linear offsets at graph property-access angles', () => {
    expect(sampleRotationYawOffsets(-135)).toEqual({
      forwardAngle: 45,
      backwardAngle: 45,
      leftAngle: -45,
      rightAngle: -45,
    })
    expect(sampleRotationYawOffsets(-45)).toEqual({
      forwardAngle: -45,
      backwardAngle: -45,
      leftAngle: 0,
      rightAngle: 45,
    })
    expect(sampleRotationYawOffsets(45)).toEqual({
      forwardAngle: 45,
      backwardAngle: 45,
      leftAngle: -45,
      rightAngle: 0,
    })
    expect(sampleRotationYawOffsets(135)).toEqual({
      forwardAngle: -45,
      backwardAngle: -45,
      leftAngle: 45,
      rightAngle: 45,
    })
  })
})
