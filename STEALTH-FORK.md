# STEALTH-FORK.md — transplant survey for the downstream stealth fork

OUT OF SCOPE for this repo (standalone ALS port — see ROADMAP "Out of scope"). This file exists
so a fork made by copying this repo inherits the stealth research without any session-memory
dependency. Survey date 2026-07-23; re-verify paths before use.

Survey 2026-07-23. Stealth is OUT OF SCOPE for als-ue5-r3f (standalone ALS port); this survey is
preserved for the downstream fork/session that adds it. Key correction: the working stealth code
lives in ../exposure-demo (vanilla three), not ../exposure-r3f. Related: [[als-anim-math-spec]].

## Survey: exposure-r3f / exposure-demo stealth layer, for ROADMAP M5

### Critical finding before the inventory

**The task's stated source repo (`exposure-r3f`) does not contain the stealth layer.** Its own `ROADMAP.md` states plainly: *"the exposure meter and guard have not started (`src/exposure/`, `src/ai/` don't exist yet)"* — confirmed, `find src` there shows only `player/`, `debug/`, `hud/`, `scene/`. `exposure-r3f`'s own M3/M4 milestones (not yet started) describe porting exposure+guard from a **third repo**, `../exposure-demo` (sibling of exposure-r3f, sibling of als-ue5-r3f — `/Users/btnorris/dev/games/echelon/tech-demos/exposure-demo`), a pre-R3F **vanilla three.js** (`three/webgpu`) prototype with no React/zustand/rapier. That is where the actual stealth code lives.

Implication for the transplant: this is a **two-hop port** collapsed into one — als-ue5-r3f must adapt vanilla-three/imperative code directly to R3F+zustand, not copy already-adapted R3F code as M1's transplants did. `exposure-r3f/src/hud/PlayerHud.tsx` (26 lines) does establish the *target-shaped* seam though — a stub with the comment *"light/sound exposure meters (port Phase 2) will live here, reading the exposure slice of the zustand store"* — so that pattern (React DOM outside Canvas, dev/non-dev App.tsx flag, zustand-fed) is confirmed and worth following even though exposure-r3f's own store has no exposure slice yet. `exposure-r3f/src/player/playerStore.ts` (221 lines) is the zustand-pattern reference for standing up an equivalent store in als-ue5-r3f (which currently has no store module at all — `zustand` is a listed dependency but unused).

---

### (1) Module inventory — source: `exposure-demo/src/`

