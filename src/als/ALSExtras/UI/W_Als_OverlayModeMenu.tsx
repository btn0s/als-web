import { useFrame, useThree } from '@react-three/fiber'
import type {
  MutableRefObject,
  RefObject,
} from 'react'
import * as THREE from 'three'
import type {
  AlsOverlayMode,
} from '../../AnimGraph/overlayMode'
import { ALS_FRAME_PRIORITY } from '../../../engine/alsFramePipeline'

export function SelectNextOverlayMode(
  OverlayModes: readonly AlsOverlayMode[],
  SelectedOverlayMode: AlsOverlayMode,
): AlsOverlayMode {
  const index = OverlayModes.indexOf(SelectedOverlayMode)
  if (index <= 0) {
    return OverlayModes.at(-1) ?? SelectedOverlayMode
  }
  return OverlayModes[index - 1]
}

export function SelectPreviousOverlayMode(
  OverlayModes: readonly AlsOverlayMode[],
  SelectedOverlayMode: AlsOverlayMode,
): AlsOverlayMode {
  const lastIndex = OverlayModes.length - 1
  const index = OverlayModes.indexOf(SelectedOverlayMode)
  if (index < 0 || index === lastIndex) {
    return OverlayModes[0] ?? SelectedOverlayMode
  }
  return OverlayModes[index + 1]
}

interface WAlsOverlayModeMenuProps {
  readonly Element: RefObject<HTMLDivElement | null>
  readonly OverlayModes: readonly AlsOverlayMode[]
  readonly SelectedOverlayMode: AlsOverlayMode
  readonly bVisible: boolean
}

/** Content/ALSExtras/UI/W_Als_OverlayModeMenu. */
export function W_Als_OverlayModeMenu({
  Element,
  OverlayModes,
  SelectedOverlayMode,
  bVisible,
}: WAlsOverlayModeMenuProps) {
  return (
    <div
      ref={Element}
      className={[
        'als-overlay-mode-menu',
        bVisible ? 'is-visible' : '',
      ].filter(Boolean).join(' ')}
      role="listbox"
      aria-label="Overlay mode"
      aria-hidden={!bVisible}
    >
      <div className="als-overlay-mode-menu__border">
        {OverlayModes.map((OverlayMode) => {
          const bSelected = OverlayMode === SelectedOverlayMode
          return (
            <div
              key={OverlayMode}
              className={[
                'als-overlay-mode-option',
                bSelected ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              role="option"
              aria-selected={bSelected}
            >
              {OverlayMode}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface OverlayModeMenuPose {
  readonly ground: THREE.Vector3
  readonly head: THREE.Vector3
  readonly ready: boolean
}

interface WAlsOverlayModeMenuAnchorProps {
  readonly Element: RefObject<HTMLDivElement | null>
  readonly Pose: MutableRefObject<OverlayModeMenuPose>
}

/**
 * W_Als_OverlayModeMenu::Tick(): project
 * `(RootBoneLocation + HeadBoneLocation) * 0.5 + FVector(0, 0, 100)`.
 */
export function W_Als_OverlayModeMenuAnchor({
  Element,
  Pose,
}: WAlsOverlayModeMenuAnchorProps) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const worldLocation = new THREE.Vector3()

  useFrame(() => {
    const element = Element.current
    const pose = Pose.current
    if (!element || !pose.ready) return

    worldLocation
      .copy(pose.ground)
      .add(pose.head)
      .multiplyScalar(0.5)
    // Unreal Z is Three Y; 100 cm is one metre.
    worldLocation.y += 1
    worldLocation.project(camera)

    element.style.setProperty(
      '--als-overlay-mode-menu-x',
      `${(worldLocation.x * 0.5 + 0.5) * size.width}px`,
    )
    element.style.setProperty(
      '--als-overlay-mode-menu-y',
      `${(-worldLocation.y * 0.5 + 0.5) * size.height}px`,
    )
  }, ALS_FRAME_PRIORITY.Diagnostics)

  return null
}
