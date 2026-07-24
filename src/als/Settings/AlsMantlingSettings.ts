import mantlingContentSource
  from '../../../scripts/extract-als/mantling-content.json?raw'
import type { AlphaBlendOption } from '../../engine/alphaBlend'
import type {
  RichCurveInterpolation,
  RichCurveKey,
} from '../../engine/richCurve'

/*
 * UAlsMantlingSettings and FAlsGeneralMantlingSettings, compiled from the
 * editor-free content oracle. Runtime distances use metres; authored times,
 * angles, dimensionless values, and curve domains retain their ALS units.
 */

export type AlsMantlingType = 'High' | 'Low' | 'InAir'

export interface AlsMantlingTraceSettings {
  readonly LedgeHeight: readonly [number, number]
  readonly ReachDistance: number
  readonly TargetLocationOffset: number
  readonly StartLocationOffset: number
  readonly bDrawFailedTraces: boolean
}

export interface AlsGeneralMantlingSettings {
  readonly bAllowMantling: boolean
  readonly TraceAngleThreshold: number
  readonly MaxReachAngle: number
  readonly SlopeAngleThreshold: number
  readonly SlopeAngleThresholdCos: number
  readonly TargetPrimitiveSpeedThreshold: number
  readonly MantlingHighHeightThreshold: number
  readonly GroundedTrace: AlsMantlingTraceSettings
  readonly InAirTrace: AlsMantlingTraceSettings
  readonly MantlingTraceChannel: string
  readonly MantlingTraceResponseChannels: readonly string[]
  readonly BlendOutDuration: number
  readonly bStartRagdollingOnTargetPrimitiveDestruction: boolean
}

export interface AlsMantlingCurve {
  readonly Name: string
  readonly Keys: readonly RichCurveKey[]
}

export interface AlsMantlingMontageNotify {
  readonly NotifyName: string
  readonly StartTime: number
  readonly Duration: number
  readonly EndTime: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly MontageTickType: string
  readonly TrackIndex: number
  readonly StateClassName: string
  readonly StateClassType: string
  readonly LocomotionAction?: string
  readonly BlendOutDuration?: number
  readonly bCheckInput?: boolean
  readonly bCheckLocomotionMode?: boolean
  readonly bCheckRotationMode?: boolean
  readonly bCheckStance?: boolean
  readonly LocomotionModeEquals?: string
  readonly RotationModeEquals?: string
  readonly StanceEquals?: string
}

export interface AlsMantlingMontageBranchingPointMarker {
  readonly NotifyIndex: number
  readonly TriggerTime: number
  readonly NotifyEventType: 'Begin' | 'End'
}

export interface AlsMantlingMontage {
  readonly Name: string
  readonly Sequence: string
  /** UAnimMontage::GetPlayLength(). */
  readonly PlayLength: number
  /** Referenced UAnimSequence::GetPlayLength(). */
  readonly SequenceLength: number
  readonly SequenceRateScale: number
  readonly RateScale: number
  readonly SamplingFrameRate: number
  readonly BlendIn: {
    readonly BlendTime: number
    readonly BlendOption: AlphaBlendOption
  }
  readonly BlendOut: {
    readonly BlendTime: number
    readonly BlendOption: AlphaBlendOption
  }
  readonly BlendOutTriggerTime: number
  readonly SlotName: string
  readonly StartPos: number
  readonly AnimStartTime: number
  readonly AnimEndTime: number
  readonly AnimPlayRate: number
  readonly LoopingCount: number
  readonly Notifies: readonly AlsMantlingMontageNotify[]
  readonly BranchingPointMarkers:
    readonly AlsMantlingMontageBranchingPointMarker[]
}

export interface AlsMantlingSettings {
  readonly Name: string
  readonly Montage: AlsMantlingMontage
  readonly bAutoCalculateStartTime: boolean
  readonly StartTimeReferenceHeight: readonly [number, number]
  readonly StartTime: readonly [number, number]
  readonly HorizontalCorrectionCurve: AlsMantlingCurve
  readonly VerticalCorrectionCurve: AlsMantlingCurve
}

interface SerializedCurveKey {
  readonly InterpMode: string
  readonly TangentWeightMode: string
  readonly Time: number
  readonly Value: number
  readonly ArriveTangent: number
  readonly LeaveTangent: number
}

interface SerializedCurve {
  readonly keys: readonly SerializedCurveKey[]
}

