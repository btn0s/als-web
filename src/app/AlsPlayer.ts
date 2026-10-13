import { createCharacterPoseSample, type CharacterPoseSample } from './CharacterPoseSample'
import type { AlsOverlayMode } from '../als/AnimGraph/overlayMode'

/** Controller-level input, consumed by the existing ALS character on its fixed physics tick. */
export interface AlsPlayerCommand {
  /** False cancels unconsumed input edges as well as held movement/aim. Physics still runs. */
  active: boolean
  right: number
  forward: number
  sprint: boolean
  crouch: boolean
  aim: boolean
  /** Increment once per press. An edge is consumed at most once across physics substeps. */
  jumpSequence: number
  /** Incremented by ragdoll(); consumed even when ordinary input is inactive. */
  ragdollSequence: number
  /** ALS/Unreal degrees: +X forward, positive yaw turns right, positive pitch looks up. */
  yaw: number
  pitch: number
  view: 'FirstPerson' | 'ThirdPerson'
  overlay: AlsOverlayMode
  bodyVisible: boolean
}

/** One controller, one ALS character, one capsule. This bridge never owns a second simulation. */
export interface AlsPlayer {
  readonly command: AlsPlayerCommand
  readonly pose: { current: CharacterPoseSample }
  readonly spawn: readonly [number, number, number]
  /** Request the existing ALS ragdoll lifecycle on the next physics tick. */
  ragdoll(): void
  /** Recreates this player's character/capsule in the same Physics world, clearing all actions. */
  respawn(position?: readonly [number, number, number]): void
  subscribe(listener: () => void): () => void
  getRevision(): number
}

export function createAlsPlayer(options: { spawn?: readonly [number, number, number] } = {}): AlsPlayer {
  let spawn: readonly [number, number, number] = options.spawn ?? [0, 0, 0]
  if (!spawn.every(Number.isFinite)) throw new Error('ALS spawn position must be finite')
  let revision = 0
  const listeners = new Set<() => void>()
  const player: AlsPlayer = {
    command: {
      active: true, right: 0, forward: 0, sprint: false, crouch: false, aim: false, jumpSequence: 0, ragdollSequence: 0,
      yaw: 0, pitch: 0, view: 'ThirdPerson', overlay: 'Default', bodyVisible: true,
    },
    pose: { current: createCharacterPoseSample() },
    // Ground position; the character adapter adds its standing half height.
    get spawn() { return spawn },
    ragdoll() { player.command.ragdollSequence++ },
    respawn(position = spawn) {
      if (!position.every(Number.isFinite)) throw new Error('ALS spawn position must be finite')
      spawn = [...position]
      player.command.forward = player.command.right = 0
      player.command.sprint = player.command.crouch = player.command.aim = false
      player.command.ragdollSequence = 0
      player.pose.current = createCharacterPoseSample()
      revision++
      for (const listener of listeners) listener()
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getRevision() { return revision },
  }
  return player
}
