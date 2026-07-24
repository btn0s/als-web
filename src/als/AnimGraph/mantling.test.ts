import { describe, expect, it } from 'vitest'
import {
  ALS_MANTLING_SETTINGS,
} from '../Settings/AlsMantlingSettings'
import {
  createAlsMantlingMontageState,
  getAlsMantlingBranchingPointTime,
  refreshAlsMantlingMontage,
  stopAlsMantlingMontage,
} from './mantling'

const restingInput = {
  DeltaTime: 1 / 60,
  bHasInput: false,
  LocomotionMode: null,
  RotationMode: 'ViewDirection',
  Stance: 'Standing',
} as const

describe('ALS PostLocomotion mantling montage', () => {
  it('releases LocomotionAction on the extracted branching-point timestamp', () => {
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const state = createAlsMantlingMontageState(1, settings, 0.5)
    const movementAction = settings.Montage.Notifies[0]
    const end = getAlsMantlingBranchingPointTime(
      settings.Montage,
      movementAction,
      'End',
    )

    refreshAlsMantlingMontage(state, {
      ...restingInput,
      AuthoritativeMontagePosition: end - 1e-8,
    })
    expect(state.bMovementActionActive).toBe(true)
    expect(state.bMovementActionEndedThisFrame).toBe(false)

    refreshAlsMantlingMontage(state, {
      ...restingInput,
      AuthoritativeMontagePosition: end,
    })
    expect(state.bMovementActionActive).toBe(false)
    expect(state.bMovementActionEndedThisFrame).toBe(true)
    expect(end).toBeCloseTo(0.9665666, 7)
  })

  it.each([
    ['input', { bHasInput: true }],
    ['InAir mode', { LocomotionMode: 'InAir' as const }],
    ['Aiming mode', { RotationMode: 'Aiming' as const }],
    ['Crouching stance', { Stance: 'Crouching' as const }],
  ])('runs the authored early blend-out for %s', (_label, override) => {
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const state = createAlsMantlingMontageState(2, settings, 0.5)
    refreshAlsMantlingMontage(state, {
      ...restingInput,
      ...override,
      DeltaTime: 0.2,
      AuthoritativeMontagePosition: 1,
    })

    expect(state.Status).toBe('BlendingOut')
    expect(state.BlendOutDuration).toBeCloseTo(0.35)
    expect(state.bStartedBlendOutThisFrame).toBe(true)
    const startingWeight = state.Weight

    refreshAlsMantlingMontage(state, {
      ...restingInput,
      ...override,
      DeltaTime: 0.35,
      AuthoritativeMontagePosition: 1.35,
    })
    expect(state.Weight).toBeLessThan(startingWeight)
    expect(state.Status).toBe('Completed')
    expect(state.bCompletedThisFrame).toBe(true)
  })

  it('does not early blend outside the notify state or without a checked condition', () => {
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low
    const before = createAlsMantlingMontageState(3, settings, 0.5)
    refreshAlsMantlingMontage(before, {
      ...restingInput,
      bHasInput: true,
      AuthoritativeMontagePosition: 0.99999,
    })
    expect(before.Status).toBe('Playing')

    const noCondition = createAlsMantlingMontageState(4, settings, 0.5)
    refreshAlsMantlingMontage(noCondition, {
      ...restingInput,
      AuthoritativeMontagePosition: 1,
    })
    expect(noCondition.Status).toBe('Playing')
  })

  it('uses the root-motion source position instead of advancing a second clock', () => {
    const settings = ALS_MANTLING_SETTINGS.MS_Als_High
    const state = createAlsMantlingMontageState(5, settings, 0.6)
    refreshAlsMantlingMontage(state, {
      ...restingInput,
      DeltaTime: 0.5,
      AuthoritativeMontagePosition: 0.75,
    })
    expect(state.MontagePosition).toBe(0.75)

    refreshAlsMantlingMontage(state, {
      ...restingInput,
      DeltaTime: 0.25,
    })
    expect(state.MontagePosition).toBeCloseTo(1.05, 7)
  })

  it('uses authored natural blend-out and preserves its terminal frame', () => {
    const settings = ALS_MANTLING_SETTINGS.MS_Als_High
    const state = createAlsMantlingMontageState(6, settings, 0.6)
    refreshAlsMantlingMontage(state, {
      ...restingInput,
      DeltaTime: 0.2,
      AuthoritativeMontagePosition: settings.Montage.PlayLength,
    })
    expect(state.Status).toBe('BlendingOut')
    expect(state.BlendOutDuration).toBeCloseTo(0.2)
    expect(state.Weight).toBeCloseTo(1, 12)

    refreshAlsMantlingMontage(state, {
      ...restingInput,
      DeltaTime: state.BlendOutDuration,
      AuthoritativeMontagePosition: settings.Montage.PlayLength,
    })
    expect(state.Status).toBe('Completed')
    expect(state.Weight).toBe(0)
    expect(state.bCompletedThisFrame).toBe(true)

    refreshAlsMantlingMontage(state, restingInput)
    expect(state.bCompletedThisFrame).toBe(false)
    expect(state.Status).toBe('Completed')
  })

  it('validates explicit stop inputs and completes a zero-duration stop', () => {
    const state = createAlsMantlingMontageState(
      7,
      ALS_MANTLING_SETTINGS.MS_Als_Low,
      0.5,
    )
    expect(() => stopAlsMantlingMontage(state, Number.NaN))
      .toThrow('BlendOutDuration')
    stopAlsMantlingMontage(state, 0)
    expect(state.Status).toBe('Completed')
    expect(state.Weight).toBe(0)
  })
})
