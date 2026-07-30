import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const openPreview = async (page: Page, audience: 'gm' | 'public' = 'gm') => {
  await page.context().addCookies([{
    name: 'rotom-role',
    value: 'gm',
    url: 'http://127.0.0.1:3017',
    sameSite: 'Lax',
  }])
  await page.goto(`/presentation-contract-preview?audience=${audience}`)
  await expect(page.getByRole('heading', { name: 'Encounter presentation contract preview' })).toBeVisible()
  // Wait for the async Nuxt entrypoint to attach the Vue application.
  await page.waitForFunction(() => Boolean(
    (document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown } | null)?.__vue_app__,
  ))
}

test('generic offer, pending response, outcomes, and keyboard controls share one component path', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await openPreview(page)

  const toggle = page.getByRole('button', { name: /Encounter/ })
  await toggle.focus()
  await expect(toggle).toBeFocused()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('heading', { name: 'Actions' })).toBeVisible()
  await expect(page.getByText('Recent outcomes (1)')).toBeVisible()

  await page.getByRole('button', { name: /Thunder Shock Standard Action/ }).click()
  await expect(page.getByTestId('preview-status')).toContainText('Activated Thunder Shock')

  await page.getByRole('button', { name: 'Use reaction' }).click()
  await expect(page.getByTestId('preview-status')).toContainText('Response choose: option:use')
  expect(consoleErrors).toEqual([])
})

test('GM and public browser contexts converge without disclosing authorised options', async ({ browser }) => {
  const gmContext = await browser.newContext()
  const publicContext = await browser.newContext()
  const gm = await gmContext.newPage()
  const publicPage = await publicContext.newPage()
  try {
    await Promise.all([openPreview(gm, 'gm'), openPreview(publicPage, 'public')])
    await Promise.all([
      gm.getByRole('button', { name: /Encounter/ }).click(),
      publicPage.getByRole('button', { name: /Encounter/ }).click(),
    ])
    await expect(gm.getByRole('button', { name: 'Use reaction' })).toBeVisible()
    await expect(publicPage.getByRole('button', { name: 'Use reaction' })).toHaveCount(0)
    await expect(publicPage.getByText('1 response outstanding')).toBeVisible()
    await Promise.all([
      gm.getByText('Recent outcomes (1)').click(),
      publicPage.getByText('Recent outcomes (1)').click(),
    ])
    await expect(gm.getByText('Thunder Shock hit Squirtle')).toBeVisible()
    await expect(publicPage.getByText('Thunder Shock hit Squirtle')).toBeVisible()
    expect(await publicPage.locator('body').innerText()).not.toContain('resolution:preview')
    expect(await publicPage.locator('body').innerText()).not.toContain('option:use')
  }
  finally {
    await gmContext.close()
    await publicContext.close()
  }
})

test('duplicate accepted delivery and reload keep one deterministic history row', async ({ page }) => {
  await openPreview(page)
  await page.getByRole('button', { name: /Encounter/ }).click()
  await expect(page.locator('[data-presentation-id="accepted:preview"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Replay accepted outcome' }).click()
  await expect(page.getByTestId('preview-status')).toHaveText('Accepted presentations: 1')
  await expect(page.locator('[data-presentation-id="accepted:preview"]')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Encounter presentation contract preview' })).toBeVisible()
  await page.getByRole('button', { name: /Encounter/ }).click()
  await expect(page.locator('[data-presentation-id="accepted:preview"]')).toHaveCount(1)
})

test('login and core reference/library routes have no serious accessibility violations', async ({ page }) => {
  // Four full-page axe scans routinely approach Playwright's 30-second default
  // on constrained CI runners. This is an accessibility assertion, not a page-
  // performance budget, so retain a bounded allowance for both browser projects.
  test.setTimeout(90_000)

  const seriousViolations = async () => (await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()).violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Choose your table role' })).toBeVisible()
  expect(await seriousViolations()).toEqual([])
  await page.getByRole('button', { name: /GM Login/ }).click()
  await expect(page).toHaveURL(/\/maps(?:\?|$)/)

  for (const route of ['/moves', '/pokedex', '/sheets']) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    await page.waitForTimeout(100)
    expect(await seriousViolations(), route).toEqual([])
  }
})

test('preview has no serious accessibility violations', async ({ page }) => {
  await openPreview(page)
  await page.getByRole('button', { name: /Encounter/ }).click()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
})

