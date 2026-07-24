import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { AnimationFrameCapture } from '../engine/animationFrameCapture'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
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

function captureMetadata(frameControls: AlsAnimationInstanceControls) {
  return {
    ...window.__weightTable,
    gait: frameControls.gait,
    stance: frameControls.stance,
    rotationMode: frameControls.rotationMode,
    overlayMode: frameControls.overlayMode,
    moving: frameControls.moving,
    movingSmooth: frameControls.movingSmooth,
    speed: frameControls.speed,
    direction: frameControls.direction,
    viewYawAngle: frameControls.viewYawAngle,
    viewYawSpeed: frameControls.viewYawSpeed,
  }
}

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
  const frameCapture = useMemo(
    () => new AnimationFrameCapture(gltf.scene),
    [gltf.scene],
  )

  useEffect(() => {
    window.__playClip = animationInstance.playClip
    window.__captureAlsAnimationFrames = (frameCount) => {
      const report = frameCapture.start(frameCount)
      // The synchronous baseline is the last fully evaluated source pose. A caller can start the
      // capture and toggle a control in the same browser task without losing the transition edge.
      frameCapture.recordFrame(0, captureMetadata(controls.current))
      return report
    }
    return () => {
      delete window.__playClip
      delete window.__captureAlsAnimationFrames
      frameCapture.cancel()
      animationInstance.clearSoloClip()
    }
  }, [animationInstance, controls, frameCapture])

  useFrame((_, delta) => {
    const frameControls = controls.current
    const rotationYawSpeed = animationInstance.refresh(delta, frameControls)
    frameCapture.recordFrame(delta, captureMetadata(frameControls))
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
  }, ALS_FRAME_PRIORITY.Animation)
}
