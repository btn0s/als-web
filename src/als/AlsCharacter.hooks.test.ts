import { describe, expect, it } from 'vitest'
import { createAlsCharacter, refreshAlsCharacter } from './AlsCharacter'
import {
  ALS_PHYSICS_TIMESTEP,
  ALS_RAPIER_JUMP_SPEED,
  consumeAlsJumpInput,
  handleAlsJumpInput,
  hasTriggeredSprintHold,
  refreshRapierAlsLocomotionMode,
  requestAlsJumpInput,
  resolveCameraRelativeInput,
  stepGroundedCharacterYaw,
  stepInAirCharacterYaw,
} from './AlsCharacter.hooks'
import { exponentialDecay } from './State/AlsGroundedState'

describe('AlsCharacter browser bridge math', () => {
  it('fires the authored 0.1s Sprint Hold on the sixth fixed physics tick', () => {
    let heldTime = 0
    for (let tick = 0; tick < 5; tick++) heldTime += ALS_PHYSICS_TIMESTEP
    expect(hasTriggeredSprintHold(heldTime)).toBe(false)
    heldTime += ALS_PHYSICS_TIMESTEP
    expect(hasTriggeredSprintHold(heldTime)).toBe(true)
  })

  it('builds camera-relative input in ALS X-forward/Y-right coordinates', () => {
    expect(resolveCameraRelativeInput(
      { right: 0, forward: 1 },
      0,
    )).toEqual({ x: 1, y: 0, z: 0 })
    expect(resolveCameraRelativeInput(
      { right: 1, forward: 0 },
      0,
    )).toEqual({ x: 0, y: 1, z: 0 })

    const rotated = resolveCameraRelativeInput(
      { right: 0, forward: 1 },
      90,
    )
    expect(rotated.x).toBeCloseTo(0, 12)
    expect(rotated.y).toBeCloseTo(1, 12)
  })

  it('applies ALS extra-smooth target rotation before actor exponential decay', () => {
    const single = createAlsCharacter({
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      single,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    )
    single.movement.rotationInterpolationSpeed = 8
    stepGroundedCharacterYaw(single, 1 / 30)

    const split = createAlsCharacter({
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      split,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    )
    split.movement.rotationInterpolationSpeed = 8
    stepGroundedCharacterYaw(split, 1 / 60)
    stepGroundedCharacterYaw(split, 1 / 60)

    // VelocityDirection uses the authored 800°/s smooth-target rate. The moving target means two
    // substeps intentionally differ from one larger step; both orders match SetRotationExtraSmooth.
    const smoothTarget = 800 / 30
    expect(single.locomotionState.smoothTargetYawAngle)
      .toBeCloseTo(smoothTarget, 12)
    expect(single.actorYawAngle).toBeCloseTo(
      smoothTarget * exponentialDecay(1 / 30, 8),
      12,
    )
    expect(split.actorYawAngle).toBeGreaterThan(0)
    expect(split.actorYawAngle).toBeLessThan(single.actorYawAngle)
    expect(single.locomotionState.targetYawAngle).toBe(90)
  })

  it('rotates airborne ViewDirection toward velocity at the authored speed', () => {
    const character = createAlsCharacter({
      actorYawAngle: 0,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
    })
    refreshAlsCharacter(
      character,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 1 },
    )

    stepInAirCharacterYaw(character, 1 / 30)

    expect(character.actorYawAngle).toBeCloseTo(
      90 * exponentialDecay(1 / 30, 5),
      12,
    )
    expect(character.locomotionState.targetYawAngle).toBe(90)
    expect(character.locomotionState.smoothTargetYawAngle).toBe(90)
  })

  it('ports KeepRelativeRotation and KeepWorldRotation without substituting a heuristic', () => {
    const relative = createAlsCharacter({
      actorYawAngle: 0,
      viewYawAngle: 90,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      settings: { inAirRotationMode: 'KeepRelativeRotation' },
    })
    relative.viewYawAngle = 120
    stepInAirCharacterYaw(relative, 1 / 30)
    expect(relative.locomotionState.targetYawAngle).toBe(30)
    expect(relative.actorYawAngle).toBeCloseTo(
      30 * exponentialDecay(1 / 30, 5),
      12,
    )

    const world = createAlsCharacter({
      actorYawAngle: 37,
      viewYawAngle: 120,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      velocity: { x: 0, y: 2, z: -1 },
      settings: { inAirRotationMode: 'KeepWorldRotation' },
    })
    expect(stepInAirCharacterYaw(world, 1 / 30)).toBe(37)
    expect(world.locomotionState.targetYawAngle).toBe(37)
  })

  it('uses the authored airborne Aiming speed and shortest wrapped path', () => {
    const character = createAlsCharacter({
      actorYawAngle: 179,
      viewYawAngle: -179,
      desiredAiming: true,
      locomotionMode: 'InAir',
    })

    stepInAirCharacterYaw(character, 1 / 30)

    expect(character.actorYawAngle).toBeCloseTo(
      179 + 2 * exponentialDecay(1 / 30, 15),
      12,
    )
    expect(character.locomotionState.aimingYawAngleLimit).toBe(70)
    expect(character.locomotionState.aimingLimitAppliedThisFrame).toBe(true)
  })

  it('coalesces the __triggerJump frame edge and consumes it exactly once', () => {
    const request = { current: false }
    requestAlsJumpInput(request)
    requestAlsJumpInput(request)
    expect(consumeAlsJumpInput(request)).toBe(true)
    expect(consumeAlsJumpInput(request)).toBe(false)
  })

  it('uncrouches on the first jump input and jumps only from Grounded Standing', () => {
    const character = createAlsCharacter({
      desiredStance: 'Crouching',
    })

    expect(handleAlsJumpInput(character)).toBe('Uncrouched')
    expect(character.desiredStance).toBe('Standing')
    expect(character.stance).toBe('Standing')
    expect(character.locomotionMode).toBe('Grounded')

    expect(handleAlsJumpInput(character)).toBe('Jumped')
    expect(character.locomotionMode).toBe('InAir')
    expect(ALS_RAPIER_JUMP_SPEED).toBe(4.2)
    expect(handleAlsJumpInput(character)).toBe('Rejected')
  })

  it('exposes Rapier Walking/Falling as exact ALS locomotion-mode edges', () => {
    const character = createAlsCharacter()

    expect(refreshRapierAlsLocomotionMode(character, false, 0))
      .toBe('Grounded')
    expect(refreshRapierAlsLocomotionMode(character, false, -1e-10))
      .toBe('Grounded')
    expect(refreshRapierAlsLocomotionMode(character, false, -0.01))
      .toBe('InAir')
    expect(refreshRapierAlsLocomotionMode(character, true, 1))
      .toBe('InAir')
    expect(refreshRapierAlsLocomotionMode(character, true, 0))
      .toBe('Grounded')
  })
})
