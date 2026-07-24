import { describe, expect, it, vi } from 'vitest'
import {
  ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS,
  getAlsAnimNotifyStateEarlyBlendOutName,
  shouldAlsAnimNotifyStateEarlyBlendOut,
  tickAlsAnimNotifyStateEarlyBlendOut,
} from './AlsAnimNotifyState_EarlyBlendOut'

const resting = {
  bHasInput: false,
  LocomotionMode: 'Grounded',
  RotationMode: 'ViewDirection',
  Stance: 'Standing',
} as const

describe('UAlsAnimNotifyState_EarlyBlendOut', () => {
  it('retains every native default', () => {
    expect(
      ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS,
    ).toEqual({
      BlendOutDuration: 0.25,
      bCheckInput: true,
      bCheckLocomotionMode: true,
      bCheckRotationMode: true,
      bCheckStance: true,
      LocomotionModeEquals: 'InAir',
      RotationModeEquals: 'Aiming',
      StanceEquals: 'Crouching',
    })
    expect(getAlsAnimNotifyStateEarlyBlendOutName())
      .toBe('Als Early Blend Out')
  })

  it('ORs only the enabled character conditions', () => {
    const defaults =
      ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS
    expect(shouldAlsAnimNotifyStateEarlyBlendOut(resting, defaults))
      .toBe(false)
    expect(shouldAlsAnimNotifyStateEarlyBlendOut({
      ...resting,
      bHasInput: true,
    }, defaults)).toBe(true)
    expect(shouldAlsAnimNotifyStateEarlyBlendOut({
      ...resting,
      LocomotionMode: 'InAir',
    }, defaults)).toBe(true)
    expect(shouldAlsAnimNotifyStateEarlyBlendOut({
      ...resting,
      RotationMode: 'Aiming',
    }, defaults)).toBe(true)
    expect(shouldAlsAnimNotifyStateEarlyBlendOut({
      ...resting,
      Stance: 'Crouching',
    }, defaults)).toBe(true)
    expect(shouldAlsAnimNotifyStateEarlyBlendOut({
      ...resting,
      bHasInput: true,
    }, {
      ...defaults,
      bCheckInput: false,
    })).toBe(false)
  })

  it('stops the exact montage instance with the authored duration', () => {
    const StopMontageInstance = vi.fn(() => true)
    expect(tickAlsAnimNotifyStateEarlyBlendOut(
      { StopMontageInstance },
      0,
      { ...resting, bHasInput: true },
      {
        ...ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS,
        BlendOutDuration: 0.2,
      },
    )).toBe(true)
    expect(StopMontageInstance).toHaveBeenCalledExactlyOnceWith(0, 0.2)

    expect(tickAlsAnimNotifyStateEarlyBlendOut(
      { StopMontageInstance },
      1,
      resting,
      ALS_ANIM_NOTIFY_STATE_EARLY_BLEND_OUT_DEFAULTS,
    )).toBe(false)
    expect(StopMontageInstance).toHaveBeenCalledTimes(1)
  })
})
