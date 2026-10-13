import { describe, expect, it } from 'vitest'
import { createAlsRagdollingAnimationState } from './State/AlsRagdollingAnimationState'
import { refreshRagdollingOnGameThread } from './AlsAnimationInstance_Ragdolling'

describe('UAlsAnimationInstance::RefreshRagdollingOnGameThread', () => {
  it('only refreshes while ragdolling, freezes at rest and saturates at 1000 cm/s', () => {
    const state = createAlsRagdollingAnimationState()
    refreshRagdollingOnGameThread(state, null, { x: 0, y: 0, z: 0 })
    expect(state.FlailPlayRate).toBe(1)
    refreshRagdollingOnGameThread(state, 'Ragdolling', { x: 3, y: 4, z: 0 })
    expect(state.FlailPlayRate).toBe(.5)
    refreshRagdollingOnGameThread(state, 'Ragdolling', { x: 0, y: 0, z: 0 })
    expect(state.FlailPlayRate).toBe(0)
    refreshRagdollingOnGameThread(state, 'Ragdolling', { x: 20, y: 0, z: 0 })
    expect(state.FlailPlayRate).toBe(1)
  })
})
