import { describe, expect, it } from 'vitest'
import { applyAlsImmediateMovementStop } from './alsMovementCommands'

describe('immediate consumer movement stop', () => {
  it.each([undefined, false])('preserves actual and collision-intended velocity without a request (%s)', requested => {
    const actual = { x: 1, y: 2, z: -3 }
    const intended = { x: 4, y: -5, z: 6 }
    expect(applyAlsImmediateMovementStop(requested, actual, intended)).toBe(false)
    expect(actual).toEqual({ x: 1, y: 2, z: -3 })
    expect(intended).toEqual({ x: 4, y: -5, z: 6 })
  })

  it('clears both velocity owners, including stale pre-penetration intent', () => {
    const actual = { x: 0.7, y: 0.2, z: -0.1 }
    const intended = { x: 1, y: 1, z: 0.5 }
    expect(applyAlsImmediateMovementStop(true, actual, intended)).toBe(true)
    expect(actual).toEqual({ x: 0, y: 0, z: 0 })
    expect(intended).toEqual({ x: 0, y: 0, z: 0 })
    actual.x = 0.3
    expect(applyAlsImmediateMovementStop(false, actual, intended)).toBe(false)
    expect(actual.x).toBe(0.3)
  })
})
