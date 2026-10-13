import type { AlsCharacter } from './AlsCharacter'
import type { AlsCharacterAnimationControls } from './AlsCharacter.hooks'
import type { AlsCharacterSnapshot } from './AlsCharacterSnapshot'

export interface AlsCharacterRecordingSource {
  /** Network input sequence when available; otherwise the recorder emits a sample counter. */
  seq?: number
  character: AlsCharacter
  controls: AlsCharacterAnimationControls
  /** Rapier body translation, in three.js axes. */
  position: { x: number; y: number; z: number }
  rolling?: { position: number; playRate: number }
  mantle?: { settings: string; position: number }
}

const actions = {
  Rolling: 'roll', Mantling: 'mantle', GettingUp: 'getUp', Ragdolling: 'ragdoll',
} as const
const gaits = { Walking: 'walking', Running: 'running', Sprinting: 'sprinting' } as const
const rotations = {
  VelocityDirection: 'velocityDirection', ViewDirection: 'viewDirection', Aiming: 'aiming',
} as const

/** Sample after MeshBase/Animation, not from window diagnostics. Call every rendered frame;
 * emission is rate limited, while action edges are observed even between emission ticks.
 * No catch-up burst after suspension: historical poses cannot be reconstructed from today's pose.
 */
export class AlsCharacterRecorder {
  readonly rateHz: number
  private nextTime = -Infinity
  private lastTime = -Infinity
  private lastAction: AlsCharacter['locomotionAction'] = null
  private actionSeq = 0
  private seq = 0

  constructor(rateHz = 20) {
    if (!Number.isFinite(rateHz) || rateHz <= 0) throw new Error('Invalid ALS recording rate')
    this.rateHz = rateHz
  }

  capture(t: number, source: AlsCharacterRecordingSource): AlsCharacterSnapshot | null {
    if (!Number.isFinite(t) || t < this.lastTime) return null
    this.lastTime = t
    const { character: c, controls, position } = source
    if (c.locomotionAction !== this.lastAction) {
      if (c.locomotionAction !== null) this.actionSeq++
      this.lastAction = c.locomotionAction
    }
    if (t < this.nextTime) return null
    const interval = 1000 / this.rateHz
    this.nextTime = Number.isFinite(this.nextTime)
      ? this.nextTime + (Math.floor((t - this.nextTime) / interval) + 1) * interval
      : t + interval
    const velocity = c.locomotionState.velocity
    return {
      t, pos: [position.x, position.y, position.z],
      vel: [velocity.x, velocity.z, velocity.y],
      actorYaw: c.actorYawAngle, viewYaw: c.viewYawAngle, viewPitch: c.viewPitchAngle,
      gait: gaits[c.gait], stance: c.stance === 'Standing' ? 'standing' : 'crouching',
      rotationMode: rotations[c.rotationMode],
      locomotionMode: c.locomotionMode === 'InAir' ? 'inAir' : 'grounded',
      action: c.locomotionAction ? actions[c.locomotionAction] : 'none',
      actionSeq: this.actionSeq, overlay: controls.overlayMode === 'Rifle' ? 'rifle'
        : String(controls.overlayMode).startsWith('Pistol') ? 'pistol' : 'default',
      aiming: c.desiredAiming, seq: source.seq ?? this.seq++,
      animation: {
        hasInput: c.locomotionState.hasInput,
        inputYaw: c.locomotionState.inputYawAngle,
        targetYaw: c.locomotionState.targetYawAngle,
        relativeAcceleration: { ...controls.relativeAccelerationAmount },
        rolling: source.rolling ? { ...source.rolling } : undefined,
        mantle: source.mantle ? { ...source.mantle } : undefined,
      },
    }
  }
}
