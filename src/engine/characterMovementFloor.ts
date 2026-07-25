/*
 * UCharacterMovementComponent constants, expressed in repository metres.
 *
 * CharacterMovementComponent.cpp defines 1.9 cm / 2.4 cm as the acceptable walking floor
 * distance and AdjustFloorHeight() moves a flat-ground character to their midpoint. The live
 * Grounded bridge owns its kinematic capsule transform at that physical target distance.
 */
export const UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE = 0.019
export const UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE = 0.024
// UCharacterMovementComponent::SWEEP_EDGE_REJECT_DISTANCE, converted from 0.15 cm.
export const UE_CHARACTER_MOVEMENT_SWEEP_EDGE_REJECT_DISTANCE = 0.0015
export const UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE = (
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE
  + UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE
) * 0.5

export function getCharacterMovementFloorOffset(
  movingOnGround: boolean,
): number {
  return movingOnGround
    ? UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE
    : 0
}
