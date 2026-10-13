import type {
  AlsGroundPredictionCapsuleSweep,
  AlsGroundPredictionSweepHitInput,
  AlsGroundPredictionSweepQuery,
} from '../als/State/AlsInAirState'
import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE,
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
  contactShape?(
    shape: unknown,
    shapePosition: RapierVector,
    shapeRotation: RapierRotation,
    prediction: number,
  ): {
    readonly distance: number
    readonly normal1?: RapierVector
  } | null
}

interface RapierCapsuleConstructor {
  new(halfHeight: number, radius: number): unknown
}

interface RapierRay {
  origin: RapierVector
  dir: RapierVector
}

interface RapierRayConstructor {
  new(origin: RapierVector, dir: RapierVector): RapierRay
}

interface RapierShapeCastHit {
  readonly time_of_impact: number
  readonly collider: RapierAlsSupportingCollider
  readonly witness1: RapierVector
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
  castRayAndGetNormal(
    ray: RapierRay,
    maxTimeOfImpact: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    excludeCollider?: unknown,
    excludeRigidBody?: unknown,
  ): RapierRayCastHit | null
}

interface RapierRayCastHit {
  readonly timeOfImpact: number
  readonly collider: RapierAlsSupportingCollider
  readonly normal: RapierVector
}

export interface RapierAlsCapsuleSweepOptions {
  readonly world: RapierShapeCastWorld
  readonly Capsule: RapierCapsuleConstructor
  readonly Ray: RapierRayConstructor
  readonly excludeRigidBody?: unknown
  /**
   * React refs populate after render, so the live bridge resolves its body when the query runs.
   * When supplied, this takes precedence over `excludeRigidBody`.
   */
  readonly resolveExcludeRigidBody?: () => unknown
  /** Query filtering remains an engine-adapter concern, normally `EXCLUDE_SENSORS`. */
  readonly filterFlags?: number
  readonly resolveFilterGroups?: () => number | undefined
}

export interface RapierAlsCapsuleSweepHit
  extends AlsGroundPredictionSweepHitInput {
  /** Retained so CharacterMovement's supporting primitive is not erased at the query seam. */
  readonly collider: RapierAlsSupportingCollider
  readonly rigidBody: RapierAlsSupportingRigidBody | null
  /** World-space impact point used by CharacterMovement's floor edge-tolerance retry. */
  readonly impactPoint?: RapierVector
  /** FHitResult::bBlockingHit, retained separately from IsValidBlockingHit(). */
  readonly bBlockingHit?: boolean
  /** Rapier contact distance supplies UE's explicit FHitResult::bStartPenetrating fact. */
  readonly bStartPenetrating?: boolean
  /**
   * Signed closest-shape separation at the start of the cast. Rapier's GJK sweep TOI can vary by
   * millimetres over a large flat collider; this independent geometric value recovers the same
   * vertical distance that UE's floor sweep is intended to measure.
   */
  readonly startSeparationDistance?: number
  readonly startSeparationNormal?: RapierVector
}

interface RapierAlsLiveCapsuleSweepHit
  extends RapierAlsCapsuleSweepHit {
  readonly impactPoint: RapierVector
  readonly bBlockingHit: boolean
  readonly bStartPenetrating: boolean
}

export interface RapierAlsFloorLineTraceQuery {
  readonly start: Readonly<RapierVector>
  readonly end: Readonly<RapierVector>
}

