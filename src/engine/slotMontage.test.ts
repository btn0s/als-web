import { describe, expect, it } from 'vitest'
import {
  advanceSlotMontageGroupSamples,
  advanceSlotMontageClock,
  advanceSlotMontageGroup,
  blendSlotCurveValue,
  canGatherSlotMontageSequenceNotifies,
  calculateSlotMontageWeight,
  convertSlotMontageTrackPositionToAnimPosition,
  createSlotMontageClock,
  getSlotMontageEvaluationWeight,
  getSlotMontageSample,
  getSlotMontageSamples,
  getSlotMontageSegmentEndPosition,
  montageSetPosition,
  playSlotMontage,
  playSlotAnimationAsDynamicMontage,
  stopSlotAnimation,
} from './slotMontage'
import type {
  AuthoredSlotMontageRequest,
  SlotMontageNotifyEvent,
  SlotMontageRequest,
  SlotMontageSample,
} from './slotMontage'

const UE_MONTAGE_END_OFFSET = 0.00005

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

function authoredRequest(
  overrides: Partial<AuthoredSlotMontageRequest> = {},
): AuthoredSlotMontageRequest {
  return {
    clipKey: 'A_Als_Mantle_Low_Right',
    clipDuration: 1.5,
    slotName: 'PostLocomotion',
    groupName: 'DefaultGroup',
    blendInDuration: 0.1,
    blendOutDuration: 0.3,
    blendInOption: 'HermiteCubic',
    blendOutOption: 'Cubic',
    playRate: 1,
    blendOutTriggerTime: 0,
    startTime: 0,
    bEnableRootMotion: false,
    montageDuration: 1.5,
    segment: {
      StartPos: 0,
      AnimStartTime: 0,
      AnimEndTime: 1.5,
      AnimPlayRate: 1,
      LoopingCount: 1,
      SequenceRateScale: 1,
    },
    ...overrides,
  }
}

