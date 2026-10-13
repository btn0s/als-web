import type { ConsumerOverlayStates } from '../als/AnimGraph/consumerOverlayStates'
import type { AlsRagdollingSettings } from '../als/Settings/AlsRagdollingSettings'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { useAlsRagdoll } from './useAlsRagdoll'
import { ALS_CHARACTER_COLLISION_GROUPS, type AlsRagdollHandle } from '../engine/rapierAlsRagdoll'
export type { AlsRagdollHandle, AlsRagdollStartOptions, AlsRagdollImpulse } from '../engine/rapierAlsRagdoll'
import { AlsCharacterRecorder } from '../als/AlsCharacterRecorder'
import type { AlsCharacterSnapshot } from '../als/AlsCharacterSnapshot'
import { isPistolOverlayMode } from '../als/AnimGraph/overlayMode'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier'
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { useAlsAnimationInstance } from '../als/AlsAnimationInstance.hooks'
import type {
  AlsMantlingMontageBridge,
  AlsRollingMontageBridge,
} from '../als/AlsAnimationInstance'
import {
  ALS_CAPSULE_RADIUS,
  ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
  ALS_STANDING_CAPSULE_HALF_HEIGHT,
  resolveAlsMeshRootRelativeY,
  useAlsCharacter,
  type AlsGamepadBindings,
} from '../als/AlsCharacter.hooks'
import type {
  AlsCharacterBridge,
} from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import type { WorldTimeState } from '../engine/timeDilation'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from '../engine/characterMovementFloor'
import { createRapierAlsCapsuleSweep } from '../engine/rapierAlsCapsuleSweep'
import {
  createRapierAlsGroundedMoveSweep,
} from '../engine/rapierAlsGroundedMove'
import {
  createRapierAlsControlRigFootTrace,
} from '../engine/rapierAlsControlRigFootTrace'
import {
  createRapierAlsFootstepEffectsTrace,
} from '../engine/rapierAlsFootstepEffectsTrace'
import {
  createRapierAlsMantling,
} from '../engine/rapierAlsMantling'
import {
  compileAuthoredRootMotion,
} from '../engine/rootMotion'
import type {
  CompiledAuthoredRootMotion,
} from '../engine/rootMotion'
import type { CharacterPoseSample } from './CharacterPoseSample'
import type { AlsCharacterInputSource } from '../als/AlsCharacter.hooks'
import type { AlsGaitSpeedOverrides } from '../als/AlsCharacterMovementComponent'
import { resolveOverlayObjectUrl } from '../als/AlsCharacter.overlayObjects'
import { PistolOverlayObject, RifleOverlayObject, type AlsOverlayObjectAssets, type AlsOverlayObjectMountHandler } from './AlsOverlayObjects'
export { RifleOverlayObject } from './AlsOverlayObjects'
import { useAlsCharacterGltf } from './AlsCharacterGltf.hooks'
import { ALS_MESH_COMPONENT_YAW_RADIANS } from '../engine/unrealCoordinateSpace'
import {
  ALS_MANTLING_SETTINGS,
} from '../als/Settings/AlsMantlingSettings'
import type {
  AlsFootstepSoundSink,
} from '../als/Notifies/AlsAnimNotify_FootstepEffects'

const ALS_VISIBILITY_MANTLING_RESPONSE_CHANNELS = new Set([
  'WorldStatic',
  'WorldDynamic',
  'Destructible',
])

export type AlsOverlayModeBridge = Pick<
  AlsCharacterBridge,
  'overlayMode' | 'SetOverlayMode'
>

