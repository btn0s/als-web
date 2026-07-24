import type { LocalPoseBuffer } from './poseBuffer'
import { copyPose, createPoseBuffer } from './poseBuffer'

const EPSILON = 1e-8

interface InertialVector {
  readonly directions: Float32Array
  readonly magnitudes: Float32Array
  readonly speeds: Float32Array
}

export interface Inertialization {
  readonly boneCount: number
  readonly translation: InertialVector
  readonly rotation: InertialVector
  readonly scale: InertialVector
  readonly previousPose: LocalPoseBuffer
  readonly olderPose: LocalPoseBuffer
  previousDeltaTime: number
  historyCount: number
  duration: number
  elapsed: number
  active: boolean
  pendingDuration: number | null
  requestCount: number
  requestInertialization: (duration: number) => void
}

function createInertialVector(boneCount: number): InertialVector {
  return {
    directions: new Float32Array(boneCount * 3),
    magnitudes: new Float32Array(boneCount),
    speeds: new Float32Array(boneCount),
  }
}

/**
 * UE request behavior: requests are gathered before evaluation; multiple requests handled by the
 * same node in one update use the shortest requested blend. A request during an active transition
 * is captured again from the last output pose, preserving continuity while restarting the timer.
 *
 * Epic API: FAnimNode_Inertialization / FInertializationRequest
 * https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/FAnimNode_Inertialization
 */
export function createInertialization(boneCount: number): Inertialization {
  const state: Inertialization = {
    boneCount,
    translation: createInertialVector(boneCount),
    rotation: createInertialVector(boneCount),
    scale: createInertialVector(boneCount),
    previousPose: createPoseBuffer(boneCount),
    olderPose: createPoseBuffer(boneCount),
    previousDeltaTime: 0,
    historyCount: 0,
    duration: 0,
    elapsed: 0,
    active: false,
    pendingDuration: null,
    requestCount: 0,
    requestInertialization(duration: number) {
      state.requestCount++
      const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0
      state.pendingDuration = state.pendingDuration === null
        ? safeDuration
        : Math.min(state.pendingDuration, safeDuration)
    },
  }
  return state
}

/**
 * UE's CalcInertialFloat is a quintic that starts at the captured difference and velocity and
 * reaches zero value, velocity, and acceleration at the request duration. This is the equivalent
 * quintic Hermite form with zero initial acceleration:
 *
 *   x(s) = x0(1 - 10s³ + 15s⁴ - 6s⁵)
 *        + v0T(s - 6s³ + 8s⁴ - 3s⁵),  s = clamp(t / T, 0, 1)
 *
 * Positive velocity is discarded and negative velocity is bounded to -2.5x0/T. That bound follows
 * directly from the two basis functions and makes the critically damped-style decay monotone and
 * non-overshooting while retaining incoming momentum. At s=1 the correction and its first two
 * derivatives are exactly zero.
 *
 * Epic describes the stored per-bone translation/rotation difference, speed, elapsed time, and
 * duration on FAnimNode_Inertialization:
 * https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/FAnimNode_Inertialization
 */
export function evaluateInertialDecay(
  initialDifference: number,
  initialSpeed: number,
  elapsed: number,
  duration: number,
): number {
  const x0 = Math.max(0, initialDifference)
  if (x0 <= EPSILON || duration <= 0 || elapsed >= duration) return 0
  const s = Math.max(0, elapsed) / duration
  const s2 = s * s
  const s3 = s2 * s
  const s4 = s3 * s
  const s5 = s4 * s
  const positionBasis = 1 - 10 * s3 + 15 * s4 - 6 * s5
  const velocityBasis = s - 6 * s3 + 8 * s4 - 3 * s5
  const speed = Math.max(-2.5 * x0 / duration, Math.min(0, initialSpeed))
  return Math.max(0, x0 * positionBasis + speed * duration * velocityBasis)
}

