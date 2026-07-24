import type { AlsVector3 } from './AlsLocomotionState'

/**
 * Framework-free counterpart of ALS Refactored's `FAlsRagdollingState`.
 *
 * Linear values cross the runtime boundary in metres and metres per second.
 * PullForce retains the native force unit because its Rapier interpretation
 * belongs to the explicit physics adapter.
 */
export interface AlsRagdollingState {
  Velocity: AlsVector3
  PullForce: number
  SpeedLimitFrameTimeRemaining: number
  SpeedLimit: number
}

export function createAlsRagdollingState(): AlsRagdollingState {
  // State/AlsRagdollingState.h:10-20.
  return {
    Velocity: { x: 0, y: 0, z: 0 },
    PullForce: 0,
    SpeedLimitFrameTimeRemaining: 0,
    SpeedLimit: 0,
  }
}
