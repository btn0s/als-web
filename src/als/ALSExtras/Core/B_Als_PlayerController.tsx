import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import {
  ALS_OVERLAY_MODES,
} from '../../AnimGraph/overlayMode'
import type {
  AlsOverlayMode,
} from '../../AnimGraph/overlayMode'
import {
  overlayModeMenuWheelAction,
  shouldCancelOverlayModeMenuForPointerLock,
} from './B_Als_PlayerController.input'
import {
  SelectNextOverlayMode,
  SelectPreviousOverlayMode,
  W_Als_OverlayModeMenu,
} from '../UI/W_Als_OverlayModeMenu'

// B_Als_PlayerController's Q menu path. The separate IA_Als_Slomo path uses 0.15.
export const ALS_OVERLAY_MODE_MENU_TIME_DILATION = 0.35

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (
      target instanceof HTMLElement
      && target.isContentEditable
    )
}

interface BAlsPlayerControllerProps {
  readonly CanvasElement: HTMLCanvasElement | null
  readonly OverlayMode: AlsOverlayMode
  readonly OverlayModeMenuElement:
    RefObject<HTMLDivElement | null>
  readonly SetGlobalTimeDilation: (
    TimeDilation: number,
  ) => void
  readonly SetOverlayMode?: (
    OverlayMode: AlsOverlayMode,
  ) => void
}

/** Content/ALSExtras/Core/B_Als_PlayerController. */
export function B_Als_PlayerController({
  CanvasElement,
  OverlayMode,
  OverlayModeMenuElement,
  SetGlobalTimeDilation,
  SetOverlayMode,
}: BAlsPlayerControllerProps) {
  const [bOverlayModeMenuVisible, setOverlayModeMenuVisible] =
    useState(false)
  const [SelectedOverlayMode, setSelectedOverlayMode] =
    useState<AlsOverlayMode>(OverlayMode)
  const overlayMode = useRef(OverlayMode)
  const selectedOverlayMode = useRef(OverlayMode)
  const bMenuVisible = useRef(false)

  useEffect(() => {
    overlayMode.current = OverlayMode
    if (!bMenuVisible.current) {
      selectedOverlayMode.current = OverlayMode
      setSelectedOverlayMode(OverlayMode)
    }
  }, [OverlayMode])

  const closeOverlayModeMenu = useCallback((
    bApproveOverlayMode: boolean,
  ) => {
    if (!bMenuVisible.current) return

    bMenuVisible.current = false
    setOverlayModeMenuVisible(false)
    SetGlobalTimeDilation(1)
    if (bApproveOverlayMode) {
      SetOverlayMode?.(selectedOverlayMode.current)
    } else {
      selectedOverlayMode.current = overlayMode.current
      setSelectedOverlayMode(overlayMode.current)
    }
  }, [SetGlobalTimeDilation, SetOverlayMode])

  useEffect(() => {
    const openOverlayModeMenu = () => {
      if (bMenuVisible.current) return
      bMenuVisible.current = true
      selectedOverlayMode.current = overlayMode.current
      setSelectedOverlayMode(overlayMode.current)
      setOverlayModeMenuVisible(true)
      SetGlobalTimeDilation(
        ALS_OVERLAY_MODE_MENU_TIME_DILATION,
      )
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== 'KeyQ'
        || event.repeat
        || isTextEntryTarget(event.target)
      ) {
        return
      }
      event.preventDefault()
      openOverlayModeMenu()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'KeyQ' || !bMenuVisible.current) return
      event.preventDefault()
      closeOverlayModeMenu(true)
    }
    const onWheel = (event: WheelEvent) => {
      if (!bMenuVisible.current) return
      const action = overlayModeMenuWheelAction(event.deltaY)
      if (!action) return

      event.preventDefault()
      const nextOverlayMode = action === 'Next'
        ? SelectNextOverlayMode(
            ALS_OVERLAY_MODES,
            selectedOverlayMode.current,
          )
        : SelectPreviousOverlayMode(
            ALS_OVERLAY_MODES,
            selectedOverlayMode.current,
          )
      selectedOverlayMode.current = nextOverlayMode
      setSelectedOverlayMode(nextOverlayMode)
    }
    const cancelOverlayModeMenu = () => {
      closeOverlayModeMenu(false)
    }
    const onPointerLockChange = () => {
      if (shouldCancelOverlayModeMenuForPointerLock(
        CanvasElement,
        document.pointerLockElement,
      )) {
        cancelOverlayModeMenu()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', cancelOverlayModeMenu)
    document.addEventListener(
      'pointerlockchange',
      onPointerLockChange,
    )
    CanvasElement?.addEventListener(
      'wheel',
      onWheel,
      { passive: false },
    )
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', cancelOverlayModeMenu)
      document.removeEventListener(
        'pointerlockchange',
        onPointerLockChange,
      )
      CanvasElement?.removeEventListener('wheel', onWheel)
      if (bMenuVisible.current) {
        bMenuVisible.current = false
        SetGlobalTimeDilation(1)
      }
    }
  }, [
    CanvasElement,
    SetGlobalTimeDilation,
    closeOverlayModeMenu,
  ])

  return (
    <W_Als_OverlayModeMenu
      Element={OverlayModeMenuElement}
      OverlayModes={ALS_OVERLAY_MODES}
      SelectedOverlayMode={SelectedOverlayMode}
      bVisible={bOverlayModeMenuVisible}
    />
  )
}
