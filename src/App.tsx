import { Canvas } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Character } from './scene/Character'
import { PoseOrbitCamera } from './scene/PoseOrbitCamera'
import { createCharacterPoseSample } from './scene/poseCameraState'
import './App.css'

const PLACEHOLDER_SIZE = new THREE.Vector3(0.7, 1.9, 0.7)

function SceneReady() {
  useEffect(() => {
    window.__appReady = true
  }, [])

  return null
}

function Scene() {
  const [characterSize, setCharacterSize] = useState(() => PLACEHOLDER_SIZE.clone())
  const poseSample = useRef(createCharacterPoseSample())
  const gridSize = Math.max(20, characterSize.length() * 3)

  return (
    <>
      <color attach="background" args={['#10141b']} />
      <ambientLight intensity={0.7} />
      <directionalLight
        castShadow
        intensity={2.5}
        position={[4, 8, 5]}
        shadow-mapSize={[1024, 1024]}
      />

      <Character onSizeChange={setCharacterSize} poseSample={poseSample} />

      <Grid
        args={[gridSize, gridSize]}
        cellColor="#354253"
        cellSize={gridSize / 40}
        fadeDistance={gridSize * 0.7}
        fadeStrength={1}
        sectionColor="#68809d"
        sectionSize={gridSize / 8}
      />
      <PoseOrbitCamera characterSize={characterSize} poseSample={poseSample} />
      <SceneReady />
    </>
  )
}

function App() {
  return (
    <main className="app-shell">
      <Canvas camera={{ fov: 42 }} shadows>
        <Scene />
      </Canvas>
    </main>
  )
}

export default App
