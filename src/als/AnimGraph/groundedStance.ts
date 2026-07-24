import { sampleRichCurve } from '../../engine/richCurve'
import type { RichCurveKey } from '../../engine/richCurve'

/*
 * AB_Als_Grounded's Grounded States stance routes.
 *
 * The direct Standing <-> Crouching transitions have the default priority 1 and win while
 * LocomotionState.bMovingSmooth or either RotateInPlace flag is set. The lower-priority transition
 * states play the authored full-body sequence only while idle. Values below are serialized from
 * AB_Als_Grounded and CF_Als_StanceChange in ALS Refactored 4.15.
 */
export const ALS_STANCE_CHANGE_TRANSITION_DURATION = 0.5
export const ALS_STANCE_TRANSITION_SEQUENCE_PLAY_RATE = 1.2
export const ALS_STANCE_TRANSITION_INERTIALIZATION_DURATION = 0.3
export const ALS_STANCE_TRANSITION_EXIT_DURATION = 0

export const ALS_STANCE_CHANGE_CURVE = [
  {
    time: 0,
    value: 0,
    interpolation: 'cubic',
    arriveTangent: 0,
    leaveTangent: 0,
  },
  {
    time: 0.4,
    value: 0.4,
    interpolation: 'cubic',
    arriveTangent: 2.7303076,
    leaveTangent: 2.7303076,
  },
  {
    time: 1,
    value: 1,
    interpolation: 'linear',
    arriveTangent: 0,
    leaveTangent: 0,
  },
] as const satisfies readonly RichCurveKey[]

export interface AlsGroundedStanceRouteInput {
  readonly movingSmooth: boolean
  readonly rotatingLeft: boolean
  readonly rotatingRight: boolean
}

export function useDirectGroundedStanceTransition(
  input: AlsGroundedStanceRouteInput,
) {
  return input.movingSmooth || input.rotatingLeft || input.rotatingRight
}

export interface AlsGroundedStanceTransitionState {
  active: boolean
  elapsed: number
  linearAlpha: number
  blendAlpha: number
  fromCrouchingAmount: number
  toCrouchingAmount: number
  crouchingAmount: number
}

export function createAlsGroundedStanceTransitionState(
  crouchingAmount = 0,
): AlsGroundedStanceTransitionState {
  const amount = Math.max(0, Math.min(1, crouchingAmount))
  return {
    active: false,
    elapsed: 0,
    linearAlpha: 1,
    blendAlpha: 1,
    fromCrouchingAmount: amount,
    toCrouchingAmount: amount,
    crouchingAmount: amount,
  }
}

export function startGroundedStanceTransition(
  state: AlsGroundedStanceTransitionState,
  fromCrouchingAmount: number,
  toCrouchingAmount: number,
) {
  state.fromCrouchingAmount = Math.max(
    0,
    Math.min(1, fromCrouchingAmount),
  )
  state.toCrouchingAmount = Math.max(0, Math.min(1, toCrouchingAmount))
  state.crouchingAmount = state.fromCrouchingAmount
  state.elapsed = 0
  state.linearAlpha = 0
  state.blendAlpha = 0
  state.active =
    Math.abs(state.toCrouchingAmount - state.fromCrouchingAmount)
    > Number.EPSILON
  if (!state.active) {
    state.linearAlpha = 1
    state.blendAlpha = 1
    state.crouchingAmount = state.toCrouchingAmount
  }
  return state
}

export function advanceGroundedStanceTransition(
  state: AlsGroundedStanceTransitionState,
  deltaTime: number,
) {
  if (!state.active) return state
  state.elapsed = Math.min(
    ALS_STANCE_CHANGE_TRANSITION_DURATION,
    state.elapsed + Math.max(0, deltaTime),
  )
  state.linearAlpha =
    state.elapsed / ALS_STANCE_CHANGE_TRANSITION_DURATION
  state.blendAlpha = sampleRichCurve(
    ALS_STANCE_CHANGE_CURVE,
    state.linearAlpha,
  )
  state.crouchingAmount =
    state.fromCrouchingAmount
    + (
      state.toCrouchingAmount - state.fromCrouchingAmount
    ) * state.blendAlpha
  if (state.elapsed >= ALS_STANCE_CHANGE_TRANSITION_DURATION) {
    state.active = false
    state.crouchingAmount = state.toCrouchingAmount
  }
  return state
}
