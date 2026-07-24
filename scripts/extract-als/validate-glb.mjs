// Stage 3: assert the produced GLB is actually usable web-side before it ships
// to public/assets. Checks structure (bones, skin, curated clips), animation
// bindings/root tracks, and physical sanity
// (character height ≈ 1.8 m, pelvis ≈ 0.9 m up at frame 0 — catches axis/unit
// conversion mistakes, which fail loudly here and silently on screen).
// Usage:
//   node validate-glb.mjs <file.glb> [abp-graph.json] [blend-spaces.json]
import { NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';

const doc = await new NodeIO().read(process.argv[2]);
const abpGraph = JSON.parse(readFileSync(
  process.argv[3] ?? new URL('./abp-graph.json', import.meta.url),
  'utf8'));
const blendSpaceDump = JSON.parse(readFileSync(
  process.argv[4] ?? new URL('./blend-spaces.json', import.meta.url),
  'utf8'));
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
const expectedBakedRootLockedClips = new Set([
  'A_Als_Turn_90_Left',
  'A_Als_Turn_90_Right',
  'A_Als_Turn_180_Left',
  'A_Als_Turn_180_Right',
  'A_Als_Rotate_90_Left',
  'A_Als_Rotate_90_Right',
  'A_Als_Crouch_Turn_90_Left',
  'A_Als_Crouch_Turn_90_Right',
  'A_Als_Crouch_Turn_180_Left',
  'A_Als_Crouch_Turn_180_Right',
  'A_Als_Crouch_Rotate_90_Left',
  'A_Als_Crouch_Rotate_90_Right',
]);
const expectedDeferredActionRootLocks = new Set([
  'A_Als_Roll',
  'A_Als_Mantle_High',
  'A_Als_Mantle_Low_Left',
  'A_Als_Mantle_Low_Right',
]);
const expectedForceRootLockedClips = new Set([
  ...expectedBakedRootLockedClips,
  ...expectedDeferredActionRootLocks,
]);
const expectedRootMotionEnabledClips = new Set(['A_Als_Roll']);
const expectedQuickStopTransitionClips = new Map([
  ['A_Als_Stand_Transition_Left', 'Left'],
  ['A_Als_Stand_Transition_Right', 'Right'],
  ['A_Als_Crouch_Transition_Left', 'Left'],
  ['A_Als_Crouch_Transition_Right', 'Right'],
]);
const expectedDynamicTransitionClips = new Map([
  ['A_Als_Stand_DynamicTransition_Left', 'Left'],
  ['A_Als_Stand_DynamicTransition_Right', 'Right'],
  ['A_Als_Crouch_DynamicTransition_Left', 'Left'],
  ['A_Als_Crouch_DynamicTransition_Right', 'Right'],
]);
const expectedActionRootTranslationEnds = new Map([
  ['A_Als_Roll', [0, 0, 2.75]],
  ['A_Als_Mantle_High', [0, 2, 0.65]],
  ['A_Als_Mantle_Low_Left', [0, 1, 0.65]],
  ['A_Als_Mantle_Low_Right', [0, 1, 0.65]],
]);
const abpAnimationReferences = [
  ...new Map(
    Object.values(abpGraph.assets ?? {})
      .flatMap((asset) => asset.referencedAnimationAssets ?? [])
      .filter(({ className }) =>
        ['AnimSequence', 'BlendSpace', 'BlendSpace1D'].includes(className))
      .map((reference) => [`${reference.className}:${reference.objectName}`, reference]),
  ).values(),
];
const abpSequenceNames = new Set(
  abpAnimationReferences
    .filter(({ className }) => className === 'AnimSequence')
    .map(({ objectName }) => objectName));
const abpBlendSpaceNames = new Set(
  abpAnimationReferences
    .filter(({ className }) => className === 'BlendSpace' || className === 'BlendSpace1D')
    .map(({ objectName }) => objectName));
const dumpedBlendSpaces = blendSpaceDump.blendSpaces ?? {};
const blendSpaceNames = new Set(Object.keys(dumpedBlendSpaces));
const blendSpaceSequenceNames = new Set(
  Object.values(dumpedBlendSpaces).flatMap((blendSpace) => [
    ...(blendSpace.samples ?? []).map((sample) => sample.animation?.name),
    blendSpace.previewBasePose?.name,
  ].filter(Boolean)));

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
if (manifest.length !== 117)
  errs.push(`ALS 4.15 content manifest has ${manifest.length} clips, expected 117`);
if (manifestSet.size !== manifest.length) errs.push('duplicate clip names in clips.manifest');
for (const clip of manifest)
  if (!animNameSet.has(clip)) errs.push(`missing curated clip: ${clip}`);
for (const clip of animNames)
  if (!manifestSet.has(clip)) errs.push(`unexpected uncurated clip: ${clip}`);
if (animNameSet.size !== animNames.length) errs.push('duplicate animation names in GLB');
for (const clip of abpSequenceNames) {
  if (!manifestSet.has(clip))
    errs.push(`ABP-referenced AnimSequence omitted from clips.manifest: ${clip}`);
  if (!animNameSet.has(clip))
    errs.push(`ABP-referenced AnimSequence omitted from GLB: ${clip}`);
}
for (const clip of blendSpaceSequenceNames) {
  if (!manifestSet.has(clip))
    errs.push(`BlendSpace sample/base omitted from clips.manifest: ${clip}`);
  if (!animNameSet.has(clip))
    errs.push(`BlendSpace sample/base omitted from GLB: ${clip}`);
}
for (const name of abpBlendSpaceNames)
  if (!blendSpaceNames.has(name))
    errs.push(`ABP-referenced BlendSpace omitted from blend-spaces.json: ${name}`);
for (const name of blendSpaceNames)
  if (!abpBlendSpaceNames.has(name))
    errs.push(`unexpected non-ABP BlendSpace in blend-spaces.json: ${name}`);

let channelCount = 0;
let rootTrackCount = 0;
let curveCount = 0;
let syncMarkerCount = 0;
let notifyCount = 0;
let rootLockedClipCount = 0;
let bakedRootLockedClipCount = 0;
let deferredActionRootLockCount = 0;
const curveNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
const curvesByClip = new Map();
const syncMarkersByClip = new Map();
const notifiesByClip = new Map();
const rootJoint = joints[names.indexOf('root')];
const rootLockModes = new Set(['RefPose', 'AnimFirstFrame', 'Zero']);
const additiveTypes = new Set([
  'AAT_None',
  'AAT_LocalSpaceBase',
  'AAT_RotationOffsetMeshSpace',
]);
const maxComponentDelta = (a, b) =>
  Math.max(...a.map((value, index) => Math.abs(value - b[index])));
const quaternionError = (a, b) => {
  const aLength = Math.hypot(...a);
  const bLength = Math.hypot(...b);
  if (aLength === 0 || bLength === 0) return Infinity;
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  return 1 - Math.abs(dot / (aLength * bLength));
};
const rootValuesMatch = (path, a, b) =>
  path === 'rotation'
    ? quaternionError(a, b) <= 1e-6
    : maxComponentDelta(a, b) <= 1e-6;
const validateLockedRootTrack = (animName, path, channel, expectedValue) => {
  const output = channel?.getSampler()?.getOutput();
  if (!output || output.getCount() === 0) {
    errs.push(`${animName} locked root ${path} track has no output keys`);
    return;
  }

  const first = output.getElement(0, []);
  for (let keyIndex = 1; keyIndex < output.getCount(); keyIndex++) {
    const value = output.getElement(keyIndex, []);
    if (!rootValuesMatch(path, value, first)) {
      errs.push(`${animName} locked root ${path} changes at key ${keyIndex}`);
      break;
    }
  }
  if (expectedValue && !rootValuesMatch(path, first, expectedValue)) {
    errs.push(
      `${animName} locked root ${path} ${JSON.stringify(first)} does not match ` +
      `${JSON.stringify(expectedValue)}`);
  }
};
const validateRawRootTrack = (animName, rawRootTrack, rootChannels) => {
  if (!rawRootTrack || typeof rawRootTrack !== 'object' || Array.isArray(rawRootTrack)) {
    errs.push(`${animName} has no animation.extras.rawRootTrack object`);
    return null;
  }

  const times = rawRootTrack.times;
  const translations = rawRootTrack.translations;
  const rotations = rawRootTrack.rotations;
  if (!Array.isArray(times) ||
      !Array.isArray(translations) ||
      !Array.isArray(rotations))
  {
    errs.push(`${animName} rawRootTrack arrays are malformed`);
    return null;
  }

  const translationChannel = rootChannels.get('translation');
  const rotationChannel = rootChannels.get('rotation');
  const input = translationChannel?.getSampler()?.getInput();
  const translationOutput = translationChannel?.getSampler()?.getOutput();
  const rotationOutput = rotationChannel?.getSampler()?.getOutput();
  const expectedCount = translationOutput?.getCount() ?? 0;
  if (times.length !== expectedCount ||
      translations.length !== expectedCount ||
      rotations.length !== expectedCount ||
      rotationOutput?.getCount() !== expectedCount)
  {
    errs.push(
      `${animName} rawRootTrack key counts ` +
      `${times.length}/${translations.length}/${rotations.length} do not match ` +
      `root channels ${expectedCount}/${rotationOutput?.getCount() ?? 0}`);
  }

  for (let keyIndex = 0; keyIndex < times.length; keyIndex++) {
    if (!Number.isFinite(times[keyIndex]))
      errs.push(`${animName} rawRootTrack time ${keyIndex} is not finite`);
    if (keyIndex > 0 && times[keyIndex] < times[keyIndex - 1])
      errs.push(`${animName} rawRootTrack times decrease at key ${keyIndex}`);
    const sampledTime = input?.getElement(keyIndex, [])?.[0];
    if (Number.isFinite(sampledTime) &&
        Math.abs(times[keyIndex] - sampledTime) > 1e-6)
    {
      errs.push(`${animName} rawRootTrack time differs from root sampler at key ${keyIndex}`);
      break;
    }
    if (!Array.isArray(translations[keyIndex]) ||
        translations[keyIndex].length !== 3 ||
        translations[keyIndex].some((value) => !Number.isFinite(value)))
    {
      errs.push(`${animName} rawRootTrack translation ${keyIndex} is malformed`);
      break;
    }
    if (!Array.isArray(rotations[keyIndex]) ||
        rotations[keyIndex].length !== 4 ||
        rotations[keyIndex].some((value) => !Number.isFinite(value)))
    {
      errs.push(`${animName} rawRootTrack rotation ${keyIndex} is malformed`);
      break;
    }
  }

  return { times, translations, rotations, translationOutput, rotationOutput };
};
const validateRootChannelsMatchRaw = (animName, rawRootTrack) => {
  for (const [path, values, output] of [
    ['translation', rawRootTrack.translations, rawRootTrack.translationOutput],
    ['rotation', rawRootTrack.rotations, rawRootTrack.rotationOutput],
  ]) {
    if (!output) continue;
    for (let keyIndex = 0;
      keyIndex < Math.min(values.length, output.getCount());
      keyIndex++)
    {
      if (!rootValuesMatch(path, output.getElement(keyIndex, []), values[keyIndex])) {
        errs.push(`${animName} deferred root ${path} differs from raw key ${keyIndex}`);
        break;
      }
    }
  }
};
for (const anim of anims) {
  const rootPaths = new Set();
  const rootChannels = new Map();
  for (const channel of anim.listChannels()) {
    channelCount++;
    const targetName = channel.getTargetNode()?.getName() ?? '';
    if (!expectedBoneSet.has(targetName) || !names.includes(targetName))
      errs.push(`${anim.getName()} binds unexpected bone: ${targetName || '<none>'}`);
    if (targetName === 'root') {
      const path = channel.getTargetPath();
      if (rootChannels.has(path))
        errs.push(`${anim.getName()} has duplicate root ${path} tracks`);
      rootPaths.add(path);
      rootChannels.set(path, channel);
    }
  }
  for (const path of ['translation', 'rotation'])
    if (!rootPaths.has(path)) errs.push(`${anim.getName()} missing root ${path} track`);
  if (rootPaths.has('translation') && rootPaths.has('rotation')) rootTrackCount++;

  const extras = anim.getExtras() ?? {};
  const shouldForceRootLock = expectedForceRootLockedClips.has(anim.getName());
  const shouldEnableRootMotion = expectedRootMotionEnabledClips.has(anim.getName());
  if (typeof extras.bEnableRootMotion !== 'boolean')
    errs.push(`${anim.getName()} animation.extras.bEnableRootMotion is not a boolean`);
  else if (extras.bEnableRootMotion !== shouldEnableRootMotion)
    errs.push(
      `${anim.getName()} bEnableRootMotion=${extras.bEnableRootMotion}, ` +
      `expected ${shouldEnableRootMotion}`);
  if (typeof extras.bForceRootLock !== 'boolean')
    errs.push(`${anim.getName()} animation.extras.bForceRootLock is not a boolean`);
  else if (extras.bForceRootLock !== shouldForceRootLock)
    errs.push(
      `${anim.getName()} bForceRootLock=${extras.bForceRootLock}, ` +
      `expected ${shouldForceRootLock}`);
  if (!rootLockModes.has(extras.RootMotionRootLock))
    errs.push(
      `${anim.getName()} has invalid RootMotionRootLock: ` +
      `${JSON.stringify(extras.RootMotionRootLock)}`);
  else if (extras.RootMotionRootLock !== 'RefPose')
    errs.push(
      `${anim.getName()} RootMotionRootLock=${extras.RootMotionRootLock}, expected RefPose`);

  if (extras.bForceRootLock === true) {
    rootLockedClipCount++;
    const rawRootTrack = validateRawRootTrack(
      anim.getName(),
      extras.rawRootTrack,
      rootChannels);
    if (expectedBakedRootLockedClips.has(anim.getName())) {
      bakedRootLockedClipCount++;
      const expectedTranslation =
        extras.RootMotionRootLock === 'Zero' ? [0, 0, 0] :
          extras.RootMotionRootLock === 'AnimFirstFrame'
            ? rawRootTrack?.translations[0]
            : rootJoint?.getTranslation();
      const expectedRotation =
        extras.RootMotionRootLock === 'Zero' ? [0, 0, 0, 1] :
          extras.RootMotionRootLock === 'AnimFirstFrame'
            ? rawRootTrack?.rotations[0]
            : rootJoint?.getRotation();
      validateLockedRootTrack(
        anim.getName(),
        'translation',
        rootChannels.get('translation'),
        expectedTranslation);
      validateLockedRootTrack(
        anim.getName(),
        'rotation',
        rootChannels.get('rotation'),
        expectedRotation);
      if (rawRootTrack &&
          !rawRootTrack.rotations.some((rotation) =>
            !rootValuesMatch('rotation', rotation, rawRootTrack.rotations[0])))
      {
        errs.push(`${anim.getName()} raw root rotation has no authored turn to preserve`);
      }
    } else if (expectedDeferredActionRootLocks.has(anim.getName())) {
      deferredActionRootLockCount++;
      if (rawRootTrack) {
        validateRootChannelsMatchRaw(anim.getName(), rawRootTrack);
        const expectedEnd = expectedActionRootTranslationEnds.get(anim.getName());
        const actualEnd = rawRootTrack.translations.at(-1);
        if (!actualEnd || !rootValuesMatch('translation', actualEnd, expectedEnd))
          errs.push(
            `${anim.getName()} raw root translation end ${JSON.stringify(actualEnd)} ` +
            `does not match ${JSON.stringify(expectedEnd)}`);
      }
    }
  } else if (extras.rawRootTrack !== undefined) {
    errs.push(`${anim.getName()} has rawRootTrack without bForceRootLock`);
  }

  if (!additiveTypes.has(extras.additiveType))
    errs.push(
      `${anim.getName()} has invalid additiveType: ` +
      `${JSON.stringify(extras.additiveType)}`);
  if (typeof extras.refPoseSeq !== 'string')
    errs.push(
      `${anim.getName()} animation.extras.refPoseSeq is not a string: ` +
      `${JSON.stringify(extras.refPoseSeq)}`);
  else if (extras.additiveType !== 'AAT_None' && extras.refPoseSeq.length === 0)
    errs.push(`${anim.getName()} is additive but has no refPoseSeq`);
  if (!Number.isInteger(extras.refFrameIndex) || extras.refFrameIndex < 0)
    errs.push(
      `${anim.getName()} has invalid refFrameIndex: ` +
      `${JSON.stringify(extras.refFrameIndex)}`);

  const curves = extras.alsCurves ?? [];
  curvesByClip.set(anim.getName(), curves);
  if (!Array.isArray(curves)) {
    errs.push(`${anim.getName()} animation.extras.alsCurves is not an array`);
  } else {
    curveCount += curves.length;
    for (const curve of curves) {
      if (!curveNamePattern.test(curve?.name ?? ''))
        errs.push(`${anim.getName()} has invalid curve name: ${JSON.stringify(curve?.name)}`);
      if (!Array.isArray(curve?.keys)) {
        errs.push(`${anim.getName()}/${curve?.name ?? '<unnamed>'} keys is not an array`);
        continue;
      }
      for (let i = 0; i < curve.keys.length; i++) {
        const time = curve.keys[i]?.[0];
        if (!Number.isFinite(time))
          errs.push(`${anim.getName()}/${curve.name} key ${i} has invalid time: ${time}`);
        if (i > 0 && time < curve.keys[i - 1]?.[0])
          errs.push(`${anim.getName()}/${curve.name} key times decrease at key ${i}`);
      }
    }
  }

  for (const [field, table, count] of [
    ['syncMarkers', syncMarkersByClip, (value) => { syncMarkerCount += value; }],
    ['notifies', notifiesByClip, (value) => { notifyCount += value; }],
  ]) {
    const events = anim.getExtras()?.[field] ?? [];
    if (!Array.isArray(events)) {
      errs.push(`${anim.getName()} animation.extras.${field} is not an array`);
      table.set(anim.getName(), []);
      continue;
    }
    table.set(anim.getName(), events);
    count(events.length);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (typeof event?.name !== 'string' || event.name.length === 0)
        errs.push(`${anim.getName()} ${field}[${i}] has invalid name: ${JSON.stringify(event?.name)}`);
      if (!Number.isFinite(event?.time))
        errs.push(`${anim.getName()} ${field}[${i}] has invalid time: ${event?.time}`);
      if (field === 'syncMarkers' && i > 0 && event.time < events[i - 1]?.time)
        errs.push(`${anim.getName()} ${field} times decrease at entry ${i}`);
    }
  }
}
if (rootLockedClipCount !== expectedForceRootLockedClips.size)
  errs.push(
    `force-root-locked clip count ${rootLockedClipCount}, ` +
    `expected ${expectedForceRootLockedClips.size}`);
