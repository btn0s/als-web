import { remapAngleForCounterClockwiseRotation } from '../Settings/AlsTurnInPlaceSettings'
import { exponentialDecay } from './AlsGroundedState'
import { unwindDegrees } from './AlsLocomotionState'

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5
const SPINE_ENABLE_INTERPOLATION_SPEED = 20
const SPINE_DISABLE_INTERPOLATION_SPEED = 1
const REFERENCE_VIEW_YAW_SPEED = 40
const MAX_YAW_ANGLE_OFFSET = 30

export interface AlsSpineState {
  spineRotationAllowed: boolean
  spineAmount: number
  spineAmountScale: number
  spineAmountBias: number
  lastYawAngle: number
  currentYawAngle: number
  yawAngle: number
  lastActorYawAngle: number
}

export interface AlsSpineInput {
  readonly spineRotationAllowed: boolean
  readonly spineBlendAmount: number
  readonly deltaTime: number
  readonly pendingUpdate: boolean
  readonly viewYawAngle: number
  readonly viewYawSpeed: number
  readonly actorYawAngle: number
  readonly movementBaseHasRelativeRotation: boolean
  readonly movementBaseDeltaRotationYaw: number
}

export function createAlsSpineState(): AlsSpineState {
  return {
    spineRotationAllowed: false,
    spineAmount: 0,
    spineAmountScale: 1,
    spineAmountBias: 0,
    lastYawAngle: 0,
    currentYawAngle: 0,
    yawAngle: 0,
    lastActorYawAngle: 0,
  }
}

function isRelevant(weight: number): boolean {
  return weight > ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function isFullWeight(weight: number): boolean {
  return weight >= 1 - ZERO_ANIMATION_WEIGHT_THRESHOLD
}

function lerpAngle(from: number, to: number, ratio: number): number {
  const delta = remapAngleForCounterClockwiseRotation(
    unwindDegrees(to - from),
  )
  return unwindDegrees(from + delta * ratio)
}

/** Exact mutable port of UAlsAnimationInstance::RefreshSpine(), cpp:386-487. */
export function refreshSpine(
  state: AlsSpineState,
  input: AlsSpineInput,
): AlsSpineState {
  if (state.spineRotationAllowed !== input.spineRotationAllowed) {
    state.spineRotationAllowed = !state.spineRotationAllowed

    if (state.spineRotationAllowed) {
      if (isFullWeight(state.spineAmount)) {
        state.spineAmountScale = 1
        state.spineAmountBias = 0
      } else {
        state.spineAmountScale = 1 / (1 - state.spineAmount)
        state.spineAmountBias = -state.spineAmount * state.spineAmountScale
      }
    } else {
      state.spineAmountScale = !isRelevant(state.spineAmount)
        ? 1
        : 1 / state.spineAmount
      state.spineAmountBias = 0
    }

    state.lastYawAngle = state.currentYawAngle
    state.lastActorYawAngle = input.actorYawAngle
  }

  if (state.spineRotationAllowed) {
    if (input.pendingUpdate || isFullWeight(state.spineAmount)) {
      state.spineAmount = 1
      state.currentYawAngle = input.viewYawAngle
    } else {
      const interpolationAmount = exponentialDecay(
        input.deltaTime,
        SPINE_ENABLE_INTERPOLATION_SPEED,
      )
      state.spineAmount += (1 - state.spineAmount) * interpolationAmount
      state.currentYawAngle = lerpAngle(
        state.lastYawAngle,
        input.viewYawAngle,
        state.spineAmount * state.spineAmountScale + state.spineAmountBias,
      )
    }
  } else if (input.pendingUpdate || !isRelevant(state.spineAmount)) {
    state.spineAmount = 0
    state.currentYawAngle = 0
  } else {
    const interpolationSpeedMultiplier = Math.max(
      1,
      Math.abs(input.viewYawSpeed) / REFERENCE_VIEW_YAW_SPEED,
    )
    const interpolationAmount = exponentialDecay(
      input.deltaTime,
      SPINE_DISABLE_INTERPOLATION_SPEED * interpolationSpeedMultiplier,
    )
    state.spineAmount += (0 - state.spineAmount) * interpolationAmount

    if (input.movementBaseHasRelativeRotation) {
      state.lastActorYawAngle = unwindDegrees(
        state.lastActorYawAngle + input.movementBaseDeltaRotationYaw,
      )
    }

    let yawAngleOffset = unwindDegrees(
      state.lastActorYawAngle - input.actorYawAngle,
    )
    yawAngleOffset = Math.max(
      -MAX_YAW_ANGLE_OFFSET,
      Math.min(MAX_YAW_ANGLE_OFFSET, yawAngleOffset),
    )
    state.lastActorYawAngle = unwindDegrees(
      yawAngleOffset + input.actorYawAngle,
    )
    state.currentYawAngle = lerpAngle(
      0,
      state.lastYawAngle + yawAngleOffset,
      state.spineAmount * state.spineAmountScale + state.spineAmountBias,
    )
  }

  state.yawAngle = lerpAngle(
    0,
    state.currentYawAngle,
    input.spineBlendAmount,
  )
  return state
}
