import type {
  AlsCharacterLocalRole,
} from '../AlsCharacter_Actions'

export interface AlsAnimNotifyStateSetRootMotionScalePayload {
  readonly TranslationScale: number
}

export interface AlsRootMotionScaleCharacter {
  readonly LocalRole: AlsCharacterLocalRole
  GetAnimRootMotionTranslationScale(): number
  SetAnimRootMotionTranslationScale(TranslationScale: number): void
}

export const ALS_ANIM_NOTIFY_STATE_SET_ROOT_MOTION_SCALE_DEFAULTS:
Readonly<AlsAnimNotifyStateSetRootMotionScalePayload> = Object.freeze({
  TranslationScale: 1,
})

function canSetRootMotionScale(
  Character: AlsRootMotionScaleCharacter,
) {
  return (
    Character.LocalRole === 'AutonomousProxy'
    || Character.LocalRole === 'Authority'
  )
}

export function notifyAlsAnimNotifyStateSetRootMotionScaleBegin(
  Character: AlsRootMotionScaleCharacter | null | undefined,
  Notify: Readonly<AlsAnimNotifyStateSetRootMotionScalePayload>,
): void {
  if (Character && canSetRootMotionScale(Character)) {
    Character.SetAnimRootMotionTranslationScale(
      Notify.TranslationScale,
    )
  }
}

export type AlsRootMotionScaleNotifyEndResult =
  | 'Ignored'
  | 'Reset'
  | 'Mismatched'

/**
 * Exact value-ownership guard from `NotifyEnd()`. A notify never overwrites a
 * scale that another system changed before its state ended.
 */
export function notifyAlsAnimNotifyStateSetRootMotionScaleEnd(
  Character: AlsRootMotionScaleCharacter | null | undefined,
  Notify: Readonly<AlsAnimNotifyStateSetRootMotionScalePayload>,
  Warn: (message: string) => void = console.warn,
): AlsRootMotionScaleNotifyEndResult {
  if (!Character || !canSetRootMotionScale(Character)) {
    return 'Ignored'
  }
  if (
    Math.abs(
      Character.GetAnimRootMotionTranslationScale()
      - Notify.TranslationScale,
    ) <= 1e-4
  ) {
    Character.SetAnimRootMotionTranslationScale(1)
    return 'Reset'
  }
  Warn(
    'The current translation scale does not match the scale from '
    + 'UAlsAnimNotifyState_SetRootMotionScale.',
  )
  return 'Mismatched'
}

export function getAlsAnimNotifyStateSetRootMotionScaleName(
  TranslationScale: number,
): string {
  return `Als Set Root Motion Scale: ${TranslationScale.toFixed(2)}`
}
