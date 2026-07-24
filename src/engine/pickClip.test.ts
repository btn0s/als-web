import { describe, expect, it } from 'vitest'
import { pickClip } from './pickClip'

describe('pickClip', () => {
  it('selects an idle clip regardless of case', () => {
    const clips = [{ name: 'Walk' }, { name: 'ALS_IdLe_Standing' }]

    expect(pickClip(clips)).toBe(clips[1])
  })

  it('falls back to the first clip when no idle clip exists', () => {
    const clips = [{ name: 'Walk' }, { name: 'Run' }]

    expect(pickClip(clips)).toBe(clips[0])
  })

  it('returns undefined when no clips exist', () => {
    expect(pickClip([])).toBeUndefined()
  })

  it('selects the first of multiple idle-like clips', () => {
    const clips = [
      { name: 'Crouch_Idle' },
      { name: 'Idle_Standing' },
      { name: 'Idle_Aiming' },
    ]

    expect(pickClip(clips)).toBe(clips[0])
  })

  it('preserves the selected clip object and its extra data', () => {
    const clips = [{ name: 'Idle', duration: 2.4 }]

    expect(pickClip(clips)?.duration).toBe(2.4)
  })
})
