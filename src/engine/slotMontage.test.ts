import { describe, expect, it } from 'vitest'
import {
  advanceSlotMontageClock,
  advanceSlotMontageGroup,
  blendSlotCurveValue,
  createSlotMontageClock,
  getSlotMontageSample,
  playSlotAnimationAsDynamicMontage,
  stopSlotAnimation,
} from './slotMontage'
import type { SlotMontageRequest, SlotMontageSample } from './slotMontage'

function request(
  overrides: Partial<SlotMontageRequest> = {},
): SlotMontageRequest {
  return {
    clipKey: 'transition',
    clipDuration: 2,
    slotName: 'Transition',
    groupName: 'DefaultGroup',
    blendInDuration: 0.4,
    blendOutDuration: 0.2,
    playRate: 1,
    loopCount: 1,
    blendOutTriggerTime: 0,
    startTime: 0,
    ...overrides,
  }
}

describe('UE dynamic slot montage clock', () => {
  it('uses the same complementary alpha for present and absent montage curves', () => {
    expect(blendSlotCurveValue(1, -1, 0.25)).toBeCloseTo(0.5)
    expect(blendSlotCurveValue(1, undefined, 0.25)).toBeCloseTo(0.75)
    expect(blendSlotCurveValue(0, 100, 0.25)).toBeCloseTo(25)
    expect(blendSlotCurveValue(1, 100, -1)).toBe(1)
    expect(blendSlotCurveValue(1, 100, 2)).toBe(100)
  })

  it('applies segment play rate before mapping montage start time to the source sample', () => {
    const clock = createSlotMontageClock()
    const initial = playSlotAnimationAsDynamicMontage(clock, request({
      playRate: 2,
      startTime: 0.25,
    }))

    expect(initial.montageTime).toBeCloseTo(0.25)
    expect(initial.sampleTime).toBeCloseTo(0.5)
    expect(initial.weight).toBe(0)
    expect(initial.status).toBe('blendingIn')

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(halfway?.montageTime).toBeCloseTo(0.45)
    expect(halfway?.sampleTime).toBeCloseTo(0.9)
    expect(halfway?.weight).toBeCloseTo(0.5)

    const full = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(full?.montageTime).toBeCloseTo(0.65)
    expect(full?.sampleTime).toBeCloseTo(1.3)
    expect(full?.weight).toBe(1)
    expect(full?.status).toBe('playing')
  })

  it('matches ALS trigger zero by retaining the terminal sample through the fade tail', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 1,
      blendInDuration: 0.2,
      blendOutDuration: 0.2,
      playRate: 1.5,
    }))

    const atEnd = advanceSlotMontageGroup(clock, 'DefaultGroup', 2 / 3)
    expect(atEnd?.montageTime).toBeCloseTo(2 / 3)
    expect(atEnd?.sampleTime).toBe(1)
    expect(atEnd?.weight).toBe(1)
    expect(atEnd?.status).toBe('blendingOut')
    expect(atEnd?.blendOutReason).toBe('automatic')

    const fading = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(fading?.montageTime).toBeCloseTo(2 / 3)
    expect(fading?.sampleTime).toBe(1)
    expect(fading?.weight).toBeCloseTo(0.5)
    expect(fading?.status).toBe('blendingOut')

    const completed = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(completed?.sampleTime).toBe(1)
    expect(completed?.weight).toBe(0)
    expect(completed?.status).toBe('completed')
    expect(getSlotMontageSample(clock, 'DefaultGroup')).toBeUndefined()
  })

  it('wraps authored loops but preserves the terminal frame of the final loop', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 1,
      blendInDuration: 0,
      playRate: 2,
      loopCount: 2,
      startTime: 0.1,
    }))

    const secondLoop = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.4)
    expect(secondLoop?.montageTime).toBeCloseTo(0.5)
    expect(secondLoop?.sampleTime).toBeCloseTo(0)
    expect(secondLoop?.status).toBe('playing')

    const terminal = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.5)
    expect(terminal?.montageTime).toBeCloseTo(1)
    expect(terminal?.sampleTime).toBe(1)
    expect(terminal?.status).toBe('blendingOut')
  })

  it('uses a non-negative trigger as seconds before the montage end', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      blendInDuration: 0,
      blendOutDuration: 0.25,
      blendOutTriggerTime: 0.5,
    }))

    const trigger = advanceSlotMontageGroup(clock, 'DefaultGroup', 1.5)
    expect(trigger?.montageTime).toBeCloseTo(1.5)
    expect(trigger?.weight).toBe(1)
    expect(trigger?.status).toBe('blendingOut')

    const complete = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.25)
    expect(complete?.montageTime).toBeCloseTo(1.75)
    expect(complete?.sampleTime).toBeCloseTo(1.75)
    expect(complete?.status).toBe('completed')
  })

  it('uses BlendOutTime for a negative trigger so fading finishes at montage end', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 4,
      blendInDuration: 0,
      blendOutDuration: 0.5,
      blendOutTriggerTime: -1,
      playRate: 2,
    }))

    const trigger = advanceSlotMontageGroup(clock, 'DefaultGroup', 1.5)
    expect(trigger?.montageTime).toBeCloseTo(1.5)
    expect(trigger?.sampleTime).toBeCloseTo(3)
    expect(trigger?.status).toBe('blendingOut')

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.25)
    expect(halfway?.sampleTime).toBeCloseTo(3.5)
    expect(halfway?.weight).toBeCloseTo(0.5)

    const complete = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.25)
    expect(complete?.montageTime).toBeCloseTo(2)
    expect(complete?.sampleTime).toBe(4)
    expect(complete?.status).toBe('completed')
  })

  it('starts StopSlotAnimation fading immediately from the current partial weight', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request())
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)

    const [stopping] = stopSlotAnimation(clock, 0.4, 'Transition')
    expect(stopping.weight).toBeCloseTo(0.5)
    expect(stopping.status).toBe('blendingOut')
    expect(stopping.blendOutReason).toBe('stopped')

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(halfway?.sampleTime).toBeCloseTo(0.4)
    expect(halfway?.weight).toBeCloseTo(0.25)

    const complete = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(complete?.status).toBe('completed')
    expect(complete?.weight).toBe(0)
  })

  it('completes an explicit zero-duration stop synchronously', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      blendInDuration: 0,
    }))

    const [completed] = stopSlotAnimation(clock, 0, 'Transition')

    expect(completed.sampleTime).toBe(0)
    expect(completed.weight).toBe(0)
    expect(completed.status).toBe('completed')
    expect(completed.blendOutReason).toBe('stopped')
    expect(getSlotMontageSample(clock, 'DefaultGroup')).toBeUndefined()
  })

  it('stops only the named slot, or every group when the name is omitted', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      blendInDuration: 0,
    }))
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'upper-body',
      slotName: 'UpperBody',
      groupName: 'UpperBodyGroup',
      blendInDuration: 0,
    }))

    expect(stopSlotAnimation(clock, 0.1, 'missing')).toEqual([])
    expect(stopSlotAnimation(clock, 0.1, 'Transition')).toHaveLength(1)
    expect(getSlotMontageSample(clock, 'DefaultGroup')?.status)
      .toBe('blendingOut')
    expect(getSlotMontageSample(clock, 'UpperBodyGroup')?.status)
      .toBe('playing')
    expect(stopSlotAnimation(clock, 0.1)).toHaveLength(2)
    expect(getSlotMontageSample(clock, 'UpperBodyGroup')?.status)
      .toBe('blendingOut')
  })

  it('keeps exactly one active owner per slot group and leaves other groups independent', () => {
    const clock = createSlotMontageClock()
    const outgoing = playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'outgoing',
    }))
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    const replacement = playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'replacement',
      slotName: 'TurnInPlaceStanding',
    }))
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'other-group',
      groupName: 'OtherGroup',
    }))

    expect(outgoing.clipKey).toBe('outgoing')
    expect(replacement.clipKey).toBe('replacement')
    expect(replacement.weight).toBe(0)
    expect(getSlotMontageSample(clock, 'DefaultGroup')).toBe(replacement)
    expect(clock.activeByGroup.size).toBe(2)
  })

  it('splits a large delta exactly at blend and end boundaries', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 1,
      blendInDuration: 0.4,
      blendOutDuration: 0.2,
    }))

    const crossed = advanceSlotMontageGroup(clock, 'DefaultGroup', 1.1)
    expect(crossed?.sampleTime).toBe(1)
    expect(crossed?.status).toBe('blendingOut')
    expect(crossed?.weight).toBeCloseTo(0.5)

    const completed = advanceSlotMontageGroup(clock, 'DefaultGroup', 10)
    expect(completed?.status).toBe('completed')
    expect(completed?.sampleTime).toBe(1)
  })

  it('handles zero blend durations and zero-length clips without a ghost owner', () => {
    const clock = createSlotMontageClock()
    const zeroClip = playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'empty',
      clipDuration: 0,
      blendInDuration: 0,
    }))
    expect(zeroClip.status).toBe('completed')
    expect(zeroClip.sampleTime).toBe(0)
    expect(zeroClip.weight).toBe(0)
    expect(clock.activeByGroup.size).toBe(0)

    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 1,
      blendInDuration: 0,
      blendOutDuration: 0,
    }))
    const completed = advanceSlotMontageGroup(clock, 'DefaultGroup', 1)
    expect(completed?.sampleTime).toBe(1)
    expect(completed?.status).toBe('completed')
    expect(clock.activeByGroup.size).toBe(0)
  })

  it('advances all groups into a retained output and ignores invalid frame deltas', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      blendInDuration: 0,
    }))
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'other',
      groupName: 'OtherGroup',
      blendInDuration: 0,
    }))
    const output: SlotMontageSample[] = []

    expect(advanceSlotMontageClock(clock, Number.NaN, output)).toBe(output)
    expect(output).toHaveLength(2)
    expect(output.map((sample) => sample.sampleTime)).toEqual([0, 0])
    advanceSlotMontageClock(clock, -1, output)
    expect(output.map((sample) => sample.sampleTime)).toEqual([0, 0])
  })

  it.each([
    { clipKey: '' },
    { slotName: '' },
    { groupName: '' },
    { clipDuration: -1 },
    { clipDuration: Number.NaN },
    { blendInDuration: -1 },
    { blendOutDuration: -1 },
    { playRate: 0 },
    { playRate: -1 },
    { loopCount: 0 },
    { loopCount: 1.5 },
    { blendOutTriggerTime: Number.POSITIVE_INFINITY },
    { startTime: -1 },
    { startTime: 3 },
  ])('rejects malformed request fields: $overrides', (overrides) => {
    expect(() => playSlotAnimationAsDynamicMontage(
      createSlotMontageClock(),
      request(overrides),
    )).toThrow()
  })
})
