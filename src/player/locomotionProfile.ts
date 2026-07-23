import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/**
 * The single source of truth for locomotion tuning.
 *
 * The player model is the UAL1 **root-motion** (`_RM`) variant: each locomotion clip bakes the
 * character's authored ground travel into the `root` bone's translation track. We read that
 * displacement once at load — `stride` = metres the body carries per clip cycle, and therefore
 * `speed = stride / duration` is the exact ground speed the animation was authored to look
 * natural at (feet planted, no slide). Then we STRIP the root track so the clip renders in
 * place, since world movement is driven by the Rapier controller, not the animation.
 *
 * Everything downstream derives from these two numbers per gait and nothing else:
 *   - movement target speeds (Player)          = gait.speed
 *   - blendspace crossfade thresholds (blendspace) = gait.speed
 *   - foot-locked animation cadence (blendspace)   = currentSpeed / gait.stride
 * so movement and animation can never drift out of sync — change the clip and both retune.
 */

export const MODEL_PATH = '/models/operative.glb';
/**
 * UAL2's clips (combat/action set), loaded alongside UAL1 in `Operative` and concatenated into one
 * animations array — same 67-bone skeleton, so UAL2's tracks bind by bone name same as UAL1's. This
 * is the "Standard" (in-place) UAL2 variant, correct for one-shots that should animate in place over
 * locomotion rather than travel.
 */
export const ALTS_MODEL_PATH = '/models/operative_alts.glb';
/**
 * The curated ALS clip set — a single animation-only GLB merged from the FULL Quaternius UAL1+UAL2
 * Source libraries (see `scripts/build-player-anims.mjs`, CLAUDE.md). 71 clips: 8-way walk/jog,
 * sprint, turn-in-place, directional crouch, crawl, in-air, wall-run/kick, multi-height vault, aim,
 * overlays. Same 67-bone rig, so tracks bind by bone name like the others. Loaded in `Operative`
 * with PRIORITY over the base/alts subsets (deduped by clip name) so the richer resampled versions
 * win, while base/alts still supply the extra montage/overlay clips this set omits (Sword_*, Spell_*,
 * Idle_FoldArms_Loop, Walk_Carry_Loop, …).
 */
export const PLAYER_ANIMS_PATH = '/models/player-anims.glb';
const ROOT_BONE = 'root';
// Resampled loops can finish a few millimetres away from their first root-Y sample. Ten centimetres
// leaves that harmless bake noise alone while sitting well below the smallest gameplay-warped
// traversal rise (StepUp is 0.5 m), so classification follows the motion rather than clip names.
const TRAVERSAL_ROOT_Y_DELTA = 0.1;

export interface Gait {
  /** Native clip length (s). */
  duration: number;
  /** Ground distance the body travels per clip cycle (m), from the baked root motion. */
  stride: number;
  /** Authored ground speed (m/s) = stride / duration. 0 for in-place idles. */
  speed: number;
}

export interface LocomotionProfile {
  idle: Gait;
  walk: Gait;
  jog: Gait;
  crouchIdle: Gait;
  crouchWalk: Gait;
}

/**
 * Reads (and caches) the baked root-motion stride from a clip, then strips the root
 * translation so the clip animates in place. Idempotent: the extracted stride is memoised on
 * the clip so a second call (e.g. HMR / a second consumer) returns it without re-stripping
 * (which would measure 0 on the now-in-place track).
 */
function strideOf(clip: THREE.AnimationClip): number {
  const cached = clip.userData?.__strideExtracted;
  if (typeof cached === 'number') return cached;

  const track =
    clip.tracks.find((t) => t.name === `${ROOT_BONE}.position`) ??
    clip.tracks.find((t) => t.name.endsWith(`${ROOT_BONE}.position`));

  let stride = 0;
  if (track) {
    const v = track.values; // flat [x,y,z, x,y,z, ...]
    const n = v.length / 3;
    if (n >= 2) {
      const fx = v[0];
      const fy = v[1];
      const fz = v[2];
      const lx = v[(n - 1) * 3];
      const ly = v[(n - 1) * 3 + 1];
      const lz = v[(n - 1) * 3 + 2];
      stride = Math.hypot(lx - fx, lz - fz);

      const rootYDelta = ly - fy;
      const removesTraversalRise = Math.abs(rootYDelta) > TRAVERSAL_ROOT_Y_DELTA;
      const firstTime = track.times[0];
      const timeSpan = track.times[n - 1] - firstTime;
      for (let i = 0; i < n; i++) {
        v[i * 3] = fx;
        v[i * 3 + 2] = fz;
        if (removesTraversalRise) {
          // The capsule warp owns traversal height, so retaining the clip's net rise applies the
          // same displacement twice and pops when the montage fades. Subtract the time-linear ramp
          // rather than flattening Y: the first/last root heights now match, while authored local
          // compression and bob survive to keep the traversal pose from looking mechanically flat.
          const phase = timeSpan > 0 ? (track.times[i] - firstTime) / timeSpan : i / (n - 1);
          v[i * 3 + 1] -= rootYDelta * phase;
        }
      }
    }
  }

  clip.userData = clip.userData ?? {};
  clip.userData.__strideExtracted = stride;
  return stride;
}

