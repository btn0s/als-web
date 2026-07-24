# AlsAnimationInstance — extracted per-frame math reference

Verified extraction from ALS-Refactored 4.15 C++ (formulas, constants, curves, file:line).
The implementation source for M3 systems: implement against THIS, cite it in code comments,
and strike through/annotate sections as they land in AlsAnimationInstance.ts.

# AlsAnimationInstance Per-Frame Math — Implementation Spec for M3

Source: `~/.cache/als-extract/ALS-Refactored-4.15/Source/ALS/` (read-only). All line numbers below are against that checkout's `Private/AlsAnimationInstance.cpp` unless another file is named.

## Architecture note (read first — affects every system below)

`NativeThreadSafeUpdateAnimation` (`AlsAnimationInstance.cpp:158-180`) unconditionally runs, in order, every frame: `RefreshLayering` → `RefreshPose` → `RefreshView`(→`RefreshSpine`) → `RefreshFeet` → `RefreshTransitions`. Everything else — `RefreshGrounded`/`RefreshGroundedMovement`/`RefreshStandingMovement`/`RefreshCrouchingMovement`, `RefreshInAir`, `RefreshRotateInPlace`, `RefreshTurnInPlace`, `RefreshDynamicTransitions`, `RefreshLook` — is `UFUNCTION(BlueprintCallable)` (`AlsAnimationInstance.h:187-343`) called **from the AnimGraph state machine**, gated by which state is currently active (Grounded/InAir, Standing/Crouching sub-states, etc.). That state machine's exact wiring isn't visible in C++; the web port's `actionArbiter`/locomotion-mode state already plays this role, so: call the grounded/standing/crouching/in-air refreshers only while the arbiter says that mode is active (mirrors ALS), and call `RefreshLook`/`RefreshSpine`/pose/feet/transitions every frame unconditionally (mirrors the C++ that truly is unconditional). `RefreshRotateInPlace`/`RefreshTurnInPlace`/`RefreshDynamicTransitions` guard themselves with a `bUpdatedThisFrame` latch reset each tick (lines 171-173) so they're safe to call from multiple state entries — reproduce that as an idempotency flag if the web port also risks double-calling per frame.

`bPendingUpdate` (true on init / after being invisible) forces most systems to snap instead of interpolate — the web-port evaluator should have an equivalent "first frame after (re)activation, don't damp" flag per system, not a global one, since ALS scopes it per-refresher.

---

## 1. Velocity blend (grounded movement)

`RefreshVelocityBlend` — `AlsAnimationInstance.cpp:735-785`. Reads `LocomotionState.Velocity`/`RotationQuaternion`; writes `GroundedState.VelocityBlend.{Forward,Backward,Left,Right}Amount`.

1. `RelativeVelocityDirection = RotationQuaternion.UnrotateVector(Velocity)` (world velocity → actor-local) — `GetRelativeVelocity()`, line 708-711.
2. Normalize it; if it normalizes to non-zero, `TargetVelocityBlend = dir / (|dir.x| + |dir.y| + |dir.z|)` (L1-normalize, **not** L2) — line 746-751. This is why diagonals read as 0.5/0.5 rather than 0.707/0.707.
3. Split into 4 non-negative channels: `Forward = clamp01(target.x)`, `Backward = |clamp(target.x, -1, 0)|`, `Left = |clamp(target.y, -1, 0)|`, `Right = clamp01(target.y)` — lines 757-760 (instant path) / 769-783 (damped path). Exactly one of Forward/Backward and one of Left/Right is non-zero at any instant (before damping smears them).
4. Damped via `UAlsMath::ExponentialDecay(current, target, dt, Settings->Grounded.VelocityBlendInterpolationSpeed)` = `lerp(current, target, 1 - exp(-speed·dt))`, **not** `FInterpTo` — the comment at line 764 explicitly says `FInterpTo` was rejected for being too twitchy at low FPS. **Constant: `VelocityBlendInterpolationSpeed = 12.0`** (`AlsGroundedSettings.h:26`).
5. `bInitializationRequired` (set on `InitializeGrounded()`, line 684) or speed ≤ 0 → snap instead of damp (lines 753-761).

These 4 weights feed a 4-way directional blend-multi node in the AnimGraph (not in C++) that cross-fades Forward/Backward/Left/Right locomotion cycles.

