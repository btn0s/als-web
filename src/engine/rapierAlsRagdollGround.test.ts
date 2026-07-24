import { describe, expect, it } from 'vitest'
import {
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
} from './characterMovementFloor'
import {
  createRapierAlsRagdollGroundTrace,
} from './rapierAlsRagdollGround'

class FakeBall {
  readonly radius: number

  constructor(radius: number) {
    this.radius = radius
  }
}

// ALS Refactored 4.15:
// Source/ALS/Private/AlsCharacter_Actions.cpp:922-958.
describe('Rapier ALS RagdollTraceGround bridge', () => {
  it('ports the exact sphere sweep and actor-center correction', () => {
    let captured:
      | {
          position: { x: number; y: number; z: number }
          rotation: { x: number; y: number; z: number; w: number }
          velocity: { x: number; y: number; z: number }
          shape: unknown
          targetDistance: number
          maxToi: number
          stopAtPenetration: boolean
        }
      | undefined
    const collider = { handle: 42 }
    const trace = createRapierAlsRagdollGroundTrace({
      Ball: FakeBall,
      world: {
        castShape(
          position,
          rotation,
          velocity,
          shape,
          targetDistance,
          maxToi,
          stopAtPenetration,
        ) {
          captured = {
            position: { ...position },
            rotation: { ...rotation },
            velocity: { ...velocity },
            shape,
            targetDistance,
            maxToi,
            stopAtPenetration,
          }
          return {
            collider,
            time_of_impact: 0.25,
          }
        },
      },
    })

    const result = trace({
      RagdollLocation: { x: 1, y: 2, z: 3 },
      CapsuleRadius: 0.3,
      CapsuleHalfHeight: 0.9,
    })

    /*
     * ALS source, converted from cm to metres and C:(x,y,z)->(x,z,y):
     * TraceStart = (1, 2, 3 + 2 * .3)
     * TraceEnd   = (1, 2, 3 - .9 + .3)
     */
    expect(captured).toMatchObject({
      position: { x: 1, y: 3.6, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: -1.2, z: 0 },
      targetDistance: 0,
      maxToi: 1,
      stopAtPenetration: true,
    })
    const capturedShape = captured?.shape
    expect(capturedShape).toBeInstanceOf(FakeBall)
    expect((capturedShape as FakeBall).radius).toBe(0.3)
    expect(result).toMatchObject({
      bGrounded: true,
      ActorLocation: {
        x: 1,
        y: 2,
      },
      HitCollider: collider,
    })
    expect(result.HitLocation?.x).toBeCloseTo(1, 12)
    expect(result.HitLocation?.y).toBeCloseTo(2, 12)
    expect(result.HitLocation?.z).toBeCloseTo(3.3, 12)
    expect(result.ActorLocation.z).toBeCloseTo(
      3.3
        + 0.9
        - 0.3
        + UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
      12,
    )
  })

  it('keeps the pelvis target when the sweep finds no ground', () => {
    const trace = createRapierAlsRagdollGroundTrace({
      Ball: FakeBall,
      world: { castShape: () => null },
    })

    expect(trace({
      RagdollLocation: { x: -2, y: 4, z: 1.5 },
      CapsuleRadius: 0.3,
      CapsuleHalfHeight: 0.9,
    })).toEqual({
      bGrounded: false,
      ActorLocation: { x: -2, y: 4, z: 1.5 },
      HitLocation: null,
      HitCollider: null,
    })
  })

  it('forwards collision mapping and the actor-wide self-filter', () => {
    const selfCollider = { handle: 7 }
    let predicateResult: boolean | undefined
    let capturedFlags: number | undefined
    let capturedGroups: number | undefined
    const trace = createRapierAlsRagdollGroundTrace({
      Ball: FakeBall,
      filterFlags: 12,
      filterGroups: 34,
      filterPredicate: ({ handle }) => handle !== 7,
      world: {
        castShape(
          _position,
          _rotation,
          _velocity,
          _shape,
          _targetDistance,
          _maxToi,
          _stopAtPenetration,
          flags,
          groups,
          _excludeCollider,
          _excludeRigidBody,
          predicate,
        ) {
          capturedFlags = flags
          capturedGroups = groups
          predicateResult = predicate?.(selfCollider)
          return null
        },
      },
    })

    trace({
      RagdollLocation: { x: 0, y: 0, z: 0 },
      CapsuleRadius: 0.3,
      CapsuleHalfHeight: 0.9,
    })
    expect(capturedFlags).toBe(12)
    expect(capturedGroups).toBe(34)
    expect(predicateResult).toBe(false)
  })

  it('reuses the sphere until the authored capsule radius changes', () => {
    const shapes: unknown[] = []
    const trace = createRapierAlsRagdollGroundTrace({
      Ball: FakeBall,
      world: {
        castShape(
          _position,
          _rotation,
          _velocity,
          shape,
        ) {
          shapes.push(shape)
          return null
        },
      },
    })
    const input = {
      RagdollLocation: { x: 0, y: 0, z: 0 },
      CapsuleRadius: 0.3,
      CapsuleHalfHeight: 0.9,
    }
    trace(input)
    trace(input)
    trace({ ...input, CapsuleRadius: 0.4 })
    expect(shapes[0]).toBe(shapes[1])
    expect(shapes[2]).not.toBe(shapes[1])
  })

  it('rejects dimensions outside Unreal capsule invariants', () => {
    const trace = createRapierAlsRagdollGroundTrace({
      Ball: FakeBall,
      world: { castShape: () => null },
    })
    const input = {
      RagdollLocation: { x: 0, y: 0, z: 0 },
      CapsuleRadius: 0.3,
      CapsuleHalfHeight: 0.9,
    }

    expect(() => trace({
      ...input,
      CapsuleRadius: 0,
    })).toThrow('HalfHeight >= Radius > 0')
    expect(() => trace({
      ...input,
      CapsuleHalfHeight: 0.2,
    })).toThrow('HalfHeight >= Radius > 0')
    expect(() => trace({
      ...input,
      CapsuleRadius: Number.NaN,
    })).toThrow('HalfHeight >= Radius > 0')
  })
})
