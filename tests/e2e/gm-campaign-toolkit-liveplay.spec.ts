import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import migrated from '../../data/gm-campaign-toolkit/migrated-legacy-tables.v1.json' with { type: 'json' }
import sessionFixture from '../../data/gm-campaign-toolkit/fixtures/session-preparation.v1.json' with { type: 'json' }

const BASE_URL = 'http://127.0.0.1:3017'
const evidenceRoot = resolve('.pi/artifacts/ui-validation/gm-campaign-toolkit')
const forest = migrated.tables.find(row => row.tableId === 'encounter-table:v1:thickerby-vale-forest')!
const tableProjection = {
  schemaVersion: 1, tableId: forest.tableId, revision: forest.revision, status: forest.status,
  name: forest.name, environmentTags: forest.environmentTags,
  speciesRowCount: forest.rows.filter(row => row.kind === 'species').length,
  nothingWeight: forest.rows.find(row => row.kind === 'nothing')?.weight ?? 0,
  levelRange: {
    minimum: Math.min(...forest.rows.filter(row => row.kind === 'species').map(row => row.minLevel!)),
    maximum: Math.max(...forest.rows.filter(row => row.kind === 'species').map(row => row.maxLevel!)),
  },
  updatedAt: forest.updatedAt,
}

const fulfill = (route: Route, value: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(value),
})
const authenticate = async (page: Page, role: 'gm' | 'player'): Promise<void> => {
  await page.context().addCookies([{ name: 'rotom-role', value: role, url: BASE_URL, sameSite: 'Lax' }])
}
const seriousAxe = async (page: Page, include: string) => (await new AxeBuilder({ page })
  .include(include).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
  .violations.filter(row => row.impact === 'serious' || row.impact === 'critical')
const noHorizontalOverflow = (page: Page) => page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
  offenders: [...document.querySelectorAll<HTMLElement>('body *')]
    .filter(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.right > document.documentElement.clientWidth + 1 || bounds.left < -1
    })
    .slice(0, 12)
    .map(element => `${element.tagName}.${typeof element.className === 'string' ? element.className : ''}`),
}))
const screenshot = async (page: Page, name: string): Promise<void> => {
  mkdirSync(evidenceRoot, { recursive: true })
  const path = resolve(evidenceRoot, name)
  if (!existsSync(path) || process.env.ROTOM_REFRESH_UI_EVIDENCE === '1') {
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' })
  }
}
const candidate = (slot: number, speciesId: string, level: number) => ({
  candidateId: `candidate:browser-${slot}`, slot, rowId: `encounter-row:v1:browser-${slot}`,
  speciesId, level, gender: slot % 2 ? 'Female' : 'Male', nature: slot === 1 ? 'Lax' : 'Brave', shiny: false,
  heldItemName: null, abilityNames: ['Shield Dust'], moveNames: ['Tackle', 'String Shot'],
  capabilitySummary: ['Overland 5', 'Jump 1/1'],
  statTotals: { hp: 8, atk: 6, def: 7, satk: 5, sdef: 6, spd: 8 },
})

