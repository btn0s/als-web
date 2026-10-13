import { compileClipSampler } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { createMutableUePoseNode, sampleSequencePoseNode } from '../../engine/uePoseGraph'
import { blendPoseNodesTogether, type UePoseNode } from '../../engine/uePoseBlend'
import { createSlotMontageClock, playSlotAnimationAsDynamicMontage, advanceSlotMontageClock, stopSlotAnimation, stopSlotMontageGroup, montageSetPosition, calculateSlotMontageWeight, getSlotMontageEvaluationWeight, type SlotMontageSample } from '../../engine/slotMontage'
import type { RigDefinition } from '../../engine/rig'
import type { ConsumerOverlayStates } from './consumerOverlayStates'
import type { AlsLayeringRegionName } from './AlsLayering'

/** A montage fans out to ALS's Curves and four upper-body region Slot nodes.
 * Slot weights, interruption tails, and playback all use the engine's montage clock.
 * Region ownership remains in AB_Als_Layering, never a consumer bone mask. */
export function createConsumerUpperBodySlot(rig: RigDefinition, registration?: ConsumerOverlayStates) {
  const clock = createSlotMontageClock()
  const sources = new Map((registration?.clips ?? []).map(clip => [clip.name, {
    sampler: compileClipSampler(clip, rig), curves: compileClipCurveSamplers(clip),
  }]))
  const samples: SlotMontageSample[] = []
  const poses = new Map<number, ReturnType<typeof createMutableUePoseNode>>()
  const output = createMutableUePoseNode(rig.boneCount)
  const regions = new Map<AlsLayeringRegionName, UePoseNode>(['Spine', 'Head', 'ArmLeft', 'ArmRight'].map(name => [name as AlsLayeringRegionName, output]))
  let previousMode: string | undefined
  let previousId: string | undefined
  let activeId: number | undefined
  let lastBlendOut = 0.1
  const baseCurves = new Map<string, number>()
  return {
    stop(duration: number) { stopSlotMontageGroup(clock, 'Layering', duration); activeId = undefined },
    update(delta: number, blocked: boolean, mode?: string) {
      if (previousMode !== mode) {
        stopSlotMontageGroup(clock, 'Layering', 0)
        activeId = undefined
        previousMode = mode
      }
      const request = registration?.sampleMontage?.()
      if (blocked) {
        // Native actions own these regions. Consume requests during the action so stale fire
        // or reload events cannot resume after its montage exits.
        stopSlotMontageGroup(clock, 'Layering', 0)
        previousId = request?.id ?? previousId
        activeId = undefined
      } else if (request && request.id !== previousId) {
        const source = sources.get(request.clip)
        if (!source) throw new Error(`Missing upper-body montage sequence: ${request.clip}`)
        previousId = request.id
        lastBlendOut = request.blendOut ?? 0.1
        const sample = playSlotAnimationAsDynamicMontage(clock, {
          clipKey: request.clip, clipDuration: source.sampler.clip.duration,
          slotName: 'UpperBody', groupName: 'Layering', blendInDuration: request.blendIn ?? 0.1,
          blendOutDuration: lastBlendOut, blendOutTriggerTime: -1,
          playRate: request.playRate, loopCount: 1, startTime: request.time,
        })
        activeId = sample.instanceId
      } else if (!request && activeId !== undefined) {
        stopSlotAnimation(clock, lastBlendOut)
        activeId = undefined
      }
      advanceSlotMontageClock(clock, delta, samples)
      if (!blocked && request && activeId !== undefined) montageSetPosition(clock, activeId, request.time)
      for (const sample of samples) {
        if (sample.status === 'completed') continue
        let pose = poses.get(sample.instanceId)
        if (!pose) { pose = createMutableUePoseNode(rig.boneCount); poses.set(sample.instanceId, pose) }
        sampleSequencePoseNode(rig, sources.get(sample.clipKey)!, sample.sampleTime, false, pose)
      }
      for (const id of poses.keys()) if (!samples.some(s => s.instanceId === id && s.status !== 'completed')) poses.delete(id)
      registration?.onMontageSamples?.(samples.filter(s => s.status !== 'completed'))
    },
    curves(overlay: ReadonlyMap<string, number>) {
      baseCurves.clear()
      for (const [name, value] of overlay) baseCurves.set(name, name.endsWith('Slot') ? 0 : value)
      const weights = calculateSlotMontageWeight(samples)
      const curves = new Map<string, number>()
      for (const [name, value] of baseCurves) curves.set(name, value * weights.sourceWeight)
      for (const sample of samples) {
        const weight = getSlotMontageEvaluationWeight(sample, weights.totalNodeWeight)
        for (const [name, value] of poses.get(sample.instanceId)?.curves ?? []) curves.set(name, (curves.get(name) ?? 0) + value * weight)
      }
      return curves
    },
    evaluate(overlay: UePoseNode) {
      if (!poses.size) return undefined
      const weight = calculateSlotMontageWeight(samples)
      const nodes: UePoseNode[] = [overlay]
      const weights = [weight.sourceWeight]
      for (const sample of samples) {
        const pose = poses.get(sample.instanceId)
        if (!pose) continue
        nodes.push(pose)
        weights.push(getSlotMontageEvaluationWeight(sample, weight.totalNodeWeight))
      }
      blendPoseNodesTogether(nodes, weights, output)
      return regions
    },
  }
}
