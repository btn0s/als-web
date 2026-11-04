import { useFrame } from '@react-three/fiber'
import { useEffect, useState, type ReactNode } from 'react'
import type { Object3D } from 'three'
import { ALS_FRAME_PRIORITY } from '../engine/alsFramePipeline'
import { readAlsCharacterGltf } from './AlsCharacterGltf'
import { createRetargetedCharacter } from './retargetedCharacter'
import type { RetargetedCharacter, RetargetedCharacterOptions } from './retargetedCharacter'

export interface AlsRetargetedCharacterProps extends Omit<RetargetedCharacterOptions, 'reference'> {
  reference?: Object3D
  /** Attach props or consumer effects to the cloned target; never modify the cached asset. */
  children?: (character: RetargetedCharacter) => ReactNode
}

/** Supply this through AlsRemoteActor.renderCharacter. Source pose publication remains owned
 * by the actor; this component owns target dressing and its StrictMode-safe lifetime. */
export function AlsRetargetedCharacter({ source, reference, target, profile, meshLayers,
  castShadow, receiveShadow, children }: AlsRetargetedCharacterProps) {
  const sourceAsset = readAlsCharacterGltf()
  const [character, setCharacter] = useState<RetargetedCharacter | null>(null)
  const bindScene = reference ?? sourceAsset.scene
  useEffect(() => {
    const created = createRetargetedCharacter({ source, reference: bindScene, target,
      profile, meshLayers, castShadow, receiveShadow })
    setCharacter(created)
    return () => { setCharacter(null); created.dispose() }
  }, [source, bindScene, target, profile, meshLayers, castShadow, receiveShadow])
  useFrame(() => character?.update(), ALS_FRAME_PRIORITY.PosePublication + 0.1)
  return <>
    <primitive object={source} dispose={null} />
    {character && <>
      <primitive object={character.object} dispose={null} />
      {children?.(character)}
    </>}
  </>
}