export interface RapierAlsCapsuleSweep {
  (
    query: Readonly<AlsGroundPredictionSweepQuery>
  ): RapierAlsLiveCapsuleSweepHit | null
  lineTrace(
    query: Readonly<RapierAlsFloorLineTraceQuery>,
  ): RapierAlsLiveCapsuleSweepHit | null
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
): RapierAlsCapsuleSweep {
  const shapePosition = { x: 0, y: 0, z: 0 }
  const shapeRotation = { x: 0, y: 0, z: 0, w: 1 }
  const shapeVelocity = { x: 0, y: 0, z: 0 }
  const ray = new options.Ray(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  )
  let capsule: unknown
  let capsuleRadius = Number.NaN
  let capsuleHalfHeight = Number.NaN

  const sweep = (query: Readonly<AlsGroundPredictionSweepQuery>) => {
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
      options.resolveFilterGroups?.(),
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    if (!hit) return null

    const rigidBody = hit.collider.parent()
    const startContact = hit.collider.contactShape?.(
      capsule,
      shapePosition,
      shapeRotation,
      Math.hypot(
        shapeVelocity.x,
        shapeVelocity.y,
        shapeVelocity.z,
      ),
    )
    const bStartPenetrating = startContact
      ? startContact.distance < 0
      : hit.time_of_impact <= 0
    const result: RapierAlsLiveCapsuleSweepHit = {
      validBlockingHit: !bStartPenetrating,
      time: hit.time_of_impact,
      impactNormal: {
        x: hit.normal1.x,
        y: hit.normal1.z,
        z: hit.normal1.y,
      },
      collider: hit.collider,
      rigidBody,
      // World.castShape supplies its witness in world space; the translated-wall regression
      // below pins this despite ShapeCastHit's stale local-space declaration comment.
      impactPoint: {
        x: hit.witness1.x,
        y: hit.witness1.z,
        z: hit.witness1.y,
      },
      bBlockingHit: true,
      bStartPenetrating,
      startSeparationDistance: startContact?.distance,
      startSeparationNormal: startContact?.normal1
        ? {
            x: startContact.normal1.x,
            y: startContact.normal1.z,
            z: startContact.normal1.y,
          }
        : undefined,
    }
    return result
  }

  sweep.lineTrace = (query: Readonly<RapierAlsFloorLineTraceQuery>) => {
    ray.origin.x = query.start.x
    ray.origin.y = query.start.z
    ray.origin.z = query.start.y
    ray.dir.x = query.end.x - query.start.x
    ray.dir.y = query.end.z - query.start.z
    ray.dir.z = query.end.y - query.start.y

    // A full displacement with max TOI 1 retains UE's normalized FHitResult::Time.
    const hit = options.world.castRayAndGetNormal(
      ray,
      1,
      true,
      options.filterFlags,
      options.resolveFilterGroups?.(),
      undefined,
      options.resolveExcludeRigidBody?.() ?? options.excludeRigidBody,
    )
    if (!hit) return null

    const rigidBody = hit.collider.parent()
    return {
      validBlockingHit: hit.timeOfImpact > 0,
      time: hit.timeOfImpact,
      impactNormal: {
        x: hit.normal.x,
        y: hit.normal.z,
        z: hit.normal.y,
      },
      impactPoint: {
        x: query.start.x + (query.end.x - query.start.x) * hit.timeOfImpact,
        y: query.start.y + (query.end.y - query.start.y) * hit.timeOfImpact,
        z: query.start.z + (query.end.z - query.start.z) * hit.timeOfImpact,
      },
      bBlockingHit: true,
      bStartPenetrating: hit.timeOfImpact <= 0,
      collider: hit.collider,
      rigidBody,
    }
  }

  return sweep
}

export interface AlsGroundProbeInput {
  readonly location: Readonly<{ x: number; y: number; z: number }>
  readonly capsuleRadius: number
  readonly capsuleHalfHeight: number
  readonly walkableFloorAngleCos: number
}

/**
 * Live equivalent of UE's selected `FFindFloorResult` fields.
 *
 * `FloorDist` is always the last blocking capsule-sweep result. When `bLineTrace` is true,
 * `HitResult` is the accepted center line hit and `LineDist` is its independently computed
 * distance, exactly as `FFindFloorResult::SetFromLineTrace()` retains both values.
 */
export interface RapierAlsFindFloorResult {
  readonly HitResult: RapierAlsCapsuleSweepHit
  readonly FloorDist: number
  readonly LineDist: number
  readonly bBlockingHit: true
  readonly bWalkableFloor: true
  readonly bLineTrace: boolean
}

