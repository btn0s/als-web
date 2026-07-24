import { describe, expect, it } from 'vitest'
import {
  createAlsLookState,
  refreshLook,
} from './AlsLookState'
import type { AlsLookInput } from './AlsLookState'

const baseInput: AlsLookInput = {
  rotationMode: 'ViewDirection',
  actorYawAngle: 0,
  movementBaseHasRelativeRotation: false,
  movementBaseDeltaRotationYaw: 0,
  hasInput: false,
  inputYawAngle: 0,
  targetYawAngle: 0,
  viewYawAngle: 0,
  viewPitchAngle: 0,
  locomotionYawSpeed: 0,
  deltaTime: 1 / 60,
}

describe('FAlsLookState parity', () => {
  it('initializes every field to the FAlsLookState defaults', () => {
    expect(createAlsLookState()).toEqual({
      initializationRequired: true,
      worldYawAngle: 0,
      yawAngle: 0,
      pitchAngle: 0,
      yawForwardAmount: 0.5,
      yawLeftAmount: 0.5,
      yawRightAmount: 0.5,
    })
  })

  it('looks toward input in VelocityDirection and forces pitch to zero', () => {
    const state = createAlsLookState()
    const result = refreshLook(state, {
      ...baseInput,
      rotationMode: 'VelocityDirection',
      actorYawAngle: 170,
      hasInput: true,
      inputYawAngle: -170,
      viewPitchAngle: 45,
    })

    expect(result).toBe(state)
    expect(state.initializationRequired).toBe(false)
    expect(state.yawAngle).toBe(20)
    expect(state.pitchAngle).toBe(0)
    expect(state.worldYawAngle).toBe(-170)
  })

  it('uses retained target yaw without input and camera yaw/pitch in other modes', () => {
    const velocityState = createAlsLookState()
    refreshLook(velocityState, {
      ...baseInput,
      rotationMode: 'VelocityDirection',
      actorYawAngle: 30,
      targetYawAngle: -150,
      viewYawAngle: 80,
      viewPitchAngle: 45,
    })
    expect(velocityState.yawAngle).toBe(-180)
    expect(velocityState.pitchAngle).toBe(0)

    const aimingState = createAlsLookState()
    refreshLook(aimingState, {
      ...baseInput,
      rotationMode: 'Aiming',
      viewYawAngle: -75,
      viewPitchAngle: 35,
    })
    expect(aimingState.yawAngle).toBe(-75)
    expect(aimingState.pitchAngle).toBe(35)
  })

  it('snaps immediately when the selected interpolation speed is zero', () => {
    const state = createAlsLookState()
    state.initializationRequired = false
    state.worldYawAngle = -120
    state.yawAngle = -120
    state.pitchAngle = -30

    refreshLook(state, {
      ...baseInput,
      viewYawAngle: 70,
      viewPitchAngle: 25,
    }, {
      lookTowardsCameraRotationInterpolationSpeed: 0,
      lookTowardsInputYawAngleInterpolationSpeed: 8,
    })

    expect(state.yawAngle).toBe(70)
    expect(state.pitchAngle).toBe(25)
  })

  it('preserves world-space continuity across movement-base rotation', () => {
    const state = createAlsLookState()
    state.initializationRequired = false
    state.worldYawAngle = 40
    state.yawAngle = 30
    state.pitchAngle = -20

    refreshLook(state, {
      ...baseInput,
      actorYawAngle: 10,
      movementBaseHasRelativeRotation: true,
      movementBaseDeltaRotationYaw: 20,
      viewYawAngle: 100,
      viewPitchAngle: 20,
      deltaTime: 0.125,
    })

    // InvExpApprox(1) gives the exact ALS interpolation amount 0.6316758747697974.
    const amount = 0.6316758747697974
    expect(state.yawAngle).toBeCloseTo(50 + 50 * amount, 12)
    expect(state.pitchAngle).toBeCloseTo(-20 + 40 * amount, 12)
    expect(state.worldYawAngle).toBeCloseTo(10 + state.yawAngle, 12)
  })

  it('biases near-positive-180 deltas counterclockwise', () => {
    const state = createAlsLookState()
    state.initializationRequired = false

    refreshLook(state, {
      ...baseInput,
      viewYawAngle: 176,
      deltaTime: 0.001,
    })

    expect(state.yawAngle).toBeLessThan(0)
  })

  it('favors the locomotion yaw direction beyond 90 degrees', () => {
    const positive = createAlsLookState()
    positive.initializationRequired = false
    positive.worldYawAngle = 100
    const negative = { ...positive }

    refreshLook(positive, {
      ...baseInput,
      viewYawAngle: -100,
      locomotionYawSpeed: 1,
      deltaTime: 0.001,
    })
    refreshLook(negative, {
      ...baseInput,
      viewYawAngle: -100,
      locomotionYawSpeed: -1,
      deltaTime: 0.001,
    })

    expect(positive.yawAngle).toBeGreaterThan(100)
    expect(negative.yawAngle).toBeLessThan(100)
  })

  it.each([-180, -90, 0, 90, 180])(
    'derives the three authored yaw blend amounts at %s degrees',
    (yawAngle) => {
      const state = createAlsLookState()
      refreshLook(state, {
        ...baseInput,
        viewYawAngle: yawAngle,
      })

      expect(state.yawForwardAmount).toBeCloseTo(yawAngle / 360 + 0.5, 12)
      expect(state.yawLeftAmount + state.yawRightAmount).toBeCloseTo(1, 12)
      expect(state.yawLeftAmount).toBeLessThanOrEqual(0.5)
      expect(state.yawRightAmount).toBeGreaterThanOrEqual(0.5)
    },
  )
})