**GaitAmount** — `RefreshPose` (`AlsAnimationInstance.cpp:313-351`), reads the `PoseGait` curve baked into every locomotion clip (authored 0=idle,1=walk,2=run,3=sprint):
- `GaitAmount = clamp(curve("PoseGait"), 0, 3)`.
- `GaitWalkingAmount = clamp01(GaitAmount)`, `GaitRunningAmount = clamp01(GaitAmount - 1)`, `GaitSprintingAmount = clamp01(GaitAmount - 2)` — three overlapping 0-1 ramps.
- `UnweightedGaitAmount = GroundedAmount > ε ? GaitAmount / GroundedAmount : GaitAmount` — "unweights" the curve by the `PoseGrounded` curve so during a Grounded-entry transition (where `PoseGrounded` curve is still ramping from 0→1) the gait fraction reads as if already fully grounded. Same 3 `Unweighted*` splits derived from this.
- Consumed in `RefreshStandingMovement` (`AlsAnimationInstance.cpp:871-951`): `StrideBlendAmount = lerp(WalkCurve(speed), RunCurve(speed), UnweightedGaitRunningAmount)`; play rate = `clamp(lerp(lerp(speed/AnimWalkSpeed, speed/AnimRunSpeed, UnweightedGaitRunningAmount), speed/AnimSprintSpeed, UnweightedGaitSprintingAmount) / StrideBlendAmount, KINDA_SMALL, 3.0)`. **Constants** (`AlsStandingSettings.h`): `AnimatedWalkSpeed=150`, `AnimatedRunSpeed=350`, `AnimatedSprintSpeed=600` cm/s (matches ROADMAP's already-noted 1.75/3.75/6.5 m/s... actually those are `AlsMovementSettings.h`/`MS_Als_Normal` gameplay speeds, distinct from these *animated* speeds — both exist and both matter: gameplay speed drives `Speed`, animated speed is the denominator).

**Web-port mapping:** velocity-blend weights → new pure module (`velocityBlend.ts`, ExponentialDecay-damped, L1-normalize) feeding `blendspace.ts`'s directional axis (blendspace.ts today only does the "stand" gait axis per its own doc comment — this is the piece that adds the 4-way directional blend on top, forward-only clips notwithstanding per that file's note). GaitAmount segmentation → `locomotionProfile.ts` input (curve-sourced once M2 lands `PoseGait` curve extraction — until then, ROADMAP already notes strides are constants, not measured, so gait fraction must come from the weight-table's own damped gait weights, not this curve). Flag: **exact PoseGait curve values require M2's curve extraction; until then approximate GaitAmount from `WeightTableInput.standWeights`/`crouchMoveWeight`, which are the web port's own analog.**

---

## 2. Turn-in-place + rotate-in-place

### Rotate-in-place — `RefreshRotateInPlace`, `AlsAnimationInstance.cpp:1631-1687`

1. Allowed only if `IsRotateInPlaceAllowed()` = `RotationMode==Aiming || ViewMode==FirstPerson` (line 1626-1629) and not moving.
2. Trigger: `bRotatingLeft = ViewYawAngle < -ViewYawAngleThreshold`, `bRotatingRight = ViewYawAngle > ViewYawAngleThreshold` — **threshold = 50°** (`AlsRotateInPlaceSettings.h:11`).
3. Play rate when rotating: `FMath::GetMappedRangeValueClamped(ReferenceViewYawSpeed={180,460}, PlayRate={1.15,3.0}, ViewState.YawSpeed)` — i.e. camera yaw-speed 180-460°/s linearly maps to anim play-rate 1.15-3.0×.
4. Play rate when not rotating: relaxes toward `PlayRate.X = 1.15` via `FMath::FInterpTo` (linear-toward-target, **not** exponential decay) at **5.0/s** (`PlayRateInterpolationSpeed`, line 1664).
5. `bPendingUpdate` → snap instead of `FInterpTo`.
6. No clip-selection here — rotate-in-place plays a single looping in-place-turn anim scrubbed by play rate; the actual body rotation delta comes from the `RotationYawSpeed` curve baked into that anim (see below), not from this function.

### Turn-in-place — `RefreshTurnInPlace`, `AlsAnimationInstance.cpp:1699-1806`

1. Allowed only if `TransitionsState.bTransitionsAllowed` and `IsTurnInPlaceAllowed()` = `RotationMode==ViewDirection && ViewMode!=FirstPerson` (line 1689-1692).
2. Early-out (reset `ActivationDelay=0`) unless `ViewYawSpeed < ViewYawSpeedThreshold` **and** `|ViewYawAngle| > ViewYawAngleThreshold` — both must hold to start accumulating (view has stopped moving fast, and is off-center). **Constants:** `ViewYawSpeedThreshold=50°/s`, `ViewYawAngleThreshold=45°` (`AlsTurnInPlaceSettings.h:32-35`).
3. Accumulate `ActivationDelay += dt`. Required hold time is itself angle-dependent: `GetMappedRangeValueClamped({ViewYawAngleThreshold, 180}, ViewYawAngleToActivationDelay={0.0, 0.75}, |ViewYawAngle|)` — bigger view-body mismatch → shorter required hold (down to instant at 180°, up to 0.75s at 45°).
4. Fire only once `ActivationDelay > ActivationDelay(mapped)`.
5. Clip select: `bTurnLeft = RemapAngleForCounterClockwiseRotation(ViewYawAngle) <= 0` (biases exactly-180° toward CCW/left, see `AlsRotation.h:55-63`: angle > 175° → angle-360). Then **90 vs 180**: `|ViewYawAngle| < Turn180AngleThreshold (130°)` picks the 90° clip set, else 180°; separately keyed by `Stance` (Standing/Crouching) → 8 possible clip refs total (`StandingTurn90Left/Right`, `StandingTurn180Left/Right`, `CrouchingTurn90Left/Right`, `CrouchingTurn180Left/Right`), each a `UAlsTurnInPlaceSettings` asset (`PlayRate`, `bScalePlayRateByAnimatedTurnAngle`, `AnimatedTurnAngle`).
6. `PlayQueuedTurnInPlaceAnimation` (`1808-1835`): montage plays at `TurnInPlaceSettings->PlayRate` (**default 1.2×**), blend in/out = `TurnInPlace.BlendDuration` (**0.2s**). If `bScalePlayRateByAnimatedTurnAngle` (**default true**), `PlayRate *= |QueuedTurnYawAngle / AnimatedTurnAngle|` — scales the clip so a 100°-off-center trigger scrubs the (typically 90° or 180°-authored) clip proportionally instead of always playing the full animated arc.

### RotationYawSpeed curve → actor rotation (the actual "turn" mechanism)

This is **not in AlsAnimationInstance.cpp** — it's in `AlsCharacter.cpp:1798-1809` (`ApplyRotationYawSpeedAnimationCurve`), called every frame the character is grounded-and-not-moving (`AlsCharacter.cpp:1534`, inside the not-moving rotation branch):
```
DeltaYawAngle = animInstance->GetCurveValue("RotationYawSpeed") * DeltaTime
actorRotation.Yaw += DeltaYawAngle
```
i.e. turn-in-place and rotate-in-place clips bake a `RotationYawSpeed` (deg/s) float curve, and the **character capsule's actual yaw is driven frame-by-frame directly from that curve**, independent of root motion. This is the ALS idiom for "in-place" turns without root motion.

**Web-port mapping:** rotate-in-place → new pure module (`rotateInPlace.ts`: threshold+mapped-range play rate, `FInterpTo`-style linear damp — note this is a **different** damp primitive than the exponential decay used everywhere else, worth preserving as a distinct helper). Turn-in-place → `actionArbiter` action record (kind `turn-in-place`, `bodyMotion: 'kinematic-warp'` since it drives yaw directly, not physics), with the activation-delay state machine as a small pure module (`turnInPlaceTrigger.ts`) feeding the arbiter's request. The `RotationYawSpeed`-curve-drives-yaw mechanism is a **hard dependency on M2's curve extraction** (flagged already in ROADMAP M2) — until then, approximate by yawing the actor directly toward the resolved target over the clip's known duration (a synthesized ramp) rather than sampling a curve.

---

## 3. Foot locking + foot IK

`RefreshFeetOnGameThread` (`1128-1153`, game-thread only) resolves foot **target** transforms every frame from the mesh socket (`ik_foot_l/r` if `bUseFootIkBones`, else the `VB foot_l/r` virtual bone) — these are the mixer's *current pose* output, i.e. "where the blended animation currently wants the foot," before any locking.

`RefreshFeet(dt)` (`1155-1167`): reads `FootPlanted` curve (clamped **[-1,1]**: sign picks which foot is planted/about-to-plant, magnitude — less than 0.5 = planted, more = airborne) and `FeetCrossing` curve (clamp01). Then per foot, in order:

1. **`ProcessFootLockTeleport`** (`1179-1204`): if a teleport happened within the last **0.2s** and the foot is currently lock-relevant, re-derive `LockLocation/Rotation` from the *component-relative* cached lock transform against the *new* component transform (keeps the lock spatially consistent through a teleport instead of leaving it in stale world-space).
2. **`ProcessFootLockBaseChange`** (`1206-1237`): if the movement base (e.g., a moving platform) changed this frame and lock is relevant, re-cache the lock in both component-relative and movement-base-relative space (so a foot locked to a moving platform keeps riding it).
3. **`RefreshFootLock`** (`1239-1376`) — the actual lock state machine:
   - `NewLockAmount = clamp01(curve(FootLeft/RightLock))` — **the authored `FootLock` curve is the primary driver.**
   - Override: if moving-smooth or airborne, force it down regardless of curve: `NewLockAmount = min(curveValue, LockAmount - dt·decreaseSpeed)`, clamped ≥0. **Constants: `MovingDecreaseSpeed = 5.0`/s, `NotGroundedDecreaseSpeed = 0.6`/s** (lines 1249-1250) — locked feet release ~8× faster when the character starts moving than when it merely leaves the ground.
   - If `Settings->Feet.bDisableFootLock` or `IkAmount·NewLockAmount` negligible: fully release (`LockAmount=0`, all lock caches zeroed), `FinalLocation/Rotation = TargetLocation/Rotation` verbatim. Early return.
   - **Monotonic-ish lock rule** (lines 1281-1326): the lock amount is only allowed to *decrease* smoothly or *jump straight to 1* — never blend upward gradually from below 1. When `NewLockAmount` hits full weight (1.0) and the previous amount was ≤ 0.9, the **current target transform is captured as the new lock point** (`LockLocation = TargetLocation` etc. — i.e. footplant is captured only once, right as weight crosses into "fully locked", avoiding re-latching every frame while already locked). When `NewLockAmount < LockAmount`, `LockAmount` tracks it down normally.
   - **Angle-limit clamp** (lines 1339-1367): to stop legs twisting into a spiral during fast rotation, the locked foot's position (relative to the pelvis's thigh axis, both mapped into component space) is clamped to `Settings->Feet.FootLockAngleLimit` (**default 90°**) either side of the thigh's rest-pose bone axis (captured once in `NativeInitializeAnimation`, lines 48-81, by walking the skeleton from the foot up to the first child of the pelvis). If the signed angle between thigh axis and lock-vector exceeds the limit, the lock location+rotation are rotated back onto the limit boundary around the up axis.
   - **Final blend**: `FinalLocation = lerp(TargetLocation, LockLocation, LockAmount)`; `FinalRotation = FastLerp(TargetRotation, LockRotation, LockAmount).Normalize()`.