export interface CharacterProps {
  inputSource?: AlsCharacterInputSource
  inputEnabled?: boolean
  exposeDebugGlobals?: boolean
  allowSprint?: boolean
  gaitSpeedOverrides?: AlsGaitSpeedOverrides
  instanceId?: string
  initialPosition?: readonly [number, number, number]
  tint?: string
  overlayStates?: ConsumerOverlayStates
  renderOverlayObject?: (scene: THREE.Object3D) => React.ReactNode
  /** Consumer prop meshes mounted by the native overlay path, one URL per overlay family. */
  overlayObjectAssets?: AlsOverlayObjectAssets
  /** Called when the native path mounts a prop on the attachment bone, and again with null on unmount. */
  onOverlayObjectMount?: AlsOverlayObjectMountHandler
  ragdollRef?: React.RefObject<AlsRagdollHandle | null>
  /** Emitted after animation in the performance.now() clock domain. */
  onSnapshot?: (snapshot: AlsCharacterSnapshot) => void
  snapshotRateHz?: number
  /** Disable the consumer's ragdoll/get-up input bindings; ALS itself has no death policy. */
  ragdollInputEnabled?: boolean
  ragdollingSettings?: Partial<AlsRagdollingSettings>
  onSizeChange: (size: THREE.Vector3) => void
  poseSample: MutableRefObject<CharacterPoseSample>
  worldTime: Readonly<WorldTimeState>
  onOverlayModeBridgeChange: (
    bridge: AlsOverlayModeBridge | null,
  ) => void
  footstepSoundSink: AlsFootstepSoundSink
  /** KeyboardEvent.code toggling rotation mode (default `Digit1`); `null` disables it. */
  toggleRotationModeKey?: string | null
  /** PointerEvent.button values that hold aim (default `[2]`, RMB). */
  aimPointerButtons?: readonly number[]
  gamepadBindings?: Partial<AlsGamepadBindings>
  gamepadEnabled?: boolean
  gamepadIndex?: number
  gamepadRollBehavior?: 'tap' | 'doubleTap'
  showDebugControls?: boolean
}

function compileAlsMantlingRootMotion(
  animations: readonly THREE.AnimationClip[],
): ReadonlyMap<string, CompiledAuthoredRootMotion> {
  const sequenceNames = new Set(
    Object.values(ALS_MANTLING_SETTINGS).map(
      (settings) => settings.Montage.Sequence,
    ),
  )
  if (sequenceNames.size !== 3) {
    throw new Error(
      `ALS mantling content must reference exactly three sequences; received ${sequenceNames.size}`,
    )
  }

  const clipsByName = new Map(
    animations.map((clip) => [clip.name, clip]),
  )
  const rootMotionBySequence =
    new Map<string, CompiledAuthoredRootMotion>()
  for (const sequenceName of sequenceNames) {
    const clip = clipsByName.get(sequenceName)
    if (!clip) {
      throw new Error(`Missing ALS mantling sequence ${sequenceName}`)
    }
    const rootMotion = compileAuthoredRootMotion(clip)
    if (!rootMotion) {
      throw new Error(
        `${sequenceName} is missing its authored raw root track`,
      )
    }
    rootMotionBySequence.set(sequenceName, rootMotion)
  }
  return rootMotionBySequence
}

function CharacterLoadState({
  status,
  progress,
  retry,
}: {
  status: 'loading' | 'error'
  progress?: number
  retry: () => void
}) {
  const determinate = status === 'loading' && progress !== undefined
  return (
    <Html fullscreen>
      <div className="character-load-state" role="status" aria-live="polite">
        <div className="character-load-card">
          <span>
            {status === 'error' ? 'character unavailable' : 'loading character…'}
          </span>
          <div className="character-load-track" aria-hidden="true">
            <i
              className={determinate ? 'is-determinate' : 'is-indeterminate'}
              style={determinate ? { transform: `scaleX(${progress})` } : undefined}
            />
          </div>
          {status === 'error' && (
            <button type="button" onClick={retry}>
              retry
            </button>
          )}
        </div>
      </div>
    </Html>
  )
}

function findSkeletonBone(scene: THREE.Object3D, name: string): THREE.Bone | null {
  const candidate = scene.getObjectByName(name)
  return candidate instanceof THREE.Bone ? candidate : null
}