const installGenerationRoutes = async (page: Page): Promise<{ requests: unknown[] }> => {
  const requests: unknown[] = []
  await page.route('**/api/encounters/list**', route => fulfill(route, { schemaVersion: 1, tables: [tableProjection] }))
  await page.route('**/api/encounters/generate', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    if (body.mode === 'preview') return fulfill(route, {
      schemaVersion: 1, operationId: body.operationId, previewToken: 'opaque-preview-authority',
      table: tableProjection, requestedSlots: 3, nothingSlots: 0, repelledSlots: 0,
      candidates: [candidate(1, 'Cutiefly', 5), candidate(2, 'Weedle', 6), candidate(3, 'Pineco', 8)],
    })
    return fulfill(route, {
      schemaVersion: 1, operationId: body.operationId, exactRetry: false,
      packageId: 'wild-package:v1:11111111111111111111111111111111', table: tableProjection,
      candidates: [candidate(1, 'Cutiefly', 5), candidate(2, 'Weedle', 6), candidate(3, 'Pineco', 8)],
      sheets: [
        { kind: 'pokemon', slug: 'generated-cutiefly', revision: 0 },
        { kind: 'pokemon', slug: 'generated-weedle', revision: 0 },
        { kind: 'pokemon', slug: 'generated-pineco', revision: 0 },
      ],
    })
  })
  await page.route('**/api/gm-toolkit/npc-archetypes', route => fulfill(route, {
    schemaVersion: 1,
    archetypes: [{
      schemaVersion: 1, archetypeId: 'npc-archetype:v1:field-researcher', revision: 0, status: 'active',
      name: 'Field Researcher', description: 'A mobile field specialist with a balanced survey roster.', trainerLevel: 5, rosterCount: 6,
    }],
  }))
  await page.route('**/api/gm-toolkit/npc-generation', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    const roster = [candidate(1, 'Weedle', 4), candidate(2, 'Spinarak', 5), candidate(3, 'Hoothoot', 7), candidate(4, 'Sentret', 5), candidate(5, 'Pidgey', 7), candidate(6, 'Pineco', 8)]
    const trainer = {
      candidateId: 'trainer-candidate:browser', name: 'Researcher Rowan', level: 5,
      statTotals: { hp: 13, atk: 8, def: 7, satk: 8, sdef: 8, spd: 7 },
      skillRanks: { pokeEd: 'Adept', command: 'Novice', medicineEd: 'Novice', survival: 'Adept' },
      featureNames: ['Researcher', 'Pokémon Caretaking'], edgeNames: ['Basic Skills'],
      inventory: [{ section: 'pokeBalls', itemId: 'Poké Ball', quantity: 5 }], money: 5000,
      guided: { name: 'Researcher Rowan', identity: 'A careful field scientist.', tactics: 'Protect the survey team.', notes: 'Keep the trail origin private.' },
    }
    if (body.mode === 'preview') return fulfill(route, {
      schemaVersion: 1, operationId: body.operationId, previewToken: 'opaque-npc-preview-authority', trainer, roster,
    })
    return fulfill(route, {
      schemaVersion: 1, operationId: body.operationId, exactRetry: false,
      packageId: 'npc-package:v1:22222222222222222222222222222222', trainerCandidate: trainer,
      pokemonCandidates: roster, trainer: { kind: 'trainer', slug: 'researcher-rowan', revision: 0 },
      roster: roster.map((row, index) => ({ kind: 'pokemon', slug: `rowan-${row.speciesId.toLowerCase()}-${index + 1}`, revision: 0 })),
    })
  })
  return { requests }
}

const readyDocument = () => ({
  ...sessionFixture.document,
  revision: 0,
  lifecycle: 'review',
  title: 'Under the Old Canopy',
  gmNotes: 'Private pacing: the researcher arrives after the second bell.',
  scenes: [
    {
      ...sessionFixture.document.scenes[0],
      map: { slug: 'forest-map', revision: 0 },
      encounterCandidates: [
        { ...sessionFixture.document.scenes[0]!.encounterCandidates[0], selection: 'selected', gmNotes: 'Private north-trail placement.' },
        { ...sessionFixture.document.scenes[0]!.encounterCandidates[0], candidateId: 'candidate:rowan-package', label: 'Researcher Rowan', selection: 'excluded', source: { kind: 'npc-package', packageId: 'npc-package:v1:22222222222222222222222222222222' }, gmNotes: 'Hold for scene two.' },
      ],
    },
    {
      sceneId: 'scene:research-camp', title: 'Research camp', playerSummary: 'Lanterns mark a temporary survey camp.', gmNotes: 'Private rival-team reveal.',
      map: { slug: 'research-map', revision: 0 },
      encounterCandidates: [{ candidateId: 'candidate:researcher-selected', label: 'Researcher Rowan', selection: 'selected', source: { kind: 'npc-package', packageId: 'npc-package:v1:22222222222222222222222222222222' }, placementIntent: { kind: 'map-zone', zoneLabel: 'Camp edge' }, gmNotes: 'Start beside the specimen cases.' }],
    },
    {
      sceneId: 'scene:quiet-road', title: 'Quiet road', playerSummary: 'The trail opens toward the vale.', gmNotes: 'Private fallback scene.', map: null,
      encounterCandidates: [],
    },
  ],
  unresolvedDecisions: [{ decisionId: 'decision:weather', headline: 'Choose the weather', prompt: 'Will the rain break before arrival?', state: 'resolved', resolution: 'The rain breaks at dusk.' }],
})

