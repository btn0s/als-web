import { describe, expect, it } from 'vitest'
import {
  ALS_RAPIER_GROUND_PROBE_DISTANCE,
  createRapierAlsCapsuleSweep,
  probeRapierAlsGround,
} from './rapierAlsCapsuleSweep'

class FakeCapsule {
  readonly halfHeight: number
  readonly radius: number

  constructor(halfHeight: number, radius: number) {
    this.halfHeight = halfHeight
    this.radius = radius
  }
}

describe('Rapier ALS capsule sweep', () => {
  it('converts the complete Z-up query once and preserves normalized hit time', () => {
    const excludedBody = {}
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
})
