import { ColliderDesc } from '@dimforge/rapier3d-compat'
import { Matrix4, Quaternion, Vector3 } from 'three'
import source from '../../scripts/extract-als/physics-asset.json?raw'
import runtimeSource from '../../scripts/extract-als/physics-asset-runtime.json?raw'

type UVector = { X: number; Y: number; Z: number }
type UQuat = UVector & { W: number }
type Rotator = { Pitch: number; Yaw: number; Roll: number }
type Value<T> = { value: T | null }
interface Shape {
  type: 'FKSphylElem' | 'FKSphereElem' | 'FKBoxElem'
  localTransform: { translationCm: UVector; rotationDegrees: Rotator | null }
  dimensions: { radiusCm: number; cylinderLengthCm: number; sizeCm: UVector }
}
interface Body { boneName: string; shapes: Shape[] }
interface Frame { positionCm: Value<UVector>; primaryAxis: Value<UVector>; secondaryAxis: Value<UVector> }
interface Constraint { jointName: string; body1: string; body2: string; frames: { body1: Frame; body2: Frame } }
interface SoftLimit { Stiffness: number; Damping: number; bSoftConstraint: boolean; Restitution: number; ContactDistance: number }
interface Drive { Stiffness: number; Damping: number; MaxForce: number; bEnablePositionDrive: boolean; bEnableVelocityDrive: boolean }
export interface ConstraintProfile {
  LinearLimit: SoftLimit & { XMotion: string; YMotion: string; ZMotion: string; Limit: number }
  ConeLimit: SoftLimit & { Swing1Motion: string; Swing2Motion: string; Swing1LimitDegrees: number; Swing2LimitDegrees: number }
  TwistLimit: SoftLimit & { TwistMotion: string; TwistLimitDegrees: number }
  AngularDrive: { TwistDrive: Drive; SwingDrive: Drive; SlerpDrive: Drive; AngularDriveMode: string; bAccelerationMode: boolean }
  bDisableCollision: boolean; bParentDominates: boolean; bEnableMassConditioning: boolean
  bEnableProjection: boolean; ProjectionLinearAlpha: number; ProjectionAngularAlpha: number
  ProjectionLinearTolerance: number; ProjectionAngularTolerance: number
}
interface NativeInstance {
  Pos1: UVector; Pos2: UVector; PriAxis1: UVector; PriAxis2: UVector; SecAxis1: UVector; SecAxis2: UVector
  ProfileInstance: ConstraintProfile
}
interface NativeBody {
  boneName: string; massKg: number; physicsType: string; inertiaKgCm2: UVector
  massSpaceLocal: { Translation: UVector; Rotation: UQuat }
  defaultInstance: { linear_damping: number; angular_damping: number; use_ccd: boolean; enable_gravity: boolean; position_solver_iteration_count: number }
}
export const ALS_PHYSICS_ASSET = JSON.parse(source) as {
  canonicalSha256: string; bodies: Body[]; constraints: Constraint[]
  collisionDisablePairs: { firstBone: string; secondBone: string }[]
}
export const ALS_PHYSICS_RUNTIME = JSON.parse(runtimeSource) as {
  engineVersion: string; assetCanonicalSha256: string
  bodies: NativeBody[]; constraints: { jointName: string; resolvedInstance: NativeInstance }[]
  defaultPhysicalMaterial: { friction: number; restitution: number }
}
if (ALS_PHYSICS_RUNTIME.assetCanonicalSha256 !== ALS_PHYSICS_ASSET.canonicalSha256) {
  throw new Error('PA_Als native runtime export does not match the asset extraction')
}
export const ueVector = (v: UVector, scale = 1) => new Vector3(v.X * scale, v.Z * scale, v.Y * scale)
export const ueQuaternion = (q: UQuat) => new Quaternion(-q.X, -q.Z, -q.Y, q.W).normalize()
/** FRotator::Quaternion, then reflected-basis conjugation C R C. */
export function ueRotation(r: Rotator | null) {
  if (!r) return new Quaternion()
  const d = Math.PI / 360
  const sp = Math.sin(r.Pitch * d), cp = Math.cos(r.Pitch * d)
  const sy = Math.sin(r.Yaw * d), cy = Math.cos(r.Yaw * d)
  const sr = Math.sin(r.Roll * d), cr = Math.cos(r.Roll * d)
  return new Quaternion(sr * cp * cy - cr * sp * sy,
    -(cr * cp * sy - sr * sp * cy), cr * sp * cy + sr * cp * sy,
    cr * cp * cy + sr * sp * sy).normalize()
}
export function compileConstraintFrame(frame: Frame, defaults: { position: UVector; primary: UVector; secondary: UVector }) {
  // Preserve authored float precision; absent fields use the native FConstraintInstance export.
  const x = ueVector(frame.primaryAxis.value ?? defaults.primary).normalize()
  const y = ueVector(frame.secondaryAxis.value ?? defaults.secondary).normalize()
  const z = new Vector3().crossVectors(x, y).normalize()
  return { position: ueVector(frame.positionCm.value ?? defaults.position, .01),
    rotation: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)) }
}
export function compileConstraint(c: Constraint) {
  const native = ALS_PHYSICS_RUNTIME.constraints.find(n => n.jointName === c.jointName)?.resolvedInstance
  if (!native) throw new Error(`Missing native constraint ${c.jointName}`)
  const p = native.ProfileInstance
  return { body1: c.body1, body2: c.body2, profile: p,
    frame1: compileConstraintFrame(c.frames.body1, { position: native.Pos1, primary: native.PriAxis1, secondary: native.SecAxis1 }),
    frame2: compileConstraintFrame(c.frames.body2, { position: native.Pos2, primary: native.PriAxis2, secondary: native.SecAxis2 }),
    // This right-handed connector basis preserves UE's secondary Y as local Y.
    limits: [p.TwistLimit.TwistLimitDegrees, p.ConeLimit.Swing2LimitDegrees,
      p.ConeLimit.Swing1LimitDegrees].map(d => d * Math.PI / 180),
  }
}
export function compileBody(body: Body) {
  const native = ALS_PHYSICS_RUNTIME.bodies.find(b => b.boneName === body.boneName)
  if (!native || !(native.massKg > 0) || !native.massSpaceLocal) {
    throw new Error(`Missing native mass/inertia for ${body.boneName}`)
  }
  const material = ALS_PHYSICS_RUNTIME.defaultPhysicalMaterial
  const shapes = body.shapes.map(s => {
    const radius = s.dimensions.radiusCm * .01
    const length = s.dimensions.cylinderLengthCm * .01
    const size = s.dimensions.sizeCm && ueVector(s.dimensions.sizeCm, .01)
    const descriptor = s.type === 'FKSphylElem' ? ColliderDesc.capsule(length / 2, radius)
      : s.type === 'FKSphereElem' ? ColliderDesc.ball(radius) : ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
    const p = ueVector(s.localTransform.translationCm, .01)
    descriptor.setTranslation(p.x, p.y, p.z).setRotation(ueRotation(s.localTransform.rotationDegrees))
      .setMass(0).setFriction(material.friction).setRestitution(material.restitution)
    return { descriptor }
  })
  return { boneName: body.boneName, mass: native.massKg, massSource: 'native-runtime' as const,
    centerOfMass: ueVector(native.massSpaceLocal.Translation, .01),
    principalInertia: ueVector(native.inertiaKgCm2, .0001),
    inertiaFrame: ueQuaternion(native.massSpaceLocal.Rotation),
    kinematic: native.physicsType === 'PHYS_TYPE_KINEMATIC',
    settings: native.defaultInstance, shapes }
}