interface SerializedNotify {
  readonly NotifyName: string
  readonly startTime: number
  readonly duration: number
  readonly endTime: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly MontageTickType: string
  readonly TrackIndex: number
  readonly stateClass: {
    readonly name: string
    readonly type: string
    readonly properties: {
      readonly LocomotionAction?: {
        readonly TagName: string
      }
      readonly BlendOutDuration?: number
      readonly bCheckInput?: boolean
      readonly bCheckLocomotionMode?: boolean
      readonly bCheckRotationMode?: boolean
      readonly bCheckStance?: boolean
      readonly LocomotionModeEquals?: {
        readonly TagName: string
      }
      readonly RotationModeEquals?: {
        readonly TagName: string
      }
      readonly StanceEquals?: {
        readonly TagName: string
      }
    }
  }
}

interface SerializedMontage {
  readonly SequenceLength: number
  readonly RateScale: number
  readonly SamplingFrameRate: {
    readonly Numerator: number
    readonly Denominator: number
  }
  readonly BlendIn: {
    readonly BlendTime: number
    readonly BlendOption: string
  }
  readonly BlendOut: {
    readonly BlendTime: number
    readonly BlendOption: string
  }
  readonly BlendOutTriggerTime: number
  readonly slot: {
    readonly SlotName: string
    readonly sequence: string
    readonly SequenceLength: number
    readonly SequenceRateScale: number
    readonly StartPos: number
    readonly AnimStartTime: number
    readonly AnimEndTime: number
    readonly AnimPlayRate: number
    readonly LoopingCount: number
  }
  readonly notifies: readonly SerializedNotify[]
  readonly branchingPointMarkers: readonly {
    readonly NotifyIndex: number
    readonly TriggerTime: number
    readonly NotifyEventType: 'Begin' | 'End'
  }[]
}

interface SerializedSettings {
  readonly Montage: string
  readonly bAutoCalculateStartTime: boolean
  readonly StartTimeReferenceHeight: readonly [number, number]
  readonly StartTime: readonly [number, number]
  readonly HorizontalCorrectionCurve: string
  readonly VerticalCorrectionCurve: string
}

interface SerializedGeneral {
  readonly bAllowMantling: boolean
  readonly TraceAngleThreshold: number
  readonly MaxReachAngle: number
  readonly SlopeAngleThreshold: number
  readonly SlopeAngleThresholdCos: number
  readonly TargetPrimitiveSpeedThreshold: number
  readonly MantlingHighHeightThreshold: number
  readonly GroundedTrace: {
    readonly LedgeHeight: readonly [number, number]
    readonly ReachDistance: number
    readonly TargetLocationOffset: number
    readonly StartLocationOffset: number
    readonly bDrawFailedTraces: boolean
  }
  readonly InAirTrace: {
    readonly LedgeHeight: readonly [number, number]
    readonly ReachDistance: number
    readonly TargetLocationOffset: number
    readonly StartLocationOffset: number
    readonly bDrawFailedTraces: boolean
  }
  readonly MantlingTraceChannel: string
  readonly MantlingTraceResponseChannels: readonly string[]
  readonly BlendOutDuration: number
  readonly bStartRagdollingOnTargetPrimitiveDestruction: boolean
}

interface SerializedMantlingContent {
  readonly general: SerializedGeneral
  readonly selection: {
    readonly High: string
    readonly Low: {
      readonly Default: string
      readonly [overlayMode: string]: string
    }
    readonly InAir: string
  }
  readonly settings: Readonly<Record<string, SerializedSettings>>
  readonly montages: Readonly<Record<string, SerializedMontage>>
  readonly curves: Readonly<Record<string, SerializedCurve>>
}

const CENTIMETRES_PER_METRE = 100
const mantlingContent = JSON.parse(
  mantlingContentSource,
) as SerializedMantlingContent

function compileInterpolation(value: string): RichCurveInterpolation {
  switch (value) {
    case 'RCIM_Constant':
      return 'constant'
    case 'RCIM_Linear':
      return 'linear'
    case 'RCIM_Cubic':
      return 'cubic'
    default:
      throw new Error(`Unsupported ALS rich-curve interpolation ${value}`)
  }
}

function compileBlendOption(value: string): AlphaBlendOption {
  switch (value) {
    case 'Linear':
    case 'Cubic':
    case 'HermiteCubic':
    case 'QuadraticInOut':
      return value
    default:
      throw new Error(`Unsupported ALS montage blend option ${value}`)
  }
}

