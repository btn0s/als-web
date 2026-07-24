import type { CurveFrame } from './curves'
import type { Inertialization } from './inertialization'
import { evaluateInertialDecay } from './inertialization'
import type { RootMotionDelta } from './rootMotion'

const KINDA_SMALL_NUMBER = 1e-4
const QUATERNION_EPSILON = 1e-8

interface CurveDifference {
  delta: number
  derivative: number
}

interface RootMotionVelocityDifference {
  readonly translationDirection: Float32Array
  translationMagnitude: number
  readonly rotationDirection: Float32Array
  rotationMagnitude: number
}

/**
 * UE's inertialization node consumes one already-blended curve container. The evaluator keeps
 * per-clip samples for graph-specific fallback rules, so the graph resolves those samples into
 * this final container before the downstream inertialization pass.
 */
export interface BlendedCurveFrame extends CurveFrame {
  readonly values: Map<string, number>
}

export type ResolveBlendedCurves = (
  samples: CurveFrame,
  output: Map<string, number>,
) => void

export interface OutputInertialization {
  readonly previousCurves: Map<string, number>
  readonly olderCurves: Map<string, number>
  readonly curveDifferences: Map<string, CurveDifference>
  readonly previousRootMotionTranslation: Float32Array
  readonly previousRootMotionRotation: Float32Array
  readonly rootMotionVelocityDifference: RootMotionVelocityDifference
  previousRootMotionValid: boolean
  previousDeltaTime: number
  historyCount: number
  captureRequested: boolean
}

export function createBlendedCurveFrame(frame: CurveFrame): BlendedCurveFrame {
  return {
    byClip: frame.byClip,
    activeClips: frame.activeClips,
    values: new Map(),
  }
}

export function createOutputInertialization(): OutputInertialization {
  return {
    previousCurves: new Map(),
    olderCurves: new Map(),
    curveDifferences: new Map(),
    previousRootMotionTranslation: new Float32Array(3),
    previousRootMotionRotation: new Float32Array([0, 0, 0, 1]),
    rootMotionVelocityDifference: {
      translationDirection: new Float32Array(3),
      translationMagnitude: 0,
      rotationDirection: new Float32Array(3),
      rotationMagnitude: 0,
    },
    previousRootMotionValid: false,
    previousDeltaTime: 0,
    historyCount: 0,
    captureRequested: false,
  }
}

/**
 * Must run before the pose pass consumes its pending request. A request without pose history is
 * discarded by UE and by `applyInertialization`, so output channels must make the same decision.
 */
export function prepareOutputInertialization(
  output: OutputInertialization,
  pose: Inertialization,
) {
  output.captureRequested = pose.pendingDuration !== null && pose.historyCount > 0
}

function captureCurveDifferences(
  output: OutputInertialization,
  incoming: ReadonlyMap<string, number>,
) {
  output.curveDifferences.clear()
  const names = new Set([
    ...incoming.keys(),
    ...output.previousCurves.keys(),
    ...output.olderCurves.keys(),
  ])

  for (const name of names) {
    const incomingValue = incoming.get(name) ?? 0
    const delta = (output.previousCurves.get(name) ?? 0) - incomingValue
    // This is the literal FAnimNode_Inertialization::InitFrom curve derivative. The inherited
    // FCurveElement value remains the incoming destination value while Delta stores Prev1 -
    // incoming; missing named values participate as zero through FNamedValueArrayUtils::Union.
    const derivative = output.historyCount > 1
      && output.previousDeltaTime > KINDA_SMALL_NUMBER
      ? (
          delta
          - incomingValue
          - (output.olderCurves.get(name) ?? 0)
        ) / output.previousDeltaTime
      : 0
    output.curveDifferences.set(name, {
      delta,
      derivative,
    })
  }
}

function normalizeQuaternion(rotation: Float32Array) {
  const inverseLength = 1 / Math.max(
    QUATERNION_EPSILON,
    Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]),
  )
  rotation[0] *= inverseLength
  rotation[1] *= inverseLength
  rotation[2] *= inverseLength
  rotation[3] *= inverseLength
}

/** Equivalent to UE's normalized `FQuat::ToRotationVector` (2 * quaternion logarithm). */
function quaternionToRotationVector(
  rotation: Float32Array,
  output: Float32Array,
) {
  const length = Math.max(
    QUATERNION_EPSILON,
    Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]),
  )
  const x = rotation[0] / length
  const y = rotation[1] / length
  const z = rotation[2] / length
  const w = Math.max(-1, Math.min(1, rotation[3] / length))
  const vectorLength = Math.hypot(x, y, z)
  if (vectorLength <= QUATERNION_EPSILON) {
    output.fill(0)
    return
  }
  const scale = 2 * Math.acos(w) / vectorLength
  output[0] = x * scale
  output[1] = y * scale
  output[2] = z * scale
}

function captureVelocityDifference(
  direction: Float32Array,
  previous: ArrayLike<number>,
  incoming: ArrayLike<number>,
  previousDeltaTime: number,
  deltaTime: number,
) {
  let x = previous[0] / previousDeltaTime - incoming[0] / deltaTime
  let y = previous[1] / previousDeltaTime - incoming[1] / deltaTime
  let z = previous[2] / previousDeltaTime - incoming[2] / deltaTime
  const magnitude = Math.hypot(x, y, z)
  if (magnitude <= KINDA_SMALL_NUMBER) {
    direction.fill(0)
    return 0
  }
  x /= magnitude
  y /= magnitude
  z /= magnitude
  direction[0] = x
  direction[1] = y
  direction[2] = z
  return magnitude
}

