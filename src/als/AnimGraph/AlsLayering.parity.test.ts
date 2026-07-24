/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createRigDefinition } from '../../engine/rig'
import { ALS_VIRTUAL_BONES } from '../Utility/AlsVirtualBones'
import {
  ALS_LAYERED_BONE_BLEND_NODES,
  ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES,
  ALS_LAYERING_REGIONS,
  createAlsLayeringMasks,
} from './AlsLayering'

interface DumpedPoseReference {
  readonly LinkID: number
  readonly SourceLinkID: number
}

interface DumpedBranchFilter {
  readonly BoneName: string
  readonly BlendDepth: number
}

interface DumpedNodeParameters {
  readonly Additive?: DumpedPoseReference
  readonly Alpha?: number
  readonly ApplyMode?: string
  readonly Base?: DumpedPoseReference
  readonly BasePose?: DumpedPoseReference
  readonly BlendAmount?: number
  readonly BlendMode?: string
  readonly BlendPoses?: readonly DumpedPoseReference[]
  readonly CachePoseName?: string
  readonly CurveBlendOption?: string
  readonly CurveNames?: readonly string[]
  readonly CurveValues?: readonly number[]
  readonly CurvesPose?: DumpedPoseReference
  readonly LayerSetup?: readonly {
    readonly BranchFilters: readonly DumpedBranchFilter[]
  }[]
  readonly PerBoneBlendWeights?: readonly {
    readonly SourceIndex: number
    readonly BlendWeight: number
  }[]
  readonly SlotName?: string
  readonly Source?: DumpedPoseReference
  readonly SourcePose?: DumpedPoseReference
  readonly bMeshSpaceAdditive?: boolean
  readonly bMeshSpaceRotationBlend?: boolean
  readonly bMeshSpaceScaleBlend?: boolean
}

interface DumpedNode {
  readonly compiledIndex: number
  readonly property: string
  readonly type: string
  readonly parameters: DumpedNodeParameters
}

interface DumpedPoseLink {
  readonly sourceNodeIndex: number
  readonly targetNodeIndex: number
  readonly targetInput: string
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as {
  readonly assets: {
    readonly AB_Als_Layering: {
      readonly nodes: readonly DumpedNode[]
      readonly wiring: {
        readonly poseLinks: readonly DumpedPoseLink[]
      }
    }
  }
}

const asset = graph.assets.AB_Als_Layering

function node(index: number): DumpedNode {
  const result = asset.nodes[index]
  if (!result || result.compiledIndex !== index) {
    throw new Error(`Missing AB_Als_Layering compiled node ${index}`)
  }
  return result
}

function sourceNode(targetNodeIndex: number, targetInput: string): DumpedNode {
  const link = asset.wiring.poseLinks.find((candidate) => (
    candidate.targetNodeIndex === targetNodeIndex
    && candidate.targetInput === targetInput
  ))
  if (!link) {
    throw new Error(
      `Missing AB_Als_Layering link ${targetNodeIndex}.${targetInput}`,
    )
  }
  return node(link.sourceNodeIndex)
}

let rig: ReturnType<typeof createRigDefinition>

beforeAll(async () => {
  const bytes = readFileSync(
    new URL('../../../public/assets/skm-als.glb', import.meta.url),
  )
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  )
  const gltf = await new GLTFLoader().parseAsync(data, '')
  rig = createRigDefinition(gltf.scene, ALS_VIRTUAL_BONES)
})

