import { useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Object3D } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import {
  ALS_PISTOL_OVERLAY_OBJECT_URL,
  ALS_RIFLE_OVERLAY_OBJECT_URL,
  attachPistolOverlayObject,
  attachRifleOverlayObject,
  detachOverlayObject,
} from '../als/AlsCharacter.overlayObjects'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'

interface OverlayObjectProps {
  characterScene: Object3D
  /** Snapshot-driven actors select visibility without a React render on every frame. */
  isVisible?: () => boolean
}

function OverlayObject({ characterScene, isVisible, url, attach }: OverlayObjectProps & {
  url: string
  attach: typeof attachRifleOverlayObject
}) {
  // Props have no ALS animation extras. Keep their authored materials and clone per actor.
  const gltf = useGLTF(url)
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene])
  useLayoutEffect(() => {
    attach(characterScene, scene)
    scene.visible = isVisible?.() ?? true
    return () => detachOverlayObject(scene)
  }, [attach, characterScene, scene, isVisible])
  useFrame(() => {
    // The prop is a bone child, outside its React parent's visibility hierarchy. Change only
    // this prop: rifle and pistol share the same virtual bone and must not toggle each other.
    scene.visible = isVisible?.() ?? true
  }, ALS_FRAME_PRIORITY.PosePublication)
  return null
}

export function RifleOverlayObject(props: OverlayObjectProps) {
  return <OverlayObject {...props} url={ALS_RIFLE_OVERLAY_OBJECT_URL} attach={attachRifleOverlayObject} />
}

export function PistolOverlayObject(props: OverlayObjectProps) {
  return <OverlayObject {...props} url={ALS_PISTOL_OVERLAY_OBJECT_URL} attach={attachPistolOverlayObject} />
}
