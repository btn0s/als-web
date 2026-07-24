export interface AlsRotateInPlaceSettings {
  readonly viewYawAngleThreshold: number
  readonly referenceViewYawSpeed: readonly [number, number]
  readonly playRate: readonly [number, number]
  readonly playRateInterpolationSpeed: number
  readonly blendDuration: number
}

/** Defaults from AlsRotateInPlaceSettings.h and RefreshRotateInPlace(). */
export const ALS_ROTATE_IN_PLACE_SETTINGS: AlsRotateInPlaceSettings = {
  viewYawAngleThreshold: 50,
  referenceViewYawSpeed: [180, 460],
  playRate: [1.15, 3],
  playRateInterpolationSpeed: 5,
  blendDuration: 0.2,
}

export function mapRotateInPlacePlayRate(
  viewYawSpeed: number,
  settings: AlsRotateInPlaceSettings = ALS_ROTATE_IN_PLACE_SETTINGS,
): number {
  const [minimumSpeed, maximumSpeed] = settings.referenceViewYawSpeed
  const alpha = Math.max(0, Math.min(
    1,
    (viewYawSpeed - minimumSpeed) / (maximumSpeed - minimumSpeed),
  ))
  const [minimumRate, maximumRate] = settings.playRate
  return minimumRate + (maximumRate - minimumRate) * alpha
}
