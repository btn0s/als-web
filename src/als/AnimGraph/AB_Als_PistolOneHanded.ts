import type { CompiledWeightBlendProfile } from '../../engine/blendProfile'
import type { RigDefinition } from '../../engine/rig'
import {
  ALS_PISTOL_TWO_HANDED_GRAPH,
  createAlsPistolRuntime,
  evaluateAlsPistolGraph,
  type AlsPistolGraph,
} from './AB_Als_PistolTwoHanded'

/** AB_Als_PistolOneHanded: same state machine, distinct pose bank and Relaxed topology. */
export const ALS_PISTOL_ONE_HANDED_GRAPH = {
  ...ALS_PISTOL_TWO_HANDED_GRAPH,
  pistolStates: { ...ALS_PISTOL_TWO_HANDED_GRAPH.pistolStates, stateMachineNodeIndex: 35 },
  relaxed: {
    standingTimes: [0, 0.05],
    crouchingTime: 0.216667,
    idleAdditiveAlpha: 0.75,
  },
  ready: {
    ...ALS_PISTOL_TWO_HANDED_GRAPH.ready,
    standingTimes: [0.083333, 0.116667],
    crouchingTime: 0.25,
  },
  aiming: {
    ...ALS_PISTOL_TWO_HANDED_GRAPH.aiming,
    standingTimes: [0.15, 0.183333],
    crouchingTime: 0.283333,
    standingAimReferenceFrame: 5,
    crouchingAimReferenceFrame: 9,
  },
  gameplayTagsBlend: {
    ...ALS_PISTOL_TWO_HANDED_GRAPH.gameplayTagsBlend,
    nodeIndex: 39,
    overrides: {
      Mantling: { nodeIndex: 36, posesTime: 0.116667 },
      GettingUp: { nodeIndex: 41, posesTime: 0.25, curves: { LayerArmRight: 3 } },
      Rolling: { nodeIndex: 40, posesTime: 0.116667, curves: { LayerArmRight: 3 } },
    },
  },
} as const satisfies AlsPistolGraph

export function createAlsPistolOneHandedRuntime(
  rig: RigDefinition,
  quickFeetBlendProfile: CompiledWeightBlendProfile | null = null,
) {
  return createAlsPistolRuntime(rig, quickFeetBlendProfile, ALS_PISTOL_ONE_HANDED_GRAPH)
}
export const evaluateAlsPistolOneHandedGraph = evaluateAlsPistolGraph
