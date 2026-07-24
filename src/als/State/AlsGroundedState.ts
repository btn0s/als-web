/**
 * ALS grounded velocity blend (`RefreshVelocityBlend`, AlsAnimationInstance.cpp:735-785).
 * Framework-free so the actor-local transform, L1 normalization, and damping stay testable.
 */

export const VELOCITY_BLEND_DAMP_RATE = 12

/**
 * ALS `UAlsMath::ExponentialDecay()` interpolation amount.
 *
 * Unreal's `FMath::InvExpApprox()` intentionally uses this adjusted reciprocal cubic instead of
 * the exact exponential. Keeping it here also gives non-animation callers the same frame-rate
 * independent interpolation scalar used by ALS.
 */
export function exponentialDecay(deltaTime: number, lambda: number): number {
  const x = lambda * deltaTime
  return 1 - 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
}

export interface Velocity3 {
  x: number
  y: number
  z: number
}

export interface AlsVelocityBlendState {
  forwardAmount: number
  backwardAmount: number
  leftAmount: number
  rightAmount: number
}

export function createVelocityBlend(): AlsVelocityBlendState {
  return { forwardAmount: 0, backwardAmount: 0, leftAmount: 0, rightAmount: 0 }
}

/**
 * Converts world velocity into ALS actor-local axes (X forward, Y right), then performs the
 * authored L1 normalization. `actorYaw` is radians around the up axis.
 */
export function velocityBlendTarget(
  velocity: Velocity3,
  actorYaw: number,
  out: AlsVelocityBlendState = createVelocityBlend(),
): AlsVelocityBlendState {
  const cos = Math.cos(actorYaw)
  const sin = Math.sin(actorYaw)
  const localX = velocity.x * cos + velocity.y * sin
  const localY = -velocity.x * sin + velocity.y * cos
  const length = Math.hypot(localX, localY, velocity.z)

  // UE FVector::GetSafeNormal treats squared length <= SMALL_NUMBER (1e-8) as zero —
  // i.e. |v| <= 1e-4 cm/s. Number.EPSILON here flipped ForwardAmount to 1 at |v|=5e-5
  // (verified by the near-zero velocity differential case).
  const UE_SMALL_NUMBER = 1e-8
  if (length * length <= UE_SMALL_NUMBER) {
    out.forwardAmount = 0
    out.backwardAmount = 0
    out.leftAmount = 0
    out.rightAmount = 0
    return out
  }

  const normalizedX = localX / length
  const normalizedY = localY / length
  const normalizedZ = velocity.z / length
  const l1 = Math.abs(normalizedX) + Math.abs(normalizedY) + Math.abs(normalizedZ)
  const x = l1 > Number.EPSILON ? normalizedX / l1 : 0
  const y = l1 > Number.EPSILON ? normalizedY / l1 : 0

  out.forwardAmount = Math.max(0, Math.min(1, x))
  out.backwardAmount = Math.abs(Math.max(-1, Math.min(0, x)))
  out.leftAmount = Math.abs(Math.max(-1, Math.min(0, y)))
  out.rightAmount = Math.max(0, Math.min(1, y))
  return out
}

/**
 * Advances a persistent velocity blend in place. ALS snaps on initialization, otherwise it uses
 * `UAlsMath::ExponentialDecay()` rather than `FInterpTo`.
 */
export function stepVelocityBlend(
  current: AlsVelocityBlendState,
  velocity: Velocity3,
  actorYaw: number,
  deltaTime: number,
  initialize = false,
  target: AlsVelocityBlendState = createVelocityBlend(),
): AlsVelocityBlendState {
  velocityBlendTarget(velocity, actorYaw, target)
  const alpha = initialize
    ? 1
    : exponentialDecay(deltaTime, VELOCITY_BLEND_DAMP_RATE)

  current.forwardAmount += (target.forwardAmount - current.forwardAmount) * alpha
  current.backwardAmount += (target.backwardAmount - current.backwardAmount) * alpha
  current.leftAmount += (target.leftAmount - current.leftAmount) * alpha
  current.rightAmount += (target.rightAmount - current.rightAmount) * alpha
  return current
}
