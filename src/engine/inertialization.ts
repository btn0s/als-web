import type { LocalPoseBuffer } from './poseBuffer'
import { copyPose, createPoseBuffer } from './poseBuffer'

const EPSILON = 1e-8
const INERTIALIZATION_TIME_EPSILON = 1e-7
const KINDA_SMALL_NUMBER = 1e-4

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
  deficit: number
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
 * captures again from the last output pose, while consecutive interruptions pay down UE's time
 * deficit so an unstable target cannot hold the pose in a perpetual transition.
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
    deficit: 0,
    active: false,
    pendingDuration: null,
    requestCount: 0,
    requestInertialization(duration: number) {
      if (!Number.isFinite(duration) || duration < 0) return
      state.requestCount++
      state.pendingDuration = state.pendingDuration === null
        ? duration
        : Math.min(state.pendingDuration, duration)
    },
  }
  return state
}

/**
 * Direct port of UE's `CalcInertialFloat`: a quintic that reaches zero value, velocity, and
 * acceleration at the request duration. Initial acceleration is normally zero, but UE raises it
 * when needed to preserve a large incoming velocity without overshoot. Extremely large negative
 * velocity shortens the effective duration instead of clamping away that momentum.
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
  if (
    !Number.isFinite(initialDifference)
    || !Number.isFinite(initialSpeed)
    || !Number.isFinite(elapsed)
    || !Number.isFinite(duration)
  ) return 0

  let x0 = initialDifference
  let v0 = initialSpeed
  const t = Math.max(0, elapsed)
  let t1 = duration
  if (t >= t1 - INERTIALIZATION_TIME_EPSILON) return 0

  let sign = 1
  if (x0 < 0) {
    x0 = -x0
    v0 = -v0
    sign = -1
  }
  if (v0 > 0) v0 = 0
  if (x0 < 0 || v0 > 0 || t1 < 0) return 0

  // A quadruple velocity root at the shortened end time is the limiting non-overshooting curve.
  if (v0 < -KINDA_SMALL_NUMBER) t1 = Math.min(t1, -5 * x0 / v0)
  if (t >= t1 - INERTIALIZATION_TIME_EPSILON) return 0

  const t1Squared = t1 * t1
  const t1Cubed = t1 * t1Squared
  const t1Fourth = t1 * t1Cubed
  const t1Fifth = t1 * t1Fourth
  const a0 = Math.max(0, (-8 * t1 * v0 - 20 * x0) / t1Squared)
  const a = -0.5 * (a0 * t1Squared + 6 * t1 * v0 + 12 * x0) / t1Fifth
  const b = 0.5 * (3 * a0 * t1Squared + 16 * t1 * v0 + 30 * x0) / t1Fourth
  const c = -0.5 * (3 * a0 * t1Squared + 12 * t1 * v0 + 20 * x0) / t1Cubed
  const d = 0.5 * a0
  const x = ((((a * t + b) * t + c) * t + d) * t + v0) * t + x0
  return x * sign
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
    if (magnitude <= KINDA_SMALL_NUMBER) {
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
    target.speeds[bone] = older && deltaTime > KINDA_SMALL_NUMBER
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

    if (
      angle <= KINDA_SMALL_NUMBER
      || !older
      || deltaTime <= KINDA_SMALL_NUMBER
    ) {
      target.speeds[bone] = 0
      continue
    }
    const previousDifference = quaternionDifference(older, q, incoming, q)
    const previousTwistAngle = unwindRadians(
      2 * Math.atan2(
        previousDifference[0] * x
          + previousDifference[1] * y
          + previousDifference[2] * z,
        previousDifference[3],
      ),
    )
    target.speeds[bone] = unwindRadians(angle - previousTwistAngle) / deltaTime
  }
}

function unwindRadians(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
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
  if (!state.active) state.deficit = 0
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
    const inverseLength = 1 / Math.max(
      EPSILON,
      Math.hypot(
        rotations[q],
        rotations[q + 1],
        rotations[q + 2],
        rotations[q + 3],
      ),
    )
    rotations[q] *= inverseLength
    rotations[q + 1] *= inverseLength
    rotations[q + 2] *= inverseLength
    rotations[q + 3] *= inverseLength
  }
}

/**
 * Applies the captured difference after normal graph blending, then records the final output for
 * the next request. Like UE's evaluation pass, the current update delta is consumed before the
 * correction is applied, including on the request frame.
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
  const safeDeltaTime = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
  const captured = pendingDuration !== null && state.historyCount > 0
  if (captured) {
    let appliedDeficit = 0
    if (state.active) {
      const applyDeficit = state.deficit > 0
      state.deficit = Math.max(0, state.duration - state.elapsed)
      if (applyDeficit) appliedDeficit = state.deficit
    } else {
      state.deficit = 0
    }
    capture(state, pose, Math.max(0, pendingDuration - appliedDeficit))
  }

  if (state.active) {
    state.elapsed = Math.min(state.duration, state.elapsed + safeDeltaTime)
    if (state.elapsed >= state.duration) {
      state.active = false
      state.duration = 0
      state.elapsed = 0
      state.deficit = 0
    } else {
      state.deficit -= Math.min(state.deficit, safeDeltaTime)
    }
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
  }

  copyPose(state.previousPose, state.olderPose)
  copyPose(pose, state.previousPose)
  state.previousDeltaTime = safeDeltaTime
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
