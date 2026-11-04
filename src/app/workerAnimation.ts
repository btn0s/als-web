import type { AnimationClip, Object3D } from 'three'
import { Vector3 } from 'three'
import type { AlsAnimationClock, AlsAnimationInstanceControls, AlsGetUpMontageNotifyEvent } from '../als/AlsAnimationInstance'
import type { ConsumerOverlayStates } from '../als/AnimGraph/consumerOverlayStates'
import type { AlsControlRigFootOffsetTrace } from '../als/AnimGraph/CR_Als'
import type { AlsGroundPredictionCapsuleSweep } from '../als/State/AlsInAirState'
import type { AlsMantlingSettings } from '../als/Settings/AlsMantlingSettings'
import { ALS_GETTING_UP_MONTAGES } from '../als/AnimGraph/gettingUp'
import { createAlsRagdollPose } from '../engine/alsRagdollPose'
import { applyPose, createPoseApplicator, trackPoseGeneration } from '../engine/applyPose'
import { createPoseBuffer } from '../engine/poseBuffer'
import { createRigDefinition } from '../engine/rig'
import { ALS_VIRTUAL_BONES } from '../als/Utility/AlsVirtualBones'
import { connectAnimationWorker } from '../engine/worker/animationWorkerPool'
import { serializeAnimationAssets } from '../engine/worker/animationMessages'
import type { AnimationCommand, AnimationFrame, AnimationResult } from '../engine/worker/animationMessages'

const assetCache = new WeakMap<readonly AnimationClip[], Map<string, ReturnType<typeof serializeAnimationAssets>>>()
/** Main-thread presentation owns publication and rigid-body physics, never graph evaluation. */
export function createWorkerAnimation(scene: Object3D, animations: AnimationClip[], overlayStates: ConsumerOverlayStates | undefined,
  trace: AlsControlRigFootOffsetTrace, prediction: AlsGroundPredictionCapsuleSweep) {
  const rig = createRigDefinition(scene, ALS_VIRTUAL_BONES), applicator = createPoseApplicator(scene, rig)
  const pose = createPoseBuffer(rig.boneCount), latestPose = createPoseBuffer(rig.boneCount)
  latestPose.positions.set(rig.referencePositions); latestPose.rotations.set(rig.referenceRotations); latestPose.scales.set(rig.referenceScales)
  const ragdolling = createAlsRagdollPose(scene, animations)
  trackPoseGeneration(scene)
  const clock = { elapsedSeconds: 0, updates: 0 }
  const commands: AnimationCommand[] = [], getUpEvents: AlsGetUpMontageNotifyEvent[] = []
  let connection: ReturnType<typeof connectAnimationWorker> | undefined
  let completed: AnimationResult | undefined, recycled: ArrayBuffer | undefined
  let sequence = 0, latestSnapshotGeneration = -1
  const traceState: Pick<AnimationFrame, 'feet' | 'prediction'> = { feet: {}, prediction: null }
  const start = new Vector3(), end = new Vector3()
  const key = (overlayStates?.clips.map(clip => clip.uuid).join(',') ?? '') + JSON.stringify(overlayStates?.states ?? [])
  let byOverlay = assetCache.get(animations)
  if (!byOverlay) assetCache.set(animations, byOverlay = new Map())
  let assets = byOverlay.get(key)
  if (!assets) { assets = serializeAnimationAssets(scene, animations, overlayStates?.clips, overlayStates?.states); byOverlay.set(key, assets) }
  const command = (value: AnimationCommand) => commands.push(value)
  return {
    clock: clock as Readonly<AlsAnimationClock>, ragdolling,
    connect() {
      connection = connectAnimationWorker(assets!, result => {
        // Keep only the newest completed publication. No shared mutable pose buffer crosses threads.
        if (completed) recycled = completed.data.buffer as ArrayBuffer
        completed = result
      })
      return () => { connection?.dispose(); connection = undefined; completed = undefined; recycled = undefined }
    },
    publish(delta: number, visible = true) {
      if (!completed) {
        // Physics publication stays current even while the next animation result is in flight.
        pose.data.set(latestPose.data)
        ragdolling.applyPhysics(pose); if (visible) applyPose(applicator, pose)
        return
      }
      const result = completed; completed = undefined
      latestPose.data.set(result.data)
      pose.data.set(latestPose.data)
      ragdolling.applyPhysics(pose)
      if (visible) applyPose(applicator, pose)
      Object.assign(clock, result.clock); getUpEvents.push(...result.getUpEvents)
      for (const query of result.feet) {
        const hit = trace({ side: query.side, start: start.fromArray(query.start), end: end.fromArray(query.end), traceChannel: 'Visibility', ignoreOwningActor: true })
        traceState.feet[query.side] = hit ? { impactPoint: hit.impactPoint.toArray(), impactNormal: hit.impactNormal.toArray() } : null
      }
      if (result.prediction) traceState.prediction = prediction(result.prediction)
      recycled = result.data.buffer as ArrayBuffer
      void delta
    },
    refresh(delta: number, controls: AlsAnimationInstanceControls, _capture = false, evaluate = true) {
      if (!connection) return
      ragdolling.prepareSnapshot()
      const snapshot = ragdolling.state.FinalRagdollPose
      const changedSnapshot = snapshot && ragdolling.snapshotGeneration !== latestSnapshotGeneration ? snapshot.data : undefined
      if (changedSnapshot) latestSnapshotGeneration = ragdolling.snapshotGeneration
      connection.submit({ sequence: sequence++, delta, evaluate, controls,
        commands: commands.splice(0), montage: overlayStates?.sampleMontage?.() ?? null,
        matrixWorld: scene.matrixWorld.toArray(), feet: traceState.feet, prediction: traceState.prediction,
        ragdoll: { active: ragdolling.active, velocity: ragdolling.velocity, snapshot: changedSnapshot }, buffer: recycled })
      recycled = undefined
    },
    jump: () => command({ kind: 'jump' }),
    StopMontages: (duration: number) => command({ kind: 'stop', duration }),
    getUpMontage: {
      Montage_Play(montage: string) { command({ kind: 'getUp', montage }); return Object.values(ALS_GETTING_UP_MONTAGES).find(value => value.Name === montage)?.SequenceLength ?? 0 },
      takeNotifyEvents: () => getUpEvents.splice(0),
    },
    setRollingPosition: (position: number) => command({ kind: 'rollPosition', position }),
    rollingMontage: { Montage_Play(montage: string, playRate: number) { command({ kind: 'roll', montage, playRate }) } },
    mantlingMontage: {
      play(settings: AlsMantlingSettings, startTime: number) { command({ kind: 'mantle', settings: settings.Name, startTime }) },
      montageSetPosition: (settings: AlsMantlingSettings, position: number) => command({ kind: 'mantlePosition', settings: settings.Name, position }),
      montageStop: (settings: AlsMantlingSettings, duration: number) => command({ kind: 'mantleStop', settings: settings.Name, duration }),
    },
  }
}
