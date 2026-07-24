#!/usr/bin/env bash
# ALS Refactored → character + rifle GLBs, fully editor-free (no Unreal install).
#
# Chain: git clone (pinned tag) → Dump.cs (CUE4Parse: skeleton ref pose + AnimDataModel
# raw tracks + SKM_Als editor LOD0 → JSON) → assemble-glb.mjs (axis/unit
# conversion, skinned primitives, GLB) →
# validate-glb.mjs (structure + physical sanity) → copy into public/assets with the
# upstream MIT notice. clips.manifest is the audited M3 animation allowlist.
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
ln -sfn "$WORK/ALS-Refactored-$TAG" "$WORK/stage/ALS"

dotnet run -- dump \
  "$WORK/stage" "$WORK/als-dump.json" \
  SK_Als SKM_Als MI_Als_Character \
  "${ANIMS[@]}"
dotnet run -- dump \
  "$WORK/stage" "$WORK/als-rifle-dump.json" \
  SK_Als_Rifle SKM_Als_Rifle MI_Als_Rifle
[ -d node_modules ] || pnpm install
node assemble-glb.mjs "$WORK/als-dump.json" "$WORK/skm-als.glb"
node assemble-glb.mjs "$WORK/als-rifle-dump.json" "$WORK/skm-als-rifle.glb"
node validate-glb.mjs "$WORK/skm-als.glb"
node validate-rifle-glb.mjs "$WORK/skm-als-rifle.glb"

mkdir -p "$REPO_ROOT/public/assets"
cp "$WORK/skm-als.glb" "$REPO_ROOT/public/assets/skm-als.glb"
cp "$WORK/skm-als-rifle.glb" "$REPO_ROOT/public/assets/skm-als-rifle.glb"
cp "$WORK/ALS-Refactored-$TAG/LICENSE.md" "$REPO_ROOT/public/assets/LICENSE-ALS-Refactored.md"
echo "done: public/assets/skm-als.glb + skm-als-rifle.glb + LICENSE-ALS-Refactored.md"