**`bDisableFootLock`** default false; **`FootLockAngleLimit`** default 90° (`AlsFeetSettings.h`).

### Pelvis-adaptive ground IK (separate stage, Control Rig — NOT AnimBP C++)

This is a genuinely separate system from foot locking, running in a **Control Rig graph** post-AnimBP, in `Private/Nodes/AlsRigUnit_*`:
- `FAlsRigUnit_FootOffsetTrace` (`AlsRigUnit_FootOffsetTrace.cpp`): line-traces straight down from each foot's XY through a configurable up/down distance; on a walkable hit, computes `OffsetLocationZ = HitLocation.Z + (FootHeight/cos(slopeAngle) − FootHeight)` (slope-compensated foot-sink correction, right-triangle derivation documented in the file) and outputs the hit normal for rotation alignment.
- `FAlsRigUnit_ApplyFootOffsetLocation` (`AlsRigUnit_ApplyFootOffsetLocation.cpp/h`): clamps that Z offset so the foot can't rise above `pelvisZ − MinPelvisToFootDistanceZ` (**default 50cm**) and can't go below the current pelvis-drop offset (prevents leg over-stretch); spring-damps the offset toward target via `SpringDampFloat` (**Frequency=0.4Hz, DampingRatio=4.0, TargetVelocityAmount=1.0**); then re-clamps the resulting hip→foot vector to `LegLength · MaxLegStretchRatio` (**default 0.99**) to avoid a fully-straight leg.
- `FAlsRigUnit_ApplyFootOffsetRotation`: aligns the foot to the ground normal by rotating from world-up to the (exponentially-decayed) hit normal, expressed in calf-local swing/twist space and clamped against `Swing1LimitAngle`/`Swing2LimitAngle`/`TwistLimitAngle` so the ankle doesn't over-rotate relative to what the base animation already had.
- **Pelvis offset itself** (lowering the hips when both feet want to sink, e.g. standing on a slope) is the `PelvisOffset` input plumbed into `ApplyFootOffsetLocation`'s clamp (line 33) — its *computation* (presumably `min` of both feet's raw offsets, plus its own spring) is **in the Control Rig graph, not in any `.cpp` file this checkout ships** — the graph asset itself isn't text-diffable from this extraction. Flag as a genuine gap: the *interface* (a per-frame scalar Z offset feeding both feet's clamps) is clear, but its exact combination formula is not recoverable from C++ alone.

