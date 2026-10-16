import { describe, expect, it } from 'vitest'
import {
  createAlsCharacter,
  refreshAlsCharacter,
  setLocomotionAction,
  setLocomotionMode,
  setStance,
} from './AlsCharacter'
import {
  ALS_CAPSULE_RADIUS,
  ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
  ALS_MESH_RELATIVE_LOCATION_Z,
  ALS_PHYSICS_TIMESTEP,
  ALS_RAPIER_GRAVITY,
  ALS_RAPIER_JUMP_SPEED,
  ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
  ALS_STANDING_CAPSULE_HALF_HEIGHT,
  alsActorYawQuaternion,
  applyAlsMantlingRotationDelta,
  consumeAlsJumpInput,
  getAlsCapsuleHalfHeight,
  handleAlsJumpInput,
  prepareRapierAlsAnimRootMotionVelocity,
  prepareRapierAlsMantlingMovementBoundary,
  refreshRapierAlsLocomotionMode,
  refreshAlsCodeJumpInput,
  requestAlsJumpInput,
  publishAlsCharacterAnimationSnapshot,
  resolveAlsActorFeetLocation,
  resolveAlsActorLocation,
  resolveAlsActorLocationFromPresentationGround,
  resolveAlsCameraMovementBaseSnapshot,
  resolveAlsMantlingOverlayTag,
  resolveAlsMeshRootRelativeY,
  resolveCameraRelativeInput,
  shouldProbeRapierAlsGround,
  stepGroundedCharacterYaw,
  stepInAirCharacterYaw,
} from './AlsCharacter.hooks'
import type {
  AlsCharacterAnimationControls,
} from './AlsCharacter.hooks'
import type {
  AlsLocomotionModeChangedLifecycle,
} from './AlsCharacter'
import { exponentialDecay } from './State/AlsGroundedState'
import { unwindDegrees } from './State/AlsLocomotionState'
import { ALS_NO_BASED_MOVEMENT } from './State/AlsMovementBaseState'
import { calculateMovingSmooth } from './Settings/AlsGeneralAnimationSettings'
import {
  UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
} from '../engine/characterMovementFloor'
import {
  applyRootMotionSource,
  createRootMotionSourceGroup,
  getRootMotionSourceByID,
} from '../engine/rootMotionSourceGroup'
import type {
  CompiledAuthoredRootMotion,
} from '../engine/rootMotion'
import {
  createRootMotionMovementParams,
} from '../engine/rootMotion'
import {
  createAlsRootMotionSource_Mantling,
} from './RootMotionSources/AlsRootMotionSource_Mantling'
import {
  ALS_MANTLING_SETTINGS,
  selectAlsMantlingSettings,
} from './Settings/AlsMantlingSettings'
import type {
  AlsMantlingLifecycleAdapter,
} from './AlsCharacter_Actions'
import type {
  RapierAlsMantlingAdapter,
} from '../engine/rapierAlsMantling'

function animationControlsFixture(): AlsCharacterAnimationControls {
  return {
    gait: 'Walking',
    moving: false,
    movingSmooth: false,
    locomotionMode: 'Grounded',
    scale: 1,
    location: { x: 0, y: 0, z: 0 },
    actorYawAngle: 0,
    basedMovement: ALS_NO_BASED_MOVEMENT,
    velocity: { x: 0, y: 0, z: 0 },
    capsuleRadius: ALS_CAPSULE_RADIUS,
    capsuleHalfHeight: ALS_STANDING_CAPSULE_HALF_HEIGHT,
    walkableFloorAngleCos: ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS,
    stance: 'Standing',
    rotationMode: 'ViewDirection',
    overlayMode: 'Default',
    speed: 0,
    direction: 0,
    relativeAccelerationAmount: { x: 0, y: 0 },
    rotateInPlace: false,
    viewYawAngle: 0,
    viewYawSpeed: 0,
  }
}

function syntheticMantlingRootMotion(
  clipName: string,
  duration: number,
): CompiledAuthoredRootMotion {
  return {
    clipName,
    duration,
    bEnableRootMotion: false,
    bForceRootLock: true,
    RootMotionRootLock: 'AnimFirstFrame',
    poseReset: {
      kind: 'animationFirstFrame',
      translation: new Float32Array(3),
      rotation: new Float32Array([0, 0, 0, 1]),
    },
    times: new Float32Array([0, duration]),
    translations: new Float32Array([
      0, 0, 0,
      0, 1, 0,
    ]),
    rotations: new Float32Array([
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]),
  }
}

