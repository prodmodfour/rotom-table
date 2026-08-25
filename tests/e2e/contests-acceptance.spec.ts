import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const BASE_URL = 'http://127.0.0.1:3017'
const evidence = resolve('.pi/artifacts/ui-validation/contests')
const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}
const authenticate = async (context: BrowserContext, role: 'gm'|'player') => context.addCookies([{ name: 'rotom-role', value: role, url: BASE_URL, sameSite: 'Lax' }])
const createSheet = async (page: Page, kind: 'trainer'|'pokemon', patch: Record<string, unknown>) => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind, folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=${kind}&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  const saved = await parseOk(await page.request.post('/api/sheets/save', { data: { kind, slug, sheet: { ...sheet, ...patch }, interactionMode: 'setup-edit', expectedRevision: sheet.revision } }))
  return { slug, revision: Number((saved.sheet as Record<string, any>).revision) }
}
const seriousViolations = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(row => row.impact === 'serious' || row.impact === 'critical')
const preserveAcceptedScreenshot = async (page: Page, path: string): Promise<void> => {
  if (existsSync(path) && process.env.ROTOM_REFRESH_UI_EVIDENCE !== '1') return
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
}

test('live Contest is keyboard/touch/reflow accessible and converges for GM and spectator through settlement', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  mkdirSync(evidence, { recursive: true })
  const gmContext = await browser.newContext()
  await authenticate(gmContext, 'gm')
  const gm = await gmContext.newPage()
  await gm.goto('/contests')
  await expect(gm.getByRole('heading', { name: 'Pokémon Contests' })).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  const indexViewport = gm.viewportSize() ?? { width: 1280, height: 720 }
  await gm.setViewportSize({ width: 320, height: 800 })
  expect(await gm.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  await gm.setViewportSize(indexViewport)
  const sheets: Array<{ trainer: string, pokemon: string }> = []
  for (let index = 0; index < 3; index += 1) {
    const trainerName = index === 0 ? 'Contest Trainer with an Exceptionally Long Stage Name' : `Contest Trainer ${index + 1}`
    const pokemonName = index === 0 ? 'Contest Partner with an Exceptionally Long Nickname' : `Contest Partner ${index + 1}`
    const trainer = await createSheet(gm, 'trainer', { name: trainerName, level: 5, skills: {}, inventory: {}, money: 0 })
    const pokemon = await createSheet(gm, 'pokemon', { nickname: pokemonName, species: 'Pikachu', level: 10, totalExp: 100, stats: { hp: { base: 20 }, atk: { base: 20 }, def: { base: 20 }, satk: { base: 20 }, sdef: { base: 20 }, spd: { base: 20 } }, movelist: [{ name: 'Charm' }, { name: 'Growl' }] })
    sheets.push({ trainer: trainer.slug, pokemon: pokemon.slug })
  }
  const ownerProfiles: Array<{ id: string, displayName: string }> = []
  for (let index = 0; index < 2; index += 1) {
    const displayName = `Contest Owner ${index + 1} ${Date.now().toString(36)}`
    const created = await parseOk(await gm.request.post('/api/player-profiles/create', { data: { displayName } }))
    const profile = created.profile as Record<string, any>
    await parseOk(await gm.request.post('/api/player-profiles/update', { data: { profileId: profile.id, displayName, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: sheets[index]!.trainer }, { sheetKind: 'pokemon', sheetSlug: sheets[index]!.pokemon }] } }))
    ownerProfiles.push({ id: String(profile.id), displayName })
  }
  const contestId = `contest:v1:e2e-${Date.now().toString(36)}`
  let sequence = 0
  const command = async (body: Record<string, unknown>) => parseOk(await gm.request.post('/api/contests/command', { data: { schemaVersion: 1, operationId: `contest-op:v1:e2e-${Date.now().toString(36)}-${sequence++}`, contestId, clientId: 'e2e', ...body } }))
  let response = await command({ commandKind: 'create-contest', expectedRevision: 0, settings: { name: 'Golden Live Contest', hallName: 'Jubilife Hall', description: 'A liveplay acceptance fixture.', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 250, items: [], notes: '' }, gmNotes: 'GM-only acceptance note' } })
  for (let index = 0; index < sheets.length; index += 1) response = await command({ commandKind: 'enroll-contestant', expectedRevision: response.result.revision, contestantId: `contestant:e2e-${index}`, trainerSheetSlug: sheets[index]!.trainer, pokemonSheetSlugs: [sheets[index]!.pokemon], controller: index < ownerProfiles.length ? { kind: 'profile', profileId: ownerProfiles[index]!.id } : { kind: 'gm' }, rotationOrder: [] })
  await gm.goto(`/contests/${encodeURIComponent(contestId)}`)
  await expect(gm.getByRole('heading', { name: 'Enroll contestants' })).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-setup.png`))
  response = await command({ commandKind: 'start-introduction', expectedRevision: response.result.revision })
  await expect(gm.getByRole('heading', { name: 'Make an impression' })).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])
  for (let index = 0; index < sheets.length; index += 1) response = await command({ commandKind: 'declare-introduction', expectedRevision: response.result.revision, contestantId: `contestant:e2e-${index}`, skillId: 'charm', generatedStatId: 'cute' })
  response = await command({ commandKind: 'start-performance', expectedRevision: response.result.revision })

  const ownerContexts = await Promise.all(ownerProfiles.map(async (profile) => {
    const context = await browser.newContext(); await authenticate(context, 'player')
    await context.addInitScript(({ profileId, displayName }) => { localStorage.setItem('rotom:player-profile:selection', JSON.stringify({ schemaVersion: 1, profileId, displayName, rememberedAt: new Date().toISOString() })) }, { profileId: profile.id, displayName: profile.displayName })
    return context
  }))
  const ownerPages = await Promise.all(ownerContexts.map(context => context.newPage()))
  const spectatorContext = await browser.newContext()
  await authenticate(spectatorContext, 'player')
  const spectator = await spectatorContext.newPage()
  await Promise.all([gm.reload(), ...ownerPages.map(page => page.goto(`/contests/${encodeURIComponent(contestId)}`)), spectator.goto(`/contests/${encodeURIComponent(contestId)}`)])
  await expect(gm.getByRole('heading', { name: 'Golden Live Contest' })).toBeVisible()
  await expect(gm.getByRole('heading', { name: 'Your appeal' })).toBeVisible()
  await expect(spectator.getByRole('heading', { name: 'Appeal in progress' })).toBeVisible()
  for (const [index, ownerPage] of ownerPages.entries()) {
    const ownerProjection = (await parseOk(await ownerPage.request.get(`/api/contests/${encodeURIComponent(contestId)}?profileId=${ownerProfiles[index]!.id}`))).contest
    expect(ownerProjection.audience).toBe('owner')
    expect(ownerProjection.ownContestant.trainerSheetSlug).toBe(sheets[index]!.trainer)
    await expect(ownerPage.getByText('GM-only acceptance note')).toHaveCount(0)
  }
  const publicProjection = (await parseOk(await spectator.request.get(`/api/contests/${encodeURIComponent(contestId)}`))).contest
  expect(publicProjection.contestants).toBeUndefined()
  await expect(spectator.getByText('Private Move offers and dice pools remain visible only')).toBeVisible()
  await expect(spectator.getByText('GM-only acceptance note')).toHaveCount(0)
  expect(await seriousViolations(gm)).toEqual([])
  expect(await seriousViolations(spectator)).toEqual([])
  await gm.emulateMedia({ reducedMotion: 'reduce' })
  expect(await gm.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-performance.png`))

  const firstMove = gm.locator('.move-options label').filter({ hasText: 'Charm' }).first()
  await firstMove.click()
  const submit = gm.getByRole('button', { name: 'Submit appeal' })
  await submit.focus()
  await expect(submit).toBeFocused()
  expect((await submit.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await gm.keyboard.press('Enter')
  await expect(gm.getByRole('heading', { name: 'Your appeal' })).toBeFocused()
  await expect(gm.getByRole('heading', { name: 'Accepted results' })).toBeVisible()
  await expect(gm.locator('.result-row')).toHaveCount(1)
  await expect.poll(async () => spectator.locator('.result-row').count(), { timeout: 15_000 }).toBe(1)
  for (const ownerPage of ownerPages) await expect.poll(async () => ownerPage.locator('.result-row').count(), { timeout: 15_000 }).toBe(1)

  response = await parseOk(await gm.request.get(`/api/contests/${encodeURIComponent(contestId)}`))
  let projection = response.contest as Record<string, any>
  while (projection.stage === 'performance') {
    const actor = projection.contestants.find((row: Record<string, any>) => row.contestantId === projection.activeContestantId)
    const performer = actor.performers[projection.variantId === 'rotation' ? actor.rotationOrder[projection.round - 1] : 0]
    const move = performer.moves.find((row: Record<string, any>) => row.available && row.optionId !== actor.lastMoveOptionId) ?? performer.moves.find((row: Record<string, any>) => row.available)
    response = await command({ commandKind: 'declare-appeal', expectedRevision: projection.revision, contestantId: actor.contestantId, performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 } })
    projection = response.projection as Record<string, any>
  }
  await expect.poll(async () => (await parseOk(await spectator.request.get(`/api/contests/${encodeURIComponent(contestId)}`))).contest.stage).toBe('settling')
  await gm.reload()
  await expect(gm.getByRole('heading', { name: 'Settlement' })).toBeVisible()
  expect(await seriousViolations(gm)).toEqual([])

  const originalViewport = gm.viewportSize() ?? { width: 1280, height: 720 }
  await gm.setViewportSize({ width: 320, height: 800 })
  await gm.reload()
  await expect(gm.getByRole('heading', { name: 'Settlement' })).toBeVisible()
  expect(await gm.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-settlement-320.png`))
  await gm.setViewportSize(originalViewport)
  await gm.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await gm.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= (document.scrollingElement?.clientWidth ?? 0) + 2)).toBe(true)
  await gm.evaluate(() => { document.documentElement.style.fontSize = '' })

  response = await command({ commandKind: 'prepare-settlement', expectedRevision: projection.revision })
  response = await command({ commandKind: 'commit-settlement', expectedRevision: response.result.revision })
  await Promise.all([gm.reload(), ...ownerPages.map(page => page.reload()), spectator.reload()])
  await expect(gm.getByRole('heading', { name: 'Results are committed' })).toBeVisible()
  await expect(spectator.getByRole('heading', { name: 'Results are committed' })).toBeVisible()
  for (const ownerPage of ownerPages) await expect(ownerPage.getByRole('heading', { name: 'Results are committed' })).toBeVisible()
  await expect(spectator.getByText('GM-only acceptance note')).toHaveCount(0)
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-completed.png`))

  const winningPokemon = projection.scoreboard.find((row: Record<string, any>) => row.placement === 1).contestantId
  const winnerIndex = Number(String(winningPokemon).split('-').at(-1))
  const settled = await parseOk(await gm.request.get(`/api/sheets/load?kind=pokemon&slug=${sheets[winnerIndex]!.pokemon}`))
  expect((settled.sheet as Record<string, any>).contestRibbons).toHaveLength(1)
  await Promise.all(ownerContexts.map(context => context.close()))
  await spectatorContext.close()
  await gmContext.close()
})

