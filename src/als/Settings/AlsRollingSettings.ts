import actionContentSource
  from '../../../scripts/extract-als/action-content.json?raw'

export interface AlsRollingSettings {
  readonly Montage: string
  readonly bCrouchOnStart: boolean
  readonly bRotateToInputOnStart: boolean
  readonly RotationInterpolationSpeed: number
  readonly bStartRollingOnLand: boolean
  /** Repository metres per second. */
  readonly RollingOnLandSpeedThreshold: number
  readonly bInterruptRollingWhenInAir: boolean
}

interface SerializedActionContent {
  readonly schemaVersion: 1
  readonly settings: {
    readonly nativeSpeedUnit: 'cm/s'
    readonly Rolling: {
      readonly Montage: string
      readonly bCrouchOnStart: boolean
      readonly bRotateToInputOnStart: boolean
      readonly RotationInterpolationSpeed: number
      readonly bStartRollingOnLand: boolean
      readonly RollingOnLandSpeedThreshold: number
      readonly bInterruptRollingWhenInAir: boolean
    }
  }
  readonly validations: readonly {
    readonly pass: boolean
  }[]
}

const content = JSON.parse(
  actionContentSource,
) as SerializedActionContent

if (
  content.schemaVersion !== 1
  || content.settings.nativeSpeedUnit !== 'cm/s'
  || content.validations.some(({ pass }) => !pass)
) {
  throw new Error('ALS Rolling settings content oracle is invalid')
}

const CENTIMETRES_PER_METRE = 100
const settings = content.settings.Rolling

/** Effective `CS_Als_Default::Rolling` values. */
export const ALS_ROLLING_SETTINGS:
Readonly<AlsRollingSettings> = Object.freeze({
  Montage: settings.Montage,
  bCrouchOnStart: settings.bCrouchOnStart,
  bRotateToInputOnStart: settings.bRotateToInputOnStart,
  RotationInterpolationSpeed: settings.RotationInterpolationSpeed,
  bStartRollingOnLand: settings.bStartRollingOnLand,
  RollingOnLandSpeedThreshold:
    settings.RollingOnLandSpeedThreshold / CENTIMETRES_PER_METRE,
  bInterruptRollingWhenInAir:
    settings.bInterruptRollingWhenInAir,
})
