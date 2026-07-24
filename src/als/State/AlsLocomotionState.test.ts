import { describe, expect, it } from 'vitest'
import {
  ALS_HAS_SPEED_THRESHOLD,
  ALS_MOVING_SPEED_THRESHOLD,
  createAlsLocomotionState,
  directionToAngleXY,
  refreshLocomotionState,
  unwindDegrees,
} from './AlsLocomotionState'

describe('FAlsLocomotionState parity', () => {
  it('initializes retained direction and target yaws from actor yaw', () => {
    // AlsCharacter.cpp:122-127 initializes target, input, and velocity yaw from actor yaw.
    const state = createAlsLocomotionState(190)

    expect(state.inputYawAngle).toBe(-170)
    expect(state.velocityYawAngle).toBe(-170)
    expect(state.targetYawAngle).toBe(-170)
    expect(state.smoothTargetYawAngle).toBe(-170)
    expect(state.rotationTowardsLastInputDirectionBlocked).toBe(true)
    expect(state.aimingYawAngleLimit).toBe(180)
    expect(state.resetAimingLimit).toBe(true)
  })

  it('uses ALS X-forward/Y-right direction angles and UE unwind boundaries', () => {
    // AlsVector.h:155-163 is degrees(atan2(Y, X)); FMath::UnwindDegrees retains ±180.
    expect(directionToAngleXY({ x: 1, y: 0, z: 0 })).toBe(0)
    expect(directionToAngleXY({ x: 0, y: 1, z: 0 })).toBe(90)
    expect(directionToAngleXY({ x: 0, y: -1, z: 0 })).toBe(-90)
    expect(unwindDegrees(540)).toBe(180)
    expect(unwindDegrees(-540)).toBe(-180)
  })

  it('uses the authored centimetre thresholds after converting to metres', () => {
    // AlsCharacter.cpp:1388-1390 uses >= 1 cm/s for bHasVelocity.
    expect(ALS_HAS_SPEED_THRESHOLD).toBe(0.01)
    // AlsCharacterSettings.h:21 uses 50 cm/s for MovingSpeedThreshold.
    expect(ALS_MOVING_SPEED_THRESHOLD).toBe(0.5)

    const state = createAlsLocomotionState(37)
    refreshLocomotionState(
      state,
      { x: ALS_HAS_SPEED_THRESHOLD - 1e-6, y: 0, z: 20 },
      true,
    )
    expect(state.hasVelocity).toBe(false)
    expect(state.velocityYawAngle).toBe(37)
    expect(state.speed).toBeCloseTo(ALS_HAS_SPEED_THRESHOLD - 1e-6, 12)

    refreshLocomotionState(
      state,
      { x: 0, y: ALS_HAS_SPEED_THRESHOLD, z: -3 },
      true,
    )
    expect(state.hasVelocity).toBe(true)
    expect(state.velocityYawAngle).toBe(90)
    expect(state.moving).toBe(true)
  })

  it('requires input plus velocity below the independent moving-speed threshold', () => {
    // AlsCharacter.cpp:1436-1439:
    // (bHasInput && bHasVelocity) || Speed > Settings->MovingSpeedThreshold.
    const state = createAlsLocomotionState()

    refreshLocomotionState(
      state,
      { x: ALS_MOVING_SPEED_THRESHOLD, y: 0, z: 0 },
      false,
    )
    expect(state.moving).toBe(false)

    refreshLocomotionState(
      state,
      { x: ALS_MOVING_SPEED_THRESHOLD + 1e-6, y: 0, z: 0 },
      false,
    )
    expect(state.moving).toBe(true)

    refreshLocomotionState(state, { x: 0.02, y: 0, z: 0 }, true)
    expect(state.moving).toBe(true)
  })

  it('copies bridge velocity instead of retaining its mutable object', () => {
    const state = createAlsLocomotionState()
    const bridgeVelocity = { x: 1, y: 2, z: 3 }
    refreshLocomotionState(state, bridgeVelocity, true)
    bridgeVelocity.x = 99

    expect(state.velocity).toEqual({ x: 1, y: 2, z: 3 })
  })
})
