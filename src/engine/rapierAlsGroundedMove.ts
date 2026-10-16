import type {
  CharacterMovementGroundedMoveHit,
  CharacterMovementGroundedMoveSweep,
  CharacterMovementGroundedMoveSweepQuery,
  CharacterMovementGroundedMoveVector,
} from './characterMovementGroundedMove'
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
  ): { readonly distance: number } | null
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

  return (query: Readonly<CharacterMovementGroundedMoveSweepQuery>) => {
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
    shapeVelocity.x = query.delta.x
    shapeVelocity.y = query.delta.z
    shapeVelocity.z = query.delta.y
    const hit = options.world.castShape(
      shapePosition,
      shapeRotation,
      shapeVelocity,
      capsule,
      0,
      1,
      true,
      options.filterFlags,
      undefined,
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    if (!hit) return null

    const startContact = hit.collider.contactShape?.(
      capsule,
      shapePosition,
      shapeRotation,
      0,
    )
    const bStartPenetrating = startContact
      ? startContact.distance < 0
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
    const normal = {
      x: hit.normal1.x,
      y: hit.normal1.z,
      z: hit.normal1.y,
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
      collider: hit.collider,
    } satisfies RapierAlsGroundedMoveHit
  }
}
