/// <reference types="node" />

import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileClipCurveSamplers } from '../../engine/curves'
import { createRigDefinition } from '../../engine/rig'
import { ALS_VIRTUAL_BONES } from '../Utility/AlsVirtualBones'

type Vector3Tuple = readonly [number, number, number]
type QuaternionTuple = readonly [number, number, number, number]

interface TransformOracle {
  readonly translation: Vector3Tuple
  readonly rotation: QuaternionTuple
  readonly scale: Vector3Tuple
}

interface VirtualBoneOracle {
  readonly index: number
  readonly name: string
  readonly source: string
  readonly target: string
}

interface HandVirtualBoneReference {
  readonly name: string
  readonly local: TransformOracle
}

interface LayerOracle {
  readonly index: number
  readonly branchFilters: readonly string[]
  readonly selectedCompactPoseIndices: readonly number[]
}

interface HandVirtualBoneOracle {
  readonly compactPose: {
    readonly physicalBoneCount: number
    readonly virtualBoneCount: number
    readonly virtualBones: readonly VirtualBoneOracle[]
  }
  readonly referencePose: {
    readonly physicalTargets: readonly {
      readonly name: string
      readonly parent: string
      readonly component: TransformOracle
    }[]
    readonly handVirtualBones: readonly HandVirtualBoneReference[]
  }
  readonly layeringNode92: {
    readonly compiledIndex: number
    readonly property: string
    readonly meshSpaceRotationBlend: boolean
    readonly meshSpaceScaleBlend: boolean
    readonly curveBlendMode: string
    readonly layers: readonly LayerOracle[]
    readonly physicalIkBonesRemainBase: readonly {
      readonly index: number
      readonly name: string
      readonly sourceIndex: number
      readonly blendWeight: number
    }[]
  }
  readonly rifleAttachment: {
    readonly useGunBoneForOverlayObjectsDefault: boolean
    readonly useLeftGunBone: boolean
    readonly target: string
    readonly relativeTransform: TransformOracle
    readonly attachmentRules: {
      readonly location: string
      readonly rotation: string
      readonly scale: string
      readonly weldSimulatedBodies: boolean
    }
    readonly fallbackSocket: {
      readonly name: string
      readonly bone: string
      readonly translation: Vector3Tuple
      readonly rotationPitchYawRollDegrees: Vector3Tuple
      readonly scale: Vector3Tuple
    }
  }
  readonly controlRigHandIk: {
    readonly useHandIkBonesDefault: boolean
    readonly targetSelection: {
      readonly left: {
        readonly whenTrue: string
        readonly whenFalse: string
        readonly variable: string
      }
      readonly right: {
        readonly whenTrue: string
        readonly whenFalse: string
        readonly variable: string
      }
    }
    readonly executionOrder: readonly string[]
    readonly solvers: {
      readonly left: HandIkSolverOracle
      readonly right: HandIkSolverOracle
    }
  }
  readonly animationEvidence: {
    readonly rightHandToGunSamples: readonly {
      readonly clip: string
      readonly time: number
      readonly translation: Vector3Tuple
      readonly rotation: QuaternionTuple
    }[]
    readonly movingArmsOnlyClips: readonly {
      readonly clip: string
      readonly presentUnitCurves: readonly string[]
      readonly absentZeroCurves: readonly string[]
    }[]
  }
}

interface HandIkSolverOracle {
  readonly itemA: string
  readonly itemB: string
  readonly effectorItem: string
  readonly effectorTargetVariable: string
  readonly effectorSpace: string
  readonly weight: string
  readonly primaryAxis: Vector3Tuple
  readonly secondaryAxis: Vector3Tuple
  readonly poleVector: Vector3Tuple
  readonly poleVectorSpace: string
  readonly stretchEnabled: boolean
  readonly stretchStartRatio: number
  readonly stretchMaximumRatio: number
  readonly propagateToChildren: boolean
}

interface DumpedLayeredBoneBlend {
  readonly compiledIndex: number
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly LayerSetup: readonly {
      readonly BranchFilters: readonly {
        readonly BoneName: string
        readonly BlendDepth: number
      }[]
    }[]
    readonly PerBoneBlendWeights: readonly {
      readonly SourceIndex: number
      readonly BlendWeight: number
    }[]
    readonly CurveBlendOption: string
    readonly bMeshSpaceRotationBlend: boolean
    readonly bMeshSpaceScaleBlend: boolean
  }
}

