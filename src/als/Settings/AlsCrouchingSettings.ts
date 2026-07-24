import { ALS_STANDING_SETTINGS } from './AlsStandingSettings'

/** FAlsCrouchingSettings defaults and AIS_Als_Default's shared walk stride curve. */
export const ALS_CROUCHING_SETTINGS = {
  animatedCrouchSpeed: 150,
  strideBlendAmountCurve: ALS_STANDING_SETTINGS.strideBlendAmountWalkCurve,
} as const
