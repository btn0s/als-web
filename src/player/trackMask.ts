import * as THREE from 'three';

/**
 * Track-filtering — the core mechanism of the ALS-style masked overlay layer.
 * three.js has NO per-bone mask / LayeredBlendPerBone API: `PropertyMixer`
 * blends per KeyframeTrack (per bound property), not per clip. So "masking" a clip to a subset of
 * bones just means building a new clip that only contains tracks for those bones — a clip with no
 * track for a bone cannot affect that bone at any weight, full stop.
 *
 * Kept framework-free of React (plain `three` only) so it stays Vitest-testable in isolation.
 */

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
 * Upper-body bone allowlist for the overlay layer, so overlay clips (e.g. `Idle_FoldArms_Loop`)
 * drive arms/torso while legs stay owned by locomotion. Bind-pose caveat (verified against three's
 * source): `PropertyMixer.apply` blends any weight shortfall on a track toward the SAVED BIND POSE,
 * not toward other actions — so the base locomotion layer must keep supplying every bone at total
 * weight ~1, and overlays/additives sit on top of that; this predicate is what
 * lets the overlay clip skip the leg bones entirely rather than fighting the base for them).
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
 * into "arms" vs "everything else" (see Operative's jump: `Jump_Loop` is masked with `!isArmBone`
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
const TORSO_PREFIXES = ['spine_'];

/**
 * Named body regions for the declarative region-overlay layer (regionOverlays.ts) — the ALS
 * "layered blend per bone" groups, expressed as track-mask predicates. LEGS/pelvis/root are
 * deliberately NOT offered: the base locomotion layer owns foot placement, and an overlay
 * fighting it would slide the feet (put leg variation in the base weight table instead).
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
  torso: (bone: string) => TORSO_PREFIXES.some((p) => bone.startsWith(p)),
  /** Everything above the pelvis — the existing overlay-state mask. */
  upperBody: isUpperBodyBone,
} as const;
export type RegionName = keyof typeof REGION_PREDICATES;