if (bakedRootLockedClipCount !== expectedBakedRootLockedClips.size)
  errs.push(
    `baked turn/rotate root-lock count ${bakedRootLockedClipCount}, ` +
    `expected ${expectedBakedRootLockedClips.size}`);
if (deferredActionRootLockCount !== expectedDeferredActionRootLocks.size)
  errs.push(
    `deferred action root-lock count ${deferredActionRootLockCount}, ` +
    `expected ${expectedDeferredActionRootLocks.size}`);

const requireCurves = (clipName, requiredNames, minimumCount = requiredNames.length) => {
  const curves = curvesByClip.get(clipName);
  if (!curves) {
    errs.push(`curve sentinel clip missing: ${clipName}`);
    return;
  }
  if (curves.length < minimumCount)
    errs.push(`${clipName} has ${curves.length} curves, expected at least ${minimumCount}`);
  const names = new Set(curves.map((curve) => curve.name));
  for (const name of requiredNames)
    if (!names.has(name)) errs.push(`${clipName} missing curve: ${name}`);
};
requireCurves('A_Als_Walk_Forward', ['FootPlanted', 'PoseGait']);
requireCurves('A_Als_Crouch_Walk_Pose', ['PoseGait']);
requireCurves(
  'A_Als_Turn_90_Left',
  ['FootLeftLock', 'FootRightLock', 'RotationYawSpeed']);
