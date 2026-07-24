import type {
  AlsGroundPredictionCapsuleSweep,
  AlsGroundPredictionSweepHitInput,
  AlsGroundPredictionSweepQuery,
} from '../als/State/AlsInAirState'

interface RapierVector {
  x: number
  y: number
  z: number
}

interface RapierRotation extends RapierVector {
  w: number
}

interface RapierCapsuleConstructor {
  new(halfHeight: number, radius: number): unknown
}

interface RapierShapeCastHit {
  readonly time_of_impact: number
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
}

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
): AlsGroundPredictionCapsuleSweep {
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
      undefined,
      undefined,
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    if (!hit) return null

    const result: AlsGroundPredictionSweepHitInput = {
      validBlockingHit: true,
      time: hit.time_of_impact,
      impactNormal: {
        x: hit.normal1.x,
        y: hit.normal1.z,
        z: hit.normal1.y,
      },
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
 * Rapier does not expose UE CharacterMovement's FindFloor result. This short shape cast is the
 * web-engine equivalent at that missing seam: it tests the complete capsule, excludes its owner,
 * and applies ALS/CharacterMovement's walkable-normal predicate. The 2 cm probe distance is
 * original engine-adapter policy, intentionally isolated here rather than presented as ALS data.
 */
export const ALS_RAPIER_GROUND_PROBE_DISTANCE = 0.02

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
