/**
 * USkinnedMeshComponent update rate optimization (FAnimUpdateRateParameters): the pose is
 * evaluated every `interval` frames from the mesh's significance (EvaluationRate). The graph
 * update (clocks, state machines, notifies) has two outputs: timed events for their listeners,
 * and state for the next evaluation. A character whose events are heard updates every frame
 * (UpdateRate 1), so a footstep lands on the frame its notify is crossed; one whose events
 * nobody hears updates only when it evaluates, carrying the skipped time, because the next
 * evaluation is the only reader. Actions pass `critical` to tick every frame because their root
 * motion comes from the evaluated pose.
 */
export interface AlsAnimationLod {
  distance?: number
  /** The camera can see the mesh itself. */
  visible?: boolean
  /** Hidden from the camera but casting a shadow it can see (bOwnerNoSee with bCastHiddenShadow). */
  shadow?: boolean
  focused?: boolean
  minInterval?: number
  maxInterval?: number
}

export function selectAlsAnimationInterval(significance: AlsAnimationLod): number {
  if (significance.focused) return 1
  const distance = significance.distance ?? 0
  const interval = significance.visible === false ? significance.shadow ? 3 : 8
    : distance < 12 ? 1 : distance < 20 ? 2 : distance < 34 ? 3 : 4
  const minimum = Math.max(1, Math.floor(significance.minInterval ?? 1))
  const maximum = Math.max(1, Math.floor(significance.maxInterval ?? 8))
  return Math.max(1, Math.min(Math.max(minimum, interval), maximum))
}

export type AlsAnimationLodSource = AlsAnimationLod | (() => AlsAnimationLod)

export function resolveAlsAnimationLod(source: AlsAnimationLodSource | undefined): AlsAnimationLod | undefined {
  return typeof source === 'function' ? source() : source
}

let nextPhase = 0

export interface AlsAnimationTick {
  update: boolean
  evaluate: boolean
  delta: number
}

export class AlsAnimationUpdateRate {
  private frame = 0
  private pending = 0
  private started = false
  private readonly tick: AlsAnimationTick = { update: false, evaluate: false, delta: 0 }
  readonly phase: number

  constructor(phase = nextPhase++) {
    this.phase = phase
  }

  next(delta: number, significance: AlsAnimationLod | undefined, critical: boolean, heard: boolean): AlsAnimationTick {
    const interval = significance && !critical ? selectAlsAnimationInterval(significance) : 1
    const evaluate = !this.started || interval === 1 || (this.frame + this.phase) % interval === 0
    this.frame++
    this.pending += Math.max(0, delta)
    const tick = this.tick
    tick.evaluate = evaluate
    tick.update = evaluate || heard
    tick.delta = 0
    if (!tick.update) return tick
    if (evaluate) this.started = true
    tick.delta = this.pending
    this.pending = 0
    return tick
  }

  reset() {
    this.pending = 0
    this.started = false
  }
}
