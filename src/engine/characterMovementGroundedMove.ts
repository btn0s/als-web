/**
 * Pure, backend-neutral slice of `UMovementComponent::SafeMoveUpdatedComponent()` followed by
 * `SlideAlongSurface()`. ALS delegates grounded collision response to UE CharacterMovement, so
 * the query itself remains an injected engine seam.
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

/** Minimal `FHitResult` surface consumed by this one-wall movement slice. */
export interface CharacterMovementGroundedMoveHit {
  /** UE-normalized `FHitResult::Time` over the requested delta. */
  readonly time: number
  readonly impactNormal: CharacterMovementGroundedMoveVector
  readonly bBlockingHit: boolean
  readonly bStartPenetrating: boolean
}

export type CharacterMovementGroundedMoveSweep = (
  query: Readonly<CharacterMovementGroundedMoveSweepQuery>,
) => CharacterMovementGroundedMoveHit | null

export interface CharacterMovementGroundedMoveInput
  extends CharacterMovementGroundedMoveSweepQuery {
  readonly sweepCapsule: CharacterMovementGroundedMoveSweep
}

export interface CharacterMovementGroundedMoveResult {
  /** Actual displacement after the first safe move plus the one allowed wall slide. */
  readonly delta: CharacterMovementGroundedMoveVector
  readonly firstHit: CharacterMovementGroundedMoveHit | null
  /** Result of the safe move that applies the projected one-wall slide. */
  readonly secondHit: CharacterMovementGroundedMoveHit | null
  readonly slideDelta: CharacterMovementGroundedMoveVector
}

const ZERO_VECTOR: CharacterMovementGroundedMoveVector = { x: 0, y: 0, z: 0 }

function scale(
  value: Readonly<CharacterMovementGroundedMoveVector>,
  amount: number,
): CharacterMovementGroundedMoveVector {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount }
}

function add(
  a: Readonly<CharacterMovementGroundedMoveVector>,
  b: Readonly<CharacterMovementGroundedMoveVector>,
): CharacterMovementGroundedMoveVector {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

/** `UMovementComponent::ComputeSlideVector()`, without UE's optional slope adjustment. */
export function computeSlideVector(
  delta: Readonly<CharacterMovementGroundedMoveVector>,
  time: number,
  normal: Readonly<CharacterMovementGroundedMoveVector>,
): CharacterMovementGroundedMoveVector {
  const projected = delta.x * normal.x + delta.y * normal.y + delta.z * normal.z
  return scale({
    x: delta.x - normal.x * projected,
    y: delta.y - normal.y * projected,
    z: delta.z - normal.z * projected,
  }, time)
}

/** `UMovementComponent::SlideAlongSurface()` for its first, single-wall adjustment. */
export function slideAlongSurface(
  delta: Readonly<CharacterMovementGroundedMoveVector>,
  time: number,
  normal: Readonly<CharacterMovementGroundedMoveVector>,
): CharacterMovementGroundedMoveVector {
  return computeSlideVector(delta, time, normal)
}

/**
 * One `SafeMoveUpdatedComponent()` hit and one `SlideAlongSurface()` response.
 *
 * Deliberately scoped: UE's complete walking path also has penetration adjustment, step-up,
 * `TwoWallAdjust()`, and movement-base behavior. Those are separate CharacterMovement work;
 * this seam prevents a blocking first hit from being discarded by the backend's raw displacement.
 */
export function moveGroundedWithSlideAlongSurface(
  input: Readonly<CharacterMovementGroundedMoveInput>,
): CharacterMovementGroundedMoveResult {
  const hit = input.sweepCapsule(input)
  if (!hit || !hit.bBlockingHit || hit.bStartPenetrating) {
    return {
      delta: hit?.bStartPenetrating ? ZERO_VECTOR : input.delta,
      firstHit: hit,
      secondHit: null,
      slideDelta: ZERO_VECTOR,
    }
  }

  const hitTime = Math.min(1, Math.max(0, hit.time))
  const firstMove = scale(input.delta, hitTime)
  const requestedSlideDelta = slideAlongSurface(
    input.delta,
    1 - hitTime,
    hit.impactNormal,
  )
  const secondStart = add(input.start, firstMove)
  const secondHit = input.sweepCapsule({
    ...input,
    start: secondStart,
    delta: requestedSlideDelta,
  })
  const slideTime = !secondHit || !secondHit.bBlockingHit
    ? 1
    : secondHit.bStartPenetrating
      ? 0
      : Math.min(1, Math.max(0, secondHit.time))
  const slideDelta = scale(requestedSlideDelta, slideTime)
  return {
    delta: add(firstMove, slideDelta),
    firstHit: hit,
    secondHit,
    slideDelta,
  }
}
