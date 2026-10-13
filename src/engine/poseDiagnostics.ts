import type { LocalPoseBuffer } from './poseBuffer'

const reported = new Set<string>()
export function inspectPoseFinite(source: string, pose: LocalPoseBuffer, names: readonly string[]) {
  if (!import.meta.env.DEV || reported.has(source)) return
  for (let bone = 0; bone < pose.boneCount; bone++) {
    const position = pose.positions.subarray(bone * 3, bone * 3 + 3)
    const rotation = pose.rotations.subarray(bone * 4, bone * 4 + 4)
    const scale = pose.scales.subarray(bone * 3, bone * 3 + 3)
    if (![...position, ...rotation, ...scale].every(Number.isFinite) || Math.hypot(...rotation) < 1e-6) {
      reported.add(source)
      console.error('Invalid animation pose', { source, bone: names[bone], position: [...position], rotation: [...rotation], scale: [...scale] })
      return
    }
  }
}
