import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** Increment `token` to (re)fire `clip`, including the same clip twice in a row. */
export interface SlotMontageRequest {
  clip: string
  token: number
}

/** Damp rate (1/s) for the single complementary montage gate. */
const MONTAGE_GATE_DAMP = 14
const GATE_EPSILON = 0.0001

function releaseAction(mixer: THREE.AnimationMixer, action: THREE.AnimationAction) {
  action.stop()
  mixer.uncacheAction(action.getClip(), action.getRoot())
}

/**
 * Full-body slot montage shared by the player and practice dummy.
 *
 * `gate` is the only montage weight controller: the active action receives `gate` every frame,
 * while callers multiply every base-layer weight by `baseWeight = 1 - gate`. The action never
 * uses AnimationAction fadeIn/fadeOut, so the two sides remain exactly complementary.
 */
export function useSlotMontage(
  actions: Record<string, THREE.AnimationAction | null>,
  mixer: THREE.AnimationMixer,
  request: SlotMontageRequest | undefined,
) {
  const lastToken = useRef(request?.token ?? 0)
  const active = useRef<THREE.AnimationAction | null>(null)
  const gate = useRef(0)
  const gateTarget = useRef(0)
  // True once the active action has been driven by the external clock (see update below). A
  // scrubbed action is PAUSED, so the 'finished' listener can never close its gate — completion
  // is owned by the clock instead, including the clock's DISAPPEARANCE.
  const externallyClocked = useRef(false)

  useEffect(() => {
    if (!request || request.token === lastToken.current) return
    lastToken.current = request.token
    const source = actions[request.clip]
    if (!source) {
      console.warn(`[slotMontage] no action found for clip "${request.clip}"`)
      return
    }

    if (active.current) releaseAction(mixer, active.current)
    // A cloned clip produces an independent mixer action even when the requested source is also
    // a live base action (notably Jump_Loop). That keeps the gate as this action's sole controller.
    const action = mixer.clipAction(source.getClip().clone(), source.getRoot())
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveWeight(gate.current)
    action.play()
    active.current = action
    externallyClocked.current = false
    gateTarget.current = 1
  }, [actions, mixer, request])

  useEffect(() => {
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== active.current) return
      gateTarget.current = 0
    }
    mixer.addEventListener('finished', onFinished)
    return () => {
      mixer.removeEventListener('finished', onFinished)
      if (active.current) {
        releaseAction(mixer, active.current)
        active.current = null
      }
    }
  }, [mixer])

  return {
    gate,
    /**
     * Advance and apply the sole montage weight source. Call once per frame.
     *
     * TD 0.3 — optional EXTERNAL CLOCK: pass `progress01` (the arbiter's published
     * `actionProgress`) while a body-warping action owns the montage, and the clip's playhead is
     * SCRUBBED to it (paused, time = progress x duration) instead of free-running on mixer time —
     * pose and capsule warp share one normalized clock, so a duration mismatch between the tuned
     * warp and the clip's native length can no longer desync them (the clip stretches/compresses
     * to the warp window). Progress >= 1 closes the gate — the 'finished' event never fires for a
     * paused action, so the external clock also owns completion. Omit `progress01` (sandbox
     * one-shots, wall-kick) and native-rate playback + the 'finished' listener behave as before;
     * `reset()` on the next fire clears the paused flag either way.
     */
    update(dt: number, progress01?: number) {
      const a = active.current
      if (a && progress01 !== undefined) {
        externallyClocked.current = true
        const duration = a.getClip().duration
        a.paused = true
        a.time = Math.min(Math.max(progress01, 0) * duration, duration - 1e-4)
        if (progress01 >= 1) gateTarget.current = 0
      } else if (a && externallyClocked.current) {
        // The external clock vanished before we ever sampled progress >= 1 — the owning action
        // can complete and publish its exit in the same frame its progress would have read 1.0,
        // so a scrubbed montage might never observe the final tick. A disappeared clock on a
        // still-active scrubbed montage IS completion: close the gate (the paused action's
        // 'finished' event can never do it). Without this, the montage clamps its last scrubbed
        // frame at full weight forever — the "frozen mid-stride after a mantle" bug.
        gateTarget.current = 0
      }
      gate.current = THREE.MathUtils.damp(gate.current, gateTarget.current, MONTAGE_GATE_DAMP, dt)
      if (gateTarget.current === 0 && gate.current < GATE_EPSILON) {
        gate.current = 0
        if (active.current) {
          releaseAction(mixer, active.current)
          active.current = null
        }
      }
      active.current?.setEffectiveWeight(gate.current)
    },
  }
}
