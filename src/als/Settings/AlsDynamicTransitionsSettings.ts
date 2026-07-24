import type { AlsStance } from './AlsMovementSettings'

export type AlsDynamicTransitionDirection = 'Left' | 'Right'

export interface AlsDynamicTransitionsSettings {
  /** Runtime metres; FAlsDynamicTransitionsSettings stores 8 cm. */
  readonly footLockDistanceThreshold: number
  readonly blendDuration: number
  readonly playRate: number
  readonly sequences: Readonly<
    Record<
      AlsStance,
      Readonly<Record<AlsDynamicTransitionDirection, string>>
    >
  >
}

/** FAlsDynamicTransitionsSettings defaults plus AIS_Als_Default sequence references. */
export const ALS_DYNAMIC_TRANSITIONS_SETTINGS:
Readonly<AlsDynamicTransitionsSettings> = {
  footLockDistanceThreshold: 0.08,
  blendDuration: 0.2,
  playRate: 1.5,
  sequences: {
    Standing: {
      Left: 'A_Als_Stand_DynamicTransition_Left',
      Right: 'A_Als_Stand_DynamicTransition_Right',
    },
    Crouching: {
      Left: 'A_Als_Crouch_DynamicTransition_Left',
      Right: 'A_Als_Crouch_DynamicTransition_Right',
    },
  },
}
