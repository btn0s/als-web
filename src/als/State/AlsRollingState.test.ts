import { describe, expect, it } from 'vitest'
import {
  createAlsRollingState,
} from './AlsRollingState'

describe('FAlsRollingState parity', () => {
  it('initializes every field from the ALS state header', () => {
    expect(createAlsRollingState()).toEqual({
      TargetYawAngle: 0,
    })
  })
})
