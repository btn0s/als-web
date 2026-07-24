import {
  ALS_ROTATE_IN_PLACE_SETTINGS,
  mapRotateInPlacePlayRate,
} from '../Settings/AlsRotateInPlaceSettings'
import type { AlsRotateInPlaceSettings } from '../Settings/AlsRotateInPlaceSettings'

export interface AlsRotateInPlaceState {
  updatedThisFrame: boolean
  rotatingLeft: boolean
  rotatingRight: boolean
  playRate: number
}

export interface AlsRotateInPlaceInput {
  readonly delta: number
  readonly moving: boolean
  readonly allowed: boolean
  readonly pendingUpdate?: boolean
  readonly viewYawAngle: number
  readonly viewYawSpeed: number
}

export function createAlsRotateInPlaceState(): AlsRotateInPlaceState {
  return {
    updatedThisFrame: false,
    rotatingLeft: false,
    rotatingRight: false,
    playRate: ALS_ROTATE_IN_PLACE_SETTINGS.playRate[0],
  }
}

/**
 * FMath::FInterpTo: proportional linear interpolation with DeltaTime * InterpSpeed clamped to 1.
 * This intentionally differs from the exponential-decay helper used by ALS velocity blending.
 */
export function fInterpTo(
  current: number,
  target: number,
  delta: number,
  interpolationSpeed: number,
): number {
  if (interpolationSpeed <= 0) return target
  const alpha = Math.max(0, Math.min(1, delta * interpolationSpeed))
  return current + (target - current) * alpha
}

export function resetRotateInPlaceFrame(state: AlsRotateInPlaceState) {
  state.updatedThisFrame = false
}

/** Advances the single shared looping clock used by both the rotate pose and its authored curves. */
export function advanceRotateInPlaceClipTime(
  currentTime: number,
  delta: number,
  playRate: number,
  duration: number,
): number {
  if (duration <= 0) return 0
  const nextTime = currentTime + Math.max(0, delta) * Math.max(0, playRate)
  return ((nextTime % duration) + duration) % duration
}

export function refreshRotateInPlace(
  state: AlsRotateInPlaceState,
  input: AlsRotateInPlaceInput,
  settings: AlsRotateInPlaceSettings = ALS_ROTATE_IN_PLACE_SETTINGS,
): AlsRotateInPlaceState {
  if (state.updatedThisFrame) return state
  state.updatedThisFrame = true

  if (input.moving || !input.allowed) {
    state.rotatingLeft = false
    state.rotatingRight = false
  } else {
    state.rotatingLeft = input.viewYawAngle < -settings.viewYawAngleThreshold
    state.rotatingRight = input.viewYawAngle > settings.viewYawAngleThreshold
  }

  const target = state.rotatingLeft || state.rotatingRight
    ? mapRotateInPlacePlayRate(input.viewYawSpeed, settings)
    : settings.playRate[0]
  state.playRate = input.pendingUpdate
    ? target
    : fInterpTo(
        state.playRate,
        target,
        input.delta,
        settings.playRateInterpolationSpeed,
      )
  return state
}
