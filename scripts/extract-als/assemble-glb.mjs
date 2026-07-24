// Stage 2 of the ALS extraction chain: JSON (from Dump.cs) → GLB.
//
// Does the three things the C# stage deliberately leaves alone:
//   1. Track selection — AnimDataModel stores the ORIGINAL imported source keys
//      (full pose), even for sequences marked AAT_LocalSpaceBase: UE derives the
//      additive delta at cook/playback, not in the editor source. So a "playable
//      idle" is just the idle's own tracks. (M2 note: to USE an anim as an
//      additive overlay web-side, derive delta = track ⊖ ref_pose_seq at build.)
//   2. Basis/unit conversion — UE is cm, Z-up, left-handed; glTF is m, Y-up,
//      right-handed. Conversion is conjugation by C = (x,y,z)→(x,z,y), which is
//      its own inverse; det(C)=-1 but conjugating a proper rotation stays proper,
//      so no hand-tuned sign flips. Positions: C·p·0.01.
//   3. GLB writing — bone nodes, skin with IBMs from the converted bind pose, and
//      skeletal-mesh LOD0 primitives. A rigid bone proxy remains available only when an
//      older dump does not contain mesh geometry.
//
// Usage: node assemble-glb.mjs <dump.json> <out.glb>

import { Document, NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';

const [jsonPath, outPath] = process.argv.slice(2);
if (!outPath) { console.error('usage: node assemble-glb.mjs <dump.json> <out.glb>'); process.exit(1); }
const dump = JSON.parse(readFileSync(jsonPath, 'utf8'));

// ---------- minimal quat/mat helpers (column-major 3x3) ----------
const quatToMat = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
  2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
  2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
];
const matToQuat = (m) => {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
};
const qMul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const qNorm = (q) => { const n = Math.hypot(...q); return q.map((v) => v / n); };

// C-conjugation: swap rows/cols 1<->2 of the rotation matrix.
const convertQuat = (q) => {
  const m = quatToMat(q);
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  return matToQuat([m00, m20, m10, m02, m22, m12, m01, m21, m11]);
};
const convertPos = ([x, y, z]) => [x * 0.01, z * 0.01, y * 0.01];
const convertScale = ([x, y, z]) => [x, z, y];

// ---------- prepare clips (UE space) ----------
const { bones } = dump.skeleton;
const rootBones = bones.filter((bone) => bone.parent < 0);
if (rootBones.length !== 1)
  throw new Error(`expected exactly one skeleton root, found ${rootBones.length}`);
