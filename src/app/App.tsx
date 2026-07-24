import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  L_Als_GridFloor,
  L_Als_GridFloorCollision,
  L_Als_GridSkyLight,
  L_Als_GridSkySphere,
} from '../als/ALSExtras/Levels/L_Als_Grid'
import {
  ALS_PHYSICS_TIMESTEP,
  ALS_RAPIER_GRAVITY,
} from '../als/AlsCharacter.hooks'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { createCharacterPoseSample } from './CharacterPoseSample'
import { AlsCamera } from './AlsCamera'
import { Character } from './Character'
import { FramePerformanceMonitor } from './FramePerformanceMonitor'
import { PostProcessing } from './PostProcessing'
import './App.css'

function SceneReady() {
  useEffect(() => {
    window.__appReady = true
  }, [])

  return null
}

function Scene() {
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
          timeStep={ALS_PHYSICS_TIMESTEP}
          updatePriority={ALS_FRAME_PRIORITY.Physics}
        >
          <Character onSizeChange={setCharacterSize} poseSample={poseSample} />
          <L_Als_GridFloorCollision />
          <AlsCamera poseSample={poseSample} />
        </Physics>
      </Suspense>

      <L_Als_GridFloor />
      <PostProcessing />
      <FramePerformanceMonitor />
      <SceneReady />
    </>
  )
}

function App() {
  return (
    <main className="app-shell">
      <Canvas
        camera={{ fov: 42 }}
        gl={{
          antialias: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
        shadows="soft"
      >
        <Scene />
      </Canvas>
    </main>
  )
}

export default App
