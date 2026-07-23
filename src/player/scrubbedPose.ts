import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

export interface ScrubbedPose {
  /**
   * Hold the clip at playhead `t01` (0..1 across its duration — pass 1→0 to run it in reverse) and
   * blend it over the base pose at `weight`. Call every frame from a `useFrame`; a no-op if the clip
   * was missing from the rig. Weight is in the same space as any other action weight, so scale it by
   * your base-suppression factor (e.g. `1 - montageGate`) at the call site.
   */
  set(t01: number, weight: number): void
}

const NOOP: ScrubbedPose = { set() {} }

/**
 * Reusable time-scrubbed pose. Turns any clip into a frozen action whose playhead and weight you
 * drive by hand each frame — the general form of "hold a clip at an authored frame and blend it in":
 * anticipation preloads (jump windup = Jump_Land reversed), landing recovery, aim in/out, turn-in-
 * place, ledge reaches. Consumers just call `set(t01, weight)`; nobody re-implements the action
 * plumbing.
 *
 * The action is PAUSED (so the mixer never advances it — the playhead is authoritative) and set to
 * LoopRepeat rather than LoopOnce, so parking the playhead at the very end can't trip LoopOnce's
 * finish/disable path (the bug that made the first, one-off jump preload silently stop contributing).
 * The clip is cloned so this action is independent of any base action playing the same clip.
 *
 * Must be called unconditionally (hooks rules). In single-clip/debug mode where `animations` is fine
 * but nothing drives it, the action just sits at weight 0 — inert.
 */
export function useScrubbedPose(
  mixer: THREE.AnimationMixer,
  animations: THREE.AnimationClip[],
  clipName: string,
): ScrubbedPose {
  const clip = useMemo(() => {
    const src = animations.find((c) => c.name === clipName)
    return src ? src.clone() : null
  }, [animations, clipName])

  const actionRef = useRef<THREE.AnimationAction | null>(null)
  const durationRef = useRef(0)

  useEffect(() => {
    if (!clip) return
    const a = mixer.clipAction(clip)
    a.setLoop(THREE.LoopRepeat, Infinity)
    a.play()
    a.paused = true // playhead is authoritative — the mixer must not advance it
    a.setEffectiveWeight(0)
    actionRef.current = a
    durationRef.current = clip.duration
    return () => {
      a.stop()
      mixer.uncacheClip(clip)
      actionRef.current = null
    }
  }, [mixer, clip])

  // Stable handle; reads the live action/duration refs so it never goes stale across re-creates.
  return useMemo<ScrubbedPose>(() => {
    if (!clip) return NOOP
    return {
      set(t01, weight) {
        const a = actionRef.current
        if (!a) return
        a.setEffectiveWeight(weight)
        // Clamp just shy of the end so t01===1 can't wrap the LoopRepeat playhead back to frame 0.
        a.time = Math.min(THREE.MathUtils.clamp(t01, 0, 1) * durationRef.current, durationRef.current - 1e-4)
      },
    }
  }, [clip])
}