**Web-port mapping:** foot-lock state machine → extends `footIk.ts`/`ikChain.ts` with a new stateful module (`footLock.ts`) carrying `LockAmount`/`LockLocation`/`LockRotation` per foot — this is genuinely new pure-module surface (arbiter-adjacent state, not a weight-table entry), consuming the authored `FootLock`/`FootIk` curves once M2 extracts them (ROADMAP already flags this dependency explicitly: "M3 turn-in-place, foot locking, and transitions are blocked without these"). The ground-trace + spring-damped Z offset + slope alignment (`AlsRigUnit_*`) is a **UE Control Rig dependency we don't have** — flag as consciously approximated: a raycast-based foot/pelvis IK pass is buildable in three.js (raycast against the collision mesh, `THREE.MathUtils.damp`-style spring) as a new pure module layered after `footIk.ts`'s existing two-bone solve, but it is new work, not a transplant. ROADMAP M3 already lists "Foot IK with pelvis adaptation" as the item exposure-r3f deliberately skipped — this confirms it's net-new, and gives you the exact math (slope formula, clamp order, spring constants) to build it from.

---

## 4. Lean

Two call sites, same target math (`GetRelativeAccelerationAmount`, lines 713-733) split by locomotion mode, same damp constant.

**Grounded** — `RefreshGroundedLean`, `787-803`:
1. `MaxAccel = (Acceleration · Velocity) >= 0 ? MaxAcceleration : MaxBrakingDeceleration` — picks accelerating-vs-braking cap based on whether accel and velocity are co-directional.
2. `RelativeAcceleration = RotationQuaternion.UnrotateVector(Acceleration)`; `target = ClampMagnitude01(RelativeAcceleration / MaxAccel)` (2D, XY only) — so lean is accel normalized to **[-1,1]**, where ±1 means "at the movement component's authored max accel/braking-decel."
3. Damp: `lerp(current, target, ExponentialDecay(dt, LeanInterpolationSpeed))`. **`LeanInterpolationSpeed = 4.0`** (`AlsGeneralAnimationSettings.h:21`). `bPendingUpdate` → snap.

**In-air** — `RefreshInAirLean`, `1102-1126`:
1. `target = GetRelativeVelocity() / ReferenceSpeed(350) * InAir.LeanAmountCurve(VerticalVelocity)` — velocity-direction lean, magnitude scaled by a curve keyed on vertical speed (so the curve can flip the lean sign as the character transitions from rising to falling, per the code comment at 1104-1106).
2. Same damp (`LeanInterpolationSpeed=4.0`, same helper).

Both write the same `LeanState.{RightAmount, ForwardAmount}` — grounded and in-air are mutually exclusive callers so no separate blending needed.

