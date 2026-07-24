import { L_ALS_GRID_CONTENT } from '../../Levels/L_Als_Grid.content'

const authoredColor = L_ALS_GRID_CONTENT.skySphere.ColorParameter.value

export const M_ALS_SKY_SPHERE_COLOR = [
  authoredColor.R,
  authoredColor.G,
  authoredColor.B,
] as const