function captureVectorDifference(
  target: InertialVector,
  outgoing: Float32Array,
  incoming: Float32Array,
  older: Float32Array | undefined,
  deltaTime: number,
) {
  for (let bone = 0; bone < target.magnitudes.length; bone++) {
    const offset = bone * 3
    const x = outgoing[offset] - incoming[offset]
    const y = outgoing[offset + 1] - incoming[offset + 1]
    const z = outgoing[offset + 2] - incoming[offset + 2]
    const magnitude = Math.hypot(x, y, z)
    target.magnitudes[bone] = magnitude
    if (magnitude <= EPSILON) {
      target.directions[offset] = 0
      target.directions[offset + 1] = 0
      target.directions[offset + 2] = 0
      target.speeds[bone] = 0
      continue
    }

    const inverseMagnitude = 1 / magnitude
    const dx = x * inverseMagnitude
    const dy = y * inverseMagnitude
    const dz = z * inverseMagnitude
    target.directions[offset] = dx
    target.directions[offset + 1] = dy
    target.directions[offset + 2] = dz
    target.speeds[bone] = older && deltaTime > EPSILON
      ? (
          (outgoing[offset] - older[offset]) * dx
          + (outgoing[offset + 1] - older[offset + 1]) * dy
          + (outgoing[offset + 2] - older[offset + 2]) * dz
        ) / deltaTime
      : 0
  }
}

function quaternionDifference(
  outgoing: Float32Array,
  outgoingOffset: number,
  incoming: Float32Array,
  incomingOffset: number,
) {
  const ax = outgoing[outgoingOffset]
  const ay = outgoing[outgoingOffset + 1]
  const az = outgoing[outgoingOffset + 2]
  const aw = outgoing[outgoingOffset + 3]
  const bx = -incoming[incomingOffset]
  const by = -incoming[incomingOffset + 1]
  const bz = -incoming[incomingOffset + 2]
  const bw = incoming[incomingOffset + 3]
  let x = aw * bx + ax * bw + ay * bz - az * by
  let y = aw * by - ax * bz + ay * bw + az * bx
  let z = aw * bz + ax * by - ay * bx + az * bw
  let w = aw * bw - ax * bx - ay * by - az * bz
  if (w < 0) {
    x = -x
    y = -y
    z = -z
    w = -w
  }
  const inverseLength = 1 / Math.max(EPSILON, Math.hypot(x, y, z, w))
  return [x * inverseLength, y * inverseLength, z * inverseLength, w * inverseLength] as const
}

function quaternionToAxisAngle(
  quaternion: readonly [number, number, number, number],
) {
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, quaternion[3])))
  const sine = Math.sqrt(Math.max(0, 1 - quaternion[3] * quaternion[3]))
  if (angle <= EPSILON || sine <= EPSILON) return [1, 0, 0, 0] as const
  return [
    quaternion[0] / sine,
    quaternion[1] / sine,
    quaternion[2] / sine,
    angle,
  ] as const
}

function captureRotationDifference(
  target: InertialVector,
  outgoing: Float32Array,
  incoming: Float32Array,
  older: Float32Array | undefined,
  deltaTime: number,
) {
  for (let bone = 0; bone < target.magnitudes.length; bone++) {
    const q = bone * 4
    const directionOffset = bone * 3
    const [x, y, z, angle] = quaternionToAxisAngle(
      quaternionDifference(outgoing, q, incoming, q),
    )
    target.directions[directionOffset] = x
    target.directions[directionOffset + 1] = y
    target.directions[directionOffset + 2] = z
    target.magnitudes[bone] = angle

    if (!older || deltaTime <= EPSILON) {
      target.speeds[bone] = 0
      continue
    }
    const [vx, vy, vz, velocityAngle] = quaternionToAxisAngle(
      quaternionDifference(outgoing, q, older, q),
    )
    target.speeds[bone] = velocityAngle
      * (vx * x + vy * y + vz * z)
      / deltaTime
  }
}

function capture(
  state: Inertialization,
  incoming: LocalPoseBuffer,
  duration: number,
) {
  const older = state.historyCount > 1 ? state.olderPose : undefined
  captureVectorDifference(
    state.translation,
    state.previousPose.positions,
    incoming.positions,
    older?.positions,
    state.previousDeltaTime,
  )
  captureRotationDifference(
    state.rotation,
    state.previousPose.rotations,
    incoming.rotations,
    older?.rotations,
    state.previousDeltaTime,
  )
  captureVectorDifference(
    state.scale,
    state.previousPose.scales,
    incoming.scales,
    older?.scales,
    state.previousDeltaTime,
  )
  state.duration = duration
  state.elapsed = 0
  state.active = duration > 0
}

