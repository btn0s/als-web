import type {
  CharacterMovementGroundedMoveHit,
  CharacterMovementGroundedMoveSweep,
  CharacterMovementGroundedMoveSweepQuery,
  CharacterMovementGroundedMoveVector,
} from './characterMovementGroundedMove'

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
}

interface RapierCapsuleConstructor {
  new(halfHeight: number, radius: number): unknown
}

interface RapierShapeCastHit {
  readonly time_of_impact: number
  readonly collider: RapierAlsGroundedMoveSupportingCollider
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
  readonly excludeRigidBody?: unknown
  readonly resolveExcludeRigidBody?: () => unknown
  readonly filterFlags?: number
}

/**
 * Rapier query adapter for the pure CharacterMovement movement slice.
 *
 * This is an ORIGINAL backend seam: ALS inherits UE's collision queries, while this repository
 * must ask Rapier directly. It preserves the same query contract—Z-up ALS coordinates, one full
 * capsule cast, normalized hit time, outward impact normal, and owner-body exclusion.
 */
export function createRapierAlsGroundedMoveSweep(
  options: Readonly<RapierAlsGroundedMoveOptions>,
): CharacterMovementGroundedMoveSweep {
  const shapePosition = { x: 0, y: 0, z: 0 }
  const shapeRotation = { x: 0, y: 0, z: 0, w: 1 }
  const shapeVelocity = { x: 0, y: 0, z: 0 }
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
    return {
      time: hit.time_of_impact,
      impactNormal: {
        x: hit.normal1.x,
        y: hit.normal1.z,
        z: hit.normal1.y,
      } satisfies CharacterMovementGroundedMoveVector,
      bBlockingHit: true,
      bStartPenetrating,
      collider: hit.collider,
    } satisfies RapierAlsGroundedMoveHit
  }
}
