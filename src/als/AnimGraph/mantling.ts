import { alphaToBlendOption } from '../../engine/alphaBlend'
import type {
  AlsMantlingMontage,
  AlsMantlingMontageNotify,
  AlsMantlingSettings,
} from '../Settings/AlsMantlingSettings'
import type { AlsLocomotionMode } from '../AlsCharacter'
import type {
  AlsRotationMode,
  AlsStance,
} from '../Settings/AlsMovementSettings'

export type AlsMantlingMontageStatus =
  | 'Playing'
  | 'BlendingOut'
  | 'Completed'

/**
 * The PostLocomotion montage and FAlsRootMotionSource_Mantling share this playhead.
 *
 * Character movement publishes the authoritative montage position produced by the root-motion
 * source. The animation graph samples that position; it never advances an independent mantle
 * clock.
 */
export interface AlsMantlingMontageState {
  readonly RequestId: number
  readonly MantlingSettings: AlsMantlingSettings
  MontagePosition: number
  PreviousMontagePosition: number
  ElapsedTime: number
  Weight: number
  Status: AlsMantlingMontageStatus
  BlendOutDuration: number
  BlendOutElapsedTime: number
  BlendOutStartWeight: number
  bMovementActionActive: boolean
  bMovementActionEndedThisFrame: boolean
  bStartedBlendOutThisFrame: boolean
  bCompletedThisFrame: boolean
}

export interface RefreshAlsMantlingMontageInput {
  readonly DeltaTime: number
  /** FAlsRootMotionSource_Mantling's Montage_SetPosition() value. */
  readonly AuthoritativeMontagePosition?: number
  readonly bHasInput: boolean
  readonly LocomotionMode: AlsLocomotionMode | null
  readonly RotationMode: AlsRotationMode
  readonly Stance: AlsStance
}

function notifyOfType(
  montage: AlsMantlingMontage,
  type: string,
): AlsMantlingMontageNotify {
  const notify = montage.Notifies.find(
    (candidate) => candidate.StateClassType === type,
  )
  if (!notify) throw new Error(`${montage.Name} is missing ${type}`)
  return notify
}

export function getAlsMantlingBranchingPointTime(
  montage: AlsMantlingMontage,
  notify: AlsMantlingMontageNotify,
  event: 'Begin' | 'End',
): number {
  const notifyIndex = montage.Notifies.indexOf(notify)
  const marker = montage.BranchingPointMarkers.find(
    (candidate) => (
      candidate.NotifyIndex === notifyIndex
      && candidate.NotifyEventType === event
    ),
  )
  if (!marker) {
    throw new Error(
      `${montage.Name} is missing the ${event} branching point for `
      + notify.NotifyName,
    )
  }
  return marker.TriggerTime
}

export function createAlsMantlingMontageState(
  RequestId: number,
  MantlingSettings: AlsMantlingSettings,
  MontageStartTime: number,
): AlsMantlingMontageState {
  const montage = MantlingSettings.Montage
  if (!(RequestId > 0) || !Number.isFinite(RequestId)) {
    throw new Error('ALS mantling montage RequestId must be positive')
  }
  if (!Number.isFinite(MontageStartTime)) {
    throw new Error('ALS mantling MontageStartTime must be finite')
  }
  const position = Math.max(
    0,
    Math.min(montage.PlayLength, MontageStartTime),
  )
  return {
    RequestId,
    MantlingSettings,
    MontagePosition: position,
    PreviousMontagePosition: position,
    ElapsedTime: 0,
    Weight: montage.BlendIn.BlendTime > 0 ? 0 : 1,
    Status: 'Playing',
    BlendOutDuration: 0,
    BlendOutElapsedTime: 0,
    BlendOutStartWeight: 0,
    // AAlsCharacter sets Mantling immediately after Montage_Play succeeds. The notify state begins
    // at montage zero, but it is not the sole start-side owner of the gameplay tag.
    bMovementActionActive: true,
    bMovementActionEndedThisFrame: false,
    bStartedBlendOutThisFrame: false,
    bCompletedThisFrame: false,
  }
}

export function stopAlsMantlingMontage(
  state: AlsMantlingMontageState,
  BlendOutDuration: number,
): AlsMantlingMontageState {
  if (state.Status !== 'Playing') return state
  if (!Number.isFinite(BlendOutDuration)) {
    throw new Error('ALS mantling BlendOutDuration must be finite')
  }
  state.Status = 'BlendingOut'
  state.BlendOutDuration = Math.max(0, BlendOutDuration)
  state.BlendOutElapsedTime = 0
  state.BlendOutStartWeight = state.Weight
  state.bStartedBlendOutThisFrame = true
  if (state.BlendOutDuration === 0) {
    state.Weight = 0
    state.Status = 'Completed'
    state.bCompletedThisFrame = true
  }
  return state
}

function crossedForward(
  previous: number,
  current: number,
  marker: number,
) {
  return previous < marker && current >= marker
}

function locomotionModeTag(value: AlsLocomotionMode | null) {
  return value === null ? null : `Als.LocomotionMode.${value}`
}

