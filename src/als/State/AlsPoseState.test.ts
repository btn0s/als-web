import { describe, expect, it } from 'vitest'
import { compileClipCurveSamplers } from '../../engine/curves'
import { refreshPose } from '../AlsAnimationInstance'
import {
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from './AlsPoseState'

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

describe('ALS authored stance transition curves', () => {
  it('takes crouching and foot-lock amounts from the playing clip at its current time', () => {
    const state = createAlsStanceTransitionCurveState()
    const curves = compileClipCurveSamplers({
      userData: {
        alsCurves: [
          {
            name: 'PoseCrouching',
            keys: [[0, 0, 2], [0.833, 1, 0]],
          },
          {
            name: 'FootLeftLock',
            keys: [[0, 0.75, 0]],
          },
          {
            name: 'FootRightLock',
            keys: [[0, 0.25, 0]],
          },
        ],
      },
    })
    refreshStanceTransition(state, 1, 1 / 60, {
      time: 0.833 * 0.25,
      curves,
    })

    expect(state.crouchingAmount).toBeCloseTo(0.15625)
    expect(state.footLeftLock).toBeCloseTo(0.75)
    expect(state.footRightLock).toBeCloseTo(0.25)
  })

  it('retains the documented 10/s non-popping fallback only without a transition clip', () => {
    const state = createAlsStanceTransitionCurveState()
    refreshStanceTransition(state, 1, 0.1)
    expect(state.crouchingAmount).toBeCloseTo(1 - Math.exp(-1))
  })
})
