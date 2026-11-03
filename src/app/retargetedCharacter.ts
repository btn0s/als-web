import { Group, Mesh, Object3D, SkinnedMesh } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { applyPose, createPoseApplicator } from '../engine/applyPose'
import { createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import {
  ALS_TRIPO_HUMANOID_PROFILE, createCompiledRetargeter, detectRetargetFacing,
} from '../engine/retarget'
import type { RetargetDiagnostics, RetargetProfile } from '../engine/retarget'

export interface RetargetedCharacterOptions {
  /** The actor's independently animated skeleton, including published cosmetic ragdolls. */
  source: Object3D
  /** Immutable source bind asset, before animation or prop attachment. */
  reference: Object3D
  /** Cached target asset. Its geometry/materials stay shared; its skeleton is cloned. */
  target: Object3D
  profile?: Omit<RetargetProfile, 'facing'>
  meshLayers?: number
  castShadow?: boolean
  receiveShadow?: boolean
}

export interface RetargetedCharacter {
  readonly object: Group
  readonly source: Object3D
  readonly target: Object3D
  readonly diagnostics: RetargetDiagnostics
  readonly translationScale: number
  /** Call after source pose publication, before attachments, bounds reads or rendering. */
  update(): void
  /** Restores mannequin visibility and frees only this target's cloned skeleton resources. */
  dispose(): void
}

/** ORIGINAL consumer dressing boundary. No movement, animation evaluation or game state. */
export function createRetargetedCharacter(options: RetargetedCharacterOptions): RetargetedCharacter {
  const { source, reference } = options
  const target = clone(options.target)
  const sourceRig = createRigDefinition(reference)
  const targetRig = createRigDefinition(target)
  const facing = detectRetargetFacing(sourceRig, targetRig)
  const retargeter = createCompiledRetargeter(sourceRig, targetRig, {
    ...(options.profile ?? ALS_TRIPO_HUMANOID_PROFILE), facing,
  })
  const sourceApplicator = createPoseApplicator(source, sourceRig)
  const targetApplicator = createPoseApplicator(target, targetRig)
  const sourcePose = createPoseBuffer(sourceRig.boneCount)
  const targetPose = createPoseBuffer(targetRig.boneCount)
  const object = new Group()
  object.quaternion.fromArray(facing).invert()
  object.add(target)
  const sourceBones = new Set(sourceApplicator.bones)
  const hidden = new Map<Mesh, boolean>()
  const targetMeshes: SkinnedMesh[] = []
  source.traverse(node => {
    // Mounted props may have their own skeleton and overlapping bone names.
    if (node instanceof SkinnedMesh && node.skeleton.bones.some(bone => sourceBones.has(bone))) {
      hidden.set(node, node.visible)
      node.visible = false
    }
  })
  target.traverse(node => {
    if (!(node instanceof Mesh)) return
    node.castShadow = options.castShadow ?? true
    node.receiveShadow = options.receiveShadow ?? true
    node.layers.mask = options.meshLayers ?? 1
    if (node instanceof SkinnedMesh) {
      // Bind-pose bounds do not cover crouches, traversal or ragdolls.
      node.frustumCulled = false
      targetMeshes.push(node)
    }
  })
  return {
    object, source, target, diagnostics: retargeter.diagnostics,
    translationScale: retargeter.diagnostics.translationScale,
    update() {
      sourceApplicator.bones.forEach((bone, index) => {
        bone.position.toArray(sourcePose.positions, index * 3)
        bone.quaternion.toArray(sourcePose.rotations, index * 4)
        bone.scale.toArray(sourcePose.scales, index * 3)
      })
      retargeter.apply(sourcePose, targetPose)
      applyPose(targetApplicator, targetPose)
      target.updateWorldMatrix(true, false)
      target.updateMatrixWorld(true)
      for (const mesh of targetMeshes) mesh.skeleton.update()
    },
    dispose() {
      object.removeFromParent()
      for (const [mesh, visible] of hidden) mesh.visible = visible
      const skeletons = new Set(targetMeshes.map(mesh => mesh.skeleton))
      for (const skeleton of skeletons) skeleton.dispose()
    },
  }
}
