import cameraContentJson from '../../../scripts/extract-als/camera-content.json?raw'
import {
  alphaToBlendOption,
  type AlphaBlendOption,
} from '../../engine/alphaBlend'
import {
  sampleRichCurve,
  type RichCurveKey,
  type RichCurveInterpolation,
} from '../../engine/richCurve'
import {
  advanceStateMachineTransitionStack,
  createStateMachineTransitionStack,
  getStateMachineStateWeight,
  resetStateMachineTransitionStack,
  startStateMachineStandardTransition,
  writeStateMachineStateWeights,
  type StateMachineTransitionStack,
} from '../../engine/stateMachineTransitionStack'

/**
 * Curve-only, framework-free execution of AB_Als_Camera.
 *
 * All graph topology, tags, durations, modifiers, curve names, and custom blend curves come from
 * camera-content.json. This module adds only the state required to execute that authored graph.
 */

interface OracleModifier {
  readonly sourceNodeIndex?: number
  readonly curveNames: readonly string[]
  readonly values: readonly number[]
  readonly applyMode: string
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

interface OracleStateMachineState {
  readonly name: string
  readonly transitions: readonly {
    readonly targetState: string
    readonly expression: {
      readonly value: string
      readonly acceptsInvalidTag: boolean
    }
  }[]
}

interface OracleStateTransition {
  readonly previousState: string
  readonly nextState: string
  readonly duration: number
  readonly blendMode: string
  readonly customCurve: string
}

interface OracleStateMachine {
  readonly initialState: string
  readonly states: readonly OracleStateMachineState[]
  readonly transitions: readonly OracleStateTransition[]
}

interface OracleNode {
  readonly index: number
  readonly type: string
  readonly StateMachineIndexInClass?: number
  readonly MaxTransitionsPerFrame?: number
  readonly bSkipFirstUpdateTransition?: boolean
}

interface OracleActionBranch extends OracleModifier {
  readonly kind?: string
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
    readonly nodes: readonly OracleNode[]
    readonly stateMachine: OracleStateMachine
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
        Record<string, OracleBlend | OracleActionBranch>
      > & {
        readonly blend: OracleBlend
      }
    }
  }
}

const ORACLE = JSON.parse(cameraContentJson) as CameraContentOracle

export const ALS_CAMERA_ANIMATION_CURVE_NAMES: readonly string[] =
  Object.freeze(ORACLE.curveNames.map(({ name }) => name))

const CURVE_COUNT = ALS_CAMERA_ANIMATION_CURVE_NAMES.length
if (CURVE_COUNT !== 13) {
  throw new Error(
    `AB_Als_Camera oracle has ${CURVE_COUNT} curves, expected 13`,
  )
}

const CURVE_INDICES = new Map(
  ALS_CAMERA_ANIMATION_CURVE_NAMES.map((name, index) => [name, index]),
)

type CurveBuffer = Float64Array

interface CurveModifier {
  readonly indices: Uint8Array
  readonly values: Float64Array
  readonly applyMode: 'Blend' | 'Scale'
}

interface BlendDefinition {
  readonly tags: readonly string[]
  readonly blendTimes: readonly number[]
  readonly blendOption: AlphaBlendOption | null
  readonly customCurve: readonly RichCurveKey[] | null
  readonly childCount: number
}

interface BlendState {
  initialized: boolean
  activeChildIndex: number
  elapsed: number
  duration: number
  transitioning: boolean
  readonly weights: Float64Array
  readonly startWeights: Float64Array
}

interface LookBranchDefinition {
  readonly standingProfiles: readonly CurveBuffer[]
  readonly crouchingProfiles: readonly CurveBuffer[]
  readonly standingGaitBlend: BlendDefinition
  readonly crouchingGaitBlend: BlendDefinition
  readonly stanceBlend: BlendDefinition
  readonly standingPivotModifier: CurveModifier
  readonly crouchingPivotModifier: CurveModifier
  readonly finalModifier: CurveModifier
}

interface LookBranchState {
  readonly standingGaitBlend: BlendState
  readonly crouchingGaitBlend: BlendState
  readonly stanceBlend: BlendState
  readonly standingCurves: CurveBuffer
  readonly crouchingCurves: CurveBuffer
  readonly stanceSources: readonly CurveBuffer[]
  readonly curves: CurveBuffer
}

