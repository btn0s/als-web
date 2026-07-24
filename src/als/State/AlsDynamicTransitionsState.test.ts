import { describe, expect, it } from 'vitest'
import {
  ALS_DYNAMIC_TRANSITIONS_SETTINGS,
} from '../Settings/AlsDynamicTransitionsSettings'
import {
  createAlsDynamicTransitionsState,
  refreshDynamicTransitions,
  resetDynamicTransitionsFrame,
} from './AlsDynamicTransitionsState'
import { createAlsFootState } from './AlsFeetState'
import {
  createAlsTransitionsState,
  takeQueuedTransitionAnimation,
} from './AlsTransitionsState'
import type { AlsStance } from '../Settings/AlsMovementSettings'

function input() {
  const leftFoot = createAlsFootState()
  const rightFoot = createAlsFootState()
  const transitions = createAlsTransitionsState()
  transitions.transitionsAllowed = true
  leftFoot.lockAmount = 1
  rightFoot.lockAmount = 1
  return {
    stance: 'Standing' as const,
    scale: 1,
    leftFoot,
    rightFoot,
    transitions,
  }
}

interface CppDynamicTransitionInput {
  stance: AlsStance
  scale: number
  transitionsAllowed: boolean
  leftLockAmount: number
  rightLockAmount: number
  leftTarget: readonly [number, number, number]
  leftLock: readonly [number, number, number]
  rightTarget: readonly [number, number, number]
  rightLock: readonly [number, number, number]
}

function cppRefreshDynamicTransitions(
  state: { bUpdatedThisFrame: boolean; FrameDelay: number },
  input: CppDynamicTransitionInput,
) {
  if (state.bUpdatedThisFrame) return null
  state.bUpdatedThisFrame = true
  if (state.FrameDelay > 0) {
    state.FrameDelay -= 1
    return null
  }
  if (!input.transitionsAllowed) return null

  const distanceSquared = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ) => (
    (a[0] - b[0]) ** 2
    + (a[1] - b[1]) ** 2
    + (a[2] - b[2]) ** 2
  )
  const thresholdSquared = (8 * input.scale) ** 2
  const leftDistanceSquared = distanceSquared(
    input.leftTarget,
    input.leftLock,
  )
  const rightDistanceSquared = distanceSquared(
    input.rightTarget,
    input.rightLock,
  )
  const leftAllowed =
    input.leftLockAmount > 1e-5
    && leftDistanceSquared > thresholdSquared
  const rightAllowed =
    input.rightLockAmount > 1e-5
    && rightDistanceSquared > thresholdSquared
  if (!leftAllowed && !rightAllowed) return null

  state.FrameDelay = 2
  return !leftAllowed
    ? 'Right'
    : !rightAllowed || leftDistanceSquared >= rightDistanceSquared
      ? 'Left'
      : 'Right'
}

