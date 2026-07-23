import * as THREE from 'three'

export interface CharacterPoseSample {
  /** Grounded character anchor in world space (the root bone's frame). */
  ground: THREE.Vector3
  /** Animated pelvis position in world space. */
  pelvis: THREE.Vector3
  /** Animated head position in world space. */
  head: THREE.Vector3
  /** Animated head height above `ground`. */
  poseHeight: number
  ready: boolean
}

export function createCharacterPoseSample(): CharacterPoseSample {
  return {
    ground: new THREE.Vector3(),
    pelvis: new THREE.Vector3(),
    head: new THREE.Vector3(),
    poseHeight: 0,
    ready: false,
  }
}
