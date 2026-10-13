import { Ball, RigidBodyType, type Collider, type RigidBody, type World } from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import type { AlsCharacter } from '../als/AlsCharacter'
import { setLocomotionAction, setLocomotionMode } from '../als/AlsCharacter'
import { refreshRagdolling, startRagdollingImplementation, stopRagdollingImplementation,
  type AlsRagdollingLifecycleAdapter } from '../als/AlsCharacter_Actions'
import type { AlsAnimationInstance } from '../als/AlsAnimationInstance'
import { RapierAlsRagdoll, validateRagdollImpulse, type AlsRagdollHandle } from './rapierAlsRagdoll'
import { threeToUnrealVector as toAls, unrealToThreeVector as toThree } from './unrealCoordinateSpace'
import type { PhysicsBoneWorldPose } from './physicsPoseBridge'

interface Options {
  world: World
  character: AlsCharacter
  animation: AlsAnimationInstance
  owner: () => RigidBody | null
  colliders: () => (Collider | null)[]
  halfHeight: () => number
  radius: number
}
/** Local and cosmetic-remote ownership use the same ALS lifecycle. UE networking, URO and
 * mesh attachment bookkeeping have no equivalent here: pose composition uses world matrices
 * directly, so the skeleton can remain mounted while its capsule follows the pelvis. */
