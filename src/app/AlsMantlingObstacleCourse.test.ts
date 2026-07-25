import { describe, expect, it } from 'vitest'
import {
  ALS_CAPSULE_RADIUS,
} from '../als/AlsCharacter.hooks'
import {
  ALS_GENERAL_MANTLING_SETTINGS,
} from '../als/Settings/AlsMantlingSettings'
import {
  ALS_MANTLING_OBSTACLE_COURSE,
  getAlsMantlingObstacleHalfExtents,
} from './AlsMantlingObstacleCourse'

interface Bounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}

function getBounds(
  obstacle: (typeof ALS_MANTLING_OBSTACLE_COURSE)[number],
): Bounds {
  const halfExtents = getAlsMantlingObstacleHalfExtents(obstacle)
  return {
    minX: obstacle.position[0] - halfExtents[0],
    maxX: obstacle.position[0] + halfExtents[0],
    minY: obstacle.position[1] - halfExtents[1],
    maxY: obstacle.position[1] + halfExtents[1],
    minZ: obstacle.position[2] - halfExtents[2],
    maxZ: obstacle.position[2] + halfExtents[2],
  }
}

function overlaps(left: Bounds, right: Bounds): boolean {
  return (
    left.minX < right.maxX
    && left.maxX > right.minX
    && left.minY < right.maxY
    && left.maxY > right.minY
    && left.minZ < right.maxZ
    && left.maxZ > right.minZ
  )
}

describe('ORIGINAL ALS mantling obstacle course', () => {
  it('keeps one data source for the visible boxes and their colliders', () => {
    expect(ALS_MANTLING_OBSTACLE_COURSE.map((obstacle) => ({
      name: obstacle.name,
      position: obstacle.position,
      size: obstacle.size,
      halfExtents: getAlsMantlingObstacleHalfExtents(obstacle),
      traversal: obstacle.traversal,
    }))).toEqual([
      {
        name: 'ORIGINAL_AlsLowMantlePlatform',
        position: [3, 0.5, 0],
        size: [1.5, 1, 3],
        halfExtents: [0.75, 0.5, 1.5],
        traversal: 'Low',
      },
      {
        name: 'ORIGINAL_AlsHighMantlePlatform',
        position: [7, 0.75, 0],
        size: [2.5, 1.5, 3],
        halfExtents: [1.25, 0.75, 1.5],
        traversal: 'High',
      },
      {
        name: 'ORIGINAL_AlsJumpTakeoffPlatform',
        position: [3, 0.3, -5],
        size: [3, 0.6, 3],
        halfExtents: [1.5, 0.3, 1.5],
        traversal: 'Jump',
      },
      {
        name: 'ORIGINAL_AlsJumpLandingPlatform',
        position: [7, 0.45, -5],
        size: [3, 0.9, 3],
        halfExtents: [1.5, 0.45, 1.5],
        traversal: 'Jump',
      },
    ])
  })

  it('places every fixture on the floor inside ALS grounded mantle height', () => {
    const [minimumHeight, maximumHeight] =
      ALS_GENERAL_MANTLING_SETTINGS.GroundedTrace.LedgeHeight

    for (const obstacle of ALS_MANTLING_OBSTACLE_COURSE) {
      const bounds = getBounds(obstacle)
      expect(bounds.minY, obstacle.name).toBe(0)
      expect(bounds.maxY, obstacle.name).toBeGreaterThanOrEqual(minimumHeight)
      expect(bounds.maxY, obstacle.name).toBeLessThanOrEqual(maximumHeight)
    }
  })

  it('straddles the authored Low and High mantling threshold exactly once', () => {
    const threshold =
      ALS_GENERAL_MANTLING_SETTINGS.MantlingHighHeightThreshold
    const low = ALS_MANTLING_OBSTACLE_COURSE.filter(
      (obstacle) => obstacle.traversal === 'Low',
    )
    const high = ALS_MANTLING_OBSTACLE_COURSE.filter(
      (obstacle) => obstacle.traversal === 'High',
    )

    expect(low).toHaveLength(1)
    expect(high).toHaveLength(1)
    expect(getBounds(low[0]).maxY).toBeLessThanOrEqual(threshold)
    expect(getBounds(high[0]).maxY).toBeGreaterThan(threshold)
  })

  it('does not overlap the spawn capsule or another fixture', () => {
    const spawnBounds: Bounds = {
      minX: -ALS_CAPSULE_RADIUS,
      maxX: ALS_CAPSULE_RADIUS,
      minY: 0,
      maxY: 1.8,
      minZ: -ALS_CAPSULE_RADIUS,
      maxZ: ALS_CAPSULE_RADIUS,
    }
    const bounds = ALS_MANTLING_OBSTACLE_COURSE.map(getBounds)

    for (let index = 0; index < bounds.length; index += 1) {
      expect(
        overlaps(bounds[index], spawnBounds),
        ALS_MANTLING_OBSTACLE_COURSE[index].name,
      ).toBe(false)
      for (let other = index + 1; other < bounds.length; other += 1) {
        expect(
          overlaps(bounds[index], bounds[other]),
          `${ALS_MANTLING_OBSTACLE_COURSE[index].name} and `
            + ALS_MANTLING_OBSTACLE_COURSE[other].name,
        ).toBe(false)
      }
    }
  })
})
