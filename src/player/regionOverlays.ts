import type { RegionName } from './trackMask';

/**
 * Declarative region-overlay layer — the ALS-style "per-state, per-body-region animation layer"
 * as DATA. Each rule pins one clip, masked to one region, whose weight is a pure function of the
 * frame's blend state. Want "run shows more crouch arms"? That's a one-line rule, not a new
 * constant threaded through the weight table.
 *
 * Contract (enforced by the pose-buffer applier):
 *  - Rules are OVERLAYS: extra normal-blend weight stacked over the full-coverage base layer.
 *    The pose accumulator normalizes, so a rule at weight v over a ~1-weight base shows the base at
 *    1/(1+v) on that region — dominance units, same math as the stance overlays. Rules can never
 *    cause bind-pose bleed (only base UNDER-coverage does; rules only add).
 *  - Every rule's weight is scaled by the frame's groundedAmount or inAirAmount, so montages and
 *    locomotion-mode changes fade the overlay with the base it rides on and the damping RATIO holds.
 *  - `phaseLock: true` rides the shared locomotion phase (footfall-synced clips, e.g. a moving
 *    gait's arms); `false` plays on its own mixer clock (idles/holds).
 *
 * The `weight` functions read damped signals — no need to re-damp inside a rule.
 */

/** Damped per-frame blend signals available to rule weight functions. Extend as rules need. */
export interface OverlayContext {
  /** Stand-gait shares (damped, sum ~1). */
  idleShare: number;
  walkShare: number;
  runShare: number;
  sprintShare: number;
  /** ALS pose-state stance blend: 0 = Standing, 1 = Crouching. */
  crouchingAmount: number;
  /** ALS pose-state locomotion-mode blend: 0 = Grounded, 1 = InAir. */
  inAirAmount: number;
}

export interface RegionOverlayRule {
  /** Stable id (debug display, per-rule tuning later). */
  id: string;
  /** Source clip name (any clip in the merged animation set). */
  clip: string;
  /** Body region the clip is masked to (see trackMask.REGION_PREDICATES). */
  region: RegionName;
  /** Ride the shared locomotion footfall phase instead of free-running mixer time. */
  phaseLock: boolean;
  /**
   * Freeze the clip at this normalized playhead (0..1) and blend the HELD POSE instead of the
   * moving clip — for mining a single pose out of a longer clip (e.g. Celebration's hands-up
   * apex as the airborne reach). Mutually exclusive with phaseLock.
   */
  holdAt?: number;
  /**
   * Which base layer this overlay rides — its weight scales with THAT base's alpha so the
   * dominance ratio holds as the base fades:
   *  - 'grounded' (default): the grounded locomotion base. Correct for gait overlays.
   *  - 'inAir': the jump-split arms base. Correct for in-air overlays.
   */
  ride?: 'grounded' | 'inAir';
  /** Dominance-unit weight for this frame; applier multiplies by the selected base amount. */
  weight: (ctx: OverlayContext) => number;
}

/**
 * The shipped rule set. Editing THIS ARRAY is how the layering changes — add a rule per ask
 * ("more X on region Y during Z"), delete rules that stop earning their keep.
 */
export const REGION_OVERLAY_RULES: RegionOverlayRule[] = [
  {
    // Sprint is now a full gait. The old permanent "sprint arms over run" look is only useful in
    // the run↔sprint crossfade, so the cross-term is zero at either pure endpoint and peaks at
    // 0.6 dominance in the middle of the hand-off.
    id: 'run-sprint-arms',
    clip: 'A_Als_Sprint',
    region: 'armsNoFingers',
    phaseLock: true,
    weight: (c) => Math.min(1, 4 * c.runShare * c.sprintShare) * 0.6,
  },
];

/** Per-frame base alphas a rule can ride (see RegionOverlayRule.ride). */
export interface OverlayAlphas {
  /** Grounded locomotion base (weightTable's groundedAmount). */
  groundedAmount: number;
  /** Airborne jump-split arms base (weightTable's jumpArms weight). */
  inAirAmount: number;
}

/**
 * Evaluates every rule's weight for this frame's context into `out` (index-aligned with `rules`,
 * reused — zero allocation). Values are clamped at 0; each rule's ride alpha is applied here so
 * the applier just copies numbers onto actions.
 */
export function evaluateRegionOverlays(
  rules: readonly RegionOverlayRule[],
  ctx: OverlayContext,
  alphas: OverlayAlphas,
  out: number[],
): number[] {
  for (let i = 0; i < rules.length; i++) {
    const alpha = rules[i].ride === 'inAir' ? alphas.inAirAmount : alphas.groundedAmount;
    out[i] = Math.max(0, rules[i].weight(ctx)) * alpha;
  }
  return out;
}