**Web-port mapping:** direct fit for `proceduralPose.ts`'s `Driver`/`stepDriver` pattern (already a spring-driven scalar-offset system matching this shape almost exactly) — feed it `RelativeAcceleration/MaxAccel` (grounded) or `RelativeVelocity/350 · curve(vz)` (in-air) as the target and reuse its existing damp helper at rate 4.0/s. The in-air `LeanAmountCurve` is an authored asset curve (not a formula) — needs M2 extraction or a placeholder curve (e.g. linear ramp that flips sign near vz≈0).

---

## 5. Look/aim + spine rotation

### Look (head/eyes aim offset) — `RefreshLook`, `494-581`, and view yaw/pitch prep in `RefreshView`, `363-379`

1. `ViewState.YawAngle/PitchAngle` = camera rotation minus actor rotation, unwound to ±180° (`RefreshView`, only when no `LocomotionAction` is active, lines 367-368). `PitchAmount = 0.5 - PitchAngle/180` (maps ±90° pitch to 1..0, centered 0.5).
2. `ViewAmount = 1 - clamp01(curve("ViewBlock"))`; `AimingAmount = clamp01(curve("AllowAiming"))`; `LookAmount = ViewAmount·(1-AimingAmount)` — Look and Aiming(spine) are complementary consumers of the same `ViewBlock` gate, split by `AllowAiming`.
3. Target depends on `RotationMode`: if `VelocityDirection`, look toward **input** direction (`InputYawAngle` if has-input else `TargetYawAngle`), pitch forced to 0, interp speed = `View.LookTowardsInputYawAngleInterpolationSpeed` (**8.0**); else look toward camera (`ViewState.YawAngle/PitchAngle`), interp speed = `View.LookTowardsCameraRotationInterpolationSpeed` (**8.0**) — both default equal but independently tunable.
4. Interpolation (lines 549-570) uses `ExponentialDecay(dt, speed)` as the lerp alpha, with a **direction-bias hack**: if the raw shortest-path delta would flip more than `180° - 5°` (`CounterClockwiseRotationAngleThreshold`), force it the other way (−360°); separately, if `|YawSpeed| > ε` and `|TargetYawAngle| > 90°`, force the interpolation direction to match the character's own current turn direction (`YawSpeed`'s sign) rather than shortest-path, "so the rotation of the head remains synchronized with the rotation of the body" (comment, line 560-561) — this prevents the head snapping opposite the body mid-turn.
5. `bInitializationRequired` or `speed<=0` → snap.
6. Final: split `YawAngle` into 3 blend weights for a 3-way (center/left/right) look blend space: `YawForwardAmount = YawAngle/360 + 0.5`; `YawLeftAmount = 0.5 - |YawForwardAmount-0.5|`; `YawRightAmount = 0.5 + |YawForwardAmount-0.5|` — enables wrapping smoothly all the way around without a seam.

### Spine (aiming rotation) — `RefreshSpine`, `386-487`, called from `RefreshView` with `SpineBlendAmount = ViewAmount·AimingAmount`

1. `IsSpineRotationAllowed()` = `RotationMode == Aiming` (line 381-384) — a hard binary the whole function hinges on.
2. **On the allowed/disallowed transition** (lines 388-422), it remaps `SpineAmount`'s effective interpolation range so that switching branches doesn't cause a visual pop: computes `SpineAmountScale`/`SpineAmountBias` so a lerp between the *old* accumulated yaw and the *new* target, at the *current* `SpineAmount`, reproduces the exact angle that was showing the instant before the switch (documented inline, lines 394-395 and 410-411 — a from-scratch re-derivation each toggle, not a fixed formula).
3. **While allowed:** `SpineAmount → 1` via `ExponentialDecay(dt, speed=20.0)`; `CurrentYawAngle = LerpAngle(LastYawAngle, ViewState.YawAngle, SpineAmount·Scale+Bias)`.
4. **While disallowed:** `SpineAmount → 0` via `ExponentialDecay(dt, speed = 1.0 · max(1, |ViewYawSpeed|/40))` — base rate **1.0/s**, sped up when the camera is spinning fast (**`ReferenceViewYawSpeed=40`**°/s). Also re-derives `LastActorYawAngle` each frame to stay locked to the movement base if relative-based, then computes a `YawAngleOffset = unwind(LastActorYawAngle - actorYaw)` clamped to **±30°** (`MaxYawAngleOffset`) to keep the spine rotation visually anchored in world space as aiming ends (documented lines 469-474 — prevents a snap back to 0 when stopping aim mid-turn).
5. Final: `SpineState.YawAngle = LerpAngle(0, CurrentYawAngle, SpineBlendAmount)`.

### Spine bone distribution — `FAlsRigUnit_DistributeRotationSimple` (`Private/Nodes/AlsRigUnit_DistributeRotationSimple.cpp`, Control Rig, not AnimBP)

Given `SpineState.YawAngle` as a single `Rotation` quaternion and a list of `N` spine bone items (chain order): `DeltaRotation = Slerp(Identity, Rotation, 1/N)`; then, **in chain order**, each bone's *global* transform gets `DeltaRotation * currentGlobalRotation` applied and written back before moving to the next bone. Because each bone already inherits its parent's freshly-modified global rotation via FK, and then gets *another* `DeltaRotation` stacked on top, the rotation compounds down the chain — the net effect is the full `Rotation` is reached by the last bone, spread evenly (not weighted by bone count of a differently-sized chain — pure `1/N`).

