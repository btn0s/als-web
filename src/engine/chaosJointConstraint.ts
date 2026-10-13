import { Matrix3, Quaternion, Vector2, Vector3 } from 'three'
import type { RigidBody } from '@dimforge/rapier3d-compat'
import type { compileConstraint } from './rapierAlsPhysicsAsset'

/** Engine constraint substrate, not ALS policy. Mechanisms follow UE 5.7's
 * FPBDJointUtilities and FPBDJointSolver (swing/twist, point constraints and XPBD drives).
 * Original integration boundary: Rapier owns contact integration; this solver runs the
 * skeletal constraints after it. Contact/joint rows are not interleaved as in Chaos.
 * This distinction is recorded in parity coverage, rather than hiding it in tuned gains. */
export function decomposeSwingTwist(q: Quaternion) {
  const twist = new Quaternion(q.x, 0, 0, q.w)
  if (twist.lengthSq() < 1e-16) twist.identity()
  else twist.normalize()
  const swing = q.clone().multiply(twist.clone().invert()).normalize()
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w)
  return { swing, twist }
}
export function nearPointOnEllipse(p: Vector2, r: Vector2) {
  if (r.x >= r.y && Math.abs(p.y) < 1e-6) return new Vector2(Math.sign(p.x) * r.x, 0)
  if (r.x < r.y && Math.abs(p.x) < 1e-6) return new Vector2(0, Math.sign(p.y) * r.y)
  const rr = r.clone().multiply(r), rp = new Vector2(Math.abs(p.x), Math.abs(p.y)).multiply(r)
  let t = Math.max(rp.x - rr.x, rp.y - rr.y)
  const d = new Vector2()
  for (let i = 0; i < 20; i++) {
    d.set(1 / (t + rr.x), 1 / (t + rr.y))
    const f = rp.clone().multiply(d); f.multiply(f)
    const error = f.x + f.y - 1
    if (error < 1e-4) return rr.clone().multiply(p).multiply(d)
    t += error / (2 * f.dot(d))
  }
  const s = rr.clone().multiply(p).multiply(d)
  return s.divideScalar(s.clone().divide(r).length())
}
/** FPBDJointUtilities::GetEllipticalConeAxisErrorLocal. Returns the native
 * non-normalized constraint gradient and signed angular error, not Euler clamps. */
export function ellipticalConeError(relative: Quaternion, limitY: number, limitZ: number) {
  const { swing } = decomposeSwingTwist(relative)
  const axis = new Vector3(0, 0, 1)
  if (Math.abs(limitY - limitZ) < 1e-3) {
    const v = new Vector3(swing.x, swing.y, swing.z), size = v.length()
    return { axis: size > 1e-6 ? v.divideScalar(size) : axis,
      error: Math.max(0, 2 * Math.atan2(size, swing.w) - limitY) }
  }
  const angles = new Vector2(4 * Math.atan2(swing.y, 1 + swing.w), 4 * Math.atan2(swing.z, 1 + swing.w))
  const limits = new Vector2(limitY, limitZ)
  if (angles.clone().divide(limits).lengthSq() <= 1) return { axis, error: 0 }
  const point = nearPointOnEllipse(angles, limits)
  const n = point.clone().divide(limits.clone().multiply(limits))
  const r = new Vector3(0, Math.tan(point.x / 4), Math.tan(point.y / 4))
  const normal = new Vector3(0, n.x, n.y)
  const r2 = r.lengthSq(), a = 1 - r2, b = 1 / (1 + r2), v1 = 2 * a * b * b
  const v2 = new Vector3(a, 2 * r.z, -2 * r.y), rd = r.dot(normal)
  const dv1 = -4 * rd * (3 - r2) * b * b * b
  const dv2 = new Vector3(-2 * rd, 2 * normal.z, -2 * normal.y)
  const line = v2.clone().multiplyScalar(v1).sub(new Vector3(1, 0, 0))
  const surfaceNormal = dv2.multiplyScalar(v1).addScaledVector(v2, dv1).normalize()
  axis.crossVectors(line, surfaceNormal)
  const twistAxis = new Vector3(1, 0, 0).applyQuaternion(swing)
  return { axis, error: -new Vector3().crossVectors(line, axis).dot(twistAxis) }
}
export function rotationVector(q: Quaternion) {
  const shortest = q.clone().normalize()
  if (shortest.w < 0) shortest.set(-shortest.x, -shortest.y, -shortest.z, -shortest.w)
  const v = new Vector3(shortest.x, shortest.y, shortest.z), s = v.length()
  return s > 1e-12 ? v.multiplyScalar(2 * Math.atan2(s, shortest.w) / s) : v.multiplyScalar(2)
}
/** Scalar XPBD soft rotation row, FPBDJointSolver::ApplyRotationConstraintSoftDD. */
export function softRotationLambda(dt: number, k: number, d: number, acceleration: boolean,
  inverseInertia: number, angle: number, angularDelta: number, lambda: number) {
  if (!(inverseInertia > 0) || !(dt > 0)) return 0
  const massScale = acceleration ? 1 / inverseInertia : 1
  const s = massScale * k * dt * dt, damping = massScale * d * dt
  return (s * angle - damping * angularDelta - lambda) / (1 + (s + damping) * inverseInertia)
}

