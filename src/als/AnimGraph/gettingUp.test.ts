import { describe, expect, it } from 'vitest'
import actionContent from '../../../scripts/extract-als/action-content.json'
import {
  advanceSlotMontageClock,
  createSlotMontageClock,
  playSlotMontage,
} from '../../engine/slotMontage'
import {
  ALS_GETTING_UP_MONTAGES,
  createAlsGettingUpSlotMontageRequest,
  selectAlsGettingUpMontage,
} from './gettingUp'

describe('ALS GettingUp authored montages', () => {
  it('pins both complete content records and orientation selection', () => {
    expect(selectAlsGettingUpMontage(false).Name)
      .toBe('AM_Als_GetUp_Front')
    expect(selectAlsGettingUpMontage(true).Name)
      .toBe('AM_Als_GetUp_Back')

    for (const montage of Object.values(ALS_GETTING_UP_MONTAGES)) {
      const oracle = actionContent.montages[montage.Name]
      expect(montage).toMatchObject({
        SequenceLength: 1.5,
        RateScale: 1.2000000476837158,
        BlendIn: {
          BlendTime: 0,
          BlendOption: 'Linear',
        },
        BlendOut: {
          BlendTime: 0.30000001192092896,
          BlendOption: 'Cubic',
        },
        BlendOutTriggerTime: -1,
        SlotName: 'PostLocomotion',
        GroupName: 'Locomotion',
        StartPos: 0,
        AnimStartTime: 0,
        AnimEndTime: 1.5,
        AnimPlayRate: 1,
        LoopingCount: 1,
        SequenceRateScale: 1,
        LocomotionActionNotifyIndex: 0,
      })
      expect(montage.BranchingPointMarkers)
        .toEqual(oracle.branchingPointMarkers)
      expect(actionContent.sequences[montage.Sequence].rootMotion)
        .toEqual({
          bEnableRootMotion: false,
          bForceRootLock: false,
          RootMotionRootLock: 'RefPose',
        })
    }
  })

  it('advances montage time at 1.2x while sampling the sequence 1:1', () => {
    const clock = createSlotMontageClock()
    const request = createAlsGettingUpSlotMontageRequest(true)
    const sample = playSlotMontage(clock, request)

    expect(sample.weight).toBe(1)
    advanceSlotMontageClock(clock, 0.5)
    expect(sample.montageTime).toBeCloseTo(
      0.5 * ALS_GETTING_UP_MONTAGES.Back.RateScale,
      12,
    )
    expect(sample.sampleTime).toBeCloseTo(sample.montageTime, 12)
    expect(sample.bEnableRootMotion).toBe(false)
  })

  it('dispatches the authored action end before retaining the cubic blend tail', () => {
    const clock = createSlotMontageClock()
    const montage = ALS_GETTING_UP_MONTAGES.Front
    const sample = playSlotMontage(
      clock,
      createAlsGettingUpSlotMontageRequest(false),
    )
    const events: Parameters<typeof advanceSlotMontageClock>[3] = []
    const actionEnd = montage.BranchingPointMarkers.find(
      ({ NotifyIndex, NotifyEventType }) =>
        NotifyIndex === montage.LocomotionActionNotifyIndex
        && NotifyEventType === 'End',
    )
    if (!actionEnd) throw new Error('Missing GettingUp action end')

    advanceSlotMontageClock(
      clock,
      actionEnd.TriggerTime / montage.RateScale + 1e-4,
      [],
      events,
    )
    expect(events).toContainEqual(expect.objectContaining({
      instanceId: sample.instanceId,
      marker: actionEnd,
    }))
    expect(sample.status).toBe('blendingOut')
    expect(sample.weight).toBeGreaterThan(0)

    advanceSlotMontageClock(clock, 0.4)
    expect(sample.status).toBe('completed')
  })
})
