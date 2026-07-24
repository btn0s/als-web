import { describe, expect, it } from 'vitest'
import type { AlsMovementGaitSettings } from './Settings/AlsMovementSettings'
import {
  calculateDirectionDependentGaitSpeeds,
  calculateGaitAmount,
  createAlsCharacterMovementComponent,
  refreshGroundedMovementSettings,
  setMaxAllowedGait,
  setMovementRotationMode,
  setMovementStance,
  setMovementVelocity,
  stepGroundedVelocity,
} from './AlsCharacterMovementComponent'
import type { AlsCharacterMovementGaitSettings } from './AlsCharacterMovementComponent'

describe('UAlsCharacterMovementComponent grounded policy', () => {
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
    // ORIGINAL WEB RUNTIME regression pin: ALS supplies the coefficients but delegates the
    // integration formula to UE's absent UCharacterMovementComponent::CalcVelocity().
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
})
