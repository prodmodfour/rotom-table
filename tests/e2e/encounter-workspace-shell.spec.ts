import { readFileSync } from 'node:fs'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'

// Package-pinned Chromium still has bounded glyph antialiasing variance across
// Linux CI hosts. Keep tolerance well below a material visual/layout change.
const MAX_RASTER_DIFF_PIXEL_RATIO = 0.002

const performanceBudgets = JSON.parse(readFileSync(
  new URL('../../data/encounter-workspace/performance-budgets.json', import.meta.url),
  'utf8',
)) as {
  readonly runtime: {
    readonly maximumWorkspaceDomNodes: number
    readonly maximumRenderedActionOffers: number
    readonly maximumRenderedHistoryEntries: number
  }
}

const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role',
    value: 'gm',
    url: 'http://127.0.0.1:3017',
    sameSite: 'Lax',
  }])
}

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

test('encounter library, cockpit shell, deep route, reload, back, and workshop compatibility remain coherent', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticateGm(page)
  const key = `workspace-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: `Workspace Arena ${key}`, dimensions: { x: 6, y: 2, z: 6 } },
  }))
  const mapSlug = String((created.map as Record<string, unknown>).slug)

  await page.goto('/play')
  await expect(page.getByRole('heading', { name: 'Encounter Library' })).toBeVisible()
  const card = page.getByRole('article').filter({ hasText: `Workspace Arena ${key}` })
  await expect(card).toContainText('Empty')
  await card.getByRole('link', { name: 'Open cockpit' }).click()
  await expect(page).toHaveURL(new RegExp(`/play/${mapSlug}(?:\\?|$)`))
  await expect(page.getByRole('heading', { name: 'No encounter participants' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Encounter and connection status' })).toContainText('Authoritative revision')
  await expect(page.getByRole('main', { name: 'Battle stage' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Available actions' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'No encounter participants' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Encounter Library' })).toBeVisible()

  await page.goto(`/play/${mapSlug}/tactical`)
  await expect(page).toHaveURL(new RegExp(`/play/${mapSlug}\\?.*tactical=1`))
  await expect(page).toHaveURL(/lens=full-screen/)
  // Exact geometry links remain authorization-bound and the compatibility map stays addressable.
  const tacticalLink = page.getByRole('link', { name: 'Open tactical battlefield' })
  await expect(tacticalLink).toHaveCount(0)
  await page.getByRole('link', { name: 'Open Battlefield Workshop' }).last().click()
  await expect(page).toHaveURL(new RegExp(`/maps/${mapSlug}(?:\\?|$)`))
  await expect(page).toHaveTitle(/Battlefield Workshop/)
})

test('participant fixture supports turn, group expansion, screen-reader hierarchy, keyboard paths, and visual regression', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const mobile = testInfo.project.name.includes('mobile')

  const createPokemon = async (nickname: string, species: string): Promise<string> => {
    const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'pokemon', folder: '' } }))
    const slug = String(created.slug)
    const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${slug}`))
    const sheet = loaded.sheet as Record<string, any>
    await parseOk(await page.request.post('/api/sheets/save', {
      data: {
        kind: 'pokemon',
        slug,
        sheet: { ...sheet, nickname, species, level: 12, combat: { ...(sheet.combat ?? {}), currentHp: 32 } },
        interactionMode: 'setup-edit',
        expectedRevision: sheet.revision,
      },
    }))
    return slug
  }

  const heroSlug = await createPokemon('Hero Luxray', 'Luxray')
  const wildOneSlug = await createPokemon('Wild Rattata 1', 'Rattata')
  const wildTwoSlug = await createPokemon('Wild Rattata 2', 'Rattata')
  const wildThreeSlug = await createPokemon('Wild Rattata 3', 'Rattata')
  const mapName = `Phase 5 Arena ${testInfo.project.name}`
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: mapName, dimensions: { x: 8, y: 2, z: 8 } },
  }))
  const map = created.map as Record<string, any>
  const mapSlug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug: mapSlug, interactionMode: 'setup-edit' },
  }))
  const scene = { name: 'Canal ambush', startedAt: 100 }
  await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug: mapSlug,
      map: {
        ...map,
        playerVisible: true,
        activeScene: scene,
        initiative: {
          activeId: 'hero-luxray',
          round: 2,
          manualOrderIds: ['hero-luxray', 'wild-one', 'wild-two', 'wild-three'],
        },
        temporaryHitPoints: { scene, byPlacementId: { 'hero-luxray': 4 } },
        placements: [
          { id: 'hero-luxray', sheetKind: 'pokemon', sheetSlug: heroSlug, sideId: 'heroes', initiative: 18, position: { x: 2, y: 0, z: 2 } },
          { id: 'wild-one', sheetKind: 'pokemon', sheetSlug: wildOneSlug, sideId: 'wild', initiative: 14, position: { x: 5, y: 0, z: 2 } },
          { id: 'wild-two', sheetKind: 'pokemon', sheetSlug: wildTwoSlug, sideId: 'wild', initiative: 12, position: { x: 5, y: 0, z: 3 } },
          { id: 'wild-three', sheetKind: 'pokemon', sheetSlug: wildThreeSlug, sideId: 'wild', initiative: 10, position: { x: 6, y: 0, z: 2 } },
        ],
        hazards: [{ kind: 'spikes', x: 4, y: 0, z: 2, layer: 1 }],
        fieldEffects: { weather: [{ kind: 'rainy', rounds: 3 }], terrains: [], rooms: [] },
        encounterState: {
          ...createEmptyEncounterState(),
          sides: {
            heroes: { id: 'heroes', label: 'Canal Watch', status: 'active', color: '#4587c7' },
            wild: { id: 'wild', label: 'Wild Pack', status: 'active', color: '#a06745' },
          },
        },
      },
      interactionMode: 'setup-edit',
      expectedRevision: map.revision,
    },
  }))
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug: mapSlug, interactionMode: 'live-play' },
  }))

  await page.goto(`/play/${mapSlug}`)
  await expect(page.getByRole('heading', { name: 'Hero Luxray', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Turn order' })).toContainText('Round')
  await expect(page.locator('.encounter-turn-rail__round strong')).toHaveText('2')
  const currentTurn = page.getByRole('button', { name: /Hero Luxray, initiative 18, current/ })
  await expect(currentTurn).toHaveAttribute('aria-current', 'step')
  if (mobile) await page.getByRole('button', { name: 'Participants' }).click()
  await expect(page.getByRole('button', { name: /Rattata ×3/ })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /Rattata ×3/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Rattata ×3/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByLabel(/Wild Rattata 2, Rattata, Wild Pack/)).toBeVisible()
  if (mobile) await page.getByRole('button', { name: 'Battle' }).click()
  await expect(page.getByRole('heading', { name: 'Environment and objectives' })).toBeVisible()
  await expect(page.getByText('Rainy')).toBeVisible()
  await expect(page.getByText('Spikes')).toBeVisible()

  await page.getByRole('button', { name: 'Tactical focus' }).click()
  await expect(page).toHaveURL(/tactical=1/)
  const tacticalLens = page.getByRole('region', { name: 'Tactical battlefield' })
  await expect(tacticalLens).toBeVisible()
  await expect.poll(async () => {
    const frame = page.frames().find(candidate => candidate.url().includes('encounterLens=1'))
    return frame ? await frame.locator('.scene-root canvas[data-engine^="three.js"]').count() : 0
  }, { timeout: 30_000 }).toBe(1)
  const tacticalFrame = page.frames().find(candidate => candidate.url().includes('encounterLens=1'))!
  await expect(page.getByText(/Tactical renderer ready in \d+ ms/)).toBeVisible()
  const p10Fps = await tacticalFrame.evaluate(async () => {
    const animationFrames = async (count: number): Promise<number[]> => new Promise((resolve) => {
      const timestamps: number[] = []
      const sample = (timestamp: number): void => {
        timestamps.push(timestamp)
        if (timestamps.length >= count) resolve(timestamps)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    // Measure steady-state rendering after the acknowledged renderer startup and
    // one warmup window, rather than counting texture/bootstrap work as frame rate.
    await animationFrames(31)
    const timestamps = await animationFrames(121)
    const rates = timestamps.slice(1).map((timestamp, index) => 1000 / Math.max(0.01, timestamp - timestamps[index]!))
      .sort((left, right) => left - right)
    return rates[Math.max(0, Math.floor(rates.length * 0.1) - 1)]!
  })
  testInfo.annotations.push({ type: 'tactical-p10-fps', description: p10Fps.toFixed(1) })
  expect(p10Fps).toBeGreaterThanOrEqual(30)
  const tacticalFrameElement = tacticalLens.locator('iframe')
  await tacticalFrameElement.evaluate(element => { element.style.visibility = 'hidden' })
  await page.mouse.move(0, 0)
  await expect(tacticalLens).toHaveScreenshot('encounter-workspace-tactical-lens.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
  })
  await tacticalFrameElement.evaluate(element => { element.style.visibility = 'visible' })
  if (mobile) {
    await expect(tacticalLens.getByRole('button', { name: 'Split' })).toBeHidden()
  }
  else {
    await tacticalLens.getByRole('button', { name: 'Split' }).click()
    await expect(tacticalLens).toHaveAttribute('data-mode', 'split')
  }
  await tacticalLens.getByRole('button', { name: 'Return to stage' }).click()
  await expect(page.locator('iframe[title^="Tactical battlefield"]')).toHaveCount(0)

  if (mobile) await page.getByRole('button', { name: 'Participants' }).click()
  await page.getByRole('button', { name: 'Inspect Wild Rattata 2' }).click()
  await expect(page).toHaveURL(/participant=wild-two/)
  await expect(page.locator('#participant-wild-two')).toBeFocused()

  await page.keyboard.press('/')
  const actionSearch = page.getByRole('searchbox', { name: 'Search' })
  await expect(actionSearch).toBeFocused()
  await actionSearch.fill('Zapper Physical')
  const filteredAction = page.getByRole('article').filter({ hasText: 'Struggle (Zapper Physical)' })
  await expect(filteredAction).toBeVisible()
  await filteredAction.getByRole('button', { name: 'Details' }).click()
  if (mobile) await page.getByRole('button', { name: 'Battle' }).click()
  await expect(page.locator('.encounter-action-inspector').getByRole('heading', { name: 'Struggle (Zapper Physical)' })).toBeVisible()
  await page.getByRole('button', { name: 'Close action details' }).click()
  await actionSearch.evaluate(element => (element as HTMLInputElement).blur())
  await page.keyboard.press('1')
  const actionDecision = page.getByRole('dialog', { name: 'Struggle (Zapper Physical)' })
  await expect(actionDecision).toBeVisible()
  await actionDecision.getByRole('button', { name: /Wild Rattata 1/ }).click()
  const declareAction = actionDecision.getByRole('button', { name: 'Declare action' })
  await expect(declareAction).toBeEnabled()
  await declareAction.click()
  await expect(page.getByRole('status').filter({ hasText: 'was authorized at revision' })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss action declaration receipt' }).click()
  await actionSearch.fill('')

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])
  expect(await page.locator('.encounter-workspace-shell *').count()).toBeLessThanOrEqual(performanceBudgets.runtime.maximumWorkspaceDomNodes)
  expect(await page.locator('.encounter-action-dock .encounter-offer-card').count()).toBeLessThanOrEqual(performanceBudgets.runtime.maximumRenderedActionOffers)
  expect(await page.locator('.encounter-event-feed [data-presentation-id]').count()).toBeLessThanOrEqual(performanceBudgets.runtime.maximumRenderedHistoryEntries)
  await expect(page.locator('.encounter-workspace-shell')).toHaveScreenshot('encounter-workspace-participants.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
  })

  await page.getByRole('button', { name: 'Display' }).click()
  const displayDialog = page.getByRole('dialog', { name: 'Encounter display' })
  await expect(displayDialog.getByRole('heading', { name: 'Encounter display' })).toBeFocused()
  await displayDialog.getByLabel('Layout').selectOption('table-display')
  await displayDialog.getByLabel('Text size').selectOption('table-distance')
  await displayDialog.getByLabel('Colour-vision palette').selectOption('deuteranopia')
  await displayDialog.getByLabel('Contrast').selectOption('high')
  await displayDialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Display' })).toBeFocused()
  const root = page.locator('.encounter-workspace-page')
  await expect(root).toHaveAttribute('data-rt-layout', 'table-display')
  await expect(root).toHaveAttribute('data-rt-text-size', 'table-distance')
  await expect(root).toHaveAttribute('data-rt-color-vision', 'deuteranopia')
  await expect(root).toHaveAttribute('data-rt-contrast', 'high')
  const storedPreferences = await page.evaluate(() => Object.entries(localStorage))
  expect(storedPreferences).toHaveLength(1)
  expect(JSON.parse(storedPreferences[0]![1])).not.toHaveProperty('mapSlug')
  await page.reload()
  await expect(page.locator('.encounter-workspace-page')).toHaveAttribute('data-rt-layout', 'table-display')
  if (!mobile) {
    await expect(page.locator('.encounter-workspace-shell')).toHaveScreenshot('encounter-workspace-table-display.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: MAX_RASTER_DIFF_PIXEL_RATIO,
    })
  }

  const metricResponse = await parseOk(await page.request.get('/api/encounter-workspace/metrics'))
  expect(metricResponse).toMatchObject({ schemaVersion: 1, privacy: 'aggregate-only' })
  expect((metricResponse.aggregates as Array<Record<string, unknown>>).some(row => row.event === 'workspace-ready')).toBe(true)
  expect(JSON.stringify(metricResponse)).not.toContain('Hero Luxray')
  expect(JSON.stringify(metricResponse)).not.toContain(mapSlug)

  if (mobile) {
    for (const control of await page.getByRole('navigation', { name: 'Encounter regions' }).getByRole('button').all()) {
      const box = await control.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }
  }

  await page.getByRole('button', { name: 'Next initiative turn' }).click()
  await expect(page.getByRole('heading', { name: 'Wild Rattata 1', level: 1 })).toBeVisible()
  await expect(page.locator('.encounter-turn-rail__round strong')).toHaveText('2')
})

test('workspace routes enforce auth and expose accessible loading/error boundaries', async ({ page }) => {
  await page.goto('/play')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await authenticateGm(page)
  await page.goto('/play/encounter-that-does-not-exist')
  await expect(page.getByRole('heading', { name: 'Encounter unavailable' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Return to Encounter Library' })).toBeVisible()
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])
})
