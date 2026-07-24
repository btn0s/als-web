import { describe, expect, it } from 'vitest'
import { createAlsCharacter } from '../AlsCharacter'
import {
  ALS_ANIM_NOTIFY_STATE_SET_LOCOMOTION_ACTION_DEFAULTS,
  getAlsAnimNotifyStateSetLocomotionActionName,
  notifyAlsAnimNotifyStateSetLocomotionActionBegin,
  notifyAlsAnimNotifyStateSetLocomotionActionEnd,
} from './AlsAnimNotifyState_SetLocomotionAction'

describe('UAlsAnimNotifyState_SetLocomotionAction', () => {
  it('sets its action on begin and only clears the same action on end', () => {
    const character = createAlsCharacter()
    const mantling = { LocomotionAction: 'Mantling' } as const

    notifyAlsAnimNotifyStateSetLocomotionActionBegin(
      character,
      mantling,
    )
    expect(character.locomotionAction).toBe('Mantling')

    character.locomotionAction = 'Rolling'
    notifyAlsAnimNotifyStateSetLocomotionActionEnd(
      character,
      mantling,
    )
    expect(character.locomotionAction).toBe('Rolling')

    notifyAlsAnimNotifyStateSetLocomotionActionEnd(character, {
      LocomotionAction: 'Rolling',
    })
    expect(character.locomotionAction).toBeNull()
  })

  it('retains the invalid-tag default and C++ display name', () => {
    expect(
      ALS_ANIM_NOTIFY_STATE_SET_LOCOMOTION_ACTION_DEFAULTS,
    ).toEqual({ LocomotionAction: null })
    expect(
      getAlsAnimNotifyStateSetLocomotionActionName('GettingUp'),
    ).toBe('Als Set Locomotion Action: Getting Up')
  })
})
