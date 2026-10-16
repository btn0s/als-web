import { describe, expect, it } from 'vitest'
import {
  computeGroundMovementDelta,
  computeSlideVector,
  moveAlongFloor,
} from './characterMovementGroundedMove'
import type {
  CharacterMovementCurrentFloor,
  CharacterMovementGroundedMoveHit,
  CharacterMovementGroundedMoveSweepQuery,
} from './characterMovementGroundedMove'

const FLAT_FLOOR: CharacterMovementCurrentFloor = {
  bLineTrace: false,
  FloorDist: 0.0215,
  LineDist: 0,
  HitResult: {
    impactNormal: { x: 0, y: 0, z: 1 },
    impactPoint: { x: 0, y: 0, z: 0 },
  },
}

const WALL_HIT: CharacterMovementGroundedMoveHit = {
  time: 0.8,
  impactNormal: { x: -1, y: 0, z: 0 },
  bBlockingHit: true,
  bStartPenetrating: false,
}

function move(
  sweepCapsule: (query: Readonly<CharacterMovementGroundedMoveSweepQuery>) =>
    CharacterMovementGroundedMoveHit | null,
  delta = { x: 2, y: 1, z: 0 },
) {
  return moveAlongFloor({
    start: { x: 0, y: 0, z: 0.9215 },
    delta,
    capsuleRadius: 0.3,
    capsuleHalfHeight: 0.9,
    sweepCapsule,
    CurrentFloor: FLAT_FLOOR,
    MaxStepHeight: 0,
    WalkableFloorZ: 0.71,
  })
}

describe('CharacterMovement MoveAlongFloor', () => {
  it('matches UE first-hit movement followed by one SlideAlongSurface adjustment', () => {
    let queryCount = 0
    const result = move(() => ++queryCount === 1 ? WALL_HIT : null)

    expect(result.delta.x).toBeCloseTo(1.6, 12)
    expect(result.delta.y).toBeCloseTo(1, 12)
    expect(result.delta.z).toBe(0)
  })

  it('performs a second safe sweep before accepting the one-wall slide', () => {
    const queries: Array<{ start: { x: number; y: number; z: number }; delta: { x: number; y: number; z: number } }> = []
    const result = move((query) => {
      queries.push({ start: query.start, delta: query.delta })
      return queries.length === 1
        ? { ...WALL_HIT, time: 0.5 }
        : { ...WALL_HIT, time: 0.25, impactNormal: { x: 0, y: -1, z: 0 } }
    }, { x: 2, y: 2, z: 0 })

    expect(queries).toEqual([
      { start: { x: 0, y: 0, z: 0.9215 }, delta: { x: 2, y: 2, z: 0 } },
      { start: { x: 1, y: 1, z: 0.9215 }, delta: { x: 0, y: 1, z: 0 } },
    ])
    expect(result.delta).toEqual({ x: 1, y: 1.25, z: 0 })
  })

  it('keeps the requested move horizontal on a miss and stops on penetration', () => {
    expect(move(() => null, { x: 1, y: 2, z: 3 }).delta).toEqual({ x: 1, y: 2, z: 0 })
    expect(move(() => ({ ...WALL_HIT, time: 0, bStartPenetrating: true })).delta)
      .toEqual({ x: 0, y: 0, z: 0 })
  })

  it('does not move without a walkable CurrentFloor', () => {
    const result = moveAlongFloor({
      start: { x: 0, y: 0, z: 0.9215 },
      delta: { x: 1, y: 0, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: () => null,
      CurrentFloor: null,
      MaxStepHeight: 0.45,
      WalkableFloorZ: 0.71,
    })
    expect(result.delta).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('projects the horizontal delta onto a walkable sweep floor only', () => {
    const slope = { x: -0.5, y: 0, z: Math.sqrt(0.75) }
    const ramp = computeGroundMovementDelta(
      { x: 1, y: 0, z: 0 },
      { impactNormal: slope },
      false,
      0.71,
    )
    expect(ramp.x).toBe(1)
    expect(ramp.z).toBeCloseTo(Math.tan(Math.PI / 6), 12)
    expect(computeGroundMovementDelta({ x: 1, y: 0, z: 0 }, { impactNormal: slope }, true, 0.71))
      .toEqual({ x: 1, y: 0, z: 0 })
  })

  it('steps up, forward and down with UE StepUp travel distances', () => {
    const queries: Array<{ x: number; y: number; z: number }> = []
    const result = moveAlongFloor({
      start: { x: 0, y: 0, z: 0.9215 },
      delta: { x: 0.1, y: 0, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      CurrentFloor: FLAT_FLOOR,
      MaxStepHeight: 0.45,
      WalkableFloorZ: 0.71,
      sweepCapsule: (query) => {
        queries.push(query.delta)
        if (queries.length === 1) {
          return {
            time: 0.5,
            impactNormal: { x: -1, y: 0, z: 0 },
            normal: { x: -0.86, y: 0, z: 0.5 },
            impactPoint: { x: 0.33, y: 0, z: 0.17 },
            bBlockingHit: true,
            bStartPenetrating: false,
          }
        }
        if (query.delta.z < 0) {
          const time = (0.45 - 0.17) / 0.498
          return {
            time,
            impactNormal: { x: 0, y: 0, z: 1 },
            impactPoint: { x: 0.33, y: 0, z: 0.17 },
            bBlockingHit: true,
            bStartPenetrating: false,
          }
        }
        return null
      },
    })

    expect(result.bSteppedUp).toBe(true)
    expect(queries[1].z).toBeCloseTo(0.45 - 0.0215, 12)
    expect(queries[2]).toEqual({ x: 0.05, y: 0, z: 0 })
    expect(queries[3].z).toBeCloseTo(-0.498, 12)
    expect(result.delta.x).toBeCloseTo(0.1, 12)
    expect(result.delta.z).toBeCloseTo(0.17 - 0.0215, 12)
  })

  it('reverts StepUp when the landing is higher than MaxStepHeight', () => {
    let queryCount = 0
    const result = moveAlongFloor({
      start: { x: 0, y: 0, z: 0.9215 },
      delta: { x: 0.1, y: 0, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      CurrentFloor: FLAT_FLOOR,
      MaxStepHeight: 0.45,
      WalkableFloorZ: 0.71,
      sweepCapsule: (query) => {
        queryCount++
        if (queryCount === 1) {
          return {
            time: 0.5,
            impactNormal: { x: -1, y: 0, z: 0 },
            impactPoint: { x: 0.35, y: 0, z: 0.3 },
            bBlockingHit: true,
            bStartPenetrating: false,
          }
        }
        return query.delta.z < 0
          ? {
              time: 0.05,
              impactNormal: { x: 0, y: 0, z: 1 },
              impactPoint: { x: 0.35, y: 0, z: 0.5 },
              bBlockingHit: true,
              bStartPenetrating: false,
            }
          : null
      },
    })

    expect(result.bSteppedUp).toBe(false)
    expect(result.delta.x).toBeCloseTo(0.05, 12)
    expect(result.delta.z).toBe(0)
  })

  it('projects exactly onto the impact tangent', () => {
    expect(computeSlideVector(
      { x: 3, y: -2, z: 4 },
      0.25,
      { x: 0, y: 0, z: 1 },
    )).toEqual({ x: 0.75, y: -0.5, z: 0 })
  })
})
