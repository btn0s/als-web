import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createPoseBuffer,
  resetPoseToReference,
  type LocalPoseBuffer,
} from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import {
  createAlsControlRigFootIkRuntime,
  evaluateAlsControlRigFootIk,
  type AlsControlRigFootOffsetTrace,
} from '../AnimGraph/CR_Als'

interface OracleSpringState {
  velocity: number
  previousTarget: number
  valid: boolean
}

interface FootLocationOracleState {
  initialized: boolean
  offset: number
  spring: OracleSpringState
}

interface PelvisOracleState {
  simulatedResult: number
  spring: OracleSpringState
}

function createSpringState(): OracleSpringState {
  return { velocity: 0, previousTarget: 0, valid: false }
}

// UE5.5 FMath::InvExpApprox(), copied independently from UnrealMathUtility.h.
function oracleInvExpApprox(value: number) {
  return 1 / (
    1
    + 1.00746054 * value
    + 0.45053901 * value * value
    + 0.25724632 * value * value * value
  )
}

// Scalar line mirror of UE5.5 FMath::SpringDamper().
function oracleSpringDamper(
  state: OracleSpringState,
  current: number,
  target: number,
  targetVelocity: number,
  deltaTime: number,
  frequency: number,
  dampingRatio: number,
) {
  if (deltaTime <= 0) return current
  const w = frequency * Math.PI * 2
  if (w < 1e-8) return current + state.velocity * deltaTime
  if (dampingRatio < 1e-8) {
    const error = current - target
    const b = state.velocity / w
    const sin = Math.sin(w * deltaTime)
    const cos = Math.cos(w * deltaTime)
    const result = target + error * cos + b * sin
    state.velocity = state.velocity * cos - error * w * sin
    return result
  }

  const smoothingTime = 2 / w
  const adjustedTarget =
    target + targetVelocity * dampingRatio * smoothingTime
  const error = current - adjustedTarget
  if (dampingRatio > 1) {
    const wd = w * Math.sqrt(dampingRatio * dampingRatio - 1)
    const c2 = -(state.velocity + (w * dampingRatio - wd) * error)
      / (2 * wd)
    const c1 = error - c2
    const a1 = wd - dampingRatio * w
    const a2 = -(wd + dampingRatio * w)
    const e1 = oracleInvExpApprox(-a1 * deltaTime)
    const e2 = oracleInvExpApprox(-a2 * deltaTime)
    state.velocity = e1 * c1 * a1 + e2 * c2 * a2
    return adjustedTarget + e1 * c1 + e2 * c2
  }
  if (dampingRatio < 1) {
    const wd = w * Math.sqrt(1 - dampingRatio * dampingRatio)
    const a = error
    const b = (state.velocity + error * dampingRatio * w) / wd
    const sin = Math.sin(wd * deltaTime)
    const cos = Math.cos(wd * deltaTime)
    const decay = oracleInvExpApprox(dampingRatio * w * deltaTime)
    let result = decay * (a * cos + b * sin)
    state.velocity = -result * dampingRatio * w
      + decay * (b * wd * cos - a * wd * sin)
    result += adjustedTarget
    return result
  }

  const c1 = error
  const c2 = state.velocity + error * w
  const decay = oracleInvExpApprox(w * deltaTime)
  state.velocity = (c2 - c1 * w - c2 * w * deltaTime) * decay
  return adjustedTarget + (c1 + c2 * deltaTime) * decay
}

function oracleFootLocationStep(
  state: FootLocationOracleState,
  target: number,
  deltaTime: number,
) {
  if (!state.initialized) {
    state.initialized = true
    state.spring.velocity = 0
    state.spring.previousTarget = 0
    state.spring.valid = false
    state.offset = target
    return state.offset
  }
  if (deltaTime <= 1e-8) return state.offset
  if (!state.spring.valid) {
    state.spring.velocity = 0
    state.spring.previousTarget = target
    state.spring.valid = true
    state.offset = target
    return state.offset
  }
  const targetVelocity =
    (target - state.spring.previousTarget) / deltaTime
  state.offset = oracleSpringDamper(
    state.spring,
    state.offset,
    target,
    targetVelocity,
    deltaTime,
    0.4,
    4,
  )
  state.spring.previousTarget = target
  return state.offset
}

function oraclePelvisStep(
  state: PelvisOracleState,
  target: number,
  deltaTime: number,
) {
  let current = state.simulatedResult
  if (!state.spring.valid) current = target
  if (deltaTime > 1e-8) {
    current = oracleSpringDamper(
      state.spring,
      current,
      target,
      0,
      deltaTime,
      2,
      1,
    )
    state.spring.previousTarget = target
    state.spring.valid = true
  }
  state.simulatedResult = current
  return current
}

