import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import type { TabletopMap } from '~/types/map'

const BASE_URL = 'http://127.0.0.1:3017'
const evidence = resolve('.pi/artifacts/ui-validation/battle-contest-encounter-link')
const joinedEvidence = resolve('.pi/artifacts/ui-validation/battle-contest-joined-liveplay')
const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}
const authenticate = async (context: BrowserContext, role: 'gm'|'player') => context.addCookies([{ name: 'rotom-role', value: role, url: BASE_URL, sameSite: 'Lax' }])
const preserveAcceptedScreenshot = async (page: Page, path: string, fullPage = true): Promise<void> => {
  if (existsSync(path) && process.env.ROTOM_REFRESH_UI_EVIDENCE !== '1') return
  await page.screenshot({ path, fullPage, animations: 'disabled' })
}
const createSheet = async (page: Page, kind: 'trainer'|'pokemon', patch: Record<string, unknown>) => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind, folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=${kind}&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', { data: { kind, slug, sheet: { ...sheet, ...patch }, interactionMode: 'setup-edit', expectedRevision: sheet.revision } }))
  return slug
}
const seriousViolations = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(row => row.impact === 'serious' || row.impact === 'critical')

test('GM atomically creates and opens the normal Battle Contest Encounter in production liveplay', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  mkdirSync(evidence, { recursive: true })
  mkdirSync(joinedEvidence, { recursive: true })
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await authenticate(gmContext, 'gm')
  const gm = await gmContext.newPage()
  const teams: Array<{ trainer: string, pokemon: string[] }> = []
  for (const [side, name, speed] of [['North', 'Mara', 18], ['South', 'Dax', 16]] as const) {
    const pokemon: string[] = []
    for (let index = 1; index <= 3; index += 1) pokemon.push(await createSheet(gm, 'pokemon', { nickname: `${side} ${index}`, species: 'Pikachu', level: 10, totalExp: 100, capabilities: { overland: 6 }, stats: { hp: { base: 20, added: 0 }, atk: { base: 20, added: 0, stage: 0 }, def: { base: 20, added: 0, stage: 0 }, satk: { base: 20, added: 0, stage: 0 }, sdef: { base: 20, added: 0, stage: 0 }, spd: { base: 20 + index, added: 0, stage: 0 } }, combatStages: { acc: 0 }, combat: { currentHp: 32, injuries: 0, conditions: [] }, movelist: [{ name: 'Agility' }] }))
    const trainer = await createSheet(gm, 'trainer', { name, level: 10, stats: { hp: { base: 10 }, atk: { base: 10 }, def: { base: 10 }, satk: { base: 10 }, sdef: { base: 10 }, spd: { base: speed } }, skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemon, inventory: {}, money: 0 })
    teams.push({ trainer, pokemon })
  }

  const ownerProfiles: Array<{ id: string, displayName: string }> = []
  for (const [index, team] of teams.entries()) {
    const displayName = index === 0 ? 'Mara' : 'Dax'
    const created = await parseOk(await gm.request.post('/api/player-profiles/create', { data: { displayName } }))
    const profile = created.profile as Record<string, any>
    await parseOk(await gm.request.post('/api/player-profiles/update', { data: {
      profileId: profile.id,
      displayName,
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: team.trainer },
        ...team.pokemon.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug })),
      ],
    } }))
    ownerProfiles.push({ id: String(profile.id), displayName })
  }

  const runId = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const contestId = `contest:v1:e2e-battle-link-${runId}`
  let sequence = 0
  const command = async (body: Record<string, unknown>) => parseOk(await gm.request.post('/api/contests/command', { data: { schemaVersion: 1, operationId: `contest-op:v1:e2e-battle-link-${runId}-${sequence++}`, contestId, clientId: 'battle-encounter-link-e2e', ...body } }))
  let response = await command({ commandKind: 'create-contest', expectedRevision: 0, settings: { name: 'Neon Circuit Clash', hallName: 'Castelia Hall', description: '', variantId: 'battle', participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private opening strategy' } })
  for (const [index, team] of teams.entries()) response = await command({ commandKind: 'enroll-contestant', expectedRevision: response.result.revision, contestantId: `contestant:e2e-link-${index + 1}`, trainerSheetSlug: team.trainer, pokemonSheetSlugs: team.pokemon, controller: { kind: 'profile', profileId: ownerProfiles[index]!.id }, rotationOrder: [] })
  response = await command({ commandKind: 'start-introduction', expectedRevision: response.result.revision })
  for (const [index, skillId, generatedStatId] of [[0, 'command', 'cool'], [1, 'charm', 'cute']] as const) response = await command({ commandKind: 'declare-introduction', expectedRevision: response.result.revision, contestantId: `contestant:e2e-link-${index + 1}`, skillId, generatedStatId, bonusStatIds: {} })

  await gm.goto(`/contests/${encodeURIComponent(contestId)}`)
  await expect(gm.getByRole('heading', { name: 'Both team pools are ready' })).toBeVisible()
  const create = gm.getByRole('button', { name: 'Create & link Battle encounter' })
  await expect(create).toBeEnabled()
  expect((await create.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await expect(gm.getByText('2 Trainers + 2 active Pokémon')).toBeVisible()
  await expect(gm.getByText('Round 1 · current Speed')).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-ready-to-link.png`))

  await create.focus(); await expect(create).toBeFocused(); await gm.keyboard.press('Enter')
  await expect(gm.getByRole('heading', { name: 'Battle encounter linked' })).toBeFocused()
  await expect(gm.getByRole('link', { name: 'Open live encounter' })).toBeVisible()
  await expect(gm.getByText('4 deployed', { exact: true })).toBeVisible()
  await expect(gm.getByText('4 ready', { exact: true })).toBeVisible()
  await expect(gm.getByText('Contest scoring is waiting for accepted encounter results.')).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-linked.png`))

  const gmContest = (await parseOk(await gm.request.get(`/api/contests/${encodeURIComponent(contestId)}`))).contest as Record<string, any>
  expect(gmContest.stage).toBe('performance')
  expect(gmContest.battle.encounter).toMatchObject({ status: 'linked', openingRound: 1, deployedCount: 4, readyReserveCount: 4 })
  const encounterId = String(gmContest.battle.encounter.encounterId)
  const mapSlug = String(gmContest.battle.encounter.mapSlug)
  const mode = await parseOk(await gm.request.get(`/api/maps/interaction-mode?slug=${encodeURIComponent(mapSlug)}`))
  expect(mode.interactionMode).toBe('live-play')
  const loadedMap = await parseOk(await gm.request.get(`/api/maps/load?slug=${encodeURIComponent(mapSlug)}`))
  expect(loadedMap.map.placements).toHaveLength(4)
  expect(loadedMap.map.initiative).toMatchObject({ round: 1 })
  expect(loadedMap.map.initiative.activeId).toBeTruthy()
  expect(Object.keys(loadedMap.map.encounterState.sides)).toHaveLength(2)
  const workspace = await parseOk(await gm.request.get(`/api/encounter-workspace/load?slug=${encodeURIComponent(encounterId)}&audience=gm`))
  expect(workspace.source).toMatchObject({ mapSlug })
  expect(workspace.participants).toHaveLength(4)
  expect(workspace.turn).toMatchObject({ round: 1 })

  await gm.setViewportSize({ width: 320, height: 800 })
  await gm.reload()
  await expect(gm.getByRole('heading', { name: 'Battle encounter linked' })).toBeVisible()
  expect(await gm.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-linked-320.png`))

  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await authenticate(publicContext, 'player')
  const spectator = await publicContext.newPage()
  await spectator.goto(`/contests/${encodeURIComponent(contestId)}`)
  await expect(spectator.getByRole('heading', { name: 'Battle encounter linked' })).toBeVisible()
  await expect(spectator.locator('.battle-pool-strip')).toHaveCount(0)
  await expect(spectator.getByText('The two accepted team pools remain private')).toBeVisible()
  await expect(spectator.getByText('private opening strategy')).toHaveCount(0)
  const publicProjection = (await parseOk(await spectator.request.get(`/api/contests/${encodeURIComponent(contestId)}`))).contest
  expect(publicProjection.battle.encounter).toEqual({ status: 'linked', encounterId, mapSlug, openingRound: 1, deployedCount: 4, readyReserveCount: 4 })
  const publicJson = JSON.stringify(publicProjection)
  for (const forbidden of ['teamDicePools', 'battle-contest-link:v1:', 'contestRosterSha256', 'sceneId', 'openingInitiativeOrderIds', 'trainerSheetSlug', 'pokemonSheetSlug', 'providerIds', 'operationId', 'private opening strategy']) expect(publicJson).not.toContain(forbidden)
  expect(await seriousViolations(spectator)).toEqual([])

  await gm.getByRole('link', { name: 'Open live encounter' }).click()
  await expect(gm).toHaveURL(new RegExp(`/play/${encodeURIComponent(encounterId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  await expect(gm.getByRole('main', { name: 'Battle stage' }).getByRole('heading', { level: 1 })).toHaveText('Mara')
  await expect(gm.getByRole('region', { name: 'Turn order' }).getByRole('listitem')).toHaveCount(4)

  await gm.setViewportSize({ width: 1440, height: 1000 })
  let battleMap = (await parseOk(await gm.request.get(`/api/maps/load?slug=${encodeURIComponent(mapSlug)}`))).map as TabletopMap
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active = battleMap.placements.find(placement => placement.id === battleMap.initiative?.activeId)
    if (active?.sheetKind === 'pokemon') break
    const postAdvance = async (orderIds: readonly string[], activeId: string | null, round: number, suffix: string) => parseOk(await gm.request.post('/api/maps/initiative/next', { data: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: `op_e2e_battle_advance_${attempt}_${suffix}_${Date.now().toString(36)}`,
      mapSlug,
      baseRevision: battleMap.revision,
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
      payload: { orderIds, activeId, round },
      clientId: 'battle-joined-liveplay-e2e',
    } }))
    let advanced = await postAdvance(battleMap.initiative?.orderIds ?? [], battleMap.initiative?.activeId ?? null, battleMap.initiative?.round ?? 1, 'visible')
    if (advanced.ok === false) {
      const current = advanced.currentState as { orderIds: string[], initiative: { activeId: string | null, round: number } }
      advanced = await postAdvance(current.orderIds, current.initiative.activeId, current.initiative.round, 'authoritative')
    }
    expect(advanced.ok).toBe(true)
    battleMap = (await parseOk(await gm.request.get(`/api/maps/load?slug=${encodeURIComponent(mapSlug)}`))).map as TabletopMap
  }
  const actorPlacementId = battleMap.initiative?.activeId ?? ''
  const actorPlacement = battleMap.placements.find(placement => placement.id === actorPlacementId)
  expect(actorPlacement?.sheetKind).toBe('pokemon')
  const intent = { schemaVersion: 1 as const, placementId: actorPlacementId, moveName: 'Agility', selection: { kind: 'self' as const } }
  const moveScopes = buildResolveMoveScopes({ map: battleMap, intent, candidateScopePlacementIds: [] })
  expect(moveScopes.ok).toBe(true)
  if (!moveScopes.ok) throw new Error(moveScopes.message)
  const moveResult = await parseOk(await gm.request.post('/api/maps/tokens/resolve-move', { data: {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: `op_e2e_battle_joined_${Date.now().toString(36)}`,
    mapSlug,
    baseRevision: battleMap.revision,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: moveScopes.scopes,
    payload: intent,
    clientId: 'battle-joined-liveplay-e2e',
  } }))
  expect(moveResult.ok).toBe(true)

  const gmDecision = gm.getByRole('dialog', { name: /Score Agility.*Contest Appeal/u })
  await expect(gmDecision).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Next initiative turn' })).toBeDisabled()
  await expect(gm.locator('.battle-contest-panel__scores > li')).toHaveCount(2)
  await expect(gm.locator('.battle-contest-panel__scores ul li')).toHaveCount(6)
  await expect(gm.locator('.battle-contest-panel__pool')).toHaveCount(2)
  const availableAdd = gmDecision.locator('button[aria-label^="Add one"]:not([disabled])').first()
  await expect(availableAdd).toBeVisible()
  await availableAdd.focus(); await expect(availableAdd).toBeFocused(); await availableAdd.click()
  await expect(gmDecision.getByText('1 team die selected')).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(joinedEvidence, `${testInfo.project.name}-gm-pending-wide.png`))

  const actingTeamIndex = teams.findIndex(team => team.pokemon.includes(actorPlacement!.sheetSlug))
  expect(actingTeamIndex).toBeGreaterThanOrEqual(0)
  const actingOwner = ownerProfiles[actingTeamIndex]!
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await authenticate(ownerContext, 'player')
  await ownerContext.addInitScript(({ profileId, displayName }) => {
    localStorage.setItem('rotom:player-profile:selection', JSON.stringify({ schemaVersion: 1, profileId, displayName, rememberedAt: new Date().toISOString() }))
  }, { profileId: actingOwner.id, displayName: actingOwner.displayName })
  const owner = await ownerContext.newPage()
  await owner.goto(`/play/${encodeURIComponent(encounterId)}`)
  await expect(owner.getByRole('dialog', { name: /Score Agility.*Contest Appeal/u })).toBeVisible()
  await expect(owner.locator('.battle-contest-panel__pool')).toHaveCount(1)
  await expect(owner.locator('.battle-contest-panel__scores ul li')).toHaveCount(6)
  const ownerProjection = await parseOk(await owner.request.get(`/api/contests/battle-liveplay?encounterId=${encodeURIComponent(encounterId)}&profileId=${encodeURIComponent(actingOwner.id)}`))
  expect(ownerProjection.battleContest).toMatchObject({ audience: 'owner', pendingAppeal: { canResolve: true } })
  expect(ownerProjection.battleContest.visibleTeamPools).toHaveLength(1)
  const ownerJson = JSON.stringify(ownerProjection)
  for (const forbidden of ['sheetSlug', 'providerId', 'operationId', 'sourceOperation', 'sourceResult', 'resolutionId', 'handoffSha256', 'linkId', 'placementId', 'private opening strategy']) expect(ownerJson).not.toContain(forbidden)
  expect(await seriousViolations(owner)).toEqual([])
  await preserveAcceptedScreenshot(owner, resolve(joinedEvidence, `${testInfo.project.name}-owner-pending-wide.png`))

  // Public Encounter projection may be previewed by the authenticated GM without selecting a player profile.
  await authenticate(publicContext, 'gm')
  await spectator.goto(`/play/${encodeURIComponent(encounterId)}?view=public`)
  await expect(spectator.getByText(/is choosing Contest Dice/u)).toBeVisible()
  await expect(spectator.getByRole('button', { name: 'Score Appeal' })).toHaveCount(0)
  await expect(spectator.locator('.battle-contest-panel__pool')).toHaveCount(0)
  await expect(spectator.locator('.battle-contest-panel__scores ul li')).toHaveCount(6)
  expect(await seriousViolations(spectator)).toEqual([])
  await preserveAcceptedScreenshot(spectator, resolve(joinedEvidence, `${testInfo.project.name}-public-pending-wide.png`))
  await spectator.setViewportSize({ width: 320, height: 800 })
  await expect(spectator.getByText(/is choosing Contest Dice/u)).toBeVisible()
  await expect(spectator.locator('.battle-contest-mobile-score')).toBeVisible()
  expect(await spectator.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  expect(await seriousViolations(spectator)).toEqual([])
  await spectator.getByRole('button', { name: 'Toggle action dock' }).click()
  await spectator.locator('.battle-contest-mobile-score').scrollIntoViewIfNeeded()
  await preserveAcceptedScreenshot(spectator, resolve(joinedEvidence, `${testInfo.project.name}-public-pending-320.png`), false)

  await gmDecision.getByRole('button', { name: 'Score Appeal' }).click()
  await expect(gm.getByText('Contest Appeal accepted.')).toBeVisible()
  await expect(gmDecision).toHaveCount(0)
  await expect(gm.getByText('Latest accepted Appeal')).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Next initiative turn' })).toBeEnabled()
  await expect(spectator.getByText(/is choosing Contest Dice/u)).toHaveCount(0)
  await spectator.getByRole('button', { name: 'Decisions & history' }).click()
  await expect(spectator.getByText('Latest accepted Appeal')).toBeVisible()
  await preserveAcceptedScreenshot(gm, resolve(joinedEvidence, `${testInfo.project.name}-gm-accepted-wide.png`))
  const joinedPublic = await parseOk(await spectator.request.get(`/api/contests/battle-liveplay?encounterId=${encodeURIComponent(encounterId)}&view=public`))
  const joinedJson = JSON.stringify(joinedPublic)
  for (const forbidden of ['sheetSlug', 'providerId', 'operationId', 'sourceOperation', 'sourceResult', 'resolutionId', 'handoffSha256', 'linkId', 'placementId', 'private opening strategy']) expect(joinedJson).not.toContain(forbidden)
  await expect(owner.getByRole('dialog', { name: /Score Agility.*Contest Appeal/u })).toHaveCount(0)
  await expect(owner.getByText('Latest accepted Appeal')).toBeVisible()
  await owner.setViewportSize({ width: 390, height: 844 })
  await owner.getByRole('button', { name: 'Decisions & history' }).click()
  await owner.locator('.battle-contest-panel').scrollIntoViewIfNeeded()
  expect(await owner.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(392)
  expect(await seriousViolations(owner)).toEqual([])
  await owner.locator('.battle-contest-panel').scrollIntoViewIfNeeded()
  await owner.evaluate(() => window.scrollBy(0, 150))
  await preserveAcceptedScreenshot(owner, resolve(joinedEvidence, `${testInfo.project.name}-owner-accepted-390.png`), false)

  await ownerContext.close()
  await publicContext.close()
  await gmContext.close()
})