function LoadedCharacter({
  gltf: sourceGltf,
  overlayStates,
  renderOverlayObject,
  overlayObjectAssets,
  onOverlayObjectMount,
  onSizeChange,
  poseSample,
  worldTime,
  onOverlayModeBridgeChange,
  footstepSoundSink,
  onSnapshot,
  ragdollRef,
  snapshotRateHz = 20,
  ragdollInputEnabled,
  ragdollingSettings,
  toggleRotationModeKey,
  aimPointerButtons,
  gamepadBindings,
  gamepadEnabled,
  gamepadIndex,
  inputSource,
  inputEnabled,
  exposeDebugGlobals,
  allowSprint,
  gaitSpeedOverrides,
  instanceId,
  initialPosition,
  tint,
  gamepadRollBehavior,
  showDebugControls,
}: {
  gltf: GLTF
  overlayStates?: CharacterProps['overlayStates']
  renderOverlayObject?: CharacterProps['renderOverlayObject']
  overlayObjectAssets?: CharacterProps['overlayObjectAssets']
  onOverlayObjectMount?: CharacterProps['onOverlayObjectMount']
  ragdollRef?: CharacterProps['ragdollRef']
  ragdollInputEnabled?: boolean
  ragdollingSettings?: Partial<AlsRagdollingSettings>
  onSizeChange: CharacterProps['onSizeChange']
  poseSample: CharacterProps['poseSample']
  worldTime: CharacterProps['worldTime']
  onOverlayModeBridgeChange:
    CharacterProps['onOverlayModeBridgeChange']
  footstepSoundSink: CharacterProps['footstepSoundSink']
  onSnapshot?: CharacterProps['onSnapshot']
  snapshotRateHz?: number
  toggleRotationModeKey: CharacterProps['toggleRotationModeKey']
  aimPointerButtons: CharacterProps['aimPointerButtons']
  gamepadBindings: CharacterProps['gamepadBindings']
  gamepadEnabled: CharacterProps['gamepadEnabled']
  gamepadIndex: CharacterProps['gamepadIndex']
  showDebugControls: CharacterProps['showDebugControls']
  inputSource: CharacterProps['inputSource']
  inputEnabled: CharacterProps['inputEnabled']
  exposeDebugGlobals: CharacterProps['exposeDebugGlobals']
  allowSprint: CharacterProps['allowSprint']
  gaitSpeedOverrides: CharacterProps['gaitSpeedOverrides']
  instanceId: CharacterProps['instanceId']
  initialPosition: CharacterProps['initialPosition']
  tint: CharacterProps['tint']
  gamepadRollBehavior: CharacterProps['gamepadRollBehavior']
}) {
  const gltf = useMemo(() => {
    const scene = clone(sourceGltf.scene)
    if (tint) {
      const color = new THREE.Color(tint)
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const tintMaterial = (material: THREE.Material) => {
          const copy = material.clone()
          if ('color' in copy && copy.color instanceof THREE.Color) copy.color.multiply(color)
          return copy
        }
        object.material = Array.isArray(object.material)
          ? object.material.map(tintMaterial)
          : tintMaterial(object.material)
      })
    }
    return { ...sourceGltf, scene, overlayStates }
  }, [sourceGltf, tint, overlayStates])
  const { rapier, world } = useRapier()
  const RapierCapsule = rapier.Capsule
  const RapierRay = rapier.Ray
  const characterGroup = useRef<THREE.Group>(null)
  const rigidBody = useRef<RapierRigidBody>(null)
  const standingCapsule = useRef<RapierCollider>(null)
  const crouchingCapsule = useRef<RapierCollider>(null)
  const mantlingMontage =
    useRef<AlsMantlingMontageBridge | null>(null)
  const rollingMontage =
    useRef<AlsRollingMontageBridge | null>(null)
  const mantlingRootMotionBySequence = useMemo(
    () => compileAlsMantlingRootMotion(gltf.animations),
    [gltf.animations],
  )
  const capsuleSweep = useMemo(
    () => createRapierAlsCapsuleSweep({
      world,
      Capsule: RapierCapsule,
      Ray: RapierRay,
      resolveExcludeRigidBody: () => rigidBody.current,
      filterFlags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      resolveFilterGroups: () => {
        const body = rigidBody.current
        return body && body.numColliders() > 0 ? body.collider(0).collisionGroups() : undefined
      },
    }),
    [RapierCapsule, RapierRay, rapier.QueryFilterFlags.EXCLUDE_SENSORS, world],
  )
  const groundedMoveSweep = useMemo(
    () => createRapierAlsGroundedMoveSweep({
      world,
      Capsule: RapierCapsule,
      resolveExcludeRigidBody: () => rigidBody.current,
      filterFlags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      resolveFilterGroups: () => {
        const body = rigidBody.current
        return body && body.numColliders() > 0 ? body.collider(0).collisionGroups() : undefined
      },
    }),
    [RapierCapsule, rapier.QueryFilterFlags.EXCLUDE_SENSORS, world],
  )
  const controlRigFootTrace = useMemo(
    () => createRapierAlsControlRigFootTrace({
      world,
      Ray: RapierRay,
      component: gltf.scene,
      queryFilterForChannel: () => ({
        flags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      }),
      resolveExcludeRigidBody: () => rigidBody.current,
      getOwnerColliders: () => {
        const colliders: RapierCollider[] = []
        if (standingCapsule.current) {
          colliders.push(standingCapsule.current)
        }
        if (crouchingCapsule.current) {
          colliders.push(crouchingCapsule.current)
        }
        return colliders
      },
    }),
    [
      gltf.scene,
      RapierRay,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      world,
    ],
  )
  const footstepEffectsTrace = useMemo(
    () => createRapierAlsFootstepEffectsTrace({
      world,
      Ray: RapierRay,
      queryFilterForChannel: () => ({
        flags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      }),
      resolveExcludeRigidBody: () => rigidBody.current,
      getOwnerColliders: () => {
        const colliders: RapierCollider[] = []
        if (standingCapsule.current) {
          colliders.push(standingCapsule.current)
        }
        if (crouchingCapsule.current) {
          colliders.push(crouchingCapsule.current)
        }
        return colliders
      },
    }),
    [
      RapierRay,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      world,
    ],
  )
  const mantlingAdapter = useMemo(
    () => createRapierAlsMantling({
      world,
      walkableFloorAngleCos:
        ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
      queryFilterForChannel(channel, responseChannels) {
        if (
          channel !== 'Visibility'
          || responseChannels.length
            !== ALS_VISIBILITY_MANTLING_RESPONSE_CHANNELS.size
          || responseChannels.some(
            (response) =>
              !ALS_VISIBILITY_MANTLING_RESPONSE_CHANNELS.has(
                response,
              ),
          )
        ) {
          throw new Error(
            `Unsupported ALS mantling collision response ${channel}:`
            + responseChannels.join(','),
          )
        }
        /*
         * ORIGINAL engine adapter policy: Rapier has no UE object-channel table. The standalone
         * scene maps Visibility's authored WorldStatic/WorldDynamic/Destructible blocking set to
         * every non-sensor world collider. The adapter separately excludes the owner rigid body
         * and both owner capsules.
         */
        return {
          flags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        }
      },
      getOwnerRigidBody: () => rigidBody.current,
      getOwnerColliders: () => {
        const colliders: RapierCollider[] = []
        if (standingCapsule.current) {
          colliders.push(standingCapsule.current)
        }
        if (crouchingCapsule.current) {
          colliders.push(crouchingCapsule.current)
        }
        return colliders
      },
    }),
    [
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      world,
    ],
  )
  const poseBones = useMemo(
    () => ({
      head: gltf.scene.getObjectByName('head') ?? gltf.scene.getObjectByName('Head'),
      pelvis: gltf.scene.getObjectByName('pelvis'),
      leftFoot: gltf.scene.getObjectByName('foot_l'),
      rightFoot: gltf.scene.getObjectByName('foot_r'),
      cameraRoot: findSkeletonBone(gltf.scene, 'root'),
      cameraHead: findSkeletonBone(gltf.scene, 'head'),
    }),
    [gltf.scene],
  )
  useEffect(() => () => {
    if (poseSample.current.rootBone === poseBones.cameraRoot) {
      poseSample.current.rootBone = null
      poseSample.current.headBone = null
      poseSample.current.ready = false
    }
  }, [poseSample, poseBones])
  const bounds = useMemo(() => {
    gltf.scene.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(gltf.scene, true)
    const size = box.getSize(new THREE.Vector3())

    return {
      size,
    }
  }, [gltf.scene])

  useLayoutEffect(() => {
    onSizeChange(bounds.size.clone())
  }, [bounds, onSizeChange])

  const internalRagdoll = useRef<AlsRagdollHandle | null>(null)
  const character = useAlsCharacter(
    rigidBody,
    standingCapsule,
    crouchingCapsule,
    characterGroup,
    poseSample,
    capsuleSweep,
    {
      adapter: mantlingAdapter,
      authoredRootMotionBySequence:
        mantlingRootMotionBySequence,
      montage: mantlingMontage,
    },
    {
      RollingMontage: rollingMontage,
      StartRagdolling: () => { internalRagdoll.current?.StartRagdolling() },
      StopRagdolling: () => internalRagdoll.current?.StopRagdolling() ?? false,
    },
    groundedMoveSweep,
    worldTime,
    toggleRotationModeKey,
    aimPointerButtons,
    gamepadBindings,
    gamepadEnabled,
    gamepadIndex,
    ragdollInputEnabled,
    ragdollingSettings,
    inputSource,
    inputEnabled,
    exposeDebugGlobals,
    allowSprint,
    gaitSpeedOverrides,
    instanceId,
    gamepadRollBehavior,
    showDebugControls,
    overlayStates?.states,
  )
  useEffect(() => {
    onOverlayModeBridgeChange({
      overlayMode: character.overlayMode,
      SetOverlayMode: character.SetOverlayMode,
    })
  }, [
    character.SetOverlayMode,
    character.overlayMode,
    onOverlayModeBridgeChange,
  ])
  useEffect(
    () => () => onOverlayModeBridgeChange(null),
    [onOverlayModeBridgeChange],
  )
  // The hook owns clip sampling, pose-space composition, and the one skeleton write per frame.
  // Its single-clip path keeps older/incomplete animation GLBs alive without a mixer fallback.
  const animationInstance = useAlsAnimationInstance(
    gltf,
    character.animationControls,
    character.animationCurves,
    character.character,
    character.onJumped,
    capsuleSweep,
    controlRigFootTrace,
    poseSample.current.cameraShakeRequests,
    mantlingMontage,
    rollingMontage,
    worldTime,
    {
      Trace: footstepEffectsTrace,
      SoundSink: footstepSoundSink,
    },
    exposeDebugGlobals ?? inputEnabled !== false,
  )

  const ragdoll = useAlsRagdoll(character.character.current, animationInstance,
    rigidBody, standingCapsule, crouchingCapsule, ragdollRef, worldTime)
  useEffect(() => {
    internalRagdoll.current = ragdoll
    return () => { internalRagdoll.current = null }
  }, [ragdoll])

  const recorder = useMemo(() => new AlsCharacterRecorder(snapshotRateHz), [snapshotRateHz])
  useFrame(() => {
    if (!onSnapshot || !rigidBody.current) return
    const snapshot = recorder.capture(performance.now(), {
      character: character.character.current,
      controls: character.animationControls.current,
      position: rigidBody.current.translation(),
      mantle: animationInstance.getMantlingSnapshot(),
      rolling: animationInstance.getRollingSnapshot(),
    })
    if (snapshot) onSnapshot(snapshot)
  }, ALS_FRAME_PRIORITY.Replication)

  useFrame(() => {
    const group = characterGroup.current
    if (!group || !poseBones.head || !poseBones.pelvis) {
      poseSample.current.ready = false
      return
    }

    // Publish after the evaluator has written this frame's skeleton. `getWorldPosition` refreshes the
    // ancestor chains, so ground, pelvis, and head all come from the same composed pose.
    group.getWorldPosition(poseSample.current.ground)
    poseBones.pelvis.getWorldPosition(poseSample.current.pelvis)
    poseBones.head.getWorldPosition(poseSample.current.head)
    poseBones.leftFoot?.getWorldPosition(poseSample.current.leftFoot)
    poseBones.rightFoot?.getWorldPosition(poseSample.current.rightFoot)
    poseSample.current.poseHeight = poseSample.current.head.y - poseSample.current.ground.y
    poseSample.current.characterYaw = group.rotation.y
    poseSample.current.rootBone = poseBones.cameraRoot
    poseSample.current.headBone = poseBones.cameraHead
    poseSample.current.ready =
      Number.isFinite(poseSample.current.poseHeight) && poseSample.current.poseHeight > 0
  }, ALS_FRAME_PRIORITY.PosePublication)

  return (
    <RigidBody
      ref={rigidBody}
      type="kinematicPosition"
      colliders={false}
      position={[
        initialPosition?.[0] ?? 0,
        (initialPosition?.[1] ?? 0) + ALS_STANDING_CAPSULE_HALF_HEIGHT
          + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
        initialPosition?.[2] ?? 0,
      ]}
      lockRotations
      canSleep={false}
      ccd
      linearDamping={0}
      angularDamping={0}
    >
      <CapsuleCollider
        ref={standingCapsule}
        args={[
          ALS_STANDING_CAPSULE_HALF_HEIGHT - ALS_CAPSULE_RADIUS,
          ALS_CAPSULE_RADIUS,
        ]}
        collisionGroups={ALS_CHARACTER_COLLISION_GROUPS}
        friction={0}
      />
      <CapsuleCollider
        ref={crouchingCapsule}
        args={[
          ALS_CROUCHING_CAPSULE_HALF_HEIGHT - ALS_CAPSULE_RADIUS,
          ALS_CAPSULE_RADIUS,
        ]}
        position={[
          0,
          ALS_CROUCHING_CAPSULE_HALF_HEIGHT
            - ALS_STANDING_CAPSULE_HALF_HEIGHT,
          0,
        ]}
        collisionGroups={ALS_CHARACTER_COLLISION_GROUPS}
        friction={0}
      />
      <group
        ref={characterGroup}
        position={[
          0,
          resolveAlsMeshRootRelativeY('Standing', 'Grounded'),
          0,
        ]}
      >
        <group rotation-y={ALS_MESH_COMPONENT_YAW_RADIANS}>
          <primitive object={gltf.scene} />
          {renderOverlayObject?.(gltf.scene)}
        </group>
        {!renderOverlayObject && isPistolOverlayMode(character.overlayMode) && (
          <Suspense fallback={null}>
            <PistolOverlayObject characterScene={gltf.scene} url={resolveOverlayObjectUrl('pistol', overlayObjectAssets)} onMount={onOverlayObjectMount} />
          </Suspense>
        )}
        {!renderOverlayObject && character.overlayMode === 'Rifle' && (
          <Suspense fallback={null}>
            <RifleOverlayObject characterScene={gltf.scene} url={resolveOverlayObjectUrl('rifle', overlayObjectAssets)} onMount={onOverlayObjectMount} />
          </Suspense>
        )}
      </group>
    </RigidBody>
  )
}

