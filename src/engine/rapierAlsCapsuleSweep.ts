import type {
  AlsGroundPredictionCapsuleSweep,
  AlsGroundPredictionSweepHitInput,
  AlsGroundPredictionSweepQuery,
} from '../als/State/AlsInAirState'
import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
} from './characterMovementFloor'
import {
  ALS_NO_BASED_MOVEMENT,
} from '../als/State/AlsMovementBaseState'
import type {
  AlsBasedMovement,
} from '../als/State/AlsMovementBaseState'
import type {
  AlsCameraMovementBase,
} from '../als/AlsCamera/AlsCameraComponent'

export interface RapierVector {
  x: number
  y: number
  z: number
}

export interface RapierRotation extends RapierVector {
  w: number
}

export interface RapierAlsSupportingRigidBody {
  readonly handle: number
  translation(): RapierVector
  rotation(): RapierRotation
  isFixed(): boolean
}

export interface RapierAlsSupportingCollider {
  readonly handle: number
  translation(): RapierVector
  rotation(): RapierRotation
  parent(): RapierAlsSupportingRigidBody | null
}

interface RapierCapsuleConstructor {
  new(halfHeight: number, radius: number): unknown
}

interface RapierShapeCastHit {
  readonly time_of_impact: number
  readonly collider: RapierAlsSupportingCollider
  /**
   * Rapier World.castShape reports the world collider as shape one and the cast query as shape
   * two. `normal1` is therefore the outward normal of the hit collider; `normal2` points back into
   * the cast capsule.
   */
  readonly normal1: RapierVector
  readonly normal2: RapierVector
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
  ): RapierShapeCastHit | null
}

export interface RapierAlsCapsuleSweepOptions {
  readonly world: RapierShapeCastWorld
  readonly Capsule: RapierCapsuleConstructor
  readonly excludeRigidBody?: unknown
  /**
   * React refs populate after render, so the live bridge resolves its body when the query runs.
   * When supplied, this takes precedence over `excludeRigidBody`.
   */
  readonly resolveExcludeRigidBody?: () => unknown
  /** Query filtering remains an engine-adapter concern, normally `EXCLUDE_SENSORS`. */
  readonly filterFlags?: number
}

export interface RapierAlsCapsuleSweepHit
  extends AlsGroundPredictionSweepHitInput {
  /** Retained so CharacterMovement's supporting primitive is not erased at the query seam. */
  readonly collider: RapierAlsSupportingCollider
  readonly rigidBody: RapierAlsSupportingRigidBody | null
}

export type RapierAlsCapsuleSweep = (
  query: Readonly<AlsGroundPredictionSweepQuery>
) => RapierAlsCapsuleSweepHit | null

/**
 * Rapier bridge for ALS's Z-up capsule sweeps.
 *
 * ALS queries use metres at the repository boundary with axes (+X forward, +Y right, +Z up).
 * Rapier uses Three's axes (+X, +Y up, +Z), so this is the sole C:(x,y,z)->(x,z,y) conversion.
 * Supplying the full displacement as shape velocity with max TOI 1 preserves UE's normalized
 * `FHitResult::Time`, which `CF_Als_GroundPredictionAmount` consumes directly.
 */
export function createRapierAlsCapsuleSweep(
  options: Readonly<RapierAlsCapsuleSweepOptions>,
): RapierAlsCapsuleSweep {
  const shapePosition = { x: 0, y: 0, z: 0 }
  const shapeRotation = { x: 0, y: 0, z: 0, w: 1 }
  const shapeVelocity = { x: 0, y: 0, z: 0 }
  let capsule: unknown
  let capsuleRadius = Number.NaN
  let capsuleHalfHeight = Number.NaN

  return (query: Readonly<AlsGroundPredictionSweepQuery>) => {
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
    shapeVelocity.x = query.end.x - query.start.x
    shapeVelocity.y = query.end.z - query.start.z
    shapeVelocity.z = query.end.y - query.start.y

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

    const rigidBody = hit.collider.parent()
    const result: RapierAlsCapsuleSweepHit = {
      validBlockingHit: true,
      time: hit.time_of_impact,
      impactNormal: {
        x: hit.normal1.x,
        y: hit.normal1.z,
        z: hit.normal1.y,
      },
      collider: hit.collider,
      rigidBody,
    }
    return result
  }
}

