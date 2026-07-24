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
  await page.waitForTimeout(250)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
