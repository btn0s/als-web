import { describe, expect, it } from 'vitest'
import { createAlsViewAnimationState, refreshView } from './AlsViewAnimationState'

describe('FAlsViewAnimationState RefreshView', () => {
  it('uses the exact FAlsViewAnimationState defaults', () => {
    const state = createAlsViewAnimationState()
    expect(state).toEqual({
      rotationYawAngle: 0,
      rotationPitchAngle: 0,
      yawAngle: 0,
      yawSpeed: 0,
      pitchAngle: 0,
      pitchAmount: 0.5,
      lookAmount: 1,
    })
  })

  it('unwinds relative yaw, normalizes pitch, and clamps curve amounts', () => {
    const state = createAlsViewAnimationState()
    const result = refreshView(state, {
      viewBlockAmount: 2,
      allowAimingAmount: -1,
      locomotionAction: null,
      viewYawAngle: -170,
      viewPitchAngle: 90,
      locomotionYawAngle: 170,
      viewYawSpeed: 4,
    })

    expect(result).toEqual({
      viewAmount: 0,
      aimingAmount: 0,
      spineBlendAmount: 0,
    })
    expect(state).toMatchObject({
      yawAngle: 20,
      yawSpeed: 4,
      pitchAngle: 90,
      pitchAmount: 0,
      lookAmount: 0,
    })
  })

  it('retains relative angles during an action but still refreshes rotation and view yaw speed', () => {
    const state = createAlsViewAnimationState()
    const first = refreshView(state, {
      viewBlockAmount: 0.2,
      allowAimingAmount: 0.5,
      locomotionAction: null,
      viewYawAngle: 20,
      viewPitchAngle: -10,
      locomotionYawAngle: 0,
      viewYawSpeed: 3,
    })
    expect(state).toMatchObject({
      yawAngle: 20,
      pitchAngle: -10,
      pitchAmount: 0.5 + 10 / 180,
      lookAmount: 0.4,
    })
    expect(first).toEqual({
      viewAmount: 0.8,
      aimingAmount: 0.5,
      spineBlendAmount: 0.4,
    })

    const actionFrame = refreshView(state, {
      viewBlockAmount: 0,
      allowAimingAmount: 1,
      locomotionAction: 'Rolling',
      viewYawAngle: 80,
      viewPitchAngle: 30,
      locomotionYawAngle: 0,
      viewYawSpeed: 9,
    })
    expect(state).toMatchObject({
      rotationYawAngle: 80,
      rotationPitchAngle: 30,
      yawSpeed: 9,
      yawAngle: 20,
      pitchAngle: -10,
      pitchAmount: 0.5 + 10 / 180,
      lookAmount: 0,
    })
    expect(actionFrame).toEqual({
      viewAmount: 1,
      aimingAmount: 1,
      spineBlendAmount: 1,
    })
  })
})
