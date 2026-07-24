import type {
  AlsLocomotionMode,
} from '../AlsCharacter'
import type {
  AlsRotationMode,
  AlsStance,
} from '../Settings/AlsMovementSettings'

export interface AlsAnimNotifyStateEarlyBlendOutPayload {
  readonly BlendOutDuration: number
  readonly bCheckInput: boolean
  readonly bCheckLocomotionMode: boolean
  readonly bCheckRotationMode: boolean
  readonly bCheckStance: boolean
  readonly LocomotionModeEquals: AlsLocomotionMode
  readonly RotationModeEquals: AlsRotationMode
  readonly StanceEquals: AlsStance
}

export interface AlsAnimNotifyStateEarlyBlendOutCharacter {
  readonly bHasInput: boolean
  readonly LocomotionMode: AlsLocomotionMode
  readonly RotationMode: AlsRotationMode
  readonly Stance: AlsStance
}

export interface AlsAnimNotifyStateEarlyBlendOutMontage {
  StopMontageInstance(
    MontageInstanceID: number,
    BlendOutDuration: number,
  ): boolean
}

export const ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS:
Readonly<AlsAnimNotifyStateEarlyBlendOutPayload> = Object.freeze({
  BlendOutDuration: 0.25,
  bCheckInput: true,
  bCheckLocomotionMode: true,
  bCheckRotationMode: true,
  bCheckStance: true,
  LocomotionModeEquals: 'InAir',
  RotationModeEquals: 'Aiming',
  StanceEquals: 'Crouching',
})

export function shouldAlsAnimNotifyStateEarlyBlendOut(
  Character: Readonly<AlsAnimNotifyStateEarlyBlendOutCharacter>,
  Notify: Readonly<AlsAnimNotifyStateEarlyBlendOutPayload>,
): boolean {
  return (
    (Notify.bCheckInput && Character.bHasInput)
    || (
      Notify.bCheckLocomotionMode
      && Character.LocomotionMode === Notify.LocomotionModeEquals
    )
    || (
      Notify.bCheckRotationMode
      && Character.RotationMode === Notify.RotationModeEquals
    )
    || (
      Notify.bCheckStance
      && Character.Stance === Notify.StanceEquals
    )
  )
}

/** Exact branching-point tick decision and identity-addressed Stop(). */
export function tickAlsAnimNotifyStateEarlyBlendOut(
  Montage: AlsAnimNotifyStateEarlyBlendOutMontage | null | undefined,
  MontageInstanceID: number,
  Character:
    Readonly<AlsAnimNotifyStateEarlyBlendOutCharacter> | null | undefined,
  Notify: Readonly<AlsAnimNotifyStateEarlyBlendOutPayload>,
): boolean {
  if (
    !Montage
    || !Character
    || !shouldAlsAnimNotifyStateEarlyBlendOut(Character, Notify)
  ) {
    return false
  }
  return Montage.StopMontageInstance(
    MontageInstanceID,
    Notify.BlendOutDuration,
  )
}

export function getAlsAnimNotifyStateEarlyBlendOutName(): string {
  return 'Als Early Blend Out'
}
