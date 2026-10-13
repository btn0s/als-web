import { describe, expect, it } from 'vitest'
import {
  ALS_PISTOL_OVERLAY_OBJECT_URL,
  ALS_RIFLE_OVERLAY_OBJECT_URL,
  resolveOverlayObjectUrl,
} from './AlsCharacter.overlayObjects'

describe('resolveOverlayObjectUrl', () => {
  it('falls back to the ALS built-in props', () => {
    expect(resolveOverlayObjectUrl('pistol', undefined)).toBe(ALS_PISTOL_OVERLAY_OBJECT_URL)
    expect(resolveOverlayObjectUrl('rifle', {})).toBe(ALS_RIFLE_OVERLAY_OBJECT_URL)
  })

  it('prefers consumer-supplied assets per family', () => {
    const assets = { pistol: '/tso/pistol.glb' }
    expect(resolveOverlayObjectUrl('pistol', assets)).toBe('/tso/pistol.glb')
    expect(resolveOverlayObjectUrl('rifle', assets)).toBe(ALS_RIFLE_OVERLAY_OBJECT_URL)
  })
})
