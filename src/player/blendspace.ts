/**
 * Pure locomotion blendspace math.
 *
 * Ported from `../exposure-demo/src/animation/blendspace.ts` — only the "stand" (gait) blend
 * pieces. The reference also blends a directional sub-space (forward/back/left/right), but the
 * UAL1 rig only ships forward locomotion clips (`Idle/Walk/Jog_Fwd/Sprint/Crouch_Idle/Crouch_Fwd`),
 * so that half is intentionally dropped: the character always plays forward locomotion and the
 * player controller yaws it to face its movement direction.
 *
 * Crucially, there are NO magic speed/cadence numbers here. The gait `speeds` (crossfade
 * breakpoints) and `strides` (metres per cycle) are passed in from the locomotion profile — both
 * measured from the model's baked root motion (see `locomotionProfile.ts`). Movement speed and
 * animation playback therefore derive from the same source and stay foot-locked at any speed.
 *
 * Kept framework-free (no `three` import) so it stays Vitest-testable in isolation.
 */

const clampf = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Below this speed (m/s) the player is treated as standing still (a tiny deadzone, not a gait). */
export const IDLE_EPS = 0.05;

/** Index layout shared by `standTargets` / `standWeights` arrays (length 3). */
export const STAND = { IDLE: 0, WALK: 1, JOG: 2 } as const;

/** Authored ground speed (m/s) of each stand gait — the blendspace crossfade breakpoints. */
export interface GaitSpeeds {
  walk: number;
  jog: number;
}

/** Authored stride (m/cycle) of each moving gait — used to foot-lock playback cadence. */
export interface GaitStrides {
  walk: number;
  jog: number;
  crouchWalk: number;
}

/**
 * Fills `standTargets` (length-3: idle/walk/jog) with target blend weights for the given measured
 * speed, crossfading so each gait is pure exactly at its authored speed (jog is the top gait, so
 * speeds above it clamp to pure jog). Returns the target crouch-move weight (0 = crouch idle,
 * 1 = full crouch-walk, reached at crouch-walk speed).
 */
export function updateLocomotionTargets(
  speed: number,
  standTargets: number[],
  speeds: GaitSpeeds,
  crouchWalkSpeed: number,
  jogBlendMax = 1,
): number {
  standTargets.fill(0);
  const { walk, jog } = speeds;

  if (speed <= IDLE_EPS) {
    standTargets[STAND.IDLE] = 1;
  } else if (speed < walk) {
    const t = clampf(speed / walk, 0, 1);
    standTargets[STAND.IDLE] = 1 - t;
    standTargets[STAND.WALK] = t;
  } else {
    // Jog band. `jogBlendMax` caps how "pure" the jog clip ever gets — below 1 it keeps a fraction of
    // the walk clip mixed in even at full jog speed, toning down an over-animated jog without changing
    // movement speed (this only shifts ANIMATION weights). 1 = pure jog at top speed (original).
    const t = clampf((speed - walk) / (jog - walk), 0, 1);
    const jogW = t * jogBlendMax;
    standTargets[STAND.WALK] = 1 - jogW;
    standTargets[STAND.JOG] = jogW;
  }

  return crouchWalkSpeed > 0 ? clampf(speed / crouchWalkSpeed, 0, 1) : 0;
}

/**
 * Advances the shared locomotion phase (0..1, wraps) that keeps footfalls in sync across the
 * blended gait clips. Cadence (cycles/sec) is `groundSpeed / strideLength`, so a planted foot
 * moves exactly with the ground at ANY speed — no sliding, and never the "authored 1× regardless
 * of movement" that made walk look slow. The effective stride is the weight-blend of the active
 * gaits, cross-faded between stand and crouch by `posture`, then into crawl by `crawlBlend`.
 * Phase freezes while stationary.
 *
 * The trailing crawl arguments deliberately default to zero so the pre-TD-2.2 Operative call
 * remains source-compatible until wave 2 wires the measured clip stride in. That integration is
 * one call-site addition after `crawlFwd` has been resolved:
 *
 * `..., strides, crawlFwd ? measureGait(crawlFwd.getClip()).stride : 0,
 * crawlMoveWeight.current, crawlBlend.current)`
 *
 * `crawlMoveWeight` belongs in the stride blend for the same reason `crouchMoveWeight` does: an
 * idle clip contributes no travelling cycle. Crawl ground speed (currently crouch-walk speed ×
 * Player's 0.5 multiplier) remains a controller/call-site concern; this pure cadence seam needs
 * only the measured metres-per-cycle stride and the already-computed blend weights.
 */
export function advanceLocomotionPhase(
  phase: number,
  dt: number,
  speed: number,
  standWeights: number[],
  crouchMoveWeight: number,
  posture: number,
  strides: GaitStrides,
  crawlStride = 0,
  crawlMoveWeight = 0,
  crawlBlend = 0,
): number {
  const standStride =
    standWeights[STAND.WALK] * strides.walk + standWeights[STAND.JOG] * strides.jog;
  const crouchStride = crouchMoveWeight * strides.crouchWalk;
  const uprightStride = lerp(standStride, crouchStride, posture);
  const effectiveCrawlStride = crawlMoveWeight * crawlStride;
  const effStride = lerp(uprightStride, effectiveCrawlStride, crawlBlend);

  const cadence = effStride > 1e-4 ? speed / effStride : 0;
  return speed > IDLE_EPS ? (phase + dt * cadence) % 1 : phase;
}
