import { beforeAll, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { ALS_PHYSICS_ASSET, compileConstraint } from './rapierAlsPhysicsAsset'
import { Quaternion, Vector2, Vector3 } from 'three'
import { decomposeSwingTwist, ellipticalConeError, nearPointOnEllipse, softRotationLambda, SkeletalJointConstraint, SkeletalSolverBody } from './chaosJointConstraint'

it('separates twist from cone swing instead of treating the joint as XYZ Euler angles', () => {
  const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .3)
  const twist = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .8)
  const decomposition = decomposeSwingTwist(swing.clone().multiply(twist))
  expect(decomposition.swing.angleTo(swing)).toBeLessThan(1e-7)
  expect(decomposition.twist.angleTo(twist)).toBeLessThan(1e-7)
  const inside = ellipticalConeError(swing.clone().multiply(twist), .4, .2)
  expect(inside.error).toBe(0)
  const outside = ellipticalConeError(swing.clone().multiply(twist), .2, .4)
  expect(outside.error).toBeCloseTo(Math.sin(.1), 5)
  expect(outside.axis.y).toBeCloseTo(1, 5)
})
it('projects to the nearest ellipse point and keeps the two swing limits coupled', () => {
  const r = new Vector2(.2, .4), p = nearPointOnEllipse(new Vector2(.3, .4), r)
  expect(p.clone().divide(r).lengthSq()).toBeCloseTo(1, 3)
  const diagonal = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 1).normalize(), .38)
  expect(ellipticalConeError(diagonal, .2, .4).error).toBeGreaterThan(0)
})
it('uses acceleration-mode XPBD effective inertia, stiffness and retained lambda', () => {
  // Independent scalar compliant constraint: dt=.1, k=100, I^-1=2 -> S=.5,
  // denominator 1 + S*I^-1 = 2; error=.2 -> delta lambda=.05.
  expect(softRotationLambda(.1, 100, 0, true, 2, .2, 0, 0)).toBeCloseTo(.05)
  expect(softRotationLambda(.1, 100, 0, true, 2, .2, 0, .1)).toBeCloseTo(0)
})

beforeAll(async () => { await RAPIER.init() })
it('enforces the two authored connector frames with mass-weighted point rows', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
  const c = compileConstraint(ALS_PHYSICS_ASSET.constraints[0])
  const rotation = c.frame2.rotation.clone().multiply(c.frame1.rotation.clone().invert())
  const position = c.frame2.position.clone().sub(c.frame1.position.clone().applyQuaternion(rotation))
  const parent = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setAdditionalMassProperties(10, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, new Quaternion()))
  const child = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
    .setRotation(rotation).setAdditionalMassProperties(5, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, new Quaternion()).setLinvel(3, 0, 0))
  for (const b of [parent, child]) { world.createCollider(RAPIER.ColliderDesc.ball(.05).setMass(0), b); b.recomputeMassPropertiesFromColliders() }
  const a = new SkeletalSolverBody(parent), b = new SkeletalSolverBody(child)
  const joint = new SkeletalJointConstraint(c, a, b)
  a.begin(); b.begin(); joint.begin(null, 0)
  world.step(); a.predict(); b.predict()
  const centreBefore = a.p.clone().multiplyScalar(10).addScaledVector(b.p, 5).divideScalar(15)
  for (let i = 0; i < 8; i++) joint.solve(world.timestep)
  expect(a.connector(c.frame2).p.distanceTo(b.connector(c.frame1).p)).toBeLessThan(1e-6)
  expect(a.p.clone().multiplyScalar(10).addScaledVector(b.p, 5).divideScalar(15).distanceTo(centreBefore)).toBeLessThan(1e-6)
  world.free()
})
