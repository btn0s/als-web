import { AnimationClip, Bone, Group, Object3D, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createAlsAnimationInstance } from '../../als/AlsAnimationInstance'
import { ALS_MANTLING_SETTINGS } from '../../als/Settings/AlsMantlingSettings'
import type { ConsumerUpperBodyMontage } from '../../als/AnimGraph/consumerOverlayStates'
import type { AnimationAssets, AnimationFrame, AnimationRequest, AnimationResult, FootQuery } from './animationMessages'

function loadAssets(assets: AnimationAssets) {
  const scene = new Group()
  const nodes = assets.nodes.map(node => {
    const object = node.bone ? new Bone() : new Object3D()
    object.name = node.name
    object.position.fromArray(node.position); object.quaternion.fromArray(node.rotation); object.scale.fromArray(node.scale)
    return object
  })
  assets.nodes.forEach((node, index) => (node.parent < 0 ? scene : nodes[node.parent]).add(nodes[index]))
  return { scene, animations: assets.clips.map(clip => AnimationClip.parse({ ...clip, tracks: clip.tracks.map(track => ({ ...track,
    times: Array.from(track.times), values: Array.from(track.values),
  })) })), states: assets.states, overlayClipNames: assets.overlayClipNames }
}
const mantleSettings = (name: string) => Object.values(ALS_MANTLING_SETTINGS).find(settings => settings.Name === name)

/** Same evaluator and graph as standalone ALS; transport changes neither its math nor clocks. */
export function createAnimationWorkerRuntime() {
  const assets = new Map<string, ReturnType<typeof loadAssets>>()
  const actors = new Map<number, ReturnType<typeof createActor>>()
  function createActor(asset: ReturnType<typeof loadAssets>) {
    const scene = clone(asset.scene)
    let frame: AnimationFrame
    let montage: ConsumerUpperBodyMontage | null = null
    const feet: FootQuery[] = []
    let prediction: AnimationResult['prediction']
    const animation = createAlsAnimationInstance({ scene, animations: asset.animations, publishDiagnostics: false,
      overlayStates: { states: asset.states,
        clips: asset.animations.filter(clip => asset.overlayClipNames.includes(clip.name)),
        sampleMontage: () => montage },
      controlRigFootTrace: query => {
        feet.push({ side: query.side, start: query.start.toArray(), end: query.end.toArray() })
        const hit = frame.feet[query.side]
        return hit ? { impactPoint: new Vector3().fromArray(hit.impactPoint), impactNormal: new Vector3().fromArray(hit.impactNormal) } : null
      },
      groundPredictionSweep: query => { prediction = structuredClone(query); return frame.prediction },
    })
    return { animation, run(input: AnimationFrame): AnimationResult {
      frame = input; montage = input.montage; feet.length = 0; prediction = undefined
      scene.matrixWorld.fromArray(input.matrixWorld); scene.matrixWorldAutoUpdate = false
      for (const command of input.commands) {
        switch (command.kind) {
          case 'jump': animation.jump(); break
          case 'teleport': animation.MarkTeleported(); break
          case 'stop': animation.StopMontages(command.duration); break
          case 'getUp': animation.getUpMontage.Montage_Play(command.montage); break
          case 'roll': animation.rollingMontage.Montage_Play(command.montage, command.playRate); break
          case 'rollPosition': animation.setRollingPosition(command.position); break
          case 'mantle': { const settings = mantleSettings(command.settings); if (settings) animation.mantlingMontage.play(settings, command.startTime); break }
          case 'mantlePosition': { const settings = mantleSettings(command.settings); if (settings) animation.mantlingMontage.montageSetPosition(settings, command.position); break }
          case 'mantleStop': { const settings = mantleSettings(command.settings); if (settings) animation.mantlingMontage.montageStop(settings, command.duration); break }
        }
      }
      animation.ragdolling.active = input.ragdoll.active
      animation.ragdolling.velocity = input.ragdoll.velocity
      if (input.ragdoll.snapshot) animation.ragdolling.setSnapshot(input.ragdoll.snapshot)
      animation.refresh(input.delta, input.controls, false, input.evaluate)
      const pose = animation.inspectPose('final')
      const data = input.buffer?.byteLength === pose.pose.data.byteLength ? new Float32Array(input.buffer) : new Float32Array(pose.pose.data.length)
      data.set(pose.pose.data)
      const result: AnimationResult = { kind: 'pose', id: input.id, sequence: input.sequence, data,
        curves: [...pose.curves], clock: { ...animation.clock }, feet: feet.slice(), prediction,
        getUpEvents: animation.getUpMontage.takeNotifyEvents() }
      animation.mantlingMontage.takeNotifyEvents(); animation.rollingMontage.takeNotifyEvents()
      animation.rollingMontage.ConsumeExtractedRootMotion()
      animation.dispatchQueuedFootstepEffectsEvents(() => {}); animation.dispatchQueuedAnimEvents({ StartCameraShake: () => {} })
      return result
    } }
  }
  return {
    handle(message: AnimationRequest): AnimationResult | undefined {
      if (message.kind === 'create') {
        if (message.assets && !assets.has(message.assetKey)) assets.set(message.assetKey, loadAssets(message.assets))
        const asset = assets.get(message.assetKey)
        if (!asset) throw new Error(`Unknown animation asset ${message.assetKey}`)
        actors.set(message.id, createActor(asset)); return
      }
      if (message.kind === 'dispose') { actors.delete(message.id); return }
      const actor = actors.get(message.frame.id)
      if (!actor) throw new Error(`Unknown animation actor ${message.frame.id}`)
      return actor.run(message.frame)
    },
  }
}
