import { describe, expect, it } from 'vitest'
import { createAlsMantlingState } from './AlsMantlingState'

describe('AlsMantlingState', () => {
  it('matches FAlsMantlingState defaults', () => {
    expect(createAlsMantlingState()).toEqual({
      RootMotionSourceId: 0,
    })
  })
})
