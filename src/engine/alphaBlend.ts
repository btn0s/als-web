export type AlphaBlendOption =
  | 'Linear'
  | 'Cubic'
  | 'HermiteCubic'
  | 'QuadraticInOut'

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * The FAlphaBlend options currently authored by ALS's state machines.
 *
 * Unreal's `Cubic` calls `FMath::CubicInterp(0, 0, 1, 0, Alpha)`, while
 * `HermiteCubic` calls `FMath::SmoothStep(0, 1, Alpha)`. Those two expressions are
 * numerically the same smoothstep polynomial for these endpoint values.
 */
export function alphaToBlendOption(
  alpha: number,
  option: AlphaBlendOption,
): number {
  const value = clamp01(alpha)

  switch (option) {
    case 'Linear':
      return value
    case 'Cubic':
    case 'HermiteCubic':
      return value * value * (3 - 2 * value)
    case 'QuadraticInOut':
      return value < 0.5
        ? 2 * value * value
        : -2 * value * value + 4 * value - 1
  }
}
