/**
 * Pure locomotion weight table — TD 1.1's extraction of the animation graph's soul.
 *
 * Everything the base locomotion layer plays each frame gets its effective weight from ONE
 * place: `computeWeightTable(input)`. The scene hook is only an APPLIER — it damps stateful blend
 * values, builds a `WeightTableInput`, and copies the table into pose-evaluator entries.
 *
 * The graph's invariants are testable here, independently from the pose-buffer applier:
 *
 *   REGION COVERAGE: the owned evaluator normalizes active per-bone weights instead of falling
 *   toward bind pose, but coverage remains a useful graph-description assertion. A montage
 *   supplies the complementary `montageGate` share, so `regionCoverage + montageGate >= ~1`.
 *
 *   Known, deliberate deviations (asserted in weightTable.test.ts rather than "fixed"):
 *   - Launch transient: while windup unloads and jumpBlend rises, coverage briefly EXCEEDS 1.
 *     The pose accumulator normalizes overweight, so the invariant is a floor, not an equality.
 *   - Tucked pipe crawl adds `baseWeight * tuckCrawl` of crawl-set weight while airborne — again
 *     overweight-by-design (see Operative's tuckCrawl doc).
 *   - FINGERS are deliberately under-covered during the jump: jumpArms is masked to the arm chain
 *     WITHOUT fingers so they relax toward the rig's rest hand in flight (see jumpSplitClips in
 *     Operative). Finger coverage is therefore NOT asserted.
 *
 * Framework-free (no three/React imports) so it stays Vitest-testable in isolation, matching
 * blendspace.ts / actionSequence.ts.
 */

import type { VelocityBlend } from './velocityBlend'

/** Damped/stateful blend values, computed by the frame loop (springs stay with their state). */
export interface WeightTableInput {
  /** [idle, walk, run, sprint] damped stand-gait weights (sum ~1, see blendspace.ts STAND). */
  standWeights: readonly number[];
  /** 0 = crouch idle, 1 = full crouch-walk (damped). */
  crouchMoveWeight: number;
  /** 0 = standing, 1 = crouched. */
  posture: number;
  /** Crawl stance blend, 0..1 (damped from stance === 'Crawling'). */
  crawlBlend: number;
  /** Crawl's own idle<->move split, 0..1 (damped). */
  crawlMoveWeight: number;
  /** Inverted pipe-tuck crawl, 0..1 (damped) — airborne crawl pose on the rod. */
  tuckCrawl: number;
  /** 0 grounded .. 1 airborne (damped). */
  jumpBlend: number;
  /** Slot-montage gate, 0..1 — every base weight scales by its complement (see slotMontage.ts). */
  montageGate: number;
  /** Jump-anticipation windup, 0..1 (damped) — drives the Jump_Land-reversed preload pose. */
  windup: number;
  /** ALS's damped actor-local Forward/Backward/Left/Right velocity blend. */
  velocityBlend: Readonly<VelocityBlend>;
  /**
   * Crouch tint, 0..1 (damped): shifts this fraction of the STAND gait share onto the crouch
   * counterpart clips (idle->crouch-idle, walk/run->crouch-walk) for a subtle hunched readiness
   * while sneaking/jogging. Tiny values (~0.1) read as posture flavor, not a stance change; the
   * crouch clips are phase-locked to the same footfall phase so the mix is slide-free.
   */
  crouchTint: number;
}

