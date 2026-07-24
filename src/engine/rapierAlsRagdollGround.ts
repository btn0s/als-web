import type { AlsVector3 } from '../als/State/AlsLocomotionState'
import {
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
} from './characterMovementFloor'

interface RapierVector {
  x: number
  y: number
  z: number
}

interface RapierRotation extends RapierVector {
  w: number
}

export interface RapierRagdollGroundCollider {
  readonly handle: number
}

interface RapierShapeCastHit {
  readonly collider: RapierRagdollGroundCollider
  readonly time_of_impact: number
}

interface RapierShapeCastWorld {
  castShape(
    shapePosition: RapierVector,
    shapeRotation: RapierRotation,
    shapeVelocity: RapierVector,
    shape: unknown,
    targetDistance: number,
    maxTimeOfImpact: number,
    stopAtPenetration: boolean,
    filterFlags?: number,
    filterGroups?: number,
    excludeCollider?: unknown,
    excludeRigidBody?: unknown,
    filterPredicate?: (
      collider: RapierRagdollGroundCollider,
    ) => boolean,
  ): RapierShapeCastHit | null
}

interface RapierBallConstructor {
  new(radius: number): unknown
}

export interface RapierAlsRagdollGroundOptions {
  readonly world: RapierShapeCastWorld
  readonly Ball: RapierBallConstructor
  readonly filterFlags?: number
  readonly filterGroups?: number
  /**
   * UE's query ignores the owning actor, including all skeletal bodies.
   * Return false for every capsule/ragdoll collider owned by this character.
   *
   * Rapier has no Unreal collision-channel/response table. The caller must
   * map CharacterMovement's collision object type and InitCollisionParams()
   * blocking set into filterGroups/predicate. Omitting that mapping is an
   * explicit NonParity integration, not a replacement policy in this bridge.
   */
  readonly filterPredicate?: (
    collider: RapierRagdollGroundCollider,
  ) => boolean
}

export interface RapierAlsRagdollGroundInput {
  /** Pelvis / replicated ragdoll target in ALS (+Z-up) world coordinates. */
  readonly RagdollLocation: Readonly<AlsVector3>
  readonly CapsuleRadius: number
  readonly CapsuleHalfHeight: number
}

export interface RapierAlsRagdollGroundResult {
  readonly bGrounded: boolean
  /** AAlsCharacter actor-center location in ALS coordinates. */
  readonly ActorLocation: AlsVector3
  /** Sphere center at impact, equivalent to FHitResult::Location. */
  readonly HitLocation: AlsVector3 | null
  readonly HitCollider: RapierRagdollGroundCollider | null
}

export type RapierAlsRagdollGroundTrace = (
  input: Readonly<RapierAlsRagdollGroundInput>,
) => RapierAlsRagdollGroundResult

function assertCapsuleDimensions(
  radius: number,
  halfHeight: number,
) {
  if (
    !Number.isFinite(radius)
    || !(radius > 0)
    || !Number.isFinite(halfHeight)
    || halfHeight < radius
  ) {
    throw new Error(
      'ALS ragdoll ground trace requires a finite capsule '
      + 'with HalfHeight >= Radius > 0',
    )
  }
}

/**
 * Rapier boundary for AAlsCharacter::RagdollTraceGround().
 *
 * The native function deliberately sweeps a sphere instead of tracing a ray:
 * the disabled capsule must continue to expose a stable bottom location to
 * the camera while its actor center follows the simulated pelvis.
 */
export function createRapierAlsRagdollGroundTrace(
  options: Readonly<RapierAlsRagdollGroundOptions>,
): RapierAlsRagdollGroundTrace {
  const shapePosition = { x: 0, y: 0, z: 0 }
  const shapeRotation = { x: 0, y: 0, z: 0, w: 1 }
  const shapeVelocity = { x: 0, y: 0, z: 0 }
  let sphere: unknown
  let sphereRadius = Number.NaN

  return (input) => {
    const radius = input.CapsuleRadius
    const halfHeight = input.CapsuleHalfHeight
    assertCapsuleDimensions(radius, halfHeight)
    if (radius !== sphereRadius) {
      sphereRadius = radius
      sphere = new options.Ball(radius)
    }

    // C:(x,y,z)->(x,z,y).
    shapePosition.x = input.RagdollLocation.x
    shapePosition.y = input.RagdollLocation.z + 2 * radius
    shapePosition.z = input.RagdollLocation.y
    shapeVelocity.x = 0
    shapeVelocity.y = -halfHeight - radius
    shapeVelocity.z = 0

    /*
     * Rapier accepts a velocity and normalized TOI; supplying the complete
     * TraceEnd - TraceStart displacement with max TOI 1 reproduces UE's
     * sphere sweep segment exactly.
     */
    const hit = options.world.castShape(
      shapePosition,
      shapeRotation,
      shapeVelocity,
      sphere,
      0,
      1,
      true,
      options.filterFlags,
      options.filterGroups,
      undefined,
      undefined,
      options.filterPredicate,
    )
    if (!hit) {
      return {
        bGrounded: false,
        ActorLocation: {
          x: input.RagdollLocation.x,
          y: input.RagdollLocation.y,
          z: input.RagdollLocation.z,
        },
        HitLocation: null,
        HitCollider: null,
      }
    }

    const hitLocation = {
      x: shapePosition.x
        + shapeVelocity.x * hit.time_of_impact,
      y: shapePosition.z
        + shapeVelocity.z * hit.time_of_impact,
      z: shapePosition.y
        + shapeVelocity.y * hit.time_of_impact,
    }
    return {
      bGrounded: true,
      ActorLocation: {
        x: input.RagdollLocation.x,
        y: input.RagdollLocation.y,
        z: hitLocation.z
          + halfHeight
          - radius
          + UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
      },
      HitLocation: hitLocation,
      HitCollider: hit.collider,
    }
  }
}
