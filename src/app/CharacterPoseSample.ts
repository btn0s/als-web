import type { RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import type { AlsCharacter } from '../als/AlsCharacter'

export interface CharacterPoseSample {
  /** Stable pure-character state consumed by the camera animation instance. */
  character: AlsCharacter | null
  /** Physics owner excluded from ALS camera geometry queries. */
  ownerRigidBody: RapierRigidBody | null
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
