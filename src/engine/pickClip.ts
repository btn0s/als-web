export interface NamedClip {
  name: string
}

export function pickClip<T extends NamedClip>(clips: readonly T[]): T | undefined {
  return clips.find((clip) => /idle/i.test(clip.name)) ?? clips[0]
}
