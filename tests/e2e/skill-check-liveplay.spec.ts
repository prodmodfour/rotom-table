import { randomBytes } from 'node:crypto'
import { devices, expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'

const baseUrl = 'http://127.0.0.1:3017'
const selectionKey = 'rotom:player-profile:selection'
const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

const authenticate = async (context: BrowserContext, role: 'gm' | 'player'): Promise<void> => {
  await context.addCookies([{ name: 'rotom-role', value: role, url: baseUrl, sameSite: 'Lax' }])
}

const createTrainer = async (page: Page, name: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer',
      slug,
      expectedRevision: loaded.sheet.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        name,
        level: 8,
        currentHp: 44,
      },
    },
  }))
  return slug
}

const createProfile = async (page: Page, displayName: string, trainerSlug: string | null): Promise<Record<string, any>> => {
  const created = await parseOk(await page.request.post('/api/player-profiles/create', {
    data: { displayName },
  }))
  const updated = await parseOk(await page.request.post('/api/player-profiles/update', {
    data: {
      profileId: created.profile.id,
      displayName,
      linkedCharacters: trainerSlug ? [{ sheetKind: 'trainer', sheetSlug: trainerSlug }] : [],
    },
  }))
  return updated.profile as Record<string, any>
}

const createLiveMap = async (page: Page, trainerSlug: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: unique('Skill Check Arena'), dimensions: { x: 6, y: 2, z: 6 } },
  }))
  const map = created.map as Record<string, any>
  const slug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'setup-edit' },
  }))
  await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug,
      interactionMode: 'setup-edit',
      expectedRevision: map.revision,
      map: {
        ...map,
        playerVisible: true,
        activeScene: { name: 'Flooded culvert', startedAt: Date.now() },
        initiative: { activeId: 'skill-check-trainer', round: 1 },
        placements: [{
          id: 'skill-check-trainer',
          sheetKind: 'trainer',
          sheetSlug: trainerSlug,
          sideId: 'party',
          initiative: 12,
          position: { x: 2, y: 0, z: 2 },
        }],
        encounterState: {
          ...createEmptyEncounterState(),
          sides: { party: { id: 'party', label: 'Party', status: 'active', color: '#3ba7bf' } },
        },
      },
    },
  }))
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'live-play' },
  }))
  return slug
}

const rememberProfile = async (context: BrowserContext, profile: Record<string, any>): Promise<void> => {
  await context.addInitScript(({ key, selection }) => {
    localStorage.setItem(key, JSON.stringify(selection))
  }, {
    key: selectionKey,
    selection: {
      schemaVersion: 1,
      profileId: profile.id,
      displayName: profile.displayName,
      rememberedAt: new Date().toISOString(),
    },
  })
}

const expectNoSeriousAxeViolations = async (page: Page, selector: string): Promise<void> => {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])
}

const expectTouchTargets = async (page: Page, selector: string): Promise<void> => {
  const controls = page.locator(`${selector} button:visible, ${selector} select:visible, ${selector} input:not([type="checkbox"]):not([type="radio"]):visible, ${selector} textarea:visible, ${selector} summary:visible`)
  for (const control of await controls.all()) {
    const box = await control.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  }
}

const expectNoHorizontalPageOverflow = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
}

