import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALS_CAMERA_ANIMATION_CURVE_NAMES,
  ALS_CAMERA_LOOK_STATE_REENTRY_ASSUMPTION,
  ALS_CAMERA_LOOK_TRANSITION_INTERRUPTION_ASSUMPTION,
  ALS_CAMERA_STANDARD_BLEND_INTERRUPTION_ASSUMPTION,
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
      readonly bSkipFirstUpdateTransition?: boolean
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
  if (option === 'Cubic') return alpha * alpha * alpha
  if (option === 'HermiteCubic') {
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
    expect(actual[name], name).toBeCloseTo(expected[name], 10)
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

  it('honors the authored initial state and skipped first-update transition', () => {
    const stateMachineNode = graph.nodes.find(
      (node) =>
        node.type === 'FAnimNode_StateMachine'
        && node.StateMachineIndexInClass === 0,
    )
    expect(stateMachineNode?.bSkipFirstUpdateTransition).toBe(true)

    const state = createAlsCameraAnimationInstance()
    const viewInput = input({
      RotationMode: rotationModeForState('View Direction'),
    })
    const firstUpdate = refreshAlsCameraAnimationInstance(
      state,
      viewInput,
      10,
    )
    expectCurves(
      firstUpdate,
      profileCurves(graph.stateMachine.initialState),
    )

    const transition = lookTransition(
      graph.stateMachine.initialState,
      'View Direction',
    )
    const secondUpdate = refreshAlsCameraAnimationInstance(
      state,
      viewInput,
      transition.duration,
    )
    expectCurves(secondUpdate, profileCurves('View Direction'))
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

  it('preserves weights deterministically across rapid standard and look changes', () => {
    const viewState = createAlsCameraAnimationInstance()
    const thirdPersonInput = input()
    const viewBlend = graph.branches.viewMode.blend
    refreshAlsCameraAnimationInstance(viewState, thirdPersonInput, 0)
    refreshAlsCameraAnimationInstance(
      viewState,
      { ...thirdPersonInput, ViewMode: viewBlend.tags[0] },
      viewBlend.blendTimes[1] / 2,
    )
    const interruptedView = refreshAlsCameraAnimationInstance(
      viewState,
      thirdPersonInput,
      viewBlend.blendTimes[0] / 2,
    )
    expect(interruptedView.FirstPersonOverride).toBeCloseTo(0.25, 10)
    expect(ALS_CAMERA_STANDARD_BLEND_INTERRUPTION_ASSUMPTION)
      .toContain('Preserve current normalized child weights')

    const lookState = createAlsCameraAnimationInstance()
    refreshAlsCameraAnimationInstance(lookState, input(), 0)
    const velocityToAiming = lookTransition(
      'Velocity Direction',
      'Aiming',
    )
    const firstAlpha = sampleCustomBlend(
      velocityToAiming.customCurve,
      0.5,
    )
    refreshAlsCameraAnimationInstance(
      lookState,
      input({ RotationMode: rotationModeForState('Aiming') }),
      velocityToAiming.duration / 2,
    )

    const aimingToView = lookTransition('Aiming', 'View Direction')
    const secondAlpha = sampleCustomBlend(
      aimingToView.customCurve,
      0.5,
    )
    const interruptedLook = refreshAlsCameraAnimationInstance(
      lookState,
      input({ RotationMode: rotationModeForState('View Direction') }),
      aimingToView.duration / 2,
    )
    const expected = mixCurves(
      [
        profileCurves('Velocity Direction'),
        profileCurves('View Direction'),
        profileCurves('Aiming'),
      ],
      [
        (1 - firstAlpha) * (1 - secondAlpha),
        secondAlpha,
        firstAlpha * (1 - secondAlpha),
      ],
    )
    expectCurves(interruptedLook, expected)
    expect(ALS_CAMERA_LOOK_TRANSITION_INTERRUPTION_ASSUMPTION)
      .toContain('Preserve current look-state weights')
  })

  it('does not advance inactive look-state blend nodes in the background', () => {
    const state = createAlsCameraAnimationInstance()
    const viewRotationMode = rotationModeForState('View Direction')
    const velocityRotationMode = rotationModeForState('Velocity Direction')
    const viewBranch = graph.branches.lookStates.ViewDirection
    const velocityBranch = graph.branches.lookStates.VelocityDirection
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
    const stanceAlpha = sampleStandardBlend(
      velocityBranch.stanceBlend.blendType,
      deltaTime / velocityBranch.stanceBlend.blendTimes[1],
    )
    const reenteringVelocity = mixCurves(
      [
        profileCurves('Velocity Direction'),
        profileCurves('Velocity Direction', crouching, running),
      ],
      [1 - stanceAlpha, stanceAlpha],
    )
    const expected = mixCurves(
      [
        reenteringVelocity,
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
    expect(ALS_CAMERA_LOOK_STATE_REENTRY_ASSUMPTION)
      .toContain('Inactive look-state branches retain blend state')
  })
})
