import RAPIER, {
  type Collider,
  type RigidBody,
  type World,
} from '@dimforge/rapier3d-compat'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AlsCameraTraceRequest } from '../als/AlsCamera/AlsCameraComponent'
import { unrealToThreeVector } from './unrealCoordinateSpace'
import { createRapierAlsCameraTrace } from './rapierAlsCameraTrace'

const worlds: World[] = []

beforeAll(async () => {
  await RAPIER.init()
})

afterEach(() => {
  for (const world of worlds.splice(0)) world.free()
})

function createWorld(): World {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  worlds.push(world)
  return world
}

function createFixedCuboid(
  world: World,
  center: Readonly<{ x: number; y: number; z: number }>,
  halfExtents: Readonly<{ x: number; y: number; z: number }>,
): { body: RigidBody; collider: Collider } {
  const rapierCenter = unrealToThreeVector(center)
  const rapierHalfExtents = unrealToThreeVector(halfExtents)
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      rapierCenter.x,
      rapierCenter.y,
      rapierCenter.z,
    ),
  )
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      rapierHalfExtents.x,
      rapierHalfExtents.y,
      rapierHalfExtents.z,
    ),
    body,
  )
  return { body, collider }
}

function request(
  overrides: Partial<AlsCameraTraceRequest> = {},
): AlsCameraTraceRequest {
  return {
    start: { x: 0, y: 0, z: 1 },
    end: { x: -5, y: 0, z: 1 },
    radius: 0.25,
    penetrationAdjustmentRadius: 0.26,
    ownerLocation: { x: 1, y: 0, z: 1 },
    channel: 'ECC_Visibility',
    ...overrides,
  }
}

describe('createRapierAlsCameraTrace', () => {
  it('returns the swept sphere center at a nonpenetrating hit', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: -2, y: 0, z: 1 },
      { x: 0.1, y: 2, z: 2 },
    )
    world.step()
    let resolvedChannel: string | undefined
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: (channel) => {
        resolvedChannel = channel
        return {}
      },
    })

    const result = trace(request())

    expect(resolvedChannel).toBe('ECC_Visibility')
    expect(result?.adjustedTraceStart).toBeUndefined()
    expect(result?.traceResult.x).toBeCloseTo(-1.65, 5)
    expect(result?.traceResult.y).toBeCloseTo(0, 5)
    expect(result?.traceResult.z).toBeCloseTo(1, 5)
  })

  it('returns null when the sweep reaches the end unobstructed', () => {
    const world = createWorld()
    const overlapSpy = vi.spyOn(world, 'intersectionsWithShape')
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    expect(trace(request())).toBeNull()
    expect(overlapSpy).not.toHaveBeenCalled()
  })

  it('excludes the owner rigid body and every additional owner collider', () => {
    const world = createWorld()
    const owner = createFixedCuboid(
      world,
      { x: -0.75, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    )
    const detachedOwnerCollider = createFixedCuboid(
      world,
      { x: -1.5, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    ).collider
    createFixedCuboid(
      world,
      { x: -3, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      getOwnerRigidBody: () => owner.body,
      getOwnerColliders: () => [owner.collider, detachedOwnerCollider],
      queryFilterForChannel: () => ({}),
    })

    expect(trace(request())?.traceResult.x).toBeCloseTo(-2.65, 4)
  })

  it('ignores a pawn attached at the trace origin while retaining a blocking world wall', () => {
    const world = createWorld()
    const carriedPawn = createFixedCuboid(world, { x: 0, y: 0, z: 1 }, { x: 0.35, y: 0.35, z: 0.9 }).collider
    carriedPawn.setCollisionGroups((0x10 << 16) | 0xffff)
    createFixedCuboid(world, { x: -3, y: 0, z: 1 }, { x: 0.1, y: 1, z: 1 })
    world.step()
    const blocked = createRapierAlsCameraTrace({ world, queryFilterForChannel: () => ({}) })(request())
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({ predicate: collider => (collider.collisionGroups() >>> 16) !== 0x10 }),
    })
    expect(blocked?.traceResult.x).not.toBeCloseTo(-2.65, 4)
    expect(trace(request())?.traceResult.x).toBeCloseTo(-2.65, 4)
  })

  it('ignores sensors and respects the visibility blocking predicate', () => {
    const world = createWorld()
    const sensor = createFixedCuboid(
      world,
      { x: -0.75, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    ).collider
    sensor.setSensor(true)
    const ignoredSolid = createFixedCuboid(
      world,
      { x: -1.5, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    ).collider
    createFixedCuboid(
      world,
      { x: -3, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({
        predicate: (collider) => collider.handle !== ignoredSolid.handle,
      }),
    })

    expect(trace(request())?.traceResult.x).toBeCloseTo(-2.65, 4)
  })

  it('moves a penetrating start by the inflated-sphere MTD before re-sweeping', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    const result = trace(request({
      start: { x: 0.65, y: 0, z: 1 },
      end: { x: 2, y: 0, z: 1 },
      ownerLocation: { x: 2, y: 0, z: 1 },
    }))

    expect(result?.adjustedTraceStart?.x).toBeCloseTo(0.76, 5)
    expect(result?.traceResult).toEqual({ x: 2, y: 0, z: 1 })
  })

  it('uses the adjusted start for the second blocking sweep', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    createFixedCuboid(
      world,
      { x: 1.5, y: 0, z: 1 },
      { x: 0.1, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    const result = trace(request({
      start: { x: 0.65, y: 0, z: 1 },
      end: { x: 3, y: 0, z: 1 },
      ownerLocation: { x: 1, y: 0, z: 1 },
    }))

    expect(result?.adjustedTraceStart?.x).toBeCloseTo(0.76, 5)
    expect(result?.traceResult.x).toBeCloseTo(1.15, 5)
  })

  it('rejects an MTD that points away from the camera owner', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    const result = trace(request({
      start: { x: 0.65, y: 0, z: 1 },
      end: { x: 2, y: 0, z: 1 },
      ownerLocation: { x: -2, y: 0, z: 1 },
    }))

    expect(result).toEqual({
      traceResult: { x: 0.65, y: 0, z: 1 },
    })
  })

  it('uses ALS dimensionless tolerance at the owner-direction guard', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    const result = trace(request({
      start: { x: 0.65, y: 0, z: 1 },
      end: { x: 2, y: 0, z: 1 },
      ownerLocation: { x: 0.64995, y: 1, z: 1 },
    }))

    expect(result?.adjustedTraceStart?.x).toBeCloseTo(0.76, 5)
  })

  it('keeps an applied MTD when the adjusted start is still blocked', () => {
    const world = createWorld()
    createFixedCuboid(
      world,
      { x: 0, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    createFixedCuboid(
      world,
      { x: 1.4, y: 0, z: 1 },
      { x: 0.5, y: 1, z: 1 },
    )
    world.step()
    const trace = createRapierAlsCameraTrace({
      world,
      queryFilterForChannel: () => ({}),
    })

    const result = trace(request({
      start: { x: 0.65, y: 0, z: 1 },
      end: { x: 2, y: 0, z: 1 },
      ownerLocation: { x: 2, y: 0, z: 1 },
    }))

    expect(result?.adjustedTraceStart?.x).toBeCloseTo(0.75, 5)
    expect(result?.traceResult.x).toBeCloseTo(0.75, 5)
  })
})
