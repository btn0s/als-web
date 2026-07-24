import { describe, expect, it } from 'vitest'
import {
  PlayQuickStopAnimation as playQuickStopAnimationReference,
} from '../reference/AlsAnimationInstance.reference'
import {
  ALS_QUICK_STOP_SETTINGS,
  playQuickStopAnimation,
} from './quickStop'
import type {
  AlsQuickStopAnimationInput,
} from './quickStop'

const REFERENCE_PLAY_RATE = [1.75, 3] as const

function reference(input: AlsQuickStopAnimationInput) {
  return playQuickStopAnimationReference({
    RotationMode: input.rotationMode,
    bHasInput: input.hasInput,
    InputYawAngle: input.inputYawAngle,
    TargetYawAngle: input.targetYawAngle,
    ActorYawAngle: input.actorYawAngle,
    QuickStopPlayRate: REFERENCE_PLAY_RATE,
  })
}

function seededRandom(seed = 0x51_53_54_4f) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_00_00_00_00
  }
}

function range(random: () => number, minimum: number, maximum: number) {
  return minimum + (maximum - minimum) * random()
}

describe('VERIFIED ALS PlayQuickStopAnimation', () => {
  it('matches the test-only C++ reference oracle over seeded inputs', () => {
    const random = seededRandom()
    const rotationModes = [
      'VelocityDirection',
      'ViewDirection',
      'Aiming',
    ] as const
    const stances = ['Standing', 'Crouching'] as const

    for (let index = 0; index < 1_000; index++) {
      const input: AlsQuickStopAnimationInput = {
        rotationMode: rotationModes[
          Math.floor(random() * rotationModes.length)
        ],
        stance: stances[Math.floor(random() * stances.length)],
        hasInput: random() >= 0.5,
        inputYawAngle: range(random, -2_000, 2_000),
        targetYawAngle: range(random, -2_000, 2_000),
        actorYawAngle: range(random, -2_000, 2_000),
      }
      const actual = playQuickStopAnimation(input)
      const expected = reference(input)

      expect(actual.direction).toBe(expected.Direction)
      expect(actual.playRate).toBeCloseTo(expected.PlayRate, 12)
      expect(actual.clip).toBe(
        ALS_QUICK_STOP_SETTINGS.sequences[input.stance][actual.direction],
      )
    }
  })

  it.each([
    { targetYawAngle: -181, actorYawAngle: 0 },
    { targetYawAngle: -180, actorYawAngle: 0 },
    { targetYawAngle: -175, actorYawAngle: 0 },
    { targetYawAngle: -0.000_001, actorYawAngle: 0 },
    { targetYawAngle: 0, actorYawAngle: 0 },
    { targetYawAngle: 0.000_001, actorYawAngle: 0 },
    { targetYawAngle: 175, actorYawAngle: 0 },
    { targetYawAngle: 175.000_001, actorYawAngle: 0 },
    { targetYawAngle: 180, actorYawAngle: 0 },
    { targetYawAngle: 181, actorYawAngle: 0 },
    { targetYawAngle: 540, actorYawAngle: 0 },
    { targetYawAngle: -540, actorYawAngle: 0 },
    { targetYawAngle: 915.000_001, actorYawAngle: 720 },
  ])(
    'matches unwind/remap boundary target=$targetYawAngle actor=$actorYawAngle',
    ({ targetYawAngle, actorYawAngle }) => {
      const input: AlsQuickStopAnimationInput = {
        rotationMode: 'VelocityDirection',
        stance: 'Standing',
        hasInput: false,
        inputYawAngle: -73,
        targetYawAngle,
        actorYawAngle,
      }
      const actual = playQuickStopAnimation(input)
      const expected = reference(input)

      expect(actual.direction).toBe(expected.Direction)
      expect(actual.playRate).toBeCloseTo(expected.PlayRate, 12)
    },
  )

  it('preserves FMath::Lerp range mapping without clamping', () => {
    const request = playQuickStopAnimation({
      rotationMode: 'VelocityDirection',
      stance: 'Standing',
      hasInput: false,
      inputYawAngle: 0,
      targetYawAngle: 175.000_001,
      actorYawAngle: 0,
    })

    expect(request.direction).toBe('Left')
    expect(request.playRate).toBeGreaterThan(
      ALS_QUICK_STOP_SETTINGS.playRate[1],
    )
    expect(request.playRate).toBeCloseTo(
      reference({
        rotationMode: 'VelocityDirection',
        stance: 'Standing',
        hasInput: false,
        inputYawAngle: 0,
        targetYawAngle: 175.000_001,
        actorYawAngle: 0,
      }).PlayRate,
      12,
    )
  })

  it('uses input yaw only while input is present', () => {
    const base: AlsQuickStopAnimationInput = {
      rotationMode: 'VelocityDirection',
      stance: 'Standing',
      hasInput: true,
      inputYawAngle: 90,
      targetYawAngle: -90,
      actorYawAngle: 0,
    }

    expect(playQuickStopAnimation(base).direction).toBe('Right')
    expect(playQuickStopAnimation({ ...base, hasInput: false }).direction)
      .toBe('Left')
  })

  it('always requests the left transition at minimum rate outside VelocityDirection', () => {
    for (const rotationMode of ['ViewDirection', 'Aiming'] as const) {
      for (const stance of ['Standing', 'Crouching'] as const) {
        const request = playQuickStopAnimation({
          rotationMode,
          stance,
          hasInput: true,
          inputYawAngle: 179,
          targetYawAngle: -93,
          actorYawAngle: 17,
        })

        expect(request).toEqual({
          direction: 'Left',
          clip: ALS_QUICK_STOP_SETTINGS.sequences[stance].Left,
          blendInDuration: 0.1,
          blendOutDuration: 0.2,
          playRate: 1.75,
          startTime: 0.3,
        })
      }
    }
  })

  it('selects the four AIS_Als_Default transition sequence references', () => {
    expect(ALS_QUICK_STOP_SETTINGS.sequences).toEqual({
      Standing: {
        Left: 'A_Als_Stand_Transition_Left',
        Right: 'A_Als_Stand_Transition_Right',
      },
      Crouching: {
        Left: 'A_Als_Crouch_Transition_Left',
        Right: 'A_Als_Crouch_Transition_Right',
      },
    })
  })
})