requireCurves('A_Als_Rifle_Poses', ['LayerArmLeftAdditive'], 11);
requireCurves(
  'A_Als_Rifle_Sprint_Impulse_Arms',
  [
    'HandLeftIk',
    'LayerArmLeft',
    'LayerArmLeftLocalSpace',
    'LayerArmRight',
    'LayerArmRightLocalSpace',
    'LayerHandRight',
  ],
  6);
requireCurves(
  'A_Als_Land_Light_Additive',
  ['FootstepSoundBlock', 'SprintBlock'],
  2);
requireCurves(
  'A_Als_Land_Heavy_Additive',
  ['FootstepSoundBlock', 'SprintBlock'],
  2);
const idleCurves = curvesByClip.get('A_Als_Idle');
if (!idleCurves) errs.push('curve-free sentinel clip missing: A_Als_Idle');
else if (idleCurves.length !== 0)
  errs.push(`A_Als_Idle should have no curves, found ${idleCurves.length}`);

const forwardLocomotionCycles = [
  'A_Als_Walk_Forward',
  'A_Als_Walk_Left_Forward',
  'A_Als_Walk_Right_Forward',
  'A_Als_Run_Forward',
  'A_Als_Run_Left_Forward',
  'A_Als_Run_Right_Forward',
];
let gaitMarkerNames = null;
for (const clipName of forwardLocomotionCycles) {
  const markers = syncMarkersByClip.get(clipName);
  if (!markers) {
    errs.push(`sync-marker sentinel clip missing: ${clipName}`);
    continue;
  }
  if (markers.length < 2)
    errs.push(`${clipName} has ${markers.length} sync markers, expected at least 2`);
  const markerNames = [...new Set(markers.map((marker) => marker.name))].sort();
  if (gaitMarkerNames === null) {
    gaitMarkerNames = markerNames;
  } else if (
    markerNames.length !== gaitMarkerNames.length ||
    markerNames.some((name, index) => name !== gaitMarkerNames[index])
  ) {
    errs.push(
      `${clipName} sync marker names [${markerNames.join(', ')}] differ from gait family ` +
      `[${gaitMarkerNames.join(', ')}]`);
  }
}

