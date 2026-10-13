import type { AnimationClip } from 'three'
import { compileClipSampler } from '../../engine/clipSampler'
import { compileClipCurveSamplers } from '../../engine/curves'
import type { CompiledWeightBlendProfile } from '../../engine/blendProfile'
import type { RigDefinition } from '../../engine/rig'
import type { SlotMontageSample } from '../../engine/slotMontage'
import { ALS_OVERLAY_MODES } from './overlayMode'
import { createAlsRifleRuntime, evaluateAlsRifleGraph, refreshAlsRifleRuntime, resetAlsRifleRuntime, type AlsRifleFullInput } from './AB_Als_Rifle'
import { createAlsPistolRuntime, evaluateAlsPistolGraph, refreshAlsPistolRuntime, resetAlsPistolRuntime } from './AB_Als_PistolTwoHanded'

/** Each registration is a linked layer with its own state machines and authored sources.
 * Templates reuse ALS topology, never another mode's evaluated pose or runtime state.
 * Pose-bank times and aim-reference frames follow the selected authored template. */
export interface ConsumerOverlayState {
  readonly mode: string
  readonly template: 'Rifle' | 'PistolTwoHanded'
  readonly sources: {
    readonly poses: string
    readonly aim: string
    readonly aimCrouch: string
    readonly aimReference: string
    readonly runArms?: string
    readonly sprintArms?: string
    readonly sprintImpulseArms?: string
    readonly idle?: string
    readonly idleReference?: string
  }
}

export interface ConsumerUpperBodyMontage {
  readonly id: string
  readonly clip: string
  readonly time: number
  readonly playRate: number
  readonly blendIn?: number
  readonly blendOut?: number
}

export interface ConsumerOverlayStates {
  readonly clips: readonly AnimationClip[]
  readonly states: readonly ConsumerOverlayState[]
  sampleMontage?(): ConsumerUpperBodyMontage | null
  onMontageSamples?(samples: readonly SlotMontageSample[]): void
}

export function createConsumerOverlayStates(
  rig: RigDefinition,
  animations: readonly AnimationClip[],
  registration?: ConsumerOverlayStates,
  profile?: CompiledWeightBlendProfile | null,
) {
  const clips = new Map([...animations, ...(registration?.clips ?? [])].map(clip => [clip.name, clip]))
  const source = (name: string) => {
    const clip = clips.get(name)
    if (!clip) throw new Error(`Missing consumer overlay sequence: ${name}`)
    return { sampler: compileClipSampler(clip, rig), curves: compileClipCurveSamplers(clip) }
  }
  const player = (name: string) => ({ ...source(name), time: 0, loop: true })
  const create = (state: ConsumerOverlayState) => {
    const s = state.sources
    const shared = {
      poses: source(s.poses), aim: source(s.aim), aimCrouch: source(s.aimCrouch),
      aimReference: source(s.aimReference), idle: player(s.idle ?? 'A_Als_Idle'),
      idleReference: source(s.idleReference ?? 'A_Als_Stand_Pose'),
    }
    // Consumers supply absolute sampled aim poses. Native graphs derive the mesh additive
    // against the consumer's reference bank, with the same virtual-bone sampling as ALS.
    if (state.template === 'PistolTwoHanded') {
      const runtime = createAlsPistolRuntime(rig, profile)
      return {
        runtime, template: state.template,
        reset: () => resetAlsPistolRuntime(runtime),
        update: (input: AlsRifleFullInput) => { refreshAlsPistolRuntime(runtime, input) },
        setTime(_phase: number, idleTime: number) { shared.idle.time = idleTime },
        evaluate: (input: AlsRifleFullInput) => evaluateAlsPistolGraph(runtime, input, shared),
      }
    }
    if (!s.runArms || !s.sprintArms || !s.sprintImpulseArms) {
      throw new Error(`Missing movement sequences for consumer overlay ${state.mode}`)
    }
    const sources = { ...shared, runArms: player(s.runArms), sprintArms: player(s.sprintArms), sprintImpulseArms: player(s.sprintImpulseArms) }
    const runtime = createAlsRifleRuntime(rig, profile)
    return {
      runtime, template: state.template,
      reset: () => resetAlsRifleRuntime(runtime),
      update: (input: AlsRifleFullInput) => { refreshAlsRifleRuntime(runtime, input) },
      setTime(phase: number, idleTime: number) {
        shared.idle.time = idleTime
        for (const p of [sources.runArms, sources.sprintArms, sources.sprintImpulseArms]) {
          p.time = phase * p.sampler.clip.duration
        }
      },
      evaluate: (input: AlsRifleFullInput) => evaluateAlsRifleGraph(runtime, input, sources),
    }
  }
  const states = new Map<string, ReturnType<typeof create>>()
  for (const state of registration?.states ?? []) {
    if (!state.mode || ALS_OVERLAY_MODES.some(mode => mode === state.mode) || states.has(state.mode)) {
      throw new Error(`Duplicate or reserved overlay mode: ${state.mode}`)
    }
    states.set(state.mode, create(state))
  }
  return states
}
