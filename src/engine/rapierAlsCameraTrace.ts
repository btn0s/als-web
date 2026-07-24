import {
  Ball,
  QueryFilterFlags,
  type Collider,
  type InteractionGroups,
  type RigidBody,
  type World,
} from '@dimforge/rapier3d-compat'
import type {
  AlsCameraTrace,
  AlsCameraTraceRequest,
} from '../als/AlsCamera/AlsCameraComponent'
import {
  threeToUnrealVector,
  unrealToThreeVector,
} from './unrealCoordinateSpace'

interface Vector3 {
  x: number
  y: number
  z: number
}

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const
const UE_KINDA_SMALL_NUMBER = 1e-4
// UE_KINDA_SMALL_NUMBER is 1e-4 in Unreal centimetres.
const UE_KINDA_SMALL_NUMBER_METRES = 1e-6

/**
 * Rapier has collision groups and predicates rather than Unreal trace channels. The application
 * must therefore map `ECC_Visibility` to the same set of blocking colliders that Unreal would
 * query. Sensors are always excluded because ALS ignores ECR_Overlap responses here.
 */
export interface RapierAlsCameraQueryFilter {
  readonly flags?: QueryFilterFlags
  readonly groups?: InteractionGroups
  readonly predicate?: (collider: Collider) => boolean
}

export interface RapierAlsCameraTraceOptions {
  readonly world: World
  readonly queryFilterForChannel: (
    channel: AlsCameraTraceRequest['channel'],
  ) => RapierAlsCameraQueryFilter
  /** Read lazily so a React ref can be wired without importing React into this engine adapter. */
  readonly getOwnerRigidBody?: () => RigidBody | null
  /**
   * Additional owner colliders, including colliders without the owner rigid body as their parent.
   * The iterable is sampled for each trace so late-created colliders are excluded too.
   */
  readonly getOwnerColliders?: () => Iterable<Collider>
}

interface QueryContext {
  flags: QueryFilterFlags
  groups: InteractionGroups | undefined
  ownerRigidBody: RigidBody | undefined
  ownerColliderHandles: Set<number>
  predicate: RapierAlsCameraQueryFilter['predicate']
  accepts: (collider: Collider) => boolean
}

interface ShapeCache {
  radius: number
  shape: Ball | null
}

interface PenetrationAdjustment {
  adjustedStart: Vector3
  free: boolean
}

function subtract(first: Readonly<Vector3>, second: Readonly<Vector3>): Vector3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  }
}

function add(first: Readonly<Vector3>, second: Readonly<Vector3>): Vector3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  }
}

