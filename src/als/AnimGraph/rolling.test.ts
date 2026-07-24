import { describe, expect, it } from 'vitest'
import {
  ALS_ROLLING_MONTAGE,
  ALS_ROLL_SEQUENCE,
} from './rolling'

describe('AM_Als_Roll authored content', () => {
  it('pins the single PostLocomotion segment and exact montage clock', () => {
    expect(ALS_ROLLING_MONTAGE).toMatchObject({
      Name: 'AM_Als_Roll',
      Sequence: 'A_Als_Roll',
      PlayLength: 1.5,
      SequenceLength: 1.5,
      SequenceRateScale: 1,
      RateScale: 1,
      BlendIn: {
        BlendTime: 0.10000000149011612,
        BlendOption: 'HermiteCubic',
      },
      BlendOut: {
        BlendTime: 0.30000001192092896,
        BlendOption: 'HermiteCubic',
      },
      BlendOutTriggerTime: -1,
      SlotName: 'PostLocomotion',
      GroupName: 'Locomotion',
      StartPos: 0,
      AnimStartTime: 0,
      AnimEndTime: 1.5,
      AnimPlayRate: 1,
      LoopingCount: 1,
      LocomotionActionEndTime: 0.9334329962730408,
      GroundedEntryModeTime: 0.9333333373069763,
      RootMotionTranslationScale: 1.3,
    })
  })

  it('pins the native Rolling branching state independently from sequence events', () => {
    expect(ALS_ROLLING_MONTAGE.Notifies).toEqual([{
      NotifyName: 'BMNotifyStateMovementAction',
      StartTime: 0,
      Duration: 0.9333329796791077,
      EndTime: 0.9333329796791077,
      TriggerTimeOffset: 0.00009999999747378752,
      EndTriggerTimeOffset: 0,
      TriggerWeightThreshold: 0.000009999999747378752,
      StateClassType:
        'AlsAnimNotifyState_SetLocomotionAction',
      LocomotionAction: 'Rolling',
    }])
    expect(ALS_ROLLING_MONTAGE.BranchingPointMarkers).toEqual([
      {
        NotifyIndex: 0,
        TriggerTime: 0.00009999999747378752,
        NotifyEventType: 'Begin',
      },
      {
        NotifyIndex: 0,
        TriggerTime: 0.9334329962730408,
        NotifyEventType: 'End',
      },
    ])
  })

  it('pins RefPose root motion, its 1.3 state, and FromRoll time', () => {
    expect(ALS_ROLL_SEQUENCE).toEqual({
      Name: 'A_Als_Roll',
      SequenceLength: 1.5,
      RateScale: 1,
      rootMotion: {
        bEnableRootMotion: true,
        bForceRootLock: true,
        RootMotionRootLock: 'RefPose',
      },
      RootMotionScaleNotify: {
        NotifyName: 'AlsRootMotionScale',
        StartTime: 0,
        Duration: 1.5,
        EndTime: 1.5,
        TriggerTimeOffset: 0.00009999999747378752,
        EndTriggerTimeOffset: 0,
        TriggerWeightThreshold: 0.000009999999747378752,
        StateClassType:
          'AlsAnimNotifyState_SetRootMotionScale',
        TranslationScale: 1.3,
      },
      GroundedEntryModeNotify: {
        NotifyName: 'AlsSetGroundedEntryMode',
        Time: 0.9333333373069763,
        TriggerTimeOffset: 0,
        TriggerWeightThreshold: 0.000009999999747378752,
        NotifyClassType:
          'AlsAnimNotify_SetGroundedEntryMode',
        GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll',
      },
    })
  })
})
