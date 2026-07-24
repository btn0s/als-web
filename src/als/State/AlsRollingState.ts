/**
 * Framework-free counterpart of ALS Refactored's `FAlsRollingState`.
 *
 * Angles remain in degrees, matching the authored ALS character state.
 */
export interface AlsRollingState {
  TargetYawAngle: number
}

export function createAlsRollingState(): AlsRollingState {
  // State/AlsRollingState.h:10-11.
  return {
    TargetYawAngle: 0,
  }
}
