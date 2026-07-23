import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { useEffect, useLayoutEffect, useState } from 'react'
import * as THREE from 'three'
import { Character } from './scene/Character'
import './App.css'

const PLACEHOLDER_SIZE = new THREE.Vector3(0.7, 1.9, 0.7)

function SceneReady() {
  useEffect(() => {
    window.__appReady = true
  }, [])

  return null
}

function CameraRig({ characterSize }: { characterSize: THREE.Vector3 }) {
  const { camera, size: viewportSize } = useThree()

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      return
    }

    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * viewportSize.width / viewportSize.height)
    const limitingFov = Math.min(verticalFov, horizontalFov)
    const boundingRadius = characterSize.length() / 2
    const distance = boundingRadius / Math.sin(limitingFov / 2) * 1.15
    const target = new THREE.Vector3(0, characterSize.y / 2, 0)
    const viewDirection = new THREE.Vector3(0.75, 0.35, 1).normalize()

    camera.position.copy(target).addScaledVector(viewDirection, distance)
    camera.near = Math.max(distance / 1000, 0.001)
    camera.far = Math.max(distance * 100, 100)
    camera.updateProjectionMatrix()
    camera.lookAt(target)
  }, [camera, characterSize, viewportSize.height, viewportSize.width])

  return (
    <OrbitControls
      makeDefault
      target={[0, characterSize.y / 2, 0]}
      minDistance={Math.max(characterSize.length() * 0.2, 0.1)}
      maxDistance={Math.max(characterSize.length() * 8, 10)}
    />
  )
}

function Scene() {
  const [characterSize, setCharacterSize] = useState(() => PLACEHOLDER_SIZE.clone())
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

      <Character onSizeChange={setCharacterSize} />

      <Grid
        args={[gridSize, gridSize]}
        cellColor="#354253"
        cellSize={gridSize / 40}
        fadeDistance={gridSize * 0.7}
        fadeStrength={1}
        sectionColor="#68809d"
        sectionSize={gridSize / 8}
      />
      <CameraRig characterSize={characterSize} />
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
