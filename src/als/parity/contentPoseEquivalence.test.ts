/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileBoneMask } from '../../engine/blend'
import { compileClipSampler, sampleClip } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { createPoseEvaluator, evaluatePose } from '../../engine/evaluator'
import type { EvaluatorLayerEntry } from '../../engine/evaluator'
import { createPoseBuffer } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import { createRigDefinition, findBoneIndex } from '../../engine/rig'
import {
  resolveRiflePoseBankTime,
  RIFLE_OVERLAY_REGION_POLICY,
  sampleRifleOverlayPolicyWeight,
} from '../AnimGraph/overlayMode'
import {
  computeWeightTable,
  createWeightTable,
  armRegionWeight,
  legRegionWeight,
} from '../AnimGraph/weightTable'
import type { WeightTableInput } from '../AnimGraph/weightTable'
import { updateLocomotionTargets } from '../AnimGraph/blendspace'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
} from '../Settings/AlsMovementSettings'
import { ALS_TURN_IN_PLACE_SETTINGS } from '../Settings/AlsTurnInPlaceSettings'
import {
  createAlsStanceTransitionCurveState,
  refreshStanceTransition,
} from '../State/AlsPoseState'
import { REGION_PREDICATES } from '../Utility/AlsConstants'

const POSE_EPSILON = 1e-5
const CURVE_EPSILON = 1e-5
const YAW_INTEGRAL_EPSILON = 1e-3
const WEIGHT_EPSILON = 1e-6

interface RawAlsCurve {
  readonly name: string
  readonly keys: readonly (readonly [number, number, number])[]
}

interface LoadedAlsGltf {
  animations: THREE.AnimationClip[]
  scene: THREE.Group
}

let gltf: LoadedAlsGltf

function loadAlsGltf() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new Promise<LoadedAlsGltf>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject)
  })
}

function clip(name: string) {
  const found = gltf.animations.find((animation) => animation.name === name)
  if (!found) throw new Error(`Missing ALS content-oracle clip "${name}"`)
  return found
}

function rawCurve(animation: THREE.AnimationClip, name: string): RawAlsCurve {
  const extras = animation.userData?.alsCurves
  if (!Array.isArray(extras)) {
    throw new Error(`${animation.name} has no ALS curve sidecar`)
  }
  const found = extras.find((curve) => curve?.name === name)
  if (!found || !Array.isArray(found.keys)) {
    throw new Error(`${animation.name} has no ${name} curve`)
  }
  return found as RawAlsCurve
}

function rifleEntries(
  rig: ReturnType<typeof createRigDefinition>,
  time: number,
): EvaluatorLayerEntry[] {
  const animation = clip('A_Als_Rifle_Poses')
  const sampler = compileClipSampler(animation, rig)
  const curves = compileClipCurveSamplers(animation)
  const source = { curves, time, weight: 1 }
  return RIFLE_OVERLAY_REGION_POLICY.map((policy) => ({
    sampler,
    time,
    weight: sampleRifleOverlayPolicyWeight(source, policy),
    loop: false,
    mask: compileBoneMask(rig, REGION_PREDICATES[policy.region]),
  }))
}

function transformComponents(pose: LocalPoseBuffer, bone: number): number[] {
  return [
    ...pose.positions.slice(bone * 3, bone * 3 + 3),
    ...pose.rotations.slice(bone * 4, bone * 4 + 4),
    ...pose.scales.slice(bone * 3, bone * 3 + 3),
  ]
}

function maximumComponentDelta(actual: number[], expected: number[]) {
  return actual.reduce(
    (maximum, value, index) => Math.max(maximum, Math.abs(value - expected[index])),
    0,
  )
}

function sampleRawCurve(curve: RawAlsCurve, time: number) {
  const { keys } = curve
  if (time <= keys[0][0]) return keys[0][1]
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1]
  let low = 0
  let high = keys.length - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (keys[middle][0] <= time) low = middle
    else high = middle
  }
  const alpha = (time - keys[low][0]) / (keys[high][0] - keys[low][0])
  const interpolationMode = keys[low][2]
  if (interpolationMode === 1) return keys[low][1]
  const curveAlpha = interpolationMode === 2
    ? alpha * alpha * (3 - 2 * alpha)
    : alpha
  return keys[low][1] + (keys[high][1] - keys[low][1]) * curveAlpha
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