describe('AlsCharacter browser bridge math', () => {
  it('pins the ALS character constructor and inherited UE movement defaults in metres', () => {
    expect(ALS_CAPSULE_RADIUS).toBe(0.3)
    expect(ALS_STANDING_CAPSULE_HALF_HEIGHT).toBe(0.9)
    expect(ALS_CROUCHING_CAPSULE_HALF_HEIGHT).toBe(0.56)
    expect(ALS_MESH_RELATIVE_LOCATION_Z).toBe(-0.92)
    expect(ALS_RAPIER_JUMP_SPEED).toBe(4.2)
    expect(ALS_RAPIER_WALKABLE_FLOOR_ANGLE_COS).toBe(0.71)
    expect(ALS_RAPIER_GRAVITY).toBe(9.8)
    expect(getAlsCapsuleHalfHeight('Standing')).toBe(0.9)
    expect(getAlsCapsuleHalfHeight('Crouching')).toBe(0.56)
  })

  it('reconstructs the active capsule-root actor location from the Rapier body anchor', () => {
    const rapierBodyAnchor = { x: 2, y: -3, z: 4 }
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Standing',
      'Grounded',
    )).toEqual({
      x: 2,
      y: -3,
      z: 4,
    })
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Crouching',
      'Grounded',
    )).toEqual({
      x: 2,
      y: -3,
      z: 4
        + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
        - ALS_STANDING_CAPSULE_HALF_HEIGHT,
    })
    expect(resolveAlsActorLocation(
      rapierBodyAnchor,
      'Crouching',
      'InAir',
    ).z).toBe(
      4
      + ALS_CROUCHING_CAPSULE_HALF_HEIGHT
      - ALS_STANDING_CAPSULE_HALF_HEIGHT,
    )
    expect(rapierBodyAnchor).toEqual({ x: 2, y: -3, z: 4 })
  })

  it('derives the camera owner location from the same rendered mesh-root frame as its pivot', () => {
    const bodyAnchor = { x: 2, y: -3, z: 0.9 }

    for (const [stance, locomotionMode] of [
      ['Standing', 'Grounded'],
      ['Crouching', 'Grounded'],
      ['Standing', 'InAir'],
      ['Crouching', 'InAir'],
    ] as const) {
      const ground = {
        x: bodyAnchor.x,
        y: bodyAnchor.y,
        z: bodyAnchor.z + resolveAlsMeshRootRelativeY(stance, locomotionMode),
      }
      expect(resolveAlsActorLocationFromPresentationGround(
        ground,
        stance,
        locomotionMode,
      )).toEqual(resolveAlsActorLocation(
        bodyAnchor,
        stance,
        locomotionMode,
      ))
    }
  })

  it('keeps both active capsule bases at CharacterMovement target floor distance', () => {
    const bodyAnchor = {
      x: 2,
      y: -3,
      z: ALS_STANDING_CAPSULE_HALF_HEIGHT
        + UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE,
    }
    for (const stance of ['Standing', 'Crouching'] as const) {
      const actor = resolveAlsActorLocation(
        bodyAnchor,
        stance,
        'Grounded',
      )
      expect(resolveAlsActorFeetLocation(actor, stance).z)
        .toBeCloseTo(UE_CHARACTER_MOVEMENT_TARGET_FLOOR_DISTANCE, 12)
    }
  })

  it('keeps the rendered mesh fixed while the crouching capsule root lowers', () => {
    // CharacterMovement lowers the capsule root to maintain its base. ACharacter::OnStartCrouch()
    // adds the same half-height adjustment to the relative mesh location, cancelling that motion.
    // Our Rapier body anchor is already fixed, so applying either adjustment again would be wrong.
    expect(resolveAlsMeshRootRelativeY('Standing', 'Grounded')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z,
    )
    expect(resolveAlsMeshRootRelativeY('Crouching', 'Grounded')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z,
    )
    expect(
      resolveAlsMeshRootRelativeY('Crouching', 'Grounded')
      - resolveAlsMeshRootRelativeY('Standing', 'Grounded'),
    ).toBe(0)
    expect(resolveAlsMeshRootRelativeY('Crouching', 'InAir')).toBe(
      ALS_MESH_RELATIVE_LOCATION_Z,
    )
  })

  it('publishes landing tags and one retained locomotion bundle as one frame', () => {
    const character = createAlsCharacter({
      actorYawAngle: 10,
      viewYawAngle: 50,
      viewPitchAngle: -25,
      viewMode: 'FirstPerson',
      desiredStance: 'Crouching',
      locomotionMode: 'InAir',
    })
    character.viewYawSpeed = 12
    setStance(character, 'Standing')
    refreshAlsCharacter(
      character,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1.2, z: -0.15 },
      { x: 0, y: 6.5, z: 0 },
    )
    setLocomotionMode(character, 'Grounded')
    setLocomotionAction(character, 'Rolling')
    character.locomotionState.inputYawAngle = 35
    character.locomotionState.targetYawAngle = -70
    const location = { x: 2, y: -3, z: 4 }
    const basedMovement = {
      ...ALS_NO_BASED_MOVEMENT,
      primitive: {},
      hasRelativeLocation: true,
    }
    const output = animationControlsFixture()

    publishAlsCharacterAnimationSnapshot(output, {
      character,
      location,
      basedMovement,
      acceleration: { x: 0, y: -2, z: 0 },
      overlayMode: 'Rifle',
      movementOverride: false,
      speedOverride: 99,
      directionOverride: -123,
      rotateInPlaceOverride: true,
      locomotionYawSpeed: -45,
    })

    expect(output).toMatchObject({
      locomotionMode: 'Grounded',
      locomotionAction: 'Rolling',
      stance: 'Crouching',
      gait: 'Walking',
      rotationMode: 'ViewDirection',
      overlayMode: 'Rifle',
      hasInput: true,
      speed: 1.2,
      moving: true,
      movingSmooth: true,
      actorYawAngle: 10,
      direction: 80,
      viewYawAngle: 40,
      viewPitchAngle: -25,
      viewYawSpeed: 12,
      viewMode: 'FirstPerson',
      inputYawAngle: 35,
      targetYawAngle: -70,
      locomotionYawSpeed: -45,
      capsuleHalfHeight: ALS_CROUCHING_CAPSULE_HALF_HEIGHT,
      rotateInPlace: true,
    })
    expect(output.velocity).toBe(character.locomotionState.velocity)
    expect(output.velocity).toEqual({ x: 0, y: 1.2, z: -0.15 })
    expect(output.speed).toBeCloseTo(
      Math.hypot(output.velocity.x, output.velocity.y),
      12,
    )
    expect(output.direction).toBe(
      unwindDegrees(
        character.locomotionState.velocityYawAngle
        - output.actorYawAngle,
      ),
    )
    expect(output.moving).toBe(character.locomotionState.moving)
    expect(output.movingSmooth).toBe(
      calculateMovingSmooth(character.locomotionState),
    )
    expect(output.location).toBe(location)
    expect(output.basedMovement).toBe(basedMovement)
  })

  it('publishes only the current Grounded support to ALSCamera', () => {
    const supportBody = (
      handle: number,
      fixed: boolean,
      translation: { x: number; y: number; z: number },
    ) => ({
      handle,
      isFixed: () => fixed,
      translation: () => translation,
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    })
    const supportHit = (
      rigidBody: ReturnType<typeof supportBody>,
    ) => {
      const collider = {
        handle: rigidBody.handle + 100,
        parent: () => rigidBody,
        translation: rigidBody.translation,
        rotation: rigidBody.rotation,
      }
      return {
        validBlockingHit: true,
        time: 0,
        impactNormal: { x: 0, y: 0, z: 1 },
        collider,
        rigidBody,
      }
    }

    const staticBody = supportBody(1, true, { x: 2, y: 3, z: 4 })
    const staticHit = supportHit(staticBody)
    expect(resolveAlsCameraMovementBaseSnapshot(
      'Grounded',
      staticHit,
    )).toEqual({
      key: staticHit.collider,
      boneName: '',
      hasRelativeRotation: false,
      location: { x: 2, y: 4, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    })

    const movingBody = supportBody(2, false, { x: 5, y: 6, z: 7 })
    const movingHit = supportHit(movingBody)
    expect(resolveAlsCameraMovementBaseSnapshot(
      'Grounded',
      movingHit,
      true,
    )).toMatchObject({
      key: movingHit.collider,
      hasRelativeRotation: true,
      location: { x: 5, y: 7, z: 6 },
    })

    expect(resolveAlsCameraMovementBaseSnapshot('Grounded', null))
      .toBeNull()
    expect(resolveAlsCameraMovementBaseSnapshot(
      'InAir',
      movingHit,
      true,
    )).toBeNull()
  })

  it('builds camera-relative input in ALS X-forward/Y-right coordinates', () => {
    expect(resolveCameraRelativeInput(
      { right: 0, forward: 1 },
      0,
    )).toEqual({ x: 1, y: 0, z: 0 })
    expect(resolveCameraRelativeInput(
      { right: 1, forward: 0 },
      0,
    )).toEqual({ x: 0, y: 1, z: 0 })

    const rotated = resolveCameraRelativeInput(
      { right: 0, forward: 1 },
      90,
    )
    expect(rotated.x).toBeCloseTo(0, 12)
    expect(rotated.y).toBeCloseTo(1, 12)
  })

  it('applies Character root-motion scale once, maps mesh forward, and preserves falling Z', () => {
    const grounded = createRootMotionMovementParams()
    grounded.valid = true
    grounded.blendWeight = 1
    grounded.translation.set([0, 0, 0.1])
    const groundedVelocity = { x: 99, y: 99, z: 99 }

    expect(prepareRapierAlsAnimRootMotionVelocity(
      grounded,
      1.3,
      90,
      0.1,
      'Grounded',
      { x: 2, y: 3, z: -4 },
      groundedVelocity,
    )).toBe(true)
    expect(grounded.translation[0]).toBe(0)
    expect(grounded.translation[1]).toBe(0)
    expect(grounded.translation[2]).toBeCloseTo(0.13, 6)
    expect(groundedVelocity.x).toBeCloseTo(0, 12)
    expect(groundedVelocity.y).toBeCloseTo(1.3, 6)
    expect(groundedVelocity.z).toBeCloseTo(0, 12)

    const falling = createRootMotionMovementParams()
    falling.valid = true
    falling.translation.set([0, 0, 0.1])
    const fallingVelocity = { x: 0, y: 0, z: 0 }
    prepareRapierAlsAnimRootMotionVelocity(
      falling,
      1.3,
      90,
      0.1,
      'InAir',
      { x: 2, y: 3, z: -4 },
      fallingVelocity,
    )
    expect(fallingVelocity).toMatchObject({
      z: -4,
    })
    expect(fallingVelocity.x).toBeCloseTo(0, 12)
    expect(fallingVelocity.y).toBeCloseTo(1.3, 6)
  })

  it('applies ALS extra-smooth target rotation before actor exponential decay', () => {
    const single = createAlsCharacter({
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      single,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    )
    single.movement.rotationInterpolationSpeed = 8
    stepGroundedCharacterYaw(single, 1 / 30)

    const split = createAlsCharacter({
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      split,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    )
    split.movement.rotationInterpolationSpeed = 8
    stepGroundedCharacterYaw(split, 1 / 60)
    stepGroundedCharacterYaw(split, 1 / 60)

    // VelocityDirection uses the authored 800°/s smooth-target rate. The moving target means two
    // substeps intentionally differ from one larger step; both orders match SetRotationExtraSmooth.
    const smoothTarget = 800 / 30
    expect(single.locomotionState.smoothTargetYawAngle)
      .toBeCloseTo(smoothTarget, 12)
    expect(single.actorYawAngle).toBeCloseTo(
      smoothTarget * exponentialDecay(1 / 30, 8),
      12,
    )
    expect(split.actorYawAngle).toBeGreaterThan(0)
    expect(split.actorYawAngle).toBeLessThan(single.actorYawAngle)
    expect(single.locomotionState.targetYawAngle).toBe(90)
  })

  it('consumes the preceding animation curves in AAlsCharacter grounded-rotation order', () => {
    const stopped = createAlsCharacter({
      actorYawAngle: 10,
      viewYawAngle: 80,
      desiredAiming: true,
    })
    refreshAlsCharacter(
      stopped,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    )

    stepGroundedCharacterYaw(stopped, 0.5, -30, 20)

    expect(stopped.actorYawAngle).toBe(20)
    expect(stopped.locomotionState.targetYawAngle).toBe(20)
    expect(stopped.locomotionState.smoothTargetYawAngle).toBe(20)

    const moving = createAlsCharacter({
      actorYawAngle: 0,
      viewYawAngle: 90,
      desiredRotationMode: 'ViewDirection',
    })
    refreshAlsCharacter(
      moving,
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    )
    stepGroundedCharacterYaw(moving, 1 / 60, -30, 10_000)

    // RotationYawSpeed is stopped-only. Moving ViewDirection instead consumes the preceding
    // RotationYawOffset as ViewYaw + Offset before SetRotationExtraSmooth().
    expect(moving.locomotionState.targetYawAngle).toBe(60)
    expect(moving.actorYawAngle).toBeLessThan(60)
  })

  it('rotates airborne ViewDirection toward velocity at the authored speed', () => {
    const character = createAlsCharacter({
      actorYawAngle: 0,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      settings: { inAirRotationMode: 'RotateToVelocityOnJump' },
    })
    refreshAlsCharacter(
      character,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 1 },
    )

    stepInAirCharacterYaw(character, 1 / 30)

    expect(character.actorYawAngle).toBeCloseTo(
      90 * exponentialDecay(1 / 30, 5),
      12,
    )
    expect(character.locomotionState.targetYawAngle).toBe(90)
    expect(character.locomotionState.smoothTargetYawAngle).toBe(90)
  })

  it('ports KeepRelativeRotation and KeepWorldRotation without substituting a heuristic', () => {
    const relative = createAlsCharacter({
      actorYawAngle: 0,
      viewYawAngle: 90,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      settings: { inAirRotationMode: 'KeepRelativeRotation' },
    })
    relative.viewYawAngle = 120
    stepInAirCharacterYaw(relative, 1 / 30)
    expect(relative.locomotionState.targetYawAngle).toBe(30)
    expect(relative.actorYawAngle).toBeCloseTo(
      30 * exponentialDecay(1 / 30, 5),
      12,
    )

    const world = createAlsCharacter({
      actorYawAngle: 37,
      viewYawAngle: 120,
      desiredRotationMode: 'ViewDirection',
      locomotionMode: 'InAir',
      velocity: { x: 0, y: 2, z: -1 },
      settings: { inAirRotationMode: 'KeepWorldRotation' },
    })
    expect(stepInAirCharacterYaw(world, 1 / 30)).toBe(37)
    expect(world.locomotionState.targetYawAngle).toBe(37)
  })

  it('uses the authored airborne Aiming speed and shortest wrapped path', () => {
    const character = createAlsCharacter({
      actorYawAngle: 179,
      viewYawAngle: -179,
      desiredAiming: true,
      locomotionMode: 'InAir',
    })

    stepInAirCharacterYaw(character, 1 / 30)

    expect(character.actorYawAngle).toBeCloseTo(
      179 + 2 * exponentialDecay(1 / 30, 15),
      12,
    )
    expect(character.locomotionState.aimingYawAngleLimit).toBe(70)
    expect(character.locomotionState.aimingLimitAppliedThisFrame).toBe(true)
  })

  it('coalesces the __triggerJump frame edge and consumes it exactly once', () => {
    const request = { current: false }
    requestAlsJumpInput(request)
    requestAlsJumpInput(request)
    expect(consumeAlsJumpInput(request)).toBe(true)
    expect(consumeAlsJumpInput(request)).toBe(false)
  })

  it('consumes external jump sequences once across fixed substeps and enters InAir', () => {
    const request = { current: false }
    const sequence = { current: 0 }
    const input = { active: true, jumpSequence: 1 }
    const character = createAlsCharacter()
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(true)
    expect(handleAlsJumpInput(character)).toBe('Jumped')
    expect(character.locomotionMode).toBe('InAir')
    for (let step = 0; step < 5; step++) {
      refreshAlsCodeJumpInput(input, sequence, request)
      expect(consumeAlsJumpInput(request)).toBe(false)
    }
    input.jumpSequence++
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(true)
  })

  it('cancels inactive external jump edges without replaying them when reactivated', () => {
    const request = { current: true }
    const sequence = { current: 0 }
    const input = { active: false, jumpSequence: 1 }
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(false)
    input.active = true
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(false)
    input.jumpSequence++
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(true)
  })

  it('starts from the mounted external sequence without replaying a pre-respawn press', () => {
    const input = { active: true, jumpSequence: 7 }
    const sequence = { current: input.jumpSequence }
    const request = { current: false }
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(false)
    input.jumpSequence++
    refreshAlsCodeJumpInput(input, sequence, request)
    expect(consumeAlsJumpInput(request)).toBe(true)
  })

  it('attempts a grounded mantle before the crouch and Jump branches', () => {
    const character = createAlsCharacter({
      desiredStance: 'Crouching',
    })
    const ordering: string[] = []
    expect(handleAlsJumpInput(character, () => {
      ordering.push('StartMantlingGrounded')
      return true
    })).toBe('Mantled')
    expect(ordering).toEqual(['StartMantlingGrounded'])
    expect(character.stance).toBe('Crouching')
    expect(character.locomotionMode).toBe('Grounded')
  })

  it('uncrouches on the first jump input and jumps only from Grounded Standing', () => {
    const character = createAlsCharacter({
      desiredStance: 'Crouching',
    })

    expect(handleAlsJumpInput(character)).toBe('Uncrouched')
    expect(character.desiredStance).toBe('Standing')
    expect(character.stance).toBe('Standing')
    expect(character.locomotionMode).toBe('Grounded')

    expect(handleAlsJumpInput(character)).toBe('Jumped')
    expect(character.locomotionMode).toBe('InAir')
    expect(ALS_RAPIER_JUMP_SPEED).toBe(4.2)
    expect(handleAlsJumpInput(character)).toBe('Rejected')
  })

  it('jumps from InAir only inside an opted-in coyote window', () => {
    const character = createAlsCharacter()
    expect(refreshRapierAlsLocomotionMode(character, false, 0)).toBe('InAir')
    expect(handleAlsJumpInput(character)).toBe('Rejected')
    expect(handleAlsJumpInput(character, () => false, true)).toBe('Jumped')
    expect(character.locomotionMode).toBe('InAir')
  })

  it('exposes Rapier Walking/Falling as exact ALS locomotion-mode edges', () => {
    const character = createAlsCharacter()

    expect(refreshRapierAlsLocomotionMode(character, false, 0))
      .toBe('InAir')
    expect(refreshRapierAlsLocomotionMode(character, true, 1))
      .toBe('InAir')
    expect(refreshRapierAlsLocomotionMode(character, true, 0))
      .toBe('Grounded')

    setLocomotionMode(character, null)
    expect(refreshRapierAlsLocomotionMode(
      character,
      true,
      -10,
      true,
    )).toBeNull()
    expect(character.locomotionMode).toBeNull()
    expect(shouldProbeRapierAlsGround(null, true)).toBe(false)
    expect(shouldProbeRapierAlsGround(null, false)).toBe(false)
    expect(shouldProbeRapierAlsGround('Grounded', false)).toBe(true)
  })

  it('keeps the exact landing action lifecycle on the Rapier mode edge', () => {
    const character = createAlsCharacter({
      locomotionMode: 'InAir',
      velocity: { x: 3, y: 0, z: -7 },
    })
    const events: unknown[] = []
    const lifecycle: AlsLocomotionModeChangedLifecycle = {
      StartRagdolling() {
        events.push('StartRagdolling')
      },
      StartRolling(PlayRate, TargetYawAngle) {
        events.push(['StartRolling', PlayRate, TargetYawAngle])
      },
      OnLocomotionModeChanged(PreviousLocomotionMode) {
        events.push([
          'OnLocomotionModeChanged',
          PreviousLocomotionMode,
        ])
      },
    }

    expect(refreshRapierAlsLocomotionMode(
      character,
      true,
      0,
      false,
      lifecycle,
    )).toBe('Grounded')
    expect(events).toEqual([
      ['StartRolling', 1.3, 0],
      ['OnLocomotionModeChanged', 'InAir'],
    ])
  })

  it('maps every authored low-mantle overlay and rejects unknown tags', () => {
    const expected = {
      Default: 'MS_Als_Low',
      Injured: 'MS_Als_Low_Left',
      HandsTied: 'MS_Als_Low_BothHands',
      Rifle: 'MS_Als_Low_Right',
      PistolOneHanded: 'MS_Als_Low_Right',
      PistolTwoHanded: 'MS_Als_Low_Right',
      Bow: 'MS_Als_Low_Left',
      Torch: 'MS_Als_Low_Left',
      Binoculars: 'MS_Als_Low_Right',
      Box: 'MS_Als_Low_Box',
      Barrel: 'MS_Als_Low_Left',
    } as const
    for (const [overlay, settingsName] of Object.entries(expected)) {
      const tag = resolveAlsMantlingOverlayTag(overlay)
      expect(selectAlsMantlingSettings('Low', tag).Name)
        .toBe(settingsName)
    }
    expect(() => resolveAlsMantlingOverlayTag('Unknown'))
      .toThrow('Unsupported ALS mantling overlay mode')
  })

  it('prepares and applies one retained mantling RMS exactly once at the movement boundary', () => {
    const character = createAlsCharacter()
    const settings = ALS_MANTLING_SETTINGS.MS_Als_Low_Right
    const targetPrimitive = {}
    const rootMotionSource = createAlsRootMotionSource_Mantling({
      MantlingSettings: settings,
      AuthoredRootMotion: syntheticMantlingRootMotion(
        settings.Montage.Sequence,
        settings.Montage.SequenceLength,
      ),
      MantlingHeight: 0.75,
      TargetPrimitive: targetPrimitive,
      bUseRelativeLocation: false,
      TargetRelativeLocation: { x: 1, y: 0, z: 1 },
      TargetRelativeRotation: {
        Pitch: 0,
        Yaw: 0,
        Roll: 0,
      },
      ActorFeetLocation: { x: 0, y: 0, z: 0.0215 },
      ActorRotation: alsActorYawQuaternion(0),
    })
    const rootMotionSources =
      createRootMotionSourceGroup<typeof rootMotionSource>()
    const rootMotionSourceId = applyRootMotionSource(
      rootMotionSources,
      rootMotionSource,
    )
    character.mantlingState.RootMotionSourceId =
      rootMotionSourceId
    setLocomotionMode(character, null)
    setLocomotionAction(character, 'Mantling')

    let montageSetPositionCount = 0
    const Lifecycle: AlsMantlingLifecycleAdapter = {
      SetNetworkSmoothingMode() {},
      ResetMeshRelativeTransform() {},
      SetMovementModeLocked() {},
      SetBase() {},
      ApplyRootMotionSource() {
        throw new Error('unexpected nested root-motion application')
      },
      GetRootMotionSourceByID(id) {
        return getRootMotionSourceByID(rootMotionSources, id)
      },
      MantlingMontage: {
        play() {
          return null
        },
        montageSetPosition() {
          montageSetPositionCount++
          return true
        },
        montageStop() {
          return false
        },
        stopMontageInstance() {
          return false
        },
        takeNotifyEvents() {
          return []
        },
      },
      IsTargetPrimitiveValid() {
        return true
      },
      OnMantlingStarted() {},
      OnMantlingEnded() {},
      ForceNetUpdate() {},
      StartRagdolling() {},
    }
    const MantlingAdapter = {
      UseRelativeLocation() {
        return false
      },
      GetTargetPrimitiveTransform() {
        throw new Error('static target has no relative transform')
      },
      IsTargetValid() {
        return true
      },
    } as unknown as RapierAlsMantlingAdapter
    let translation = { x: 0, y: 0.9, z: 0 }
    let setNextKinematicTranslationCount = 0
    let setLinvelCount = 0
    const Body = {
      translation: () => translation,
      setNextKinematicTranslation(value: typeof translation) {
        setNextKinematicTranslationCount++
        translation = { ...value }
      },
      setLinvel(
        value: { x: number; y: number; z: number },
      ) {
        setLinvelCount++
        expect(value).toEqual({ x: 0, y: 0, z: 0 })
      },
    }

    const result =
      prepareRapierAlsMantlingMovementBoundary({
        Character: character,
        RootMotionSources: rootMotionSources,
        Lifecycle,
        MantlingAdapter,
        Body,
        ActorFeetLocation: { x: 0, y: 0, z: 0.0215 },
        DeltaTime: ALS_PHYSICS_TIMESTEP,
      })

    expect(result.PreparedSourceCount).toBe(1)
    expect(result.bAppliedDirectTranslation).toBe(true)
    expect(result.RootMotionResult?.valid).toBe(true)
    expect(rootMotionSource.Time).toBe(ALS_PHYSICS_TIMESTEP)
    expect(montageSetPositionCount).toBe(1)
    expect(setNextKinematicTranslationCount).toBe(1)
    expect(setLinvelCount).toBe(1)
    expect(Object.keys(character.mantlingState))
      .toEqual(['RootMotionSourceId'])
  })

  it('applies RotationDelta times current actor rotation in UE order', () => {
    expect(applyAlsMantlingRotationDelta(
      30,
      alsActorYawQuaternion(60),
    )).toBeCloseTo(90, 12)
  })
})
