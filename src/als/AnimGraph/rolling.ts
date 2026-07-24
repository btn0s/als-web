import actionContentSource
  from '../../../scripts/extract-als/action-content.json?raw'
import type { AlphaBlendOption } from '../../engine/alphaBlend'
import type { RootMotionRootLock } from '../../engine/rootMotion'

export interface AlsRollMontageNotify {
  readonly NotifyName: string
  readonly StartTime: number
  readonly Duration: number
  readonly EndTime: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly TriggerWeightThreshold: number
  readonly StateClassType: 'AlsAnimNotifyState_SetLocomotionAction'
  readonly LocomotionAction: 'Rolling'
}

export interface AlsRollMontage {
  readonly Name: 'AM_Als_Roll'
  readonly Sequence: 'A_Als_Roll'
  readonly PlayLength: number
  readonly SequenceLength: number
  readonly SequenceRateScale: number
  readonly RateScale: number
  readonly BlendIn: {
    readonly BlendTime: number
    readonly BlendOption: AlphaBlendOption
  }
  readonly BlendOut: {
    readonly BlendTime: number
    readonly BlendOption: AlphaBlendOption
  }
  readonly BlendOutTriggerTime: number
  readonly SlotName: 'PostLocomotion'
  readonly GroupName: 'Locomotion'
  readonly StartPos: number
  readonly AnimStartTime: number
  readonly AnimEndTime: number
  readonly AnimPlayRate: number
  readonly LoopingCount: number
  readonly LocomotionActionEndTime: number
  readonly GroundedEntryModeTime: number
  readonly RootMotionTranslationScale: number
  readonly Notifies: readonly AlsRollMontageNotify[]
  readonly BranchingPointMarkers: readonly {
    readonly NotifyIndex: number
    readonly TriggerTime: number
    readonly NotifyEventType: 'Begin' | 'End'
  }[]
}

export interface AlsRollSequenceNotifyState {
  readonly NotifyName: 'AlsRootMotionScale'
  readonly StartTime: number
  readonly Duration: number
  readonly EndTime: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly TriggerWeightThreshold: number
  readonly StateClassType: 'AlsAnimNotifyState_SetRootMotionScale'
  readonly TranslationScale: number
}

export interface AlsRollSequenceGroundedEntryNotify {
  readonly NotifyName: 'AlsSetGroundedEntryMode'
  readonly Time: number
  readonly TriggerTimeOffset: number
  readonly TriggerWeightThreshold: number
  readonly NotifyClassType: 'AlsAnimNotify_SetGroundedEntryMode'
  readonly GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll'
}

export interface AlsRollSequence {
  readonly Name: 'A_Als_Roll'
  readonly SequenceLength: number
  readonly RateScale: number
  readonly rootMotion: {
    readonly bEnableRootMotion: true
    readonly bForceRootLock: true
    readonly RootMotionRootLock: RootMotionRootLock
  }
  readonly RootMotionScaleNotify: AlsRollSequenceNotifyState
  readonly GroundedEntryModeNotify:
    AlsRollSequenceGroundedEntryNotify
}

interface SerializedLinkedClass {
  readonly type: string
  readonly properties: {
    readonly LocomotionAction?: { readonly TagName: string }
    readonly TranslationScale?: number
    readonly GroundedEntryMode?: { readonly TagName: string }
  }
}

interface SerializedNotify {
  readonly NotifyName: string
  readonly startTime: number
  readonly duration: number
  readonly endTime: number
  readonly TriggerTimeOffset: number
  readonly EndTriggerTimeOffset: number
  readonly TriggerWeightThreshold: number
  readonly linkedClass: SerializedLinkedClass
}