interface LookTransitionDefinition {
  readonly duration: number
  readonly customCurve: readonly RichCurveKey[]
}

interface LookStateMachineState {
  firstUpdate: boolean
  hasEverBeenUpdated: boolean
  updatedPreviousFrame: boolean
  readonly transitionStack: StateMachineTransitionStack<number>
  readonly weights: Float32Array
  readonly statesToUpdate: Uint8Array
}

interface ActionBranchDefinition {
  readonly modifier: CurveModifier | null
  readonly startsFromReferencePose: boolean
}

// FAnimWeight::IsRelevant() uses ZERO_ANIMWEIGHT_THRESH.
const ZERO_ANIMWEIGHT_THRESH = 1e-5

function curveIndex(name: string): number {
  const index = CURVE_INDICES.get(name)
  if (index === undefined) {
    throw new Error(`AB_Als_Camera modifier references unknown curve "${name}"`)
  }
  return index
}

function compileModifier(source: OracleModifier): CurveModifier {
  if (source.curveNames.length !== source.values.length) {
    throw new Error('AB_Als_Camera modifier name/value length mismatch')
  }
  const applyMode = source.applyMode.endsWith('::Scale') ? 'Scale' : 'Blend'
  return {
    indices: Uint8Array.from(source.curveNames.map(curveIndex)),
    values: Float64Array.from(source.values),
    applyMode,
  }
}

function applyModifier(output: CurveBuffer, modifier: CurveModifier) {
  for (let index = 0; index < modifier.indices.length; index++) {
    const curve = modifier.indices[index]
    if (modifier.applyMode === 'Scale') {
      output[curve] *= modifier.values[index]
    } else {
      output[curve] = modifier.values[index]
    }
  }
}

function compileProfile(source: OracleModifier): CurveBuffer {
  const output = new Float64Array(CURVE_COUNT)
  applyModifier(output, compileModifier(source))
  return output
}

function richCurveInterpolation(interpMode: string): RichCurveInterpolation {
  if (interpMode === 'RCIM_Constant') return 'constant'
  if (interpMode === 'RCIM_Linear') return 'linear'
  if (interpMode === 'RCIM_Cubic') return 'cubic'
  throw new Error(`unsupported camera blend interpolation ${interpMode}`)
}

function compileRichCurve(name: string): readonly RichCurveKey[] {
  const source = ORACLE.blendCurves[name]
  if (!source) throw new Error(`missing camera custom blend curve "${name}"`)
  return source.keys.map((key) => ({
    time: key.Time,
    value: key.Value,
    interpolation: richCurveInterpolation(key.InterpMode),
    arriveTangent: key.ArriveTangent,
    leaveTangent: key.LeaveTangent,
  }))
}

function alphaBlendOption(source: string): AlphaBlendOption {
  const option = source.split('::').at(-1)
  if (
    option === 'Linear'
    || option === 'Cubic'
    || option === 'HermiteCubic'
    || option === 'QuadraticInOut'
  ) {
    return option
  }
  throw new Error(`unsupported camera alpha blend option "${source}"`)
}

function compileBlend(source: OracleBlend): BlendDefinition {
  const childCount = source.sourceNodeIndices.length
  if (source.blendTimes.length !== childCount) {
    throw new Error('AB_Als_Camera blend child/time length mismatch')
  }
  return {
    tags: source.tags,
    blendTimes: source.blendTimes,
    blendOption: source.customCurve
      ? null
      : alphaBlendOption(source.blendType),
    customCurve: source.customCurve
      ? compileRichCurve(source.customCurve)
      : null,
    childCount,
  }
}

function compileLookBranch(source: OracleLookBranch): LookBranchDefinition {
  return {
    standingProfiles: source.Standing.profiles.map(compileProfile),
    crouchingProfiles: source.Crouching.profiles.map(compileProfile),
    standingGaitBlend: compileBlend(source.Standing.gaitBlend),
    crouchingGaitBlend: compileBlend(source.Crouching.gaitBlend),
    stanceBlend: compileBlend(source.stanceBlend),
    standingPivotModifier: compileModifier(source.Standing.pivotModifier),
    crouchingPivotModifier: compileModifier(source.Crouching.pivotModifier),
    finalModifier: compileModifier(source.finalModifier),
  }
}

