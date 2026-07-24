export interface AlsPoseState {
  amount: number
  walking: number
  running: number
  sprinting: number
}

export function createAlsPoseState(): AlsPoseState {
  return { amount: 0, walking: 0, running: 0, sprinting: 0 }
}

export interface AlsStanceTransitionCurveState {
  crouchingAmount: number
  footLeftLock: number
  footRightLock: number
}

export interface AlsStanceTransitionCurveSamplers {
  readonly PoseCrouching?: (time: number) => number
  readonly FootLeftLock?: (time: number) => number
  readonly FootRightLock?: (time: number) => number
}

export function createAlsStanceTransitionCurveState(): AlsStanceTransitionCurveState {
  return { crouchingAmount: 0, footLeftLock: 0, footRightLock: 0 }
}

/**
 * Samples stance and foot-lock state from the playing transition clip. The 10/s decay is retained
 * only when the requested authored transition clip is unavailable, so incomplete GLBs still have a
 * non-popping Stance path.
 */
export function refreshStanceTransition(
  state: AlsStanceTransitionCurveState,
  targetCrouchingAmount: number,
  delta: number,
  transition?: {
    readonly time: number
    readonly curves: AlsStanceTransitionCurveSamplers
  },
): AlsStanceTransitionCurveState {
  if (transition) {
    const { curves, time } = transition
    state.crouchingAmount = Math.max(
      0,
      Math.min(1, curves.PoseCrouching?.(time) ?? targetCrouchingAmount),
    )
    state.footLeftLock = Math.max(
      0,
      Math.min(1, curves.FootLeftLock?.(time) ?? 0),
    )
    state.footRightLock = Math.max(
      0,
      Math.min(1, curves.FootRightLock?.(time) ?? 0),
    )
    return state
  }

  const alpha = 1 - Math.exp(-10 * Math.max(0, delta))
  state.crouchingAmount += (targetCrouchingAmount - state.crouchingAmount) * alpha
  state.footLeftLock = 0
  state.footRightLock = 0
  return state
}
