import {
  setLocomotionAction,
} from '../AlsCharacter'
import type {
  AlsCharacter,
  AlsLocomotionAction,
} from '../AlsCharacter'

export interface AlsAnimNotifyStateSetLocomotionActionPayload {
  readonly LocomotionAction: AlsLocomotionAction
}

export const ALS_ANIM_NOTIFY_STATE_SET_LOCOMOTION_ACTION_DEFAULTS:
Readonly<AlsAnimNotifyStateSetLocomotionActionPayload> =
Object.freeze({
  LocomotionAction: null,
})

/** Exact `NotifyBegin()` side effect. */
export function notifyAlsAnimNotifyStateSetLocomotionActionBegin(
  Character: AlsCharacter | null | undefined,
  Notify: Readonly<AlsAnimNotifyStateSetLocomotionActionPayload>,
): void {
  if (Character) {
    setLocomotionAction(Character, Notify.LocomotionAction)
  }
}

/**
 * Exact identity guard from `NotifyEnd()`: an outgoing montage may only clear
 * the action it originally installed.
 */
export function notifyAlsAnimNotifyStateSetLocomotionActionEnd(
  Character: AlsCharacter | null | undefined,
  Notify: Readonly<AlsAnimNotifyStateSetLocomotionActionPayload>,
): void {
  if (
    Character
    && Character.locomotionAction === Notify.LocomotionAction
  ) {
    setLocomotionAction(Character, null)
  }
}

export function getAlsAnimNotifyStateSetLocomotionActionName(
  LocomotionAction: AlsLocomotionAction,
): string {
  const displayName = (LocomotionAction ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return `Als Set Locomotion Action: ${displayName}`
}
