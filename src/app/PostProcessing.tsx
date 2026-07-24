import { useControls } from 'leva'
import { L_Als_GridPostProcess } from '../als/ALSExtras/Levels/L_Als_Grid'
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

  return <L_Als_GridPostProcess />
}
