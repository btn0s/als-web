import { SkeletalJointConstraint, SkeletalSolverBody } from './chaosJointConstraint'
import { JointData, RigidBodyDesc, type RigidBody, type World } from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { ALS_PHYSICS_ASSET, compileBody, compileConstraint } from './rapierAlsPhysicsAsset'
import type { PhysicsBoneWorldPose } from './physicsPoseBridge'

export interface AlsRagdollImpulse {
  /** Physics-asset bone name, e.g. head, spine_03 or pelvis. */
  boneName: string
  /** Three.js WORLD space, kg m/s. */
  impulse: { x: number; y: number; z: number }
  /** Optional world point in metres; omission applies at the body's centre of mass. */
  location?: { x: number; y: number; z: number }
  /** Optional WORLD angular impulse, kg m²/s. */
  torqueImpulse?: { x: number; y: number; z: number }
}
export interface AlsRagdollStartOptions {
  initialImpulse?: AlsRagdollImpulse
}
export interface AlsRagdollHandle {
  StartRagdolling(options?: AlsRagdollStartOptions): boolean
  StopRagdolling(): boolean
  AddImpulse(impulse: AlsRagdollImpulse): boolean
  readonly active: boolean
  /** Mutable sample, three.js world metres and metres/second. */
  readonly pelvis: { position: Vector3; velocity: Vector3 }
}
export const ALS_RAGDOLL_COLLISION_GROUPS = (0x0004 << 16) | 0xfffd
export const ALS_CHARACTER_COLLISION_GROUPS = (0x0002 << 16) | 0xfffb

export function validateRagdollImpulse(input: AlsRagdollImpulse) {
  if (!ALS_PHYSICS_ASSET.bodies.some(b => b.boneName === input.boneName && b.boneName !== 'root')) return false
  return [input.impulse, input.location, input.torqueImpulse].every(v => !v || [v.x, v.y, v.z].every(Number.isFinite))
}
export class RapierAlsRagdoll {
  readonly bodies = new Map<string, RigidBody>()
  readonly poses = new Map<string, PhysicsBoneWorldPose>()
  private joints: SkeletalJointConstraint[] = []
  private solverBodies = new Map<string, SkeletalSolverBody>()
  private iterations = 0
  readonly world: World
  constructor(world: World) { this.world = world }
  start(poses: ReadonlyMap<string, PhysicsBoneWorldPose>, velocity: { x: number; y: number; z: number }) {
    if (this.bodies.size) return
    try {
      for (const asset of ALS_PHYSICS_ASSET.bodies) {
        const pose = poses.get(asset.boneName)
        if (!pose) throw new Error(`Missing ragdoll bone ${asset.boneName}`)
        const p = pose.translation
        const compiled = compileBody(asset)
        const desc = compiled.kinematic ? RigidBodyDesc.kinematicPositionBased() : RigidBodyDesc.dynamic()
        const body = this.world.createRigidBody(desc
          .setTranslation(p.x, p.y, p.z).setRotation(pose.rotation)
          .setLinvel(velocity.x, velocity.y, velocity.z)
          .setCcdEnabled(compiled.settings.use_ccd)
          .setLinearDamping(compiled.settings.linear_damping).setAngularDamping(compiled.settings.angular_damping)
          .setGravityScale(compiled.settings.enable_gravity ? 1 : 0)
          .setAdditionalMassProperties(compiled.mass, compiled.centerOfMass, compiled.principalInertia, compiled.inertiaFrame))
        this.bodies.set(asset.boneName, body)
        for (const shape of compiled.shapes) {
          this.world.createCollider(shape.descriptor.setCollisionGroups(ALS_RAGDOLL_COLLISION_GROUPS), body)
        }
        body.recomputeMassPropertiesFromColliders()
        this.solverBodies.set(asset.boneName, new SkeletalSolverBody(body))
        this.iterations = Math.max(this.iterations, compiled.settings.position_solver_iteration_count)
      }
      for (const asset of ALS_PHYSICS_ASSET.constraints) {
        const c = compileConstraint(asset), child = this.solverBodies.get(c.body1), parent = this.solverBodies.get(c.body2)
        if (!child || !parent) throw new Error(`Missing PA_Als constraint body ${c.body1}/${c.body2}`)
        this.joints.push(new SkeletalJointConstraint(c, parent, child))
      }
      // Rapier contact suppression is per connected pair. A free generic joint adds no
      // constraint rows, but honours PA_Als's additional disabled collision pairs.
      for (const pair of ALS_PHYSICS_ASSET.collisionDisablePairs) {
        const a = this.bodies.get(pair.firstBone), b = this.bodies.get(pair.secondBone)
        if (a && b) this.world.createImpulseJoint(JointData.generic(
          { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0 as import('@dimforge/rapier3d-compat').JointAxesMask), a, b, true).setContactsEnabled(false)
      }
    } catch (error) { this.dispose(); throw error }
  }
  AddImpulse(input: AlsRagdollImpulse) {
    if (!validateRagdollImpulse(input)) return false
    const body = this.bodies.get(input.boneName)
    if (!body) return false
    if (input.location) body.applyImpulseAtPoint(input.impulse, input.location, true)
    else body.applyImpulse(input.impulse, true)
    if (input.torqueImpulse) body.applyTorqueImpulse(input.torqueImpulse, true)
    return true
  }
  step(_dt: number, targets?: ReadonlyMap<string, PhysicsBoneWorldPose>, stiffness = 0) {
    for (const [name, solver] of this.solverBodies) {
      if (solver.body.isKinematic()) {
        const target = targets?.get(name)
        if (target) {
          solver.body.setNextKinematicTranslation(target.translation)
          solver.body.setNextKinematicRotation(target.rotation)
        }
      }
      solver.begin()
    }
    for (const joint of this.joints) {
      const a = targets?.get(joint.c.body1), b = targets?.get(joint.c.body2)
      // USkeletalMeshComponent::UpdateRBJointMotors: parent connector inverse × child
      // connector, including all intervening graphics bones resolved by the pose bridge.
      const target = a && b ? new Quaternion().copy(b.rotation).multiply(joint.c.frame2.rotation).invert()
        .multiply(new Quaternion().copy(a.rotation).multiply(joint.c.frame1.rotation)) : null
      joint.begin(target, stiffness)
    }
  }
  afterPhysics(dt: number) {
    if (!(dt > 0)) return
    for (const solver of this.solverBodies.values()) solver.predict()
    for (let i = 0; i < this.iterations; i++) for (const joint of this.joints) joint.solve(dt)
    for (const solver of this.solverBodies.values()) solver.publish(dt, true)
    for (const joint of this.joints) joint.project()
    for (const solver of this.solverBodies.values()) solver.publish(dt, false)
  }
  readPoses() {
    for (const [name, body] of this.bodies) if (body.isDynamic()) this.poses.set(name, { translation: body.translation(), rotation: body.rotation() })
    return this.poses
  }
  dispose() {
    for (const body of this.bodies.values()) if (body.isValid()) this.world.removeRigidBody(body)
    this.bodies.clear(); this.poses.clear(); this.joints = []; this.solverBodies.clear(); this.iterations = 0
  }
}