const STATE_MACHINE_ORACLE = ORACLE.animGraph.stateMachine
const STATE_MACHINE_NODE_ORACLE = ORACLE.animGraph.nodes.find(
  (node) =>
    node.type === 'FAnimNode_StateMachine'
    && node.StateMachineIndexInClass === 0,
)
if (!STATE_MACHINE_NODE_ORACLE) {
  throw new Error('AB_Als_Camera state-machine node is missing')
}
const SKIP_FIRST_LOOK_TRANSITION =
  STATE_MACHINE_NODE_ORACLE.bSkipFirstUpdateTransition === true
const MAX_LOOK_TRANSITIONS_PER_FRAME =
  STATE_MACHINE_NODE_ORACLE.MaxTransitionsPerFrame ?? 0
if (MAX_LOOK_TRANSITIONS_PER_FRAME <= 0) {
  throw new Error(
    'AB_Als_Camera state machine has no valid MaxTransitionsPerFrame',
  )
}
const LOOK_STATE_NAMES = Object.freeze(
  STATE_MACHINE_ORACLE.states.map(({ name }) => name),
)
const LOOK_STATE_INDICES = Object.freeze(
  LOOK_STATE_NAMES.map((_, index) => index),
)
const INITIAL_LOOK_STATE_INDEX = LOOK_STATE_NAMES.indexOf(
  STATE_MACHINE_ORACLE.initialState,
)
if (INITIAL_LOOK_STATE_INDEX < 0) {
  throw new Error('AB_Als_Camera initial look state is missing')
}

const LOOK_BRANCH_DEFINITIONS = STATE_MACHINE_ORACLE.states.map((state) => {
  const branchKey = state.name.replaceAll(' ', '')
  const branch = ORACLE.animGraph.branches.lookStates[branchKey]
  if (!branch) throw new Error(`missing camera look branch "${branchKey}"`)
  return compileLookBranch(branch)
})

const ROTATION_MODE_TO_LOOK_STATE = new Map<string, number>()
for (const state of STATE_MACHINE_ORACLE.states) {
  for (const transition of state.transitions) {
    const targetIndex = LOOK_STATE_NAMES.indexOf(transition.targetState)
    if (targetIndex < 0) {
      throw new Error(`missing look transition target "${transition.targetState}"`)
    }
    const existing = ROTATION_MODE_TO_LOOK_STATE.get(
      transition.expression.value,
    )
    if (existing !== undefined && existing !== targetIndex) {
      throw new Error(
        `inconsistent RotationMode route "${transition.expression.value}"`,
      )
    }
    ROTATION_MODE_TO_LOOK_STATE.set(transition.expression.value, targetIndex)
  }
}

const LOOK_TRANSITIONS: (LookTransitionDefinition | null)[][] =
  LOOK_STATE_NAMES.map(
    () => Array<LookTransitionDefinition | null>(
      LOOK_STATE_NAMES.length,
    ).fill(null),
  )
for (const transition of STATE_MACHINE_ORACLE.transitions) {
  const previousStateIndex = LOOK_STATE_NAMES.indexOf(
    transition.previousState,
  )
  const nextStateIndex = LOOK_STATE_NAMES.indexOf(transition.nextState)
  if (previousStateIndex < 0 || nextStateIndex < 0) {
    throw new Error(
      `missing camera transition state ${transition.previousState} -> ${transition.nextState}`,
    )
  }
  if (transition.blendMode !== 'EAlphaBlendOption::Custom') {
    throw new Error(
      `camera transition ${transition.previousState} -> ${transition.nextState} must use its authored custom blend curve`,
    )
  }
  LOOK_TRANSITIONS[previousStateIndex][nextStateIndex] = {
    duration: transition.duration,
    customCurve: compileRichCurve(transition.customCurve),
  }
}

const VIEW_DEFINITION = compileBlend(
  ORACLE.animGraph.branches.viewMode.blend,
)
const VIEW_MODIFIERS = [
  compileModifier(ORACLE.animGraph.branches.viewMode.ThirdPerson),
  compileModifier(ORACLE.animGraph.branches.viewMode.FirstPerson),
] as const

const SHOULDER_DEFINITION = compileBlend(
  ORACLE.animGraph.branches.shoulder.blend,
)
const SHOULDER_MODIFIERS =
  ORACLE.animGraph.branches.shoulder.branches.map(compileModifier)

