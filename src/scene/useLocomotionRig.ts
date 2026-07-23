import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { pickClip } from '../anim/pickClip'
import { updateLocomotionTargets, STAND } from '../player/blendspace'
import { ALS_AUTHORED_GAIT_SPEEDS } from '../player/locomotionProfile'
import { applyPose, createPoseApplicator } from '../player/pose/applyPose'
import { compileBoneMask } from '../player/pose/blend'
import { compileClipSampler } from '../player/pose/clipSampler'
import type { CompiledClipSampler } from '../player/pose/clipSampler'
import { createPoseEvaluator, evaluatePose } from '../player/pose/evaluator'
import type {
  EvaluatePoseInput,
  EvaluatorLayerEntry,
} from '../player/pose/evaluator'
import { createRigDefinition } from '../player/pose/rig'
import { createRootMotionExtractor, resetRootMotionExtractor } from '../player/pose/rootMotion'
import type { RootMotionExtractor } from '../player/pose/rootMotion'
import { evaluateRegionOverlays, REGION_OVERLAY_RULES } from '../player/regionOverlays'
import type { OverlayContext, RegionOverlayRule } from '../player/regionOverlays'
import { REGION_PREDICATES } from '../player/trackMask'
import { computeWeightTable, createWeightTable } from '../player/weightTable'
import type { WeightTableInput } from '../player/weightTable'
import { LEVA_ROOTS } from './levaRoots'

const GAIT_SPEEDS = {
  walk: ALS_AUTHORED_GAIT_SPEEDS.standing.walk,
  jog: ALS_AUTHORED_GAIT_SPEEDS.standing.run,
}
const CLIP_ROLES = {
  idle: 'A_Als_Idle',
  walkFwd: 'A_Als_Walk_Forward',
  jogFwd: 'A_Als_Run_Forward',
} as const
type ClipRole = keyof typeof CLIP_ROLES
const DAMP_RATE = 8

interface RuntimeClip {
  readonly sampler: CompiledClipSampler
  readonly entry: EvaluatorLayerEntry
  time: number
}

interface RuntimeOverlay {
  readonly rule: RegionOverlayRule
  readonly clip: RuntimeClip
  readonly entry: EvaluatorLayerEntry
}

declare global {
  interface Window {
    /** Dev/test hook: last frame's applied clip weights by role (+ overlay rule ids). */
    __weightTable?: Record<string, number>
    /** Dev/test hook: override the Leva speed input (m/s). */
    __setSpeed?: (speed: number) => void
    /** Dev/test hook: play a named source clip solo, or pass null to resume the weight table. */
    __playClip?: (name: string | null) => boolean
  }
}

function createEntry(sampler: CompiledClipSampler): EvaluatorLayerEntry {
  return { sampler, time: 0, weight: 0, loop: true }
}

function advanceClip(clip: RuntimeClip, delta: number) {
  const duration = clip.sampler.clip.duration
  clip.time = duration > 0 ? (clip.time + delta) % duration : 0
}

/**
 * Owns sampling, pose-space composition, and the sole skeleton write for the character. The pure
 * weight table and region rules remain the graph; this hook only translates their outputs into
 * evaluator entries.
 */