/*
 * Rapier does not expose UE CharacterMovement's FindFloor result. Port
 * UAlsCharacterMovementComponent::ComputeFloorDist(): shorten the first capsule, retry an
 * adjacent / penetrating hit with UE's smaller capsule, then use its center line trace only when
 * a blocking sweep result exists. This keeps a vertical wall from hiding the floor underneath.
 */
export const ALS_RAPIER_GROUND_PROBE_DISTANCE =
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE
const UE_KINDA_SMALL_NUMBER_METRES = 1e-6
const ALS_FLOOR_SWEEP_SHRINK_SCALE = 0.9
const ALS_FLOOR_SWEEP_OVERLAP_SHRINK_SCALE = 0.1

function isUsableGroundHit(
  hit: AlsGroundPredictionSweepHitInput | null,
  walkableFloorAngleCos: number,
  traceDistance: number,
  shrinkHeight: number,
  capsuleRadius: number,
) {
  const bStartPenetrating = (
    hit as Partial<RapierAlsCapsuleSweepHit> | null
  )?.bStartPenetrating === true
  return hit?.validBlockingHit
    && !bStartPenetrating
    && hit.impactNormal.z >= walkableFloorAngleCos
    && calculateFloorDistance(
      hit,
      traceDistance,
      shrinkHeight,
      capsuleRadius,
    )
      <= ALS_RAPIER_GROUND_PROBE_DISTANCE
}

function calculateFloorDistance(
  hit: Readonly<AlsGroundPredictionSweepHitInput>,
  traceDistance: number,
  shrinkHeight: number,
  capsuleRadius: number,
) {
  const liveHit = hit as Partial<RapierAlsCapsuleSweepHit>
  const startSeparationDistance = liveHit.startSeparationDistance
  const startSeparationNormalZ = liveHit.startSeparationNormal?.z
  // ORIGINAL Rapier precision seam: `castShape()`'s GJK TOI drifts by several millimetres even
  // over a flat cuboid, while `contactShape()` returns a stable signed separation. Dividing that
  // separation by the floor-normal projection recovers the vertical travel represented by UE's
  // exact `Hit.Time * TraceDistance` term. Generic oracle sweeps retain the literal source math.
  const verticalTravel = (
    startSeparationDistance !== undefined
    && startSeparationNormalZ !== undefined
    && startSeparationNormalZ > UE_KINDA_SMALL_NUMBER_METRES
  )
    ? startSeparationDistance / startSeparationNormalZ
    : hit.time * traceDistance
  // UAlsCharacterMovementComponent::ComputeFloorDist(): allow a bounded negative distance so
  // CharacterMovement can pull out of a penetration instead of discarding the floor result.
  return Math.max(
    -Math.max(ALS_RAPIER_GROUND_PROBE_DISTANCE, capsuleRadius),
    verticalTravel - shrinkHeight,
  )
}

function sweepGroundCapsule(
  sweepCapsule: AlsGroundPredictionCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
  capsuleRadius: number,
  capsuleHalfHeight: number,
  traceDistance: number,
) {
  return sweepCapsule({
    start: input.location,
    end: {
      x: input.location.x,
      y: input.location.y,
      z: input.location.z - traceDistance,
    },
    capsuleRadius,
    capsuleHalfHeight,
  })
}

function lineTraceGround(
  sweepCapsule: RapierAlsCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
) {
  const traceDistance = ALS_RAPIER_GROUND_PROBE_DISTANCE
    + input.capsuleHalfHeight
  return {
    traceDistance,
    hit: sweepCapsule.lineTrace({
      start: input.location,
      end: {
        x: input.location.x,
        y: input.location.y,
        z: input.location.z - traceDistance,
      },
    }),
  }
}