const BONE_NAMES = [
  'root',
  'pelvis',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r',
] as const

const PARENT_INDICES = new Int16Array([
  -1,
  0,
  1,
  2,
  3,
  4,
  1,
  6,
  7,
  8,
])

const LOCAL_POSITIONS = [
  [0, 0, 0],
  [0, 1, 0],
  [0, -0.1, 0.12],
  [0, -0.4, 0],
  [0, -0.4, 0],
  [0.12, -0.04, 0],
  [0, -0.1, -0.12],
  [0, -0.4, 0],
  [0, -0.4, 0],
  [0.12, -0.04, 0],
] as const

function createRig() {
  const boneCount = BONE_NAMES.length
  const referencePositions = new Float32Array(boneCount * 3)
  const referenceRotations = new Float32Array(boneCount * 4)
  const referenceScales = new Float32Array(boneCount * 3)
  for (let bone = 0; bone < boneCount; bone++) {
    referencePositions.set(LOCAL_POSITIONS[bone], bone * 3)
    referenceRotations[bone * 4 + 3] = 1
    referenceScales.set([1, 1, 1], bone * 3)
  }
  return {
    boneCount,
    boneNames: BONE_NAMES,
    parentIndices: PARENT_INDICES,
    referencePositions,
    referenceRotations,
    referenceScales,
  } as unknown as RigDefinition
}

function createPose(rig: RigDefinition) {
  return resetPoseToReference(createPoseBuffer(rig.boneCount), rig)
}

function traceAt(
  leftHeight: number,
  rightHeight = leftHeight,
  normal = new THREE.Vector3(0, 1, 0),
): AlsControlRigFootOffsetTrace {
  return (request) => ({
    impactPoint: new THREE.Vector3(
      request.start.x,
      request.side === 'left' ? leftHeight : rightHeight,
      request.start.z,
    ),
    impactNormal: normal,
  })
}

function evaluate(
  runtime: ReturnType<typeof createAlsControlRigFootIkRuntime>,
  pose: LocalPoseBuffer,
  curves: ReadonlyMap<string, number>,
  trace: AlsControlRigFootOffsetTrace,
  deltaTime: number,
) {
  return evaluateAlsControlRigFootIk(runtime, {
    pose,
    curves,
    trace,
    deltaTime,
    rigInput: {
      bFootOffsetAllowed: true,
      footLeftLocation: new THREE.Vector3(0, 0.1, 0.12),
      footLeftRotation: new THREE.Quaternion(),
      footRightLocation: new THREE.Vector3(0, 0.1, -0.12),
      footRightRotation: new THREE.Quaternion(),
    },
  })
}

function lcg(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

interface ComponentTransform {
  readonly position: THREE.Vector3
  readonly rotation: THREE.Quaternion
}

function componentTransforms(
  rig: RigDefinition,
  pose: LocalPoseBuffer,
) {
  const matrices: THREE.Matrix4[] = []
  const transforms: ComponentTransform[] = []
  for (let bone = 0; bone < rig.boneCount; bone++) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(pose.positions, bone * 3),
      new THREE.Quaternion().fromArray(pose.rotations, bone * 4),
      new THREE.Vector3().fromArray(pose.scales, bone * 3),
    )
    const parent = rig.parentIndices[bone]
    matrices[bone] = parent < 0
      ? local
      : new THREE.Matrix4().multiplyMatrices(matrices[parent], local)
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    matrices[bone].decompose(position, rotation, new THREE.Vector3())
    transforms[bone] = { position, rotation }
  }
  return transforms
}

function conjugateBasis(
  quaternion: THREE.Quaternion,
  out = new THREE.Quaternion(),
) {
  return out.set(
    -quaternion.x,
    -quaternion.z,
    -quaternion.y,
    quaternion.w,
  )
}

function oracleFindBetweenVectors(
  a: THREE.Vector3,
  b: THREE.Vector3,
) {
  const norm = Math.sqrt(a.lengthSq() * b.lengthSq())
  let w = norm + a.dot(b)
  const result = new THREE.Quaternion()
  if (w >= 1e-6 * norm) {
    result.set(
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
      w,
    )
  } else {
    w = 0
    const basis = (
      Math.abs(a.x) > Math.abs(a.y)
      && Math.abs(a.x) > Math.abs(a.z)
    )
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(-1, 0, 0)
    result.set(
      a.y * basis.z - a.z * basis.y,
      a.z * basis.x - a.x * basis.z,
      a.x * basis.y - a.y * basis.x,
      w,
    )
  }
  return result.lengthSq() <= 1e-8
    ? result.identity()
    : result.normalize()
}

