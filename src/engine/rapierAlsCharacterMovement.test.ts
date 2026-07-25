import { describe, expect, it } from 'vitest'
import {
  ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  ALS_STANDING_CAPSULE_HALF_HEIGHT,
} from '../als/AlsCharacter.hooks'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from './characterMovementFloor'
import {
  getRapierAlsActiveCapsuleCenter,
  getRapierAlsAdjustFloorHeightTarget,
  getRapierAlsBodyAnchorFromActiveCapsuleCenter,
  getRapierAlsFindFloorDistance,
  shouldAdjustRapierAlsFloorHeight,
} from './rapierAlsCharacterMovement'

describe('Rapier ALS CharacterMovement floor bridge', () => {
  it('selects FFindFloorResult LineDist only when the line trace supplied the floor', () => {
    expect(getRapierAlsFindFloorDistance({
      bLineTrace: false,
      FloorDist: 0.019,
      LineDist: 0.024,
    })).toBe(0.019)
    expect(getRapierAlsFindFloorDistance({
      bLineTrace: true,
      FloorDist: 0.019,
      LineDist: 0.024,
    })).toBe(0.024)
  })

  it('ports AdjustFloorHeight using the selected floor distance', () => {
    const bodyAnchor = { x: 2, y: -3, z: 0.919 }
    expect(getRapierAlsAdjustFloorHeightTarget(bodyAnchor, {
      bLineTrace: false,
      FloorDist: 0.018,
      LineDist: 0.024,
    })).toEqual({ x: 2, y: -3, z: 0.9225 })
    expect(getRapierAlsAdjustFloorHeightTarget(bodyAnchor, {
      bLineTrace: true,
      FloorDist: 0.019,
      LineDist: 0.025,
    })).toEqual({ x: 2, y: -3, z: 0.9155 })
  })

  it('does not adjust inside the accepted floor-distance band', () => {
    for (const distance of [0.019, 0.0215, 0.024]) {
      const floor = {
        bLineTrace: false,
        FloorDist: distance,
        LineDist: 1,
      }
      expect(shouldAdjustRapierAlsFloorHeight(floor)).toBe(false)
      expect(getRapierAlsAdjustFloorHeightTarget(
        { x: 2, y: -3, z: 0.9215 },
        floor,
      )).toEqual({ x: 2, y: -3, z: 0.9215 })
    }
    expect(shouldAdjustRapierAlsFloorHeight({
      bLineTrace: true,
      FloorDist: 0.0215,
      LineDist: 0.018,
    })).toBe(true)
    expect(shouldAdjustRapierAlsFloorHeight({
      bLineTrace: true,
      FloorDist: 0.018,
      LineDist: 0.0215,
    })).toBe(false)
  })

  it('maps standing and crouching active capsule centers to one target floor distance', () => {
    const floorZ = 4
    const bodyAnchor = {
      x: 2,
      y: -3,
      z: floorZ
        + ALS_STANDING_CAPSULE_HALF_HEIGHT
        + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
    }

    for (const activeHalfHeight of [
      ALS_STANDING_CAPSULE_HALF_HEIGHT,
      ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
    ]) {
      const activeCenter = getRapierAlsActiveCapsuleCenter(
        bodyAnchor,
        activeHalfHeight,
        ALS_STANDING_CAPSULE_HALF_HEIGHT,
      )
      expect(activeCenter.z).toBeCloseTo(
        floorZ + activeHalfHeight + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        12,
      )
      expect(activeCenter.z - activeHalfHeight).toBeCloseTo(
        floorZ + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        12,
      )
      expect(getRapierAlsBodyAnchorFromActiveCapsuleCenter(
        activeCenter,
        activeHalfHeight,
        ALS_STANDING_CAPSULE_HALF_HEIGHT,
      )).toEqual(bodyAnchor)
    }
  })
})
