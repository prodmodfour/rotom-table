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

const createTrainer = async (page: Page, pokemonSlug: string, name: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...sheet, name, level: 10, currentTeam: [pokemonSlug],
        inventory: {
          ...(sheet.inventory ?? {}),
          medicalKit: [
            { id: unique('super-potion-first'), name: 'Super Potion', qty: 2 },
            { id: unique('super-potion-second'), name: 'Super Potion', qty: 1 },
          ],
        },
      },
    },
  }))
  return slug
}

test('duplicate item copies expose exact safe sources and consume only the revalidated selected row', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await authenticateGm(page)
  const pokemonName = unique('Volt')
  const trainerName = unique('Mira')
  const pokemonSlug = await createPokemon(page, pokemonName)
  const trainerSlug = await createTrainer(page, pokemonSlug, trainerName)

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Medical Kit/ }).click()
  const itemRows = page.getByRole('row').filter({ hasText: 'Super Potion' })
  await expect(itemRows).toHaveCount(2)
  await itemRows.nth(0).getByRole('button', { name: 'Use', exact: true }).click()

  const decision = page.locator('.sheet-item-decision')
  await expect(decision.getByRole('heading', { name: 'Super Potion', exact: true })).toBeVisible()
  await expect(decision).toContainText('3 total across 2 rows')
  await expect(decision.getByRole('heading', { name: 'Choose source' })).toBeVisible()
  await expect(decision).toContainText('2 matching sources')
  const firstSource = decision.getByRole('radio', { name: /Trainer inventory · Medical Kit · Row 1/ })
  const secondSource = decision.getByRole('radio', { name: /Trainer inventory · Medical Kit · Row 2/ })
  await expect(firstSource).toHaveAttribute('aria-checked', 'true')
  await expect(secondSource).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('.inv-table tbody tr[aria-current="true"]')).toContainText('Super Potion')
  await expect(decision).toContainText('Selection and revision are rechecked when submitted.')
  await expect(decision).not.toContainText(/item-instance|inventory-source:v1|operation|profile_|sha256|row id/i)

  await firstSource.focus()
  await firstSource.press('ArrowDown')
  await expect(secondSource).toHaveAttribute('aria-checked', 'true')
  await expect(secondSource).toBeFocused()
  await expect(page.locator('.inv-table tbody tr').nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(decision).toContainText('Source changed. Choose the target again before submitting.')

  const target = decision.getByRole('radio', { name: new RegExp(`Pokémon · ${pokemonName}`) })
  await target.click()
  await expect(target).toHaveAttribute('aria-checked', 'true')

  const accessibility = await new AxeBuilder({ page }).include('.sheet-item-decision').analyze()
  expect(accessibility.violations).toEqual([])
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  const preference = await page.evaluate(() => localStorage.getItem('rotom-table:inventory-source-presentation:v1'))
  expect(preference).toBe('{"schemaVersion":1,"preferredContainerKind":"trainer","preferredSection":"medicalKit"}')
  expect(preference).not.toMatch(/slug|row|offer|operation|profile|instance/i)

  await decision.getByRole('button', { name: 'Confirm use' }).click()
  await expect(decision.getByRole('heading', { name: 'Item use complete' })).toBeVisible()

  const loadedTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const remaining = (loadedTrainer.sheet as Record<string, any>).inventory.medicalKit as Record<string, any>[]
  expect(remaining.filter(row => row.name === 'Super Potion')).toEqual([
    expect.objectContaining({ name: 'Super Potion', qty: 2 }),
  ])

  if (testInfo.project.name === 'mobile-chromium') {
    const inventoryBox = await page.locator('.inventory-section-panel').boundingBox()
    const decisionBox = await decision.boundingBox()
    expect(inventoryBox).not.toBeNull()
    expect(decisionBox).not.toBeNull()
    expect(decisionBox!.y).toBeGreaterThan(inventoryBox!.y)
  }
})
