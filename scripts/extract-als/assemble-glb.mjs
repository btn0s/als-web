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
//      a rigid-skinned proxy body (box per bone segment). The proxy stands in for
//      SKM_Als's real geometry until the M2 editor-bulk mesh parser lands.
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
const key = (arr, i) => arr.length === 0 ? null : arr[Math.min(i, arr.length - 1)];
const refByName = Object.fromEntries(bones.map((b) => [b.name, b]));
// AnimDataModel tracks are full-pose source keys — playable directly, one glTF
// clip per dumped sequence (pose sequences like A_Als_Stand_Pose included).
const clips = dump.anims.map((a) => ({
  name: a.name,
  fps: a.fps,
  numKeys: a.numberOfKeys,
  tracks: a.tracks.map((t) => ({
    bone: t.bone,
    pos: Array.from({ length: a.numberOfKeys }, (_, i) => key(t.pos, i) ?? refByName[t.bone].t),
    rot: Array.from({ length: a.numberOfKeys }, (_, i) => qNorm(key(t.rot, i) ?? refByName[t.bone].r)),
  })),
}));

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

// ---------- proxy body: one box per bone segment ----------
const positions = [], joints = [], weights = [], indices = [];
const jointOf = [], childrenOf = bones.map(() => []);
bones.forEach((b, i) => { if (b.parent >= 0) childrenOf[b.parent].push(i); });
const visual = (n) => !/^(ik_|root$|VB )/.test(n);
const boxTo = (ji, from, to, thick) => {
  const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(...dir);
  if (len < 1e-4) return;
  const d = dir.map((v) => v / len);
  let up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const sX = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const nX = Math.hypot(...sX); const x = sX.map((v) => (v / nX) * thick);
  const y = [d[1] * x[2] - d[2] * x[1], d[2] * x[0] - d[0] * x[2], d[0] * x[1] - d[1] * x[0]].map((v) => v * 1);
  const vbase = positions.length / 3;
  const corners = [];
  for (const e of [from, to]) for (const a of [-1, 1]) for (const b2 of [-1, 1])
    corners.push([e[0] + a * x[0] + b2 * y[0], e[1] + a * x[1] + b2 * y[1], e[2] + a * x[2] + b2 * y[2]]);
  corners.forEach((c) => { positions.push(...c); joints.push(ji, 0, 0, 0); weights.push(1, 0, 0, 0); });
  const f = [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  f.forEach(([a2,b3,c2,d2]) => indices.push(vbase+a2, vbase+b3, vbase+c2, vbase+a2, vbase+c2, vbase+d2));
};
bones.forEach((b, i) => {
  if (!visual(b.name)) return;
  const from = [world[i][12], world[i][13], world[i][14]];
  const kids = childrenOf[i].filter((c) => visual(bones[c].name));
  if (kids.length === 0) {
    boxTo(i, from, [from[0], from[1] + 0.04, from[2]], 0.02); // leaf nub
  } else {
    kids.forEach((c) => boxTo(i, from, [world[c][12], world[c][13], world[c][14]], 0.018));
  }
});

const posAcc = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer);
const jointAcc = doc.createAccessor().setType('VEC4').setArray(new Uint16Array(joints)).setBuffer(buffer);
const weightAcc = doc.createAccessor().setType('VEC4').setArray(new Float32Array(weights)).setBuffer(buffer);
const idxAcc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer);
const mat = doc.createMaterial('proxy').setBaseColorFactor([0.55, 0.57, 0.6, 1]).setMetallicFactor(0).setRoughnessFactor(0.8);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', posAcc).setAttribute('JOINTS_0', jointAcc).setAttribute('WEIGHTS_0', weightAcc)
  .setIndices(idxAcc).setMaterial(mat);
const mesh = doc.createMesh('SKM_Als_Proxy').addPrimitive(prim);

const ibms = new Float32Array(bones.length * 16);
bones.forEach((b, i) => ibms.set(inv4Rigid(world[i]), i * 16));
const ibmAcc = doc.createAccessor().setType('MAT4').setArray(ibms).setBuffer(buffer);
const skin = doc.createSkin('SK_Als').setInverseBindMatrices(ibmAcc);
nodes.forEach((n) => skin.addJoint(n));
skin.setSkeleton(nodes[0]);
const meshNode = doc.createNode('SKM_Als').setMesh(mesh).setSkin(skin);
scene.addChild(meshNode);

// ---------- animations ----------
const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));
for (const clip of clips) {
  const anim = doc.createAnimation(clip.name);
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
console.log(`wrote ${outPath}: ${bones.length} joints, ${positions.length / 3} proxy verts, clips: ${clipDesc}`);