const rootBoneName = rootBones[0].name;
const key = (arr, i) => arr.length === 0 ? null : arr[Math.min(i, arr.length - 1)];
const refByName = Object.fromEntries(bones.map((b) => [b.name, b]));
const canonicalBoneByLower = new Map(bones.map((b) => [b.name.toLowerCase(), b.name]));
const canonicalBoneName = (clipName, sourceName) => {
  const canonical = canonicalBoneByLower.get(sourceName.toLowerCase());
  if (!canonical) throw new Error(`${clipName} track targets unknown bone: ${sourceName}`);
  return canonical;
};
const compactFloat = (value) => Number(Number(value).toPrecision(6));
const rootLockModes = new Set(['RefPose', 'AnimFirstFrame', 'Zero']);
const readRootMotionSettings = (anim) => {
  if (typeof anim.bEnableRootMotion !== 'boolean')
    throw new Error(`${anim.name} has no exact bEnableRootMotion metadata`);
  if (typeof anim.bForceRootLock !== 'boolean')
    throw new Error(`${anim.name} has no exact bForceRootLock metadata`);
  if (!rootLockModes.has(anim.RootMotionRootLock))
    throw new Error(
      `${anim.name} has unsupported RootMotionRootLock metadata: ` +
      `${JSON.stringify(anim.RootMotionRootLock)}`);
  return {
    bEnableRootMotion: anim.bEnableRootMotion,
    bForceRootLock: anim.bForceRootLock,
    RootMotionRootLock: anim.RootMotionRootLock,
  };
};
const bakeRootLock = (anim, rootMotionSettings, shouldBakeRootLock, bone, pos, rot) => {
  if (!shouldBakeRootLock || bone !== rootBoneName)
    return { pos, rot };

  // Unreal evaluates bForceRootLock by resetting bone 0 on every pose, even
  // when root motion extraction is disabled. Preserve that authored sequence
  // behavior in the clip itself so every web-side sampler sees the same pose.
  let lockedPos;
  let lockedRot;
  switch (rootMotionSettings.RootMotionRootLock) {
    case 'RefPose':
      lockedPos = refByName[bone].t;
      lockedRot = qNorm(refByName[bone].r);
      break;
    case 'AnimFirstFrame':
      lockedPos = pos[0];
      lockedRot = rot[0];
      break;
    case 'Zero':
      lockedPos = [0, 0, 0];
      lockedRot = [0, 0, 0, 1];
      break;
  }

  return {
    pos: Array.from({ length: anim.numberOfKeys }, () => lockedPos),
    rot: Array.from({ length: anim.numberOfKeys }, () => lockedRot),
  };
};
// AnimDataModel tracks are full-pose source keys — playable directly, one glTF
// clip per dumped sequence (pose sequences like A_Als_Stand_Pose included). A few
// upstream arms-only clips retain import-time bone-name capitalization; canonicalize
// those names against SK_Als so every channel binds instead of becoming targetless.
const clips = dump.anims.map((a) => {
  const rootMotionSettings = readRootMotionSettings(a);
  const sourceTracks = a.tracks.map((t) => {
    const bone = canonicalBoneName(a.name, t.bone);
    return {
      bone,
      pos: Array.from({ length: a.numberOfKeys }, (_, i) => key(t.pos, i) ?? refByName[bone].t),
      rot: Array.from({ length: a.numberOfKeys }, (_, i) => qNorm(key(t.rot, i) ?? refByName[bone].r)),
    };
  });
  const sourceRootTrack = sourceTracks.find((track) => track.bone === rootBoneName);
  if (rootMotionSettings.bForceRootLock && !sourceRootTrack)
    throw new Error(`${a.name} enables bForceRootLock but has no ${rootBoneName} track`);
  const rootTranslationChanges = sourceRootTrack?.pos.some((position) =>
    position.some((value, axis) => Math.abs(value - sourceRootTrack.pos[0][axis]) > 1e-6)) ?? false;
  // Tactical compatibility seam: the evaluator currently extracts motion from
  // the GLB root channel itself. Keep action trajectories there until it reads
  // rawRootTrack and resets the output pose afterward. The current ALS pack's
  // exact split is 12 rotational turn/rotate clips baked, with Roll and three
  // translational Mantles kept raw.
  const shouldBakeRootLock = rootMotionSettings.bForceRootLock &&
    !rootMotionSettings.bEnableRootMotion &&
    !rootTranslationChanges;

  return {
    name: a.name,
    fps: a.fps,
    numKeys: a.numberOfKeys,
    rootMotionSettings,
    // Root-motion extraction reads the authored root trajectory before Unreal
    // resets bone 0 for the output pose. Keep that source trajectory beside the
    // pose channels so the runtime can close the action-pose reset gap above
    // without another content extraction change.
    rawRootTrack: rootMotionSettings.bForceRootLock ? sourceRootTrack : undefined,
    tracks: sourceTracks.map((track) => {
      return {
        bone: track.bone,
        ...bakeRootLock(
          a,
          rootMotionSettings,
          shouldBakeRootLock,
          track.bone,
          track.pos,
          track.rot),
      };
    }),
    curves: (a.curves ?? []).map((curve) => ({
      name: curve.name,
      flags: curve.flags,
      keys: curve.keys.map(([t, v, interp]) => [compactFloat(t), compactFloat(v), interp]),
    })),
    syncMarkers: (a.syncMarkers ?? []).map(({ name, time }) => ({
      name,
      time: compactFloat(time),
    })),
    notifies: (a.notifies ?? []).map(({ name, time }) => ({
      name,
      time: compactFloat(time),
    })),
  };
});

// ---------- build document ----------
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');

const nodes = bones.map((b, i) => {
  const node = doc.createNode(b.name)
    .setTranslation(convertPos(b.t))
    .setRotation(convertQuat(b.r))
    .setScale(convertScale(b.s));
  return node;
});
bones.forEach((b, i) => { if (b.parent >= 0) nodes[b.parent].addChild(nodes[i]); else scene.addChild(nodes[i]); });

