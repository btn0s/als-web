/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveCameraRelativeInput,
  sampleGamepad,
  ALS_GAMEPAD_BINDINGS,
} from '../AlsCharacter.hooks'
import { resolveDesiredGaitSpeed } from '../Settings/AlsMovementSettings'
import {
  FInputActionInstance,
  UInputTriggerHold,
  UInputTriggerPressed,
  UInputTriggerReleased,
  UInputTriggerTap,
} from '../../engine/InputTriggers'

interface ExtractedInputObject {
  readonly type: string
  readonly serializedProperties: Readonly<Record<string, unknown>>
}

interface ExtractedInputMapping {
  readonly action: {
    readonly name: string
  }
  readonly key: string
  readonly triggers: readonly ExtractedInputObject[]
  readonly modifiers: readonly ExtractedInputObject[]
}

interface ExtractedInputAction {
  readonly valueType: string
  readonly triggers: readonly ExtractedInputObject[]
  readonly modifiers: readonly ExtractedInputObject[]
}

interface ExtractedInputMappings {
  readonly source: {
    readonly release: string
    readonly engineVersion: string
    readonly asset: string
  }
  readonly mappingContext: {
    readonly name: string
    readonly mappings: readonly ExtractedInputMapping[]
  }
  readonly actions: Readonly<Record<string, ExtractedInputAction>>
  readonly validations: {
    readonly passed: boolean
  }
}

interface ExtractedGaitSettings {
  readonly WalkForwardSpeed: number
  readonly RunForwardSpeed: number
  readonly SprintSpeed: number
}

interface ExtractedMovementSettings {
  readonly settings: {
    readonly nativeSpeedUnit: 'cm/s'
    readonly rotationModes: Readonly<Record<string, {
      readonly stances: Readonly<Record<string, ExtractedGaitSettings>>
    }>>
  }
}

const extractedInput = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/input-mappings.json', import.meta.url),
  'utf8',
)) as ExtractedInputMappings

const extractedMovement = JSON.parse(readFileSync(
  new URL('../../../scripts/extract-als/movement-settings.json', import.meta.url),
  'utf8',
)) as ExtractedMovementSettings

const controllerSource = readFileSync(
  new URL('../AlsCharacter.hooks.ts', import.meta.url),
  'utf8',
)
const compactControllerSource = controllerSource.replace(/\s+/g, ' ')

const IMPLEMENTED_MAPPING_CONTRACTS = [
  ['IA_Als_Move', 'W', ['InputModifierSwizzleAxis']],
  ['IA_Als_Move', 'A', ['InputModifierNegate']],
  ['IA_Als_Move', 'S', [
    'InputModifierSwizzleAxis',
    'InputModifierNegate',
  ]],
  ['IA_Als_Move', 'D', []],
  ['IA_Als_Move', 'Gamepad_Left2D', ['InputModifierDeadZone']],
  ['IA_Als_Sprint', 'LeftShift', []],
  ['IA_Als_Sprint', 'Gamepad_FaceButton_Right', []],
  ['IA_Als_Walk', 'LeftAlt', []],
  ['IA_Als_Walk', 'Gamepad_RightShoulder', []],
  ['IA_Als_Crouch', 'LeftControl', []],
  ['IA_Als_Crouch', 'Gamepad_LeftThumbstick', []],
  ['IA_Als_Aim', 'RightMouseButton', []],
  ['IA_Als_Aim', 'Gamepad_LeftShoulder', []],
  ['IA_Als_Ragdoll', 'X', []],
  ['IA_Als_Ragdoll', 'Gamepad_FaceButton_Left', []],
  ['IA_Als_Roll', 'LeftShift', []],
  ['IA_Als_Roll', 'Gamepad_FaceButton_Right', []],
  ['IA_Als_RotationMode', 'One', []],
  ['IA_Als_RotationMode', 'Gamepad_DPad_Left', []],
] as const

function findMapping(actionName: string, key: string) {
  return extractedInput.mappingContext.mappings.filter(
    (mapping) => mapping.action.name === actionName && mapping.key === key,
  )
}

function moveAxisFromAuthoredMapping(mapping: ExtractedInputMapping) {
  let right = 1
  let forward = 0
  for (const modifier of mapping.modifiers) {
    if (modifier.type === 'InputModifierSwizzleAxis') {
      // UE5.5's class default is YXZ. The empty tagged-property object in the
      // extracted ALS asset means that default is authoritative.
      forward = right
      right = 0
    } else if (modifier.type === 'InputModifierNegate') {
      right = -right
      forward = -forward
    }
  }
  return { right, forward }
}

