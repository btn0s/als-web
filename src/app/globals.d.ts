import type { AlsOverlayMode } from '../als/AnimGraph/overlayMode'
import type {
  AlsLocomotionAction,
  AlsLocomotionMode,
  AlsViewMode,
} from '../als/AlsCharacter'
import type { AnimationFrameCaptureReport } from '../engine/animationFrameCapture'
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
    /** Queue ALS's authored Jump input for the next fixed character update. */
    __triggerJump?: () => void
    /**
     * Capture the current baseline plus subsequent evaluated animation frames. The report names
     * the largest per-bone delta on every edge and traces key bones in local and world space.
     */
    __captureAlsAnimationFrames?: (
      frameCount?: number,
    ) => Promise<AnimationFrameCaptureReport>
    /** Live read-only bridge diagnostics for browser verification. */
    __alsCharacterState?: {
      actorYawAngle: number
      desiredGait: AlsGait
      desiredStance: AlsStance
      gait: AlsGait
      stance: AlsStance
      rotationMode: AlsRotationMode
      locomotionMode: AlsLocomotionMode
      locomotionAction: AlsLocomotionAction
      speed: number
      direction: number
      moving: boolean
      capsuleBottomY: number
      capsuleHalfHeight: number
      meshBaseOffsetY: number
      position: { x: number; y: number; z: number }
      velocity: { x: number; y: number; z: number }
      verticalVelocity: number
      rootMotionSourceId: number
      rootMotionSourceStatus:
        | 'Active'
        | 'Finished'
        | 'MarkedForRemoval'
        | null
      rootMotionSourceTime: number | null
      activeMantlingTargetHandle: number | null
      movementBaseHandle: number | null
      bodyAnchor: { x: number; y: number; z: number }
      actorFeet: { x: number; y: number; z: number }
      floorCompensation: number
      movementModeLocked: boolean
      gravityScale: number
      networkSmoothingMode: 'Disabled' | 'Exponential'
      ragdollRequestedAfterMantlingTargetDestruction: boolean
    }
    __alsCameraState?: {
      activated: boolean
      pointerLocked: boolean
      rightShoulder: boolean
      viewMode: AlsViewMode
      firstPersonOverride: number
      traceDistanceRatio: number
      horizontalFieldOfView: number
      location: { x: number; y: number; z: number }
      rotation: { pitch: number; yaw: number; roll: number }
    }
    __setCameraRightShoulder?: (rightShoulder: boolean) => void
    __setCameraViewMode?: (viewMode: AlsViewMode) => void
    __setCameraViewRotation?: (pitch: number, yaw: number) => void
  }
}
