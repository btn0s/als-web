import { describe, expect, it } from 'vitest'
import {
  ALS_ACTUAL_GAIT_SPEED_BUFFER,
  ALS_SPRINT_VIEW_RELATIVE_ANGLE_THRESHOLD,
  applyDesiredStance,
  applyRotationYawSpeedAnimationCurve,
  calculateActualGait,
  calculateGroundedMovingRotationInterpolationSpeed,
  calculateMaxAllowedGait,
  canSprint,
  createAlsCharacter,
  refreshAlsCharacter,
  refreshGait,
  refreshGroundedFacingTarget,
  refreshInput,
  refreshLocomotion,
  refreshRotationMode,
  refreshView,
  setLocomotionAction,
  setLocomotionMode,
  setStance,
  setTargetYawAngle,
  setViewMode,
} from './AlsCharacter'

describe('AAlsCharacter input and gait policy', () => {
  it('owns exact rolling and ragdolling state records', () => {
    const first = createAlsCharacter()
    const second = createAlsCharacter()

    expect(first.rollingState).toEqual({
      TargetYawAngle: 0,
    })
    expect(first.ragdollingState).toEqual({
      Velocity: { x: 0, y: 0, z: 0 },
      PullForce: 0,
      SpeedLimitFrameTimeRemaining: 0,
      SpeedLimit: 0,
    })

    expect(first.rollingState).not.toBe(second.rollingState)
    expect(first.ragdollingState).not.toBe(second.ragdollingState)
    expect(first.ragdollingState.Velocity).not.toBe(
      second.ragdollingState.Velocity,
    )
  })

  it('safe-normalizes input and retains its yaw when input stops', () => {
    // AlsCharacter.cpp:1118-1137: SetInputDirection(GetSafeNormal), then only update yaw
    // while bHasInput is true.
    const character = createAlsCharacter()
    refreshInput(character, { x: 3, y: 4, z: 0 })

    expect(character.inputDirection.x).toBeCloseTo(0.6, 12)
    expect(character.inputDirection.y).toBeCloseTo(0.8, 12)
    expect(character.inputDirection.z).toBe(0)
    expect(character.locomotionState.hasInput).toBe(true)
    expect(character.locomotionState.inputYawAngle).toBeCloseTo(
      53.13010235415598,
      12,
    )

    refreshInput(character, { x: 0, y: 0, z: 0 })
    expect(character.locomotionState.hasInput).toBe(false)
    expect(character.locomotionState.inputYawAngle).toBeCloseTo(
      53.13010235415598,
      12,
    )
  })

  it('uses the strict 50-degree sprint eligibility boundary', () => {
    // AlsCharacter.cpp:1010-1037.
    expect(ALS_SPRINT_VIEW_RELATIVE_ANGLE_THRESHOLD).toBe(50)
    const character = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredRotationMode: 'ViewDirection',
      viewYawAngle: 0,
      settings: { rotateToVelocityWhenSprinting: false },
    })

    refreshInput(character, {
      x: Math.cos(49.999 * Math.PI / 180),
      y: Math.sin(49.999 * Math.PI / 180),
      z: 0,
    })
    expect(canSprint(character)).toBe(true)

    character.locomotionState.inputYawAngle = 50
    expect(canSprint(character)).toBe(false)
    expect(calculateMaxAllowedGait(character)).toBe('Running')
  })

  it('allows third-person VelocityDirection sprinting at any input angle, but not first person', () => {
    // AlsCharacter.cpp:1022-1035 excludes FirstPerson from the unconditional branch.
    const character = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredRotationMode: 'VelocityDirection',
      viewYawAngle: 0,
    })
    refreshInput(character, { x: -1, y: 0, z: 0 })

    expect(canSprint(character)).toBe(true)
    expect(setViewMode(character, 'FirstPerson')).toBe(character)
    expect(character.viewMode).toBe('FirstPerson')
    expect(canSprint(character)).toBe(false)
  })

  it('blocks sprint when crouching or aiming unless sprint has priority', () => {
    // AlsCharacter.cpp:1016-1019.
    const character = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredAiming: true,
      viewYawAngle: 0,
      settings: { sprintHasPriorityOverAiming: false },
    })
    refreshInput(character, { x: 1, y: 0, z: 0 })
    expect(canSprint(character)).toBe(false)

    const priorityCharacter = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredAiming: true,
      viewYawAngle: 0,
      settings: { sprintHasPriorityOverAiming: true },
    })
    refreshInput(priorityCharacter, { x: 1, y: 0, z: 0 })
    expect(canSprint(priorityCharacter)).toBe(true)

    setStance(priorityCharacter, 'Crouching')
    expect(canSprint(priorityCharacter)).toBe(false)
  })

  it('matches actual-gait boundaries including the 10 cm/s buffer', () => {
    // AlsCharacter.cpp:989-1008.
    expect(ALS_ACTUAL_GAIT_SPEED_BUFFER).toBe(0.1)
    const settings = createAlsCharacter().movement.gaitSettings

    expect(calculateActualGait(1.849999, settings, 'Sprinting')).toBe('Walking')
    expect(calculateActualGait(1.85, settings, 'Sprinting')).toBe('Running')
    expect(calculateActualGait(3.849999, settings, 'Sprinting')).toBe('Running')
    expect(calculateActualGait(3.85, settings, 'Sprinting')).toBe('Sprinting')
    expect(calculateActualGait(9, settings, 'Running')).toBe('Running')
  })

  it('keeps actual Running while a Walking max gait decelerates', () => {
    // The source comment at AlsCharacter.cpp:991-993 requires this lag.
    const character = createAlsCharacter({
      desiredGait: 'Walking',
      velocity: { x: 3, y: 0, z: 0 },
    })
    refreshLocomotion(character, { x: 3, y: 0, z: 0 })
    refreshGait(character)

    expect(character.movement.maxAllowedGait).toBe('Walking')
    expect(character.gait).toBe('Running')
  })

  it('refreshes in ALS Tick order from bridge input and velocity', () => {
    // AlsCharacter.cpp:291-300.
    const character = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      character,
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 4, z: 0 },
    )

    expect(character.locomotionState.inputYawAngle).toBe(90)
    expect(character.locomotionState.velocityYawAngle).toBe(90)
    expect(character.locomotionState.speed).toBe(4)
    expect(character.movement.maxAllowedGait).toBe('Sprinting')
    expect(character.gait).toBe('Sprinting')
    expect(character.rotationMode).toBe('VelocityDirection')
  })

  it('uncrouches InAir and reapplies DesiredStance on the landing edge', () => {
    // AlsCharacter.cpp:503-529 and 810-833.
    const character = createAlsCharacter({
      desiredStance: 'Crouching',
    })
    setStance(character, 'Crouching')
    character.locomotionState.rotationTowardsLastInputDirectionBlocked = false

    setLocomotionMode(character, 'InAir')
    expect(character.locomotionMode).toBe('InAir')
    expect(character.desiredStance).toBe('Crouching')
    expect(character.stance).toBe('Standing')
    expect(character.movement.stance).toBe('Standing')

    setLocomotionMode(character, 'Grounded')
    expect(character.locomotionMode).toBe('Grounded')
    expect(character.stance).toBe('Crouching')
    expect(character.movement.stance).toBe('Crouching')
    expect(
      character.locomotionState.rotationTowardsLastInputDirectionBlocked,
    ).toBe(true)
    expect(character.movement.brakingFrictionFactor).toBe(3)
    expect(character.movement.brakingFrictionFactorResetTime).toBe(0.5)
  })

  it('keeps stance action-owned and restores desired stance on action exit', () => {
    const character = createAlsCharacter({
      desiredStance: 'Standing',
    })

    setLocomotionAction(character, 'Mantling')
    character.desiredStance = 'Crouching'
    applyDesiredStance(character)
    expect(character.stance).toBe('Standing')

    setLocomotionMode(character, null)
    expect(character.stance).toBe('Standing')

    setLocomotionAction(character, null)
    // MOVE_Custom has no stance branch.
    expect(character.stance).toBe('Standing')

    setLocomotionMode(character, 'Grounded')
    expect(character.stance).toBe('Crouching')

    character.desiredStance = 'Standing'
    setLocomotionAction(character, 'Rolling')
    expect(character.stance).toBe('Crouching')

    character.movement.inputBlocked = true
    setLocomotionAction(character, null)
    expect(character.stance).toBe('Standing')
    expect(character.movement.inputBlocked).toBe(false)
  })
})