export class SkeletalSolverBody {
  readonly q = new Quaternion()
  readonly p = new Vector3()
  readonly initialQ = new Quaternion()
  readonly predictedQ = new Quaternion()
  readonly predictedP = new Vector3()
  readonly localCom: Vector3
  readonly principalInertia: Vector3
  readonly inertiaFrame: Quaternion
  readonly inverseMass: number
  readonly body: RigidBody
  constructor(body: RigidBody) {
    this.body = body
    this.localCom = new Vector3().copy(body.localCom())
    this.principalInertia = new Vector3().copy(body.principalInertia())
    this.inertiaFrame = new Quaternion().copy(body.principalInertiaLocalFrame())
    this.inverseMass = body.isDynamic() ? 1 / body.mass() : 0
  }
  begin() { this.initialQ.copy(this.body.rotation()) }
  predict() {
    this.q.copy(this.body.rotation()); this.p.copy(this.body.worldCom())
    this.predictedQ.copy(this.q); this.predictedP.copy(this.p)
  }
  inverseInertia(v: Vector3) {
    if (!this.inverseMass) return new Vector3()
    const frame = this.q.clone().multiply(this.inertiaFrame)
    return v.clone().applyQuaternion(frame.clone().invert()).divide(this.principalInertia).applyQuaternion(frame)
  }
  rotate(delta: Vector3) {
    if (!this.inverseMass) return
    // FQuat::IntegrateRotationWithAngularVelocity: first-order delta, then normalize.
    const dq = new Quaternion(delta.x, delta.y, delta.z, 0).multiply(this.q)
    this.q.set(this.q.x + .5 * dq.x, this.q.y + .5 * dq.y,
      this.q.z + .5 * dq.z, this.q.w + .5 * dq.w).normalize()
  }
  connector(frame: { position: Vector3; rotation: Quaternion }) {
    return { p: frame.position.clone().sub(this.localCom).applyQuaternion(this.q).add(this.p),
      q: this.q.clone().multiply(frame.rotation) }
  }
  publish(dt: number, updateVelocity: boolean) {
    if (!this.inverseMass) return
    if (updateVelocity) {
      this.body.setLinvel(new Vector3().copy(this.body.linvel()).addScaledVector(this.p.clone().sub(this.predictedP), 1 / dt), false)
      this.body.setAngvel(new Vector3().copy(this.body.angvel()).addScaledVector(
        rotationVector(this.q.clone().multiply(this.predictedQ.clone().invert())), 1 / dt), false)
    }
    this.body.setRotation(this.q, false)
    this.body.setTranslation(this.p.clone().sub(this.localCom.clone().applyQuaternion(this.q)), false)
  }
}

