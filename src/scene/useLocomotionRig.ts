import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { updateLocomotionTargets, STAND } from '../player/blendspace'
import { evaluateRegionOverlays, REGION_OVERLAY_RULES } from '../player/regionOverlays'
import type { OverlayContext } from '../player/regionOverlays'
import { REGION_PREDICATES } from '../player/trackMask'
import { filterClipToBones } from '../player/trackMask'
import { computeWeightTable, createWeightTable } from '../player/weightTable'
import type { WeightTableInput } from '../player/weightTable'

/**
 * M1 applier: the pure weight table drives the mixer (the frame loop is an APPLIER, not a graph —
 * see weightTable.ts). Scope is the transplant PROOF: stand gaits (idle/walk/jog by a Leva speed)
 * under `computeWeightTable`, plus the shipped region rule as a masked overlay. Crouch/crawl/
 * jump/montage inputs are wired but held at rest until their systems land (M3).
 *
 * Gait speeds are PLACEHOLDERS until locomotionProfile re-measures them from this pack (M2) —
 * they only shape the Leva slider's crossfade points, not movement (nothing translates yet).
 * Phase-locking (shared footfall phase; updateLocomotionPhase) also waits for measured strides.
 */
const GAIT_SPEEDS = { walk: 1.75, jog: 3.5 }
const CLIP_ROLES = {
  idle: 'A_Als_Idle',
  walkFwd: 'A_Als_Walk_Forward',
  jogFwd: 'A_Als_Run_Forward',
} as const
/** Exponential damp rate (1/s) for gait shares — spring state lives here, with the frame loop. */
const DAMP_RATE = 8

declare global {
  interface Window {
    /** Dev/test hook: last frame's applied clip weights by role (+ overlay rule ids). */
    __weightTable?: Record<string, number>
    /** Dev/test hook: override the Leva speed input (m/s) — the M1 slice of `__triggerJump`-style
     * hooks (playtests stay live in the browser; hooks exist so gates can drive the rig). */
    __setSpeed?: (speed: number) => void
  }
}

export function useLocomotionRig(gltf: { animations: THREE.AnimationClip[]; scene: THREE.Object3D }, mixer: THREE.AnimationMixer) {
  const [{ speed }, setControls] = useControls('Movement', () => ({
    speed: { value: 0, min: 0, max: 4.5, step: 0.05, label: 'speed (m/s)' },
  }))
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    window.__setSpeed = (v: number) => setControls({ speed: v })
    return () => { delete window.__setSpeed }
  }, [setControls])

  const rig = useMemo(() => {
    const byName = new Map(gltf.animations.map((c) => [c.name, c]))
    const roles: Partial<Record<keyof typeof CLIP_ROLES, THREE.AnimationAction>> = {}
    for (const [role, clipName] of Object.entries(CLIP_ROLES) as [keyof typeof CLIP_ROLES, string][]) {
      const clip = byName.get(clipName)
      if (clip) roles[role] = mixer.clipAction(clip)
    }
    const overlays = REGION_OVERLAY_RULES.flatMap((rule) => {
      const clip = byName.get(rule.clip)
      if (!clip) return []
      return [{ rule, action: mixer.clipAction(filterClipToBones(clip, REGION_PREDICATES[rule.region])) }]
    })
    return { roles, overlays, complete: Boolean(roles.idle && roles.walkFwd && roles.jogFwd) }
  }, [gltf.animations, mixer])

  useEffect(() => {
    const actions = [...Object.values(rig.roles), ...rig.overlays.map((o) => o.action)]
    for (const action of actions) {
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.setEffectiveWeight(0)
      action.play()
    }
    return () => actions.forEach((a) => a.stop())
  }, [rig])

  const standTargets = useRef([1, 0, 0])
  const standWeights = useRef([1, 0, 0])
  const table = useRef(createWeightTable())
  const overlayOut = useRef(REGION_OVERLAY_RULES.map(() => 0))
  const input = useRef<WeightTableInput>({
    standWeights: standWeights.current,
    crouchMoveWeight: 0, posture: 0, crawlBlend: 0, crawlMoveWeight: 0, tuckCrawl: 0,
    jumpBlend: 0, montageGate: 0, windup: 0, movementAngle: 0, crouchTint: 0,
  })

  useFrame((_, delta) => {
    if (!rig.complete) return
    updateLocomotionTargets(speedRef.current, standTargets.current, GAIT_SPEEDS, 0)
    const k = 1 - Math.exp(-DAMP_RATE * delta)
    for (let i = 0; i < 3; i++)
      standWeights.current[i] += (standTargets.current[i] - standWeights.current[i]) * k

    const t = computeWeightTable(input.current, table.current)
    rig.roles.idle?.setEffectiveWeight(t.idle)
    rig.roles.walkFwd?.setEffectiveWeight(t.walkFwd)
    rig.roles.jogFwd?.setEffectiveWeight(t.jogFwd)

    const ctx: OverlayContext = {
      idleShare: standWeights.current[STAND.IDLE],
      walkShare: standWeights.current[STAND.WALK],
      jogShare: standWeights.current[STAND.JOG],
      sneak: 0, posture: 0, crawlBlend: 0, jumpBlend: 0,
    }
    evaluateRegionOverlays(
      rig.overlays.map((o) => o.rule),
      ctx,
      { stance: t.stanceAlpha, airborne: t.jumpArms },
      overlayOut.current,
    )
    rig.overlays.forEach((o, i) => o.action.setEffectiveWeight(overlayOut.current[i]))

    window.__weightTable = {
      idle: t.idle, walkFwd: t.walkFwd, jogFwd: t.jogFwd, stanceAlpha: t.stanceAlpha,
      ...Object.fromEntries(rig.overlays.map((o, i) => [o.rule.id, overlayOut.current[i]])),
    }
  })

  return rig.complete
}