**Web-port mapping:** Look → new pure module (`lookState.ts`), same exponential-decay-alpha lerp shape as `proceduralPose.ts`'s driver but angle-aware (needs `LerpAngle`'s shortest/character-direction-biased unwind, which `proceduralPose.ts` doesn't currently have — worth factoring out as a shared `angleLerp` helper alongside `THREE.MathUtils.damp`). Spine aiming-toggle remap and 30°-offset anchoring are genuinely fiddly state — land as their own small pure module (`spineAim.ts`) rather than folding into `proceduralPose.ts`'s generic driver, since the scale/bias re-derivation on toggle is bespoke. Spine-bone distribution → `proceduralPose.ts`'s existing "distribute angle across a chain, each bone scaled by its own share" concept (its docstring already references `distributeAngle` for a look-chain) is the right home — confirm it reproduces the *compounding-via-FK* semantics (cumulative, not independently-scaled-per-bone) since that's what UE's version actually does, not a naive `angle/N` applied identically to every bone in isolation.

---

## 6. Dynamic transitions + stop/start/pivot

### Gate — `RefreshTransitions`, `1477-1482`
`TransitionsState.bTransitionsAllowed = FAnimWeight::IsFullWeight(curve("AllowTransitions"))` — a hard binary gate (curve == 1.0, full weight) that every transition/turn-in-place trigger checks first. The curve's authored values live in the AnimGraph/clips (forced to 0 during certain states, e.g. mid-transition-montage, to block re-triggering) — **not derivable from this C++ file**; in the web port this maps directly to "is the arbiter's current action interruptible / not already playing a transition," i.e. `actionArbiter`'s own busy-state, not a curve to author.

### Dynamic transitions (foot-position-error triggered) — `RefreshDynamicTransitions`, `1484-1587`
1. Guarded by `bUpdatedThisFrame` latch + a 2-frame cooldown (`FrameDelay`, decremented each call while >0) + `bTransitionsAllowed`.
2. Per foot: `distSq = DistSquared(FeetState.{L,R}.TargetLocation, FeetState.{L,R}.LockLocation)`; allowed if `LockAmount` is relevant (foot is currently locked) **and** `distSq > (FootLockDistanceThreshold · LocomotionState.Scale)²`. **`FootLockDistanceThreshold = 8cm`** (`AlsDynamicTransitionsSettings.h:13`) — i.e. triggers when the mixer's current pose wants the foot more than 8cm away from where it's actually locked (a big instantaneous re-plant, e.g. after a snap-turn or teleport-adjacent event).
3. If both feet qualify, picks the foot with the **larger** error (line 1555). Sequence chosen by `Stance` (Standing/Crouching) × side (Left/Right) from 4 configured `UAnimSequenceBase` refs.
4. Plays via `PlaySlotAnimationAsDynamicMontage` on the `Transition` slot at `BlendDuration=0.2s` in/out, `PlayRate=1.5×` (`AlsDynamicTransitionsSettings.h`), then sets `FrameDelay=2` to block re-triggering for ~2 frames while the AnimBP reacts.

### Quick-stop (velocity-direction stop transition) — `PlayQuickStopAnimation`, `1378-1414`
1. If not in `VelocityDirection` rotation mode, just plays the plain left transition (no yaw-scaled play rate).
2. Else: `RemainingYawAngle = unwind((hasInput ? InputYawAngle : TargetYawAngle) - actorYaw)`, then `RemapAngleForCounterClockwiseRotation` (biases near-180° to negative, same helper as turn-in-place).
3. Sign picks left-vs-right transition clip; magnitude scales play rate: `lerp(QuickStopPlayRate.X=1.75, QuickStopPlayRate.Y=3.0, |RemainingYawAngle|/180)` — bigger remaining turn ⇒ faster stop-transition playback, capping at 3× for a full 180° reversal. **`BlendIn=0.1s`, `BlendOut=0.2s`, `StartTime=0.3s`** (scrubs 0.3s into the clip before blending in, skipping the very start of the anticipation pose).

### Pivot — `ActivatePivot`, `953-956`
`StandingState.bPivotActive = Speed < PivotActivationSpeedThreshold` (**200 cm/s**, `AlsStandingSettings.h:30`). This is a bool the AnimGraph state machine reads to decide whether a directional-reversal counts as a "pivot" (foot-plant-preserving spin) vs a full stop+restart — the *decision logic* for when to call `ActivatePivot()` at all lives in the AnimGraph, not here; the threshold itself is the only piece of math C++ owns.

**Web-port mapping:** the `AllowTransitions` gate → arbiter's own interrupt/busy state (already modeled — `ActionInterruptPolicy`). Dynamic-transition foot-error trigger + quick-stop yaw-scaled play rate → `actionArbiter` action records (`kind: 'dynamic-transition'`/`'quick-stop'`, `bodyMotion: 'none'` since these are purely cosmetic corrective plays layered over the base pose, `clip` chosen by the same left/right + stance branching, `duration` from clip length / play rate). The foot-error threshold needs `FeetState`'s lock-vs-target distance, which only exists once system 3's foot-lock module lands — sequence this after foot locking. Pivot threshold (200 cm/s) is a plain constant for `blendspace.ts`/`weightTable.ts` gait-transition logic.

---

## 7. In-air

`RefreshInAirOnGameThread` (`985-991`, game thread): latches `bJumped = !pendingUpdate && (bJumped || bJumpRequested)`; `bJumpRequested` reset every frame (set externally by `Jump()`, `AlsAnimationInstance.h:393-396`, called from character jump input).

