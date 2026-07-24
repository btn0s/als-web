import { expect, test } from '@playwright/test'

test('scene mounts with either the character GLB or its DOM load state', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')

  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__appReady)).toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.__characterStatus))
    .toMatch(/^(glb|placeholder)$/)
  if (await page.evaluate(() => window.__characterStatus === 'glb')) {
    await expect.poll(() => page.evaluate(() => ({
      gait: typeof window.__setGait,
      stance: typeof window.__setStance,
      overlayMode: typeof window.__setOverlayMode,
      speed: typeof window.__setSpeed,
      playClip: typeof window.__playClip,
      weightTable: typeof window.__weightTable,
    }))).toEqual({
      gait: 'function',
      stance: 'function',
      overlayMode: 'function',
      speed: 'function',
      playClip: 'function',
      weightTable: 'object',
    })
  }
  await page.waitForTimeout(250)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