test('GM request, subject response, resolution, and spectator history pass desktop/mobile liveplay acceptance', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  const mobile = testInfo.project.name.includes('mobile')
  await authenticate(page.context(), 'gm')
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const trainerName = unique('Mira')
  const playerName = unique('Culvert Player')
  const publicLabel = unique('Cross the flooded culvert')
  const prompt = 'Choose a stable route and keep the rope above the current.'
  const privateNote = 'Private GM note: the west ledge is unstable.'
  const trainerSlug = await createTrainer(page, trainerName)
  const profile = await createProfile(page, playerName, trainerSlug)
  const spectatorProfile = await createProfile(page, unique('Culvert Observer'), null)
  const mapSlug = await createLiveMap(page, trainerSlug)

  await page.goto(`/play/${mapSlug}`)
  await expect(page.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'Director', exact: true }).click()
  const director = page.locator('.encounter-director')
  await expect(director.getByRole('heading', { name: 'Director' })).toBeVisible()
  await director.getByRole('tab', { name: 'Checks' }).focus()
  await page.keyboard.press('Enter')
  const checksPanel = page.locator('#director-panel-checks')
  await expect(checksPanel.getByRole('heading', { name: 'Skill checks' })).toBeVisible()

  await checksPanel.getByLabel('Public label').fill(publicLabel)
  await checksPanel.getByLabel('Prompt').fill(prompt)
  await checksPanel.getByLabel('Find a Trainer or Pokémon').fill(trainerName)
  const subjectRow = checksPanel.locator('.gm-checks__subject-option').filter({ hasText: trainerName })
  await expect(subjectRow).toHaveCount(1)
  await subjectRow.getByRole('checkbox').check()
  await subjectRow.getByRole('combobox').selectOption('survival')
  await checksPanel.locator('.gm-checks__notes > summary').click()
  await checksPanel.getByLabel('Private GM notes').fill(privateNote)
  await expect(checksPanel.getByText('Request inputs are valid.')).toBeVisible()

  const requestStartedAt = Date.now()
  await checksPanel.getByRole('button', { name: 'Request check' }).click()
  const gmRequest = checksPanel.getByRole('article').filter({ hasText: publicLabel })
  await expect(gmRequest).toContainText('Waiting for subjects')
  const requestLatencyMs = Date.now() - requestStartedAt
  testInfo.annotations.push({ type: 'skill-check-request-ms', description: String(requestLatencyMs) })
  expect(requestLatencyMs).toBeLessThan(2_000)
  await expect(checksPanel.locator('.gm-checks__announcement')).toBeFocused()
  await expect(checksPanel.locator('.gm-checks')).toHaveAttribute('aria-busy', 'false')
  await expectTouchTargets(page, '#director-panel-checks')
  await expectNoSeriousAxeViolations(page, '#director-panel-checks')

  const contextOptions = mobile ? devices['Pixel 7'] : devices['Desktop Chrome']
  const playerContext = await browser.newContext(contextOptions)
  await authenticate(playerContext, 'player')
  await rememberProfile(playerContext, profile)
  const player = await playerContext.newPage()
  await player.emulateMedia({ reducedMotion: 'reduce' })
  await player.goto(`/play/${mapSlug}`)
  const decision = player.getByRole('dialog', { name: publicLabel })
  await expect(decision).toBeVisible()
  await expect(decision.getByRole('heading', { name: publicLabel })).toBeFocused()
  await expect(decision).toHaveAttribute('aria-busy', 'false')
  await expect(decision).toContainText(prompt)
  await expect(decision).toContainText(trainerName)
  await expect(decision).toContainText('Survival')
  await expect(decision).not.toContainText(privateNote)
  await decision.getByText(/Request history/).focus()
  await player.keyboard.press('Enter')
  await expect(decision.locator('.subject-check__history')).toHaveAttribute('open', '')
  await expectTouchTargets(player, '.subject-check')
  await expectNoSeriousAxeViolations(player, '.subject-check')

  const responseStartedAt = Date.now()
  await decision.getByRole('button', { name: 'Take the check' }).focus()
  await player.keyboard.press('Enter')
  await expect(decision).toContainText('Your response is recorded')
  const responseLatencyMs = Date.now() - responseStartedAt
  testInfo.annotations.push({ type: 'skill-check-response-ms', description: String(responseLatencyMs) })
  expect(responseLatencyMs).toBeLessThan(2_000)
  await expect(decision.locator('.subject-check__announcement')).toBeFocused()

  await checksPanel.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(gmRequest).toContainText('Ready to resolve')
  const resolveStartedAt = Date.now()
  await gmRequest.getByRole('button', { name: 'Resolve check' }).click()
  await expect(checksPanel.getByText(new RegExp(`${publicLabel}: accepted`, 'i'))).toBeVisible()
  const resolveLatencyMs = Date.now() - resolveStartedAt
  testInfo.annotations.push({ type: 'skill-check-resolve-ms', description: String(resolveLatencyMs) })
  expect(resolveLatencyMs).toBeLessThan(2_000)
  await checksPanel.getByText(/Recent Skill Check history/).focus()
  await page.keyboard.press('Enter')
  await expect(checksPanel.locator('.gm-checks__history')).toContainText(publicLabel)

  const spectatorContext = await browser.newContext(contextOptions)
  await authenticate(spectatorContext, 'player')
  await rememberProfile(spectatorContext, spectatorProfile)
  const spectator = await spectatorContext.newPage()
  await spectator.emulateMedia({ reducedMotion: 'reduce' })
  await spectator.goto(`/play/${mapSlug}`)
  if (mobile) {
    await spectator.getByRole('navigation', { name: 'Encounter regions' })
      .getByRole('button', { name: 'Decisions & history' }).click()
  }
  const publicFeed = spectator.locator('.public-checks')
  await expect(publicFeed.getByRole('heading', { name: 'Skill checks' })).toBeVisible()
  await expect(publicFeed).toHaveAttribute('aria-busy', 'false')
  const publicEntry = publicFeed.getByRole('article', { name: publicLabel })
  await expect(publicEntry).toContainText('Resolved')
  await expect(publicEntry).toContainText(/\d+ (success|failure)/)
  await expect(publicEntry).not.toContainText(trainerName)
  await expect(publicEntry).not.toContainText(trainerSlug)
  await expect(publicEntry).not.toContainText(prompt)
  await expect(publicEntry).not.toContainText(privateNote)
  await expect(publicEntry).not.toContainText('Survival')
  await publicEntry.getByText(/Public history/).focus()
  await spectator.keyboard.press('Enter')
  await expect(publicEntry.locator('.public-checks__history')).toHaveAttribute('open', '')
  await expectTouchTargets(spectator, '.public-checks')
  await expectNoSeriousAxeViolations(spectator, '.public-checks')

  const renderedSkillNodes = await spectator.locator('.public-checks *').count()
  const renderedHistoryEntries = await spectator.locator('.public-checks__history li').count()
  testInfo.annotations.push({ type: 'skill-check-public-dom-nodes', description: String(renderedSkillNodes) })
  expect(renderedSkillNodes).toBeLessThan(500)
  expect(renderedHistoryEntries).toBeLessThanOrEqual(80)

  await spectator.getByRole('button', { name: 'Display', exact: true }).click()
  const displayDialog = spectator.getByRole('dialog', { name: 'Encounter display' })
  await displayDialog.getByLabel('Layout').selectOption('table-display')
  await displayDialog.getByLabel('Text size').selectOption('table-distance')
  await displayDialog.getByRole('button', { name: 'Done' }).click()
  await spectator.setViewportSize({ width: 320, height: 900 })
  await expectNoHorizontalPageOverflow(spectator)
  await spectator.getByRole('navigation', { name: 'Encounter regions' })
    .getByRole('button', { name: 'Decisions & history' }).click()
  await expect(publicFeed).toBeVisible()
  await spectator.screenshot({
    path: testInfo.outputPath(`skill-check-public-${testInfo.project.name}.png`),
    animations: 'disabled',
    fullPage: true,
  })

  await playerContext.close()
  await spectatorContext.close()
})
