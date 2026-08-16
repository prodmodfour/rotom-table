import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'gm', url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
}

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`

const createPokemon = async (page: Page, nickname: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'pokemon', folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...sheet,
        nickname,
        species: 'Pikachu',
        level: 10,
        stats: {
          hp: { base: 5, added: 0 }, atk: { base: 5, added: 0 }, def: { base: 5, added: 0 },
          satk: { base: 5, added: 0 }, sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
        },
        movelist: [{ name: 'Quick Attack' }],
        appliedMoves: [],
        tutorPoints: { spent: 0 },
      },
    },
  }))
  return slug
}

const createTrainer = async (page: Page, pokemonSlug: string, name: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...sheet,
        name,
        level: 10,
        currentTeam: [pokemonSlug],
        inventory: {
          ...(sheet.inventory ?? {}),
          pokemonItems: [{ id: unique('tm-row'), name: 'TM 24 - Thunderbolt', qty: 1 }],
        },
      },
    },
  }))
  return slug
}

test('TM training previews, confirms, stays inert until completion, and settles atomically', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const nickname = unique('Volt')
  const trainerName = unique('Mira')
  const pokemonSlug = await createPokemon(page, nickname)
  const trainerSlug = await createTrainer(page, pokemonSlug, trainerName)

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Pokémon Items/ }).click()
  const row = page.getByRole('row').filter({ hasText: 'TM 24 - Thunderbolt' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Use', exact: true }).click()

  const decision = page.locator('.sheet-item-decision')
  await expect(decision.getByRole('heading', { name: 'TM 24 - Thunderbolt' })).toBeVisible()
  await expect(decision).toContainText('Move training')
  await decision.getByRole('radio', { name: new RegExp(nickname) }).click()
  await expect(decision).toContainText('About 1 hour · Extended Action')
  await expect(decision).toContainText('TM/Tutor limit')
  await expect(decision).toContainText('No Move, Tutor Point, HM usage, or inventory change occurs until completion')
  const start = decision.getByRole('button', { name: 'Start Move Training' })
  await expect(start).toBeDisabled()
  await decision.getByRole('radio', { name: /Keep current Moves/ }).click()
  await expect(decision).toContainText('Open slot → Thunderbolt')
  await expect(decision).toContainText('3 → 2 available')
  await decision.getByRole('checkbox', { name: /Teach Thunderbolt in an open Move slot/ }).check()
  await expect(start).toBeEnabled()

  const accessibility = await new AxeBuilder({ page }).include('.sheet-item-decision').analyze()
  expect(accessibility.violations).toEqual([])
  const columns = await page.locator('.inventory-action-workspace').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns
  ))
  if (testInfo.project.name.includes('mobile')) expect(columns.trim().split(/\s+/)).toHaveLength(1)
  else expect(columns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2)
  await testInfo.attach('machine-move-learning-preview', {
    body: await decision.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })

  await start.click()
  const activity = page.locator('.extended-treatment')
  await expect(page.getByRole('heading', { name: 'Move training in progress' })).toBeVisible()
  await expect(activity).toContainText(`${trainerName} is training ${nickname} with TM 24 - Thunderbolt`)
  await expect(activity).toContainText('No mechanics applied')
  await expect(activity).not.toContainText('machine-choice:v1:')
  await expect(activity).not.toContainText('sheet-item:v1:')

  const inertPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const inertTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(inertPokemon.sheet.movelist.map((move: Record<string, unknown>) => move.name)).toEqual(['Quick Attack'])
  expect(inertPokemon.sheet.tutorPoints?.spent ?? 0).toBe(0)
  expect(inertTrainer.sheet.inventory.pokemonItems[0].qty).toBe(1)

  await activity.getByRole('button', { name: 'Complete Move Training' }).click()
  await expect(page.getByRole('heading', { name: 'Move training complete' })).toBeVisible()
  await expect(activity).toContainText('Move, Tutor Points, usage receipt, and inventory settlement')

  const acceptedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const acceptedTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(acceptedPokemon.sheet.movelist.map((move: Record<string, unknown>) => move.name))
    .toEqual(['Quick Attack', 'Thunderbolt'])
  expect(acceptedPokemon.sheet.movelist[1]).toMatchObject({ name: 'Thunderbolt', itemMoveLearningLocked: true })
  expect(acceptedPokemon.sheet.appliedMoves).toEqual([
    expect.objectContaining({ name: 'Thunderbolt', source: 'tm', itemMoveLearningLocked: true }),
  ])
  expect(acceptedPokemon.sheet.tutorPoints).toMatchObject({ earned: 3, spent: 1 })
  expect(acceptedTrainer.sheet.inventory.pokemonItems ?? []).toEqual([])
  expect(JSON.stringify(acceptedPokemon)).not.toContain('"itemMoveLearning":')
  expect(JSON.stringify(acceptedPokemon)).not.toContain('"serverPrivate":')
  expect(JSON.stringify(acceptedTrainer)).not.toContain('"itemMachineUsage":')
})
