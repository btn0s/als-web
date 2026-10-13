import type { AlsRagdollingSettings } from '../als/Settings/AlsRagdollingSettings'
import { notifyAlsAnimNotifyStateSetLocomotionActionBegin, notifyAlsAnimNotifyStateSetLocomotionActionEnd } from '../als/Notifies/AlsAnimNotifyState_SetLocomotionAction'
import { useAlsRagdoll } from './useAlsRagdoll'
import { ALS_CHARACTER_COLLISION_GROUPS, type AlsRagdollHandle } from '../engine/rapierAlsRagdoll'
export type { AlsRagdollHandle, AlsRagdollStartOptions, AlsRagdollImpulse } from '../engine/rapierAlsRagdoll'
import { Suspense, useCallback, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier } from '@react-three/rapier'
import type { RapierCollider, RapierRigidBody } from '@react-three/rapier'
import { Group } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createAlsAnimationInstance } from '../als/AlsAnimationInstance'
import type { AlsControlRigFootOffsetTrace } from '../als/AnimGraph/CR_Als'
import { AlsRemoteCharacter } from '../als/AlsRemoteCharacter'
import type { AlsCharacterSnapshot } from '../als/AlsCharacterSnapshot'
import { AlsSnapshotBuffer } from '../als/AlsSnapshotBuffer'
import {
  ALS_CAPSULE_RADIUS, ALS_STANDING_CAPSULE_HALF_HEIGHT, ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  resolveAlsMeshRootRelativeY,
} from '../als/AlsCharacter.hooks'
import { ALS_MANTLING_SETTINGS } from '../als/Settings/AlsMantlingSettings'
import { getWorldDeltaTime, type WorldTimeState } from '../engine/timeDilation'
import { ALS_ROLLING_MONTAGE } from '../als/AnimGraph/rolling'
import { ALS_ROLLING_SETTINGS } from '../als/Settings/AlsRollingSettings'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { createRapierAlsCapsuleSweep } from '../engine/rapierAlsCapsuleSweep'
import { createRapierAlsControlRigFootTrace } from '../engine/rapierAlsControlRigFootTrace'
import { setRapierAlsStanceCapsules } from '../engine/rapierAlsStanceCapsules'
import { ALS_MESH_COMPONENT_YAW_RADIANS, unrealYawDegreesToThreeRadians } from '../engine/unrealCoordinateSpace'
import { isPistolOverlayMode } from '../als/AnimGraph/overlayMode'
import { useSuspenseAlsCharacterGltf } from './AlsCharacterGltf.hooks'
import { PistolOverlayObject, RifleOverlayObject } from './AlsOverlayObjects'

export interface AlsRemoteActorProps {
  ragdollRef?: React.RefObject<AlsRagdollHandle | null>
  ragdollingSettings?: Partial<AlsRagdollingSettings>
  /** Own this in useMemo, push packets as they arrive. Exactly one actor consumes each buffer. */
  snapshots: AlsSnapshotBuffer
  /** Must return milliseconds in the snapshot timestamp domain. Defaults to performance.now(). */
  now?: () => number
  offset?: readonly [number, number, number]
  footIk?: boolean
  worldTime?: Readonly<WorldTimeState>
  /** Delivered once for each received actionSeq crossed by playback, including skipped poses. */
  onAction?: (snapshot: AlsCharacterSnapshot) => void
  onUnsupportedState?: (feature: string) => void
}
const clock = () => performance.now()
const origin = [0, 0, 0] as const
const warnUnsupported = (feature: string) => console.warn(`[AlsRemoteActor] Unsupported ${feature}`)

/** Full ALS graph, independent skeleton and kinematic collision capsule. Per remote cost:
 * one evaluator + pose/curve buffers + a skinned mesh (authored material-section draw calls)
 * + two capsules (one enabled). No controller,
 * local movement/floor/mantle sweeps, camera, audio, debug captures, or root-motion movement.
 * footIk=false removes foot terrain queries for distance LOD; the authored rig still evaluates.
 * Further LOD can throttle Animation/cull hidden actors, but must keep snapshot/action clocks
 * and collision current. No measured millisecond budget is claimed by this component.
 */
