# CLAUDE.md

Web port of **ALS Refactored** (UE5-native Advanced Locomotion System) on React Three Fiber,
built UE5-Manny-skeleton-native as a reference repo / template, with stealth layered on later.
`ROADMAP.md` is the authoritative plan — read it before feature work.

## Ground rules

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
ride-alphas, track-mask regions (prefix-based — already UE5-bone-correct), action arbiter with
exactly-once exit cleanup, pose-based camera, measured-gait foot-locking. Treat that repo as
read-only reference; improvements flow forward into this one.

Key three.js constraints (verified against source, documented in that repo's trackMask.ts /
slotMontage.ts / proceduralPose.ts headers): no per-bone blend API — masking = track filtering;
PropertyMixer blends weight shortfalls toward BIND POSE, so the base layer must cover every bone
at total weight ~1; a single complementary gate for montages; additive/procedural layers apply
post-mixer in one ordered frame callback.

## Stack

Vite react-ts · React 19 · @react-three/fiber · drei · @react-three/rapier · zustand · leva ·
vitest (pure logic, `include: src/**` only) + one Playwright smoke. Package manager: pnpm.
