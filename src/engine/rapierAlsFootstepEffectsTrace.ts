import { QueryFilterFlags } from '@dimforge/rapier3d-compat'
import type {
  AlsFootstepEffectsTrace,
  AlsFootstepEffectsTraceRequest,
} from '../als/Notifies/AlsAnimNotify_FootstepEffects'

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

export interface RapierAlsFootstepEffectsCollider {
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
    predicate?: (
      collider: RapierAlsFootstepEffectsCollider,
    ) => boolean,
  ): RapierRayIntersection | null
}

export interface RapierAlsFootstepEffectsQueryFilter {
  readonly flags?: number
  readonly groups?: number
  readonly predicate?: (
    collider: RapierAlsFootstepEffectsCollider,
  ) => boolean
}

interface RapierAlsFootstepEffectsTraceOptionsBase {
  readonly world: RapierRayCastWorld
  readonly Ray: RapierRayConstructor
  readonly queryFilterForChannel: (
    channel: AlsFootstepEffectsTraceRequest['TraceChannel'],
  ) => RapierAlsFootstepEffectsQueryFilter
  readonly getOwnerColliders?: (
  ) => Iterable<RapierAlsFootstepEffectsCollider>
}

export type RapierAlsFootstepEffectsTraceOptions =
  RapierAlsFootstepEffectsTraceOptionsBase & (
    | {
        readonly resolveExcludeRigidBody: () => unknown
        readonly excludeRigidBody?: unknown
      }
    | {
        readonly excludeRigidBody: unknown
        readonly resolveExcludeRigidBody?: () => unknown
      }
  )

/**
 * Rapier boundary for UAlsAnimNotify_FootstepEffects's line traces.
 *
 * The pure notify owns both exact endpoints and the Foot-Z/world-down
 * fallback order. This adapter only maps one Visibility query while excluding
 * the complete owning actor.
 */
export function createRapierAlsFootstepEffectsTrace(
  options: Readonly<RapierAlsFootstepEffectsTraceOptions>,
): AlsFootstepEffectsTrace {
  if (
    !options.resolveExcludeRigidBody
    && options.excludeRigidBody === undefined
  ) {
    throw new Error(
      'ALS footstep trace requires an owning rigid-body exclusion',
    )
  }
  const ray = new options.Ray(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  )
  const ownerColliderHandles = new Set<number>()
  let channelPredicate:
    | RapierAlsFootstepEffectsQueryFilter['predicate']
    | undefined
  const acceptsCollider = (
    collider: RapierAlsFootstepEffectsCollider,
  ) => (
    !ownerColliderHandles.has(collider.handle)
    && (channelPredicate?.(collider) ?? true)
  )

  return (request) => {
    const direction = {
      x: request.End.x - request.Start.x,
      y: request.End.y - request.Start.y,
      z: request.End.z - request.Start.z,
    }
    const distance = Math.hypot(
      direction.x,
      direction.y,
      direction.z,
    )
    if (!(distance > Number.EPSILON)) return null

    const inverseDistance = 1 / distance
    ray.origin.x = request.Start.x
    ray.origin.y = request.Start.y
    ray.origin.z = request.Start.z
    ray.dir.x = direction.x * inverseDistance
    ray.dir.y = direction.y * inverseDistance
    ray.dir.z = direction.z * inverseDistance

    const queryFilter = options.queryFilterForChannel(
      request.TraceChannel,
    )
    ownerColliderHandles.clear()
    if (request.bIgnoreOwningActor) {
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
      request.bIgnoreOwningActor
        ? options.resolveExcludeRigidBody?.()
          ?? options.excludeRigidBody
        : undefined,
      acceptsCollider,
    )
    if (!hit) return null

    return {
      ImpactPoint: {
        x: request.Start.x + ray.dir.x * hit.timeOfImpact,
        y: request.Start.y + ray.dir.y * hit.timeOfImpact,
        z: request.Start.z + ray.dir.z * hit.timeOfImpact,
      },
      ImpactNormal: {
        x: hit.normal.x,
        y: hit.normal.y,
        z: hit.normal.z,
      },
      PhysicalSurface: 'SurfaceType_Default',
    }
  }
}
