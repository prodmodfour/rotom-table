import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptySheetEquipmentState, parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'

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
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
      },
    },
  }))
  return slug
}

const createTrainer = async (page: Page, pokemonSlug: string, name: string, restorative: string): Promise<string> => {
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
          medicalKit: [{ id: unique('restorative-row'), name: restorative, qty: 3 }],
          equipment: [
            { id: unique('re-breather-row'), name: 'Re-Breather' },
            { id: unique('armor-row'), name: 'Light Armor' },
          ],
        },
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: slug }),
      },
    },
  }))
  return slug
}

const openSection = async (page: Page, label: RegExp): Promise<void> => {
  await page.getByRole('tab', { name: label }).click()
}
const rowFor = (page: Page, item: string) => page.getByRole('row').filter({ hasText: item })

const finishAcceptedDecision = async (page: Page): Promise<void> => {
  const decision = page.locator('.inventory-action-decision')
  await expect(decision).toContainText(/moved|custody/i)
  await decision.getByRole('button', { name: 'Done' }).click()
  await expect(decision).toHaveCount(0)
}

test('Use, Transfer, Give, and Equip share one authoritative inventory action anatomy', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await authenticateGm(page)
  const restorative = testInfo.project.name === 'mobile-chromium' ? 'Full Restore' : 'Hyper Potion'
  const pokemonName = unique('Volt')
  const trainerName = unique('Mira')
  const pokemonSlug = await createPokemon(page, pokemonName)
  const trainerSlug = await createTrainer(page, pokemonSlug, trainerName, restorative)

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()

  await openSection(page, /Medical Kit/)
  const restorativeRow = rowFor(page, restorative)
  await expect(restorativeRow).toBeVisible()
  await restorativeRow.getByRole('button', { name: 'Use', exact: true }).click()
  const useDecision = page.locator('.sheet-item-decision')
  await expect(useDecision.getByRole('heading', { name: restorative, exact: true })).toBeVisible()
  await expect(useDecision).toContainText('Trainer inventory · Medical Kit · Row 1')
  await useDecision.getByRole('button', { name: 'Cancel', exact: true }).click()

  await restorativeRow.getByRole('button', { name: 'Transfer', exact: true }).click()
  let actionDecision = page.locator('.inventory-action-decision')
  await expect(actionDecision.getByRole('heading', { name: 'Transfer items' })).toBeVisible()
  await expect(actionDecision).toContainText('Trainer inventory · Medical Kit · Row 1')
  await actionDecision.getByRole('spinbutton', { name: /Quantity/ }).fill('2')
  await actionDecision.getByRole('button', { name: 'Transfer items' }).click()
  await expect(actionDecision).toContainText('Selected quantity moved into group inventory.')
  await finishAcceptedDecision(page)

  const group = await parseOk(await page.request.get('/api/group-inventory/load?slug=main'))
  expect(group.inventory.medicalKit).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: restorative, qty: 2 }),
  ]))

  await openSection(page, /Equipment/)
  const reBreather = rowFor(page, 'Re-Breather')
  await expect(reBreather).toBeVisible()
  await expect(reBreather.getByRole('button', { name: 'Equip', exact: true })).toBeVisible()
  await expect(reBreather.getByRole('button', { name: 'Give', exact: true })).toBeVisible()
  await expect(reBreather.getByRole('button', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(reBreather.getByRole('link', { name: 'Inspect', exact: true })).toBeVisible()
  await reBreather.getByRole('button', { name: 'Give', exact: true }).click()
  actionDecision = page.locator('.inventory-action-decision')
  await expect(actionDecision.getByRole('heading', { name: 'Give whole item' })).toBeVisible()
  await expect(actionDecision).toContainText('Moves 1 whole item')
  await expect(actionDecision.getByRole('radio', { name: new RegExp(`${pokemonName} · Held Item`) })).toBeChecked()
  await expect(actionDecision).toContainText('Source and destination revisions are rechecked when submitted.')
  await expect(actionDecision).not.toContainText(/inventory-(?:source|destination|revision)|equipment-operation|profile_|sha256|row id/i)

  const accessibility = await new AxeBuilder({ page }).include('.inventory-action-decision').analyze()
  expect(accessibility.violations).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await actionDecision.getByRole('button', { name: 'Give item' }).click()
  await expect(actionDecision).toContainText('held-item custody')
  await finishAcceptedDecision(page)

  const loadedPokemon = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${pokemonSlug}`))
  const pokemonEquipment = parseSheetEquipmentStateForOwner(loadedPokemon.sheet.equipmentState, { kind: 'pokemon', slug: pokemonSlug })
  expect(pokemonEquipment.slots.find(slot => slot.slotId === 'held')?.instanceId).toEqual(expect.any(String))
  expect(pokemonEquipment.instances).toHaveLength(1)

  const armor = rowFor(page, 'Light Armor')
  await expect(armor).toBeVisible()
  await armor.getByRole('button', { name: 'Equip', exact: true }).click()
  actionDecision = page.locator('.inventory-action-decision')
  await expect(actionDecision.getByRole('heading', { name: 'Equip whole item' })).toBeVisible()
  await actionDecision.getByRole('button', { name: 'Equip item' }).click()
  await expect(actionDecision).toContainText('Trainer equipment custody')
  await finishAcceptedDecision(page)

  const loadedTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(loadedTrainer.sheet.inventory.medicalKit).toEqual([
    expect.objectContaining({ name: restorative, qty: 1 }),
  ])
  expect(loadedTrainer.sheet.inventory.equipment).toEqual([])
  const trainerEquipment = parseSheetEquipmentStateForOwner(loadedTrainer.sheet.equipmentState, { kind: 'trainer', slug: trainerSlug })
  expect(trainerEquipment.slots.find(slot => slot.slotId === 'body')?.instanceId).toEqual(expect.any(String))

  await page.goto('/group-inventory')
  await openSection(page, /Medical Kit/)
  const groupRestorative = rowFor(page, restorative)
  await expect(groupRestorative.getByRole('button', { name: 'Transfer', exact: true })).toBeEnabled()
  await groupRestorative.getByRole('button', { name: 'Transfer', exact: true }).click()
  actionDecision = page.locator('.inventory-action-decision')
  await expect(actionDecision).toContainText(/Group inventory · Medical Kit · Row \d+/)
  const trainerDestination = actionDecision.getByRole('radio', { name: new RegExp(`${trainerName} · Medical Kit`) })
  await trainerDestination.check()
  await expect(trainerDestination).toBeChecked()
  await actionDecision.getByRole('spinbutton', { name: /Quantity/ }).fill('1')

  const groupAccessibility = await new AxeBuilder({ page }).include('.group-inventory-panel__workspace').analyze()
  expect(groupAccessibility.violations).toEqual([])
  const groupOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(groupOverflow).toBeLessThanOrEqual(1)
  if (testInfo.project.name === 'mobile-chromium') {
    const inventoryBox = await page.locator('.group-inventory-panel__section').boundingBox()
    const decisionBox = await actionDecision.boundingBox()
    expect(inventoryBox).not.toBeNull()
    expect(decisionBox).not.toBeNull()
    expect(decisionBox!.y).toBeGreaterThan(inventoryBox!.y)
  }

  await actionDecision.getByRole('button', { name: 'Transfer items' }).click()
  await expect(actionDecision).toContainText('moved from group inventory into Trainer inventory')
  await finishAcceptedDecision(page)

  await page.getByRole('button', { name: 'Receive from trainer' }).click()
  const sourcePicker = page.locator('.group-inventory-panel__source-picker')
  const expectedSourceLabel = `${trainerName} inventory · Row 1 · ${restorative} · qty 2`
  await expect(sourcePicker).toContainText(expectedSourceLabel)
  await sourcePicker.getByRole('combobox', { name: 'Exact Trainer source' }).selectOption({ label: expectedSourceLabel })
  actionDecision = page.locator('.inventory-action-decision')
  await expect(actionDecision).toContainText(`${trainerName} inventory · Medical Kit · Row 1`)
  await actionDecision.getByRole('button', { name: 'Transfer items' }).click()
  await expect(actionDecision).toContainText('moved from Trainer inventory into group inventory')
  await finishAcceptedDecision(page)

  const finalGroup = await parseOk(await page.request.get('/api/group-inventory/load?slug=main'))
  expect(finalGroup.inventory.medicalKit).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: restorative, qty: 2 }),
  ]))
  const finalTrainer = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(finalTrainer.sheet.inventory.medicalKit).toEqual([
    expect.objectContaining({ name: restorative, qty: 1 }),
  ])
})
