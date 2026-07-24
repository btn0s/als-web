const KINDA_SMALL_NUMBER_SQUARED = 1e-8

export interface InputScaleBiasClampState {
  value: number
  initialized: boolean
}

export function createInputScaleBiasClampState(): InputScaleBiasClampState {
  return { value: 0, initialized: false }
}

export function resetInputScaleBiasClampState(
  state: InputScaleBiasClampState,
) {
  state.value = 0
  state.initialized = false
  return state
}

export function mapRangeUnclamped(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
) {
  if (inputMinimum === inputMaximum) return outputMinimum
  return outputMinimum + (
    (value - inputMinimum)
    / (inputMaximum - inputMinimum)
  ) * (outputMaximum - outputMinimum)
}

/** UE `FMath::FInterpTo()`, including its delta*speed clamp and zero-speed snap. */
export function fInterpTo(
  current: number,
  target: number,
  deltaTime: number,
  interpolationSpeed: number,
) {
  if (interpolationSpeed <= 0) return target
  const distance = target - current
  if (distance * distance < KINDA_SMALL_NUMBER_SQUARED) return target
  const amount = Math.max(
    0,
    Math.min(1, Math.max(0, deltaTime) * interpolationSpeed),
  )
  return current + distance * amount
}

/**
 * UE `FInputScaleBiasClampState`'s stateful interpolation pass.
 *
 * A newly relevant node snaps to its current input on the first update. Later updates select the
 * increasing or decreasing speed from the mapped target's direction.
 */
export function refreshInputScaleBiasClampState(
  state: InputScaleBiasClampState,
  target: number,
  deltaTime: number,
  increasingSpeed: number,
  decreasingSpeed: number,
) {
  if (!state.initialized) {
    state.value = target
    state.initialized = true
    return target
  }
  state.value = fInterpTo(
    state.value,
    target,
    Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0,
    target > state.value ? increasingSpeed : decreasingSpeed,
  )
  return state.value
}