/** Effective weights for every base-layer action, by clip role. All values >= 0. */
export interface WeightTable {
  idle: number;
  walkFwd: number;
  walkBwd: number;
  walkLeftFwd: number;
  walkRightFwd: number;
  walkLeftBwd: number;
  walkRightBwd: number;
  runFwd: number;
  runBwd: number;
  runLeftFwd: number;
  runRightFwd: number;
  runLeftBwd: number;
  runRightBwd: number;
  sprint: number;
  crouchIdle: number;
  crouchFwd: number;
  crouchBwd: number;
  crouchLeftFwd: number;
  crouchRightFwd: number;
  crouchLeftBwd: number;
  crouchRightBwd: number;
  crawlIdle: number;
  crawlFwd: number;
  crawlBwd: number;
  crawlLeft: number;
  crawlRight: number;
  /** Jump_Loop masked to !arm bones (legs/torso/head) — see Operative's jumpSplitClips. */
  jumpBody: number;
  /** Idle masked to arm-chain-minus-fingers — the arms' airborne base. */
  jumpArms: number;
  /** Jump_Land-reversed windup preload (full-body scrubbed pose, see useScrubbedPose). */
  windupPose: number;
  /**
   * NOT a clip weight: the grounded-locomotion alpha (baseWeight x not-jump x not-crawl x
   * not-windup), exposed so the region-overlay layer (regionOverlays.ts) can scale its rule
   * weights by the same fade the base clips get — overlays ride the base, so they share its alpha.
   */
  stanceAlpha: number;
}

/** Allocation-free: callers reuse one table object per consumer (`createWeightTable()` once). */
export function createWeightTable(): WeightTable {
  return {
    idle: 0,
    walkFwd: 0, walkBwd: 0,
    walkLeftFwd: 0, walkRightFwd: 0, walkLeftBwd: 0, walkRightBwd: 0,
    runFwd: 0, runBwd: 0,
    runLeftFwd: 0, runRightFwd: 0, runLeftBwd: 0, runRightBwd: 0,
    sprint: 0,
    crouchIdle: 0,
    crouchFwd: 0, crouchBwd: 0,
    crouchLeftFwd: 0, crouchRightFwd: 0, crouchLeftBwd: 0, crouchRightBwd: 0,
    crawlIdle: 0,
    crawlFwd: 0, crawlBwd: 0, crawlLeft: 0, crawlRight: 0,
    jumpBody: 0,
    jumpArms: 0,
    windupPose: 0,
    stanceAlpha: 0,
  };
}

export interface SixDirectionWeights {
  forward: number
  backward: number
  leftForward: number
  rightForward: number
  leftBackward: number
  rightBackward: number
}

export function createSixDirectionWeights(): SixDirectionWeights {
  return {
    forward: 1,
    backward: 0,
    leftForward: 0,
    rightForward: 0,
    leftBackward: 0,
    rightBackward: 0,
  }
}

/**
 * Maps ALS's four cardinal channels onto this pack's six authored cycles. Matching longitudinal
 * and lateral shares coalesce into the authored diagonal (0.5 forward + 0.5 left becomes 100%
 * Left_Forward). Because the pack intentionally has no pure side cycles, a pure lateral channel
 * is split evenly across that side's forward/backward diagonals. This preserves both a real
 * authored diagonal at 45° and a centered lateral silhouette at 90°.
 */
export function mapVelocityBlendToSixDirections(
  blend: Readonly<VelocityBlend>,
  out: SixDirectionWeights = createSixDirectionWeights(),
): SixDirectionWeights {
  const rawForward = Math.max(0, blend.forward)
  const rawBackward = Math.max(0, blend.backward)
  const rawLeft = Math.max(0, blend.left)
  const rawRight = Math.max(0, blend.right)
  const rawTotal = rawForward + rawBackward + rawLeft + rawRight
  if (rawTotal <= Number.EPSILON) {
    out.forward = 1
    out.backward = 0
    out.leftForward = 0
    out.rightForward = 0
    out.leftBackward = 0
    out.rightBackward = 0
    return out
  }

  const forward = rawForward / rawTotal
  const backward = rawBackward / rawTotal
  const left = rawLeft / rawTotal
  const right = rawRight / rawTotal
  const longitudinal = forward + backward
  const lateral = left + right
  const forwardFraction = longitudinal > 0 ? forward / longitudinal : 0.5
  const backwardFraction = longitudinal > 0 ? backward / longitudinal : 0.5
  const leftFraction = lateral > 0 ? left / lateral : 0.5
  const rightFraction = lateral > 0 ? right / lateral : 0.5
  const pairedAmount = 2 * Math.min(longitudinal, lateral)

  out.forward = 0
  out.backward = 0
  out.leftForward = pairedAmount * forwardFraction * leftFraction
  out.rightForward = pairedAmount * forwardFraction * rightFraction
  out.leftBackward = pairedAmount * backwardFraction * leftFraction
  out.rightBackward = pairedAmount * backwardFraction * rightFraction

  if (longitudinal >= lateral) {
    const cardinalAmount = longitudinal - lateral
    out.forward = cardinalAmount * forwardFraction
    out.backward = cardinalAmount * backwardFraction
  } else {
    const lateralRemainder = lateral - longitudinal
    const leftRemainder = lateralRemainder * leftFraction * 0.5
    const rightRemainder = lateralRemainder * rightFraction * 0.5
    out.leftForward += leftRemainder
    out.leftBackward += leftRemainder
    out.rightForward += rightRemainder
    out.rightBackward += rightRemainder
  }

  return out
}

