import type { AlsLocomotionAction } from '../AlsCharacter'
import { unwindDegrees } from './AlsLocomotionState'

/** FAlsViewAnimationState fields owned by UAlsAnimationInstance. */
export interface AlsViewAnimationState {
  rotationYawAngle: number
  rotationPitchAngle: number
  yawAngle: number
  yawSpeed: number
  pitchAngle: number
  pitchAmount: number
  lookAmount: number
}

export interface AlsViewRefreshResult {
  readonly viewAmount: number
  readonly aimingAmount: number
  readonly spineBlendAmount: number
}

export function createAlsViewAnimationState(): AlsViewAnimationState {
  return {
    rotationYawAngle: 0,
    rotationPitchAngle: 0,
    yawAngle: 0,
    yawSpeed: 0,
    pitchAngle: 0,
    pitchAmount: 0.5,
    lookAmount: 1,
  }
}

/** UAlsAnimationInstance::RefreshViewOnGameThread + RefreshView. */
export function refreshView(
  state: AlsViewAnimationState,
  input: {
    readonly viewBlockAmount: number
    readonly allowAimingAmount: number
    readonly locomotionAction: AlsLocomotionAction | null | undefined
    readonly viewYawAngle: number
    readonly viewPitchAngle: number
    readonly locomotionYawAngle: number
    readonly viewYawSpeed: number
  },
): AlsViewRefreshResult {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
  state.rotationYawAngle = unwindDegrees(input.viewYawAngle)
  state.rotationPitchAngle = unwindDegrees(input.viewPitchAngle)
  state.yawSpeed = input.viewYawSpeed
  if (!input.locomotionAction) {
    state.yawAngle = unwindDegrees(
      state.rotationYawAngle - input.locomotionYawAngle,
    )
    state.pitchAngle = state.rotationPitchAngle
    state.pitchAmount = 0.5 - state.pitchAngle / 180
  }
  const viewAmount = 1 - clamp01(input.viewBlockAmount)
  const aimingAmount = clamp01(input.allowAimingAmount)
  state.lookAmount = viewAmount * (1 - aimingAmount)
  return { viewAmount, aimingAmount, spineBlendAmount: viewAmount * aimingAmount }
}
