import { describe, expect, it } from 'vitest'
import {
  FInputActionInstance,
  UInputTriggerHold,
  UInputTriggerPressed,
  UInputTriggerReleased,
  UInputTriggerTap,
  UInputTriggerDoubleTap,
  getTriggerStateChangeEvents,
  type ETriggerState,
  type FInputActionInstanceTick,
} from './InputTriggers'

function createSharedSprintRollActions() {
  return {
    sprint: new FInputActionInstance([
      new UInputTriggerHold({
        HoldTimeThreshold: 0.1,
        bIsOneShot: true,
      }),
      new UInputTriggerReleased(),
    ]),
    roll: new FInputActionInstance([
      new UInputTriggerTap({ TapReleaseTimeThreshold: 0.3 }),
    ]),
  }
}

function isPositiveTriggeredValue(tick: FInputActionInstanceTick) {
  return tick.triggerEvent === 'Triggered' && tick.value === true
}

describe('Unreal Enhanced Input trigger-state events', () => {
  it.each<[
    ETriggerState,
    ETriggerState,
    readonly string[],
  ]>([
    ['None', 'None', []],
    ['None', 'Ongoing', ['Started']],
    ['None', 'Triggered', ['Started', 'Triggered']],
    ['Ongoing', 'None', ['Canceled']],
    ['Ongoing', 'Ongoing', ['Ongoing']],
    ['Ongoing', 'Triggered', ['Triggered']],
    ['Triggered', 'None', ['Completed']],
    ['Triggered', 'Ongoing', ['Ongoing']],
    ['Triggered', 'Triggered', ['Triggered']],
  ])(
    'maps %s -> %s to %j',
    (lastState, state, events) => {
      expect(getTriggerStateChangeEvents(lastState, state)).toEqual(events)
    },
  )

  it('dispatches Started before Triggered for an instant Pressed action', () => {
    const action = new FInputActionInstance([new UInputTriggerPressed()])

    expect(action.update(true, 1 / 60)).toMatchObject({
      triggerState: 'Triggered',
      triggerEvent: 'Triggered',
      triggerEvents: ['Started', 'Triggered'],
      value: true,
    })
    expect(action.update(true, 1 / 60)).toMatchObject({
      triggerState: 'None',
      triggerEvent: 'Completed',
      value: false,
    })
    expect(action.update(false, 1 / 60).triggerEvent).toBe('None')
    expect(action.update(true, 1 / 60).triggerEvents).toEqual([
      'Started',
      'Triggered',
    ])
  })

  it('keeps Released ongoing while held, then triggers once with the released value', () => {
    const action = new FInputActionInstance([new UInputTriggerReleased()])

    expect(action.update(true, 1 / 60).triggerEvent).toBe('Started')
    expect(action.update(true, 1 / 60).triggerEvent).toBe('Ongoing')
    expect(action.update(false, 1 / 60)).toMatchObject({
      triggerState: 'Triggered',
      triggerEvent: 'Triggered',
      value: false,
    })
    expect(action.update(false, 1 / 60).triggerEvent).toBe('Completed')
  })
})

describe('UInputTriggerHold', () => {
  it('reaches 0.1 seconds on the sixth Unreal-float 60 Hz tick', () => {
    const hold = new UInputTriggerHold({
      HoldTimeThreshold: 0.1,
      bIsOneShot: true,
    })

    for (let tick = 0; tick < 5; tick++) {
      expect(hold.updateState(true, 1 / 60)).toBe('Ongoing')
    }
    expect(hold.updateState(true, 1 / 60)).toBe('Triggered')
  })

  it('uses an inclusive threshold, fires one shot, and rearms after release', () => {
    const hold = new UInputTriggerHold({
      HoldTimeThreshold: 0.1,
      bIsOneShot: true,
    })

    expect(hold.updateState(true, 0.099_999)).toBe('Ongoing')
    hold.reset()

    expect(hold.updateState(true, 0.1)).toBe('Triggered')
    expect(hold.updateState(true, 0.01)).toBe('None')
    expect(hold.updateState(false, 0.01)).toBe('None')
    expect(hold.updateState(true, 0.1)).toBe('Triggered')
  })

  it('cancels an action released before its hold threshold', () => {
    const action = new FInputActionInstance([
      new UInputTriggerHold({ HoldTimeThreshold: 0.1 }),
    ])

    expect(action.update(true, 0.05).triggerEvent).toBe('Started')
    expect(action.update(false, 0.05).triggerEvent).toBe('Canceled')
  })
})

