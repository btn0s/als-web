import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { AnimationFrameCapture } from '../engine/animationFrameCapture'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import {
  getAnimRootMotionTranslationScale,
  setAnimRootMotionTranslationScale,
} from './AlsCharacter'
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
import type {
  AlsAnimationInstanceControls,
  AlsMantlingMontageBridge,
  AlsRollingMontageBridge,
} from './AlsAnimationInstance'
import type {
  AlsPlayerCameraManager,
} from './AlsCamera/Notifies/AlsAnimNotify_CameraShake'
import {
  createAlsMantlingNotifyRuntime,
  refreshAlsMantlingNotifyRuntime,
} from './AlsCharacter_Actions'
import type {
  AlsMantlingNotifyRuntime,
} from './AlsCharacter_Actions'
import {
  notifyAlsAnimNotifySetGroundedEntryMode,
} from './Notifies/AlsAnimNotify_SetGroundedEntryMode'
import {
  notifyAlsAnimNotifyStateSetLocomotionActionBegin,
  notifyAlsAnimNotifyStateSetLocomotionActionEnd,
} from './Notifies/AlsAnimNotifyState_SetLocomotionAction'
import {
  notifyAlsAnimNotifyStateSetRootMotionScaleBegin,
  notifyAlsAnimNotifyStateSetRootMotionScaleEnd,
} from './Notifies/AlsAnimNotifyState_SetRootMotionScale'
import {
  ROTATION_YAW_OFFSET_CURVE_NAME,
  ROTATION_YAW_SPEED_CURVE_NAME,
} from './Utility/AlsConstants'

function captureMetadata(frameControls: AlsAnimationInstanceControls) {
  const characterState = window.__alsCharacterState
  const cameraState = window.__alsCameraState
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
    ...(frameControls.actorYawAngle === undefined
      ? {}
      : { actorYawAngle: frameControls.actorYawAngle }),
    ...(characterState
      ? {
          locomotionAction:
            characterState.locomotionAction ?? 'None',
          characterPositionX: characterState.position.x,
          characterPositionY: characterState.position.y,
          characterPositionZ: characterState.position.z,
          capsuleBottomY: characterState.capsuleBottomY,
          actorFeetY: characterState.actorFeet.y,
          meshBaseOffsetY: characterState.meshBaseOffsetY,
          rootMotionConsumedX:
            characterState.animRootMotionConsumedTranslation.x,
          rootMotionConsumedY:
            characterState.animRootMotionConsumedTranslation.y,
          rootMotionConsumedZ:
            characterState.animRootMotionConsumedTranslation.z,
          rootMotionApplied: characterState.animRootMotionApplied,
          rootMotionOwned: characterState.animRootMotionOwned,
        }
      : {}),
    ...(cameraState
      ? {
          // Camera debug state is published in Unreal axes. Convert it to the same Three/Rapier
          // world axes as the raw body and rendered root before the transform-jitter comparison.
          cameraPositionX: cameraState.location.x,
          cameraPositionY: cameraState.location.z,
          cameraPositionZ: cameraState.location.y,
        }
      : {}),
  }
}

export function refreshAlsAnimationMantlingNotifies(
  runtime: AlsMantlingNotifyRuntime,
  character: AlsCharacter,
  montage: AlsMantlingMontageBridge,
): boolean {
  return refreshAlsMantlingNotifyRuntime(runtime, {
    Character: character,
    MantlingMontage: montage,
    NotifyEvents: montage.takeNotifyEvents(),
  })
}

/**
 * Dispatches the retained Roll montage's branching points in the exact order
 * emitted by `FAnimMontageInstance`.
 *
 * Standalone owns the character as Authority. Translation scale remains
 * character state, while GroundedEntryMode remains animation-instance state,
 * matching the two native notify targets.
 */