const ACTION_ORACLE = ORACLE.animGraph.branches.locomotionAction
const ACTION_DEFINITION = compileBlend(ACTION_ORACLE.blend)
const ACTION_BRANCH_NAMES = [
  Object.entries(ACTION_ORACLE).find(
    ([name, branch]) => name !== 'blend' && 'kind' in branch,
  )?.[0],
  ...ACTION_DEFINITION.tags.map((tag) => tag.split('.').at(-1)),
]
if (ACTION_BRANCH_NAMES.some((name) => !name)) {
  throw new Error('AB_Als_Camera action branch names are incomplete')
}
const NODE_TYPES = new Map(
  ORACLE.animGraph.nodes.map(({ index, type }) => [index, type]),
)
const ACTION_BRANCH_DEFINITIONS: readonly ActionBranchDefinition[] =
  ACTION_BRANCH_NAMES.map((name) => {
    const branch = ACTION_ORACLE[name!] as OracleActionBranch
    if (!branch) throw new Error(`missing camera action branch "${name}"`)
    if (branch.kind) {
      return { modifier: null, startsFromReferencePose: false }
    }
    return {
      modifier: compileModifier(branch),
      startsFromReferencePose:
        NODE_TYPES.get(branch.sourceNodeIndex!) === 'FAnimNode_RefPose',
    }
  })

function createBlendState(definition: BlendDefinition): BlendState {
  return {
    initialized: false,
    activeChildIndex: 0,
    elapsed: 0,
    duration: 0,
    transitioning: false,
    weights: new Float64Array(definition.childCount),
    startWeights: new Float64Array(definition.childCount),
  }
}

function initializeBlendState(state: BlendState, childIndex: number) {
  state.weights.fill(0)
  state.weights[childIndex] = 1
  state.startWeights.fill(0)
  state.activeChildIndex = childIndex
  state.elapsed = 0
  state.duration = 0
  state.transitioning = false
  state.initialized = true
}

function resetBlendState(state: BlendState) {
  state.weights.fill(0)
  state.weights[0] = 1
  state.startWeights.fill(0)
  state.activeChildIndex = 0
  state.elapsed = 0
  state.duration = 0
  state.transitioning = false
  // FAnimNode_BlendListBase::Initialize() leaves LastActiveChildIndex at
  // INDEX_NONE. Its first update therefore snaps to the bound child.
  state.initialized = false
}

function sampleCustomBlendCurve(
  curve: readonly RichCurveKey[],
  normalizedTime: number,
) {
  return Math.max(
    0,
    Math.min(1, sampleRichCurve(curve, normalizedTime)),
  )
}

function blendAlpha(
  definition: BlendDefinition,
  normalizedTime: number,
): number {
  if (definition.customCurve) {
    return sampleCustomBlendCurve(
      definition.customCurve,
      normalizedTime,
    )
  }
  return alphaToBlendOption(normalizedTime, definition.blendOption!)
}

function advanceBlendState(
  state: BlendState,
  definition: BlendDefinition,
  targetChildIndex: number,
  deltaTime: number,
) {
  if (!state.initialized) {
    initializeBlendState(state, targetChildIndex)
    return
  }

  if (targetChildIndex !== state.activeChildIndex) {
    state.startWeights.set(state.weights)
    state.activeChildIndex = targetChildIndex
    state.elapsed = 0
    // FAnimNode_BlendListBase scales the target's authored BlendTime by the
    // remaining target weight. This is what makes an interrupted reversal
    // complete over the remaining fraction instead of restarting a full blend.
    state.duration =
      definition.blendTimes[targetChildIndex]
      * Math.min(1, Math.abs(1 - state.weights[targetChildIndex]))
    state.transitioning = true
  }
  if (!state.transitioning) return

  state.elapsed += Math.max(0, deltaTime)
  const normalizedTime = state.duration > 0
    ? Math.min(1, state.elapsed / state.duration)
    : 1
  const alpha = blendAlpha(definition, normalizedTime)
  for (let index = 0; index < state.weights.length; index++) {
    state.weights[index] = state.startWeights[index] * (1 - alpha)
  }
  state.weights[state.activeChildIndex] += alpha
  if (normalizedTime >= 1) {
    state.weights.fill(0)
    state.weights[state.activeChildIndex] = 1
    state.transitioning = false
  }
}

