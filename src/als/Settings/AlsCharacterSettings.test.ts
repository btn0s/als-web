import { describe, expect, it } from 'vitest'
import characterSettingsSource from '../../../scripts/extract-als/character-settings.json?raw'
import {
  ALS_CHARACTER_SETTINGS,
} from './AlsCharacterSettings'
import {
  ALS_RAGDOLLING_SETTINGS,
} from './AlsRagdollingSettings'
import {
  ALS_ROLLING_SETTINGS,
} from './AlsRollingSettings'

describe('CS_Als_Default character settings', () => {
  it('uses the shipped asset overrides over the C++ class defaults', () => {
    expect(ALS_CHARACTER_SETTINGS).toEqual({
      teleportDistanceThreshold: 0.5,
      movingSpeedThreshold: 0.5,
      inAirRotationMode: 'KeepRelativeRotation',
      allowAimingWhenInAir: true,
      sprintHasPriorityOverAiming: true,
      rotateToVelocityWhenSprinting: true,
      inheritMovementBaseRotationInVelocityDirectionRotationMode: false,
      rotateTowardsDesiredVelocityInVelocityDirectionRotationMode: true,
      autoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode: true,
      Ragdolling: {
        bStartRagdollingOnLand: true,
        RagdollingOnLandSpeedThreshold: 10,
        bLimitInitialRagdollSpeed: true,
        GetUpFrontMontage: 'AM_Als_GetUp_Front',
        GetUpBackMontage: 'AM_Als_GetUp_Back',
      },
      Rolling: {
        Montage: 'AM_Als_Roll',
        bCrouchOnStart: true,
        bRotateToInputOnStart: true,
        RotationInterpolationSpeed: 10,
        bStartRollingOnLand: true,
        RollingOnLandSpeedThreshold: 7,
        bInterruptRollingWhenInAir: false,
      },
    })
  })

  it('composes the exact extracted action settings records', () => {
    expect(ALS_CHARACTER_SETTINGS.Ragdolling).toBe(
      ALS_RAGDOLLING_SETTINGS,
    )
    expect(ALS_CHARACTER_SETTINGS.Rolling).toBe(
      ALS_ROLLING_SETTINGS,
    )
  })

  it('is backed by a passing extracted content oracle', () => {
    const oracle = JSON.parse(characterSettingsSource) as {
      source: {
        settingsAssetPath: string
        cppDefaults: string
      }
      serializedOverrides: Record<string, unknown>
      validations: { passed: boolean }[]
    }

    expect(oracle.source.settingsAssetPath).toBe(
      'ALS/Content/ALS/Data/Character/CS_Als_Default.uasset',
    )
    expect(oracle.source.cppDefaults).toBe(
      'Source/ALS/Public/Settings/AlsCharacterSettings.h',
    )
    expect(oracle.serializedOverrides).toMatchObject({
      bSprintHasPriorityOverAiming: true,
      bRotateToVelocityWhenSprinting: true,
      InAirRotationMode: 'EAlsInAirRotationMode::KeepRelativeRotation',
    })
    expect(oracle.validations.every(({ passed }) => passed)).toBe(true)
  })
})
