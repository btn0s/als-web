# ROADMAP.md — als-ue5-r3f

A web port of **ALS Refactored** ([Sixze/ALS-Refactored](https://github.com/Sixze/ALS-Refactored),
the C++ rework of Advanced Locomotion System) on React Three Fiber: **the standalone web port of
ALS** (scope sharpened 2026-07-23) — a reference repo / template whose deliverable is ALS-grade
locomotion on the web, full stop. Gameplay layers are downstream projects that
fork this, not milestones here.

**Operating principles (inherited):** code speaks for itself — this plan plus `AGENTS.md` are the
standing orientation; extracted ALS reference data lives beside its subject and design rationale
lives in code comments. Fix quality bar applies (land at the seam, in-idiom, no reward hacks,
name the trades). Burn debt on a system before the feature wave that touches it.

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
UE5-native clip packs would need a scripted retarget — deferred out with the skeleton decisions.

---

## M1 — Land the pure-module core

- [x] `weightTable` (invariant grid tests green) · `regionOverlays` (rules on ALS clips) ·
      `trackMask` (prefixes verified against the SK_Als dump) *(2026-07-23)*
- [x] `blendspace` · `actionSequence` · `actionArbiter` · `slotMontage` · `scrubbedPose` ·
      `proceduralPose` · `footIk` + `ikChain` — landed with tests green *(2026-07-23)*
- [x] `locomotionProfile` on ALS authored constants (`AlsMovementSettings.h` / `MS_Als_Normal`:
      Walking 1.75, Running 3.75, Sprinting 6.5 m/s, crouched Walking/Running 1.5/2.0);
      the live controller now evaluates the authored acceleration, braking, friction, and
      rotation-interpolation rich curves rather than tuning replacements *(2026-07-23)*
- [ ] Pose-based camera (poseHeight publish + self-calibrating pivot) and the reticle-true zoom
- [ ] Dev tooling: test hooks (`__triggerJump`, `__playClip`; `__setSpeed` + `__weightTable`
      landed with the M1 proof), capture scripts, Leva root taxonomy
      (Camera / Movement / Animation / Sandbox / Debug)

**Exit:** transplanted test suite green; character walks under the weight table with one region
rule active as proof. *(Proof landed 2026-07-23: the debug speed override crossfades
Idle/Walking/Running and the Sprinting-arms region rule rides Running — verified through
`__weightTable`. Remaining for M1 close: reticle-true camera zoom and the rest of dev tooling.)*

---

## M2 — Content pipeline (the point of the UE5 bet)

- [x] Extraction path: **editor-free, no UE install** (decided + proven 2026-07-23). CUE4Parse (.NET,
      cross-platform incl. macOS arm64) reads the repo's loose `.uasset`s directly; export mesh +
      anims (glTF or psk/psa/ueformat → Blender batch import → GLB). One command per pack.
      If CUE4Parse lags the plugin's engine target (4.17 → UE 5.7), pin an older plugin release
      (e.g. 4.15 → UE 5.5) — the content is identical for our purposes.
- [x] **ALS Refactored's complete referenced animation set** extracted — the union of every
      direct ABP sequence, authored BlendSpace sample/preview base, and animation-instance
      settings transition reference is 117 clips, pinned by `clips.manifest` and the cross-oracle
      validator
      *(2026-07-23; licensing settled: the repo's
      blanket MIT names the full author lineage — Sixze, Longmire, Yanıkoğlu — and covers its
      assets; upstream notice ships as `LICENSE-ALS-Refactored.md` beside ported assets)*
- [x] **Animation metadata extracted** — 361 float curves across 82/119 clips, 60 authored sync
      markers across 30 clips, and 162 notifies across 65 clips as glTF animation extras
      *(2026-07-23)*. (Architecture review: ALS's runtime is
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
      decision and any non-ALS clip packs leave this repo — they belong to downstream forks
- [x] `scripts/build-player-anims.mjs` equivalent — `run.sh` + `clips.manifest` + assembler IS
      the curated merge (single GLB, mesh + 119 clips + curves/markers/notifies, root tracks
      preserved) *(2026-07-23)*
- [x] Clip audit doc-comment: `clips.manifest`, one line per clip keyed to M3 items *(2026-07-23)*

- [x] **ABP AnimGraph dumper (2026-07-23)**: the
      AnimGraph Blueprints are ALS's only non-legible substance — every shipped visual defect was
      a wrong reconstruction of graph semantics (overlay ownership, ik routing, bank frames, clip
      selection). Blueprint uassets serialize their compiled anim-node objects with readable
      tagged properties (proven piecemeal: ExplicitTimes, attach sockets, CDO flags); a pipeline
      stage walks AB_Als/AB_Als_Grounded/overlay ABPs/ALI interfaces and emits the graph as JSON —
      nodes, parameters, pose-link wiring, layered-blend-per-bone branch filters, state
      transitions, blend durations. Converts graph archaeology into lookups; feeds the parity
      harness's content oracle its ground truth. The validator pins the exact 23-asset topology,
      all serialized node/link/index invariants, 24 state machines, and 304 transitions
- [x] **Movement content oracle (2026-07-23):** `MS_Als_Normal`'s 3 rotation modes × 2 stances
      plus all referenced acceleration/braking/friction and rotation-interpolation rich curves
      dump deterministically with their authored interpolation and tangent metadata
- [x] **BlendSpace content oracle (2026-07-23):** all nine ABP-referenced BlendSpaces dump their
      authored axes, interpolation parameters, samples, segments/triangles, and grid topology;
      the validator proves the 33 unique sample/preview-base sequences are in the GLB
- [x] **Input content oracle (2026-07-23):** `IMC_Als` dumps all 31 mappings / 13 actions with
      exact key, modifier order, and trigger metadata; the live bridge consumes that contract
      for the implemented controller actions

**Exit (revised):** one curated GLB (met 2026-07-23: 11,167,356 bytes / 10.65 MiB, real mesh,
117 clips, 361 curves, 60 markers, 162 notifies; every clip binds by bone name) plus the ABP,
BlendSpace, movement-settings, and input-mapping dumps alongside it.

---

## M3 — ALS parity (the port proper)

ALS Refactored's taxonomy as the checklist, replicated as closely as the web stack allows —
data on the M1 substrate (weight-table entries, region rules, arbiter records), not new systems.
**Every item derives from ALS source/content ONLY**: the plugin C++ (formulas/constants frozen in
`src/als/AlsAnimationInstance.reference.md`), the authored clips/curves, and the extracted content
oracles. No constant without a citation; spec gaps resolve from ALS content first, original design
second (flagged) — never from another project's implementation:

- [x] **Owned pose-buffer animation runtime FIRST** (landed 2026-07-23 — no M3 system rests on the
      mixer): sample clips into typed-array local-pose buffers → blend in pose space (lerp/slerp
      with quaternion neighborhood, per-bone masked, additive local-space, mesh-space capable) →
      write the skeleton once. Per-bone masks, local/mesh-space additives, authored curve
      evaluation, marker sync, and output inertialization are evaluator operations; normalized
      under-coverage warns in development. Authored root-motion delta consumption remains tracked
      with action montage semantics, not as a mixer-era limitation.
- [ ] Gaits: Walking / Running / Sprinting through the exact six-state grounded graph. Authored
      movement speeds, all nine BlendSpace topologies, graph state selection, per-bone
      MoveDirectionChange transition profiles, and sprint state wiring evaluate today;
      start/stop/pivot states remain open
- [x] Stances: Standing / Crouching with authored StandToCrouch/CrouchToStand transitions
      following their own PoseCrouching curves *(2026-07-23; non-ALS stance additions stay in
      downstream forks)*
- [x] **Parity harness (landed 2026-07-23 — before more systems build on unverified semantics)**:
      two oracles the implementation didn't author. (a) C++ DIFFERENTIAL: test-only, line-mirroring
      transliteration of AlsAnimationInstance's Refresh* functions; property sweeps assert our
      systems match within epsilon — catches math/constant/interp drift. (b) CONTENT-DERIVED POSE
      EQUIVALENCE: final poses must trace to the authored data path ALS would take (clip
      transforms, curves, extracted ABP ExplicitTimes as ground truth) — catches the
      content-semantics failure class the unit suite structurally cannot (the shipped rifle-overlay
      defects were all this class). Implementation tests remain as regression pins, not equivalence
      evidence
- [x] **Character controller (`AlsCharacter` + movement component analog)**: WASD/gamepad input →
      acceleration/braking → velocity on a rapier capsule, feeding the existing VelocityBlend/
      gait inputs (Leva/debug hooks are overrides, not the source). All policy constants
      from ALS source/content: `MS_Als_Normal` gait speeds + `AlsMovementSettings` accel/braking/
      direction-dependent speeds; actor yaw consumes the `RotationYawSpeed` curve while
      grounded-and-not-moving (`AlsCharacter.cpp:1798`). The numerical velocity integrator is
      explicitly ORIGINAL because ALS delegates it to UE; source-backed policy and live input
      lifecycle are covered by unit and Playwright gates *(2026-07-23)*
- [ ] Rotation modes: VelocityDirection / ViewDirection / Aiming — real 8-way blendspaces
      from authored directional clips (not cardinal-blend approximation). The complete authored
      `AB_Als_View` Look state machine is live in the exact Layering → View → CR_Als stage order,
      including its mesh-space additive, side-switch curves, and `LookDirectionChange` profile
      *(2026-07-24)*; directional locomotion remains open
- [x] Turn-in-place + rotate-in-place per spec constants, RotationYawSpeed drives yaw *(2026-07-23)*; start/stop/pivot transitions still open (quick-stop math transliterated, unwired)
- [x] Overlay states: curve-driven per-region layering + spawning overlay objects (Rifle end-to-end; full `AB_Als_Rifle` state/action graph live 2026-07-24) — original plan: SEED
      rule alphas from the overlay assets' authored `Layer*` curves (dumped in M2), don't hand-tune
      from scratch. (Mesh-space arm layering: previously an accepted mixer limitation — the
      pose-buffer runtime above makes it implementable; do it if parity footage demands it)
- [ ] In-air: jump/fall with land recovery (`Land_Light`/`LandRoll` by fall speed)
- [ ] Mantle/vault through the arbiter (one clock: warp + montage share normalized progress)
- [ ] **Engine features**: sync groups on authored Left/Right markers, final named-curve
      composition, and UE-style output inertialization landed *(2026-07-23)*; montage/slot blend
      semantics and authored root-motion handoff remain open
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

Gameplay systems beyond ALS locomotion are DEFERRED OUT of this repo entirely (user 2026-07-23):
this repo is the standalone web port of ALS, and M4 is its final milestone.

---

## Guardrails

- **Extraction scope facts (recon 2026-07-23, verified):** uncooked SoundWave assets contain NO
  audio payload (streaming bulk exists only in cooked builds) — footstep SFX must be sourced
  independently if ever wanted. Uncooked StaticMesh geometry needs a new custom bulk-data parser
  (real unstarted work — budget before scoping env props). OverlayObjects skeletal meshes parse
  via the existing probe-based shim, no changes expected. Full decision tree is frozen in
  `scripts/extract-als/PLAYBOOK.md`.

- **Never ship Epic-published content** (Manny/Quinn mannequin packs, MetaHumans, and other
  Epic-designated UE-only assets). Local experiments with Epic content stay local.
- **ALS Refactored content is cleared** (settled 2026-07-23): its blanket MIT — copyright Sixze,
  Longmire, Yanıkoğlu, and contributors — covers the repo's assets, meshes included. Usable and
  redistributable here; ship the upstream notice alongside.
- **Purchased Fab content stays out of the public repo** (anti-redistribution terms): any bought
  packs/characters are gitignored, acquisition documented as a setup step; deployed web bundles
  may include them ("inseparable part of a Project").
- Verify per-listing licenses on Fab before any new asset enters the curated pack.
- ALS Refactored is the design north star, not a code-port target: its C++/AnimGraph stays in UE;
  we replicate behavior on the pure-module substrate.

---

## Maintenance rules

- Check items off as they land; stamp milestones with date + commit on close.
- New debt is scheduled here or named at its code seam; no parallel decision-log document.
