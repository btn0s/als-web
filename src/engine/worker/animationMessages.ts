import type { ConsumerLocomotionSample, ConsumerLocomotionState } from '../../als/AnimGraph/consumerLocomotionStates'
import type { AnimationClip, Object3D } from 'three'
import type { AlsAnimationInstanceControls, AlsGetUpMontageNotifyEvent } from '../../als/AlsAnimationInstance'
import type { ConsumerOverlayState, ConsumerUpperBodyMontage } from '../../als/AnimGraph/consumerOverlayStates'
import type { AlsControlRigFootSide } from '../../als/AnimGraph/CR_Als'
import type { AlsGroundPredictionSweepQuery, AlsGroundPredictionSweepHitInput } from '../../als/State/AlsInAirState'

type ClipJson = ReturnType<typeof AnimationClip.toJSON>
type SerializedClip = Omit<ClipJson, 'tracks'> & { tracks: (Omit<ClipJson['tracks'][number], 'times' | 'values'> & {
  times: Float32Array; values: Float32Array
})[] }
export interface AnimationAssets {
  key: string
  nodes: { name: string; bone: boolean; parent: number; position: number[]; rotation: number[]; scale: number[] }[]
  clips: SerializedClip[]
  overlayClipNames: string[]
  locomotion?: { clipNames: string[]; states: Omit<ConsumerLocomotionState, 'sample' | 'onSample' | 'onPose'>[] }
  states: readonly ConsumerOverlayState[]
}
export type FootQuery = { side: AlsControlRigFootSide; start: number[]; end: number[] }
export type FootHit = { impactPoint: number[]; impactNormal: number[] } | null
export type AnimationCommand =
  | { kind: 'jump' | 'teleport' }
  | { kind: 'stop'; duration: number }
  | { kind: 'getUp'; montage: string }
  | { kind: 'roll'; montage: string; playRate: number }
  | { kind: 'rollPosition'; position: number }
  | { kind: 'mantle'; settings: string; startTime: number }
  | { kind: 'mantlePosition'; settings: string; position: number }
  | { kind: 'mantleStop'; settings: string; duration: number }
export interface AnimationFrame {
  id: number
  sequence: number
  delta: number
  evaluate: boolean
  controls: AlsAnimationInstanceControls
  commands: AnimationCommand[]
  locomotionSamples?: (ConsumerLocomotionSample | null)[]
  montage: ConsumerUpperBodyMontage | null
  matrixWorld: number[]
  feet: Partial<Record<AlsControlRigFootSide, FootHit>>
  prediction: AlsGroundPredictionSweepHitInput | null
  ragdoll: { active: boolean; velocity: { x: number; y: number; z: number }; snapshot?: Float32Array }
  buffer?: ArrayBuffer
}
export interface AnimationResult {
  kind: 'pose'
  id: number
  sequence: number
  data: Float32Array
  curves: [string, number][]
  clock: { elapsedSeconds: number; updates: number }
  feet: FootQuery[]
  prediction?: AlsGroundPredictionSweepQuery
  getUpEvents: readonly AlsGetUpMontageNotifyEvent[]
}
export type AnimationRequest =
  | { kind: 'create'; id: number; assetKey: string; assets?: AnimationAssets }
  | { kind: 'dispose'; id: number }
  | { kind: 'frame'; frame: AnimationFrame }
export type AnimationReply = AnimationResult | { kind: 'error'; id: number; message: string }

/** Skeleton hierarchy only: animation workers never clone geometry, materials or textures. */
export function serializeAnimationAssets(scene: Object3D, clips: readonly AnimationClip[],
  overlayClips: readonly AnimationClip[] = [], states: readonly ConsumerOverlayState[] = []): AnimationAssets {
  const nodes: Object3D[] = []
  scene.traverse(node => {
    if (node.type === 'Bone' && node.userData.alsVirtualBone !== true) {
      const ancestors: Object3D[] = []
      for (let current: Object3D | null = node; current && !nodes.includes(current); current = current.parent) ancestors.push(current)
      nodes.push(...ancestors.reverse())
    }
  })
  const channels = new WeakMap<Float32Array, Float32Array>()
  const pack = (source: Float32Array) => {
    let owned = channels.get(source)
    if (!owned) { owned = source.slice(); channels.set(source, owned) }
    return owned
  }
  return {
    key: clips.map(clip => clip.uuid).join(',') + ':' + overlayClips.map(clip => clip.uuid).join(',') + ':' + JSON.stringify(states),
    nodes: nodes.map(node => ({ name: node.name, bone: node.type === 'Bone', parent: nodes.indexOf(node.parent!),
      position: node.position.toArray(), rotation: node.quaternion.toArray(), scale: node.scale.toArray() })),
    clips: [...clips, ...overlayClips].map(clip => {
      const serialized = clip.toJSON()
      // Structured clone preserves typed storage. Avoid expanding every key into JS numbers
      // once per worker. Own the views: GLTF tracks can point into the entire asset buffer,
      // and structured clone would otherwise copy geometry and images along with the keys.
      return { ...serialized, tracks: serialized.tracks.map((track, index) => ({ ...track,
        times: pack(clip.tracks[index].times), values: pack(clip.tracks[index].values),
      })) }
    }),
    overlayClipNames: overlayClips.map(clip => clip.name), states,
  }
}
