import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { AnimationFrameCapture } from '../engine/animationFrameCapture'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { getWorldDeltaTime } from '../engine/timeDilation'
import { AlsAnimationUpdateRate, resolveAlsAnimationLod, type AlsAnimationLodSource } from '../engine/animationUpdateRate'
import type { WorldTimeState } from '../engine/timeDilation'
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
  notifyAlsAnimNotifyFootstepEffects,
} from './Notifies/AlsAnimNotify_FootstepEffects'
import type {
  AlsAnimNotifyFootstepEffectsEvent,
  AlsFootstepEffectsTrace,
  AlsFootstepSoundSink,
} from './Notifies/AlsAnimNotify_FootstepEffects'
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
  FOOTSTEP_SOUND_BLOCK_CURVE_NAME,
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
          physicsStepIndex: characterState.physicsStepIndex,
          physicsTimeStep: characterState.physicsTimeStep,
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
    ...(cameraState?.activated
      ? {
          // Camera debug state is published in Unreal axes. Convert it to the same Three/Rapier
          // world axes as the raw body and rendered root before the transform-jitter comparison.
          cameraPositionX: cameraState.location.x,
          cameraPositionY: cameraState.location.z,
          cameraPositionZ: cameraState.location.y,
          cameraPivotTargetPositionX:
            cameraState.pivotTargetLocation.x,
          cameraPivotTargetPositionY:
            cameraState.pivotTargetLocation.z,
          cameraPivotTargetPositionZ:
            cameraState.pivotTargetLocation.y,
          cameraPivotLagPositionX:
            cameraState.pivotLagLocation.x,
          cameraPivotLagPositionY:
            cameraState.pivotLagLocation.z,
          cameraPivotLagPositionZ:
            cameraState.pivotLagLocation.y,
          cameraPivotPositionX: cameraState.pivotLocation.x,
          cameraPivotPositionY: cameraState.pivotLocation.z,
          cameraPivotPositionZ: cameraState.pivotLocation.y,
          cameraComponentPositionX:
            cameraState.componentLocation.x,
          cameraComponentPositionY:
            cameraState.componentLocation.z,
          cameraComponentPositionZ:
            cameraState.componentLocation.y,
          cameraTraceDistanceRatio:
            cameraState.traceDistanceRatio,
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

export function dispatchAlsQueuedFootstepEffectsEvents(
  animationInstance: {
    dispatchQueuedFootstepEffectsEvents(
      sink: (
        event: Readonly<AlsAnimNotifyFootstepEffectsEvent>,
      ) => void,
    ): number
  },
  sink: (
    event: Readonly<AlsAnimNotifyFootstepEffectsEvent>,
  ) => void,
): number {
  return animationInstance.dispatchQueuedFootstepEffectsEvents(sink)
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
  worldTime?: Readonly<WorldTimeState>,
  footstepEffects?: Readonly<{
    Trace: AlsFootstepEffectsTrace
    SoundSink: AlsFootstepSoundSink
  }>,
  exposeDebugGlobals = true,
  animationLod?: AlsAnimationLodSource,
) {
  const camera = useThree((state) => state.camera)
  const renderer = useThree((state) => state.gl)
  const captureControlRigComponentPositions = useRef(false)
  const animationInstance = useMemo(
    () => createAlsAnimationInstance({
      ...gltf,
      groundPredictionSweep,
      controlRigFootTrace,
      exposeDebugGlobals,
    }),
    [controlRigFootTrace, gltf, groundPredictionSweep, exposeDebugGlobals],
  )
  const updateRate = useMemo(() => new AlsAnimationUpdateRate(), [animationInstance])
  const frameCapture = useMemo(
    () => new AnimationFrameCapture(
      gltf.scene,
      undefined,
      {
        camera,
        getDrawingBufferSize: (out) =>
          renderer.getDrawingBufferSize(out),
      },
    ),
    [camera, gltf.scene, renderer],
  )
  const mantlingNotifyRuntime = useMemo(
    createAlsMantlingNotifyRuntime,
    [animationInstance],
  )
  const dispatchFootstepEffectsEvent = useMemo(() => {
    if (!footstepEffects) return null
    const footLeft = gltf.scene.getObjectByName('foot_l')
    const footRight = gltf.scene.getObjectByName('foot_r')
    if (!footLeft || !footRight) return null
    const location = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const meshScale = new THREE.Vector3()

    return (
      event: Readonly<AlsAnimNotifyFootstepEffectsEvent>,
    ) => {
      const foot = event.FootBone === 'Left'
        ? footLeft
        : footRight
      foot.getWorldPosition(location)
      foot.getWorldQuaternion(rotation)
      gltf.scene.getWorldScale(meshScale)
      notifyAlsAnimNotifyFootstepEffects(event, {
        LocomotionMode: character.current.locomotionMode,
        FootWorldTransform: { Location: location, Rotation: rotation },
        // Extractor C maps Unreal component Z (up) to three.js component Y.
        MeshScaleZ: meshScale.y,
        FootstepSoundBlock:
          animationInstance.getCurveValue(
            FOOTSTEP_SOUND_BLOCK_CURVE_NAME,
          ),
        Trace: footstepEffects.Trace,
        SoundSink: footstepEffects.SoundSink,
      })
    }
  }, [
    animationInstance,
    character,
    footstepEffects,
    gltf.scene,
  ])

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
    if (!exposeDebugGlobals) return
    window.__playClip = animationInstance.playClip
    const startFrameCapture = (frameCount?: number) => {
      if (captureControlRigComponentPositions.current) {
        return frameCapture.start(frameCount)
      }
      const report = frameCapture.start(frameCount)
      captureControlRigComponentPositions.current = true
      void report.then(
        () => {
          captureControlRigComponentPositions.current = false
        },
        () => {
          captureControlRigComponentPositions.current = false
        },
      )
      // The synchronous baseline is the last fully evaluated source pose. A caller can start the
      // capture and toggle a control in the same browser task without losing the transition edge.
      frameCapture.recordFrame(0, captureMetadata(controls.current))
      return report
    }
    window.__captureAlsAnimationFrames = startFrameCapture
    window.__diagnoseAlsCharacterJitter = async (frameCount = 360) => {
      const report = await startFrameCapture(frameCount)
      window.__lastAlsJitterCapture = report
      return report.diagnostics.transformJitterSummary.character
    }
    return () => {
      delete window.__playClip
      delete window.__captureAlsAnimationFrames
      delete window.__diagnoseAlsCharacterJitter
      delete window.__lastAlsJitterCapture
      captureControlRigComponentPositions.current = false
      frameCapture.cancel()
      animationInstance.clearSoloClip()
    }
  }, [animationInstance, controls, frameCapture, exposeDebugGlobals])

  useFrame((_, deltaRealTime) => {
    const deltaTime = worldTime
      ? getWorldDeltaTime(worldTime, deltaRealTime)
      : deltaRealTime
    const frameControls = controls.current
    const current = character.current
    frameControls.hasInput = current.locomotionState.hasInput
    const tick = updateRate.next(deltaTime, resolveAlsAnimationLod(animationLod), current.locomotionAction !== null, true)
    if (!tick.update) return
    animationInstance.refresh(
      tick.delta,
      frameControls,
      captureControlRigComponentPositions.current,
      tick.evaluate,
    )
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
    for (const event of animationInstance.getUpMontage.takeNotifyEvents()) {
      if (event.notifyEventType === 'Begin') notifyAlsAnimNotifyStateSetLocomotionActionBegin(current, event)
      else notifyAlsAnimNotifyStateSetLocomotionActionEnd(current, event)
    }
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
    if (dispatchFootstepEffectsEvent) {
      dispatchAlsQueuedFootstepEffectsEvents(
        animationInstance,
        dispatchFootstepEffectsEvent,
      )
    }
  }, ALS_FRAME_PRIORITY.AnimNotifyDispatch)

  useFrame((_, deltaRealTime) => {
    frameCapture.recordFrame(
      worldTime
        ? getWorldDeltaTime(worldTime, deltaRealTime)
        : deltaRealTime,
      captureMetadata(controls.current),
    )
  }, ALS_FRAME_PRIORITY.Diagnostics)
  return animationInstance
}