function applyVectorCorrection(
  values: Float32Array,
  correction: InertialVector,
  elapsed: number,
  duration: number,
) {
  for (let bone = 0; bone < correction.magnitudes.length; bone++) {
    const magnitude = evaluateInertialDecay(
      correction.magnitudes[bone],
      correction.speeds[bone],
      elapsed,
      duration,
    )
    if (magnitude <= 0) continue
    const offset = bone * 3
    values[offset] += correction.directions[offset] * magnitude
    values[offset + 1] += correction.directions[offset + 1] * magnitude
    values[offset + 2] += correction.directions[offset + 2] * magnitude
  }
}

function applyRotationCorrection(
  rotations: Float32Array,
  correction: InertialVector,
  elapsed: number,
  duration: number,
) {
  for (let bone = 0; bone < correction.magnitudes.length; bone++) {
    const angle = evaluateInertialDecay(
      correction.magnitudes[bone],
      correction.speeds[bone],
      elapsed,
      duration,
    )
    if (angle <= 0) continue
    const directionOffset = bone * 3
    const q = bone * 4
    const halfAngle = angle * 0.5
    const sine = Math.sin(halfAngle)
    const ax = correction.directions[directionOffset] * sine
    const ay = correction.directions[directionOffset + 1] * sine
    const az = correction.directions[directionOffset + 2] * sine
    const aw = Math.cos(halfAngle)
    const bx = rotations[q]
    const by = rotations[q + 1]
    const bz = rotations[q + 2]
    const bw = rotations[q + 3]
    rotations[q] = aw * bx + ax * bw + ay * bz - az * by
    rotations[q + 1] = aw * by - ax * bz + ay * bw + az * bx
    rotations[q + 2] = aw * bz + ax * by - ay * bx + az * bw
    rotations[q + 3] = aw * bw - ax * bx - ay * by - az * bz
  }
}

/**
 * Applies the captured difference after normal graph blending, then records the final output for
 * the next request. The request frame evaluates at t=0, so the outgoing pose is reproduced exactly.
 */
export function applyInertialization(
  state: Inertialization,
  pose: LocalPoseBuffer,
  deltaTime: number,
): LocalPoseBuffer {
  if (pose.boneCount !== state.boneCount) {
    throw new Error('Inertialization pose has an incompatible bone count')
  }

  const pendingDuration = state.pendingDuration
  state.pendingDuration = null
  const captured = pendingDuration !== null && state.historyCount > 0
  if (captured) {
    capture(state, pose, pendingDuration)
  } else if (pendingDuration !== null) {
    state.active = false
  } else if (state.active) {
    state.elapsed = Math.min(
      state.duration,
      state.elapsed + Math.max(0, deltaTime),
    )
  }

  if (state.active) {
    applyVectorCorrection(
      pose.positions,
      state.translation,
      state.elapsed,
      state.duration,
    )
    applyRotationCorrection(
      pose.rotations,
      state.rotation,
      state.elapsed,
      state.duration,
    )
    applyVectorCorrection(
      pose.scales,
      state.scale,
      state.elapsed,
      state.duration,
    )
    if (state.elapsed >= state.duration) state.active = false
  }

  copyPose(state.previousPose, state.olderPose)
  copyPose(pose, state.previousPose)
  state.previousDeltaTime = Math.max(0, deltaTime)
  state.historyCount = Math.min(2, state.historyCount + 1)
  return pose
}

/** Maximum currently applicable per-bone correction, exposed for runtime diagnostics and tests. */
export function measureInertializationCorrectionMagnitude(
  state: Inertialization,
): number {
  if (!state.active) return 0
  let maximum = 0
  for (const vector of [state.translation, state.rotation, state.scale]) {
    for (let bone = 0; bone < state.boneCount; bone++) {
      maximum = Math.max(
        maximum,
        evaluateInertialDecay(
          vector.magnitudes[bone],
          vector.speeds[bone],
          state.elapsed,
          state.duration,
        ),
      )
    }
  }
  return maximum
}
