import { describe, expect, it } from 'vitest'
import {
  createAlsCharacter,
  refreshAlsCharacter,
  setLocomotionMode,
  setStance,
} from './AlsCharacter'
import {
  ALS_CAPSULE_RADIUS,
  ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  ALS_MESH_RELATIVE_LOCATION_Z,
  ALS_PHYSICS_TIMESTEP,
  ALS_RAPIER_GRAVITY,
  ALS_RAPIER_JUMP_SPEED,
  ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
  ALS_STANDING_CAPSULE_HALF_HEIGHT,
  consumeAlsJumpInput,
  getAlsCapsuleHalfHeight,
  handleAlsJumpInput,
  hasTriggeredSprintHold,
  refreshRapierAlsLocomotionMode,
  requestAlsJumpInput,
  publishAlsCharacterAnimationSnapshot,
  resolveAlsActorLocation,
  resolveAlsCameraMovementBaseSnapshot,
  resolveAlsMeshRootRelativeY,
  resolveCameraRelativeInput,
  stepGroundedCharacterYaw,
  stepInAirCharacterYaw,
} from './AlsCharacter.hooks'
import type {
  AlsCharacterAnimationControls,
} from './AlsCharacter.hooks'
import { exponentialDecay } from './State/AlsGroundedState'
import { unwindDegrees } from './State/AlsLocomotionState'
import { ALS_NO_BASED_MOVEMENT } from './State/AlsMovementBaseState'
import { calculateMovingSmooth } from './Settings/AlsGeneralAnimationSettings'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from '../engine/characterMovementFloor'

function animationControlsFixture(): AlsCharacterAnimationControls {
  return {
    gait: 'Walking',
    moving: false,
    movingSmooth: false,
    locomotionMode: 'Grounded',
    scale: 1,
    location: { x: 0, y: 0, z: 0 },
    actorYawAngle: 0,
    basedMovement: ALS_NO_BASED_MOVEMENT,
    velocity: { x: 0, y: 0, z: 0 },
    capsuleRadius: ALS_CAPSULE_RADIUS,
    capsuleHalfHeight: ALS_STANDING_CAPSULE_HALF_HEIGHT,
    walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
    stance: 'Standing',
    rotationMode: 'ViewDirection',
    overlayMode: 'Default',
    speed: 0,
    direction: 0,
    relativeAccelerationAmount: { x: 0, y: 0 },
    rotateInPlace: false,
    viewYawAngle: 0,
    viewYawSpeed: 0,
  }
}