function swingTwistX(quaternion: THREE.Quaternion) {
  const twist = new THREE.Quaternion(
    quaternion.x,
    0,
    0,
    quaternion.w,
  )
  if (twist.lengthSq() === 0) twist.identity()
  else twist.normalize()
  return {
    twist,
    swing: quaternion.clone().multiply(twist.clone().conjugate()),
  }
}

function constrain(initial: number, target: number, degrees: number) {
  const limit = Math.sin(THREE.MathUtils.degToRad(degrees) * 0.5)
  const minimum = initial >= 0 ? -limit : Math.min(initial, -limit)
  const maximum = initial >= 0 ? Math.max(initial, limit) : limit
  return THREE.MathUtils.clamp(target, minimum, maximum)
}

function sign(value: number) {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

// Independent line mirror of FAlsRigUnit_ApplyFootOffsetRotation.cpp.
function oracleFootRotation(
  calfGltf: THREE.Quaternion,
  targetGltf: THREE.Quaternion,
  normalGltf: THREE.Vector3,
) {
  const calf = conjugateBasis(calfGltf)
  const target = conjugateBasis(targetGltf)
  const normal = new THREE.Vector3(
    normalGltf.x,
    normalGltf.z,
    normalGltf.y,
  )
  const offset = oracleFindBetweenVectors(
    new THREE.Vector3(0, 0, 1),
    normal,
  )
  const limit = new THREE.Quaternion(
    0.001903,
    -0.043578,
    0.043578,
    0.998097,
  )
  const initialLocal = calf.clone().conjugate()
    .multiply(target)
    .multiply(limit)
  const targetLocal = calf.clone().conjugate()
    .multiply(offset)
    .multiply(target)
    .multiply(limit)
  const initial = swingTwistX(initialLocal)
  const desired = swingTwistX(targetLocal)
  const y = constrain(initial.swing.y, desired.swing.y, 5)
  const z = constrain(initial.swing.z, desired.swing.z, 25)
  const swing = new THREE.Quaternion(
    0,
    y,
    z,
    sign(desired.swing.w) * Math.sqrt(
      Math.max(0, 1 - y * y - z * z),
    ),
  )
  const x = constrain(initial.twist.x, desired.twist.x, 0)
  const twist = new THREE.Quaternion(
    x,
    0,
    0,
    sign(desired.twist.w) * Math.sqrt(Math.max(0, 1 - x * x)),
  )
  const result = calf
    .multiply(swing.multiply(twist))
    .multiply(limit.clone().conjugate())
    .normalize()
  return conjugateBasis(result).normalize()
}

describe('CR_Als Control Rig source equivalence', () => {
  it('matches UAlsMath::SpringDampFloat across a deterministic target/delta trace', () => {
    const rig = createRig()
    const pose = createPose(rig)
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const oracle: FootLocationOracleState = {
      initialized: false,
      offset: 0,
      spring: createSpringState(),
    }
    const random = lcg(0x4a53_464f)
    const curves = new Map<string, number>()

    for (let frame = 0; frame < 256; frame++) {
      resetPoseToReference(pose, rig)
      const groundHeight = random() * 0.35
      const deltaTime = frame % 29 === 0
        ? 0
        : 1 / (30 + Math.floor(random() * 91))
      evaluate(
        runtime,
        pose,
        curves,
        traceAt(groundHeight),
        deltaTime,
      )
      // Reference pelvis is 1m, target ankle 0.1m: the authored 50cm clearance allows +0.4m.
      const target = Math.max(0, Math.min(groundHeight, 0.4))
      const expected = oracleFootLocationStep(
        oracle,
        target,
        deltaTime,
      )
      expect(runtime.feet[0].offsetLocation)
        .toBeCloseTo(expected, 11)
      expect(runtime.feet[0].offsetLocationSpring.velocity)
        .toBeCloseTo(oracle.spring.velocity, 11)
    }
  })

  it('matches FRigUnit_SpringInterpV2 across a deterministic two-foot trace', () => {
    const rig = createRig()
    const pose = createPose(rig)
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const oracle: PelvisOracleState = {
      simulatedResult: 0,
      spring: createSpringState(),
    }
    const random = lcg(0x5045_4c56)
    const curves = new Map([
      ['FootLeftIk', 1],
      ['FootRightIk', 1],
    ])

    for (let frame = 0; frame < 256; frame++) {
      resetPoseToReference(pose, rig)
      const left = -0.45 + random() * 1.05
      const right = -0.45 + random() * 1.05
      const deltaTime = frame % 31 === 0
        ? 0
        : 1 / (24 + Math.floor(random() * 97))
      evaluate(
        runtime,
        pose,
        curves,
        traceAt(left, right),
        deltaTime,
      )
      const target = THREE.MathUtils.clamp(
        Math.min(left, right),
        -0.3,
        0.4,
      )
      const expected = oraclePelvisStep(
        oracle,
        target,
        deltaTime,
      )
      expect(runtime.pelvisOffset).toBeCloseTo(expected, 11)
      expect(runtime.pelvisSpring.velocity)
        .toBeCloseTo(oracle.spring.velocity, 11)

      const transforms = componentTransforms(rig, pose)
      expect(transforms[1].position.y)
        .toBeCloseTo(1 + expected, 6)
    }
  })

  it('matches the independent pole and offset-normal exponential-decay states', () => {
    const rig = createRig()
    const pose = createPose(rig)
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const random = lcg(0x504f_4c45)
    const poleCurrent = new THREE.Vector3()
    const normalCurrent = new THREE.Vector3()
    const lastCalf = new THREE.Vector3()
    const lastDirection = new THREE.Vector3(1, 0, 0)
    let initialized = false

    for (let frame = 0; frame < 128; frame++) {
      resetPoseToReference(pose, rig)
      const calfOffset = 3 * 3
      const footOffset = 4 * 3
      if (frame % 17 !== 0) {
        pose.positions[calfOffset] = 0.01 + random() * 0.05
        pose.positions[footOffset] = -0.05 + random() * 0.02
      }
      const before = componentTransforms(rig, pose)
      const thigh = before[2].position
      const calf = before[3].position
      const foot = before[4].position
      const ab = calf.clone().sub(thigh)
      const ac = foot.clone().sub(thigh)
      const projection = thigh.clone().add(
        ac.clone().normalize().multiplyScalar(
          ab.dot(ac.clone().normalize()),
        ),
      )
      const direction = calf.clone().sub(projection)
      if (
        Math.abs(ab.x) > 1e-6
        || Math.abs(ab.y) > 1e-6
        || Math.abs(ab.z) > 1e-6
      ) {
        if (ac.lengthSq() <= 1e-12) {
          lastCalf.copy(calf)
          lastDirection.copy(ab).normalize()
        } else if (direction.lengthSq() > 1e-12) {
          lastCalf.copy(calf)
          lastDirection.copy(direction).normalize()
        }
      }
      const poleTarget = lastCalf.clone()
        .addScaledVector(lastDirection, 0.4)
      const angle = (random() - 0.5) * 0.7
      const normal = new THREE.Vector3(
        0,
        Math.cos(angle),
        Math.sin(angle),
      )
      const deltaTime = 1 / (30 + Math.floor(random() * 91))
      if (!initialized) {
        poleCurrent.copy(poleTarget)
        normalCurrent.copy(normal)
        initialized = true
      }
      poleCurrent.lerp(
        poleTarget,
        1 - oracleInvExpApprox(15 * deltaTime),
      )
      normalCurrent.lerp(
        normal,
        1 - oracleInvExpApprox(20 * deltaTime),
      )

      evaluate(
        runtime,
        pose,
        new Map(),
        traceAt(0, 0, normal),
        deltaTime,
      )
      expect(runtime.feet[0].poleLocation.distanceTo(poleCurrent))
        .toBeLessThan(2e-7)
      expect(runtime.feet[0].offsetNormal.distanceTo(normalCurrent))
        .toBeLessThan(2e-7)
    }
  })

  it('matches ApplyFootOffsetRotation after the left two-bone solve', () => {
    const rig = createRig()
    const pose = createPose(rig)
    const runtime = createAlsControlRigFootIkRuntime(rig)
    const normal = new THREE.Vector3(
      0,
      Math.cos(THREE.MathUtils.degToRad(18)),
      Math.sin(THREE.MathUtils.degToRad(18)),
    )
    evaluate(
      runtime,
      pose,
      new Map([
        ['FootLeftIk', 1],
        ['FootRightIk', 0],
      ]),
      traceAt(0, 0, normal),
      1 / 60,
    )
    const transforms = componentTransforms(rig, pose)
    const expected = oracleFootRotation(
      transforms[3].rotation,
      new THREE.Quaternion(),
      normal,
    )
    // The evaluator writes the constrained global result back through Float32 local-pose storage.
    expect(transforms[4].rotation.angleTo(expected)).toBeLessThan(2e-5)
  })
})
