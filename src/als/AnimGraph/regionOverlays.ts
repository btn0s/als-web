import type { RegionName } from '../Utility/AlsConstants';

/**
 * Declarative extension rules for non-OverlayMode state layers. ALS OverlayMode itself lives in
 * overlayMode.ts because its regions and alphas come directly from the active clip's Layer* curves.
 *
 * Contract (enforced by the pose-buffer applier):
 *  - Rules emit conventional non-negative layer alphas for the consumer to apply through a mask.
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
  /** Body region the clip is masked to (see Utility/AlsConstants.REGION_PREDICATES). */
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
 * No ad-hoc rules ship today. Add one only for a layer with no ALS OverlayMode analog.
 */
// The M1 run-sprint-arms transplant proof was superseded by OverlayMode Rifle's authored
// A_Als_Rifle_Run_Arms/A_Als_Rifle_Sprint_Arms linked-layer sources.
export const REGION_OVERLAY_RULES: RegionOverlayRule[] = [];

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
