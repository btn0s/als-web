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
 * `Cubic` is Unreal's cubic-in option, not smoothstep; the latter is the separate
 * `HermiteCubic` option used by ALS's Idle/Move transitions.
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
      return value * value * value
    case 'HermiteCubic':
      return value * value * (3 - 2 * value)
    case 'QuadraticInOut':
      return value < 0.5
        ? 2 * value * value
        : -2 * value * value + 4 * value - 1
  }
}