function childIndexForTag(
  definition: BlendDefinition,
  activeTag: string | null | undefined,
): number {
  const tagIndex = definition.tags.indexOf(activeTag ?? '')
  return tagIndex < 0 ? 0 : tagIndex + 1
}

function blendCurves(
  output: CurveBuffer,
  sources: readonly CurveBuffer[],
  weights: ArrayLike<number>,
) {
  output.fill(0)
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const weight = weights[sourceIndex]
    if (weight === 0) continue
    const source = sources[sourceIndex]
    for (let curveIndex = 0; curveIndex < CURVE_COUNT; curveIndex++) {
      output[curveIndex] += source[curveIndex] * weight
    }
  }
}

function createLookBranchState(
  definition: LookBranchDefinition,
): LookBranchState {
  const standingCurves = new Float64Array(CURVE_COUNT)
  const crouchingCurves = new Float64Array(CURVE_COUNT)
  return {
    standingGaitBlend: createBlendState(definition.standingGaitBlend),
    crouchingGaitBlend: createBlendState(definition.crouchingGaitBlend),
    stanceBlend: createBlendState(definition.stanceBlend),
    standingCurves,
    crouchingCurves,
    stanceSources: [standingCurves, crouchingCurves],
    curves: new Float64Array(CURVE_COUNT),
  }
}

function resetLookBranchState(state: LookBranchState) {
  resetBlendState(state.standingGaitBlend)
  resetBlendState(state.crouchingGaitBlend)
  resetBlendState(state.stanceBlend)
  state.standingCurves.fill(0)
  state.crouchingCurves.fill(0)
  state.curves.fill(0)
}

function evaluateLookBranch(
  state: LookBranchState,
  definition: LookBranchDefinition,
  input: AlsCameraAnimationInstanceInput,
  deltaTime: number,
) {
  advanceBlendState(
    state.stanceBlend,
    definition.stanceBlend,
    childIndexForTag(definition.stanceBlend, input.Stance),
    deltaTime,
  )

  if (state.stanceBlend.weights[0] > ZERO_ANIMWEIGHT_THRESH) {
    advanceBlendState(
      state.standingGaitBlend,
      definition.standingGaitBlend,
      childIndexForTag(definition.standingGaitBlend, input.Gait),
      deltaTime,
    )
    blendCurves(
      state.standingCurves,
      definition.standingProfiles,
      state.standingGaitBlend.weights,
    )
    applyModifier(state.standingCurves, definition.standingPivotModifier)
  }

  if (state.stanceBlend.weights[1] > ZERO_ANIMWEIGHT_THRESH) {
    advanceBlendState(
      state.crouchingGaitBlend,
      definition.crouchingGaitBlend,
      childIndexForTag(definition.crouchingGaitBlend, input.Gait),
      deltaTime,
    )
    blendCurves(
      state.crouchingCurves,
      definition.crouchingProfiles,
      state.crouchingGaitBlend.weights,
    )
    applyModifier(state.crouchingCurves, definition.crouchingPivotModifier)
  }

  blendCurves(state.curves, state.stanceSources, state.stanceBlend.weights)
  applyModifier(state.curves, definition.finalModifier)
}

function createLookStateMachineState(): LookStateMachineState {
  const weights = new Float32Array(LOOK_STATE_NAMES.length)
  weights[INITIAL_LOOK_STATE_INDEX] = 1
  return {
    firstUpdate: true,
    hasEverBeenUpdated: false,
    updatedPreviousFrame: false,
    // The camera state machine has no blend profile. One synthetic pose element
    // lets the shared stack execute UE's exact transition lifecycle and scalar
    // state-weight recurrence without inventing camera-specific stack logic.
    transitionStack: createStateMachineTransitionStack(
      INITIAL_LOOK_STATE_INDEX,
      1,
      3,
    ),
    weights,
    statesToUpdate: new Uint8Array(LOOK_STATE_NAMES.length),
  }
}

