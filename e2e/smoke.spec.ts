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
  await expect.poll(
    () => page.evaluate(() => window.__appReady),
    { timeout: 15_000 },
  ).toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.__characterStatus))
    .toMatch(/^(glb|placeholder)$/)
  await expect.poll(
    () => page.evaluate(() => window.__characterStatus),
    { timeout: 30_000 },
  ).toBe('glb')
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
      cameraState: typeof window.__alsCameraState,
      cameraShoulder: typeof window.__setCameraRightShoulder,
      cameraViewMode: typeof window.__setCameraViewMode,
      cameraViewRotation: typeof window.__setCameraViewRotation,
    }))).toEqual({
      gait: 'function',
      stance: 'function',
      rotationMode: 'function',
      overlayMode: 'function',
      speed: 'function',
      movementOverride: 'function',
      playClip: 'function',
      weightTable: 'object',
      cameraState: 'object',
      cameraShoulder: 'function',
      cameraViewMode: 'function',
      cameraViewRotation: 'function',
    })

    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.rotationMode,
    )).toBe('ViewDirection')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.activated,
    )).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      const camera = window.__alsCameraState
      return camera && {
        viewMode: camera.viewMode,
        rightShoulder: camera.rightShoulder,
        finite: [
          camera.location.x,
          camera.location.y,
          camera.location.z,
          camera.rotation.pitch,
          camera.rotation.yaw,
          camera.rotation.roll,
          camera.horizontalFieldOfView,
          camera.traceDistanceRatio,
        ].every(Number.isFinite),
      }
    })).toEqual({
      viewMode: 'ThirdPerson',
      rightShoulder: true,
      finite: true,
    })
    await page.evaluate(() => {
      window.__setCameraViewRotation?.(0, 90)
    })
    await page.waitForTimeout(4_000)

    const initialPosition = await page.evaluate(() => ({
      x: window.__alsCharacterState?.position.x ?? 0,
      z: window.__alsCharacterState?.position.z ?? 0,
    }))

    await page.keyboard.down('KeyW')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.speed ?? 0,
    )).toBeGreaterThan(0.1)
    await expect.poll(() => page.evaluate(
      (start) => Math.hypot(
        (window.__alsCharacterState?.position.x ?? start.x) - start.x,
        (window.__alsCharacterState?.position.z ?? start.z) - start.z,
      ),
      initialPosition,
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
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.speed ?? Number.POSITIVE_INFINITY,
    )).toBeLessThan(0.05)
    await page.waitForTimeout(1_500)
    await page.keyboard.down('KeyW')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.speed ?? 0,
    )).toBeGreaterThan(0.1)
    await page.waitForTimeout(500)
    await page.keyboard.up('KeyW')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.speed ?? Number.POSITIVE_INFINITY,
    )).toBeLessThan(0.05)
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

    await page.keyboard.press('KeyC')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.rightShoulder,
    )).toBe(false)

    await page.keyboard.press('Digit2')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.viewMode,
    )).toBe('FirstPerson')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.firstPersonOverride ?? 0,
    )).toBeGreaterThan(1 - 1e-5)

    await page.evaluate(() => {
      window.__setCameraViewRotation?.(5, 90)
    })
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.rotation.yaw ?? 0,
    )).toBeCloseTo(90, 3)

    await page.keyboard.press('Digit2')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.viewMode,
    )).toBe('ThirdPerson')
    await expect.poll(() => page.evaluate(
      () => window.__alsCameraState?.firstPersonOverride ?? 1,
    )).toBeLessThan(1e-5)

    const overlayModeMenu = page.getByRole('listbox', {
      name: 'Overlay mode',
      includeHidden: true,
    })
    await expect(overlayModeMenu).toBeHidden()
    await page.mouse.move(100, 100)
    await page.keyboard.down('KeyQ')
    await expect(overlayModeMenu).toBeVisible()
    await expect.poll(() => page.evaluate(
      () => window.__effectiveGlobalTimeDilation,
    )).toBe(0.35)
    await expect(
      overlayModeMenu.getByRole('option', {
        selected: true,
      }),
    ).toHaveText('Default')

    await page.mouse.wheel(0, 100)
    await expect(
      overlayModeMenu.getByRole('option', {
        selected: true,
      }),
    ).toHaveText('Rifle')
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.overlayMode,
    )).toBe('Default')

    await page.keyboard.up('KeyQ')
    await expect(overlayModeMenu).toBeHidden()
    await expect.poll(() => page.evaluate(
      () => window.__effectiveGlobalTimeDilation,
    )).toBe(1)
    await expect.poll(() => page.evaluate(
      () => window.__alsCharacterState?.overlayMode,
    )).toBe('Rifle')
    await expect.poll(() => page.evaluate(
      () => window.__weightTable?.overlayModeRifle,
    )).toBe(1)
  }
  await page.waitForTimeout(250)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
