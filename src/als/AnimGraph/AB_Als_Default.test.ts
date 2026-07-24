import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from '../../engine/clipSampler'
import {
  createPoseBuffer,
  resetPoseToReference,
} from '../../engine/poseBuffer'
import { createRigDefinition } from '../../engine/rig'
import {
  AB_ALS_DEFAULT_OVERLAY_GRAPH,
  createAlsDefaultOverlayGraphRuntime,
  createAlsDefaultOverlayGraphState,
  evaluateAlsDefaultOverlayGraph,
  refreshAlsDefaultOverlayGraph,
} from './AB_Als_Default'

function setup() {
  const root = new THREE.Bone()
  root.name = 'root'
  root.position.x = 50
  const rig = createRigDefinition(root)
  const clip = new THREE.AnimationClip('A_Als_Default_Poses', 1, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, 0.05, 0.083333, 1],
      [
        0, 0, 0,
        10, 0, 0,
        20, 0, 0,
        100, 0, 0,
      ],
    ),
  ])
  const referencePose = resetPoseToReference(
    createPoseBuffer(rig.boneCount),
    rig,
  )
  const runtime = createAlsDefaultOverlayGraphRuntime(
    rig,
    {
      sampler: compileClipSampler(clip, rig),
      curves: { LayerArmLeft: (time) => time * 100 },
    },
    referencePose,
  )
  return { rig, runtime, referencePose }
}

describe('AB_Als_Default Overlay graph', () => {
  it('pins the compiled node topology and authored evaluator times', () => {
    expect(AB_ALS_DEFAULT_OVERLAY_GRAPH).toMatchObject({
      applyIdleAdditive: {
        nodeIndex: 1,
        clip: 'A_Als_Idle',
        alpha: 0.75,
        syncGroup: 'Secondary Motion',
      },
      standingMoving: {
        nodeIndex: 2,
        alphaBinding: 'PoseState.GaitWalkingAmount',
        evaluators: [
          { nodeIndex: 5, explicitTime: 0 },
          { nodeIndex: 6, explicitTime: 0.05 },
        ],
      },
      groundedInAir: {
        nodeIndex: 3,
        alphaBinding: 'PoseState.InAirAmount',
      },
      groundPrediction: {
        nodeIndex: 4,
        interpolationSpeedIncreasing: 20,
        interpolationSpeedDecreasing: 5,
        evaluators: [
          { nodeIndex: 8, explicitTime: 0.05 },
          { nodeIndex: 9, explicitTime: 0 },
        ],
      },
      crouching: { nodeIndex: 7, explicitTime: 0.083333 },
      stance: { nodeIndex: 10, normalizeAlpha: true },
    })
  })

  it('uses the serialized GroundPrediction FInputScaleBiasClamp state', () => {
    const state = createAlsDefaultOverlayGraphState()
    const input = {
      gaitWalkingAmount: 0,
      standingAmount: 1,
      crouchingAmount: 0,
      inAirAmount: 1,
      groundPredictionAmount: 0.8,
      deltaTime: 0.1,
    }

    expect(
      refreshAlsDefaultOverlayGraph(state, input).groundPredictionAmount,
    ).toBe(0.8)
    expect(
      refreshAlsDefaultOverlayGraph(state, {
        ...input,
        groundPredictionAmount: 0,
      }).groundPredictionAmount,
    ).toBeCloseTo(0.4)
    expect(
      refreshAlsDefaultOverlayGraph(state, {
        ...input,
        groundPredictionAmount: 1,
      }).groundPredictionAmount,
    ).toBe(1)

    refreshAlsDefaultOverlayGraph(state, { ...input, relevant: false })
    expect(state.groundPrediction.initialized).toBe(false)
    expect(
      refreshAlsDefaultOverlayGraph(state, {
        ...input,
        groundPredictionAmount: 0.25,
      }).groundPredictionAmount,
    ).toBe(0.25)
  })

  it('evaluates fixed samples through Standing, normalized Stance, Prediction, then InAir', () => {
    const { rig, runtime } = setup()
    const outputPose = createPoseBuffer(rig.boneCount)
    const outputCurves = new Map<string, number>()

    evaluateAlsDefaultOverlayGraph(
      runtime,
      {
        gaitWalkingAmount: 0.5,
        standingAmount: 0.25,
        crouchingAmount: 0.75,
        inAirAmount: 0.4,
        groundPredictionAmount: 0.25,
      },
      outputPose,
      outputCurves,
    )

    // Standing: 0 -> 10 @ .5 = 5.
    // Stance: 5*.25 + 20*.75 = 16.25.
    // Prediction: 10 -> 0 @ .25 = 7.5.
    // InAir: 16.25 -> 7.5 @ .4 = 12.75.
    expect(outputPose.positions[0]).toBeCloseTo(12.75, 4)
    expect(outputCurves.get('LayerArmLeft')).toBeCloseTo(5.625, 4)
  })

  it('uses the reference pose when the normalized stance node has no relevant child', () => {
    const { rig, runtime, referencePose } = setup()
    const outputPose = createPoseBuffer(rig.boneCount)

    evaluateAlsDefaultOverlayGraph(
      runtime,
      {
        gaitWalkingAmount: 0,
        standingAmount: 0,
        crouchingAmount: 0,
        inAirAmount: 0,
        groundPredictionAmount: 0,
      },
      outputPose,
      new Map(),
    )

    expect([...outputPose.data]).toEqual([...referencePose.data])
  })
})
