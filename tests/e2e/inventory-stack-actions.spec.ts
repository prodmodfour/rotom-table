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

const createTrainer = async (page: Page, name: string): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
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
        inventory: {
          ...(sheet.inventory ?? {}),
          medicalKit: [
            { id: unique('private-potion-source'), name: 'Potion', qty: 5, cost: '$200' },
            { id: unique('private-potion-target'), name: 'Potion', qty: 2, cost: '$200' },
            { id: unique('private-antidote-source'), name: 'Antidote', qty: 3, cost: '$200' },
          ],
        },
      },
    },
  }))
  return slug
}

const itemRows = (page: Page, item: string) => page.getByRole('row').filter({ hasText: item })
const finishAccepted = async (page: Page, message: RegExp): Promise<void> => {
  const decision = page.locator('.inventory-action-decision')
  await expect(decision).toContainText(message)
  await decision.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(decision).toHaveCount(0)
}

test('Split, Merge, and Discard preserve exact stack authority and irreversible confirmation', async ({ page }, testInfo) => {
  test.setTimeout(150_000)
  await authenticateGm(page)
  const trainerSlug = await createTrainer(page, unique('Stack Keeper'))

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Medical Kit/ }).click()

  let potionRows = itemRows(page, 'Potion')
  await expect(potionRows).toHaveCount(2)
  const firstPotion = potionRows.nth(0)
  await expect(firstPotion.getByRole('button', { name: 'Split', exact: true })).toBeEnabled()
  await expect(firstPotion.getByRole('button', { name: 'Merge', exact: true })).toBeEnabled()
  await expect(firstPotion.getByRole('button', { name: 'Discard', exact: true })).toBeEnabled()

  await firstPotion.getByRole('button', { name: 'Split', exact: true }).click()
  let decision = page.locator('.inventory-action-decision')
  await expect(decision.getByRole('heading', { name: 'Split stack', exact: true })).toBeVisible()
  await expect(decision).toContainText('Trainer inventory · Medical Kit · Row 1')
  await decision.getByRole('spinbutton', { name: /Quantity/ }).fill('2')
  await expect(decision).toContainText('Creates a separate stack of 2 items')
  await expect(decision).toContainText('5 currently available · 3 remain after acceptance')
  await expect(firstPotion).toContainText('5')
  await decision.getByRole('button', { name: 'Split stack', exact: true }).click()
  await finishAccepted(page, /separated into a new stack/i)

  potionRows = itemRows(page, 'Potion')
  await expect(potionRows).toHaveCount(3)
  const splitPotion = potionRows.nth(1)
  await expect(splitPotion).toContainText('2')
  await splitPotion.getByRole('button', { name: 'Merge', exact: true }).click()
  decision = page.locator('.inventory-action-decision')
  await expect(decision.getByRole('heading', { name: 'Merge stacks', exact: true })).toBeVisible()
  await expect(decision).toContainText('Merges all 2 items')
  await expect(decision.getByRole('radio', { name: /Medical Kit · Row 1 · Potion/ })).toBeChecked()
  await decision.getByRole('button', { name: 'Merge stacks', exact: true }).click()
  await finishAccepted(page, /whole stack merged/i)

  potionRows = itemRows(page, 'Potion')
  await expect(potionRows).toHaveCount(2)
  await expect(potionRows.nth(0)).toContainText('5')

  const antidote = itemRows(page, 'Antidote')
  await expect(antidote).toHaveCount(1)
  await antidote.getByRole('button', { name: 'Discard', exact: true }).click()
  decision = page.locator('.inventory-action-decision')
  await expect(decision.getByRole('heading', { name: 'Discard items', exact: true })).toBeVisible()
  await expect(decision).toContainText('Trainer inventory · Medical Kit · Row 3')
  await decision.getByRole('spinbutton', { name: /Quantity/ }).fill('2')
  await expect(decision).toContainText('Permanently removes 2 items')
  await expect(decision).toContainText('2 items will be permanently removed from this inventory.')
  await expect(decision).toContainText('3 currently available · 1 remains after acceptance')
  await expect(decision).toContainText('Irreversible')
  await expect(decision).toContainText('Source and destination revisions are rechecked when submitted.')
  await expect(decision).not.toContainText(/private-|inventory-(?:action|source|destination|confirmation|revision)|operation|profile_|sha256|row id/i)

  const discard = decision.getByRole('button', { name: 'Discard 2 items', exact: true })
  await expect(discard).toBeDisabled()
  await decision.getByRole('checkbox', {
    name: 'I understand these items cannot be recovered through ordinary inventory actions.',
  }).check()
  await expect(discard).toBeEnabled()
  await expect(antidote).toContainText('3')

  const accessibility = await new AxeBuilder({ page }).include('.inventory-action-workspace').analyze()
  expect(accessibility.violations).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  if (testInfo.project.name === 'mobile-chromium') {
    const inventoryBox = await page.locator('.inventory-section-panel').boundingBox()
    const decisionBox = await decision.boundingBox()
    expect(inventoryBox).not.toBeNull()
    expect(decisionBox).not.toBeNull()
    expect(decisionBox!.y).toBeGreaterThan(inventoryBox!.y)
  }

  await discard.click()
  await finishAccepted(page, /permanently discarded/i)

  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  expect(loaded.sheet.inventory.medicalKit).toEqual([
    expect.objectContaining({ name: 'Potion', qty: 5, cost: '$200' }),
    expect.objectContaining({ name: 'Potion', qty: 2, cost: '$200' }),
    expect.objectContaining({ name: 'Antidote', qty: 1, cost: '$200' }),
  ])
})