export function refreshAlsAnimationRollingNotifies(
  animationInstance: {
    SetGroundedEntryMode(
      GroundedEntryMode:
        'Als.GroundedEntryMode.FromRoll' | null,
    ): void
  },
  character: AlsCharacter,
  montage: AlsRollingMontageBridge,
): number {
  const events = montage.takeNotifyEvents()
  if (events.length === 0) return 0

  const rootMotionCharacter = {
    LocalRole: 'Authority' as const,
    GetAnimRootMotionTranslationScale() {
      return getAnimRootMotionTranslationScale(character)
    },
    SetAnimRootMotionTranslationScale(TranslationScale: number) {
      setAnimRootMotionTranslationScale(
        character,
        TranslationScale,
      )
    },
  }

  for (const event of events) {
    switch (event.notifyClass) {
      case 'AlsAnimNotifyState_SetLocomotionAction':
        if (event.notifyEventType === 'Begin') {
          notifyAlsAnimNotifyStateSetLocomotionActionBegin(
            character,
            event,
          )
        } else {
          notifyAlsAnimNotifyStateSetLocomotionActionEnd(
            character,
            event,
          )
        }
        break
      case 'AlsAnimNotifyState_SetRootMotionScale':
        if (event.notifyEventType === 'Begin') {
          notifyAlsAnimNotifyStateSetRootMotionScaleBegin(
            rootMotionCharacter,
            event,
          )
        } else {
          notifyAlsAnimNotifyStateSetRootMotionScaleEnd(
            rootMotionCharacter,
            event,
          )
        }
        break
      case 'AlsAnimNotify_SetGroundedEntryMode':
        notifyAlsAnimNotifySetGroundedEntryMode(
          animationInstance,
          event,
        )
        break
    }
  }
  return events.length
}

export function dispatchAlsQueuedAnimationEvents(
  animationInstance: {
    dispatchQueuedAnimEvents(
      sink: AlsPlayerCameraManager,
    ): number
  },
  cameraManager: AlsPlayerCameraManager,
): number {
  return animationInstance.dispatchQueuedAnimEvents(cameraManager)
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
  cameraManager: AlsPlayerCameraManager,
  mantlingMontage?: MutableRefObject<AlsMantlingMontageBridge | null>,
  rollingMontage?: MutableRefObject<AlsRollingMontageBridge | null>,
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
  const mantlingNotifyRuntime = useMemo(
    createAlsMantlingNotifyRuntime,
    [animationInstance],
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
    if (!mantlingMontage) return
    const bridge = animationInstance.mantlingMontage
    mantlingMontage.current = bridge
    return () => {
      if (mantlingMontage.current === bridge) {
        mantlingMontage.current = null
      }
    }
  }, [animationInstance, mantlingMontage])

  useEffect(() => {
    if (!rollingMontage) return
    const bridge = animationInstance.rollingMontage
    rollingMontage.current = bridge
    return () => {
      if (rollingMontage.current === bridge) {
        rollingMontage.current = null
      }
    }
  }, [animationInstance, rollingMontage])

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
    const montage = animationInstance.mantlingMontage
    refreshAlsAnimationMantlingNotifies(
      mantlingNotifyRuntime,
      current,
      montage,
    )
    refreshAlsAnimationRollingNotifies(
      animationInstance,
      current,
      animationInstance.rollingMontage,
    )
    animationCurves.current.rotationYawOffset =
      animationInstance.getCurveValue(ROTATION_YAW_OFFSET_CURVE_NAME)
    animationCurves.current.rotationYawSpeed =
      animationInstance.getCurveValue(ROTATION_YAW_SPEED_CURVE_NAME)
  }, ALS_FRAME_PRIORITY.Animation)

  useFrame(() => {
    dispatchAlsQueuedAnimationEvents(
      animationInstance,
      cameraManager,
    )
  }, ALS_FRAME_PRIORITY.AnimNotifyDispatch)

  useFrame((_, delta) => {
    frameCapture.recordFrame(
      delta,
      captureMetadata(controls.current),
    )
  }, ALS_FRAME_PRIORITY.Diagnostics)
}