beforeAll(async () => {
  gltf = await loadAlsGltf()
})

describe('ALS content oracle: crouch under Rifle', () => {
  it('traces pelvis and both thigh locals to A_Als_Crouch_Pose', () => {
    const rig = createRigDefinition(gltf.scene)
    const crouchSampler = compileClipSampler(clip('A_Als_Crouch_Pose'), rig)
    const rifleSampler = compileClipSampler(clip('A_Als_Rifle_Poses'), rig)
    const bankTime = resolveRiflePoseBankTime(1)
    const crouchPose = sampleClip(
      crouchSampler,
      rig,
      0,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const riflePose = sampleClip(
      rifleSampler,
      rig,
      bankTime,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const result = evaluatePose(createPoseEvaluator(rig), {
      base: [{ sampler: crouchSampler, time: 0, weight: 1, loop: false }],
      overlays: rifleEntries(rig, bankTime),
    })

    for (const boneName of ['pelvis', 'thigh_l', 'thigh_r']) {
      const bone = findBoneIndex(rig, boneName)
      const actual = transformComponents(result.pose, bone)
      const expected = transformComponents(crouchPose, bone)
      const wrongSource = transformComponents(riflePose, bone)
      expect(
        maximumComponentDelta(actual, expected),
        `${boneName} did not trace to A_Als_Crouch_Pose`,
      ).toBeLessThanOrEqual(POSE_EPSILON)
      expect(maximumComponentDelta(actual, wrongSource), boneName)
        .toBeGreaterThan(0.01)
    }
  })
})

describe('ALS content oracle: Rifle ik_hand_gun bank trace', () => {
  it.each([
    ['Standing', 'A_Als_Idle', resolveRiflePoseBankTime(0)],
    ['Crouching', 'A_Als_Crouch_Pose', resolveRiflePoseBankTime(1)],
  ])(
    '%s final ik_hand_gun local transform traces exactly to A_Als_Rifle_Poses at %ss',
    (_, baseClipName, bankTime) => {
      const rig = createRigDefinition(gltf.scene)
      const baseSampler = compileClipSampler(clip(baseClipName), rig)
      const rifleSampler = compileClipSampler(clip('A_Als_Rifle_Poses'), rig)
      const riflePose = sampleClip(
        rifleSampler,
        rig,
        bankTime,
        createPoseBuffer(rig.boneCount),
        false,
      )
      const basePose = sampleClip(
        baseSampler,
        rig,
        0,
        createPoseBuffer(rig.boneCount),
        false,
      )
      const result = evaluatePose(createPoseEvaluator(rig), {
        base: [{ sampler: baseSampler, time: 0, weight: 1, loop: false }],
        overlays: rifleEntries(rig, bankTime),
      })
      const bone = findBoneIndex(rig, 'ik_hand_gun')
      const actual = transformComponents(result.pose, bone)
      const expected = transformComponents(riflePose, bone)

      expect(maximumComponentDelta(actual, expected))
        .toBeLessThanOrEqual(POSE_EPSILON)
      expect(maximumComponentDelta(expected, transformComponents(basePose, bone)))
        .toBeGreaterThan(1e-3)
    },
  )
})

describe('ALS content oracle: stance-transition PoseCrouching', () => {
  it.each([
    ['A_Als_StandToCrouch', 1],
    ['A_Als_CrouchToStand', 0],
  ])('%s crouchingAmount matches its authored PoseCrouching values', (
    clipName,
    targetCrouchingAmount,
  ) => {
    const animation = clip(clipName)
    const raw = rawCurve(animation, 'PoseCrouching')
    const curves = compileClipCurveSamplers(animation)
    const state = createAlsStanceTransitionCurveState()
    const endTime = raw.keys[raw.keys.length - 1][0]
    const times = [0, endTime * 0.25, endTime * 0.5, endTime, animation.duration]

    for (const time of times) {
      refreshStanceTransition(state, targetCrouchingAmount, 0, { time, curves })
      expect(Math.abs(
        state.crouchingAmount - clamp01(sampleRawCurve(raw, time)),
      )).toBeLessThanOrEqual(CURVE_EPSILON)
    }
  })
})

const TURN_CASES = (
  ['Standing', 'Crouching'] as const
).flatMap((stance) => (
  [90, 180] as const
).flatMap((angle) => (
  ['Left', 'Right'] as const
).map((direction) => ({
  stance,
  angle,
  direction,
  settings: ALS_TURN_IN_PLACE_SETTINGS.clips[stance][angle][direction],
}))))

describe('ALS content oracle: turn-in-place RotationYawSpeed integral', () => {
  it.each(TURN_CASES)(
    '$stance $angle $direction integrates to the authored signed yaw',
    ({ direction, settings }) => {
      const animation = clip(settings.clip)
      const raw = rawCurve(animation, 'RotationYawSpeed')
      const sampler = compileClipCurveSamplers(animation).RotationYawSpeed
      if (!sampler) throw new Error(`${animation.name} did not compile RotationYawSpeed`)

      let integratedYaw = 0
      for (let index = 1; index < raw.keys.length; index++) {
        const previousTime = raw.keys[index - 1][0]
        const time = raw.keys[index][0]
        // AlsCharacter.cpp:1798-1809 applies RotationYawSpeed * DeltaTime.
        // The sidecar is linear, so trapezoidal integration is exact at its authored keys.
        integratedYaw += (
          sampler(previousTime) + sampler(time)
        ) * 0.5 * (time - previousTime)
      }

      const expectedYaw = settings.animatedTurnAngle
        * (direction === 'Left' ? -1 : 1)
      expect(Math.abs(integratedYaw - expectedYaw))
        .toBeLessThanOrEqual(YAW_INTEGRAL_EPSILON)
    },
  )
})

const GAIT_CASES = [
  {
    name: 'Standing Walking',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.walk,
    crouchingAmount: 0,
    expectedKey: 'walkFwd',
  },
  {
    name: 'Standing Running',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.run,
    crouchingAmount: 0,
    expectedKey: 'runFwd',
  },
  {
    name: 'Standing Sprinting',
    speed: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
    crouchingAmount: 0,
    expectedKey: 'sprint',
  },
  {
    name: 'Crouching Walking',
    speed: ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    crouchingAmount: 1,
    expectedKey: 'crouchFwd',
  },
] as const

describe('ALS content oracle: authored gait speed purity and coverage', () => {
  it.each(GAIT_CASES)('$name is pure and sums to authored coverage', ({
    speed,
    crouchingAmount,
    expectedKey,
  }) => {
    const standWeights = [0, 0, 0, 0]
    const crouchMoveWeight = updateLocomotionTargets(
      speed,
      standWeights,
      ALS_AUTHORED_GAIT_SPEEDS.standing,
      ALS_AUTHORED_GAIT_SPEEDS.crouching.walk,
    )
    const input: WeightTableInput = {
      standWeights,
      crouchMoveWeight,
      crouchingAmount,
      inAirAmount: 0,
      montageGate: 0,
      velocityBlend: {
        forwardAmount: 1,
        backwardAmount: 0,
        leftAmount: 0,
        rightAmount: 0,
      },
    }
    const weights = computeWeightTable(input, createWeightTable())

    expect(Math.abs(weights[expectedKey] - 1)).toBeLessThanOrEqual(WEIGHT_EPSILON)
    expect(Math.abs(legRegionWeight(weights) - 1))
      .toBeLessThanOrEqual(WEIGHT_EPSILON)
    expect(Math.abs(armRegionWeight(weights) - 1))
      .toBeLessThanOrEqual(WEIGHT_EPSILON)
  })
})
