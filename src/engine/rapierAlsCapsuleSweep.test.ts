import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ALS_RAPIER_GROUND_PROBE_DISTANCE,
  createRapierAlsCapsuleSweep,
  probeRapierAlsGround,
  rapierAlsCameraMovementBaseFromPrimitive,
  rapierAlsCameraMovementBase,
  rapierAlsMovementBaseFromPrimitive,
  rapierAlsMovementBase,
} from './rapierAlsCapsuleSweep'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from './characterMovementFloor'

class FakeCapsule {
  readonly halfHeight: number
  readonly radius: number

  constructor(halfHeight: number, radius: number) {
    this.halfHeight = halfHeight
    this.radius = radius
  }
}

class FakeRay {
  origin: { x: number; y: number; z: number }
  dir: { x: number; y: number; z: number }

  constructor(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ) {
    this.origin = origin
    this.dir = dir
  }
}

beforeAll(async () => {
  await RAPIER.init()
})

describe('Rapier ALS capsule sweep', () => {
  it('converts the complete Z-up query once and preserves normalized hit time', () => {
    const excludedBody = {}
    const supportingBody = {
      handle: 11,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isFixed: () => false,
    }
    const supportingCollider = {
      handle: 22,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      parent: () => supportingBody,
    }
    let observed:
      | {
          position: { x: number; y: number; z: number }
          velocity: { x: number; y: number; z: number }
          rotation: { x: number; y: number; z: number; w: number }
          capsule: FakeCapsule
          targetDistance: number
          maxTimeOfImpact: number
          stopAtPenetration: boolean
          excludedBody: unknown
        }
      | undefined
    const sweep = createRapierAlsCapsuleSweep({
      Capsule: FakeCapsule,
      Ray: FakeRay,
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
          _collider,
          body,
        ) {
          observed = {
            position: { ...position },
            velocity: { ...velocity },
            rotation: { ...rotation },
            capsule: shape as FakeCapsule,
            targetDistance,
            maxTimeOfImpact,
            stopAtPenetration,
            excludedBody: body,
          }
          return {
            time_of_impact: 0.375,
            collider: supportingCollider,
            witness1: { x: 4, y: 5, z: 6 },
            normal1: { x: 0.1, y: 0.9, z: -0.2 },
            normal2: { x: -0.1, y: -0.9, z: 0.2 },
          }
        },
        castRayAndGetNormal() {
          return null
        },
      },
    })

    const hit = sweep({
      start: { x: 1, y: 2, z: 3 },
      end: { x: 5, y: 7, z: -8 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
    })

    expect(observed).toEqual({
      position: { x: 1, y: 3, z: 2 },
      velocity: { x: 4, y: -11, z: 5 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      capsule: expect.any(FakeCapsule),
      targetDistance: 0,
      maxTimeOfImpact: 1,
      stopAtPenetration: true,
      excludedBody,
    })
    expect(observed?.capsule.halfHeight).toBeCloseTo(0.6, 12)
    expect(observed?.capsule.radius).toBe(0.3)
    expect(hit).toEqual({
      validBlockingHit: true,
      time: 0.375,
      impactNormal: { x: 0.1, y: -0.2, z: 0.9 },
      impactPoint: { x: 4, y: 6, z: 5 },
      bBlockingHit: true,
      bStartPenetrating: false,
      collider: supportingCollider,
      rigidBody: supportingBody,
    })
  })

  it('uses the first ALS ComputeFloorDist sweep and rejects non-walkable normals', () => {
    const queries: Array<{
      start: { x: number; y: number; z: number }
      end: { x: number; y: number; z: number }
      capsuleRadius: number
      capsuleHalfHeight: number
    }> = []
    const walkable = probeRapierAlsGround(
      (query) => {
        queries.push(query)
        return {
          validBlockingHit: true,
          time: 0.5,
          impactNormal: { x: 0, y: 0, z: 0.8 },
        }
      },
      {
        location: { x: 1, y: 2, z: 3 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      },
    )
    expect(queries).toHaveLength(1)
    expect(queries[0].start).toEqual({ x: 1, y: 2, z: 3 })
    expect(queries[0].end.x).toBe(1)
    expect(queries[0].end.y).toBe(2)
    expect(queries[0].end.z).toBeCloseTo(
      3 - ALS_RAPIER_GROUND_PROBE_DISTANCE - 0.06,
      12,
    )
    expect(queries[0].capsuleRadius).toBe(0.3)
    expect(queries[0].capsuleHalfHeight).toBeCloseTo(0.84, 12)
    expect(walkable).not.toBeNull()

    expect(probeRapierAlsGround(
      () => ({
        validBlockingHit: true,
        time: 0,
        impactNormal: { x: 0, y: 0, z: 0.7 },
      }),
      {
        location: { x: 0, y: 0, z: 0 },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      },
    )).toBeNull()
  })

  it('converts the ALS center floor ray, normal, support, and owner exclusion once', () => {
    const excludedBody = {}
    const supportingBody = {
      handle: 31,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isFixed: () => true,
    }
    const supportingCollider = {
      handle: 32,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      parent: () => supportingBody,
    }
    let observed:
      | {
          origin: { x: number; y: number; z: number }
          direction: { x: number; y: number; z: number }
          maxTimeOfImpact: number
          solid: boolean
          excludedBody: unknown
        }
      | undefined
    const sweep = createRapierAlsCapsuleSweep({
      Capsule: FakeCapsule,
      Ray: FakeRay,
      excludeRigidBody: excludedBody,
      world: {
        castShape() {
          return null
        },
        castRayAndGetNormal(
          ray,
          maxTimeOfImpact,
          solid,
          _flags,
          _groups,
          _collider,
          body,
        ) {
          observed = {
            origin: { ...ray.origin },
            direction: { ...ray.dir },
            maxTimeOfImpact,
            solid,
            excludedBody: body,
          }
          return {
            timeOfImpact: 0.5,
            collider: supportingCollider,
            normal: { x: 0.1, y: 0.9, z: -0.2 },
          }
        },
      },
    })

    const hit = sweep.lineTrace({
      start: { x: 1, y: 2, z: 3 },
      end: { x: 5, y: 7, z: -8 },
    })

    expect(observed).toEqual({
      origin: { x: 1, y: 3, z: 2 },
      direction: { x: 4, y: -11, z: 5 },
      maxTimeOfImpact: 1,
      solid: true,
      excludedBody,
    })
    expect(hit).toEqual({
      validBlockingHit: true,
      time: 0.5,
      impactNormal: { x: 0.1, y: -0.2, z: 0.9 },
      impactPoint: { x: 3, y: 4.5, z: -2.5 },
      bBlockingHit: true,
      bStartPenetrating: false,
      collider: supportingCollider,
      rigidBody: supportingBody,
    })
  })

  it('retries an adjacent wall hit with ALS exact overlap sweep dimensions', () => {
    const queries: Array<{
      start: { x: number; y: number; z: number }
      end: { x: number; y: number; z: number }
      capsuleRadius: number
      capsuleHalfHeight: number
    }> = []
    const floorHit = {
      validBlockingHit: true,
      time: 0.9,
      impactNormal: { x: 0, y: 0, z: 1 },
    }
    const result = probeRapierAlsGround((query) => {
      queries.push(query)
      return queries.length === 1
        ? {
            validBlockingHit: true,
            time: 0.125,
            impactNormal: { x: -1, y: 0, z: 0 },
            impactPoint: { x: 1.3, y: 2, z: 2.7 },
          }
        : floorHit
    }, {
      location: { x: 1, y: 2, z: 3 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      walkableFloorAngleCos: 0.71,
    })

    expect(result).toBe(floorHit)
    expect(queries).toHaveLength(2)
    expect(queries[1].start).toEqual({ x: 1, y: 2, z: 3 })
    expect(queries[1].end.z).toBeCloseTo(
      3 - ALS_RAPIER_GROUND_PROBE_DISTANCE - 0.54,
      12,
    )
    expect(queries[1].capsuleRadius).toBeCloseTo(0.298499, 12)
    expect(queries[1].capsuleHalfHeight).toBeCloseTo(0.36, 12)
  })

  it('does not accept a retry that remains start-penetrating', () => {
    let queryCount = 0
    const result = probeRapierAlsGround(() => {
      queryCount++
      return queryCount === 1
        ? {
            validBlockingHit: true,
            time: 0,
            impactNormal: { x: -1, y: 0, z: 0 },
          }
        : {
            validBlockingHit: true,
            time: 0,
            impactNormal: { x: 0, y: 0, z: 1 },
            bBlockingHit: true,
            bStartPenetrating: true,
          }
    }, {
      location: { x: 0, y: 0, z: 0.9215 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      walkableFloorAngleCos: 0.71,
    })

    expect(queryCount).toBe(2)
    expect(result).toBeNull()
  })

  it('keeps floor support when the standing capsule presses into a vertical wall', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    )
    const floor = world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.05, 20),
      floorBody,
    )
    const obstacleBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(3, 0.5, 0),
    )
    const obstacle = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.5, 1.5),
      obstacleBody,
    )
    world.step()

    const sweep = createRapierAlsCapsuleSweep({
      world,
      Capsule: RAPIER.Capsule,
      Ray: RAPIER.Ray,
    })
    const queries: Parameters<typeof sweep>[0][] = []
    const hits: ReturnType<typeof sweep>[] = []
    const observedSweep = Object.assign(
      (query: Parameters<typeof sweep>[0]) => {
        queries.push(query)
        const hit = sweep(query)
        hits.push(hit)
        return hit
      },
      {
        lineTrace(query: Parameters<typeof sweep.lineTrace>[0]) {
          return sweep.lineTrace(query)
        },
      },
    )
    const ground = probeRapierAlsGround(
      observedSweep,
      {
        // The obstacle face is x=2.25. At x=1.951 the 0.3 m capsule starts the
        // floor sweep 1 mm into that face, reproducing the live false-InAir edge.
        location: {
          x: 1.951,
          y: 0,
          z: 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      },
    )

    expect(queries).toHaveLength(2)
    expect(hits[0]?.collider.handle).toBe(obstacle.handle)
    expect(hits[0]?.bBlockingHit).toBe(true)
    expect(hits[0]?.validBlockingHit).toBe(false)
    expect(hits[0]?.bStartPenetrating).toBe(true)
    expect(hits[0]?.impactNormal.z).toBeLessThan(0.71)
    // World.castShape's witness is world-space: this is the translated wall's x=2.25 face.
    expect(hits[0]?.impactPoint.x).toBeCloseTo(2.25, 5)
    expect(queries[1].capsuleRadius).toBeCloseTo(0.298499, 12)
    expect(ground?.collider.handle).toBe(floor.handle)
    expect(ground?.impactNormal.z).toBeGreaterThanOrEqual(0.71)
    world.free()
  })

  it('uses ALS ComputeFloorDist center line fallback after a deep ledge penetration', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0),
    )
    const floor = world.createCollider(
      RAPIER.ColliderDesc.cuboid(20, 0.05, 20),
      floorBody,
    )
    const obstacleBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(3, 0.5, 0),
    )
    const obstacle = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.5, 1.5),
      obstacleBody,
    )
    world.step()

    const sweep = createRapierAlsCapsuleSweep({
      world,
      Capsule: RAPIER.Capsule,
      Ray: RAPIER.Ray,
    })
    const capsuleHits: ReturnType<typeof sweep>[] = []
    const lineQueries: Parameters<typeof sweep.lineTrace>[0][] = []
    const observedSweep = Object.assign(
      (query: Parameters<typeof sweep>[0]) => {
        const hit = sweep(query)
        capsuleHits.push(hit)
        return hit
      },
      {
        lineTrace(query: Parameters<typeof sweep.lineTrace>[0]) {
          lineQueries.push(query)
          return sweep.lineTrace(query)
        },
      },
    )
    const ground = probeRapierAlsGround(
      observedSweep,
      {
        // The wall face is x=2.25. Here the capsule is 5 cm into it, so even the smaller
        // retry capsule remains penetrating. The center ray is still clear and must recover
        // the floor exactly as ComputeFloorDist's final line trace does.
        location: {
          x: 2,
          y: 0,
          z: 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        },
        capsuleRadius: 0.3,
        capsuleHalfHeight: 0.9,
        walkableFloorAngleCos: 0.71,
      },
    )

    expect(capsuleHits).toHaveLength(2)
    expect(capsuleHits[0]?.collider.handle).toBe(obstacle.handle)
    expect(capsuleHits[0]?.bStartPenetrating).toBe(true)
    expect(capsuleHits[1]?.collider.handle).toBe(obstacle.handle)
    expect(capsuleHits[1]?.bStartPenetrating).toBe(true)
    expect(lineQueries).toEqual([{
      start: {
        x: 2,
        y: 0,
        z: 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
      },
      end: {
        x: 2,
        y: 0,
        z: 0.9 + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE
          - ALS_RAPIER_GROUND_PROBE_DISTANCE - 0.9,
      },
    }])
    expect(ground?.collider.handle).toBe(floor.handle)
    expect(ground?.impactNormal.z).toBeGreaterThanOrEqual(0.71)
    expect(ground?.time).toBeGreaterThan(0)
    world.free()
  })

  it('returns null on a miss and resolves the owner at query time', () => {
    const firstBody = {}
    const secondBody = {}
    const observedBodies: unknown[] = []
    let currentBody: unknown = firstBody
    const sweep = createRapierAlsCapsuleSweep({
      Capsule: FakeCapsule,
      Ray: FakeRay,
      resolveExcludeRigidBody: () => currentBody,
      world: {
        castShape(
          _position,
          _rotation,
          _velocity,
          _shape,
          _targetDistance,
          _maxTimeOfImpact,
          _stopAtPenetration,
          _flags,
          _groups,
          _collider,
          body,
        ) {
          observedBodies.push(body)
          return null
        },
        castRayAndGetNormal() {
          return null
        },
      },
    })
    const query = {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 0, y: 0, z: -1 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
    }

    expect(sweep(query)).toBeNull()
    currentBody = secondBody
    expect(sweep(query)).toBeNull()
    expect(observedBodies).toEqual([firstBody, secondBody])
  })

  it('maps moving and static floor primitives without erasing support identity', () => {
    const dynamicBody = {
      handle: 17,
      translation: () => ({ x: 1, y: 2, z: 3 }),
      rotation: () => ({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 }),
      isFixed: () => false,
    }
    const fixedBody = {
      handle: 18,
      translation: () => ({ x: 4, y: 5, z: 6 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isFixed: () => true,
    }
    const standaloneCollider = {
      handle: 19,
      translation: () => ({ x: 7, y: 8, z: 9 }),
      rotation: () => ({ x: 0, y: 0.25, z: 0, w: 0.9682458 }),
      parent: () => null,
    }
    const colliderFor = (
      parent: typeof dynamicBody | typeof fixedBody | null,
    ) => ({
      handle: 20,
      translation: () => ({ x: 100, y: 200, z: 300 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      parent: () => parent,
    })
    const hitFor = (
      collider: ReturnType<typeof colliderFor> | typeof standaloneCollider,
    ) => ({
      validBlockingHit: true,
      time: 0,
      impactNormal: { x: 0, y: 0, z: 1 },
      collider,
      rigidBody: collider.parent(),
    })
    const dynamicCollider = colliderFor(dynamicBody)
    const fixedCollider = colliderFor(fixedBody)

    expect(rapierAlsMovementBase(hitFor(dynamicCollider))).toEqual({
      primitive: dynamicCollider,
      boneName: '',
      hasRelativeLocation: true,
      relativeRotation: false,
      location: { x: 100, y: 300, z: 200 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    expect(
      rapierAlsMovementBase(hitFor(dynamicCollider), true),
    ).toMatchObject({
      primitive: dynamicCollider,
      hasRelativeLocation: true,
      relativeRotation: true,
    })
    expect(rapierAlsMovementBase(hitFor(fixedCollider))).toMatchObject({
      primitive: fixedCollider,
      hasRelativeLocation: false,
      relativeRotation: false,
      location: { x: 100, y: 300, z: 200 },
    })
    expect(rapierAlsMovementBase(hitFor(standaloneCollider))).toEqual({
      primitive: standaloneCollider,
      boneName: '',
      hasRelativeLocation: false,
      relativeRotation: false,
      location: { x: 7, y: 9, z: 8 },
      rotation: { x: 0, y: 0, z: -0.25, w: 0.9682458 },
    })
    expect(rapierAlsMovementBase(null).primitive).toBeNull()
  })

  it('publishes the exact based-movement subset consumed by ALSCamera', () => {
    const dynamicBody = {
      handle: 27,
      translation: () => ({ x: 1, y: 2, z: 3 }),
      rotation: () => ({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 }),
      isFixed: () => false,
    }
    const collider = {
      handle: 28,
      translation: () => ({ x: 100, y: 200, z: 300 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      parent: () => dynamicBody,
    }
    const hit = {
      validBlockingHit: true,
      time: 0,
      impactNormal: { x: 0, y: 0, z: 1 },
      collider,
      rigidBody: dynamicBody,
    }

    expect(rapierAlsCameraMovementBase(hit)).toEqual({
      key: collider,
      boneName: '',
      hasRelativeRotation: false,
      location: { x: 100, y: 300, z: 200 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    expect(rapierAlsCameraMovementBase(hit, true)).toMatchObject({
      key: collider,
      hasRelativeRotation: true,
    })
    expect(rapierAlsCameraMovementBase(null)).toBeNull()
  })

  it('retains a SetBase target without inventing a floor-sweep hit', () => {
    let targetTranslation = { x: 20, y: 30, z: 40 }
    const movingBody = {
      handle: 37,
      translation: () => ({ x: 2, y: 3, z: 4 }),
      rotation: () => ({ x: 0, y: 0.2, z: 0, w: 0.98 }),
      isFixed: () => false,
    }
    const targetCollider = {
      handle: 38,
      translation: () => targetTranslation,
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      parent: () => movingBody,
    }

    expect(
      rapierAlsMovementBaseFromPrimitive(targetCollider),
    ).toEqual({
      primitive: targetCollider,
      boneName: '',
      hasRelativeLocation: true,
      relativeRotation: false,
      location: { x: 20, y: 40, z: 30 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    })
    expect(
      rapierAlsCameraMovementBaseFromPrimitive(
        targetCollider,
        true,
      ),
    ).toMatchObject({
      key: targetCollider,
      hasRelativeRotation: true,
      location: { x: 20, y: 40, z: 30 },
    })

    targetTranslation = { x: 21, y: 34, z: 55 }
    expect(
      rapierAlsMovementBaseFromPrimitive(targetCollider).location,
    ).toEqual({ x: 21, y: 55, z: 34 })
  })

  it('retains real Rapier primitive-component collider identities', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const staticCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 0.1, 2),
    )
    const movingBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(5, 0, 0),
    )
    const movingCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 0.1, 2),
      movingBody,
    )
    world.step()
    const sweep = createRapierAlsCapsuleSweep({
      world,
      Capsule: RAPIER.Capsule,
      Ray: RAPIER.Ray,
      filterFlags: RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    })

    const staticHit = sweep({
      start: { x: 0, y: 0, z: 1.1 },
      end: { x: 0, y: 0, z: -1 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.5,
    })
    expect(staticHit?.collider.handle).toBe(staticCollider.handle)
    expect(staticHit?.rigidBody).toBeNull()
    const staticBase = rapierAlsMovementBase(staticHit)
    expect(
      (staticBase.primitive as typeof staticCollider).handle,
    ).toBe(staticCollider.handle)
    expect(staticBase.hasRelativeLocation).toBe(false)

    const movingHit = sweep({
      start: { x: 5, y: 0, z: 1.1 },
      end: { x: 5, y: 0, z: -1 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.5,
    })
    expect(movingHit?.collider.handle).toBe(movingCollider.handle)
    expect(movingHit?.rigidBody?.handle).toBe(movingBody.handle)
    const movingBase = rapierAlsMovementBase(movingHit)
    expect(
      (movingBase.primitive as typeof movingCollider).handle,
    ).toBe(movingCollider.handle)
    expect(movingBase.hasRelativeLocation).toBe(true)

    world.free()
  })
})
