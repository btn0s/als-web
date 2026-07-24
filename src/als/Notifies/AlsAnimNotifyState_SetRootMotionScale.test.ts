import { describe, expect, it, vi } from 'vitest'
import {
  ALS_ANIM_NOTIFY_STATE_SET_ROOT_MOTION_SCALE_DEFAULTS,
  getAlsAnimNotifyStateSetRootMotionScaleName,
  notifyAlsAnimNotifyStateSetRootMotionScaleBegin,
  notifyAlsAnimNotifyStateSetRootMotionScaleEnd,
} from './AlsAnimNotifyState_SetRootMotionScale'

function character(
  LocalRole:
    'None' | 'SimulatedProxy' | 'AutonomousProxy' | 'Authority',
) {
  let scale = 1
  return {
    LocalRole,
    GetAnimRootMotionTranslationScale: () => scale,
    SetAnimRootMotionTranslationScale: (value: number) => {
      scale = value
    },
  }
}

describe('UAlsAnimNotifyState_SetRootMotionScale', () => {
  it('sets autonomous/authority characters and ignores lower roles', () => {
    const notify = { TranslationScale: 1.3 }
    for (const role of ['AutonomousProxy', 'Authority'] as const) {
      const target = character(role)
      notifyAlsAnimNotifyStateSetRootMotionScaleBegin(target, notify)
      expect(target.GetAnimRootMotionTranslationScale()).toBe(1.3)
    }
    for (const role of ['None', 'SimulatedProxy'] as const) {
      const target = character(role)
      notifyAlsAnimNotifyStateSetRootMotionScaleBegin(target, notify)
      expect(target.GetAnimRootMotionTranslationScale()).toBe(1)
    }
  })

  it('resets only the scale installed by the same notify', () => {
    const target = character('Authority')
    const notify = { TranslationScale: 1.3 }
    const Warn = vi.fn()
    notifyAlsAnimNotifyStateSetRootMotionScaleBegin(target, notify)
    expect(notifyAlsAnimNotifyStateSetRootMotionScaleEnd(
      target,
      notify,
      Warn,
    )).toBe('Reset')
    expect(target.GetAnimRootMotionTranslationScale()).toBe(1)

    target.SetAnimRootMotionTranslationScale(2)
    expect(notifyAlsAnimNotifyStateSetRootMotionScaleEnd(
      target,
      notify,
      Warn,
    )).toBe('Mismatched')
    expect(target.GetAnimRootMotionTranslationScale()).toBe(2)
    expect(Warn).toHaveBeenCalledTimes(1)
  })

  it('retains the native default and display formatting', () => {
    expect(
      ALS_ANIM_NOTIFY_STATE_SET_ROOT_MOTION_SCALE_DEFAULTS,
    ).toEqual({ TranslationScale: 1 })
    expect(getAlsAnimNotifyStateSetRootMotionScaleName(1.3))
      .toBe('Als Set Root Motion Scale: 1.30')
  })
})
