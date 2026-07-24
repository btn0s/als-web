import type { AlsGait, AlsStance } from './player/locomotionProfile'
import type { AlsOverlayMode } from './player/overlayMode'

export {}

declare global {
  interface Window {
    __appReady: boolean
    __characterStatus: 'glb' | 'placeholder'
    /** Dev/test hook: last frame's applied clip, gait, and Layer* weights. */
    __weightTable?: Record<string, number>
    /** Debug speed override; positive values also enable Moving. */
    __setSpeed?: (speed: number) => void
    __setGait?: (gait: AlsGait) => void
    __setStance?: (stance: AlsStance) => void
    __setOverlayMode?: (overlayMode: AlsOverlayMode) => void
    /** Play a named source clip solo, or pass null to resume the ALS graph. */
    __playClip?: (name: string | null) => boolean
  }
}