describe('UE retained slot montage clock', () => {
  it('retains one instance ID per play and preserves same-clip insertion order', () => {
    const clock = createSlotMontageClock()
    const outgoing = playSlotAnimationAsDynamicMontage(clock, request())
    const outgoingInstanceId = outgoing.instanceId
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)

    const incoming = playSlotAnimationAsDynamicMontage(clock, request())
    const samples = getSlotMontageSamples(clock, 'DefaultGroup')

    expect(incoming.instanceId).toBe(outgoingInstanceId + 1)
    expect(incoming.instanceId).not.toBe(outgoing.instanceId)
    expect(samples.map(({ instanceId }) => instanceId)).toEqual([
      outgoing.instanceId,
      incoming.instanceId,
    ])

    const advanced: SlotMontageSample[] = []
    advanceSlotMontageGroupSamples(clock, 'DefaultGroup', 0.2, advanced)
    expect(advanced.map(({ instanceId }) => instanceId)).toEqual([
      outgoing.instanceId,
      incoming.instanceId,
    ])
    expect(outgoing.instanceId).toBe(outgoingInstanceId)
  })

  it('does not reset or recycle instance IDs across completion and clock creation', () => {
    const firstClock = createSlotMontageClock()
    const first = playSlotAnimationAsDynamicMontage(firstClock, request({
      blendInDuration: 0,
    }))
    const firstInstanceId = first.instanceId
    stopSlotAnimation(firstClock, 0)

    expect(first.status).toBe('completed')
    expect(first.instanceId).toBe(firstInstanceId)

    const secondClock = createSlotMontageClock()
    const rejectedEmpty = playSlotAnimationAsDynamicMontage(secondClock, request({
      clipDuration: 0,
    }))
    const replay = playSlotAnimationAsDynamicMontage(secondClock, request({
      blendInDuration: 0,
    }))

    expect(rejectedEmpty.instanceId).toBe(-1)
    expect(replay.instanceId).toBe(firstInstanceId + 1)
    expect(replay.clipKey).toBe(first.clipKey)
  })

  it('uses the same complementary alpha for present and absent montage curves', () => {
    expect(blendSlotCurveValue(1, -1, 0.25)).toBeCloseTo(0.5)
    expect(blendSlotCurveValue(1, undefined, 0.25)).toBeCloseTo(0.75)
    expect(blendSlotCurveValue(0, 100, 0.25)).toBeCloseTo(25)
    expect(blendSlotCurveValue(1, 100, -1)).toBe(1)
    expect(blendSlotCurveValue(1, 100, 2)).toBe(100)
  })

  it('keeps start time on the authored montage timeline and applies play rate while advancing', () => {
    const clock = createSlotMontageClock()
    const initial = playSlotAnimationAsDynamicMontage(clock, request({
      playRate: 2,
      startTime: 0.25,
    }))

    expect(initial.montageTime).toBeCloseTo(0.25)
    expect(initial.sampleTime).toBeCloseTo(0.25)
    expect(initial.weight).toBe(0)
    expect(initial.status).toBe('blendingIn')

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(halfway?.montageTime).toBeCloseTo(0.65)
    expect(halfway?.sampleTime).toBeCloseTo(0.65)
    expect(halfway?.weight).toBeCloseTo(0.5)

    const full = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(full?.montageTime).toBeCloseTo(1.05)
    expect(full?.sampleTime).toBeCloseTo(1.05)
    expect(full?.weight).toBe(1)
    expect(full?.status).toBe('playing')
  })

  it('maps authored FAnimSegment track time into sequence time and loops', () => {
    const segment = {
      StartPos: 2,
      AnimStartTime: 0.25,
      AnimEndTime: 1.25,
      AnimPlayRate: 2,
      LoopingCount: 2,
      SequenceRateScale: 0.5,
    } as const
    expect(getSlotMontageSegmentEndPosition(segment)).toBe(4)
    expect(convertSlotMontageTrackPositionToAnimPosition(segment, 2))
      .toBe(0.25)
    expect(convertSlotMontageTrackPositionToAnimPosition(segment, 2.5))
      .toBe(0.75)
    expect(convertSlotMontageTrackPositionToAnimPosition(segment, 3))
      .toBe(0.25)
    expect(convertSlotMontageTrackPositionToAnimPosition(segment, 4))
      .toBe(1.25)

    const clock = createSlotMontageClock()
    const authored = playSlotMontage(clock, authoredRequest({
      clipDuration: 1.5,
      montageDuration: 4,
      startTime: 2.5,
      segment,
    }))
    expect(authored.montageTime).toBe(2.5)
    expect(authored.sampleTime).toBe(0.75)

    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.5)
    expect(authored.montageTime).toBe(3)
    expect(authored.sampleTime).toBe(0.25)
  })

  it('advances from external Montage_SetPosition(M - delta) exactly to M', () => {
    const clock = createSlotMontageClock()
    const mantle = playSlotMontage(clock, authoredRequest())
    const targetMontageTime = 0.8
    const deltaTime = 0.1

    expect(montageSetPosition(
      clock,
      mantle.instanceId,
      targetMontageTime - deltaTime,
    )).toBe(mantle)
    expect(mantle.montageTime).toBeCloseTo(0.7, 12)
    expect(advanceSlotMontageGroup(
      clock,
      'DefaultGroup',
      deltaTime,
    )).toBe(mantle)
    expect(mantle.montageTime).toBeCloseTo(targetMontageTime, 12)
    expect(mantle.sampleTime).toBeCloseTo(targetMontageTime, 12)
    expect(mantle.bEnableRootMotion).toBe(false)
    expect(clock.rootMotionMontageInstance).toBeNull()
  })

  it('uses authored HermiteCubic blend-in and Cubic blend-out options', () => {
    const clock = createSlotMontageClock()
    const authored = playSlotMontage(clock, authoredRequest())

    expect(advanceSlotMontageGroup(clock, 'DefaultGroup', 0.025)?.weight)
      .toBeCloseTo(0.15625)
    advanceSlotMontageGroup(clock, 'DefaultGroup', 1.475)
    expect(authored.status).toBe('blendingOut')
    expect(authored.weight).toBe(1)
    expect(advanceSlotMontageGroup(clock, 'DefaultGroup', 0.075)?.weight)
      .toBeCloseTo(0.84375)
  })

  it('publishes the Roll source range at authored play-rate crossings', () => {
    const clock = createSlotMontageClock()
    const roll = playSlotMontage(clock, authoredRequest({
      clipKey: 'A_Als_Roll',
      clipDuration: 1.5,
      montageDuration: 1.5,
      playRate: 1.3,
      blendInDuration: 0.1,
      blendInOption: 'HermiteCubic',
      segment: {
        StartPos: 0,
        AnimStartTime: 0,
        AnimEndTime: 1.5,
        AnimPlayRate: 1,
        LoopingCount: 1,
        SequenceRateScale: 1,
      },
    }))

    advanceSlotMontageGroup(
      clock,
      'DefaultGroup',
      0.10000000894069672 / 1.3,
    )
    expect(roll.sourceNotifyPreviousTime).toBe(0)
    expect(roll.sourceNotifyCurrentTime)
      .toBeCloseTo(0.10000000894069672, 12)
    expect(roll.montageTime).toBeCloseTo(0.10000000894069672, 12)
    expect(canGatherSlotMontageSequenceNotifies(roll)).toBe(true)

    advanceSlotMontageGroup(
      clock,
      'DefaultGroup',
      (
        0.46666669845581055
        - 0.10000000894069672
      ) / 1.3,
    )
    expect(roll.sourceNotifyPreviousTime)
      .toBeCloseTo(0.10000000894069672, 12)
    expect(roll.sourceNotifyCurrentTime)
      .toBeCloseTo(0.46666669845581055, 12)
    expect(roll.montageTime).toBeCloseTo(0.46666669845581055, 12)
  })

  it('uses max(pre, post) NotifyWeight and suppresses interrupted sources', () => {
    const clock = createSlotMontageClock()
    const outgoing = playSlotMontage(clock, authoredRequest({
      clipKey: 'A_Als_Roll',
      blendInDuration: 0.4,
      blendInOption: 'HermiteCubic',
    }))

    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(outgoing.notifyPreviousWeight).toBe(0)
    expect(outgoing.weight).toBeCloseTo(0.5)
    expect(outgoing.notifyWeight).toBeCloseTo(0.5)

    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(outgoing.notifyPreviousWeight).toBeCloseTo(0.5)
    expect(outgoing.weight).toBe(1)
    expect(outgoing.notifyWeight).toBe(1)

    playSlotMontage(clock, authoredRequest({
      clipKey: 'replacement',
      blendInDuration: 0.4,
      blendInOption: 'HermiteCubic',
    }))
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.2)
    expect(outgoing.notifyPreviousWeight).toBe(1)
    expect(outgoing.weight).toBeCloseTo(0.5)
    expect(outgoing.notifyWeight).toBe(1)
    expect(outgoing.blendOutReason).toBe('interrupted')
    expect(canGatherSlotMontageSequenceNotifies(outgoing)).toBe(false)
  })

  it('keeps a stopped PostLocomotion source relevant for its prior-weight range', () => {
    const clock = createSlotMontageClock()
    const roll = playSlotMontage(clock, authoredRequest({
      clipKey: 'A_Als_Roll',
      blendInDuration: 0,
    }))
    stopSlotAnimation(clock, 0.1, 'PostLocomotion')

    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)

    expect(roll.notifyPreviousWeight).toBe(1)
    expect(roll.weight).toBe(0)
    expect(roll.notifyWeight).toBe(1)
    expect(roll.sourceNotifyPreviousTime).toBe(0)
    expect(roll.sourceNotifyCurrentTime).toBeCloseTo(0.1, 12)
    expect(roll.blendOutReason).toBe('stopped')
    expect(canGatherSlotMontageSequenceNotifies(roll)).toBe(true)
  })

  it('retains an interrupted instance but dispatches the new boundary marker once', () => {
    const clock = createSlotMontageClock()
    const outgoing = playSlotMontage(clock, authoredRequest({
      clipKey: 'outgoing',
      blendInDuration: 0,
      BranchingPointMarkers: [{
        NotifyIndex: 3,
        TriggerTime: 0.5,
        NotifyEventType: 'End',
      }],
    }))
    montageSetPosition(clock, outgoing.instanceId, 0.4)
    const incoming = playSlotMontage(clock, authoredRequest({
      clipKey: 'incoming',
      blendInDuration: 0.4,
      BranchingPointMarkers: [{
        NotifyIndex: 7,
        TriggerTime: 0.1,
        NotifyEventType: 'Begin',
      }],
    }))
    const events: SlotMontageNotifyEvent[] = []

    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1, events)
    expect(events.map((event) => ({
      instanceId: event.instanceId,
      clipKey: event.clipKey,
      marker: event.marker,
    }))).toEqual([{
      instanceId: incoming.instanceId,
      clipKey: 'incoming',
      marker: {
        NotifyIndex: 7,
        TriggerTime: 0.1,
        NotifyEventType: 'Begin',
      },
    }])
    expect(outgoing.instanceId).not.toBe(incoming.instanceId)
    expect(getSlotMontageSamples(clock, 'DefaultGroup').map(
      (sample) => sample.instanceId,
    )).toEqual([outgoing.instanceId, incoming.instanceId])
    expect(outgoing.montageTime).toBeCloseTo(0.5)
    expect(incoming.montageTime).toBeCloseTo(0.1)

    // Forward crossing is (PreviousPosition, Position], so the exact previous boundary does not
    // dispatch again on the next Advance.
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1, events)
    expect(events).toEqual([])
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
    expect(atEnd?.montageTime).toBeCloseTo(1)
    expect(atEnd?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
    expect(atEnd?.weight).toBe(1)
    expect(atEnd?.status).toBe('blendingOut')
    expect(atEnd?.blendOutReason).toBe('automatic')

    const fading = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(fading?.montageTime).toBeCloseTo(1)
    expect(fading?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
    expect(fading?.weight).toBeCloseTo(0.5)
    expect(fading?.status).toBe('blendingOut')

    const completed = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(completed?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
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

    const secondLoop = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.45)
    expect(secondLoop?.montageTime).toBeCloseTo(1)
    expect(secondLoop?.sampleTime).toBeCloseTo(0)
    expect(secondLoop?.status).toBe('playing')

    const terminal = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.5)
    expect(terminal?.montageTime).toBeCloseTo(2)
    expect(terminal?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
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
    expect(trigger?.montageTime).toBeCloseTo(3)
    expect(trigger?.sampleTime).toBeCloseTo(3)
    expect(trigger?.status).toBe('blendingOut')

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.25)
    expect(halfway?.montageTime).toBeCloseTo(3.5)
    expect(halfway?.sampleTime).toBeCloseTo(3.5)
    expect(halfway?.weight).toBeCloseTo(0.5)

    const complete = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.25)
    expect(complete?.montageTime).toBeCloseTo(4)
    expect(complete?.sampleTime).toBeCloseTo(4 - UE_MONTAGE_END_OFFSET, 8)
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
    // StopSlotAnimation(NAME_None) visits active montages, not instances already blending out.
    expect(stopSlotAnimation(clock, 0.1)).toHaveLength(1)
    expect(getSlotMontageSample(clock, 'UpperBodyGroup')?.status)
      .toBe('blendingOut')
  })

  it('keeps one active owner but evaluates the interrupted outgoing montage until its fade ends', () => {
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

    const initialSamples = getSlotMontageSamples(clock, 'DefaultGroup')
    expect(initialSamples).toHaveLength(2)
    expect(initialSamples.map(({ clipKey, weight, blendOutReason }) => ({
      clipKey,
      weight,
      blendOutReason,
    }))).toEqual([
      {
        clipKey: 'outgoing',
        weight: 0.5,
        blendOutReason: 'interrupted',
      },
      {
        clipKey: 'replacement',
        weight: 0,
        blendOutReason: null,
      },
    ])

    const advanced: SlotMontageSample[] = []
    advanceSlotMontageGroupSamples(clock, 'DefaultGroup', 0.2, advanced)
    expect(advanced.map(({ clipKey, weight }) => [clipKey, weight])).toEqual([
      ['outgoing', 0.25],
      ['replacement', 0.5],
    ])
    expect(calculateSlotMontageWeight(advanced)).toEqual({
      slotNodeWeight: 0.75,
      sourceWeight: 0.25,
      totalNodeWeight: 0.75,
    })
  })

  it('uses the incoming blend-in duration for a complementary full-weight replacement', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({ clipKey: 'outgoing' }))
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.4)
    playSlotAnimationAsDynamicMontage(clock, request({ clipKey: 'incoming' }))

    const samples: SlotMontageSample[] = []
    advanceSlotMontageGroupSamples(clock, 'DefaultGroup', 0.2, samples)

    expect(samples.map(({ clipKey, weight }) => [clipKey, weight])).toEqual([
      ['outgoing', 0.5],
      ['incoming', 0.5],
    ])
    expect(calculateSlotMontageWeight(samples)).toEqual({
      slotNodeWeight: 1,
      sourceWeight: 0,
      totalNodeWeight: 1,
    })
  })

  it('keeps a longer repeat stop envelope but restarts every older fade for a shorter one', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({ clipKey: 'a' }))
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.4)
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'b',
      blendInDuration: 0.4,
    }))
    advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)

    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'c',
      blendInDuration: 0.8,
    }))
    const longer: SlotMontageSample[] = []
    advanceSlotMontageGroupSamples(clock, 'DefaultGroup', 0.1, longer)
    expect(longer.map(({ clipKey, weight }) => [clipKey, weight])).toEqual([
      ['a', 0.5],
      ['b', 0.21875],
      ['c', 0.125],
    ])

    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'd',
      blendInDuration: 0.1,
    }))
    const shorter: SlotMontageSample[] = []
    advanceSlotMontageGroupSamples(clock, 'DefaultGroup', 0.05, shorter)
    expect(shorter.map(({ clipKey, weight }) => [clipKey, weight])).toEqual([
      ['a', 0.25],
      ['b', 0.109375],
      ['c', 0.0625],
      ['d', 0.5],
    ])
  })

  it('normalizes montage evaluation only when total slot weight exceeds one', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'first',
      blendInDuration: 0,
    }))
    playSlotAnimationAsDynamicMontage(clock, request({
      clipKey: 'second',
      blendInDuration: 1,
    }))
    const samples = getSlotMontageSamples(clock, 'DefaultGroup')
    samples[0].weight = 0.8
    samples[1].weight = 0.7

    const weights = calculateSlotMontageWeight(samples)
    expect(weights.slotNodeWeight).toBe(1)
    expect(weights.sourceWeight).toBeCloseTo(0)
    expect(weights.totalNodeWeight).toBeCloseTo(1.5)
    expect(getSlotMontageEvaluationWeight(samples[0], weights.totalNodeWeight))
      .toBeCloseTo(0.8 / 1.5)
    expect(getSlotMontageEvaluationWeight(samples[1], weights.totalNodeWeight))
      .toBeCloseTo(0.7 / 1.5)
  })

  it('clamps Montage_Play start position and supports zero and reverse instance rates', () => {
    const clampedClock = createSlotMontageClock()
    const clamped = playSlotAnimationAsDynamicMontage(clampedClock, request({
      startTime: 3,
    }))
    expect(clamped.montageTime).toBe(2)
    expect(clamped.sampleTime).toBe(2)

    const zeroClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(zeroClock, request({
      playRate: 0,
      startTime: -1,
    }))
    const zero = advanceSlotMontageGroup(zeroClock, 'DefaultGroup', 0.2)
    expect(zero?.montageTime).toBe(0)
    expect(zero?.sampleTime).toBe(0)
    expect(zero?.weight).toBeCloseTo(0.5)

    const reverseClock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(reverseClock, request({
      playRate: -2,
      startTime: 1,
    }))
    const reverse = advanceSlotMontageGroup(reverseClock, 'DefaultGroup', 0.25)
    expect(reverse?.montageTime).toBeCloseTo(0.5)
    expect(reverse?.sampleTime).toBeCloseTo(0.5)
  })

  it('updates weight before position and does not spend post-end overshoot on a new fade', () => {
    const clock = createSlotMontageClock()
    playSlotAnimationAsDynamicMontage(clock, request({
      clipDuration: 1,
      blendInDuration: 0.4,
      blendOutDuration: 0.2,
    }))

    const crossed = advanceSlotMontageGroup(clock, 'DefaultGroup', 1.1)
    expect(crossed?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
    expect(crossed?.status).toBe('blendingOut')
    expect(crossed?.weight).toBe(1)

    const halfway = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(halfway?.weight).toBeCloseTo(0.5)

    const completed = advanceSlotMontageGroup(clock, 'DefaultGroup', 0.1)
    expect(completed?.status).toBe('completed')
    expect(completed?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
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
    expect(completed?.sampleTime).toBeCloseTo(1 - UE_MONTAGE_END_OFFSET, 8)
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
    {
      blendInOption:
        'Unsupported' as SlotMontageRequest['blendInOption'],
    },
    {
      blendOutOption:
        'Unsupported' as SlotMontageRequest['blendOutOption'],
    },
    { playRate: Number.NaN },
    { loopCount: 0 },
    { loopCount: 1.5 },
    { blendOutTriggerTime: Number.POSITIVE_INFINITY },
    { startTime: Number.NEGATIVE_INFINITY },
  ])('rejects malformed request fields: $overrides', (overrides) => {
    expect(() => playSlotAnimationAsDynamicMontage(
      createSlotMontageClock(),
      request(overrides),
    )).toThrow()
  })
})
