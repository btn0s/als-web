import characterSettingsSource from '../../../scripts/extract-als/character-settings.json?raw'

export type AlsInAirRotationMode =
  | 'RotateToVelocityOnJump'
  | 'KeepRelativeRotation'
  | 'KeepWorldRotation'

/**
 * Character policy consumed by the standalone core.
 *
 * These are the effective values of ALS Refactored's shipped `CS_Als_Default`, not merely the
 * `UAlsCharacterSettings` class defaults. Linear values cross to repository metres here.
 */
export interface AlsCharacterSettings {
  readonly teleportDistanceThreshold: number
  readonly movingSpeedThreshold: number
  readonly inAirRotationMode: AlsInAirRotationMode
  readonly allowAimingWhenInAir: boolean
  readonly sprintHasPriorityOverAiming: boolean
  readonly rotateToVelocityWhenSprinting: boolean
  readonly inheritMovementBaseRotationInVelocityDirectionRotationMode:
    boolean
  readonly rotateTowardsDesiredVelocityInVelocityDirectionRotationMode:
    boolean
  readonly autoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode:
    boolean
  /** FAlsRollingSettings::bCrouchOnStart. CS_Als_Default does not override the C++ default. */
  readonly rollingCrouchOnStart: boolean
}

interface ExtractedCharacterSettings {
  readonly schemaVersion: 1
  readonly settings: {
    readonly TeleportDistanceThreshold: number
    readonly MovingSpeedThreshold: number
    readonly InAirRotationMode: AlsInAirRotationMode
    readonly bAllowAimingWhenInAir: boolean
    readonly bSprintHasPriorityOverAiming: boolean
    readonly bRotateToVelocityWhenSprinting: boolean
    readonly bInheritMovementBaseRotationInVelocityDirectionRotationMode:
      boolean
    readonly bRotateTowardsDesiredVelocityInVelocityDirectionRotationMode:
      boolean
    readonly bAutoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode:
      boolean
  }
  readonly validations: readonly {
    readonly id: string
    readonly passed: boolean
  }[]
}

const extracted = JSON.parse(
  characterSettingsSource,
) as ExtractedCharacterSettings

if (
  extracted.schemaVersion !== 1
  || extracted.validations.some((validation) => !validation.passed)
) {
  throw new Error('CS_Als_Default character settings oracle is invalid')
}

const CENTIMETRES_TO_METRES = 0.01

export const ALS_CHARACTER_SETTINGS: Readonly<AlsCharacterSettings> = {
  teleportDistanceThreshold:
    extracted.settings.TeleportDistanceThreshold * CENTIMETRES_TO_METRES,
  movingSpeedThreshold:
    extracted.settings.MovingSpeedThreshold * CENTIMETRES_TO_METRES,
  inAirRotationMode: extracted.settings.InAirRotationMode,
  allowAimingWhenInAir: extracted.settings.bAllowAimingWhenInAir,
  sprintHasPriorityOverAiming:
    extracted.settings.bSprintHasPriorityOverAiming,
  rotateToVelocityWhenSprinting:
    extracted.settings.bRotateToVelocityWhenSprinting,
  inheritMovementBaseRotationInVelocityDirectionRotationMode:
    extracted.settings
      .bInheritMovementBaseRotationInVelocityDirectionRotationMode,
  rotateTowardsDesiredVelocityInVelocityDirectionRotationMode:
    extracted.settings
      .bRotateTowardsDesiredVelocityInVelocityDirectionRotationMode,
  autoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode:
    extracted.settings
      .bAutoRotateOnAnyInputWhileNotMovingInViewDirectionRotationMode,
  rollingCrouchOnStart: true,
}
