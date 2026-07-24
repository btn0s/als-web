import * as THREE from 'three';

/** Framework-free bone predicates shared by extraction utilities and the owned pose evaluator. */

export const POSE_GAIT_CURVE_NAME = 'PoseGait'
export const POSE_GROUNDED_CURVE_NAME = 'PoseGrounded'
export const POSE_IN_AIR_CURVE_NAME = 'PoseInAir'
export const POSE_STANDING_CURVE_NAME = 'PoseStanding'
export const POSE_CROUCHING_CURVE_NAME = 'PoseCrouching'
export const POSE_MOVING_CURVE_NAME = 'PoseMoving'
export const FOOT_LEFT_LOCK_CURVE_NAME = 'FootLeftLock'
export const FOOT_RIGHT_LOCK_CURVE_NAME = 'FootRightLock'
export const HIPS_DIRECTION_LOCK_CURVE_NAME = 'HipsDirectionLock'
export const FEET_CROSSING_CURVE_NAME = 'FeetCrossing'
export const ROTATION_YAW_SPEED_CURVE_NAME = 'RotationYawSpeed'
export const SPRINT_BLOCK_CURVE_NAME = 'SprintBlock'
export const ALLOW_TRANSITIONS_CURVE_NAME = 'AllowTransitions'

// UAlsConstants slot names plus SK_Als's authored AnimSlotGroup.
export const TRANSITION_SLOT_NAME = 'Transition'
export const TURN_IN_PLACE_STANDING_SLOT_NAME = 'TurnInPlaceStanding'
export const TURN_IN_PLACE_CROUCHING_SLOT_NAME = 'TurnInPlaceCrouching'
export const GROUNDED_SLOT_GROUP_NAME = 'Grounded'

/**
 * Returns a NEW `THREE.AnimationClip` containing only the tracks of `clip` whose target bone
 * passes `keep`. Uses `THREE.PropertyBinding.parseTrackName` to pull the bone name off each
 * track — NOT a naive `track.name.split('.')`, since bone names can themselves contain dots (the
 * parser handles that via its object-name allowlist; see PropertyBinding.js).
 *
 * Preserves `clip.duration` (passed explicitly, so `AnimationClip` doesn't recompute it from the
 * — possibly now-empty — filtered track list) and `clip.blendMode`. The new clip is named
 * `${clip.name}__mask` so it's distinguishable from the source clip in the mixer / devtools.
 */
export function filterClipToBones(
  clip: THREE.AnimationClip,
  keep: (boneName: string) => boolean,
): THREE.AnimationClip {
  const tracks = clip.tracks.filter((track) => {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name);
    return nodeName !== undefined && keep(nodeName);
  });
  return new THREE.AnimationClip(`${clip.name}__mask`, clip.duration, tracks, clip.blendMode);
}

/**
 * Upper-body allowlist retained for generic whole-upper-body masks. ALS OverlayMode uses the
 * finer exact regions below so each Layer* curve owns a non-overlapping branch.
 *
 * Actual bone names, read directly off `public/assets/skm-als.glb`'s skeleton (68 bones total,
 * ALS Refactored's SK_Als — UE4-mannequin layout, all-lowercase):
 *   head, neck_01, spine_01..03, clavicle_l/r, upperarm_l/r (+ _twist_01), lowerarm_l/r
 *   (+ _twist_01), hand_l/r, finger chains index/middle/pinky/ring/thumb `..._01`..`..._03`  => KEEP
 *   pelvis, root, ik_* (ik_foot_root/l/r, ik_hand_root/gun/l/r)                            => EXCLUDE
 *   thigh_l/r (+ _twist_01), calf_l/r (+ _twist_01), foot_l/r, ball_l/r                    => EXCLUDE
 *
 * Implemented as an explicit prefix ALLOWLIST (not a leg denylist) so an unrecognised future bone
 * (a new rig, a renamed node) defaults to EXCLUDED — i.e. stays owned by locomotion — rather than
 * silently joining the overlay.
 */
const UPPER_BODY_PREFIXES = [
  'head',
  'neck_',
  'spine_',
  'clavicle_',
  'upperarm_',
  'lowerarm_',
  'hand_',
  'index_',
  'middle_',
  'pinky_',
  'ring_',
  'thumb_',
];

export function isUpperBodyBone(boneName: string): boolean {
  return UPPER_BODY_PREFIXES.some((prefix) => boneName.startsWith(prefix));
}

/**
 * The ARM chain only (clavicle -> upperarm -> lowerarm -> hand -> fingers), both sides — a strict
 * subset of `UPPER_BODY_PREFIXES` that deliberately EXCLUDES spine/neck/Head. Used to split a clip
 * into "arms" vs "everything else" (`Jump_Loop` is masked with `!isArmBone`
 * so it keeps its airborne legs/torso but never touches the arms, and a separate idle clip masked
 * with `isArmBone` supplies the arm base — so the procedural arm-swing composes additively on the
 * idle-arm pose it was authored against, not on Jump_Loop's arms).
 */
const ARM_PREFIXES = ['clavicle_', 'upperarm_', 'lowerarm_', 'hand_'];

/** The five finger chains (each `..._01`..`..._03` + `..._04_leaf` tip), both sides. A strict
 * subset of the arm — split out so a clip can drive the arm down to the wrist while leaving the
 * fingers alone (the jump does this so the fingers relax toward the rig's rest/open hand in flight
 * instead of holding the idle curl). */
