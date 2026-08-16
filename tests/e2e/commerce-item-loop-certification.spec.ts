import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'

const BASE_URL = 'http://127.0.0.1:3017'
const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`
const artifactDirectory = process.env.P8070_UI_ARTIFACT_DIR?.trim() || null

const parseOk = async (response: APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

const authenticateGm = async (context: BrowserContext): Promise<void> => {
  await context.addCookies([{
    name: 'rotom-role', value: 'gm', url: BASE_URL, sameSite: 'Lax',
  }])
}

const recordBrowserProblems = (page: Page): string[] => {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  return problems
}

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1)
}

const saveEvidence = async (page: Page, project: string, name: string): Promise<void> => {
  if (!artifactDirectory) return
  await page.mouse.move(1, 1)
  await page.screenshot({
    path: `${artifactDirectory}/${project}-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  })
}

const createPokemon = async (page: Page, nickname: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'pokemon', folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=pokemon&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'pokemon', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        nickname,
        species: 'Pikachu',
        level: 5,
        totalExp: 40,
        stats: {
          hp: { base: 5, added: 0 }, atk: { base: 5, added: 0 }, def: { base: 5, added: 0 },
          satk: { base: 5, added: 0 }, sdef: { base: 5, added: 0 }, spd: { base: 5, added: 0 },
        },
        combat: { ...(loaded.sheet.combat ?? {}), currentHp: 1, injuries: 0, conditions: [] },
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
      },
    },
  }))
  return slug
}

const createTrainer = async (page: Page, input: {
  name: string
  pokemonSlug: string
}): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        name: input.name,
        level: 10,
        money: 12_000,
        currentTeam: [input.pokemonSlug],
        inventory: loaded.sheet.inventory ?? {},
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: slug }),
      },
    },
  }))
  return slug
}

const createProfile = async (page: Page, input: {
  displayName: string
  trainerSlug: string
  pokemonSlug: string
}): Promise<Record<string, any>> => {
  const created = await parseOk(await page.request.post('/api/player-profiles/create', {
    data: { displayName: input.displayName },
  }))
  const updated = await parseOk(await page.request.post('/api/player-profiles/update', {
    data: {
      profileId: created.profile.id,
      displayName: input.displayName,
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: input.trainerSlug },
        { sheetKind: 'pokemon', sheetSlug: input.pokemonSlug },
      ],
    },
  }))
  return updated.profile as Record<string, any>
}

const createShop = async (page: Page, input: {
  slug: string
  restorative: string
}): Promise<void> => {
  await parseOk(await page.request.post('/api/shops/create', {
    data: {
      slug: input.slug,
      document: {
        name: 'Loop Certification Supply',
        description: 'Current liveplay item-loop acceptance fixture.',
        playerVisible: true,
        open: true,
        allowedPaymentSources: ['trainer'],
        allowedDeliveryTargets: ['trainer'],
        entries: [
          { id: 'restorative-sale', itemName: input.restorative, section: 'medicalKit', price: 200, stock: 8 },
          { id: 'armor-sale', itemName: 'Light Armor', section: 'equipment', price: 4_000, stock: 4 },
        ],
      },
    },
  }))
}

const createLiveMap = async (page: Page, input: {
  trainerSlug: string
  pokemonSlug: string
  trainerPlacementId: string
  pokemonPlacementId: string
}): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/maps/create', {
    data: { name: unique('Loop Arena'), dimensions: { x: 8, y: 2, z: 8 } },
  }))
  const map = created.map as Record<string, any>
  const slug = String(map.slug)
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'setup-edit' },
  }))
  await parseOk(await page.request.post('/api/maps/save', {
    data: {
      slug,
      interactionMode: 'setup-edit',
      expectedRevision: map.revision,
      map: {
        ...map,
        playerVisible: true,
        placements: [{
          id: input.trainerPlacementId,
          sheetKind: 'trainer',
          sheetSlug: input.trainerSlug,
          position: { x: 2, y: 0, z: 2 },
          sideId: 'heroes',
          initiative: 14,
        }, {
          id: input.pokemonPlacementId,
          sheetKind: 'pokemon',
          sheetSlug: input.pokemonSlug,
          position: { x: 3, y: 0, z: 2 },
          sideId: 'heroes',
          initiative: 13,
        }],
        activeScene: { name: 'Item loop certification', startedAt: Date.now() },
        initiative: { activeId: input.trainerPlacementId, round: 1 },
        encounterState: {
          ...createEmptyEncounterState(),
          sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active', color: '#35d4f4' } },
          turnResources: {
            [input.trainerPlacementId]: createEncounterTurnResourceLedger({
              placementId: input.trainerPlacementId,
              round: 1,
            }),
          },
        },
      },
    },
  }))
  await parseOk(await page.request.post('/api/maps/interaction-mode', {
    data: { slug, interactionMode: 'live-play' },
  }))
  return slug
}

