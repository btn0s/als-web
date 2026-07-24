import { describe, expect, it } from 'vitest'
import type {
  AlsMantlingMontageBridge,
  AlsMantlingMontageNotifyEvent,
  AlsRollingMontageBridge,
  AlsRollingMontageNotifyEvent,
} from './AlsAnimationInstance'
import {
  dispatchAlsQueuedAnimationEvents,
  refreshAlsAnimationMantlingNotifies,
  refreshAlsAnimationRollingNotifies,
} from './AlsAnimationInstance.hooks'
import {
  createRootMotionMovementParams,
} from '../engine/rootMotion'
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

describe('UAnimInstance queued-notify frame seam', () => {
  it('dispatches the held queue through the camera-manager interface', () => {
    const events: unknown[] = []
    const cameraManager = {
      StartCameraShake(
        CameraShakeClass: string | null,
        Scale = 1,
      ) {
        events.push([CameraShakeClass, Scale])
        return null
      },
    }
    const animationInstance = {
      dispatchQueuedAnimEvents(sink: typeof cameraManager) {
        sink.StartCameraShake('B_Als_CameraShake_Sprint_C', 1.25)
        return 1
      },
    }

    expect(dispatchAlsQueuedAnimationEvents(
      animationInstance,
      cameraManager,
    )).toBe(1)
    expect(events).toEqual([
      ['B_Als_CameraShake_Sprint_C', 1.25],
    ])
  })
})

describe('UAlsAnimationInstance live Roll hook seam', () => {
  it('dispatches action, root scale, and FromRoll events in retained queue order', () => {
    const character = createAlsCharacter()
    const events: AlsRollingMontageNotifyEvent[] = [
      {
        instanceId: 4,
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetLocomotionAction',
        notifyEventType: 'Begin',
        triggerTime: 0,
        LocomotionAction: 'Rolling',
      },
      {
        instanceId: 4,
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetRootMotionScale',
        notifyEventType: 'Begin',
        triggerTime: 0,
        TranslationScale: 1.3,
      },
      {
        instanceId: 4,
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass: 'AlsAnimNotify_SetGroundedEntryMode',
        notifyEventType: 'Notify',
        triggerTime: 0.933333,
        GroundedEntryMode:
          'Als.GroundedEntryMode.FromRoll',
      },
      {
        instanceId: 4,
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetLocomotionAction',
        notifyEventType: 'End',
        triggerTime: 0.933333,
        LocomotionAction: 'Rolling',
      },
      {
        instanceId: 4,
        montage: 'AM_Als_Roll',
        sequence: 'A_Als_Roll',
        notifyClass:
          'AlsAnimNotifyState_SetRootMotionScale',
        notifyEventType: 'End',
        triggerTime: 1.5,
        TranslationScale: 1.3,
      },
    ]
    const rootMotion = createRootMotionMovementParams()
    const montage: AlsRollingMontageBridge = {
      Montage_IsPlaying: () => false,
      Montage_Play: () => 0,
      takeNotifyEvents: () =>
        events.splice(0, events.length),
      ConsumeExtractedRootMotion: () => rootMotion,
    }
    const groundedEntryObservations: unknown[] = []
    const animationInstance = {
      SetGroundedEntryMode(
        GroundedEntryMode:
          'Als.GroundedEntryMode.FromRoll' | null,
      ) {
        groundedEntryObservations.push({
          GroundedEntryMode,
          action: character.locomotionAction,
          scale: character.animRootMotionTranslationScale,
        })
      },
    }

    expect(refreshAlsAnimationRollingNotifies(
      animationInstance,
      character,
      montage,
    )).toBe(5)
    expect(groundedEntryObservations).toEqual([{
      GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll',
      action: 'Rolling',
      scale: 1.3,
    }])
    expect(character.locomotionAction).toBeNull()
    expect(character.animRootMotionTranslationScale).toBe(1)
    expect(events).toHaveLength(0)
  })
})
