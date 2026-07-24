export type ScalarCurveSampler = (time: number) => number
export type ClipCurveSamplers = Readonly<Record<string, ScalarCurveSampler>>

interface AlsCurveExtras {
  name?: unknown
  keys?: unknown
}

interface ClipWithCurveExtras {
  userData?: {
    alsCurves?: unknown
  }
}

/** Stable per-clip maps; curve values are overwritten instead of allocated each frame. */
export interface CurveFrame {
  readonly byClip: Map<string, Map<string, number>>
  readonly activeClips: Set<string>
}

export function createCurveFrame(): CurveFrame {
  return { byClip: new Map(), activeClips: new Set() }
}

export function beginCurveFrame(frame: CurveFrame) {
  frame.activeClips.clear()
}

export function sampleClipCurves(
  frame: CurveFrame,
  clipKey: string,
  samplers: ClipCurveSamplers,
  time: number,
) {
  let values = frame.byClip.get(clipKey)
  if (!values) {
    values = new Map()
    frame.byClip.set(clipKey, values)
  }
  frame.activeClips.add(clipKey)
  for (const name in samplers) values.set(name, samplers[name](time))
}

/** Binary-searched scalar-curve sampler for sidecar/extras data emitted by the asset pipeline. */
export function createKeyframedScalarCurve(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  interpolationModes?: ArrayLike<number>,
): ScalarCurveSampler {
  if (times.length === 0 || times.length !== values.length) {
    throw new Error('Scalar curve times and values must have the same non-zero length')
  }

  return (time: number) => {
    const last = times.length - 1
    if (time <= times[0]) return values[0]
    if (time >= times[last]) return values[last]
    let low = 0
    let high = last
    while (high - low > 1) {
      const middle = (low + high) >>> 1
      if (times[middle] <= time) low = middle
      else high = middle
    }
    const alpha = (time - times[low]) / (times[high] - times[low])
    const interpolationMode = interpolationModes?.[low] ?? 0
    if (interpolationMode === 1) return values[low]
    // The GLB sidecar retains Unreal's interpolation mode but not RichCurve tangents. ALS's
    // two-key PoseCrouching transitions are auto-tangent cubic ramps, so their recoverable Hermite
    // form is smoothstep (zero slope at both authored endpoints).
    const curveAlpha = interpolationMode === 2
      ? alpha * alpha * (3 - 2 * alpha)
      : alpha
    return values[low] + (values[high] - values[low]) * curveAlpha
  }
}

/**
 * Compiles the GLB animation `extras.alsCurves` sidecar emitted by the ALS extraction pipeline.
 * Keys are `[time, value, interpolationMode]`; mode 0 is linear, mode 1 is constant, and mode 2
 * uses the recoverable tangent-free cubic form documented in `createKeyframedScalarCurve`.
 */
export function compileClipCurveSamplers(clip: ClipWithCurveExtras): ClipCurveSamplers {
  const extras = clip.userData?.alsCurves
  if (!Array.isArray(extras)) return {}

  const samplers: Record<string, ScalarCurveSampler> = {}
  for (const rawCurve of extras as AlsCurveExtras[]) {
    if (typeof rawCurve?.name !== 'string' || !Array.isArray(rawCurve.keys)) continue
    const times: number[] = []
    const values: number[] = []
    const interpolationModes: number[] = []
    for (const rawKey of rawCurve.keys) {
      if (
        Array.isArray(rawKey)
        && typeof rawKey[0] === 'number'
        && typeof rawKey[1] === 'number'
      ) {
        times.push(rawKey[0])
        values.push(rawKey[1])
        interpolationModes.push(
          typeof rawKey[2] === 'number' ? rawKey[2] : 0,
        )
      }
    }
    if (times.length > 0) {
      samplers[rawCurve.name] = createKeyframedScalarCurve(
        times,
        values,
        interpolationModes,
      )
    }
  }
  return samplers
}

export interface WeightedCurveSource {
  clipKey: string
  weight: number
  /** Authored graph value used when this clip does not carry the requested curve. */
  fallback: number
}

export interface AdditiveCurveSource {
  clipKey: string
  weight: number
}

/**
 * Reconstructs the AnimGraph's blended scalar from the per-clip curve seam. Missing curves use
 * their damped graph share's semantic value, matching the approximation called out by the ALS
 * math spec for packs without complete PoseGait coverage.
 */
export function blendCurveValue(
  frame: CurveFrame,
  curveName: string,
  sources: readonly WeightedCurveSource[],
  fallback = 0,
): number {
  let weighted = 0
  let totalWeight = 0
  for (const source of sources) {
    if (source.weight <= 0) continue
    const sampled = frame.byClip.get(source.clipKey)?.get(curveName)
    weighted += (sampled ?? source.fallback) * source.weight
    totalWeight += source.weight
  }
  return totalWeight > Number.EPSILON ? weighted / totalWeight : fallback
}

/**
 * Adds clip-authored curve deltas to an already-resolved graph curve container.
 *
 * Additive sources are deliberately not normalized against one another or against base sources.
 * A missing additive curve is an identity delta of zero, and stale samples from inactive clips are
 * ignored even though `CurveFrame` retains their maps to avoid per-frame allocation.
 */
export function accumulateAdditiveCurveValues(
  frame: CurveFrame,
  output: Map<string, number>,
  sources: readonly AdditiveCurveSource[],
): Map<string, number> {
  for (const source of sources) {
    if (source.weight <= 0 || !frame.activeClips.has(source.clipKey)) continue
    const sampled = frame.byClip.get(source.clipKey)
    if (!sampled) continue
    for (const [name, value] of sampled) {
      output.set(name, (output.get(name) ?? 0) + value * source.weight)
    }
  }
  return output
}
