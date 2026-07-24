# ROADMAP.md — als-ue5-r3f

A web port of **ALS Refactored** ([Sixze/ALS-Refactored](https://github.com/Sixze/ALS-Refactored),
the C++ rework of Advanced Locomotion System) on React Three Fiber: **the standalone web port of
ALS** (scope sharpened 2026-07-23) — a reference repo / template whose deliverable is ALS-grade
locomotion on the web, full stop. Gameplay layers (stealth etc.) are downstream projects that
fork this, not milestones here.

**Operating principles (inherited):** code speaks for itself — this file plus a lean CLAUDE.md are
the only docs; design rationale lives in code comments. Fix quality bar applies (land at the seam,
in-idiom, no reward hacks, name the trades). Burn debt on a system before the feature wave that
touches it.

---

## M0 — Scaffold + character  *(closed 2026-07-23)*

- [x] Vite `react-ts` scaffold; three / R3F / drei / rapier / zustand / leva; vitest + playwright
- [x] **Character lands: `SKM_Als` from ALS Refactored** (MIT, licensing settled 2026-07-23 — see
      guardrails), via `scripts/extract-als/run.sh` (CUE4Parse dump → GLB assembly, editor-free).
      **Named trade:** body is a bone-proxy (box-per-segment) — real `SKM_Als` geometry is editor
      native-bulk CUE4Parse can't read; parser scheduled in M2. Skeleton + idle are the real data.
- [x] Character renders in a Canvas playing the idle; orbit cam; vitest (5) + one Playwright smoke
      green (vitest `include: src/**` — the e2e/vitest spec-pattern collision trap is handled)

**Exit met:** extracted character idles on screen (`__characterStatus === 'glb'`); test gates green.
60fps is a live-playtest check, per ground rules.

**Discovery that bends the premise:** `SK_Als` is UE4-mannequin layout (68 bones, spine_01–03,
neck_01) even at tag 4.17/UE 5.7 — ALS Refactored never adopted the UE5 Manny skeleton. The
"UE5-skeleton-native, Fab drops in with no retargeting" bet does not hold for ALS content itself;
UE5-native packs (TSO) will need the scripted retarget now listed in M2.

---

## M1 — Land the pure-module core

- [x] `weightTable` (invariant grid tests green) · `regionOverlays` (rules on ALS clips) ·
      `trackMask` (prefixes verified against the SK_Als dump) *(2026-07-23)*
- [x] `blendspace` · `actionSequence` · `actionArbiter` · `slotMontage` · `scrubbedPose` ·
      `proceduralPose` · `footIk` + `ikChain` — landed with tests green *(2026-07-23)*
- [x] `locomotionProfile` on ALS authored constants (`AlsMovementSettings.h` / `MS_Als_Normal`:
      walk 1.75, run 3.75, sprint 6.5 m/s, crouch 1.5/2.0; stride = speed × duration) *(2026-07-23)*
- [ ] Pose-based camera (poseHeight publish + self-calibrating pivot) and the reticle-true zoom
- [ ] Dev tooling: test hooks (`__triggerJump`, `__playClip`; `__setSpeed` + `__weightTable`
      landed with the M1 proof), capture scripts, Leva root taxonomy
      (Camera / Movement / Animation / Sandbox / Debug)

**Exit:** transplanted test suite green; character walks under the weight table with one region
rule active as proof. *(Proof landed 2026-07-23: Leva-driven speed crossfades idle/walk/jog per
the blendspace, sprint-arms region rule rides the jog — verified via `__weightTable` in-browser.
Remaining for M1 close: locomotionProfile re-point, pose-based camera, rest of dev tooling.)*

---

## M2 — Content pipeline (the point of the UE5 bet)

- [x] Extraction path: **editor-free, no UE install** (decided + proven 2026-07-23). CUE4Parse (.NET,
      cross-platform incl. macOS arm64) reads the repo's loose `.uasset`s directly; export mesh +
      anims (glTF or psk/psa/ueformat → Blender batch import → GLB). One command per pack.
      If CUE4Parse lags the plugin's engine target (4.17 → UE 5.7), pin an older plugin release
      (e.g. 4.15 → UE 5.5) — the content is identical for our purposes.
- [x] **ALS Refactored's animation set** extracted — 67 curated clips via clips.manifest
      *(2026-07-23; licensing settled: the repo's
      blanket MIT names the full author lineage — Sixze, Longmire, Yanıkoğlu — and covers its
      assets; upstream notice ships as `LICENSE-ALS-Refactored.md` beside ported assets)*
- [x] **Animation float curves extracted** — 161 curves across 53/67 clips as glTF animation
      extras, +25KB *(2026-07-23)*. (Architecture review: ALS's runtime is
      curve-driven — `AlsConstants.h` names them all: `FootLeft/RightLock`/`Ik`, `RotationYawSpeed`
      (turn-in-place timing), `AllowTransitions`, `SprintBlock`, `Pose*`, per-region `Layer*`
      alphas (incl. `Additive`/`LocalSpace` variants). They live in the same AnimDataModel Dump.cs
      already parses.) M3 turn-in-place, foot locking, and transitions now have their authored
      data; foot locking consumes the authored `FootLock` curves
- [x] **Real `SKM_Als` geometry** *(2026-07-23)*: geometry turned out to live INLINE in the
      USkeletalMesh export (behind an extra strip-flags field CUE4Parse skips), not in
      SkeletalMeshEditorData (that holds Oodle-compressed import data). 10,273 verts / 16,544
      tris / 15 sections / 1.834m; rigid per-section skinning (max 1 influence — segmented
      mannequin). Named trade: authored tangents don't decode yet (constant bytes); assembler
      computes smooth area-weighted normals from geometry instead — revisit only if authored
      hard edges matter
- [x] **OUT OF SCOPE (scope sharpened 2026-07-23): anything that touches the skeleton.** The
      standalone port builds UE4-mannequin-native (SK_Als), period. The UE5 retarget/re-rig
      decision and the TacticalStealthOperation pack (stealth content) leave this repo with the
      stealth layer — they belong to downstream forks
- [x] `scripts/build-player-anims.mjs` equivalent — `run.sh` + `clips.manifest` + assembler IS
      the curated merge (single GLB, mesh + 67 clips + curves, root tracks preserved) *(2026-07-23)*
- [x] Clip audit doc-comment: `clips.manifest`, one line per clip keyed to M3 items *(2026-07-23)*

- [ ] **ABP AnimGraph dumper (added 2026-07-23 — build whatever the 1:1 port needs)**: the
      AnimGraph Blueprints are ALS's only non-legible substance — every shipped visual defect was
      a wrong reconstruction of graph semantics (overlay ownership, ik routing, bank frames, clip
      selection). Blueprint uassets serialize their compiled anim-node objects with readable
      tagged properties (proven piecemeal: ExplicitTimes, attach sockets, CDO flags); a pipeline
      stage walks AB_Als/AB_Als_Grounded/overlay ABPs/ALI interfaces and emits the graph as JSON —
      nodes, parameters, pose-link wiring, layered-blend-per-bone branch filters, state
      transitions, blend durations. Converts graph archaeology into lookups; feeds the parity
      harness's content oracle its ground truth

**Exit (revised):** one curated GLB (met 2026-07-23: 7.4MB, real mesh, 67 clips, 161 curves; every
clip binds by bone name; strides from authored speeds) + the ABP graph dump alongside it.

---

## M3 — ALS parity (the port proper)

ALS Refactored's taxonomy as the checklist, replicated as closely as the web stack allows —
data on the M1 substrate (weight-table entries, region rules, arbiter records), not new systems.
**Every item derives from ALS source/content ONLY**: the plugin C++ (formulas/constants per the
extracted math spec in session memory), the authored clips, and their curves. No constant without
a citation; spec gaps resolve from ALS content first, original design second (flagged) — never
from another project's implementation:

- [ ] **Owned pose-buffer animation runtime FIRST** (decision 2026-07-23 — no building M3 on the
      mixer): sample clips into typed-array local-pose buffers → blend in pose space (lerp/slerp
      with quaternion neighborhood, per-bone masked, additive local-space, mesh-space capable) →
      write skeleton once + root-motion delta. ggez (`vibe-stack/ggez` anim-core/anim-runtime,
      MIT) is the pattern REFERENCE, not a dependency — the math is small and we own it. The pure
      modules (weightTable, regionOverlays, blendspace, arbiter) are the graph description and
      drive the new applier unchanged; `useLocomotionRig` re-points; mixer-era machinery
      (`filterClipToBones` as applier, bind-pose coverage as a hard invariant) retires — coverage
      stays as a debug assertion, not a survival constraint. This LIFTS the mesh-space arm-layering
      approximation recorded below.
- [ ] Gaits: walk / run / sprint with authored speeds; stride warping if the clips demand it
- [ ] Stances: Standing / Crouching (prone/crawl deferred to the stealth fork — non-ALS concepts defer by default); stance ladder + staged transitions
- [ ] **Parity harness (added 2026-07-23 — before more systems build on unverified semantics)**:
      two oracles the implementation didn't author. (a) C++ DIFFERENTIAL: test-only, line-mirroring
      transliteration of AlsAnimationInstance's Refresh* functions; property sweeps assert our
      systems match within epsilon — catches math/constant/interp drift. (b) CONTENT-DERIVED POSE
      EQUIVALENCE: final poses must trace to the authored data path ALS would take (clip
      transforms, curves, extracted ABP ExplicitTimes as ground truth) — catches the
      content-semantics failure class the unit suite structurally cannot (the shipped rifle-overlay
      defects were all this class). Implementation tests remain as regression pins, not equivalence
      evidence
- [ ] **Character controller (`AlsCharacter` + movement component analog)**: WASD/gamepad input →
      acceleration/braking → velocity on a rapier capsule, feeding the existing VelocityBlend/
      gait inputs (today's Leva sliders become the debug override, not the source). All constants
      from ALS source/content: `MS_Als_Normal` gait speeds + `AlsMovementSettings` accel/braking/
      direction-dependent speeds; actor yaw consumes the `RotationYawSpeed` curve while
      grounded-and-not-moving (AlsCharacter.cpp:1798). Prereq for rotation modes + turn-in-place
      feeling real
- [ ] Rotation modes: VelocityDirection / ViewDirection / Aiming — real 8-way blendspaces
      from authored directional clips (not cardinal-blend approximation)
- [ ] Turn-in-place (authored Turn clips, scrubbed/arbitered) + start/stop/pivot transitions
- [ ] Overlay states: ALS-style item/pose overlays via region rules (masked, per-bone) — SEED
      rule alphas from the overlay assets' authored `Layer*` curves (dumped in M2), don't hand-tune
      from scratch. (Mesh-space arm layering: previously an accepted mixer limitation — the
      pose-buffer runtime above makes it implementable; do it if parity footage demands it)
- [ ] In-air: jump/fall with land recovery (`Land_Light`/`LandRoll` by fall speed)
- [ ] Mantle/vault through the arbiter (one clock: warp + montage share normalized progress)
- [ ] **Engine features the UE runtime provided for free (build as needed for parity feel)**:
      sync groups/markers (footfall-phase-synced gait blending — ALS relies on it; our crossfades
      don't sync yet), inertialization (UE's transition blending; we approximate with crossfades),
      montage blend semantics per the ABP dump
- [ ] Foot IK with pelvis adaptation (ALS's Control Rig stage: ground trace + spring-damped Z offset + slope alignment — constants in the math spec; the pelvis-combine formula is graph-side and flagged original-design)
- [ ] CUT for now: ragdoll, rolling physics blend, debug-camera parity — revisit on demand

**Exit:** parity harness green (measured equivalence) AND side-by-side with ALS Refactored
in-editor footage the web version reads as the same system. Template README records what's
parity, what's approximated, what's cut.

---

## M4 — Template hardening

- [ ] Strip experiment scaffolding; document the "add a pack / add a rule / add an action" paths
      in code comments at the extension seams
- [ ] Runtime pack budget: single animation GLB, lazy dev content, size target recorded
- [ ] This file trimmed to a maintenance doc; repo marked as the template baseline for new demos

**Exit:** a new prototype can fork this repo and have ALS-grade locomotion + the tuning surface
in under an hour.

---

## Out of scope — downstream forks

Stealth (exposure model, guards, TSO content) is DEFERRED OUT of this repo entirely (user
2026-07-23): this repo is the standalone web port of ALS, and M4 is its final milestone. Survey
notes for the stealth layer are preserved in session memory for whichever downstream fork picks
it up.

---

## Guardrails

- **Extraction scope facts (recon 2026-07-23, verified):** uncooked SoundWave assets contain NO
  audio payload (streaming bulk exists only in cooked builds) — footstep SFX must be sourced
  independently if ever wanted. Uncooked StaticMesh geometry needs a new custom bulk-data parser
  (real unstarted work — budget before scoping env props). OverlayObjects skeletal meshes parse
  via the existing probe-based shim, no changes expected. Full decision tree in session memory
  (uasset-serialization-playbook).

- **Never ship Epic-published content** (Manny/Quinn mannequin packs, MetaHumans, and other
  Epic-designated UE-only assets). Local experiments with Epic content stay local.
- **ALS Refactored content is cleared** (settled 2026-07-23): its blanket MIT — copyright Sixze,
  Longmire, Yanıkoğlu, and contributors — covers the repo's assets, meshes included. Usable and
  redistributable here; ship the upstream notice alongside.
- **Purchased Fab content stays out of the public repo** (anti-redistribution terms): TSO pack and
  any bought character are gitignored, acquisition documented as a setup step; deployed web
  bundles may include them ("inseparable part of a Project").
- Verify per-listing licenses on Fab before any new asset enters the curated pack.
- ALS Refactored is the design north star, not a code-port target: its C++/AnimGraph stays in UE;
  we replicate behavior on the pure-module substrate.

---

## Maintenance rules

- Check items off as they land; stamp milestones with date + commit on close.
- New debt goes in a TECH-DEBT.md when it earns one; this file only schedules.
