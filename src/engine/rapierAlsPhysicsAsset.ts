import { ColliderDesc } from '@dimforge/rapier3d-compat'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import source from '../../scripts/extract-als/physics-asset.json?raw'

type UVector = { X: number; Y: number; Z: number }
type Rotator = { Pitch: number; Yaw: number; Roll: number }
type Value<T> = { value: T | null }
interface Shape {
  type: 'FKSphylElem' | 'FKSphereElem' | 'FKBoxElem'
  localTransform: { translationCm: UVector; rotationDegrees: Rotator }
  dimensions: { radiusCm: number; cylinderLengthCm: number; sizeCm: UVector }
}
interface Body {
  boneName: string
  shapes: Shape[]
  massAndMaterial: { effectiveMassKg: Value<number> }
}
interface Frame { positionCm: Value<UVector>; primaryAxis: Value<UVector>; secondaryAxis: Value<UVector> }
interface Constraint {
  body1: string; body2: string
  frames: { body1: Frame; body2: Frame }
  limits: {
    cone: { Swing1LimitDegrees: Value<number>; Swing2LimitDegrees: Value<number>; Swing1Motion: Value<string>; Swing2Motion: Value<string> }
    twist: { TwistLimitDegrees: Value<number>; TwistMotion: Value<string> }
  }
}
export const ALS_PHYSICS_ASSET = JSON.parse(source) as {
  bodies: Body[]; constraints: Constraint[]
  collisionDisablePairs: { firstBone: string; secondBone: string }[]
}
export const ueVector = (v: UVector, scale = 1) => new Vector3(v.X * scale, v.Z * scale, v.Y * scale)
/** FRotator::Quaternion, then reflected-basis conjugation C R C. */
export function ueRotation(r: Rotator) {
  const d = Math.PI / 360
  const sp = Math.sin(r.Pitch * d), cp = Math.cos(r.Pitch * d)
  const sy = Math.sin(r.Yaw * d), cy = Math.cos(r.Yaw * d)
  const sr = Math.sin(r.Roll * d), cr = Math.cos(r.Roll * d)
  return new Quaternion(sr * cp * cy - cr * sp * sy,
    -(cr * cp * sy - sr * sp * cy), cr * sp * cy + sr * cp * sy,
    cr * cp * cy + sr * sp * sy).normalize()
}
export function compileConstraintFrame(frame: Frame) {
  // UE FConstraintInstance defaults: zero anchor, primary X, secondary Y.
  const x = ueVector(frame.primaryAxis.value ?? { X: 1, Y: 0, Z: 0 }).normalize()
  const y = ueVector(frame.secondaryAxis.value ?? { X: 0, Y: 1, Z: 0 }).normalize()
  const z = new Vector3().crossVectors(x, y).normalize()
  return { position: ueVector(frame.positionCm.value ?? { X: 0, Y: 0, Z: 0 }, .01),
    rotation: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)) }
}
export function compileConstraint(c: Constraint) {
  const limit = (motion: Value<string>, degrees: Value<number>) =>
    motion.value === 'ACM_Free' ? Math.PI : motion.value === 'ACM_Locked' ? 0 : (degrees.value ?? 45) * Math.PI / 180
  return { body1: c.body1, body2: c.body2,
    frame1: compileConstraintFrame(c.frames.body1), frame2: compileConstraintFrame(c.frames.body2),
    // Frame Y is reflected UE secondary Y; frame Z is its right-handed cross product.
    limits: [limit(c.limits.twist.TwistMotion, c.limits.twist.TwistLimitDegrees),
      limit(c.limits.cone.Swing2Motion, c.limits.cone.Swing2LimitDegrees),
      limit(c.limits.cone.Swing1Motion, c.limits.cone.Swing1LimitDegrees)] as const }
}
export function compileBody(body: Body) {
  const shapes = body.shapes.map(s => {
    const radius = s.dimensions.radiusCm * .01
    const length = s.dimensions.cylinderLengthCm * .01
    const size = s.dimensions.sizeCm && ueVector(s.dimensions.sizeCm, .01)
    const volume = s.type === 'FKSphylElem' ? Math.PI * radius ** 2 * length + 4 / 3 * Math.PI * radius ** 3
      : s.type === 'FKSphereElem' ? 4 / 3 * Math.PI * radius ** 3 : size.x * size.y * size.z
    const descriptor = s.type === 'FKSphylElem' ? ColliderDesc.capsule(length / 2, radius)
      : s.type === 'FKSphereElem' ? ColliderDesc.ball(radius) : ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
    const p = ueVector(s.localTransform.translationCm, .01)
    descriptor.setTranslation(p.x, p.y, p.z).setRotation(ueRotation(s.localTransform.rotationDegrees))
    return { descriptor, volume }
  })
  const volume = shapes.reduce((v, s) => v + s.volume, 0)
  // NonParity: PA_Als extraction explicitly lacks effective UE mass/material defaults.
  // Original fallback: uniform 1000 kg/m³; never advertise this as authored Chaos mass.
  const mass = body.massAndMaterial.effectiveMassKg.value ?? volume * 1000
  for (const s of shapes) s.descriptor.setMass(mass * s.volume / volume)
  return { boneName: body.boneName, mass, massSource: body.massAndMaterial.effectiveMassKg.value === null ? 'density-fallback' : 'asset', shapes }
}

/** Rapier JS exposes no independently rotated generic-joint frames. Spherical joints own
 * translation; this angular velocity projection enforces authored frame-space limits.
 * NonParity: independent Euler limits approximate Chaos's elliptical swing cone. */
export function angularLimitError(relative: Quaternion, limits: readonly number[]) {
  const e = new Euler().setFromQuaternion(relative, 'XYZ')
  return new Vector3(...[e.x, e.y, e.z].map((v, i) => v - Math.max(-limits[i], Math.min(limits[i], v))) as [number, number, number])
}
