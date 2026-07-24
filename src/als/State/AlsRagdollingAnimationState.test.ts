import { describe, expect, it } from 'vitest'
import {
  createAlsRagdollingAnimationState,
} from './AlsRagdollingAnimationState'

describe('FAlsRagdollingAnimationState parity', () => {
  it('starts with an invalid snapshot and the authored flail rate', () => {
    expect(createAlsRagdollingAnimationState()).toEqual({
      FinalRagdollPose: null,
      FlailPlayRate: 1,
    })
  })
})
