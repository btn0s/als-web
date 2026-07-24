import * as THREE from 'three'

/**
 * Reusable procedural pose layer — spring-driven ADDITIVE bone-rotation offsets applied AFTER
 * the mixer: additive layers, each scoped to its own subtree, added on top of the ~weight-1
 * base pose. The character owns its animation pipeline: one frame callback runs
 * `mixer.update(dt)` first, then every post-mixer stage in source order — this must be invoked
 * from a stage AFTER that update (never before it, or from a separate frame callback), so the
 * mixer has already written this frame's pose and the edits survive to render.
 *
 * Framework-light (plain `three`, no React) so the pure math is Vitest-testable in isolation —
 * mirrors AlsConstants.ts/blendspace.ts's split between "pure system" (this file) and "R3F wiring"
 * (the character binding, where bones resolve off the cloned skeleton and Leva tunables live).
 *
 * Everything here does ZERO per-frame allocation: `ProceduralOffset.scratch` is reused every
 * frame, and `axis`/`maxAngle` are meant to be MUTATED in place by the consumer (e.g. copied in
 * fresh each frame from a live Leva vector/angle) rather than replaced — see `ProceduralOffset`.
 */

/**
 * A spring-smoothed scalar (0..1, or signed -1..1) driving one or more `ProceduralOffset`s.
 * Typically SHARED across every bone in a chain that should move together off the same smoothed
 * amount (e.g. one `yawDriver` feeds a look-chain's head/neck/spine offsets, each scaled by its
 * own share of the total angle — see `distributeAngle`). A plain mutable object, not a class,
 * matching the rest of this codebase's ref-driven style (`armRaise = useRef(0)` etc.).
 */
export interface Driver {
  /** Current smoothed value. Read by `applyOffset`, written by `stepDriver`. */
  value: number
}

export function createDriver(initial = 0): Driver {
  return { value: initial }
}

/**
 * Springs `driver.value` toward `target` — a thin, explicitly-named wrapper over
 * `THREE.MathUtils.damp` (the same damp math already used everywhere else in this codebase:
 * `BLEND_DAMP`, `YAW_DAMP`, `JUMP_BLEND_DAMP`, ...) so procedural drivers settle with the same
 * feel as the rest of the locomotion rig. `rate` is a 1/s damp rate (higher = snappier), not a
 * physical spring stiffness/mass pair — good enough for a critically-damped FEEL without the
 * extra velocity-state bookkeeping a true spring needs.
 */
export function stepDriver(driver: Driver, target: number, rate: number, dt: number): void {
  driver.value = THREE.MathUtils.damp(driver.value, target, rate, dt)
}

/**
 * Shortest signed angular distance from `from` to `to`, wrapped to [-PI, PI]. Pulled out as pure
 * math (rather than inlined at each call site) since both look-offset (camera-yaw vs body-yaw)
 * and lean (yaw RATE, i.e. this same delta divided by dt) need it. Same wrap logic as
 * `Player.tsx`'s local `dampAngle` helper, minus the damping step.
 */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/**
 * Splits a total additive angle (radians) across a bone chain by weight fractions — e.g. a
 * look-offset chain putting more of the rotation on the head than the spine (`[0.5, 0.3, 0.2]`).
 * Fractions don't need to sum to 1 (each bone just gets `fraction * totalAngle`), but for the
 * SUM across the chain to equal the intended total they generally should.
 */
export function distributeAngle(totalAngle: number, fractions: readonly number[]): number[] {
  return fractions.map((fraction) => totalAngle * fraction)
}

/**
 * Computes the additive local-space delta quaternion for a driver value. Conceptually
 * `slerp(identity, quatFromAxisAngle(axis, maxAngle), driver)`, but computed DIRECTLY as
 * `quatFromAxisAngle(axis, maxAngle * driver)` instead of an actual `Quaternion.slerp` call. The
 * two are mathematically equivalent for `driver` in [0, 1] — both trace the same single-axis
 * rotation, so slerping identity toward a target angle by fraction `t` is exactly the quaternion
 * for `angle * t` about that same axis — but the direct form ALSO stays correct for SIGNED
 * drivers outside that range (a look/lean deadzone can legitimately want a negative angle),
 * where `THREE.Quaternion.slerp`'s shortest-path dot-product flip can invert the rotation
 * direction instead of extrapolating past `t=0`. Writes into `out` (reused scratch — no
 * allocation) and returns it.
 */
export function additiveDeltaQuat(
  axis: THREE.Vector3,
  maxAngle: number,
  driver: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  return out.setFromAxisAngle(axis, maxAngle * driver)
}

/**
 * One additive rotation: `bone` gets rotated about its own LOCAL `axis` by `maxAngle *
 * driver.value` radians, POST-multiplied onto whatever the mixer (and any earlier-applied
 * offsets this same frame) already wrote into `bone.quaternion` — i.e.
 * `bone.quaternion.multiply(delta)`, rotating further in the bone's own current local frame
 * rather than resetting it. Multiple offsets can target the same bone (e.g. a yaw offset then a
 * pitch offset) and compose in the order they're applied.
 *
 * `axis` and `maxAngle` are read fresh on every `applyOffset` call — a consumer wiring this up to
 * live Leva controls can mutate them in place each frame (e.g. `offset.axis.set(x, y, z)`,
 * `offset.maxAngle = fraction * liveMaxAngle`) without rebuilding the offset or allocating.
 */
export interface ProceduralOffset {
  /** Resolved bone, or null if it wasn't found on the rig — `applyOffset` no-ops rather than
   * throwing, so a consumer can build its offset list before every bone name is confirmed
   * present on the skeleton. */
  bone: THREE.Bone | null
  /** Local-space rotation axis (should stay normalized; mutate in place to retune live). */
  axis: THREE.Vector3
  /** Rotation (radians) applied at `driver.value === 1` (or `-1` for the opposite direction). */
  maxAngle: number
  /** Spring-smoothed driver (see `Driver`/`stepDriver`) — typically SHARED across every offset in
   * a chain that should move off the same smoothed amount. */
  driver: Driver
  /** Scratch quaternion for this offset's delta, reused every `applyOffset` call. */
  scratch: THREE.Quaternion
}

/**
 * Builds a `ProceduralOffset`. `axis` is cloned (so the caller can pass a throwaway/literal
 * vector) into an owned scratch the offset goes on to mutate in place.
 */
export function createOffset(
  bone: THREE.Bone | null,
  axis: THREE.Vector3,
  maxAngle: number,
  driver: Driver,
): ProceduralOffset {
  return { bone, axis: axis.clone(), maxAngle, driver, scratch: new THREE.Quaternion() }
}

/** Applies one offset's additive rotation onto its bone. No-op if `bone` is null. */
export function applyOffset(offset: ProceduralOffset): void {
  if (!offset.bone) return
  additiveDeltaQuat(offset.axis, offset.maxAngle, offset.driver.value, offset.scratch)
  offset.bone.quaternion.multiply(offset.scratch)
}

/**
 * Applies every offset in `offsets`, in order. Call this at the very END of the consuming
 * component's locomotion `useFrame`, after every base-layer weight/`clip.time` assignment — see
 * this module's top comment for why the ordering matters.
 */
export function applyProceduralPose(offsets: readonly ProceduralOffset[]): void {
  for (const offset of offsets) applyOffset(offset)
}
