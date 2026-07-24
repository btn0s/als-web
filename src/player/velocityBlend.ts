/**
 * ALS grounded velocity blend (`RefreshVelocityBlend`, AlsAnimationInstance.cpp:735-785).
 * Framework-free so the actor-local transform, L1 normalization, and damping stay testable.
 */

export const VELOCITY_BLEND_DAMP_RATE = 12

export interface Velocity3 {
  x: number
  y: number
  z: number
}

export interface VelocityBlend {
  forward: number
  backward: number
  left: number
  right: number
}

export function createVelocityBlend(): VelocityBlend {
  return { forward: 0, backward: 0, left: 0, right: 0 }
}

/**
 * Converts world velocity into ALS actor-local axes (X forward, Y right), then performs the
 * authored L1 normalization. `actorYaw` is radians around the up axis.
 */
export function velocityBlendTarget(
  velocity: Velocity3,
  actorYaw: number,
  out: VelocityBlend = createVelocityBlend(),
): VelocityBlend {
  const cos = Math.cos(actorYaw)
  const sin = Math.sin(actorYaw)
  const localX = velocity.x * cos + velocity.y * sin
  const localY = -velocity.x * sin + velocity.y * cos
  const length = Math.hypot(localX, localY, velocity.z)

  if (length <= Number.EPSILON) {
    out.forward = 0
    out.backward = 0
    out.left = 0
    out.right = 0
    return out
  }

  const normalizedX = localX / length
  const normalizedY = localY / length
  const normalizedZ = velocity.z / length
  const l1 = Math.abs(normalizedX) + Math.abs(normalizedY) + Math.abs(normalizedZ)
  const x = l1 > Number.EPSILON ? normalizedX / l1 : 0
  const y = l1 > Number.EPSILON ? normalizedY / l1 : 0

  out.forward = Math.max(0, Math.min(1, x))
  out.backward = Math.abs(Math.max(-1, Math.min(0, x)))
  out.left = Math.abs(Math.max(-1, Math.min(0, y)))
  out.right = Math.max(0, Math.min(1, y))
  return out
}

/**
 * Advances a persistent velocity blend in place. ALS snaps on initialization, otherwise it uses
 * exponential decay `lerp(current, target, 1 - exp(-12 * dt))` rather than `FInterpTo`.
 */
export function stepVelocityBlend(
  current: VelocityBlend,
  velocity: Velocity3,
  actorYaw: number,
  deltaTime: number,
  initialize = false,
  target: VelocityBlend = createVelocityBlend(),
): VelocityBlend {
  velocityBlendTarget(velocity, actorYaw, target)
  const alpha = initialize
    ? 1
    : 1 - Math.exp(-VELOCITY_BLEND_DAMP_RATE * Math.max(0, deltaTime))

  current.forward += (target.forward - current.forward) * alpha
  current.backward += (target.backward - current.backward) * alpha
  current.left += (target.left - current.left) * alpha
  current.right += (target.right - current.right) * alpha
  return current
}
