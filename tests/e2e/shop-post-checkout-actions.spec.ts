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
const createTrainer = async (page: Page, name: string, pokemonSlug: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  const sheet = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...sheet, name, level: 10, money: 10_000, currentTeam: [pokemonSlug], inventory: sheet.inventory ?? {},
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: slug }),
      },
    },
  }))
  return slug
}
const createShop = async (page: Page, slug: string): Promise<void> => {
  await parseOk(await page.request.post('/api/shops/create', {
    data: {
      slug,
      document: {
        name: 'Continuity Supply', description: 'Exact accepted delivery handoffs.',
        playerVisible: true, open: true,
        allowedPaymentSources: ['trainer'], allowedDeliveryTargets: ['trainer'],
        entries: [
          { id: 'potion-sale', itemName: 'Potion', section: 'medicalKit', price: 200, stock: 8 },
          { id: 'armor-sale', itemName: 'Light Armor', section: 'equipment', price: 4_000, stock: 4 },
        ],
      },
    },
  }))
}

const purchaseCard = (page: Page, itemName: string) => page.locator('.post-checkout__item').filter({ hasText: itemName })

test('accepted shop delivery offers exact inspect, use, equip, give, and transfer handoffs', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await authenticateGm(page)
  const pokemonName = unique('Checkout Target')
  const trainerName = unique('Checkout Buyer')
  const pokemonSlug = await createPokemon(page, pokemonName)
  const trainerSlug = await createTrainer(page, trainerName, pokemonSlug)
  const shopSlug = unique('continuity-supply').toLowerCase()
  await createShop(page, shopSlug)

  await page.goto(`/shops/${shopSlug}`)
  const potionCatalog = page.getByTestId('shopfront-entry-card').filter({ hasText: 'Potion' })
  const armorCatalog = page.getByTestId('shopfront-entry-card').filter({ hasText: 'Light Armor' })
  await potionCatalog.getByLabel('Quantity for Potion').fill('2')
  await armorCatalog.getByLabel('Quantity for Light Armor').fill('1')
  await page.getByTestId('shopfront-payment-source').selectOption({ label: `${trainerName} · $10,000 available` })
  await page.getByTestId('shopfront-delivery-target').selectOption({ label: `${trainerName} · $10,000 available` })
  await page.getByTestId('shopfront-buy').click()

  const panel = page.locator('.post-checkout')
  await expect(panel.getByRole('heading', { name: 'Checkout accepted', exact: true })).toBeVisible()
  await expect(panel).toContainText('Nothing changes until the destination action is confirmed.')
  const potion = purchaseCard(page, 'Potion')
  const armor = purchaseCard(page, 'Light Armor')
  await expect(potion).toContainText('Potion ×2')
  await expect(potion).toContainText(`${trainerName} inventory · Medical Kit · Row 1`)
  await expect(potion.getByRole('link', { name: 'Inspect', exact: true })).toBeVisible()
  await expect(potion.getByRole('link', { name: 'Use now', exact: true })).toBeVisible()
  await expect(potion.getByRole('button', { name: 'Equip now', exact: true })).toBeDisabled()
  await expect(potion).toContainText('This item is not equipment.')
  await expect(potion.getByRole('link', { name: 'Move to group', exact: true })).toBeVisible()
  await expect(armor).toContainText('Light Armor ×1')
  await expect(armor).toContainText(`${trainerName} inventory · Equipment · Row 1`)
  await expect(armor.getByRole('link', { name: 'Equip now', exact: true })).toBeVisible()
  await expect(armor.getByRole('button', { name: 'Give now', exact: true })).toBeDisabled()
  await expect(armor).toContainText('This item has no current Pokémon equipment destination.')
  await expect(armor.getByRole('link', { name: 'Move to group', exact: true })).toBeVisible()
  await expect(panel).not.toContainText(/shop-continuation|shop-post-action|inventory-source:v1|operation|profile_|row id|sha256/i)

  const accessibility = await new AxeBuilder({ page }).include('.post-checkout').analyze()
  expect(accessibility.violations).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  if (testInfo.project.name === 'mobile-chromium') {
    const potionBox = await potion.boundingBox()
    const armorBox = await armor.boundingBox()
    expect(potionBox).not.toBeNull()
    expect(armorBox).not.toBeNull()
    expect(armorBox!.y).toBeGreaterThan(potionBox!.y + potionBox!.height - 2)
  }
  await testInfo.attach('shop-post-checkout-actions', {
    body: await panel.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })

  if (testInfo.project.name === 'mobile-chromium') {
    await armor.getByRole('link', { name: 'Equip now', exact: true }).click()
    const decision = page.locator('.inventory-action-decision')
    await expect(decision.getByRole('heading', { name: 'Equip whole item', exact: true })).toBeVisible()
    await expect(decision).toContainText('Trainer inventory · Equipment · Row 1')
    await decision.getByRole('button', { name: 'Equip item', exact: true }).click()
    await expect(decision).toContainText('Trainer equipment custody')
    const accepted = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
    const equipment = parseSheetEquipmentStateForOwner(accepted.sheet.equipmentState, { kind: 'trainer', slug: trainerSlug })
    expect(equipment.slots.find(slot => slot.slotId === 'body')?.instanceId).toEqual(expect.any(String))
  }
  else {
    await potion.getByRole('link', { name: 'Use now', exact: true }).click()
    const decision = page.locator('.sheet-item-decision')
    await expect(decision.getByRole('heading', { name: 'Potion', exact: true })).toBeVisible()
    await expect(decision).toContainText('Trainer inventory · Medical Kit · Row 1')
    await decision.getByRole('radio', { name: new RegExp(`Pokémon · ${pokemonName}`) }).click()
    await decision.getByRole('button', { name: 'Confirm use', exact: true }).click()
    await expect(decision.getByRole('heading', { name: 'Item use complete', exact: true })).toBeVisible()
    const accepted = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
    expect(accepted.sheet.inventory.medicalKit).toEqual([expect.objectContaining({ name: 'Potion', qty: 1 })])
  }
})
