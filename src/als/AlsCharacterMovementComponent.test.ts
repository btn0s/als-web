import { describe, expect, it } from 'vitest'
import type { AlsMovementGaitSettings } from './Settings/AlsMovementSettings'
import {
  ALS_AIR_CONTROL,
  ALS_BRAKING_FRICTION_FACTOR_RESET_DELAY,
  ALS_HAS_INPUT_BRAKING_FRICTION_FACTOR,
  ALS_MAX_ACCELERATION,
  ALS_MIN_ANALOG_WALK_SPEED,
  ALS_NO_INPUT_BRAKING_FRICTION_FACTOR,
  UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_MULTIPLIER,
  UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_VELOCITY_THRESHOLD,
  calculateDirectionDependentGaitSpeeds,
  calculateGaitAmount,
  createAlsCharacterMovementComponent,
  refreshGroundedMovementSettings,
  setMaxAllowedGait,
  setMovementRotationMode,
  setMovementStance,
  setMovementVelocity,
  startAlsLandingBrakingFriction,
  stepGroundedVelocity,
  stepInAirVelocity,
} from './AlsCharacterMovementComponent'
import type { AlsCharacterMovementGaitSettings } from './AlsCharacterMovementComponent'

describe('UAlsCharacterMovementComponent grounded policy', () => {
  it('pins ALS and inherited CharacterMovement constructor values', () => {
    const component = createAlsCharacterMovementComponent()
    expect(component.airControl).toBe(ALS_AIR_CONTROL)
    expect(component.maxAcceleration).toBe(ALS_MAX_ACCELERATION)
    expect(component.minAnalogWalkSpeed).toBe(ALS_MIN_ANALOG_WALK_SPEED)
    expect(component.airControlBoostMultiplier)
      .toBe(UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_MULTIPLIER)
    expect(component.airControlBoostVelocityThreshold)
      .toBe(UE_CHARACTER_MOVEMENT_AIR_CONTROL_BOOST_VELOCITY_THRESHOLD)
    expect(component.brakingFrictionFactor).toBe(0)
  })

  it('refreshes gait settings when rotation mode or stance changes', () => {
    // AlsCharacterMovementComponent.cpp:914-944 indexes settings by RotationMode × Stance.
    const component = createAlsCharacterMovementComponent()
    expect(component.gaitSettings.walkForwardSpeed).toBe(1.75)

    setMovementRotationMode(component, 'Aiming')
    expect(component.gaitSettings.walkForwardSpeed).toBe(1.65)

    setMovementStance(component, 'Crouching')
    expect(component.gaitSettings.walkForwardSpeed).toBe(1.5)
    expect(component.gaitSettings.runForwardSpeed).toBe(2)
  })

  it('keeps per-character gait overrides through stance and rotation changes', () => {
    const customized = createAlsCharacterMovementComponent({
      gaitSpeedOverrides: {
        Standing: { walkForwardSpeed: 2.4, runForwardSpeed: 4 },
        Crouching: { walkForwardSpeed: 1.32, runForwardSpeed: 2.2 },
      },
    })
    const defaultCharacter = createAlsCharacterMovementComponent()
    expect(customized.gaitSettings.walkForwardSpeed).toBe(2.4)
    expect(customized.gaitSettings.runForwardSpeed).toBe(4)
    expect(defaultCharacter.gaitSettings.runForwardSpeed).toBe(3.75)
    setMovementRotationMode(customized, 'Aiming')
    expect(customized.gaitSettings.walkForwardSpeed).toBe(2.4)
    setMovementStance(customized, 'Crouching')
    expect(customized.gaitSettings.walkForwardSpeed).toBe(1.32)
    expect(customized.gaitSettings.runForwardSpeed).toBe(2.2)
    setMovementStance(customized, 'Standing')
    expect(customized.gaitSettings.runForwardSpeed).toBe(4)
  })

  it('maps exact authored speed anchors onto the 0..3 GaitAmount domain', () => {
    // AlsCharacterMovementComponent.cpp:981-997.
    expect(calculateGaitAmount(0, 1.75, 3.75, 6.5)).toBe(0)
    expect(calculateGaitAmount(1.75, 1.75, 3.75, 6.5)).toBe(1)
    expect(calculateGaitAmount(3.75, 1.75, 3.75, 6.5)).toBe(2)
    expect(calculateGaitAmount(6.5, 1.75, 3.75, 6.5)).toBe(3)
    expect(calculateGaitAmount(2.75, 1.75, 3.75, 6.5)).toBe(1.5)
  })

  it('selects max speed from MaxAllowedGait and samples authored movement curves', () => {
    // AlsCharacterMovementComponent.cpp:999-1029.
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 3.75, y: 0, z: 0 },
    })

    refreshGroundedMovementSettings(component, 0)
    expect(component.gaitAmount).toBe(2)
    expect(component.maxWalkSpeed).toBe(3.75)
    expect(component.maxAccelerationWalking).toBe(20)
    expect(component.brakingDecelerationWalking).toBe(12.5)
    expect(component.groundFriction).toBe(4)
    expect(component.rotationInterpolationSpeed).toBe(5)

    setMaxAllowedGait(component, 'Sprinting')
    refreshGroundedMovementSettings(component, 0)
    expect(component.maxWalkSpeed).toBe(6.5)
  })

  it('ports the dormant direction-dependent forward/backward interpolation branch', () => {
    // AlsMovementSettings.h:72-75 and AlsCharacterMovementComponent.cpp:952-979.
    const authoredShape: AlsMovementGaitSettings = {
      walkForwardSpeed: 2,
      walkBackwardSpeed: 1,
      runForwardSpeed: 4,
      runBackwardSpeed: 2,
      sprintSpeed: 6,
      movementCurve: 'normal',
      rotationCurve: 'normal',
    }
    const settings: AlsCharacterMovementGaitSettings = {
      ...authoredShape,
      allowDirectionDependentMovementSpeed: true,
    }

    expect(calculateDirectionDependentGaitSpeeds(
      settings,
      { x: 1, y: 0, z: 0 },
      0,
    )).toEqual({ walkSpeed: 2, runSpeed: 4 })

    const middleAngle = 112.5 * Math.PI / 180
    const middle = calculateDirectionDependentGaitSpeeds(
      settings,
      { x: Math.cos(middleAngle), y: Math.sin(middleAngle), z: 0 },
      0,
    )
    expect(middle.walkSpeed).toBeCloseTo(1.5, 12)
    expect(middle.runSpeed).toBeCloseTo(3, 12)

    expect(calculateDirectionDependentGaitSpeeds(
      settings,
      { x: -1, y: 0, z: 0 },
      0,
    )).toEqual({ walkSpeed: 1, runSpeed: 2 })
  })

  it('accelerates from rest with the authored curve value and respects the gait cap', () => {
    // Normal movement curve at GaitAmount 0 is 20 m/s²; MS_Als_Normal run cap is 3.75 m/s.
    const component = createAlsCharacterMovementComponent()

    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 0.1, 0)
    expect(component.velocity.x).toBeCloseTo(2, 12)
    expect(component.velocity.y).toBe(0)

    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 1, 0)
    expect(component.velocity.x).toBeCloseTo(3.75, 12)
  })

  it('uses braking deceleration without default frictional braking and preserves bridge Z', () => {
    // Component constructor lines 145-153 set BrakingFrictionFactor=0; at GaitAmount 2 the
    // authored Normal braking curve is 12.5 m/s² even though GroundFriction is 4.
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 3.75, y: 0, z: -7 },
    })

    stepGroundedVelocity(component, { x: 0, y: 0, z: 99 }, 0.1, 0)
    expect(component.velocity.x).toBeCloseTo(2.5, 12)
    expect(component.velocity.y).toBe(0)
    expect(component.velocity.z).toBe(-7)
  })

  it('uses ground friction to steer while accelerating', () => {
    // UCharacterMovementComponent::CalcVelocity() frictional steering branch.
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 1, y: 0, z: 0 },
    })

    stepGroundedVelocity(component, { x: 0, y: 1, z: 0 }, 0.1, 0)
    expect(component.velocity.x).toBeCloseTo(0.5, 12)
    expect(component.velocity.y).toBeCloseTo(2.5, 12)
  })

  it('brakes gradually toward a lowered max gait instead of snapping speed', () => {
    // AlsCharacter.cpp:991-1004 explicitly says actual gait remains Running while decelerating
    // after max gait becomes Walking.
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 3.75, y: 0, z: 0 },
    })
    setMaxAllowedGait(component, 'Walking')

    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 0.1, 0)
    expect(component.velocity.x).toBeCloseTo(2.5, 12)
    expect(component.velocity.x).toBeGreaterThan(component.maxWalkSpeed)

    setMovementVelocity(component, { x: 1.75, y: 0, z: 0 })
    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 0.1, 0)
    expect(component.velocity.x).toBe(1.75)
  })

  it('blocks movement input without suppressing authored braking', () => {
    // ConsumeInputVector(), AlsCharacterMovementComponent.cpp:202-218, returns zero when blocked.
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 1, y: 0, z: 0 },
    })
    component.inputBlocked = true

    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 0.05, 0)
    expect(component.velocity.x).toBeCloseTo(0.25, 12)
  })

  it('accepts consumer planar velocity after settings refresh while preserving vertical velocity', () => {
    const component = createAlsCharacterMovementComponent({ velocity: { x: 1, y: 2, z: 3 } })
    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 1 / 60, 0, (movement, input, dt) => {
      expect(movement.maxWalkSpeed).toBeGreaterThan(0)
      expect(input).toEqual({ x: 1, y: 0, z: 0 })
      expect(dt).toBe(1 / 60)
      return { x: 0.5, y: -0.25, z: 99 }
    })
    expect(component.velocity).toEqual({ x: 0.5, y: -0.25, z: 3 })
  })

  it('passes blocked input as zero and keeps ALS braking for a declined override', () => {
    const component = createAlsCharacterMovementComponent({ velocity: { x: 1, y: 0, z: 0 } })
    component.inputBlocked = true
    stepGroundedVelocity(component, { x: 1, y: 0, z: 0 }, 0.05, 0, (_movement, input) => {
      expect(input).toEqual({ x: 0, y: 0, z: 0 })
      return null
    })
    expect(component.velocity.x).toBeCloseTo(0.25, 12)
  })

  it('rejects non-finite consumer velocity without partially applying it', () => {
    const component = createAlsCharacterMovementComponent({ velocity: { x: 1, y: 0, z: 0 } })
    const baseline = createAlsCharacterMovementComponent({ velocity: { x: 1, y: 0, z: 0 } })
    stepGroundedVelocity(component, { x: 0, y: 0, z: 0 }, 0.05, 0, () => ({ x: 123, y: NaN, z: 0 }))
    stepGroundedVelocity(baseline, { x: 0, y: 0, z: 0 }, 0.05, 0)
    expect(component.velocity).toEqual(baseline.velocity)
  })

  it('uses UE MinAnalogWalkSpeed for low-amplitude input', () => {
    const component = createAlsCharacterMovementComponent()

    stepGroundedVelocity(component, { x: 0.05, y: 0, z: 0 }, 1, 0)

    expect(component.velocity.x).toBe(ALS_MIN_ANALOG_WALK_SPEED)
    expect(component.velocity.y).toBe(0)
  })

  it('applies ALS landing friction factors and resets them after 0.5 seconds', () => {
    const withInput = createAlsCharacterMovementComponent({
      velocity: { x: 3.75, y: 0, z: 0 },
    })
    startAlsLandingBrakingFriction(withInput, true)
    expect(withInput.brakingFrictionFactor)
      .toBe(ALS_HAS_INPUT_BRAKING_FRICTION_FACTOR)
    expect(withInput.brakingFrictionFactorResetTime)
      .toBe(ALS_BRAKING_FRICTION_FACTOR_RESET_DELAY)
    stepGroundedVelocity(withInput, { x: 0, y: 0, z: 0 }, 1 / 60, 0)
    expect(withInput.velocity.x).toBeCloseTo(3.4166666666666665, 12)

    const withoutInput = createAlsCharacterMovementComponent({
      velocity: { x: 3.75, y: 0, z: 0 },
    })
    startAlsLandingBrakingFriction(withoutInput, false)
    expect(withoutInput.brakingFrictionFactor)
      .toBe(ALS_NO_INPUT_BRAKING_FRICTION_FACTOR)
    stepGroundedVelocity(withoutInput, { x: 0, y: 0, z: 0 }, 1 / 60, 0)
    expect(withoutInput.velocity.x).toBeCloseTo(2.7916666666666665, 12)

    for (let tick = 1; tick < 30; tick += 1) {
      stepGroundedVelocity(
        withoutInput,
        { x: 0, y: 0, z: 0 },
        1 / 60,
        0,
      )
    }
    expect(withoutInput.brakingFrictionFactorResetTime).toBe(0)
    expect(withoutInput.brakingFrictionFactor).toBe(0)
  })
})

