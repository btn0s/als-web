import { describe, expect, it } from 'vitest'
import {
  overlayModeMenuWheelAction,
  shouldCancelOverlayModeMenuForPointerLock,
} from './B_Als_PlayerController.input'
import {
  ALS_OVERLAY_MODE_MENU_TIME_DILATION,
} from './B_Als_PlayerController'

describe('B_Als_PlayerController overlay-mode input', () => {
  it('uses the authored Q-menu global time dilation', () => {
    expect(ALS_OVERLAY_MODE_MENU_TIME_DILATION).toBe(0.35)
  })

  it('maps MouseScrollUp to Next and MouseScrollDown to Previous', () => {
    expect(overlayModeMenuWheelAction(-1)).toBe('Next')
    expect(overlayModeMenuWheelAction(1)).toBe('Previous')
    expect(overlayModeMenuWheelAction(0)).toBeNull()
  })

  it('cancels whenever the game canvas loses pointer-lock ownership', () => {
    const CanvasElement = {} as HTMLCanvasElement
    const OtherElement = {} as Element

    expect(shouldCancelOverlayModeMenuForPointerLock(
      CanvasElement,
      CanvasElement,
    )).toBe(false)
    expect(shouldCancelOverlayModeMenuForPointerLock(
      CanvasElement,
      null,
    )).toBe(true)
    expect(shouldCancelOverlayModeMenuForPointerLock(
      CanvasElement,
      OtherElement,
    )).toBe(true)
  })
})
