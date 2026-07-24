import type { AlsQuaternion } from './AlsFeetState'
import type { AlsVector3 } from './AlsLocomotionState'

/**
 * Framework-free counterpart of ALS Refactored's `FAlsMovementBaseState`.
 *
 * `primitive` is the engine adapter's stable identity for the supporting primitive, including a
 * static floor. A base need not use relative movement to remain the current primitive.
 */
export interface AlsMovementBaseState {
  primitive: unknown
  boneName: string
  baseChanged: boolean
  hasRelativeLocation: boolean
  hasRelativeRotation: boolean
  location: AlsVector3
  rotation: AlsQuaternion
  deltaRotation: AlsRotator
}

export interface AlsRotator {
  pitch: number
  yaw: number
  roll: number
}

/**
 * Web-engine counterpart of the `FBasedMovementInfo` fields consumed by
 * `UAlsAnimationInstance::RefreshMovementBaseOnGameThread()`.
 */
export interface AlsBasedMovement {
  primitive: unknown
  boneName: string
  hasRelativeLocation: boolean
  relativeRotation: boolean
  location: Readonly<AlsVector3>
  rotation: Readonly<AlsQuaternion>
}

export const ALS_NO_BASED_MOVEMENT: Readonly<AlsBasedMovement> = {
  primitive: null,
  boneName: '',
  hasRelativeLocation: false,
  relativeRotation: false,
  location: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
}

function normalizeAxisDegrees(value: number): number {
  let normalized = value % 360
  if (normalized < 0) normalized += 360
  if (normalized > 180) normalized -= 360
  return normalized === 0 ? 0 : normalized
}

function quaternionDelta(
  current: Readonly<AlsQuaternion>,
  previous: Readonly<AlsQuaternion>,
): AlsQuaternion {
  const previousSizeSquared = (
    previous.x * previous.x
    + previous.y * previous.y
    + previous.z * previous.z
    + previous.w * previous.w
  )
  if (!(previousSizeSquared > 0) || !Number.isFinite(previousSizeSquared)) {
    return { x: 0, y: 0, z: 0, w: 1 }
  }

  const inverseX = -previous.x / previousSizeSquared
  const inverseY = -previous.y / previousSizeSquared
  const inverseZ = -previous.z / previousSizeSquared
  const inverseW = previous.w / previousSizeSquared
  return {
    x: (
      current.w * inverseX
      + current.x * inverseW
      + current.y * inverseZ
      - current.z * inverseY
    ),
    y: (
      current.w * inverseY
      - current.x * inverseZ
      + current.y * inverseW
      + current.z * inverseX
    ),
    z: (
      current.w * inverseZ
      + current.x * inverseY
      - current.y * inverseX
      + current.z * inverseW
    ),
    w: (
      current.w * inverseW
      - current.x * inverseX
      - current.y * inverseY
      - current.z * inverseZ
    ),
  }
}

/**
 * Unreal `FQuat::Rotator()`, including its singularity branches.
 *
 * ALS currently consumes only Yaw, but the mirrored state owns the complete `FRotator`.
 */
function quaternionToRotator(
  value: Readonly<AlsQuaternion>,
  out: AlsRotator,
): void {
  const size = Math.hypot(value.x, value.y, value.z, value.w)
  if (!(size > 0) || !Number.isFinite(size)) {
    out.pitch = 0
    out.yaw = 0
    out.roll = 0
    return
  }

  const x = value.x / size
  const y = value.y / size
  const z = value.z / size
  const w = value.w / size
  const singularityTest = z * x - w * y
  const yawY = 2 * (w * z + x * y)
  const yawX = 1 - 2 * (y * y + z * z)
  const radiansToDegrees = 180 / Math.PI
  const singularityThreshold = 0.4999995

  if (singularityTest < -singularityThreshold) {
    out.pitch = -90
    out.yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    out.roll = normalizeAxisDegrees(
      -out.yaw - 2 * Math.atan2(x, w) * radiansToDegrees,
    )
  } else if (singularityTest > singularityThreshold) {
    out.pitch = 90
    out.yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    out.roll = normalizeAxisDegrees(
      out.yaw - 2 * Math.atan2(x, w) * radiansToDegrees,
    )
  } else {
    out.pitch = Math.asin(2 * singularityTest) * radiansToDegrees
    out.yaw = Math.atan2(yawY, yawX) * radiansToDegrees
    out.roll = Math.atan2(
      -2 * (w * x + y * z),
      1 - 2 * (x * x + y * y),
    ) * radiansToDegrees
  }
}

/** `FAlsMovementBaseState` field defaults from `State/AlsMovementBaseState.h`. */
export function createAlsMovementBaseState(): AlsMovementBaseState {
  return {
    primitive: null,
    boneName: '',
    baseChanged: false,
    hasRelativeLocation: false,
    hasRelativeRotation: false,
    location: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    deltaRotation: { pitch: 0, yaw: 0, roll: 0 },
  }
}

/**
 * Exact `UAlsAnimationInstance::RefreshMovementBaseOnGameThread()` state transition
 * (`AlsAnimationInstance.cpp:236-262`).
 */
export function refreshMovementBaseOnGameThread(
  state: AlsMovementBaseState,
  basedMovement: Readonly<AlsBasedMovement>,
): AlsMovementBaseState {
  if (
    !Object.is(basedMovement.primitive, state.primitive)
    || basedMovement.boneName !== state.boneName
  ) {
    state.primitive = basedMovement.primitive
    state.boneName = basedMovement.boneName
    state.baseChanged = true
  } else {
    state.baseChanged = false
  }

  state.hasRelativeLocation = basedMovement.hasRelativeLocation
  state.hasRelativeRotation =
    state.hasRelativeLocation && basedMovement.relativeRotation

  const previousRotation = {
    x: state.rotation.x,
    y: state.rotation.y,
    z: state.rotation.z,
    w: state.rotation.w,
  }
  state.location.x = basedMovement.location.x
  state.location.y = basedMovement.location.y
  state.location.z = basedMovement.location.z
  state.rotation.x = basedMovement.rotation.x
  state.rotation.y = basedMovement.rotation.y
  state.rotation.z = basedMovement.rotation.z
  state.rotation.w = basedMovement.rotation.w

  if (state.hasRelativeLocation && !state.baseChanged) {
    quaternionToRotator(
      quaternionDelta(state.rotation, previousRotation),
      state.deltaRotation,
    )
  } else {
    state.deltaRotation.pitch = 0
    state.deltaRotation.yaw = 0
    state.deltaRotation.roll = 0
  }

  return state
}
