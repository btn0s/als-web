import type {
  CharacterMovementGroundedMoveHit,
  CharacterMovementGroundedMoveSweep,
  CharacterMovementGroundedMoveSweepQuery,
  CharacterMovementGroundedMoveVector,
} from './characterMovementGroundedMove'
import { UE_PENETRATION_PULLBACK_DISTANCE } from './characterMovementGroundedMove'
import { findRapierAlsOpposingNormal } from './rapierAlsCapsuleSweep'
import type {
  RapierRay,
  RapierRayConstructor,
} from './rapierAlsCapsuleSweep'

export interface RapierAlsGroundedMoveVector {
  x: number
  y: number
  z: number
}

export interface RapierAlsGroundedMoveRotation extends RapierAlsGroundedMoveVector {
  w: number
}

export interface RapierAlsGroundedMoveSupportingCollider {
  readonly handle: number
  parent(): unknown
  contactShape?(
    shape: unknown,
    shapePosition: RapierAlsGroundedMoveVector,
    shapeRotation: RapierAlsGroundedMoveRotation,
    prediction: number,
  ): { readonly distance: number; readonly normal1?: RapierAlsGroundedMoveVector } | null
  castRayAndGetNormal?(
    ray: RapierRay,
    maxTimeOfImpact: number,
    solid: boolean,
  ): {
    readonly timeOfImpact: number
    readonly normal: RapierAlsGroundedMoveVector
  } | null
}

interface RapierCapsuleConstructor {
  new(halfHeight: number, radius: number): unknown
}

interface RapierShapeCastHit {
  readonly time_of_impact: number
  readonly collider: RapierAlsGroundedMoveSupportingCollider
  readonly witness1?: RapierAlsGroundedMoveVector
  readonly normal1: RapierAlsGroundedMoveVector
}

interface RapierShapeCastWorld {
  intersectionsWithShape?(
    shapePosition: RapierAlsGroundedMoveVector,
    shapeRotation: RapierAlsGroundedMoveRotation,
    shape: unknown,
    callback: (collider: RapierAlsGroundedMoveSupportingCollider) => boolean,
    filterFlags?: number,
    filterGroups?: number,
    excludeCollider?: unknown,
    excludeRigidBody?: unknown,
  ): void
  castShape(
    shapePosition: RapierAlsGroundedMoveVector,
    shapeRotation: RapierAlsGroundedMoveRotation,
    shapeVelocity: RapierAlsGroundedMoveVector,
    shape: unknown,
    targetDistance: number,
    maxTimeOfImpact: number,
    stopAtPenetration: boolean,
    filterFlags?: number,
    filterGroups?: number,
    excludeCollider?: unknown,
    excludeRigidBody?: unknown,
  ): RapierShapeCastHit | null
}

export interface RapierAlsGroundedMoveHit extends CharacterMovementGroundedMoveHit {
  readonly collider: RapierAlsGroundedMoveSupportingCollider
}

export interface RapierAlsGroundedMoveOptions {
  readonly world: RapierShapeCastWorld
  readonly Capsule: RapierCapsuleConstructor
  /** Resolves `FHitResult::ImpactNormal` on the hit face; without it the contact normal is used. */
  readonly Ray?: RapierRayConstructor
  readonly excludeRigidBody?: unknown
  readonly resolveExcludeRigidBody?: () => unknown
  readonly filterFlags?: number
}

/**
 * Rapier query adapter for the pure CharacterMovement movement slice.
 *
 * This is an ORIGINAL backend seam: ALS inherits UE's collision queries, while this repository
 * must ask Rapier directly. It preserves the same query contract—Z-up ALS coordinates, one full
 * capsule cast, normalized hit time, impact point, contact `Normal`, opposing-face
 * `ImpactNormal`, and owner-body exclusion.
 */