function compileCurve(name: string): AlsMantlingCurve {
  const serialized = mantlingContent.curves[name]
  if (!serialized) throw new Error(`Missing ALS mantling curve ${name}`)
  return {
    Name: name,
    Keys: serialized.keys.map((key) => {
      if (key.TangentWeightMode !== 'RCTWM_WeightedNone') {
        throw new Error(`Unsupported weighted ALS mantling curve ${name}`)
      }
      return {
        time: key.Time,
        value: key.Value,
        interpolation: compileInterpolation(key.InterpMode),
        arriveTangent: key.ArriveTangent,
        leaveTangent: key.LeaveTangent,
      }
    }),
  }
}

function compileMontage(name: string): AlsMantlingMontage {
  const serialized = mantlingContent.montages[name]
  if (!serialized) throw new Error(`Missing ALS mantling montage ${name}`)
  const frameRate = (
    serialized.SamplingFrameRate.Numerator
    / serialized.SamplingFrameRate.Denominator
  )
  if (!(frameRate > 0) || !Number.isFinite(frameRate)) {
    throw new Error(`${name} has an invalid sampling frame rate`)
  }
  return {
    Name: name,
    Sequence: serialized.slot.sequence,
    PlayLength: serialized.SequenceLength,
    SequenceLength: serialized.slot.SequenceLength,
    SequenceRateScale: serialized.slot.SequenceRateScale,
    RateScale: serialized.RateScale,
    SamplingFrameRate: frameRate,
    BlendIn: {
      BlendTime: serialized.BlendIn.BlendTime,
      BlendOption: compileBlendOption(serialized.BlendIn.BlendOption),
    },
    BlendOut: {
      BlendTime: serialized.BlendOut.BlendTime,
      BlendOption: compileBlendOption(serialized.BlendOut.BlendOption),
    },
    BlendOutTriggerTime: serialized.BlendOutTriggerTime,
    SlotName: serialized.slot.SlotName,
    StartPos: serialized.slot.StartPos,
    AnimStartTime: serialized.slot.AnimStartTime,
    AnimEndTime: serialized.slot.AnimEndTime,
    AnimPlayRate: serialized.slot.AnimPlayRate,
    LoopingCount: serialized.slot.LoopingCount,
    Notifies: serialized.notifies.map((notify) => {
      const properties = notify.stateClass.properties
      const earlyBlendOut =
        notify.stateClass.type === 'AlsAnimNotifyState_EarlyBlendOut'
      return {
        NotifyName: notify.NotifyName,
        StartTime: notify.startTime,
        Duration: notify.duration,
        EndTime: notify.endTime,
        TriggerTimeOffset: notify.TriggerTimeOffset,
        EndTriggerTimeOffset: notify.EndTriggerTimeOffset,
        MontageTickType: notify.MontageTickType,
        TrackIndex: notify.TrackIndex,
        StateClassName: notify.stateClass.name,
        StateClassType: notify.stateClass.type,
        LocomotionAction: properties.LocomotionAction?.TagName,
        BlendOutDuration: properties.BlendOutDuration,
        // Effective UAlsAnimNotifyState_EarlyBlendOut values. Tagged uassets omit these
        // true/default-tag fields, so preserve the 4.15 class defaults at this data boundary.
        bCheckInput: earlyBlendOut
          ? properties.bCheckInput ?? true
          : undefined,
        bCheckLocomotionMode: earlyBlendOut
          ? properties.bCheckLocomotionMode ?? true
          : undefined,
        bCheckRotationMode: earlyBlendOut
          ? properties.bCheckRotationMode ?? true
          : undefined,
        bCheckStance: earlyBlendOut
          ? properties.bCheckStance ?? true
          : undefined,
        LocomotionModeEquals: earlyBlendOut
          ? properties.LocomotionModeEquals?.TagName
            ?? 'Als.LocomotionMode.InAir'
          : undefined,
        RotationModeEquals: earlyBlendOut
          ? properties.RotationModeEquals?.TagName
            ?? 'Als.RotationMode.Aiming'
          : undefined,
        StanceEquals: earlyBlendOut
          ? properties.StanceEquals?.TagName
            ?? 'Als.Stance.Crouching'
          : undefined,
      }
    }),
    BranchingPointMarkers: serialized.branchingPointMarkers.map(
      (marker) => ({ ...marker }),
    ),
  }
}

function compileTraceSettings(
  serialized: SerializedGeneral['GroundedTrace'],
): AlsMantlingTraceSettings {
  return {
    LedgeHeight: [
      serialized.LedgeHeight[0] / CENTIMETRES_PER_METRE,
      serialized.LedgeHeight[1] / CENTIMETRES_PER_METRE,
    ],
    ReachDistance: serialized.ReachDistance / CENTIMETRES_PER_METRE,
    TargetLocationOffset:
      serialized.TargetLocationOffset / CENTIMETRES_PER_METRE,
    StartLocationOffset:
      serialized.StartLocationOffset / CENTIMETRES_PER_METRE,
    bDrawFailedTraces: serialized.bDrawFailedTraces,
  }
}