const requireEvents = (table, clipName, requiredNames, label) => {
  const events = table.get(clipName);
  if (!events) {
    errs.push(`${label} sentinel clip missing: ${clipName}`);
    return;
  }
  const names = events.map(({ name }) => name);
  for (const requiredName of requiredNames)
    if (!names.includes(requiredName))
      errs.push(`${clipName} missing ${label}: ${requiredName}`);
};
requireEvents(
  syncMarkersByClip,
  'A_Als_Crouch_Walk_Pose',
  ['Left', 'Right'],
  'sync marker');
requireEvents(
  syncMarkersByClip,
  'A_Als_Rifle_Sprint_Impulse_Arms',
  ['Left', 'Right'],
  'sync marker');
requireEvents(
  notifiesByClip,
  'A_Als_Land_Light_Additive',
  ['BMAnimNotifyFootstep'],
  'notify');
requireEvents(
  notifiesByClip,
  'A_Als_Land_Heavy_Additive',
  ['BMAnimNotifyFootstep'],
  'notify');

const QUICK_STOP_NEAR_ZERO = -9.53674e-8;
const QUICK_STOP_SHARED_CURVES = {
  AllowTransitions: {
    flags: 4,
    keys: [[0, -1, 1], [1.33333, QUICK_STOP_NEAR_ZERO, 0]],
  },
  FootstepSoundBlock: {
    flags: 20,
    keys: [[0, 1, 0]],
  },
};
const QUICK_STOP_EARLY_LOCK_KEYS = [
  [0.333333, QUICK_STOP_NEAR_ZERO, 2],
  [0.733333, -1, 1],
  [0.8, QUICK_STOP_NEAR_ZERO, 0],
];
const QUICK_STOP_LATE_LOCK_KEYS = [
  [0.833333, QUICK_STOP_NEAR_ZERO, 2],
  [1.26667, -1, 1],
  [1.33333, QUICK_STOP_NEAR_ZERO, 0],
];
const extrasByClip = new Map(
  anims.map((animation) => [animation.getName(), animation.getExtras() ?? {}]));
