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
