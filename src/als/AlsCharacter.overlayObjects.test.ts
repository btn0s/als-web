import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ALS_RIFLE_OVERLAY_OBJECT_BONE,
  ALS_PISTOL_OVERLAY_OBJECT_BONE,
  attachPistolOverlayObject,
  attachRifleOverlayObject,
  detachOverlayObject,
} from './AlsCharacter.overlayObjects'

describe('AlsCharacter overlay objects', () => {
  it('snaps the rifle root to the authored right-gun virtual bone', () => {
    expect(ALS_RIFLE_OVERLAY_OBJECT_BONE)
      .toBe('VB hand_r_to_ik_hand_gun')

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

  it('snaps independent pistol instances to their own moving right-gun bones', () => {
    expect(ALS_PISTOL_OVERLAY_OBJECT_BONE).toBe(ALS_RIFLE_OVERLAY_OBJECT_BONE)
    const scenes = [new THREE.Group(), new THREE.Group()]
    const props = scenes.map((scene, index) => {
      const bone = new THREE.Bone()
      bone.name = ALS_PISTOL_OVERLAY_OBJECT_BONE
      bone.position.set(index, 2, 3)
      scene.add(bone)
      const prop = new THREE.Group()
      prop.position.set(5, 5, 5)
      prop.rotation.set(1, 1, 1)
      prop.scale.setScalar(2)
      attachPistolOverlayObject(scene, prop)
      expect(prop.position.toArray()).toEqual([0, 0, 0])
      expect(prop.quaternion.toArray()).toEqual([0, 0, 0, 1])
      expect(prop.scale.toArray()).toEqual([1, 1, 1])
      bone.position.y = 4
      expect(prop.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([index, 4, 3])
      return prop
    })
    expect(props[0].parent).not.toBe(props[1].parent)
    detachOverlayObject(props[0])
    expect(props[1].parent).not.toBeNull()
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