const openTrainerInventory = async (
  page: Page,
  trainerSlug: string,
  section: RegExp = /Medical Kit/,
): Promise<void> => {
  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: section }).click()
}

const rowFor = (page: Page, itemName: string) => page.getByRole('row').filter({ hasText: itemName })

const finishInventoryDecision = async (page: Page): Promise<void> => {
  const decision = page.locator('.inventory-action-decision')
  await decision.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(decision).toHaveCount(0)
}

const trainerAuthority = async (page: Page, trainerSlug: string, profileId?: string): Promise<Record<string, any>> => (
  parseOk(await page.request.get(
    `/api/sheets/load?kind=trainer&slug=${trainerSlug}${profileId ? `&profileId=${profileId}` : ''}`,
  ))
)

const pokemonAuthority = async (page: Page, pokemonSlug: string, profileId?: string): Promise<Record<string, any>> => (
  parseOk(await page.request.get(
    `/api/sheets/load?kind=pokemon&slug=${pokemonSlug}${profileId ? `&profileId=${profileId}` : ''}`,
  ))
)

test('GM and player clients converge through checkout, equip, encounter use, history, transfer, unequip, and exact replay', async ({ page, browser }, testInfo) => {
  test.setTimeout(210_000)
  await authenticateGm(page.context())
  const playerProblems = recordBrowserProblems(page)
  const mobile = testInfo.project.name.includes('mobile')
  const restorative = mobile ? 'Super Potion' : 'Potion'
  const restoredHeadline = new RegExp(`${restorative} restored \\d+ HP`)
  const trainerName = unique('Loop Trainer')
  const pokemonName = unique('Loop Partner')
  const profileName = unique('Loop Player')
  const pokemonSlug = await createPokemon(page, pokemonName)
  const trainerSlug = await createTrainer(page, { name: trainerName, pokemonSlug })
  const profile = await createProfile(page, { displayName: profileName, trainerSlug, pokemonSlug })
  const shopSlug = unique('loop-certification-supply').toLowerCase()
  await createShop(page, { slug: shopSlug, restorative })
  const trainerPlacementId = unique('loop-trainer-token')
  const pokemonPlacementId = unique('loop-pokemon-token')
  const mapSlug = await createLiveMap(page, {
    trainerSlug, pokemonSlug, trainerPlacementId, pokemonPlacementId,
  })

  const projectViewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const gmContext = await browser.newContext({ baseURL: BASE_URL, viewport: projectViewport })
  await authenticateGm(gmContext)
  const gm = await gmContext.newPage()
  const gmProblems = recordBrowserProblems(gm)
  let gmGroup: Page | null = null
  let gmGroupProblems: string[] = []

  const captured = {
    checkout: [] as Record<string, any>[],
    inventoryActions: [] as Record<string, any>[],
    itemUses: [] as Record<string, any>[],
    equipmentOperations: [] as Record<string, any>[],
  }
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const pathname = new URL(request.url()).pathname
    let body: Record<string, any>
    try { body = request.postDataJSON() as Record<string, any> }
    catch { return }
    if (pathname === '/api/shops/checkout') captured.checkout.push(body)
    else if (pathname === '/api/inventory/actions/execute') captured.inventoryActions.push(body)
    else if (pathname === '/api/items/use') captured.itemUses.push(body)
    else if (pathname === '/api/equipment/operations') captured.equipmentOperations.push(body)
  })

  try {
    await openTrainerInventory(gm, trainerSlug)
    await expect(rowFor(gm, restorative)).toHaveCount(0)

    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByRole('button', { name: /Player Login/ }).click()
    await page.getByRole('button', { name: new RegExp(profileName) }).click()
    await expect(page).toHaveURL(/\/maps(?:\?|$)/)

    await page.goto(`/shops/${shopSlug}`)
    await page.getByTestId('shopfront-entry-card').filter({ hasText: restorative })
      .getByLabel(`Quantity for ${restorative}`).fill('2')
    await page.getByTestId('shopfront-entry-card').filter({ hasText: 'Light Armor' })
      .getByLabel('Quantity for Light Armor').fill('1')
    await page.getByTestId('shopfront-payment-source').selectOption({ label: `${trainerName} · $12,000 available` })
    await page.getByTestId('shopfront-delivery-target').selectOption({ label: `${trainerName} · $12,000 available` })
    await page.getByTestId('shopfront-buy').click()

    const checkoutPanel = page.locator('.post-checkout')
    await expect(checkoutPanel.getByRole('heading', { name: 'Checkout accepted', exact: true })).toBeVisible()
    await expect(checkoutPanel).toContainText(`${restorative} ×2`)
    await expect(checkoutPanel).toContainText('Light Armor ×1')
    expect((await new AxeBuilder({ page }).include('.post-checkout').analyze()).violations).toEqual([])
    await expectNoHorizontalOverflow(page)
    await saveEvidence(page, testInfo.project.name, 'checkout-accepted')

    await expect(rowFor(gm, restorative)).toContainText('2', { timeout: 20_000 })
    expect(captured.checkout).toHaveLength(1)
    const afterCheckout = await trainerAuthority(gm, trainerSlug)
    await parseOk(await page.request.post('/api/shops/checkout', { data: captured.checkout[0] }))
    const afterCheckoutReplay = await trainerAuthority(gm, trainerSlug)
    expect(afterCheckoutReplay.sheet.revision).toBe(afterCheckout.sheet.revision)
    expect(afterCheckoutReplay.sheet.money).toBe(afterCheckout.sheet.money)
    expect(afterCheckoutReplay.sheet.inventory).toEqual(afterCheckout.sheet.inventory)

    const armorReceipt = checkoutPanel.locator('.post-checkout__item').filter({ hasText: 'Light Armor' })
    await armorReceipt.getByRole('link', { name: 'Equip now', exact: true }).click()
    let decision = page.locator('.inventory-action-decision')
    await expect(decision.getByRole('heading', { name: 'Equip whole item', exact: true })).toBeVisible()
    await decision.getByRole('button', { name: 'Equip item', exact: true }).click()
    await expect(decision).toContainText('Trainer equipment custody')
    await finishInventoryDecision(page)

    const playerInspector = page.locator('.equipment-contribution-workspace')
    const gmInspector = gm.locator('.equipment-contribution-workspace')
    await expect(playerInspector).toContainText('Damage reduction')
    await expect(playerInspector).toContainText('5')
    await expect(gm.locator('.equipment-slot-list')).toContainText('Light Armor', { timeout: 20_000 })
    await expect(gmInspector).toContainText('Damage reduction')
    await expect(gmInspector).toContainText('5')
    expect(captured.inventoryActions).toHaveLength(1)
    const afterEquip = await trainerAuthority(gm, trainerSlug)
    await parseOk(await page.request.post('/api/inventory/actions/execute', { data: captured.inventoryActions[0] }))
    const afterEquipReplay = await trainerAuthority(gm, trainerSlug)
    expect(afterEquipReplay.sheet.revision).toBe(afterEquip.sheet.revision)
    expect(afterEquipReplay.sheet.inventory).toEqual(afterEquip.sheet.inventory)
    expect(afterEquipReplay.sheet.equipmentState).toEqual(afterEquip.sheet.equipmentState)
    await saveEvidence(page, testInfo.project.name, 'equipment-effective')

    await Promise.all([
      gm.goto(`/play/${mapSlug}`),
      page.goto(`/play/${mapSlug}`),
    ])
    await Promise.all([
      expect(gm.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible(),
      expect(page.getByRole('navigation', { name: 'Encounter workspace' })).toBeVisible(),
    ])
    await page.getByRole('button', { name: 'Inventory', exact: true }).click()
    const itemOffer = page.getByRole('button', { name: new RegExp(`^Use ${restorative},.*available$`, 'i') })
    await expect(itemOffer).toBeVisible()
    await itemOffer.click()
    const encounterDecision = page.locator('.encounter-decision-layer')
    await expect(encounterDecision.getByRole('heading', { name: `Use ${restorative}`, exact: true })).toBeFocused()
    await encounterDecision.getByRole('button', { name: new RegExp(pokemonName) }).click()
    await expect(encounterDecision).toContainText('Irreversible on acceptance')
    expect((await new AxeBuilder({ page }).include('.encounter-decision-layer').analyze()).violations).toEqual([])
    await expectNoHorizontalOverflow(page)
    await saveEvidence(page, testInfo.project.name, 'encounter-use-decision')

    const beforeUseTrainer = await trainerAuthority(gm, trainerSlug)
    const beforeUsePokemon = await pokemonAuthority(gm, pokemonSlug)
    await encounterDecision.getByRole('button', { name: 'Use item', exact: true }).click()
    await Promise.all([
      expect(page.locator('.encounter-event-feed__announcement')).toHaveText(restoredHeadline, { timeout: 20_000 }),
      expect(gm.locator('.encounter-event-feed__announcement')).toHaveText(restoredHeadline, { timeout: 20_000 }),
    ])
    expect(captured.itemUses).toHaveLength(1)
    const afterUseTrainer = await trainerAuthority(gm, trainerSlug)
    const afterUsePokemon = await pokemonAuthority(gm, pokemonSlug)
    expect(afterUseTrainer.sheet.revision).toBeGreaterThan(beforeUseTrainer.sheet.revision)
    expect(afterUsePokemon.sheet.revision).toBeGreaterThan(beforeUsePokemon.sheet.revision)
    expect(afterUseTrainer.sheet.inventory.medicalKit).toEqual([
      expect.objectContaining({ name: restorative, qty: 1 }),
    ])
    expect(afterUsePokemon.sheet.combat.currentHp).toBeGreaterThan(beforeUsePokemon.sheet.combat.currentHp)
    await parseOk(await page.request.post('/api/items/use', { data: captured.itemUses[0] }))
    const afterUseReplayTrainer = await trainerAuthority(gm, trainerSlug)
    const afterUseReplayPokemon = await pokemonAuthority(gm, pokemonSlug)
    expect(afterUseReplayTrainer.sheet.revision).toBe(afterUseTrainer.sheet.revision)
    expect(afterUseReplayPokemon.sheet.revision).toBe(afterUsePokemon.sheet.revision)
    expect(afterUseReplayTrainer.sheet.inventory).toEqual(afterUseTrainer.sheet.inventory)
    expect(afterUseReplayPokemon.sheet.combat.currentHp).toBe(afterUsePokemon.sheet.combat.currentHp)
    await saveEvidence(page, testInfo.project.name, 'encounter-use-accepted')

    await Promise.all([
      openTrainerInventory(gm, trainerSlug),
      openTrainerInventory(page, trainerSlug),
    ])
    await expect(rowFor(page, restorative)).toContainText('1')
    await expect(rowFor(gm, restorative)).toContainText('1')
    const history = page.locator('.inventory-history')
    await expect(history).toContainText(`${restorative} ×2`)
    await expect(history).toContainText('Light Armor equipped')
    await expect(history).toContainText(`${restorative} was used.`)

    gmGroup = await gmContext.newPage()
    gmGroupProblems = recordBrowserProblems(gmGroup)
    await gmGroup.goto('/group-inventory')
    await gmGroup.getByRole('tab', { name: /Medical Kit/ }).click()
    await expect(rowFor(gmGroup, restorative)).toHaveCount(0)

    await rowFor(page, restorative).getByRole('button', { name: 'Transfer', exact: true }).click()
    decision = page.locator('.inventory-action-decision')
    await expect(decision.getByRole('heading', { name: 'Transfer items', exact: true })).toBeVisible()
    await decision.getByRole('button', { name: 'Transfer items', exact: true }).click()
    await expect(decision).toContainText('Selected quantity moved into group inventory.')
    await finishInventoryDecision(page)
    await expect(rowFor(gm, restorative)).toHaveCount(0, { timeout: 20_000 })
    await expect(rowFor(gmGroup, restorative)).toContainText('1', { timeout: 20_000 })

    expect(captured.inventoryActions).toHaveLength(2)
    const afterTransferTrainer = await trainerAuthority(gm, trainerSlug)
    const afterTransferGroup = await parseOk(await gm.request.get('/api/group-inventory/load?slug=main'))
    await parseOk(await page.request.post('/api/inventory/actions/execute', { data: captured.inventoryActions[1] }))
    const afterTransferReplayTrainer = await trainerAuthority(gm, trainerSlug)
    const afterTransferReplayGroup = await parseOk(await gm.request.get('/api/group-inventory/load?slug=main'))
    expect(afterTransferReplayTrainer.sheet.revision).toBe(afterTransferTrainer.sheet.revision)
    expect(afterTransferReplayGroup.revision).toBe(afterTransferGroup.revision)
    expect(afterTransferReplayGroup.inventory).toEqual(afterTransferGroup.inventory)
    await expect(history).toContainText(`${restorative} transferred`)

    const returnArmor = page.getByRole('button', { name: 'Return Light Armor from Body to inventory' })
    await returnArmor.click()
    const equipmentStatus = page.locator('.equipment-operation-status')
    await expect(equipmentStatus).toContainText('Light Armor returned to inventory.')
    await expect(gm.locator('.equipment-slot-list')).not.toContainText('Light Armor', { timeout: 20_000 })
    await expect(gmInspector).not.toContainText('Damage reduction')
    expect(captured.equipmentOperations).toHaveLength(1)
    const afterUnequip = await trainerAuthority(gm, trainerSlug)
    await parseOk(await page.request.post('/api/equipment/operations', { data: captured.equipmentOperations[0] }))
    const afterUnequipReplay = await trainerAuthority(gm, trainerSlug)
    expect(afterUnequipReplay.sheet.revision).toBe(afterUnequip.sheet.revision)
    expect(afterUnequipReplay.sheet.inventory).toEqual(afterUnequip.sheet.inventory)
    expect(afterUnequipReplay.sheet.equipmentState).toEqual(afterUnequip.sheet.equipmentState)
    await equipmentStatus.getByRole('button', { name: 'Dismiss', exact: true }).click()

    await page.getByRole('tab', { name: /Equipment/ }).click()
    await gm.getByRole('tab', { name: /Equipment/ }).click()
    await expect(rowFor(page, 'Light Armor')).toBeVisible()
    await expect(rowFor(gm, 'Light Armor')).toBeVisible()
    await expect(history).toContainText('Light Armor unequipped')

    const finalHistory = await parseOk(await gm.request.get(
      `/api/inventory/history?trainerSlug=${trainerSlug}&limit=20`,
    ))
    const historyKinds = (finalHistory.facts as Record<string, any>[]).map(fact => fact.kind)
    expect(historyKinds).toEqual(expect.arrayContaining([
      'purchase', 'equipment-change', 'item-use', 'transfer',
    ]))
    expect((finalHistory.facts as Record<string, any>[]).filter(fact => fact.kind === 'equipment-change')).toHaveLength(2)

    const finalGmTrainer = await trainerAuthority(gm, trainerSlug)
    const finalPlayerTrainer = await trainerAuthority(page, trainerSlug, profile.id)
    const finalGmPokemon = await pokemonAuthority(gm, pokemonSlug)
    const finalPlayerPokemon = await pokemonAuthority(page, pokemonSlug, profile.id)
    const finalGmGroup = await parseOk(await gm.request.get('/api/group-inventory/load?slug=main'))
    const finalPlayerGroup = await parseOk(await page.request.get(`/api/group-inventory/load?slug=main&profileId=${profile.id}`))
    expect(finalPlayerTrainer.sheet.revision).toBe(finalGmTrainer.sheet.revision)
    expect(finalPlayerPokemon.sheet.revision).toBe(finalGmPokemon.sheet.revision)
    expect(finalPlayerGroup.revision).toBe(finalGmGroup.revision)
    expect(finalPlayerTrainer.sheet.inventory.medicalKit).toEqual([])
    expect(finalPlayerTrainer.sheet.inventory.equipment).toEqual([
      expect.objectContaining({ name: 'Light Armor' }),
    ])
    expect(finalPlayerTrainer.sheet.equipmentProjection.instances).toEqual([])
    expect(finalPlayerTrainer.sheet.equipmentContributionProjection?.values ?? []).toEqual([])
    expect(finalPlayerPokemon.sheet.combat.currentHp).toBe(finalGmPokemon.sheet.combat.currentHp)
    expect(finalPlayerGroup.inventory.medicalKit).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: restorative, qty: 1 }),
    ]))

    const visibleText = `${await page.locator('body').innerText()}\n${await gm.locator('body').innerText()}\n${await gmGroup.locator('body').innerText()}`
    expect(visibleText).not.toMatch(/profile_|inventory-action:v1:|equipment-operation:v1:|inventory-source:v1:|sha256|row id/i)
    expect((await new AxeBuilder({ page }).include('.inventory-receipts-workspace').analyze()).violations).toEqual([])
    expect((await new AxeBuilder({ page: gmGroup }).include('.group-inventory-panel').analyze()).violations).toEqual([])
    await Promise.all([
      expectNoHorizontalOverflow(page),
      expectNoHorizontalOverflow(gm),
      expectNoHorizontalOverflow(gmGroup),
    ])
    await saveEvidence(page, testInfo.project.name, 'final-trainer-history')
    await saveEvidence(gmGroup, testInfo.project.name, 'final-shared-inventory')

    expect(playerProblems).toEqual([])
    expect(gmProblems).toEqual([])
    expect(gmGroupProblems).toEqual([])
  }
  finally {
    await gmGroup?.close()
    await gmContext.close()
  }
})