/**
 * Measures a single clip's gait (duration/stride/speed), stripping any baked root motion in place
 * (see `strideOf`). Exported so the Animation Sandbox can measure an arbitrary user-selected clip —
 * e.g. re-deriving the walk slot's stride when the Leva "Walk" dropdown swaps to an alt clip (see
 * Operative.tsx) — not just the five fixed clips `buildLocomotionProfile` reads by name.
 */
export function measureGait(clip: THREE.AnimationClip): Gait {
  const stride = strideOf(clip);
  const duration = clip.duration;
  return { duration, stride, speed: duration > 0 ? stride / duration : 0 };
}

function gaitOf(clips: Map<string, THREE.AnimationClip>, name: string): Gait {
  const clip = clips.get(name);
  if (!clip) return { duration: 0, stride: 0, speed: 0 };
  return measureGait(clip);
}

const profileCache = new WeakMap<THREE.AnimationClip[], LocomotionProfile>();

export function buildLocomotionProfile(animations: THREE.AnimationClip[]): LocomotionProfile {
  const cached = profileCache.get(animations);
  if (cached) return cached;

  const byName = new Map(animations.map((c) => [c.name, c]));
  const profile: LocomotionProfile = {
    idle: gaitOf(byName, 'Idle_Loop'),
    walk: gaitOf(byName, 'Walk_Loop'),
    jog: gaitOf(byName, 'Jog_Fwd_Loop'),
    crouchIdle: gaitOf(byName, 'Crouch_Idle_Loop'),
    crouchWalk: gaitOf(byName, 'Crouch_Fwd_Loop'),
  };
  profileCache.set(animations, profile);
  return profile;
}

/** Hook form: derives the profile from the (cached) player glb, memoised per animations array. */
export function useLocomotionProfile(): LocomotionProfile {
  const { animations } = useGLTF(MODEL_PATH);
  return useMemo(() => buildLocomotionProfile(animations), [animations]);
}

/**
 * Pace tuning (leva). Multipliers on the clips' authored ground speed — 1 = authored; feet stay
 * locked at ANY value (cadence = speed/stride), so these only trade limb-cadence naturalness for
 * traversal feel. Walk has two modes, `normal` and `slow`, toggled at runtime by Caps Lock (and
 * the same normal/slow applies while crouched). `jog` is the Shift gait and is unaffected by the
 * walk mode. Authored UAL speeds are a wide spread (walk ~1, jog ~5.4 m/s), so defaults tighten it.
 */
export interface PaceTuning {
  normal: number;
  slow: number;
  jog: number;
}

// Playtest 2026-07-23 (two rounds): walk/jog are the HURRIED gaits — sneaking lives on slow walk
// (Caps Lock, stays 0.7) — so both got quicker: walk 1.4 -> 1.65, jog 0.6 -> 0.85. The jog bumps
// are double-duty: faster run AND less floaty, because foot-lock plays the clip at speed/stride
// tempo — the old 0.6x ran the whole jog cycle (airborne beats included) at 60% tempo, and that
// stretched hang time was the float. 0.85 runs it near authored tempo while gaining ground speed.
export const DEFAULT_PACE: PaceTuning = { normal: 1.65, slow: 0.7, jog: 0.85 };

export interface ResolvedGaitSpeeds {
  walk: number;
  jog: number;
  crouchWalk: number;
}

/**
 * Resolves authored gait speeds × pace into the movement/threshold speeds, keeping walk < jog so
 * the blendspace crossfade can't invert however the sliders are set. `slowWalk` (Caps Lock) picks
 * the walk mode, applied to both walk and crouch-walk. Single source consumed by BOTH Player
 * (target speed) and Operative (crossfade thresholds), so they can't diverge.
 */
export function resolveGaitSpeeds(
  profile: LocomotionProfile,
  tuning: PaceTuning,
  slowWalk: boolean,
): ResolvedGaitSpeeds {
  const walkMult = slowWalk ? tuning.slow : tuning.normal;
  const walk = profile.walk.speed * walkMult;
  const jog = Math.max(profile.jog.speed * tuning.jog, walk * 1.05);
  const crouchWalk = profile.crouchWalk.speed * walkMult;
  return { walk, jog, crouchWalk };
}
