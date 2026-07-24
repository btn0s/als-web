import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from './clipSampler'
import { createPoseEvaluator, evaluatePose } from './evaluator'
import {
  applyInertialization,
  createInertialization,
  evaluateInertialDecay,
} from './inertialization'
import {
  applyOutputInertialization,
  createOutputInertialization,
  prepareOutputInertialization,
} from './inertializationOutput'
import { createPoseBuffer } from './poseBuffer'
import type { RootMotionDelta } from './rootMotion'
import { createRootMotionExtractor } from './rootMotion'
import { createRigDefinition } from './rig'

function poseAt(x = 0) {
  const pose = createPoseBuffer(1)
  pose.positions[0] = x
  pose.rotations[3] = 1
  pose.scales.fill(1)
  return pose
}

function rootMotion(
  translationX: number,
  rotationY = 0,
): RootMotionDelta {
  return {
    translation: new Float32Array([translationX, 0, 0]),
    rotation: new Float32Array([
      0,
      Math.sin(rotationY * 0.5),
      0,
      Math.cos(rotationY * 0.5),
    ]),
    valid: true,
  }
}

function stepOutput(
  poseState: ReturnType<typeof createInertialization>,
  outputState: ReturnType<typeof createOutputInertialization>,
  curves: Map<string, number>,
  root: RootMotionDelta | undefined,
  deltaTime: number,
) {
  prepareOutputInertialization(outputState, poseState)
  applyInertialization(poseState, poseAt(), deltaTime)
  applyOutputInertialization(
    outputState,
    curves,
    root,
    deltaTime,
    poseState,
  )
}

function quaternionAngleY(rotation: Float32Array) {
  return 2 * Math.atan2(rotation[1], rotation[3])
}

function linearPositionClip(name: string, endX: number) {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, 1],
      [0, 0, 0, endX, 0, 0],
    ),
  ])
}

function constantPositionClip(name: string, x: number) {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, 1],
      [x, 0, 0, x, 0, 0],
    ),
  ])
}

