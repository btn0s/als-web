import { describe, expect, it } from 'vitest'
import { ALS_RAGDOLLING_SETTINGS } from './AlsRagdollingSettings'

describe('FAlsRagdollingSettings', () => {
  it('uses the exact effective CS_Als_Default values', () => {
    expect(ALS_RAGDOLLING_SETTINGS).toEqual({
      bStartRagdollingOnLand: true,
      RagdollingOnLandSpeedThreshold: 10,
      bLimitInitialRagdollSpeed: true,
      GetUpFrontMontage: 'AM_Als_GetUp_Front',
      GetUpBackMontage: 'AM_Als_GetUp_Back',
    })
  })
})
