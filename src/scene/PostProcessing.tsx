import { Bloom, EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import { useControls } from 'leva'
import { LEVA_ROOTS } from './levaRoots'

export function PostProcessing() {
  const { postprocessing } = useControls(
    LEVA_ROOTS.debug,
    {
      postprocessing: {
        value: true,
        label: 'postprocess',
      },
    },
    { order: 4 },
  )

  if (!postprocessing) {
    return null
  }

  return (
    <EffectComposer multisampling={0}>
      <N8AO
        aoRadius={0.35}
        distanceFalloff={0.75}
        intensity={0.7}
        quality="performance"
        halfRes
        depthAwareUpsampling
      />
      <Bloom
        intensity={0.12}
        luminanceThreshold={1.05}
        luminanceSmoothing={0.12}
        mipmapBlur
      />
      <SMAA />
    </EffectComposer>
  )
}