| Path | LOC | Pure / Coupled | Deps | Notes |
|---|---:|---|---|---|
| `exposure/state.ts` | 36 | **Pure** | none | hysteresis rise/fall state machine |
| `exposure/combine.ts` | 46 | **Pure** | none | torso-weighted luminance combine |
| `exposure/perceptual.ts` | 45 | **Pure** | none | cube-root perceptual curve + black point |
| `exposure/smoothing.ts` | 32 | **Pure** | none | asymmetric attack/release smoothing |
| `exposure/exposure.ts` | 77 | **Pure** | above 4 | orchestrating pipeline (`createExposurePipeline`) |
| `exposure/ambientFill.ts` | 41 | Coupled (light) | `three/webgpu` (Color/Vector3 only) | analytic hemisphere-light fill; trivial re-import to `three` |
| `exposure/samplePoints.ts` | 78 | Coupled | `three/webgpu`, `scene/player` `AnchorName` | 7-point body sample rig, bone-anchor driven |
| `exposure/analyticDirect.ts` | 119 | Coupled | `three/webgpu` (Raycaster, PointLight, SpotLight) | per-point direct-light + hard-occlusion sampler; **core light-exposure sampler** |
| `exposure/fillProbe.ts` | 119 | Coupled, **retired** | `three/webgpu` WebGPU cube capture | dead code path per its own header comment — skip |
| `exposure/screenTruth.ts` | 136 | Coupled, **dev-proof only** | `three/webgpu` multi-camera capture | verification harness for the demo's own build-out, not gameplay — skip |
| `ai/perception.ts` | 84 | **Pure** | none | `sense()` — coffin cone + proximity + sound-masking |
| `ai/awareness.ts` | 69 | **Pure** | `perception.Vec2` | awareness meter + `unaware→suspicious→searching→alert` FSM + LKP |
| `ai/takedown.ts` | 50 | **Pure** | `navGrid.Vec2` | rear-cone + range + undetected takedown validity check |
| `nav/navGrid.ts` | 211 | **Pure** | none | grid A*, static+dynamic obstacles — class, no three |
| `ai/navigate.ts` | 91 | Coupled (light) | `three/webgpu` Group/Vector3, `navGrid` | thin wrapper: path-follow + face-dir on a `THREE.Group` root |
| `ai/guard.ts` | 277 | Coupled | `three/webgpu` (Group/Raycaster/SpotLight), navGrid, awareness, coordination, bodyDiscovery, guardAnim, flashlight, navigate, perception | orchestrator; far more than M5 needs (see §2) |
| `ai/bodyDiscovery.ts` | 44 | **Pure** | none | out of scope for M5 ("one guard" — no body-discovery-by-others) |
| `ai/coordination.ts` | 43 | **Pure** | awareness, navGrid | out of scope for M5 (multi-guard signalling) |
| `ai/squad.ts` | 98 | Coupled | coordination, guard | out of scope for M5 (explicitly cut in exposure-demo's own guardrails too) |
| `ai/flashlight.ts` | 106 | Coupled | `three/webgpu` SpotLight | out of scope for M5 (cut per exposure-demo guardrails) |
| `ai/guardAnim.ts` | 150 | Coupled, **AnimationMixer-era** | `three/webgpu`, own GLTFLoader, `fx/heatPass` | loads its own Quaternius rig + hand-authored mixer sub-clips; **does not transplant** — als-ue5-r3f retired the mixer for the owned pose-buffer runtime (per its AGENTS.md) |
| `player/wallCover.ts` | 31 | **Pure** | none | wall-detection/slide geometry (`isBackingIntoWall`, `projectOntoWallTangent`, `clampWallSlide`) |
| `player/handOverHand.ts` | 163 | Coupled | own player controller | ledge/pipe traversal — als-ue5-r3f's `footIk.ts`/`ikChain.ts` (already transplanted in M1) are the better-fit reference here, not this file |
| `ui/hud.ts` / `ui/view.ts` / `ui/widgets.ts` (420) / `ui/renderer.ts` | ~500+ combined | Coupled, wired | Yoga layout, canvas retained-mode, entangled with the PIGFACE PS2 postprocess pipeline (explicitly out of scope per both repos' guardrails) | **not the HUD to port** |
| `ui/meter.ts` | 55 | Coupled, **dead code** | raw DOM | Confirmed unused — `grep` finds zero importers. It's the *design reference* (2-tier light-dot + sound-fill/ambient-mark gauge) but not wired anywhere; must be rewritten as React regardless |

Sound-exposure input is **not a standalone module** — it's computed inline in `exposure-demo/src/main.ts` as a `FOOTSTEP_NOISE = { crouch: 0.07, walk: 0.46, run: 0.9 }` table keyed by gait, fed by `player.drainFootPlants()` discrete foot-plant events on that repo's own bespoke player controller (`src/player/controller.ts`, 1600+ lines, not transplantable — als-ue5-r3f's player is ALS/rig-driven, not this).

---

### (2) Dependency-ordered transplant sequence

1. **Pure exposure math** (`combine.ts`, `perceptual.ts`, `smoothing.ts`, `state.ts`, `exposure.ts`) — verbatim transplant + vitest suite, zero adaptation beyond import paths. Foundational, no deps.
2. **`ambientFill.ts`** — verbatim logic, swap `three/webgpu` → `three` (only `Color`/`Vector3`/`HemisphereLight` used, no WebGPU-specific API touched).
3. **`samplePoints.ts`** — re-key the `WEIGHTS`/`AnchorName` map from exposure-demo's `head/chest/pelvis/hand.L/hand.R/foot.L/foot.R` to SK_Als's actual bone names (verified against `als-ue5-r3f/src/player/trackMask.ts`: `head`, `spine_03` as chest-equivalent, `pelvis`, `hand_l`, `hand_r`, `foot_l`, `foot_r`). Anchor objects must come from the already-working skeleton bone lookup in `scene/useLocomotionRig.ts`, not a new bone walk.
4. **`analyticDirect.ts`** — the real adaptation work: port the raycast-occlusion + inverse-square + spot-cone sampler to `three` proper, feed it the scene's registered light list (new: a light-source registry doesn't exist yet in als-ue5-r3f) and the level's static occluder meshes.
5. **Sound-exposure input** — no module to port; **build new**: a small pure `gait → noise level` table (same shape as `FOOTSTEP_NOISE`) driven from ALS's actual foot-plant signal. This is the first place the M5 work is blocked on M3/M2 landing (see §3).
6. **Zustand exposure store** — new module, following `exposure-r3f/src/player/playerStore.ts`'s pattern (doesn't exist there either, but the pattern/idiom is established): light exposure result + sound noise/ambient, fed each frame from steps 1–5.
7. **HUD** — new React components under a `src/hud/` directory (mirroring `exposure-r3f/src/hud/PlayerHud.tsx`'s stub and comment), reading the store from step 6. `exposure-demo/ui/meter.ts` is design reference only (2-tier light-dot / sound-fill+ambient-mark gauge) — not code to port, it's dead/DOM code and the target wants React.
8. **`nav/navGrid.ts`** — verbatim transplant, pure A*. No deps on anything above.
9. **`ai/perception.ts`** — verbatim transplant, pure. Depends conceptually on step 6's exposure value and a new sound-noise value as call-site inputs (no import coupling).
10. **`ai/awareness.ts`** — verbatim transplant, pure. Depends on step 9's output shape.
11. **`ai/takedown.ts`** — verbatim transplant, pure. No deps — wire later once the arbiter action record (step 14) exists to consume its boolean.
12. **`ai/navigate.ts`** — thin adaptation: replace the raw `THREE.Group root` with an R3F ref/rapier kinematic body pattern consistent with how als-ue5-r3f will drive the guard's transform.
13. **Guard orchestrator** — **do not port `ai/guard.ts` wholesale.** Reimplement a minimal `createGuard`-equivalent that wires only: navigate (12) + perception (9) + awareness (10) + a `hasLOSAt` raycast (lift ~15 lines out of `guard.ts`, drop `bodyDiscovery`/`coordination`/`flashlight`/`squad`/relight-task machinery — all explicitly out of M5's "one guard" scope and out of scope in exposure-demo's own guardrails too).
14. **Guard presentation/animation** — **do not port `ai/guardAnim.ts`.** It's built on `THREE.AnimationMixer` sub-clip splitting against a Quaternius rig; als-ue5-r3f's owned pose-buffer runtime (M3) and weight-table/region-overlay substrate is the correct target — this is new work using the M1 substrate, using `guardAnim.ts`'s STATE_COLOR/debug-viz cone-and-bar idea only as a design reference for the `?dev` cone/awareness-bar visualization.
15. **Takedown/interrogate as arbiter action records** — new work on top of `actionArbiter.ts` (already transplanted, generic `ActionRecord<Kind>`): define `Kind = 'takedown' | 'interrogate'`, `canTakedown()` (step 11) as the gate, `bodyMotion: 'kinematic-hold'`, clip = Headlock/CarryBody clips (already in hand per M2 note).
16. **Sneak overlay / wall-hug region rules** — new `RegionOverlayRule` entries in `als-ue5-r3f/src/player/regionOverlays.ts`. Notably, `OverlayContext.sneak` **already exists** as a documented-but-unwired field (`"Sneak blend 0..1 (slow-walk mode, upright, grounded, moving)"`) — this is a stub placeholder, not a port target; no equivalent module exists in either sibling repo to copy.
17. **`player/wallCover.ts`** — verbatim pure transplant (wall-detection/slide geometry), but it's just the geometry test; wiring it to an actual wall-hug *pose* needs the TSO clip pack (blocked, see §3).

---

### (3) Gaps — stealth-layer assumptions this repo doesn't satisfy yet, mapped to M3

| Stealth-layer need | Blocked on | M3 item that provides it |
|---|---|---|
| Guard animation (idle/walk/torch-arm/pistol-arm/death) | Owned pose-buffer applier; `AnimationMixer`-based `guardAnim.ts` is explicitly retired-pattern | "Owned pose-buffer animation runtime FIRST" |
| Sound-exposure input (gait → noise via foot-plant events) | ALS's authored `FootLeft/RightLock` curves (extracted in M2, not yet wired) — the sibling's `drainFootPlants()` measured-gait heuristic is explicitly the thing this repo is *not* using (AGENTS.md: "this repo uses ALS's authored data instead") | Foot IK / `locomotionProfile` re-point (M1 open item) + curve extraction (M2, unchecked) |
| Sneak overlay clip | No authored ALS sneak/slow-walk clip confirmed in the curated pack yet | Overlay states region-rule wiring ("SEED rule alphas from the overlay assets' authored `Layer*` curves") |
| Wall-hug pose/clips | **TacticalStealthOperation pack (64 clips, WallHug/OnLedge/PipeHang, owned/gitignored)** — deferred to end of M2, which itself is explicitly deferred to the *start* of M5 per ROADMAP: "this is where the deferred UE5-retarget-or-re-rig decision from M2 gets made" | M2's deferred-to-M5 skeleton decision — **this is a hard M5 precondition, not parallelizable with the rest** |
| Takedown/interrogate clips | Headlock/CarryBody — "already in hand" per M2 note, contingent on the same TSO pack decision above | same as wall-hug |
| Guard perception LOS raycast against real occluders | Level geometry / occluder registry doesn't exist in als-ue5-r3f yet (no test-room level module found) | Not an M3 item — new scene work, sibling `scene/TestRoom.tsx` is the closest reference |
| Light-source registry feeding `analyticDirect.ts` | No registry exists; als-ue5-r3f has no scene lights beyond whatever `Character.tsx`/`PoseOrbitCamera.tsx` set up | New work, not blocked on M3 |
| Foot IK / pelvis adaptation for guard on uneven terrain | Not needed for M5's flat test room | Explicitly benched until M3's "Foot IK with pelvis adaptation" item, itself flagged low-priority |

**Skeleton-agnostic check (per M5's premise):** confirmed true for every *pure* module (§1) — `perception.ts`, `awareness.ts`, `takedown.ts`, `navGrid.ts`, `exposure/*` pure math all operate on `Vec2`/scalars, zero bone/skeleton coupling. The only skeleton-touching pieces are `samplePoints.ts` (anchor names, needs remap — trivial) and `guardAnim.ts` (fully retired, not transplanted). So the ROADMAP's "all skeleton-agnostic" claim holds for the actual transplant set once `guardAnim.ts` is correctly excluded rather than ported.

---

### (4) Per-step scope estimate

| Step | Scope |
|---|---|
| 1. Pure exposure math (combine/perceptual/smoothing/state/exposure) | **S** — literal copy + test re-point |
| 2. `ambientFill.ts` (three/webgpu → three) | **S** |
| 3. `samplePoints.ts` (bone remap) | **S** |
| 4. `analyticDirect.ts` (light registry + occluder wiring) | **M** |
| 5. Sound-exposure input (new, blocked on foot-plant signal) | **M** (blocked — real work is in M3/M2, this step is thin once unblocked) |
| 6. Zustand exposure store (new) | **S** |
| 7. HUD React components (new, design-ref only) | **M** |
| 8. `navGrid.ts` | **S** — verbatim |
| 9. `perception.ts` | **S** — verbatim |
| 10. `awareness.ts` | **S** — verbatim |
| 11. `takedown.ts` | **S** — verbatim |
| 12. `navigate.ts` adaptation | **S** |
| 13. Guard orchestrator (trimmed reimplementation) | **M** |
| 14. Guard presentation on pose-buffer runtime | **L** — no reference implementation exists yet in either sibling; also gated on M3's runtime landing first |
| 15. Takedown/interrogate arbiter records | **M** — gated on TSO pack (wall-hug/headlock clips) |
| 16. Sneak/wall-hug region rules | **M** — gated on TSO pack + sneak clip availability |
| 17. `wallCover.ts` transplant + wiring | **S** transplant / **M** once wired to real pose |

**Overall read:** roughly half of M5 (exposure math + guard sensing/patrol logic, steps 1–13) is either verbatim-portable or a contained adaptation and can proceed independently of M3. The other half (guard presentation, sneak overlay, wall-hug, takedown/interrogate) is **hard-gated** on two things landing first: the owned pose-buffer runtime (M3's first item) and the deferred TacticalStealthOperation pack / skeleton decision (explicitly scheduled to happen *at* the start of M5 per ROADMAP, not before it) — matching the ROADMAP's own sequencing, just worth flagging precisely since it constrains which M5 sub-items can start in parallel.

**Files read for this survey** (paths, for reference): `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/{AGENTS.md,ROADMAP.md}`, `/Users/btnorris/dev/games/echelon/tech-demos/exposure-r3f/{ROADMAP.md,src/hud/PlayerHud.tsx,src/player/playerStore.ts}`, `/Users/btnorris/dev/games/echelon/tech-demos/exposure-demo/src/{exposure/*,ai/*,nav/navGrid.ts,player/wallCover.ts,ui/hud.ts,ui/meter.ts,main.ts}`, `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/src/player/{regionOverlays.ts,actionArbiter.ts,trackMask.ts}`.