# AGENTS.md

**The standalone web port of ALS Refactored** (the C++ rework of Advanced Locomotion System) on
React Three Fiber — UE4-mannequin-skeleton-native (SK_Als), built as a reference repo / template.
ALS-grade locomotion on the web IS the deliverable; gameplay layers happen in
downstream forks, in later sessions — not here. `ROADMAP.md` is the authoritative plan — read it
before feature work.

## Ground rules

- **ALS is the single source of truth:** every system derives from ALS Refactored's own source
  and content — the plugin C++ (clone at `~/.cache/als-extract/ALS-Refactored-4.15`), its authored
  clips/curves/data assets, and the extracted references IN THIS REPO:
  `src/als/AlsAnimationInstance.reference.md` (per-frame math, formulas/constants/curves) and
  `scripts/extract-als/PLAYBOOK.md` (uasset serialization decision tree). When the C++ has no
  constant, the answer is almost always in CONTENT (transition clips, Pose*/Layer* curves, data
  assets) — look there first. Referencing any other local project's implementation is prohibited.
  If ALS genuinely has no answer, design from first principles and flag it as original. When a
  shortcut and the faithful mechanism compete, port the mechanism — inventing missing three.js
  tooling IS the project.
- **Naming parity (user 2026-07-23):** anything with an ALS analog uses ALS Refactored's exact
  name, so an ALS-fluent reader has zero onboarding: Gait Walking/Running/Sprinting (never
  "jog"), Stance Standing/Crouching, RotationMode VelocityDirection/ViewDirection/Aiming,
  LocomotionMode Grounded/InAir, LocomotionAction Mantling/Rolling/GettingUp, VelocityBlend,
  GaitAmount, curve names verbatim (FootLeftLock, RotationYawSpeed, …). Concepts ALS doesn't
  have are DEFERRED BY DEFAULT to downstream forks (user 2026-07-23) — crawl/prone/
  sneak/tuck don't live here at all; legacy non-ALS vocabulary is deleted on contact, not renamed.
  **Parity extends to the file tree**: `src/als/` mirrors `Source/ALS/` 1:1 as closely as the
  stack allows — same directory names and casing (`Settings/`, `State/`, `Utility/`, `AlsCamera/`
  as its module), same file names (`AlsMovementSettings.ts` ↔ `AlsMovementSettings.h`), the
  `Refresh*` families living under `AlsAnimationInstance`. TS has no Public/Private header split —
  mirror the `Public/` tree shape. The two honest deviations are labeled: `AnimGraph/` (UE keeps
  this in Blueprint content; ours must be code) and `src/engine/` (UE's animation runtime itself,
  which the plugin doesn't own either). New systems land at their mirrored path or not at all.
- **Don't re-solve solved problems:** before any discovery, check for prior art (libraries,
  tools, earlier session findings — cite, don't re-derive). Once a behavior is understood and
  repeatable, freeze it into a script, validator, data file, or rule so nobody pays for the
  reasoning again.
- **Discovery claims and corrections need independent verification:** a single discovery loop
  can overcorrect on something it thinks it saw. Verify conclusions with a cheap check derived
  from ground truth, not from the discovery's own reasoning (precedent: a theory-driven winding
  "fix" was reversed by a signed-volume test). Research reports separate VERIFIED (evidence
  cited) from HYPOTHESIS (how to test it); corrections to working state require reproducing the
  actual defect first. Ordinary code changes are covered by the test gates — this rule is for
  discovery and fixes, not ceremony.
- **Docs philosophy:** code speaks for itself. ROADMAP.md (plan) + this file (orientation) are
  the only standing PROSE docs; design rationale lives in code comments at the relevant site.
  One carve-out (user 2026-07-23): EXTRACTED REFERENCE data from ALS source/recon lives in-repo
  next to its subject (`AlsAnimationInstance.reference.md`, `extract-als/PLAYBOOK.md`,
  `clips.manifest`, `props.manifest`) — fresh sessions and sandboxed agents have no session
  memory, so load-bearing verified knowledge persists in the repo or it doesn't exist. No
  history/decision-log markdown.
- **Fix quality bar:** land fixes at the existing architectural seam, in the codebase's idiom.
  No reward hacks (no test special-casing, no symptom suppression). Deliberately scoped tactical
  patches are fine when the real fix is scheduled — say so and name the trade.
- **Licensing guardrail:** never ship Epic-published content (Manny/Quinn packs, MetaHumans —
  Epic-designated UE-only). ALS Refactored's assets are cleared under its MIT (settled 2026-07-23,
  see ROADMAP guardrails; ship the upstream notice). Purchased Fab content is gitignored, never
  committed. Verify per-listing before any new asset enters the pack.
- **Agent sandboxes cannot bind ports.** Never run `pnpm e2e`, launch dev servers, or attempt
  browser checks from an agent sandbox — they fail with EPERM after wasted effort, every time.
  Agent gates are exactly `pnpm test` + `pnpm build` (or `pnpm check` once it exists); browser
  verification is the orchestrator's job, outside the sandbox. State in your report that e2e was
  left to the orchestrator and move on.
- **Playtesting:** the user playtests feel LIVE in the browser — no headless feel-comparison
  smokes beyond the sanctioned Playwright gate.

## Parity debugging field guide

Trace animation defects through the actual pipeline:

`ALS source/content → extracted channels/curves → clip sampler → AnimGraph stages → Control Rig → pose publication → rendered mesh / camera / physics`

