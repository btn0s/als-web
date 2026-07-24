import type { AlsStance } from '../Settings/AlsMovementSettings'
import {
  ALS_DYNAMIC_TRANSITIONS_SETTINGS,
} from '../Settings/AlsDynamicTransitionsSettings'
import type {
  AlsDynamicTransitionDirection,
  AlsDynamicTransitionsSettings,
} from '../Settings/AlsDynamicTransitionsSettings'
import type { AlsFootState } from './AlsFeetState'
import {
  queueTransitionAnimation,
} from './AlsTransitionsState'
import type {
  AlsTransitionAnimation,
  AlsTransitionsState,
} from './AlsTransitionsState'

/** Framework-free counterpart of FAlsDynamicTransitionsState. */
export interface AlsDynamicTransitionsState {
  updatedThisFrame: boolean
  frameDelay: number
}

export function createAlsDynamicTransitionsState():
  AlsDynamicTransitionsState {
  return {
    updatedThisFrame: false,
    frameDelay: 0,
  }
}

/** NativeThreadSafeUpdateAnimation resets this latch at the start of every frame. */
export function resetDynamicTransitionsFrame(
  state: AlsDynamicTransitionsState,
): AlsDynamicTransitionsState {
  state.updatedThisFrame = false
  return state
}

export interface AlsRefreshDynamicTransitionsInput {
  readonly stance: AlsStance
  readonly scale: number
  readonly leftFoot: Pick<
    AlsFootState,
    'lockAmount' | 'targetLocation' | 'lockLocation'
  >
  readonly rightFoot: Pick<
    AlsFootState,
    'lockAmount' | 'targetLocation' | 'lockLocation'
  >
  readonly transitions: AlsTransitionsState
  readonly settings?: AlsDynamicTransitionsSettings
}

export interface AlsDynamicTransitionRequest
extends AlsTransitionAnimation {
  readonly direction: AlsDynamicTransitionDirection
}

const ZERO_ANIMATION_WEIGHT_THRESHOLD = 1e-5

function distanceSquared(
  a: Readonly<{ x: number; y: number; z: number }>,
  b: Readonly<{ x: number; y: number; z: number }>,
): number {
  const x = a.x - b.x
  const y = a.y - b.y
  const z = a.z - b.z
  return x * x + y * y + z * z
}

/**
 * Exact port of `UAlsAnimationInstance::RefreshDynamicTransitions()`,
 * `AlsAnimationInstance.cpp:1484-1587`.
 */
export function refreshDynamicTransitions(
  state: AlsDynamicTransitionsState,
  input: AlsRefreshDynamicTransitionsInput,
): AlsDynamicTransitionRequest | null {
  if (state.updatedThisFrame) return null
  state.updatedThisFrame = true

  if (state.frameDelay > 0) {
    state.frameDelay -= 1
    return null
  }
  if (!input.transitions.transitionsAllowed) return null

  const settings = input.settings ?? ALS_DYNAMIC_TRANSITIONS_SETTINGS
  const threshold = settings.footLockDistanceThreshold * input.scale
  const thresholdSquared = threshold * threshold
  const leftDistanceSquared = distanceSquared(
    input.leftFoot.targetLocation,
    input.leftFoot.lockLocation,
  )
  const rightDistanceSquared = distanceSquared(
    input.rightFoot.targetLocation,
    input.rightFoot.lockLocation,
  )
  const leftAllowed =
    input.leftFoot.lockAmount > ZERO_ANIMATION_WEIGHT_THRESHOLD
    && leftDistanceSquared > thresholdSquared
  const rightAllowed =
    input.rightFoot.lockAmount > ZERO_ANIMATION_WEIGHT_THRESHOLD
    && rightDistanceSquared > thresholdSquared

  if (!leftAllowed && !rightAllowed) return null

  const direction: AlsDynamicTransitionDirection =
    !leftAllowed
      ? 'Right'
      : !rightAllowed || leftDistanceSquared >= rightDistanceSquared
        ? 'Left'
        : 'Right'
  const request: AlsDynamicTransitionRequest = {
    direction,
    clip: settings.sequences[input.stance][direction],
    blendInDuration: settings.blendDuration,
    blendOutDuration: settings.blendDuration,
    playRate: settings.playRate,
    startTime: 0,
  }

  // ALS writes the two-frame block before queueing the game-thread montage.
  state.frameDelay = 2
  queueTransitionAnimation(input.transitions, request)
  return request
}
