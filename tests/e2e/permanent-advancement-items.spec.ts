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
        level: 5,
        totalExp: 40,
        stats: {
          hp: { base: 5, added: 0 }, atk: { base: 5, added: 0 }, def: { base: 5, added: 0 },
          satk: { base: 5, added: 0 }, sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
        },
        movelist: [
          { name: 'Spark', frequency: 'EOT' },
          { name: 'Thunder Wave', frequency: 'Scene x2' },
        ],
      },
    },
  }))
  return slug
}

const createTrainer = async (
  page: Page,
  pokemonSlug: string,
  name: string,
  item: string,
): Promise<string> => {
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
          pokemonItems: [{ id: unique('permanent-item'), name: item, qty: 1 }],
        },
      },
    },
  }))
  return slug
}

const openPermanentItem = async (page: Page, trainerSlug: string, item: string): Promise<void> => {
  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Pokémon Items/ }).click()
  const row = page.getByRole('row').filter({ hasText: item })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Use', exact: true }).click()
  await expect(page.getByRole('heading', { name: item, exact: true })).toBeVisible()
}

test('PP Up previews an exact Move and completes once through liveplay', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const pokemonSlug = await createPokemon(page, unique('Volt'))
  const trainerSlug = await createTrainer(page, pokemonSlug, unique('Mira'), 'PP Up')

  await openPermanentItem(page, trainerSlug, 'PP Up')
  const decision = page.locator('.sheet-item-decision')
  await expect(decision).toContainText('Permanent advancement')
  await expect(decision).toContainText('Extended Action')
  await decision.getByRole('radio', { name: /Pokémon/ }).click()
  await expect(decision.getByRole('heading', { name: 'Permanent preview' })).toBeVisible()
  await expect(decision).toContainText('0 / 5 → 1 / 5')
  await expect(decision).toContainText('Starting stores this target and choice only')
  const startButton = decision.getByRole('button', { name: 'Start Extended Action' })
  await expect(startButton).toBeDisabled()
  await decision.getByRole('radio', { name: /Spark/ }).click()
  await expect(decision).toContainText('EOT → At-Will')
  await expect(startButton).toBeEnabled()

  const accessibility = await new AxeBuilder({ page }).include('.sheet-item-decision').analyze()
  expect(accessibility.violations).toEqual([])
  const columns = await page.locator('.inventory-action-workspace').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns
  ))
  if (testInfo.project.name.includes('mobile')) expect(columns.trim().split(/\s+/)).toHaveLength(1)
  else expect(columns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2)
  await testInfo.attach('pp-up-permanent-preview', {
    body: await decision.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })

  await startButton.click()
  const activity = page.locator('.extended-treatment')
  await expect(page.getByRole('heading', { name: 'PP Up in progress' })).toBeVisible()
  await expect(activity).toContainText('No mechanics applied')
  await expect(activity).not.toContainText('move-choice:v1:')
  await expect(activity).not.toContainText('sheet-item:v1:')

  const inertPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const inertTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(inertPokemon.sheet.movelist[0].frequency).toBe('EOT')
  expect(inertPokemon.sheet.vitamins?.ppUp).not.toBe(true)
  expect(inertTrainer.sheet.inventory.pokemonItems[0].qty).toBe(1)

  await activity.getByRole('button', { name: 'Complete Extended Action' }).click()
  await expect(page.getByRole('heading', { name: 'PP Up complete' })).toBeVisible()
  await expect(activity).toContainText('permanent sheet change')

  const acceptedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const acceptedTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(acceptedPokemon.sheet.movelist[0].frequency).toBe('At-Will')
  expect(acceptedPokemon.sheet.vitamins).toMatchObject({ ppUp: true, ppUpMove: 'Spark' })
  expect(acceptedTrainer.sheet.inventory.pokemonItems).toEqual([])
  expect(JSON.stringify(acceptedPokemon)).not.toContain('itemPermanentAdvancement')
  expect(JSON.stringify(acceptedPokemon)).not.toContain('canonicalDefinitionSha256')
})

test('Stat Suppressants require explicit consent and interruption remains inert', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const pokemonSlug = await createPokemon(page, unique('Ember'))
  const trainerSlug = await createTrainer(page, pokemonSlug, unique('Rook'), 'Stat Suppressants')

  await openPermanentItem(page, trainerSlug, 'Stat Suppressants')
  const decision = page.locator('.sheet-item-decision')
  await decision.getByRole('radio', { name: /Pokémon/ }).click()
  await expect(decision).toContainText('Trainer consent')
  await expect(decision).toContainText('Required')
  const startButton = decision.getByRole('button', { name: 'Start Extended Action' })
  await decision.getByRole('radio', { name: /^Attack\b/ }).click()
  await expect(startButton).toBeDisabled()
  await decision.getByRole('checkbox', { name: /Trainer consents/ }).check()
  await expect(decision).toContainText('Confirmed')
  await expect(startButton).toBeEnabled()

  const accessibility = await new AxeBuilder({ page }).include('.sheet-item-decision').analyze()
  expect(accessibility.violations).toEqual([])
  await testInfo.attach('stat-suppressant-consent-preview', {
    body: await decision.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })

  await startButton.click()
  const activity = page.locator('.extended-treatment')
  await expect(page.getByRole('heading', { name: 'Stat Suppressants in progress' })).toBeVisible()
  await activity.getByRole('button', { name: 'Interrupt safely' }).click()
  await expect(page.getByRole('heading', { name: 'Stat Suppressants interrupted' })).toBeVisible()
  await expect(activity).toContainText('before any item mechanics')

  const pokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const trainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(pokemon.sheet.vitamins?.statSuppressants?.atk ?? 0).toBe(0)
  expect(trainer.sheet.inventory.pokemonItems[0]).toMatchObject({ name: 'Stat Suppressants', qty: 1 })
  await expect(activity).not.toContainText('trainer-consent')
})
