import type { AlsStance } from '../Settings/AlsMovementSettings'
import {
  ALS_TURN_IN_PLACE_SETTINGS,
  calculateTurnInPlacePlayRate,
  selectTurnInPlaceClip,
} from '../Settings/AlsTurnInPlaceSettings'
import type {
  AlsGeneralTurnInPlaceSettings,
  AlsTurnInPlaceSelection,
} from '../Settings/AlsTurnInPlaceSettings'

export interface AlsTurnInPlaceState {
  updatedThisFrame: boolean
  activationDelay: number
}

export interface AlsTurnInPlaceInput {
  readonly delta: number
  readonly transitionsAllowed: boolean
  readonly viewYawAngle: number
  readonly viewYawSpeed: number
  readonly stance: AlsStance
}

export interface AlsTurnInPlaceRequest extends AlsTurnInPlaceSelection {
  readonly queuedTurnYawAngle: number
  readonly playRate: number
}

export function createAlsTurnInPlaceState(): AlsTurnInPlaceState {
  return { updatedThisFrame: false, activationDelay: 0 }
}

export function resetTurnInPlaceFrame(state: AlsTurnInPlaceState) {
  state.updatedThisFrame = false
}

export function getTurnInPlaceActivationDelay(
  viewYawAngle: number,
  settings: AlsGeneralTurnInPlaceSettings = ALS_TURN_IN_PLACE_SETTINGS,
): number {
  const alpha = Math.max(0, Math.min(
    1,
    (Math.abs(viewYawAngle) - settings.viewYawAngleThreshold)
      / (180 - settings.viewYawAngleThreshold),
  ))
  const [minimum, maximum] = settings.viewYawAngleToActivationDelay
  return minimum + (maximum - minimum) * alpha
}

/**
 * ALS RefreshTurnInPlace trigger/queue state machine. The strict comparison is intentional:
 * AlsAnimationInstance.cpp keeps waiting while ActivationDelay <= the mapped delay.
 */
export function refreshTurnInPlace(
  state: AlsTurnInPlaceState,
  input: AlsTurnInPlaceInput,
  settings: AlsGeneralTurnInPlaceSettings = ALS_TURN_IN_PLACE_SETTINGS,
): AlsTurnInPlaceRequest | null {
  if (state.updatedThisFrame) return null
  state.updatedThisFrame = true

  if (
    !input.transitionsAllowed
    || input.viewYawSpeed >= settings.viewYawSpeedThreshold
    || Math.abs(input.viewYawAngle) <= settings.viewYawAngleThreshold
  ) {
    state.activationDelay = 0
    return null
  }

  state.activationDelay += Math.max(0, input.delta)
  if (
    state.activationDelay
    <= getTurnInPlaceActivationDelay(input.viewYawAngle, settings)
  ) {
    return null
  }

  const selection = selectTurnInPlaceClip(
    input.stance,
    input.viewYawAngle,
    settings,
  )
  state.activationDelay = 0
  return {
    ...selection,
    queuedTurnYawAngle: input.viewYawAngle,
    playRate: calculateTurnInPlacePlayRate(
      input.viewYawAngle,
      selection.settings,
    ),
  }
}