const FINGER_PREFIXES = ['index_', 'middle_', 'pinky_', 'ring_', 'thumb_'];

export function isFingerBone(boneName: string): boolean {
  return FINGER_PREFIXES.some((prefix) => boneName.startsWith(prefix));
}

/** The whole arm chain INCLUDING fingers (clavicle -> upperarm -> lowerarm -> hand -> fingers),
 * both sides. `Jump_Loop` is masked with `!isArmBone` so it never drives any of it. */
export function isArmBone(boneName: string): boolean {
  return ARM_PREFIXES.some((prefix) => boneName.startsWith(prefix)) || isFingerBone(boneName);
}

const HEAD_PREFIXES = ['head', 'neck_'];
const SPINE_PREFIXES = ['spine_'];
const LEG_PREFIXES = ['thigh_', 'calf_', 'foot_', 'ball_'];
const IK_HAND_LEFT_BONES = new Set(['ik_hand_l'])
const IK_HAND_RIGHT_BONES = new Set(['ik_hand_root', 'ik_hand_gun', 'ik_hand_r'])

function isSide(bone: string, side: 'l' | 'r') {
  return bone.endsWith(`_${side}`)
}

function isArmWithoutFingers(bone: string, side: 'l' | 'r') {
  return isArmBone(bone) && !isFingerBone(bone) && isSide(bone, side)
}

function isHand(bone: string, side: 'l' | 'r') {
  // AB_Als_Layering excludes the five authored finger branches from each arm additive, then
  // restores them through LayerHandLeft/Right. The wrist itself remains part of the arm branch.
  return isFingerBone(bone) && isSide(bone, side)
}

/**
 * Named body regions for the owned evaluator. The side-specific regions reproduce
 * AB_Als_Layering's branch filters; the generic regions remain extension seams.
 */
export const REGION_PREDICATES = {
  /** Full arm chain incl. fingers. */
  arms: isArmBone,
  /** Arm chain WITHOUT fingers — lets fingers relax/follow another source (see jump split). */
  armsNoFingers: (bone: string) => isArmBone(bone) && !isFingerBone(bone),
  /** Just the finger chains. */
  fingers: isFingerBone,
  /** Head + neck. */
  head: (bone: string) => HEAD_PREFIXES.some((p) => bone.startsWith(p)),
  /** Spine chain only (no arms, no head). */
  spine: (bone: string) => SPINE_PREFIXES.some((p) => bone.startsWith(p)),
  /** ALS LayerArmLeft branch: clavicle through wrist/twists, with fingers split to LayerHandLeft. */
  armLeft: (bone: string) => isArmWithoutFingers(bone, 'l'),
  /** ALS LayerArmRight branch: clavicle through wrist/twists, with fingers split to LayerHandRight. */
  armRight: (bone: string) => isArmWithoutFingers(bone, 'r'),
  /** ALS hand layers are the five finger branches, not the wrist already owned by LayerArm*. */
  handLeft: (bone: string) => isHand(bone, 'l'),
  handRight: (bone: string) => isHand(bone, 'r'),
  /** Left-hand IK target follows the left arm and its authored HandLeftIk gate. */
  ikHandLeft: (bone: string) => IK_HAND_LEFT_BONES.has(bone),
  /** Shared IK root, gun target, and right-hand target follow the rifle's right arm source. */
  ikHandRight: (bone: string) => IK_HAND_RIGHT_BONES.has(bone),
  /** Pelvis only; child spine and thigh branches have their own Layer* curves. */
  pelvis: (bone: string) => bone === 'pelvis',
  /** Both thigh branches and every descendant leg bone. */
  legs: (bone: string) => LEG_PREFIXES.some((p) => bone.startsWith(p)),
  /** Everything above the pelvis — the existing overlay-state mask. */
  upperBody: isUpperBodyBone,
} as const;
export type RegionName = keyof typeof REGION_PREDICATES;

export interface AlsLayerRegion {
  readonly region: RegionName
  readonly baseCurve: string
  readonly additiveCurve?: string
  readonly localSpaceCurve?: string
  readonly additiveSpace?: 'local' | 'mesh'
}

/**
 * UAlsConstants Layer* names mapped onto AB_Als_Layering's branch roots. Additive curves drive
 * the graph's dynamic locomotion additive; LayerArm*LocalSpace chooses its rotation space.
 */
export const ALS_LAYER_REGIONS: readonly AlsLayerRegion[] = [
  {
    region: 'head',
    baseCurve: 'LayerHead',
    additiveCurve: 'LayerHeadAdditive',
    additiveSpace: 'mesh',
  },
  {
    region: 'armLeft',
    baseCurve: 'LayerArmLeft',
    additiveCurve: 'LayerArmLeftAdditive',
    localSpaceCurve: 'LayerArmLeftLocalSpace',
  },
  {
    region: 'armRight',
    baseCurve: 'LayerArmRight',
    additiveCurve: 'LayerArmRightAdditive',
    localSpaceCurve: 'LayerArmRightLocalSpace',
  },
  { region: 'handLeft', baseCurve: 'LayerHandLeft' },
  { region: 'handRight', baseCurve: 'LayerHandRight' },
  {
    region: 'spine',
    baseCurve: 'LayerSpine',
    additiveCurve: 'LayerSpineAdditive',
    additiveSpace: 'mesh',
  },
  { region: 'pelvis', baseCurve: 'LayerPelvis' },
  { region: 'legs', baseCurve: 'LayerLegs' },
] as const
