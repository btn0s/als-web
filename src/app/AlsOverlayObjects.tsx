import { useLayoutEffect, useMemo, useRef } from 'react'
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

export interface AlsOverlayObjectAssets {
  readonly pistol?: string
  readonly rifle?: string
}

export type AlsOverlayObjectMountHandler = (family: 'pistol' | 'rifle', object: Object3D | null, bone: Object3D | null) => void

interface OverlayObjectProps {
  characterScene: Object3D
  url?: string
  onMount?: AlsOverlayObjectMountHandler
  /** Snapshot-driven actors select visibility without a React render on every frame. */
  isVisible?: () => boolean
}

function OverlayObject({ characterScene, isVisible, url, onMount, family, attach }: OverlayObjectProps & {
  url: string
  family: 'pistol' | 'rifle'
  attach: typeof attachRifleOverlayObject
}) {
  // Props have no ALS animation extras. Keep their authored materials and clone per actor.
  const gltf = useGLTF(url)
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene])
  const mountHandler = useRef(onMount)
  mountHandler.current = onMount
  useLayoutEffect(() => {
    const bone = attach(characterScene, scene)
    scene.visible = isVisible?.() ?? true
    mountHandler.current?.(family, scene, bone)
    return () => {
      mountHandler.current?.(family, null, null)
      detachOverlayObject(scene)
    }
  }, [attach, characterScene, scene, isVisible, family])
  useFrame(() => {
    // The prop is a bone child, outside its React parent's visibility hierarchy. Change only
    // this prop: rifle and pistol share the same virtual bone and must not toggle each other.
    scene.visible = isVisible?.() ?? true
  }, ALS_FRAME_PRIORITY.PosePublication)
  return null
}

export function RifleOverlayObject(props: OverlayObjectProps) {
  return <OverlayObject {...props} url={props.url ?? ALS_RIFLE_OVERLAY_OBJECT_URL} family="rifle" attach={attachRifleOverlayObject} />
}

export function PistolOverlayObject(props: OverlayObjectProps) {
  return <OverlayObject {...props} url={props.url ?? ALS_PISTOL_OVERLAY_OBJECT_URL} family="pistol" attach={attachPistolOverlayObject} />
}
