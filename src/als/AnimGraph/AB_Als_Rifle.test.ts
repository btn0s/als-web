import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileClipSampler } from '../../engine/clipSampler'
import {
  createMutableUePoseNode,
  type UeSequencePoseSource,
} from '../../engine/uePoseGraph'
import { blendPoseNodesTogether } from '../../engine/uePoseBlend'
import { createRigDefinition } from '../../engine/rig'
import {
  ALS_RIFLE_RELAXED_GRAPH,
  ALS_RIFLE_GRAPH,
  createAlsRifleRuntime,
  createAlsRifleRelaxedRuntime,
  evaluateAlsRifleGraph,
  evaluateAlsRifleRelaxedGraph,
  refreshAlsRifleRuntime,
  refreshAlsRifleRelaxedState,
  sampleCF_Als_Aim_In,
  sampleCF_Als_Aim_Out,
  type AlsRifleFullInput,
  type AlsRifleFullSources,
  type AlsRifleRelaxedSources,
  type AlsRifleRelaxedStateInput,
  type AlsRifleSequencePlayerSource,
} from './AB_Als_Rifle'

function createRig() {
  const root = new THREE.Bone()
  root.name = 'root'
  return createRigDefinition(root)
}

function createSource(
  rig: ReturnType<typeof createRig>,
  name: string,
  positionBase: number,
  curveBase: number,
  rotation: THREE.Quaternion,
): UeSequencePoseSource {
  const quaternion = rotation.toArray()
  const clip = new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(
      'root.position',
      [0, 1],
      [
        positionBase, 0, 0,
        positionBase + 100, 0, 0,
      ],
    ),
    new THREE.QuaternionKeyframeTrack(
      'root.quaternion',
      [0, 1],
      [...quaternion, ...quaternion],
    ),
  ])
  return {
    sampler: compileClipSampler(clip, rig),
    curves: {
      GraphCurve: (time) => curveBase + time * 10,
    },
  }
}

function createPlayerSource(
  source: UeSequencePoseSource,
  time = 0.2,
  loop = false,
): AlsRifleSequencePlayerSource {
  return { ...source, time, loop }
}

function createSources(
  rig: ReturnType<typeof createRig>,
): AlsRifleRelaxedSources {
  const identity = new THREE.Quaternion()
  const rotateX = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    2 * Math.PI / 3,
  )
  const rotateY = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    2 * Math.PI / 3,
  )
  const rotateZ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    2 * Math.PI / 3,
  )
  return {
    poses: createSource(rig, 'poses', 0, 0, rotateY),
    runArms: createPlayerSource(
      createSource(rig, 'run', 100, 100, rotateX),
    ),
    sprintArms: createPlayerSource(
      createSource(rig, 'sprint', 200, 200, rotateZ),
    ),
    sprintImpulseArms: createPlayerSource(
      createSource(rig, 'sprint-impulse', 300, 300, identity),
    ),
  }
}

function createStateInput(
  overrides: Partial<AlsRifleRelaxedStateInput> = {},
): AlsRifleRelaxedStateInput {
  const velocityBlend = {
    forwardAmount: 1,
    backwardAmount: 0,
    leftAmount: 0,
    rightAmount: 0,
  }
  return {
    relevant: true,
    deltaTime: 0,
    standingAmount: 1,
    crouchingAmount: 0,
    gaitWalkingAmount: 0,
    gaitRunningAmount: 0,
    gaitSprintingAmount: 0,
    inAirAmount: 0,
    groundPredictionAmount: 0,
    sprintAccelerationAmount: 0,
    ...overrides,
    velocityBlend: overrides.velocityBlend ?? velocityBlend,
  }
}

function evaluateFresh(
  input: Partial<AlsRifleRelaxedStateInput>,
) {
  const rig = createRig()
  const runtime = createAlsRifleRelaxedRuntime(rig)
  refreshAlsRifleRelaxedState(runtime, createStateInput(input))
  return evaluateAlsRifleRelaxedGraph(runtime, createSources(rig))
}