export interface AlsGroundProbeInput {
  readonly location: Readonly<{ x: number; y: number; z: number }>
  readonly capsuleRadius: number
  readonly capsuleHalfHeight: number
  readonly walkableFloorAngleCos: number
}

/*
 * Rapier does not expose UE CharacterMovement's FindFloor result. This short shape cast tests the
 * complete capsule, excludes its owner, applies CharacterMovement's MAX_FLOOR_DIST boundary, and
 * then applies ALS's inherited walkable-normal predicate.
 */
export const ALS_RAPIER_GROUND_PROBE_DISTANCE =
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE

export function probeRapierAlsGround(
  sweepCapsule: RapierAlsCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
): RapierAlsCapsuleSweepHit | null
export function probeRapierAlsGround(
  sweepCapsule: AlsGroundPredictionCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
): AlsGroundPredictionSweepHitInput | null
export function probeRapierAlsGround(
  sweepCapsule: AlsGroundPredictionCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
): AlsGroundPredictionSweepHitInput | null {
  const hit = sweepCapsule({
    start: input.location,
    end: {
      x: input.location.x,
      y: input.location.y,
      z: input.location.z - ALS_RAPIER_GROUND_PROBE_DISTANCE,
    },
    capsuleRadius: input.capsuleRadius,
    capsuleHalfHeight: input.capsuleHalfHeight,
  })
  return hit?.validBlockingHit
    && hit.impactNormal.z >= input.walkableFloorAngleCos
    ? hit
    : null
}

function toAlsLocation(value: Readonly<RapierVector>) {
  return {
    x: value.x,
    y: value.z,
    z: value.y,
  }
}

function toAlsRotation(value: Readonly<RapierRotation>) {
  // C R_Rapier C. C:(x,y,z)->(x,z,y) is a reflection, so swapping the quaternion vector
  // components without the signs would produce the inverse physical rotation.
  return {
    x: value.x === 0 ? 0 : -value.x,
    y: value.z === 0 ? 0 : -value.z,
    z: value.y === 0 ? 0 : -value.y,
    w: value.w,
  }
}

/**
 * Maps a Rapier floor support to the `FBasedMovementInfo` fields consumed by ALS.
 *
 * UE retains `MovementBase` for static primitives even though `HasRelativeLocation()` is false.
 * The adapter therefore uses a parent rigid body as the primitive when present and the standalone
 * collider otherwise; it returns `ALS_NO_BASED_MOVEMENT` only for an actual miss.
 */
export function rapierAlsMovementBase(
  hit: Readonly<RapierAlsCapsuleSweepHit> | null,
  relativeRotation = false,
): Readonly<AlsBasedMovement> {
  if (!hit) return ALS_NO_BASED_MOVEMENT

  const primitive = hit.rigidBody ?? hit.collider
  const hasRelativeLocation =
    hit.rigidBody !== null && !hit.rigidBody.isFixed()
  return {
    primitive,
    boneName: '',
    hasRelativeLocation,
    // UAlsCharacterMovementComponent defaults bIgnoreBaseRotation=true, so the sample's
    // FBasedMovementInfo::bRelativeRotation remains false unless an adapter explicitly opts in.
    relativeRotation: hasRelativeLocation && relativeRotation,
    location: toAlsLocation(primitive.translation()),
    rotation: toAlsRotation(primitive.rotation()),
  }
}

/**
 * Publishes the same `FBasedMovementInfo` snapshot consumed directly by
 * `UAlsCameraComponent::TickCamera()` (`AlsCameraComponent.cpp:180-207`).
 *
 * The camera retains even a static primitive's identity, but only reads the primitive transform
 * when `HasRelativeRotation()` is true. Keeping that distinction here prevents the render bridge
 * from inventing a second movement-base policy.
 */
export function rapierAlsCameraMovementBase(
  hit: Readonly<RapierAlsCapsuleSweepHit> | null,
  relativeRotation = false,
): AlsCameraMovementBase | null {
  const basedMovement = rapierAlsMovementBase(hit, relativeRotation)
  if (basedMovement.primitive === null) return null

  return {
    key: basedMovement.primitive as AlsCameraMovementBase['key'],
    boneName: basedMovement.boneName,
    hasRelativeRotation:
      basedMovement.hasRelativeLocation && basedMovement.relativeRotation,
    location: basedMovement.location,
    rotation: basedMovement.rotation,
  }
}
