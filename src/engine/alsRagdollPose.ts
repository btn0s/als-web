import type { AnimationClip, Object3D } from 'three'
import { createPhysicsPoseBridge, type PhysicsBoneWorldPose } from './physicsPoseBridge'
import { createPoseBuffer, type LocalPoseBuffer } from './poseBuffer'
import { compileClipSampler, sampleClip } from './clipSampler'
import { blendPoseInPlace } from './blend'
import { ALS_VIRTUAL_BONES } from '../als/Utility/AlsVirtualBones'
import { createAlsRagdollingGraphState, refreshAlsRagdollingGraph } from '../als/AnimGraph/AB_Als_Ragdolling'
import { createAlsRagdollingAnimationState } from '../als/State/AlsRagdollingAnimationState'
import { refreshRagdollingOnGameThread } from '../als/AlsAnimationInstance_Ragdolling'
import { ALS_PHYSICS_ASSET } from './rapierAlsPhysicsAsset'

/** AB_Als_Ragdolling runs after CR_Als; simulated bodies override animation afterwards. */
export function createAlsRagdollPose(scene: Object3D, animations: AnimationClip[]) {
  const bridge = createPhysicsPoseBridge(scene, ALS_VIRTUAL_BONES)
  const graph = createAlsRagdollingGraphState()
  const state = createAlsRagdollingAnimationState()
  const snapshot = createPoseBuffer(bridge.rig.boneCount)
  const flailPose = createPoseBuffer(bridge.rig.boneCount)
  const clip = animations.find(c => c.name === 'A_Als_Flail')
  const flail = clip && compileClipSampler(clip, bridge.rig)
  const boneNames = ALS_PHYSICS_ASSET.bodies.map(b => b.boneName)
  let flailTime = 0
  let pendingPelvis: ReadonlyMap<string, PhysicsBoneWorldPose> | null = null
  const runtime = {
    bridge, boneNames, state, scene,
    active: false,
    velocity: { x: 0, y: 0, z: 0 },
    physics: null as (() => ReadonlyMap<string, PhysicsBoneWorldPose>) | null,
    targets: new Map<string, PhysicsBoneWorldPose>(),
    captureSnapshot() {
      // USkeletalMeshComponent::SnapshotPose reads its current component-space publication.
      for (let i = 0; i < bridge.applicator.bones.length; i++) {
        const bone = bridge.applicator.bones[i]
        bone.position.toArray(snapshot.positions, i * 3)
        bone.quaternion.toArray(snapshot.rotations, i * 4)
        bone.scale.toArray(snapshot.scales, i * 3)
      }
      state.FinalRagdollPose = snapshot
      return snapshot
    },
    restoreSnapshot(world: ReadonlyMap<string, PhysicsBoneWorldPose>) {
      // Character teleport is published by Rapier/MeshBase before the next animation tick.
      // Rebase against that restored component, never the preceding capsule transform.
      pendingPelvis = world
    },
    evaluate(animation: LocalPoseBuffer, dt: number) {
      if (pendingPelvis) {
        bridge.composeLocalPose(snapshot, pendingPelvis, snapshot)
        pendingPelvis = null
      }
      refreshRagdollingOnGameThread(state, runtime.active ? 'Ragdolling' : null, runtime.velocity)
      const weights = refreshAlsRagdollingGraph(graph, runtime.active ? 'Ragdolling' : null, dt)
      if (runtime.active && flail) {
        // UAlsAnimationInstance::RefreshRagdolling: speed / 1000 cm/s, clamped 0..1.
        flailTime += dt * state.FlailPlayRate
        sampleClip(flail, bridge.rig, flailTime % flail.clip.duration, flailPose)
        blendPoseInPlace(animation, flailPose, weights.flailWeight)
      } else if (state.FinalRagdollPose && weights.finalRagdollPoseWeight > 0) {
        blendPoseInPlace(animation, snapshot, weights.finalRagdollPoseWeight)
      }
      if (runtime.active && runtime.physics) {
        runtime.targets = bridge.resolveWorldPoses(animation, boneNames)
        bridge.composeLocalPose(animation, runtime.physics(), animation)
      }
    },
  }
  return runtime
}
export type AlsRagdollPose = ReturnType<typeof createAlsRagdollPose>
