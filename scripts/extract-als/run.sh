#!/usr/bin/env bash
# ALS Refactored → public/assets/skm-als.glb, fully editor-free (no Unreal install).
#
# Chain: git clone (pinned tag) → Dump.cs (CUE4Parse: skeleton ref pose + AnimDataModel
# raw tracks → JSON) → assemble-glb.mjs (axis/unit conversion, proxy body, GLB) →
# validate-glb.mjs (structure + physical sanity) → copy into public/assets with the
# upstream MIT notice. Extend the anim list here + ANIM extraction in M2.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${ALS_TAG:-4.15}"
WORK="${ALS_WORK:-$HOME/.cache/als-extract}"
REPO_ROOT="$(cd ../.. && pwd)"
ANIMS=(A_Als_Stand_Pose A_Als_Idle)

mkdir -p "$WORK/stage"
if [ ! -d "$WORK/ALS-Refactored-$TAG" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/Sixze/ALS-Refactored "$WORK/ALS-Refactored-$TAG"
fi
ln -sfn "$WORK/ALS-Refactored-$TAG" "$WORK/stage/ALS"

dotnet run -- dump "$WORK/stage" "$WORK/als-dump.json" "${ANIMS[@]}"
[ -d node_modules ] || pnpm install
node assemble-glb.mjs "$WORK/als-dump.json" "$WORK/skm-als.glb"
node validate-glb.mjs "$WORK/skm-als.glb"

mkdir -p "$REPO_ROOT/public/assets"
cp "$WORK/skm-als.glb" "$REPO_ROOT/public/assets/skm-als.glb"
cp "$WORK/ALS-Refactored-$TAG/LICENSE.md" "$REPO_ROOT/public/assets/LICENSE-ALS-Refactored.md"
echo "done: public/assets/skm-als.glb + LICENSE-ALS-Refactored.md"