function multiply(vector: Readonly<Vector3>, scalar: number): Vector3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function lengthSquared(vector: Readonly<Vector3>): number {
  return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

function normalize(vector: Readonly<Vector3>): Vector3 | null {
  const length = Math.sqrt(lengthSquared(vector))
  if (length <= UE_KINDA_SMALL_NUMBER_METRES) return null
  return multiply(vector, 1 / length)
}

function dot(first: Readonly<Vector3>, second: Readonly<Vector3>): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function getShape(cache: ShapeCache, radius: number): Ball {
  if (cache.shape === null || cache.radius !== radius) {
    cache.radius = radius
    cache.shape = new Ball(radius)
  }
  return cache.shape
}

function acceptsCollider(
  collider: Collider,
  context: QueryContext,
): boolean {
  return (
    !context.ownerColliderHandles.has(collider.handle)
    && (context.predicate?.(collider) ?? true)
  )
}

function hasPenetration(
  world: World,
  location: Readonly<Vector3>,
  shape: Ball,
  context: QueryContext,
): boolean {
  let penetrating = false
  world.intersectionsWithShape(
    location,
    IDENTITY_ROTATION,
    shape,
    (collider) => {
      const contact = collider.contactShape(
        shape,
        location,
        IDENTITY_ROTATION,
        0,
      )
      penetrating = contact !== null && contact.distance < 0
      return !penetrating
    },
    context.flags,
    context.groups,
    undefined,
    context.ownerRigidBody,
    context.accepts,
  )
  return penetrating
}

function hasBlockingOverlap(
  world: World,
  location: Readonly<Vector3>,
  shape: Ball,
  context: QueryContext,
): boolean {
  return world.intersectionWithShape(
    location,
    IDENTITY_ROTATION,
    shape,
    context.flags,
    context.groups,
    undefined,
    context.ownerRigidBody,
    context.accepts,
  ) !== null
}

/**
 * UAlsCameraComponent::TryAdjustLocationBlockedByGeometry().
 *
 * Rapier's public JS API has no direct equivalent of BodyInstance::OverlapTest(..., FMTDResult).
 * `contactShape()` exposes one signed contact for each collider. Its normal and penetration depth
 * are the exact MTD for the convex primitives used by this demo, but Rapier does not guarantee
 * that one contact is a global MTD for arbitrary non-convex geometry. We preserve ALS's
 * per-collider accumulation and failure branches; a missing signed contact fails adjustment
 * instead of substituting a heuristic.
 */
function tryAdjustLocationBlockedByGeometry(
  world: World,
  location: Readonly<Vector3>,
  ownerLocation: Readonly<Vector3>,
  collisionShape: Ball,
  penetrationAdjustmentShape: Ball,
  context: QueryContext,
): PenetrationAdjustment | null {
  let anyOverlap = false
  let failed = false
  const adjustment = { x: 0, y: 0, z: 0 }
  let anyValidBlock = false

  world.intersectionsWithShape(
    location,
    IDENTITY_ROTATION,
    penetrationAdjustmentShape,
    (collider) => {
      anyOverlap = true
      const contact = collider.contactShape(
        penetrationAdjustmentShape,
        location,
        IDENTITY_ROTATION,
        0,
      )
      if (contact === null) {
        failed = true
        return false
      }

      const distance = -contact.distance
      if (distance <= UE_KINDA_SMALL_NUMBER_METRES) return true

      // contact.normal1 points from the collider (shape 1) toward the query sphere (shape 2).
      adjustment.x += contact.normal1.x * distance
      adjustment.y += contact.normal1.y * distance
      adjustment.z += contact.normal1.z * distance
      anyValidBlock = true
      return true
    },
    context.flags,
    context.groups,
    undefined,
    context.ownerRigidBody,
    context.accepts,
  )
  if (!anyOverlap || failed) return null

  const adjustmentDirection = normalize(adjustment)
  if (!anyValidBlock || adjustmentDirection === null) return null

  const ownerDirection = normalize(subtract(ownerLocation, location))
  if (
    ownerDirection !== null
    && dot(ownerDirection, adjustmentDirection)
      < -UE_KINDA_SMALL_NUMBER
  ) {
    return null
  }

  const adjustedStart = add(location, adjustment)
  return {
    adjustedStart,
    free: !hasBlockingOverlap(
      world,
      adjustedStart,
      collisionShape,
      context,
    ),
  }
}

function castSphere(
  world: World,
  start: Readonly<Vector3>,
  end: Readonly<Vector3>,
  shape: Ball,
  context: QueryContext,
  displacement: Vector3,
): number | null {
  displacement.x = end.x - start.x
  displacement.y = end.y - start.y
  displacement.z = end.z - start.z
  const hit = world.castShape(
    start,
    IDENTITY_ROTATION,
    displacement,
    shape,
    0,
    1,
    true,
    context.flags,
    context.groups,
    undefined,
    context.ownerRigidBody,
    context.accepts,
  )
  return hit?.time_of_impact ?? null
}

function locationAtTimeOfImpact(
  start: Readonly<Vector3>,
  displacement: Readonly<Vector3>,
  timeOfImpact: number,
): Vector3 {
  return {
    x: start.x + displacement.x * timeOfImpact,
    y: start.y + displacement.y * timeOfImpact,
    z: start.z + displacement.z * timeOfImpact,
  }
}

/**
 * Creates the non-React Rapier implementation of `AlsCameraTrace`.
 *
 * It mirrors CalculateCameraTrace's collision branches: initial sphere sweep, start-penetration
 * recovery using the inflated overlap sphere, free-space validation, then the adjusted re-sweep.
 * All public camera positions stay in Unreal axes; conversion to Rapier/three.js axes is confined
 * to this adapter.
 */
export function createRapierAlsCameraTrace(
  options: RapierAlsCameraTraceOptions,
): AlsCameraTrace {
  const collisionShapeCache: ShapeCache = {
    radius: Number.NaN,
    shape: null,
  }
  const penetrationAdjustmentShapeCache: ShapeCache = {
    radius: Number.NaN,
    shape: null,
  }
  const ownerColliderHandles = new Set<number>()
  let context: QueryContext
  const accepts = (collider: Collider) => acceptsCollider(collider, context)
  context = {
    flags: QueryFilterFlags.EXCLUDE_SENSORS,
    groups: undefined,
    ownerRigidBody: undefined,
    ownerColliderHandles,
    predicate: undefined,
    accepts,
  }
  const start = { x: 0, y: 0, z: 0 }
  const end = { x: 0, y: 0, z: 0 }
  const ownerLocation = { x: 0, y: 0, z: 0 }
  const displacement = { x: 0, y: 0, z: 0 }

  return (request) => {
    const resolvedFilter = options.queryFilterForChannel(request.channel)
    const ownerRigidBody = options.getOwnerRigidBody?.() ?? undefined
    ownerColliderHandles.clear()
    const ownerColliders = options.getOwnerColliders?.()
    if (ownerColliders) {
      for (const collider of ownerColliders) {
        ownerColliderHandles.add(collider.handle)
      }
    }
    context.flags =
      (resolvedFilter.flags ?? 0)
      | QueryFilterFlags.EXCLUDE_SENSORS
    context.groups = resolvedFilter.groups
    context.ownerRigidBody = ownerRigidBody
    context.predicate = resolvedFilter.predicate

    unrealToThreeVector(request.start, start)
    unrealToThreeVector(request.end, end)
    unrealToThreeVector(request.ownerLocation, ownerLocation)
    const collisionShape = getShape(
      collisionShapeCache,
      request.radius,
    )

    const timeOfImpact = castSphere(
      options.world,
      start,
      end,
      collisionShape,
      context,
      displacement,
    )
    if (timeOfImpact === null) return null

    if (
      timeOfImpact !== 0
      || !hasPenetration(
        options.world,
        start,
        collisionShape,
        context,
      )
    ) {
      return {
        traceResult: threeToUnrealVector(
          locationAtTimeOfImpact(start, displacement, timeOfImpact),
        ),
      }
    }

    const penetrationAdjustmentShape = getShape(
      penetrationAdjustmentShapeCache,
      request.penetrationAdjustmentRadius,
    )
    const adjustment = tryAdjustLocationBlockedByGeometry(
      options.world,
      start,
      ownerLocation,
      collisionShape,
      penetrationAdjustmentShape,
      context,
    )
    if (adjustment === null) {
      return { traceResult: threeToUnrealVector(start) }
    }

    const adjustedTraceStart = threeToUnrealVector(
      adjustment.adjustedStart,
    )
    if (!adjustment.free) {
      return {
        traceResult: adjustedTraceStart,
        adjustedTraceStart,
      }
    }

    const adjustedTimeOfImpact = castSphere(
      options.world,
      adjustment.adjustedStart,
      end,
      collisionShape,
      context,
      displacement,
    )
    return {
      traceResult: threeToUnrealVector(
        adjustedTimeOfImpact === null
          ? end
          : locationAtTimeOfImpact(
              adjustment.adjustedStart,
              displacement,
              adjustedTimeOfImpact,
            ),
      ),
      adjustedTraceStart,
    }
  }
}
