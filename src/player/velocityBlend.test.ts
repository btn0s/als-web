import { describe, expect, it } from 'vitest'
import {
  createVelocityBlend,
  stepVelocityBlend,
  velocityBlendTarget,
} from './velocityBlend'

describe('ALS velocity blend', () => {
  it.each([
    [{ x: 1, y: 0, z: 0 }, {
      forwardAmount: 1, backwardAmount: 0, leftAmount: 0, rightAmount: 0,
    }],
    [{ x: -1, y: 0, z: 0 }, {
      forwardAmount: 0, backwardAmount: 1, leftAmount: 0, rightAmount: 0,
    }],
    [{ x: 0, y: -1, z: 0 }, {
      forwardAmount: 0, backwardAmount: 0, leftAmount: 1, rightAmount: 0,
    }],
    [{ x: 0, y: 1, z: 0 }, {
      forwardAmount: 0, backwardAmount: 0, leftAmount: 0, rightAmount: 1,
    }],
  ])('splits a pure actor-local direction', (velocity, expected) => {
    expect(velocityBlendTarget(velocity, 0)).toEqual(expected)
  })

  it('unrotates world velocity by actor yaw before splitting channels', () => {
    const blend = velocityBlendTarget({ x: 0, y: 1, z: 0 }, Math.PI / 2)
    expect(blend.forwardAmount).toBeCloseTo(1, 12)
    expect(blend.backwardAmount).toBe(0)
    expect(blend.leftAmount).toBe(0)
    expect(blend.rightAmount).toBeCloseTo(0, 12)
  })

  it('L1-normalizes diagonals to 0.5/0.5 rather than 0.707/0.707', () => {
    expect(velocityBlendTarget({ x: 1, y: -1, z: 0 }, 0)).toEqual({
      forwardAmount: 0.5,
      backwardAmount: 0,
      leftAmount: 0.5,
      rightAmount: 0,
    })
  })

  it('snaps on initialization and follows the exact 12/s exponential-decay curve afterward', () => {
    const current = createVelocityBlend()
    const scratch = createVelocityBlend()
    stepVelocityBlend(current, { x: 1, y: 0, z: 0 }, 0, 1 / 60, true, scratch)
    expect(current.forwardAmount).toBe(1)

    stepVelocityBlend(current, { x: 0, y: 1, z: 0 }, 0, 0.1, false, scratch)
    const retained = Math.exp(-12 * 0.1)
    expect(current.forwardAmount).toBeCloseTo(retained, 8)
    expect(current.rightAmount).toBeCloseTo(1 - retained, 8)
  })
})