function compileSettings(name: string): AlsMantlingSettings {
  const serialized = mantlingContent.settings[name]
  if (!serialized) throw new Error(`Missing ALS mantling settings ${name}`)
  return {
    Name: name,
    Montage: compileMontage(serialized.Montage),
    bAutoCalculateStartTime: serialized.bAutoCalculateStartTime,
    StartTimeReferenceHeight: [
      serialized.StartTimeReferenceHeight[0] / CENTIMETRES_PER_METRE,
      serialized.StartTimeReferenceHeight[1] / CENTIMETRES_PER_METRE,
    ],
    StartTime: [...serialized.StartTime],
    HorizontalCorrectionCurve:
      compileCurve(serialized.HorizontalCorrectionCurve),
    VerticalCorrectionCurve:
      compileCurve(serialized.VerticalCorrectionCurve),
  }
}

const general = mantlingContent.general

export const ALS_GENERAL_MANTLING_SETTINGS: AlsGeneralMantlingSettings = {
  bAllowMantling: general.bAllowMantling,
  TraceAngleThreshold: general.TraceAngleThreshold,
  MaxReachAngle: general.MaxReachAngle,
  SlopeAngleThreshold: general.SlopeAngleThreshold,
  SlopeAngleThresholdCos: general.SlopeAngleThresholdCos,
  TargetPrimitiveSpeedThreshold:
    general.TargetPrimitiveSpeedThreshold / CENTIMETRES_PER_METRE,
  MantlingHighHeightThreshold:
    general.MantlingHighHeightThreshold / CENTIMETRES_PER_METRE,
  GroundedTrace: compileTraceSettings(general.GroundedTrace),
  InAirTrace: compileTraceSettings(general.InAirTrace),
  MantlingTraceChannel: general.MantlingTraceChannel,
  MantlingTraceResponseChannels:
    [...general.MantlingTraceResponseChannels],
  BlendOutDuration: general.BlendOutDuration,
  bStartRagdollingOnTargetPrimitiveDestruction:
    general.bStartRagdollingOnTargetPrimitiveDestruction,
}

export const ALS_MANTLING_SETTINGS: Readonly<
  Record<
    | 'MS_Als_High'
    | 'MS_Als_Low'
    | 'MS_Als_Low_BothHands'
    | 'MS_Als_Low_Box'
    | 'MS_Als_Low_Left'
    | 'MS_Als_Low_Right',
    AlsMantlingSettings
  >
> = {
  MS_Als_High: compileSettings('MS_Als_High'),
  MS_Als_Low: compileSettings('MS_Als_Low'),
  MS_Als_Low_BothHands: compileSettings('MS_Als_Low_BothHands'),
  MS_Als_Low_Box: compileSettings('MS_Als_Low_Box'),
  MS_Als_Low_Left: compileSettings('MS_Als_Low_Left'),
  MS_Als_Low_Right: compileSettings('MS_Als_Low_Right'),
}

function selectedSettings(name: string): AlsMantlingSettings {
  if (!(name in ALS_MANTLING_SETTINGS)) {
    throw new Error(`Unsupported B_Als_Character mantling selection ${name}`)
  }
  return ALS_MANTLING_SETTINGS[
    name as keyof typeof ALS_MANTLING_SETTINGS
  ]
}

/**
 * Exact B_Als_Character `SelectMantlingSettings` graph. Overlay mode only
 * selects a branch for Low mantles; unlisted tags follow the Default pin.
 */
export function selectAlsMantlingSettings(
  MantlingType: AlsMantlingType,
  OverlayMode = 'Default',
): AlsMantlingSettings {
  if (MantlingType === 'High') {
    return selectedSettings(mantlingContent.selection.High)
  }
  if (MantlingType === 'InAir') {
    return selectedSettings(mantlingContent.selection.InAir)
  }
  return selectedSettings(
    mantlingContent.selection.Low[OverlayMode]
    ?? mantlingContent.selection.Low.Default,
  )
}

export const ALS_DEFAULT_MANTLING_SETTINGS_BY_TYPE: Readonly<
  Record<AlsMantlingType, AlsMantlingSettings>
> = {
  High: selectAlsMantlingSettings('High'),
  Low: selectAlsMantlingSettings('Low'),
  InAir: selectAlsMantlingSettings('InAir'),
}
