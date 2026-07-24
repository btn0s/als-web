import { describe, expect, it } from 'vitest'
import {
  createVelocityBlend,
  stepVelocityBlend,
  velocityBlendTarget,
} from './velocityBlend'

describe('ALS velocity blend', () => {
  it.each([
    [{ x: 1, y: 0, z: 0 }, { forward: 1, backward: 0, left: 0, right: 0 }],
    [{ x: -1, y: 0, z: 0 }, { forward: 0, backward: 1, left: 0, right: 0 }],
    [{ x: 0, y: -1, z: 0 }, { forward: 0, backward: 0, left: 1, right: 0 }],
    [{ x: 0, y: 1, z: 0 }, { forward: 0, backward: 0, left: 0, right: 1 }],
  ])('splits a pure actor-local direction', (velocity, expected) => {
    expect(velocityBlendTarget(velocity, 0)).toEqual(expected)
  })

  it('unrotates world velocity by actor yaw before splitting channels', () => {
    const blend = velocityBlendTarget({ x: 0, y: 1, z: 0 }, Math.PI / 2)
    expect(blend.forward).toBeCloseTo(1, 12)
    expect(blend.backward).toBe(0)
    expect(blend.left).toBe(0)
    expect(blend.right).toBeCloseTo(0, 12)
  })

  it('L1-normalizes diagonals to 0.5/0.5 rather than 0.707/0.707', () => {
    expect(velocityBlendTarget({ x: 1, y: -1, z: 0 }, 0)).toEqual({
      forward: 0.5,
      backward: 0,
      left: 0.5,
      right: 0,
    })
  })

  it('snaps on initialization and follows the exact 12/s exponential-decay curve afterward', () => {
    const current = createVelocityBlend()
    const scratch = createVelocityBlend()
    stepVelocityBlend(current, { x: 1, y: 0, z: 0 }, 0, 1 / 60, true, scratch)
    expect(current.forward).toBe(1)

    stepVelocityBlend(current, { x: 0, y: 1, z: 0 }, 0, 0.1, false, scratch)
    const retained = Math.exp(-12 * 0.1)
    expect(current.forward).toBeCloseTo(retained, 8)
    expect(current.right).toBeCloseTo(1 - retained, 8)
  })
})
