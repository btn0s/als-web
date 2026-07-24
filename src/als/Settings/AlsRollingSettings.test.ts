import { describe, expect, it } from 'vitest'
import { ALS_ROLLING_SETTINGS } from './AlsRollingSettings'

describe('FAlsRollingSettings', () => {
  it('uses the exact effective CS_Als_Default values', () => {
    expect(ALS_ROLLING_SETTINGS).toEqual({
      Montage: 'AM_Als_Roll',
      bCrouchOnStart: true,
      bRotateToInputOnStart: true,
      RotationInterpolationSpeed: 10,
      bStartRollingOnLand: true,
      RollingOnLandSpeedThreshold: 7,
      bInterruptRollingWhenInAir: false,
    })
  })
})
