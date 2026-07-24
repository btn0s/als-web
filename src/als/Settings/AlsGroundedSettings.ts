import animationInstanceSettingsSource
  from '../../../scripts/extract-als/animation-settings.json?raw'
import { sampleRichCurve } from '../../engine/richCurve'
import type {
  RichCurveInterpolation,
  RichCurveKey,
} from '../../engine/richCurve'

/*
 * FAlsGroundedSettings content from AIS_Als_Default.
 *
 * The generated oracle validates all four object references and every exact linear key from the
 * three referenced CurveFloat assets. Forward and Backward intentionally share one asset.
 */

interface SerializedRichCurveKey {
  readonly InterpMode: string
  readonly TangentWeightMode: string
  readonly Time: number
  readonly Value: number
  readonly ArriveTangent: number
  readonly LeaveTangent: number
}

interface SerializedCurve {
  readonly channels: Readonly<Record<string, {
    readonly sourceIndex: number
    readonly keys: readonly SerializedRichCurveKey[]
  }>>
}

interface SerializedAnimationInstanceSettings {
  readonly settings: {
    readonly grounded: {
      readonly RotationYawOffsetForwardCurve: string
      readonly RotationYawOffsetBackwardCurve: string
      readonly RotationYawOffsetLeftCurve: string
      readonly RotationYawOffsetRightCurve: string
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

function compileRotationYawOffsetCurve(
  curveName: string,
): readonly RichCurveKey[] {
  const channel = animationInstanceSettings.curves[curveName]
    ?.channels.RotationYawOffset
  if (channel === undefined) {
    throw new Error(
      `Missing ALS curve ${curveName}.RotationYawOffset`,
    )
  }
  if (channel.sourceIndex !== 0) {
    throw new Error(
      `Unexpected ALS curve source index `
      + `${curveName}.RotationYawOffset: ${channel.sourceIndex}`,
    )
  }

  return channel.keys.map((key) => {
    if (key.TangentWeightMode !== 'RCTWM_WeightedNone') {
      throw new Error(
        `Unsupported weighted ALS rich curve `
        + `${curveName}.RotationYawOffset`,
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

const grounded = animationInstanceSettings.settings.grounded

export const ALS_GROUNDED_SETTINGS = {
  rotationYawOffsetForwardCurve:
    grounded.RotationYawOffsetForwardCurve,
  rotationYawOffsetBackwardCurve:
    grounded.RotationYawOffsetBackwardCurve,
  rotationYawOffsetLeftCurve:
    grounded.RotationYawOffsetLeftCurve,
  rotationYawOffsetRightCurve:
    grounded.RotationYawOffsetRightCurve,
} as const

export const ALS_ROTATION_YAW_OFFSET_FORWARD_CURVE =
  compileRotationYawOffsetCurve(
    ALS_GROUNDED_SETTINGS.rotationYawOffsetForwardCurve,
  )

export const ALS_ROTATION_YAW_OFFSET_BACKWARD_CURVE =
  compileRotationYawOffsetCurve(
    ALS_GROUNDED_SETTINGS.rotationYawOffsetBackwardCurve,
  )

export const ALS_ROTATION_YAW_OFFSET_LEFT_CURVE =
  compileRotationYawOffsetCurve(
    ALS_GROUNDED_SETTINGS.rotationYawOffsetLeftCurve,
  )

export const ALS_ROTATION_YAW_OFFSET_RIGHT_CURVE =
  compileRotationYawOffsetCurve(
    ALS_GROUNDED_SETTINGS.rotationYawOffsetRightCurve,
  )

export interface AlsRotationYawOffsetsState {
  readonly forwardAngle: number
  readonly backwardAngle: number
  readonly leftAngle: number
  readonly rightAngle: number
}

/** UAlsAnimationInstance::RefreshRotationYawOffsets(). */
export function sampleRotationYawOffsets(
  viewRelativeVelocityYawAngle: number,
): AlsRotationYawOffsetsState {
  return {
    forwardAngle: sampleRichCurve(
      ALS_ROTATION_YAW_OFFSET_FORWARD_CURVE,
      viewRelativeVelocityYawAngle,
    ),
    backwardAngle: sampleRichCurve(
      ALS_ROTATION_YAW_OFFSET_BACKWARD_CURVE,
      viewRelativeVelocityYawAngle,
    ),
    leftAngle: sampleRichCurve(
      ALS_ROTATION_YAW_OFFSET_LEFT_CURVE,
      viewRelativeVelocityYawAngle,
    ),
    rightAngle: sampleRichCurve(
      ALS_ROTATION_YAW_OFFSET_RIGHT_CURVE,
      viewRelativeVelocityYawAngle,
    ),
  }
}