Do not skip directly from “the source clip is correct” to “the runtime is correct.” Preserve a
reproduction at the first bad boundary and add the cheapest independent check there.

| Symptom / trap | Where to look and how to prove it |
| --- | --- |
| A left/right limb looks copied even though the GLB tracks differ | Raw-channel parity proves extraction only. Compare the left and right chains before Layering, after Layering, after Control Rig, and after publication. Use component-space transforms for visual pose comparisons; mirrored skeleton locals are not directly comparable. `pnpm diagnose:animation rifle --json` also checks the shipped arm channels against a fresh CUE4Parse dump. |
| An “expected vs actual” pose reports zero delta but the screen is wrong | Check whether both sides call the same evaluator. That is a circular oracle. Derive the expected result independently from serialized pins/topology, source keys, or a geometric invariant; compare immediately before and after the suspected stage. |
| Control Rig elbows, knees, poles, or twist axes point into the wrong plane | Authored Control Rig constants are in Unreal space. At the asset boundary, vectors map `(X,Y,Z) → (X,Z,Y)`, locations also convert centimetres to metres, and rotations use the extractor's reflected-basis conjugation. Keep checked-in oracle constants in Unreal units and convert once when compiling the evaluator. |
| A virtual-bone target appears cross-wired | SK_Als's hand VBs intentionally use cross-hand chains. Verify `ALS_VIRTUAL_BONES` against `scripts/extract-als/hand-virtual-bones.json`, then inspect compiled source/target indices and component transforms. Generate VB locals on each sampled source pose before blending; do not regenerate them after LayeredBoneBlend or before `CR_Als`, because that erases the authored target offsets. |
| A transition flashes a strange pose for exactly one frame | Capture the frame before entry, the entry frame, and the next frame. `AnimationFrameCapture` reports triangle-inequality pose detours and the worst bone; `authoredStanceTransitionBoundaries.test.ts` is the stance-transition precedent. Inspect newly relevant player initialization/reset, same-frame curve ownership, inertialization requests, and graph evaluation order before blaming the clip. |
| Crouch, Roll, or another action floats while standing still | Bone/socket heights are not mesh contact. Measure deformed skinned-mesh `minY` over the transition/action with `captureSkinnedMeshWorldBounds`; compare authored clip, reconstructed graph pose, and published runtime pose. Also separate capsule/base movement from skeletal root/pelvis motion. |
| An action pose gets a large pelvis/leg offset or the wrong additive base | Gameplay `Stance` and the animation's published `PoseStanding`/`PoseCrouching` curves can intentionally disagree during transitions and actions. Layering and dynamic-additive reference poses must follow the same-frame published `PoseState`, not a requested controls value. Roll is the regression precedent. |
| Roll moves visually but contact/root travel disagrees | Root-lock pose sampling and extracted root motion are separate channels. Compare the root-locked authored pose, reconstructed mesh-space additive, consumed root-motion delta, and body displacement. Consume root motion exactly once; apply the notify-authored translation scale to translation only. |
| Breathing/overlay state disappears during turn-in-place or another montage | Look for a full-body replacement where ALS uses `PostLocomotion` followed by Layering/slots. Inspect final per-bone effective weights and same-frame `Layer*`, additive, and slot curves. A correct turn/action owns only its authored stage/regions; idle and overlay contributions continue elsewhere. |
| A held prop stays near the hand but does not follow its bones | Verify the authored attachment target and timing, not a one-time world transform. Rifle defaults to identity `SnapToTarget` on `VB hand_r_to_ik_hand_gun`; resolve its component transform after pose publication. Check the fallback socket only when the authored gun-bone setting disables the VB path. |
| Turning the actor makes the camera turn it again forever | Audit the one-way frame order in `ALS_FRAME_PRIORITY`: ControlRotation → Physics → MeshBase → Animation → PosePublication → Camera. Camera view is an input to character facing, while the final camera reads the pose pivot; actor yaw must not be fed back as new camera-input yaw in the same frame. |
| Debugging leaves the machine full of Chrome helpers | Agents do not launch browser feel-checks. Run `pnpm process-hygiene:agent-browser` to list old agent-browser daemon roots; use `--terminate` only for its re-verified matches. Never broadly kill Chrome/Chromium processes—the user's live playtest browser is outside that scope. |

For animation triage, start with `pnpm diagnose:animation all`; it runs in-process without a
browser or bound port and reports the first failing stage, ranked bones/regions, left/right
collapse, and ground contact instead of dumping raw arrays. Finish deterministic changes with
`pnpm check`; live browser verification remains the orchestrator's final gate.

## Architecture

The substrate is a set of PURE, framework-free modules (vitest-tested in isolation): the weight
table (per-clip effective weights as one explicit function — the web-native form of the AnimGraph's
implicit blend math), declarative region-overlay rules with ride-alphas, track-mask region
predicates, an action arbiter with exactly-once exit cleanup, velocity blend, blendspace/cadence
math, and a pose-based camera on ALS's root+head pivot. Where ALS ships authored data (FootLock
curves, AlsMovementSettings speeds, Pose* transition ramps), this repo consumes that data — never
re-derived heuristics.

**`src/engine/` is a game-engine animation runtime, not a helper library** (user 2026-07-23):
three.js is a renderer, not a game engine — every runtime capability UE gave ALS for free (pose
evaluation, per-bone blending, additives, sync groups/markers, inertialization, montage/slot
semantics, root motion, curve sampling) gets BUILT here as the need lands. An engine gap is a
work item, never a reason to approximate the ALS mechanism away.

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