export function createAlsRagdollRuntime(o: Options) {
  const physics = new RapierAlsRagdoll(o.world)
  const pose = o.animation.ragdolling
  let target = { x: 0, y: 0, z: 0 }, keep = false, stiffness = 0
  let savedPelvis: PhysicsBoneWorldPose | undefined
  let selectedGetUpMontage: string | null = null
  const noOp = () => {}
  const body = (value: unknown) => value as RigidBody
  const teleport = (location: { x: number; y: number; z: number }) => {
    const owner = o.owner()
    if (!owner) return
    owner.setBodyType(RigidBodyType.KinematicPositionBased, true)
    owner.setTranslation(toThree(location), true)
    owner.setNextKinematicTranslation(toThree(location))
  }
  const lifecycle: AlsRagdollingLifecycleAdapter = {
    GetBodyInstance: name => physics.bodies.get(name) ?? (pose.boneNames.includes(name) ? name : null),
    ReadBodyState: value => ({ Location: toAls(body(value).translation()), LinearVelocity: toAls(body(value).linvel()) }),
    IsRigidBody: value => typeof value !== 'string',
    GetBodyLocation: value => toAls(body(value).translation()),
    AddForce: (value, force) => body(value).addForce(new Vector3().copy(toThree(force)).multiplyScalar(body(value).mass()), true),
    SetBodyLinearVelocity: (value, velocity) => body(value).setLinvel(toThree(velocity), true),
    ForEachBodyBelow: (_name, _include, _skip, visitor) => physics.bodies.forEach(visitor),
    SetUpdateJointsFromAnimation: noOp, IsRunningParallelEvaluation: () => false,
    GetBoneSpaceTransformCount: () => pose.bridge.rig.boneCount, UpdateRBJointMotors: noOp,
    Montage_Stop: duration => { o.animation.StopMontages(duration) },
    // Partial: selection is faithful, but get-up montage root motion/notify ownership is
    // not yet integrated. Never claim GettingUp or block input for a montage we didn't play.
    Montage_Play: montage => { selectedGetUpMontage = montage; return 0 },
    SetNetworkSmoothingMode: noOp, SetIgnoreClientMovementErrorChecksAndCorrection: noOp,
    DetachMeshKeepWorld: noOp, AttachMeshToCapsuleKeepWorld: noOp,
    SetCapsuleCollisionEnabled: mode => o.colliders().forEach((c, index) => c?.setEnabled(mode !== 'NoCollision' && index === (o.character.stance === 'Crouching' ? 1 : 0))),
    SetMeshCollisionObjectType: noOp, SetMeshCollisionEnabled: noOp,
    SetMeshSimulatePhysics: enabled => {
      if (enabled) {
        physics.start(pose.bridge.captureWorldPoses(pose.boneNames), toThree(o.character.locomotionState.velocity))
        pose.physics = () => physics.readPoses(); pose.active = true
      } else { pose.active = false; pose.physics = null; physics.dispose() }
    },
    SetAllMotorsAngularDriveParams: spring => { stiffness = spring },
    GetRagdollTargetLocation: () => target,
    SetRagdollTargetLocation: value => { target = { ...value } },
    ServerSetRagdollTargetLocation: noOp,
    GetActorLocation: () => toAls(o.owner()?.translation() ?? { x: 0, y: 0, z: 0 }),
    GetActorRotation: () => ({ Pitch: 0, Yaw: o.character.actorYawAngle, Roll: 0 }),
    SetActorLocationTeleport: teleport,
    SetActorLocationAndRotationTeleport: (location, rotation) => {
      teleport(location); o.character.actorYawAngle = rotation.Yaw
    },
    GetScaledCapsuleRadius: () => o.radius, GetScaledCapsuleHalfHeight: o.halfHeight,
    GetMovementCollisionObjectType: () => undefined, InitCollisionParams: noOp,
    SweepSingleByChannel: query => {
      const start = toThree(query.Start), end = toThree(query.End)
      const own = new Set(o.colliders().flatMap(c => c ? [c.handle] : []))
      for (const b of physics.bodies.values()) for (let i = 0; i < b.numColliders(); i++) own.add(b.collider(i).handle)
      const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
      const hit = o.world.castShape(start, { x: 0, y: 0, z: 0, w: 1 }, delta,
        new Ball(query.Radius), 0, 1, true, undefined, undefined, undefined, undefined,
        collider => !own.has(collider.handle) && !collider.isSensor())
      return hit ? { Location: toAls({ x: start.x + delta.x * hit.time_of_impact,
        y: start.y + delta.y * hit.time_of_impact, z: start.z + delta.z * hit.time_of_impact }) } : null
    },
    SetMovementMode: noOp, SetMovementModeLocked: locked => { o.character.movement.inputBlocked = locked },
    SnapshotFinalRagdollPose: () => pose.captureSnapshot(),
    GetPelvisSocketTransform: () => {
      savedPelvis = physics.readPoses().get('pelvis'); return savedPelvis
    },
    GetTransformRotation: value => {
      const q = (value as PhysicsBoneWorldPose).rotation
      const x = -q.x, y = -q.z, z = -q.y, w = q.w
      return { Pitch: Math.asin(Math.max(-1, Math.min(1, 2 * (z * x - w * y)))) * 180 / Math.PI,
        Yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI,
        Roll: Math.atan2(-2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * 180 / Math.PI }
    },
    RestoreMeshWorldTransformFromActorBaseOffsets: noOp,
    RefreshUpdateRateOptimizationsAfterRagdolling: noOp,
    RestoreFinalRagdollPosePelvisTransform: () => {
      if (savedPelvis) pose.restoreSnapshot(new Map([['pelvis', savedPelvis]]))
    },
    FlushServerMoves: noOp, ServerStartRagdolling: noOp, MulticastStartRagdolling: noOp,
    ServerStopRagdolling: noOp, MulticastStopRagdolling: noOp, ForceNetUpdate: noOp,
    OnRagdollingStarted: noOp, OnRagdollingEnded: noOp,
  }
  const input = { Character: o.character, Lifecycle: lifecycle,
    LocalRole: 'Authority' as const, bIsLocallyControlled: true, bHasValidController: true }
  const handle: AlsRagdollHandle = {
    get active() { return pose.active },
    pelvis: { position: new Vector3(), velocity: new Vector3() },
    StartRagdolling(options = {}) {
      if (!o.owner() || (options.initialImpulse && !validateRagdollImpulse(options.initialImpulse))) return false
      if (pose.active) {
        if (options.keepRagdoll) keep = true
        if (options.initialImpulse) o.character.ragdollingState.SpeedLimitFrameTimeRemaining = 0
        return options.initialImpulse ? physics.AddImpulse(options.initialImpulse) : false
      }
      if (!startRagdollingImplementation(input)) return false
      keep = options.keepRagdoll ?? false
      // Explicit downstream impulses are applied AFTER ALS's initial-speed clamp and must
      // survive the next eight frames; natural falls retain the native startup limiter.
      if (options.initialImpulse) {
        o.character.ragdollingState.SpeedLimitFrameTimeRemaining = 0
        physics.AddImpulse(options.initialImpulse)
      }
      return true
    },
    StopRagdolling() {
      if (keep) return pose.active
      return stopRagdollingImplementation(input) !== null
    },
    ResetRagdolling() {
      keep = false
      if (pose.active) {
        lifecycle.SetMeshSimulatePhysics(false)
        lifecycle.SetCapsuleCollisionEnabled('QueryAndPhysics')
        setLocomotionAction(o.character, null); setLocomotionMode(o.character, 'Grounded')
        o.character.movement.inputBlocked = false
      }
    },
    AddImpulse: impulse => physics.AddImpulse(impulse),
  }
  return { handle,
    get selectedGetUpMontage() { return selectedGetUpMontage },
    beforePhysics(dt: number) {
      if (!pose.active) return
      lifecycle.SetCapsuleCollisionEnabled('NoCollision')
      physics.step(dt, pose.targets, stiffness)
    },
    refresh(dt: number) {
      if (!pose.active) return
      refreshRagdolling({ ...input, DeltaTime: dt })
      const pelvis = physics.bodies.get('pelvis')!
      handle.pelvis.position.copy(pelvis.translation()); handle.pelvis.velocity.copy(pelvis.linvel())
      pose.speed = handle.pelvis.velocity.length()
    },
    dispose() { handle.ResetRagdolling(); physics.dispose() },
  }
}
