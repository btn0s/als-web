import { ALS_MOVEMENT_SETTINGS, sampleGroundedMovementParameters } from './Settings/AlsMovementSettings'
import {
  createAlsCharacterAnimationControls, publishAlsCharacterAnimationSnapshot,
  resolveAlsActorLocation, type AlsAnimationCharacter, type AlsAnimationAccelerationLimits,
} from './AlsCharacterAnimation'
import { ALS_NO_BASED_MOVEMENT } from './State/AlsMovementBaseState'
import { createAlsLocomotionState, refreshLocomotionState, unwindDegrees } from './State/AlsLocomotionState'
import type { AlsCharacterSnapshot } from './AlsCharacterSnapshot'
import { AlsAnimationUpdateRate } from '../engine/animationUpdateRate'

const gait = { walking: 'Walking', running: 'Running', sprinting: 'Sprinting' } as const
const rotation = {
  velocityDirection: 'VelocityDirection', viewDirection: 'ViewDirection', aiming: 'Aiming',
} as const
const action = {
  none: null, roll: 'Rolling', mantle: 'Mantling', getUp: 'GettingUp', ragdoll: 'Ragdolling',
} as const

/** Presentation-only equivalent of the Character → NativeUpdateAnimation boundary. Never calls
 * RefreshCharacter, rotation policy, movement integration, input bindings, or action authority.
 */
export class AlsRemoteCharacter {
  readonly animationRate
  readonly character: AlsAnimationCharacter
  private readonly accelerationLimits: AlsAnimationAccelerationLimits

  constructor(options: {
    character?: AlsAnimationCharacter
    animationLodPhase?: number
    accelerationLimits?: AlsAnimationAccelerationLimits
  } = {}) {
    this.character = options.character ?? {
      desiredAiming: false, desiredRotationMode: 'ViewDirection', desiredStance: 'Standing',
      desiredGait: 'Running', viewMode: 'ThirdPerson', locomotionMode: 'Grounded',
      locomotionAction: null, rotationMode: 'ViewDirection', stance: 'Standing', gait: 'Walking',
      actorYawAngle: 0, viewYawAngle: 0, viewPitchAngle: 0, viewYawSpeed: 0,
      locomotionState: createAlsLocomotionState(),
    }
    this.accelerationLimits = options.accelerationLimits ?? sampleGroundedMovementParameters(
      ALS_MOVEMENT_SETTINGS.ViewDirection.Standing, 0,
    )
    this.animationRate = new AlsAnimationUpdateRate(options.animationLodPhase)
  }
  readonly controls = createAlsCharacterAnimationControls()
  private previous: AlsCharacterSnapshot | null = null
  private location = { x: 0, y: 0, z: 0 }

  apply(snapshot: AlsCharacterSnapshot): { jumped: boolean; unsupported: string[] } {
    const c = this.character
    const previous = this.previous
    const delta = previous ? (snapshot.t - previous.t) / 1000 : 0
    const velocity = { x: snapshot.vel[0], y: snapshot.vel[2], z: snapshot.vel[1] }
    const acceleration = {
      x: delta > 0 ? (snapshot.vel[0] - previous!.vel[0]) / delta : 0,
      y: delta > 0 ? (snapshot.vel[2] - previous!.vel[2]) / delta : 0,
      z: delta > 0 ? (snapshot.vel[1] - previous!.vel[1]) / delta : 0,
    }
    c.actorYawAngle = snapshot.actorYaw
    c.viewYawAngle = snapshot.viewYaw
    c.viewPitchAngle = snapshot.viewPitch
    c.viewYawSpeed = delta > 0 ? Math.abs(unwindDegrees(snapshot.viewYaw - previous!.viewYaw) / delta) : 0
    c.gait = c.desiredGait = gait[snapshot.gait]
    c.stance = c.desiredStance = snapshot.stance === 'standing' ? 'Standing' : 'Crouching'
    c.rotationMode = c.desiredRotationMode = rotation[snapshot.rotationMode]
    c.desiredAiming = snapshot.aiming
    c.locomotionMode = snapshot.action === 'mantle' || snapshot.action === 'ragdoll'
      ? null : snapshot.locomotionMode === 'grounded' ? 'Grounded' : 'InAir'
    c.locomotionAction = action[snapshot.action]
    // Base protocol lacks input intent. Velocity-derived intent is a documented fallback;
    // recorder extensions preserve braking versus driven motion and the authored start graph.
    c.locomotionState.hasInput = snapshot.animation?.hasInput
      ?? Math.hypot(velocity.x, velocity.y) > 0.01
    refreshLocomotionState(c.locomotionState, velocity, c.locomotionState.hasInput)
    c.locomotionState.inputYawAngle = snapshot.animation?.inputYaw ?? c.locomotionState.velocityYawAngle
    c.locomotionState.targetYawAngle = snapshot.animation?.targetYaw ?? snapshot.actorYaw
    resolveAlsActorLocation({ x: snapshot.pos[0], y: snapshot.pos[2], z: snapshot.pos[1] },
      c.stance, c.locomotionMode, this.location)
    const pistol = snapshot.animation?.pistolOverlayMode === 'PistolOneHanded'
      ? 'PistolOneHanded' : 'PistolTwoHanded'
    const unsupported: string[] = []
    if (snapshot.action === 'ragdoll' || snapshot.action === 'getUp') {
      unsupported.push(`${snapshot.action} replication (consumer must trigger the cosmetic ragdoll API)`)
    }
    publishAlsCharacterAnimationSnapshot(this.controls, {
      character: c, location: this.location, basedMovement: ALS_NO_BASED_MOVEMENT,
      acceleration,
      accelerationLimits: this.accelerationLimits,
      overlayMode: snapshot.animation?.overlayMode ?? (snapshot.overlay === 'launcher' ? 'Launcher' : snapshot.overlay === 'rifle' ? 'Rifle'
        : snapshot.overlay === 'pistol' ? pistol : 'Default'),
      movementOverride: false, speedOverride: 0, directionOverride: 0,
      rotateInPlaceOverride: false,
      locomotionYawSpeed: delta > 0 ? unwindDegrees(snapshot.actorYaw - previous!.actorYaw) / delta : 0,
    })
    if (snapshot.animation) {
      Object.assign(this.controls.relativeAccelerationAmount, snapshot.animation.relativeAcceleration)
    }
    const jumped = previous !== null && previous.locomotionMode === 'grounded'
      && snapshot.locomotionMode === 'inAir' && snapshot.vel[1] > 0 && snapshot.action === 'none'
    this.previous = snapshot
    return { jumped, unsupported }
  }
}
