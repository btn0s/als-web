import type { AlsStance } from '../Settings/AlsMovementSettings'
import {
  ALS_TURN_IN_PLACE_SETTINGS,
  calculateTurnInPlacePlayRate,
  selectTurnInPlaceClip,
} from '../Settings/AlsTurnInPlaceSettings'
import type {
  AlsGeneralTurnInPlaceSettings,
  AlsTurnInPlaceClipSettings,
  AlsTurnInPlaceSelection,
} from '../Settings/AlsTurnInPlaceSettings'
import {
  TURN_IN_PLACE_CROUCHING_SLOT_NAME,
  TURN_IN_PLACE_STANDING_SLOT_NAME,
} from '../Utility/AlsConstants'

export type AlsTurnInPlaceSlotName =
  | typeof TURN_IN_PLACE_STANDING_SLOT_NAME
  | typeof TURN_IN_PLACE_CROUCHING_SLOT_NAME

export interface AlsTurnInPlaceState {
  updatedThisFrame: boolean
  activationDelay: number
  queuedSettings: AlsTurnInPlaceClipSettings | null
  queuedSlotName: AlsTurnInPlaceSlotName | null
  queuedTurnYawAngle: number
  playRate: number
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
  return {
    updatedThisFrame: false,
    activationDelay: 0,
    queuedSettings: null,
    queuedSlotName: null,
    queuedTurnYawAngle: 0,
    playRate: 1,
  }
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
  state.queuedSettings = selection.settings
  state.queuedSlotName = input.stance === 'Standing'
    ? TURN_IN_PLACE_STANDING_SLOT_NAME
    : TURN_IN_PLACE_CROUCHING_SLOT_NAME
  state.queuedTurnYawAngle = input.viewYawAngle
  // ALS retains the delay when it queues a turn. The frame latch blocks duplicate graph calls;
  // the montage's following AllowTransitions gate clears the retained delay.
  return {
    ...selection,
    queuedTurnYawAngle: input.viewYawAngle,
    playRate: calculateTurnInPlacePlayRate(
      input.viewYawAngle,
      selection.settings,
    ),
  }
}

export interface AlsQueuedTurnInPlaceAnimation {
  readonly settings: AlsTurnInPlaceClipSettings
  readonly slotName: AlsTurnInPlaceSlotName
  readonly queuedTurnYawAngle: number
  /** RotationYawSpeed multiplier, distinct from the dynamic montage segment play rate. */
  readonly playRate: number
}

/**
 * UAlsAnimationInstance::PlayQueuedTurnInPlaceAnimation(), cpp:1808-1834.
 *
 * NativePostUpdateAnimation calls this before queued Slot stops. A pending stop suppresses
 * playback without clearing the queued settings, matching the C++ early return.
 */
export function takeQueuedTurnInPlaceAnimation(
  state: AlsTurnInPlaceState,
  stopTransitionsQueued: boolean,
): AlsQueuedTurnInPlaceAnimation | null {
  if (
    stopTransitionsQueued
    || !state.queuedSettings
    || !state.queuedSlotName
  ) {
    return null
  }

  const queued = {
    settings: state.queuedSettings,
    slotName: state.queuedSlotName,
    queuedTurnYawAngle: state.queuedTurnYawAngle,
    playRate: calculateTurnInPlacePlayRate(
      state.queuedTurnYawAngle,
      state.queuedSettings,
    ),
  }
  state.playRate = queued.playRate
  state.queuedSettings = null
  state.queuedSlotName = null
  state.queuedTurnYawAngle = 0
  return queued
}