function isOutsideFloorSweepEdgeTolerance(
  hit: AlsGroundPredictionSweepHitInput,
  location: Readonly<RapierVector>,
  capsuleRadius: number,
) {
  const impactPoint = (
    hit as Partial<RapierAlsCapsuleSweepHit>
  ).impactPoint
  if (!impactPoint) return false

  const reducedRadius = Math.max(
    UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE
      + UE_KINDA_SMALL_NUMBER_METRES,
    capsuleRadius
      - UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE,
  )
  const deltaX = impactPoint.x - location.x
  const deltaY = impactPoint.y - location.y
  return deltaX * deltaX + deltaY * deltaY
    >= reducedRadius * reducedRadius
}

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
  if (typeof (sweepCapsule as Partial<RapierAlsCapsuleSweep>).lineTrace === 'function') {
    return selectRapierAlsFloor(
      sweepCapsule as RapierAlsCapsuleSweep,
      input,
    )?.HitResult ?? null
  }
  return probeGenericAlsGround(sweepCapsule, input)
}

/** Preserves the narrow injected-sweep API for pure callers without manufacturing a line trace. */
function probeGenericAlsGround(
  sweepCapsule: AlsGroundPredictionCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
): AlsGroundPredictionSweepHitInput | null {
  const capsuleCoreHalfHeight = Math.max(
    0,
    input.capsuleHalfHeight - input.capsuleRadius,
  )
  const shrinkHeight = capsuleCoreHalfHeight
    * (1 - ALS_FLOOR_SWEEP_SHRINK_SCALE)
  const traceDistance = ALS_RAPIER_GROUND_PROBE_DISTANCE + shrinkHeight
  const hit = sweepGroundCapsule(
    sweepCapsule,
    input,
    input.capsuleRadius,
    input.capsuleHalfHeight - shrinkHeight,
    traceDistance,
  )
  if (!hit) return null
  const bStartPenetrating = (
    hit as Partial<RapierAlsCapsuleSweepHit>
  ).bStartPenetrating ?? hit.time <= 0
  const bBlockingHit = (
    hit as Partial<RapierAlsCapsuleSweepHit>
  ).bBlockingHit ?? (hit.validBlockingHit || bStartPenetrating)
  if (!bBlockingHit) return null
  const shouldRetry = bStartPenetrating
    || isOutsideFloorSweepEdgeTolerance(
      hit,
      input.location,
      input.capsuleRadius,
    )
  if (!shouldRetry) {
    return isUsableGroundHit(
      hit,
      input.walkableFloorAngleCos,
      traceDistance,
      shrinkHeight,
      input.capsuleRadius,
    ) ? hit : null
  }
  const retryRadius = Math.max(
    0,
    input.capsuleRadius
      - UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE
      - UE_KINDA_SMALL_NUMBER_METRES,
  )
  if (retryRadius <= UE_KINDA_SMALL_NUMBER_METRES) return null
  const overlapShrinkHeight = capsuleCoreHalfHeight
    * (1 - ALS_FLOOR_SWEEP_OVERLAP_SHRINK_SCALE)
  const retryTraceDistance = ALS_RAPIER_GROUND_PROBE_DISTANCE + overlapShrinkHeight
  const retryHit = sweepGroundCapsule(
    sweepCapsule,
    input,
    retryRadius,
    Math.max(input.capsuleHalfHeight - overlapShrinkHeight, retryRadius),
    retryTraceDistance,
  )
  return isUsableGroundHit(
    retryHit,
    input.walkableFloorAngleCos,
    retryTraceDistance,
    overlapShrinkHeight,
    input.capsuleRadius,
  ) ? retryHit : null
}

/**
 * `UAlsCharacterMovementComponent::ComputeFloorDist()` at the live Rapier seam.
 *
 * The generic `probeRapierAlsGround()` overload remains intentionally narrow for pure callers;
 * live character movement can use this result to distinguish a selected sweep from line fallback.
 */
