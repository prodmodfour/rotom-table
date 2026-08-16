import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type APIResponse, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEncounterSettlementDocument, parseEncounterSettlementDocument } from '../../shared/encounterSettlement/document'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const BASE_URL = 'http://127.0.0.1:3017'
const evidenceRoot = resolve('.pi/artifacts/ui-validation/finish-encounter')

const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'gm', url: BASE_URL, sameSite: 'Lax',
  }])
}

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

const createSheet = async (page: Page, input: {
  kind: 'pokemon' | 'trainer'
  name: string
  patch: (sheet: Record<string, any>) => Record<string, any>
}): Promise<{ slug: string, revision: number }> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: input.kind, folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=${input.kind}&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  const saved = await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: input.kind,
      slug,
      sheet: input.patch(sheet),
      interactionMode: 'setup-edit',
      expectedRevision: sheet.revision,
    },
  }))
  return { slug, revision: Number((saved.sheet as Record<string, any> | undefined)?.revision ?? sheet.revision + 1) }
}

const seedSettlementDraft = (input: {
  settlementId: string
  encounterId: string
  encounterRevision: number
  mapSlug: string
  mapRevision: number
}): void => {
  const database = new DatabaseSync(resolve('.playwright-campaign/rotom-table.sqlite'))
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  try {
    const row = database.prepare('SELECT campaign_minute FROM campaign_clock WHERE singleton = 1').get() as { campaign_minute: number } | undefined
    const campaignMinute = Number(row?.campaign_minute)
    const draft = createEncounterSettlementDocument({
      settlementId: input.settlementId,
      rewardPackageId: `rewards-${input.encounterId}`,
      encounter: {
        encounterId: input.encounterId,
        encounterRevision: input.encounterRevision,
        linkedMapSlug: input.mapSlug,
        linkedMapRevision: input.mapRevision,
        campaignMinute,
      },
    })
    const document = parseEncounterSettlementDocument({
      ...draft,
      rewardPackage: {
        ...draft.rewardPackage,
        status: 'ready',
        lines: [{
          rewardId: `reward-xp-${input.encounterId}`,
          visibility: 'participant-owner',
          sourceAuthority: { kind: 'encounter-document', id: input.encounterId, revision: input.encounterRevision },
          disposition: 'pending',
          payload: { kind: 'experience', amount: 10 },
        }, {
          rewardId: `reward-money-${input.encounterId}`,
          visibility: 'destination-owner',
          sourceAuthority: { kind: 'encounter-document', id: input.encounterId, revision: input.encounterRevision },
          disposition: 'pending',
          payload: { kind: 'money', amount: 500 },
        }],
      },
    })
    const documentJson = stableJsonStringify(document)
    const definitionSha256 = createHash('sha256').update(documentJson).digest('hex')
    database.prepare(`
      INSERT INTO encounter_settlements (
        settlement_id, encounter_id, status, revision, document_json, definition_sha256,
        created_at_campaign_minute, updated_at_campaign_minute, completion_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      document.settlementId,
      document.encounter.encounterId,
      document.status,
      document.revision,
      documentJson,
      definitionSha256,
      document.createdAtCampaignMinute,
      document.updatedAtCampaignMinute,
    )
  }
  finally {
    database.close()
  }
}

const createTrainerDuel = async (page: Page, projectName: string) => {
  const ally = await createSheet(page, {
    kind: 'pokemon', name: 'Sprig',
    patch: sheet => ({
      ...sheet,
      nickname: `Sprig ${projectName}`,
      species: 'Bulbasaur',
      level: 10,
      totalExp: 90,
      combat: { ...(sheet.combat ?? {}), currentHp: 13, injuries: 1, conditions: ['Poisoned'] },
      stats: {
        hp: { base: 5, added: 0 }, atk: { base: 5, added: 0 }, def: { base: 5, added: 0 },
        satk: { base: 5, added: 0 }, sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
      },
    }),
  })
  const hero = await createSheet(page, {
    kind: 'trainer', name: 'Mira',
    patch: sheet => ({
      ...sheet,
      name: `Mira ${projectName}`,
      portraitUrl: '/profile-sprites/trainers/red-gen7.png',
      level: 8,
      currentTeam: [ally.slug],
      boxedPokemon: [],
      inventory: sheet.inventory ?? {},
    }),
  })
  const rival = await createSheet(page, {
    kind: 'trainer', name: 'Rival',
    patch: sheet => ({
      ...sheet,
      name: `Rival ${projectName}`,
      portraitUrl: '/profile-sprites/trainers/blue-gen7.png',
      level: 8,
      currentTeam: [],
      boxedPokemon: [],
      inventory: sheet.inventory ?? {},
    }),
  })
  const projectKey = projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const mapName = `Finish Duel ${projectKey}`
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: mapName, dimensions: { x: 8, y: 2, z: 8 } },
  }))
  const map = created.map as Record<string, any>
  const mapSlug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug: mapSlug, interactionMode: 'setup-edit' },
  }))
  const scene = { name: 'Training bout', startedAt: Date.now() - 60_000 }
  const savedMap = await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug: mapSlug,
      expectedRevision: map.revision,
      interactionMode: 'setup-edit',
      map: {
        ...map,
        activeScene: scene,
        playerVisible: true,
        placements: [{
          id: `ally-trainer-${mapSlug}`, sheetKind: 'trainer', sheetSlug: hero.slug, sideId: 'heroes',
          position: { x: 1, y: 0, z: 1 }, initiative: 16,
        }, {
          id: `ally-pokemon-${mapSlug}`, sheetKind: 'pokemon', sheetSlug: ally.slug, sideId: 'heroes',
          position: { x: 2, y: 0, z: 1 }, initiative: 14,
        }, {
          id: `rival-trainer-${mapSlug}`, sheetKind: 'trainer', sheetSlug: rival.slug, sideId: 'rivals',
          position: { x: 6, y: 0, z: 6 }, initiative: 12,
        }],
        initiative: {
          activeId: `ally-pokemon-${mapSlug}`,
          round: 4,
          manualOrderIds: [`ally-trainer-${mapSlug}`, `ally-pokemon-${mapSlug}`, `rival-trainer-${mapSlug}`],
        },
        temporaryHitPoints: { scene, byPlacementId: { [`ally-pokemon-${mapSlug}`]: 4 } },
        fieldEffects: { weather: [{ kind: 'rainy', rounds: 2 }], terrains: [], rooms: [] },
        encounterState: {
          ...createEmptyEncounterState(),
          sides: {
            heroes: { id: 'heroes', label: 'Mira', status: 'active', color: '#34d399' },
            rivals: { id: 'rivals', label: 'Rival', status: 'active', color: '#ef4444' },
          },
        },
      },
    },
  }))
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug: mapSlug, interactionMode: 'live-play' },
  }))
  const encounterId = `encounter-finish-${projectKey}`
  const initializedEncounter = await parseOk(await page.request.post('/api/encounter-documents/initialize', {
    data: { encounterId, mapSlug, name: mapName, recipe: 'trainer-duel' },
  }))
  const encounter = await parseOk(await page.request.post('/api/encounter-documents/director-command', {
    data: {
      schemaVersion: 1,
      commandId: `activate-finish-duel-${projectKey}`,
      encounterId,
      baseRevision: Number(initializedEncounter.revision),
      type: 'set-story',
      payload: { name: mapName, lifecycle: 'active', publicStakes: null, gmStakes: null, notes: null },
    },
  }))
  const groupBefore = await parseOk(await page.request.get('/api/group-inventory/load?slug=main'))
  seedSettlementDraft({
    settlementId: `encounter-settlement:${encounterId}`,
    encounterId,
    encounterRevision: Number(encounter.revision),
    mapSlug,
    mapRevision: Number((savedMap.map as Record<string, any> | undefined)?.revision ?? map.revision + 1),
  })
  return {
    mapSlug,
    allySlug: ally.slug,
    initialMoney: Number(groupBefore.money),
    initialExp: 90,
  }
}

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

const assertPlayerPrivacy = async (browser: Browser, mapSlug: string): Promise<void> => {
  const context = await browser.newContext()
  try {
    await context.addCookies([{ name: 'rotom-role', value: 'player', url: BASE_URL, sameSite: 'Lax' }])
    const player = await context.newPage()
    await player.goto(`/play/${mapSlug}`)
    await expect(player.getByRole('button', { name: 'Director', exact: true })).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'Finish Encounter', exact: true })).toHaveCount(0)
    await expect(player.getByRole('dialog', { name: 'Finish Encounter' })).toHaveCount(0)
  }
  finally {
    await context.close()
  }
}

test('GM reviews and atomically finishes a trainer duel without sheet repair', async ({ browser, page }, testInfo) => {
  test.setTimeout(180_000)
  await authenticateGm(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const mobile = testInfo.project.name.includes('mobile')
  if (mobile) await page.setViewportSize({ width: 320, height: 800 })
  const fixture = await createTrainerDuel(page, testInfo.project.name)

  await page.goto(`/play/${fixture.mapSlug}`)
  await expect(page.getByRole('heading', { name: new RegExp(`Sprig ${testInfo.project.name}`), level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Director', exact: true }).click()
  const director = page.locator('.encounter-director')
  await director.getByRole('tab', { name: 'System', exact: true }).click()
  const startedAt = Date.now()
  await director.getByRole('button', { name: 'Finish Encounter', exact: true }).click()

  const finish = page.getByRole('dialog', { name: 'Finish Encounter' })
  await expect(finish).toBeVisible()
  await expect(finish.getByRole('heading', { name: 'Finish Encounter', level: 2 })).toBeFocused()
  await expect(finish.getByRole('heading', { name: 'Ready to settle' })).toBeVisible()
  await expect(finish).toContainText('No unresolved decisions')
  await expect(finish).toContainText('10 XP')
  await expect(finish).toContainText('₽500')
  await expect(finish.getByRole('region', { name: 'Persistent consequences' })).toBeVisible()
  await expect(finish.getByRole('region', { name: 'Rewards & allocations' })).toBeVisible()
  await expect(finish.getByRole('region', { name: 'Encounter outcome' })).toBeVisible()
  await expect(finish.getByRole('region', { name: 'Temporary cleanup' })).toBeVisible()
  await expect(finish.getByRole('region', { name: 'Outstanding work' })).toBeVisible()
  await assertNoHorizontalOverflow(page)

  const primary = finish.getByRole('button', { name: 'Finish encounter', exact: true })
  await expect(primary).toBeDisabled()
  const confirmation = finish.getByLabel('I reviewed this settlement and understand it cannot be partly applied.')
  await confirmation.check()
  await expect(primary).toBeEnabled()
  const primaryBox = await primary.boundingBox()
  expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(44)

  mkdirSync(evidenceRoot, { recursive: true })
  await page.mouse.move(0, 0)
  await page.screenshot({
    path: resolve(evidenceRoot, `${testInfo.project.name}-ready.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  })

  const axe = await new AxeBuilder({ page })
    .include('.finish-encounter')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])

  await primary.click()
  await expect(finish.getByRole('heading', { name: 'Encounter finished' })).toBeVisible()
  expect(Date.now() - startedAt).toBeLessThanOrEqual(120_000)
  await expect(page).toHaveURL(new RegExp(`/play/${fixture.mapSlug}(?:\\?|$)`))
  await expect(finish.locator('.finish-encounter__back')).toHaveText('Back to encounter')

  const pokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${fixture.allySlug}`))
  expect(Number((pokemon.sheet as Record<string, any>).totalExp)).toBe(fixture.initialExp + 10)
  expect((pokemon.sheet as Record<string, any>).combat).toMatchObject({ currentHp: 13, injuries: 1, conditions: ['Poisoned'] })
  const group = await parseOk(await page.request.get('/api/group-inventory/load?slug=main'))
  expect(Number(group.money)).toBe(fixture.initialMoney + 500)
  const map = await parseOk(await page.request.get(`/api/maps/load?slug=${fixture.mapSlug}`))
  expect((map.map as Record<string, any>).placements).toHaveLength(3)
  expect((map.map as Record<string, any>).initiative).toEqual({ activeId: null, round: 1 })
  expect((map.map as Record<string, any>).fieldEffects.weather).toEqual([])

  if (mobile) {
    await assertNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 160, height: 800 })
    await expect(finish.getByRole('heading', { name: 'Encounter finished' })).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 320, height: 800 })
  }
  else {
    await assertPlayerPrivacy(browser, fixture.mapSlug)
  }
  await page.mouse.move(0, 0)
  await page.screenshot({
    path: resolve(evidenceRoot, `${testInfo.project.name}-accepted.png`),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  })
})
