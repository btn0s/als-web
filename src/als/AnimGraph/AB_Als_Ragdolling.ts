import type { AlsLocomotionAction } from '../AlsCharacter'

/**
 * AB_Als_Ragdolling's complete six-node authored graph.
 *
 * The inner zero-time tag blend selects Flail only while the action is Ragdolling and selects the
 * captured FinalRagdollPose for every other action. The outer tag blend owns the visible 0.5 s
 * entry and 0.4 s exit against the linked Ragdolling Input pose.
 */
export const AB_ALS_RAGDOLLING_GRAPH = {
  rootNodeIndex: 0,
  linkedInputPose: {
    nodeIndex: 1,
    name: 'Ragdolling Input',
  },
  outerGameplayTagsBlend: {
    nodeIndex: 2,
    tag: 'Als.LocomotionAction.Ragdolling',
    defaultPoseNodeIndex: 1,
    taggedPoseNodeIndex: 3,
    defaultBlendTime: 0.4,
    taggedBlendTime: 0.5,
    blendType: 'Linear',
    transitionType: 'StandardBlend',
    resetChildOnActivation: false,
  },
  innerGameplayTagsBlend: {
    nodeIndex: 3,
    tag: 'Als.LocomotionAction.Ragdolling',
    defaultPoseNodeIndex: 5,
    taggedPoseNodeIndex: 4,
    defaultBlendTime: 0,
    taggedBlendTime: 0,
    blendType: 'Linear',
    transitionType: 'StandardBlend',
    resetChildOnActivation: false,
  },
  flailSequencePlayer: {
    nodeIndex: 4,
    sequence: 'A_Als_Flail',
    startPosition: 0,
    loopAnimation: true,
    playRateBinding: 'RagdollingState.FlailPlayRate',
    syncMethod: 'DoNotSync',
  },
  finalRagdollPoseSnapshot: {
    nodeIndex: 5,
    sourceBinding: 'RagdollingState.FinalRagdollPose',
    mode: 'SnapshotPin',
  },
} as const

export interface AlsRagdollingGraphState {
  ragdollingAmount: number
  blendSourceAmount: number
  blendElapsedTime: number
  blendDuration: number
  blendTarget: 0 | 1
}

export interface AlsRagdollingGraphSample {
  readonly linkedInputWeight: number
  readonly flailWeight: number
  readonly finalRagdollPoseWeight: number
  readonly ragdollingAmount: number
}

export function createAlsRagdollingGraphState(): AlsRagdollingGraphState {
  return {
    ragdollingAmount: 0,
    blendSourceAmount: 0,
    blendElapsedTime: 0,
    blendDuration:
      AB_ALS_RAGDOLLING_GRAPH.outerGameplayTagsBlend.defaultBlendTime,
    blendTarget: 0,
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * FAlsAnimNode_GameplayTagsBlend is a tag-indexed FAnimNode_BlendListBase. With this graph's two
 * poses and Linear StandardBlend, the retained scalar is the exact tagged-pose weight.
 */
export function refreshAlsRagdollingGraph(
  state: AlsRagdollingGraphState,
  locomotionAction: AlsLocomotionAction,
  deltaTime: number,
  relevant = true,
): AlsRagdollingGraphSample {
  const bRagdolling = locomotionAction === 'Ragdolling'
  const blendTarget: 0 | 1 = bRagdolling ? 1 : 0

  if (relevant) {
    if (blendTarget !== state.blendTarget) {
      state.blendSourceAmount = state.ragdollingAmount
      state.blendElapsedTime = 0
      state.blendDuration = blendTarget === 1
        ? AB_ALS_RAGDOLLING_GRAPH
            .outerGameplayTagsBlend.taggedBlendTime
        : AB_ALS_RAGDOLLING_GRAPH
            .outerGameplayTagsBlend.defaultBlendTime
      state.blendTarget = blendTarget
    }

    state.blendElapsedTime += Number.isFinite(deltaTime)
      ? Math.max(0, deltaTime)
      : 0
    const transitionAmount = state.blendDuration <= 0
      ? 1
      : clamp01(state.blendElapsedTime / state.blendDuration)
    state.ragdollingAmount = (
      state.blendSourceAmount
      + (
        state.blendTarget - state.blendSourceAmount
      ) * transitionAmount
    )
  }

  const ragdollingAmount = clamp01(state.ragdollingAmount)
  return {
    linkedInputWeight: 1 - ragdollingAmount,
    flailWeight: bRagdolling ? ragdollingAmount : 0,
    finalRagdollPoseWeight: bRagdolling ? 0 : ragdollingAmount,
    ragdollingAmount,
  }
}
