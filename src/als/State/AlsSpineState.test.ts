import { describe, expect, it } from 'vitest'
import {
  createAlsSpineState,
  refreshSpine,
} from './AlsSpineState'
import type { AlsSpineInput } from './AlsSpineState'

const baseInput: AlsSpineInput = {
  spineRotationAllowed: false,
  spineBlendAmount: 1,
  deltaTime: 1 / 60,
  pendingUpdate: false,
  viewYawAngle: 0,
  viewYawSpeed: 0,
  actorYawAngle: 0,
  movementBaseHasRelativeRotation: false,
  movementBaseDeltaRotationYaw: 0,
}

describe('FAlsSpineState parity', () => {
  it('initializes every field to the FAlsSpineState defaults', () => {
    expect(createAlsSpineState()).toEqual({
      spineRotationAllowed: false,
      spineAmount: 0,
      spineAmountScale: 1,
      spineAmountBias: 0,
      lastYawAngle: 0,
      currentYawAngle: 0,
      yawAngle: 0,
      lastActorYawAngle: 0,
    })
  })

  it('remaps a partial amount on enable without changing the current yaw', () => {
    const state = createAlsSpineState()
    state.spineAmount = 0.25
    state.currentYawAngle = 40

    const result = refreshSpine(state, {
      ...baseInput,
      spineRotationAllowed: true,
      deltaTime: 0,
      viewYawAngle: -100,
      actorYawAngle: 20,
    })

    expect(result).toBe(state)
    expect(state.spineAmountScale).toBeCloseTo(4 / 3, 12)
    expect(state.spineAmountBias).toBeCloseTo(-1 / 3, 12)
    expect(state.lastYawAngle).toBe(40)
    expect(state.lastActorYawAngle).toBe(20)
    expect(state.currentYawAngle).toBeCloseTo(40, 12)
  })

  it('remaps a partial amount on disable without changing the current yaw', () => {
    const state = createAlsSpineState()
    state.spineRotationAllowed = true
    state.spineAmount = 0.4
    state.currentYawAngle = 60

    refreshSpine(state, {
      ...baseInput,
      spineRotationAllowed: false,
      deltaTime: 0,
      actorYawAngle: 30,
    })

    expect(state.spineAmountScale).toBeCloseTo(2.5, 12)
    expect(state.spineAmountBias).toBe(0)
    expect(state.currentYawAngle).toBeCloseTo(60, 12)
  })

  it('snaps an allowed spine to view yaw on a pending update', () => {
    const state = createAlsSpineState()
    refreshSpine(state, {
      ...baseInput,
      spineRotationAllowed: true,
      pendingUpdate: true,
      viewYawAngle: -135,
      spineBlendAmount: 0.5,
    })

    expect(state.spineAmount).toBe(1)
    expect(state.currentYawAngle).toBe(-135)
    expect(state.yawAngle).toBeCloseTo(-67.5, 12)
  })

  it('enables at the fixed 20/s InvExpApprox rate', () => {
    const state = createAlsSpineState()
    state.spineRotationAllowed = true

    refreshSpine(state, {
      ...baseInput,
      spineRotationAllowed: true,
      deltaTime: 0.05,
      viewYawAngle: 90,
    })

    const amount = 0.6316758747697974
    expect(state.spineAmount).toBeCloseTo(amount, 15)
    expect(state.currentYawAngle).toBeCloseTo(90 * amount, 12)
  })

  it('multiplies the 1/s disable rate by fast camera yaw', () => {
    const state = createAlsSpineState()
    state.spineAmount = 1
    state.spineAmountScale = 1
    state.lastYawAngle = 80

    refreshSpine(state, {
      ...baseInput,
      deltaTime: 0.5,
      viewYawSpeed: 80,
    })

    // abs(80) / 40 = 2, so lambda * dt = 1.
    expect(state.spineAmount).toBeCloseTo(1 - 0.6316758747697974, 15)
  })

  it('keeps fade-out world-relative and clamps actor yaw offset to 30 degrees', () => {
    const state = createAlsSpineState()
    state.spineAmount = 0.5
    state.spineAmountScale = 2
    state.lastYawAngle = 20
    state.lastActorYawAngle = 0

    refreshSpine(state, {
      ...baseInput,
      deltaTime: 0,
      actorYawAngle: -100,
      movementBaseHasRelativeRotation: true,
      movementBaseDeltaRotationYaw: 20,
    })

    expect(state.lastActorYawAngle).toBe(-70)
    expect(state.currentYawAngle).toBeCloseTo(50, 12)
  })

  it('uses Unreal animation-weight thresholds at their exact boundaries', () => {
    const full = createAlsSpineState()
    full.spineRotationAllowed = true
    full.spineAmount = 0.99999
    refreshSpine(full, {
      ...baseInput,
      spineRotationAllowed: true,
      viewYawAngle: 45,
    })
    expect(full.spineAmount).toBe(1)
    expect(full.currentYawAngle).toBe(45)

    const irrelevant = createAlsSpineState()
    irrelevant.spineAmount = 0.00001
    irrelevant.currentYawAngle = 20
    refreshSpine(irrelevant, baseInput)
    expect(irrelevant.spineAmount).toBe(0)
    expect(irrelevant.currentYawAngle).toBe(0)
  })
})
