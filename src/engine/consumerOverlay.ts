import type { AnimationClip } from 'three'
import { compileClipSampler, sampleClip, type CompiledClipSampler } from './clipSampler'
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
  sample(): { pose: ConsumerPoseSample; aim?: ConsumerPoseSample & { weight: number }; montage?: ConsumerPoseSample & { weight: number } } | null
}

export function createConsumerOverlay(rig: RigDefinition, source?: ConsumerOverlaySource) {
  if (!source) return null
  const clips = new Map(source.clips.map((clip) => [clip.name, clip]))
  const samplers = new Map<string, CompiledClipSampler>()
  const sampler = (name: string) => {
    let compiled = samplers.get(name)
    const clip = clips.get(name)
    if (!compiled && clip) {
      compiled = compileClipSampler(clip, rig)
      samplers.set(name, compiled)
    }
    return compiled
  }
  const montagePose = createPoseBuffer(rig.boneCount)
  const aimPose = createPoseBuffer(rig.boneCount)
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
    const base = sampler(frame.pose.clip)
    if (!base) throw new Error(`Missing consumer overlay sequence: ${frame.pose.clip}`)
    sampleClip(base, rig, frame.pose.time, pose, frame.pose.loop ?? false)
    if (frame.aim) {
      const aim = sampler(frame.aim.clip)
      if (!aim) throw new Error(`Missing consumer aim sequence: ${frame.aim.clip}`)
      sampleClip(aim, rig, frame.aim.time, aimPose, false)
      blendPoseInPlace(pose, aimPose, Math.max(0, Math.min(1, frame.aim.weight)))
    }
    if (!frame.montage) return
    const montage = sampler(frame.montage.clip)
    if (!montage) throw new Error(`Missing consumer montage sequence: ${frame.montage.clip}`)
    sampleClip(montage, rig, frame.montage.time, montagePose, frame.montage.loop ?? false)
    blendPoseInPlace(pose, montagePose, Math.max(0, Math.min(1, frame.montage.weight)), mask)
  }
}
