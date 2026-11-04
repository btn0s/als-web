import type { LocalPoseBuffer } from './poseBuffer'

const reported = new Set<string>()
export function inspectPoseFinite(source: string, pose: LocalPoseBuffer, names: readonly string[]) {
  if (!import.meta.env.DEV || reported.has(source)) return
  for (let bone = 0; bone < pose.boneCount; bone++) {
    const p = bone * 3, q = bone * 4
    const positions = pose.positions, rotations = pose.rotations, scales = pose.scales
    // Scan retained storage directly; construct diagnostic arrays only on the error path.
    const finite = Number.isFinite(positions[p]) && Number.isFinite(positions[p + 1])
      && Number.isFinite(positions[p + 2]) && Number.isFinite(rotations[q])
      && Number.isFinite(rotations[q + 1]) && Number.isFinite(rotations[q + 2])
      && Number.isFinite(rotations[q + 3]) && Number.isFinite(scales[p])
      && Number.isFinite(scales[p + 1]) && Number.isFinite(scales[p + 2])
    if (!finite || Math.hypot(rotations[q], rotations[q + 1], rotations[q + 2], rotations[q + 3]) < 1e-6) {
      const position = positions.subarray(p, p + 3)
      const rotation = rotations.subarray(q, q + 4)
      const scale = scales.subarray(p, p + 3)
      reported.add(source)
      console.error('Invalid animation pose', { source, bone: names[bone], position: [...position], rotation: [...rotation], scale: [...scale] })
      return
    }
  }
}
