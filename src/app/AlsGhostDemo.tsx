import { useCallback, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { Character, type CharacterProps } from './Character'
import { AlsRemoteActor } from './AlsRemoteActor'
import { AlsSnapshotBuffer } from '../als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from '../als/AlsCharacterSnapshot'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'

function parameter(name: string, fallback: number, min: number, max: number) {
  const value = new URLSearchParams(window.location.search).get(name)
  const number = value === null ? fallback : Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

/** ?ghost&ghostDelay=125&ghostRate=20&ghostJitter=35&ghostLoss=0.1&ghostLatency=30
 * Leva Ghost controls update live. Offset is world-space, so an offset ghost can stand over
 * different terrain: disable its foot traces when comparing upper-body/mantle poses there.
 * Transport simulation is intentionally just a bounded packet queue, not a second game loop.
 */
export function AlsGhostDemo(props: CharacterProps) {
  const { onSnapshot } = props
  const options = useControls('Ghost', {
    delayMs: { value: parameter('ghostDelay', 125, 0, 1000), min: 0, max: 1000, step: 5 },
    rateHz: { value: parameter('ghostRate', 20, 1, 60), min: 1, max: 60, step: 1 },
    latencyMs: { value: parameter('ghostLatency', 30, 0, 500), min: 0, max: 500, step: 5 },
    jitterMs: { value: parameter('ghostJitter', 0, 0, 500), min: 0, max: 500, step: 5 },
    packetLoss: { value: parameter('ghostLoss', 0, 0, 1), min: 0, max: 1, step: 0.01 },
    offsetX: { value: 2.5, min: -10, max: 10, step: 0.1 },
    offsetZ: { value: 0, min: -10, max: 10, step: 0.1 },
    footIk: true,
  })
  const transport = useMemo(() => ({
    snapshots: new AlsSnapshotBuffer({ interpolationDelayMs: options.delayMs }),
    pending: [] as { at: number; snapshot: AlsCharacterSnapshot }[],
    // Changing rate restarts the recorder's sequence domain, so restart the receiving actor too.
    rateHz: options.rateHz,
  }), [options.delayMs, options.rateHz])
  const record = useCallback((snapshot: AlsCharacterSnapshot) => {
    onSnapshot?.(snapshot)
    if (Math.random() < options.packetLoss) return
    transport.pending.push({
      at: performance.now() + Math.max(0, options.latencyMs + (Math.random() * 2 - 1) * options.jitterMs),
      snapshot,
    })
    if (transport.pending.length > 512) transport.pending.shift()
  }, [onSnapshot, options.packetLoss, options.latencyMs, options.jitterMs, transport])
  useFrame(() => {
    const now = performance.now()
    // Arrival order can differ from sample order. The actual receiver handles ordering.
    transport.pending.sort((a, b) => a.at - b.at)
    while (transport.pending[0]?.at <= now) {
      transport.snapshots.push(transport.pending.shift()!.snapshot)
    }
  }, ALS_FRAME_PRIORITY.ControlRotation)
  return <>
    <Character {...props} onSnapshot={record} snapshotRateHz={options.rateHz} />
    <AlsRemoteActor key={`${options.delayMs}:${options.rateHz}`} snapshots={transport.snapshots}
      worldTime={props.worldTime}
      offset={[options.offsetX, 0, options.offsetZ]} footIk={options.footIk} />
  </>
}
