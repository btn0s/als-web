import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from './characterMovementFloor'
import type {
  RapierAlsFindFloorResult,
} from './rapierAlsCapsuleSweep'

type RapierAlsFloorDistanceResult = Pick<
  RapierAlsFindFloorResult,
  'bLineTrace' | 'FloorDist' | 'LineDist'
>

export interface RapierAlsVector3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** `FFindFloorResult::GetDistanceToFloor()`. */
export function getRapierAlsFindFloorDistance(
  floor: Readonly<RapierAlsFloorDistanceResult>,
): number {
  return floor.bLineTrace ? floor.LineDist : floor.FloorDist
}

/** The source guard around `UCharacterMovementComponent::AdjustFloorHeight()`. */
export function shouldAdjustRapierAlsFloorHeight(
  floor: Readonly<RapierAlsFloorDistanceResult>,
): boolean {
  // A short sweep with a longer line result would scale unwalkable walls.
  if (
    floor.bLineTrace
    && floor.FloorDist < UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
    && floor.LineDist >= UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
  ) return false
  const distance = getRapierAlsFindFloorDistance(floor)
  return distance < UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
    || distance > UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE
}

/**
 * The active capsule center is ALS's actor location. Rapier keeps the standing capsule root as
 * the rigid-body anchor and offsets its crouching collider locally to preserve the capsule base.
 *
 * The arithmetic is stack-specific ORIGINAL backend mapping; the active-capsule meaning comes
 * directly from UE `ACharacter` / `UCharacterMovementComponent`.
 */
export function getRapierAlsActiveCapsuleCenter(
  bodyAnchor: Readonly<RapierAlsVector3>,
  activeCapsuleHalfHeight: number,
  standingCapsuleHalfHeight: number,
): RapierAlsVector3 {
  return {
    x: bodyAnchor.x,
    y: bodyAnchor.y,
    z: bodyAnchor.z
      + activeCapsuleHalfHeight
      - standingCapsuleHalfHeight,
  }
}

/** Inverse of `getRapierAlsActiveCapsuleCenter()`. */
export function getRapierAlsBodyAnchorFromActiveCapsuleCenter(
  activeCapsuleCenter: Readonly<RapierAlsVector3>,
  activeCapsuleHalfHeight: number,
  standingCapsuleHalfHeight: number,
): RapierAlsVector3 {
  return {
    x: activeCapsuleCenter.x,
    y: activeCapsuleCenter.y,
    z: activeCapsuleCenter.z
      - activeCapsuleHalfHeight
      + standingCapsuleHalfHeight,
  }
}

/**
 * `UCharacterMovementComponent::AdjustFloorHeight()` target for this fixed Rapier body anchor.
 *
 * UE moves its UpdatedComponent by `AvgFloorDist - CurrentFloor.GetDistanceToFloor()`. The
 * standing-root body anchor and active capsule center differ only by a fixed stance-local offset,
 * so that same Z delta applies directly to the body anchor.
 */
export function getRapierAlsAdjustFloorHeightTarget(
  bodyAnchor: Readonly<RapierAlsVector3>,
  floor: Readonly<RapierAlsFloorDistanceResult>,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): RapierAlsVector3 {
  out.x = bodyAnchor.x
  out.y = bodyAnchor.y
  out.z = shouldAdjustRapierAlsFloorHeight(floor)
    ? bodyAnchor.z
      + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE
      - getRapierAlsFindFloorDistance(floor)
    : bodyAnchor.z
  return out
}
