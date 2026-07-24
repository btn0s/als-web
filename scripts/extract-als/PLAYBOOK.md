# Uncooked .uasset Serialization Playbook

Decision-tree reference for extending this extraction pipeline. Every claim labeled
VERIFIED (evidence cited) or HYPOTHESIS (how to test). Update this file when a new seam
is cracked — agents in fresh sessions have no other source.

## Recon complete

Read-only throughout; all probing happened in `/Users/btnorris/.claude/jobs/c3251c49/tmp/ser-recon/extract-als-probe` (a copy of `scripts/extract-als`, instrumented and rebuilt there — nothing in the repo was touched). Repo files read: `scripts/extract-als/AlsSkeletalMesh.cs`, `Dump.cs`, `Program.cs`, `Inspect.cs`, `run.sh`, `assemble-glb.mjs` (grep only), `clips.manifest`, `ROADMAP.md`. Verified against CUE4Parse 1.2.2 source at `github.com/FabianFG/CUE4Parse` (`USkeletalMesh.cs`, `FStaticLODModel.cs`, `FSkelMeshSection.cs`, `FSoftVertex.cs`, `FSkinWeightInfo.cs`, `USoundWave.cs`).

Note: while I was working, the parallel agent kept moving (`scripts/extract-als` now also shows `assemble-glb.mjs`/`run.sh` modified and new `props.manifest`/`validate-rifle-glb.mjs`, none of which I touched) — the rifle divergence below may already be landing there in parallel.

---

# ALS Extraction Playbook — uncooked UE 5.5 .uasset via CUE4Parse 1.2.2

## Decision tree

