/**
 * Pure locomotion blendspace math.
 *
 * Gait breakpoints and strides come from ALS's authored movement settings through
 * `locomotionProfile.ts`; the clips are in-place, so root-motion measurement is not a valid
 * source. Directional distribution is a separate pure layer in `weightTable.ts`.
 *
 * Kept framework-free (no `three` import) so it stays Vitest-testable in isolation.
 */

const clampf = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Below this speed (m/s) the player is treated as standing still (a tiny deadzone, not a gait). */
export const IDLE_EPS = 0.05;

/** Index layout shared by `standTargets` / `standWeights` arrays (length 4). */
export const STAND = { IDLE: 0, WALK: 1, RUN: 2, SPRINT: 3 } as const;

/** Authored ground speed (m/s) of each stand gait — the blendspace crossfade breakpoints. */
export interface GaitSpeeds {
  walk: number;
  run: number;
  sprint: number;
}

/** Authored stride (m/cycle) of each moving gait — used to foot-lock playback cadence. */
export interface GaitStrides {
  walk: number;
  run: number;
  sprint: number;
  crouchWalk: number;
}

/**
 * Fills `standTargets` (length-4: idle/walk/run/sprint) with target weights for measured speed,
 * with every authored gait pure at its ALS movement speed. Returns the crouch idle→walk target.
 */
export function updateLocomotionTargets(
  speed: number,
  standTargets: number[],
  speeds: GaitSpeeds,
  crouchWalkSpeed: number,
): number {
  standTargets.fill(0);
  const { walk, run, sprint } = speeds;

  if (speed <= IDLE_EPS) {
    standTargets[STAND.IDLE] = 1;
  } else if (speed < walk) {
    const t = clampf(speed / walk, 0, 1);
    standTargets[STAND.IDLE] = 1 - t;
    standTargets[STAND.WALK] = t;
  } else if (speed < run) {
    const t = clampf((speed - walk) / (run - walk), 0, 1);
    standTargets[STAND.WALK] = 1 - t;
    standTargets[STAND.RUN] = t;
  } else {
    const t = clampf((speed - run) / (sprint - run), 0, 1);
    standTargets[STAND.RUN] = 1 - t;
    standTargets[STAND.SPRINT] = t;
  }

  return crouchWalkSpeed > 0 ? clampf(speed / crouchWalkSpeed, 0, 1) : 0;
}

/**
 * Advances the shared locomotion phase (0..1, wraps) that keeps footfalls in sync across the
 * blended gait clips. Cadence (cycles/sec) is `groundSpeed / strideLength`, so a planted foot
 * moves exactly with the ground at ANY speed — no sliding, and never the "authored 1× regardless
 * of movement" that made walk look slow. The effective stride is the weight-blend of the active
 * gaits, cross-faded between ALS's Standing and Crouching pose amounts. Phase freezes while
 * stationary.
 */
export function advanceLocomotionPhase(
  phase: number,
  dt: number,
  speed: number,
  standWeights: number[],
  crouchMoveWeight: number,
  crouchingAmount: number,
  strides: GaitStrides,
  poseGaitAmount?: number,
): number {
  let standStride =
    standWeights[STAND.WALK] * strides.walk
    + standWeights[STAND.RUN] * strides.run
    + standWeights[STAND.SPRINT] * strides.sprint;
  if (poseGaitAmount !== undefined) {
    // ALS PoseGait is 0 idle, 1 walk, 2 run, 3 sprint. These are the exact overlapping ramps from
    // RefreshPose; our constant strides replace UE's authored stride-blend curves at this seam.
    const walking = clampf(poseGaitAmount, 0, 1);
    const running = clampf(poseGaitAmount - 1, 0, 1);
    const sprinting = clampf(poseGaitAmount - 2, 0, 1);
    standStride = lerp(0, strides.walk, walking);
    standStride = lerp(standStride, strides.run, running);
    standStride = lerp(standStride, strides.sprint, sprinting);
  }
  const crouchStride = crouchMoveWeight * strides.crouchWalk;
  const effStride = lerp(standStride, crouchStride, crouchingAmount);

  const cadence = effStride > 1e-4 ? speed / effStride : 0;
  return speed > IDLE_EPS ? (phase + dt * cadence) % 1 : phase;
}
