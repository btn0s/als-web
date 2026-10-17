import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  moveAlongFloor,
  UE_PENETRATION_PULLBACK_DISTANCE,
} from './characterMovementGroundedMove'
import type {
  CharacterMovementCurrentFloor,
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
  findRapierAlsCharacterFloor,
  refreshRapierAlsLocomotionMode,
} from '../als/AlsCharacter.hooks'
import {
  getRapierAlsAdjustFloorHeightTarget,
  getRapierAlsFindFloorDistance,
  shouldAdjustRapierAlsFloorHeight,
} from './rapierAlsCharacterMovement'

const FLAT_FLOOR: CharacterMovementCurrentFloor = {
  bLineTrace: false,
  FloorDist: UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
  LineDist: 0,
  HitResult: { impactNormal: { x: 0, y: 0, z: 1 } },
}

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
      stopAtPenetration: true,
      excludedRigidBody: excludedBody,
    })
    expect(hit).toEqual({
      time: 0.25,
      impactNormal: { x: -0.8, y: 0.4, z: 0.3 },
      normal: { x: -0.8, y: 0.4, z: 0.3 },
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
      const result = moveAlongFloor({
        start: location,
        delta: { x: 0.05, y: 0, z: 0 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        sweepCapsule: sweep,
        CurrentFloor: FLAT_FLOOR,
        MaxStepHeight: 0.45,
        WalkableFloorZ: 0.71,
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
      const result = moveAlongFloor({
        start: {
          x: bodyLocation.x,
          y: bodyLocation.z,
          z: bodyLocation.y,
        },
        delta: { x: 3.75 * deltaTime, y: 0, z: 0 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        sweepCapsule: sweep,
        CurrentFloor: FLAT_FLOOR,
        MaxStepHeight: 0.45,
        WalkableFloorZ: 0.71,
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
    expect(maximumX).toBeLessThanOrEqual(1.95 + UE_PENETRATION_PULLBACK_DISTANCE)
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
    const result = moveAlongFloor({
      start: { x: 0, y: 0, z: 0.9 },
      delta: { x: 2, y: 1, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: sweep,
      CurrentFloor: FLAT_FLOOR,
      MaxStepHeight: 0,
      WalkableFloorZ: 0.71,
    })

    expect(result.firstHit?.bBlockingHit).toBe(true)
    expect(result.firstHit?.impactNormal.x).toBeLessThan(-0.99)
    // Rapier leaves its cast margin before the geometric contact plane.
    expect(result.delta.x).toBeCloseTo(1.6, 3)
    expect(result.delta.y).toBeCloseTo(1, 5)
    expect(result.delta.z).toBe(0)
    world.free()
  })
})

const STEP_TEST_DELTA_TIME = 1 / 60
const WALK_SPEED = 1.75
const RUN_SPEED = 3.75
const SPRINT_SPEED = 6.5

function createStepWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const addBox = (
    minX: number,
    maxX: number,
    top: number,
    bottom = top - 0.1,
  ) => world.createCollider(
    RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, (top - bottom) / 2, 3)
      .setTranslation((minX + maxX) / 2, (top + bottom) / 2, 0),
  )
  return { world, addBox }
}

function createWalkingCharacter(
  world: RAPIER.World,
  x: number,
  floorZ: number,
) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(
        x,
        floorZ + 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        0,
      )
      .lockRotations(),
  )
  world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.3), body)
  world.step()
  const moveSweep = createRapierAlsGroundedMoveSweep({
    world,
    Capsule: RAPIER.Capsule,
    Ray: RAPIER.Ray,
    resolveExcludeRigidBody: () => body,
  })
  const floorSweep = createRapierAlsCapsuleSweep({
    world,
    Capsule: RAPIER.Capsule,
    Ray: RAPIER.Ray,
    resolveExcludeRigidBody: () => body,
  })
  const character = createAlsCharacter()
  let pendingGroundedBodyHeight: number | null = null
  const probe = (location: { x: number; y: number; z: number }) =>
    findRapierAlsCharacterFloor(
      floorSweep,
      character.locomotionMode,
      {
        location,
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      },
      character.movement,
    )

  // One AlsCharacter.hooks fixed step: CurrentFloor → MoveAlongFloor → Rapier → FindFloor.
  const step = (speed: number) => {
    const translation = body.translation()
    const offset = pendingGroundedBodyHeight === null
      ? 0
      : pendingGroundedBodyHeight - translation.y
    const start = {
      x: translation.x,
      y: translation.z,
      z: translation.y + offset,
    }
    const result = moveAlongFloor({
      start,
      delta: { x: speed * STEP_TEST_DELTA_TIME, y: 0, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: moveSweep,
      CurrentFloor: probe(start),
      MaxStepHeight: character.movement.maxStepHeight,
      WalkableFloorZ: 0.71,
      findFloor: probe,
    })
    const stepDownFloor = result.StepDownResult.FloorResult
    const stepDownFloorHeightAdjustment = (
      stepDownFloor && shouldAdjustRapierAlsFloorHeight(stepDownFloor)
    )
      ? UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE
        - getRapierAlsFindFloorDistance(stepDownFloor)
      : 0
    body.setNextKinematicTranslation({
      x: translation.x + result.delta.x,
      y: translation.y + offset + result.delta.z + stepDownFloorHeightAdjustment,
      z: translation.z + result.delta.y,
    })
    pendingGroundedBodyHeight = null
    world.step()

    const moved = body.translation()
    const anchor = { x: moved.x, y: moved.z, z: moved.y }
    const floor = probe(anchor)
    refreshRapierAlsLocomotionMode(character, floor !== null, 0)
    if (
      character.locomotionMode === 'Grounded'
      && floor
      && shouldAdjustRapierAlsFloorHeight(floor)
    ) {
      pendingGroundedBodyHeight =
        getRapierAlsAdjustFloorHeightTarget(anchor, floor).z
    }
    return result
  }

  const baseZ = () => body.translation().y - 0.9
  return { body, character, step, baseZ }
}

