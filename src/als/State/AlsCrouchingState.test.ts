import { describe, expect, it } from 'vitest'
import {
  createAlsCrouchingState,
  refreshCrouchingMovement,
} from './AlsCrouchingState'

describe('RefreshCrouchingMovement', () => {
  it('reuses the authored walk stride curve and crouch animated speed', () => {
    const stopped = refreshCrouchingMovement(createAlsCrouchingState(), 0)
    expect(stopped.strideBlendAmount).toBe(0.2)
    expect(stopped.playRate).toBe(1e-4)

    const authored = refreshCrouchingMovement(createAlsCrouchingState(), 1.5)
    expect(authored.strideBlendAmount).toBe(1)
    expect(authored.playRate).toBe(1)
  })

  it('matches ALS two-times crouching play-rate clamp', () => {
    expect(
      refreshCrouchingMovement(createAlsCrouchingState(), 20).playRate,
    ).toBe(2)
  })
})
