import { describe, expect, it } from 'vitest'
import { sampleRichCurve } from '../../engine/richCurve'
import {
  ALS_DEFAULT_MANTLING_SETTINGS_BY_TYPE,
  ALS_GENERAL_MANTLING_SETTINGS,
  ALS_MANTLING_SETTINGS,
  selectAlsMantlingSettings,
} from './AlsMantlingSettings'

describe('ALS authored mantling settings', () => {
  it('compiles CS_Als_Default C++ defaults plus its grounded debug override', () => {
    expect(ALS_GENERAL_MANTLING_SETTINGS).toMatchObject({
      bAllowMantling: true,
      TraceAngleThreshold: 110,
      MaxReachAngle: 50,
      SlopeAngleThreshold: 35,
      TargetPrimitiveSpeedThreshold: 0.1,
      MantlingHighHeightThreshold: 1.25,
      MantlingTraceChannel: 'Visibility',
      MantlingTraceResponseChannels: [
        'WorldStatic',
        'WorldDynamic',
        'Destructible',
      ],
      BlendOutDuration: 0.3,
      bStartRagdollingOnTargetPrimitiveDestruction: true,
      GroundedTrace: {
        LedgeHeight: [0.5, 2.25],
        ReachDistance: 0.75,
        TargetLocationOffset: 0.15,
        StartLocationOffset: 0.55,
        bDrawFailedTraces: true,
      },
      InAirTrace: {
        LedgeHeight: [0.5, 1.5],
        ReachDistance: 0.7,
        TargetLocationOffset: 0.15,
        StartLocationOffset: 0.55,
        bDrawFailedTraces: false,
      },
    })
    expect(ALS_GENERAL_MANTLING_SETTINGS.SlopeAngleThresholdCos)
      .toBeCloseTo(Math.cos(35 * Math.PI / 180), 14)
  })

  it('follows B_Als_Character High/InAir and default Low graph links', () => {
    expect(ALS_DEFAULT_MANTLING_SETTINGS_BY_TYPE.High)
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_High)
    expect(ALS_DEFAULT_MANTLING_SETTINGS_BY_TYPE.InAir)
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_High)
    expect(ALS_DEFAULT_MANTLING_SETTINGS_BY_TYPE.Low)
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low)
  })

  it('follows every authored Low overlay branch and the default fallback', () => {
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.HandsTied'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_BothHands)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.Box'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_Box)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.Injured'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_Left)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.Bow'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_Left)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.Rifle'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_Right)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.PistolTwoHanded'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low_Right)
    expect(selectAlsMantlingSettings('Low', 'Als.OverlayMode.Default'))
      .toBe(ALS_MANTLING_SETTINGS.MS_Als_Low)
  })

  it('preserves authored start ranges, montage rate, segment, and notify clocks', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    expect(high.bAutoCalculateStartTime).toBe(false)
    expect(high.StartTimeReferenceHeight).toEqual([1.25, 2])
    expect(high.StartTime[0]).toBeCloseTo(0.6, 7)
    expect(high.StartTime[1]).toBe(0)
    expect(high.Montage).toMatchObject({
      Name: 'AM_Als_Mantle_High',
      Sequence: 'A_Als_Mantle_High',
      PlayLength: expect.closeTo(2.6666667, 6),
      SequenceLength: expect.closeTo(2.6666667, 6),
      SequenceRateScale: 1,
      RateScale: expect.closeTo(1.2, 6),
      SamplingFrameRate: 30,
      BlendIn: {
        BlendTime: expect.closeTo(0.2, 6),
        BlendOption: 'HermiteCubic',
      },
      BlendOut: {
        BlendTime: expect.closeTo(0.2, 6),
        BlendOption: 'Cubic',
      },
      SlotName: 'PostLocomotion',
      StartPos: 0,
      AnimStartTime: 0,
      AnimEndTime: expect.closeTo(2.6666667, 6),
      AnimPlayRate: 1,
      LoopingCount: 1,
    })
    expect(high.Montage.Notifies).toEqual([
      expect.objectContaining({
        NotifyName: 'BMNotifyStateMovementAction',
        StartTime: 0,
        Duration: expect.closeTo(2.0666666, 6),
        LocomotionAction: 'Als.LocomotionAction.Mantling',
      }),
      expect.objectContaining({
        NotifyName: 'BMNotifyStateEarlyBlendOut',
        StartTime: expect.closeTo(2.1333334, 6),
        Duration: expect.closeTo(0.5333333, 6),
        BlendOutDuration: 0.4,
        bCheckInput: true,
        bCheckLocomotionMode: true,
        bCheckRotationMode: true,
        bCheckStance: true,
        LocomotionModeEquals: 'Als.LocomotionMode.InAir',
        RotationModeEquals: 'Als.RotationMode.Aiming',
        StanceEquals: 'Als.Stance.Crouching',
      }),
    ])
    expect(high.Montage.BranchingPointMarkers).toEqual([
      {
        NotifyIndex: 0,
        TriggerTime: expect.closeTo(-0.0001, 8),
        NotifyEventType: 'Begin',
      },
      {
        NotifyIndex: 0,
        TriggerTime: expect.closeTo(2.0665665, 6),
        NotifyEventType: 'End',
      },
      {
        NotifyIndex: 1,
        TriggerTime: expect.closeTo(2.1333334, 6),
        NotifyEventType: 'Begin',
      },
      {
        NotifyIndex: 1,
        TriggerTime: expect.closeTo(2.6665668, 6),
        NotifyEventType: 'End',
      },
    ])

    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    expect(low.StartTimeReferenceHeight).toEqual([0.5, 1])
    expect(low.StartTime).toEqual([0.5, 0])
    expect(low.Montage).toMatchObject({
      Name: 'AM_Als_Mantle_Low',
      Sequence: 'A_Als_Mantle_Low_Right',
      PlayLength: 1.5,
      SequenceLength: 1.5,
      SequenceRateScale: 1,
      RateScale: 1,
      BlendOut: {
        BlendOption: 'HermiteCubic',
      },
      SlotName: 'PostLocomotion',
      StartPos: 0,
      AnimStartTime: 0,
      AnimEndTime: 1.5,
      AnimPlayRate: 1,
      LoopingCount: 1,
    })
    expect(low.Montage.Notifies[0].Duration).toBeCloseTo(0.96666664, 7)
    expect(low.Montage.Notifies[1]).toMatchObject({
      StartTime: 1,
      Duration: 0.5,
      BlendOutDuration: 0.35,
    })
    expect(low.Montage.BranchingPointMarkers[1]).toEqual({
      NotifyIndex: 0,
      TriggerTime: expect.closeTo(0.9665666, 7),
      NotifyEventType: 'End',
    })
  })

  it('samples all four unweighted correction curves at their authored boundaries', () => {
    const high = ALS_MANTLING_SETTINGS.MS_Als_High
    expect(sampleRichCurve(high.HorizontalCorrectionCurve.Keys, 0)).toBe(0)
    expect(sampleRichCurve(high.HorizontalCorrectionCurve.Keys, 0.3))
      .toBeCloseTo(1, 12)
    expect(sampleRichCurve(high.VerticalCorrectionCurve.Keys, 0.333)).toBe(0)
    expect(sampleRichCurve(high.VerticalCorrectionCurve.Keys, 0.7))
      .toBeCloseTo(1, 12)

    const low = ALS_MANTLING_SETTINGS.MS_Als_Low
    expect(sampleRichCurve(low.HorizontalCorrectionCurve.Keys, 0.1)).toBe(0)
    expect(sampleRichCurve(low.HorizontalCorrectionCurve.Keys, 0.4))
      .toBeCloseTo(1, 12)
    expect(sampleRichCurve(low.VerticalCorrectionCurve.Keys, 0.3)).toBe(0)
    expect(sampleRichCurve(low.VerticalCorrectionCurve.Keys, 0.6))
      .toBeCloseTo(1, 12)
  })
})
