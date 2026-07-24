import { sampleRichCurve } from '../../engine/richCurve'
import type { AlsGait } from '../Settings/AlsMovementSettings'
import { ALS_STANDING_SETTINGS } from '../Settings/AlsStandingSettings'

export interface AlsStandingState {
  strideBlendAmount: number
  walkRunBlendAmount: number
  playRate: number
}

export interface AlsStandingMovementInput {
  /** Character speed in this runtime's metres-per-second world units. */
  speed: number
  gait: AlsGait
  unweightedGaitRunningAmount: number
  unweightedGaitSprintingAmount: number
}

export function createAlsStandingState(): AlsStandingState {
  return {
    strideBlendAmount: ALS_STANDING_SETTINGS.strideBlendAmountWalkCurve[0].value,
    walkRunBlendAmount: 0,
    playRate: 1e-4,
  }
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount

/**
 * Exact gait/stride/play-rate portion of UAlsAnimationInstance::RefreshStandingMovement.
 * Metres are converted back to cm only at the authored-curve boundary.
 */
export function refreshStandingMovement(
  state: AlsStandingState,
  input: Readonly<AlsStandingMovementInput>,
): AlsStandingState {
  const speed = Math.max(0, input.speed) * 100
  const runningAmount = clamp01(input.unweightedGaitRunningAmount)
  const sprintingAmount = clamp01(input.unweightedGaitSprintingAmount)

  state.strideBlendAmount = lerp(
    sampleRichCurve(
      ALS_STANDING_SETTINGS.strideBlendAmountWalkCurve,
      speed,
    ),
    sampleRichCurve(
      ALS_STANDING_SETTINGS.strideBlendAmountRunCurve,
      speed,
    ),
    runningAmount,
  )
  state.walkRunBlendAmount = input.gait === 'Walking' ? 0 : 1

  const walkRunSpeedAmount = lerp(
    speed / ALS_STANDING_SETTINGS.animatedWalkSpeed,
    speed / ALS_STANDING_SETTINGS.animatedRunSpeed,
    runningAmount,
  )
  const walkRunSprintSpeedAmount = lerp(
    walkRunSpeedAmount,
    speed / ALS_STANDING_SETTINGS.animatedSprintSpeed,
    sprintingAmount,
  )
  state.playRate = Math.max(
    1e-4,
    Math.min(
      3,
      walkRunSprintSpeedAmount / state.strideBlendAmount,
    ),
  )
  return state
}