test('real GM/player login, map realtime, reconnect, and IndexedDB use the production server', async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const key = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const profileName = `E2E Player ${key}`
  const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
    const text = await response.text()
    expect(response.ok(), `${response.status()} ${text}`).toBe(true)
    return JSON.parse(text) as Record<string, any>
  }
  const gmContext = await browser.newContext()
  const playerContext = await browser.newContext()
  const gm = await gmContext.newPage()
  const player = await playerContext.newPage()
  try {
    await gm.goto('/login')
    await gm.getByRole('button', { name: /GM Login/ }).click()
    await expect(gm).toHaveURL(/\/maps(?:\?|$)/)

    const createdMap = await parseOk(await gm.request.post('/api/maps/create', {
      data: { name: `E2E Arena ${key}`, dimensions: { x: 8, y: 2, z: 8 } },
    }))
    const map = createdMap.map as Record<string, any>
    const mapSlug = String(map.slug)
    await parseOk(await gm.request.post('/api/maps/interaction-mode', {
      data: { slug: mapSlug, interactionMode: 'setup-edit' },
    }))
    const savedMap = await parseOk(await gm.request.post('/api/maps/save', {
      data: {
        slug: mapSlug,
        map: { ...map, playerVisible: true },
        interactionMode: 'setup-edit',
        expectedRevision: map.revision,
      },
    }))
    await parseOk(await gm.request.post('/api/maps/interaction-mode', {
      data: { slug: mapSlug, interactionMode: 'live-play' },
    }))

    const createdSheet = await parseOk(await gm.request.post('/api/sheets/create', {
      data: { kind: 'pokemon', folder: '' },
    }))
    const loadedSheet = await parseOk(await gm.request.get(
      `/api/sheets/load?kind=pokemon&slug=${createdSheet.slug}`,
    ))
    await parseOk(await gm.request.post('/api/sheets/save', {
      data: {
        kind: 'pokemon',
        slug: createdSheet.slug,
        sheet: {
          ...loadedSheet.sheet,
          nickname: `Pikachu ${key}`,
          species: 'Pikachu',
        },
        interactionMode: 'setup-edit',
        expectedRevision: loadedSheet.sheet.revision,
      },
    }))
    const createdProfile = await parseOk(await gm.request.post('/api/player-profiles/create', {
      data: { displayName: profileName },
    }))
    await parseOk(await gm.request.post('/api/player-profiles/update', {
      data: {
        profileId: createdProfile.profile.id,
        displayName: profileName,
        linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: createdSheet.slug }],
      },
    }))

    const liveState = await parseOk(await gm.request.get(`/api/maps/live-state?slug=${mapSlug}`))
    const placementId = `token-${key}`
    const spawnOpId = `op_${key}_spawn`
    const spawned = await parseOk(await gm.request.post('/api/maps/tokens/spawn', {
      data: {
        schemaVersion: 1,
        opId: spawnOpId,
        mapSlug,
        baseRevision: liveState.mapRevision,
        type: 'spawnToken',
        scopes: [{ kind: 'token', placementId, field: 'spawn' }],
        payload: {
          placement: {
            id: placementId,
            sheetKind: 'pokemon',
            sheetSlug: createdSheet.slug,
            position: { x: 2, y: 0, z: 2 },
            facing: 'south-east',
            turned: false,
          },
        },
      },
    }))
    expect(spawned.ok).toBe(true)

    await player.goto('/login')
    await player.getByRole('button', { name: /Player Login/ }).click()
    await player.getByRole('button', { name: new RegExp(profileName) }).click()
    await expect(player).toHaveURL(/\/maps(?:\?|$)/)

    await Promise.all([
      gm.goto(`/maps/${mapSlug}`),
      player.goto(`/maps/${mapSlug}`),
    ])
    await Promise.all([
      expect(gm.locator('.scene-root canvas')).toBeVisible({ timeout: 30_000 }),
      expect(player.locator('.scene-root canvas')).toBeVisible({ timeout: 30_000 }),
    ])
    expect(await gm.evaluate(() => new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`ws://${location.host}/api/sessions/socket`)
      const timeout = window.setTimeout(() => { socket.close(); resolve(false) }, 5_000)
      socket.addEventListener('open', () => {
        window.clearTimeout(timeout)
        socket.close()
        resolve(true)
      }, { once: true })
      socket.addEventListener('error', () => {
        window.clearTimeout(timeout)
        resolve(false)
      }, { once: true })
    }))).toBe(true)
    await Promise.all([
      gm.getByRole('button', { name: /Encounter/ }).click(),
      player.getByRole('button', { name: /Encounter/ }).click(),
    ])

    await expect.poll(async () => gm.evaluate(async () => (
      await indexedDB.databases()
    ).map(database => database.name))).toContain('rotom-table-client')

    const moveOpId = `op_${key}_move`
    const moved = await parseOk(await gm.request.post('/api/maps/tokens/move', {
      data: {
        schemaVersion: 1,
        opId: moveOpId,
        mapSlug,
        baseRevision: spawned.revision,
        type: 'moveToken',
        scopes: [{ kind: 'token', placementId, field: 'position' }],
        payload: { placementId, position: { x: 3, y: 0, z: 2 } },
      },
    }))
    expect(moved.ok, JSON.stringify(moved)).toBe(true)

    const acceptedSelector = `[data-presentation-id="accepted:${moveOpId}"]`
    await Promise.all([
      expect(gm.locator(acceptedSelector)).toHaveCount(1, { timeout: 20_000 }),
      expect(player.locator(acceptedSelector)).toHaveCount(1, { timeout: 20_000 }),
    ])
    await expect(gm.locator(acceptedSelector)).toContainText('Movement resolved')
    await expect(player.locator(acceptedSelector)).toContainText('Movement resolved')

    await playerContext.setOffline(true)
    await player.waitForTimeout(250)
    await playerContext.setOffline(false)
    await player.reload()
    await expect(player.locator('.scene-root canvas')).toBeVisible({ timeout: 30_000 })
    await player.getByRole('button', { name: /Encounter/ }).click()
    await expect(player.locator(acceptedSelector)).toHaveCount(1)
    expect(await player.evaluate(() => localStorage.getItem('rotom:player-profile:selection'))).toContain(profileName)

    expect(savedMap.map.playerVisible).toBe(true)
  }
  finally {
    await gmContext.close()
    await playerContext.close()
  }
})

test('reduced motion and mobile layout preserve readable controls', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPreview(page)
  await page.getByRole('button', { name: /Encounter/ }).click()
  const panel = page.getByTestId('encounter-presentation-panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1280)
  await expect(page.getByTestId('encounter-vfx-overlay')).toBeVisible()
})
