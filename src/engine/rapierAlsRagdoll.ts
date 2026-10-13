import { JointData, RigidBodyDesc, type RigidBody, type World } from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { ALS_PHYSICS_ASSET, angularLimitError, compileBody, compileConstraint } from './rapierAlsPhysicsAsset'
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
  /** Consumer-owned death: StopRagdolling is ignored until ResetRagdolling/unmount. */
  keepRagdoll?: boolean
}
export interface AlsRagdollHandle {
  StartRagdolling(options?: AlsRagdollStartOptions): boolean
  StopRagdolling(): boolean
  ResetRagdolling(): void
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
  private joints: { constraint: ReturnType<typeof compileConstraint>; a: RigidBody; b: RigidBody }[] = []
  readonly world: World
  constructor(world: World) { this.world = world }
  start(poses: ReadonlyMap<string, PhysicsBoneWorldPose>, velocity: { x: number; y: number; z: number }) {
    if (this.bodies.size) return
    try {
      for (const asset of ALS_PHYSICS_ASSET.bodies) {
        // PA_Als root is a kinematic query body, not part of the simulated pelvis hierarchy.
        if (asset.boneName === 'root') continue
        const pose = poses.get(asset.boneName)
        if (!pose) throw new Error(`Missing ragdoll bone ${asset.boneName}`)
        const p = pose.translation
        const body = this.world.createRigidBody(RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z).setRotation(pose.rotation)
          .setLinvel(velocity.x, velocity.y, velocity.z).setCcdEnabled(true)
          .setAdditionalSolverIterations(8))
        this.bodies.set(asset.boneName, body)
        for (const shape of compileBody(asset).shapes) {
          this.world.createCollider(shape.descriptor.setCollisionGroups(ALS_RAGDOLL_COLLISION_GROUPS), body)
        }
      }
      for (const asset of ALS_PHYSICS_ASSET.constraints) {
        const c = compileConstraint(asset), a = this.bodies.get(c.body1), b = this.bodies.get(c.body2)
        if (!a || !b) continue
        this.world.createImpulseJoint(JointData.spherical(c.frame1.position, c.frame2.position), a, b, true).setContactsEnabled(false)
        this.joints.push({ constraint: c, a, b })
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
  step(dt: number, targets?: ReadonlyMap<string, PhysicsBoneWorldPose>, stiffness = 0) {
    for (const { constraint: c, a, b } of this.joints) {
      if (a.isSleeping() && b.isSleeping()) continue
      const qa = new Quaternion().copy(a.rotation()).multiply(c.frame1.rotation)
      const qb = new Quaternion().copy(b.rotation()).multiply(c.frame2.rotation)
      const relative = qb.clone().invert().multiply(qa)
      const error = angularLimitError(relative, c.limits)
      const targetA = targets?.get(c.body1), targetB = targets?.get(c.body2)
      if (targetA && targetB && stiffness > 0) {
        const target = new Quaternion().copy(targetB.rotation).multiply(c.frame2.rotation).invert()
          .multiply(new Quaternion().copy(targetA.rotation).multiply(c.frame1.rotation))
        const delta = target.invert().multiply(relative)
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
        // Native stiffness is kg cm²/s²; convert to SI. Original damped velocity solver.
        error.addScaledVector(new Vector3(delta.x, delta.y, delta.z), Math.min(1, stiffness * .0001 * dt))
      }
      if (error.lengthSq() < 1e-9) continue
      const correction = error.multiplyScalar(Math.min(12, .2 / Math.max(dt, .001))).applyQuaternion(qb)
      correction.clampLength(0, 8)
      const total = a.mass() + b.mass()
      a.setAngvel(new Vector3().copy(a.angvel()).addScaledVector(correction, -b.mass() / total), false)
      b.setAngvel(new Vector3().copy(b.angvel()).addScaledVector(correction, a.mass() / total), false)
    }
  }
  readPoses() {
    for (const [name, body] of this.bodies) this.poses.set(name, { translation: body.translation(), rotation: body.rotation() })
    return this.poses
  }
  dispose() {
    for (const body of this.bodies.values()) if (body.isValid()) this.world.removeRigidBody(body)
    this.bodies.clear(); this.poses.clear(); this.joints = []
  }
}
