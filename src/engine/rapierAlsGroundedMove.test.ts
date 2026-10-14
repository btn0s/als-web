import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  moveGroundedWithSlideAlongSurface,
} from './characterMovementGroundedMove'
import {
  createRapierAlsGroundedMoveSweep,
} from './rapierAlsGroundedMove'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from './characterMovementFloor'
import {
  createRapierAlsCapsuleSweep,
  selectRapierAlsFloor,
} from './rapierAlsCapsuleSweep'
import { createAlsCharacter } from '../als/AlsCharacter'
import {
  refreshRapierAlsLocomotionMode,
} from '../als/AlsCharacter.hooks'
import {
  getRapierAlsFindFloorDistance,
  shouldAdjustRapierAlsFloorHeight,
} from './rapierAlsCharacterMovement'

class FakeCapsule {
  readonly halfHeight: number
  readonly radius: number

  constructor(halfHeight: number, radius: number) {
    this.halfHeight = halfHeight
    this.radius = radius
  }
}

beforeAll(async () => {
  await RAPIER.init()
})

describe('Rapier ALS grounded movement query', () => {
  it('can retreat after repeated wall contact accumulates a small overlap', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.7, 2).setTranslation(4, 0.7, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(18, 0.12, 12).setTranslation(0, -0.12, 0))
    world.step()
    const sweep = createRapierAlsGroundedMoveSweep({ world, Capsule: RAPIER.Capsule })
    let start = { x: 1.65, y: 0, z: 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE }
    const shape = { capsuleRadius: 0.3, capsuleHalfHeight: 0.9, sweepCapsule: sweep }
    for (let step = 0; step < 20; step++) {
      const result = moveGroundedWithSlideAlongSurface({ ...shape, start, delta: { x: 0.05, y: 0, z: 0 } })
      start = { x: Math.fround(start.x + result.delta.x), y: Math.fround(start.y + result.delta.y), z: start.z }
    }
    expect(start.x).toBeGreaterThanOrEqual(1.699)
    expect(start.x).toBeLessThan(1.701)
    const retreat = moveGroundedWithSlideAlongSurface({ ...shape, start, delta: { x: -0.05, y: 0, z: 0 } })
    expect(retreat.delta.x).toBeCloseTo(-0.05, 6)
    world.free()
  })

  it('permits overlap exit without permitting deeper motion or bypassing a second wall', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.7, 2).setTranslation(4, 0.7, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 1, 2).setTranslation(1, 1, 0))
    world.step()
    const sweep = createRapierAlsGroundedMoveSweep({ world, Capsule: RAPIER.Capsule })
    const input = { start: { x: 1.7003, y: 0, z: 0.9215 }, capsuleRadius: 0.3, capsuleHalfHeight: 0.9, sweepCapsule: sweep }
    const deeper = moveGroundedWithSlideAlongSurface({ ...input, delta: { x: 0.05, y: 0, z: 0 } })
    expect(deeper.delta.x).toBe(0)
    const retreat = moveGroundedWithSlideAlongSurface({ ...input, delta: { x: -1, y: 0, z: 0 } })
    expect(input.start.x + retreat.delta.x).toBeCloseTo(1.4, 3)
    expect(retreat.firstHit?.bBlockingHit).toBe(true)
    world.free()
  })

  it('ignores a physically overlapping body excluded by the owner collision response', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const corpse = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0))
    const corpseCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.3, 0.5)
      .setCollisionGroups((0x0004 << 16) | 0xfffd), corpse)
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0))
    const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10), floorBody)
    world.step()
    let groups: number | undefined
    const sweep = createRapierAlsGroundedMoveSweep({
      world,
      Capsule: RAPIER.Capsule,
      resolveFilterGroups: () => groups,
    })
    const horizontal = { start: { x: 0, y: 0, z: 1 }, delta: { x: 0.1, y: 0, z: 0 }, capsuleRadius: 0.3, capsuleHalfHeight: 0.9 }
    expect(sweep(horizontal)).toMatchObject({ collider: { handle: corpseCollider.handle } })
    groups = (0x0002 << 16) | 0xfffb
    expect(sweep(horizontal)).not.toEqual(expect.objectContaining({ collider: corpseCollider }))
    expect(sweep({ ...horizontal, start: { x: 0, y: 0, z: 3 }, delta: { x: 0, y: 0, z: -4 } })).toMatchObject({ collider: { handle: floor.handle } })
    world.free()
  })

  it('converts Z-up full capsule casts and excludes the owner body', () => {
    const excludedBody = {}
    const collider = {
      handle: 12,
      parent: () => null,
    }
    let observed: Record<string, unknown> | undefined
    const sweep = createRapierAlsGroundedMoveSweep({
      Capsule: FakeCapsule,
      excludeRigidBody: excludedBody,
      world: {
        castShape(
          position,
          rotation,
          velocity,
          shape,
          targetDistance,
          maxTimeOfImpact,
          stopAtPenetration,
          _flags,
          _groups,
          _excludedCollider,
          excludedRigidBody,
        ) {
          observed = {
            position: { ...position },
            rotation: { ...rotation },
            velocity: { ...velocity },
            shape,
            targetDistance,
            maxTimeOfImpact,
            stopAtPenetration,
            excludedRigidBody,
          }
          return {
            time_of_impact: 0.25,
            collider,
            normal1: { x: -0.8, y: 0.3, z: 0.4 },
          }
        },
      },
    })

    const hit = sweep({
      start: { x: 1, y: 2, z: 3 },
      delta: { x: 4, y: 5, z: -11 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
    })

    expect(observed).toMatchObject({
      position: { x: 1, y: 3, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 4, y: -11, z: 5 },
      shape: expect.any(FakeCapsule),
      targetDistance: 0,
      maxTimeOfImpact: 1,
      stopAtPenetration: false,
      excludedRigidBody: excludedBody,
    })
    expect(hit).toEqual({
      time: 0.25,
      impactNormal: { x: -0.8, y: 0.4, z: 0.3 },
      bBlockingHit: true,
      bStartPenetrating: false,
      collider,
    })
  })

  it('does not accumulate through a wall over 120 repeated grounded pushes', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const wall = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 0.9, 2).setTranslation(2, 0.9, 0),
    )
    world.step()
    const sweep = createRapierAlsGroundedMoveSweep({
      world,
      Capsule: RAPIER.Capsule,
    })
    let location = { x: 0, y: 0, z: 0.9 }

    for (let tick = 0; tick < 120; tick++) {
      const result = moveGroundedWithSlideAlongSurface({
        start: location,
        delta: { x: 0.05, y: 0, z: 0 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        sweepCapsule: sweep,
      })
      location = {
        x: location.x + result.delta.x,
        y: location.y + result.delta.y,
        z: location.z + result.delta.z,
      }
    }

    // Wall face x=1.9 minus the 0.3 m capsule radius. A small query epsilon allows the contact.
    expect(location.x).toBeLessThanOrEqual(1.600001)
    expect(location.x).toBeGreaterThan(1.59)
    expect(wall.handle).toBeGreaterThanOrEqual(0)
    world.free()
  })

  it('keeps a Grounded kinematic body supported while pushing into the 1m ledge', () => {
    const deltaTime = 1 / 60
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.05, 20),
      floorBody,
    )
    const wallBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(3, 0.5, 0),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.5, 1.5),
      wallBody,
    )
    const characterBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(
          0,
          0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
          0,
        )
        .lockRotations(),
    )
    world.createCollider(
      RAPIER.ColliderDesc.capsule(0.6, 0.3),
      characterBody,
    )
    world.step()
    const sweep = createRapierAlsGroundedMoveSweep({
      world,
      Capsule: RAPIER.Capsule,
      resolveExcludeRigidBody: () => characterBody,
    })
    const floorSweep = createRapierAlsCapsuleSweep({
      world,
      Capsule: RAPIER.Capsule,
      Ray: RAPIER.Ray,
      resolveExcludeRigidBody: () => characterBody,
    })
    const character = createAlsCharacter()
    let previousX = characterBody.translation().x
    let maximumX = previousX
    let maximumRetreat = 0
    let maximumFloorDistanceError = 0
    let inAirMantleOpportunityCount = 0

    for (let tick = 0; tick < 120; tick++) {
      const bodyLocation = characterBody.translation()
      const result = moveGroundedWithSlideAlongSurface({
        start: {
          x: bodyLocation.x,
          y: bodyLocation.z,
          z: bodyLocation.y,
        },
        delta: { x: 3.75 * deltaTime, y: 0, z: 0 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        sweepCapsule: sweep,
      })
      characterBody.setNextKinematicTranslation({
        x: bodyLocation.x + result.delta.x,
        y: bodyLocation.y,
        z: bodyLocation.z + result.delta.y,
      })
      world.step()

      const translation = characterBody.translation()
      const floor = selectRapierAlsFloor(floorSweep, {
        location: {
          x: translation.x,
          y: translation.z,
          z: translation.y,
        },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      })
      const verticalVelocity = (
        translation.y - bodyLocation.y
      ) / deltaTime
      if (floor) {
        maximumFloorDistanceError = Math.max(
          maximumFloorDistanceError,
          Math.abs(
            getRapierAlsFindFloorDistance(floor)
              - UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
          ),
        )
        expect(shouldAdjustRapierAlsFloorHeight(floor)).toBe(false)
      }
      refreshRapierAlsLocomotionMode(
        character,
        floor !== null,
        verticalVelocity,
      )
      if (character.locomotionMode === 'InAir') {
        inAirMantleOpportunityCount++
      }

      const x = translation.x
      maximumX = Math.max(maximumX, x)
      maximumRetreat = Math.max(maximumRetreat, previousX - x)
      previousX = x
    }

    expect(characterBody.bodyType())
      .toBe(RAPIER.RigidBodyType.KinematicPositionBased)
    expect(maximumX).toBeLessThanOrEqual(1.95002)
    expect(maximumRetreat).toBeLessThan(0.000001)
    expect(maximumFloorDistanceError).toBeLessThan(0.00001)
    expect(previousX).toBeGreaterThan(1.94)
    expect(character.locomotionMode).toBe('Grounded')
    expect(inAirMantleOpportunityCount).toBe(0)
    world.free()
  })

  it('slides diagonally along the wall tangent instead of discarding the full move', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, 0.9, 3).setTranslation(2, 0.9, 0),
    )
    world.step()
    const sweep = createRapierAlsGroundedMoveSweep({
      world,
      Capsule: RAPIER.Capsule,
    })
    const result = moveGroundedWithSlideAlongSurface({
      start: { x: 0, y: 0, z: 0.9 },
      delta: { x: 2, y: 1, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: sweep,
    })

    expect(result.firstHit?.bBlockingHit).toBe(true)
    expect(result.firstHit?.impactNormal.x).toBeLessThan(-0.99)
    // Rapier leaves its cast margin before the geometric contact plane.
    expect(result.delta.x).toBeCloseTo(1.6, 3)
    expect(result.delta.y).toBeCloseTo(1, 5)
    expect(result.slideDelta.y).toBeGreaterThan(0)
    world.free()
  })
})
