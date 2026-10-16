import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE,
} from './characterMovementFloor'

/**
 * Pure, backend-neutral port of `UCharacterMovementComponent::MoveAlongFloor()`, including
 * `ComputeGroundMovementDelta()`, `StepUp()` and the walking `SlideAlongSurface()` override.
 * ALS delegates grounded collision response to UE CharacterMovement, so the query itself
 * remains an injected engine seam.
 */

export interface CharacterMovementGroundedMoveVector {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface CharacterMovementGroundedMoveSweepQuery {
  readonly start: CharacterMovementGroundedMoveVector
  readonly delta: CharacterMovementGroundedMoveVector
  readonly capsuleRadius: number
  readonly capsuleHalfHeight: number
}

/** Minimal `FHitResult` surface consumed by MoveAlongFloor. */
export interface CharacterMovementGroundedMoveHit {
  /** UE-normalized `FHitResult::Time` over the requested delta. */
  readonly time: number
  /** `FHitResult::ImpactNormal`: the hit geometry's face normal opposing the sweep. */
  readonly impactNormal: CharacterMovementGroundedMoveVector
  /** `FHitResult::Normal`: the swept-shape contact normal. Defaults to `impactNormal`. */
  readonly normal?: CharacterMovementGroundedMoveVector
  readonly impactPoint?: CharacterMovementGroundedMoveVector
  readonly bBlockingHit: boolean
  readonly bStartPenetrating: boolean
}

export type CharacterMovementGroundedMoveSweep = (
  query: Readonly<CharacterMovementGroundedMoveSweepQuery>,
) => CharacterMovementGroundedMoveHit | null

/** The `FFindFloorResult` fields read by MoveAlongFloor, StepUp and SlideAlongSurface. */
export interface CharacterMovementCurrentFloor {
  readonly bLineTrace: boolean
  readonly FloorDist: number
  readonly LineDist: number
  readonly HitResult: Readonly<{
    readonly impactNormal: CharacterMovementGroundedMoveVector
    readonly normal?: CharacterMovementGroundedMoveVector
    readonly impactPoint?: CharacterMovementGroundedMoveVector
  }>
}

export interface CharacterMovementMoveAlongFloorInput<
  TFloor extends CharacterMovementCurrentFloor = CharacterMovementCurrentFloor,
> extends CharacterMovementGroundedMoveSweepQuery {
  readonly sweepCapsule: CharacterMovementGroundedMoveSweep
  /** Walkable `CurrentFloor`; `null` is UE's `!CurrentFloor.IsWalkableFloor()` early return. */
  readonly CurrentFloor: Readonly<CharacterMovementCurrentFloor> | null
  readonly MaxStepHeight: number
  readonly WalkableFloorZ: number
  /** `UPrimitiveComponent::CanCharacterStepUp()`; Rapier has no `ECB_No` response by default. */
  readonly canStepUp?: (hit: Readonly<CharacterMovementGroundedMoveHit>) => boolean
  /** Walking `FindFloor()` at a capsule location, returning only a walkable floor. */
  readonly findFloor?: (location: CharacterMovementGroundedMoveVector) => TFloor | null
}

/** `FStepDownResult`: StepUp's floor, which PhysWalking uses instead of a second FindFloor. */
export interface CharacterMovementStepDownResult<TFloor> {
  readonly bComputedFloor: boolean
  readonly FloorResult: TFloor | null
}

export interface CharacterMovementMoveAlongFloorResult<TFloor> {
  /** Actual displacement, including any ramp or StepUp height change. */
  readonly delta: CharacterMovementGroundedMoveVector
  readonly firstHit: CharacterMovementGroundedMoveHit | null
  readonly bSteppedUp: boolean
  readonly StepDownResult: CharacterMovementStepDownResult<TFloor>
}

const ZERO_VECTOR: CharacterMovementGroundedMoveVector = { x: 0, y: 0, z: 0 }
const UE_KINDA_SMALL_NUMBER = 1e-4
const UE_DELTA = 1e-5
const UE_KINDA_SMALL_NUMBER_METRES = 1e-6

function scale(
  value: Readonly<CharacterMovementGroundedMoveVector>,
  amount: number,
): CharacterMovementGroundedMoveVector {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function dot(
  a: Readonly<CharacterMovementGroundedMoveVector>,
  b: Readonly<CharacterMovementGroundedMoveVector>,
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function getSafeNormal2D(
  value: Readonly<CharacterMovementGroundedMoveVector>,
): CharacterMovementGroundedMoveVector {
  const length = Math.hypot(value.x, value.y)
  return length > 1e-8
    ? { x: value.x / length, y: value.y / length, z: 0 }
    : ZERO_VECTOR
}

function hitNormal(
  hit: Readonly<Pick<CharacterMovementGroundedMoveHit, 'impactNormal' | 'normal'>>,
): CharacterMovementGroundedMoveVector {
  return hit.normal ?? hit.impactNormal
}

function isValidBlockingHit(
  hit: Readonly<CharacterMovementGroundedMoveHit> | null,
): hit is CharacterMovementGroundedMoveHit {
  return hit !== null && hit.bBlockingHit && !hit.bStartPenetrating
}

/** `UCharacterMovementComponent::IsWithinEdgeTolerance()`. */
export function isWithinCharacterMovementEdgeTolerance(
  capsuleLocation: Readonly<CharacterMovementGroundedMoveVector>,
  testImpactPoint: Readonly<CharacterMovementGroundedMoveVector>,
  capsuleRadius: number,
): boolean {
  const deltaX = testImpactPoint.x - capsuleLocation.x
  const deltaY = testImpactPoint.y - capsuleLocation.y
  const reducedRadius = Math.max(
    UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE + UE_KINDA_SMALL_NUMBER_METRES,
    capsuleRadius - UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE,
  )
  return deltaX * deltaX + deltaY * deltaY < reducedRadius * reducedRadius
}

/** `UMovementComponent::ComputeSlideVector()`; CharacterMovement adds slope boosting only while falling. */
export function computeSlideVector(
  delta: Readonly<CharacterMovementGroundedMoveVector>,
  time: number,
  normal: Readonly<CharacterMovementGroundedMoveVector>,
): CharacterMovementGroundedMoveVector {
  const projected = dot(delta, normal)
  return scale({
    x: delta.x - normal.x * projected,
    y: delta.y - normal.y * projected,
    z: delta.z - normal.z * projected,
  }, time)
}

/** `UCharacterMovementComponent::ComputeGroundMovementDelta()` with `bMaintainHorizontalGroundVelocity`. */
export function computeGroundMovementDelta(
  delta: Readonly<CharacterMovementGroundedMoveVector>,
  rampHit: Readonly<Pick<CharacterMovementGroundedMoveHit, 'impactNormal' | 'normal'>>,
  bHitFromLineTrace: boolean,
  walkableFloorZ: number,
): CharacterMovementGroundedMoveVector {
  const floorNormal = rampHit.impactNormal
  const contactNormal = hitNormal(rampHit)
  if (
    floorNormal.z < 1 - UE_KINDA_SMALL_NUMBER
    && floorNormal.z > UE_KINDA_SMALL_NUMBER
    && contactNormal.z > UE_KINDA_SMALL_NUMBER
    && !bHitFromLineTrace
    && floorNormal.z >= walkableFloorZ
  ) {
    return {
      x: delta.x,
      y: delta.y,
      z: -dot(floorNormal, delta) / floorNormal.z,
    }
  }
  return delta
}

/**
 * `UCharacterMovementComponent::MoveAlongFloor()`.
 *
 * Deliberately scoped: `SafeMoveUpdatedComponent()` penetration resolution, `TwoWallAdjust()`
 * and `HandleImpact()` are not ported.
 */
export function moveAlongFloor<
  TFloor extends CharacterMovementCurrentFloor = CharacterMovementCurrentFloor,
>(
  input: Readonly<CharacterMovementMoveAlongFloorInput<TFloor>>,
): CharacterMovementMoveAlongFloorResult<TFloor> {
  let stepDownResult: CharacterMovementStepDownResult<TFloor> = {
    bComputedFloor: false,
    FloorResult: null,
  }
  const currentFloor = input.CurrentFloor
  if (!currentFloor) {
    return {
      delta: ZERO_VECTOR,
      firstHit: null,
      bSteppedUp: false,
      StepDownResult: stepDownResult,
    }
  }

  let x = input.start.x
  let y = input.start.y
  let z = input.start.z
  const canStepUp = (hit: Readonly<CharacterMovementGroundedMoveHit>) =>
    isValidBlockingHit(hit) && (input.canStepUp?.(hit) ?? true)
  const isWalkable = (hit: Readonly<CharacterMovementGroundedMoveHit>) =>
    isValidBlockingHit(hit)
    && hit.impactNormal.z >= UE_KINDA_SMALL_NUMBER
    && hit.impactNormal.z >= input.WalkableFloorZ

  // UMovementComponent::SafeMoveUpdatedComponent(): sweep, then stop at the first blocking hit.
  const safeMove = (delta: Readonly<CharacterMovementGroundedMoveVector>) => {
    const hit = input.sweepCapsule({
      start: { x, y, z },
      delta,
      capsuleRadius: input.capsuleRadius,
      capsuleHalfHeight: input.capsuleHalfHeight,
    })
    if (hit?.bStartPenetrating) return hit
    const time = hit?.bBlockingHit ? clamp01(hit.time) : 1
    x += delta.x * time
    y += delta.y * time
    z += delta.z * time
    return hit?.bBlockingHit ? hit : null
  }

  // UCharacterMovementComponent::SlideAlongSurface() → UMovementComponent::SlideAlongSurface().
  const slideAlongSurface = (
    delta: Readonly<CharacterMovementGroundedMoveVector>,
    time: number,
    inNormal: Readonly<CharacterMovementGroundedMoveVector>,
    hit: Readonly<CharacterMovementGroundedMoveHit>,
  ) => {
    if (!hit.bBlockingHit) return 0
    let normal = inNormal
    if (normal.z > 0) {
      if (!isWalkable(hit)) normal = getSafeNormal2D(normal)
    } else if (normal.z < -UE_KINDA_SMALL_NUMBER) {
      if (currentFloor.FloorDist < UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE) {
        const floorNormal = hitNormal(currentFloor.HitResult)
        const bFloorOpposedToMovement = dot(delta, floorNormal) < 0
          && floorNormal.z < 1 - UE_DELTA
        if (bFloorOpposedToMovement) normal = floorNormal
        normal = getSafeNormal2D(normal)
      }
    }
    const slideDelta = computeSlideVector(delta, time, normal)
    if (dot(slideDelta, delta) <= 0) return 0
    const slideHit = safeMove(slideDelta)
    return slideHit && !slideHit.bStartPenetrating ? clamp01(slideHit.time) : slideHit ? 0 : 1
  }

  const stepUp = (
    delta: Readonly<CharacterMovementGroundedMoveVector>,
    inHit: Readonly<CharacterMovementGroundedMoveHit>,
    inHitLocation: Readonly<CharacterMovementGroundedMoveVector>,
  ) => {
    if (!canStepUp(inHit) || input.MaxStepHeight <= 0 || !inHit.impactPoint) return false
    const oldX = x
    const oldY = y
    const oldZ = z
    const revertMove = () => {
      x = oldX
      y = oldY
      z = oldZ
      return false
    }

    // Don't bother stepping up if top of capsule is hitting something.
    const initialImpactZ = inHit.impactPoint.z
    if (initialImpactZ > oldZ + (input.capsuleHalfHeight - input.capsuleRadius)) return false

    let stepTravelUpHeight = input.MaxStepHeight
    let stepTravelDownHeight = stepTravelUpHeight
    let pawnInitialFloorBaseZ = oldZ - input.capsuleHalfHeight
    let pawnFloorPointZ = pawnInitialFloorBaseZ
    const floorDist = Math.max(
      0,
      currentFloor.bLineTrace ? currentFloor.LineDist : currentFloor.FloorDist,
    )
    pawnInitialFloorBaseZ -= floorDist
    stepTravelUpHeight = Math.max(stepTravelUpHeight - floorDist, 0)
    stepTravelDownHeight = input.MaxStepHeight + UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE * 2
    const bHitVerticalFace = !isWithinCharacterMovementEdgeTolerance(
      inHitLocation,
      inHit.impactPoint,
      input.capsuleRadius,
    )
    if (!currentFloor.bLineTrace && !bHitVerticalFace && currentFloor.HitResult.impactPoint) {
      pawnFloorPointZ = currentFloor.HitResult.impactPoint.z
    } else {
      pawnFloorPointZ -= currentFloor.FloorDist
    }

    // Don't step up if the impact is below us, accounting for distance from floor.
    if (initialImpactZ <= pawnInitialFloorBaseZ) return false

    const sweepUpHit = safeMove({ x: 0, y: 0, z: stepTravelUpHeight })
    if (sweepUpHit?.bStartPenetrating) return revertMove()

    const forwardHit = safeMove(delta)
    if (forwardHit) {
      if (forwardHit.bStartPenetrating) return revertMove()
      const forwardHitTime = clamp01(forwardHit.time)
      const forwardSlideAmount = slideAlongSurface(
        delta,
        1 - forwardHitTime,
        hitNormal(forwardHit),
        forwardHit,
      )
      if (forwardHitTime === 0 && forwardSlideAmount === 0) return revertMove()
    }

    const downHit = safeMove({ x: 0, y: 0, z: -stepTravelDownHeight })
    if (downHit?.bStartPenetrating) return revertMove()
    if (isValidBlockingHit(downHit)) {
      if (!downHit.impactPoint) return revertMove()
      // See if this step sequence would have allowed us to travel higher than our max step height allows.
      const deltaZ = downHit.impactPoint.z - pawnFloorPointZ
      if (deltaZ > input.MaxStepHeight) return revertMove()
      if (!isWalkable(downHit)) {
        // Reject if normal opposes movement direction.
        if (dot(delta, downHit.impactNormal) < 0) return revertMove()
        // Also reject if we would end up being higher than our starting location by stepping down.
        if (z > oldZ) return revertMove()
      }
      if (!isWithinCharacterMovementEdgeTolerance(
        { x, y, z },
        downHit.impactPoint,
        input.capsuleRadius,
      )) return revertMove()
      if (deltaZ > 0 && !canStepUp(downHit)) return revertMove()
      if (input.findFloor) {
        stepDownResult = {
          bComputedFloor: true,
          FloorResult: input.findFloor({ x, y, z }),
        }
      }
    }
    return true
  }

  const delta = { x: input.delta.x, y: input.delta.y, z: 0 }
  let rampVector = computeGroundMovementDelta(
    delta,
    currentFloor.HitResult,
    currentFloor.bLineTrace,
    input.WalkableFloorZ,
  )
  const firstHit = safeMove(rampVector)
  let hit = firstHit
  let bSteppedUp = false

  if (hit?.bStartPenetrating) {
    slideAlongSurface(delta, 1, hitNormal(hit), hit)
  } else if (isValidBlockingHit(hit)) {
    // We impacted something (most likely another ramp, but possibly a barrier).
    let percentTimeApplied = clamp01(hit.time)
    if (percentTimeApplied > 0 && hitNormal(hit).z > UE_KINDA_SMALL_NUMBER && isWalkable(hit)) {
      const initialPercentRemaining = 1 - percentTimeApplied
      rampVector = computeGroundMovementDelta(
        scale(delta, initialPercentRemaining),
        hit,
        false,
        input.WalkableFloorZ,
      )
      hit = safeMove(rampVector)
      const secondHitPercent = (hit && !hit.bStartPenetrating ? clamp01(hit.time) : hit ? 0 : 1)
        * initialPercentRemaining
      percentTimeApplied = clamp01(percentTimeApplied + secondHitPercent)
    }

    if (isValidBlockingHit(hit)) {
      const hitLocation = { x, y, z }
      if (canStepUp(hit)) {
        bSteppedUp = stepUp(scale(delta, 1 - percentTimeApplied), hit, hitLocation)
        if (!bSteppedUp) {
          slideAlongSurface(delta, 1 - percentTimeApplied, hitNormal(hit), hit)
        }
      } else {
        slideAlongSurface(delta, 1 - percentTimeApplied, hitNormal(hit), hit)
      }
    }
  }

  return {
    delta: {
      x: x - input.start.x,
      y: y - input.start.y,
      z: z - input.start.z,
    },
    firstHit,
    bSteppedUp,
    StepDownResult: stepDownResult,
  }
}
