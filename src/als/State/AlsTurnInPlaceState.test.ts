import { describe, expect, it } from 'vitest'
import {
  calculateTurnInPlacePlayRate,
  selectTurnInPlaceClip,
} from '../Settings/AlsTurnInPlaceSettings'
import {
  createAlsTurnInPlaceState,
  getTurnInPlaceActivationDelay,
  refreshTurnInPlace,
  resetTurnInPlaceFrame,
  takeQueuedTurnInPlaceAnimation,
} from './AlsTurnInPlaceState'

describe('ALS turn in place', () => {
  it('initializes the full FAlsTurnInPlaceState payload', () => {
    expect(createAlsTurnInPlaceState()).toEqual({
      updatedThisFrame: false,
      activationDelay: 0,
      queuedSettings: null,
      queuedSlotName: null,
      queuedTurnYawAngle: 0,
      playRate: 1,
    })
  })

  it('requires yaw speed below 50 and absolute yaw strictly above 45 degrees', () => {
    const state = createAlsTurnInPlaceState()
    const base = {
      delta: 1,
      transitionsAllowed: true,
      stance: 'Standing' as const,
    }

    expect(refreshTurnInPlace(state, {
      ...base,
      viewYawAngle: 90,
      viewYawSpeed: 50,
    })).toBeNull()
    resetTurnInPlaceFrame(state)
    expect(refreshTurnInPlace(state, {
      ...base,
      viewYawAngle: 45,
      viewYawSpeed: 0,
    })).toBeNull()
    expect(state.activationDelay).toBe(0)
  })

  it('maps 45..180 degrees to 0..0.75 seconds and fires only after the delay', () => {
    expect(getTurnInPlaceActivationDelay(45)).toBe(0)
    expect(getTurnInPlaceActivationDelay(90)).toBeCloseTo(0.25)
    expect(getTurnInPlaceActivationDelay(180)).toBeCloseTo(0.75)

    const state = createAlsTurnInPlaceState()
    const input = {
      delta: 0.25,
      transitionsAllowed: true,
      viewYawAngle: 90,
      viewYawSpeed: 0,
      stance: 'Standing' as const,
    }
    expect(refreshTurnInPlace(state, input)).toBeNull()
    resetTurnInPlaceFrame(state)
    const request = refreshTurnInPlace(state, { ...input, delta: 0.001 })
    expect(request?.settings.clip).toBe('A_Als_Turn_90_Right')
    expect(state.activationDelay).toBeCloseTo(0.251)
  })

  it('retains activation delay on request and lets the transition gate clear it next frame', () => {
    const state = createAlsTurnInPlaceState()
    const input = {
      delta: 0.01,
      transitionsAllowed: true,
      viewYawAngle: 180,
      viewYawSpeed: 0,
      stance: 'Standing' as const,
    }

    state.activationDelay = 0.75
    expect(refreshTurnInPlace(state, input)).not.toBeNull()
    expect(state.activationDelay).toBeCloseTo(0.76)

    // The per-frame latch prevents duplicate graph calls from queuing the montage twice.
    expect(refreshTurnInPlace(state, input)).toBeNull()
    expect(state.activationDelay).toBeCloseTo(0.76)

    resetTurnInPlaceFrame(state)
    expect(refreshTurnInPlace(state, {
      ...input,
      transitionsAllowed: false,
    })).toBeNull()
    expect(state.activationDelay).toBe(0)
  })

  it('selects stance, angle, and direction including the near-180 CCW bias', () => {
    expect(selectTurnInPlaceClip('Standing', 129).settings.clip)
      .toBe('A_Als_Turn_90_Right')
    expect(selectTurnInPlaceClip('Standing', 130).settings.clip)
      .toBe('A_Als_Turn_180_Right')
    expect(selectTurnInPlaceClip('Crouching', -130).settings.clip)
      .toBe('A_Als_Crouch_Turn_180_Left')
    expect(selectTurnInPlaceClip('Standing', 176).settings.clip)
      .toBe('A_Als_Turn_180_Left')
  })

  it('scales the authored 1.2 play rate by queued angle over animated angle', () => {
    const selected = selectTurnInPlaceClip('Standing', 100)
    expect(calculateTurnInPlacePlayRate(100, selected.settings))
      .toBeCloseTo(1.2 * 100 / 90)
  })

  it('defers playback, lets a pending stop win, and clears the queue on take', () => {
    const state = createAlsTurnInPlaceState()
    state.activationDelay = 1
    const request = refreshTurnInPlace(state, {
      delta: 1 / 60,
      transitionsAllowed: true,
      viewYawAngle: -100,
      viewYawSpeed: 0,
      stance: 'Crouching',
    })
    expect(request?.settings.clip).toBe('A_Als_Crouch_Turn_90_Left')
    expect(state.queuedSlotName).toBe('TurnInPlaceCrouching')
    expect(state.playRate).toBe(1)

    expect(takeQueuedTurnInPlaceAnimation(state, true)).toBeNull()
    expect(state.queuedSettings?.clip).toBe('A_Als_Crouch_Turn_90_Left')

    const queued = takeQueuedTurnInPlaceAnimation(state, false)
    expect(queued).toMatchObject({
      slotName: 'TurnInPlaceCrouching',
      queuedTurnYawAngle: -100,
      playRate: 1.2 * 100 / 90,
    })
    expect(state.playRate).toBeCloseTo(1.2 * 100 / 90)
    expect(state.queuedSettings).toBeNull()
    expect(state.queuedSlotName).toBeNull()
    expect(state.queuedTurnYawAngle).toBe(0)
  })
})
