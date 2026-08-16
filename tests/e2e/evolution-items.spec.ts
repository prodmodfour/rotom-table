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
        level: 25,
        nature: 'Hardy',
        gender: 'Male',
        stats: {
          hp: { base: 4, added: 4 }, atk: { base: 6, added: 7 }, def: { base: 4, added: 4 },
          satk: { base: 5, added: 6 }, sdef: { base: 5, added: 6 }, spd: { base: 9, added: 8 },
        },
        abilities: [{ name: 'Static' }, { name: 'Cute Charm' }],
        movelist: [{ name: 'Quick Attack' }, { name: 'Thunder Wave' }],
        appliedMoves: [],
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
          pokemonItems: [{ id: unique('thunder-stone-row'), name: 'Thunder Stone', qty: 1 }],
        },
      },
    },
  }))
  return slug
}

test('Thunder Stone previews, confirms, evolves atomically, and leaves resolvable owner attention', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const nickname = unique('Volt')
  const trainerName = unique('Mira')
  const pokemonSlug = await createPokemon(page, nickname)
  const trainerSlug = await createTrainer(page, pokemonSlug, trainerName)

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Pokémon Items/ }).click()
  const row = page.getByRole('row').filter({ hasText: 'Thunder Stone' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Use', exact: true }).click()

  const decision = page.locator('.sheet-item-decision')
  await expect(decision.getByRole('heading', { name: 'Thunder Stone' })).toBeVisible()
  await expect(decision).toContainText('Evolution preview')
  await decision.getByRole('radio', { name: new RegExp(nickname) }).click()
  await expect(decision.getByRole('button', { name: 'Confirm use' })).toBeDisabled()
  await decision.getByRole('radio', { name: /Evolve to Raichu/ }).click()
  const evolve = decision.getByRole('button', { name: 'Evolve to Raichu' })
  await expect(decision).toContainText('Pikachu → Raichu')
  await expect(decision).toContainText('Electric · Base 4 / 6 / 4 / 5 / 5 / 9')
  await expect(decision).toContainText('Electric · Base 6 / 9 / 6 / 9 / 8 / 11')
  await expect(decision).toContainText('Static → Static, Cute Charm → Motor Drive')
  await expect(decision).toContainText('35 Stat Points need allocation after evolution')
  await expect(decision).toContainText('No new Move decision')
  await expect(decision).toContainText('No compatibility conflicts')
  await expect(decision).toContainText('No species, Stat, Move, Ability, equipment, or inventory change occurs until the server accepts')
  await decision.getByRole('checkbox', { name: new RegExp(`changes ${nickname}.*species to Raichu`, 'i') }).check()
  await expect(evolve).toBeEnabled()

  const accessibility = await new AxeBuilder({ page }).include('.sheet-item-decision').analyze()
  expect(accessibility.violations).toEqual([])
  const columns = await page.locator('.inventory-action-workspace').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns
  ))
  if (testInfo.project.name.includes('mobile')) expect(columns.trim().split(/\s+/)).toHaveLength(1)
  else expect(columns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2)
  await testInfo.attach('evolution-item-preview', {
    body: await decision.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })

  const inertPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const inertTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(inertPokemon.sheet.species).toBe('Pikachu')
  expect(inertPokemon.sheet.stats.spd.added).toBe(8)
  expect(inertTrainer.sheet.inventory.pokemonItems[0].qty).toBe(1)

  await evolve.click()
  await expect(page.getByRole('heading', { name: 'Item use complete' })).toBeVisible()
  const acceptedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const acceptedTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(acceptedPokemon.sheet).toMatchObject({
    species: 'Raichu', itemEvolutionLocked: true,
    itemEvolutionAttention: {
      fromSpecies: 'Pikachu', toSpecies: 'Raichu', canonicalItemName: 'Thunder Stone',
      statAllocation: { status: 'open', required: 35, allocated: 0 },
      moveOpportunities: [],
    },
  })
  expect(Object.values(acceptedPokemon.sheet.stats).map((stat: any) => stat.added)).toEqual([0, 0, 0, 0, 0, 0])
  expect(acceptedPokemon.sheet.abilities).toEqual([
    expect.objectContaining({ name: 'Static', itemEvolutionLocked: true }),
    expect.objectContaining({ name: 'Motor Drive', itemEvolutionLocked: true }),
  ])
  expect(acceptedPokemon.sheet.movelist.map((move: Record<string, unknown>) => move.name)).toEqual(['Quick Attack', 'Thunder Wave'])
  expect(acceptedTrainer.sheet.inventory.pokemonItems ?? []).toEqual([])
  const acceptedJson = JSON.stringify({ acceptedPokemon, acceptedTrainer })
  expect(acceptedJson).not.toContain('"itemEvolution":')
  expect(acceptedJson).not.toContain('"serverPrivate":')
  expect(acceptedJson).not.toContain('sourceOperationId')
  expect(acceptedJson).not.toContain('ruleRecordSha256')

  await page.goto(`/sheets/${pokemonSlug}`)
  const attention = page.locator('.evolution-attention')
  await expect(attention).toContainText('Follow-up required')
  await expect(attention).toContainText('0 / 35 Stat Points allocated')
  await expect(attention).toContainText('No new Move decision')
  await expect(page.locator('.identity__species')).toContainText('Evolved')
  await expect(page.locator('.ability-authority-badge')).toHaveCount(2)
  const attentionA11y = await new AxeBuilder({ page }).include('.evolution-attention').analyze()
  expect(attentionA11y.violations).toEqual([])

  const current = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug: pokemonSlug, expectedRevision: current.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...current.sheet,
        stats: {
          ...current.sheet.stats,
          hp: { ...current.sheet.stats.hp, added: 4 },
          atk: { ...current.sheet.stats.atk, added: 6 },
          def: { ...current.sheet.stats.def, added: 4 },
          satk: { ...current.sheet.stats.satk, added: 6 },
          sdef: { ...current.sheet.stats.sdef, added: 5 },
          spd: { ...current.sheet.stats.spd, added: 10 },
        },
      },
    },
  }))
  const resolved = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(resolved.sheet.itemEvolutionAttention.statAllocation).toEqual({ status: 'resolved', required: 35, allocated: 35 })
  expect(JSON.stringify(resolved)).not.toContain('"itemEvolution":')
  await page.reload()
  await expect(page.locator('.evolution-attention')).toContainText('Evolution record')
  await expect(page.locator('.evolution-attention')).toContainText('35 Stat Points allocated')
})
