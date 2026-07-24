import { alphaToBlendOption } from '../../engine/alphaBlend'
import {
  fInterpTo,
  mapRangeUnclamped,
} from '../../engine/inputScaleBiasClamp'
import type { AlsGait } from '../Settings/AlsMovementSettings'

/*
 * AB_Als_Standing's Move Forward cache, compiled nodes 129..144.
 *
 * VERIFIED:
 * - The two sequence players, both TwoWayBlend nodes, and the custom GameplayTagsBlend node are
 *   serialized in scripts/extract-als/abp-graph.json.
 * - The three StandingState values are direct ports of RefreshStandingMovement() in ALS 4.15.
 * - FInputScaleBiasClamp maps before interpolation and uses FInterpTo's delta*speed clamp.
 * - SequencePlayer PlayRateBasis divides its bound PlayRate (Epic's engine API contract).
 */
export const ALS_STANDING_SPRINT_GRAPH = {
  sprint: {
    compiledNodeIndex: 129,
    clip: 'A_Als_Sprint',
    startPosition: 0.166667,
    playRateBasis: 1,
  },
  sprintAcceleration: {
    compiledNodeIndex: 130,
    clip: 'A_Als_Sprint_Acceleration',
    startPosition: 0.166667,
    playRateBasis: 0.833333,
  },
  sprintAccelerationBlend: {
    compiledNodeIndex: 131,
    inputMinimum: 0,
    inputMaximum: 0.25,
    outputMinimum: 0,
    outputMaximum: 1,
    interpolate: true,
    interpolationSpeedIncreasing: 20,
    interpolationSpeedDecreasing: 4,
    resetChildOnActivation: true,
  },
  sprintBlockBlend: {
    compiledNodeIndex: 139,
    alphaBinding: 'StandingState.SprintBlockAmount',
    resetChildOnActivation: false,
  },
  gaitBlend: {
    compiledNodeIndex: 144,
    activeTagBinding: 'Gait',
    sprintingTag: 'Als.Gait.Sprinting',
    defaultBlendDuration: 0.3,
    sprintingBlendDuration: 0.2,
    blendOption: 'Cubic',
    resetChildOnActivation: false,
  },
} as const

const SPRINT_TIME_THRESHOLD = 0.5

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export interface AlsStandingSprintState {
  /** FAlsStandingState fields, refreshed before graph property bindings execute. */
  sprintBlockAmount: number
  sprintTime: number
  sprintAccelerationAmount: number

  /** FAnimNode_BlendListBase state for the gait-tag selection. */
  sprintBlendAmount: number
  sprintBlendSourceAmount: number
  sprintBlendElapsedTime: number
  sprintBlendDuration: number
  sprintBlendTarget: 0 | 1

  /** FInputScaleBiasClampState owned by the acceleration TwoWayBlend. */
  sprintAccelerationBlendAmount: number
  sprintAccelerationBlendInitialized: boolean
}

export function createAlsStandingSprintState(): AlsStandingSprintState {
  return {
    sprintBlockAmount: 0,
    sprintTime: 0,
    sprintAccelerationAmount: 0,
    sprintBlendAmount: 0,
    sprintBlendSourceAmount: 0,
    sprintBlendElapsedTime: 0,
    sprintBlendDuration:
      ALS_STANDING_SPRINT_GRAPH.gaitBlend.defaultBlendDuration,
    sprintBlendTarget: 0,
    sprintAccelerationBlendAmount: 0,
    sprintAccelerationBlendInitialized: false,
  }
}

export interface AlsStandingSprintInput {
  readonly gait: AlsGait
  readonly deltaTime: number
  readonly pendingUpdate?: boolean
  /** GetCurveValueClamped01(UAlsConstants::SprintBlockCurveName()). */
  readonly sprintBlockCurveValue: number
  /** GetRelativeAccelerationAmount().X. */
  readonly relativeAccelerationAmountX: number
  /** StandingState.PlayRate bound to both sequence players. */
  readonly standingPlayRate: number
  /** Whether the Move Forward cache currently updates this graph branch. */
  readonly relevant?: boolean
}

export interface AlsStandingSprintGraphSample {
  readonly moveForwardBaseWeight: number
  readonly sprintWeight: number
  readonly sprintAccelerationWeight: number
  readonly sprintBlendAmount: number
  readonly sprintAccelerationBlendAmount: number
  readonly sprintBlockAmount: number
  readonly sprintPlayRate: number
  readonly sprintAccelerationPlayRate: number
}