/**
 * The whole base-layer graph, in one pure function. Algebra ported verbatim from the previous
 * inline Operative block — see each intermediate's comment for its meaning. Writes into `out`
 * (reused — zero allocation) and returns it.
 */
export function computeWeightTable(
  input: WeightTableInput,
  out: WeightTable,
  directions: SixDirectionWeights = createSixDirectionWeights(),
): WeightTable {
  const {
    standWeights, crouchMoveWeight, posture, crawlBlend, crawlMoveWeight, tuckCrawl,
    jumpBlend, montageGate, windup, velocityBlend, crouchTint,
  } = input;

  // Crouch tint folds into an EFFECTIVE posture: the tinted share routes through the exact same
  // stand/crouch split below, so the invariants are untouched (p substitutes for posture).
  const p = posture + (1 - posture) * crouchTint;
  const stand = 1 - p;
  // Montage complement: the single gate is the montage's sole weight source; every base weight
  // gets exactly the complementary share (the anti-T-pose rule for montages).
  const baseWeight = 1 - montageGate;
  // Airborne complement: locomotion fades by (1 - jumpBlend); the jump split takes the remainder.
  const groundAlpha = baseWeight * (1 - jumpBlend);
  // Crawl fades the whole stand/crouch locomotion out (stanceAlpha) and the crawl set in
  // (crawlAlpha); the windup pose fades locomotion out by (1 - windup) as Jump_Land-reversed
  // takes over the body.
  const stanceAlpha = groundAlpha * (1 - crawlBlend) * (1 - windup);
  // Ground crawl rides groundAlpha; the pipe tuck adds an airborne path off baseWeight
  // (groundAlpha is ~0 while hanging), so the inverted crawl pose still shows on the rod.
  const crawlAlpha = groundAlpha * crawlBlend * (1 - windup) + baseWeight * tuckCrawl;

  mapVelocityBlendToSixDirections(velocityBlend, directions)

  out.idle = stand * standWeights[0] * stanceAlpha;
  out.crouchIdle = p * (1 - crouchMoveWeight) * stanceAlpha;

  const walkW = stand * standWeights[1] * stanceAlpha;
  const runW = stand * standWeights[2] * stanceAlpha;
  const sprintW = stand * standWeights[3] * stanceAlpha;
  const crouchWalkW = p * crouchMoveWeight * stanceAlpha;
  out.walkFwd = walkW * directions.forward;
  out.walkBwd = walkW * directions.backward;
  out.walkLeftFwd = walkW * directions.leftForward;
  out.walkRightFwd = walkW * directions.rightForward;
  out.walkLeftBwd = walkW * directions.leftBackward;
  out.walkRightBwd = walkW * directions.rightBackward;
  out.runFwd = runW * directions.forward;
  out.runBwd = runW * directions.backward;
  out.runLeftFwd = runW * directions.leftForward;
  out.runRightFwd = runW * directions.rightForward;
  out.runLeftBwd = runW * directions.leftBackward;
  out.runRightBwd = runW * directions.rightBackward;
  // ALS ships one forward sprint, so sprint is a real gait axis entry but has no direction split.
  out.sprint = sprintW;
  out.crouchFwd = crouchWalkW * directions.forward;
  out.crouchBwd = crouchWalkW * directions.backward;
  out.crouchLeftFwd = crouchWalkW * directions.leftForward;
  out.crouchRightFwd = crouchWalkW * directions.rightForward;
  out.crouchLeftBwd = crouchWalkW * directions.leftBackward;
  out.crouchRightBwd = crouchWalkW * directions.rightBackward;

  // Crawl stance: idle<->move split by crawlMoveWeight, move split 4-way by the same direction.
  const crawlIdleW = crawlAlpha * (1 - crawlMoveWeight);
  const crawlMoveW = crawlAlpha * crawlMoveWeight;
  out.crawlIdle = crawlIdleW;
  const crawlFwd = Math.max(0, velocityBlend.forward);
  const crawlBwd = Math.max(0, velocityBlend.backward);
  const crawlLeft = Math.max(0, velocityBlend.left);
  const crawlRight = Math.max(0, velocityBlend.right);
  const cardinalTotal = crawlFwd + crawlBwd + crawlLeft + crawlRight;
  if (cardinalTotal > Number.EPSILON) {
    out.crawlFwd = crawlMoveW * crawlFwd / cardinalTotal;
    out.crawlBwd = crawlMoveW * crawlBwd / cardinalTotal;
    out.crawlLeft = crawlMoveW * crawlLeft / cardinalTotal;
    out.crawlRight = crawlMoveW * crawlRight / cardinalTotal;
  } else {
    out.crawlFwd = crawlMoveW;
    out.crawlBwd = 0;
    out.crawlLeft = 0;
    out.crawlRight = 0;
  }

  // Jump split rides jumpBlend like the old full Jump_Loop; the tucked pipe crawl owns the whole
  // body, so the airborne split fades out under it.
  const notTuck = 1 - tuckCrawl;
  out.jumpBody = jumpBlend * baseWeight * notTuck;
  out.jumpArms = jumpBlend * baseWeight * notTuck;

  // Windup load pose fades in by windup while its complement fades locomotion out (stanceAlpha).
  out.windupPose = windup * baseWeight;
  out.stanceAlpha = stanceAlpha;

  return out;
}