const installPreparationAndBuilderRoutes = async (page: Page): Promise<{ mutations: unknown[] }> => {
  let document = readyDocument()
  const mutations: unknown[] = []
  const projection = () => ({
    schemaVersion: 1, preparationId: document.preparationId, revision: document.revision, lifecycle: document.lifecycle,
    title: document.title, scheduledFor: document.scheduledFor, sceneCount: document.scenes.length,
    openDecisionCount: document.unresolvedDecisions.filter(row => row.state === 'open').length,
    selectedCandidateCount: document.scenes.flatMap(row => row.encounterCandidates).filter(row => row.selection === 'selected').length,
    updatedAt: document.updatedAt,
  })
  await page.route('**/api/gm-toolkit/session-preparations/list**', route => fulfill(route, { schemaVersion: 1, preparations: [projection()] }))
  await page.route('**/api/gm-toolkit/session-preparations/*', (route) => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname.endsWith('/list')) return route.fallback()
    return fulfill(route, { schemaVersion: 1, preparation: document })
  })
  await page.route('**/api/gm-toolkit/session-preparations/mutate', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    mutations.push(body)
    if (body.kind === 'transition' && body.target === 'ready') document = { ...document, revision: 1, lifecycle: 'ready', updatedAt: '2026-08-26T12:00:00.000Z' }
    return fulfill(route, { schemaVersion: 1, operationId: body.operationId, exactRetry: false, preparation: document })
  })
  await page.route('**/api/encounters/list**', route => fulfill(route, { schemaVersion: 1, tables: [tableProjection] }))
  const mapSummaries = [
    { slug: 'forest-map', name: 'Forest Map', folder: '', dimensions: { x: 12, y: 2, z: 12 }, placementCount: 0, playerVisible: true, schemaVersion: 2, revision: 0, updatedAt: 1 },
    { slug: 'research-map', name: 'Research Camp', folder: '', dimensions: { x: 12, y: 2, z: 12 }, placementCount: 0, playerVisible: true, schemaVersion: 2, revision: 0, updatedAt: 1 },
  ]
  await page.route('**/api/maps/list**', route => fulfill(route, { maps: mapSummaries }))
  await page.route('**/api/maps/folders**', route => fulfill(route, { folders: [] }))
  await page.route('**/api/maps/load**', route => fulfill(route, {
    map: {
      schemaVersion: 2, revision: 0, slug: 'forest-map', name: 'Forest Map', folder: '', dimensions: { x: 12, y: 2, z: 12 },
      placements: [], encounterState: { sides: { opposition: { id: 'opposition', label: 'Opposition', status: 'active' }, heroes: { id: 'heroes', label: 'Heroes', status: 'active' } } },
    },
  }))
  await page.route('**/api/sheets/list**', route => fulfill(route, { pokemonSheets: [], trainerSheets: [] }))
  await page.route('**/api/gm-toolkit/builder-handoff**', route => fulfill(route, {
    schemaVersion: 1,
    handoff: {
      schemaVersion: 1,
      handoff: { kind: 'session-preparation', documentId: document.preparationId, expectedRevision: 1, sceneId: 'scene:forest-arrival' },
      source: { label: document.title, sceneLabel: 'Forest arrival' },
      defaults: { name: 'Forest arrival', recipe: 'wild-pack', map: { slug: 'forest-map', expectedRevision: 0 }, publicStakes: 'The path narrows beneath an old canopy.', gmStakes: 'Keep the tracks concealed.', notes: 'North-trail arrival.', storyLocked: true },
      cast: [candidate(1, 'Cutiefly', 5), candidate(2, 'Weedle', 6), candidate(3, 'Pineco', 8)].map((row, index) => ({
        sheet: { kind: 'pokemon', slug: `forest-${row.speciesId.toLowerCase()}`, expectedRevision: 0 }, sourceCandidateId: row.candidateId,
        displayName: row.speciesId, displayLevel: row.level, placementIntent: { kind: index === 0 ? 'map-zone' : 'builder-default', zoneLabel: index === 0 ? 'North trail' : null },
      })),
    },
  }))
  await page.route('**/api/onboarding/encounter/eligibility**', route => fulfill(route, { candidates: [] }))
  return { mutations }
}

test('GM completes keyboard-addressable wild and NPC previews in production Workshop UI', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticate(page, 'gm')
  const { requests } = await installGenerationRoutes(page)
  await page.goto('/generate')
  await expect(page.getByRole('heading', { name: 'Campaign Toolkit', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Campaign Toolkit' }).getByRole('link', { name: 'Wild encounter' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Preview encounter' }).click()
  const reviewHeading = page.getByRole('heading', { name: 'Generated candidates' })
  await expect(reviewHeading).toBeFocused()
  await expect(page.getByText('Preview only — nothing has been saved')).toBeVisible()
  await expect(page.locator('.candidate-card')).toHaveCount(3)
  expect((await page.locator('.candidate-select').first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(await page.locator('.wild-workspace').innerText()).not.toContain('opaque-preview-authority')
  await page.getByRole('button', { name: 'Commit package' }).click()
  await expect(page.getByRole('heading', { name: '3 ordinary Pokémon sheets committed' })).toBeFocused()
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests)).not.toContain('seed')
  expect(JSON.stringify(requests)).not.toContain('journal')

  const npcLink = page.getByRole('navigation', { name: 'Campaign Toolkit' }).getByRole('link', { name: 'NPC Trainers' })
  await npcLink.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/npc-trainers$/)
  await page.getByLabel(/Trainer name/u).fill('Researcher Rowan')
  await page.getByLabel('Owned roster size').fill('6')
  await page.getByRole('button', { name: 'Preview NPC package' }).click()
  await expect(page.getByRole('heading', { name: 'Trainer and roster' })).toBeFocused()
  await expect(page.getByText('Preview only — nothing has been saved')).toBeVisible()
  await expect(page.locator('.pokemon-card')).toHaveCount(6)
  await expect(page.getByRole('complementary', { name: 'Private guided decisions' })).toContainText('Protect the survey team.')
  expect(await page.locator('.npc-workspace').innerText()).not.toContain('opaque-npc-preview-authority')
  expect(await seriousAxe(page, '.toolkit-page')).toEqual([])

  const overflow = await noHorizontalOverflow(page)
  expect(overflow, overflow.offenders.join(', ')).toMatchObject({ scroll: overflow.client })
  await screenshot(page, `${testInfo.project.name}-npc-preview.png`)
})

