export type OverlayModeMenuWheelAction =
  | 'Next'
  | 'Previous'
  | null

export function overlayModeMenuWheelAction(
  deltaY: number,
): OverlayModeMenuWheelAction {
  if (deltaY < 0) return 'Next'
  if (deltaY > 0) return 'Previous'
  return null
}

export function shouldCancelOverlayModeMenuForPointerLock(
  CanvasElement: HTMLCanvasElement | null,
  PointerLockElement: Element | null,
): boolean {
  return PointerLockElement !== CanvasElement
}

export interface AlsGamepadLookInput {
  readonly gamepad: Gamepad
  readonly yaw: number
  readonly pitch: number
  readonly yawDelta: number
  readonly pitchDelta: number
  readonly deltaTime: number
}
export interface AlsGamepadLookDelta {
  yawDelta: number
  pitchDelta: number
}

/** Consumer extension applied after the authored deadzone/rate and before control rotation. */
export function modifyAlsGamepadLook(
  gamepad: Gamepad | null,
  input: Omit<AlsGamepadLookInput, 'gamepad'>,
  modifier?: (input: AlsGamepadLookInput) => AlsGamepadLookDelta,
): AlsGamepadLookDelta {
  const modified = gamepad && modifier ? modifier({ ...input, gamepad }) : null
  return {
    yawDelta: modified && Number.isFinite(modified.yawDelta) ? modified.yawDelta : input.yawDelta,
    pitchDelta: modified && Number.isFinite(modified.pitchDelta) ? modified.pitchDelta : input.pitchDelta,
  }
}