for (const [clipName, direction] of expectedQuickStopTransitionClips) {
  const extras = extrasByClip.get(clipName);
  if (!extras) {
    errs.push(`quick-stop transition clip missing: ${clipName}`);
    continue;
  }

  const expectedCurves = [
    { name: 'AllowTransitions', ...QUICK_STOP_SHARED_CURVES.AllowTransitions },
    {
      name: 'FootLeftLock',
      flags: 4,
      keys: direction === 'Left'
        ? QUICK_STOP_EARLY_LOCK_KEYS
        : QUICK_STOP_LATE_LOCK_KEYS,
    },
    {
      name: 'FootRightLock',
      flags: 4,
      keys: direction === 'Left'
        ? QUICK_STOP_LATE_LOCK_KEYS
        : QUICK_STOP_EARLY_LOCK_KEYS,
    },
    {
      name: 'FootstepSoundBlock',
      ...QUICK_STOP_SHARED_CURVES.FootstepSoundBlock,
    },
  ];
  if (JSON.stringify(extras.alsCurves) !== JSON.stringify(expectedCurves))
    errs.push(`${clipName} quick-stop curve inventory differs from ALS 4.15`);
  if (JSON.stringify(extras.syncMarkers) !== '[]')
    errs.push(`${clipName} should have no authored sync markers`);
  if (JSON.stringify(extras.notifies) !== JSON.stringify([
    { name: 'BMAnimNotifyFootstep', time: 0.833333 },
    { name: 'BMAnimNotifyFootstep', time: 1.36667 },
  ]))
    errs.push(`${clipName} quick-stop notify inventory differs from ALS 4.15`);
  if (
    extras.bEnableRootMotion !== false
    || extras.bForceRootLock !== false
    || extras.RootMotionRootLock !== 'RefPose'
  ) {
    errs.push(`${clipName} quick-stop root-motion settings differ from ALS 4.15`);
  }
  if (
    extras.additiveType !== 'AAT_RotationOffsetMeshSpace'
    || extras.refPoseSeq !== 'A_Als_Stand_Pose'
    || extras.refFrameIndex !== 0
  ) {
    errs.push(`${clipName} quick-stop additive settings differ from ALS 4.15`);
  }
}