/**
 * Total base-layer weight covering the LEG/torso region. This plus `montageGate` should stay at
 * least ~1 as a graph-description assertion, even though the owned evaluator is under-coverage
 * safe.
 */
export function legRegionWeight(t: WeightTable): number {
  return (
    t.idle + t.walkFwd + t.walkBwd +
    t.walkLeftFwd + t.walkRightFwd + t.walkLeftBwd + t.walkRightBwd +
    t.runFwd + t.runBwd +
    t.runLeftFwd + t.runRightFwd + t.runLeftBwd + t.runRightBwd + t.sprint +
    t.crouchIdle + t.crouchFwd + t.crouchBwd +
    t.crouchLeftFwd + t.crouchRightFwd + t.crouchLeftBwd + t.crouchRightBwd +
    t.crawlIdle + t.crawlFwd + t.crawlBwd + t.crawlLeft + t.crawlRight +
    t.jumpBody + t.windupPose
  );
}

/**
 * Total base-layer weight covering the ARM region: same full-body contributors, but the jump's
 * arm share comes from `jumpArms` (idle-arms masked clip) instead of the arm-less `jumpBody`.
 * Same >= ~1 (with montageGate) invariant. Fingers are deliberately NOT asserted (see header).
 */
export function armRegionWeight(t: WeightTable): number {
  return (
    t.idle + t.walkFwd + t.walkBwd +
    t.walkLeftFwd + t.walkRightFwd + t.walkLeftBwd + t.walkRightBwd +
    t.runFwd + t.runBwd +
    t.runLeftFwd + t.runRightFwd + t.runLeftBwd + t.runRightBwd + t.sprint +
    t.crouchIdle + t.crouchFwd + t.crouchBwd +
    t.crouchLeftFwd + t.crouchRightFwd + t.crouchLeftBwd + t.crouchRightBwd +
    t.crawlIdle + t.crawlFwd + t.crawlBwd + t.crawlLeft + t.crawlRight +
    t.jumpArms + t.windupPose
  );
}