export function AlsRemoteActor({ snapshots, now = clock, offset = origin,
  footIk = true, worldTime, ragdollRef, ragdollingSettings, onAction, onUnsupportedState = warnUnsupported }: AlsRemoteActorProps) {
  const gltf = useSuspenseAlsCharacterGltf()
  // Cached materials/clips are shared; each remote (including ghosts) owns its skeleton.
  const scene = useMemo(() => clone(gltf.scene), [gltf.scene])
  const { rapier, world } = useRapier()
  const body = useRef<RapierRigidBody>(null)
  const standing = useRef<RapierCollider>(null)
  const crouching = useRef<RapierCollider>(null)
  // Render separately from Rapier's interpolated object: network interpolation already owns
  // presentation. This avoids smoothing snapshots a second time at fixed physics frequency.
  const root = useRef<Group>(null)
  const driver = useMemo(() => new AlsRemoteCharacter(ragdollingSettings), [ragdollingSettings])
  const sweep = useMemo(() => createRapierAlsCapsuleSweep({ world,
    Capsule: rapier.Capsule, Ray: rapier.Ray,
    resolveExcludeRigidBody: () => body.current,
    filterFlags: rapier.QueryFilterFlags.EXCLUDE_SENSORS,
  }), [world, rapier])
  const traceEnabled = useRef(footIk)
  const trace = useMemo(() => createRapierAlsControlRigFootTrace({ world,
    Ray: rapier.Ray, component: scene,
    queryFilterForChannel: () => ({ flags: rapier.QueryFilterFlags.EXCLUDE_SENSORS }),
    resolveExcludeRigidBody: () => body.current,
    getOwnerColliders: () => [standing.current, crouching.current].filter(
      (collider): collider is RapierCollider => collider !== null),
  }), [world, rapier, scene])
  const lodTrace = useMemo<AlsControlRigFootOffsetTrace>(
    () => (query) => traceEnabled.current ? trace(query) : null, [trace],
  )
  const animation = useMemo(() => createAlsAnimationInstance({
    scene, animations: gltf.animations, groundPredictionSweep: sweep,
    controlRigFootTrace: lodTrace, publishDiagnostics: false,
  }), [scene, gltf.animations, sweep, lodTrace])
  const ragdoll = useAlsRagdoll(driver.character, animation, body, standing, crouching, ragdollRef, worldTime)
  const warned = useRef(new Set<string>())
  const active = useRef(false)
  const cosmeticRagdoll = useRef(false)
  const isRifleVisible = useCallback(
    () => active.current && driver.controls.overlayMode === 'Rifle', [driver],
  )
  const isPistolVisible = useCallback(
    () => active.current && isPistolOverlayMode(driver.controls.overlayMode), [driver],
  )
  const driverSnapshot = useRef<AlsCharacterSnapshot | null>(null)
  const mantleSettings = useRef<(typeof ALS_MANTLING_SETTINGS)[keyof typeof ALS_MANTLING_SETTINGS] | undefined>(undefined)

  useFrame(() => {
    traceEnabled.current = footIk
    if (!body.current || !root.current) return
    if (ragdoll.active) { cosmeticRagdoll.current = true; return }
    if (cosmeticRagdoll.current && driver.character.locomotionAction === 'GettingUp') {
      // A consumer-triggered cosmetic get-up owns presentation until its authored notify ends.
      // No state is sent back to the network actor.
      const position = body.current.translation()
      root.current.position.set(position.x, position.y + resolveAlsMeshRootRelativeY(
        driver.character.stance, driver.character.locomotionMode), position.z)
      root.current.rotation.y = unrealYawDegreesToThreeRadians(driver.character.actorYawAngle)
      root.current.updateWorldMatrix(true, true)
      return
    }
    cosmeticRagdoll.current = false
    const frame = snapshots.sample(now())
    if (!frame) {
      active.current = false
      standing.current?.setEnabled(false)
      crouching.current?.setEnabled(false)
      root.current.visible = false
      return
    }
    const firstFrame = !active.current
    active.current = true
    const state = frame.state
    driverSnapshot.current = state
    state.pos = state.pos.map((value, axis) => value + offset[axis]) as [number, number, number]
    const result = driver.apply(state)
    for (const feature of result.unsupported) {
      if (!warned.current.has(feature)) { warned.current.add(feature); onUnsupportedState(feature) }
    }
    if (result.jumped) animation.jump()
    for (const event of frame.actions) {
      onAction?.(event)
      // A frame hitch may cross an entire old action. Deliver its event without resurrecting
      // a montage that the current replicated state says has already finished.
      if (event.actionSeq !== state.actionSeq || event.action !== state.action) continue
      if (event.action === 'roll') animation.rollingMontage.Montage_Play(
        ALS_ROLLING_SETTINGS.Montage, event.animation?.rolling
          ? event.animation.rolling.playRate / ALS_ROLLING_MONTAGE.RateScale : 1.3)
      if (event.action === 'mantle') {
        const settings = Object.values(ALS_MANTLING_SETTINGS).find(
          (candidate) => candidate.Name === event.animation?.mantle?.settings)
        if (settings) {
          mantleSettings.current = settings
          animation.mantlingMontage.play(settings, event.animation!.mantle!.position)
        } else if (!warned.current.has('mantle metadata')) {
          warned.current.add('mantle metadata')
          onUnsupportedState('mantle metadata: forward snapshot.animation.mantle to select the authored montage')
        }
      }
    }
    if (state.action !== 'mantle' && mantleSettings.current) {
      animation.mantlingMontage.montageStop(mantleSettings.current, 0.2)
      mantleSettings.current = undefined
    }
    setRapierAlsStanceCapsules(standing.current, crouching.current, driver.character.stance)
    if (firstFrame) body.current.setTranslation({ x: state.pos[0], y: state.pos[1], z: state.pos[2] }, true)
    body.current.setNextKinematicTranslation({ x: state.pos[0], y: state.pos[1], z: state.pos[2] })
    root.current.visible = true
    root.current.position.set(state.pos[0], state.pos[1] + resolveAlsMeshRootRelativeY(
      driver.character.stance, driver.character.locomotionMode), state.pos[2])
    root.current.rotation.y = unrealYawDegreesToThreeRadians(state.actorYaw)
    root.current.updateWorldMatrix(true, true)
  }, ALS_FRAME_PRIORITY.Character)

  useFrame((_, deltaRealTime) => {
    const delta = worldTime ? getWorldDeltaTime(worldTime, deltaRealTime) : deltaRealTime
    if (!active.current) return
    // Montage time comes from the same interpolated frame as position, including slow motion.
    const mantle = mantleSettings.current
    // Refresh advances the montage once, so the caller-provided clock is positioned before it.
    const snapshot = driverSnapshot.current?.animation?.mantle?.position
    if (mantle && snapshot !== undefined) {
      animation.mantlingMontage.montageSetPosition(mantle, Math.max(0, snapshot - delta * mantle.Montage.RateScale))
    }
    const rolling = driverSnapshot.current?.animation?.rolling
    if (rolling) animation.setRollingPosition(Math.max(0, rolling.position - delta * rolling.playRate))
    if (ragdoll.active || cosmeticRagdoll.current) {
      driver.controls.locomotionAction = driver.character.locomotionAction
      driver.controls.locomotionMode = driver.character.locomotionMode
    }
    animation.refresh(delta, driver.controls)
    for (const event of animation.getUpMontage.takeNotifyEvents()) {
      if (event.notifyEventType === 'Begin') notifyAlsAnimNotifyStateSetLocomotionActionBegin(driver.character, event)
      else notifyAlsAnimNotifyStateSetLocomotionActionEnd(driver.character, event)
    }
    // Drain authored events, but never let montage notifies acquire character/movement authority.
    animation.mantlingMontage.takeNotifyEvents()
    animation.rollingMontage.takeNotifyEvents()
    animation.rollingMontage.ConsumeExtractedRootMotion()
    animation.dispatchQueuedFootstepEffectsEvents(() => {})
    animation.dispatchQueuedAnimEvents({ StartCameraShake: () => {} })
  }, ALS_FRAME_PRIORITY.Animation)

  return <>
    <RigidBody ref={body} type="kinematicPosition" colliders={false} lockRotations canSleep={false}>
      <CapsuleCollider collisionGroups={ALS_CHARACTER_COLLISION_GROUPS} ref={standing} args={[ALS_STANDING_CAPSULE_HALF_HEIGHT - ALS_CAPSULE_RADIUS, ALS_CAPSULE_RADIUS]} friction={0} />
      <CapsuleCollider collisionGroups={ALS_CHARACTER_COLLISION_GROUPS} ref={crouching} args={[ALS_CROUCHING_CAPSULE_HALF_HEIGHT - ALS_CAPSULE_RADIUS, ALS_CAPSULE_RADIUS]}
        position={[0, ALS_CROUCHING_CAPSULE_HALF_HEIGHT - ALS_STANDING_CAPSULE_HALF_HEIGHT, 0]} friction={0} />
    </RigidBody>
    <group ref={root} visible={false}>
      <group rotation-y={ALS_MESH_COMPONENT_YAW_RADIANS}><primitive object={scene} dispose={null} /></group>
      <Suspense fallback={null}>
        <RifleOverlayObject characterScene={scene} isVisible={isRifleVisible} />
      </Suspense>
      <Suspense fallback={null}>
        <PistolOverlayObject characterScene={scene} isVisible={isPistolVisible} />
      </Suspense>
    </group>
  </>
}
