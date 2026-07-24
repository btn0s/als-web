import { exponentialDecay } from './AlsGroundedState'
import type { AlsVector3 } from './AlsLocomotionState'

export const ALS_LEAN_INTERPOLATION_SPEED = 4
export const ALS_IN_AIR_LEAN_REFERENCE_SPEED = 3.5

export interface AlsLeanState {
  rightAmount: number
  forwardAmount: number
}

export interface AlsLeanAmount {
  readonly x: number
  readonly y: number
}

interface AlsLeanInterpolationInput {
  readonly pendingUpdate: boolean
  readonly deltaTime: number
  readonly leanInterpolationSpeed?: number
}

export interface AlsGroundedLeanInput extends AlsLeanInterpolationInput {
  readonly relativeAccelerationAmount: AlsLeanAmount
}

export interface AlsInAirLeanInput extends AlsLeanInterpolationInput {
  /** Actor-local velocity in the web runtime's metres-per-second boundary units. */
  readonly relativeVelocity: Readonly<AlsVector3>
  /** Vertical velocity in metres per second. */
  readonly verticalVelocity: number
  /** Samples ALS's authored cm/s-domain LeanAmountCurve. */
  readonly leanAmountCurve: (verticalVelocityCentimetresPerSecond: number) => number
}

export function createAlsLeanState(): AlsLeanState {
  return { rightAmount: 0, forwardAmount: 0 }
}

function refreshLeanAmounts(
  state: AlsLeanState,
  targetRightAmount: number,
  targetForwardAmount: number,
  input: AlsLeanInterpolationInput,
): AlsLeanState {
  const interpolationSpeed =
    input.leanInterpolationSpeed ?? ALS_LEAN_INTERPOLATION_SPEED
  if (input.pendingUpdate || interpolationSpeed <= 0) {
    state.rightAmount = targetRightAmount
    state.forwardAmount = targetForwardAmount
    return state
  }

  const interpolationAmount = exponentialDecay(
    input.deltaTime,
    interpolationSpeed,
  )
  state.rightAmount +=
    (targetRightAmount - state.rightAmount) * interpolationAmount
  state.forwardAmount +=
    (targetForwardAmount - state.forwardAmount) * interpolationAmount
  return state
}

/** Exact mutable port of UAlsAnimationInstance::RefreshGroundedLean(), cpp:787-803. */
export function refreshGroundedLean(
  state: AlsLeanState,
  input: AlsGroundedLeanInput,
): AlsLeanState {
  return refreshLeanAmounts(
    state,
    input.relativeAccelerationAmount.y,
    input.relativeAccelerationAmount.x,
    input,
  )
}

/** Exact mutable port of UAlsAnimationInstance::RefreshInAirLean(), cpp:1102-1126. */
export function refreshInAirLean(
  state: AlsLeanState,
  input: AlsInAirLeanInput,
): AlsLeanState {
  const leanAmount = input.leanAmountCurve(input.verticalVelocity * 100)
  return refreshLeanAmounts(
    state,
    input.relativeVelocity.y / ALS_IN_AIR_LEAN_REFERENCE_SPEED * leanAmount,
    input.relativeVelocity.x / ALS_IN_AIR_LEAN_REFERENCE_SPEED * leanAmount,
    input,
  )
}
