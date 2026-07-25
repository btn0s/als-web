import { describe, expect, it } from 'vitest'
import {
  computeSlideVector,
  moveGroundedWithSlideAlongSurface,
} from './characterMovementGroundedMove'

describe('CharacterMovement grounded wall move', () => {
  it('matches UE first-hit movement followed by one SlideAlongSurface adjustment', () => {
    let queryCount = 0
    const result = moveGroundedWithSlideAlongSurface({
      start: { x: 0, y: 0, z: 0.9 },
      delta: { x: 2, y: 1, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: () => {
        queryCount++
        return queryCount === 1
          ? {
              time: 0.8,
              impactNormal: { x: -1, y: 0, z: 0 },
              bBlockingHit: true,
              bStartPenetrating: false,
            }
          : null
      },
    })

    expect(result.delta).toEqual({ x: 1.6, y: 1, z: 0 })
    expect(result.slideDelta).toMatchObject({ x: 0, z: 0 })
    expect(result.slideDelta.y).toBeCloseTo(0.2, 12)
  })

  it('performs a second safe sweep before accepting the one-wall slide', () => {
    const queries: Array<{ start: { x: number; y: number; z: number }; delta: { x: number; y: number; z: number } }> = []
    const result = moveGroundedWithSlideAlongSurface({
      start: { x: 0, y: 0, z: 0.9 },
      delta: { x: 2, y: 2, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: (query) => {
        queries.push({ start: query.start, delta: query.delta })
        return queries.length === 1
          ? {
              time: 0.5,
              impactNormal: { x: -1, y: 0, z: 0 },
              bBlockingHit: true,
              bStartPenetrating: false,
            }
          : {
              time: 0.25,
              impactNormal: { x: 0, y: -1, z: 0 },
              bBlockingHit: true,
              bStartPenetrating: false,
            }
      },
    })

    expect(queries).toEqual([
      { start: { x: 0, y: 0, z: 0.9 }, delta: { x: 2, y: 2, z: 0 } },
      { start: { x: 1, y: 1, z: 0.9 }, delta: { x: 0, y: 1, z: 0 } },
    ])
    expect(result.delta).toEqual({ x: 1, y: 1.25, z: 0 })
    expect(result.secondHit?.impactNormal).toEqual({ x: 0, y: -1, z: 0 })
  })

  it('does not invent a collision response for a miss or penetration', () => {
    const miss = moveGroundedWithSlideAlongSurface({
      start: { x: 0, y: 0, z: 0 },
      delta: { x: 1, y: 2, z: 3 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: () => null,
    })
    const penetration = moveGroundedWithSlideAlongSurface({
      start: { x: 0, y: 0, z: 0 },
      delta: { x: 1, y: 0, z: 0 },
      capsuleRadius: 0.3,
      capsuleHalfHeight: 0.9,
      sweepCapsule: () => ({
        time: 0,
        impactNormal: { x: -1, y: 0, z: 0 },
        bBlockingHit: true,
        bStartPenetrating: true,
      }),
    })

    expect(miss.delta).toEqual({ x: 1, y: 2, z: 3 })
    expect(penetration.delta).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('projects exactly onto the impact tangent', () => {
    expect(computeSlideVector(
      { x: 3, y: -2, z: 4 },
      0.25,
      { x: 0, y: 0, z: 1 },
    )).toEqual({ x: 0.75, y: -0.5, z: 0 })
  })
})
