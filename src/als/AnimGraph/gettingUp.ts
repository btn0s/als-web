import actionContentSource
  from '../../../scripts/extract-als/action-content.json?raw'
import type { AlphaBlendOption } from '../../engine/alphaBlend'
import type {
  AuthoredSlotMontageRequest,
  SlotMontageBranchingPointMarker,
} from '../../engine/slotMontage'

type GettingUpMontageName =
  | 'AM_Als_GetUp_Front'
  | 'AM_Als_GetUp_Back'
type GettingUpSequenceName =
  | 'A_Als_GetUp_Front'
  | 'A_Als_GetUp_Back'

interface SerializedGettingUpMontage {
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
    readonly StartPos: number
    readonly AnimStartTime: number
    readonly AnimEndTime: number
    readonly AnimPlayRate: number
    readonly LoopingCount: number
    readonly sequence: GettingUpSequenceName
  }
  readonly notifies: readonly {
    readonly linkedClass: {
      readonly type: string
      readonly properties: {
        readonly LocomotionAction?: {
          readonly TagName?: string
        }
      }
    }
  }[]
  readonly branchingPointMarkers:
    readonly SlotMontageBranchingPointMarker[]
}

interface SerializedGettingUpSequence {
  readonly SequenceLength: number
  readonly RateScale: number
  readonly rootMotion: {
    readonly bEnableRootMotion: boolean
    readonly bForceRootLock: boolean
    readonly RootMotionRootLock: string
  }
}

interface SerializedActionContent {
  readonly schemaVersion: 1
  readonly settings: {
    readonly Ragdolling: {
      readonly GetUpFrontMontage: GettingUpMontageName
      readonly GetUpBackMontage: GettingUpMontageName
    }
  }
  readonly montages:
    Readonly<Record<GettingUpMontageName, SerializedGettingUpMontage>>
  readonly sequences:
    Readonly<Record<GettingUpSequenceName, SerializedGettingUpSequence>>
  readonly validations: readonly {
    readonly pass: boolean
  }[]
}

export interface AlsGettingUpMontage {
  readonly Name: GettingUpMontageName
  readonly Sequence: GettingUpSequenceName
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
  readonly SlotName: 'PostLocomotion'
  readonly GroupName: 'Locomotion'
  readonly StartPos: number
  readonly AnimStartTime: number
  readonly AnimEndTime: number
  readonly AnimPlayRate: number
  readonly LoopingCount: number
  readonly SequenceRateScale: number
  readonly BranchingPointMarkers:
    readonly SlotMontageBranchingPointMarker[]
  readonly LocomotionActionNotifyIndex: number
}

const content = JSON.parse(actionContentSource) as SerializedActionContent

function compileGettingUpMontage(
  Name: GettingUpMontageName,
): AlsGettingUpMontage {
  const montage = content.montages[Name]
  const sequence = content.sequences[montage.slot.sequence]
  const LocomotionActionNotifyIndex = montage.notifies.findIndex(
    ({ linkedClass }) =>
      linkedClass.type === 'AlsAnimNotifyState_SetLocomotionAction'
      && linkedClass.properties.LocomotionAction?.TagName
        === 'Als.LocomotionAction.GettingUp',
  )
  if (
    montage.slot.SlotName !== 'PostLocomotion'
    || montage.SequenceLength !== sequence.SequenceLength
    || sequence.rootMotion.bEnableRootMotion
    || sequence.rootMotion.bForceRootLock
    || sequence.rootMotion.RootMotionRootLock !== 'RefPose'
    || LocomotionActionNotifyIndex < 0
    || !montage.branchingPointMarkers.some(
      ({ NotifyIndex, NotifyEventType }) =>
        NotifyIndex === LocomotionActionNotifyIndex
        && NotifyEventType === 'End',
    )
  ) {
    throw new Error(`${Name} GettingUp content oracle is invalid`)
  }

  return Object.freeze({
    Name,
    Sequence: montage.slot.sequence,
    SequenceLength: montage.SequenceLength,
    RateScale: montage.RateScale,
    BlendIn: Object.freeze({ ...montage.BlendIn }),
    BlendOut: Object.freeze({ ...montage.BlendOut }),
    BlendOutTriggerTime: montage.BlendOutTriggerTime,
    SlotName: 'PostLocomotion' as const,
    GroupName: 'Locomotion' as const,
    StartPos: montage.slot.StartPos,
    AnimStartTime: montage.slot.AnimStartTime,
    AnimEndTime: montage.slot.AnimEndTime,
    AnimPlayRate: montage.slot.AnimPlayRate,
    LoopingCount: montage.slot.LoopingCount,
    SequenceRateScale: sequence.RateScale,
    BranchingPointMarkers: Object.freeze(
      montage.branchingPointMarkers.map((marker) =>
        Object.freeze({ ...marker })),
    ),
    LocomotionActionNotifyIndex,
  })
}

if (
  content.schemaVersion !== 1
  || content.validations.some(({ pass }) => !pass)
) {
  throw new Error('ALS GettingUp action content oracle is invalid')
}

export const ALS_GETTING_UP_MONTAGES = Object.freeze({
  Front: compileGettingUpMontage(
    content.settings.Ragdolling.GetUpFrontMontage,
  ),
  Back: compileGettingUpMontage(
    content.settings.Ragdolling.GetUpBackMontage,
  ),
})

export function selectAlsGettingUpMontage(
  bRagdollFacingUpward: boolean,
): AlsGettingUpMontage {
  return bRagdollFacingUpward
    ? ALS_GETTING_UP_MONTAGES.Back
    : ALS_GETTING_UP_MONTAGES.Front
}

export function createAlsGettingUpSlotMontageRequest(
  bRagdollFacingUpward: boolean,
  PlayRate = 1,
): AuthoredSlotMontageRequest {
  const montage = selectAlsGettingUpMontage(bRagdollFacingUpward)
  return {
    clipKey: montage.Sequence,
    clipDuration: montage.SequenceLength,
    montageDuration: montage.SequenceLength,
    slotName: montage.SlotName,
    groupName: montage.GroupName,
    blendInDuration: montage.BlendIn.BlendTime,
    blendInOption: montage.BlendIn.BlendOption,
    blendOutDuration: montage.BlendOut.BlendTime,
    blendOutOption: montage.BlendOut.BlendOption,
    playRate: PlayRate * montage.RateScale,
    blendOutTriggerTime: montage.BlendOutTriggerTime,
    startTime: montage.StartPos,
    bEnableRootMotion: false,
    segment: {
      StartPos: montage.StartPos,
      AnimStartTime: montage.AnimStartTime,
      AnimEndTime: montage.AnimEndTime,
      AnimPlayRate: montage.AnimPlayRate,
      LoopingCount: montage.LoopingCount,
      SequenceRateScale: montage.SequenceRateScale,
    },
    BranchingPointMarkers: montage.BranchingPointMarkers,
  }
}
