export type ScalarCurveSampler = (time: number) => number
export type ClipCurveSamplers = Readonly<Record<string, ScalarCurveSampler>>

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

/** Binary-searched linear curve sampler for sidecar/extras data emitted by the asset pipeline. */
export function createKeyframedScalarCurve(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
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
    return values[low] + (values[high] - values[low]) * alpha
  }
}