function captureRootMotionVelocityDifference(
  output: OutputInertialization,
  incoming: RootMotionDelta | undefined,
  deltaTime: number,
) {
  const difference = output.rootMotionVelocityDifference
  difference.translationDirection.fill(0)
  difference.translationMagnitude = 0
  difference.rotationDirection.fill(0)
  difference.rotationMagnitude = 0

  if (
    !incoming?.valid
    || !output.previousRootMotionValid
    || output.previousDeltaTime <= KINDA_SMALL_NUMBER
    || deltaTime <= KINDA_SMALL_NUMBER
  ) return

  difference.translationMagnitude = captureVelocityDifference(
    difference.translationDirection,
    output.previousRootMotionTranslation,
    incoming.translation,
    output.previousDeltaTime,
    deltaTime,
  )

  // Root-motion acceleration is deliberately not retained, and capture only happens on a
  // request, so these short-lived vectors avoid a shared mutable scratch cache between rigs.
  const previousRotationVector = new Float32Array(3)
  const incomingRotationVector = new Float32Array(3)
  quaternionToRotationVector(
    output.previousRootMotionRotation,
    previousRotationVector,
  )
  quaternionToRotationVector(incoming.rotation, incomingRotationVector)
  difference.rotationMagnitude = captureVelocityDifference(
    difference.rotationDirection,
    previousRotationVector,
    incomingRotationVector,
    output.previousDeltaTime,
    deltaTime,
  )
}

function applyCurveDifferences(
  output: OutputInertialization,
  curves: Map<string, number>,
  pose: Inertialization,
) {
  for (const [name, difference] of output.curveDifferences) {
    const destination = curves.get(name) ?? 0
    curves.set(
      name,
      destination + evaluateInertialDecay(
        difference.delta,
        difference.derivative,
        pose.elapsed,
        pose.duration,
      ),
    )
  }
}

function multiplyRotationLeft(
  rotation: Float32Array,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  const bx = rotation[0]
  const by = rotation[1]
  const bz = rotation[2]
  const bw = rotation[3]
  rotation[0] = w * bx + x * bw + y * bz - z * by
  rotation[1] = w * by - x * bz + y * bw + z * bx
  rotation[2] = w * bz + x * by - y * bx + z * bw
  rotation[3] = w * bw - x * bx - y * by - z * bz
  normalizeQuaternion(rotation)
}

function applyRootMotionVelocityDifference(
  output: OutputInertialization,
  rootMotion: RootMotionDelta | undefined,
  deltaTime: number,
  pose: Inertialization,
) {
  if (!rootMotion?.valid) return
  const difference = output.rootMotionVelocityDifference
  const translationVelocity = evaluateInertialDecay(
    difference.translationMagnitude,
    0,
    pose.elapsed,
    pose.duration,
  )
  rootMotion.translation[0] +=
    deltaTime * difference.translationDirection[0] * translationVelocity
  rootMotion.translation[1] +=
    deltaTime * difference.translationDirection[1] * translationVelocity
  rootMotion.translation[2] +=
    deltaTime * difference.translationDirection[2] * translationVelocity

  const rotationVelocity = evaluateInertialDecay(
    difference.rotationMagnitude,
    0,
    pose.elapsed,
    pose.duration,
  )
  const x = deltaTime * difference.rotationDirection[0] * rotationVelocity
  const y = deltaTime * difference.rotationDirection[1] * rotationVelocity
  const z = deltaTime * difference.rotationDirection[2] * rotationVelocity
  const angle = Math.hypot(x, y, z)
  if (angle > QUATERNION_EPSILON) {
    const sine = Math.sin(angle * 0.5) / angle
    multiplyRotationLeft(
      rootMotion.rotation,
      x * sine,
      y * sine,
      z * sine,
      Math.cos(angle * 0.5),
    )
  }
}

function copyCurveSnapshot(
  source: ReadonlyMap<string, number>,
  destination: Map<string, number>,
) {
  destination.clear()
  for (const [name, value] of source) destination.set(name, value)
}

function recordOutput(
  output: OutputInertialization,
  curves: ReadonlyMap<string, number>,
  rootMotion: RootMotionDelta | undefined,
  deltaTime: number,
) {
  copyCurveSnapshot(output.previousCurves, output.olderCurves)
  copyCurveSnapshot(curves, output.previousCurves)
  output.previousRootMotionValid = rootMotion?.valid ?? false
  if (rootMotion?.valid) {
    output.previousRootMotionTranslation.set(rootMotion.translation)
    output.previousRootMotionRotation.set(rootMotion.rotation)
  }
  output.previousDeltaTime = deltaTime
  output.historyCount = Math.min(2, output.historyCount + 1)
}

/**
 * Ports the non-pose half of UE's downstream `FAnimNode_Inertialization`.
 *
 * Curve offsets use the node's main duration. Root motion uses the root-bone duration, which is
 * the same main duration in ALS because its ABPs have no inertialization blend profiles. UE
 * intentionally stores only the root-motion velocity difference and evaluates it with zero
 * acceleration/derivative because acceleration noise produces unstable offsets.
 */
export function applyOutputInertialization(
  output: OutputInertialization,
  curves: Map<string, number>,
  rootMotion: RootMotionDelta | undefined,
  deltaTime: number,
  pose: Inertialization,
) {
  const safeDeltaTime = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
  if (output.captureRequested && output.historyCount > 0) {
    captureCurveDifferences(output, curves)
    captureRootMotionVelocityDifference(output, rootMotion, safeDeltaTime)
  }
  output.captureRequested = false

  if (pose.active) {
    applyCurveDifferences(output, curves, pose)
    applyRootMotionVelocityDifference(output, rootMotion, safeDeltaTime, pose)
  }

  recordOutput(output, curves, rootMotion, safeDeltaTime)
}
