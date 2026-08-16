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
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'pokemon', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...sheet, nickname, species: 'Pikachu', level: 5, totalExp: 40,
        stats: {
          hp: { base: 5, added: 0 }, atk: { base: 5, added: 0 }, def: { base: 5, added: 0 },
          satk: { base: 5, added: 0 }, sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
        },
        combat: { ...(sheet.combat ?? {}), currentHp: 1 },
      },
    },
  }))
  return slug
}
const createTrainer = async (page: Page, name: string, pokemonSlug: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: { ...sheet, name, level: 10, currentTeam: [pokemonSlug], inventory: sheet.inventory ?? {} },
    },
  }))
  return slug
}
const appendSharedRow = async (page: Page, row: Record<string, any>): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const loaded = await parseOk(await page.request.get('/api/group-inventory/load'))
    const document = loaded as Record<string, any>
    const response = await page.request.post('/api/group-inventory/save', {
      data: {
        slug: document.slug,
        expectedRevision: document.revision,
        document: {
          ...document,
          inventory: {
            ...document.inventory,
            medicalKit: [...(document.inventory.medicalKit ?? []), row],
          },
        },
      },
    })
    if (response.ok()) {
      await response.body()
      return
    }
    const text = await response.text()
    if (response.status() !== 409) throw new Error(`${response.status()} ${text}`)
  }
  throw new Error('Could not append the shared item row after bounded revision retries.')
}

test('shared item use selects an acting Trainer, consumes exact group custody, and stays accessible', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await authenticateGm(page)
  const pokemonName = unique('Shared Target')
  const trainerName = unique('Shared Medic')
  const pokemonSlug = await createPokemon(page, pokemonName)
  await createTrainer(page, trainerName, pokemonSlug)
  const itemName = testInfo.project.name === 'mobile-chromium' ? 'Super Potion' : 'Potion'
  const quantity = testInfo.project.name === 'mobile-chromium' ? 8 : 7
  const rowId = unique(`private-${testInfo.project.name}-shared-source`)
  await appendSharedRow(page, { id: rowId, name: itemName, qty: quantity })

  await page.goto('/group-inventory')
  await page.getByRole('tab', { name: /Medical Kit/ }).click()
  const actor = page.getByLabel('Acting Trainer')
  await expect(actor).toBeVisible()
  await actor.selectOption({ label: trainerName })

  const row = page.getByRole('row').filter({ hasText: itemName }).filter({ hasText: String(quantity) }).last()
  await expect(row).toBeVisible()
  const use = row.getByRole('button', { name: 'Use', exact: true })
  await expect(use).toBeEnabled()
  await use.click()

  const decision = page.locator('.sheet-item-decision')
  await expect(decision.getByRole('heading', { name: itemName, exact: true })).toBeVisible()
  await expect(decision).toContainText('Group inventory · Medical Kit · Row')
  await expect(decision).toContainText(trainerName)
  await expect(decision).toContainText(`${quantity} available`)
  await expect(decision).toContainText(pokemonName)
  await expect(decision).not.toContainText(/private-|item-instance|group-item-actor:v1|inventory-source:v1|operation|profile_|reservation|sha256|row id/i)

  const target = decision.getByRole('radio', { name: new RegExp(`Pokémon · ${pokemonName}`) })
  await target.click()
  await expect(target).toHaveAttribute('aria-checked', 'true')
  await expect(decision).toContainText(/HP after use/u)

  const accessibility = await new AxeBuilder({ page }).include('.group-inventory-panel__workspace').analyze()
  expect(accessibility.violations).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  if (testInfo.project.name === 'mobile-chromium') {
    const inventoryBox = await page.locator('.group-inventory-panel__section').boundingBox()
    const decisionBox = await decision.boundingBox()
    expect(inventoryBox).not.toBeNull()
    expect(decisionBox).not.toBeNull()
    expect(decisionBox!.y).toBeGreaterThan(inventoryBox!.y)
  }

  await decision.getByRole('button', { name: 'Confirm use', exact: true }).click()
  await expect(decision.getByRole('heading', { name: 'Item use complete', exact: true })).toBeVisible()
  const acceptedGroup = await parseOk(await page.request.get('/api/group-inventory/load'))
  const acceptedRow = (acceptedGroup.inventory.medicalKit as Record<string, any>[]).find(candidate => candidate.id === rowId)
  expect(acceptedRow).toMatchObject({ name: itemName, qty: quantity - 1 })
  const acceptedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  expect(acceptedPokemon.sheet.combat.currentHp).toBeGreaterThan(1)
})
