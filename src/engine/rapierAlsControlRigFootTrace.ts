import { QueryFilterFlags } from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type {
  AlsControlRigFootOffsetTrace,
  AlsControlRigFootOffsetTraceRequest,
} from '../als/AnimGraph/CR_Als'

interface RapierVector {
  x: number
  y: number
  z: number
}

interface RapierRay {
  origin: RapierVector
  dir: RapierVector
}

interface RapierRayConstructor {
  new(origin: RapierVector, direction: RapierVector): RapierRay
}

interface RapierCollider {
  readonly handle: number
}

interface RapierRayIntersection {
  readonly timeOfImpact: number
  readonly normal: RapierVector
}

interface RapierRayCastWorld {
  castRayAndGetNormal(
    ray: RapierRay,
    maxTimeOfImpact: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    excludeCollider?: unknown,
    excludeRigidBody?: unknown,
    predicate?: (collider: RapierCollider) => boolean,
  ): RapierRayIntersection | null
}

export interface RapierAlsControlRigFootQueryFilter {
  readonly flags?: number
  readonly groups?: number
  readonly predicate?: (collider: RapierCollider) => boolean
}

export interface RapierAlsControlRigFootTraceOptions {
  readonly world: RapierRayCastWorld
  readonly Ray: RapierRayConstructor
  /** Object whose local coordinates are CR_Als's rig/component-global space. */
  readonly component: THREE.Object3D
  readonly queryFilterForChannel: (
    channel: AlsControlRigFootOffsetTraceRequest['traceChannel'],
  ) => RapierAlsControlRigFootQueryFilter
  /** Stable owner fallback for non-React callers. */
  readonly excludeRigidBody?: unknown
  /**
   * React refs populate after render, so the live bridge resolves the owner when each trace runs.
   * When supplied, this takes precedence over `excludeRigidBody`.
   */
  readonly resolveExcludeRigidBody?: () => unknown
  /**
   * Other colliders owned by the actor but not parented to its rigid body. Sampled for each trace
   * so late-created colliders are excluded by the same owning-actor contract.
   */
  readonly getOwnerColliders?: () => Iterable<RapierCollider>
}

/**
 * Rapier bridge for `FAlsRigUnit_FootOffsetTrace`.
 *
 * The pure CR_Als stage owns the authored absolute trace endpoints. This bridge converts those
 * component-space glTF points to world space, performs the Visibility blocking query, then
 * converts the hit point and normal back into the same component space.
 */
export function createRapierAlsControlRigFootTrace(
  options: Readonly<RapierAlsControlRigFootTraceOptions>,
): AlsControlRigFootOffsetTrace {
  const ray = new options.Ray(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  )
  const startWorld = new THREE.Vector3()
  const endWorld = new THREE.Vector3()
  const directionWorld = new THREE.Vector3()
  const impactPoint = new THREE.Vector3()
  const impactNormal = new THREE.Vector3(0, 1, 0)
  const componentWorldInverse = new THREE.Matrix4()
  const worldLinearTranspose = new THREE.Matrix3()
  const ownerColliderHandles = new Set<number>()
  let channelPredicate:
    | RapierAlsControlRigFootQueryFilter['predicate']
    | undefined
  const acceptsCollider = (collider: RapierCollider) => (
    !ownerColliderHandles.has(collider.handle)
    && (channelPredicate?.(collider) ?? true)
  )

  return (request) => {
    const component = options.component
    component.updateWorldMatrix(true, false)
    startWorld.copy(request.start).applyMatrix4(component.matrixWorld)
    endWorld.copy(request.end).applyMatrix4(component.matrixWorld)
    directionWorld.subVectors(endWorld, startWorld)
    const distance = directionWorld.length()
    if (!(distance > Number.EPSILON)) return null

    directionWorld.multiplyScalar(1 / distance)
    ray.origin.x = startWorld.x
    ray.origin.y = startWorld.y
    ray.origin.z = startWorld.z
    ray.dir.x = directionWorld.x
    ray.dir.y = directionWorld.y
    ray.dir.z = directionWorld.z

    const queryFilter = options.queryFilterForChannel(
      request.traceChannel,
    )
    ownerColliderHandles.clear()
    if (request.ignoreOwningActor) {
      const ownerColliders = options.getOwnerColliders?.()
      if (ownerColliders) {
        for (const collider of ownerColliders) {
          ownerColliderHandles.add(collider.handle)
        }
      }
    }
    channelPredicate = queryFilter.predicate

    const hit = options.world.castRayAndGetNormal(
      ray,
      distance,
      true,
      (queryFilter.flags ?? 0) | QueryFilterFlags.EXCLUDE_SENSORS,
      queryFilter.groups,
      undefined,
      request.ignoreOwningActor
        ? options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody
        : undefined,
      acceptsCollider,
    )
    if (!hit) return null

    impactPoint.copy(directionWorld)
      .multiplyScalar(hit.timeOfImpact)
      .add(startWorld)
    componentWorldInverse.copy(component.matrixWorld).invert()
    impactPoint.applyMatrix4(componentWorldInverse)

    // If A maps component vectors to world vectors, normals map by inverse-transpose(A).
    // Therefore a world normal returns to component space through transpose(A).
    worldLinearTranspose
      .setFromMatrix4(component.matrixWorld)
      .transpose()
    impactNormal
      .set(hit.normal.x, hit.normal.y, hit.normal.z)
      .applyMatrix3(worldLinearTranspose)
      .normalize()

    // CR_Als copies both values before issuing the next foot trace, so these buffers can be
    // reused without producing two vector allocations per character per frame.
    return { impactPoint, impactNormal }
  }
}
