export type AlsGroundedEntryMode =
  | 'Als.GroundedEntryMode.FromRoll'
  | null

export interface AlsAnimNotifySetGroundedEntryModePayload {
  readonly GroundedEntryMode: AlsGroundedEntryMode
}

export interface AlsGroundedEntryModeAnimationInstance {
  SetGroundedEntryMode(
    GroundedEntryMode: AlsGroundedEntryMode,
  ): void
}

export const ALS_ANIM_NOTIFY_SET_GROUNDED_ENTRY_MODE_DEFAULTS:
Readonly<AlsAnimNotifySetGroundedEntryModePayload> = Object.freeze({
  GroundedEntryMode: null,
})

export function notifyAlsAnimNotifySetGroundedEntryMode(
  AnimationInstance:
    AlsGroundedEntryModeAnimationInstance | null | undefined,
  Notify: Readonly<AlsAnimNotifySetGroundedEntryModePayload>,
): void {
  AnimationInstance?.SetGroundedEntryMode(
    Notify.GroundedEntryMode,
  )
}

function displaySimpleTag(tag: string | null) {
  const simple = tag?.split('.').at(-1) ?? ''
  return simple.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

export function getAlsAnimNotifySetGroundedEntryModeName(
  GroundedEntryMode: AlsGroundedEntryMode,
): string {
  return `Als Set Grounded Entry Mode: ${
    displaySimpleTag(GroundedEntryMode)
  }`
}
