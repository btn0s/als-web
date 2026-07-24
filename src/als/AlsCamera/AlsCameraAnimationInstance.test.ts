import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_CAMERA_ANIMATION_CURVE_NAMES,
  createAlsCameraAnimationInstance,
  refreshAlsCameraAnimationInstance,
  type AlsCameraAnimationInstanceInput,
} from './AlsCameraAnimationInstance'

interface OracleModifier {
  readonly sourceNodeIndex?: number
  readonly curveNames: readonly string[]
  readonly values: readonly number[]
  readonly applyMode: string
  readonly kind?: string
}

interface OracleBlend {
  readonly sourceNodeIndices: readonly number[]
  readonly tags: readonly string[]
  readonly blendTimes: readonly number[]
  readonly blendType: string
  readonly customCurve: string | null
  readonly resetChildOnActivation: boolean
}

interface OracleLookStance {
  readonly pivotModifier: OracleModifier
  readonly gaitBlend: OracleBlend
  readonly profiles: readonly OracleModifier[]
}

interface OracleLookBranch {
  readonly finalModifier: OracleModifier
  readonly stanceBlend: OracleBlend
  readonly Standing: OracleLookStance
  readonly Crouching: OracleLookStance
}

interface CameraContentOracle {
  readonly curveNames: readonly { readonly name: string }[]
  readonly blendCurves: Readonly<Record<string, {
    readonly keys: readonly {
      readonly InterpMode: string
      readonly Time: number
      readonly Value: number
      readonly ArriveTangent: number
      readonly LeaveTangent: number
    }[]
  }>>
  readonly animGraph: {
    readonly nodes: readonly {
      readonly index: number
      readonly type: string
      readonly StateMachineIndexInClass?: number
      readonly MaxTransitionsPerFrame?: number
      readonly bSkipFirstUpdateTransition?: boolean
      readonly bReinitializeOnBecomingRelevant?: boolean
    }[]
    readonly stateMachine: {
      readonly initialState: string
      readonly states: readonly {
        readonly name: string
        readonly transitions: readonly {
          readonly targetState: string
          readonly expression: {
            readonly value: string
          }
        }[]
      }[]
      readonly transitions: readonly {
        readonly previousState: string
        readonly nextState: string
        readonly duration: number
        readonly blendMode: string
        readonly customCurve: string
      }[]
    }
    readonly branches: {
      readonly lookStates: Readonly<Record<string, OracleLookBranch>>
      readonly viewMode: {
        readonly blend: OracleBlend
        readonly ThirdPerson: OracleModifier
        readonly FirstPerson: OracleModifier
      }
      readonly shoulder: {
        readonly blend: OracleBlend
        readonly branches: readonly OracleModifier[]
      }
      readonly locomotionAction: Readonly<
        Record<string, OracleBlend | OracleModifier>
      > & {
        readonly blend: OracleBlend
      }
    }
  }
}

type Curves = Record<string, number>

const oracle = JSON.parse(
  readFileSync(
    new URL('../../../scripts/extract-als/camera-content.json', import.meta.url),
    'utf8',
  ),
) as CameraContentOracle

const curveNames = oracle.curveNames.map(({ name }) => name)
const graph = oracle.animGraph

function createZeroCurves(): Curves {
  return Object.fromEntries(curveNames.map((name) => [name, 0]))
}

function cloneCurves(source: Curves): Curves {
  return Object.fromEntries(curveNames.map((name) => [name, source[name]]))
}

function applyModifier(curves: Curves, modifier: OracleModifier): Curves {
  for (let index = 0; index < modifier.curveNames.length; index++) {
    const name = modifier.curveNames[index]
    const value = modifier.values[index]
    if (modifier.applyMode.endsWith('::Scale')) {
      curves[name] *= value
    } else {
      curves[name] = value
    }
  }
  return curves
}

function childIndexForTag(
  blend: OracleBlend,
  tag: string | null,
): number {
  const tagIndex = blend.tags.indexOf(tag ?? '')
  return tagIndex < 0 ? 0 : tagIndex + 1
}

function profileCurves(
  stateName: string,
  stanceTag: string | null = null,
  gaitTag: string | null = null,
): Curves {
  const branch = graph.branches.lookStates[stateName.replaceAll(' ', '')]
  const stanceIndex = childIndexForTag(branch.stanceBlend, stanceTag)
  const stance = stanceIndex === 0 ? branch.Standing : branch.Crouching
  const gaitIndex = childIndexForTag(stance.gaitBlend, gaitTag)
  return applyModifier(
    applyModifier(
      applyModifier(
        createZeroCurves(),
        stance.profiles[gaitIndex],
      ),
      stance.pivotModifier,
    ),
    branch.finalModifier,
  )
}

