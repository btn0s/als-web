import { describe, expect, it } from 'vitest'
import {
  UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE,
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
  getCharacterMovementFloorOffset,
} from './characterMovementFloor'

describe('UCharacterMovementComponent floor distance', () => {
  it('ports the source constants and AdjustFloorHeight midpoint in metres', () => {
    expect(UE_CHARACTER_MOVEMENT_MIN_FLOOR_DISTANCE).toBe(0.019)
    expect(UE_CHARACTER_MOVEMENT_MAX_FLOOR_DISTANCE).toBe(0.024)
    expect(UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE).toBe(0.0215)
    expect(getCharacterMovementFloorOffset(true)).toBe(0.0215)
    expect(getCharacterMovementFloorOffset(false)).toBe(0)
  })
})
