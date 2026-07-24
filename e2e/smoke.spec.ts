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
      rotationMode: typeof window.__setRotationMode,
      overlayMode: typeof window.__setOverlayMode,
      speed: typeof window.__setSpeed,
      movementOverride: typeof window.__setMovementOverride,
      playClip: typeof window.__playClip,
      weightTable: typeof window.__weightTable,
    }))).toEqual({
      gait: 'function',
      stance: 'function',
      rotationMode: 'function',
      overlayMode: 'function',
      speed: 'function',
      movementOverride: 'function',
      playClip: 'function',
      weightTable: 'object',
    })

    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.rotationMode,
    )).toBe('ViewDirection')
    const initialX = await page.evaluate(
      () => window.__alsCharacterState?.position.x ?? 0,
    )

    await page.keyboard.down('KeyW')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.speed ?? 0,
    )).toBeGreaterThan(0.1)
    await expect.poll(() => page.evaluate(
      (startX) => (window.__alsCharacterState?.position.x ?? startX) - startX,
      initialX,
    )).toBeGreaterThan(0.02)

    await page.keyboard.down('ShiftLeft')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.desiredGait,
    )).toBe('Sprinting')
    await page.keyboard.up('ShiftLeft')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.desiredGait,
    )).toBe('Running')
    await page.keyboard.up('KeyW')

    await page.keyboard.press('ControlLeft')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.stance,
    )).toBe('Crouching')
    await page.keyboard.press('Digit1')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.rotationMode,
    )).toBe('VelocityDirection')

    await page.mouse.move(10, 10)
    await page.mouse.down({ button: 'right' })
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.rotationMode,
    )).toBe('Aiming')
    await page.mouse.up({ button: 'right' })
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.rotationMode,
    )).toBe('VelocityDirection')
  }
  await page.waitForTimeout(250)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