function mixCurves(
  sources: readonly Curves[],
  weights: readonly number[],
): Curves {
  const output = createZeroCurves()
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    for (const name of curveNames) {
      output[name] += sources[sourceIndex][name] * weights[sourceIndex]
    }
  }
  return output
}

function sampleCustomBlend(name: string, time: number): number {
  const keys = oracle.blendCurves[name].keys
  if (time <= keys[0].Time) return keys[0].Value
  const last = keys[keys.length - 1]
  if (time >= last.Time) return last.Value

  let fromIndex = 0
  while (keys[fromIndex + 1].Time <= time) fromIndex++
  const from = keys[fromIndex]
  const to = keys[fromIndex + 1]
  if (from.InterpMode === 'RCIM_Constant') return from.Value

  const duration = to.Time - from.Time
  const alpha = (time - from.Time) / duration
  if (from.InterpMode === 'RCIM_Linear') {
    return from.Value + (to.Value - from.Value) * alpha
  }

  const alphaSquared = alpha * alpha
  const alphaCubed = alphaSquared * alpha
  return (
    (2 * alphaCubed - 3 * alphaSquared + 1) * from.Value
    + (alphaCubed - 2 * alphaSquared + alpha)
      * from.LeaveTangent * duration
    + (-2 * alphaCubed + 3 * alphaSquared) * to.Value
    + (alphaCubed - alphaSquared) * to.ArriveTangent * duration
  )
}

function sampleStandardBlend(blendType: string, alpha: number): number {
  const option = blendType.split('::').at(-1)
  if (option === 'Cubic' || option === 'HermiteCubic') {
    return alpha * alpha * (3 - 2 * alpha)
  }
  if (option === 'Linear') return alpha
  if (option === 'QuadraticInOut') {
    return alpha < 0.5
      ? 2 * alpha * alpha
      : -2 * alpha * alpha + 4 * alpha - 1
  }
  throw new Error(`unsupported test blend option "${blendType}"`)
}

function rotationModeForState(stateName: string): string {
  for (const state of graph.stateMachine.states) {
    const transition = state.transitions.find(
      ({ targetState }) => targetState === stateName,
    )
    if (transition) return transition.expression.value
  }
  throw new Error(`no RotationMode route for "${stateName}"`)
}

function actionTag(branchName: string): string {
  const tag = graph.branches.locomotionAction.blend.tags.find(
    (candidate) => candidate.endsWith(`.${branchName}`),
  )
  if (!tag) throw new Error(`no action tag for "${branchName}"`)
  return tag
}

function lookTransition(previousState: string, nextState: string) {
  const transition = graph.stateMachine.transitions.find(
    (candidate) =>
      candidate.previousState === previousState
      && candidate.nextState === nextState,
  )
  if (!transition) {
    throw new Error(`no look transition ${previousState} -> ${nextState}`)
  }
  return transition
}

function input(
  overrides: Partial<AlsCameraAnimationInstanceInput> = {},
): AlsCameraAnimationInstanceInput {
  return {
    ViewMode: null,
    LocomotionMode: 'Als.LocomotionMode.Grounded',
    RotationMode: rotationModeForState(graph.stateMachine.initialState),
    Stance: null,
    Gait: null,
    LocomotionAction: null,
    bRightShoulder: true,
    ...overrides,
  }
}

function expectCurves(actual: Curves, expected: Curves) {
  for (const name of curveNames) {
    // UE stores transition/state weights as float; the port deliberately
    // writes through Float32Array at the same boundary.
    expect(Math.abs(actual[name] - expected[name]), name)
      .toBeLessThanOrEqual(2e-5)
  }
}

