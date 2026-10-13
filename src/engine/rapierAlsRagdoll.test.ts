import { beforeAll, describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import { ALS_PHYSICS_ASSET, compileBody, compileConstraint, ueRotation } from './rapierAlsPhysicsAsset'
import { RapierAlsRagdoll, ALS_CHARACTER_COLLISION_GROUPS, ALS_RAGDOLL_COLLISION_GROUPS } from './rapierAlsRagdoll'

beforeAll(async () => { await RAPIER.init() })
describe('PA_Als conversion', () => {
  it('preserves shape dimensions and uses native mass, COM and principal inertia', () => {
    const result = compileBody(ALS_PHYSICS_ASSET.bodies[0])
    expect(result.shapes[0].descriptor.translation.x).toBeCloseTo(.005)
    expect(result.shapes[0].descriptor.translation.z).toBeCloseTo(-.005)
    expect(result.mass).toBeCloseTo(7.926502227783203)
    expect(result.massSource).toBe('native-runtime')
    expect(result.centerOfMass.toArray()).toEqual([.005, 0, -.005])
    expect(result.principalInertia.x).toBeCloseTo(.08491806030273438)
    expect(result.principalInertia.y).toBeCloseTo(.06638085327148438)
    expect(result.shapes[0].descriptor.mass).toBe(0)
    expect(() => compileBody({ ...ALS_PHYSICS_ASSET.bodies[0], boneName: 'missing' })).toThrow('Missing native mass')
  })
  it('converts reflected rotation and constraint frames independently of the animated pose', () => {
    const yaw = ueRotation({ Pitch: 0, Yaw: 90, Roll: 0 })
    expect(new Vector3(1, 0, 0).applyQuaternion(yaw).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6)
    const roll = ueRotation({ Pitch: 0, Yaw: 0, Roll: 90 })
    expect(new Vector3(0, 1, 0).applyQuaternion(roll).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6)
    const c = compileConstraint(ALS_PHYSICS_ASSET.constraints[0])
    expect(c.frame2.position.x).toBeCloseTo(.10808878)
    expect(new Vector3(1, 0, 0).applyQuaternion(c.frame2.rotation).x).toBeCloseTo(.99221534)
    expect(c.limits).toEqual([15, 10, 15].map(d => d * Math.PI / 180))
    expect(c.profile.ConeLimit.bSoftConstraint).toBe(true)
    expect(c.profile.AngularDrive.TwistDrive.bEnablePositionDrive).toBe(true)
    const root = compileConstraint(ALS_PHYSICS_ASSET.constraints.find(c => c.body2 === 'root')!)
    expect(root.profile.LinearLimit.XMotion).toBe('LCM_Free')
    expect(root.profile.ConeLimit.Swing1Motion).toBe('ACM_Free')
  })
})
it('applies impulses to a named body, at a world point, rejects invalid input and disposes all physics', () => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const ragdoll = new RapierAlsRagdoll(world)
  const poses = new Map(ALS_PHYSICS_ASSET.bodies.map((b, i) => [b.boneName,
    { translation: { x: i, y: 3, z: 0 }, rotation: new Quaternion() }]))
  ragdoll.start(poses, { x: 2, y: 0, z: 0 })
  const head = ragdoll.bodies.get('head')!
  const mass = head.mass()
  expect(ragdoll.AddImpulse({ boneName: 'missing', impulse: { x: 1, y: 0, z: 0 } })).toBe(false)
  expect(ragdoll.AddImpulse({ boneName: 'head', impulse: { x: NaN, y: 0, z: 0 } })).toBe(false)
  expect(ragdoll.AddImpulse({ boneName: 'head', impulse: { x: mass * 3, y: 0, z: 0 },
    location: { x: 5, y: 4, z: 0 } })).toBe(true)
  expect(head.linvel().x).toBeCloseTo(5)
  expect(Math.abs(head.angvel().z)).toBeGreaterThan(0)
  expect(ragdoll.bodies.get('pelvis')!.linvel().x).toBe(2)
  expect((ALS_RAGDOLL_COLLISION_GROUPS & 0xffff) & (ALS_CHARACTER_COLLISION_GROUPS >>> 16)).toBe(0)
  ragdoll.dispose(); ragdoll.dispose()
  expect(world.bodies.len()).toBe(0)
  expect(world.impulseJoints.len()).toBe(0)
  world.free()
})