interface RigVmGraph {
  readonly path: string
  readonly pins: readonly {
    readonly path: string
    readonly defaultValue?: string
  }[]
  readonly links: readonly {
    readonly source: string
    readonly target: string
  }[]
}

const oracle = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/hand-virtual-bones.json', import.meta.url),
  'utf8',
)) as HandVirtualBoneOracle

const abpGraph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as {
  readonly assets: {
    readonly AB_Als_Layering: {
      readonly nodes: readonly DumpedLayeredBoneBlend[]
    }
  }
}

const controlRig = JSON.parse(readFileSync(
  new URL(
    '../../../scripts/extract-als/control-rig/CR_Als.json',
    import.meta.url,
  ),
  'utf8',
)) as {
  readonly graphs: readonly RigVmGraph[]
}

const propsManifest = readFileSync(
  new URL('../../../scripts/extract-als/props.manifest', import.meta.url),
  'utf8',
)

function loadAlsGltf() {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  return new GLTFLoader().parseAsync(data, '')
}

let gltf: Awaited<ReturnType<typeof loadAlsGltf>>

beforeAll(async () => {
  gltf = await loadAlsGltf()
})

function composeTransform(transform: TransformOracle): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.translation),
    new THREE.Quaternion(...transform.rotation),
    new THREE.Vector3(...transform.scale),
  )
}

function canonicalize(quaternion: THREE.Quaternion): THREE.Quaternion {
  if (quaternion.w < 0) {
    quaternion.set(
      -quaternion.x,
      -quaternion.y,
      -quaternion.z,
      -quaternion.w,
    )
  }
  return quaternion
}

function decompose(matrix: THREE.Matrix4) {
  const translation = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  matrix.decompose(translation, rotation, scale)
  canonicalize(rotation)
  return { translation, rotation, scale }
}

function unrealTransformToThree(transform: TransformOracle): TransformOracle {
  const [x, y, z] = transform.translation
  const [qx, qy, qz, qw] = transform.rotation
  const [sx, sy, sz] = transform.scale
  return {
    translation: [x * 0.01, z * 0.01, y * 0.01],
    rotation: [-qx, -qz, -qy, qw],
    scale: [sx, sz, sy],
  }
}

function expectTransformClose(
  actual: ReturnType<typeof decompose>,
  expected: TransformOracle,
  translationTolerance: number,
  rotationTolerance = 0.0002,
) {
  expect(
    actual.translation.distanceTo(new THREE.Vector3(...expected.translation)),
  ).toBeLessThan(translationTolerance)
  expect(
    actual.rotation.angleTo(new THREE.Quaternion(...expected.rotation).normalize()),
  ).toBeLessThan(rotationTolerance)
  expect(
    actual.scale.distanceTo(new THREE.Vector3(...expected.scale)),
  ).toBeLessThan(0.00001)
}

function clip(name: string): THREE.AnimationClip {
  const result = gltf.animations.find((animation) => animation.name === name)
  if (!result) throw new Error(`Missing extracted ALS clip "${name}"`)
  return result
}