describe('UInputTriggerTap', () => {
  it('triggers only when the stored held duration is strictly below the threshold', () => {
    const successful = new FInputActionInstance([
      new UInputTriggerTap({ TapReleaseTimeThreshold: 0.3 }),
    ])

    expect(successful.update(true, 0.299).triggerEvent).toBe('Started')
    expect(successful.update(false, 1 / 60)).toMatchObject({
      triggerState: 'Triggered',
      triggerEvent: 'Triggered',
      value: false,
    })

    const boundary = new FInputActionInstance([
      new UInputTriggerTap({ TapReleaseTimeThreshold: 0.3 }),
    ])

    expect(boundary.update(true, 0.15).triggerEvent).toBe('Started')
    expect(boundary.update(true, 0.15)).toMatchObject({
      triggerState: 'None',
      triggerEvent: 'Canceled',
    })
    expect(boundary.update(false, 1 / 60).triggerEvent).toBe('None')
  })

  it('reset clears the prior value and timer so the same instance can retrigger', () => {
    const action = new FInputActionInstance([
      new UInputTriggerTap({ TapReleaseTimeThreshold: 0.3 }),
    ])

    expect(action.update(true, 0.1).triggerEvent).toBe('Started')
    action.reset()
    expect(action.update(true, 0.1).triggerEvent).toBe('Started')
    expect(action.update(false, 1 / 60).triggerEvent).toBe('Triggered')
  })
})

describe('ALS shared Sprint and Roll input fixtures', () => {
  it('fires Roll on a quick tap without ever producing a positive Sprint value', () => {
    const { sprint, roll } = createSharedSprintRollActions()
    const sprintTicks = [
      sprint.update(true, 0.05),
      sprint.update(false, 0.05),
    ]
    const rollTicks = [
      roll.update(true, 0.05),
      roll.update(false, 0.05),
    ]

    expect(sprintTicks.some(isPositiveTriggeredValue)).toBe(false)
    // Hold + Released faithfully dispatches Sprint's release callback with a false value.
    expect(sprintTicks.at(-1)).toMatchObject({
      triggerEvent: 'Triggered',
      value: false,
    })
    expect(rollTicks.at(-1)?.triggerEvent).toBe('Triggered')
  })

  it('fires Sprint once at 0.1 seconds and never fires Roll after a long hold', () => {
    const { sprint, roll } = createSharedSprintRollActions()
    const sprintTicks = [
      sprint.update(true, 0.1),
      sprint.update(true, 0.2),
      sprint.update(true, 0.1),
      sprint.update(false, 1 / 60),
    ]
    const rollTicks = [
      roll.update(true, 0.1),
      roll.update(true, 0.2),
      roll.update(true, 0.1),
      roll.update(false, 1 / 60),
    ]

    expect(sprintTicks.filter(isPositiveTriggeredValue)).toHaveLength(1)
    expect(sprintTicks[0]).toMatchObject({
      triggerEvent: 'Triggered',
      value: true,
    })
    expect(sprintTicks.at(-1)).toMatchObject({
      triggerEvent: 'Triggered',
      value: false,
    })
    expect(rollTicks.some((tick) => tick.triggerEvent === 'Triggered')).toBe(
      false,
    )
    expect(rollTicks[1]?.triggerEvent).toBe('Canceled')
  })
})


describe('consumer double-tap roll', () => {
  function action() {
    return new FInputActionInstance([
      new UInputTriggerDoubleTap({ TapReleaseTimeThreshold: 0.3 }),
    ])
  }

  it('rolls once on the second short release and rearms for a new pair', () => {
    const roll = action()
    for (let pair = 0; pair < 2; pair++) {
      expect(roll.update(true, 0.05).triggerEvent).toBe('Started')
      expect(roll.update(false, 0.05).triggerEvents).not.toContain('Triggered')
      roll.update(false, 0.05)
      expect(roll.update(true, 0.05).triggerEvents).not.toContain('Triggered')
      expect(roll.update(false, 0.05).triggerEvents).toContain('Triggered')
      roll.update(false, 0.05)
    }
  })

  it('rejects nearby releases when the consecutive presses are too far apart', () => {
    const roll = action()
    roll.update(true, 0.2)
    roll.update(true, 0.05)
    roll.update(false, 0.05)
    roll.update(false, 0.15)
    roll.update(true, 0.05)
    expect(roll.update(false, 0.05).triggerEvents).not.toContain('Triggered')
    // The rejected second press becomes the first press of the next pair.
    roll.update(true, 0.05)
    expect(roll.update(false, 0.05).triggerEvents).toContain('Triggered')
  })

  it.each([0.299, 0.3, 0.301])('uses a strict press interval at %s seconds', (interval) => {
    const roll = action()
    roll.update(true, 0.01)
    roll.update(false, 0)
    roll.update(false, interval)
    roll.update(true, 0)
    expect(roll.update(false, 0.01).triggerEvents.includes('Triggered')).toBe(interval < 0.3)
  })

  it.each([1, 2])('rejects a long hold on tap %s', (longTap) => {
    const roll = action()
    roll.update(true, longTap === 1 ? 0.3 : 0.05)
    roll.update(false, 0.01)
    roll.update(true, longTap === 2 ? 0.3 : 0.05)
    expect(roll.update(false, 0.01).triggerEvents).not.toContain('Triggered')
  })

  it('reset cancels a pending pair instead of interpreting disabling input as a release', () => {
    const roll = action()
    roll.update(true, 0.05)
    roll.update(false, 0.05)
    roll.update(true, 0.05)
    roll.reset()
    expect(roll.update(false, 0.05).triggerEvents).not.toContain('Triggered')
    roll.update(true, 0.05)
    expect(roll.update(false, 0.05).triggerEvents).not.toContain('Triggered')
  })
})
