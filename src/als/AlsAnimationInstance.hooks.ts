import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { unrealYawDegreesToThreeRadians } from '../engine/unrealCoordinateSpace'
import {
  applyRotationYawSpeedAnimationCurve,
  setTargetYawAngle,
} from './AlsCharacter'
import type { AlsCharacter } from './AlsCharacter'
import {
  createAlsAnimationInstance,
} from './AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from './AlsAnimationInstance'

/**
 * Thin React binding for the framework-free AlsAnimationInstance frame brain. Character policy
 * and physics own the controls; this hook owns pose evaluation and applies authored
 * RotationYawSpeed only through AAlsCharacter's stopped-grounded seam.
 */
export function useAlsAnimationInstance(
  gltf: {
    animations: THREE.AnimationClip[]
    scene: THREE.Object3D
  },
  characterRoot: MutableRefObject<THREE.Group | null>,
  controls: MutableRefObject<AlsAnimationInstanceControls>,
  character: MutableRefObject<AlsCharacter>,
) {
  const animationInstance = useMemo(
    () => createAlsAnimationInstance(gltf),
    [gltf],
  )

  useEffect(() => {
    window.__playClip = animationInstance.playClip
    return () => {
      delete window.__playClip
      animationInstance.clearSoloClip()
    }
  }, [animationInstance])

  useFrame((_, delta) => {
    const frameControls = controls.current
    const rotationYawSpeed = animationInstance.refresh(delta, frameControls)
    const root = characterRoot.current
    const current = character.current
    if (
      root
      && current.locomotionMode === 'Grounded'
      && !frameControls.moving
      && rotationYawSpeed !== 0
    ) {
      current.actorYawAngle = applyRotationYawSpeedAnimationCurve(
        current.actorYawAngle,
        rotationYawSpeed,
        delta,
      )
      setTargetYawAngle(current, current.actorYawAngle)
      root.rotation.y = unrealYawDegreesToThreeRadians(
        current.actorYawAngle,
      )
    }
  })
}
