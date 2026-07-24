import type { CompiledClipSampler } from './clipSampler'
import { resolveClipTime, sampleClip } from './clipSampler'
import type { ClipCurveSamplers } from './curves'
import type { MutableUePoseNode } from './uePoseBlend'
import { createPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'

/** One sequence source consumed by a code-authored Unreal AnimGraph node. */
export interface UeSequencePoseSource {
  readonly sampler: CompiledClipSampler
  readonly curves?: ClipCurveSamplers
}

export function createMutableUePoseNode(
  boneCount: number,
): MutableUePoseNode {
  return {
    pose: createPoseBuffer(boneCount),
    curves: new Map(),
  }
}

/**
 * Evaluates one Sequence Player/Evaluator leaf into retained pose and curve storage.
 *
 * Explicit-time evaluators pass `loop=false`; synchronized sequence players pass their live time
 * and authored looping flag. Curves use the same resolved time as transforms.
 */
export function sampleSequencePoseNode(
  rig: RigDefinition,
  source: UeSequencePoseSource,
  time: number,
  loop: boolean,
  out: MutableUePoseNode,
): MutableUePoseNode {
  sampleClip(source.sampler, rig, time, out.pose, loop)
  out.curves.clear()
  if (!source.curves) return out

  const resolvedTime = resolveClipTime(
    time,
    source.sampler.clip.duration,
    loop,
  )
  for (const name in source.curves) {
    out.curves.set(name, source.curves[name](resolvedTime))
  }
  return out
}
