import type { AlsOverlayMode } from '../als/AnimGraph/overlayMode'
import type {
  AlsGait,
  AlsRotationMode,
  AlsStance,
} from '../als/Settings/AlsMovementSettings'

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
    __setRotationMode?: (rotationMode: AlsRotationMode) => void
    __setOverlayMode?: (overlayMode: AlsOverlayMode) => void
    /** Enables/disables the animation-only speed/direction debug override. */
    __setMovementOverride?: (enabled: boolean) => void
    /** Enable the debug view-yaw override and set its relative angle. */
    __setViewYaw?: (viewYaw: number) => void
    /** Play a named source clip solo, or pass null to resume the ALS graph. */
    __playClip?: (name: string | null) => boolean
    /** Live read-only bridge diagnostics for browser verification. */
    __alsCharacterState?: {
      actorYawAngle: number
      desiredGait: AlsGait
      gait: AlsGait
      stance: AlsStance
      rotationMode: AlsRotationMode
      speed: number
      direction: number
      moving: boolean
      position: { x: number; y: number; z: number }
      velocity: { x: number; y: number; z: number }
    }
  }
}
