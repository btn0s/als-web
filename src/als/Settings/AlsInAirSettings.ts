import animationInstanceSettingsSource
  from '../../../scripts/extract-als/animation-settings.json?raw'
import { sampleRichCurve } from '../../engine/richCurve'
import type {
  RichCurveInterpolation,
  RichCurveKey,
} from '../../engine/richCurve'

/*
 * FAlsInAirSettings content from AIS_Als_Default.
 *
 * The extractor validates the object references and every serialized rich-curve key against
 * ALS Refactored 4.15 content. Keeping this adapter on top of the generated oracle prevents the
 * runtime from acquiring a second, manually transcribed version of either curve.
 */

interface SerializedRichCurveKey {
  readonly InterpMode: string
  readonly TangentWeightMode: string
  readonly Time: number
  readonly Value: number
  readonly ArriveTangent: number
  readonly LeaveTangent: number
}

interface SerializedCurveChannel {
  readonly sourceIndex: number
  readonly keys: readonly SerializedRichCurveKey[]
}

interface SerializedCurve {
  readonly channels: Readonly<Record<string, SerializedCurveChannel>>
}

interface SerializedAnimationInstanceSettings {
  readonly settings: {
    readonly inAir: {
      readonly LeanAmountCurve: string
      readonly GroundPredictionAmountCurve: string
    }
  }
  readonly curves: Readonly<Record<string, SerializedCurve>>
}

const animationInstanceSettings = JSON.parse(
  animationInstanceSettingsSource,
) as SerializedAnimationInstanceSettings

function compileInterpolation(interpMode: string): RichCurveInterpolation {
  switch (interpMode) {
    case 'RCIM_Constant':
      return 'constant'
    case 'RCIM_Linear':
      return 'linear'
    case 'RCIM_Cubic':
      return 'cubic'
    default:
      throw new Error(`Unsupported ALS rich-curve interpolation ${interpMode}`)
  }
}

function compileCurve(
  curveName: string,
  channelName: string,
): readonly RichCurveKey[] {
  const channel = animationInstanceSettings.curves[curveName]
    ?.channels[channelName]
  if (channel === undefined) {
    throw new Error(`Missing ALS curve ${curveName}.${channelName}`)
  }
  if (channel.sourceIndex !== 0) {
    throw new Error(
      `Unexpected ALS curve source index ${curveName}.${channelName}: `
      + channel.sourceIndex,
    )
  }

  return channel.keys.map((key) => {
    if (key.TangentWeightMode !== 'RCTWM_WeightedNone') {
      throw new Error(
        `Unsupported weighted ALS rich curve ${curveName}.${channelName}`,
      )
    }
    return {
      time: key.Time,
      value: key.Value,
      interpolation: compileInterpolation(key.InterpMode),
      arriveTangent: key.ArriveTangent,
      leaveTangent: key.LeaveTangent,
    }
  })
}

export const ALS_IN_AIR_SETTINGS = {
  leanAmountCurve:
    animationInstanceSettings.settings.inAir.LeanAmountCurve,
  groundPredictionAmountCurve:
    animationInstanceSettings.settings.inAir.GroundPredictionAmountCurve,
} as const

export const ALS_IN_AIR_LEAN_AMOUNT_CURVE = compileCurve(
  ALS_IN_AIR_SETTINGS.leanAmountCurve,
  'LeanAmount',
)

export const ALS_GROUND_PREDICTION_AMOUNT_CURVE = compileCurve(
  ALS_IN_AIR_SETTINGS.groundPredictionAmountCurve,
  'GroundPredictionAmount',
)

/** FAlsInAirSettings::LeanAmountCurve, sampled in ALS's native cm/s domain. */
export function sampleInAirLeanAmount(
  verticalVelocityCentimetresPerSecond: number,
): number {
  return sampleRichCurve(
    ALS_IN_AIR_LEAN_AMOUNT_CURVE,
    verticalVelocityCentimetresPerSecond,
  )
}

/** FAlsInAirSettings::GroundPredictionAmountCurve, sampled by FHitResult::Time. */
export function sampleGroundPredictionAmount(hitTime: number): number {
  return sampleRichCurve(
    ALS_GROUND_PREDICTION_AMOUNT_CURVE,
    hitTime,
  )
}
