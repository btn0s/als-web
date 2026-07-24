import { describe, expect, it } from 'vitest'
import {
  createAlsRagdollingState,
} from './AlsRagdollingState'

describe('FAlsRagdollingState parity', () => {
  it('initializes every field from the ALS state header', () => {
    expect(createAlsRagdollingState()).toEqual({
      Velocity: { x: 0, y: 0, z: 0 },
      PullForce: 0,
      SpeedLimitFrameTimeRemaining: 0,
      SpeedLimit: 0,
    })
  })

  it('allocates velocity ownership per state instance', () => {
    const first = createAlsRagdollingState()
    const second = createAlsRagdollingState()

    first.Velocity.x = 3

    expect(second.Velocity).toEqual({ x: 0, y: 0, z: 0 })
  })
})