/**
 * RefreshStandingMovement()'s sprint fields followed by AB_Als_Standing's exact nested blends.
 * Mutating a retained state mirrors the three stateful Unreal nodes without allocating per frame.
 */
export function refreshStandingSprint(
  state: AlsStandingSprintState,
  input: AlsStandingSprintInput,
): AlsStandingSprintGraphSample {
  const deltaTime = Number.isFinite(input.deltaTime)
    ? Math.max(0, input.deltaTime)
    : 0
  state.sprintBlockAmount = clamp01(input.sprintBlockCurveValue)

  if (input.gait !== 'Sprinting') {
    state.sprintTime = 0
    state.sprintAccelerationAmount = 0
  } else {
    state.sprintTime = input.pendingUpdate === true
      ? SPRINT_TIME_THRESHOLD
      : state.sprintTime + deltaTime
    state.sprintAccelerationAmount =
      state.sprintTime >= SPRINT_TIME_THRESHOLD
        ? 0
        : input.relativeAccelerationAmountX
  }

  const relevant = input.relevant !== false
  if (relevant) {
    const sprintBlendTarget = input.gait === 'Sprinting' ? 1 : 0
    if (sprintBlendTarget !== state.sprintBlendTarget) {
      state.sprintBlendSourceAmount = state.sprintBlendAmount
      state.sprintBlendElapsedTime = 0
      state.sprintBlendDuration = sprintBlendTarget === 1
        ? ALS_STANDING_SPRINT_GRAPH.gaitBlend.sprintingBlendDuration
        : ALS_STANDING_SPRINT_GRAPH.gaitBlend.defaultBlendDuration
      state.sprintBlendTarget = sprintBlendTarget
    }

    state.sprintBlendElapsedTime += deltaTime
    const transitionAmount = state.sprintBlendDuration <= 0
      ? 1
      : clamp01(
          state.sprintBlendElapsedTime / state.sprintBlendDuration,
        )
    const blendedTransitionAmount = alphaToBlendOption(
      transitionAmount,
      ALS_STANDING_SPRINT_GRAPH.gaitBlend.blendOption,
    )
    state.sprintBlendAmount =
      state.sprintBlendSourceAmount
      + (
        state.sprintBlendTarget - state.sprintBlendSourceAmount
      ) * blendedTransitionAmount

    // The sprint child updates while active or while its outgoing blend still has weight.
    if (sprintBlendTarget === 1 || state.sprintBlendAmount > 0) {
      const settings =
        ALS_STANDING_SPRINT_GRAPH.sprintAccelerationBlend
      const mappedAcceleration = mapRangeUnclamped(
        state.sprintAccelerationAmount,
        settings.inputMinimum,
        settings.inputMaximum,
        settings.outputMinimum,
        settings.outputMaximum,
      )
      if (!state.sprintAccelerationBlendInitialized) {
        state.sprintAccelerationBlendAmount = mappedAcceleration
        state.sprintAccelerationBlendInitialized = true
      } else {
        const interpolationSpeed =
          mappedAcceleration > state.sprintAccelerationBlendAmount
            ? settings.interpolationSpeedIncreasing
            : settings.interpolationSpeedDecreasing
        state.sprintAccelerationBlendAmount = fInterpTo(
          state.sprintAccelerationBlendAmount,
          mappedAcceleration,
          deltaTime,
          interpolationSpeed,
        )
      }
    }
  }

  const sprintAccelerationBlendAmount = clamp01(
    state.sprintAccelerationBlendAmount,
  )
  const sprintGraphWeight =
    clamp01(state.sprintBlendAmount) * (1 - state.sprintBlockAmount)
  const sprintAccelerationWeight =
    sprintGraphWeight * sprintAccelerationBlendAmount
  const sprintWeight =
    sprintGraphWeight * (1 - sprintAccelerationBlendAmount)

  return {
    moveForwardBaseWeight: 1 - sprintGraphWeight,
    sprintWeight,
    sprintAccelerationWeight,
    sprintBlendAmount: clamp01(state.sprintBlendAmount),
    sprintAccelerationBlendAmount,
    sprintBlockAmount: state.sprintBlockAmount,
    sprintPlayRate:
      input.standingPlayRate
      / ALS_STANDING_SPRINT_GRAPH.sprint.playRateBasis,
    sprintAccelerationPlayRate:
      input.standingPlayRate
      / ALS_STANDING_SPRINT_GRAPH.sprintAcceleration.playRateBasis,
  }
}
