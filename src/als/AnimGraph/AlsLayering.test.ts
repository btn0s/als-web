import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createPoseBuffer,
  resetPoseToReference,
} from '../../engine/poseBuffer'
import { createRigDefinition } from '../../engine/rig'
import {
  ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES,
  ALS_LAYERING_REGIONS,
  composeAlsLayeringFinalCurves,
  createAlsLayeringPoseRuntime,
  evaluateAlsLayeringPose,
  resolveAlsLayeringState,
} from './AlsLayering'

describe('ALS layering regions', () => {
  it('freezes every authored region curve and dynamic-additive rule', () => {
    expect(ALS_LAYERING_REGIONS.map((region) => ({
      name: region.name,
      cachedPoseName: region.cachedPoseName,
      slotName: region.slotName,
      curves: [
        region.baseCurveName,
        region.additiveCurveName,
        region.slotCurveName,
        region.localSpaceCurveName,
      ],
      additive: [
        region.dynamicAdditiveSpace,
        region.dynamicAdditiveAlpha,
      ],
    }))).toEqual([
      {
        name: 'Legs',
        cachedPoseName: 'Legs',
        slotName: 'Legs',
        curves: ['LayerLegs', null, 'LayerLegsSlot', null],
        additive: ['mesh', { kind: 'full', amount: 1 }],
      },
      {
        name: 'Pelvis',
        cachedPoseName: 'Pelvis',
        slotName: 'Pelvis',
        curves: ['LayerPelvis', null, 'LayerPelvisSlot', null],
        additive: ['mesh', { kind: 'full', amount: 1 }],
      },
      {
        name: 'Spine',
        cachedPoseName: 'Spine',
        slotName: 'Spine',
        curves: [
          'LayerSpine',
          'LayerSpineAdditive',
          'LayerSpineSlot',
          null,
        ],
        additive: [
          'mesh',
          { kind: 'curve', curveName: 'LayerSpineAdditive' },
        ],
      },
      {
        name: 'Head',
        cachedPoseName: 'Head',
        slotName: 'Head',
        curves: [
          'LayerHead',
          'LayerHeadAdditive',
          'LayerHeadSlot',
          null,
        ],
        additive: [
          'mesh',
          { kind: 'curve', curveName: 'LayerHeadAdditive' },
        ],
      },
      {
        name: 'ArmLeft',
        cachedPoseName: 'Arm Left',
        slotName: 'ArmLeft',
        curves: [
          'LayerArmLeft',
          'LayerArmLeftAdditive',
          'LayerArmLeftSlot',
          'LayerArmLeftLocalSpace',
        ],
        additive: [
          'local',
          { kind: 'curve', curveName: 'LayerArmLeftAdditive' },
        ],
      },
      {
        name: 'ArmRight',
        cachedPoseName: 'Arm Right',
        slotName: 'ArmRight',
        curves: [
          'LayerArmRight',
          'LayerArmRightAdditive',
          'LayerArmRightSlot',
          'LayerArmRightLocalSpace',
        ],
        additive: [
          'local',
          { kind: 'curve', curveName: 'LayerArmRightAdditive' },
        ],
      },
    ])
  })
})

describe('resolveAlsLayeringState', () => {
  it('matches RefreshLayering curve reads and preserves authored values', () => {
    const state = resolveAlsLayeringState(new Map([
      ['LayerHead', 0.01],
      ['LayerHeadAdditive', 0.02],
      ['LayerHeadSlot', 0.03],
      ['LayerArmLeft', 0.11],
      ['LayerArmLeftAdditive', 0.12],
      ['LayerArmLeftSlot', 0.13],
      ['LayerArmLeftLocalSpace', 0.99999],
      ['LayerArmRight', 0.21],
      ['LayerArmRightAdditive', 0.22],
      ['LayerArmRightSlot', 0.23],
      ['LayerArmRightLocalSpace', 0.99998],
      ['LayerHandLeft', 0.31],
      ['LayerHandRight', 0.32],
      ['LayerSpine', 0.41],
      ['LayerSpineAdditive', 0.42],
      ['LayerSpineSlot', 0.43],
      ['LayerPelvis', 0.51],
      ['LayerPelvisSlot', 0.52],
      ['LayerLegs', 1.25],
      ['LayerLegsSlot', -0.25],
    ]))

    expect(state).toEqual({
      headBlendAmount: 0.01,
      headAdditiveBlendAmount: 0.02,
      headSlotBlendAmount: 0.03,
      armLeftBlendAmount: 0.11,
      armLeftAdditiveBlendAmount: 0.12,
      armLeftSlotBlendAmount: 0.13,
      armLeftLocalSpaceBlendAmount: 0.99999,
      armLeftMeshSpaceBlendAmount: 0,
      armRightBlendAmount: 0.21,
      armRightAdditiveBlendAmount: 0.22,
      armRightSlotBlendAmount: 0.23,
      armRightLocalSpaceBlendAmount: 0.99998,
      armRightMeshSpaceBlendAmount: 1,
      handLeftBlendAmount: 0.31,
      handRightBlendAmount: 0.32,
      spineBlendAmount: 0.41,
      spineAdditiveBlendAmount: 0.42,
      spineSlotBlendAmount: 0.43,
      pelvisBlendAmount: 0.51,
      pelvisSlotBlendAmount: 0.52,
      legsBlendAmount: 1.25,
      legsSlotBlendAmount: -0.25,
    })
  })

  it('uses zero for every missing curve before deriving arm mesh space', () => {
    expect(resolveAlsLayeringState(new Map())).toEqual({
      headBlendAmount: 0,
      headAdditiveBlendAmount: 0,
      headSlotBlendAmount: 0,
      armLeftBlendAmount: 0,
      armLeftAdditiveBlendAmount: 0,
      armLeftSlotBlendAmount: 0,
      armLeftLocalSpaceBlendAmount: 0,
      armLeftMeshSpaceBlendAmount: 1,
      armRightBlendAmount: 0,
      armRightAdditiveBlendAmount: 0,
      armRightSlotBlendAmount: 0,
      armRightLocalSpaceBlendAmount: 0,
      armRightMeshSpaceBlendAmount: 1,
      handLeftBlendAmount: 0,
      handRightBlendAmount: 0,
      spineBlendAmount: 0,
      spineAdditiveBlendAmount: 0,
      spineSlotBlendAmount: 0,
      pelvisBlendAmount: 0,
      pelvisSlotBlendAmount: 0,
      legsBlendAmount: 0,
      legsSlotBlendAmount: 0,
    })
  })
})