const DYNAMIC_TRANSITION_SHARED_CURVES = {
  AllowTransitions: {
    flags: 4,
    keys: [[0, -1, 1], [0.533333, 0, 0]],
  },
  FootstepSoundBlock: {
    flags: 20,
    keys: [[0, 1, 0]],
  },
};
const DYNAMIC_TRANSITION_FOOT_LOCK_KEYS = [
  [0.0333333, 0, 2],
  [0.466667, -1, 1],
  [0.533333, 0, 0],
];
for (const [clipName, direction] of expectedDynamicTransitionClips) {
  const extras = extrasByClip.get(clipName);
  if (!extras) {
    errs.push(`dynamic transition clip missing: ${clipName}`);
    continue;
  }

  const expectedCurves = [
    {
      name: 'AllowTransitions',
      ...DYNAMIC_TRANSITION_SHARED_CURVES.AllowTransitions,
    },
    {
      name: direction === 'Left' ? 'FootLeftLock' : 'FootRightLock',
      flags: 4,
      keys: DYNAMIC_TRANSITION_FOOT_LOCK_KEYS,
    },
    {
      name: 'FootstepSoundBlock',
      ...DYNAMIC_TRANSITION_SHARED_CURVES.FootstepSoundBlock,
    },
  ];
  if (JSON.stringify(extras.alsCurves) !== JSON.stringify(expectedCurves))
    errs.push(`${clipName} dynamic-transition curve inventory differs from ALS 4.15`);
  if (JSON.stringify(extras.syncMarkers) !== '[]')
    errs.push(`${clipName} should have no authored sync markers`);
  if (JSON.stringify(extras.notifies) !== JSON.stringify([
    { name: 'BMAnimNotifyFootstep', time: 0.566667 },
  ]))
    errs.push(`${clipName} dynamic-transition notify inventory differs from ALS 4.15`);
  if (
    extras.bEnableRootMotion !== false
    || extras.bForceRootLock !== false
    || extras.RootMotionRootLock !== 'RefPose'
  ) {
    errs.push(`${clipName} dynamic-transition root-motion settings differ from ALS 4.15`);
  }
  if (
    extras.additiveType !== 'AAT_RotationOffsetMeshSpace'
    || extras.refPoseSeq !== 'A_Als_Stand_Pose'
    || extras.refFrameIndex !== 0
  ) {
    errs.push(`${clipName} dynamic-transition additive settings differ from ALS 4.15`);
  }
}

