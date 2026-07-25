import { describe, expect, it } from 'vitest'
import type { AlsOverlayMode } from '../../AnimGraph/overlayMode'
import {
  SelectNextOverlayMode,
  SelectPreviousOverlayMode,
} from './W_Als_OverlayModeMenu'

const OverlayModes: readonly AlsOverlayMode[] = [
  'Default',
  'Rifle',
]

describe('W_Als_OverlayModeMenu selection', () => {
  it('matches the authored inverted Next direction and wraps', () => {
    expect(SelectNextOverlayMode(OverlayModes, 'Rifle')).toBe(
      'Default',
    )
    expect(SelectNextOverlayMode(OverlayModes, 'Default')).toBe(
      'Rifle',
    )
  })

  it('matches the authored Previous direction and wraps', () => {
    expect(SelectPreviousOverlayMode(OverlayModes, 'Default')).toBe(
      'Rifle',
    )
    expect(SelectPreviousOverlayMode(OverlayModes, 'Rifle')).toBe(
      'Default',
    )
  })
})
