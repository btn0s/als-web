import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ALS_RIFLE_OVERLAY_OBJECT_BONE,
  attachRifleOverlayObject,
  detachOverlayObject,
} from './AlsCharacter.overlayObjects'

describe('AlsCharacter overlay objects', () => {
  it('snaps the rifle root to ik_hand_gun with an identity relative transform', () => {
    const characterScene = new THREE.Group()
    const attachmentBone = new THREE.Bone()
    attachmentBone.name = ALS_RIFLE_OVERLAY_OBJECT_BONE
    attachmentBone.position.set(1, 2, 3)
    characterScene.add(attachmentBone)

    const previousParent = new THREE.Group()
    const rifle = new THREE.Group()
    rifle.position.set(4, 5, 6)
    rifle.rotation.set(0.1, 0.2, 0.3)
    rifle.scale.set(2, 3, 4)
    rifle.visible = false
    previousParent.add(rifle)

    expect(attachRifleOverlayObject(characterScene, rifle)).toBe(attachmentBone)
    expect(rifle.parent).toBe(attachmentBone)
    expect(rifle.position.toArray()).toEqual([0, 0, 0])
    expect(rifle.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(rifle.scale.toArray()).toEqual([1, 1, 1])
    expect(rifle.visible).toBe(true)

    attachmentBone.position.set(7, 8, 9)
    expect(rifle.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([7, 8, 9])
  })

  it('detaches and hides the cached object', () => {
    const parent = new THREE.Bone()
    const rifle = new THREE.Group()
    parent.add(rifle)

    detachOverlayObject(rifle)

    expect(rifle.parent).toBeNull()
    expect(rifle.visible).toBe(false)
  })
})
