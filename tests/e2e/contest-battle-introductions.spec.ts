import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test'

const BASE_URL = 'http://127.0.0.1:3017'
const evidence = resolve('.pi/artifacts/ui-validation/battle-contest-introductions')
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
  await parseOk(await page.request.post('/api/sheets/save', { data: { kind, slug, sheet: { ...sheet, ...patch }, interactionMode: 'setup-edit', expectedRevision: sheet.revision } }))
  return slug
}
const seriousViolations = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.filter(row => row.impact === 'serious' || row.impact === 'critical')
const preserveAcceptedScreenshot = async (page: Page, path: string) => { if (!existsSync(path)) await page.screenshot({ path, fullPage: true, animations: 'disabled' }) }

test('Battle Trainer Introductions create separate team pools without Contest initiative in production liveplay', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  mkdirSync(evidence, { recursive: true })
  const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await authenticate(gmContext, 'gm')
  const gm = await gmContext.newPage()
  const teams: Array<{ trainer: string, pokemon: string[], name: string }> = []
  for (const [side, name] of [['North', 'Mara'], ['South', 'Dax']] as const) {
    const pokemon: string[] = []
    for (let index = 1; index <= 3; index += 1) pokemon.push(await createSheet(gm, 'pokemon', { nickname: `${side} ${index}`, species: 'Pikachu', level: 10, totalExp: 100, stats: { hp: { base: 20 }, atk: { base: 20 }, def: { base: 20 }, satk: { base: 20 }, sdef: { base: 20 }, spd: { base: 20 } }, movelist: [{ name: 'Growl' }] }))
    const trainer = await createSheet(gm, 'trainer', { name, level: 10, skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemon, inventory: {}, money: 0 })
    teams.push({ trainer, pokemon, name })
  }

  const runId = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
  const contestId = `contest:v1:e2e-battle-intro-${runId}`
  let sequence = 0
  const command = async (body: Record<string, unknown>) => parseOk(await gm.request.post('/api/contests/command', { data: { schemaVersion: 1, operationId: `contest-op:v1:e2e-battle-intro-${runId}-${sequence++}`, contestId, clientId: 'battle-introduction-e2e', ...body } }))
  let response = await command({ commandKind: 'create-contest', expectedRevision: 0, settings: { name: 'Neon Circuit Clash', hallName: 'Castelia Hall', description: '', variantId: 'battle', participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private battle plan' } })
  for (const [index, team] of teams.entries()) response = await command({ commandKind: 'enroll-contestant', expectedRevision: response.result.revision, contestantId: `contestant:e2e-battle-${index + 1}`, trainerSheetSlug: team.trainer, pokemonSheetSlugs: team.pokemon, controller: { kind: 'gm' }, rotationOrder: [] })
  response = await command({ commandKind: 'start-introduction', expectedRevision: response.result.revision })

  await gm.goto(`/contests/${encodeURIComponent(contestId)}`)
  await expect(gm.getByRole('heading', { name: 'Mara makes an impression' })).toBeVisible()
  await expect(gm.getByText('0 of 2 accepted')).toBeVisible()
  await expect(gm.getByText('No Contest initiative')).toBeVisible()
  await expect(gm.getByText('Authority rolls', { exact: false })).toBeVisible()
  const roll = gm.getByRole('button', { name: 'Roll team Introduction' })
  await roll.focus(); await expect(roll).toBeFocused()
  expect((await roll.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-pending.png`))

  await gm.keyboard.press('Enter')
  await expect(gm.getByRole('heading', { name: 'Dax makes an impression' })).toBeFocused()
  await gm.getByRole('button', { name: 'Roll team Introduction' }).click()
  await expect(gm.getByRole('heading', { name: 'Both team pools are ready' })).toBeVisible()
  await expect(gm.locator('.battle-intro-team--accepted')).toHaveCount(2)
  await expect(gm.getByText('2 team pools secured', { exact: false })).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Create & link Battle encounter' })).toBeEnabled()
  await expect(gm.getByRole('button', { name: 'Start performance' })).toHaveCount(0)
  await expect(gm.locator('.battle-pool-strip')).toHaveCount(2)
  expect(await seriousViolations(gm)).toEqual([])
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-ready.png`))

  await gm.setViewportSize({ width: 320, height: 800 })
  await gm.reload()
  await expect(gm.getByRole('heading', { name: 'Both team pools are ready' })).toBeVisible()
  expect(await gm.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)).toBeLessThanOrEqual(322)
  await preserveAcceptedScreenshot(gm, resolve(evidence, `${testInfo.project.name}-ready-320.png`))

  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await authenticate(publicContext, 'player')
  const spectator = await publicContext.newPage()
  await spectator.goto(`/contests/${encodeURIComponent(contestId)}`)
  await expect(spectator.getByRole('heading', { name: 'Battle Introductions in progress' })).toBeVisible()
  await expect(spectator.locator('.battle-intro-team')).toHaveCount(0)
  await expect(spectator.getByText('Team pools and roll evidence remain visible only')).toBeVisible()
  await expect(spectator.getByText('private battle plan')).toHaveCount(0)
  const publicProjection = (await parseOk(await spectator.request.get(`/api/contests/${encodeURIComponent(contestId)}`))).contest
  const publicJson = JSON.stringify(publicProjection)
  for (const forbidden of ['teamDicePools', 'providerIds', 'trainerSheetSlug', 'pokemonSheetSlug', 'operationId', 'private battle plan']) expect(publicJson).not.toContain(forbidden)
  expect(await seriousViolations(spectator)).toEqual([])

  expect((await gmContext.pages()[0]!.evaluate(() => performance.getEntriesByType('resource').length))).toBeGreaterThan(0)
  await publicContext.close()
  await gmContext.close()
})
