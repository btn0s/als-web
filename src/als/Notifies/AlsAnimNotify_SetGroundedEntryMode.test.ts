import { describe, expect, it, vi } from 'vitest'
import {
  ALS_ANIM_NOTIFY_SET_GROUNDED_ENTRY_MODE_DEFAULTS,
  getAlsAnimNotifySetGroundedEntryModeName,
  notifyAlsAnimNotifySetGroundedEntryMode,
} from './AlsAnimNotify_SetGroundedEntryMode'

describe('UAlsAnimNotify_SetGroundedEntryMode', () => {
  it('forwards the exact gameplay tag to the animation instance', () => {
    const SetGroundedEntryMode = vi.fn()
    notifyAlsAnimNotifySetGroundedEntryMode(
      { SetGroundedEntryMode },
      { GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll' },
    )
    expect(SetGroundedEntryMode)
      .toHaveBeenCalledExactlyOnceWith(
        'Als.GroundedEntryMode.FromRoll',
      )
  })

  it('retains the invalid-tag default and display-name conversion', () => {
    expect(
      ALS_ANIM_NOTIFY_SET_GROUNDED_ENTRY_MODE_DEFAULTS,
    ).toEqual({ GroundedEntryMode: null })
    expect(getAlsAnimNotifySetGroundedEntryModeName(
      'Als.GroundedEntryMode.FromRoll',
    )).toBe('Als Set Grounded Entry Mode: From Roll')
  })
})