```
extracting asset class X from uncooked ALS-Refactored (.uasset only, no .uexp/.ubulk)
│
├─ Does provider.Mount() resolve /ALS/... paths?
│   trap: loose Content needs a stage-dir symlink layout (stage/ALS → repo clone root)
│   VERIFIED: run.sh reuses a matching stage/ALS mount or creates the symlink when needed
│
├─ X = AnimSequence
│   ├─ cooked/compressed fields (CompressedByteStream etc.) → always null. Don't touch them.
│   ├─ real data → AnimDataModel export, `BoneAnimationTracks` (tagged UScriptArray of
│   │   FStructFallback, each with a nested `InternalTrackData` FRawAnimSequenceTrack)
│   ├─ additive clips store the FULL pose, not a delta — delta is a cook-time step, not
│   │   present in editor source. Don't subtract a "base pose" during extraction.
│   ├─ FrameRate is an FStructFallback — `GetOrDefault("Numerator"/"Denominator", default)`
│   │   because UE omits default-valued tagged properties entirely (GetOrDefault pattern,
│   │   applies broadly — never assume a tagged property is present just because the schema
│   │   has it)
│   └─ curves → CurveData is TWO hops: `model.GetOrDefault<FStructFallback?>("CurveData")`
│       then `new FRawCurveTracks(fallback)`. A one-hop typed `Get<FRawCurveTracks>` returns
│       silently null. Absent vs empty-array curve set are different states — check both.
│       Metadata flag bit 16 gates visibility. Every FRichCurveKey field is serialized here:
│       interpolation/tangent/tangent-weight modes, time/value, and independent arrive/leave
│       tangents and weights. Preserve them; never regenerate the curve shape downstream.
│
├─ X = SkeletalMesh (editor LOD0)
│   VERIFIED (CUE4Parse source, `USkeletalMesh.Deserialize`): stock reads
│   `LODModels = Ar.ReadArray(() => new FStaticLODModel(Ar, bHasVertexColors))` when
│   `!stripDataFlags.IsEditorDataStripped()` — i.e. stock CAN read editor LOD0 in principle.
│   It fails on ALS content because its per-vertex reader (`FSoftVertex`/`FSkinWeightInfo`,
│   see below) hasn't been updated for UE5's extended vertex-influence model. That's why this
│   project carries `UAlsSkeletalMesh : UObject` (registered via
│   `ObjectTypeRegistry.RegisterClass("SkeletalMesh", ...)`) as a compatibility shim at the
│   extraction seam, not a patch to the vendored library — correct call, keep doing this per game asset if there's a mismatch.
│
│   Four verified seams vs stock CUE4Parse 1.2.2:
│   1. Extra model-level `FStripDataFlags` immediately before the plain `int32` LOD count,
│      that stock `USkeletalMesh.Deserialize` does not read at that point (stock goes
│      straight from custom-version check to `Ar.ReadArray(...)`, which handles its own
│      count internally — UE5.5 editor format interposes an additional strip-flags marker).
│   2. `TMap<int32, FSkelMeshSourceSectionUserData>` (49 bytes/entry) between `Sections` and
│      `Indices`. VERIFIED ABSENT from CUE4Parse's `FStaticLODModel.cs` entirely — not
│      version-gated, not game-cased, just never implemented. This field is new to a UE
│      engine revision CUE4Parse hasn't caught up to for GAME_UE5_5's editor path.
│   3. Per-soft-vertex influence layout. VERIFIED root cause: `FSkinWeightInfo(FArchive,
│      bExtraBoneInfluences, bUse16BitBoneIndex=false, bUse16BitBoneWeight=false, length=0)`
│      — `FSoftVertex`'s constructor calls this with ONLY the `bExtraBoneInfluences` arg,
│      hardcoding influence slots to 4 or 8 (`NUM_INFLUENCES_UE4`/`MAX_TOTAL_INFLUENCES_UE4`)
│      and index/weight width to 8-bit always. Both shipped meshes instead have 12 reserved
│      influence slots and uint16 editor indices. Their weight widths differ: SKM_Als uses
│      uint8 and SKM_Als_Rifle uses uint16. This is independently VERIFIED in the source
│      uasset bytes by consecutive vertex starts: body stride 124 =
│      56 fixed + 4 UVs × 8 + 12 indices × 2 + 12 weights × 1; rifle stride 136 =
│      56 + 32 + 12 × 2 + 12 × 2. CUE4Parse's fixed reader can desynchronize the cursor and
│      feed a garbage length into a later array/bulk read.
│
│      `ProbeInfluenceLayout` therefore enumerates {uvCount 1–4} × {influenceCount
│      4/8/12/16/24} × {8/16-bit index} × {8/16-bit weight}. The post-array
│      `Use16BitBoneIndex` / `BoneMap` / `NumVertices` / `MaxBoneInfluences` fields prove
│      only the total stride. Equal-stride width swaps are resolved independently by Unreal's
│      content invariants: positive weights form a packed prefix, paired local indices resolve
│      through BoneMap, the observed maximum active count equals `MaxBoneInfluences`, every
│      section BoneMap entry is used, and sums match the candidate width (255 or 65535).
│      Extraction rejects zero or multiple semantic matches rather than choosing by loop order.
│   4. Legacy retained `NumVertices` int after `Size`, before the real (strip-flag-gated)
│      `NumVertices` — read and discard it (`_ = ar.Read<int>()`), matching the shim as-is.
│
│   CORRECTION (2026-07-23): the earlier “rifle has 16 slots / weights are always uint16”
│   conclusion was an equal-stride probe alias, not a source fact. On the body, the wrong
│   12×uint8-index + 12×uint16-weight interpretation has the same 124-byte stride as the real
│   12×uint16-index + 12×uint8-weight layout. It moved each rigid weight from slot 0 to slot 6;
│   the assembler then paired it with local joint 0 and collapsed every multi-bone section.
│   Exact per-material joint histograms in `validate-glb.mjs` and the rifle joint histogram in
│   `validate-rifle-glb.mjs` are the independent output oracles for this failure class.
│
│   Winding: VERIFIED (assemble-glb.mjs comment, signed-volume test, 2026-07-23) — UE's
│   stored index order is already front-facing after the (x,z,y) basis-swap conjugation;
│   do not reverse it.
│
├─ X = SKM_Als_Rifle / other OverlayObjects skeletal meshes — PROBED NOW, WORKS
│   VERIFIED end-to-end: dumped SK_Als_Rifle (9 bones) + SKM_Als_Rifle successfully with the
│   *current* (in-progress, uncommitted) AlsSkeletalMesh.cs shim — 11754 vertices, 6926
│   triangles, 1 section, all internal sanity checks passed (section-vertex-sum ==
│   NumVertices, section-triangle-sum*3 == Indices.Length), weight-sum-normalization check
│   passed under the ushort branch.
│   What differs from SKM_Als, precisely:
│     - Skeleton: 9 bones vs SKM_Als's much larger skeleton (smaller-skeleton hypothesis
│       from the task brief — CONFIRMED).
│     - Sections: 1 vs SKM_Als's several.
│     - Weight width: uint16/full 65535 versus the body's uint8/255. Both use 12 slots,
│       uint16 indices, four UV channels, the same section-user-data map, and the same
│       strip-flags seam.
│     - `MaxBoneInfluences=1` for every rifle vertex (rigid prop pieces). Its exact positive
│       joint histogram is root 7435, bullets 864, magazine 747, charging handle 328,
│       barrel 960, sights 802, trigger 74, stock 544, and muzzle 0.
│   Bottom line: keep the semantic probe; neither slot count nor index/weight width is inferred
│   from stride alone. If a new mesh reports no unique match, inspect the diagnostic candidate
│   list and source bytes before widening the allowed slot/UV ranges.
│   Not yet probed: SK_Als_Bow / SK_Als_Pistol and their SKM_* meshes — apply the identical
│   `dump` invocation; the shim needs zero changes since it already generalizes. HYPOTHESIS:
│   they'll parse the same way, possibly with yet another influence-slot count — that's fine,
│   the probe handles it.
│
├─ X = StaticMesh (SM_Als_* env/prop meshes) — PROBED, negative-but-actionable result
│   VERIFIED (`inspect` on SM_Als_Box): stock `UStaticMesh`-equivalent export parses fine at
│   the tagged-property level. `RenderData: null` (same cooked-strip pattern as everything
│   else). BUT unlike SkeletalMesh, the real editor geometry source
│   (`SourceModels[0].StaticMeshDescriptionBulkData` → a `StaticMeshDescriptionBulkData`
│   export, i.e. `FMeshDescriptionBulkData`/`FMeshDescription`) comes back as an **empty
│   stub** — `Type/Name/Flags/Class/Outer` only, no `Properties`, no raw bytes surfaced.
│   CUE4Parse has no native class registered for `StaticMeshDescriptionBulkData`, so its
│   generic `UObject` reader stops at the tagged-property boundary and never touches the
│   custom binary bulk blob that holds the actual mesh (FMeshDescription's own versioned,
│   likely-compressed binary format — analogous to, but almost certainly more complex than,
│   the RawSkeletalMeshBulkData/Oodle situation already solved for SkeletalMesh).
│   HYPOTHESIS for the fix, same methodology as the SkeletalMesh shim: register a custom
│   `UAlsStaticMeshDescriptionBulkData : UObject` override, call `base.Deserialize` then read
│   raw bytes off the archive at the resulting cursor position looking for a bulk-data header
│   (`FByteBulkData`-shaped: element count + element size + flags) the way `RawSkeletalMeshBulkDatas`
│   was found for skeletal meshes — but do NOT assume it'll be Oodle-compressed or
│   inline; probe both. This is real, unstarted work — budget for it before committing to
│   static-mesh env props being in scope.
│
├─ X = Audio (S_Als_Footstep_*) — PROBED, VERIFIED negative
│   VERIFIED via `inspect` + CUE4Parse `USoundWave.cs` source: `RawData`, `CompressedFormatData`,
│   `RunningPlatformData` are all `null` in the uncooked asset — and source-level, this is NOT
│   a CUE4Parse gap to patch around. `USoundWave.Deserialize`'s `SerializePlatformData` only
│   populates `RawData` (`new FByteBulkData(Ar)`) in the `!bStreaming` branch; for uncooked
│   assets `bCooked` is false and `bStreaming` resolves true by default (no explicit
│   `LoadingBehavior`/`bStreaming` tagged property found on these footstep assets → falls back
│   to `Ar.Versions["SoundWave.UseAudioStreaming"]`, true at GAME_UE5_5) → the streaming
│   branch never even attempts to read `RawData`, it just reads a GUID. There is no PCM/WAV
│   payload serialized into these .uassets at all — this isn't a parser gap, the bytes
│   genuinely aren't there (streaming-audio chunk data is built into the DDC only at cook
│   time). `AssetImportData.SourceData[0].RelativeFilename` is also empty, so there's no
│   recoverable link to an original .wav either. Conclusion: **uncooked-.uasset extraction of
│   ALS footstep audio is a dead end** with this pipeline — don't spend more time probing
│   variant SoundWave settings here; if audio is wanted, source it independently (record/find
│   equivalent free SFX, or extract from a cooked build instead of this editor clone).
│
└─ Generalizable traps across all of the above
    - "strip-flags-before-native-payload": UE5.5 editor .uasset serialization repeatedly
      interposes an extra `FStripDataFlags` marker at points stock CUE4Parse (tracking older
      engine layouts, or games behind on version bumps) doesn't expect. When a parse
      misaligns, first suspect a missing/extra `FStripDataFlags` read before assuming a
      field-width or array-length problem.
    - "FByteBulkData framing variants": bulk payloads show up either fully absent (audio),
      present-but-unparsed-stub (static mesh description), or genuinely inline in the main
      export payload despite there also being an editor-data indirection object that looks
      like it should hold it but doesn't (skeletal mesh: `SkeletalMeshEditorData`'s
      Oodle-compressed `RawSkeletalMeshBulkDatas` is a red herring — LOD0 geometry is inline
      in `USkeletalMesh` itself, behind the 2-byte strip-flags + plain int32 LOD-count seam).
      Don't assume the "editor data" object with the obvious name is where the real data is —
      verify empirically (dump raw bytes, look for plausible array-count/GUID patterns)
      before writing a decoder against it.
    - "Oodle-compressed editor bulk": when it does appear (the SkeletalMeshEditorData path,
      not currently used), treat compression as a separate, optional layer on top of a
      correctly-framed `FByteBulkData` header — get the framing right first per the pattern
      above, decompression second.
    - "versioning guards at GAME_UE5_5": CUE4Parse's per-class `Deserialize` methods are
      littered with `Ar.Game == GAME_X` and `Ar.Ver >= ...`/`FXCustomVersion.Get(Ar) >= ...`
      branches for dozens of specific titles. ALS-Refactored is generic UE 5.5 with no
      per-game case in the library, so any custom-version check that resolves differently at
      GAME_UE5_5 than the branch CUE4Parse's authors tested against is a candidate seam —
      when in doubt, diff the actual byte layout against the relevant `*CustomVersion.cs`
      enum's ordering rather than guessing from the C# alone.
    - Bone-name capitalization: VERIFIED already handled (`assemble-glb.mjs`,
      `canonicalBoneName`) — upstream arms-only overlay clips (rifle run/sprint arms etc.)
      retain import-time capitalization that differs from the skeleton's reference names;
      always resolve track bone names through a lowercase→canonical map keyed off the
      skeleton's `FReferenceSkeleton`, never compare raw strings.
```