function createFullSources(
  rig: ReturnType<typeof createRig>,
): AlsRifleFullSources {
  const relaxed = createSources(rig)
  const identity = new THREE.Quaternion()
  return {
    ...relaxed,
    // Keep the idle delta neutral so state/action assertions measure only
    // the compiled Rifle graph nodes under test.
    idle: createPlayerSource(
      createSource(rig, 'idle', 0, 0, identity),
      0,
      true,
    ),
    idleReference: createSource(rig, 'idle-reference', 0, 0, identity),
    aim: createSource(rig, 'aim', 100, 0, identity),
    aimCrouch: createSource(rig, 'aim-crouch', 300, 0, identity),
    aimReference: createSource(rig, 'aim-reference', 200, 0, identity),
  }
}

function createFullInput(
  overrides: Partial<AlsRifleFullInput> = {},
): AlsRifleFullInput {
  return {
    ...createStateInput(),
    rotationMode: 'ViewDirection',
    locomotionMode: 'Grounded',
    gait: 'Walking',
    transitionsAllowed: true,
    moving: false,
    pitchAmount: 0,
    ...overrides,
    velocityBlend: overrides.velocityBlend ?? createStateInput().velocityBlend,
  }
}

describe('AB_Als_Rifle Relaxed graph', () => {
  it('freezes the exact compiled-node topology and authored sequence times', () => {
    expect(ALS_RIFLE_RELAXED_GRAPH.moduleOutputNodeIndex).toBe(32)
    expect(
      ALS_RIFLE_RELAXED_GRAPH.applyAdditiveNodeIndex,
    ).toBe(34)
    expect(ALS_RIFLE_RELAXED_GRAPH.idleAdditiveAlpha).toBe(0.75)
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node27).toMatchObject({
      inputs: [47, 44],
      normalizeAlpha: true,
    })
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node28).toMatchObject({
      inputs: [39, 42, 36, 35],
      normalizeAlpha: true,
    })
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node32.inputs).toEqual([27, 30])
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node47.inputs).toEqual([46, 43])
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node43.inputs).toEqual([45, 40])
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node40.inputs).toEqual([28, 41])
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node41).toMatchObject({
      inputs: [38, 37],
      resetChildOnActivation: true,
    })
    expect(ALS_RIFLE_RELAXED_GRAPH.nodes.node30.inputs).toEqual([31, 29])
    expect(ALS_RIFLE_RELAXED_GRAPH.sequenceEvaluators).toMatchObject({
      node46: { explicitTime: 0 },
      node45: { explicitTime: 0.05 },
      node44: { explicitTime: 0.216667 },
      node31: { explicitTime: 0.316667 },
      node29: { explicitTime: 0.35 },
    })
    expect(ALS_RIFLE_RELAXED_GRAPH.sequencePlayers.node37).toEqual({
      sequence: 'A_Als_Rifle_Sprint_Impulse_Arms',
      groupName: 'Movement',
      groupRole: 'AlwaysFollower',
      playRate: 0,
    })
  })

  it('samples every fixed Poses evaluator time without scrubbing between states', () => {
    const idle = evaluateFresh({})
    expect(idle.pose.positions[0]).toBeCloseTo(0)
    expect(idle.curves.get('GraphCurve')).toBeCloseTo(0)

    const walking = evaluateFresh({ gaitWalkingAmount: 1 })
    expect(walking.pose.positions[0]).toBeCloseTo(5)
    expect(walking.curves.get('GraphCurve')).toBeCloseTo(0.5)

    const crouching = evaluateFresh({
      standingAmount: 0,
      crouchingAmount: 1,
    })
    expect(crouching.pose.positions[0]).toBeCloseTo(21.6667, 4)
    expect(crouching.curves.get('GraphCurve')).toBeCloseTo(2.16667, 4)

    const inAir = evaluateFresh({ inAirAmount: 1 })
    expect(inAir.pose.positions[0]).toBeCloseTo(31.6667, 4)
    expect(inAir.curves.get('GraphCurve')).toBeCloseTo(3.16667, 4)

    const groundPrediction = evaluateFresh({
      inAirAmount: 1,
      groundPredictionAmount: 1,
    })
    expect(groundPrediction.pose.positions[0]).toBeCloseTo(35)
    expect(groundPrediction.curves.get('GraphCurve')).toBeCloseTo(3.5)
  })

  it('uses the live looping Movement follower time for arm players', () => {
    const rig = createRig()
    const sources = createSources(rig)
    const runArms = {
      ...sources.runArms,
      time: 1.25,
      loop: true,
    }
    const runtime = createAlsRifleRelaxedRuntime(rig)
    refreshAlsRifleRelaxedState(runtime, createStateInput({
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
    }))

    const output = evaluateAlsRifleRelaxedGraph(runtime, {
      ...sources,
      runArms,
    })

    expect(output.pose.positions[0]).toBeCloseTo(125)
    expect(output.curves.get('GraphCurve')).toBeCloseTo(102.5)
  })

  it('normalizes velocity alphas and preserves each nested quaternion boundary', () => {
    const rig = createRig()
    const sources = createSources(rig)
    const runtime = createAlsRifleRelaxedRuntime(rig)
    refreshAlsRifleRelaxedState(runtime, createStateInput({
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 0.5,
      sprintAccelerationAmount: 0.125,
      velocityBlend: {
        forwardAmount: 0.5,
        backwardAmount: 0.5,
        leftAmount: 0,
        rightAmount: 0,
      },
    }))

    const output = evaluateAlsRifleRelaxedGraph(runtime, sources)
    const flattened = createMutableUePoseNode(rig.boneCount)
    blendPoseNodesTogether(
      [
        runtime.nodes.node39,
        runtime.nodes.node42,
        runtime.nodes.node38,
        runtime.nodes.node37,
      ],
      [0.25, 0.25, 0.25, 0.25],
      flattened,
    )

    expect([...runtime.state.velocityBlendWeights]).toEqual([
      0.5, 0.5, 0, 0,
    ])
    const quaternionDistance = Math.min(
      Math.hypot(
        ...output.pose.rotations.map(
          (value, index) => value - flattened.pose.rotations[index],
        ),
      ),
      Math.hypot(
        ...output.pose.rotations.map(
          (value, index) => value + flattened.pose.rotations[index],
        ),
      ),
    )
    expect(quaternionDistance).toBeGreaterThan(0.01)
    expect(output.pose.positions[0]).toBeCloseTo(166.25)
    expect(output.curves.get('GraphCurve')).toBeCloseTo(151.625)
  })

  it('ports relevance-gated alpha filters and node41 child resets', () => {
    const runtime = createAlsRifleRelaxedRuntime(createRig())

    let state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      standingAmount: 0.5,
      crouchingAmount: 0.25,
      gaitWalkingAmount: 0,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
      velocityBlend: {
        forwardAmount: 0.4,
        backwardAmount: 0.2,
        leftAmount: 0.2,
        rightAmount: 0,
      },
    }))
    expect([...state.stanceWeights]).toEqual([
      expect.closeTo(2 / 3),
      expect.closeTo(1 / 3),
    ])
    expect([...state.velocityBlendWeights]).toEqual([0.5, 0.25, 0.25, 0])
    expect(state.node43Relevant).toBe(false)
    expect(state.gaitRunningAmount).toBe(0)

    state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
    }))
    expect(state.gaitRunningAmount).toBe(1)
    expect(state.gaitSprintingAmount).toBe(1)
    expect(state.node41Relevant).toBe(true)
    expect(state.node41ResetChildOnActivation).toEqual({
      sprintArms: true,
      sprintImpulseArms: false,
    })

    state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      deltaTime: 0.05,
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
      sprintAccelerationAmount: 0.25,
    }))
    expect(state.sprintAccelerationAmount).toBe(1)
    expect(state.node41ResetChildOnActivation).toEqual({
      sprintArms: false,
      sprintImpulseArms: true,
    })

    state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      deltaTime: 0.05,
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
      sprintAccelerationAmount: 0.25,
    }))
    expect(state.node41ResetChildOnActivation).toEqual({
      sprintArms: false,
      sprintImpulseArms: false,
    })

    state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      deltaTime: 2,
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
      sprintAccelerationAmount: 0,
    }))
    expect(state.sprintAccelerationAmount).toBe(0)
    expect(state.node41ResetChildOnActivation).toEqual({
      sprintArms: true,
      sprintImpulseArms: false,
    })
  })

  it('uses snap increases and exact asymmetric decay speeds', () => {
    const runtime = createAlsRifleRelaxedRuntime(createRig())
    refreshAlsRifleRelaxedState(runtime, createStateInput({
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
    }))

    let state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      deltaTime: 0.1,
      gaitWalkingAmount: 1,
      gaitRunningAmount: 0,
      gaitSprintingAmount: 0,
    }))
    expect(state.gaitRunningAmount).toBeCloseTo(0.5)
    expect(state.gaitSprintingAmount).toBeCloseTo(0.5)

    state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      deltaTime: 0.001,
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
    }))
    expect(state.gaitRunningAmount).toBe(1)
    expect(state.gaitSprintingAmount).toBe(1)

    const inAirRuntime = createAlsRifleRelaxedRuntime(createRig())
    refreshAlsRifleRelaxedState(inAirRuntime, createStateInput({
      inAirAmount: 1,
      groundPredictionAmount: 0,
    }))
    state = refreshAlsRifleRelaxedState(inAirRuntime, createStateInput({
      deltaTime: 0.025,
      inAirAmount: 1,
      groundPredictionAmount: 1,
    }))
    expect(state.groundPredictionAmount).toBeCloseTo(0.5)
    state = refreshAlsRifleRelaxedState(inAirRuntime, createStateInput({
      deltaTime: 0.1,
      inAirAmount: 1,
      groundPredictionAmount: 0,
    }))
    expect(state.groundPredictionAmount).toBeCloseTo(0.25)
    state = refreshAlsRifleRelaxedState(inAirRuntime, createStateInput({
      deltaTime: 0.05,
      inAirAmount: 0,
      groundPredictionAmount: 0,
    }))
    expect(state.inAirAmount).toBeCloseTo(0.5)
  })

  it('maps sprint acceleration unclamped, then clamps only the final pose alpha', () => {
    const rig = createRig()
    const runtime = createAlsRifleRelaxedRuntime(rig)
    const state = refreshAlsRifleRelaxedState(runtime, createStateInput({
      gaitWalkingAmount: 1,
      gaitRunningAmount: 1,
      gaitSprintingAmount: 1,
      sprintAccelerationAmount: 0.5,
    }))
    const output = evaluateAlsRifleRelaxedGraph(runtime, createSources(rig))

    expect(state.mappedSprintAccelerationAmount).toBe(2)
    expect(state.sprintAccelerationAmount).toBe(2)
    expect(output.pose.positions[0]).toBeCloseTo(320)
    expect(output.curves.get('GraphCurve')).toBeCloseTo(302)
  })
})