export function createRapierAlsGroundedMoveSweep(
  options: Readonly<RapierAlsGroundedMoveOptions>,
): CharacterMovementGroundedMoveSweep {
  const shapePosition = { x: 0, y: 0, z: 0 }
  const shapeRotation = { x: 0, y: 0, z: 0, w: 1 }
  const shapeVelocity = { x: 0, y: 0, z: 0 }
  const faceRay = options.Ray
    ? new options.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    : null
  let capsule: unknown
  let capsuleRadius = Number.NaN
  let capsuleHalfHeight = Number.NaN

  const place = (query: Readonly<Omit<CharacterMovementGroundedMoveSweepQuery, 'delta'>>) => {
    if (
      query.capsuleRadius !== capsuleRadius
      || query.capsuleHalfHeight !== capsuleHalfHeight
    ) {
      capsuleRadius = query.capsuleRadius
      capsuleHalfHeight = query.capsuleHalfHeight
      capsule = new options.Capsule(
        Math.max(0, capsuleHalfHeight - capsuleRadius),
        capsuleRadius,
      )
    }
    shapePosition.x = query.start.x
    shapePosition.y = query.start.z
    shapePosition.z = query.start.y
  }

  const overlaps = (query: Readonly<Omit<CharacterMovementGroundedMoveSweepQuery, 'delta'>>) => {
    place(query)
    let encroached = false
    options.world.intersectionsWithShape?.(
      shapePosition,
      shapeRotation,
      capsule,
      (collider) => {
        const contact = collider.contactShape?.(capsule, shapePosition, shapeRotation, 0)
        encroached = !contact || contact.distance < -UE_PENETRATION_PULLBACK_DISTANCE
        return !encroached
      },
      options.filterFlags,
      undefined,
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    return encroached
  }

  const sweep = (query: Readonly<CharacterMovementGroundedMoveSweepQuery>) => {
    place(query)
    shapeVelocity.x = query.delta.x
    shapeVelocity.y = query.delta.z
    shapeVelocity.z = query.delta.y
    const cast = (stopAtPenetration: boolean) => options.world.castShape(
      shapePosition,
      shapeRotation,
      shapeVelocity,
      capsule,
      0,
      1,
      stopAtPenetration,
      options.filterFlags,
      undefined,
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    const contactAt = (collider: RapierAlsGroundedMoveSupportingCollider) =>
      collider.contactShape?.(capsule, shapePosition, shapeRotation, 0)
    let hit = cast(true)
    if (!hit) return null
    let startContact = contactAt(hit.collider)
    // UPrimitiveComponent::ShouldIgnoreHitResult(): a start overlap the move is leaving does not
    // block it.
    const leaving = startContact?.normal1
      && startContact.distance < 0
      && startContact.normal1.x * shapeVelocity.x
        + startContact.normal1.y * shapeVelocity.y
        + startContact.normal1.z * shapeVelocity.z > 0
    if (leaving) {
      hit = cast(false)
      if (!hit) return null
      startContact = contactAt(hit.collider)
    }

    // Rapier sweeps rest at exact contact rather than at UE's pulled-back hit time, so contact
    // within the pullback distance is a touching time-0 hit, not an overlap.
    const bStartPenetrating = startContact
      ? startContact.distance < -UE_PENETRATION_PULLBACK_DISTANCE
      : hit.time_of_impact <= 0
    const impactNormal = faceRay && hit.witness1 && !bStartPenetrating
      ? findRapierAlsOpposingNormal(
          hit.collider,
          faceRay,
          hit.witness1,
          shapeVelocity,
          hit.normal1,
        )
      : hit.normal1
    const contactNormal = bStartPenetrating && startContact?.normal1
      ? startContact.normal1
      : hit.normal1
    const normal = {
      x: contactNormal.x,
      y: contactNormal.z,
      z: contactNormal.y,
    } satisfies CharacterMovementGroundedMoveVector
    return {
      time: hit.time_of_impact,
      impactNormal: {
        x: impactNormal.x,
        y: impactNormal.z,
        z: impactNormal.y,
      } satisfies CharacterMovementGroundedMoveVector,
      normal,
      ...(hit.witness1 && {
        impactPoint: {
          x: hit.witness1.x,
          y: hit.witness1.z,
          z: hit.witness1.y,
        } satisfies CharacterMovementGroundedMoveVector,
      }),
      bBlockingHit: true,
      bStartPenetrating,
      ...(bStartPenetrating && startContact && {
        penetrationDepth: -startContact.distance,
      }),
      collider: hit.collider,
    } satisfies RapierAlsGroundedMoveHit
  }

  return options.world.intersectionsWithShape ? Object.assign(sweep, { overlaps }) : sweep
}