const clipsWithCurves = [...curvesByClip.values()].filter((curves) => curves.length > 0).length;
const clipsWithSyncMarkers =
  [...syncMarkersByClip.values()].filter((markers) => markers.length > 0).length;
const clipsWithNotifies =
  [...notifiesByClip.values()].filter((notifies) => notifies.length > 0).length;
if (curveCount !== 361 || clipsWithCurves !== 82)
  errs.push(
    `ALS 4.15 curve inventory ${curveCount} across ${clipsWithCurves} clips, ` +
    'expected 361 across 82');
if (syncMarkerCount !== 60 || clipsWithSyncMarkers !== 30)
  errs.push(
    `ALS 4.15 sync-marker inventory ${syncMarkerCount} across ${clipsWithSyncMarkers} clips, ` +
    'expected 60 across 30');
if (notifyCount !== 162 || clipsWithNotifies !== 65)
  errs.push(
    `ALS 4.15 notify inventory ${notifyCount} across ${clipsWithNotifies} clips, ` +
    'expected 162 across 65');

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
console.log(
  `ABP content coverage: ${abpSequenceNames.size} direct sequences + ` +
  `${blendSpaceNames.size} BlendSpaces / ${blendSpaceSequenceNames.size} sample/base sequences`);
console.log(`bindings: ${channelCount} channels target only expected SK_Als bones`);
console.log(`root tracks: translation + rotation present in ${rootTrackCount}/${anims.length} clips`);
console.log(
  `root locks: exact ${rootLockedClipCount}/${expectedForceRootLockedClips.size} authored; ` +
  `${bakedRootLockedClipCount} turn/rotate poses baked to RefPose; ` +
  `${deferredActionRootLockCount} action channels retain raw motion`);
console.log(`curves: ${curveCount} across ${clipsWithCurves}/${anims.length} clips; sentinel clips passed`);
console.log(
  `sync markers: ${syncMarkerCount} across ` +
  `${clipsWithSyncMarkers}/${anims.length} clips; ` +
  `${forwardLocomotionCycles.length} forward walk/run cycles have >=2 non-decreasing markers ` +
  `with consistent names [${gaitMarkerNames?.join(', ') ?? ''}]`);
console.log(
  `notifies: ${notifyCount} across ` +
  `${clipsWithNotifies}/${anims.length} clips`);
console.log(`idle duration: ${dur.toFixed(2)}s, pelvis@0: ${pelvisHeight?.toFixed(3)}m`);
if (errs.length) { console.error('FAIL:\n  ' + errs.join('\n  ')); process.exit(1); }
console.log('GLB validation passed');
