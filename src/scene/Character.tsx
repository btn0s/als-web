import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { pickClip } from '../anim/pickClip'
import type { CharacterPoseSample } from './poseCameraState'
import { useLocomotionRig } from './useLocomotionRig'

const CHARACTER_URL = '/assets/skm-als.glb'
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46]

interface CharacterProps {
  onSizeChange: (size: THREE.Vector3) => void
  poseSample: MutableRefObject<CharacterPoseSample>
}

function isGlb(buffer: ArrayBuffer) {
  if (buffer.byteLength < 12) {
    return false
  }

  const header = new Uint8Array(buffer, 0, 4)
  return GLB_MAGIC.every((byte, index) => header[index] === byte)
}

function useCharacterGltf() {
  const [gltf, setGltf] = useState<GLTF>()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(CHARACTER_URL, { signal: controller.signal })
        const contentType = response.headers.get('content-type') ?? ''

        if (!response.ok || contentType.includes('text/html')) {
          return
        }

        const buffer = await response.arrayBuffer()
        if (!isGlb(buffer)) {
          return
        }

        const resourcePath = new URL('.', response.url).href
        const loadedGltf = await new GLTFLoader().parseAsync(buffer, resourcePath)
        if (!controller.signal.aborted) {
          setGltf(loadedGltf)
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.debug('[Character] GLB unavailable; using placeholder')
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [])

  return gltf
}

function Placeholder() {
  return (
    <mesh castShadow position={[0, 0.95, 0]}>
      <capsuleGeometry args={[0.35, 1.2, 8, 16]} />
      <meshStandardMaterial color="#c87842" roughness={0.72} />
    </mesh>
  )
}

function LoadedCharacter({
  gltf,
  onSizeChange,
  poseSample,
}: {
  gltf: GLTF
  onSizeChange: CharacterProps['onSizeChange']
  poseSample: CharacterProps['poseSample']
}) {
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf.scene])
  const characterGroup = useRef<THREE.Group>(null)
  const poseBones = useMemo(
    () => ({
      head: gltf.scene.getObjectByName('head') ?? gltf.scene.getObjectByName('Head'),
      pelvis: gltf.scene.getObjectByName('pelvis'),
    }),
    [gltf.scene],
  )
  const bounds = useMemo(() => {
    gltf.scene.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(gltf.scene, true)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    return {
      position: new THREE.Vector3(-center.x, -box.min.y, -center.z),
      size,
    }
  }, [gltf.scene])

  useLayoutEffect(() => {
    console.debug('[Character] bbox size', {
      x: bounds.size.x,
      y: bounds.size.y,
      z: bounds.size.z,
    })
    onSizeChange(bounds.size.clone())
  }, [bounds, onSizeChange])

  // Weight-table applier owns playback when the locomotion set is present (M1);
  // single-idle fallback keeps older single-clip GLBs (and the smoke) working.
  const rigComplete = useLocomotionRig(gltf, mixer)

  useEffect(() => {
    if (rigComplete) {
      return
    }
    const clip = pickClip(gltf.animations)
    if (!clip) {
      return
    }

    const action = mixer.clipAction(clip)
    action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play()

    return () => {
      action.stop()
      mixer.uncacheAction(clip, gltf.scene)
    }
  }, [gltf.animations, gltf.scene, mixer, rigComplete])

  useFrame((_, delta) => {
    mixer.update(delta)

    const group = characterGroup.current
    if (!group || !poseBones.head || !poseBones.pelvis) {
      poseSample.current.ready = false
      return
    }

    // Publish after the mixer has written this frame's skeleton. `getWorldPosition` refreshes the
    // ancestor chains, so ground, pelvis, and head all come from the same composed pose.
    group.getWorldPosition(poseSample.current.ground)
    poseBones.pelvis.getWorldPosition(poseSample.current.pelvis)
    poseBones.head.getWorldPosition(poseSample.current.head)
    poseSample.current.poseHeight = poseSample.current.head.y - poseSample.current.ground.y
    poseSample.current.ready =
      Number.isFinite(poseSample.current.poseHeight) && poseSample.current.poseHeight > 0
  })

  return (
    <group ref={characterGroup} position={bounds.position}>
      <primitive object={gltf.scene} />
    </group>
  )
}

export function Character({ onSizeChange, poseSample }: CharacterProps) {
  const gltf = useCharacterGltf()

  useEffect(() => {
    window.__characterStatus = gltf ? 'glb' : 'placeholder'
  }, [gltf])

  return gltf ? (
    <LoadedCharacter gltf={gltf} onSizeChange={onSizeChange} poseSample={poseSample} />
  ) : (
    <Placeholder />
  )
}