export function selectRapierAlsFloor(
  sweepCapsule: RapierAlsCapsuleSweep,
  input: Readonly<AlsGroundProbeInput>,
): RapierAlsFindFloorResult | null {
  const capsuleCoreHalfHeight = Math.max(
    0,
    input.capsuleHalfHeight - input.capsuleRadius,
  )
  const shrinkHeight = capsuleCoreHalfHeight
    * (1 - ALS_FLOOR_SWEEP_SHRINK_SCALE)
  const traceDistance =
    ALS_RAPIER_GROUND_PROBE_DISTANCE + shrinkHeight
  const hit = sweepGroundCapsule(
    sweepCapsule,
    input,
    input.capsuleRadius,
    input.capsuleHalfHeight - shrinkHeight,
    traceDistance,
  )
  if (!hit) return null
  // ComputeFloorDist retries both explicit start penetrations and non-penetrating hits at the
  // capsule's outer edge. Generic injected sweeps retain the old TOI fallback; the live Rapier
  // bridge publishes bStartPenetrating from an exact signed contact-distance query.
  const bStartPenetrating = (
    hit as Partial<RapierAlsCapsuleSweepHit>
  ).bStartPenetrating ?? hit.time <= 0
  const bBlockingHit = (
    hit as Partial<RapierAlsCapsuleSweepHit>
  ).bBlockingHit ?? (hit.validBlockingHit || bStartPenetrating)
  if (!bBlockingHit) return null
  let selectedSweepDistance = calculateFloorDistance(
    hit,
    traceDistance,
    shrinkHeight,
    input.capsuleRadius,
  )
  const shouldRetry = bStartPenetrating
    || isOutsideFloorSweepEdgeTolerance(
      hit,
      input.location,
      input.capsuleRadius,
    )
  if (!shouldRetry) {
    if (isUsableGroundHit(
      hit,
      input.walkableFloorAngleCos,
      traceDistance,
      shrinkHeight,
      input.capsuleRadius,
    )) return {
      HitResult: hit as RapierAlsCapsuleSweepHit,
      FloorDist: selectedSweepDistance,
      LineDist: 0,
      bBlockingHit: true,
      bWalkableFloor: true,
      bLineTrace: false,
    }
  } else {
    const retryRadius = Math.max(
      0,
      input.capsuleRadius
        - UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE
        - UE_KINDA_SMALL_NUMBER_METRES,
    )
    // `FCollisionShape::IsNearlyZero()` skips only the retry. The original blocking hit remains
    // in OutFloorResult and therefore still qualifies for the UE line-trace fallback below.
    if (retryRadius > UE_KINDA_SMALL_NUMBER_METRES) {
      const overlapShrinkHeight = capsuleCoreHalfHeight
        * (1 - ALS_FLOOR_SWEEP_OVERLAP_SHRINK_SCALE)
      const retryHalfHeight = Math.max(
        input.capsuleHalfHeight - overlapShrinkHeight,
        retryRadius,
      )
      const retryTraceDistance =
        ALS_RAPIER_GROUND_PROBE_DISTANCE + overlapShrinkHeight
      const retryHit = sweepGroundCapsule(
        sweepCapsule,
        input,
        retryRadius,
        retryHalfHeight,
        retryTraceDistance,
      )
      // UE resets FHitResult before the second FloorSweepTest; a second sweep miss removes the
      // original blocking/penetration state and suppresses the line trace.
      if (!retryHit) return null
      const retryBlockingHit = (
        retryHit as Partial<RapierAlsCapsuleSweepHit>
      ).bBlockingHit ?? (
        retryHit.validBlockingHit
        || (retryHit as Partial<RapierAlsCapsuleSweepHit>).bStartPenetrating === true
      )
      if (!retryBlockingHit) return null
      selectedSweepDistance = calculateFloorDistance(
        retryHit,
        retryTraceDistance,
        overlapShrinkHeight,
        input.capsuleRadius,
      )
      if (isUsableGroundHit(
        retryHit,
        input.walkableFloorAngleCos,
        retryTraceDistance,
        overlapShrinkHeight,
        input.capsuleRadius,
      )) return {
        HitResult: retryHit as RapierAlsCapsuleSweepHit,
        FloorDist: selectedSweepDistance,
        LineDist: 0,
        bBlockingHit: true,
        bWalkableFloor: true,
        bLineTrace: false,
      }
    }
  }

  // ComputeFloorDist only reaches its line trace after a blocking sweep result (including a
  // start penetration). A total sweep miss returned above must remain a miss; line tracing it
  // would violate UE's intentionally different sweep/line distance interpretation.
  const { traceDistance: lineTraceDistance, hit: lineHit } = lineTraceGround(
    sweepCapsule,
    input,
  )
  if (
    !lineHit
    || lineHit.time <= 0
    || !lineHit.validBlockingHit
    || lineHit.impactNormal.z < input.walkableFloorAngleCos
  ) return null

  // UE starts at the capsule center and subtracts PawnHalfHeight from the ray length.
  const lineResult = Math.max(
    -Math.max(ALS_RAPIER_GROUND_PROBE_DISTANCE, input.capsuleRadius),
    lineHit.time * lineTraceDistance - input.capsuleHalfHeight,
  )
  return lineResult <= ALS_RAPIER_GROUND_PROBE_DISTANCE
    ? {
        HitResult: lineHit,
        FloorDist: selectedSweepDistance,
        LineDist: lineResult,
        bBlockingHit: true,
        bWalkableFloor: true,
        bLineTrace: true,
      }
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
 * Maps a known Rapier primitive to the FBasedMovementInfo fields consumed by ALS.
 *
 * Mantling calls SetBase() with the hit collider before CharacterMovement enters MOVE_Custom,
 * so there is no floor-sweep hit to adapt while the root-motion source is active. Keeping this
 * primitive seam beside the ordinary floor-hit adapter makes both paths use the same identity
 * and coordinate conversion.
 */
export function rapierAlsMovementBaseFromPrimitive(
  collider: RapierAlsSupportingCollider,
  relativeRotation = false,
): Readonly<AlsBasedMovement> {
  const body = collider.parent()
  const hasRelativeLocation = body !== null && !body.isFixed()
  return {
    primitive: collider,
    boneName: '',
    hasRelativeLocation,
    relativeRotation: hasRelativeLocation && relativeRotation,
    location: toAlsLocation(collider.translation()),
    rotation: toAlsRotation(collider.rotation()),
  }
}

/**
 * Maps a Rapier floor support to the `FBasedMovementInfo` fields consumed by ALS.
 *
 * UCharacterMovement stores the supporting UPrimitiveComponent, not its owning actor. A Rapier
 * collider is that component analog, so an offset or rotated collider retains both its identity
 * and world transform even when it has a parent body.
 */
export function rapierAlsMovementBase(
  hit: Readonly<RapierAlsCapsuleSweepHit> | null,
  relativeRotation = false,
): Readonly<AlsBasedMovement> {
  if (!hit) return ALS_NO_BASED_MOVEMENT
  return rapierAlsMovementBaseFromPrimitive(
    hit.collider,
    relativeRotation,
  )
}

export function rapierAlsCameraMovementBaseFromPrimitive(
  collider: RapierAlsSupportingCollider,
  relativeRotation = false,
): AlsCameraMovementBase {
  const basedMovement = rapierAlsMovementBaseFromPrimitive(
    collider,
    relativeRotation,
  )
  return {
    key: basedMovement.primitive as AlsCameraMovementBase['key'],
    boneName: basedMovement.boneName,
    hasRelativeRotation:
      basedMovement.hasRelativeLocation && basedMovement.relativeRotation,
    location: basedMovement.location,
    rotation: basedMovement.rotation,
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
  return rapierAlsCameraMovementBaseFromPrimitive(
    hit!.collider,
    relativeRotation,
  )
}
