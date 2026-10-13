import type { AlsLocomotionAction } from './AlsCharacter'
import type { AlsRagdollingAnimationState } from './State/AlsRagdollingAnimationState'

/** UAlsAnimationInstance::RefreshRagdollingOnGameThread, ALS 4.15.
 * Linear velocity uses this port's metres/second, hence 1000 cm/s = 10 m/s. */
export function refreshRagdollingOnGameThread(
  State: AlsRagdollingAnimationState,
  LocomotionAction: AlsLocomotionAction,
  PelvisVelocity: Readonly<{ x: number; y: number; z: number }>,
) {
  if (LocomotionAction !== 'Ragdolling') return
  State.FlailPlayRate = Math.min(1, Math.hypot(PelvisVelocity.x, PelvisVelocity.y, PelvisVelocity.z) / 10)
}
