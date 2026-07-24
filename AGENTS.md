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
- **Single source of truth (user 2026-07-23):** every system derives from ALS Refactored's own
  source and content — the plugin C++ (clone at `~/.cache/als-extract/ALS-Refactored-4.15`), its
  authored clips/curves/data assets, and the extracted math spec. When the C++ has no constant,
  the answer is almost always in CONTENT (authored transition clips, Pose*/Layer* curves, data
  assets) — look there FIRST. Referencing any other local project's implementation is
  prohibited. If ALS genuinely has no answer, design from first principles and flag the decision
  loudly as original.
- **Naming parity (user 2026-07-23):** anything with an ALS analog uses ALS Refactored's exact
  name, so an ALS-fluent reader has zero onboarding: Gait Walking/Running/Sprinting (never
  "jog"), Stance Standing/Crouching, RotationMode VelocityDirection/ViewDirection/Aiming,
  LocomotionMode Grounded/InAir, LocomotionAction Mantling/Rolling/GettingUp, VelocityBlend,
  GaitAmount, curve names verbatim (FootLeftLock, RotationYawSpeed, …). Concepts ALS doesn't
  have are DEFERRED BY DEFAULT to the downstream stealth fork (user 2026-07-23) — crawl/prone/
  sneak/tuck don't live here at all; legacy non-ALS vocabulary is deleted on contact, not renamed.
  **Parity extends to the file tree**: `src/als/` mirrors `Source/ALS/` 1:1 as closely as the
  stack allows — same directory names and casing (`Settings/`, `State/`, `Utility/`, `AlsCamera/`
  as its module), same file names (`AlsMovementSettings.ts` ↔ `AlsMovementSettings.h`), the
  `Refresh*` families living under `AlsAnimationInstance`. TS has no Public/Private header split —
  mirror the `Public/` tree shape. The two honest deviations are labeled: `AnimGraph/` (UE keeps
  this in Blueprint content; ours must be code) and `src/engine/` (UE's animation runtime itself,
  which the plugin doesn't own either). New systems land at their mirrored path or not at all.
- **Discovery once, determinism forever:** agent reasoning is for uncertainty — cracking a
  format, probing an asset, root-causing a bug. And before burning discovery on a problem at
  all, check whether it's ALREADY solved: search for existing libraries, tools, and prior art
  first (this repo exists because CUE4Parse had already solved uasset parsing, gltf-transform
  had solved GLB authoring, and ggez had proven the pose-buffer pattern — verify license and
  quality, prefer proven code as a dependency or a pattern reference over reinvention). The moment a behavior is understood and
  repeatable, capture it where no one pays for it again: a script (`run.sh`, one command per
  pack), a validator that asserts the invariant (`validate-glb.mjs`, the test suites), a data
  file (`clips.manifest`), a persisted research doc consumed as fact by later work, or a rule in
  this file. Never re-derive what a previous session already verified — cite it. If you catch
  yourself re-solving a solved problem, the correct output is the tool/check that makes the
  re-solving impossible, not the solution itself.
- **Conclusions must be falsifiable by something they didn't author:** a single discovery loop
  can overcorrect on something it thinks it saw. Every conclusion therefore ships with an
  independent, cheap, decisive check derived from ground truth (a physical invariant, the
  authoritative artifact, a known constant) — never from the discovery's own reasoning chain —
  and lands in a validator/test so it stays checked. Research reports separate VERIFIED (cite
  the evidence) from HYPOTHESIS (state how to test it); downstream work treats hypotheses as
  tests to run, not facts to build on. Corrections to working state require reproducing the
  actual defect first — pattern-matching a known problem is not evidence. (Precedents: winding
  "fix" reversed by a signed-volume test; mesh location hypothesis corrected by human-scale
  vertex bounds; stale-dump curve conclusion overturned by reading the shipped GLB.)
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

## Architecture

The substrate is a set of PURE, framework-free modules (vitest-tested in isolation): the weight
table (per-clip effective weights as one explicit function — the web-native form of the AnimGraph's
implicit blend math), declarative region-overlay rules with ride-alphas, track-mask region
predicates, an action arbiter with exactly-once exit cleanup, velocity blend, blendspace/cadence
math, and a pose-based camera on ALS's root+head pivot. Where ALS ships authored data (FootLock
curves, AlsMovementSettings speeds, Pose* transition ramps), this repo consumes that data — never
re-derived heuristics.

**Animation applier (decision 2026-07-23):** an OWNED pose-buffer runtime — sample clips into
typed-array local-pose buffers, blend in pose space (per-bone masks, additive, mesh-space
capable), write the skeleton once per frame — replaced `THREE.AnimationMixer`
entirely (landed 2026-07-23). The pure modules above are the graph description and drive it. The
mixer-era constraints (no per-bone blend API; PropertyMixer blending weight shortfalls toward
BIND POSE; the single complementary montage gate) are RETIRED — under-coverage normalizes with a
dev warning; per-bone masks, additive, and mesh-space blending are native evaluator operations.

## Stack

Vite react-ts · React 19 · @react-three/fiber · drei · @react-three/rapier · zustand · leva ·
vitest (pure logic, `include: src/**` only) + one Playwright smoke. Package manager: pnpm.