describe('AlsCameraAnimationInstance', () => {
  it('emits the oracle curve set through stable allocation-free outputs', () => {
    const state = createAlsCameraAnimationInstance()
    const curves = state.curves
    const curveValues = state.curveValues

    expect(ALS_CAMERA_ANIMATION_CURVE_NAMES).toEqual(curveNames)
    expect(Object.keys(curves)).toEqual(curveNames)
    expect(curveNames).toHaveLength(13)

    const inputs = [
      input(),
      input({
        RotationMode: rotationModeForState('View Direction'),
        Stance: graph.branches.lookStates.ViewDirection.stanceBlend.tags[0],
        Gait:
          graph.branches.lookStates.ViewDirection.Crouching.gaitBlend.tags[0],
        bRightShoulder: true,
      }),
      input({
        ViewMode: graph.branches.viewMode.blend.tags[0],
        RotationMode: rotationModeForState('Aiming'),
        Gait: graph.branches.lookStates.Aiming.Standing.gaitBlend.tags[1],
        LocomotionAction: actionTag('Mantling'),
      }),
      input({ LocomotionAction: actionTag('Ragdolling') }),
      input({
        RotationMode: 'Als.RotationMode.Invalid',
        LocomotionAction: 'Als.LocomotionAction.Invalid',
      }),
    ]

    for (const nextInput of inputs) {
      const output = refreshAlsCameraAnimationInstance(state, nextInput, 10)
      expect(output).toBe(curves)
      expect(state.curveValues).toBe(curveValues)
      expect(Object.keys(output)).toEqual(curveNames)
      for (const value of Object.values(output)) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('matches an oracle-derived steady View Direction crouching/running profile', () => {
    const state = createAlsCameraAnimationInstance()
    const branch = graph.branches.lookStates.ViewDirection
    const stance = branch.stanceBlend.tags[0]
    const gait = branch.Crouching.gaitBlend.tags[0]
    refreshAlsCameraAnimationInstance(state, input(), 0)

    const actual = refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: rotationModeForState('View Direction'),
        Stance: stance,
        Gait: gait,
      }),
      10,
    )

    expectCurves(
      actual,
      profileCurves('View Direction', stance, gait),
    )
  })

  it('pins authored transition priority, duration, blend mode, and relevancy settings', () => {
    const stateMachineNode = graph.nodes.find(
      (node) =>
        node.type === 'FAnimNode_StateMachine'
        && node.StateMachineIndexInClass === 0,
    )
    expect(stateMachineNode?.MaxTransitionsPerFrame).toBe(3)
    expect(stateMachineNode?.bSkipFirstUpdateTransition).toBe(true)
    expect(stateMachineNode?.bReinitializeOnBecomingRelevant).toBe(true)
    expect(
      graph.stateMachine.states.map((state) => [
        state.name,
        state.transitions.map(({ targetState }) => targetState),
      ]),
    ).toEqual([
      ['Velocity Direction', ['View Direction', 'Aiming']],
      ['View Direction', ['Aiming', 'Velocity Direction']],
      ['Aiming', ['Velocity Direction', 'View Direction']],
    ])
    expect(
      graph.stateMachine.transitions.map((transition) => [
        `${transition.previousState}->${transition.nextState}`,
        transition.duration,
        transition.blendMode,
        transition.customCurve,
      ]),
    ).toEqual([
      [
        'Velocity Direction->View Direction',
        1,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Smooth',
      ],
      [
        'Velocity Direction->Aiming',
        0.3499999940395355,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Quick',
      ],
      [
        'View Direction->Aiming',
        0.3499999940395355,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Quick',
      ],
      [
        'View Direction->Velocity Direction',
        1,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Smooth',
      ],
      [
        'Aiming->Velocity Direction',
        1,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Smooth',
      ],
      [
        'Aiming->View Direction',
        1,
        'EAlphaBlendOption::Custom',
        'CF_Als_CameraBlend_Smooth',
      ],
    ])
    expect(graph.branches.viewMode.blend).toMatchObject({
      blendTimes: [0.1, 0.1],
      blendType: 'EAlphaBlendOption::HermiteCubic',
      customCurve: null,
      resetChildOnActivation: false,
    })
    expect(graph.branches.shoulder.blend).toMatchObject({
      blendTimes: [0.5, 0.5],
      blendType: 'EAlphaBlendOption::Custom',
      customCurve: 'CF_Als_CameraBlend_Quick',
      resetChildOnActivation: false,
    })
    expect(graph.branches.locomotionAction.blend).toMatchObject({
      blendTimes: [0.4, 0.2, 0.2, 1],
      blendType: 'EAlphaBlendOption::Cubic',
      customCurve: null,
      resetChildOnActivation: false,
    })
    for (const state of graph.stateMachine.states) {
      const branch = graph.branches.lookStates[
        state.name.replaceAll(' ', '')
      ]
      expect(branch.stanceBlend.resetChildOnActivation).toBe(false)
      expect(branch.Standing.gaitBlend.resetChildOnActivation).toBe(true)
      expect(branch.Crouching.gaitBlend.resetChildOnActivation).toBe(true)
    }
  })

  it('takes the first valid transition but discards its blend on the skipped first update', () => {
    const state = createAlsCameraAnimationInstance()
    const initialUpdate = refreshAlsCameraAnimationInstance(
      state,
      input(),
      10,
    )
    expectCurves(
      initialUpdate,
      profileCurves(graph.stateMachine.initialState),
    )

    const redirectedState = createAlsCameraAnimationInstance()
    const viewInput = input({
      RotationMode: rotationModeForState('View Direction'),
    })
    const firstUpdate = refreshAlsCameraAnimationInstance(
      redirectedState,
      viewInput,
      10,
    )
    expectCurves(firstUpdate, profileCurves('View Direction'))
    expect(
      redirectedState.lookStateMachine.transitionStack.currentState,
    ).toBe(
      graph.stateMachine.states.findIndex(
        ({ name }) => name === 'View Direction',
      ),
    )
    expect(
      redirectedState.lookStateMachine.transitionStack.activeTransitions,
    ).toHaveLength(0)
  })

  it('uses the authored custom curve at a direct look-transition midpoint', () => {
    const state = createAlsCameraAnimationInstance()
    refreshAlsCameraAnimationInstance(state, input(), 0)

    const transition = lookTransition('Velocity Direction', 'Aiming')
    const alpha = sampleCustomBlend(transition.customCurve, 0.5)
    const actual = refreshAlsCameraAnimationInstance(
      state,
      input({ RotationMode: rotationModeForState('Aiming') }),
      transition.duration / 2,
    )
    const expected = mixCurves(
      [
        profileCurves('Velocity Direction'),
        profileCurves('Aiming'),
      ],
      [1 - alpha, alpha],
    )

    expectCurves(actual, expected)
  })

  it('applies shoulder sign before the Hermite FirstPerson blend', () => {
    const state = createAlsCameraAnimationInstance()
    const viewInput = input({
      RotationMode: rotationModeForState('View Direction'),
      bRightShoulder: false,
    })
    const source = profileCurves('View Direction')
    refreshAlsCameraAnimationInstance(
      state,
      input({ bRightShoulder: false }),
      0,
    )
    refreshAlsCameraAnimationInstance(state, viewInput, 10)

    const shoulderBlend = graph.branches.shoulder.blend
    const shoulderDuration = shoulderBlend.blendTimes[0]
    const shoulderAlpha = sampleCustomBlend(
      shoulderBlend.customCurve!,
      0.5,
    )
    const shoulderMidpoint = refreshAlsCameraAnimationInstance(
      state,
      { ...viewInput, bRightShoulder: true },
      shoulderDuration / 2,
    )
    expect(shoulderMidpoint.CameraOffsetY).toBeCloseTo(
      source.CameraOffsetY * (-1 + 2 * shoulderAlpha),
      10,
    )

    const rightShoulder = refreshAlsCameraAnimationInstance(
      state,
      { ...viewInput, bRightShoulder: true },
      shoulderDuration / 2,
    )
    expect(rightShoulder.CameraOffsetY).toBeCloseTo(
      source.CameraOffsetY,
      10,
    )

    const leftShoulder = refreshAlsCameraAnimationInstance(
      state,
      { ...viewInput, bRightShoulder: false },
      shoulderBlend.blendTimes[1],
    )
    expect(leftShoulder.CameraOffsetY).toBeCloseTo(
      -source.CameraOffsetY,
      10,
    )
    refreshAlsCameraAnimationInstance(
      state,
      { ...viewInput, bRightShoulder: true },
      shoulderBlend.blendTimes[0],
    )

    const viewBlend = graph.branches.viewMode.blend
    const firstPersonDuration = viewBlend.blendTimes[1]
    const viewAlpha = sampleStandardBlend(viewBlend.blendType, 0.5)
    const firstPersonMidpoint = refreshAlsCameraAnimationInstance(
      state,
      {
        ...viewInput,
        ViewMode: viewBlend.tags[0],
        bRightShoulder: true,
      },
      firstPersonDuration / 2,
    )
    expect(firstPersonMidpoint.CameraOffsetY).toBeCloseTo(
      source.CameraOffsetY,
      10,
    )
    expect(firstPersonMidpoint.FirstPersonOverride).toBeCloseTo(
      viewAlpha,
      10,
    )
    expect(firstPersonMidpoint.TraceOverride).toBeCloseTo(viewAlpha, 10)

    const firstPerson = refreshAlsCameraAnimationInstance(
      state,
      {
        ...viewInput,
        ViewMode: viewBlend.tags[0],
        bRightShoulder: true,
      },
      firstPersonDuration / 2,
    )
    expect(firstPerson.FirstPersonOverride).toBe(1)
    expect(firstPerson.TraceOverride).toBe(1)
  })

  it('runs action branches last and routes invalid action tags to Default', () => {
    const state = createAlsCameraAnimationInstance()
    const viewModifier = graph.branches.viewMode.FirstPerson
    const shoulderModifier = graph.branches.shoulder.branches[0]
    const firstPersonInput = input({
      ViewMode: graph.branches.viewMode.blend.tags[0],
      RotationMode: rotationModeForState('View Direction'),
      bRightShoulder: true,
    })
    const upstream = applyModifier(
      applyModifier(
        profileCurves('View Direction'),
        shoulderModifier,
      ),
      viewModifier,
    )
    refreshAlsCameraAnimationInstance(state, input(), 0)
    refreshAlsCameraAnimationInstance(state, firstPersonInput, 10)

    const actionBlend = graph.branches.locomotionAction.blend
    const rollingIndex = childIndexForTag(actionBlend, actionTag('Rolling'))
    const rollingModifier =
      graph.branches.locomotionAction.Rolling as OracleModifier
    const rolling = applyModifier(
      cloneCurves(upstream),
      rollingModifier,
    )
    const rollingAlpha = sampleStandardBlend(actionBlend.blendType, 0.5)
    const rollingMidpoint = refreshAlsCameraAnimationInstance(
      state,
      {
        ...firstPersonInput,
        LocomotionAction: actionTag('Rolling'),
      },
      actionBlend.blendTimes[rollingIndex] / 2,
    )
    expectCurves(
      rollingMidpoint,
      mixCurves([upstream, rolling], [1 - rollingAlpha, rollingAlpha]),
    )

    const rollingComplete = refreshAlsCameraAnimationInstance(
      state,
      {
        ...firstPersonInput,
        LocomotionAction: actionTag('Rolling'),
      },
      actionBlend.blendTimes[rollingIndex] / 2,
    )
    expectCurves(rollingComplete, rolling)

    const ragdollIndex = childIndexForTag(
      actionBlend,
      actionTag('Ragdolling'),
    )
    const ragdollModifier =
      graph.branches.locomotionAction.Ragdolling as OracleModifier
    const ragdollSourceType = graph.nodes.find(
      ({ index }) => index === ragdollModifier.sourceNodeIndex,
    )?.type
    expect(ragdollSourceType).toBe('FAnimNode_RefPose')
    const ragdoll = applyModifier(createZeroCurves(), ragdollModifier)
    const ragdollComplete = refreshAlsCameraAnimationInstance(
      state,
      {
        ...firstPersonInput,
        LocomotionAction: actionTag('Ragdolling'),
      },
      actionBlend.blendTimes[ragdollIndex],
    )
    expectCurves(ragdollComplete, ragdoll)
    expect(ragdollComplete.FirstPersonOverride).toBe(0)

    const defaultComplete = refreshAlsCameraAnimationInstance(
      state,
      {
        ...firstPersonInput,
        LocomotionAction: 'Als.LocomotionAction.Invalid',
      },
      actionBlend.blendTimes[0],
    )
    expectCurves(defaultComplete, upstream)
  })

  it('rescales an interrupted BlendListBase reversal by the remaining target weight', () => {
    const viewState = createAlsCameraAnimationInstance()
    const thirdPersonInput = input()
    const viewBlend = graph.branches.viewMode.blend
    refreshAlsCameraAnimationInstance(viewState, thirdPersonInput, 0)
    refreshAlsCameraAnimationInstance(
      viewState,
      { ...thirdPersonInput, ViewMode: viewBlend.tags[0] },
      viewBlend.blendTimes[1] / 2,
    )
    expect(viewState.viewModeBlend.weights).toEqual(
      new Float64Array([0.5, 0.5]),
    )

    const interruptedView = refreshAlsCameraAnimationInstance(
      viewState,
      thirdPersonInput,
      viewBlend.blendTimes[0] / 4,
    )
    expect(interruptedView.FirstPersonOverride).toBeCloseTo(0.25, 10)
    expect(viewState.viewModeBlend.duration).toBeCloseTo(
      viewBlend.blendTimes[0] / 2,
      10,
    )

    const completedView = refreshAlsCameraAnimationInstance(
      viewState,
      thirdPersonInput,
      viewBlend.blendTimes[0] / 4,
    )
    expect(completedView.FirstPersonOverride).toBe(0)
  })

  it('uses UE stack duration rescaling and state-weight recurrence for interrupted look transitions', () => {
    const lookState = createAlsCameraAnimationInstance()
    refreshAlsCameraAnimationInstance(lookState, input(), 0)
    const velocityToAiming = lookTransition(
      'Velocity Direction',
      'Aiming',
    )
    const firstFraction = 0.25
    refreshAlsCameraAnimationInstance(
      lookState,
      input({ RotationMode: rotationModeForState('Aiming') }),
      velocityToAiming.duration * firstFraction,
    )

    const aimingToView = lookTransition('Aiming', 'View Direction')
    const secondElapsed = 0.05
    refreshAlsCameraAnimationInstance(
      lookState,
      input({ RotationMode: rotationModeForState('View Direction') }),
      secondElapsed,
    )

    const viewToVelocity = lookTransition(
      'View Direction',
      'Velocity Direction',
    )
    refreshAlsCameraAnimationInstance(
      lookState,
      input({
        RotationMode: rotationModeForState('Velocity Direction'),
      }),
      0,
    )
    const entries =
      lookState.lookStateMachine.transitionStack.activeTransitions
    expect(entries).toHaveLength(3)

    const firstAlphaBeforeThird = sampleCustomBlend(
      velocityToAiming.customCurve,
      (
        velocityToAiming.duration * firstFraction
        + secondElapsed
      ) / velocityToAiming.duration,
    )
    const secondAlphaBeforeThird = sampleCustomBlend(
      aimingToView.customCurve,
      secondElapsed / aimingToView.duration,
    )
    const existingVelocityWeight =
      (1 - firstAlphaBeforeThird) * (1 - secondAlphaBeforeThird)
    const expectedDuration =
      viewToVelocity.duration * (1 - existingVelocityWeight)
    expect(entries[2].crossfadeDuration).toBeCloseTo(
      expectedDuration,
      7,
    )

    const thirdElapsed = Math.min(expectedDuration * 0.1, 0.05)
    const thirdFraction = thirdElapsed / expectedDuration
    const thirdAlpha = sampleCustomBlend(
      viewToVelocity.customCurve,
      thirdFraction,
    )
    const firstAlpha = sampleCustomBlend(
      velocityToAiming.customCurve,
      (
        velocityToAiming.duration * firstFraction
        + secondElapsed
        + thirdElapsed
      ) / velocityToAiming.duration,
    )
    const secondAlpha = sampleCustomBlend(
      aimingToView.customCurve,
      (secondElapsed + thirdElapsed) / aimingToView.duration,
    )
    const interruptedLook = refreshAlsCameraAnimationInstance(
      lookState,
      input({
        RotationMode: rotationModeForState('Velocity Direction'),
      }),
      thirdElapsed,
    )
    const expected = mixCurves(
      [
        profileCurves('Velocity Direction'),
        profileCurves('View Direction'),
        profileCurves('Aiming'),
      ],
      [
        (1 - firstAlpha)
          * (1 - secondAlpha)
          * (1 - thirdAlpha)
          + thirdAlpha,
        secondAlpha * (1 - thirdAlpha),
        firstAlpha * (1 - secondAlpha) * (1 - thirdAlpha),
      ],
    )
    const expectedWeights = Float32Array.from([
      (1 - firstAlpha)
        * (1 - secondAlpha)
        * (1 - thirdAlpha)
        + thirdAlpha,
      secondAlpha * (1 - thirdAlpha),
      firstAlpha * (1 - secondAlpha) * (1 - thirdAlpha),
    ])
    expect(
      Array.from(lookState.lookStateMachine.weights),
    ).toEqual(Array.from(expectedWeights))
    expectCurves(interruptedLook, expected)
  })

  it('initializes a fully inactive look state when it is entered again', () => {
    const state = createAlsCameraAnimationInstance()
    const viewRotationMode = rotationModeForState('View Direction')
    const velocityRotationMode = rotationModeForState('Velocity Direction')
    const viewBranch = graph.branches.lookStates.ViewDirection
    const crouching = viewBranch.stanceBlend.tags[0]
    const running = viewBranch.Crouching.gaitBlend.tags[0]

    refreshAlsCameraAnimationInstance(state, input(), 0)
    refreshAlsCameraAnimationInstance(
      state,
      input({ RotationMode: viewRotationMode }),
      lookTransition('Velocity Direction', 'View Direction').duration,
    )
    refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: viewRotationMode,
        Stance: crouching,
        Gait: running,
      }),
      10,
    )

    const deltaTime = 0.5
    const transition = lookTransition(
      'View Direction',
      'Velocity Direction',
    )
    const lookAlpha = sampleCustomBlend(
      transition.customCurve,
      deltaTime / transition.duration,
    )
    const expected = mixCurves(
      [
        profileCurves('Velocity Direction', crouching, running),
        profileCurves('View Direction', crouching, running),
      ],
      [lookAlpha, 1 - lookAlpha],
    )
    const actual = refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: velocityRotationMode,
        Stance: crouching,
        Gait: running,
      }),
      deltaTime,
    )

    expectCurves(actual, expected)
    expect(state.lookBranches[0].stanceBlend.weights[1]).toBe(1)
  })

  it('retains a look branch when an interrupted transition reenters it while still active', () => {
    const state = createAlsCameraAnimationInstance()
    const viewRotationMode = rotationModeForState('View Direction')
    const velocityRotationMode = rotationModeForState('Velocity Direction')
    const velocityBranch = graph.branches.lookStates.VelocityDirection
    const crouching = velocityBranch.stanceBlend.tags[0]
    const running = velocityBranch.Crouching.gaitBlend.tags[0]

    refreshAlsCameraAnimationInstance(state, input(), 0)
    refreshAlsCameraAnimationInstance(
      state,
      input({ RotationMode: viewRotationMode }),
      lookTransition(
        'Velocity Direction',
        'View Direction',
      ).duration / 4,
    )

    refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: velocityRotationMode,
        Stance: crouching,
        Gait: running,
      }),
      0,
    )

    // SetState() sees non-zero existing Velocity Direction weight, so all
    // authored bAlwaysResetOnEntry=false branch nodes keep their prior state.
    expect(state.lookBranches[0].stanceBlend.weights[0]).toBe(1)
    expect(state.lookBranches[0].stanceBlend.weights[1]).toBe(0)
    expect(
      state.lookStateMachine.transitionStack.activeTransitions,
    ).toHaveLength(2)
  })

  it('reinitializes the authored look state machine after the ragdoll branch makes it irrelevant', () => {
    const state = createAlsCameraAnimationInstance()
    const viewRotationMode = rotationModeForState('View Direction')
    const aimingRotationMode = rotationModeForState('Aiming')
    const ragdollTag = actionTag('Ragdolling')
    const actionBlend = graph.branches.locomotionAction.blend
    const ragdollIndex = childIndexForTag(actionBlend, ragdollTag)

    const viewOutput = refreshAlsCameraAnimationInstance(
      state,
      input({ RotationMode: viewRotationMode }),
      0,
    )
    expectCurves(viewOutput, profileCurves('View Direction'))

    refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: aimingRotationMode,
        LocomotionAction: ragdollTag,
      }),
      actionBlend.blendTimes[ragdollIndex],
    )
    expect(state.lookStateMachine.updatedPreviousFrame).toBe(false)

    refreshAlsCameraAnimationInstance(
      state,
      input({
        RotationMode: aimingRotationMode,
        LocomotionAction: ragdollTag,
      }),
      1,
    )
    expect(
      state.lookStateMachine.transitionStack.currentState,
    ).toBe(
      graph.stateMachine.states.findIndex(
        ({ name }) => name === 'View Direction',
      ),
    )

    const relevantAgain = refreshAlsCameraAnimationInstance(
      state,
      input({ RotationMode: aimingRotationMode }),
      actionBlend.blendTimes[0],
    )
    expectCurves(relevantAgain, profileCurves('Aiming'))
    expect(
      state.lookStateMachine.transitionStack.currentState,
    ).toBe(
      graph.stateMachine.states.findIndex(
        ({ name }) => name === 'Aiming',
      ),
    )
    expect(
      state.lookStateMachine.transitionStack.activeTransitions,
    ).toHaveLength(0)
  })
})
