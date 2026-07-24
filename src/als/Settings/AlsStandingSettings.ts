import type { RichCurveKey } from '../../engine/richCurve'

/**
 * FAlsStandingSettings defaults plus AIS_Als_Default's referenced stride curves. Speeds stay in
 * Unreal's native cm/s because the curve keys are authored in cm/s too.
 */
export const ALS_STANDING_SETTINGS = {
  animatedWalkSpeed: 150,
  animatedRunSpeed: 350,
  animatedSprintSpeed: 600,
  pivotActivationSpeedThreshold: 200,
  strideBlendAmountWalkCurve: [
    {
      time: 0,
      value: 0.2,
      interpolation: 'cubic',
      leaveTangent: 0,
    },
    {
      time: 58.3,
      value: 0.54999995,
      interpolation: 'cubic',
      arriveTangent: 0.012879322,
      leaveTangent: 0.012879322,
    },
    {
      time: 150,
      value: 1,
      interpolation: 'linear',
      arriveTangent: 0,
    },
  ] satisfies readonly RichCurveKey[],
  strideBlendAmountRunCurve: [
    {
      time: 0,
      value: 0.2,
      interpolation: 'cubic',
      leaveTangent: 0,
    },
    {
      time: 166.9,
      value: 0.45000002,
      interpolation: 'cubic',
      arriveTangent: 0.0033657213,
      leaveTangent: 0.0033657213,
    },
    {
      time: 350,
      value: 1,
      interpolation: 'linear',
      arriveTangent: 0,
    },
  ] satisfies readonly RichCurveKey[],
} as const