test('Ready multi-scene preparation restores focus, reflows, and opens one immutable Builder handoff', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticate(page, 'gm')
  const { mutations } = await installPreparationAndBuilderRoutes(page)
  await page.goto(`/session-prep?preparation=${encodeURIComponent(sessionFixture.document.preparationId)}`)
  await expect(page.getByRole('heading', { name: 'Under the Old Canopy', level: 2 })).toBeVisible()
  await expect(page.getByText('3 scenes')).toBeVisible()
  const ready = page.getByRole('button', { name: 'Ready for Builder' })
  await expect(ready).toBeEnabled()
  await ready.click()
  await expect(page.getByRole('heading', { name: 'Ready for Builder' })).toBeFocused()
  expect(mutations).toHaveLength(1)
  expect(mutations[0]).toMatchObject({ schemaVersion: 1, kind: 'transition', target: 'ready', expectedRevision: 0 })
  expect(JSON.stringify(mutations[0])).not.toMatch(/gmNotes|encounterCandidates|prompt|resolution/u)
  expect(await seriousAxe(page, '.toolkit-page')).toEqual([])
  await screenshot(page, `${testInfo.project.name}-session-ready.png`)

  const openBuilder = page.getByRole('link', { name: 'Open in Builder' }).first()
  await openBuilder.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/encounters\/new\?.*preparation=/)
  await expect(page.getByRole('heading', { name: 'Ready for Builder' })).toBeFocused()
  await expect(page.getByText('Current · immutable')).toBeVisible()
  await expect(page.getByText('Scene material · Ready preparation')).toBeVisible()
  await expect(page.locator('.encounter-builder__cast li')).toHaveCount(3)
  const firstRecipe = page.locator('.encounter-builder__recipes input').first()
  await firstRecipe.focus()
  expect(await firstRecipe.evaluate(element => getComputedStyle(element.parentElement!).outlineStyle)).not.toBe('none')
  expect(await seriousAxe(page, '.encounter-builder')).toEqual([])
  await screenshot(page, `${testInfo.project.name}-builder-handoff.png`)

  if (testInfo.project.name === 'chromium') {
    for (const width of [320, 160]) {
      await page.setViewportSize({ width, height: 900 })
      const overflow = await noHorizontalOverflow(page)
      expect(overflow, `${width}px: ${overflow.offenders.join(', ')}`).toMatchObject({ scroll: overflow.client })
    }
  } else {
    const overflow = await noHorizontalOverflow(page)
    expect(overflow, overflow.offenders.join(', ')).toMatchObject({ scroll: overflow.client })
  }
})

test('player liveplay structurally denies toolkit authority and receives no private destination', async ({ page }) => {
  await authenticate(page, 'player')
  const requested: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/gm-toolkit')) requested.push(new URL(request.url()).pathname) })
  await page.goto('/session-prep')
  await expect(page.getByRole('heading', { name: 'GM preparation workspace' })).toBeVisible()
  await expect(page.getByText('Private session scenes, candidate options, and notes are available only to the active GM.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Campaign Toolkit' })).toHaveCount(0)
  expect(await page.locator('body').innerText()).not.toMatch(/Private pacing|north-trail|Researcher Rowan/u)

  for (const path of [
    '/api/gm-toolkit/npc-archetypes',
    '/api/gm-toolkit/packages/wild/wild-package:v1:11111111111111111111111111111111',
    '/api/gm-toolkit/session-preparations/list',
    '/api/gm-toolkit/builder-handoff?kind=session-preparation&documentId=session-preparation:v1:old-canopy&expectedRevision=0&sceneId=scene:forest-arrival',
    `/api/encounters/export/${encodeURIComponent(forest.tableId)}`,
  ]) {
    const response = await page.request.get(path)
    expect(response.status(), path).toBe(403)
    expect(await response.text()).not.toMatch(/Private pacing|journal|sourceSha256|candidate-pools/u)
  }
  expect(requested).toEqual([])
})