describe('ALS content oracle: implemented character inputs', () => {
  it('uses the validated ALS 4.15 mapping context', () => {
    expect(extractedInput.source).toEqual({
      release: 'ALS-Refactored 4.15',
      engineVersion: 'UE5.5',
      asset: '/ALS/ALS/Data/Input/IMC_Als_Default',
    })
    expect(extractedInput.mappingContext.name).toBe('IMC_Als_Default')
    expect(extractedInput.validations.passed).toBe(true)
  })

  it.each(IMPLEMENTED_MAPPING_CONTRACTS)(
    '%s / %s preserves its authored mapping modifiers',
    (actionName, key, modifierTypes) => {
      const mappings = findMapping(actionName, key)
      expect(mappings).toHaveLength(1)
      expect(mappings[0].modifiers.map((modifier) => modifier.type))
        .toEqual(modifierTypes)
      expect(mappings[0].triggers).toEqual([])
    },
  )

  it('preserves the authored action-level trigger contracts', () => {
    expect(extractedInput.actions.IA_Als_Move).toMatchObject({
      valueType: 'EInputActionValueType::Axis2D',
      triggers: [],
      modifiers: [],
    })
    expect(extractedInput.actions.IA_Als_Sprint.triggers).toEqual([
      expect.objectContaining({
        type: 'InputTriggerHold',
        serializedProperties: {
          HoldTimeThreshold: 0.1,
          bIsOneShot: true,
        },
      }),
      expect.objectContaining({
        type: 'InputTriggerReleased',
        serializedProperties: {},
      }),
    ])
    for (const actionName of [
      'IA_Als_Walk',
      'IA_Als_Crouch',
      'IA_Als_Ragdoll',
      'IA_Als_RotationMode',
    ]) {
      expect(extractedInput.actions[actionName].triggers).toEqual([
        expect.objectContaining({
          type: 'InputTriggerPressed',
          serializedProperties: {},
        }),
      ])
    }
    expect(extractedInput.actions.IA_Als_Aim.triggers).toEqual([
      expect.objectContaining({
        type: 'InputTriggerPressed',
        serializedProperties: {},
      }),
      expect.objectContaining({
        type: 'InputTriggerReleased',
        serializedProperties: {},
      }),
    ])
    expect(extractedInput.actions.IA_Als_Roll.triggers).toEqual([
      expect.objectContaining({
        type: 'InputTriggerTap',
        serializedProperties: {
          TapReleaseTimeThreshold: 0.3,
        },
      }),
    ])
  })

  it('implements the authored keyboard movement signs and view-relative basis', () => {
    const expectedAtZeroYaw = {
      W: { x: 1, y: 0, z: 0 },
      A: { x: 0, y: -1, z: 0 },
      S: { x: -1, y: 0, z: 0 },
      D: { x: 0, y: 1, z: 0 },
    }

    for (const key of ['W', 'A', 'S', 'D'] as const) {
      const [mapping] = findMapping('IA_Als_Move', key)
      const actual = resolveCameraRelativeInput(
        moveAxisFromAuthoredMapping(mapping),
        0,
      )
      expect(actual.x).toBeCloseTo(expectedAtZeroYaw[key].x, 12)
      expect(actual.y).toBeCloseTo(expectedAtZeroYaw[key].y, 12)
      expect(actual.z).toBe(0)
    }

    const [forwardMapping] = findMapping('IA_Als_Move', 'W')
    const rotatedForward = resolveCameraRelativeInput(
      moveAxisFromAuthoredMapping(forwardMapping),
      90,
    )
    expect(rotatedForward.x).toBeCloseTo(0, 12)
    expect(rotatedForward.y).toBeCloseTo(1, 12)

    const diagonal = resolveCameraRelativeInput(
      { right: 1, forward: 1 },
      0,
    )
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 12)
  })

  it('keeps browser key, pointer, and standard-gamepad bindings wired to the oracle', () => {
    expect(compactControllerSource).toContain(
      "(keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + gamepad.right",
    )
    expect(compactControllerSource).toContain(
      "(keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + gamepad.forward",
    )
    expect(compactControllerSource).toContain(
      "out.right = gamepad.axes[0] ?? 0",
    )
    expect(compactControllerSource).toContain(
      "out.forward = -(gamepad.axes[1] ?? 0)",
    )
    expect(compactControllerSource).toContain('applyRadialDeadZone(out)')

    expect(compactControllerSource).toContain(
      "keys.has('ShiftLeft')",
    )
    expect(compactControllerSource).toContain(
      "event.code === 'AltLeft'",
    )
    expect(compactControllerSource).toContain(
      "event.code === 'ControlLeft'",
    )
    expect(compactControllerSource).not.toContain("'ShiftRight'")
    expect(compactControllerSource).not.toContain("'AltRight'")
    expect(compactControllerSource).not.toContain("'ControlRight'")
    expect(compactControllerSource).toContain("toggleRotationModeKey: string | null = 'Digit1'")
    expect(compactControllerSource).toContain('event.code === toggleRotationModeKey')
    expect(compactControllerSource).toContain(
      'export const ALS_AIM_POINTER_BUTTONS: readonly number[] = [2]',
    )
    expect(compactControllerSource).toContain(
      'aimPointerButtons: readonly number[] = ALS_AIM_POINTER_BUTTONS',
    )
    expect(compactControllerSource).toContain(
      'if (aimPointerButtons.includes(event.button)) aimingWithPointer.current = true',
    )
    expect(compactControllerSource).toContain(
      'if (aimPointerButtons.includes(event.button)) aimingWithPointer.current = false',
    )

    for (const [action, button] of Object.entries({
      jump: 0, sprint: 1, roll: 1, ragdoll: 2, walk: 5, crouch: 10, aim: 4, rotationMode: 14,
    })) {
      expect(compactControllerSource).toContain(`${action}: ${button},`)
      expect(compactControllerSource).toContain(`out.${action} = readGamepadButton(gamepad, resolved.${action})`)
    }
    expect(compactControllerSource).toContain('if (!enabled) return out')
    expect(compactControllerSource).toContain('candidate.index === index')
  })

  it('implements Hold Sprint, Released Sprint, and Pressed toggles', () => {
    const sprintTriggers =
      extractedInput.actions.IA_Als_Sprint.triggers
    const holdProperties = sprintTriggers[0].serializedProperties
    const sprint = new FInputActionInstance([
      new UInputTriggerHold({
        HoldTimeThreshold: Number(
          holdProperties.HoldTimeThreshold,
        ),
        bIsOneShot: Boolean(holdProperties.bIsOneShot),
      }),
      new UInputTriggerReleased(),
    ])
    for (let frame = 1; frame <= 5; frame += 1) {
      expect(sprint.update(true, 1 / 60).triggerEvent)
        .not.toBe('Triggered')
    }
    expect(sprint.update(true, 1 / 60)).toMatchObject({
      triggerEvent: 'Triggered',
      value: true,
    })
    expect(sprint.update(false, 1 / 60)).toMatchObject({
      triggerEvent: 'Triggered',
      value: false,
    })

    const tapProperties =
      extractedInput.actions.IA_Als_Roll
        .triggers[0].serializedProperties
    const roll = new FInputActionInstance([
      new UInputTriggerTap({
        TapReleaseTimeThreshold: Number(
          tapProperties.TapReleaseTimeThreshold,
        ),
      }),
    ])
    roll.update(true, 1 / 60)
    expect(roll.update(false, 1 / 60).triggerEvent)
      .toBe('Triggered')

    const ragdoll = new FInputActionInstance([
      new UInputTriggerPressed(),
    ])
    expect(ragdoll.update(true, 1 / 60).triggerEvent)
      .toBe('Triggered')

    expect(compactControllerSource).toContain(
      'const sprintTick = sprintAction.current.update',
    )
    expect(compactControllerSource).toContain(
      'const rollTick = rollAction.current.update',
    )
    expect(compactControllerSource).toContain(
      'const ragdollTick = ragdollAction.current.update',
    )
    expect(compactControllerSource).toContain(
      'current.desiredStance = controls.desiredStance',
    )
    expect(compactControllerSource).toContain(
      'applyDesiredStance(current)',
    )
    for (const actionName of ['walk', 'crouch', 'rotationMode']) {
      expect(compactControllerSource).toContain(
        `gamepad.${actionName} && !previousGamepad.${actionName}`,
      )
    }
    expect(compactControllerSource).toContain(
      'controls.desiredAiming || aimingWithPointer.current || gamepad.aim',
    )
  })

  it('resolves gait selections through the extracted MS_Als_Normal speeds', () => {
    expect(extractedMovement.settings.nativeSpeedUnit).toBe('cm/s')
    for (const rotationMode of [
      'VelocityDirection',
      'ViewDirection',
      'Aiming',
    ] as const) {
      for (const stance of ['Standing', 'Crouching'] as const) {
        const source = extractedMovement.settings.rotationModes[
          `Als.RotationMode.${rotationMode}`
        ].stances[`Als.Stance.${stance}`]
        expect(resolveDesiredGaitSpeed(
          'Walking',
          stance,
          rotationMode,
        )).toBe(source.WalkForwardSpeed / 100)
        expect(resolveDesiredGaitSpeed(
          'Running',
          stance,
          rotationMode,
        )).toBe(source.RunForwardSpeed / 100)
        expect(resolveDesiredGaitSpeed(
          'Sprinting',
          stance,
          rotationMode,
        )).toBe(
          (
            stance === 'Standing'
              ? source.SprintSpeed
              : source.RunForwardSpeed
          ) / 100,
        )
      }
    }

    expect(compactControllerSource).toContain(
      'resolveDesiredGaitSpeed( desiredGait as AlsGait, desiredStance as AlsStance, desiredRotationMode as AlsRotationMode, )',
    )
  })
})


