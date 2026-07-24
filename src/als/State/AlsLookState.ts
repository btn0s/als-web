import type { AlsRotationMode } from '../Settings/AlsMovementSettings'
import { remapAngleForCounterClockwiseRotation } from '../Settings/AlsTurnInPlaceSettings'
import { exponentialDecay } from './AlsGroundedState'
import { unwindDegrees } from './AlsLocomotionState'

const UE_SMALL_NUMBER = 1e-8

export interface AlsLookState {
  initializationRequired: boolean
  worldYawAngle: number
  yawAngle: number
  pitchAngle: number
  yawForwardAmount: number
  yawLeftAmount: number
  yawRightAmount: number
}

export interface AlsLookSettings {
  readonly lookTowardsCameraRotationInterpolationSpeed: number
  readonly lookTowardsInputYawAngleInterpolationSpeed: number
}

export const ALS_LOOK_SETTINGS: AlsLookSettings = {
  // AlsViewAnimationSettings.h defaults; callers can supply extracted asset overrides.
  lookTowardsCameraRotationInterpolationSpeed: 8,
  lookTowardsInputYawAngleInterpolationSpeed: 8,
}

export interface AlsLookInput {
  readonly rotationMode: AlsRotationMode
  readonly actorYawAngle: number
  readonly movementBaseHasRelativeRotation: boolean
  readonly movementBaseDeltaRotationYaw: number
  readonly hasInput: boolean
  readonly inputYawAngle: number
  readonly targetYawAngle: number
  readonly viewYawAngle: number
  readonly viewPitchAngle: number
  readonly locomotionYawSpeed: number
  readonly deltaTime: number
}

export function createAlsLookState(): AlsLookState {
  return {
    initializationRequired: true,
    worldYawAngle: 0,
    yawAngle: 0,
    pitchAngle: 0,
    yawForwardAmount: 0.5,
    yawLeftAmount: 0.5,
    yawRightAmount: 0.5,
  }
}

function lerpAngle(from: number, to: number, ratio: number): number {
  const delta = remapAngleForCounterClockwiseRotation(
    unwindDegrees(to - from),
  )
  return unwindDegrees(from + delta * ratio)
}

/** Exact mutable port of UAlsAnimationInstance::RefreshLook(), cpp:494-581. */
export function refreshLook(
  state: AlsLookState,
  input: AlsLookInput,
  settings: AlsLookSettings = ALS_LOOK_SETTINGS,
): AlsLookState {
  const actorYawAngle = input.actorYawAngle

  if (input.movementBaseHasRelativeRotation) {
    state.worldYawAngle = unwindDegrees(
      state.worldYawAngle + input.movementBaseDeltaRotationYaw,
    )
  }

  let targetYawAngle: number
  let targetPitchAngle: number
  let interpolationSpeed: number

  if (input.rotationMode === 'VelocityDirection') {
    targetYawAngle = unwindDegrees(
      (input.hasInput ? input.inputYawAngle : input.targetYawAngle)
      - actorYawAngle,
    )
    targetPitchAngle = 0
    interpolationSpeed = settings.lookTowardsInputYawAngleInterpolationSpeed
  } else {
    targetYawAngle = input.viewYawAngle
    targetPitchAngle = input.viewPitchAngle
    interpolationSpeed = settings.lookTowardsCameraRotationInterpolationSpeed
  }

  if (state.initializationRequired || interpolationSpeed <= 0) {
    state.yawAngle = targetYawAngle
    state.pitchAngle = targetPitchAngle
    state.initializationRequired = false
  } else {
    const yawAngle = unwindDegrees(state.worldYawAngle - actorYawAngle)
    let deltaYawAngle = unwindDegrees(targetYawAngle - yawAngle)

    if (deltaYawAngle > 175) {
      deltaYawAngle -= 360
    } else if (
      Math.abs(input.locomotionYawSpeed) > UE_SMALL_NUMBER
      && Math.abs(targetYawAngle) > 90
    ) {
      // ALS favors the body's turn direction beyond 90 degrees so the head stays synchronized.
      deltaYawAngle = input.locomotionYawSpeed > 0
        ? Math.abs(deltaYawAngle)
        : -Math.abs(deltaYawAngle)
    }

    const interpolationAmount = exponentialDecay(
      input.deltaTime,
      interpolationSpeed,
    )
    state.yawAngle = unwindDegrees(
      yawAngle + deltaYawAngle * interpolationAmount,
    )
    state.pitchAngle = lerpAngle(
      state.pitchAngle,
      targetPitchAngle,
      interpolationAmount,
    )
  }

  state.worldYawAngle = unwindDegrees(actorYawAngle + state.yawAngle)
  state.yawForwardAmount = state.yawAngle / 360 + 0.5
  state.yawLeftAmount = 0.5 - Math.abs(state.yawForwardAmount - 0.5)
  state.yawRightAmount = 0.5 + Math.abs(state.yawForwardAmount - 0.5)
  return state
}