function nextLookStateIndex(
  currentStateIndex: number,
  rotationMode: string | null | undefined,
) {
  const rotationModeTag = rotationMode ?? ''
  const rotationModeIsValid =
    ROTATION_MODE_TO_LOOK_STATE.has(rotationModeTag)
  for (
    const transition of
      STATE_MACHINE_ORACLE.states[currentStateIndex].transitions
  ) {
    if (
      rotationModeTag === transition.expression.value
      || (
        transition.expression.acceptsInvalidTag
        && !rotationModeIsValid
      )
    ) {
      return LOOK_STATE_NAMES.indexOf(transition.targetState)
    }
  }
  return currentStateIndex
}

function reinitializeLookStateMachine(
  state: LookStateMachineState,
  lookBranches: readonly LookBranchState[],
) {
  resetStateMachineTransitionStack(
    state.transitionStack,
    INITIAL_LOOK_STATE_INDEX,
  )
  state.firstUpdate = true
  state.weights.fill(0)
  state.weights[INITIAL_LOOK_STATE_INDEX] = 1
  state.statesToUpdate.fill(0)

  // FBakedAnimationState::bAlwaysResetOnEntry is false for all three authored
  // camera states. Whole-machine relevancy reset initializes only the entry
  // state; inactive targets initialize when SetState() later enters them.
  resetLookBranchState(lookBranches[INITIAL_LOOK_STATE_INDEX])
}

function refreshLookTransitionCustomAlphas(
  state: LookStateMachineState,
) {
  for (const transition of state.transitionStack.activeTransitions) {
    const definition =
      LOOK_TRANSITIONS[transition.previousState][transition.nextState]
    if (!definition) {
      throw new Error(
        `missing camera transition ${LOOK_STATE_NAMES[transition.previousState]} -> ${LOOK_STATE_NAMES[transition.nextState]}`,
      )
    }

    // FAnimationActiveTransitionEntry uses its transition stack for lifetime,
    // interruption rescaling, and cleanup, then evaluates the authored
    // FAlphaBlend custom curve at ElapsedTime / CrossfadeDuration.
    transition.alpha = sampleCustomBlendCurve(
      definition.customCurve,
      transition.linearAlpha,
    )
    transition.previousPoseMask.fill(1 - transition.alpha)
    transition.nextPoseMask.fill(transition.alpha)
  }
}

function startLookTransition(
  state: LookStateMachineState,
  targetStateIndex: number,
  lookBranches: readonly LookBranchState[],
) {
  const previousStateIndex = state.transitionStack.currentState
  const previousStateName = LOOK_STATE_NAMES[previousStateIndex]
  const targetStateName = LOOK_STATE_NAMES[targetStateIndex]
  const definition =
    LOOK_TRANSITIONS[previousStateIndex][targetStateIndex]
  if (!definition) {
    throw new Error(
      `missing camera transition ${previousStateName} -> ${targetStateName}`,
    )
  }

  const targetWasAlreadyActive =
    getStateMachineStateWeight(
      state.transitionStack,
      targetStateIndex,
    ) > 0

  // The shared stack's Linear option supplies the exact non-Hermite inverse
  // duration scaler used by UE for Custom alpha blends. We replace each
  // entry's scalar alpha with its authored curve after advancing the stack.
  startStateMachineStandardTransition(state.transitionStack, {
    from: previousStateIndex,
    to: targetStateIndex,
    duration: definition.duration,
    blendOption: 'Linear',
  })

  if (!targetWasAlreadyActive) {
    resetLookBranchState(lookBranches[targetStateIndex])
  }
}

function advanceLookStateMachine(
  state: LookStateMachineState,
  rotationMode: string | null | undefined,
  deltaTime: number,
  lookBranches: readonly LookBranchState[],
) {
  let skipTransitionAdvance = false

  for (
    let transitionCount = 0;
    transitionCount < MAX_LOOK_TRANSITIONS_PER_FRAME;
    transitionCount++
  ) {
    const targetStateIndex = nextLookStateIndex(
      state.transitionStack.currentState,
      rotationMode,
    )
    if (targetStateIndex === state.transitionStack.currentState) break
    startLookTransition(state, targetStateIndex, lookBranches)
  }

  if (state.firstUpdate) {
    state.firstUpdate = false
    if (SKIP_FIRST_LOOK_TRANSITION) {
      // UE still takes and initializes the first valid transition, then throws
      // away ActiveTransitionArray. The visited target therefore starts at
      // full weight on this same first update.
      resetStateMachineTransitionStack(
        state.transitionStack,
        state.transitionStack.currentState,
      )
      skipTransitionAdvance = true
    }
  }

  if (!skipTransitionAdvance) {
    advanceStateMachineTransitionStack(state.transitionStack, deltaTime)
    refreshLookTransitionCustomAlphas(state)
  }

  writeStateMachineStateWeights(
    state.transitionStack,
    LOOK_STATE_INDICES,
    state.weights,
  )

  state.statesToUpdate.fill(0)
  if (state.transitionStack.activeTransitions.length > 0) {
    for (const transition of state.transitionStack.activeTransitions) {
      state.statesToUpdate[transition.previousState] = 1
      state.statesToUpdate[transition.nextState] = 1
    }
  } else {
    state.statesToUpdate[state.transitionStack.currentState] = 1
  }
}

