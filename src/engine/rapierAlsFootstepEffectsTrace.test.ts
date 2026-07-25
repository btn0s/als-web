import { QueryFilterFlags } from '@dimforge/rapier3d-compat'
import { describe, expect, it } from 'vitest'
import type {
  AlsFootstepEffectsTraceRequest,
} from '../als/Notifies/AlsAnimNotify_FootstepEffects'
import {
  createRapierAlsFootstepEffectsTrace,
} from './rapierAlsFootstepEffectsTrace'

class FakeRay {
  readonly origin: { x: number; y: number; z: number }
  readonly dir: { x: number; y: number; z: number }

  constructor(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
  ) {
    this.origin = origin
    this.dir = direction
  }
}

function request(
  Start = { x: 1, y: 2, z: 3 },
  End = { x: 1, y: 1.5, z: 3 },
): AlsFootstepEffectsTraceRequest {
  return {
    Start,
    End,
    TraceChannel: 'Visibility',
    bIgnoreOwningActor: true,
  }
}

describe('Rapier ALS footstep-effects trace', () => {
  it('casts the exact world segment as a solid Visibility ray', () => {
    const body = {}
    let captured:
      | {
          origin: { x: number; y: number; z: number }
          direction: { x: number; y: number; z: number }
          distance: number
          solid: boolean
          excludedBody: unknown
        }
      | undefined
    const trace = createRapierAlsFootstepEffectsTrace({
      Ray: FakeRay,
      excludeRigidBody: body,
      queryFilterForChannel: () => ({}),
      world: {
        castRayAndGetNormal(
          ray,
          distance,
          solid,
          _flags,
          _groups,
          _collider,
          excludedBody,
        ) {
          captured = {
            origin: { ...ray.origin },
            direction: { ...ray.dir },
            distance,
            solid,
            excludedBody,
          }
          return {
            timeOfImpact: 0.2,
            normal: { x: 0, y: 1, z: 0 },
          }
        },
      },
    })

    const hit = trace(request())

    expect(captured).toEqual({
      origin: { x: 1, y: 2, z: 3 },
      direction: { x: 0, y: -1, z: 0 },
      distance: 0.5,
      solid: true,
      excludedBody: body,
    })
    expect(hit).toEqual({
      ImpactPoint: { x: 1, y: 1.8, z: 3 },
      ImpactNormal: { x: 0, y: 1, z: 0 },
      PhysicalSurface: 'SurfaceType_Default',
    })
  })

  it('maps filters and resolves all owning-actor exclusions per trace', () => {
    const firstBody = {}
    const secondBody = {}
    const ownerCollider = { handle: 11 }
    const channelRejectedCollider = { handle: 22 }
    const acceptedCollider = { handle: 33 }
    let currentBody: unknown = firstBody
    const observedBodies: unknown[] = []
    const observedAcceptance: boolean[][] = []
    let observedChannel: string | undefined
    let observedFlags: number | undefined
    let observedGroups: number | undefined
    const trace = createRapierAlsFootstepEffectsTrace({
      Ray: FakeRay,
      resolveExcludeRigidBody: () => currentBody,
      getOwnerColliders: () => [ownerCollider],
      queryFilterForChannel: (channel) => {
        observedChannel = channel
        return {
          flags: QueryFilterFlags.EXCLUDE_DYNAMIC,
          groups: 0x0001_0002,
          predicate: (collider) => (
            collider.handle !== channelRejectedCollider.handle
          ),
        }
      },
      world: {
        castRayAndGetNormal(
          _ray,
          _distance,
          _solid,
          flags,
          groups,
          _collider,
          body,
          predicate,
        ) {
          observedFlags = flags
          observedGroups = groups
          observedBodies.push(body)
          observedAcceptance.push([
            predicate?.(ownerCollider) ?? false,
            predicate?.(channelRejectedCollider) ?? false,
            predicate?.(acceptedCollider) ?? false,
          ])
          return null
        },
      },
    })

    trace(request())
    currentBody = secondBody
    trace(request())

    expect(observedChannel).toBe('Visibility')
    expect(observedFlags).toBe(
      QueryFilterFlags.EXCLUDE_DYNAMIC
      | QueryFilterFlags.EXCLUDE_SENSORS,
    )
    expect(observedGroups).toBe(0x0001_0002)
    expect(observedBodies).toEqual([firstBody, secondBody])
    expect(observedAcceptance).toEqual([
      [false, false, true],
      [false, false, true],
    ])
  })

  it('returns null for a miss or collapsed segment', () => {
    let casts = 0
    const trace = createRapierAlsFootstepEffectsTrace({
      Ray: FakeRay,
      excludeRigidBody: {},
      queryFilterForChannel: () => ({}),
      world: {
        castRayAndGetNormal() {
          casts++
          return null
        },
      },
    })

    expect(trace(request())).toBeNull()
    expect(trace(request(
      { x: 1, y: 2, z: 3 },
      { x: 1, y: 2, z: 3 },
    ))).toBeNull()
    expect(casts).toBe(1)
  })

  it('rejects an adapter that could trace into its owning actor', () => {
    expect(() => createRapierAlsFootstepEffectsTrace({
      Ray: FakeRay,
      queryFilterForChannel: () => ({}),
      world: { castRayAndGetNormal: () => null },
    } as never)).toThrow(
      'requires an owning rigid-body exclusion',
    )
  })
})
