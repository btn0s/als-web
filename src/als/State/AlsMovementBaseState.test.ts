import { describe, expect, it } from 'vitest'
import {
  ALS_NO_BASED_MOVEMENT,
  createAlsMovementBaseState,
  refreshMovementBaseOnGameThread,
} from './AlsMovementBaseState'

function yawQuaternion(yaw: number) {
  const halfAngle = yaw * Math.PI / 360
  return {
    x: 0,
    y: 0,
    z: Math.sin(halfAngle),
    w: Math.cos(halfAngle),
  }
}

function basedMovement(
  primitive: unknown,
  yaw: number,
  hasRelativeLocation = true,
) {
  return {
    primitive,
    boneName: '',
    hasRelativeLocation,
    relativeRotation: true,
    location: { x: 1, y: 2, z: 3 },
    rotation: yawQuaternion(yaw),
  }
}

describe('FAlsMovementBaseState', () => {
  it('marks primitive and bone changes and suppresses their delta rotation', () => {
    const state = createAlsMovementBaseState()
    const primitive = {}

    refreshMovementBaseOnGameThread(
      state,
      basedMovement(primitive, 35),
    )

    expect(state.primitive).toBe(primitive)
    expect(state.baseChanged).toBe(true)
    expect(state.hasRelativeLocation).toBe(true)
    expect(state.hasRelativeRotation).toBe(true)
    expect(state.location).toEqual({ x: 1, y: 2, z: 3 })
    expect(state.deltaRotation).toEqual({ pitch: 0, yaw: 0, roll: 0 })

    refreshMovementBaseOnGameThread(state, {
      ...basedMovement(primitive, 80),
      boneName: 'platform_bone',
    })
    expect(state.baseChanged).toBe(true)
    expect(state.boneName).toBe('platform_bone')
    expect(state.deltaRotation).toEqual({ pitch: 0, yaw: 0, roll: 0 })
  })

  it('calculates Rotation * PreviousRotation.Inverse() on a retained base', () => {
    const state = createAlsMovementBaseState()
    const primitive = {}
    refreshMovementBaseOnGameThread(
      state,
      basedMovement(primitive, 35),
    )

    refreshMovementBaseOnGameThread(
      state,
      basedMovement(primitive, 80),
    )

    expect(state.baseChanged).toBe(false)
    expect(state.deltaRotation.pitch).toBeCloseTo(0, 12)
    expect(state.deltaRotation.yaw).toBeCloseTo(45, 12)
    expect(state.deltaRotation.roll).toBeCloseTo(0, 12)
  })

  it('retains static support identity without claiming relative movement', () => {
    const state = createAlsMovementBaseState()
    const staticFloorCollider = {}

    refreshMovementBaseOnGameThread(
      state,
      basedMovement(staticFloorCollider, 0, false),
    )

    expect(state.primitive).toBe(staticFloorCollider)
    expect(state.baseChanged).toBe(true)
    expect(state.hasRelativeLocation).toBe(false)
    expect(state.hasRelativeRotation).toBe(false)

    refreshMovementBaseOnGameThread(
      state,
      basedMovement(staticFloorCollider, 90, false),
    )
    expect(state.baseChanged).toBe(false)
    expect(state.deltaRotation).toEqual({ pitch: 0, yaw: 0, roll: 0 })
  })

  it('clears the base only when FBasedMovementInfo has no primitive', () => {
    const state = createAlsMovementBaseState()
    refreshMovementBaseOnGameThread(state, basedMovement({}, 0, false))

    refreshMovementBaseOnGameThread(state, ALS_NO_BASED_MOVEMENT)

    expect(state.primitive).toBeNull()
    expect(state.baseChanged).toBe(true)
    expect(state.hasRelativeLocation).toBe(false)
    expect(state.hasRelativeRotation).toBe(false)
    expect(state.location).toEqual({ x: 0, y: 0, z: 0 })
    expect(state.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 })
    expect(state.deltaRotation).toEqual({ pitch: 0, yaw: 0, roll: 0 })
  })
})
