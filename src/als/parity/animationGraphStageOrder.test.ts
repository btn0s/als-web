/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface AbpNode {
  readonly compiledIndex: number | null
  readonly property: string
  readonly type: string
  readonly parameters: {
    readonly InputPoseNames?: readonly string[]
    readonly InstanceClass?: { readonly ObjectName: string }
    readonly Layer?: string
    readonly SlotName?: string
  }
}

interface AbpPoseLink {
  readonly sourceNodeIndex: number
  readonly targetNodeIndex: number
  readonly targetInput: string
  readonly status: string
}

interface AbpAsset {
  readonly nodes: readonly AbpNode[]
  readonly wiring: { readonly poseLinks: readonly AbpPoseLink[] }
}

const graph = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/abp-graph.json', import.meta.url),
  'utf8',
)) as { readonly assets: Readonly<Record<string, AbpAsset>> }

function asset(name: string) {
  const value = graph.assets[name]
  if (!value) throw new Error(`Missing ALS AnimGraph asset "${name}"`)
  return value
}

function node(graphAsset: AbpAsset, property: string) {
  const value = graphAsset.nodes.find(
    (candidate) => candidate.property === property,
  )
  if (!value || value.compiledIndex === null) {
    throw new Error(`Missing compiled ALS AnimGraph node "${property}"`)
  }
  return value
}

function expectLink(
  graphAsset: AbpAsset,
  sourceProperty: string,
  targetProperty: string,
  targetInput: string,
) {
  const source = node(graphAsset, sourceProperty)
  const target = node(graphAsset, targetProperty)
  const matches = graphAsset.wiring.poseLinks.filter((link) =>
    link.sourceNodeIndex === source.compiledIndex
    && link.targetNodeIndex === target.compiledIndex
    && link.targetInput === targetInput
    && link.status === 'recovered',
  )
  expect(
    matches,
    `${sourceProperty} must feed ${targetProperty}.${targetInput}`,
  ).toHaveLength(1)
}

describe('ALS authored animation graph stage order', () => {
  it('places Grounded States inertialization before the top-level Transition slot', () => {
    const grounded = asset('AB_Als_Grounded')
    expect(node(grounded, 'AnimGraphNode_StateMachine').type)
      .toBe('FAnimNode_StateMachine')
    expect(node(grounded, 'AnimGraphNode_Inertialization').type)
      .toBe('FAnimNode_Inertialization')
    expect(node(grounded, 'AnimGraphNode_ModifyCurve').type)
      .toBe('FAnimNode_ModifyCurve')
    expectLink(
      grounded,
      'AnimGraphNode_StateMachine',
      'AnimGraphNode_Inertialization',
      'Source',
    )
    expectLink(
      grounded,
      'AnimGraphNode_Inertialization',
      'AnimGraphNode_ModifyCurve',
      'SourcePose',
    )

    const main = asset('AB_Als')
    const groundedGraph = node(main, 'AnimGraphNode_LinkedAnimGraph_3')
    const transitionSlot = node(main, 'AnimGraphNode_Slot_1')
    const locomotionGraph = node(main, 'AnimGraphNode_LinkedAnimGraph_2')
    const postLocomotionSlot = node(main, 'AnimGraphNode_Slot')
    expect(groundedGraph.parameters.InstanceClass?.ObjectName)
      .toBe("AnimBlueprintGeneratedClass'AB_Als_Grounded_C'")
    expect(transitionSlot.parameters.SlotName).toBe('Transition')
    expect(locomotionGraph.parameters.InstanceClass?.ObjectName)
      .toBe("AnimBlueprintGeneratedClass'AB_Als_Locomotion_C'")
    expect(postLocomotionSlot.parameters.SlotName).toBe('PostLocomotion')
    expectLink(
      main,
      groundedGraph.property,
      transitionSlot.property,
      'Source',
    )
    expectLink(
      main,
      transitionSlot.property,
      locomotionGraph.property,
      'InputPoses[0]',
    )
    expectLink(
      main,
      locomotionGraph.property,
      postLocomotionSlot.property,
      'Source',
    )
  })

  it('inertializes the full linked Overlay branch before AB_Als_Layering', () => {
    const main = asset('AB_Als')
    const overlayLayer = node(main, 'AnimGraphNode_LinkedAnimLayer')
    const overlayInertialization = node(
      main,
      'AnimGraphNode_Inertialization',
    )
    const postLocomotionSlot = node(main, 'AnimGraphNode_Slot')
    const layeringGraph = node(main, 'AnimGraphNode_LinkedAnimGraph_6')

    expect(overlayLayer.parameters.Layer).toBe('Overlay')
    expect(overlayInertialization.type).toBe('FAnimNode_Inertialization')
    expect(layeringGraph.parameters.InstanceClass?.ObjectName)
      .toBe("AnimBlueprintGeneratedClass'AB_Als_Layering_C'")
    expect(layeringGraph.parameters.InputPoseNames)
      .toEqual(['Locomotion Input', 'Overlay Input'])
    expectLink(
      main,
      overlayLayer.property,
      overlayInertialization.property,
      'Source',
    )
    expectLink(
      main,
      postLocomotionSlot.property,
      layeringGraph.property,
      'InputPoses[0]',
    )
    expectLink(
      main,
      overlayInertialization.property,
      layeringGraph.property,
      'InputPoses[1]',
    )
  })

  it('evaluates Layering, then View, then CR_Als', () => {
    const main = asset('AB_Als')
    const layeringGraph = node(main, 'AnimGraphNode_LinkedAnimGraph_6')
    const viewGraph = node(main, 'AnimGraphNode_LinkedAnimGraph')
    const controlRig = node(main, 'AnimGraphNode_ControlRig')

    expect(layeringGraph.parameters.InstanceClass?.ObjectName)
      .toBe("AnimBlueprintGeneratedClass'AB_Als_Layering_C'")
    expect(viewGraph.parameters.InstanceClass?.ObjectName)
      .toBe("AnimBlueprintGeneratedClass'AB_Als_View_C'")
    expect(viewGraph.parameters.InputPoseNames).toEqual(['View Input'])
    expect(controlRig.type).toBe('FAnimNode_ControlRig')
    expectLink(
      main,
      layeringGraph.property,
      viewGraph.property,
      'InputPoses[0]',
    )
    expectLink(
      main,
      viewGraph.property,
      controlRig.property,
      'Source',
    )
  })
})
