import { describe, expect, it } from 'vitest'
import {
  constrainAnimRootMotionVelocity,
} from './characterMovementRootMotion'

describe('UCharacterMovementComponent animation root motion', () => {
  it('accepts the complete animation velocity outside Falling', () => {
    expect(constrainAnimRootMotionVelocity(
      { x: 2, y: 3, z: 4 },
      { x: 7, y: 8, z: -9 },
      false,
    )).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('preserves only the physics vertical velocity while Falling', () => {
    expect(constrainAnimRootMotionVelocity(
      { x: 2, y: 3, z: 0 },
      { x: 7, y: 8, z: -9 },
      true,
    )).toEqual({ x: 2, y: 3, z: -9 })
  })
})
