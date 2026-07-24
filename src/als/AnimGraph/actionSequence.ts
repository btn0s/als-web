/**
 * Pure, framework-free timing primitive for "animation + timing + synced world action" — the shape
 * every anticipation/traversal move shares: run for some duration, expose `progress` (0..1)
 * for an animation layer to render (see scrubbedPose.ts), and fire gameplay/physics actions at
 * normalized phases (the jump impulse at progress 1; a mantle's body-warp reads progress each frame;
 * a roll's i-frames could toggle at 0.2..0.7; a strike's hitbox at 0.4). Consumers own WHAT fires;
 * this owns WHEN.
 *
 * No `three` / React import so it stays Vitest-testable in isolation (see actionSequence.test.ts).
 * The owner drives it: `start()` on trigger, `update(dt)` each frame, `cancel()` to abort.
 */

/** A world/physics action fired once, when `progress` first reaches `at` (normalized 0..1). */
export interface SequenceCue {
  at: number
  fire: () => void
}

export interface ActionSequenceConfig {
  /** Duration in seconds. A function is resolved at each `start()`, so live-tuned values (e.g. a
   * Leva action time) take effect on the next trigger. <= 0 completes instantly on the first update. */
  duration: number | (() => number)
  /** World actions fired at normalized times as the sequence plays. */
  cues?: SequenceCue[]
  /** Fired once when progress reaches 1 (after any cue at 1). */
  onComplete?: () => void
  /** Fired if `cancel()` is called while active (before completion). */
  onCancel?: () => void
}

export interface ActionSequence {
  /** Whether a run is in progress. */
  readonly active: boolean;
  /** Current normalized playhead, 0..1. Holds its last value when inactive. */
  readonly progress: number;
  /** Begin (or restart) the sequence: resolves duration, resets progress and fired cues. */
  start(): void;
  /** Abort without firing remaining cues or onComplete; fires onCancel if it was active. */
  cancel(): void;
  /** Advance by `dt` seconds, firing crossed cues then onComplete. No-op when inactive. */
  update(dt: number): void;
}

export function createActionSequence(config: ActionSequenceConfig): ActionSequence {
  // Sorted ascending so cues crossed within a single `update` fire in playhead order, not array order.
  const cues = [...(config.cues ?? [])].sort((a, b) => a.at - b.at);
  let active = false;
  let progress = 0;
  let elapsed = 0;
  let duration = 0;
  const fired = new Set<SequenceCue>();

  const resolveDuration = () =>
    typeof config.duration === 'function' ? config.duration() : config.duration;

  return {
    get active() {
      return active;
    },
    get progress() {
      return progress;
    },
    start() {
      active = true;
      elapsed = 0;
      progress = 0;
      duration = resolveDuration();
      fired.clear();
    },
    cancel() {
      if (!active) return;
      active = false;
      config.onCancel?.();
    },
    update(dt: number) {
      if (!active) return;
      elapsed += dt;
      progress = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
      // Fire any cue the playhead has reached (ascending `at`), each at most once.
      for (const cue of cues) {
        if (!fired.has(cue) && progress >= cue.at) {
          fired.add(cue);
          cue.fire();
        }
      }
      if (progress >= 1) {
        active = false;
        config.onComplete?.();
      }
    },
  };
}
