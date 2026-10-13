import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('package exports', () => {
  it('exposes the overlay object attach API so consumers can supply their own prop meshes', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(manifest.exports['./als/AlsCharacter.overlayObjects']).toBe('./src/als/AlsCharacter.overlayObjects.ts')
  })
})
