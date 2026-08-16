import { mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const evidenceDirectory = resolve(process.cwd(), '.pi/artifacts/ui-validation/inventory-accessible-reflow')
const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`

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
const createTrainer = async (page: Page, name: string, itemName: string, privateRowId: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        name,
        level: 10,
        portraitUrl: '/profile-sprites/trainers/red-gen7.png',
        inventory: {
          ...(loaded.sheet.inventory ?? {}),
          medicalKit: [{
            id: privateRowId,
            name: itemName,
            qty: 3,
            cost: '$200',
            description: 'Heals 20 Hit Points',
          }],
        },
      },
    },
  }))
  return slug
}
const appendSharedRow = async (page: Page, row: Record<string, any>): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const document = await parseOk(await page.request.get('/api/group-inventory/load'))
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
  throw new Error('Could not append the shared accessibility row after bounded revision retries.')
}
const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}
const expectMinimumTarget = async (locator: Locator, label: string): Promise<void> => {
  const box = await locator.boundingBox()
  expect(box, `${label} should be visible`).not.toBeNull()
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.5)
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.5)
}
const expectAllMinimumTargets = async (locator: Locator, label: string): Promise<void> => {
  const targets = await locator.all()
  expect(targets.length, `${label} should include controls`).toBeGreaterThan(0)
  for (const [index, target] of targets.entries()) await expectMinimumTarget(target, `${label} ${index + 1}`)
}
const visibleRowFor = (page: Page, itemName: string, quantity?: number): Locator => {
  let rows = page.getByRole('row').filter({ hasText: itemName })
  if (quantity !== undefined) rows = rows.filter({ hasText: String(quantity) })
  return rows.last()
}

test('dense Trainer and shared inventory reflow remains keyboard, touch, zoom, and screen-reader accessible', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await mkdir(evidenceDirectory, { recursive: true })
  const browserProblems: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    const knownOuterSheetCacheDiagnostic = message.type() === 'warning'
      && text.includes('[live-sheets] failed to load runtime sheet list')
      && text.includes('divergent contents at revision')
    if (!knownOuterSheetCacheDiagnostic && (message.type() === 'error' || message.type() === 'warning')) {
      browserProblems.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', error => browserProblems.push(`pageerror: ${error.message}`))

  await authenticateGm(page)
  const mobile = testInfo.project.name === 'mobile-chromium'
  const itemName = mobile ? 'Super Potion' : 'Potion'
  const privateTrainerRowId = unique('private-accessibility-trainer-row')
  const privateGroupRowId = unique('private-accessibility-group-row')
  const sharedQuantity = mobile ? 32 : 31
  const trainerSlug = await createTrainer(page, `Accessible Keeper ${testInfo.project.name}`, itemName, privateTrainerRowId)
  await appendSharedRow(page, {
    id: privateGroupRowId,
    name: itemName,
    qty: sharedQuantity,
    cost: '$200',
    description: 'Shared responsive fixture.',
  })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.waitForTimeout(700)
  browserProblems.length = 0

  const sheetTabs = page.locator('.tab-nav .tab-btn')
  await expectAllMinimumTargets(sheetTabs, 'sheet navigation')
  const inventorySheetTab = page.getByRole('button', { name: 'Inventory', exact: true })
  await expect(inventorySheetTab).toHaveAttribute('aria-pressed', 'true')
  expect(await inventorySheetTab.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')

  const keyItemsTab = page.getByRole('tab', { name: /Key Items/ })
  await keyItemsTab.focus()
  await keyItemsTab.press('End')
  const equipmentTab = page.getByRole('tab', { name: /Equipment/ })
  await expect(equipmentTab).toBeFocused()
  await expect(equipmentTab).toHaveAttribute('aria-selected', 'true')
  await equipmentTab.press('Home')
  await expect(keyItemsTab).toBeFocused()
  await expect(keyItemsTab).toHaveAttribute('aria-selected', 'true')

  const medicalTab = page.getByRole('tab', { name: /Medical Kit/ })
  await medicalTab.click()
  await expect(medicalTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#trainer-inventory-section-panel')).toHaveAttribute('aria-labelledby', 'trainer-inventory-tab-medicalKit')
  await expectAllMinimumTargets(page.locator('.inventory-subtabs [role="tab"]'), 'inventory section tabs')
  expect(await medicalTab.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')

  const trainerRow = visibleRowFor(page, itemName)
  await expect(trainerRow).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Name' })).toBeAttached()
  await expect(page.getByRole('columnheader', { name: 'Qty' })).toBeAttached()
  await expect(trainerRow.getByRole('rowheader')).toContainText(itemName)
  expect(await trainerRow.evaluate(element => getComputedStyle(element).display)).toBe(mobile ? 'grid' : 'table-row')
  await expect(trainerRow.locator('[data-label="Name"]')).toBeVisible()
  await expect(trainerRow.locator('[data-label="Qty"]')).toBeVisible()
  await expect(trainerRow.locator('[data-label="Cost"]')).toBeVisible()
  await expect(trainerRow.locator('[data-label="Description"]')).toBeVisible()
  await expect(trainerRow.locator('[data-label="Actions"]')).toBeVisible()
  await expectAllMinimumTargets(trainerRow.locator('button, a, [role="button"]'), 'Trainer row actions and editors')

  let quantityEditor = trainerRow.getByRole('button', { name: new RegExp(`Edit quantity for ${itemName}: 3`, 'u') })
  await quantityEditor.focus()
  await quantityEditor.press('Enter')
  const quantityInput = trainerRow.getByRole('spinbutton', { name: `quantity for ${itemName}` })
  await expect(quantityInput).toBeFocused()
  await expectMinimumTarget(quantityInput, 'active quantity editor')
  await quantityInput.press('Escape')
  quantityEditor = trainerRow.getByRole('button', { name: new RegExp(`Edit quantity for ${itemName}: 3`, 'u') })
  await expect(quantityEditor).toBeFocused()
  expect(await quantityEditor.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')

  const discard = trainerRow.getByRole('button', { name: 'Discard', exact: true })
  await discard.focus()
  await discard.press('Enter')
  let decision = page.locator('.inventory-action-decision')
  const decisionHeading = decision.getByRole('heading', { name: 'Discard items', exact: true })
  await expect(decisionHeading).toBeFocused()
  await expect(trainerRow.getByText('Selected source', { exact: true })).toBeVisible()
  await expect(trainerRow).toHaveAttribute('aria-current', 'true')
  await expect(decision).toContainText('Trainer inventory · Medical Kit · Row 1')
  await expect(decision).toContainText('3 currently available · 2 remain after acceptance')
  await expect(decision).toContainText('Irreversible')
  await expect(decision).toContainText('1 item will be permanently removed from this inventory.')
  await expect(decision).not.toContainText(privateTrainerRowId)
  await expect(decision).not.toContainText(/inventory-(?:action|source|confirmation|revision)|operation|profile_|sha256|row id/i)
  await expectMinimumTarget(decision.getByRole('spinbutton', { name: /Quantity/ }), 'discard quantity')
  await expectMinimumTarget(decision.locator('.inventory-action-confirmation'), 'discard confirmation')
  await expectAllMinimumTargets(decision.getByRole('button'), 'discard decision actions')
  const discardCommit = decision.getByRole('button', { name: 'Discard 1 item', exact: true })
  await expect(discardCommit).toBeDisabled()
  await decision.getByRole('checkbox').check()
  await expect(discardCommit).toBeEnabled()

  const initialViewport = page.viewportSize()
  expect(initialViewport).not.toBeNull()
  await page.mouse.move(1, 1)
  await page.screenshot({
    path: resolve(evidenceDirectory, `${testInfo.project.name}-trainer-discard.png`),
    fullPage: true,
  })

  await page.setViewportSize({ width: 320, height: 900 })
  await expectNoHorizontalOverflow(page)
  expect(await trainerRow.evaluate(element => getComputedStyle(element).display)).toBe('grid')
  const inventoryBox = await page.locator('.inventory-section-panel').boundingBox()
  const decisionBox = await decision.boundingBox()
  expect(inventoryBox).not.toBeNull()
  expect(decisionBox).not.toBeNull()
  expect(decisionBox!.y).toBeGreaterThan(inventoryBox!.y)
  await expectAllMinimumTargets(trainerRow.locator('.inventory-item-action, .row-remove, [role="button"]'), '320-pixel row controls')
  const trainerAxe = await new AxeBuilder({ page }).include('.inventory-receipts-workspace').analyze()
  expect(trainerAxe.violations).toEqual([])
  await page.mouse.move(1, 1)
  await page.screenshot({
    path: resolve(evidenceDirectory, `${testInfo.project.name}-trainer-zoom-320.png`),
    fullPage: true,
  })

  const cancel = decision.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.press('Enter')
  await expect(decision).toHaveCount(0)
  await expect(discard).toBeFocused()
  await page.setViewportSize(initialViewport!)

  await discard.press('Enter')
  decision = page.locator('.inventory-action-decision')
  await expect(decision.getByRole('heading', { name: 'Discard items', exact: true })).toBeFocused()
  await decision.getByRole('spinbutton', { name: /Quantity/ }).fill('3')
  await decision.getByRole('checkbox').check()
  await decision.getByRole('button', { name: 'Discard 3 items', exact: true }).click()
  await expect(decision).toContainText(/permanently discarded/i)
  await decision.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(decision).toHaveCount(0)
  await expect(medicalTab).toBeFocused()
  await expect(visibleRowFor(page, itemName)).toHaveCount(0)

  await page.goto('/group-inventory')
  await page.getByRole('tab', { name: /Medical Kit/ }).click()
  await expect(page.locator('#group-inventory-section-panel')).toHaveAttribute('aria-labelledby', 'group-inventory-tab-medicalKit')
  const groupRow = visibleRowFor(page, itemName, sharedQuantity)
  await expect(groupRow).toBeVisible()
  expect(await groupRow.evaluate(element => getComputedStyle(element).display)).toBe(mobile ? 'grid' : 'table-row')
  await expectAllMinimumTargets(groupRow.locator('button, a, [role="button"]'), 'shared row actions and editors')
  await expect(page.locator('.group-inventory-panel')).not.toContainText(privateGroupRowId)

  const groupTransfer = groupRow.getByRole('button', { name: 'Transfer', exact: true })
  await expect(groupTransfer).toBeEnabled()
  await groupTransfer.focus()
  await groupTransfer.press('Enter')
  decision = page.locator('.inventory-action-decision')
  await expect(decision.getByRole('heading', { name: 'Transfer items', exact: true })).toBeFocused()
  await expect(groupRow.getByText('Selected source', { exact: true })).toBeVisible()
  await expect(decision).toContainText(/Group inventory · Medical Kit · Row \d+/u)
  await expect(decision).not.toContainText(privateGroupRowId)

  const groupAxe = await new AxeBuilder({ page }).include('.group-inventory-panel__receipts-workspace').analyze()
  expect(groupAxe.violations).toEqual([])
  await expectNoHorizontalOverflow(page)
  await page.mouse.move(1, 1)
  await page.screenshot({
    path: resolve(evidenceDirectory, `${testInfo.project.name}-group-transfer.png`),
    fullPage: true,
  })
  await decision.getByRole('button', { name: 'Cancel', exact: true }).press('Enter')
  await expect(decision).toHaveCount(0)
  await expect(groupTransfer).toBeFocused()

  expect(browserProblems).toEqual([])
})