interface SerializedActionContent {
  readonly schemaVersion: 1
  readonly montages: {
    readonly AM_Als_Roll: {
      readonly SequenceLength: number
      readonly RateScale: number
      readonly BlendIn: {
        readonly BlendTime: number
        readonly BlendOption: AlphaBlendOption
      }
      readonly BlendOut: {
        readonly BlendTime: number
        readonly BlendOption: AlphaBlendOption
      }
      readonly BlendOutTriggerTime: number
      readonly slot: {
        readonly SlotName: string
        readonly sequence: string
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
  }
  readonly sequences: {
    readonly A_Als_Roll: {
      readonly SequenceLength: number
      readonly RateScale: number
      readonly rootMotion: {
        readonly bEnableRootMotion: boolean
        readonly bForceRootLock: boolean
        readonly RootMotionRootLock: RootMotionRootLock
      }
      readonly notifies: readonly SerializedNotify[]
    }
  }
  readonly validations: readonly { readonly pass: boolean }[]
}

function findNotify(
  notifies: readonly SerializedNotify[],
  classType: string,
) {
  const matches = notifies.filter(
    ({ linkedClass }) => linkedClass.type === classType,
  )
  if (matches.length !== 1) {
    throw new Error(
      `ALS Roll content requires exactly one ${classType} notify`,
    )
  }
  return matches[0]
}

const content = JSON.parse(
  actionContentSource,
) as SerializedActionContent

if (
  content.schemaVersion !== 1
  || content.validations.some(({ pass }) => !pass)
) {
  throw new Error('ALS Roll action content oracle is invalid')
}

const montage = content.montages.AM_Als_Roll
const sequence = content.sequences.A_Als_Roll
const actionNotify = findNotify(
  montage.notifies,
  'AlsAnimNotifyState_SetLocomotionAction',
)
const rootMotionScaleNotify = findNotify(
  sequence.notifies,
  'AlsAnimNotifyState_SetRootMotionScale',
)
const groundedEntryModeNotify = findNotify(
  sequence.notifies,
  'AlsAnimNotify_SetGroundedEntryMode',
)
const actionEndMarker = montage.branchingPointMarkers.find(
  ({ NotifyEventType }) => NotifyEventType === 'End',
)

if (
  montage.slot.SlotName !== 'PostLocomotion'
  || montage.slot.sequence !== 'A_Als_Roll'
  || actionNotify.linkedClass.properties.LocomotionAction?.TagName
    !== 'Als.LocomotionAction.Rolling'
  || rootMotionScaleNotify.linkedClass.properties.TranslationScale
    === undefined
  || groundedEntryModeNotify.linkedClass.properties.GroundedEntryMode
    ?.TagName !== 'Als.GroundedEntryMode.FromRoll'
  || !sequence.rootMotion.bEnableRootMotion
  || !sequence.rootMotion.bForceRootLock
  || sequence.rootMotion.RootMotionRootLock !== 'RefPose'
  || !actionEndMarker
) {
  throw new Error('ALS Roll action content contract differs from 4.15')
}

export const ALS_ROLLING_MONTAGE: Readonly<AlsRollMontage> =
Object.freeze({
  Name: 'AM_Als_Roll',
  Sequence: 'A_Als_Roll',
  PlayLength: montage.SequenceLength,
  SequenceLength: sequence.SequenceLength,
  SequenceRateScale: sequence.RateScale,
  RateScale: montage.RateScale,
  BlendIn: Object.freeze({ ...montage.BlendIn }),
  BlendOut: Object.freeze({ ...montage.BlendOut }),
  BlendOutTriggerTime: montage.BlendOutTriggerTime,
  SlotName: 'PostLocomotion',
  GroupName: 'Locomotion',
  StartPos: montage.slot.StartPos,
  AnimStartTime: montage.slot.AnimStartTime,
  AnimEndTime: montage.slot.AnimEndTime,
  AnimPlayRate: montage.slot.AnimPlayRate,
  LoopingCount: montage.slot.LoopingCount,
  LocomotionActionEndTime: actionEndMarker.TriggerTime,
  GroundedEntryModeTime: groundedEntryModeNotify.startTime,
  RootMotionTranslationScale:
    rootMotionScaleNotify.linkedClass.properties.TranslationScale,
  Notifies: Object.freeze([Object.freeze({
    NotifyName: actionNotify.NotifyName,
    StartTime: actionNotify.startTime,
    Duration: actionNotify.duration,
    EndTime: actionNotify.endTime,
    TriggerTimeOffset: actionNotify.TriggerTimeOffset,
    EndTriggerTimeOffset: actionNotify.EndTriggerTimeOffset,
    TriggerWeightThreshold: actionNotify.TriggerWeightThreshold,
    StateClassType: 'AlsAnimNotifyState_SetLocomotionAction',
    LocomotionAction: 'Rolling',
  })]),
  BranchingPointMarkers: Object.freeze(
    montage.branchingPointMarkers.map(
      (marker) => Object.freeze({ ...marker }),
    ),
  ),
})

export const ALS_ROLL_SEQUENCE: Readonly<AlsRollSequence> =
Object.freeze({
  Name: 'A_Als_Roll',
  SequenceLength: sequence.SequenceLength,
  RateScale: sequence.RateScale,
  rootMotion: Object.freeze({
    bEnableRootMotion: true,
    bForceRootLock: true,
    RootMotionRootLock: sequence.rootMotion.RootMotionRootLock,
  }),
  RootMotionScaleNotify: Object.freeze({
    NotifyName: 'AlsRootMotionScale',
    StartTime: rootMotionScaleNotify.startTime,
    Duration: rootMotionScaleNotify.duration,
    EndTime: rootMotionScaleNotify.endTime,
    TriggerTimeOffset: rootMotionScaleNotify.TriggerTimeOffset,
    EndTriggerTimeOffset:
      rootMotionScaleNotify.EndTriggerTimeOffset,
    TriggerWeightThreshold:
      rootMotionScaleNotify.TriggerWeightThreshold,
    StateClassType: 'AlsAnimNotifyState_SetRootMotionScale',
    TranslationScale:
      rootMotionScaleNotify.linkedClass.properties.TranslationScale,
  }),
  GroundedEntryModeNotify: Object.freeze({
    NotifyName: 'AlsSetGroundedEntryMode',
    Time: groundedEntryModeNotify.startTime,
    TriggerTimeOffset: groundedEntryModeNotify.TriggerTimeOffset,
    TriggerWeightThreshold:
      groundedEntryModeNotify.TriggerWeightThreshold,
    NotifyClassType: 'AlsAnimNotify_SetGroundedEntryMode',
    GroundedEntryMode: 'Als.GroundedEntryMode.FromRoll',
  }),
})