// world bind matrices (converted space) for IBMs + proxy geometry
const composeTRS = (t, q, s) => {
  const m = quatToMat(q);
  return [
    m[0] * s[0], m[1] * s[0], m[2] * s[0], 0,
    m[3] * s[1], m[4] * s[1], m[5] * s[1], 0,
    m[6] * s[2], m[7] * s[2], m[8] * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const mul4 = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const inv4Rigid = (m) => { // rigid+uniform-scale inverse is fine for bind poses
  // general inverse via adjugate would be safer; bind poses here are rigid, do transpose-based
  const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  // assume orthonormal (scale 1): R^T
  const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  const t = [m[12], m[13], m[14]];
  const ti = [
    -(rt[0] * t[0] + rt[3] * t[1] + rt[6] * t[2]),
    -(rt[1] * t[0] + rt[4] * t[1] + rt[7] * t[2]),
    -(rt[2] * t[0] + rt[5] * t[1] + rt[8] * t[2]),
  ];
  return [rt[0], rt[1], rt[2], 0, rt[3], rt[4], rt[5], 0, rt[6], rt[7], rt[8], 0, ti[0], ti[1], ti[2], 1];
};
const world = [];
bones.forEach((b, i) => {
  const local = composeTRS(convertPos(b.t), convertQuat(b.r), convertScale(b.s));
  world[i] = b.parent >= 0 ? mul4(world[b.parent], local) : local;
});

// ---------- real LOD0 mesh, with the M0 proxy retained as a dump fallback ----------
const convertNormal = ([x, y, z]) => {
  const converted = [x, z, y];
  const length = Math.hypot(...converted);
  if (length < 1e-8) throw new Error('mesh contains a zero-length normal');
  return converted.map((value) => value / length);
};

// Named trade: the editor asset's AUTHORED tangents don't decode yet (the C# reader lands the
// TangentZ slot on constant bytes — every dumped normal is [-1,-1,-1]). Until that decode is
// fixed, compute smooth area-weighted vertex normals from the geometry itself, per section,
// welding duplicate positions so seams within a section stay smooth. Untextured gray body ⇒
// visually equivalent; revisit only if authored hard edges start to matter.
const dumpedNormalsAreDegenerate = (sections) => {
  const first = sections[0]?.normals?.[0];
  return !first || sections.every((s) => s.normals.every(
    (n) => n[0] === first[0] && n[1] === first[1] && n[2] === first[2]));
};
const computeSectionNormals = (positions, indices) => {
  const weldKey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  const weldAccum = new Map();
  const accumFor = (p) => {
    const k = weldKey(p);
    let a = weldAccum.get(k);
    if (!a) { a = [0, 0, 0]; weldAccum.set(k, a); }
    return a;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = positions[indices[t]], b = positions[indices[t + 1]], c = positions[indices[t + 2]];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    // cross product magnitude is 2x triangle area — leave unnormalized for area weighting
    const n = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    for (const p of [a, b, c]) {
      const acc = accumFor(p);
      acc[0] += n[0]; acc[1] += n[1]; acc[2] += n[2];
    }
  }
  return positions.map((p) => {
    const a = accumFor(p);
    const len = Math.hypot(...a) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  });
};
const computeSignedVolume = (positions, indices) => {
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = positions[indices[index]];
    const b = positions[indices[index + 1]];
    const c = positions[indices[index + 2]];
    volume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return volume;
};
let mesh;
let meshStats;
if (dump.mesh?.sections?.length) {
  mesh = doc.createMesh(dump.mesh.name ?? 'SkeletalMesh');
  const materials = new Map();
  const baseColor = dump.material?.baseColor ?? [0.55, 0.57, 0.6, 1];
  if (baseColor.length !== 4 || baseColor.some((value) => !Number.isFinite(value)))
    throw new Error(`invalid material base color: ${JSON.stringify(baseColor)}`);
  let vertexCount = 0;
  let triangleCount = 0;
  let verticesOverFourInfluences = 0;
  const signedVolumes = [];

  const useComputedNormals = dumpedNormalsAreDegenerate(dump.mesh.sections);
  if (useComputedNormals) console.warn('dumped normals are degenerate — computing smooth normals from geometry');

  for (const [sectionIndex, section] of dump.mesh.sections.entries()) {
    const convertedPositions = section.positions.map(convertPos);
    const sectionPositions = convertedPositions.flat();
    // Computed normals come from CONVERTED positions + EMITTED winding, so no
    // pseudovector sign juggling is possible; authored normals (once the decode
    // works) go through convertNormal instead.
    const sectionNormals = useComputedNormals
      ? computeSectionNormals(convertedPositions, section.indices).flat()
      : section.normals.flatMap(convertNormal);
    const sectionUVs = section.uv0.flat();
    const sectionJoints = [];
    const sectionWeights = [];

    for (let vertexIndex = 0; vertexIndex < section.positions.length; vertexIndex++) {
      const influences = section.weights[vertexIndex]
        .map((weight, influenceIndex) => ({
          weight,
          localJoint: section.joints[vertexIndex][influenceIndex],
        }))
        .filter(({ weight }) => weight > 0)
        .map(({ weight, localJoint }) => {
          const skinJoint = section.boneMap[localJoint];
          if (!Number.isInteger(skinJoint) || skinJoint < 0 || skinJoint >= bones.length) {
            throw new Error(
              `section ${sectionIndex} vertex ${vertexIndex} maps local joint ${localJoint} outside BoneMap`);
          }
          return { weight, skinJoint };
        })
        .sort((a, b) => b.weight - a.weight);

      if (influences.length > 4) verticesOverFourInfluences++;
      const selected = influences.slice(0, 4);
      const totalWeight = selected.reduce((sum, influence) => sum + influence.weight, 0);
      if (totalWeight <= 0) throw new Error(`section ${sectionIndex} vertex ${vertexIndex} has no skin weight`);
      for (let i = 0; i < 4; i++) {
        sectionJoints.push(selected[i]?.skinJoint ?? 0);
        sectionWeights.push((selected[i]?.weight ?? 0) / totalWeight);
      }
    }

    // Winding: verified empirically (signed-volume test, 2026-07-23) — UE's stored index
    // order is ALREADY front-facing after the C basis swap; reversing it turned the model
    // inside-out (the "see-through" playtest report). Emit source order unchanged.
    const sectionIndices = section.indices.slice();
    const signedVolume = computeSignedVolume(convertedPositions, sectionIndices);
    if (!(signedVolume > 1e-10))
      throw new Error(
        `section ${sectionIndex} signed volume ${signedVolume} is not positive; winding suspect`);
    signedVolumes.push(signedVolume);

    const material = materials.get(section.materialName) ?? doc.createMaterial(section.materialName)
      .setBaseColorFactor(baseColor)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.8);
    materials.set(section.materialName, material);

    const primitive = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor()
        .setType('VEC3').setArray(new Float32Array(sectionPositions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor()
        .setType('VEC3').setArray(new Float32Array(sectionNormals)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor()
        .setType('VEC2').setArray(new Float32Array(sectionUVs)).setBuffer(buffer))
      .setAttribute('JOINTS_0', doc.createAccessor()
        .setType('VEC4').setArray(new Uint16Array(sectionJoints)).setBuffer(buffer))
      .setAttribute('WEIGHTS_0', doc.createAccessor()
        .setType('VEC4').setArray(new Float32Array(sectionWeights)).setBuffer(buffer))
      .setIndices(doc.createAccessor()
        .setType('SCALAR').setArray(new Uint32Array(sectionIndices)).setBuffer(buffer))
      .setMaterial(material);
    mesh.addPrimitive(primitive);
    vertexCount += section.positions.length;
    triangleCount += section.indices.length / 3;
  }

  if (vertexCount !== dump.mesh.numVertices || triangleCount !== dump.mesh.numTriangles)
    throw new Error(
      `assembled mesh totals ${vertexCount}/${triangleCount}, dump reports ` +
      `${dump.mesh.numVertices}/${dump.mesh.numTriangles}`);
  if (verticesOverFourInfluences !== dump.mesh.verticesOverFourInfluences)
    throw new Error(
      `influence reduction count ${verticesOverFourInfluences}, dump reports ` +
      `${dump.mesh.verticesOverFourInfluences}`);
  meshStats = {
    kind: 'real',
    vertexCount,
    triangleCount,
    sectionCount: dump.mesh.sections.length,
    verticesOverFourInfluences,
    signedVolumes,
  };
} else {
  const positions = [], joints = [], weights = [], indices = [];
  const childrenOf = bones.map(() => []);
  bones.forEach((b, i) => { if (b.parent >= 0) childrenOf[b.parent].push(i); });
  const visual = (n) => !/^(ik_|root$|VB )/.test(n);
  const boxTo = (ji, from, to, thick) => {
    const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(...dir);
    if (len < 1e-4) return;
    const d = dir.map((v) => v / len);
    const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const sX = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
    const nX = Math.hypot(...sX); const x = sX.map((v) => (v / nX) * thick);
    const y = [d[1] * x[2] - d[2] * x[1], d[2] * x[0] - d[0] * x[2], d[0] * x[1] - d[1] * x[0]];
    const vbase = positions.length / 3;
    const corners = [];
    for (const e of [from, to]) for (const a of [-1, 1]) for (const b2 of [-1, 1])
      corners.push([e[0] + a * x[0] + b2 * y[0], e[1] + a * x[1] + b2 * y[1], e[2] + a * x[2] + b2 * y[2]]);
    corners.forEach((c) => { positions.push(...c); joints.push(ji, 0, 0, 0); weights.push(1, 0, 0, 0); });
    const f = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
    f.forEach(([a,b,c,d2]) => indices.push(vbase+a, vbase+b, vbase+c, vbase+a, vbase+c, vbase+d2));
  };
  bones.forEach((b, i) => {
    if (!visual(b.name)) return;
    const from = [world[i][12], world[i][13], world[i][14]];
    const kids = childrenOf[i].filter((c) => visual(bones[c].name));
    if (kids.length === 0) boxTo(i, from, [from[0], from[1] + 0.04, from[2]], 0.02);
    else kids.forEach((c) => boxTo(i, from, [world[c][12], world[c][13], world[c][14]], 0.018));
  });

  const material = doc.createMaterial('proxy')
    .setBaseColorFactor([0.55, 0.57, 0.6, 1]).setMetallicFactor(0).setRoughnessFactor(0.8);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor()
      .setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('JOINTS_0', doc.createAccessor()
      .setType('VEC4').setArray(new Uint16Array(joints)).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', doc.createAccessor()
      .setType('VEC4').setArray(new Float32Array(weights)).setBuffer(buffer))
    .setIndices(doc.createAccessor()
      .setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  mesh = doc.createMesh('SKM_Als_Proxy').addPrimitive(primitive);
  meshStats = {
    kind: 'proxy',
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    sectionCount: 1,
    verticesOverFourInfluences: 0,
  };
}

const ibms = new Float32Array(bones.length * 16);
bones.forEach((b, i) => ibms.set(inv4Rigid(world[i]), i * 16));
const ibmAcc = doc.createAccessor().setType('MAT4').setArray(ibms).setBuffer(buffer);
const skin = doc.createSkin('SK_Als').setInverseBindMatrices(ibmAcc);
skin.setName(dump.skeleton.name ?? 'Skeleton');
nodes.forEach((n) => skin.addJoint(n));
skin.setSkeleton(nodes[0]);
const meshNode = doc.createNode(dump.mesh?.name ?? 'SkeletalMesh').setMesh(mesh).setSkin(skin);
scene.addChild(meshNode);

// ---------- animations ----------
const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));
for (const clip of clips) {
  // Runtime contract: animation.extras.alsCurves is
  // [{ name, flags, keys: [[timeSeconds, value, ueInterpMode], ...] }].
  // Alongside it, animation.extras.syncMarkers and animation.extras.notifies are
  // [{ name, time }], where time is authored seconds in the UAnimSequence.
  // UE auto-cubic keys store zero tangents because the editor computes them; preserve the
  // authored interpolation enum, but consumers intentionally sample t/v linearly for now.
  const extras = {
    alsCurves: clip.curves,
    syncMarkers: clip.syncMarkers,
    notifies: clip.notifies,
    ...clip.rootMotionSettings,
  };
  if (clip.rawRootTrack) {
    extras.rawRootTrack = {
      times: Array.from({ length: clip.numKeys }, (_, i) => i / clip.fps),
      translations: clip.rawRootTrack.pos.map(convertPos),
      rotations: clip.rawRootTrack.rot.map(convertQuat),
    };
  }
  const anim = doc.createAnimation(clip.name).setExtras(extras);
  const times = Float32Array.from({ length: clip.numKeys }, (_, i) => i / clip.fps);
  const timeAcc = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  for (const t of clip.tracks) {
    const node = nodes[boneIndex[t.bone]];
    const addChannel = (path, acc) => {
      const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(acc).setInterpolation('LINEAR');
      const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);
      anim.addSampler(sampler).addChannel(channel);
    };
    addChannel('rotation', doc.createAccessor().setType('VEC4').setArray(new Float32Array(t.rot.flatMap(convertQuat))).setBuffer(buffer));
    addChannel('translation', doc.createAccessor().setType('VEC3').setArray(new Float32Array(t.pos.flatMap(convertPos))).setBuffer(buffer));
  }
}

await new NodeIO().write(outPath, doc);
const clipDesc = clips.map((c) => `${c.name} ${(c.numKeys / c.fps).toFixed(2)}s`).join(', ');
console.log(
  `wrote ${outPath}: ${bones.length} joints, ${meshStats.vertexCount} ${meshStats.kind} verts, ` +
  `${meshStats.triangleCount} triangles, ${meshStats.sectionCount} sections, ` +
  `${meshStats.verticesOverFourInfluences} vertices reduced to four influences, ` +
  `signed volumes: ${(meshStats.signedVolumes ?? []).map((volume) => volume.toExponential(3)).join(', ') || 'n/a'}, ` +
  `clips: ${clipDesc || 'none'}`);