describe('AAlsCharacter RotationMode policy', () => {
  it('selects Aiming from desired aim and VelocityDirection for configured sprinting', () => {
    // AlsCharacter.cpp:684-767.
    const aiming = createAlsCharacter({ desiredAiming: true })
    refreshRotationMode(aiming)
    expect(aiming.rotationMode).toBe('Aiming')

    const sprinting = createAlsCharacter({
      desiredGait: 'Sprinting',
      desiredRotationMode: 'ViewDirection',
      settings: { rotateToVelocityWhenSprinting: true },
    })
    refreshInput(sprinting, { x: 1, y: 0, z: 0 })
    refreshGait(sprinting)
    refreshRotationMode(sprinting)
    expect(sprinting.rotationMode).toBe('VelocityDirection')
  })

  it('uses authored camera-yaw responsiveness multiplication', () => {
    // AlsCharacter.cpp:1791-1795 maps 0..300°/s to a 1..3 multiplier.
    expect(calculateGroundedMovingRotationInterpolationSpeed(5, 0)).toBe(5)
    expect(calculateGroundedMovingRotationInterpolationSpeed(5, 150)).toBe(10)
    expect(calculateGroundedMovingRotationInterpolationSpeed(5, 300)).toBe(15)
    expect(calculateGroundedMovingRotationInterpolationSpeed(5, 900)).toBe(15)
  })

  it('faces desired velocity in moving VelocityDirection and releases the last-input block', () => {
    // AlsCharacter.cpp:1612-1627.
    const character = createAlsCharacter({
      desiredRotationMode: 'VelocityDirection',
    })
    refreshAlsCharacter(
      character,
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    )
    const target = refreshGroundedFacingTarget(character)

    expect(target.source).toBe('DesiredVelocity')
    expect(target.yawAngle).toBe(90)
    expect(target.targetYawAngleRotationSpeed).toBe(800)
    expect(
      character.locomotionState.rotationTowardsLastInputDirectionBlocked,
    ).toBe(false)
  })

  it('uses view plus RotationYawOffset for ViewDirection, except sprint uses velocity', () => {
    // AlsCharacter.cpp:1631-1652.
    const character = createAlsCharacter({
      desiredRotationMode: 'ViewDirection',
      viewYawAngle: 30,
    })
    refreshAlsCharacter(
      character,
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    )

    const running = refreshGroundedFacingTarget(character, -15)
    expect(running.source).toBe('ViewRotationWithRotationYawOffset')
    expect(running.yawAngle).toBe(15)

    character.gait = 'Sprinting'
    character.locomotionState.velocityYawAngle = -70
    const sprinting = refreshGroundedFacingTarget(character, 80)
    expect(sprinting.source).toBe('Velocity')
    expect(sprinting.yawAngle).toBe(-70)
  })

  it('preserves actor yaw while stopped-and-blocked, but input targets view yaw', () => {
    // AlsCharacter.cpp:1574-1592.
    const character = createAlsCharacter({
      actorYawAngle: -20,
      viewYawAngle: 70,
    })
    let target = refreshGroundedFacingTarget(character)
    expect(target).toMatchObject({
      source: 'ActorRotation',
      yawAngle: -20,
    })

    refreshInput(character, { x: 1, y: 0, z: 0 })
    target = refreshGroundedFacingTarget(character)
    expect(target).toMatchObject({
      source: 'ViewRotation',
      yawAngle: 70,
      targetYawAngleRotationSpeed: 500,
    })
  })

  it('targets view rotation in Aiming with the authored moving rates', () => {
    // AlsCharacter.cpp:1656-1701.
    const character = createAlsCharacter({
      desiredAiming: true,
      viewYawAngle: 110,
      velocity: { x: 1, y: 0, z: 0 },
    })
    refreshInput(character, { x: 1, y: 0, z: 0 })
    refreshLocomotion(character, { x: 1, y: 0, z: 0 })
    refreshRotationMode(character)

    expect(refreshGroundedFacingTarget(character)).toEqual({
      source: 'ViewRotation',
      yawAngle: 110,
      rotationInterpolationSpeed: 20,
      targetYawAngleRotationSpeed: 1000,
    })
  })

  it('applies authored RotationYawSpeed as degrees/second and refreshes target yaw state', () => {
    // AlsCharacter.cpp:1798-1810 and 1921-1927.
    expect(applyRotationYawSpeedAnimationCurve(170, 40, 0.5)).toBe(-170)
    expect(applyRotationYawSpeedAnimationCurve(25, 0, 1)).toBe(25)

    const character = createAlsCharacter({ viewYawAngle: 30 })
    setTargetYawAngle(character, 190)
    expect(character.locomotionState.targetYawAngle).toBe(-170)
    expect(character.locomotionState.smoothTargetYawAngle).toBe(-170)
    expect(character.locomotionState.viewRelativeTargetYawAngle).toBe(-160)
  })

  it('keeps absolute view yaw independent while authored actor yaw turns', () => {
    // AlsCharacter.cpp:1226-1269 samples controller view rotation one-way; actor yaw never feeds
    // back into it. AlsAnimationInstance.cpp:363-369 derives the relative yaw afterward.
    const character = createAlsCharacter({
      actorYawAngle: 0,
      viewYawAngle: 90,
    })

    refreshView(character, 90, 1 / 60)
    character.actorYawAngle = applyRotationYawSpeedAnimationCurve(
      character.actorYawAngle,
      45,
      1,
    )
    refreshView(character, 90, 1 / 60)

    expect(character.viewYawAngle).toBe(90)
    expect(character.viewYawSpeed).toBe(0)
    expect(character.viewYawAngle - character.actorYawAngle).toBe(45)
  })
})
