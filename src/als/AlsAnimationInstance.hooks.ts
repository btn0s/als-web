import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { AnimationFrameCapture } from '../engine/animationFrameCapture'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import type { AlsCharacter } from './AlsCharacter'
import type {
  AlsCharacterAnimationCurves,
} from './AlsCharacter.hooks'
import type {
  AlsGroundPredictionCapsuleSweep,
} from './State/AlsInAirState'
import type {
  AlsControlRigFootOffsetTrace,
} from './AnimGraph/CR_Als'
import {
  createAlsAnimationInstance,
} from './AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from './AlsAnimationInstance'
import {
  ROTATION_YAW_OFFSET_CURVE_NAME,
  ROTATION_YAW_SPEED_CURVE_NAME,
} from './Utility/AlsConstants'

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
    locomotionMode: frameControls.locomotionMode === undefined
      ? 'Grounded'
      : frameControls.locomotionMode ?? 'Invalid',
    hasInput: frameControls.hasInput ?? false,
  }
}

/**
 * Thin React binding for the framework-free AlsAnimationInstance frame brain. Character policy
 * and physics own the controls; this hook owns pose evaluation and publishes the resulting curves
 * for the following AAlsCharacter::Tick().
 */
export function useAlsAnimationInstance(
  gltf: {
    animations: THREE.AnimationClip[]
    scene: THREE.Object3D
  },
  controls: MutableRefObject<AlsAnimationInstanceControls>,
  animationCurves: MutableRefObject<AlsCharacterAnimationCurves>,
  character: MutableRefObject<AlsCharacter>,
  onJumped: MutableRefObject<(() => void) | null>,
  groundPredictionSweep: AlsGroundPredictionCapsuleSweep,
  controlRigFootTrace: AlsControlRigFootOffsetTrace,
) {
  const animationInstance = useMemo(
    () => createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep,
      controlRigFootTrace,
    }),
    [controlRigFootTrace, gltf, groundPredictionSweep],
  )
  const frameCapture = useMemo(
    () => new AnimationFrameCapture(gltf.scene),
    [gltf.scene],
  )

  useEffect(() => {
    onJumped.current = animationInstance.jump
    return () => {
      if (onJumped.current === animationInstance.jump) {
        onJumped.current = null
      }
    }
  }, [animationInstance, onJumped])

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
    const current = character.current
    frameControls.hasInput = current.locomotionState.hasInput
    animationInstance.refresh(delta, frameControls)
    animationCurves.current.rotationYawOffset =
      animationInstance.getCurveValue(ROTATION_YAW_OFFSET_CURVE_NAME)
    animationCurves.current.rotationYawSpeed =
      animationInstance.getCurveValue(ROTATION_YAW_SPEED_CURVE_NAME)
    frameCapture.recordFrame(delta, captureMetadata(frameControls))
  }, ALS_FRAME_PRIORITY.Animation)
}