type Constraint = ReturnType<typeof compileConstraint>
export class SkeletalJointConstraint {
  private lambda = new Float64Array(5)
  private target: Quaternion | null = null
  private stiffness = 0
  readonly c: Constraint
  readonly parent: SkeletalSolverBody
  readonly child: SkeletalSolverBody
  constructor(c: Constraint, parent: SkeletalSolverBody, child: SkeletalSolverBody) {
    this.c = c; this.parent = parent; this.child = child
  }
  begin(target: Quaternion | null, stiffness: number) {
    this.lambda.fill(0); this.target = target; this.stiffness = stiffness
  }
  private angular(axis: Vector3, error: number, dt: number, k: number, d: number, slot: number, soft: boolean) {
    const a = this.parent, b = this.child
    const ii0 = axis.dot(a.inverseInertia(axis)), ii1 = axis.dot(b.inverseInertia(axis)), ii = ii0 + ii1
    if (!(ii > 1e-12) || Math.abs(error) < 1e-10) return
    const angularDelta = rotationVector(a.q.clone().multiply(a.initialQ.clone().invert()))
      .sub(rotationVector(b.q.clone().multiply(b.initialQ.clone().invert()))).dot(axis)
    const dl = soft ? softRotationLambda(dt, k, d, true, ii, error, angularDelta, this.lambda[slot]) : error / ii
    this.lambda[slot] += dl
    if (soft) {
      // Native soft-DD uses the scalar effective inertia along the constraint gradient.
      a.rotate(axis.clone().multiplyScalar(dl * ii0)); b.rotate(axis.clone().multiplyScalar(-dl * ii1))
    } else {
      a.rotate(a.inverseInertia(axis).multiplyScalar(dl)); b.rotate(b.inverseInertia(axis).multiplyScalar(-dl))
    }
  }
  private point(childOnly = false, alpha = 1) {
    const a = this.parent, b = this.child
    const f0 = a.connector(this.c.frame2), f1 = b.connector(this.c.frame1)
    const r0 = f0.p.clone().sub(a.p), r1 = f1.p.clone().sub(b.p)
    const im0 = childOnly ? 0 : a.inverseMass, im1 = b.inverseMass
    const columns = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(v => {
      const result = v.clone().multiplyScalar(im0 + im1)
      if (im0) result.add(a.inverseInertia(new Vector3().crossVectors(r0, v)).cross(r0))
      if (im1) result.add(b.inverseInertia(new Vector3().crossVectors(r1, v)).cross(r1))
      return result
    })
    const m = new Matrix3().set(columns[0].x, columns[1].x, columns[2].x,
      columns[0].y, columns[1].y, columns[2].y, columns[0].z, columns[1].z, columns[2].z)
    if (Math.abs(m.determinant()) < 1e-15) return
    const dx = f1.p.sub(f0.p).applyMatrix3(m.invert()).multiplyScalar(alpha)
    if (im0) { a.p.addScaledVector(dx, im0); a.rotate(a.inverseInertia(r0.cross(dx))) }
    if (im1) { b.p.addScaledVector(dx, -im1); b.rotate(b.inverseInertia(r1.cross(dx)).negate()) }
  }
  solve(dt: number) {
    const p = this.c.profile
    let q0 = this.parent.connector(this.c.frame2).q, q1 = this.child.connector(this.c.frame1).q
    const relative = q0.clone().invert().multiply(q1)
    const { twist } = decomposeSwingTwist(relative)
    const twistAngle = rotationVector(twist).x
    if (p.TwistLimit.TwistMotion === 'ACM_Limited') {
      const limit = this.c.limits[0]
      const error = twistAngle - Math.max(-limit, Math.min(limit, twistAngle))
      this.angular(new Vector3(1, 0, 0).applyQuaternion(q1), error, dt,
        p.TwistLimit.Stiffness, p.TwistLimit.Damping, 0, p.TwistLimit.bSoftConstraint)
    }
    q0 = this.parent.connector(this.c.frame2).q; q1 = this.child.connector(this.c.frame1).q
    const cone = p.ConeLimit
    if (cone.Swing1Motion === 'ACM_Limited' && cone.Swing2Motion === 'ACM_Limited') {
      const { axis, error } = ellipticalConeError(q0.clone().invert().multiply(q1), this.c.limits[1], this.c.limits[2])
      if (error > 0) this.angular(axis.applyQuaternion(q0), error, dt, cone.Stiffness, cone.Damping, 1, cone.bSoftConstraint)
    } else {
      for (const [index, motion] of [[1, cone.Swing2Motion], [2, cone.Swing1Motion]] as const) {
        if (motion === 'ACM_Free') continue
        q0 = this.parent.connector(this.c.frame2).q; q1 = this.child.connector(this.c.frame1).q
        const locked = motion === 'ACM_Locked'
        const otherMotion = index === 1 ? cone.Swing1Motion : cone.Swing2Motion
        let axis: Vector3, angle: number
        if (!locked && otherMotion === 'ACM_Locked') {
          // GetSwingAxisAngle: limited swing beside a locked swing is not a dual cone.
          const { swing } = decomposeSwingTwist(q0.clone().invert().multiply(q1))
          angle = 4 * Math.atan2(index === 1 ? swing.y : swing.z, 1 + swing.w)
          axis = (index === 1 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)).applyQuaternion(q0)
        } else {
          const other = (index === 1 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)).applyQuaternion(q0)
          const childX = new Vector3(1, 0, 0).applyQuaternion(q1)
          axis = new Vector3().crossVectors(other, childX)
          angle = locked ? -other.dot(childX) : Math.asin(Math.max(-1, Math.min(1, -other.dot(childX))))
          if (!locked) axis.normalize()
        }
        const limit = locked ? 0 : this.c.limits[index]
        this.angular(axis, angle - Math.max(-limit, Math.min(limit, angle)), dt,
          cone.Stiffness, cone.Damping, 1, !locked && cone.bSoftConstraint)
      }
    }
    if (p.TwistLimit.TwistMotion === 'ACM_Locked') {
      // GetLockedRotationAxes / ApplyLockedRotationConstraints: quaternion derivative
      // handles coupled swing without pretending the twist lock is an Euler constraint.
      q0 = this.parent.connector(this.c.frame2).q; q1 = this.child.connector(this.c.frame1).q
      if (q0.dot(q1) < 0) q1.set(-q1.x, -q1.y, -q1.z, -q1.w)
      const v0 = new Vector3(q0.x, q0.y, q0.z), v1 = new Vector3(q1.x, q1.y, q1.z)
      const c = v1.clone().multiplyScalar(q0.w).addScaledVector(v0, q1.w)
      const d = q0.w * q1.w - v0.dot(v1)
      const axis = v0.clone().multiplyScalar(v1.x).addScaledVector(v1, v0.x)
        .add(new Vector3(d, c.z, -c.y)).multiplyScalar(.5)
      if (Math.abs(q0.w * q1.w + v0.dot(v1)) < 1e-8) axis.x += 1e-8
      this.angular(axis, q0.clone().invert().multiply(q1).x, dt, 0, 0, 0, false)
    }
    if (this.target && this.stiffness) {
    q0 = this.parent.connector(this.c.frame2).q; q1 = this.child.connector(this.c.frame1).q
    const error = q0.clone().multiply(this.target).invert().multiply(q1)
    if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w)
    const x = new Vector3(1, 0, 0).applyQuaternion(error)
    const drive = p.AngularDrive
    const rows = [
      { axis: new Vector3(1, 0, 0), error: 2 * error.x, enabled: drive.TwistDrive.bEnablePositionDrive && p.TwistLimit.TwistMotion !== 'ACM_Locked' },
      { axis: new Vector3(0, 1, 0), error: -x.z, enabled: drive.SwingDrive.bEnablePositionDrive && cone.Swing2Motion !== 'ACM_Locked' },
      { axis: new Vector3(0, 0, 1), error: x.y, enabled: drive.SwingDrive.bEnablePositionDrive && cone.Swing1Motion !== 'ACM_Locked' },
    ]
    rows.forEach((row, i) => { if (row.enabled) this.angular(row.axis.applyQuaternion(q1), row.error, dt, this.stiffness, 0, 2 + i, true) })
    }
    // FPBDJointSolverSettings defaults to bSolvePositionLast.
    if (p.LinearLimit.XMotion === 'LCM_Locked') this.point()
  }
  project() {
    const p = this.c.profile
    if (p.bEnableProjection && p.ProjectionLinearAlpha > 0 && p.LinearLimit.XMotion === 'LCM_Locked') {
      this.point(true, p.ProjectionLinearAlpha)
      // ApplyTranslateProjection, final position fixup after the rotational point row.
      const error = this.child.connector(this.c.frame1).p.sub(this.parent.connector(this.c.frame2).p)
      if (this.child.inverseMass) this.child.p.addScaledVector(error, -p.ProjectionLinearAlpha)
    }
  }
}