export function Character({
  overlayStates,
  renderOverlayObject,
  overlayObjectAssets,
  onOverlayObjectMount,
  onSizeChange,
  poseSample,
  worldTime,
  onOverlayModeBridgeChange,
  footstepSoundSink,
  onSnapshot,
  ragdollRef,
  snapshotRateHz = 20,
  ragdollInputEnabled,
  ragdollingSettings,
  toggleRotationModeKey,
  aimPointerButtons,
  gamepadBindings,
  gamepadEnabled,
  gamepadIndex,
  inputSource,
  inputEnabled,
  exposeDebugGlobals,
  allowSprint,
  gaitSpeedOverrides,
  instanceId,
  initialPosition,
  tint,
  gamepadRollBehavior,
  showDebugControls,
}: CharacterProps) {
  const { gltf, status, progress, retry } = useAlsCharacterGltf()

  useEffect(() => {
    if (exposeDebugGlobals ?? inputEnabled !== false) window.__characterStatus = gltf ? 'glb' : 'placeholder'
  }, [gltf, exposeDebugGlobals, inputEnabled])

  return gltf ? (
    <LoadedCharacter
      gltf={gltf}
      overlayStates={overlayStates}
      renderOverlayObject={renderOverlayObject}
      overlayObjectAssets={overlayObjectAssets}
      onOverlayObjectMount={onOverlayObjectMount}
      onSizeChange={onSizeChange}
      poseSample={poseSample}
      worldTime={worldTime}
      onOverlayModeBridgeChange={onOverlayModeBridgeChange}
      footstepSoundSink={footstepSoundSink}
      onSnapshot={onSnapshot}
      snapshotRateHz={snapshotRateHz}
      ragdollRef={ragdollRef}
      ragdollInputEnabled={ragdollInputEnabled}
      ragdollingSettings={ragdollingSettings}
      toggleRotationModeKey={toggleRotationModeKey}
      aimPointerButtons={aimPointerButtons}
      gamepadBindings={gamepadBindings}
      gamepadEnabled={gamepadEnabled}
      gamepadIndex={gamepadIndex}
      inputSource={inputSource}
      inputEnabled={inputEnabled}
      exposeDebugGlobals={exposeDebugGlobals}
      allowSprint={allowSprint}
      gaitSpeedOverrides={gaitSpeedOverrides}
      instanceId={instanceId}
      initialPosition={initialPosition}
      tint={tint}
      gamepadRollBehavior={gamepadRollBehavior}
      showDebugControls={showDebugControls}
    />
  ) : (
    <CharacterLoadState status={status} progress={progress} retry={retry} />
  )
}
