/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  RIFLE_OVERLAY_REGION_POLICY,
  RIFLE_RELAXED_POSE_TIME,
  resolveRiflePoseBankTime,
  sampleRifleOverlayPolicyWeight,
} from '../als/AnimGraph/overlayMode'
import { REGION_PREDICATES } from '../als/Utility/AlsConstants'
import { applyPose, createPoseApplicator } from './applyPose'
import { compileBoneMask } from './blend'
import { compileClipSampler, sampleClip } from './clipSampler'
import { compileClipCurveSamplers } from './curves'
import { createPoseEvaluator, evaluatePose } from './evaluator'
import type { EvaluatorLayerEntry } from './evaluator'
import { createPoseBuffer } from './poseBuffer'
import { createRigDefinition, findBoneIndex } from './rig'

let gltf: Awaited<ReturnType<typeof loadAlsGltf>>

function loadAlsGltf() {
  const bytes = readFileSync(new URL('../../public/assets/skm-als.glb', import.meta.url))
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Promise<{
    animations: THREE.AnimationClip[]
    scene: THREE.Group
  }>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, reject)
  })
}

function clip(name: string) {
  const found = gltf.animations.find((animation) => animation.name === name)
  if (!found) throw new Error(`Missing ALS regression clip "${name}"`)
  return found
}

function rifleEntries(
  rig: ReturnType<typeof createRigDefinition>,
  includeIkHands = true,
  time: number = RIFLE_RELAXED_POSE_TIME,
): EvaluatorLayerEntry[] {
  const animation = clip('A_Als_Rifle_Poses')
  const sampler = compileClipSampler(animation, rig)
  const curves = compileClipCurveSamplers(animation)
  const source = { curves, time, weight: 1 }
  return RIFLE_OVERLAY_REGION_POLICY
    .filter(({ region }) => includeIkHands || !region.startsWith('ikHand'))
    .map((policy) => ({
      sampler,
      time,
      weight: sampleRifleOverlayPolicyWeight(source, policy),
      loop: false,
      mask: compileBoneMask(rig, REGION_PREDICATES[policy.region]),
    }))
}

function transformSlice(
  pose: ReturnType<typeof createPoseBuffer>,
  bone: number,
) {
  return {
    position: [...pose.positions.slice(bone * 3, bone * 3 + 3)],
    rotation: [...pose.rotations.slice(bone * 4, bone * 4 + 4)],
    scale: [...pose.scales.slice(bone * 3, bone * 3 + 3)],
  }
}

function transformDistance(
  a: ReturnType<typeof transformSlice>,
  b: ReturnType<typeof transformSlice>,
) {
  return [...a.position, ...a.rotation, ...a.scale].reduce(
    (sum, value, index) => (
      sum + Math.abs(value - [...b.position, ...b.rotation, ...b.scale][index])
    ),
    0,
  )
}

describe('Rifle overlay evaluator regression', () => {
  beforeAll(async () => {
    gltf = await loadAlsGltf()
  })

  it('preserves Crouching base pelvis and thighs instead of replacing them from the pose bank', () => {
    const rig = createRigDefinition(gltf.scene)
    const crouch = compileClipSampler(clip('A_Als_Crouch_Pose'), rig)
    const rifle = compileClipSampler(clip('A_Als_Rifle_Poses'), rig)
    const basePose = sampleClip(crouch, rig, 0, createPoseBuffer(rig.boneCount), false)
    const riflePose = sampleClip(
      rifle,
      rig,
      RIFLE_RELAXED_POSE_TIME,
      createPoseBuffer(rig.boneCount),
      false,
    )
    const result = evaluatePose(createPoseEvaluator(rig), {
      base: [{ sampler: crouch, time: 0, weight: 1, loop: false }],
      overlays: rifleEntries(rig),
    })

    for (const boneName of ['pelvis', 'thigh_l', 'thigh_r']) {
      const bone = findBoneIndex(rig, boneName)
      const finalTransform = transformSlice(result.pose, bone)
      const baseTransform = transformSlice(basePose, bone)
      const rifleTransform = transformSlice(riflePose, bone)
      expect(finalTransform, `${boneName} must pass through from Crouching`).toEqual(baseTransform)
      expect(transformDistance(finalTransform, rifleTransform), boneName).toBeGreaterThan(0.01)
    }
  })

  it.each([
    ['Standing', 'A_Als_Idle', resolveRiflePoseBankTime(0)],
    ['Crouching', 'A_Als_Crouch_Pose', resolveRiflePoseBankTime(1)],
  ])(
    'drives %s ik_hand_gun from the Rifle source so the identity attachment reaches the hands',
    (_, baseClipName, overlayTime) => {
      const rig = createRigDefinition(gltf.scene)
      const base = compileClipSampler(clip(baseClipName), rig)
      const evaluator = createPoseEvaluator(rig)
      const input = {
        base: [{ sampler: base, time: 0, weight: 1, loop: false }],
      }
      const applicator = createPoseApplicator(gltf.scene, rig)
      const gunBone = gltf.scene.getObjectByName('ik_hand_gun')
      const leftHandBone = gltf.scene.getObjectByName('hand_l')
      const rightHandBone = gltf.scene.getObjectByName('hand_r')
      if (!(gunBone instanceof THREE.Bone)) throw new Error('Missing ik_hand_gun bone')
      if (!(leftHandBone instanceof THREE.Bone)) throw new Error('Missing hand_l bone')
      if (!(rightHandBone instanceof THREE.Bone)) throw new Error('Missing hand_r bone')
      const gun = gunBone
      const leftHand = leftHandBone
      const rightHand = rightHandBone

      function distanceFromHandsMidpoint() {
        const gunPosition = gun.getWorldPosition(new THREE.Vector3())
        const handsMidpoint = leftHand.getWorldPosition(new THREE.Vector3())
          .add(rightHand.getWorldPosition(new THREE.Vector3()))
          .multiplyScalar(0.5)
        return {
          distance: gunPosition.distanceTo(handsMidpoint),
          gunPosition,
          handsMidpoint,
        }
      }

      const beforeResult = evaluatePose(evaluator, {
        ...input,
        overlays: rifleEntries(rig, false, overlayTime),
      })
      applyPose(applicator, beforeResult.pose)
      gltf.scene.updateMatrixWorld(true)
      const before = distanceFromHandsMidpoint()

      const afterResult = evaluatePose(evaluator, {
        ...input,
        overlays: rifleEntries(rig, true, overlayTime),
      })
      applyPose(applicator, afterResult.pose)
      gltf.scene.updateMatrixWorld(true)
      const after = distanceFromHandsMidpoint()

      expect(
        after.distance,
        `gun ${after.gunPosition.toArray()} vs hands ${after.handsMidpoint.toArray()}`,
      ).toBeLessThanOrEqual(0.35)
      expect(after.distance).toBeLessThan(before.distance)
    },
  )
})
