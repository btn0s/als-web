import type { AlsStance } from './AlsMovementSettings'

export type AlsTurnInPlaceDirection = 'Left' | 'Right'
export type AlsTurnInPlaceAngle = 90 | 180

export interface AlsTurnInPlaceClipSettings {
  readonly clip: string
  readonly playRate: number
  readonly scalePlayRateByAnimatedTurnAngle: boolean
  readonly animatedTurnAngle: number
}

export interface AlsGeneralTurnInPlaceSettings {
  readonly viewYawAngleThreshold: number
  readonly viewYawSpeedThreshold: number
  readonly viewYawAngleToActivationDelay: readonly [number, number]
  readonly turn180AngleThreshold: number
  readonly blendDuration: number
  readonly clips: Readonly<
    Record<AlsStance, Readonly<Record<AlsTurnInPlaceAngle, Readonly<Record<AlsTurnInPlaceDirection, AlsTurnInPlaceClipSettings>>>>>
  >
}

function clip(
  name: string,
  animatedTurnAngle: number,
): AlsTurnInPlaceClipSettings {
  return {
    clip: name,
    playRate: 1.2,
    scalePlayRateByAnimatedTurnAngle: true,
    animatedTurnAngle,
  }
}

/**
 * Defaults from AlsTurnInPlaceSettings.h. Sequence names are the corresponding ALS content assets
 * shipped in the curated GLB.
 */
export const ALS_TURN_IN_PLACE_SETTINGS: AlsGeneralTurnInPlaceSettings = {
  viewYawAngleThreshold: 45,
  viewYawSpeedThreshold: 50,
  viewYawAngleToActivationDelay: [0, 0.75],
  turn180AngleThreshold: 130,
  blendDuration: 0.2,
  clips: {
    Standing: {
      90: {
        Left: clip('A_Als_Turn_90_Left', 90),
        Right: clip('A_Als_Turn_90_Right', 90),
      },
      180: {
        Left: clip('A_Als_Turn_180_Left', 180),
        Right: clip('A_Als_Turn_180_Right', 180),
      },
    },
    Crouching: {
      90: {
        Left: clip('A_Als_Crouch_Turn_90_Left', 90),
        Right: clip('A_Als_Crouch_Turn_90_Right', 90),
      },
      180: {
        Left: clip('A_Als_Crouch_Turn_180_Left', 180),
        Right: clip('A_Als_Crouch_Turn_180_Right', 180),
      },
    },
  },
}

export interface AlsTurnInPlaceSelection {
  readonly stance: AlsStance
  readonly angle: AlsTurnInPlaceAngle
  readonly direction: AlsTurnInPlaceDirection
  readonly settings: AlsTurnInPlaceClipSettings
}

/** AlsRotation::RemapAngleForCounterClockwiseRotation; positive near-180 angles bias left. */
export function remapAngleForCounterClockwiseRotation(angle: number): number {
  return angle > 175 ? angle - 360 : angle
}

export function selectTurnInPlaceClip(
  stance: AlsStance,
  viewYawAngle: number,
  settings: AlsGeneralTurnInPlaceSettings = ALS_TURN_IN_PLACE_SETTINGS,
): AlsTurnInPlaceSelection {
  const angle: AlsTurnInPlaceAngle =
    Math.abs(viewYawAngle) < settings.turn180AngleThreshold ? 90 : 180
  const direction: AlsTurnInPlaceDirection =
    remapAngleForCounterClockwiseRotation(viewYawAngle) <= 0 ? 'Left' : 'Right'
  return {
    stance,
    angle,
    direction,
    settings: settings.clips[stance][angle][direction],
  }
}

export function calculateTurnInPlacePlayRate(
  queuedTurnYawAngle: number,
  settings: AlsTurnInPlaceClipSettings,
): number {
  if (!settings.scalePlayRateByAnimatedTurnAngle) return settings.playRate
  return settings.playRate
    * Math.abs(queuedTurnYawAngle / settings.animatedTurnAngle)
}