function copyAndModify(
  output: CurveBuffer,
  source: CurveBuffer,
  modifier: CurveModifier,
) {
  output.set(source)
  applyModifier(output, modifier)
}

export interface AlsCameraAnimationInstanceInput {
  readonly ViewMode: string | null
  readonly LocomotionMode: string | null
  readonly RotationMode: string | null
  readonly Stance: string | null
  readonly Gait: string | null
  readonly LocomotionAction: string | null
  readonly bRightShoulder: boolean
  /** Game-owned addition to the look state's CameraOffsetY, in centimetres, applied before the shoulder blend. */
  readonly ShoulderOffsetY?: number
}

export interface AlsCameraAnimationInstanceState {
  /** Stable named output container; every oracle curve is present on every update. */
  readonly curves: Record<string, number>
  /** Stable ordered view of `curves`, indexed by ALS_CAMERA_ANIMATION_CURVE_NAMES. */
  readonly curveValues: Float64Array
  readonly lookStateMachine: LookStateMachineState
  readonly lookBranches: readonly LookBranchState[]
  readonly lookSources: readonly CurveBuffer[]
  readonly lookCurves: CurveBuffer
  readonly shoulderBlend: BlendState
  readonly shoulderBranches: readonly CurveBuffer[]
  readonly shoulderCurves: CurveBuffer
  readonly viewModeBlend: BlendState
  readonly viewModeBranches: readonly CurveBuffer[]
  readonly viewModeCurves: CurveBuffer
  readonly locomotionActionBlend: BlendState
  readonly locomotionActionBranches: readonly CurveBuffer[]
}

export function createAlsCameraAnimationInstance():
AlsCameraAnimationInstanceState {
  const lookBranches = LOOK_BRANCH_DEFINITIONS.map(createLookBranchState)
  const lookSources = lookBranches.map(({ curves }) => curves)
  const shoulderBranches = SHOULDER_MODIFIERS.map(
    () => new Float64Array(CURVE_COUNT),
  )
  const viewModeBranches = VIEW_MODIFIERS.map(
    () => new Float64Array(CURVE_COUNT),
  )
  const locomotionActionBranches = ACTION_BRANCH_DEFINITIONS.map(
    () => new Float64Array(CURVE_COUNT),
  )
  const curves: Record<string, number> = {}
  for (const name of ALS_CAMERA_ANIMATION_CURVE_NAMES) curves[name] = 0
  return {
    curves,
    curveValues: new Float64Array(CURVE_COUNT),
    lookStateMachine: createLookStateMachineState(),
    lookBranches,
    lookSources,
    lookCurves: new Float64Array(CURVE_COUNT),
    shoulderBlend: createBlendState(SHOULDER_DEFINITION),
    shoulderBranches,
    shoulderCurves: new Float64Array(CURVE_COUNT),
    viewModeBlend: createBlendState(VIEW_DEFINITION),
    viewModeBranches,
    viewModeCurves: new Float64Array(CURVE_COUNT),
    locomotionActionBlend: createBlendState(ACTION_DEFINITION),
    locomotionActionBranches,
  }
}

/**
 * Executes AB_Als_Camera in graph order:
 * look-state profiles/modifiers -> look state machine -> shoulder -> ViewMode -> action.
 */