export function useLocomotionRig(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
}) {
  const [{ speed }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      speed: {
        value: 0,
        min: 0,
        max: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
        step: 0.05,
        label: 'speed (m/s)',
      },
    }),
    { order: 1 },
  )
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    window.__setSpeed = (value: number) => setControls({ speed: value })
    return () => { delete window.__setSpeed }
  }, [setControls])

  const runtime = useMemo(() => {
    const rig = createRigDefinition(gltf.scene)
    const applicator = createPoseApplicator(gltf.scene, rig)
    const evaluator = createPoseEvaluator(rig, { development: import.meta.env.DEV })
    const rootMotion: RootMotionExtractor | undefined =
      rig.boneCount > 0 ? createRootMotionExtractor(rig) : undefined
    const clips = gltf.animations.map((clip): RuntimeClip => {
      const sampler = compileClipSampler(clip, rig)
      return { sampler, entry: createEntry(sampler), time: 0 }
    })
    const clipsByName = new Map(clips.map((clip) => [clip.sampler.clip.name, clip]))
    const roles: Partial<Record<ClipRole, RuntimeClip>> = {}
    for (const [role, clipName] of Object.entries(CLIP_ROLES) as [ClipRole, string][]) {
      const clip = clipsByName.get(clipName)
      if (clip) roles[role] = clip
    }

    const baseEntries = Object.values(roles).map((clip) => clip.entry)
    const overlays = REGION_OVERLAY_RULES.flatMap((rule): RuntimeOverlay[] => {
      const clip = clipsByName.get(rule.clip)
      if (!clip) return []
      const entry = createEntry(clip.sampler)
      entry.mask = compileBoneMask(rig, REGION_PREDICATES[rule.region])
      return [{ rule, clip, entry }]
    })
    const fallbackSource = pickClip(gltf.animations)
    const fallbackClip = fallbackSource ? clipsByName.get(fallbackSource.name) : undefined
    const fallbackEntries = fallbackClip ? [fallbackClip.entry] : []
    const soloEntries: EvaluatorLayerEntry[] = fallbackClip ? [fallbackClip.entry] : []
    const overlayRules = overlays.map((overlay) => overlay.rule)
    const normalDebugWeights: Record<string, number> = {
      idle: 0,
      walkFwd: 0,
      jogFwd: 0,
      stanceAlpha: 0,
    }
    for (const overlay of overlays) normalDebugWeights[overlay.rule.id] = 0
    const soloDebugWeights = new Map(
      clips.map((clip) => [clip.sampler.clip.name, { [clip.sampler.clip.name]: 1 }]),
    )
    const complete = Boolean(
      rig.boneCount > 0 && roles.idle && roles.walkFwd && roles.jogFwd,
    )
    const mainInput: EvaluatePoseInput = {
      base: baseEntries,
      overlays: overlays.map((overlay) => overlay.entry),
      rootMotion,
    }
    const fallbackInput: EvaluatePoseInput = { base: fallbackEntries, rootMotion }
    const soloInput: EvaluatePoseInput = { base: soloEntries, rootMotion }

    return {
      rig,
      applicator,
      evaluator,
      rootMotion,
      clips,
      clipsByName,
      roles,
      overlays,
      overlayRules,
      fallbackClip,
      soloEntries,
      normalDebugWeights,
      soloDebugWeights,
      complete,
      mainInput,
      fallbackInput,
      soloInput,
    }
  }, [gltf.animations, gltf.scene])

  const soloClip = useRef<RuntimeClip | null>(null)
  useEffect(() => {
    window.__playClip = (name: string | null) => {
      if (name === null) {
        soloClip.current = null
        if (runtime.rootMotion) resetRootMotionExtractor(runtime.rootMotion)
        return true
      }
      const clip = runtime.clipsByName.get(name)
      if (!clip) {
        console.warn(`[Animation] Unknown clip "${name}"`)
        return false
      }
      clip.time = 0
      runtime.soloEntries[0] = clip.entry
      soloClip.current = clip
      if (runtime.rootMotion) resetRootMotionExtractor(runtime.rootMotion)
      return true
    }
    return () => {
      delete window.__playClip
      soloClip.current = null
    }
  }, [runtime])

  const standTargets = useRef([1, 0, 0])
  const standWeights = useRef([1, 0, 0])
  const table = useRef(createWeightTable())
  const overlayOut = useRef(REGION_OVERLAY_RULES.map(() => 0))
  const overlayContext = useRef<OverlayContext>({
    idleShare: 1,
    walkShare: 0,
    jogShare: 0,
    sneak: 0,
    posture: 0,
    crawlBlend: 0,
    jumpBlend: 0,
  })
  const overlayAlphas = useRef({ stance: 1, airborne: 0 })
  const input = useRef<WeightTableInput>({
    standWeights: standWeights.current,
    crouchMoveWeight: 0, posture: 0, crawlBlend: 0, crawlMoveWeight: 0, tuckCrawl: 0,
    jumpBlend: 0, montageGate: 0, windup: 0, movementAngle: 0, crouchTint: 0,
  })

  useFrame((_, delta) => {
    if (runtime.rig.boneCount === 0) return
    for (const clip of runtime.clips) advanceClip(clip, delta)

    const solo = soloClip.current
    if (solo) {
      solo.entry.time = solo.time
      solo.entry.weight = 1
      applyPose(runtime.applicator, evaluatePose(runtime.evaluator, runtime.soloInput).pose)
      window.__weightTable = runtime.soloDebugWeights.get(solo.sampler.clip.name)
      return
    }

    if (!runtime.complete) {
      const fallback = runtime.fallbackClip
      if (!fallback) return
      fallback.entry.time = fallback.time
      fallback.entry.weight = 1
      applyPose(runtime.applicator, evaluatePose(runtime.evaluator, runtime.fallbackInput).pose)
      window.__weightTable = runtime.soloDebugWeights.get(fallback.sampler.clip.name)
      return
    }

    updateLocomotionTargets(speedRef.current, standTargets.current, GAIT_SPEEDS, 0)
    const damping = 1 - Math.exp(-DAMP_RATE * delta)
    for (let i = 0; i < 3; i++) {
      standWeights.current[i] +=
        (standTargets.current[i] - standWeights.current[i]) * damping
    }

    const weights = computeWeightTable(input.current, table.current)
    if (runtime.roles.idle) {
      runtime.roles.idle.entry.time = runtime.roles.idle.time
      runtime.roles.idle.entry.weight = weights.idle
    }
    if (runtime.roles.walkFwd) {
      runtime.roles.walkFwd.entry.time = runtime.roles.walkFwd.time
      runtime.roles.walkFwd.entry.weight = weights.walkFwd
    }
    if (runtime.roles.jogFwd) {
      runtime.roles.jogFwd.entry.time = runtime.roles.jogFwd.time
      runtime.roles.jogFwd.entry.weight = weights.jogFwd
    }

    const context = overlayContext.current
    context.idleShare = standWeights.current[STAND.IDLE]
    context.walkShare = standWeights.current[STAND.WALK]
    context.jogShare = standWeights.current[STAND.JOG]
    overlayAlphas.current.stance = weights.stanceAlpha
    overlayAlphas.current.airborne = weights.jumpArms
    evaluateRegionOverlays(
      runtime.overlayRules,
      context,
      overlayAlphas.current,
      overlayOut.current,
    )
    for (let i = 0; i < runtime.overlays.length; i++) {
      const overlay = runtime.overlays[i]
      overlay.entry.time = overlay.rule.holdAt === undefined
        ? overlay.clip.time
        : overlay.clip.sampler.clip.duration * overlay.rule.holdAt
      overlay.entry.weight = overlayOut.current[i]
    }

    applyPose(runtime.applicator, evaluatePose(runtime.evaluator, runtime.mainInput).pose)
    runtime.normalDebugWeights.idle = weights.idle
    runtime.normalDebugWeights.walkFwd = weights.walkFwd
    runtime.normalDebugWeights.jogFwd = weights.jogFwd
    runtime.normalDebugWeights.stanceAlpha = weights.stanceAlpha
    for (let i = 0; i < runtime.overlays.length; i++) {
      runtime.normalDebugWeights[runtime.overlays[i].rule.id] = overlayOut.current[i]
    }
    window.__weightTable = runtime.normalDebugWeights
  })
}
