/**
 * Framework-free counterpart of ALS Refactored's FAlsLocomotionState.
 *
 * Linear values use metres / metres-per-second at the web boundary. Yaw values intentionally
 * remain in degrees because ALS's state, settings, animation curves, and branch thresholds are
 * all authored in degrees. The horizontal plane mirrors ALS: +X forward, +Y right, +Z up.
 */

export interface AlsVector3 {
  x: number
  y: number
  z: number
}

export interface AlsLocomotionState {
  hasInput: boolean
  inputYawAngle: number
  hasVelocity: boolean
  speed: number
  velocity: AlsVector3
  velocityYawAngle: number
  moving: boolean
  rotationTowardsLastInputDirectionBlocked: boolean
  targetYawAngle: number
  smoothTargetYawAngle: number
  viewRelativeTargetYawAngle: number
  aimingYawAngleLimit: number
  aimingLimitAppliedThisFrame: boolean
  resetAimingLimit: boolean
}

// AlsCharacter.cpp:1388-1390. The source value is 1 cm/s.
export const ALS_HAS_SPEED_THRESHOLD = 0.01

// AlsCharacterSettings.h:21 and AlsCharacter.cpp:1436-1439. The source value is 50 cm/s.
export const ALS_MOVING_SPEED_THRESHOLD = 0.5

export function unwindDegrees(angle: number): number {
  let result = angle % 360
  if (result > 180) result -= 360
  if (result < -180) result += 360
  return result
}

/** UAlsVector::DirectionToAngleXY(), AlsVector.h:160-163. */
export function directionToAngleXY(direction: Readonly<AlsVector3>): number {
  return Math.atan2(direction.y, direction.x) * 180 / Math.PI
}

/**
 * Mirrors AAlsCharacter::PostRegisterAllComponents() and FAlsLocomotionState's field defaults
 * (AlsCharacter.cpp:122-127; AlsLocomotionState.h:10-52).
 */
export function createAlsLocomotionState(
  initialYawAngle = 0,
): AlsLocomotionState {
  const yawAngle = unwindDegrees(initialYawAngle)
  return {
    hasInput: false,
    inputYawAngle: yawAngle,
    hasVelocity: false,
    speed: 0,
    velocity: { x: 0, y: 0, z: 0 },
    velocityYawAngle: yawAngle,
    moving: false,
    rotationTowardsLastInputDirectionBlocked: true,
    targetYawAngle: yawAngle,
    smoothTargetYawAngle: yawAngle,
    viewRelativeTargetYawAngle: 0,
    aimingYawAngleLimit: 180,
    aimingLimitAppliedThisFrame: false,
    resetAimingLimit: true,
  }
}

/**
 * Mirrors AAlsCharacter::RefreshLocomotion()'s locally observable state updates
 * (AlsCharacter.cpp:1375-1440). Velocity yaw is deliberately retained below the has-velocity
 * threshold so stopped systems can still use the last movement direction.
 */
export function refreshLocomotionState(
  state: AlsLocomotionState,
  velocity: Readonly<AlsVector3>,
  hasInput: boolean,
  movingSpeedThreshold = ALS_MOVING_SPEED_THRESHOLD,
): AlsLocomotionState {
  state.velocity.x = velocity.x
  state.velocity.y = velocity.y
  state.velocity.z = velocity.z
  state.speed = Math.hypot(velocity.x, velocity.y)
  state.hasVelocity = state.speed >= ALS_HAS_SPEED_THRESHOLD

  if (state.hasVelocity) {
    state.velocityYawAngle = directionToAngleXY(velocity)
  }

  state.moving = (hasInput && state.hasVelocity)
    || state.speed > movingSpeedThreshold
  return state
}