## Verified vs Hypothesis summary

| Claim | Status | Evidence |
|---|---|---|
| Plugin mount via stage-dir symlink | VERIFIED | `run.sh` already does it, dumps succeed |
| AnimSequence cooked fields null / source in AnimDataModel | VERIFIED | `Dump.cs` working code + successful dumps |
| Additive = full pose, not delta | VERIFIED | stated invariant, consistent with `Dump.cs` doing no delta math |
| FrameRate GetOrDefault pattern | VERIFIED | `Dump.cs:172` |
| CurveData two-hop FStructFallback→FRawCurveTracks | VERIFIED | `Dump.cs:149-152`, working |
| SkeletalMesh LOD0 inline, 4 serialization seams | VERIFIED | cross-checked shim against live CUE4Parse `USkeletalMesh.cs`/`FStaticLODModel.cs`/`FSkelMeshSection.cs`/`FSkinWeightInfo.cs` |
| Weight field is always uint16-wide (not conditionally 8/16) | VERIFIED | source (`FSkelMeshSection` has no weight-width flag) + probe matching both meshes at 16-bit weight width |
| Header comment "12 uint8 weights" is stale/wrong | VERIFIED (worth fixing) | contradicts both source and probe evidence above |
| Rifle divergence: 9-bone skeleton, 1 section, 16 influence slots, full 16-bit weight magnitude | VERIFIED | instrumented dump of SK_Als_Rifle/SKM_Als_Rifle, succeeded end-to-end |
| Current probe-based shim already handles the rifle correctly | VERIFIED | clean dump, all internal sanity checks passed |
| Exit-134 abort mechanism (cursor desync → garbage array length → native abort) | HYPOTHESIS | plausible from source review of the old fixed-width `FSkinWeightInfo`, not directly reproduced (couldn't get the pre-fix file to test against) |
| Bow/Pistol overlay meshes will parse the same way | HYPOTHESIS | not yet run; same code path as rifle, no reason to expect otherwise |
| StaticMesh source geometry needs a new custom bulk-data class | HYPOTHESIS (with concrete next step) | `inspect` shows `RenderData:null` and an unparsed `StaticMeshDescriptionBulkData` stub |
| Uncooked SoundWave audio is unextractable via this pipeline | VERIFIED (negative result) | `inspect` output + `USoundWave.Deserialize` source shows the streaming branch never reads `RawData` for uncooked assets |

## AnimSequence sync markers and notifies

- **VERIFIED — ALS generates foot sync markers with
  `B_Als_AnimationModifier_FootSyncMarkers`.** The upstream 4.15 `README.md` feature list
  names that modifier, and direct package inspection independently finds two modifier
  instances plus the generated `FootSyncMarkers` notify track in both
  `A_Als_Walk_Forward` and `A_Als_Run_Forward`.

- **VERIFIED — both event arrays are tagged directly on `UAnimSequence`, not on its
  `AnimDataModel`.** `AuthoredSyncMarkers` contains `FAnimSyncMarker` fallback structs with
  `MarkerName` and `Time`; `Notifies` contains `FAnimNotifyEvent` fallback structs with
  `NotifyName` and inherited `LinkValue`. The extractor maps `LinkValue` to notify `time`;
  `TriggerTimeOffset` is trigger-boundary adjustment metadata and is not folded into the
  authored event position.

- **VERIFIED — exact forward-cycle values in ALS Refactored 4.15 / UE 5.5 content:**
  `A_Als_Walk_Forward` has `Left` at `0.083333336` seconds and `Right` at
  `0.65000004`; `A_Als_Run_Forward` has `Left` at `0.033333335` and `Right` at
  `0.43333337`. Both sequences have two `BMAnimNotifyFootstep` notifies: walk at
  `0.13333333` and `0.6999999`, run at `0.06666667` and `0.4666667`.

- **VERIFIED — default-valued tags can be absent.** `A_Als_Idle` has neither
  `AuthoredSyncMarkers` nor `Notifies`. `Dump.cs` therefore reads both with nullable
  `GetOrDefault<UScriptArray?>`; an absent tag and a present-but-empty array are handled as
  distinct input states, and both intentionally serialize as explicit empty arrays in the
  dump and GLB.

- **VERIFIED — GLB metadata contract.** Beside
  `animation.extras.alsCurves: [{name, flags, keys: [[timeSeconds, value,
  ueInterpMode, ueTangentMode, ueTangentWeightMode, arriveTangent,
  arriveTangentWeight, leaveTangent, leaveTangentWeight], ...]}]`, every animation carries
  `animation.extras.syncMarkers: [{name: string, time: number}]` and
  `animation.extras.notifies: [{name: string, time: number}]`. Both `time` fields are
  authored seconds. ALS 4.15's 361 animation curves contain 1,646 keys: 70 cubic keys, four
  keys with nonzero authored tangents, and zero weighted-tangent keys. The runtime evaluates
  the unweighted cubic segments with UE's duration-scaled Hermite formula.

- **HYPOTHESIS — an explicitly serialized empty `AuthoredSyncMarkers` or `Notifies`
  tag may occur in other Unreal content.** It was not observed in the three probe assets;
  verify by inspecting a sequence saved with an explicitly cleared event track. The
  nullable-array implementation already accepts that representation without conflating it
  with a parse failure.

## Key file/line references
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/AlsSkeletalMesh.cs` — the shim; `ProbeInfluenceLayout` (lines ~199-272) is the generalized fix, header comment (lines ~11-17) needs the uint8→uint16-weight correction
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/Dump.cs` — `expectedWeightSum` per-mesh magnitude handling (~line 108-115)
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/assemble-glb.mjs` — bone canonicalization (`canonicalBoneName`), winding note (~line 270-277)
- Probe artifacts (throwaway, in tmp): `/Users/btnorris/.claude/jobs/c3251c49/tmp/ser-recon/extract-als-probe/` (instrumented copy), `rifle-dump.json`, `/tmp/main-dump.json`, `/tmp/rifle-dump2.json`, `/tmp/sm-box.json`, `/tmp/sound.json`

## Compiled AnimBlueprint graph serialization

Run:

```sh
dotnet run -- dump-abp "$ALS_WORK/stage" abp-graph.json
dotnet run -- validate-abp abp-graph.json
```

`dump-abp` covers `AB_Als`, `AB_Als_Monolithic`, every `AB_Als_*` below
`Character/AnimationInstances/` (including `Overlays/` and `Stances/`), and `ALI_Overlay`.
The 4.15/UE5.5 content currently yields 23 per-asset sections.

- **VERIFIED — compiled nodes live on the generated-class CDO as tagged struct
  properties.** The class default object has one `AnimGraphNode_*` property per serialized
  compiled node. `FPropertyTag.TagData.StructType` and `.Module` preserve the exact runtime
  struct identity (`AnimNode_SequenceEvaluator`, `/Script/AnimGraphRuntime`, etc.). The value
  is usually an `FStructFallback`; serializing its complete `Properties` list exposes every
  tagged parameter without a node-type allowlist. Confirmed by direct property enumeration
  across all 23 targets and by exact lookups of `Sequence`, `ExplicitTime`, `PlayRate`,
  `LayerSetup`, slot names, linked-layer interface/tag fields, and cached-pose names.

- **VERIFIED — pose links use compiled node indices.** Every nested object containing both
  `LinkID` and `SourceLinkID` is an `FPoseLink`: `LinkID` is the upstream compiled node and
  `SourceLinkID` identifies the owning node. This independently verifies a node index whenever
  a struct has an input pose. Confirmed across ordinary pose fields, pose arrays, and
  `UseCachedPose.LinkToCachingNode`.

- **VERIFIED — CDO property ordinal is not always the compiled node index.** Compiled index
  space can contain external or otherwise untagged nodes. Examples: `AB_Als_Rifle` has 57
  serialized node structs but 58 `AnimNodeData` entries; `AB_Als_Layering` has 92 vs 94.
  Therefore never wire nodes by array ordinal alone. `dump-abp` anchors indices from
  `SourceLinkID`, assigns an ordinal only when the surrounding anchors leave exactly one
  possibility, and otherwise emits `compiledIndexCandidates`, raw link IDs, and
  `unresolvedCompiledNodeIndices`.

- **VERIFIED — state machines are baked on `UAnimBlueprintGeneratedClass`.**
  `BakedStateMachines` expands to `FBakedAnimationStateMachine` data: machine name and initial
  state; state names, root/player/layer node indices, entry/reset flags, and outgoing compiled
  rule data; transition previous/next state, crossfade duration, blend mode, custom curve,
  blend profile, and notify indices. Confirmed in the monolithic, locomotion, grounded, view,
  stance, and weapon-overlay ABPs.

- **VERIFIED negative — transition expressions are not legible from the baked description.**
  `CanTakeDelegateIndex`, desired result, automatic-rule fields, and bound function names
  survive, but CUE4Parse does not decompile the delegate's boolean expression. The dump marks
  each expression `{unrecoverable: reason}` rather than implying that the delegate index is
  the rule. **HYPOTHESIS:** a future Kismet bytecode decompiler plus property-access-library
  mapping could recover these expressions; verify it by comparing decompiled predicates with
  the saved editor transition graphs before treating them as ground truth.

- **VERIFIED — the package import table is directly available.** `Package.ImportMap` retains
  `ClassPackage`, `ClassName`, `ObjectName`, outer package path, package name, and optional
  flag. The dump keeps every import and also emits a filtered animation-asset lookup for
  `AnimSequence`, blend-space, montage, composite, aim-offset, and pose-asset classes.

- **VERIFIED validation oracle:**
  - The target inventory is exact for ALS Refactored 4.15: 23 assets (`AB_Als`,
    `AB_Als_Monolithic`, `ALI_Overlay`, and all 20 linked-instance ABPs). The validator
    rejects missing, unexpected, or wrong-kind targets, and independently checks node counts,
    recovered/candidate index ranges, the exact unresolved-index complement, emitted pose-link
    wiring, state roots/player indices, transition state references, and every serialized
    `CrossfadeDuration`.
  - `AB_Als_Rifle` has non-zero sequence-evaluator times for `A_Als_Rifle_Poses`
    (including 0.05, 0.083333, 0.116667, 0.15, 0.183333, 0.216667, 0.25, 0.283333,
    0.316667, 0.35, and 0.383333 seconds).
  - Both `AB_Als_Layering` `MakeDynamicAdditive` nodes reach the authored
    `A_Als_Stand_Pose` and `A_Als_Crouch_Pose` through their cached base-pose wiring; one is
    local-space and one mesh-space.
  - The grounded graph's `Crouching Input` is implemented by `AB_Als_Crouching`; its compiled
    `Idle` output resolves to **`A_Als_Crouch_Pose`**.
  - Layered-bone-blend branch filters include `spine_01`, `clavicle_l`, and `clavicle_r`.

- **VERIFIED scope boundary — `CR_Als` is not an AnimBlueprint.** It is a
  `ControlRigBlueprint` with RigVM models/functions (1,877 exports in this content), not an
  `AnimBlueprintGeneratedClass`/CDO `FAnimNode` graph. `dump-abp` records it as not dumped.
  **HYPOTHESIS:** a separate Control Rig stage can serialize `RigVMGraph` models and compiled
  RigVM bytecode; validate graph pins and execution order against the saved Control Rig editor
  graphs before using such a dump as a runtime oracle.

## Movement settings and rich curves

Run:

```sh
dotnet run -- dump-movement-settings "$ALS_WORK/stage" movement-settings.json
dotnet run -- validate-movement-settings movement-settings.json
```

- **VERIFIED — `MS_Als_Normal` exposes the complete six-way gait table as tagged
  properties.** `RotationModes` contains VelocityDirection, ViewDirection, and Aiming; each
  contains Standing and Crouching. The dump preserves all forward/backward walk/run and sprint
  speeds in Unreal-native cm/s. The default-valued
  `bAllowDirectionDependentMovementSpeed=false` bit is absent from the asset and therefore
  comes from `FAlsMovementGaitSettings` in `AlsMovementSettings.h`, as does the absent
  `VelocityAngleToSpeedInterpolationRange={100,125}`.

- **VERIFIED — the data asset selects both Normal and Responsive authored curves.** Standing
  uses `CV_Als_AccelerationAndDecelerationAndGroundFriction_Normal`; Crouching uses the
  Responsive vector curve. VelocityDirection/Standing alone uses the Responsive rotation
  curve; the other five gait rows use the Normal rotation curve.

- **VERIFIED — all referenced curve payloads are ordinary tagged rich-curve keys.**
  `CurveFloat.FloatCurve.Keys` holds rotation interpolation speed. The three
  `CurveVector.FloatCurves` channels map exactly as consumed by
  `AlsCharacterMovementComponent.cpp`: index 0 `MaxAccelerationWalking`, index 1
  `BrakingDecelerationWalking`, index 2 `GroundFriction`. `movement-settings.json` preserves
  interpolation modes, tangent modes, tangent-weight modes, times, values, and both tangent
  values/weights for all 32 keys. Its validator pins the 3 modes, 6 gait rows, 4 referenced
  assets, 8 channels, key times, and authored key values.

## Animation instance settings and rich curves

Run:

```sh
dotnet run -- dump-animation-settings "$ALS_WORK/stage" animation-settings.json
dotnet run -- validate-animation-settings animation-settings.json
```

- **VERIFIED — `AIS_Als_Default` binds authored cadence and InAir curves.** Standing and
  Crouching select the two stride curves; `InAir.LeanAmountCurve` selects
  `CF_Als_LeanAmount_Air`, and `InAir.GroundPredictionAmountCurve` selects
  `CF_Als_GroundPredictionAmount`. The animated gait speeds remain default-valued C++ settings,
  so the dump reads their initializers from the pinned 4.15 headers.

- **VERIFIED — all four `CurveFloat` payloads are frozen with their exact rich-curve keys.**
  The validator pins curve/channel names, paths, interpolation/tangent modes, times, values,
  and independent arrive/leave tangents. Runtime `FAlsInAirSettings` sampling consumes this
  generated oracle directly; it does not replace the air-lean reversal or landing prediction
  response with a heuristic.

## BlendSpaces and complete AnimGraph animation coverage

Run:

```sh
dotnet run -- dump-blend-spaces "$ALS_WORK/stage" blend-spaces.json
dotnet run -- validate-blend-spaces blend-spaces.json
```

- **VERIFIED — the 23 compiled ABP assets reference 71 unique `AnimSequence`s, eight
  `BlendSpace`s, and one `BlendSpace1D`.** The previous 67-clip hand-curated pack omitted 26
  directly imported sequences. Five were immediate M3 runtime gaps
  (`A_Als_Crouch_Walk_Pose`, `A_Als_Flail`, both `A_Als_Land_*_Additive` clips, and
  `A_Als_Rifle_Sprint_Impulse_Arms`); the other 21 were pose/aim assets used by non-rifle
  overlay ABPs.

- **VERIFIED — the nine BlendSpaces reference 33 unique sample/preview-base sequences.**
  Sixteen were absent from the old pack: five grounded Lean poses, five Air Lean poses, and
  the six zero-stride Walk/Run directional pose samples. `clips.manifest` now contains the
  complete union: 109 ALS-authored sequences. `validate-glb.mjs` joins
  `abp-graph.json` + `blend-spaces.json` + `clips.manifest` and rejects any direct ABP,
  BlendSpace sample, or preview-base omission.

- **VERIFIED — BlendSpace topology is ordinary tagged content.** `SampleData`,
  `BlendParameters`, axis `InterpolationParam`s, and `BlendSpaceData` triangles/segments all
  serialize legibly. One authored exception matters: `BS_Als_WalkRun_Right_Backward` sets
  `bInterpolateUsingGrid=true` and serializes four `GridSamples` instead of
  `BlendSpaceData`; the dump preserves this rather than rebuilding a Delaunay topology.
  `BS_Als_Look` is the only 1D space and sets
  `bContainsRotationOffsetMeshSpaceSamples=true`.

- **VERIFIED — expanded animation metadata inventory.** The 109-clip GLB carries 333 curves
  across 74 clips, 60 sync markers across 30 clips, and 150 notifies across 57 clips.
  Validators pin those totals and targeted sentinels for crouch locomotion, landing
  additives, and the rifle sprint impulse.

- **VERIFIED — root-motion flags live directly on each `UAnimSequence`.** Sixteen curated
  clips set `bForceRootLock`: all 12 standing/crouched Turn/Rotate clips, `A_Als_Roll`, and
  the three Mantles. All use the default-valued (therefore omitted) `RefPose` lock mode.
  Roll alone sets `bEnableRootMotion=true`; Mantles keep it false because ALS drives them
  through `FAlsRootMotionSource_Mantling`. The assembler bakes forced root locks into the
  emitted root tracks and preserves all three settings in animation extras. Typed extraction
  and independent generic uasset inspection agree on the Roll/Mantle values.

## Enhanced Input mappings

Run:

```sh
dotnet run -- dump-input-mappings "$ALS_WORK/stage" input-mappings.json
dotnet run -- validate-input-mappings input-mappings.json
```

- **VERIFIED — `IMC_Als_Default` has 31 ordered mappings across 13 InputActions.**
  `input-mappings.json` preserves keyboard/gamepad keys, mapping-level modifier order,
  action-level modifier order, and action-level triggers. WASD uses the authored
  Swizzle/Negate arrangement; `Gamepad_Left2D` uses a default-valued DeadZone, while
  `Gamepad_Right2D` applies a Y-only Negate followed by a default-valued DeadZone.
  The complete modifier inventory is 2 DeadZone, 5 Negate, 4 SwizzleAxis, and one
  action-level ScaleByDeltaTime; **there is no Scalar modifier** in the ALS mapping/action
  assets.

- **VERIFIED — Sprint and Roll deliberately share `LeftShift` and
  `Gamepad_FaceButton_Right`.** The action assets disambiguate them: Sprint uses a
  one-shot Hold at 0.1 seconds plus Released; Roll uses Tap with a 0.3-second release
  threshold. These trigger subobjects live on the InputAction packages, not the mapping
  context, so dumping the IMC alone is insufficient.

- **VERIFIED limitation — Unreal omits class-default-valued tags.** Empty
  `serializedProperties` on the DeadZone, Swizzle, Negate, Pressed, Released, and
  ScaleByDeltaTime subobjects means the asset uses that UE5.5 Enhanced Input class default.
  The extractor preserves the omission explicitly; it does not invent duplicate constants.

## Character capsule source

- **VERIFIED — ALS overrides the engine character defaults in C++.**
  `AAlsCharacter::AAlsCharacter()` calls `InitCapsuleSize(30.0f, 90.0f)` and
  `UAlsCharacterMovementComponent::UAlsCharacterMovementComponent()` calls
  `SetCrouchedHalfHeight(56.0f)`. Independent inspection of `B_Als_Character` finds no
  serialized properties on its `CollisionCylinder` or `CharMoveComp` template exports, so
  Blueprint content does not override the C++ values. In web meters these are radius 0.30,
  standing half-height 0.90, and crouched half-height 0.56.
