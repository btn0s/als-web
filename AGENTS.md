# AGENTS.md

**The standalone web port of ALS Refactored** (the C++ rework of Advanced Locomotion System) on
React Three Fiber — UE4-mannequin-skeleton-native (SK_Als), built as a reference repo / template.
ALS-grade locomotion on the web IS the deliverable; gameplay layers (stealth etc.) happen in
downstream forks, in later sessions — not here. `ROADMAP.md` is the authoritative plan — read it
before feature work.

## Ground rules

- **ALS fidelity over convenience:** the point is to stay as true as possible to ALS — even when
  that means inventing systems and tooling that don't exist for three.js yet (editor-free .uasset
  extraction, curve-driven layering, an owned pose-buffer runtime). Inventing the missing tooling
  IS the project; it's a net good for web gamedev and animation tooling. When a shortcut and a
  faithful mechanism compete, port the mechanism.
- **Spec-gap resolution order (user 2026-07-23):** when ALS's C++ has no constant/formula for
  something, the answer is almost always in ALS's CONTENT — authored transition clips, Pose*/
  Layer* curves, blend settings in data assets — or in the AnimGraph conventions the spec flags.
  Look there FIRST. The sibling repo's solutions are a last resort, flagged loudly as shims with
  a scheduled replacement — "the sibling did X" is never, by itself, a justification.
- **Naming parity (user 2026-07-23):** anything with an ALS analog uses ALS Refactored's exact
  name, so an ALS-fluent reader has zero onboarding: Gait Walking/Running/Sprinting (never
  "jog"), Stance Standing/Crouching, RotationMode VelocityDirection/ViewDirection/Aiming,
  LocomotionMode Grounded/InAir, LocomotionAction Mantling/Rolling/GettingUp, VelocityBlend,
  GaitAmount, curve names verbatim (FootLeftLock, RotationYawSpeed, …). Concepts ALS doesn't
  have are DEFERRED BY DEFAULT to the downstream stealth fork (user 2026-07-23) — crawl/prone/
  sneak/tuck don't live here at all; unused sibling vocabulary is deleted on contact, not renamed.
- **Docs philosophy:** code speaks for itself. ROADMAP.md (plan) + this file (orientation) are
  the only standing docs; design rationale lives in code comments at the relevant site. No
  spec/history markdown files.
- **Fix quality bar:** land fixes at the existing architectural seam, in the codebase's idiom.
  No reward hacks (no test special-casing, no symptom suppression). Deliberately scoped tactical
  patches are fine when the real fix is scheduled — say so and name the trade.
- **Licensing guardrail:** never ship Epic-published content (Manny/Quinn packs, MetaHumans —
  Epic-designated UE-only). ALS Refactored's assets are cleared under its MIT (settled 2026-07-23,
  see ROADMAP guardrails; ship the upstream notice). Purchased Fab content is gitignored, never
  committed. Verify per-listing before any new asset enters the pack.
- **Playtesting:** the user playtests feel LIVE in the browser — no headless feel-comparison
  smokes beyond the sanctioned Playwright gate.

## Sibling reference — `../exposure-r3f`

The architecture was pioneered there on a UE4-style rig and is transplanted here (see ROADMAP M1):
pure weight table (anti-T-pose coverage invariant), declarative region-overlay rules with
ride-alphas, track-mask regions (prefix-based), action arbiter with exactly-once exit cleanup,
pose-based camera. Treat that repo as read-only reference; improvements flow forward into this
one. Where the sibling worked around missing authored data (measured-gait foot locking,
root-motion stride measurement), this repo uses ALS's authored data instead (FootLock curves,
AlsMovementSettings speeds) — see the ROADMAP architecture-review notes.

**Animation applier (decision 2026-07-23):** an OWNED pose-buffer runtime — sample clips into
typed-array local-pose buffers, blend in pose space (per-bone masks, additive, mesh-space
capable), write the skeleton once per frame — replaces `THREE.AnimationMixer` from M3 on
(`vibe-stack/ggez` anim-core is the pattern reference, not a dependency). The pure modules above
are the graph description and drive it unchanged. The mixer-era constraints the sibling designed
around (no per-bone blend API; PropertyMixer blending weight shortfalls toward BIND POSE, forcing
the ~1 coverage invariant; the single complementary montage gate) are RETIRED with the mixer —
coverage survives as a debug assertion, not a survival rule. Until the runtime lands, the M1
mixer applier (`useLocomotionRig` + track-filter masking) is what runs.

## Stack

Vite react-ts · React 19 · @react-three/fiber · drei · @react-three/rapier · zustand · leva ·
vitest (pure logic, `include: src/**` only) + one Playwright smoke. Package manager: pnpm.