describe('UAlsCharacterMovementComponent falling policy', () => {
  it('uses authored AirControl and MaxAcceleration without grounded friction or braking', () => {
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 1, y: 0, z: 4.2 },
    })

    // 20 m/s² MaxAcceleration × 0.15 AirControl × 0.1 s = 0.3 m/s.
    stepInAirVelocity(component, { x: 0, y: 1, z: 0 }, 0.1)

    expect(component.airControl).toBe(ALS_AIR_CONTROL)
    expect(component.maxAcceleration).toBe(ALS_MAX_ACCELERATION)
    expect(component.velocity.x).toBe(1)
    expect(component.velocity.y).toBeCloseTo(0.3, 12)
    expect(component.velocity.z).toBe(4.2)
  })

  it('uses inherited low-speed AirControlBoost before the 25 cm/s threshold', () => {
    const component = createAlsCharacterMovementComponent()

    stepInAirVelocity(component, { x: 1, y: 0, z: 0 }, 0.1)

    expect(component.velocity.x).toBeCloseTo(0.6, 12)
    expect(component.velocity.y).toBe(0)
  })

  it('normalizes analog input without snapping inherited overspeed', () => {
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 6, y: 0, z: -2 },
    })

    stepInAirVelocity(component, { x: 1, y: 1, z: 0 }, 0.1)

    expect(Math.hypot(component.velocity.x, component.velocity.y))
      .toBeCloseTo(6, 12)
    expect(component.velocity.x).toBeGreaterThan(0)
    expect(component.velocity.y).toBeGreaterThan(0)
    expect(component.velocity.z).toBe(-2)
  })

  it('does not brake with no input and honors blocked input', () => {
    const component = createAlsCharacterMovementComponent({
      velocity: { x: 2, y: -1, z: 3 },
    })

    stepInAirVelocity(component, { x: 0, y: 0, z: 0 }, 1)
    expect(component.velocity).toEqual({ x: 2, y: -1, z: 3 })

    component.inputBlocked = true
    stepInAirVelocity(component, { x: 1, y: 0, z: 0 }, 1)
    expect(component.velocity).toEqual({ x: 2, y: -1, z: 3 })
  })
})