describe('AB_Als_Layering final curve composition', () => {
  it('zeros only Overlay region slots, accumulates every curve, then returns the override', () => {
    const locomotion = new Map([
      ['LocomotionOnly', 2],
      ['Shared', 3],
      ['LayerHeadSlot', 0.25],
      ['LayerArmLeftSlot', 0.75],
    ])
    const overlay = new Map([
      ['OverlayOnly', 5],
      ['Shared', 7],
      ['LayerHead', 0.8],
      ['LayerHeadSlot', 0.9],
      ['LayerLegsSlot', 0.6],
    ])

    const finalCurves = composeAlsLayeringFinalCurves(locomotion, overlay)

    expect(Object.fromEntries(finalCurves)).toEqual({
      LocomotionOnly: 2,
      Shared: 10,
      LayerHeadSlot: 0.25,
      LayerArmLeftSlot: 0.75,
      OverlayOnly: 5,
      LayerHead: 0.8,
      LayerArmRightSlot: 0,
      LayerSpineSlot: 0,
      LayerPelvisSlot: 0,
      LayerLegsSlot: 0,
    })
    expect(overlay.get('LayerHeadSlot')).toBe(0.9)
    expect(ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES).toEqual([
      'LayerHeadSlot',
      'LayerArmLeftSlot',
      'LayerArmRightSlot',
      'LayerSpineSlot',
      'LayerPelvisSlot',
      'LayerLegsSlot',
    ])
  })
})

function layeringTestRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  const pelvis = new THREE.Bone()
  pelvis.name = 'pelvis'
  const thighLeft = new THREE.Bone()
  thighLeft.name = 'thigh_l'
  const thighRight = new THREE.Bone()
  thighRight.name = 'thigh_r'
  const spine1 = new THREE.Bone()
  spine1.name = 'spine_01'
  const spine2 = new THREE.Bone()
  spine2.name = 'spine_02'
  const spine3 = new THREE.Bone()
  spine3.name = 'spine_03'
  const neck = new THREE.Bone()
  neck.name = 'neck_01'
  const head = new THREE.Bone()
  head.name = 'head'
  const clavicleLeft = new THREE.Bone()
  clavicleLeft.name = 'clavicle_l'
  const handLeft = new THREE.Bone()
  handLeft.name = 'hand_l'
  const clavicleRight = new THREE.Bone()
  clavicleRight.name = 'clavicle_r'
  const handRight = new THREE.Bone()
  handRight.name = 'hand_r'

  root.add(pelvis)
  pelvis.add(thighLeft, thighRight, spine1)
  spine1.add(spine2)
  spine2.add(spine3)
  spine3.add(neck, clavicleLeft, clavicleRight)
  neck.add(head)
  clavicleLeft.add(handLeft)
  clavicleRight.add(handRight)
  return createRigDefinition(root)
}

describe('AB_Als_Layering pose evaluation', () => {
  it('round-trips locomotion through the authored dynamic-additive caches', () => {
    const rig = layeringTestRig()
    const basePose = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const overlayPose = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const locomotionPose = resetPoseToReference(
      createPoseBuffer(rig.boneCount),
      rig,
    )
    const outputPose = createPoseBuffer(rig.boneCount)

    for (let bone = 0; bone < rig.boneCount; bone++) {
      const positionOffset = bone * 3
      const rotationOffset = bone * 4
      locomotionPose.positions[positionOffset] += bone * 0.03
      locomotionPose.positions[positionOffset + 1] -= bone * 0.02
      locomotionPose.scales[positionOffset] += bone * 0.001
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0.3, 0.5, 0.2).normalize(),
        bone * 0.017,
      ).toArray(locomotionPose.rotations, rotationOffset)
    }

    const curves = new Map([
      ['LayerLegs', 1],
      ['LayerPelvis', 1],
      ['LayerSpine', 1],
      ['LayerSpineAdditive', 1],
      ['LayerHead', 1],
      ['LayerHeadAdditive', 1],
      ['LayerArmLeft', 1],
      ['LayerArmLeftAdditive', 1],
      ['LayerArmLeftLocalSpace', 1],
      ['LayerArmRight', 1],
      ['LayerArmRightAdditive', 1],
      ['LayerArmRightLocalSpace', 1],
    ])

    evaluateAlsLayeringPose(
      createAlsLayeringPoseRuntime(rig),
      {
        locomotionPose,
        overlayPose,
        basePose,
        curves,
      },
      outputPose,
    )

    for (let index = 0; index < outputPose.data.length; index++) {
      expect(outputPose.data[index]).toBeCloseTo(
        locomotionPose.data[index],
        5,
      )
    }
  })
})
