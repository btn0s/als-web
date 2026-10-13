import type { AlsPistolOverlayMode } from './AnimGraph/overlayMode'

/** Transport-neutral wire contract. Times are milliseconds in ONE synchronized clock domain.
 * pos is the Rapier body anchor (standing capsule centre), not the mesh root; all linear
 * values use three.js metres, all angles use ALS degrees. Network clock sync belongs to caller.
 */
export interface AlsCharacterSnapshot {
  t: number
  pos: [number, number, number]
  vel: [number, number, number]
  actorYaw: number
  viewYaw: number
  viewPitch: number
  gait: 'walking' | 'running' | 'sprinting'
  stance: 'standing' | 'crouching'
  rotationMode: 'velocityDirection' | 'viewDirection' | 'aiming'
  locomotionMode: 'grounded' | 'inAir'
  action: 'none' | 'roll' | 'mantle' | 'getUp' | 'ragdoll'
  actionSeq: number
  overlay: 'default' | 'pistol' | 'rifle'
  aiming: boolean
  seq: number
  /** Optional presentation data: base wire fields cannot recover input intent or mantle choice.
   * The recorder supplies these; servers may forward them unchanged. No movement authority.
   */
  animation?: {
    /** Base overlay='pistol' defaults to two-handed when this presentation detail is absent. */
    pistolOverlayMode?: AlsPistolOverlayMode
    hasInput: boolean
    inputYaw: number
    targetYaw?: number
    relativeAcceleration: { x: number; y: number }
    rolling?: { position: number; playRate: number }
    mantle?: { settings: string; position: number }
  }
}