describe('AlsCharacter browser bridge math', () => {
  it('pins the ALS character constructor and inherited UE movement defaults in metres', () => {
    expect(ALS_CAPSULE_RADIUS).toBe(0.3)
    expect(ALS_STANDING_CAPSULE_HALF_HEIGHT).toBe(0.9)
    expect(ALS_CROUCHING_CAPSULE_HALF_HEIGHT).toBe(0.56)
    expect(ALS_MESH_RELATIVE_LOCATION_Z).toBe(-0.92)
    expect(ALS_RAPIER_JUMP_SPEED).toBe(4.2)
    expect(ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS).toBe(0.71)
    expect(ALS_RAPIER_GRAVITY).toBe(9.8)
    expect(getAlsCapsuleHalfHeight('Standing')).toBe(0.9)
    expect(getAlsCapsuleHalfHeight('Crouching')).toBe(0.56)
  })

  it('reconstructs the active capsule-root actor location from the Rapier body anchor', () => {
    const rapierBodyAnchor = { x: 2, y: -3, z: 4 }
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Standing',
      'Grounded',
    )).toEqual({
      x: 2,
      y: -3,
      z: 4 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
    })
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Crouching',
      'Grounded',
    )).toEqual({
      x: 2,
      y: -3,
      z: 4
        + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
        - ALS_STANDING_CAPSULE_HALF_HEIGHT
        + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
    })
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Crouching',
      'InAir',
    ).z).toBe(
      4
      + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
      - ALS_STANDING_CAPSULE_HALF_HEIGHT,
    )
    expect(rapierBodyAnchor).toEqual({ x: 2, y: -3, z: 4 })
  })

  it('keeps the rendered mesh on the active capsule base while crouching', () => {
    // UAlsCharacterMovementComponent constructor line 236 enables bCrouchMaintainsBaseLocation.
    const floorOffset = UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE
    expect(resolveAlsMeshRootRelativeY('Standing', 'Grounded')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z + floorOffset,
    )
    expect(resolveAlsMeshRootRelativeY('Crouching', 'Grounded')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z
      + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
      - ALS_STANDING_CAPSULE_HALF_HEIGHT
      + floorOffset,
    )
    expect(
      resolveAlsMeshRootRelativeY('Crouching', 'Grounded')
      - resolveAlsMeshRootRelativeY('Standing', 'Grounded'),
    ).toBeCloseTo(
      ALS_CROUCHING_CAPSULE_HALF_HEIGHT
      - ALS_STANDING_CAPSULE_HALF_HEIGHT,
      12,
    )
    expect(resolveAlsMeshRootRelativeY('Crouching', 'InAir')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z
      + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
      - ALS_STANDING_CAPSULE_HALF_HEIGHT,
    )
  })

  it('publishes landing tags and one retained locomotion bundle as one frame', () => {
    const character = createAlsCharacter({
      actorYawAngle: 10,
      viewYawAngle: 50,
      desiredStance: 'Crouching',
      locomotionMode: 'InAir',
    })
    setStance(character, 'Standing')
    refreshAlsCharacter(
      character,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1.2, z: -0.15 },
      { x: 0, y: 6.5, z: 0 },
    )
    setLocomotionMode(character, 'Grounded')
    const location = { x: 2, y: -3, z: 4 }
    const basedMovement = {
      ...ALS_NO_BASED_MOVEMENT,
      primitive: {},
      hasRelativeLocation: true,
    }
    const output = animationControlsFixture()

    publishAlsCharacterAnimationSnapshot(output, {
      character,
      location,
      basedMovement,
      acceleration: { x: 0, y: -2, z: 0 },
      overlayMode: 'Rifle',
      movementOverride: false,
      speedOverride: 99,
      directionOverride: -123,
      rotateInPlaceOverride: true,
    })

    expect(output).toMatchObject({
      locomotionMode: 'Grounded',
      stance: 'Crouching',
      gait: 'Walking',
      rotationMode: 'ViewDirection',
      overlayMode: 'Rifle',
      hasInput: true,
      speed: 1.2,
      moving: true,
      movingSmooth: true,
      actorYawAngle: 10,
      direction: 80,
      viewYawAngle: 40,
      capsuleHalfHeight: ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
      rotateInPlace: true,
    })
    expect(output.velocity).toBe(character.locomotionState.velocity)
    expect(output.velocity).toEqual({ x: 0, y: 1.2, z: -0.15 })
    expect(output.speed).toBeCloseTo(
      Math.hypot(output.velocity.x, output.velocity.y),
      12,
    )
    expect(output.direction).toBe(
      unwindDegrees(
        character.locomotionState.velocityYawAngle
        - output.actorYawAngle,
      ),
    )
    expect(output.moving).toBe(character.locomotionState.moving)
    expect(output.movingSmooth).toBe(
      calculateMovingSmooth(character.locomotionState),
    )
    expect(output.location).toBe(location)
    expect(output.basedMovement).toBe(basedMovement)
  })

  it('publishes only the current Grounded support to ALSCamera', () => {
    const supportBody = (
      handle: number,
      fixed: boolean,
      translation: { x: number; y: number; z: number },
    ) => ({
      handle,
      isFixed: () => fixed,
      translation: () => translation,
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    })
    const supportHit = (
      rigidBody: ReturnType<typeof supportBody>,
    ) => {
      const collider = {
        handle: rigidBody.handle + 100,
        parent: () => rigidBody,
        translation: rigidBody.translation,
        rotation: rigidBody.rotation,
      }
      return {
        validBlockingHit: true,
        time: 0,
        impactNormal: { x: 0, y: 0, z: 1 },
        collider,
        rigidBody,
      }
    }

    const staticBody = supportBody(1, true, { x: 2, y: 3, z: 4 })
    expect(resolveAlsCameraMovementBaseSnapshot(
      'Grounded',
      supportHit(staticBody),
    )).toEqual({
      key: staticBody,
      boneName: '',
      hasRelativeRotation: false,
      location: { x: 2, y: 4, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    const movingBody = supportBody(2, false, { x: 5, y: 6, z: 7 })
    expect(resolveAlsCameraMovementBaseSnapshot(
      'Grounded',
      supportHit(movingBody),
      true,
    )).toMatchObject({
      key: movingBody,
      hasRelativeRotation: true,
      location: { x: 5, y: 7, z: 6 },
    })

    expect(resolveAlsCameraMovementBaseSnapshot('Grounded', null))
      .toBeNull()
    expect(resolveAlsCameraMovementBaseSnapshot(
      'InAir',
      supportHit(movingBody),
      true,
    )).toBeNull()
  })

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

  it('consumes the preceding animation curves in AAlsCharacter grounded-rotation order', () => {
    const stopped = createAlsCharacter({
      actorYawAngle: 10,
      viewYawAngle: 80,
      desiredAiming: true,
    })
    refreshAlsCharacter(
      stopped,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    )

    stepGroundedCharacterYaw(stopped, 0.5, -30, 20)

    expect(stopped.actorYawAngle).toBe(20)
    expect(stopped.locomotionState.targetYawAngle).toBe(20)
    expect(stopped.locomotionState.smoothTargetYawAngle).toBe(20)

    const moving = createAlsCharacter({
      actorYawAngle: 0,
      viewYawAngle: 90,
      desiredRotationMode: 'ViewDirection',
    })
    refreshAlsCharacter(
      moving,
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    )
    stepGroundedCharacterYaw(moving, 1 / 60, -30, 10_000)

    // RotationYawSpeed is stopped-only. Moving ViewDirection instead consumes the preceding
    // RotationYawOffset as ViewYaw + Offset before SetRotationExtraSmooth().
    expect(moving.locomotionState.targetYawAngle).toBe(60)
    expect(moving.actorYawAngle).toBeLessThan(60)
  })

  it('rotates airborne ViewDirection toward velocity at the authored speed', () => {
    const character = createAlsCharacter({
      actorYawAngle: 0,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      settings: { inAirRotationMode: 'RotateToVelocityOnJump' },
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
