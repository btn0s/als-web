import { QueryFilterFlags } from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type {
  AlsControlRigFootOffsetTraceRequest,
} from '../als/AnimGraph/CR_Als'
import {
  createRapierAlsControlRigFootTrace,
} from './rapierAlsControlRigFootTrace'

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
  start = new THREE.Vector3(0.2, 0.5, -0.35),
  end = new THREE.Vector3(0.2, -0.8, -0.35),
): AlsControlRigFootOffsetTraceRequest {
  return {
    side: 'left',
    start,
    end,
    traceChannel: 'Visibility',
    ignoreOwningActor: true,
  }
}

function expectVectorClose(
  actual: THREE.Vector3 | undefined,
  expected: THREE.Vector3,
  precision = 6,
) {
  expect(actual?.x).toBeCloseTo(expected.x, precision)
  expect(actual?.y).toBeCloseTo(expected.y, precision)
  expect(actual?.z).toBeCloseTo(expected.z, precision)
}

describe('Rapier CR_Als foot trace', () => {
  it('casts the exact supplied component-space endpoints as one solid world ray', () => {
    const excludedBody = {}
    let observed:
      | {
          origin: THREE.Vector3
          direction: THREE.Vector3
          distance: number
          solid: boolean
          excludedBody: unknown
        }
      | undefined
    const trace = createRapierAlsControlRigFootTrace({
      component: new THREE.Object3D(),
      Ray: FakeRay,
      excludeRigidBody: excludedBody,
      queryFilterForChannel: () => ({}),
      world: {
        castRayAndGetNormal(
          ray,
          distance,
          solid,
          _flags,
          _groups,
          _collider,
          body,
        ) {
          observed = {
            origin: new THREE.Vector3(
              ray.origin.x,
              ray.origin.y,
              ray.origin.z,
            ),
            direction: new THREE.Vector3(
              ray.dir.x,
              ray.dir.y,
              ray.dir.z,
            ),
            distance,
            solid,
            excludedBody: body,
          }
          return {
            timeOfImpact: 0.5,
            normal: { x: 0, y: 1, z: 0 },
          }
        },
      },
    })

    const hit = trace(request())

    expect(observed?.origin.toArray()).toEqual([0.2, 0.5, -0.35])
    expect(observed?.direction.toArray()).toEqual([0, -1, 0])
    expect(observed?.distance).toBeCloseTo(1.3, 12)
    expect(observed?.solid).toBe(true)
    expect(observed?.excludedBody).toBe(excludedBody)
    expectVectorClose(
      hit?.impactPoint,
      new THREE.Vector3(0.2, 0, -0.35),
    )
    expectVectorClose(
      hit?.impactNormal,
      new THREE.Vector3(0, 1, 0),
    )
  })

  it('round-trips points and normals through a transformed component', () => {
    const component = new THREE.Object3D()
    component.position.set(3, 2, -4)
    component.rotation.set(0.2, -0.7, 0.1)
    component.scale.set(1.5, 0.75, 2)
    component.updateMatrixWorld(true)
    const start = new THREE.Vector3(0.1, 0.5, 0.3)
    const end = new THREE.Vector3(0.1, -0.8, 0.3)
    const expectedPoint = start.clone().lerp(end, 0.4)
    const expectedNormal = new THREE.Vector3(0.2, 1, -0.1).normalize()
    const worldPoint = expectedPoint.clone().applyMatrix4(
      component.matrixWorld,
    )
    const worldNormal = expectedNormal.clone().applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(component.matrixWorld),
    )
    const trace = createRapierAlsControlRigFootTrace({
      component,
      Ray: FakeRay,
      queryFilterForChannel: () => ({}),
      world: {
        castRayAndGetNormal(ray) {
          const origin = new THREE.Vector3(
            ray.origin.x,
            ray.origin.y,
            ray.origin.z,
          )
          const direction = new THREE.Vector3(
            ray.dir.x,
            ray.dir.y,
            ray.dir.z,
          )
          return {
            timeOfImpact: worldPoint.clone().sub(origin).dot(direction),
            normal: worldNormal,
          }
        },
      },
    })

    const hit = trace(request(start, end))

    expectVectorClose(hit?.impactPoint, expectedPoint)
    expectVectorClose(hit?.impactNormal, expectedNormal)
  })

  it('returns null for a miss or a collapsed component-space segment', () => {
    let casts = 0
    const trace = createRapierAlsControlRigFootTrace({
      component: new THREE.Object3D(),
      Ray: FakeRay,
      queryFilterForChannel: () => ({}),
      world: {
        castRayAndGetNormal() {
          casts++
          return null
        },
      },
    })

    expect(trace(request())).toBeNull()
    const point = new THREE.Vector3(1, 2, 3)
    expect(trace(request(point, point))).toBeNull()
    expect(casts).toBe(1)
  })

  it('maps Visibility filters and resolves all owning-actor exclusions per trace', () => {
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
    const trace = createRapierAlsControlRigFootTrace({
      component: new THREE.Object3D(),
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
})
