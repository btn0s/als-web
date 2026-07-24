import { sampleRichCurve } from './richCurve'
import type {
  RichCurveInterpolation,
  RichCurveKey,
} from './richCurve'

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
  arriveTangents?: ArrayLike<number>,
  leaveTangents?: ArrayLike<number>,
): ScalarCurveSampler {
  if (times.length === 0 || times.length !== values.length) {
    throw new Error('Scalar curve times and values must have the same non-zero length')
  }
  for (const [label, valuesValue] of [
    ['interpolation modes', interpolationModes],
    ['arrive tangents', arriveTangents],
    ['leave tangents', leaveTangents],
  ] as const) {
    if (valuesValue && valuesValue.length !== times.length) {
      throw new Error(`Scalar curve ${label} must match the key count`)
    }
  }

  const keys: RichCurveKey[] = []
  for (let index = 0; index < times.length; index++) {
    const mode = interpolationModes?.[index] ?? 0
    let interpolation: RichCurveInterpolation
    switch (mode) {
      case 0:
        interpolation = 'linear'
        break
      case 1:
        interpolation = 'constant'
        break
      case 2:
        interpolation = 'cubic'
        break
      default:
        throw new Error(`Scalar curve key ${index} has unsupported interpolation mode ${mode}`)
    }
    keys.push({
      time: times[index],
      value: values[index],
      interpolation,
      arriveTangent: arriveTangents?.[index] ?? 0,
      leaveTangent: leaveTangents?.[index] ?? 0,
    })
  }
  return (time: number) => sampleRichCurve(keys, time)
}

/**
 * Compiles the GLB animation `extras.alsCurves` sidecar emitted by the ALS extraction pipeline.
 * Each key retains all nine FRichCurveKey fields. ALS 4.15 has no weighted animation-curve keys,
 * so any future weighted key fails compilation instead of taking an approximate cubic path.
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
    const arriveTangents: number[] = []
    const leaveTangents: number[] = []
    for (let index = 0; index < rawCurve.keys.length; index++) {
      const rawKey = rawCurve.keys[index]
      if (!Array.isArray(rawKey) || rawKey.length !== 9) {
        throw new Error(
          `${rawCurve.name} curve key ${index} does not retain all FRichCurveKey fields`,
        )
      }
      const [
        time,
        value,
        interpolationMode,
        tangentMode,
        tangentWeightMode,
        arriveTangent,
        arriveTangentWeight,
        leaveTangent,
        leaveTangentWeight,
      ] = rawKey
      const numericFields = [
        time,
        value,
        interpolationMode,
        tangentMode,
        tangentWeightMode,
        arriveTangent,
        arriveTangentWeight,
        leaveTangent,
        leaveTangentWeight,
      ]
      if (numericFields.some((field) => (
        typeof field !== 'number' || !Number.isFinite(field)
      ))) {
        throw new Error(`${rawCurve.name} curve key ${index} is malformed`)
      }
      if (
        !Number.isInteger(interpolationMode)
        || interpolationMode < 0
        || interpolationMode > 2
        || !Number.isInteger(tangentMode)
        || tangentMode < 0
        || tangentMode > 3
        || !Number.isInteger(tangentWeightMode)
        || tangentWeightMode < 0
        || tangentWeightMode > 3
      ) {
        throw new Error(`${rawCurve.name} curve key ${index} has an invalid UE mode`)
      }
      if (tangentWeightMode !== 0) {
        throw new Error(
          `${rawCurve.name} curve key ${index} uses unsupported weighted tangents`,
        )
      }
      times.push(time)
      values.push(value)
      interpolationModes.push(interpolationMode)
      arriveTangents.push(arriveTangent)
      leaveTangents.push(leaveTangent)
    }
    if (times.length > 0) {
      samplers[rawCurve.name] = createKeyframedScalarCurve(
        times,
        values,
        interpolationModes,
        arriveTangents,
        leaveTangents,
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
