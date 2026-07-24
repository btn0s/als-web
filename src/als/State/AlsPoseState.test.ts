import { describe, expect, it } from 'vitest'
import { refreshPose } from '../AlsAnimationInstance'

describe('ALS pose state', () => {
  it('segments PoseGait with walking/running/sprinting overlapping ramps', () => {
    expect(refreshPose(2.5)).toEqual({
      amount: 2.5,
      walking: 1,
      running: 1,
      sprinting: 0.5,
    })
  })
})
