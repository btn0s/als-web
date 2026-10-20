import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import {
  B_Als_PlayerController,
} from '../als/ALSExtras/Core/B_Als_PlayerController'
import {
  L_Als_GridFloor,
  L_Als_GridFloorCollision,
  L_Als_GridSkyLight,
  L_Als_GridSkySphere,
} from '../als/ALSExtras/Levels/L_Als_Grid'
import {
  W_Als_OverlayModeMenuAnchor,
} from '../als/ALSExtras/UI/W_Als_OverlayModeMenu'
import {
  ALS_PHYSICS_TIMESTEP,
  ALS_RAPIER_GRAVITY,
} from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { AlsPhysicsStepper } from './AlsPhysicsStepper'
import {
  AlsFootstepAudioRuntime,
} from '../engine/alsAudioBridge'
import {
  createWorldTimeState,
  getWorldDeltaTime,
  setGlobalTimeDilation,
} from '../engine/timeDilation'
import type { WorldTimeState } from '../engine/timeDilation'
import { createCharacterPoseSample } from './CharacterPoseSample'
import { AlsCamera } from './AlsCamera'
import { AlsMantlingObstacleCourse } from './AlsMantlingObstacleCourse'
import { Character } from './Character'
import { AlsGhostDemo } from './AlsGhostDemo'
import type { AlsOverlayModeBridge } from './Character'
import { FramePerformanceMonitor } from './FramePerformanceMonitor'
import { PostProcessing } from './PostProcessing'
import './App.css'

function SceneReady() {
  useEffect(() => {
    window.__appReady = true
  }, [])

  return null
}

interface SceneProps {
  readonly onOverlayModeBridgeChange: (
    bridge: AlsOverlayModeBridge | null,
  ) => void
  readonly overlayModeMenuElement:
    RefObject<HTMLDivElement | null>
  readonly worldTime: Readonly<WorldTimeState>
  readonly footstepAudioRuntime: AlsFootstepAudioRuntime
}

function Scene({
  onOverlayModeBridgeChange,
  overlayModeMenuElement,
  worldTime,
  footstepAudioRuntime,
}: SceneProps) {
  const CharacterComponent = new URLSearchParams(window.location.search).has('ghost')
    ? AlsGhostDemo : Character
  const [, setCharacterSize] = useState(() => new THREE.Vector3())
  const poseSample = useRef(createCharacterPoseSample())
  return (
    <>
      <L_Als_GridSkySphere />
      <L_Als_GridSkyLight />

      <Suspense fallback={null}>
        <Physics
          colliders={false}
          gravity={[0, -ALS_RAPIER_GRAVITY, 0]}
          paused
          timeStep={ALS_PHYSICS_TIMESTEP}
          updatePriority={ALS_FRAME_PRIORITY.Physics}
        >
          <AlsPhysicsStepper
            getDeltaTime={delta => getWorldDeltaTime(worldTime, delta)}
          />
          <CharacterComponent
            onSizeChange={setCharacterSize}
            poseSample={poseSample}
            worldTime={worldTime}
            onOverlayModeBridgeChange={
              onOverlayModeBridgeChange
            }
            footstepSoundSink={footstepAudioRuntime}
          />
          <L_Als_GridFloorCollision />
          <AlsMantlingObstacleCourse />
          <AlsCamera
            poseSample={poseSample}
            worldTime={worldTime}
            footstepAudioRuntime={footstepAudioRuntime}
          />
        </Physics>
      </Suspense>

      <L_Als_GridFloor />
      <PostProcessing />
      <FramePerformanceMonitor />
      <W_Als_OverlayModeMenuAnchor
        Element={overlayModeMenuElement}
        Pose={poseSample}
      />
      <SceneReady />
    </>
  )
}

function App() {
  const [canvasElement, setCanvasElement] =
    useState<HTMLCanvasElement | null>(null)
  const [
    effectiveGlobalTimeDilation,
    setEffectiveGlobalTimeDilation,
  ] = useState(1)
  const [overlayModeBridge, setOverlayModeBridge] =
    useState<AlsOverlayModeBridge | null>(null)
  const overlayModeMenuElement =
    useRef<HTMLDivElement>(null)
  const worldTime = useMemo(createWorldTimeState, [])
  const footstepAudioEffectGeneration = useRef(0)
  const footstepAudioRuntime = useMemo(
    () => new AlsFootstepAudioRuntime({
      AutoInstallUserGestureUnlock: false,
      OnError(error) {
        console.warn(
          `[ALS Audio] ${error.Phase}`,
          error.WaveAssetName ?? '',
          error.Cause,
        )
      },
    }),
    [],
  )
  const SetGlobalTimeDilation = useCallback((
    TimeDilation: number,
  ) => {
    setGlobalTimeDilation(worldTime, TimeDilation)
    setEffectiveGlobalTimeDilation(TimeDilation)
  }, [worldTime])
  useEffect(() => {
    window.__effectiveGlobalTimeDilation =
      effectiveGlobalTimeDilation
    return () => {
      delete window.__effectiveGlobalTimeDilation
    }
  }, [effectiveGlobalTimeDilation])
  useEffect(() => {
    const generation = ++footstepAudioEffectGeneration.current
    footstepAudioRuntime.InstallUserGestureUnlock()
    return () => {
      footstepAudioRuntime.RemoveUserGestureUnlock()
      // StrictMode immediately replays this effect in development. Defer terminal disposal so
      // that replay can retain the render-owned runtime; a real unmount has no newer generation
      // and still closes its AudioContext and nodes in the microtask.
      queueMicrotask(() => {
        // The latest value is the StrictMode replay guard; capturing it would defeat the check.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        if (footstepAudioEffectGeneration.current === generation) {
          void footstepAudioRuntime.Dispose()
        }
      })
    }
  }, [footstepAudioRuntime])

  return (
    <main className="app-shell">
      <Canvas
        camera={{ fov: 42 }}
        gl={{
          antialias: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
        onCreated={({ gl }) => {
          setCanvasElement(gl.domElement)
        }}
        shadows="soft"
      >
        <Scene
          onOverlayModeBridgeChange={setOverlayModeBridge}
          overlayModeMenuElement={overlayModeMenuElement}
          worldTime={worldTime}
          footstepAudioRuntime={footstepAudioRuntime}
        />
      </Canvas>
      <B_Als_PlayerController
        CanvasElement={canvasElement}
        OverlayMode={
          overlayModeBridge?.overlayMode ?? 'Default'
        }
        OverlayModeMenuElement={overlayModeMenuElement}
        SetGlobalTimeDilation={SetGlobalTimeDilation}
        SetOverlayMode={overlayModeBridge?.SetOverlayMode}
      />
    </main>
  )
}

export default App