export function refreshAlsCameraAnimationInstance(
  state: AlsCameraAnimationInstanceState,
  input: AlsCameraAnimationInstanceInput,
  deltaTime: number,
): Record<string, number> {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      'Camera animation delta time must be finite and non-negative',
    )
  }

  // LocomotionMode is published by UAlsCameraAnimationInstance but AB_Als_Camera has no binding
  // for it in the extracted graph.
  void input.LocomotionMode

  // UE updates parents before relevant children. The action node is the root,
  // so it decides whether the cached View Mode -> Shoulder -> Look States
  // chain receives an update at all this frame.
  advanceBlendState(
    state.locomotionActionBlend,
    ACTION_DEFINITION,
    childIndexForTag(ACTION_DEFINITION, input.LocomotionAction),
    deltaTime,
  )

  let lookGraphRelevant = false
  for (
    let index = 0;
    index < ACTION_BRANCH_DEFINITIONS.length;
    index++
  ) {
    if (
      !ACTION_BRANCH_DEFINITIONS[index].startsFromReferencePose
      && state.locomotionActionBlend.weights[index]
        > ZERO_ANIMWEIGHT_THRESH
    ) {
      lookGraphRelevant = true
      break
    }
  }

  if (lookGraphRelevant) {
    if (
      state.lookStateMachine.hasEverBeenUpdated
      && !state.lookStateMachine.updatedPreviousFrame
    ) {
      // The authored state-machine node has
      // bReinitializeOnBecomingRelevant=true.
      reinitializeLookStateMachine(
        state.lookStateMachine,
        state.lookBranches,
      )
    }

    advanceBlendState(
      state.viewModeBlend,
      VIEW_DEFINITION,
      childIndexForTag(VIEW_DEFINITION, input.ViewMode),
      deltaTime,
    )
    advanceBlendState(
      state.shoulderBlend,
      SHOULDER_DEFINITION,
      // FAnimNode_BlendListByBool intentionally stores True Pose at
      // BlendPose[0] and False Pose at BlendPose[1].
      input.bRightShoulder ? 0 : 1,
      deltaTime,
    )
    advanceLookStateMachine(
      state.lookStateMachine,
      input.RotationMode,
      deltaTime,
      state.lookBranches,
    )

    for (
      let index = 0;
      index < LOOK_BRANCH_DEFINITIONS.length;
      index++
    ) {
      if (state.lookStateMachine.statesToUpdate[index] === 0) continue
      evaluateLookBranch(
        state.lookBranches[index],
        LOOK_BRANCH_DEFINITIONS[index],
        input,
        deltaTime,
      )
    }

    state.lookStateMachine.hasEverBeenUpdated = true
    state.lookStateMachine.updatedPreviousFrame = true
  } else {
    state.lookStateMachine.updatedPreviousFrame = false
  }

  // Evaluation runs bottom-up after the update traversal above.
  blendCurves(
    state.lookCurves,
    state.lookSources,
    state.lookStateMachine.weights,
  )
  if (input.ShoulderOffsetY) {
    state.lookCurves[CURVE_INDICES.get('CameraOffsetY')!] += input.ShoulderOffsetY
  }

  for (let index = 0; index < SHOULDER_MODIFIERS.length; index++) {
    copyAndModify(
      state.shoulderBranches[index],
      state.lookCurves,
      SHOULDER_MODIFIERS[index],
    )
  }
  blendCurves(
    state.shoulderCurves,
    state.shoulderBranches,
    state.shoulderBlend.weights,
  )

  for (let index = 0; index < VIEW_MODIFIERS.length; index++) {
    copyAndModify(
      state.viewModeBranches[index],
      state.shoulderCurves,
      VIEW_MODIFIERS[index],
    )
  }
  blendCurves(
    state.viewModeCurves,
    state.viewModeBranches,
    state.viewModeBlend.weights,
  )

  for (let index = 0; index < ACTION_BRANCH_DEFINITIONS.length; index++) {
    const definition = ACTION_BRANCH_DEFINITIONS[index]
    const output = state.locomotionActionBranches[index]
    if (definition.startsFromReferencePose) {
      output.fill(0)
    } else {
      output.set(state.viewModeCurves)
    }
    if (definition.modifier) applyModifier(output, definition.modifier)
  }
  blendCurves(
    state.curveValues,
    state.locomotionActionBranches,
    state.locomotionActionBlend.weights,
  )

  for (let index = 0; index < CURVE_COUNT; index++) {
    state.curves[ALS_CAMERA_ANIMATION_CURVE_NAMES[index]] =
      state.curveValues[index]
  }
  return state.curves
}
