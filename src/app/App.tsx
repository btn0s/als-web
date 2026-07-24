import { Canvas } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import {
  CuboidCollider,
  Physics,
  RigidBody,
} from '@react-three/rapier'
import { Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ALS_PHYSICS_TIMESTEP } from '../als/AlsCharacter.hooks'
import { AlsCameraComponent } from '../als/AlsCamera/AlsCameraComponent'
import { createCharacterPoseSample } from '../als/AlsCamera/poseCameraState'
import { Character } from './Character'
import { PostProcessing } from './PostProcessing'
import './App.css'

const DEFAULT_CHARACTER_SIZE = new THREE.Vector3(0.7, 1.9, 0.7)

function SceneReady() {
  useEffect(() => {
    window.__appReady = true
  }, [])

  return null
}

function Scene() {
  const [characterSize, setCharacterSize] = useState(() => DEFAULT_CHARACTER_SIZE.clone())
  const poseSample = useRef(createCharacterPoseSample())
  const gridSize = Math.max(20, characterSize.length() * 3)

  return (
    <>
      <color attach="background" args={['#18202b']} />
      <hemisphereLight args={['#c8ddff', '#202633', 1.1]} />
      <directionalLight
        castShadow
        color="#fff1db"
        intensity={3.2}
        position={[4.5, 7.5, 5]}
        shadow-bias={-0.0001}
        shadow-normalBias={0.025}
        shadow-radius={4}
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight color="#9abfff" intensity={1.15} position={[-4, 3.5, 2]} />

      <Suspense fallback={null}>
        <Physics
          colliders={false}
          gravity={[0, -9.81, 0]}
          timeStep={ALS_PHYSICS_TIMESTEP}
        >
          <Character onSizeChange={setCharacterSize} poseSample={poseSample} />
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider
              args={[gridSize / 2, 0.05, gridSize / 2]}
              position={[0, -0.05, 0]}
              friction={0}
            />
          </RigidBody>
        </Physics>
      </Suspense>

      <Grid
        args={[gridSize, gridSize]}
        cellColor="#354253"
        cellSize={gridSize / 40}
        fadeDistance={gridSize * 0.7}
        fadeStrength={1}
        sectionColor="#68809d"
        sectionSize={gridSize / 8}
      />
      <AlsCameraComponent characterSize={characterSize} poseSample={poseSample} />
      <PostProcessing />
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
          toneMappingExposure: 1.05,
        }}
        shadows="soft"
      >
        <Scene />
      </Canvas>
    </main>
  )
}

export default App
