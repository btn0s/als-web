import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from './clipSampler'
import {
  createEvaluatorInertializationStage,
  createPoseEvaluator,
  evaluatePose,
} from './evaluator'
import { copyPose } from './poseBuffer'
import { createRigDefinition } from './rig'

function constantPositionClip(name: string, x: number) {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, 1],
      [x, 0, 0, x, 0, 0],
    ),
  ])
}

function setup() {
  const root = new THREE.Bone()
  root.name = 'root'
  const rig = createRigDefinition(root)
  return {
    rig,
    evaluator: createPoseEvaluator(rig),
    base: {
      sampler: compileClipSampler(constantPositionClip('base', 2), rig),
      time: 0,
      weight: 1,
    },
    flattened: {
      sampler: compileClipSampler(constantPositionClip('overlay', 20), rig),
      time: 0,
      weight: 1,
    },
  }
}

describe('authored evaluator pose graph seam', () => {
  it('passes the exact graph pose and resolved curves through Overlay inertialization', () => {
    const { rig, evaluator, base } = setup()
    const overlayInertialization = createEvaluatorInertializationStage(
      rig.boneCount,
    )
    let linkedCurve = -1

    const result = evaluatePose(evaluator, {
      base: [base],
      overlayGraph(context) {
        copyPose(context.referencePose, context.outputPose)
        context.outputPose.positions[0] = 10
        context.outputCurves.set('LayerArmRight', 0.75)
      },
      stagedInertialization: { overlay: overlayInertialization },
      linkedLayer(context) {
        linkedCurve = context.overlayCurves.get('LayerArmRight') ?? -1
        copyPose(context.overlayPose, context.outputPose)
      },
      resolveBlendedCurves(_samples, output) {
        output.set(
          'LayerArmRight',
          overlayInertialization.curves.get('LayerArmRight') ?? -1,
        )
      },
      deltaTime: 1 / 60,
    })

    expect(result.pose.positions[0]).toBeCloseTo(10)
    expect(linkedCurve).toBeCloseTo(0.75)
    expect(result.curves.values.get('LayerArmRight')).toBeCloseTo(0.75)
  })

  it('rejects flattening an authored graph beside the exact graph output', () => {
    const { evaluator, base, flattened } = setup()

    expect(() => evaluatePose(evaluator, {
      base: [base],
      overlayBranch: [flattened],
      overlayGraph() {},
      overlayLayers: [],
    })).toThrow('either overlayBranch or overlayGraph')
  })

  it('evaluates Locomotion before Grounded inertia and the Transition slot', () => {
    const { rig, evaluator } = setup()
    const locomotion = createEvaluatorInertializationStage(rig.boneCount)
    const transition = compileClipSampler(
      constantPositionClip('transition', 20),
      rig,
    )

    const result = evaluatePose(evaluator, {
      base: [],
      locomotionGraph(context) {
        copyPose(context.referencePose, context.outputPose)
        context.outputPose.positions[0] = 12
        context.outputCurves.set('PoseMoving', 1)
      },
      montages: [{
        sampler: transition,
        time: 0,
        weight: 0.25,
      }],
      stagedInertialization: { locomotion },
      resolveBlendedCurves(_samples, output) {
        output.set(
          'PoseMoving',
          locomotion.curves.get('PoseMoving') ?? -1,
        )
      },
    })

    expect(result.pose.positions[0]).toBeCloseTo(14)
    expect(evaluator.basePose.positions[0]).toBeCloseTo(14)
    expect(locomotion.curves.get('PoseMoving')).toBe(1)
    expect(result.curves.values.get('PoseMoving')).toBe(1)
  })

  it('rejects a flattened locomotion branch beside the exact graph output', () => {
    const { rig, evaluator, base } = setup()
    const locomotion = createEvaluatorInertializationStage(rig.boneCount)

    expect(() => evaluatePose(evaluator, {
      base: [base],
      locomotionGraph() {},
      stagedInertialization: { locomotion },
    })).toThrow('either locomotionGraph or flattened base/slots')
  })

  it('requires the authored Grounded inertialization boundary for Locomotion', () => {
    const { evaluator } = setup()

    expect(() => evaluatePose(evaluator, {
      base: [],
      locomotionGraph() {},
    })).toThrow('authored locomotion inertialization stage')
  })
})