describe('AB_Als_Layering graph topology parity', () => {
  it('proves both dynamic-additive spaces and every region construction chain', () => {
    expect(node(38).type).toBe('FAnimNode_MakeDynamicAdditive')
    expect(node(38).parameters.bMeshSpaceAdditive).toBe(false)
    expect(sourceNode(36, 'Pose').compiledIndex).toBe(38)
    expect(node(36).parameters.CachePoseName).toBe(
      'Locomotion Additive Local Space',
    )

    expect(node(39).type).toBe('FAnimNode_MakeDynamicAdditive')
    expect(node(39).parameters.bMeshSpaceAdditive).toBe(true)
    expect(sourceNode(37, 'Pose').compiledIndex).toBe(39)
    expect(node(37).parameters.CachePoseName).toBe(
      'Locomotion Additive Mesh Space',
    )

    for (const region of ALS_LAYERING_REGIONS) {
      const slot = node(region.slotNodeIndex)
      const slotBlend = node(region.slotBlendNodeIndex)
      const applyAdditive = node(region.applyDynamicAdditiveNodeIndex)
      const regionBlend = node(region.regionBlendNodeIndex)
      const saved = node(region.saveCachedPoseNodeIndex)

      expect(slot.type, region.name).toBe('FAnimNode_Slot')
      expect(slot.parameters.SlotName, region.name).toBe(region.slotName)
      expect(sourceNode(region.slotNodeIndex, 'Source').parameters.CachePoseName)
        .toBe('Overlay')

      expect(slotBlend.type, region.name).toBe('FAnimNode_TwoWayBlend')
      expect(sourceNode(region.slotBlendNodeIndex, 'A').parameters.CachePoseName)
        .toBe('Overlay')
      expect(sourceNode(region.slotBlendNodeIndex, 'B').compiledIndex)
        .toBe(region.slotNodeIndex)

      expect(applyAdditive.type, region.name).toBe(
        region.dynamicAdditiveSpace === 'mesh'
          ? 'FAnimNode_ApplyMeshSpaceAdditive'
          : 'FAnimNode_ApplyAdditive',
      )
      expect(applyAdditive.parameters.Alpha, region.name).toBe(1)
      expect(sourceNode(
        region.applyDynamicAdditiveNodeIndex,
        'Base',
      ).compiledIndex).toBe(region.slotBlendNodeIndex)
      expect(sourceNode(
        region.applyDynamicAdditiveNodeIndex,
        'Additive',
      ).parameters.CachePoseName).toBe(
        region.dynamicAdditiveSpace === 'mesh'
          ? 'Locomotion Additive Mesh Space'
          : 'Locomotion Additive Local Space',
      )

      expect(regionBlend.type, region.name).toBe('FAnimNode_TwoWayBlend')
      expect(sourceNode(
        region.regionBlendNodeIndex,
        'A',
      ).parameters.CachePoseName).toBe('Locomotion')
      expect(sourceNode(region.regionBlendNodeIndex, 'B').compiledIndex)
        .toBe(region.applyDynamicAdditiveNodeIndex)

      expect(saved.type, region.name).toBe('FAnimNode_SaveCachedPose')
      expect(saved.parameters.CachePoseName, region.name)
        .toBe(region.cachedPoseName)
      expect(sourceNode(region.saveCachedPoseNodeIndex, 'Pose').compiledIndex)
        .toBe(region.regionBlendNodeIndex)
    }
  })

  it('derives the seven-node LayeredBoneBlend order from graph wiring', () => {
    const reverseOrder: number[] = []
    let current = sourceNode(74, 'SourcePose')

    while (current.type === 'FAnimNode_LayeredBoneBlend') {
      reverseOrder.push(current.compiledIndex)
      current = sourceNode(current.compiledIndex, 'BasePose')
    }

    expect(current.type).toBe('FAnimNode_UseCachedPose')
    expect(current.parameters.CachePoseName).toBe('Legs')
    expect(reverseOrder.reverse()).toEqual(
      ALS_LAYERED_BONE_BLEND_NODES.map((definition) => definition.nodeIndex),
    )
  })

  it('proves every branch filter, source pose, and blend flag from the dump', () => {
    for (const definition of ALS_LAYERED_BONE_BLEND_NODES) {
      const dumped = node(definition.nodeIndex)

      expect(dumped.property).toBe(definition.nodeProperty)
      expect(dumped.type).toBe('FAnimNode_LayeredBoneBlend')
      expect(dumped.parameters.BlendMode).toBe(
        'ELayeredBoneBlendMode::BranchFilter',
      )
      expect(dumped.parameters.bMeshSpaceRotationBlend).toBe(
        definition.meshSpaceRotationBlend,
      )
      expect(dumped.parameters.bMeshSpaceScaleBlend).toBe(
        definition.meshSpaceScaleBlend,
      )
      expect(dumped.parameters.CurveBlendOption).toBe(
        `ECurveBlendOption::${definition.curveBlendMode}`,
      )
      expect(dumped.parameters.LayerSetup?.map((layer) => (
        layer.BranchFilters.map((filter) => ({
          boneName: filter.BoneName,
          blendDepth: filter.BlendDepth,
        }))
      ))).toEqual(
        definition.layers.map((layer) => layer.branchFilters),
      )

      for (let layerIndex = 0; layerIndex < definition.layers.length; layerIndex++) {
        expect(sourceNode(
          definition.nodeIndex,
          `BlendPoses[${layerIndex}]`,
        ).parameters.CachePoseName).toBe(
          definition.layers[layerIndex].sourcePose,
        )
      }
    }

    expect(ALS_LAYERED_BONE_BLEND_NODES.map((definition) => ({
      basePose: definition.basePose,
      weights: definition.layers.map((layer) => layer.weightSource),
    }))).toEqual([
      {
        basePose: 'Legs',
        weights: [{ kind: 'full', amount: 1 }],
      },
      {
        basePose: 'Previous',
        weights: [{ kind: 'full', amount: 1 }],
      },
      {
        basePose: 'Previous',
        weights: [{ kind: 'full', amount: 1 }],
      },
      {
        basePose: 'Previous',
        weights: [{
          kind: 'state',
          property: 'armLeftMeshSpaceBlendAmount',
        }],
      },
      {
        basePose: 'Previous',
        weights: [{
          kind: 'state',
          property: 'armRightMeshSpaceBlendAmount',
        }],
      },
      {
        basePose: 'Previous',
        weights: [
          {
            kind: 'state',
            property: 'armLeftLocalSpaceBlendAmount',
          },
          {
            kind: 'state',
            property: 'armRightLocalSpaceBlendAmount',
          },
        ],
      },
      {
        basePose: 'Previous',
        weights: [
          { kind: 'state', property: 'handLeftBlendAmount' },
          { kind: 'state', property: 'handRightBlendAmount' },
        ],
      },
    ])
  })

  it('compiles every layer to the complete dumped 79-bone compact-pose mask', () => {
    const compiled = createAlsLayeringMasks(rig)
    expect(compiled).toHaveLength(7)
    expect(rig.physicalBoneCount).toBe(68)
    expect(rig.boneCount).toBe(79)

    for (let nodeOrder = 0; nodeOrder < compiled.length; nodeOrder++) {
      const compiledNode = compiled[nodeOrder]
      const dumped = node(compiledNode.nodeIndex)
      const dumpedWeights = dumped.parameters.PerBoneBlendWeights
      if (!dumpedWeights) throw new Error('Dumped node has no per-bone weights')

      expect(compiledNode.nodeProperty).toBe(dumped.property)
      for (
        let layerIndex = 0;
        layerIndex < compiledNode.layerMasks.length;
        layerIndex++
      ) {
        const mask = compiledNode.layerMasks[layerIndex]
        for (let boneIndex = 0; boneIndex < rig.boneCount; boneIndex++) {
          const dumpedWeight = dumpedWeights[boneIndex]
          const expected = dumpedWeight.SourceIndex === layerIndex
            ? dumpedWeight.BlendWeight
            : 0
          expect(
            mask[boneIndex],
            `${dumped.property} layer ${layerIndex} ${rig.boneNames[boneIndex]}`,
          ).toBeCloseTo(expected, 6)
        }
      }
    }
  })

  it('proves nodes 52, 73, and 74 preserve the complete final curve container', () => {
    const modify = node(52)
    expect(modify.type).toBe('FAnimNode_ModifyCurve')
    expect(modify.parameters.CurveNames).toEqual(
      ALS_LAYERING_DISABLED_OVERLAY_SLOT_CURVES,
    )
    expect(modify.parameters.CurveValues).toEqual([0, 0, 0, 0, 0, 0])
    expect(modify.parameters.ApplyMode).toBe('EModifyCurveApplyMode::Blend')
    expect(modify.parameters.Alpha).toBe(1)
    expect(sourceNode(52, 'SourcePose').parameters.CachePoseName)
      .toBe('Overlay')

    const curvesSlot = node(51)
    expect(curvesSlot.type).toBe('FAnimNode_Slot')
    expect(curvesSlot.parameters.SlotName).toBe('Curves')
    expect(sourceNode(51, 'Source').compiledIndex).toBe(52)

    const accumulate = node(73)
    expect(accumulate.type).toBe('FAlsAnimNode_CurvesBlend')
    expect(accumulate.parameters.BlendMode).toBe(
      'EAlsCurvesBlendMode::BlendByAmount',
    )
    expect(accumulate.parameters.BlendAmount).toBe(1)
    expect(sourceNode(73, 'SourcePose').parameters.CachePoseName)
      .toBe('Locomotion')
    expect(sourceNode(73, 'CurvesPose').compiledIndex).toBe(51)

    const override = node(74)
    expect(override.type).toBe('FAlsAnimNode_CurvesBlend')
    expect(override.parameters.BlendMode).toBe(
      'EAlsCurvesBlendMode::Override',
    )
    expect(override.parameters.BlendAmount).toBe(1)
    expect(sourceNode(74, 'SourcePose').compiledIndex).toBe(92)
    expect(sourceNode(74, 'CurvesPose').compiledIndex).toBe(73)
  })
})