describe('AB_Als_Rifle full state machine', () => {
  it('skips transition evaluation on the first relevant update, then chains Relaxed → Ready → Aiming', () => {
    const rig = createRig()
    const runtime = createAlsRifleRuntime(rig)
    const input = createFullInput({ rotationMode: 'Aiming' })

    refreshAlsRifleRuntime(runtime, input)
    expect(runtime.rifleStates.currentState).toBe('Relaxed')
    expect(runtime.transitionsTakenThisFrame).toBe(0)
    expect(runtime.lifecycleEvents).toEqual([])

    refreshAlsRifleRuntime(runtime, input)
    expect(runtime.rifleStates.currentState).toBe('Aiming')
    expect(runtime.transitionsTakenThisFrame).toBe(2)
    expect(runtime.rifleStates.activeTransitions).toHaveLength(2)
    expect(runtime.rifleStates.activeTransitions.map((transition) => [
      transition.previousState,
      transition.nextState,
    ])).toEqual([
      ['Relaxed', 'Ready'],
      ['Ready', 'Aiming'],
    ])
    expect(runtime.lifecycleEvents).toEqual([{
      kind: 'AnimNotify',
      name: 'RelaxedToReady',
      callSite: 'TransitionStart',
    }])
  })

  it('uses the authored custom aim curves, including their asymmetric early ease', () => {
    expect(sampleCF_Als_Aim_In(0)).toBe(0)
    expect(sampleCF_Als_Aim_In(0.1)).toBeCloseTo(0.06191, 5)
    expect(sampleCF_Als_Aim_In(0.2)).toBeCloseTo(0.25)
    expect(sampleCF_Als_Aim_In(0.5)).toBeGreaterThan(0.25)
    expect(sampleCF_Als_Aim_In(1)).toBe(1)

    expect(sampleCF_Als_Aim_Out(0)).toBe(0)
    expect(sampleCF_Als_Aim_Out(0.25)).toBeCloseTo(0.05478, 5)
    expect(sampleCF_Als_Aim_Out(0.5)).toBeCloseTo(0.5)
    expect(sampleCF_Als_Aim_Out(0.75)).toBeCloseTo(0.94521829375)
    expect(sampleCF_Als_Aim_Out(1)).toBe(1)
  })

  it('takes Ready’s InAir/Sprinting fallback before elapsed Ready exits', () => {
    const rig = createRig()
    const runtime = createAlsRifleRuntime(rig)
    const aiming = createFullInput({ rotationMode: 'Aiming' })
    refreshAlsRifleRuntime(runtime, aiming)
    refreshAlsRifleRuntime(runtime, aiming)
    refreshAlsRifleRuntime(runtime, createFullInput({
      rotationMode: 'Aiming',
      deltaTime: 1,
    }))
    refreshAlsRifleRuntime(runtime, createFullInput({
      rotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      gait: 'Sprinting',
      moving: true,
      transitionsAllowed: true,
    }))
    const latest = runtime.rifleStates.activeTransitions.at(-1)
    expect(runtime.rifleStates.currentState).toBe('Relaxed')
    expect(latest).toMatchObject({
      previousState: 'Ready',
      nextState: 'Relaxed',
      crossfadeDuration: ALS_RIFLE_GRAPH.rifleStates.transitions[5].duration,
    })
    expect(runtime.lifecycleEvents).toEqual([])
  })

  it('uses GameplayTagsBlend target-child blend times and authored override curves', () => {
    const rig = createRig()
    const sources = createFullSources(rig)
    const runtime = createAlsRifleRuntime(rig)

    refreshAlsRifleRuntime(runtime, createFullInput({
      locomotionAction: 'Rolling',
    }))
    expect(runtime.gameplayTagsBlend.currentState).toBe(3)
    expect(runtime.gameplayTagsBlend.activeTransitions[0]).toMatchObject({
      previousState: 0,
      nextState: 3,
      crossfadeDuration: 0.3,
    })
    refreshAlsRifleRuntime(runtime, createFullInput({
      locomotionAction: 'Rolling',
      deltaTime: 0.3,
    }))
    const rolling = evaluateAlsRifleGraph(
      runtime,
      createFullInput({ locomotionAction: 'Rolling' }),
      sources,
    )
    expect(rolling.actionChild).toBe(3)
    expect(rolling.pose.positions[0]).toBeCloseTo(31.6667, 4)
    expect(rolling.curves.get('LayerArmLeft')).toBe(3)
    expect(rolling.curves.get('LayerArmLeftAdditive')).toBe(0)
    expect(rolling.curves.get('LayerArmRight')).toBe(3)
    expect(rolling.curves.get('LayerArmRightAdditive')).toBe(0)

    const gettingUp = createAlsRifleRuntime(rig)
    refreshAlsRifleRuntime(gettingUp, createFullInput({
      locomotionAction: 'GettingUp',
    }))
    expect(gettingUp.gameplayTagsBlend.currentState).toBe(2)
    expect(gettingUp.gameplayTagsBlend.activeTransitions).toHaveLength(0)
    const gettingUpOutput = evaluateAlsRifleGraph(
      gettingUp,
      createFullInput({ locomotionAction: 'GettingUp' }),
      sources,
    )
    expect(gettingUpOutput.actionChild).toBe(2)
    expect(gettingUpOutput.pose.positions[0]).toBeCloseTo(25)
    expect(gettingUpOutput.curves.get('LayerArmRight')).toBe(3)
  })

  it('uses the authored standing aim reference frame for mesh-space additive evaluation', () => {
    const rig = createRig()
    const runtime = createAlsRifleRuntime(rig)
    const sources = createFullSources(rig)
    const aiming = createFullInput({
      rotationMode: 'Aiming',
      pitchAmount: 0.5,
    })
    refreshAlsRifleRuntime(runtime, aiming)
    refreshAlsRifleRuntime(runtime, aiming)
    evaluateAlsRifleGraph(runtime, aiming, sources)

    expect(ALS_RIFLE_GRAPH.aiming.aimExplicitTime).toBe('PitchAmount')
    expect(runtime.nodes.aimReference.pose.positions[0]).toBeCloseTo(200 + 100 * (9 / 30))
    expect(runtime.statePoses.Aiming.pose.positions[0]).toBeCloseTo(
      (15 + 100 * (1 / 30) * 0.5)
      + (150 - (200 + 100 * (5 / 30))),
      4,
    )
  })
})
