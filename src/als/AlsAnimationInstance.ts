import type { Object3D } from 'three'
import { ALS_GENERAL_ANIMATION_SETTINGS } from './Settings/AlsGeneralAnimationSettings'
import { ALS_VIRTUAL_BONES } from './Utility/AlsVirtualBones'
import { createAlsAnimationCore, hasCompleteAlsControlRig, type AlsAnimationCore, type AlsAnimationCoreOptions } from './AlsAnimationCore'
import { applyPose, createPoseApplicator } from '../engine/applyPose'
import { createAlsFeetPoseBridge } from '../engine/alsFeetPoseBridge'
import { createAlsRagdollPose, type AlsRagdollPose } from '../engine/alsRagdollPose'
import { createRigDefinition } from '../engine/rig'

export * from './AlsAnimationCore'

export interface AlsAnimationInstance extends AlsAnimationCore {
  readonly ragdolling: AlsRagdollPose
}

export function createAlsAnimationInstance(options: Omit<AlsAnimationCoreOptions,
  'rig' | 'feetPoseBridge' | 'componentToWorld' | 'publishPose' | 'publishWeights'> & {
    scene: Object3D
    publishDiagnostics?: boolean
    exposeDebugGlobals?: boolean
  }): AlsAnimationInstance {
  const { scene, publishDiagnostics, exposeDebugGlobals, ...graph } = options
  const rig = createRigDefinition(scene, ALS_VIRTUAL_BONES)
  const applicator = createPoseApplicator(scene, rig)
  const ragdolling = createAlsRagdollPose(scene, graph.animations)
  const feetPoseBridge = hasCompleteAlsControlRig(new Set(rig.boneNames))
    ? createAlsFeetPoseBridge(rig, applicator, scene, ALS_GENERAL_ANIMATION_SETTINGS.useFootIkBones)
    : undefined
  const debugWindow = typeof window === 'undefined'
    ? undefined : window as Window & { __weightTable?: Record<string, number> }
  const animation = createAlsAnimationCore({
    ...graph, rig, feetPoseBridge,
    componentToWorld: () => scene.matrixWorld,
    publishWeights: publishDiagnostics !== false && exposeDebugGlobals !== false && debugWindow
      ? weights => { debugWindow.__weightTable = weights }
      : undefined,
    publishPose: (pose, deltaTime) => {
      ragdolling.evaluate(pose, deltaTime)
      applyPose(applicator, pose)
    },
  })
  return { ...animation, ragdolling }
}
