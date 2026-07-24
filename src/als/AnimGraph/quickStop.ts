import type {
  AlsRotationMode,
  AlsStance,
} from '../Settings/AlsMovementSettings'
import { remapAngleForCounterClockwiseRotation } from '../Settings/AlsTurnInPlaceSettings'
import { unwindDegrees } from '../State/AlsLocomotionState'

export type AlsQuickStopDirection = 'Left' | 'Right'

export interface AlsQuickStopSettings {
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: readonly [number, number]
  readonly startTime: number
  readonly sequences: Readonly<
    Record<AlsStance, Readonly<Record<AlsQuickStopDirection, string>>>
  >
}

/**
 * FAlsTransitionsSettings defaults plus AIS_Als_Default's sequence references.
 *
 * These are the transition-montage sequences selected by PlayTransitionLeftAnimation() and
 * PlayTransitionRightAnimation(), not the A_Als_Stop_Left/Right players owned by the grounded
 * locomotion state machine.
 */
export const ALS_QUICK_STOP_SETTINGS: AlsQuickStopSettings = {
  blendInDuration: 0.1,
  blendOutDuration: 0.2,
  playRate: [1.75, 3],
  startTime: 0.3,
  sequences: {
    Standing: {
      Left: 'A_Als_Stand_Transition_Left',
      Right: 'A_Als_Stand_Transition_Right',
    },
    Crouching: {
      Left: 'A_Als_Crouch_Transition_Left',
      Right: 'A_Als_Crouch_Transition_Right',
    },
  },
}

export interface AlsQuickStopAnimationInput {
  readonly rotationMode: AlsRotationMode
  readonly stance: AlsStance
  readonly hasInput: boolean
  readonly inputYawAngle: number
  readonly targetYawAngle: number
  readonly actorYawAngle: number
}

/**
 * Framework-free equivalent of the values queued by PlayTransitionAnimation(). A montage/slot
 * owner may consume this record without reimplementing the source's selection or timing math.
 */
export interface AlsQuickStopAnimationRequest {
  readonly direction: AlsQuickStopDirection
  readonly clip: string
  readonly blendInDuration: number
  readonly blendOutDuration: number
  readonly playRate: number
  readonly startTime: number
}

/**
 * UAlsAnimationInstance::PlayQuickStopAnimation(), ALS Refactored 4.15 lines 1378-1414.
 *
 * FMath::Lerp() is intentionally not clamped. The counter-clockwise remap maps yaw angles just
 * above +175 degrees below -180, so the resulting play rate can slightly exceed playRate[1].
 */
export function playQuickStopAnimation(
  input: AlsQuickStopAnimationInput,
  settings: AlsQuickStopSettings = ALS_QUICK_STOP_SETTINGS,
): AlsQuickStopAnimationRequest {
  let direction: AlsQuickStopDirection = 'Left'
  let playRate = settings.playRate[0]

  if (input.rotationMode === 'VelocityDirection') {
    const targetYawAngle = input.hasInput
      ? input.inputYawAngle
      : input.targetYawAngle
    const remainingYawAngle = remapAngleForCounterClockwiseRotation(
      unwindDegrees(targetYawAngle - input.actorYawAngle),
    )

    direction = remainingYawAngle <= 0 ? 'Left' : 'Right'
    const ratio = Math.abs(remainingYawAngle) / 180
    playRate = (
      settings.playRate[0]
      + (settings.playRate[1] - settings.playRate[0]) * ratio
    )
  }

  return {
    direction,
    clip: settings.sequences[input.stance][direction],
    blendInDuration: settings.blendInDuration,
    blendOutDuration: settings.blendOutDuration,
    playRate,
    startTime: settings.startTime,
  }
}
