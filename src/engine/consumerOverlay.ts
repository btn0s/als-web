import type { AnimationClip } from 'three'
import { compileClipSampler, sampleClip } from './clipSampler'
import { createPoseBuffer } from './poseBuffer'
import type { LocalPoseBuffer } from './poseBuffer'
import type { RigDefinition } from './rig'
import { blendPoseInPlace } from './blend'

export interface ConsumerPoseSample {
  clip: string
  time: number
  loop?: boolean
}

export interface ConsumerOverlaySource {
  clips: readonly AnimationClip[]
  sample(): { pose: ConsumerPoseSample; montage?: ConsumerPoseSample & { weight: number } } | null
}

export function createConsumerOverlay(rig: RigDefinition, source?: ConsumerOverlaySource) {
  if (!source) return null
  const clips = new Map(source.clips.map((clip) => [clip.name, compileClipSampler(clip, rig)]))
  const montagePose = createPoseBuffer(rig.boneCount)
  const mask = new Float32Array(rig.boneCount)
  for (let i = 0; i < rig.boneCount; i++) {
    let ancestor = i
    while (ancestor >= 0) {
      const name = rig.boneNames[ancestor]
      if (name === 'spine_01' || name === 'ik_hand_root' || name.startsWith('VB hand')) {
        mask[i] = 1
        break
      }
      ancestor = rig.parentIndices[ancestor]
    }
  }
  return (pose: LocalPoseBuffer) => {
    const frame = source.sample()
    if (!frame) return
    const base = clips.get(frame.pose.clip)
    if (!base) throw new Error(`Missing consumer overlay sequence: ${frame.pose.clip}`)
    sampleClip(base, rig, frame.pose.time, pose, frame.pose.loop ?? false)
    if (!frame.montage) return
    const montage = clips.get(frame.montage.clip)
    if (!montage) throw new Error(`Missing consumer montage sequence: ${frame.montage.clip}`)
    sampleClip(montage, rig, frame.montage.time, montagePose, frame.montage.loop ?? false)
    blendPoseInPlace(pose, montagePose, Math.max(0, Math.min(1, frame.montage.weight)), mask)
  }
}
