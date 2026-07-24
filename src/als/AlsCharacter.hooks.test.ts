import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAlsCharacter, refreshAlsCharacter } from './AlsCharacter'
import {
  ALS_PHYSICS_TIMESTEP,
  ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  ALS_STANDING_CAPSULE_HALF_HEIGHT,
  calculateMaintainedMeshBaseOffset,
  hasTriggeredSprintHold,
  resolveCameraRelativeInput,
  setCapsuleHalfHeightMaintainingBase,
  stepGroundedCharacterYaw,
} from './AlsCharacter.hooks'
import { exponentialDecay } from './State/AlsGroundedState'

beforeAll(async () => {
  await RAPIER.init()
})

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

  it('replaces the Rapier capsule while maintaining the crouched base location', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = ALS_PHYSICS_TIMESTEP
    try {
      const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      world.createCollider(
        RAPIER.ColliderDesc
          .cuboid(10, 0.05, 10)
          .setTranslation(0, -0.05, 0),
        ground,
      )
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc
          .dynamic()
          .setTranslation(0, ALS_STANDING_CAPSULE_HALF_HEIGHT, 0)
          .lockRotations()
          .setCanSleep(false),
      )
      let collider = setCapsuleHalfHeightMaintainingBase(
        world,
        body,
        null,
        ALS_STANDING_CAPSULE_HALF_HEIGHT,
        ALS_STANDING_CAPSULE_HALF_HEIGHT,
      )
      for (let step = 0; step < 120; step += 1) world.step()
      const standingBottom =
        body.translation().y - ALS_STANDING_CAPSULE_HALF_HEIGHT

      collider = setCapsuleHalfHeightMaintainingBase(
        world,
        body,
        collider,
        ALS_STANDING_CAPSULE_HALF_HEIGHT,
        ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
      )
      for (let step = 0; step < 60; step += 1) world.step()

      expect(collider.translationWrtParent()?.y).toBe(0)
      expect(
        body.translation().y - ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
      ).toBeCloseTo(standingBottom, 5)
      expect(body.translation().y).toBeCloseTo(
        ALS_CROUCHING_CAPSULE_HALF_HEIGHT + standingBottom,
        5,
      )
    } finally {
      world.free()
    }
  })

  it('cancels the one-frame rendered-body interpolation across a crouch teleport', () => {
    const physicsBodyY = 0.5588623881340027
    const renderedBodyY = 0.7583373704612587
    const colliderHalfExtent = ALS_CROUCHING_CAPSULE_HALF_HEIGHT
    const offset = calculateMaintainedMeshBaseOffset(
      physicsBodyY,
      renderedBodyY,
      0,
      colliderHalfExtent,
    )

    expect(renderedBodyY + offset).toBeCloseTo(
      physicsBodyY - colliderHalfExtent,
      12,
    )
    expect(offset).toBeCloseTo(-0.759474982327256, 12)
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
})