describe('ALS hand virtual-bone topology parity', () => {
  it('freezes the exact compact-pose order absent from the physical GLB skin', () => {
    const physicalBones: THREE.Bone[] = []
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Bone) physicalBones.push(object)
    })

    expect(physicalBones).toHaveLength(oracle.compactPose.physicalBoneCount)
    expect(physicalBones.some((bone) => bone.name.startsWith('VB '))).toBe(false)
    expect(oracle.compactPose.virtualBones).toHaveLength(
      oracle.compactPose.virtualBoneCount,
    )
    expect(oracle.compactPose.virtualBones.map((bone) => bone.index)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 68),
    )
    expect(oracle.compactPose.virtualBones.map((bone) => [
      bone.name,
      bone.source,
      bone.target,
    ])).toEqual([
      ['VB foot_root', 'root', 'root'],
      ['VB foot_l', 'VB foot_root', 'foot_l'],
      ['VB foot_r', 'VB foot_root', 'foot_r'],
      ['VB hand_l_to_hand_r', 'hand_l', 'hand_r'],
      ['VB hand_r', 'VB hand_l_to_hand_r', 'hand_r'],
      ['VB hand_l_to_ik_hand_gun', 'hand_l', 'ik_hand_gun'],
      ['VB ik_hand_r', 'VB hand_l_to_ik_hand_gun', 'hand_r'],
      ['VB hand_r_to_hand_r', 'hand_r', 'hand_r'],
      ['VB hand_l', 'VB hand_r_to_hand_r', 'hand_l'],
      ['VB hand_r_to_ik_hand_gun', 'hand_r', 'ik_hand_gun'],
      ['VB ik_hand_l', 'VB hand_r_to_ik_hand_gun', 'hand_l'],
    ])
  })

  it('reconstructs every exact hand-VB reference transform from source and target', () => {
    const componentByName = new Map<string, THREE.Matrix4>(
      oracle.referencePose.physicalTargets.map((bone) => [
        bone.name,
        composeTransform(bone.component),
      ]),
    )
    const referenceByName = new Map(
      oracle.referencePose.handVirtualBones.map((bone) => [bone.name, bone]),
    )

    for (const definition of oracle.compactPose.virtualBones.slice(3)) {
      const source = componentByName.get(definition.source)
      const target = componentByName.get(definition.target)
      const reference = referenceByName.get(definition.name)
      if (!source || !target || !reference) {
        throw new Error(`Incomplete oracle for ${definition.name}`)
      }

      const derivedLocal = new THREE.Matrix4()
        .copy(source)
        .invert()
        .multiply(target)
      expectTransformClose(decompose(derivedLocal), reference.local, 0.0001)

      componentByName.set(
        definition.name,
        new THREE.Matrix4().multiplyMatrices(
          source,
          composeTransform(reference.local),
        ),
      )
    }
  })

  it('makes the production rig own the exact 79-bone order and hand-VB reference locals', () => {
    const rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
    expect(rig.physicalBoneCount).toBe(68)
    expect(rig.boneCount).toBe(79)
    expect(rig.boneNames.slice(68)).toEqual(
      oracle.compactPose.virtualBones.map((bone) => bone.name),
    )
    expect(rig.virtualBones.map((bone) => ({
      index: bone.boneIndex,
      name: bone.name,
      source: rig.boneNames[bone.sourceBoneIndex],
      target: rig.boneNames[bone.targetBoneIndex],
    }))).toEqual(
      oracle.compactPose.virtualBones.map((bone) => ({
        index: bone.index,
        name: bone.name,
        source: bone.source,
        target: bone.target,
      })),
    )

    const referenceByName = new Map(
      oracle.referencePose.handVirtualBones.map((bone) => [bone.name, bone]),
    )
    for (const virtualBone of rig.virtualBones.slice(3)) {
      const expected = referenceByName.get(virtualBone.name)
      if (!expected) throw new Error(`Missing ${virtualBone.name} reference oracle`)
      const positionOffset = virtualBone.boneIndex * 3
      const rotationOffset = virtualBone.boneIndex * 4
      expectTransformClose({
        translation: new THREE.Vector3().fromArray(
          rig.referencePositions,
          positionOffset,
        ),
        rotation: canonicalize(new THREE.Quaternion().fromArray(
          rig.referenceRotations,
          rotationOffset,
        )),
        scale: new THREE.Vector3().fromArray(
          rig.referenceScales,
          positionOffset,
        ),
      }, unrealTransformToThree(expected.local), 0.00001)
    }
  })

  it('matches the extracted physical GLB reference pose after basis conversion', () => {
    gltf.scene.updateMatrixWorld(true)
    const root = gltf.scene.getObjectByName('root')
    if (!(root instanceof THREE.Bone)) throw new Error('Missing root bone')
    const inverseRoot = root.matrixWorld.clone().invert()

    for (const expectedBone of oracle.referencePose.physicalTargets) {
      const bone = gltf.scene.getObjectByName(expectedBone.name)
      if (!(bone instanceof THREE.Bone)) {
        throw new Error(`Missing physical bone ${expectedBone.name}`)
      }
      const componentMatrix = inverseRoot.clone().multiply(bone.matrixWorld)
      expectTransformClose(
        decompose(componentMatrix),
        unrealTransformToThree(expectedBone.component),
        0.00001,
      )
    }
  })

  it('proves node 92 selects virtual branches while physical IK bones stay base', () => {
    const node = abpGraph.assets.AB_Als_Layering.nodes[
      oracle.layeringNode92.compiledIndex
    ]
    expect(node.compiledIndex).toBe(92)
    expect(node.property).toBe(oracle.layeringNode92.property)
    expect(node.type).toBe('FAnimNode_LayeredBoneBlend')
    expect(node.parameters.bMeshSpaceRotationBlend).toBe(
      oracle.layeringNode92.meshSpaceRotationBlend,
    )
    expect(node.parameters.bMeshSpaceScaleBlend).toBe(
      oracle.layeringNode92.meshSpaceScaleBlend,
    )
    expect(node.parameters.CurveBlendOption).toBe(
      `ECurveBlendOption::${oracle.layeringNode92.curveBlendMode}`,
    )
    expect(node.parameters.PerBoneBlendWeights).toHaveLength(79)

    for (const layer of oracle.layeringNode92.layers) {
      expect(
        node.parameters.LayerSetup[layer.index].BranchFilters,
      ).toEqual(layer.branchFilters.map((BoneName) => ({
        BoneName,
        BlendDepth: 0,
      })))
      const selected = node.parameters.PerBoneBlendWeights
        .map((weight, index) => ({ ...weight, index }))
        .filter((weight) => (
          weight.SourceIndex === layer.index && weight.BlendWeight === 1
        ))
        .map((weight) => weight.index)
      expect(selected).toEqual(layer.selectedCompactPoseIndices)
    }

    for (const physical of oracle.layeringNode92.physicalIkBonesRemainBase) {
      expect(node.parameters.PerBoneBlendWeights[physical.index]).toEqual({
        SourceIndex: physical.sourceIndex,
        BlendWeight: physical.blendWeight,
      })
    }
  })

  it('pins the Control Rig selectors and exact two-bone IK topology', () => {
    const graph = controlRig.graphs.find((candidate) => (
      candidate.path === 'RigVMModel'
    ))
    if (!graph) throw new Error('Missing CR_Als RigVMModel')
    const defaultByPin = new Map(
      graph.pins.map((pin) => [pin.path, pin.defaultValue]),
    )
    const links = new Set(graph.links.map((link) => (
      `${link.source}->${link.target}`
    )))
    const selection = oracle.controlRigHandIk.targetSelection

    expect(oracle.controlRigHandIk.useHandIkBonesDefault).toBe(true)
    expect(defaultByPin.get('If_2_1/True/Name')).toBe(selection.left.whenTrue)
    expect(defaultByPin.get('If_2_1/False/Name')).toBe(selection.left.whenFalse)
    expect(defaultByPin.get('VariableNode_9/Variable')).toBe(
      selection.left.variable,
    )
    expect(defaultByPin.get('If_2_1_1/True/Name')).toBe(
      selection.right.whenTrue,
    )
    expect(defaultByPin.get('If_2_1_1/False/Name')).toBe(
      selection.right.whenFalse,
    )
    expect(defaultByPin.get('VariableNode_10/Variable')).toBe(
      selection.right.variable,
    )
    expect(links).toContain('VariableNode_8_1.Value.bUseHandIkBones->If_2_1.Condition')
    expect(links).toContain('If_2_1.Result->VariableNode_9.Value')
    expect(links).toContain('VariableNode_8_2.Value.bUseHandIkBones->If_2_1_1.Condition')
    expect(links).toContain('If_2_1_1.Result->VariableNode_10.Value')
    expect(links).toContain('VariableNode_9.ExecuteContext->VariableNode_10.ExecuteContext')

    expect(oracle.controlRigHandIk.executionOrder).toEqual(['left', 'right'])
    expect(oracle.controlRigHandIk.solvers.left).toEqual({
      itemA: 'upperarm_l',
      itemB: 'lowerarm_l',
      effectorItem: 'hand_l',
      effectorTargetVariable: 'HandLeftIkTargetBone',
      effectorSpace: 'GlobalSpace',
      weight: 'clamp01(LayerArmLeft) * clamp01(HandLeftIk)',
      primaryAxis: [1, 0, 0],
      secondaryAxis: [0, -1, 0],
      poleVector: [0, -30, 0],
      poleVectorSpace: 'lowerarm_l',
      stretchEnabled: false,
      stretchStartRatio: 0.75,
      stretchMaximumRatio: 1.25,
      propagateToChildren: true,
    })
    expect(oracle.controlRigHandIk.solvers.right).toEqual({
      itemA: 'upperarm_r',
      itemB: 'lowerarm_r',
      effectorItem: 'hand_r',
      effectorTargetVariable: 'HandRightIkTargetBone',
      effectorSpace: 'GlobalSpace',
      weight: 'clamp01(LayerArmRight) * clamp01(HandRightIk)',
      primaryAxis: [-1, 0, 0],
      secondaryAxis: [0, 1, 0],
      poleVector: [0, 30, 0],
      poleVectorSpace: 'lowerarm_r',
      stretchEnabled: false,
      stretchStartRatio: 0.75,
      stretchMaximumRatio: 1.25,
      propagateToChildren: true,
    })
  })

  it('pins default rifle attachment to the right gun VB, never the fallback offset', () => {
    expect(oracle.rifleAttachment.useGunBoneForOverlayObjectsDefault).toBe(true)
    expect(oracle.rifleAttachment.useLeftGunBone).toBe(false)
    expect(oracle.rifleAttachment.target).toBe('VB hand_r_to_ik_hand_gun')
    expect(oracle.rifleAttachment.relativeTransform).toEqual({
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })
    expect(oracle.rifleAttachment.attachmentRules).toEqual({
      location: 'SnapToTarget',
      rotation: 'SnapToTarget',
      scale: 'SnapToTarget',
      weldSimulatedBodies: true,
    })
    expect(oracle.rifleAttachment.fallbackSocket).toEqual({
      name: 'Rifle',
      bone: 'hand_r',
      translation: [-10.14707, 5.234151, -0.669373],
      rotationPitchYawRollDegrees: [1.14474, 78.18995, 3.937074],
      scale: [1, 1, 1],
    })
    expect(propsManifest).toContain(
      'VB hand_r_to_ik_hand_gun (shipped default)',
    )
    expect(propsManifest).toContain(
      'default: identity (Location/Rotation/Scale SnapToTarget)',
    )
  })

  it('proves the right-hand gun VB is animated and not a physical-bone alias', () => {
    const animation = clip('A_Als_Rifle_Poses')
    const mixer = new THREE.AnimationMixer(gltf.scene)
    mixer.clipAction(animation).play()
    const hand = gltf.scene.getObjectByName('hand_r')
    const gun = gltf.scene.getObjectByName('ik_hand_gun')
    if (!(hand instanceof THREE.Bone)) throw new Error('Missing hand_r')
    if (!(gun instanceof THREE.Bone)) throw new Error('Missing ik_hand_gun')

    for (const sample of oracle.animationEvidence.rightHandToGunSamples) {
      mixer.setTime(sample.time)
      gltf.scene.updateMatrixWorld(true)
      const actual = decompose(
        hand.matrixWorld.clone().invert().multiply(gun.matrixWorld),
      )
      expectTransformClose(actual, unrealTransformToThree({
        translation: sample.translation,
        rotation: sample.rotation,
        scale: [1, 1, 1],
      }), 0.00001)
      expect(actual.translation.length()).toBeGreaterThan(0.09)
    }
  })

  it('proves moving rifle clips own the virtual hand branch but omit physical legs', () => {
    const poseCurves = compileClipCurveSamplers(clip('A_Als_Rifle_Poses'))
    expect(poseCurves.LayerLegs?.(0)).toBe(1)

    for (const evidence of oracle.animationEvidence.movingArmsOnlyClips) {
      const samplers = compileClipCurveSamplers(clip(evidence.clip))
      for (const curve of evidence.presentUnitCurves) {
        expect(samplers[curve], `${evidence.clip}/${curve}`).toBeDefined()
        expect(samplers[curve]?.(0), `${evidence.clip}/${curve}`).toBe(1)
      }
      for (const curve of evidence.absentZeroCurves) {
        expect(samplers[curve], `${evidence.clip}/${curve}`).toBeUndefined()
      }
    }
  })
})
