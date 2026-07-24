import * as THREE from 'three'

/**
 * Mirrors B_Als_Character's Blueprint-owned RefreshOverlayObject / AttachOverlayObject behavior.
 * Its CDO selects the right gun virtual bone and SnapToTarget uses identity location, rotation,
 * and scale. The animation runtime materializes SK_Als's generated virtual bones because
 * AB_Als_Layering node 92 blends their local transforms independently of the physical IK bones.
 *
 * Evidence: scripts/extract-als/props.manifest (rifle entry).
 */
export const ALS_RIFLE_OVERLAY_OBJECT_URL = '/assets/skm-als-rifle.glb'
export const ALS_RIFLE_OVERLAY_OBJECT_BONE = 'VB hand_r_to_ik_hand_gun'

export function attachRifleOverlayObject(
  characterScene: THREE.Object3D,
  overlayObject: THREE.Object3D,
): THREE.Bone {
  const attachmentBone = characterScene.getObjectByName(ALS_RIFLE_OVERLAY_OBJECT_BONE)
  if (!(attachmentBone instanceof THREE.Bone)) {
    throw new Error(
      `ALS rifle attachment bone "${ALS_RIFLE_OVERLAY_OBJECT_BONE}" is missing`,
    )
  }

  attachmentBone.add(overlayObject)
  overlayObject.position.set(0, 0, 0)
  overlayObject.quaternion.identity()
  overlayObject.scale.set(1, 1, 1)
  overlayObject.visible = true
  return attachmentBone
}

export function detachOverlayObject(overlayObject: THREE.Object3D) {
  overlayObject.removeFromParent()
  overlayObject.visible = false
}
