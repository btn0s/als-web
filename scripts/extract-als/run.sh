#!/usr/bin/env bash
# ALS Refactored → character/rifle GLBs + compiled ABP graph, fully editor-free.
#
# Chain: git clone (pinned tag) → Dump.cs (CUE4Parse: skeleton ref pose + AnimDataModel
# raw tracks + SKM_Als editor LOD0 → JSON) → assemble-glb.mjs (axis/unit
# conversion, skinned primitives, GLB) →
# validate-glb.mjs (structure + physical sanity) → AbpDump.cs (compiled FAnimNode
# structs + validation lookups) → BlendSpaceDump.cs (authored axes/samples/topology)
# → MovementSettingsDump.cs (MS_Als_Normal + every referenced rich curve) →
# AnimationInstanceSettingsDump.cs (AIS_Als_Default locomotion curves + C++ cadence defaults) →
# SkeletonProfilesDump.cs (SK_Als authored per-bone blend profiles) →
# InputMappingDump.cs (IMC + action triggers/modifiers) →
# CameraContentDump.cs (camera defaults + scalar graph + authored transition curves) →
# GridLevelContentDump.cs (L_Als_Grid floor/sky/post-process external actors) →
# MantlingContentDump.cs (character/mantling settings + montage clocks + correction curves) →
# ActionContentDump.cs (Rolling/GettingUp settings + montage/notify/root-motion clocks) →
# PhysicsAssetDump.cs (PA_Als bodies/shapes/constraints/collision-disable topology) →
# copy distributable assets
# with the upstream MIT notice.
# clips.manifest is the audited M3 animation allowlist.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${ALS_TAG:-4.15}"
WORK="${ALS_WORK:-$HOME/.cache/als-extract}"
REPO_ROOT="$(cd ../.. && pwd)"
ANIMS=()
while IFS='|' read -r clip purpose checklist; do
  [[ -z "$clip" || "$clip" == \#* ]] && continue
  ANIMS+=("$clip")
done < clips.manifest

mkdir -p "$WORK/stage"
if [ ! -d "$WORK/ALS-Refactored-$TAG" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/Sixze/ALS-Refactored "$WORK/ALS-Refactored-$TAG"
fi
if [ ! -d "$WORK/stage/ALS" ] ||
   [ "$(cd "$WORK/stage/ALS" && pwd -P)" != "$(cd "$WORK/ALS-Refactored-$TAG" && pwd -P)" ]; then
  ln -sfn "$WORK/ALS-Refactored-$TAG" "$WORK/stage/ALS"
fi

dotnet run -- dump \
  "$WORK/stage" "$WORK/als-dump.json" \
  SK_Als SKM_Als MI_Als_Character \
  "${ANIMS[@]}"
dotnet run -- dump \
  "$WORK/stage" "$WORK/als-rifle-dump.json" \
  SK_Als_Rifle SKM_Als_Rifle MI_Als_Rifle
dotnet run -- dump-abp "$WORK/stage" "$WORK/abp-graph.json"
dotnet run -- validate-abp "$WORK/abp-graph.json"
dotnet run -- dump-blend-spaces "$WORK/stage" "$WORK/blend-spaces.json"
dotnet run -- validate-blend-spaces "$WORK/blend-spaces.json"
dotnet run -- dump-movement-settings "$WORK/stage" "$WORK/movement-settings.json"
dotnet run -- validate-movement-settings "$WORK/movement-settings.json"
dotnet run -- dump-character-settings "$WORK/stage" "$WORK/character-settings.json"
dotnet run -- validate-character-settings "$WORK/character-settings.json"
dotnet run -- dump-animation-settings "$WORK/stage" "$WORK/animation-settings.json"
dotnet run -- validate-animation-settings "$WORK/animation-settings.json"
dotnet run -- dump-skeleton-profiles "$WORK/stage" "$WORK/skeleton-profiles.json"
dotnet run -- validate-skeleton-profiles "$WORK/skeleton-profiles.json"
dotnet run -- dump-input-mappings "$WORK/stage" "$WORK/input-mappings.json"
dotnet run -- validate-input-mappings "$WORK/input-mappings.json"
dotnet run -- dump-camera-content "$WORK/stage" "$WORK/camera-content.json"
dotnet run -- validate-camera-content "$WORK/camera-content.json"
dotnet run -- dump-grid-level-content "$WORK/stage" "$WORK/grid-level-content.json"
dotnet run -- validate-grid-level-content "$WORK/grid-level-content.json"
dotnet run -- dump-mantling-content "$WORK/stage" "$WORK/mantling-content.json"
dotnet run -- validate-mantling-content "$WORK/mantling-content.json"
dotnet run -- dump-action-content "$WORK/stage" "$WORK/action-content.json"
dotnet run -- validate-action-content "$WORK/action-content.json"
dotnet run -- dump-physics-asset "$WORK/stage" "$WORK/physics-asset.json"
dotnet run -- validate-physics-asset "$WORK/physics-asset.json"
[ -d node_modules ] || pnpm install
node assemble-glb.mjs "$WORK/als-dump.json" "$WORK/skm-als.glb"
node assemble-glb.mjs "$WORK/als-rifle-dump.json" "$WORK/skm-als-rifle.glb"
node validate-glb.mjs \
  "$WORK/skm-als.glb" \
  "$WORK/abp-graph.json" \
  "$WORK/blend-spaces.json"
node validate-rifle-glb.mjs "$WORK/skm-als-rifle.glb"

mkdir -p "$REPO_ROOT/public/assets"
cp "$WORK/skm-als.glb" "$REPO_ROOT/public/assets/skm-als.glb"
cp "$WORK/skm-als-rifle.glb" "$REPO_ROOT/public/assets/skm-als-rifle.glb"
cp "$WORK/ALS-Refactored-$TAG/LICENSE.md" "$REPO_ROOT/public/assets/LICENSE-ALS-Refactored.md"
ABP_GRAPH_SIZE="$(wc -c < "$WORK/abp-graph.json" | tr -d '[:space:]')"
if (( ABP_GRAPH_SIZE < 1048576 )); then
  cp "$WORK/abp-graph.json" "$REPO_ROOT/public/assets/abp-graph.json"
  ABP_GRAPH_DESTINATION="public/assets/abp-graph.json"
else
  cp "$WORK/abp-graph.json" "$REPO_ROOT/scripts/extract-als/abp-graph.json"
  ABP_GRAPH_DESTINATION="scripts/extract-als/abp-graph.json"
fi
cp "$WORK/movement-settings.json" "$REPO_ROOT/scripts/extract-als/movement-settings.json"
cp "$WORK/character-settings.json" "$REPO_ROOT/scripts/extract-als/character-settings.json"
cp "$WORK/animation-settings.json" "$REPO_ROOT/scripts/extract-als/animation-settings.json"
cp "$WORK/skeleton-profiles.json" "$REPO_ROOT/scripts/extract-als/skeleton-profiles.json"
cp "$WORK/blend-spaces.json" "$REPO_ROOT/scripts/extract-als/blend-spaces.json"
cp "$WORK/input-mappings.json" "$REPO_ROOT/scripts/extract-als/input-mappings.json"
cp "$WORK/camera-content.json" "$REPO_ROOT/scripts/extract-als/camera-content.json"
cp "$WORK/grid-level-content.json" "$REPO_ROOT/scripts/extract-als/grid-level-content.json"
cp "$WORK/mantling-content.json" "$REPO_ROOT/scripts/extract-als/mantling-content.json"
cp "$WORK/action-content.json" "$REPO_ROOT/scripts/extract-als/action-content.json"
cp "$WORK/physics-asset.json" "$REPO_ROOT/scripts/extract-als/physics-asset.json"
echo "done: public/assets/skm-als.glb + skm-als-rifle.glb + LICENSE-ALS-Refactored.md"
echo "done: $ABP_GRAPH_DESTINATION ($ABP_GRAPH_SIZE bytes)"
echo "done: scripts/extract-als/{movement-settings,character-settings,animation-settings,skeleton-profiles,blend-spaces,input-mappings,camera-content,grid-level-content,mantling-content,action-content,physics-asset}.json"
