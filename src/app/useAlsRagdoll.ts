import { getWorldDeltaTime, type WorldTimeState } from '../engine/timeDilation'
import { useEffect, useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useBeforePhysicsStep, useAfterPhysicsStep, useRapier } from '@react-three/rapier'
import type { RapierCollider, RapierRigidBody } from '@react-three/rapier'
import type { AlsCharacter } from '../als/AlsCharacter'
import type { AlsAnimationInstance } from '../als/AlsAnimationInstance'
import { createAlsRagdollRuntime } from '../engine/alsRagdollRuntime'
import type { AlsRagdollHandle } from '../engine/rapierAlsRagdoll'
import { ALS_CAPSULE_RADIUS, ALS_STANDING_CAPSULE_HALF_HEIGHT, getAlsCapsuleHalfHeight } from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'

export function useAlsRagdoll(character: AlsCharacter, animation: AlsAnimationInstance,
  owner: RefObject<RapierRigidBody | null>, standing: RefObject<RapierCollider | null>,
  crouching: RefObject<RapierCollider | null>, output?: RefObject<AlsRagdollHandle | null>, worldTime?: Readonly<WorldTimeState>) {
  const { world } = useRapier()
  const runtime = useMemo(() => createAlsRagdollRuntime({ world, character, animation,
    owner: () => owner.current, colliders: () => [standing.current, crouching.current],
    radius: ALS_CAPSULE_RADIUS, ownerAnchorHalfHeight: ALS_STANDING_CAPSULE_HALF_HEIGHT, halfHeight: () => getAlsCapsuleHalfHeight(character.stance),
  }), [world, character, animation, owner, standing, crouching])
  useEffect(() => {
    if (output) output.current = runtime.handle
    return () => { if (output) output.current = null; runtime.dispose() }
  }, [runtime, output])
  useBeforePhysicsStep(world => runtime.beforePhysics(world.timestep))
  useAfterPhysicsStep(world => runtime.afterPhysics(world.timestep))
  useFrame((_, dt) => runtime.refresh(worldTime ? getWorldDeltaTime(worldTime, dt) : dt), ALS_FRAME_PRIORITY.Character + .1)
  return runtime.handle
}