function expectWithinFloorBand(baseZ: number, floorZ: number) {
  expect(baseZ - floorZ).toBeGreaterThanOrEqual(0.019 - 0.0005)
  expect(baseZ - floorZ).toBeLessThanOrEqual(0.024 + 0.0005)
}

function runUntil(
  harness: ReturnType<typeof createWalkingCharacter>,
  speed: number,
  untilX: number,
  maximumSteps = 600,
) {
  let inAirSteps = 0
  let steps = 0
  while (harness.body.translation().x < untilX && steps < maximumSteps) {
    harness.step(speed)
    steps++
    if (harness.character.locomotionMode !== 'Grounded') inAirSteps++
  }
  return { inAirSteps, steps }
}

describe('Rapier ALS MoveAlongFloor StepUp and walking FindFloor', () => {
  it.each([
    ['Walking', WALK_SPEED],
    ['Running', RUN_SPEED],
    ['Sprinting', SPRINT_SPEED],
  ])('climbs a 0.17 m step while %s', (_gait, speed) => {
    const { world, addBox } = createStepWorld()
    addBox(-10, 10, 0)
    addBox(1, 4, 0.17, 0)
    const harness = createWalkingCharacter(world, 0, 0)

    const { inAirSteps } = runUntil(harness, speed, 2)

    expect(inAirSteps).toBe(0)
    expect(harness.body.translation().x).toBeGreaterThanOrEqual(2)
    expectWithinFloorBand(harness.baseZ(), 0.17)
    world.free()
  })

  it.each([
    ['Walking', WALK_SPEED],
    ['Running', RUN_SPEED],
    ['Sprinting', SPRINT_SPEED],
  ])('climbs a 0.17 m riser / 0.28 m tread stair flight while %s', (_gait, speed) => {
    const { world, addBox } = createStepWorld()
    addBox(-10, 10, 0)
    const stepCount = 8
    for (let index = 1; index <= stepCount; index++) {
      addBox(1 + (index - 1) * 0.28, index === stepCount ? 8 : 1 + index * 0.28, index * 0.17, 0)
    }
    const harness = createWalkingCharacter(world, 0, 0)
    const topX = 1 + stepCount * 0.28 + 0.5

    const { inAirSteps } = runUntil(harness, speed, topX)

    expect(inAirSteps).toBe(0)
    expect(harness.body.translation().x).toBeGreaterThanOrEqual(topX)
    expectWithinFloorBand(harness.baseZ(), stepCount * 0.17)
    world.free()
  })

  it('does not step onto a 0.5 m block', () => {
    const { world, addBox } = createStepWorld()
    addBox(-10, 10, 0)
    addBox(1, 4, 0.5, 0)
    const harness = createWalkingCharacter(world, 0, 0)

    const { inAirSteps } = runUntil(harness, RUN_SPEED, 2, 120)

    expect(inAirSteps).toBe(0)
    expect(harness.body.translation().x).toBeLessThanOrEqual(0.7001)
    expect(harness.body.translation().x).toBeGreaterThan(0.69)
    expectWithinFloorBand(harness.baseZ(), 0)
    world.free()
  })

  it.each([
    ['Walking', WALK_SPEED],
    ['Running', RUN_SPEED],
  ])('stays Grounded walking down a 0.17 m stair flight while %s', (_gait, speed) => {
    const { world, addBox } = createStepWorld()
    const stepCount = 6
    addBox(-10, 0, stepCount * 0.17, 0)
    for (let index = 1; index < stepCount; index++) {
      addBox((index - 1) * 0.28, index * 0.28, (stepCount - index) * 0.17, 0)
    }
    addBox((stepCount - 1) * 0.28, 10, 0)
    const harness = createWalkingCharacter(world, -1, stepCount * 0.17)
    const bottomX = stepCount * 0.28 + 0.5

    const { inAirSteps } = runUntil(harness, speed, bottomX)

    expect(inAirSteps).toBe(0)
    expectWithinFloorBand(harness.baseZ(), 0)
    world.free()
  })

  it.each([
    ['Running', RUN_SPEED],
    ['Sprinting', SPRINT_SPEED],
  ])('stays Grounded running down a 30 degree ramp while %s', (_gait, speed) => {
    const { world, addBox } = createStepWorld()
    const height = 2
    const angle = Math.PI / 6
    const length = height / Math.tan(angle)
    addBox(-10, 0, height, 0)
    addBox(length, 20, 0)
    const halfLength = length / 2 / Math.cos(angle) + 0.05
    const normal = { x: Math.sin(angle), y: Math.cos(angle) }
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfLength, 0.05, 3)
        .setTranslation(
          length / 2 - normal.x * 0.05,
          height / 2 - normal.y * 0.05,
          0,
        )
        .setRotation({ x: 0, y: 0, z: Math.sin(-angle / 2), w: Math.cos(-angle / 2) }),
    )
    const harness = createWalkingCharacter(world, -1, height)

    const { inAirSteps } = runUntil(harness, speed, length + 1)

    expect(inAirSteps).toBe(0)
    expectWithinFloorBand(harness.baseZ(), 0)
    world.free()
  })

  it('falls InAir walking off a 1 m ledge once the capsule overhangs the perch radius', () => {
    const { world, addBox } = createStepWorld()
    addBox(-10, 0, 1, 0)
    addBox(-10, 10, 0)
    const harness = createWalkingCharacter(world, -1, 1)

    runUntil(harness, WALK_SPEED, 1, 120)
    let x = harness.body.translation().x
    let lowestBaseZ = harness.baseZ()
    while (harness.character.locomotionMode === 'Grounded' && x < 1) {
      harness.step(WALK_SPEED)
      x = harness.body.translation().x
      if (harness.character.locomotionMode === 'Grounded') {
        lowestBaseZ = Math.min(lowestBaseZ, harness.baseZ())
      }
    }

    expect(harness.character.locomotionMode).toBe('InAir')
    expect(x).toBeGreaterThan(0.15)
    expect(x).toBeLessThan(0.15 + WALK_SPEED * STEP_TEST_DELTA_TIME + 0.001)
    expect(lowestBaseZ).toBeGreaterThan(0.95)
    world.free()
  })
})

