import { describe, expect, it } from 'vitest'
import { ALS_FRAME_PRIORITY } from './alsFramePipeline'

describe('ALS frame pipeline', () => {
  it('orders control rotation through the post-animation camera tick', () => {
    expect([
      ALS_FRAME_PRIORITY.ControlRotation,
      ALS_FRAME_PRIORITY.Physics,
      ALS_FRAME_PRIORITY.MeshBase,
      ALS_FRAME_PRIORITY.Animation,
      ALS_FRAME_PRIORITY.PosePublication,
      ALS_FRAME_PRIORITY.AnimNotifyDispatch,
      ALS_FRAME_PRIORITY.Camera,
    ]).toEqual([-4, -3, -2.5, -2, -1, -0.5, 0])
  })
})
