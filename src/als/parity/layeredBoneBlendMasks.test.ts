/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  compileBranchFilterMask,
  type BranchFilter,
} from '../../engine/branchFilter'
import { createRigDefinition } from '../../engine/rig'

interface DumpedBranchFilter {
  readonly BoneName: string
  readonly BlendDepth: number
}

interface DumpedLayeredBoneBlend {
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly LayerSetup: readonly {
      readonly BranchFilters: readonly DumpedBranchFilter[]
    }[]
    readonly PerBoneBlendWeights: readonly {
      readonly SourceIndex: number
      readonly BlendWeight: number
    }[]
  }
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as {
  readonly assets: {
    readonly AB_Als_Layering: {
      readonly nodes: readonly DumpedLayeredBoneBlend[]
    }
  }
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
  rig = createRigDefinition(gltf.scene)
})

describe('ALS LayeredBoneBlend branch-filter masks', () => {
  it('reproduces every dumped physical-bone blend weight', () => {
    const nodes = graph.assets.AB_Als_Layering.nodes.filter(
      (node) => node.type === 'FAnimNode_LayeredBoneBlend',
    )
    expect(nodes).toHaveLength(7)
    expect(rig.boneCount).toBe(68)

    for (const node of nodes) {
      expect(node.parameters.PerBoneBlendWeights.length).toBeGreaterThanOrEqual(
        rig.boneCount,
      )
      for (
        let layerIndex = 0;
        layerIndex < node.parameters.LayerSetup.length;
        layerIndex++
      ) {
        const filters = node.parameters.LayerSetup[layerIndex].BranchFilters
          .map((filter): BranchFilter => ({
            boneName: filter.BoneName,
            blendDepth: filter.BlendDepth,
          }))
        const mask = compileBranchFilterMask(rig, filters)

        for (let bone = 0; bone < rig.boneCount; bone++) {
          const dumped = node.parameters.PerBoneBlendWeights[bone]
          const expected = dumped.SourceIndex === layerIndex
            ? dumped.BlendWeight
            : 0
          expect(
            mask[bone],
            `${node.property} layer ${layerIndex} bone ${rig.boneNames[bone]}`,
          ).toBeCloseTo(expected, 6)
        }
      }
    }
  })
})
