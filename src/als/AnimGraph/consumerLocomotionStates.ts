import { Quaternion, type AnimationClip } from 'three'
import type { AlsAnimationInstanceControls } from '../AlsAnimationInstance'
import { compileClipSampler } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import { blendPoseInPlace } from '../../engine/blend'
import { copyPose } from '../../engine/poseBuffer'
import type { LocalPoseBuffer } from '../../engine/poseBuffer'
import type { RigDefinition } from '../../engine/rig'
import { compileAuthoredRootMotion } from '../../engine/rootMotion'
import { createMutableUePoseNode, sampleSequencePoseNode } from '../../engine/uePoseGraph'
import { blendPoseNodesTogether, blendTwoPoseNodesTogether } from '../../engine/uePoseBlend'
import type { MutableUePoseNode } from '../../engine/uePoseBlend'

export interface ConsumerLocomotionSample {
  /** Ordered legacy channels: full base, then shortest-path spherical overlays. */
  readonly composition?: 'sequential-slerp'
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
  /** Opt-in phase-authored locks; native moving unlock remains the default. */
  readonly allowMovingFootLock?: boolean
  /** Own the Default overlay's idle additive at this state's effective pose weight. */
  readonly suppressDefaultIdle?: boolean
  /** Own the overlay template pose before region action slots, using effective stance weight. */
  readonly ownOverlayPose?: boolean
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
  /** The consumer supplies both complete ground graphs; null retains its last pose, never ALS. */
  readonly exclusive?: boolean
  readonly clips: readonly AnimationClip[]
  readonly states: readonly ConsumerLocomotionState[]
  /** Borrowed component-stage inputs/outputs, captured synchronously without changing evaluation. */
  onEvaluatePose?(snapshot: {
    readonly stage: 'layering-reference' | 'overlay-input' | 'layering-input' | 'layering-output' | 'view-output' | 'control-rig-input' | 'control-rig-output'
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
    effectiveWeight: number
    previous: ConsumerLocomotionSample | null
    pose: MutableUePoseNode
    output: MutableUePoseNode
  }>()
  for (const definition of registration?.states ?? []) {
    if (states.has(definition.stance)) throw new Error(`Duplicate locomotion stance: ${definition.stance}`)
    if (!Number.isFinite(definition.blendDuration) || definition.blendDuration < 0) throw new Error('Invalid locomotion blend duration')
    states.set(definition.stance, { definition, weight: 0, effectiveWeight: 0, previous: null, pose: createMutableUePoseNode(rig.boneCount), output: createMutableUePoseNode(rig.boneCount) })
  }
  if (registration?.exclusive && (!states.has('Standing') || !states.has('Crouching'))) throw new Error('Exclusive locomotion requires both stance graphs')
  const rotationA = new Quaternion()
  const rotationB = new Quaternion()
  const layeringCurves = new Map<string, { weight: number; value: number }>()
  return {
    applyOverlayPose(reference: LocalPoseBuffer, overlay: LocalPoseBuffer, output: LocalPoseBuffer) {
      if (output === reference || output === overlay) throw new Error('Consumer overlay scratch must not alias its inputs')
      const owned = [...states.values()].reduce((sum, state) => sum + (state.definition.ownOverlayPose ? state.effectiveWeight : 0), 0)
      copyPose(overlay, output)
      blendPoseInPlace(output, reference, Math.max(0, Math.min(1, owned)))
    },
    defaultIdleAdditiveScale() {
      const owned = [...states.values()].reduce((sum, state) => sum + (state.definition.suppressDefaultIdle ? state.effectiveWeight : 0), 0)
      return 1 - Math.max(0, Math.min(1, owned))
    },
    allowsMovingFootLock() {
      return [...states.values()].some(state => state.definition.allowMovingFootLock && state.effectiveWeight >= 1 - 1e-5)
    },
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
        state.weight = registration?.exclusive ? 1 : state.weight + Math.max(-step, Math.min(step, target - state.weight))
        if (sample) {
          const nodes: MutableUePoseNode[] = []
          const weights: number[] = []
          const names = new Set<string>()
          let total = 0
          for (const source of sample.sources) {
            const clip = clips.get(source.clip)
            if (!clip) throw new Error(`Missing consumer locomotion sequence: ${source.clip}`)
            if (!sample.composition && names.has(source.clip)) throw new Error(`Duplicate locomotion sample: ${source.clip}`)
            names.add(source.clip)
            if (!Number.isFinite(source.time) || !Number.isFinite(source.weight) || source.weight < 0) throw new Error('Invalid locomotion source sample')
            if (source.weight === 0) continue
            sampleSequencePoseNode(rig, clip, source.time, source.loop, clip.node)
            if (sample.composition === 'sequential-slerp') {
              if (nodes.length === 0) {
                if (source.weight !== 1) throw new Error('Sequential locomotion requires a full-weight base')
                copyPose(clip.node.pose, state.pose.pose)
                state.pose.curves.clear()
                for (const [name, value] of clip.node.curves) state.pose.curves.set(name, value)
              } else {
                const alpha = Math.min(1, source.weight)
                for (let i = 0; i < state.pose.pose.positions.length; i++) {
                  state.pose.pose.positions[i] += (clip.node.pose.positions[i] - state.pose.pose.positions[i]) * alpha
                  state.pose.pose.scales[i] += (clip.node.pose.scales[i] - state.pose.pose.scales[i]) * alpha
                }
                for (let i = 0; i < state.pose.pose.rotations.length; i += 4) {
                  rotationA.fromArray(state.pose.pose.rotations, i).slerp(rotationB.fromArray(clip.node.pose.rotations, i), alpha).normalize().toArray(state.pose.pose.rotations, i)
                }
                for (const name of new Set([...state.pose.curves.keys(), ...clip.node.curves.keys()])) {
                  const previous = state.pose.curves.get(name) ?? 0
                  state.pose.curves.set(name, previous + ((clip.node.curves.get(name) ?? 0) - previous) * alpha)
                }
              }
            }
            nodes.push(clip.node)
            weights.push(source.weight)
            total += source.weight
          }
          if (!sample.composition && Math.abs(total - 1) > 1e-5) throw new Error('Consumer locomotion weights must sum to one')
          if (!sample.composition) blendPoseNodesTogether(nodes, weights, state.pose)
          else if (!nodes.length) throw new Error('Sequential locomotion requires a base')
          for (const [name, value] of Object.entries(sample.curves ?? {})) {
            if (!Number.isFinite(value)) throw new Error(`Invalid locomotion curve: ${name}`)
            state.pose.curves.set(name, value)
          }
          for (const [name, value] of Object.entries(sample.layeringCurves ?? {})) {
            if (!Number.isFinite(value)) throw new Error(`Invalid layering curve: ${name}`)
          }
          state.previous = sample
        }
        if (registration?.exclusive && !state.previous) throw new Error('Exclusive locomotion requires an initial source pose')
        const original = state.definition.stance === 'Standing' ? standing : crouching
        if (state.weight > 0 && state.previous) {
          blendTwoPoseNodesTogether(state.pose, original, state.weight, state.output)
          copyPose(state.output.pose, original.pose)
          original.curves.clear()
          for (const [name, value] of state.output.curves) original.curves.set(name, value)
        }
        const effectiveWeight = state.weight * stanceWeights[state.definition.stance]
        state.effectiveWeight = effectiveWeight
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