describe('consumer gamepad bindings', () => {
  it('preserves defaults, remaps buttons, disables actions, and selects a pad', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }))
    buttons[1] = { pressed: true, touched: true, value: 1 }
    buttons[6] = { pressed: true, touched: true, value: 1 }
    const pad = { index: 1, connected: true, axes: [1, 0], buttons }
    vi.stubGlobal('navigator', { getGamepads: () => [null, pad] })
    try {
      const out = { right: 0, forward: 0, jump: false, sprint: false, roll: false, ragdoll: false, walk: false, crouch: false, aim: false, rotationMode: false }
      expect(ALS_GAMEPAD_BINDINGS).toEqual({ jump: 0, sprint: 1, roll: 1, ragdoll: 2, walk: 5, crouch: 10, aim: 4, rotationMode: 14, shoulderSwap: 11, viewMode: 15 })
      expect(sampleGamepad(out)).toMatchObject({ roll: true, sprint: true, crouch: false, aim: false, right: 1 })
      expect(sampleGamepad(out, { sprint: null, crouch: 1, aim: 6 }, true, 1)).toMatchObject({ sprint: false, crouch: true, aim: true })
      expect(sampleGamepad(out, { sprint: null, roll: 1 }, true, 1)).toMatchObject({ sprint: false, roll: true })
      expect(sampleGamepad(out, { sprint: 1, roll: null }, true, 1)).toMatchObject({ sprint: true, roll: false })
      expect(sampleGamepad(out, { sprint: 6 }, true, 1)).toMatchObject({ sprint: true, roll: true })
      expect(sampleGamepad(out, { ragdoll: 1 }, true, 1)).toMatchObject({ ragdoll: true })
      expect(sampleGamepad(out, {}, false)).toMatchObject({ index: undefined, right: 0, sprint: false, roll: false, ragdoll: false, aim: false })
      expect(sampleGamepad(out, {}, true, 0)).toMatchObject({ index: undefined, right: 0, sprint: false, roll: false, ragdoll: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})


describe('multi-character browser input ownership', () => {
  it('samples the selected enabled pad once for normal and ragdoll actions', () => {
    expect(compactControllerSource.match(/sampleGamepad\(gamepadInput.current/g)).toHaveLength(1)
    expect(compactControllerSource).toContain('sampleGamepad(gamepadInput.current, gamepadBindings, inputEnabled && gamepadEnabled, gamepadIndex)')
    expect(compactControllerSource).toContain('const codeInput = inputSource?.()')
  })

  it('keeps keyboard roll independent of sprint permission and cancels stale pad taps', () => {
    expect(compactControllerSource).toContain("rollAction.current.update( inputEnabled && keys.has('ShiftLeft')")
    expect(compactControllerSource).toContain('if (!inputEnabled || !gamepadEnabled || gamepad.index === undefined')
    expect(compactControllerSource).toContain('rollContext.index !== gamepad.index')
    expect(compactControllerSource).toContain('rollContext.binding !== rollBinding')
    expect(compactControllerSource).toContain('rollContext.behavior !== gamepadRollBehavior')
    expect(compactControllerSource).toContain('gamepadDoubleTapAction.current.reset() gamepadTapAction.current.reset()')
    expect(compactControllerSource).toContain("gamepadRollBehavior === 'tap' && gamepad.roll")
    expect(compactControllerSource).toContain("gamepadRollBehavior === 'doubleTap' && gamepad.roll")
  })
})
