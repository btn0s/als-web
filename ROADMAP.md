# ROADMAP.md — als-ue5-r3f

A web port of **ALS Refactored** ([Sixze/ALS-Refactored](https://github.com/Sixze/ALS-Refactored),
the UE5-native rework of Advanced Locomotion System) on React Three Fiber, built as a
**reference repo / template**: UE5-Manny-skeleton-native so the modern Fab animation ecosystem
drops in with no retargeting. Stealth gameplay layers on top once the locomotion template stands.

**Lineage:** sibling of `../exposure-r3f`, which pioneered the architecture on a UE4-style rig
(Quaternius UAL) — pure weight table, region-overlay rules, track-mask regions, action arbiter,
pose-based camera, measured-gait foot-locking. That repo stays the working stealth slice and the
reference implementation; this one is the clean rebuild on the skeleton the content ecosystem
actually uses. Its pure modules transplant verbatim (they are skeleton-agnostic; the prefix-based
masks already classify UE5's `spine_04/05`, `neck_02`, and twist bones correctly).

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

## M1 — Transplant the proven core

Copy from `../exposure-r3f/src/player/`, tests included, adapting names only:

- [ ] `weightTable` (+ invariant grid tests) · `regionOverlays` (+ ride-alphas, holdAt, Leva
      auto-panel) · `trackMask` (verify prefix sets against the actual UE5 skeleton dump)
- [ ] `blendspace` (crawl-aware cadence) · `actionSequence` · `actionArbiter` · `slotMontage` ·
      `scrubbedPose` · `proceduralPose` · `footIk` + `ikChain`
- [ ] `locomotionProfile` — re-point at the new pack; verify root-motion stride measurement against
      UE5-exported root translation conventions
- [ ] Pose-based camera (poseHeight publish + self-calibrating pivot) and the reticle-true zoom
- [ ] Dev tooling: test hooks (`__triggerJump`, `__playClip`), capture scripts, Leva root taxonomy
      (Camera / Movement / Animation / Sandbox / Debug)

**Exit:** transplanted test suite green; character walks under the weight table with one region
rule active as proof.

---

## M2 — Content pipeline (the point of the UE5 bet)

- [ ] Extraction path: **editor-free, no UE install** (decided 2026-07-23). CUE4Parse (.NET,
      cross-platform incl. macOS arm64) reads the repo's loose `.uasset`s directly; export mesh +
      anims (glTF or psk/psa/ueformat → Blender batch import → GLB). One command per pack.
      If CUE4Parse lags the plugin's engine target (4.17 → UE 5.7), pin an older plugin release
      (e.g. 4.15 → UE 5.5) — the content is identical for our purposes.
- [ ] **ALS Refactored's animation set** extracted (licensing settled 2026-07-23: the repo's
      blanket MIT names the full author lineage — Sixze, Longmire, Yanıkoğlu — and covers its
      assets; preserve the upstream notice as `LICENSE-ALS-Refactored.md` beside ported assets)
- [ ] **Real `SKM_Als` geometry**: extend `Dump.cs` to parse the editor native-bulk mesh
      (FSkeletalMeshModel / import data) and replace the M0 proxy body in `assemble-glb.mjs`
- [ ] **Scripted retarget UE5 → SK_Als layout** (see M0 discovery): map spine_04/05→spine_03,
      neck_02→neck_01 rolls at build time, or decide to re-rig the project UE5-native instead —
      decide before the TSO pack lands
- [ ] **TacticalStealthOperation pack** (64 clips, already owned, UE5-native): WallHug set,
      OnLedge set, PipeHang (incl. inverted), Land/Land_Light/LandRoll, rolls, Headlock/CarryBody
- [ ] `scripts/build-player-anims.mjs` equivalent: curated merge → single animation-only GLB,
      dedup/resample, root-motion preserved for gait measurement
- [ ] Clip audit doc-comment in the build script: what each curated clip is FOR

**Exit:** one curated GLB; every clip binds by bone name to the character; strides measure sanely.

---

## M3 — ALS parity (the port proper)

ALS Refactored's taxonomy as the checklist, replicated as closely as the web stack allows —
data on the M1 substrate (weight-table entries, region rules, arbiter records), not new systems:

- [ ] Gaits: walk / run / sprint with authored speeds; stride warping if the clips demand it
- [ ] Stances: standing / crouching (+ our prone extension); stance ladder + staged transitions
- [ ] Rotation modes: velocity direction / looking direction / aiming — real 8-way blendspaces
      from authored directional clips (not cardinal-blend approximation)
- [ ] Turn-in-place (authored Turn clips, scrubbed/arbitered) + start/stop/pivot transitions
- [ ] Overlay states: ALS-style item/pose overlays via region rules (masked, per-bone)
- [ ] In-air: jump/fall with land recovery (`Land_Light`/`LandRoll` by fall speed)
- [ ] Mantle/vault through the arbiter (one clock: warp + montage share normalized progress)
- [ ] Foot IK with pelvis adaptation (the part exposure-r3f deliberately benched)
- [ ] CUT for now: ragdoll, rolling physics blend, debug-camera parity — revisit on demand

**Exit:** side-by-side with ALS Refactored in-editor footage, the web version reads as the same
system. Template README records what's parity, what's approximated, what's cut.

---

## M4 — Template hardening

- [ ] Strip experiment scaffolding; document the "add a pack / add a rule / add an action" paths
      in code comments at the extension seams
- [ ] Runtime pack budget: single animation GLB, lazy dev content, size target recorded
- [ ] This file trimmed to a maintenance doc; repo marked as the template baseline for new demos

**Exit:** a new prototype can fork this repo and have ALS-grade locomotion + the tuning surface
in under an hour.

---

## M5 — Stealth on top

Port the stealth layer from `../exposure-r3f` (all skeleton-agnostic):

- [ ] Exposure model (light + sound) + HUD meters
- [ ] One guard: perception cone / LOS / graded awareness on patrol
- [ ] Stealth-specific animation content: sneak overlays, wall-hug + peeks (TSO clips), takedown/
      interrogate as arbiter action records (Headlock/CarryBody clips are already in hand)

---

## Guardrails

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
- `../exposure-r3f` is read-only reference from here — improvements flow forward into this repo,
  not back.

---

## Maintenance rules

- Check items off as they land; stamp milestones with date + commit on close.
- New debt goes in a TECH-DEBT.md when it earns one; this file only schedules.