test('Trainer Participant performer choice passes the final assistive-technology and reflow audit', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticate(page.context(), 'gm')
  const sheets: Array<{ trainer: string, pokemon: string }> = []
  for (let index = 0; index < 3; index += 1) {
    const trainer = await createSheet(page, 'trainer', {
      name: `Paired Trainer ${index + 1}`,
      level: 8,
      skills: { charm: { rankBonus: index } },
      inventory: {},
      money: 0,
    })
    const pokemon = await createSheet(page, 'pokemon', {
      nickname: `Paired Partner ${index + 1}`,
      species: 'Pikachu',
      level: 10,
      totalExp: 100,
      stats: { hp: { base: 20 }, atk: { base: 20 }, def: { base: 20 }, satk: { base: 20 }, sdef: { base: 20 }, spd: { base: 20 + index } },
      movelist: [{ name: 'Charm' }, { name: 'Growl' }],
    })
    sheets.push({ trainer: trainer.slug, pokemon: pokemon.slug })
  }
  const runId = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const contestId = `contest:v1:e2e-participant-a11y-${runId}`
  let sequence = 0
  const command = async (body: Record<string, unknown>) => parseOk(await page.request.post('/api/contests/command', {
    data: {
      schemaVersion: 1,
      operationId: `contest-op:v1:e2e-participant-a11y-${runId}-${sequence++}`,
      contestId,
      clientId: 'participant-accessibility-e2e',
      ...body,
    },
  }))
  let response = await command({
    commandKind: 'create-contest',
    expectedRevision: 0,
    settings: {
      name: 'Paired Accessibility Contest', hallName: 'Jubilife Hall', description: '',
      variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous',
      contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true,
      prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '',
    },
  })
  for (const [index, pair] of sheets.entries()) response = await command({
    commandKind: 'enroll-contestant', expectedRevision: response.result.revision,
    contestantId: `contestant:e2e-participant-${index + 1}`,
    trainerSheetSlug: pair.trainer, pokemonSheetSlugs: [pair.pokemon], controller: { kind: 'gm' }, rotationOrder: [],
  })
  response = await command({ commandKind: 'start-introduction', expectedRevision: response.result.revision })
  for (let index = 0; index < sheets.length; index += 1) response = await command({
    commandKind: 'declare-introduction', expectedRevision: response.result.revision,
    contestantId: `contestant:e2e-participant-${index + 1}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {},
  })
  await command({ commandKind: 'start-performance', expectedRevision: response.result.revision })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/contests/${encodeURIComponent(contestId)}`)
  const appealHeading = page.getByRole('heading', { name: 'Your appeal' })
  await expect(appealHeading).toBeVisible()
  await expect(appealHeading).toHaveAttribute('tabindex', '-1')
  const choice = page.locator('.participant-performer-choice')
  await expect(choice.getByText('Choose who appeals first')).toBeVisible()
  const performers = choice.getByRole('button')
  await expect(performers).toHaveCount(2)
  await performers.first().focus()
  await expect(performers.first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(performers.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(performers.first()).toContainText('Selected')
  for (const performer of await performers.all()) expect((await performer.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(await seriousViolations(page)).toEqual([])
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= (document.scrollingElement?.clientWidth ?? 0) + 2)).toBe(true)
  expect(await seriousViolations(page)).toEqual([])
})
