// Stage 3: assert the produced GLB is actually usable web-side before it ships
// to public/assets. Checks structure (bones, skin, curated clips), animation
// bindings/root tracks, and physical sanity
// (character height ≈ 1.8 m, pelvis ≈ 0.9 m up at frame 0 — catches axis/unit
// conversion mistakes, which fail loudly here and silently on screen).
// Usage: node validate-glb.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';

const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
const joints = root.listSkins()[0]?.listJoints() ?? [];
const names = joints.map((j) => j.getName());
const anims = root.listAnimations();
const errs = [];
const meshNodes = root.listNodes().filter((node) => node.getMesh());
const meshPrimitives = meshNodes.flatMap((node) => node.getMesh().listPrimitives());
const expectedBones = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'index_01_l', 'index_02_l', 'index_03_l',
  'middle_01_l', 'middle_02_l', 'middle_03_l',
  'pinky_01_l', 'pinky_02_l', 'pinky_03_l',
  'ring_01_l', 'ring_02_l', 'ring_03_l',
  'thumb_01_l', 'thumb_02_l', 'thumb_03_l',
  'lowerarm_twist_01_l', 'upperarm_twist_01_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'index_01_r', 'index_02_r', 'index_03_r',
  'middle_01_r', 'middle_02_r', 'middle_03_r',
  'pinky_01_r', 'pinky_02_r', 'pinky_03_r',
  'ring_01_r', 'ring_02_r', 'ring_03_r',
  'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
  'lowerarm_twist_01_r', 'upperarm_twist_01_r',
  'neck_01', 'head',
  'thigh_l', 'calf_l', 'calf_twist_01_l', 'foot_l', 'ball_l', 'thigh_twist_01_l',
  'thigh_r', 'calf_r', 'calf_twist_01_r', 'foot_r', 'ball_r', 'thigh_twist_01_r',
  'ik_foot_root', 'ik_foot_l', 'ik_foot_r',
  'ik_hand_root', 'ik_hand_gun', 'ik_hand_l', 'ik_hand_r',
];
const expectedBoneSet = new Set(expectedBones);
const manifest = readFileSync(new URL('./clips.manifest', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('|', 1)[0]);
const manifestSet = new Set(manifest);
const animNames = anims.map((anim) => anim.getName());
const animNameSet = new Set(animNames);

// NOTE: SK_Als is UE4-mannequin-layout (spine_01–03, neck_01) even in ALS-Refactored
// 4.17/UE 5.7 — the plugin never adopted the UE5 Manny skeleton (spine_04/05, neck_02).
// UE5-native packs (e.g. TSO) therefore need a scripted retarget in M2.
for (const req of expectedBones)
  if (!names.includes(req)) errs.push(`missing bone: ${req}`);
for (const name of names)
  if (!expectedBoneSet.has(name)) errs.push(`unexpected bone: ${name}`);
if (new Set(names).size !== names.length) errs.push('duplicate bone names in skin');

if (meshNodes.length !== 1) errs.push(`expected one mesh node, found ${meshNodes.length}`);
if (!meshNodes[0]?.getSkin()) errs.push('mesh node is not skinned');
if (/proxy/i.test(meshNodes[0]?.getMesh()?.getName() ?? '')) errs.push('proxy mesh shipped instead of SKM_Als geometry');
let vertexCount = 0;
let triangleCount = 0;
let boundsMinY = Infinity;
let boundsMaxY = -Infinity;
for (const [index, primitive] of meshPrimitives.entries()) {
  const position = primitive.getAttribute('POSITION');
  const normal = primitive.getAttribute('NORMAL');
  const joints0 = primitive.getAttribute('JOINTS_0');
  const weights0 = primitive.getAttribute('WEIGHTS_0');
  const indices = primitive.getIndices();
  if (!position) errs.push(`mesh primitive ${index} has no POSITION`);
  if (!normal) errs.push(`mesh primitive ${index} has no NORMAL`);
  if (!joints0 || !weights0) errs.push(`mesh primitive ${index} is missing skin attributes`);
  if (!indices) errs.push(`mesh primitive ${index} is not indexed`);
  vertexCount += position?.getCount() ?? 0;
  triangleCount += (indices?.getCount() ?? 0) / 3;
  boundsMinY = Math.min(boundsMinY, position?.getMin([])[1] ?? Infinity);
  boundsMaxY = Math.max(boundsMaxY, position?.getMax([])[1] ?? -Infinity);
}
const meshHeight = boundsMaxY - boundsMinY;
if (vertexCount <= 5000) errs.push(`mesh has only ${vertexCount} vertices (proxy or incomplete geometry)`);
if (meshHeight < 1.6 || meshHeight > 2.1)
  errs.push(`mesh bounding-box height ${meshHeight.toFixed(3)}m out of range`);

if (anims.length < 1) errs.push('no animations');
if (manifestSet.size !== manifest.length) errs.push('duplicate clip names in clips.manifest');
for (const clip of manifest)
  if (!animNameSet.has(clip)) errs.push(`missing curated clip: ${clip}`);
for (const clip of animNames)
  if (!manifestSet.has(clip)) errs.push(`unexpected uncurated clip: ${clip}`);
if (animNameSet.size !== animNames.length) errs.push('duplicate animation names in GLB');

let channelCount = 0;
let rootTrackCount = 0;
for (const anim of anims) {
  const rootPaths = new Set();
  for (const channel of anim.listChannels()) {
    channelCount++;
    const targetName = channel.getTargetNode()?.getName() ?? '';
    if (!expectedBoneSet.has(targetName) || !names.includes(targetName))
      errs.push(`${anim.getName()} binds unexpected bone: ${targetName || '<none>'}`);
    if (targetName === 'root') rootPaths.add(channel.getTargetPath());
  }
  for (const path of ['translation', 'rotation'])
    if (!rootPaths.has(path)) errs.push(`${anim.getName()} missing root ${path} track`);
  if (rootPaths.has('translation') && rootPaths.has('rotation')) rootTrackCount++;
}

const idle = anims.find((a) => /idle/i.test(a.getName()));
if (!idle) errs.push('no /idle/i clip');
const dur = Math.max(...(idle?.listSamplers() ?? []).map((s) => s.getInput().getMax([0])[0] ?? 0), 0);
if (dur < 1) errs.push(`idle too short: ${dur}s`);

// world pelvis height at frame 0: chain root->pelvis using first rotation/translation keys
const pelvis = joints[names.indexOf('pelvis')];
const chan = idle?.listChannels().find((c) => c.getTargetNode() === pelvis && c.getTargetPath() === 'translation');
const t0 = chan?.getSampler().getOutput().getElement(0, []) ?? pelvis.getTranslation();
const pelvisHeight = t0[1]; // parent is root at origin, Y-up
if (pelvisHeight < 0.7 || pelvisHeight > 1.2) errs.push(`pelvis height ${pelvisHeight.toFixed(3)}m out of range (axis/unit conversion suspect)`);

console.log(`joints: ${joints.length}/${expectedBones.length} expected`);
console.log(
  `mesh: ${vertexCount} vertices, ${triangleCount} triangles, ${meshPrimitives.length} skinned sections, ` +
  `${meshHeight.toFixed(3)}m bounding-box height`);
console.log(`curated clips: ${anims.length}/${manifest.length} present`);
console.log(`bindings: ${channelCount} channels target only expected SK_Als bones`);
console.log(`root tracks: translation + rotation present in ${rootTrackCount}/${anims.length} clips`);
console.log(`idle duration: ${dur.toFixed(2)}s, pelvis@0: ${pelvisHeight?.toFixed(3)}m`);
if (errs.length) { console.error('FAIL:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('GLB validation passed');
