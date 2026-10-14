import type { AnimationClip } from 'three'
import type { AlsAnimationInstanceControls } from '../AlsAnimationInstance'
import { compileClipSampler } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { copyPose } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import { compileAuthoredRootMotion } from '../../engine/rootMotion'
import { createMutableUePoseNode, sampleSequencePoseNode } from '../../engine/uePoseGraph'
import { blendPoseNodesTogether, blendTwoPoseNodesTogether } from '../../engine/uePoseBlend'
import type { MutableUePoseNode } from '../../engine/uePoseBlend'

export interface ConsumerLocomotionSample {
  readonly sources: readonly {
    readonly clip: string
    readonly time: number
    readonly weight: number
    readonly loop: boolean
  }[]
  readonly curves?: Readonly<Record<string, number>>
  /** Desired named values after overlay/slot curve composition, weighted by this linked stance. */
  readonly layeringCurves?: Readonly<Record<string, number>>
}

/** A replacement linked stance graph, evaluated before PostLocomotion, Layering and Control Rig.
 * The consumer owns sequence clocks/selection; the ALS engine owns pose and curve evaluation.
 * Returning null selects the original stance graph. This never writes the rendered skeleton. */
export interface ConsumerLocomotionState {
  readonly stance: 'Standing' | 'Crouching'
  readonly blendDuration: number
  sample(controls: Readonly<AlsAnimationInstanceControls>, deltaTime: number): ConsumerLocomotionSample | null
  onSample?(sample: ConsumerLocomotionSample | null, effectiveWeight: number): void
  /** Transient engine-owned buffers; observers must copy before returning. */
  onPose?(snapshot: {
    readonly rig: RigDefinition
    readonly source: Readonly<MutableUePoseNode> | null
    readonly linked: Readonly<MutableUePoseNode>
    readonly effectiveWeight: number
  }): void
}

export interface ConsumerLocomotionStates {
  readonly clips: readonly AnimationClip[]
  readonly states: readonly ConsumerLocomotionState[]
  /** Borrowed component-stage inputs/outputs, captured synchronously without changing evaluation. */
  onEvaluatePose?(snapshot: {
    readonly stage: 'layering-input' | 'layering-output' | 'view-output' | 'control-rig-input' | 'control-rig-output'
    readonly rig: RigDefinition
    readonly pose: LocalPoseBuffer
    readonly curves: ReadonlyMap<string, number>
  }): void
}

export function createConsumerLocomotionStates(rig: RigDefinition, registration?: ConsumerLocomotionStates) {
  const clips = new Map((registration?.clips ?? []).map(clip => [clip.name, {
    sampler: compileClipSampler(clip, rig),
    curves: compileClipCurveSamplers(clip),
    rootMotion: compileAuthoredRootMotion(clip),
    node: createMutableUePoseNode(rig.boneCount),
  }]))
  if (clips.size !== registration?.clips.length && registration) throw new Error('Duplicate consumer locomotion clip')
  const states = new Map<string, {
    definition: ConsumerLocomotionState
    weight: number
    previous: ConsumerLocomotionSample | null
    pose: MutableUePoseNode
    output: MutableUePoseNode
  }>()
  for (const definition of registration?.states ?? []) {
    if (states.has(definition.stance)) throw new Error(`Duplicate locomotion stance: ${definition.stance}`)
    if (!Number.isFinite(definition.blendDuration) || definition.blendDuration < 0) throw new Error('Invalid locomotion blend duration')
    states.set(definition.stance, { definition, weight: 0, previous: null, pose: createMutableUePoseNode(rig.boneCount), output: createMutableUePoseNode(rig.boneCount) })
  }
  const layeringCurves = new Map<string, { weight: number; value: number }>()
  return {
    applyLayeringCurves(output: Map<string, number>) {
      for (const [name, blend] of layeringCurves) {
        output.set(name, (output.get(name) ?? 0) * (1 - blend.weight) + blend.value)
      }
    },
    evaluate(controls: Readonly<AlsAnimationInstanceControls>, deltaTime: number, standing: MutableUePoseNode, crouching: MutableUePoseNode, stanceWeights: Readonly<{ Standing: number; Crouching: number }>) {
      if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new Error('Invalid locomotion delta time')
      layeringCurves.clear()
      for (const state of states.values()) {
        const sample = state.definition.sample(controls, deltaTime)
        const target = sample ? 1 : 0
        const step = state.definition.blendDuration > 0 ? deltaTime / state.definition.blendDuration : 1
        state.weight += Math.max(-step, Math.min(step, target - state.weight))
        if (sample) {
          const nodes: MutableUePoseNode[] = []
          const weights: number[] = []
          const names = new Set<string>()
          let total = 0
          for (const source of sample.sources) {
            const clip = clips.get(source.clip)
            if (!clip) throw new Error(`Missing consumer locomotion sequence: ${source.clip}`)
            if (names.has(source.clip)) throw new Error(`Duplicate locomotion sample: ${source.clip}`)
            names.add(source.clip)
            if (!Number.isFinite(source.time) || !Number.isFinite(source.weight) || source.weight < 0) throw new Error('Invalid locomotion source sample')
            if (source.weight === 0) continue
            sampleSequencePoseNode(rig, clip, source.time, source.loop, clip.node)
            nodes.push(clip.node)
            weights.push(source.weight)
            total += source.weight
          }
          if (Math.abs(total - 1) > 1e-5) throw new Error('Consumer locomotion weights must sum to one')
          blendPoseNodesTogether(nodes, weights, state.pose)
          for (const [name, value] of Object.entries(sample.curves ?? {})) {
            if (!Number.isFinite(value)) throw new Error(`Invalid locomotion curve: ${name}`)
            state.pose.curves.set(name, value)
          }
          for (const [name, value] of Object.entries(sample.layeringCurves ?? {})) {
            if (!Number.isFinite(value)) throw new Error(`Invalid layering curve: ${name}`)
          }
          state.previous = sample
        }
        const original = state.definition.stance === 'Standing' ? standing : crouching
        if (state.weight > 0 && state.previous) {
          blendTwoPoseNodesTogether(state.pose, original, state.weight, state.output)
          copyPose(state.output.pose, original.pose)
          original.curves.clear()
          for (const [name, value] of state.output.curves) original.curves.set(name, value)
        }
        const effectiveWeight = state.weight * stanceWeights[state.definition.stance]
        if (effectiveWeight > 0) {
          for (const [name, value] of Object.entries(state.previous?.layeringCurves ?? {})) {
            const blend = layeringCurves.get(name) ?? { weight: 0, value: 0 }
            blend.weight += effectiveWeight
            blend.value += value * effectiveWeight
            layeringCurves.set(name, blend)
          }
        }
        state.definition.onSample?.(state.weight > 0 ? state.previous : null, state.weight * stanceWeights[state.definition.stance])
        state.definition.onPose?.({ rig, source: state.weight > 0 && state.previous ? state.pose : null, linked: original, effectiveWeight: state.weight * stanceWeights[state.definition.stance] })
      }
    },
  }
}
