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
│   VERIFIED: run.sh does this today (`ln -sfn $repo $WORK/stage/ALS`)
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
│       Metadata flag bit 16 gates visibility; auto-cubic tangents aren't stored (must be
│       recomputed downstream, not read).
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
│      and index/weight width to 8-bit always. UE5.5 editor soft vertices actually carry a
│      **per-section, variable** slot count (12 for SKM_Als main body, 16 for
│      SKM_Als_Rifle — VERIFIED, see Part B) and a **per-section** `bUse16BitBoneIndex` bool
│      (read AFTER the vertex array, matching stock's `FSkelMeshSection` field order — that
│      part stock gets right). CUE4Parse's fixed-width reader silently misparses this and
│      desyncs the cursor — this is very likely the mechanism behind the exit-134 abort (a
│      cursor desync feeding a garbage huge/negative length into a subsequent
│      `ReadArray`/bulk-count read, aborting the CLR natively rather than throwing a catchable
│      .NET exception). The fix already in place (`AlsSkeletalMesh.cs`,
│      `ProbeInfluenceLayout`): brute-force search over {uvCount 1–4} × {influenceCount
│      4/8/12/16/24} × {8/16-bit index} × {8/16-bit weight}, validated by requiring the
│      subsequent `Use16BitBoneIndex` flag / `BoneMap` count / `NumVertices` /
│      `MaxBoneInfluences` fields to land exactly right. This generalizes correctly — no
│      further per-mesh hardcoding needed for future OverlayObjects meshes.
│   4. Legacy retained `NumVertices` int after `Size`, before the real (strip-flag-gated)
│      `NumVertices` — read and discard it (`_ = ar.Read<int>()`), matching the shim as-is.
│
│   NEW finding (not yet reflected in the file's header comment, which still says
│   "12 uint8 weights" — stale, should be corrected): weight width is **always 16-bit** in
│   this format, for BOTH meshes. VERIFIED two ways:
│     - Empirically: instrumented probe run against both SKM_Als (main body, 5 independent
│       sections) and SKM_Als_Rifle all matched `16bitWeight=True`, never `False` — and this
│       is not a spurious match: the anchor check requires an *exact* vertex-count match on
│       the post-array `serializedVertexCount` field, independently for each section, which a
│       wrong stride essentially cannot pass by chance.
│     - By source: `FSkelMeshSection.cs` has no `bUse16BitBoneWeight` field at all — only
│       `bUse16BitBoneIndex` is a real serialized bool. There is no format switch for weight
│       width; it's constant.
│   The apparent "8-bit vs 16-bit" difference between main body (values 0–255) and rifle
│   (values 0–65535) is NOT a wire-format difference — it's authored precision/quantization
│   scale within the same uint16 field (main body was likely imported/authored at legacy
│   byte precision and just left in the low byte of the wider field; rifle uses full 16-bit
│   scale). `Dump.cs`'s `expectedWeightSum = weightSums.Max() > byte.MaxValue ? ushort.MaxValue
│   : byte.MaxValue` already handles this correctly per-mesh — no code change needed, just
│   correct the misleading header comment in `AlsSkeletalMesh.cs` when next touching that file.
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
│   What differs from SKM_Als, precisely (instrumented `ProbeInfluenceLayout` to print the
│   winning candidate):
│     - Skeleton: 9 bones vs SKM_Als's much larger skeleton (smaller-skeleton hypothesis
│       from the task brief — CONFIRMED).
│     - Sections: 1 vs SKM_Als's several.
│     - Influence slots: 16 vs SKM_Als's 12 (both matched consistently, not a fluke — see
│       above). This is the actual "pinpointed divergence": OverlayObjects meshes are not
│       guaranteed to share the main body's 12-slot influence layout, and a hardcoded
│       assumption of "12" (which is what the OLD, pre-fix version of this file effectively
│       had, per its still-current stale header comment) would misparse the rifle and,
│       per seam 3 above, plausibly explains the previously-reported exit-134 abort.
│     - Weight magnitude: 0–65535 (full 16-bit precision) vs main body's 0–255-in-a-uint16.
│       `MaxBoneInfluences=1` for every rifle vertex (simple rigid single-bone skin, as
│       expected for a prop).
│     - Index width, UV count (4), section-user-data map, strip-flags seam: all identical
│       to SKM_Als — no additional divergence found there.
│   Bottom line: the current general (probe-based) shim already generalizes correctly to the
│   rifle. There is no further code change to recommend here — the fix is exactly "don't
│   hardcode the influence-slot count; keep the brute-force probe." If the parallel agent's
│   exit-134 was hit against an OLDER/hardcoded version of this file, it's already resolved
│   by the generalization now in place; if it recurs, re-run with the
│   `ProbeInfluenceLayout`-instrumentation trick above (temporary `Console.Error.WriteLine` at
│   the `return (...)` site) to see which candidate — or none — matched, and widen the
│   `influenceCount` candidate list (currently `{4,8,12,16,24}`) or `uvCount` range if the
│   fallback stride-scan (already present, throws with `matchingStrides` diagnostics) reports
│   a stride outside those bounds.
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

## Key file/line references
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/AlsSkeletalMesh.cs` — the shim; `ProbeInfluenceLayout` (lines ~199-272) is the generalized fix, header comment (lines ~11-17) needs the uint8→uint16-weight correction
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/Dump.cs` — `expectedWeightSum` per-mesh magnitude handling (~line 108-115)
- `/Users/btnorris/dev/games/echelon/tech-demos/als-ue5-r3f/scripts/extract-als/assemble-glb.mjs` — bone canonicalization (`canonicalBoneName`), winding note (~line 270-277)
- Probe artifacts (throwaway, in tmp): `/Users/btnorris/.claude/jobs/c3251c49/tmp/ser-recon/extract-als-probe/` (instrumented copy), `rifle-dump.json`, `/tmp/main-dump.json`, `/tmp/rifle-dump2.json`, `/tmp/sm-box.json`, `/tmp/sound.json`