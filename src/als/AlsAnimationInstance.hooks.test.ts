import { describe, expect, it } from 'vitest'
import type {
  AlsMantlingMontageBridge,
  AlsMantlingMontageNotifyEvent,
} from './AlsAnimationInstance'
import {
  refreshAlsAnimationMantlingNotifies,
} from './AlsAnimationInstance.hooks'
import { createAlsCharacter } from './AlsCharacter'
import {
  createAlsMantlingNotifyRuntime,
} from './AlsCharacter_Actions'
import {
  ALS_MANTLING_SETTINGS,
} from './Settings/AlsMantlingSettings'

describe('UAlsAnimationInstance live mantling hook seam', () => {
  it('drains branching points after animation advancement and leaves action exit to NotifyEnd', () => {
    const character = createAlsCharacter()
    const runtime = createAlsMantlingNotifyRuntime()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const notify = settings.Montage.Notifies.find(
      (candidate) =>
        candidate.StateClassType
          === 'AlsAnimNotifyState_SetLocomotionAction',
    )
    if (!notify) throw new Error('Mantle action notify is missing')
    const events: AlsMantlingMontageNotifyEvent[] = [{
      instanceId: 73,
      mantlingSettings: settings,
      notify,
      notifyEventType: 'Begin',
      triggerTime: notify.StartTime,
    }]
    const montage: AlsMantlingMontageBridge = {
      play() {
        return null
      },
      montageSetPosition() {
        return false
      },
      montageStop() {
        return false
      },
      stopMontageInstance() {
        return false
      },
      takeNotifyEvents() {
        return events.splice(0, events.length)
      },
    }

    refreshAlsAnimationMantlingNotifies(
      runtime,
      character,
      montage,
    )
    expect(character.locomotionAction).toBe('Mantling')
    expect(events).toHaveLength(0)

    // StopMantling intentionally does not clear this action. The retained montage's eventual
    // branching-point teardown owns the delayed exit.
    events.push({
      instanceId: 73,
      mantlingSettings: settings,
      notify,
      notifyEventType: 'End',
      triggerTime: notify.EndTime,
    })
    refreshAlsAnimationMantlingNotifies(
      runtime,
      character,
      montage,
    )
    expect(character.locomotionAction).toBeNull()
  })
})
