import actionContentSource
  from '../../../scripts/extract-als/action-content.json?raw'

export interface AlsRagdollingSettings {
  readonly bStartRagdollingOnLand: boolean
  /** Repository metres per second. */
  readonly RagdollingOnLandSpeedThreshold: number
  readonly bLimitInitialRagdollSpeed: boolean
  readonly GetUpFrontMontage: string
  readonly GetUpBackMontage: string
}

interface SerializedActionContent {
  readonly schemaVersion: 1
  readonly settings: {
    readonly nativeSpeedUnit: 'cm/s'
    readonly Ragdolling: {
      readonly bStartRagdollingOnLand: boolean
      readonly RagdollingOnLandSpeedThreshold: number
      readonly bLimitInitialRagdollSpeed: boolean
      readonly GetUpFrontMontage: string
      readonly GetUpBackMontage: string
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
  throw new Error('ALS Ragdolling settings content oracle is invalid')
}

const CENTIMETRES_PER_METRE = 100
const settings = content.settings.Ragdolling

/** Effective `CS_Als_Default::Ragdolling` values. */
export const ALS_RAGDOLLING_SETTINGS:
Readonly<AlsRagdollingSettings> = Object.freeze({
  bStartRagdollingOnLand: settings.bStartRagdollingOnLand,
  RagdollingOnLandSpeedThreshold:
    settings.RagdollingOnLandSpeedThreshold / CENTIMETRES_PER_METRE,
  bLimitInitialRagdollSpeed: settings.bLimitInitialRagdollSpeed,
  GetUpFrontMontage: settings.GetUpFrontMontage,
  GetUpBackMontage: settings.GetUpBackMontage,
})
