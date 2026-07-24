import type { RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import type {
  AlsCameraMovementBase,
} from '../als/AlsCamera/AlsCameraComponent'
import type { AlsCharacter } from '../als/AlsCharacter'
import {
  AlsCameraShakeRequestQueue,
} from '../engine/alsCameraBridge'

export interface CharacterPoseSample {
  /** Stable pure-character state consumed by the camera animation instance. */
  character: AlsCharacter | null
  /** Physics owner excluded from ALS camera geometry queries. */
  ownerRigidBody: RapierRigidBody | null
  /**
   * Complete `FBasedMovementInfo` snapshot for UAlsCameraComponent. The character adapter must
   * publish it after movement/physics and before `ALS_FRAME_PRIORITY.Camera`; keep this null until
   * a supporting primitive, bone, world transform, and relative-rotation flag are all known.
   */
  movementBase: AlsCameraMovementBase | null
  /** Queued UAlsAnimNotify_CameraShake payloads awaiting the animation-notify crossing seam. */
  readonly cameraShakeRequests: AlsCameraShakeRequestQueue
  /** Grounded character anchor in world space (the root bone's frame). */
  ground: THREE.Vector3
  /** Animated pelvis position in world space. */
  pelvis: THREE.Vector3
  /** Animated head position in world space. */
  head: THREE.Vector3
  /** Animated head height above `ground`. */
  poseHeight: number
  /** View yaw relative to character facing, in ALS degrees. */
  viewYawAngle: number
  /** Absolute orbit yaw speed, in degrees per second. */
  viewYawSpeed: number
  /** Rendered character-root yaw, in radians. */
  characterYaw: number
  ready: boolean
}

export function createCharacterPoseSample(): CharacterPoseSample {
  return {
    character: null,
    ownerRigidBody: null,
    movementBase: null,
    cameraShakeRequests: new AlsCameraShakeRequestQueue(),
    ground: new THREE.Vector3(),
    pelvis: new THREE.Vector3(),
    head: new THREE.Vector3(),
    poseHeight: 0,
    viewYawAngle: 0,
    viewYawSpeed: 0,
    characterYaw: 0,
    ready: false,
  }
}
