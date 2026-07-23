/**
 * Pure locomotion weight table — TD 1.1's extraction of the animation graph's soul.
 *
 * Everything the base locomotion layer plays each frame gets its effective weight from ONE
 * place: `computeWeightTable(input)`. The frame loop in Operative.tsx is now an APPLIER — it
 * damps the stateful blend values (springs live where state lives), builds a `WeightTableInput`,
 * and copies the returned table onto mixer actions. It no longer defines the graph.
 *
 * The algebra is ported EXACTLY from the previous inline block (no behavior change) — the point
 * is that the graph's invariants are now testable:
 *
 *   REGION COVERAGE (the anti-T-pose rule, see trackMask.ts's bind-pose caveat): for every bone
 *   region, the total normal-blend weight across contributors must stay >= ~1·(1 - montageGate)
 *   so no region ever drifts toward bind pose. The montage action itself supplies the missing
 *   `montageGate` share (it's a full-body clip weighted by the gate — see slotMontage.ts), so
 *   `regionCoverage + montageGate >= ~1` is the runtime invariant (see `legRegionWeight` /
 *   `armRegionWeight` and the dev assertion in Operative).
 *
 *   Known, deliberate deviations (asserted in weightTable.test.ts rather than "fixed"):
 *   - Launch transient: while windup unloads and jumpBlend rises, coverage briefly EXCEEDS 1.
 *     PropertyMixer normalizes overweight, so this crossfades cleanly; only UNDER-coverage shows
 *     bind pose. The invariant is a floor, not an equality.
 *   - Tucked pipe crawl adds `baseWeight * tuckCrawl` of crawl-set weight while airborne — again
 *     overweight-by-design (see Operative's tuckCrawl doc).
 *   - FINGERS are deliberately under-covered during the jump: jumpArms is masked to the arm chain
 *     WITHOUT fingers so they relax toward the rig's rest hand in flight (see jumpSplitClips in
 *     Operative). Finger coverage is therefore NOT asserted.
 *
 * Framework-free (no three/React imports) so it stays Vitest-testable in isolation, matching
 * blendspace.ts / actionSequence.ts.
 */

/** Damped/stateful blend values, computed by the frame loop (springs stay with their state). */
export interface WeightTableInput {
  /** [idle, walk, jog] damped stand-gait weights (sum ~1, see blendspace.ts STAND). */
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
  /** Velocity heading vs body facing (rad) — splits each moving gait across its 4-way strafe set. */
  movementAngle: number;
  /**
   * Crouch tint, 0..1 (damped): shifts this fraction of the STAND gait share onto the crouch
   * counterpart clips (idle->crouch-idle, walk/jog->crouch-walk) for a subtle hunched readiness
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
  walkLeft: number;
  walkRight: number;
  jogFwd: number;
  jogBwd: number;
  jogLeft: number;
  jogRight: number;
  crouchIdle: number;
  crouchFwd: number;
  crouchBwd: number;
  crouchLeft: number;
  crouchRight: number;
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
    walkFwd: 0, walkBwd: 0, walkLeft: 0, walkRight: 0,
    jogFwd: 0, jogBwd: 0, jogLeft: 0, jogRight: 0,
    crouchIdle: 0,
    crouchFwd: 0, crouchBwd: 0, crouchLeft: 0, crouchRight: 0,
    crawlIdle: 0,
    crawlFwd: 0, crawlBwd: 0, crawlLeft: 0, crawlRight: 0,
    jumpBody: 0,
    jumpArms: 0,
    windupPose: 0,
    stanceAlpha: 0,
  };
}

/**
 * The whole base-layer graph, in one pure function. Algebra ported verbatim from the previous
 * inline Operative block — see each intermediate's comment for its meaning. Writes into `out`
 * (reused — zero allocation) and returns it.
 */
export function computeWeightTable(input: WeightTableInput, out: WeightTable): WeightTable {
  const {
    standWeights, crouchMoveWeight, posture, crawlBlend, crawlMoveWeight, tuckCrawl,
    jumpBlend, montageGate, windup, movementAngle, crouchTint,
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

  // 4-way direction split of `movementAngle` (cos -> fwd/bwd axis, sin -> left/right axis),
  // normalized so the split always sums to 1 and each gait's total is preserved.
  const dFwd = Math.max(0, Math.cos(movementAngle));
  const dBwd = Math.max(0, -Math.cos(movementAngle));
  const dLeft = Math.max(0, Math.sin(movementAngle));
  const dRight = Math.max(0, -Math.sin(movementAngle));
  const dSum = dFwd + dBwd + dLeft + dRight || 1;
  const nFwd = dFwd / dSum;
  const nBwd = dBwd / dSum;
  const nLeft = dLeft / dSum;
  const nRight = dRight / dSum;

  out.idle = stand * standWeights[0] * stanceAlpha;
  out.crouchIdle = p * (1 - crouchMoveWeight) * stanceAlpha;

  const walkW = stand * standWeights[1] * stanceAlpha;
  const jogW = stand * standWeights[2] * stanceAlpha;
  const crouchWalkW = p * crouchMoveWeight * stanceAlpha;
  out.walkFwd = walkW * nFwd;
  out.walkBwd = walkW * nBwd;
  out.walkLeft = walkW * nLeft;
  out.walkRight = walkW * nRight;
  out.jogFwd = jogW * nFwd;
  out.jogBwd = jogW * nBwd;
  out.jogLeft = jogW * nLeft;
  out.jogRight = jogW * nRight;
  out.crouchFwd = crouchWalkW * nFwd;
  out.crouchBwd = crouchWalkW * nBwd;
  out.crouchLeft = crouchWalkW * nLeft;
  out.crouchRight = crouchWalkW * nRight;

  // Crawl stance: idle<->move split by crawlMoveWeight, move split 4-way by the same direction.
  const crawlIdleW = crawlAlpha * (1 - crawlMoveWeight);
  const crawlMoveW = crawlAlpha * crawlMoveWeight;
  out.crawlIdle = crawlIdleW;
  out.crawlFwd = crawlMoveW * nFwd;
  out.crawlBwd = crawlMoveW * nBwd;
  out.crawlLeft = crawlMoveW * nLeft;
  out.crawlRight = crawlMoveW * nRight;

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
 * Total base-layer weight covering the LEG/torso region (every full-body clip + the arm-masked
 * jump body + the full-body windup pose). Runtime invariant: this plus `montageGate` must never
 * fall below ~1, or the legs drift toward bind pose (TD 1.2's dev assertion).
 */
export function legRegionWeight(t: WeightTable): number {
  return (
    t.idle + t.walkFwd + t.walkBwd + t.walkLeft + t.walkRight +
    t.jogFwd + t.jogBwd + t.jogLeft + t.jogRight +
    t.crouchIdle + t.crouchFwd + t.crouchBwd + t.crouchLeft + t.crouchRight +
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
    t.idle + t.walkFwd + t.walkBwd + t.walkLeft + t.walkRight +
    t.jogFwd + t.jogBwd + t.jogLeft + t.jogRight +
    t.crouchIdle + t.crouchFwd + t.crouchBwd + t.crouchLeft + t.crouchRight +
    t.crawlIdle + t.crawlFwd + t.crawlBwd + t.crawlLeft + t.crawlRight +
    t.jumpArms + t.windupPose
  );
}
