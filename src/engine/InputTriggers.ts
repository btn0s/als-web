export type FInputActionValue = boolean | number

export type ETriggerState = 'None' | 'Ongoing' | 'Triggered'

export type ETriggerEvent =
  | 'None'
  | 'Triggered'
  | 'Started'
  | 'Ongoing'
  | 'Canceled'
  | 'Completed'

export type ETriggerType = 'Explicit' | 'Implicit' | 'Blocker'

export interface UInputTriggerOptions {
  ActuationThreshold?: number
}

function getMagnitudeSquared(value: FInputActionValue) {
  const scalar = typeof value === 'boolean' ? Number(value) : value
  return scalar * scalar
}

function getZeroValue(value: FInputActionValue): FInputActionValue {
  return typeof value === 'boolean' ? false : 0
}

/**
 * UE `UInputTrigger`.
 *
 * `updateState()` also performs the `FTriggerStateTracker` bookkeeping that copies the current
 * modified value into `LastValue` after evaluation.
 */
export abstract class UInputTrigger {
  ActuationThreshold: number
  LastValue: FInputActionValue = false

  constructor(options: UInputTriggerOptions = {}) {
    this.ActuationThreshold = Math.fround(
      options.ActuationThreshold ?? 0.5,
    )
  }

  isActuated(value: FInputActionValue) {
    return getMagnitudeSquared(value)
      >= this.ActuationThreshold * this.ActuationThreshold
  }

  getTriggerType(): ETriggerType {
    return 'Explicit'
  }

  isBlocking(state: ETriggerState) {
    void state
    return false
  }

