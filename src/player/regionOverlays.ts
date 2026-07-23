import type { RegionName } from './trackMask';

/**
 * Declarative region-overlay layer — the ALS-style "per-state, per-body-region animation layer"
 * as DATA. Each rule pins one clip, masked to one region, whose weight is a pure function of the
 * frame's blend state. Want "jog shows more crouch arms"? That's a one-line rule, not a new
 * constant threaded through the weight table.
 *
 * Contract (enforced by the applier in Operative.tsx):
 *  - Rules are OVERLAYS: extra normal-blend weight stacked over the full-coverage base layer.
 *    PropertyMixer normalizes, so a rule at weight v over a ~1-weight base shows the base at
 *    1/(1+v) on that region — dominance units, same math as the stance overlays. Rules can never
 *    cause bind-pose bleed (only base UNDER-coverage does; rules only add).
 *  - Every rule's weight is scaled by the frame's stanceAlpha, so montages/jumps/crawl fade the
 *    overlay with the base it rides on and the damping RATIO holds.
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
  jogShare: number;
  /** Sneak blend 0..1 (slow-walk mode, upright, grounded, moving). */
  sneak: number;
  /** Crouch posture 0..1 (damped). */
  posture: number;
  /** Crawl stance blend 0..1 (damped). */
  crawlBlend: number;
  /** 0 grounded .. 1 airborne (damped). */
  jumpBlend: number;
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
   *  - 'stance' (default): the grounded locomotion base (stanceAlpha). Correct for gait
   *    overlays (sneak arms, jog arms) — but ~0 while airborne.
   *  - 'airborne': the jump-split arms base (jumpBlend-scaled). Correct for in-air overlays —
   *    a 'stance' rule gated on jumpBlend would multiply jumpBlend x (1 - jumpBlend) and peak
   *    at a useless 0.3 mid-crossfade, zero at the apex (the frame-dump-diagnosed arms-down bug).
   */
  ride?: 'stance' | 'airborne';
  /** Dominance-unit weight for this frame; applier multiplies by stanceAlpha. Keep it pure. */
  weight: (ctx: OverlayContext) => number;
}

/**
 * The shipped rule set. Editing THIS ARRAY is how the layering changes — add a rule per ask
 * ("more X on region Y during Z"), delete rules that stop earning their keep.
 */
export const REGION_OVERLAY_RULES: RegionOverlayRule[] = [
  {
    // M1 transplant proof rule (the exposure-r3f rule set stays in that repo as reference —
    // rules are per-project data, re-pointed at this pack's clips): the sprint's pumping arm
    // cycle bleeds over the run's arms as the jog share rises, reading as building urgency
    // before sprint becomes its own gait (M3). 0.6 dominance ≈ 37% sprint arms at full jog.
    id: 'jog-sprint-arms',
    clip: 'A_Als_Sprint',
    region: 'armsNoFingers',
    phaseLock: false,
    weight: (c) => c.jogShare * 0.6,
  },
];

/** Per-frame base alphas a rule can ride (see RegionOverlayRule.ride). */
export interface OverlayAlphas {
  /** Grounded locomotion base (weightTable's stanceAlpha). */
  stance: number;
  /** Airborne jump-split arms base (weightTable's jumpArms weight). */
  airborne: number;
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
    const alpha = rules[i].ride === 'airborne' ? alphas.airborne : alphas.stance;
    out[i] = Math.max(0, rules[i].weight(ctx)) * alpha;
  }
  return out;
}
