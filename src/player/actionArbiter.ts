import { createActionSequence } from './actionSequence';
import type { ActionSequence, SequenceCue } from './actionSequence';

/**
 * What an action is allowed to do to the gameplay body. The arbiter deliberately does not execute
 * motion itself: Player owns Rapier/geometry, while this framework-free policy says which consumer
 * is entitled to drive the body. Future paired actions can extend this union without teaching the
 * animation clock about Three or Rapier.
 */
export type BodyMotionPolicy =
  | 'none'
  | 'impulse'
  | 'kinematic-hold'
  | 'kinematic-warp';

/** Whether a later request may replace this action before it completes or is explicitly cancelled. */
export type ActionInterruptPolicy = 'interruptible' | 'uninterruptible';

export type ActionExitReason = 'completed' | 'cancelled' | 'interrupted';

/**
 * Declarative ownership record. `duration: Infinity` is the intentional representation for a
 * stateful action (a hang, cover, interrogation hold, etc.) that exits only by cancel/interruption.
 * Finite timing and cues are delegated to ActionSequence rather than reimplemented here.
 */
export interface ActionRecord<Kind extends string = string> {
  kind: Kind;
  /** Animation clip selected by this action, or null when the pose comes from the base graph/IK. */
  clip: string | null;
  duration: number | (() => number);
  bodyMotion: BodyMotionPolicy;
  interrupt: ActionInterruptPolicy;
  cues?: readonly SequenceCue[];
  onEnter?: () => void;
  /** Runs exactly once for every accepted request, regardless of how the action exits. */
  onExit?: (reason: ActionExitReason) => void;
}

/** The accepted record plus its authoritative normalized playhead. */
export interface ActiveAction<Kind extends string = string> extends ActionRecord<Kind> {
  readonly progress: number;
}

export interface ActionArbiter<Kind extends string = string> {
  /** The sole current owner, or null. */
  readonly active: ActiveAction<Kind> | null;
  /** Convenience view of the active owner's normalized playhead; 0 while idle. */
  readonly progress: number;
  /** Accept a request, interrupting the current owner only when its policy permits it. */
  request(action: ActionRecord<Kind>): boolean;
  /** Explicitly abort the active action. No-op when idle. */
  cancel(): boolean;
  /** Explicitly finish the active action. No-op when idle. */
  complete(): boolean;
  /**
   * Advance the current ActionSequence. Returns the action that was advanced even when this update
   * completed it, so the body-motion consumer can apply the terminal progress=1 pose this frame.
   */
  update(dt: number): ActiveAction<Kind> | null;
}

interface ActionRun<Kind extends string> {
  view: ActiveAction<Kind>;
  sequence: ActionSequence;
  exited: boolean;
}

const normalized = (progress: number) =>
  Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;

export function createActionArbiter<Kind extends string = string>(): ActionArbiter<Kind> {
  let current: ActionRun<Kind> | null = null;

  /**
   * Mark-before-callback is the exactly-once guarantee. It also makes exit callbacks re-entrant:
   * cleanup may synchronously request another action without the old owner still appearing active.
   */
  const exit = (run: ActionRun<Kind>, reason: ActionExitReason) => {
    if (run.exited) return false;
    run.exited = true;
    if (current === run) current = null;

    // Manual completion and interruption must also stop the underlying sequence. Its onCancel
    // loops back here, but `exited` turns that second path into a harmless no-op.
    if (run.sequence.active) run.sequence.cancel();
    run.view.onExit?.(reason);
    return true;
  };

  const arbiter: ActionArbiter<Kind> = {
    get active() {
      return current?.view ?? null;
    },
    get progress() {
      return current?.view.progress ?? 0;
    },
    request(action) {
      if (current) {
        if (current.view.interrupt === 'uninterruptible') return false;
        exit(current, 'interrupted');
        // Cleanup is intentionally allowed to synchronously hand ownership to a recovery/fallback
        // action. Do not orphan that accepted run by overwriting it with the outer request.
        if (current) return false;
      }

      let sequence!: ActionSequence;
      const run = {
        exited: false,
        get sequence() {
          return sequence;
        },
        view: {
          ...action,
          get progress() {
            return normalized(sequence.progress);
          },
        },
      } as ActionRun<Kind>;

      sequence = createActionSequence({
        duration: action.duration,
        cues: action.cues ? [...action.cues] : undefined,
        onComplete: () => exit(run, 'completed'),
        onCancel: () => exit(run, 'cancelled'),
      });
      current = run;
      sequence.start();
      try {
        action.onEnter?.();
      } catch (error) {
        // An accepted action must not strand ownership when setup fails. Its cleanup still owns the
        // rollback, and the original setup error remains the one the caller sees.
        exit(run, 'cancelled');
        throw error;
      }
      return true;
    },
    cancel() {
      return current ? exit(current, 'cancelled') : false;
    },
    complete() {
      return current ? exit(current, 'completed') : false;
    },
    update(dt) {
      const run = current;
      if (!run) return null;
      // A negative/NaN render delta must never publish progress outside 0..1. ActionSequence retains
      // ownership of ordinary elapsed-time behavior; this is only an input-boundary guard.
      run.sequence.update(Number.isFinite(dt) ? Math.max(0, dt) : 0);
      return run.view;
    },
  };

  return arbiter;
}