  updateState(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState {
    const state = this.updateStateImplementation(modifiedValue, deltaTime)
    this.LastValue = modifiedValue
    return state
  }

  reset() {
    this.LastValue = false
    this.resetState()
  }

  protected resetState() {}

  protected abstract updateStateImplementation(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState
}

/**
 * UE `UInputTriggerTimedBase`. The ALS-authored timed triggers retain Unreal's default
 * `bAffectedByTimeDilation = false`, so their clock advances directly by the fixed-step delta.
 */
export abstract class UInputTriggerTimedBase extends UInputTrigger {
  HeldDuration = 0

  protected override updateStateImplementation(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState {
    if (this.isActuated(modifiedValue)) {
      // Both operands and the stored result are `float` in Unreal. Retaining that precision is
      // observable at authored thresholds such as six 60 Hz ticks reaching 0.1 seconds.
      this.HeldDuration = Math.fround(
        this.HeldDuration + Math.fround(deltaTime),
      )
      return 'Ongoing'
    }

    this.HeldDuration = 0
    return 'None'
  }

  protected override resetState() {
    this.HeldDuration = 0
  }
}

/** UE `UInputTriggerPressed`. */
export class UInputTriggerPressed extends UInputTrigger {
  protected override updateStateImplementation(
    modifiedValue: FInputActionValue,
    _deltaTime: number,
  ): ETriggerState {
    return this.isActuated(modifiedValue) && !this.isActuated(this.LastValue)
      ? 'Triggered'
      : 'None'
  }
}

/** UE `UInputTriggerReleased`. */
export class UInputTriggerReleased extends UInputTrigger {
  protected override updateStateImplementation(
    modifiedValue: FInputActionValue,
    _deltaTime: number,
  ): ETriggerState {
    if (this.isActuated(modifiedValue)) return 'Ongoing'
    return this.isActuated(this.LastValue) ? 'Triggered' : 'None'
  }
}

export interface UInputTriggerHoldOptions extends UInputTriggerOptions {
  HoldTimeThreshold?: number
  bIsOneShot?: boolean
}

/** UE `UInputTriggerHold`. */
export class UInputTriggerHold extends UInputTriggerTimedBase {
  HoldTimeThreshold: number
  bIsOneShot: boolean

  private bTriggered = false

  constructor(options: UInputTriggerHoldOptions = {}) {
    super(options)
    this.HoldTimeThreshold = Math.fround(options.HoldTimeThreshold ?? 1)
    this.bIsOneShot = options.bIsOneShot ?? false
  }

  protected override updateStateImplementation(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState {
    const state = super.updateStateImplementation(modifiedValue, deltaTime)
    const isFirstTrigger = !this.bTriggered

    // Unreal's hold boundary is inclusive.
    this.bTriggered = this.HeldDuration >= this.HoldTimeThreshold
    if (this.bTriggered) {
      return isFirstTrigger || !this.bIsOneShot ? 'Triggered' : 'None'
    }

    return state
  }

  protected override resetState() {
    super.resetState()
    this.bTriggered = false
  }
}

export interface UInputTriggerTapOptions extends UInputTriggerOptions {
  TapReleaseTimeThreshold?: number
}

/** UE `UInputTriggerTap`. */
export class UInputTriggerTap extends UInputTriggerTimedBase {
  TapReleaseTimeThreshold: number

  constructor(options: UInputTriggerTapOptions = {}) {
    super(options)
    this.TapReleaseTimeThreshold = Math.fround(
      options.TapReleaseTimeThreshold ?? 0.2,
    )
  }

  protected override updateStateImplementation(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState {
    const lastHeldDuration = this.HeldDuration
    let state = super.updateStateImplementation(modifiedValue, deltaTime)

    // Unreal samples LastHeldDuration before the release frame resets the timed base. A tap is
    // intentionally strict at the boundary: release succeeds only below the threshold.
    if (
      this.isActuated(this.LastValue)
      && state === 'None'
      && lastHeldDuration < this.TapReleaseTimeThreshold
    ) {
      state = 'Triggered'
    } else if (this.HeldDuration >= this.TapReleaseTimeThreshold) {
      state = 'None'
    }

    return state
  }
}

/**
 * UE `FTriggerStateTracker` for the native trigger kinds currently required by ALS.
 *
 * All four native triggers above are explicit, but retaining the tracker rules here keeps
 * multi-trigger actions such as Hold + Released faithful and leaves the engine seam ready for
 * implicit and blocker triggers.
 */
export class FTriggerStateTracker {
  evaluateTriggers(
    triggers: readonly UInputTrigger[],
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): ETriggerState {
    if (triggers.length === 0) {
      return getMagnitudeSquared(modifiedValue) > 0 ? 'Triggered' : 'None'
    }

    let foundActiveTrigger = false
    let anyExplicitTriggered = false
    let foundExplicit = false
    let allImplicitsTriggered = true
    let blocking = false

    // No early exit: every trigger must advance its private duration and previous-value state.
    for (const trigger of triggers) {
      const state = trigger.updateState(modifiedValue, deltaTime)

      switch (trigger.getTriggerType()) {
        case 'Explicit':
          foundExplicit = true
          anyExplicitTriggered ||= state === 'Triggered'
          foundActiveTrigger ||= state !== 'None'
          break
        case 'Implicit':
          allImplicitsTriggered &&= state === 'Triggered'
          foundActiveTrigger ||= state !== 'None'
          break
        case 'Blocker':
          break
      }

      blocking ||= trigger.isBlocking(state)
    }

    if (blocking) return 'None'

    const triggered = (!foundExplicit || anyExplicitTriggered)
      && allImplicitsTriggered
    return triggered
      ? 'Triggered'
      : foundActiveTrigger
        ? 'Ongoing'
        : 'None'
  }
}

export interface FInputActionInstanceTick {
  triggerState: ETriggerState
  triggerEvent: ETriggerEvent
  /**
   * Events dispatched to bindings this tick. A direct None -> Triggered transition dispatches
   * Started first and Triggered second even though `triggerEvent` remains Triggered.
   */
  triggerEvents: readonly ETriggerEvent[]
  /** UE `FInputActionInstance::GetValue()`: zero unless the action event is Triggered. */
  value: FInputActionValue
  modifiedValue: FInputActionValue
}

export function getTriggerStateChangeEvents(
  lastState: ETriggerState,
  state: ETriggerState,
): readonly ETriggerEvent[] {
  if (lastState === 'None') {
    if (state === 'Ongoing') return ['Started']
    if (state === 'Triggered') return ['Started', 'Triggered']
    return []
  }

  if (lastState === 'Ongoing') {
    if (state === 'None') return ['Canceled']
    if (state === 'Ongoing') return ['Ongoing']
    return ['Triggered']
  }

  if (state === 'None') return ['Completed']
  if (state === 'Ongoing') return ['Ongoing']
  return ['Triggered']
}

/**
 * The trigger and event portion of UE `FInputActionInstance`.
 *
 * One instance owns one independent set of trigger objects. Feed the same keyboard/gamepad value
 * to multiple instances when Unreal maps a shared key to multiple input actions.
 */
export class FInputActionInstance {
  readonly Triggers: readonly UInputTrigger[]

  private lastTriggerState: ETriggerState = 'None'
  private readonly tracker = new FTriggerStateTracker()

  constructor(triggers: readonly UInputTrigger[]) {
    this.Triggers = triggers
  }

  update(
    modifiedValue: FInputActionValue,
    deltaTime: number,
  ): FInputActionInstanceTick {
    const triggerState = this.tracker.evaluateTriggers(
      this.Triggers,
      modifiedValue,
      deltaTime,
    )
    const triggerEvents = getTriggerStateChangeEvents(
      this.lastTriggerState,
      triggerState,
    )
    const triggerEvent = triggerEvents.at(-1) ?? 'None'

    this.lastTriggerState = triggerState

    return {
      triggerState,
      triggerEvent,
      triggerEvents,
      value: triggerEvent === 'Triggered'
        ? modifiedValue
        : getZeroValue(modifiedValue),
      modifiedValue,
    }
  }

  reset() {
    for (const trigger of this.Triggers) trigger.reset()
    this.lastTriggerState = 'None'
  }
}
