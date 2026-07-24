/**
 * FAlsGeneralAnimationSettings defaults. Linear speed values are converted from UE centimetres
 * per second to the web boundary's metres per second.
 */
export const ALS_GENERAL_ANIMATION_SETTINGS = {
  useHandIkBones: true,
  useFootIkBones: true,
  movingSmoothSpeedThreshold: 1.5,
  leanInterpolationSpeed: 4,
} as const

export function calculateMovingSmooth(input: {
  readonly hasInput: boolean
  readonly hasVelocity: boolean
  readonly speed: number
}) {
  return (
    (input.hasInput && input.hasVelocity)
    || input.speed > ALS_GENERAL_ANIMATION_SETTINGS.movingSmoothSpeedThreshold
  )
}