`RefreshInAir`, `993-1026`:
1. On the frame `bJumped` is (still) true: `JumpPlayRate = LerpClamped(1.2, 1.5, Speed/600)` (**`ReferenceSpeed=600`** cm/s) — faster horizontal speed at jump-off ⇒ faster jump-anim playback, capped [1.2, 1.5]. Then `bJumped` is cleared (one-shot).
2. `VerticalVelocity = Velocity.Z` (cached separately for landing-speed decisions).
3. Calls `RefreshGroundPrediction()` then `RefreshInAirLean()` (lean already covered in §4).

### Ground prediction — `RefreshGroundPrediction`, `1028-1100`
1. Early-out to 0 if `VerticalVelocity > -200` (**`VerticalVelocityThreshold`**) — only predicts while falling meaningfully fast.
2. `AllowanceAmount = 1 - clamp01(curve("GroundPredictionBlock"))`; early-out to 0 if ≤ ~0.
3. Sweep direction = velocity clamped to `Z ∈ [-4000, -200]` (**`MinVerticalVelocity`/`MaxVerticalVelocity`**) then normalized.
4. Sweep **distance** = `GetMappedRangeValueClamped({MaxVerticalVelocity=-200, MinVerticalVelocity=-4000}, {MinSweepDistance=150, MaxSweepDistance=2000}, VerticalVelocity) · LocomotionState.Scale` — i.e. falling faster (more negative Vz) linearly increases the sweep length from 150cm up to 2000cm.
5. Capsule sweep (`SweepSingleByChannel`, `Settings->InAir.GroundPredictionSweepChannel`/`SweepResponses`) from `LocomotionState.Location` along that vector, capsule shape from `CapsuleRadius`/`CapsuleHalfHeight`. Valid only if it's a blocking hit **and** `ImpactNormal.Z >= WalkableFloorAngleCos` (floor-angle check, same threshold the character movement component uses for "walkable").
6. `GroundPredictionAmount = valid ? curve("GroundPredictionAmountCurve")(Hit.Time) · AllowanceAmount : 0` — `Hit.Time` is the sweep's normalized hit fraction (0=immediate, 1=no hit within range), remapped through an authored curve to the final blend amount (typically front-loaded so it ramps in quickly as the ground gets close).

### Landing-recovery clip choice
**Not present in this C++ file at all.** The fall-speed→`Land_Light` vs heavier-landing clip selection lives in AnimGraph transition rules (not extracted here). The only concrete fall-speed breakpoints in the whole plugin are gameplay-side, in `AlsCharacter.cpp:522-527`: `Rolling.RollingOnLandSpeedThreshold = 700 cm/s` and `Ragdolling.RagdollingOnLandSpeedThreshold = 1000 cm/s` (both features **CUT for M3** per ROADMAP). `InAirState.VerticalVelocity` at landing is the only signal C++ exposes for driving this choice.

**Web-port mapping:** jump play-rate scaling and vertical-velocity tracking → `actionArbiter`/`InAirState`-equivalent record fields, direct port. Ground prediction → **flag as approximated**: it depends on a physics-engine capsule sweep against arbitrary level geometry with a walkable-normal check — Rapier can do this (`world.castShape`), so it's buildable as a new pure-ish module (`groundPrediction.ts`, sweep math is pure; the actual cast is an R3F/Rapier wiring concern, same split as `footIk.ts`/`ikChain.ts`), but it is new work, not a transplant, and needs the `GroundPredictionAmountCurve`/`GroundPredictionBlock` curve data from M2. Land-recovery clip selection by fall speed has **no C++ source of truth to replicate** — author your own thresholds (700/1000 cm/s from the cut ragdoll/roll features are a reasonable starting anchor for "light vs heavy landing" even though those specific features are cut) and treat it as original design, not a port.

---

## 8. Pose curves catalog + Sprint/HipsDirectionLock/ViewBlock usage

All curve names from `Public/Utility/AlsConstants.h:64-196` (values shown are the `TEXTVIEW` string, `AlsConstants.h:306-558`), cross-referenced to every read site found:

| Curve | Read at | Drives |
|---|---|---|
| `PoseGait` | `RefreshPose`, cpp:336 | GaitAmount + Walking/Running/Sprinting/Unweighted splits (§1) — **consumed only inside `AlsAnimationInstance`**, not read anywhere else in C++; the AnimGraph blend-multi nodes for gait blending are graph-side. |
| `PoseMoving` | `RefreshPose`, cpp:334 | `PoseState.MovingAmount` — **read nowhere else in this C++**; purely an AnimGraph blend-space input (e.g. blending an idle-vs-moving additive), no formula recoverable here. |
| `PoseStanding` / `PoseCrouching` | `RefreshPose`, cpp:331-332 | Same — raw pass-through state, consumed by AnimGraph stance blending, not further processed in C++. |
| `PoseGrounded` / `PoseInAir` | `RefreshPose`, cpp:328-329 | `PoseGrounded` is the *only* curve with a downstream C++ formula: it's the denominator in the `UnweightedGaitAmount` "un-weighting" trick (§1, cpp:344-346). `PoseInAir` otherwise just a pass-through, presumably the complementary AnimGraph blend weight to Grounded. |
| `HipsDirectionLock` | `RefreshGroundedMovement`, cpp:823 | `GroundedState.HipsDirectionLockAmount = clamp(curve, -1, 1)`. **The `HipsDirection` enum itself (`Forward/Backward/Left*/Right*`) is set exclusively via `SetHipsDirection()`, a `BlueprintCallable` called from the AnimGraph** (`AlsAnimationInstance.h:232`, `385`) — i.e. the state machine decides the discrete direction and only uses this curve as a **continuous blend-lock amount** layered on top (presumably locking the hips to their current facing while this curve ramps toward 1, so 180°-reversal pivots don't snap the hip yaw). No further C++ formula exists; the actual lock-blend math is AnimGraph-side. |
| `SprintBlock` | `RefreshStandingMovement`, cpp:929 | `StandingState.SprintBlockAmount = clamp01(curve)` — gates the sprint-acceleration-lean logic immediately below it (cpp:931-951): while `Gait==Sprinting`, tracks `SprintTime` since sprint start and only applies `SprintAccelerationAmount = GetRelativeAccelerationAmount().X` for the first **0.5s** (`SprintTimeThreshold`) of a sprint, zero after — this produces a brief forward-lean "digging in" pose at sprint-start only. `SprintBlockAmount` itself is stored but not consumed further in this file — it's an AnimGraph multiplier (presumably suppresses sprint-lean blending during e.g. a sprint-start transition montage). |
| `ViewBlock` | `RefreshView`, cpp:373 | `ViewAmount = 1 - clamp01(curve)`; feeds both Look (`LookAmount = ViewAmount·(1-AimingAmount)`, §5) and Spine (`SpineBlendAmount = ViewAmount·AimingAmount`, §5) as the shared "how much is the AnimGraph currently suppressing all head/spine aiming" gate (e.g. forced to 0 during certain full-body montages). |
| `AllowAiming` | `RefreshView`, cpp:374 | `AimingAmount = clamp01(curve)` — the complementary split between Look and Spine described above. |
| `AllowTransitions` | `RefreshTransitions`, cpp:1481 | §6 gate, binary (full-weight check only). |
| `FootLeft/RightIk`, `FootLeft/RightLock` | `RefreshFoot`/`RefreshFootLock`, cpp:1172, 1242 | §3, foot-lock primary driver. |
| `FootPlanted` | `RefreshFeet`, cpp:1157 | `FeetState.FootPlantedAmount`, clamp **[-1,1]** — sign selects which foot, magnitude is planted(<0.5)/lifting(>0.5) (comment cpp:55-58). Not further processed in C++; feeds AnimGraph foot-plant-driven logic (e.g. dynamic transition timing, footstep notify gating) elsewhere. |
| `FeetCrossing` | `RefreshFeet`, cpp:1158 | `FeetState.FeetCrossingAmount = clamp01(curve)` — stored, not further processed here; AnimGraph-side (likely biases foot-crossing-avoidance IK). |
| `RotationYawSpeed` | Read in `AlsCharacter.cpp:1800`, **not** in AnimationInstance | §2 — direct actor-yaw driver. |
| `GroundPredictionBlock` | `RefreshGroundPrediction`, cpp:1042 | §7 allowance gate. |
| `SprintBlock`/all `Layer*` curves | `RefreshLayering`, cpp:264-311 | Raw pass-through into `LayeringState` (Head/Arm(L/R)/Hand(L/R)/Spine/Pelvis/Legs, each with base + Additive/Slot/LocalSpace variants) — zero formula in C++, these are per-region overlay blend weights authored directly on overlay-pose clips, consumed by the AnimGraph's layered-blend-per-bone nodes. **This is exactly what ROADMAP M3's region-overlay item wants**: "SEED rule alphas from the overlay assets' authored `Layer*` curves... don't hand-tune from scratch" — confirms these curves are literally the region-overlay rule weights and should map 1:1 onto `regionOverlays.ts` rule `weight` functions once extracted. |
| `FootstepSoundBlock` | not referenced in `AlsAnimationInstance.cpp` at all | Presumably consumed by `AlsAnimNotify_FootstepEffects` (`Public/Notifies/`) directly from the anim notify system, out of scope for this spec. |

**Web-port mapping:** `PoseGait`/`PoseMoving`/`PoseStanding`/`PoseCrouching`/`PoseGrounded`/`PoseInAir` → these are almost entirely raw AnimGraph blend-weight passthroughs with only one real C++ formula (`UnweightedGaitAmount`); the web port's `weightTable.ts` already **is** the graph description that would consume these, so once M2 extracts them, wire them as additional `WeightTableInput` fields rather than trying to reverse-engineer AnimGraph blend nodes that aren't in this checkout. `Layer*` → `regionOverlays.ts` rule weights, direct and well-specified (per ROADMAP's own plan). `HipsDirection` enum's *decision logic* (which of the 6 discrete directions) is **not recoverable from C++** — it's AnimGraph state-machine logic; flag as needing either UE-editor inspection of the ABP graph or original design (a reasonable approximation: derive it from `GroundedState.MovementDirection` (Forward/Backward/Left/Right, which *is* computed in C++ at cpp:833-849 via `UAlsMath::CalculateMovementDirection`, forward half-angle 70°, threshold 5°) crossed with a forward/backward split, since the enum's 6 values look exactly like that cross-product).