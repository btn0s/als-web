import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ALS_RAPIER_GROUND_PROBE_DISTANCE,
  createRapierAlsCapsuleSweep,
  probeRapierAlsGround,
  rapierAlsCameraMovementBase,
  rapierAlsMovementBase,
} from './rapierAlsCapsuleSweep'

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
            normal1: { x: 0.1, y: 0.9, z: -0.2 },
            normal2: { x: -0.1, y: -0.9, z: 0.2 },
          }
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
      collider: supportingCollider,
      rigidBody: supportingBody,
    })
  })

  it('probes the whole capsule downward and rejects non-walkable normals', () => {
    const queries: unknown[] = []
    const walkable = probeRapierAlsGround(
      (query) => {
        queries.push(query)
        return {
          validBlockingHit: true,
          time: 0,
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
    expect(queries).toEqual([{
      start: { x: 1, y: 2, z: 3 },
      end: {
        x: 1,
        y: 2,
        z: 3 - ALS_RAPIER_GROUND_PROBE_DISTANCE,
      },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
    }])
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

  it('returns null on a miss and resolves the owner at query time', () => {
    const firstBody = {}
    const secondBody = {}
    const observedBodies: unknown[] = []
    let currentBody: unknown = firstBody
    const sweep = createRapierAlsCapsuleSweep({
      Capsule: FakeCapsule,
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

    expect(rapierAlsMovementBase(hitFor(colliderFor(dynamicBody)))).toEqual({
      primitive: dynamicBody,
      boneName: '',
      hasRelativeLocation: true,
      relativeRotation: false,
      location: { x: 1, y: 3, z: 2 },
      rotation: { x: -0.1, y: -0.3, z: -0.2, w: 0.9 },
    })
    expect(
      rapierAlsMovementBase(hitFor(colliderFor(dynamicBody)), true),
    ).toMatchObject({
      primitive: dynamicBody,
      hasRelativeLocation: true,
      relativeRotation: true,
    })
    expect(rapierAlsMovementBase(hitFor(colliderFor(fixedBody)))).toMatchObject({
      primitive: fixedBody,
      hasRelativeLocation: false,
      relativeRotation: false,
      location: { x: 4, y: 6, z: 5 },
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
      key: dynamicBody,
      boneName: '',
      hasRelativeRotation: false,
      location: { x: 1, y: 3, z: 2 },
      rotation: { x: -0.1, y: -0.3, z: -0.2, w: 0.9 },
    })
    expect(rapierAlsCameraMovementBase(hit, true)).toMatchObject({
      key: dynamicBody,
      hasRelativeRotation: true,
    })
    expect(rapierAlsCameraMovementBase(null)).toBeNull()
  })

  it('retains real Rapier standalone-collider and parent-body identities', () => {
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
      (movingBase.primitive as typeof movingBody).handle,
    ).toBe(movingBody.handle)
    expect(movingBase.hasRelativeLocation).toBe(true)

    world.free()
  })
})