describe('Rapier ALS MoveAlongFloor start penetration', () => {
  it.each([
    ['Running', RUN_SPEED],
    ['Sprinting', SPRINT_SPEED],
  ])('runs onto a 10 degree slab ramp far from the origin from every sub-step phase while %s', (_gait, speed) => {
    const stalls: number[] = []
    const angle = 10 * Math.PI / 180
    const length = 1.2 / Math.sin(angle)
    const thick = 0.4
    const startX = 138.1325
    for (let phase = 0; phase < 120; phase++) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
      const level = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      world.createCollider(RAPIER.ColliderDesc.cuboid(230, 0.5, 230).setTranslation(80, -0.5, 0), level)
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(length / 2, thick / 2, 2)
          .setTranslation(
            startX + length / 2 * Math.cos(angle) + thick / 2 * Math.sin(angle),
            length / 2 * Math.sin(angle) - thick / 2 * Math.cos(angle),
            0,
          )
          .setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }),
        level,
      )
      const harness = createWalkingCharacter(world, startX - 3 + phase * speed * STEP_TEST_DELTA_TIME / 120, 0)
      let velocity = speed
      for (let step = 0; step < 240 && harness.body.translation().x < startX + 3; step++) {
        velocity = Math.min(speed, velocity + 20 * STEP_TEST_DELTA_TIME)
        const result = harness.step(velocity)
        velocity = Math.hypot(result.delta.x, result.delta.y) / STEP_TEST_DELTA_TIME
      }
      if (harness.body.translation().x < startX + 3) stalls.push(phase)
      world.free()
    }
    expect(stalls).toEqual([])
  })

  it('stays put when resolving a start penetration would push into other geometry', () => {
    const { world, addBox } = createStepWorld()
    addBox(-10, 10, 0)
    const harness = createWalkingCharacter(world, 0, 0)
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 2, 3).setTranslation(0.75, 1, 0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 2, 3).setTranslation(-0.75, 1, 0))
    world.step()
    const before = harness.body.translation()

    const result = harness.step(RUN_SPEED)

    expect(result.delta.x).toBeCloseTo(0, 9)
    expect(harness.body.translation().x).toBeCloseTo(before.x, 6)
    world.free()
  })
})