describe('RefreshDynamicTransitions parity', () => {
  it('initializes and resets the per-frame latch exactly', () => {
    const state = createAlsDynamicTransitionsState()
    expect(state).toEqual({ updatedThisFrame: false, frameDelay: 0 })
    state.updatedThisFrame = true
    expect(resetDynamicTransitionsFrame(state).updatedThisFrame).toBe(false)
  })

  it('uses strict relevance and scaled 8 cm distance boundaries', () => {
    const state = createAlsDynamicTransitionsState()
    const value = input()
    value.leftFoot.targetLocation.x = 0.16

    value.leftFoot.lockAmount = 1e-5
    expect(refreshDynamicTransitions(state, { ...value, scale: 2 })).toBeNull()

    resetDynamicTransitionsFrame(state)
    value.leftFoot.lockAmount = 1e-5 + Number.EPSILON
    expect(refreshDynamicTransitions(state, { ...value, scale: 2 })).toBeNull()

    resetDynamicTransitionsFrame(state)
    value.leftFoot.targetLocation.x += Number.EPSILON
    expect(refreshDynamicTransitions(state, { ...value, scale: 2 })?.direction)
      .toBe('Left')
  })

  it('selects the sole eligible side and resolves stance-specific clips', () => {
    const state = createAlsDynamicTransitionsState()
    const value = input()
    value.rightFoot.targetLocation.y = 0.2

    const request = refreshDynamicTransitions(state, {
      ...value,
      stance: 'Crouching',
    })

    expect(request).toEqual({
      direction: 'Right',
      clip: 'A_Als_Crouch_DynamicTransition_Right',
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
      startTime: 0,
    })
    expect(takeQueuedTransitionAnimation(value.transitions)).toEqual({
      clip: request!.clip,
      blendInDuration: request!.blendInDuration,
      blendOutDuration: request!.blendOutDuration,
      playRate: request!.playRate,
      startTime: request!.startTime,
    })
  })

  it('chooses the larger error, breaking an exact tie toward Left', () => {
    const leftState = createAlsDynamicTransitionsState()
    const leftValue = input()
    leftValue.leftFoot.targetLocation.x = 0.2
    leftValue.rightFoot.targetLocation.x = -0.2
    expect(refreshDynamicTransitions(leftState, leftValue)?.direction)
      .toBe('Left')

    const rightState = createAlsDynamicTransitionsState()
    const rightValue = input()
    rightValue.leftFoot.targetLocation.x = 0.2
    rightValue.rightFoot.targetLocation.x = -0.21
    expect(refreshDynamicTransitions(rightState, rightValue)?.direction)
      .toBe('Right')
  })

  it('sets the two-frame delay and remains idempotent until each frame reset', () => {
    const state = createAlsDynamicTransitionsState()
    const value = input()
    value.leftFoot.targetLocation.x = 0.2

    expect(refreshDynamicTransitions(state, value)).not.toBeNull()
    expect(state.frameDelay).toBe(2)
    expect(refreshDynamicTransitions(state, value)).toBeNull()
    expect(state.frameDelay).toBe(2)

    resetDynamicTransitionsFrame(state)
    expect(refreshDynamicTransitions(state, value)).toBeNull()
    expect(state.frameDelay).toBe(1)
    resetDynamicTransitionsFrame(state)
    expect(refreshDynamicTransitions(state, value)).toBeNull()
    expect(state.frameDelay).toBe(0)
    resetDynamicTransitionsFrame(state)
    expect(refreshDynamicTransitions(state, value)).not.toBeNull()
  })

  it('does not consume frame delay while the same-frame latch is already set', () => {
    const state = createAlsDynamicTransitionsState()
    state.updatedThisFrame = true
    state.frameDelay = 2
    expect(refreshDynamicTransitions(state, input())).toBeNull()
    expect(state.frameDelay).toBe(2)
  })

  it('does not queue while AllowTransitions is false', () => {
    const state = createAlsDynamicTransitionsState()
    const value = input()
    value.transitions.transitionsAllowed = false
    value.leftFoot.targetLocation.x = 100

    expect(refreshDynamicTransitions(state, value)).toBeNull()
    expect(value.transitions.queuedTransition).toBeNull()
    expect(state.frameDelay).toBe(0)
  })

  it('pins all defaults from FAlsDynamicTransitionsSettings and AIS_Als_Default', () => {
    expect(ALS_DYNAMIC_TRANSITIONS_SETTINGS).toEqual({
      footLockDistanceThreshold: 0.08,
      blendDuration: 0.2,
      playRate: 1.5,
      sequences: {
        Standing: {
          Left: 'A_Als_Stand_DynamicTransition_Left',
          Right: 'A_Als_Stand_DynamicTransition_Right',
        },
        Crouching: {
          Left: 'A_Als_Crouch_DynamicTransition_Left',
          Right: 'A_Als_Crouch_DynamicTransition_Right',
        },
      },
    })
  })

  it('matches a line-mirroring C++ oracle across 512 seeded state and unit-boundary cases', () => {
    let seed = 0xd1a6_7a15
    const random = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 0x1_0000_0000
    }
    const scalar = (extent: number) => (random() * 2 - 1) * extent

    for (let index = 0; index < 512; index++) {
      const runtimeState = createAlsDynamicTransitionsState()
      runtimeState.updatedThisFrame = random() > 0.8
      runtimeState.frameDelay = Math.floor(random() * 4)
      const cppState = {
        bUpdatedThisFrame: runtimeState.updatedThisFrame,
        FrameDelay: runtimeState.frameDelay,
      }
      const value = input()
      const stance: AlsStance =
        random() > 0.5 ? 'Standing' : 'Crouching'
      value.scale = 0.2 + random() * 2.8
      value.transitions.transitionsAllowed = random() > 0.25
      value.leftFoot.lockAmount = random() * 1.2
      value.rightFoot.lockAmount = random() * 1.2
      value.leftFoot.targetLocation = {
        x: scalar(3),
        y: scalar(3),
        z: scalar(3),
      }
      value.leftFoot.lockLocation = {
        x: scalar(3),
        y: scalar(3),
        z: scalar(3),
      }
      value.rightFoot.targetLocation = {
        x: scalar(3),
        y: scalar(3),
        z: scalar(3),
      }
      value.rightFoot.lockLocation = {
        x: scalar(3),
        y: scalar(3),
        z: scalar(3),
      }

      // The C++ oracle receives the same positions in native centimetres.
      const toCentimetres = (
        point: Readonly<{ x: number; y: number; z: number }>,
      ): [number, number, number] => [
        point.x * 100,
        point.y * 100,
        point.z * 100,
      ]
      const cppDirection = cppRefreshDynamicTransitions(cppState, {
        stance,
        scale: value.scale,
        transitionsAllowed: value.transitions.transitionsAllowed,
        leftLockAmount: value.leftFoot.lockAmount,
        rightLockAmount: value.rightFoot.lockAmount,
        leftTarget: toCentimetres(value.leftFoot.targetLocation),
        leftLock: toCentimetres(value.leftFoot.lockLocation),
        rightTarget: toCentimetres(value.rightFoot.targetLocation),
        rightLock: toCentimetres(value.rightFoot.lockLocation),
      })
      const runtimeRequest = refreshDynamicTransitions(runtimeState, {
        ...value,
        stance,
      })

      expect(runtimeRequest?.direction ?? null).toBe(cppDirection)
      expect(runtimeState.updatedThisFrame).toBe(cppState.bUpdatedThisFrame)
      expect(runtimeState.frameDelay).toBe(cppState.FrameDelay)
      if (runtimeRequest) {
        expect(runtimeRequest.clip).toBe(
          ALS_DYNAMIC_TRANSITIONS_SETTINGS
            .sequences[stance][runtimeRequest.direction],
        )
      } else {
        expect(value.transitions.queuedTransition).toBeNull()
      }
    }
  })
})
