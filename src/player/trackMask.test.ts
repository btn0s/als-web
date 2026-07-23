import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { filterClipToBones, isUpperBodyBone, isArmBone, isFingerBone } from './trackMask';

/** Builds a minimal 2-keyframe quaternion track for `boneName`, matching how baked clips are shaped. */
function boneTrack(boneName: string) {
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
}

function makeClip(name: string, boneNames: string[], duration = 1) {
  return new THREE.AnimationClip(
    name,
    duration,
    boneNames.map(boneTrack),
    THREE.NormalAnimationBlendMode,
  );
}

describe('filterClipToBones', () => {
  it('keeps only tracks whose bone passes the predicate', () => {
    const clip = makeClip('Test_Clip', ['spine_01', 'hand_l', 'thigh_l', 'foot_r']);
    const filtered = filterClipToBones(clip, (bone) => bone === 'spine_01' || bone === 'hand_l');

    const keptBones = filtered.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName);
    expect(keptBones.sort()).toEqual(['hand_l', 'spine_01']);
  });

  it('drops tracks for bones that do not match the predicate', () => {
    const clip = makeClip('Test_Clip', ['spine_01', 'thigh_l', 'calf_l', 'foot_l']);
    const filtered = filterClipToBones(clip, (bone) => bone === 'spine_01');

    for (const track of filtered.tracks) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
      expect(['thigh_l', 'calf_l', 'foot_l']).not.toContain(nodeName);
    }
    expect(filtered.tracks).toHaveLength(1);
  });

  it('preserves clip.duration and blendMode, and names the result `${name}__mask`', () => {
    const clip = makeClip('Idle_FoldArms_Loop', ['spine_01', 'hand_l'], 2.5);
    const filtered = filterClipToBones(clip, () => true);

    expect(filtered.duration).toBe(2.5);
    expect(filtered.blendMode).toBe(clip.blendMode);
    expect(filtered.name).toBe('Idle_FoldArms_Loop__mask');
  });

  it('returns a clip with no tracks when the predicate matches nothing, but still preserves duration', () => {
    const clip = makeClip('Test_Clip', ['spine_01', 'hand_l', 'thigh_l'], 1.75);
    const filtered = filterClipToBones(clip, () => false);

    expect(filtered.tracks).toHaveLength(0);
    expect(filtered.duration).toBe(1.75);
  });

  it('does not mutate the source clip', () => {
    const clip = makeClip('Test_Clip', ['spine_01', 'thigh_l']);
    filterClipToBones(clip, (bone) => bone === 'spine_01');
    expect(clip.tracks).toHaveLength(2);
  });
});

describe('isUpperBodyBone', () => {
  it('keeps the spine chain, neck, head, clavicles, arms, hands, and fingers', () => {
    const upper = [
      'head',
      'neck_01',
      'spine_01',
      'spine_02',
      'spine_03',
      'clavicle_l',
      'clavicle_r',
      'upperarm_l',
      'upperarm_r',
      'lowerarm_l',
      'lowerarm_r',
      'hand_l',
      'hand_r',
      'index_01_l',
      'middle_04_leaf_r',
      'thumb_02_l',
      'pinky_03_r',
      'ring_01_l',
    ];
    for (const bone of upper) expect(isUpperBodyBone(bone)).toBe(true);
  });

  it('excludes root, pelvis, and the legs', () => {
    const lower = [
      'root',
      'pelvis',
      'thigh_l',
      'thigh_r',
      'calf_l',
      'calf_r',
      'foot_l',
      'foot_r',
      'ball_l',
      'ball_r',
      'ball_leaf_l',
      'ball_leaf_r',
    ];
    for (const bone of lower) expect(isUpperBodyBone(bone)).toBe(false);
  });
});

describe('isArmBone', () => {
  it('keeps the arm chain (clavicle -> upperarm -> lowerarm -> hand) and fingers, both sides', () => {
    const arms = [
      'clavicle_l',
      'clavicle_r',
      'upperarm_l',
      'upperarm_r',
      'lowerarm_l',
      'lowerarm_r',
      'hand_l',
      'hand_r',
      'index_01_l',
      'middle_04_leaf_r',
      'thumb_02_l',
      'pinky_03_r',
      'ring_01_l',
    ];
    for (const bone of arms) expect(isArmBone(bone)).toBe(true);
  });

  it('excludes the spine chain, neck, head — the non-arm upper body Jump_Loop keeps', () => {
    const nonArm = ['head', 'neck_01', 'spine_01', 'spine_02', 'spine_03', 'pelvis', 'root', 'thigh_l', 'foot_r'];
    for (const bone of nonArm) expect(isArmBone(bone)).toBe(false);
  });

  it('includes the finger chains (arm covers the whole chain down to the fingertips)', () => {
    for (const bone of ['index_01_l', 'middle_04_leaf_r', 'thumb_02_l', 'pinky_03_r', 'ring_01_l']) {
      expect(isArmBone(bone)).toBe(true);
    }
  });

  it('is a strict subset of isUpperBodyBone (every arm bone is upper-body, but not vice versa)', () => {
    for (const bone of ['clavicle_l', 'upperarm_r', 'hand_l', 'index_01_l']) {
      expect(isArmBone(bone)).toBe(true);
      expect(isUpperBodyBone(bone)).toBe(true);
    }
    // spine/neck/head are upper-body but NOT arm bones — this gap is exactly what the jump split
    // relies on so Jump_Loop keeps torso/head while shedding the arms.
    for (const bone of ['spine_02', 'neck_01', 'head']) {
      expect(isUpperBodyBone(bone)).toBe(true);
      expect(isArmBone(bone)).toBe(false);
    }
  });
});

describe('isFingerBone', () => {
  it('matches the five finger chains (and their leaf tips), both sides', () => {
    for (const bone of ['index_01_l', 'middle_02_r', 'pinky_03_l', 'ring_01_r', 'thumb_02_l', 'index_04_leaf_r']) {
      expect(isFingerBone(bone)).toBe(true);
    }
  });

  it('excludes the arm bones down to the wrist — so idle can drive the arm but not the fingers', () => {
    for (const bone of ['clavicle_l', 'upperarm_r', 'lowerarm_l', 'hand_l', 'hand_r', 'spine_01']) {
      expect(isFingerBone(bone)).toBe(false);
      // ...while those same wrist-and-up bones are still arm bones:
      if (bone !== 'spine_01') expect(isArmBone(bone)).toBe(true);
    }
  });
});
