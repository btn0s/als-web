import type { AnimationClip, Object3D } from 'three'
import { createPhysicsPoseBridge, type PhysicsBoneWorldPose } from './physicsPoseBridge'
import { copyPose, createPoseBuffer, type LocalPoseBuffer } from './poseBuffer'
import { compileClipSampler, sampleClip } from './clipSampler'
import { blendPoseInPlace } from './blend'
import { ALS_VIRTUAL_BONES } from '../als/Utility/AlsVirtualBones'
import { createAlsRagdollingGraphState, refreshAlsRagdollingGraph } from '../als/AnimGraph/AB_Als_Ragdolling'
import { ALS_PHYSICS_ASSET } from './rapierAlsPhysicsAsset'

/** AB_Als_Ragdolling runs after CR_Als; simulated bodies override animation afterwards. */
export function createAlsRagdollPose(scene: Object3D, animations: AnimationClip[]) {
  const bridge = createPhysicsPoseBridge(scene, ALS_VIRTUAL_BONES)
  const graph = createAlsRagdollingGraphState()
  const pose = createPoseBuffer(bridge.rig.boneCount)
  const snapshot = createPoseBuffer(bridge.rig.boneCount)
  const flailPose = createPoseBuffer(bridge.rig.boneCount)
  const clip = animations.find(c => c.name === 'A_Als_Flail')
  const flail = clip && compileClipSampler(clip, bridge.rig)
  const boneNames = ALS_PHYSICS_ASSET.bodies.filter(b => b.boneName !== 'root').map(b => b.boneName)
  let flailTime = 0, hasSnapshot = false
  const runtime = {
    bridge, boneNames,
    active: false,
    speed: 0,
    physics: null as (() => ReadonlyMap<string, PhysicsBoneWorldPose>) | null,
    targets: new Map<string, PhysicsBoneWorldPose>(),
    captureSnapshot() { copyPose(pose, snapshot); hasSnapshot = true; return snapshot },
    restoreSnapshot(world: ReadonlyMap<string, PhysicsBoneWorldPose>) {
      bridge.composeLocalPose(snapshot, world, snapshot)
    },
    evaluate(animation: LocalPoseBuffer, dt: number) {
      const weights = refreshAlsRagdollingGraph(graph, runtime.active ? 'Ragdolling' : null, dt)
      if (runtime.active && flail) {
        // UAlsAnimationInstance::RefreshRagdolling: speed / 1000 cm/s, clamped 0..1.
        flailTime += dt * Math.min(1, runtime.speed / 10)
        sampleClip(flail, bridge.rig, flailTime % flail.clip.duration, flailPose)
        blendPoseInPlace(animation, flailPose, weights.flailWeight)
      } else if (hasSnapshot && weights.finalRagdollPoseWeight > 0) {
        blendPoseInPlace(animation, snapshot, weights.finalRagdollPoseWeight)
      }
      if (runtime.active && runtime.physics) {
        runtime.targets = bridge.resolveWorldPoses(animation, boneNames)
        bridge.composeLocalPose(animation, runtime.physics(), animation)
      }
      copyPose(animation, pose)
    },
  }
  return runtime
}
export type AlsRagdollPose = ReturnType<typeof createAlsRagdollPose>
