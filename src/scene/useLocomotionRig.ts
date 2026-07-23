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
import { LEVA_ROOTS } from './levaRoots'

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
    /** Dev/test hook: play a named source clip solo, or pass null to resume the weight table. */
    __playClip?: (name: string | null) => boolean
    /** `__triggerJump` is intentionally deferred until the jump system lands in M3. */
  }
}

export function useLocomotionRig(gltf: { animations: THREE.AnimationClip[]; scene: THREE.Object3D }, mixer: THREE.AnimationMixer) {
  const [{ speed }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      speed: { value: 0, min: 0, max: 4.5, step: 0.05, label: 'speed (m/s)' },
    }),
    { order: 1 },
  )
  const speedRef = useRef(speed)
  speedRef.current = speed

  useEffect(() => {
    window.__setSpeed = (v: number) => setControls({ speed: v })
    return () => { delete window.__setSpeed }
  }, [setControls])

  const rig = useMemo(() => {
    const byName = new Map(gltf.animations.map((c) => [c.name, c]))
    const actionsByName = new Map(
      gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]),
    )
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
    const baseActions = new Set([
      ...Object.values(roles),
      ...overlays.map((overlay) => overlay.action),
    ])
    return {
      actionsByName,
      baseActions,
      roles,
      overlays,
      complete: Boolean(roles.idle && roles.walkFwd && roles.jogFwd),
    }
  }, [gltf.animations, mixer])

  useEffect(() => {
    for (const action of rig.baseActions) {
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.setEffectiveWeight(0)
      action.play()
    }
    return () => rig.baseActions.forEach((action) => action.stop())
  }, [rig])

  const soloClip = useRef<string | null>(null)
  const soloAction = useRef<THREE.AnimationAction | null>(null)
  const preSoloWeights = useRef<Map<THREE.AnimationAction, number> | null>(null)

  useEffect(() => {
    window.__playClip = (name: string | null) => {
      if (name === null) {
        soloClip.current = null
        if (soloAction.current && !rig.baseActions.has(soloAction.current)) {
          soloAction.current.stop()
        }
        soloAction.current = null
        if (preSoloWeights.current) {
          for (const [action, weight] of preSoloWeights.current) {
            action.setEffectiveWeight(weight)
          }
          preSoloWeights.current = null
        }
        return true
      }

      const nextSoloAction = rig.actionsByName.get(name)
      if (!nextSoloAction) {
        console.warn(`[Animation] Unknown clip "${name}"`)
        return false
      }

      if (!preSoloWeights.current) {
        preSoloWeights.current = new Map(
          [...rig.actionsByName.values()].map((action) => [
            action,
            action.getEffectiveWeight(),
          ]),
        )
      }
      if (soloAction.current && !rig.baseActions.has(soloAction.current)) {
        soloAction.current.stop()
      }
      soloClip.current = name
      soloAction.current = nextSoloAction
      nextSoloAction.reset()
        .setLoop(THREE.LoopRepeat, Infinity)
        .setEffectiveWeight(1)
        .play()
      return true
    }

    return () => {
      delete window.__playClip
      soloClip.current = null
      if (soloAction.current && !rig.baseActions.has(soloAction.current)) {
        soloAction.current.stop()
      }
      soloAction.current = null
      preSoloWeights.current = null
    }
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
    const soloName = soloClip.current
    if (soloName) {
      for (const action of rig.actionsByName.values()) {
        action.setEffectiveWeight(action === rig.actionsByName.get(soloName) ? 1 : 0)
      }
      for (const overlay of rig.overlays) {
        overlay.action.setEffectiveWeight(0)
      }
      window.__weightTable = { [soloName]: 1 }
      return
    }

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