function rotationModeTag(value: AlsRotationMode) {
  return `Als.RotationMode.${value}`
}

function stanceTag(value: AlsStance) {
  return `Als.Stance.${value}`
}

function shouldEarlyBlendOut(
  notify: AlsMantlingMontageNotify,
  input: RefreshAlsMantlingMontageInput,
) {
  return (
    (notify.bCheckInput === true && input.bHasInput)
    || (
      notify.bCheckLocomotionMode === true
      && locomotionModeTag(input.LocomotionMode)
        === notify.LocomotionModeEquals
    )
    || (
      notify.bCheckRotationMode === true
      && rotationModeTag(input.RotationMode)
        === notify.RotationModeEquals
    )
    || (
      notify.bCheckStance === true
      && stanceTag(input.Stance) === notify.StanceEquals
    )
  )
}

/**
 * FAnimMontageInstance advancement plus ALS's two native branching-point notify states.
 *
 * The movement-action End marker clears `LocomotionAction` on its exact extracted trigger time.
 * `UAlsAnimNotifyState_EarlyBlendOut::BranchingPointNotifyTick()` may then stop only this montage
 * instance with its authored duration while the root-motion source remains on its fixed clock.
 */
export function refreshAlsMantlingMontage(
  state: AlsMantlingMontageState,
  input: RefreshAlsMantlingMontageInput,
): AlsMantlingMontageState {
  if (!Number.isFinite(input.DeltaTime)) {
    throw new Error('ALS mantling montage DeltaTime must be finite')
  }
  if (
    input.AuthoritativeMontagePosition !== undefined
    && !Number.isFinite(input.AuthoritativeMontagePosition)
  ) {
    throw new Error(
      'ALS mantling AuthoritativeMontagePosition must be finite',
    )
  }
  const deltaTime = Math.max(0, input.DeltaTime)
  state.bMovementActionEndedThisFrame = false
  state.bStartedBlendOutThisFrame = false
  state.bCompletedThisFrame = false
  if (state.Status === 'Completed') return state

  const montage = state.MantlingSettings.Montage
  const previousPosition = state.MontagePosition
  state.PreviousMontagePosition = previousPosition
  state.MontagePosition = Math.max(
    0,
    Math.min(
      montage.PlayLength,
      input.AuthoritativeMontagePosition
        ?? previousPosition + deltaTime * montage.RateScale,
    ),
  )
  state.ElapsedTime += deltaTime

  const movementAction = notifyOfType(
    montage,
    'AlsAnimNotifyState_SetLocomotionAction',
  )
  const movementActionEnd = getAlsMantlingBranchingPointTime(
    montage,
    movementAction,
    'End',
  )
  if (
    state.bMovementActionActive
    && (
      crossedForward(
        previousPosition,
        state.MontagePosition,
        movementActionEnd,
      )
      || previousPosition >= movementActionEnd
    )
  ) {
    state.bMovementActionActive = false
    state.bMovementActionEndedThisFrame = true
  }

  if (state.Status === 'Playing') {
    state.Weight = montage.BlendIn.BlendTime > 0
      ? alphaToBlendOption(
          state.ElapsedTime / montage.BlendIn.BlendTime,
          montage.BlendIn.BlendOption,
        )
      : 1

    const earlyBlendOut = notifyOfType(
      montage,
      'AlsAnimNotifyState_EarlyBlendOut',
    )
    const earlyBegin = getAlsMantlingBranchingPointTime(
      montage,
      earlyBlendOut,
      'Begin',
    )
    const earlyEnd = getAlsMantlingBranchingPointTime(
      montage,
      earlyBlendOut,
      'End',
    )
    if (
      state.MontagePosition >= earlyBegin
      && state.MontagePosition <= earlyEnd
      && shouldEarlyBlendOut(earlyBlendOut, input)
    ) {
      stopAlsMantlingMontage(
        state,
        earlyBlendOut.BlendOutDuration ?? 0.25,
      )
    } else if (state.MontagePosition >= montage.PlayLength) {
      stopAlsMantlingMontage(state, montage.BlendOut.BlendTime)
    }
  }

  // Stop() changes the blend target during this Advance. The new blend starts from the current
  // weight; elapsed blend-out time advances on the following update.
  if (state.Status === 'BlendingOut' && !state.bStartedBlendOutThisFrame) {
    state.BlendOutElapsedTime = Math.min(
      state.BlendOutDuration,
      state.BlendOutElapsedTime + deltaTime,
    )
    const alpha = state.BlendOutDuration > 0
      ? alphaToBlendOption(
          state.BlendOutElapsedTime / state.BlendOutDuration,
          montage.BlendOut.BlendOption,
        )
      : 1
    state.Weight = state.BlendOutStartWeight * (1 - alpha)
    if (state.BlendOutElapsedTime >= state.BlendOutDuration) {
      state.Weight = 0
      state.Status = 'Completed'
      state.bCompletedThisFrame = true
    }
  }
  return state
}