describe('inertialized output channels', () => {
  it('preserves final curve and root-motion velocity on a zero-elapsed request frame', () => {
    const poseState = createInertialization(1)
    const outputState = createOutputInertialization()
    stepOutput(
      poseState,
      outputState,
      new Map([['PoseGait', 3]]),
      rootMotion(0.75, 0.3),
      0.25,
    )

    poseState.requestInertialization(1)
    const curves = new Map([['PoseGait', 0]])
    const root = rootMotion(0, 0)
    stepOutput(poseState, outputState, curves, root, 0)

    expect(curves.get('PoseGait')).toBeCloseTo(3)
    // UE cannot form a root-motion velocity difference when the destination frame has zero dt.
    expect(root.translation[0]).toBe(0)
    expect(quaternionAngleY(root.rotation)).toBeCloseTo(0)
  })

  it('consumes request-frame delta for curves and root translation/rotation velocity', () => {
    const poseState = createInertialization(1)
    const outputState = createOutputInertialization()
    stepOutput(
      poseState,
      outputState,
      new Map([['PoseGait', 10]]),
      rootMotion(2, 0.4),
      0.25,
    )

    poseState.requestInertialization(1)
    const curves = new Map([['PoseGait', 0]])
    const root = rootMotion(0.5, 0.1)
    stepOutput(poseState, outputState, curves, root, 0.25)

    expect(curves.get('PoseGait')).toBeCloseTo(
      evaluateInertialDecay(10, 0, 0.25, 1),
    )
    const translationVelocityDifference = 2 / 0.25 - 0.5 / 0.25
    expect(root.translation[0]).toBeCloseTo(
      0.5 + 0.25 * evaluateInertialDecay(
        translationVelocityDifference,
        0,
        0.25,
        1,
      ),
    )
    const rotationVelocityDifference = 0.4 / 0.25 - 0.1 / 0.25
    expect(quaternionAngleY(root.rotation)).toBeCloseTo(
      0.1 + 0.25 * evaluateInertialDecay(
        rotationVelocityDifference,
        0,
        0.25,
        1,
      ),
      5,
    )
  })

  it('ports UE curve union derivative and zero-value behavior exactly', () => {
    const poseState = createInertialization(1)
    const outputState = createOutputInertialization()
    stepOutput(
      poseState,
      outputState,
      new Map([
        ['OutgoingOnly', 1],
        ['Shared', 1],
      ]),
      undefined,
      0.2,
    )
    stepOutput(
      poseState,
      outputState,
      new Map([
        ['OutgoingOnly', 3],
        ['Shared', 3],
      ]),
      undefined,
      0.25,
    )

    poseState.requestInertialization(1)
    const curves = new Map([
      ['IncomingOnly', 5],
      ['Shared', 5],
    ])
    stepOutput(poseState, outputState, curves, undefined, 0)

    // FNamedValueArrayUtils unions missing curves as zero. At elapsed zero the outgoing
    // container is therefore reproduced, including an outgoing-only curve.
    expect(curves.get('OutgoingOnly')).toBeCloseTo(3)
    expect(curves.get('IncomingOnly')).toBeCloseTo(0)
    expect(curves.get('Shared')).toBeCloseTo(3)
    // Literal UE source formula:
    // Delta = Prev1 - Incoming = -2
    // Derivative = (Delta - Incoming - Prev2) / Prev1DeltaTime
    expect(outputState.curveDifferences.get('Shared')?.derivative)
      .toBeCloseTo((-2 - 5 - 1) / 0.25)

    const missingDestination = new Map<string, number>()
    stepOutput(
      poseState,
      outputState,
      missingDestination,
      undefined,
      0.25,
    )
    // The next destination omits every curve. UE's named-value union supplies zero; it does not
    // retain the request frame's incoming value under the active correction.
    expect(missingDestination.get('Shared')).toBeCloseTo(
      evaluateInertialDecay(-2, -32, 0.25, 1),
    )
  })

  it('recaptures final output on interruption and follows the pose deficit duration', () => {
    const poseState = createInertialization(1)
    const outputState = createOutputInertialization()
    stepOutput(
      poseState,
      outputState,
      new Map([['PoseGait', 10]]),
      rootMotion(1),
      0.1,
    )

    poseState.requestInertialization(1)
    const firstRequestCurves = new Map([['PoseGait', 0]])
    const firstRequestRoot = rootMotion(0)
    stepOutput(
      poseState,
      outputState,
      firstRequestCurves,
      firstRequestRoot,
      0.1,
    )

    const decayedCurves = new Map([['PoseGait', 0]])
    const decayedRoot = rootMotion(0)
    stepOutput(poseState, outputState, decayedCurves, decayedRoot, 0.25)

    poseState.requestInertialization(0.5)
    const interruptedCurves = new Map([['PoseGait', -20]])
    const interruptedRoot = rootMotion(-0.5)
    stepOutput(
      poseState,
      outputState,
      interruptedCurves,
      interruptedRoot,
      0.1,
    )

    const curveDelta = decayedCurves.get('PoseGait')! - (-20)
    const curveDerivative = (
      curveDelta
      - (-20)
      - firstRequestCurves.get('PoseGait')!
    ) / 0.25
    expect(interruptedCurves.get('PoseGait')).toBeCloseTo(
      -20 + evaluateInertialDecay(
        curveDelta,
        curveDerivative,
        0.1,
        0.5,
      ),
    )
    const rootVelocityDifference =
      decayedRoot.translation[0] / 0.25 - (-0.5 / 0.1)
    expect(interruptedRoot.translation[0]).toBeCloseTo(
      -0.5 + 0.1 * evaluateInertialDecay(
        rootVelocityDifference,
        0,
        0.1,
        0.5,
      ),
    )

    // A second interruption pays the prior 0.4-second deficit from the requested 0.5 seconds.
    poseState.requestInertialization(0.5)
    const secondInterruptedCurves = new Map([['PoseGait', 5]])
    stepOutput(
      poseState,
      outputState,
      secondInterruptedCurves,
      rootMotion(0),
      0,
    )
    expect(poseState.duration).toBeCloseTo(0.1)
    expect(secondInterruptedCurves.get('PoseGait'))
      .toBeCloseTo(interruptedCurves.get('PoseGait')!)
  })

  it('inertializes extracted root-motion velocity independently of root-pose correction', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const extractor = createRootMotionExtractor(rig)
    const moving = compileClipSampler(linearPositionClip('moving', 10), rig)
    const stopped = compileClipSampler(constantPositionClip('stopped', 1), rig)

    evaluatePose(evaluator, {
      base: [{ sampler: moving, time: 0, weight: 1 }],
      rootMotion: extractor,
      deltaTime: 0.1,
    })
    const movingResult = evaluatePose(evaluator, {
      base: [{ sampler: moving, time: 0.1, weight: 1 }],
      rootMotion: extractor,
      deltaTime: 0.1,
    })
    expect(movingResult.rootMotionDelta?.translation[0]).toBeCloseTo(1)

    evaluator.inertialization.requestInertialization(1)
    const stoppedResult = evaluatePose(evaluator, {
      base: [{ sampler: stopped, time: 0, weight: 1 }],
      rootMotion: extractor,
      deltaTime: 0.1,
    })

    // Raw root delta is zero and the pose itself has no discontinuity. Only UE's root-motion
    // velocity correction contributes this frame.
    expect(stoppedResult.pose.positions[0]).toBeCloseTo(1)
    expect(stoppedResult.rootMotionDelta?.translation[0]).toBeCloseTo(
      0.1 * evaluateInertialDecay(10, 0, 0.1, 1),
    )
  })

  it('inertializes an explicitly resolved final curve instead of per-clip samples', () => {
    const root = new THREE.Bone()
    root.name = 'root'
    const rig = createRigDefinition(root)
    const evaluator = createPoseEvaluator(rig)
    const clip = compileClipSampler(constantPositionClip('pose', 0), rig)
    let finalGait = 3
    const resolveBlendedCurves = (
      _samples: unknown,
      output: Map<string, number>,
    ) => {
      output.set('PoseGait', finalGait)
    }

    evaluatePose(evaluator, {
      base: [{ sampler: clip, time: 0, weight: 1 }],
      resolveBlendedCurves,
      deltaTime: 0.25,
    })
    evaluator.inertialization.requestInertialization(1)
    finalGait = 0
    const result = evaluatePose(evaluator, {
      base: [{ sampler: clip, time: 0, weight: 1 }],
      resolveBlendedCurves,
      deltaTime: 0.25,
    })

    expect(result.curves.values.get('PoseGait')).toBeCloseTo(
      evaluateInertialDecay(3, 0, 0.25, 1),
    )
  })
})
