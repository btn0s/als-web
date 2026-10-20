import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { ALS_PHYSICS_TIMESTEP } from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'

export const ALS_MAX_PHYSICS_STEPS_PER_FRAME = 2

export function clampAlsPhysicsDelta(delta: number): number {
  return Math.min(
    Math.max(0, delta),
    ALS_PHYSICS_TIMESTEP * ALS_MAX_PHYSICS_STEPS_PER_FRAME,
  )
}

export function AlsPhysicsStepper({
  getDeltaTime = delta => delta,
}: {
  getDeltaTime?: (delta: number) => number
}) {
  const { step } = useRapier()

  useFrame((_, delta) => {
    step(clampAlsPhysicsDelta(getDeltaTime(delta)))
  }, ALS_FRAME_PRIORITY.Physics)

  return null
}
