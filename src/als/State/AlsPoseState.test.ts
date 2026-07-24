import { describe, expect, it } from 'vitest'
import { compileClipCurveSamplers } from '../../engine/curves'
import { refreshPose } from '../AlsAnimationInstance'
import {
  createAlsPoseState,
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from './AlsPoseState'

describe('ALS pose state', () => {
  it('uses the exact FAlsPoseState field defaults', () => {
    expect(createAlsPoseState()).toEqual({
      groundedAmount: 1,
      inAirAmount: 0,
      standingAmount: 1,
      crouchingAmount: 0,
      movingAmount: 0,
      amount: 0,
      walking: 0,
      running: 0,
      sprinting: 0,
      unweightedAmount: 0,
      unweightedWalking: 0,
      unweightedRunning: 0,
      unweightedSprinting: 0,
    })
  })

  it('segments PoseGait with walking/running/sprinting overlapping ramps', () => {
    expect(refreshPose(new Map([
      ['PoseGrounded', 0.5],
      ['PoseInAir', 0.25],
      ['PoseStanding', 0.75],
      ['PoseCrouching', 0.25],
      ['PoseMoving', 0.8],
      ['PoseGait', 1.25],
    ]))).toEqual({
      groundedAmount: 0.5,
      inAirAmount: 0.25,
      standingAmount: 0.75,
      crouchingAmount: 0.25,
      movingAmount: 0.8,
      amount: 1.25,
      walking: 1,
      running: 0.25,
      sprinting: 0,
      unweightedAmount: 2.5,
      unweightedWalking: 1,
      unweightedRunning: 1,
      unweightedSprinting: 0.5,
    })
  })

  it('does not divide by PoseGrounded at or below UE_SMALL_NUMBER', () => {
    expect(refreshPose(new Map([
      ['PoseGrounded', 1e-8],
      ['PoseGait', 2.5],
    ]))).toMatchObject({
      amount: 2.5,
      walking: 1,
      running: 1,
      sprinting: 0.5,
      unweightedAmount: 2.5,
      unweightedWalking: 1,
      unweightedRunning: 1,
      unweightedSprinting: 0.5,
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
