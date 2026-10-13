import { expect, it, vi } from 'vitest'
import { createPoseBuffer } from './poseBuffer'
import { inspectPoseFinite } from './poseDiagnostics'

it('reports the first invalid bone once without altering the offending pose', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const pose = createPoseBuffer(2)
    pose.rotations.set([0, 0, 0, 1, 0, 0, 0, 1])
    pose.scales.fill(1)
    inspectPoseFinite('diagnostic-test', pose, ['pelvis', 'hand_r'])
    expect(log).not.toHaveBeenCalled()
    pose.positions[3] = NaN
    inspectPoseFinite('diagnostic-test', pose, ['pelvis', 'hand_r'])
    inspectPoseFinite('diagnostic-test', pose, ['pelvis', 'hand_r'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toMatchObject({ source: 'diagnostic-test', bone: 'hand_r' })
    expect(pose.positions[3]).toBeNaN()
  } finally { log.mockRestore() }
})
