import { sampleRichCurve } from '../../engine/richCurve'
import { ALS_CROUCHING_SETTINGS } from '../Settings/AlsCrouchingSettings'

export interface AlsCrouchingState {
  strideBlendAmount: number
  playRate: number
}

export function createAlsCrouchingState(): AlsCrouchingState {
  return {
    strideBlendAmount: ALS_CROUCHING_SETTINGS.strideBlendAmountCurve[0].value,
    playRate: 1e-4,
  }
}

/** Exact UAlsAnimationInstance::RefreshCrouchingMovement gait/stride/play-rate math. */
export function refreshCrouchingMovement(
  state: AlsCrouchingState,
  speedMetresPerSecond: number,
): AlsCrouchingState {
  const speed = Math.max(0, speedMetresPerSecond) * 100
  state.strideBlendAmount = sampleRichCurve(
    ALS_CROUCHING_SETTINGS.strideBlendAmountCurve,
    speed,
  )
  state.playRate = Math.max(
    1e-4,
    Math.min(
      2,
      speed
        / (
          ALS_CROUCHING_SETTINGS.animatedCrouchSpeed
          * state.strideBlendAmount
        ),
    ),
  )
  return state
}
