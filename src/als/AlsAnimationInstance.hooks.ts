import { useFrame } from '@react-three/fiber'
import { folder, useControls } from 'leva'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LEVA_ROOTS } from '../app/levaRoots'
import {
  createAlsAnimationInstance,
} from './AlsAnimationInstance'
import type { AlsAnimationInstanceControls } from './AlsAnimationInstance'
import { ALS_OVERLAY_MODES } from './AnimGraph/overlayMode'
import type { AlsOverlayMode } from './AnimGraph/overlayMode'
import {
  ALS_AUTHORED_GAIT_SPEEDS,
  ALS_GAITS,
  ALS_STANCES,
  resolveDesiredGaitSpeed,
} from './Settings/AlsMovementSettings'
import type { AlsGait, AlsStance } from './Settings/AlsMovementSettings'

/** Thin React/Leva binding for the framework-free AlsAnimationInstance frame brain. */
export function useAlsAnimationInstance(gltf: {
  animations: THREE.AnimationClip[]
  scene: THREE.Object3D
}) {
  const [{
    gait,
    moving,
    stance,
    overlayMode,
    speed,
    direction,
  }, setControls] = useControls(
    LEVA_ROOTS.movement,
    () => ({
      gait: {
        value: 'Running' as AlsGait,
        options: ALS_GAITS,
        label: 'Gait',
      },
      moving: {
        value: false,
        label: 'Moving',
      },
      stance: {
        value: 'Standing' as AlsStance,
        options: ALS_STANCES,
        label: 'Stance',
      },
      overlayMode: {
        value: 'Default' as AlsOverlayMode,
        options: ALS_OVERLAY_MODES,
        label: 'OverlayMode',
      },
      'Debug Overrides': folder({
        speed: {
          value: resolveDesiredGaitSpeed('Running', 'Standing'),
          min: 0,
          max: ALS_AUTHORED_GAIT_SPEEDS.standing.sprint,
          step: 0.05,
          label: 'speed (m/s)',
        },
        direction: {
          value: 0,
          min: -180,
          max: 180,
          step: 1,
          label: 'direction (deg)',
        },
      }, { collapsed: true }),
    }),
    { order: 1 },
  )
  const controls = useRef<AlsAnimationInstanceControls>({
    gait: gait as AlsGait,
    moving,
    stance: stance as AlsStance,
    overlayMode: overlayMode as AlsOverlayMode,
    speed,
    direction,
  })
  controls.current = {
    gait: gait as AlsGait,
    moving,
    stance: stance as AlsStance,
    overlayMode: overlayMode as AlsOverlayMode,
    speed,
    direction,
  }

  useEffect(() => {
    setControls({
      speed: resolveDesiredGaitSpeed(gait as AlsGait, stance as AlsStance),
    })
  }, [gait, stance, setControls])

  useEffect(() => {
    window.__setSpeed = (value: number) => setControls({
      speed: value,
      moving: value > 0,
    })
    window.__setGait = (value: AlsGait) => {
      if (ALS_GAITS.includes(value)) setControls({ gait: value })
    }
    window.__setStance = (value: AlsStance) => {
      if (ALS_STANCES.includes(value)) setControls({ stance: value })
    }
    window.__setOverlayMode = (value: AlsOverlayMode) => {
      if (ALS_OVERLAY_MODES.includes(value)) setControls({ overlayMode: value })
    }
    return () => {
      delete window.__setSpeed
      delete window.__setGait
      delete window.__setStance
      delete window.__setOverlayMode
    }
  }, [setControls])

  const animationInstance = useMemo(
    () => createAlsAnimationInstance(gltf),
    [gltf.animations, gltf.scene],
  )

  useEffect(() => {
    window.__playClip = animationInstance.playClip
    return () => {
      delete window.__playClip
      animationInstance.clearSoloClip()
    }
  }, [animationInstance])

  useFrame((_, delta) => {
    animationInstance.refresh(delta, controls.current)
  })
}
