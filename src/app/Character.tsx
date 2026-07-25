import { useFrame } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier'
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
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
} from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { createRapierAlsCapsuleSweep } from '../engine/rapierAlsCapsuleSweep'
import {
  createRapierAlsControlRigFootTrace,
} from '../engine/rapierAlsControlRigFootTrace'
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
import {
  ALS_RIFLE_OVERLAY_OBJECT_URL,
  attachRifleOverlayObject,
  detachOverlayObject,
} from '../als/AlsCharacter.overlayObjects'
import { applyCharacterMaterialOverrides } from '../als/characterMaterials'
import { ALS_MESH_COMPONENT_YAW_RADIANS } from '../engine/unrealCoordinateSpace'
import {
  ALS_MANTLING_SETTINGS,
} from '../als/Settings/AlsMantlingSettings'

const CHARACTER_URL = '/assets/skm-als.glb'
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46]
const ALS_VISIBILITY_MANTLING_RESPONSE_CHANNELS = new Set([
  'WorldStatic',
  'WorldDynamic',
  'Destructible',
])

interface CharacterProps {
  onSizeChange: (size: THREE.Vector3) => void
  poseSample: MutableRefObject<CharacterPoseSample>
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

function isGlb(buffer: ArrayBuffer) {
  if (buffer.byteLength < 12) {
    return false
  }

  const header = new Uint8Array(buffer, 0, 4)
  return GLB_MAGIC.every((byte, index) => header[index] === byte)
}

function useCharacterGltf() {
  const [gltf, setGltf] = useState<GLTF>()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [progress, setProgress] = useState<number>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setStatus('loading')
      setProgress(undefined)
      try {
        const response = await fetch(CHARACTER_URL, { signal: controller.signal })
        const contentType = response.headers.get('content-type') ?? ''

        if (!response.ok || contentType.includes('text/html')) {
          throw new Error(`Character request failed (${response.status})`)
        }

        let buffer: ArrayBuffer
        const totalBytes = Number(response.headers.get('content-length')) || 0
        if (response.body) {
          const reader = response.body.getReader()
          const chunks: Uint8Array[] = []
          let receivedBytes = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            receivedBytes += value.byteLength
            if (totalBytes > 0) setProgress(Math.min(1, receivedBytes / totalBytes))
          }
          const bytes = new Uint8Array(receivedBytes)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          buffer = bytes.buffer
        } else {
          buffer = await response.arrayBuffer()
        }
        if (!isGlb(buffer)) {
          throw new Error('Character response was not a GLB')
        }

        const resourcePath = new URL('.', response.url).href
        const loadedGltf = await new GLTFLoader().parseAsync(buffer, resourcePath)
        if (!controller.signal.aborted) {
          applyCharacterMaterialOverrides(loadedGltf.scene)
          setGltf(loadedGltf)
        }
      } catch (error) {
        if (
          !controller.signal.aborted
          && !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          console.debug('[Character] GLB unavailable; showing retry state')
          setStatus('error')
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setGltf(undefined)
    setAttempt((value) => value + 1)
  }, [])

  return { gltf, status, progress, retry }
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

function RifleOverlayObject({ characterScene }: { characterScene: THREE.Object3D }) {
  // useGLTF caches by URL: the first Rifle switch loads, then Default only detaches/hides it.
  const rifleGltf = useGLTF(ALS_RIFLE_OVERLAY_OBJECT_URL)

  useLayoutEffect(() => {
    // Keep the authored MI_Als_Rifle material graph intact; as a bone child it shares the
    // character's lighting, shadows, and postprocessing path.
    attachRifleOverlayObject(characterScene, rifleGltf.scene)
    return () => detachOverlayObject(rifleGltf.scene)
  }, [characterScene, rifleGltf.scene])

  return null
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
    }),
    [RapierCapsule, RapierRay, rapier.QueryFilterFlags.EXCLUDE_SENSORS, world],
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
    }),
    [gltf.scene],
  )
  const bounds = useMemo(() => {
    gltf.scene.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(gltf.scene, true)
    const size = box.getSize(new THREE.Vector3())

    return {
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
    },
  )
  // The hook owns clip sampling, pose-space composition, and the one skeleton write per frame.
  // Its single-clip path keeps older/incomplete animation GLBs alive without a mixer fallback.
  useAlsAnimationInstance(
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
  )

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
    poseSample.current.poseHeight = poseSample.current.head.y - poseSample.current.ground.y
    poseSample.current.characterYaw = group.rotation.y
    poseSample.current.ready =
      Number.isFinite(poseSample.current.poseHeight) && poseSample.current.poseHeight > 0
  }, ALS_FRAME_PRIORITY.PosePublication)

  return (
    <RigidBody
      ref={rigidBody}
      type="dynamic"
      colliders={false}
      position={[0, ALS_STANDING_CAPSULE_HALF_HEIGHT, 0]}
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
        </group>
        {character.overlayMode === 'Rifle' && (
          <Suspense fallback={null}>
            <RifleOverlayObject characterScene={gltf.scene} />
          </Suspense>
        )}
      </group>
    </RigidBody>
  )
}

export function Character({ onSizeChange, poseSample }: CharacterProps) {
  const { gltf, status, progress, retry } = useCharacterGltf()

  useEffect(() => {
    window.__characterStatus = gltf ? 'glb' : 'placeholder'
  }, [gltf])

  return gltf ? (
    <LoadedCharacter gltf={gltf} onSizeChange={onSizeChange} poseSample={poseSample} />
  ) : (
    <CharacterLoadState status={status} progress={progress} retry={retry} />
  )
}
