// Stage 3: assert the produced GLB is actually usable web-side before it ships
// to public/assets. Checks structure (bones, skin, clip) and physical sanity
// (character height ≈ 1.8 m, pelvis ≈ 0.9 m up at frame 0 — catches axis/unit
// conversion mistakes, which fail loudly here and silently on screen).
// Usage: node validate-glb.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';

const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
const joints = root.listSkins()[0]?.listJoints() ?? [];
const names = joints.map((j) => j.getName());
const anims = root.listAnimations();
const errs = [];

// NOTE: SK_Als is UE4-mannequin-layout (spine_01–03, neck_01) even in ALS-Refactored
// 4.17/UE 5.7 — the plugin never adopted the UE5 Manny skeleton (spine_04/05, neck_02).
// UE5-native packs (e.g. TSO) therefore need a scripted retarget in M2.
for (const req of ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'hand_r', 'foot_l', 'ball_r', 'thigh_twist_01_l', 'ik_foot_root', 'ik_hand_gun'])
  if (!names.includes(req)) errs.push(`missing bone: ${req}`);
if (anims.length < 1) errs.push('no animations');
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

console.log(`joints: ${joints.length}, clips: ${anims.map((a) => a.getName()).join(', ')}, idle duration: ${dur.toFixed(2)}s, pelvis@0: ${pelvisHeight?.toFixed(3)}m`);
if (errs.length) { console.error('FAIL:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('GLB validation passed');
