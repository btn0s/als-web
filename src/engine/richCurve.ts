export type RichCurveInterpolation = 'constant' | 'linear' | 'cubic'

export interface RichCurveKey {
  readonly time: number
  readonly value: number
  readonly interpolation: RichCurveInterpolation
  readonly arriveTangent?: number
  readonly leaveTangent?: number
}

/**
 * Samples Unreal's unweighted FRichCurve segments. ALS's movement data uses constant, linear, and
 * cubic keys with RCTWM_WeightedNone, so the cubic path is the same Hermite interpolation used by
 * FMath::CubicInterp after scaling tangents by the segment duration.
 */
export function sampleRichCurve(
  keys: readonly RichCurveKey[],
  time: number,
): number {
  if (keys.length === 0) return 0
  if (keys.length === 1 || time <= keys[0].time) return keys[0].value
  const last = keys[keys.length - 1]
  if (time >= last.time) return last.value

  let low = 0
  let high = keys.length - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (keys[middle].time <= time) low = middle
    else high = middle
  }

  const from = keys[low]
  const to = keys[high]
  if (from.interpolation === 'constant') return from.value

  const duration = to.time - from.time
  if (duration <= 0) return from.value
  const alpha = (time - from.time) / duration
  if (from.interpolation === 'linear') {
    return from.value + (to.value - from.value) * alpha
  }

  const alphaSquared = alpha * alpha
  const alphaCubed = alphaSquared * alpha
  const fromTangent = (from.leaveTangent ?? 0) * duration
  const toTangent = (to.arriveTangent ?? 0) * duration
  return (
    (2 * alphaCubed - 3 * alphaSquared + 1) * from.value
    + (alphaCubed - 2 * alphaSquared + alpha) * fromTangent
    + (-2 * alphaCubed + 3 * alphaSquared) * to.value
    + (alphaCubed - alphaSquared) * toTangent
  )
}
