import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'

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
const createTrainer = async (page: Page, name: string, itemName: string): Promise<{ slug: string, privateRowId: string }> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  const privateRowId = unique('private-history-row')
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet, name, level: 10,
        ap: { ...(loaded.sheet.ap ?? {}), left: loaded.sheet.ap?.left ?? 5 },
        currentInjuries: loaded.sheet.currentInjuries ?? 0,
        money: loaded.sheet.money ?? 0,
        equipmentSlots: loaded.sheet.equipmentSlots ?? {},
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: slug }),
        inventory: {
          ...(loaded.sheet.inventory ?? {}),
          medicalKit: [{ id: privateRowId, name: itemName, qty: 3 }],
        },
      },
    },
  }))
  return { slug, privateRowId }
}
const rowFor = (page: Page, itemName: string) => page.getByRole('row').filter({ hasText: itemName })

test.describe('inventory history', () => {
  test('one accepted transfer becomes privacy-safe Trainer and shared activity without duplicate receipts', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const browserProblems: string[] = []
    page.on('console', message => {
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
      const itemName = testInfo.project.name === 'mobile-chromium' ? 'Energy Root' : 'Energy Powder'
      const trainerName = unique('Receipt Keeper')
      const trainer = await createTrainer(page, trainerName, itemName)

      await page.goto(`/sheets/trainers/${trainer.slug}`)
      await page.getByRole('button', { name: 'Inventory', exact: true }).click()
      await page.getByRole('tab', { name: /Medical Kit/ }).click()
      const row = rowFor(page, itemName)
      await expect(row).toBeVisible()
      const initialHistory = page.locator('.inventory-history')
      await expect(initialHistory).toContainText('No accepted inventory receipts yet.')
      // The legacy Trainer editor emits known hydration diagnostics before this
      // target workspace settles; P8-067 console acceptance starts after it is quiet.
      await page.waitForTimeout(1_000)
      browserProblems.length = 0
      await row.getByRole('button', { name: 'Transfer', exact: true }).click()
      const decision = page.locator('.inventory-action-decision')
      await decision.getByRole('spinbutton', { name: /Quantity/ }).fill('2')
      await decision.getByRole('button', { name: 'Transfer items' }).click()
      await expect(decision).toContainText('Selected quantity moved into group inventory.')
      await decision.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(decision).toHaveCount(0)

      const trainerHistory = page.locator('.inventory-history')
      await expect(trainerHistory).toContainText('Inventory activity')
      await expect(trainerHistory).toContainText('Transfer')
      await expect(trainerHistory).toContainText(`${itemName} ×2 transferred`)
      await expect(trainerHistory).toContainText('Moved from Trainer inventory to Shared inventory.')
      await expect(trainerHistory.locator('.inventory-history__fact--transfer')).toHaveCount(1)
      await expect(trainerHistory).not.toContainText(trainer.privateRowId)
      await expect(trainerHistory).not.toContainText(/inventory-action:v1:|profile_|sha256|row id|operation id/i)
      await expect(trainerHistory.getByRole('button', { name: 'Refresh history' })).toBeEnabled()

      const trainerAxe = await new AxeBuilder({ page }).include('.inventory-receipts-workspace').analyze()
      expect(trainerAxe.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      const trainerPrimary = await page.locator('.inventory-primary-workspace').boundingBox()
      const trainerActivity = await trainerHistory.boundingBox()
      expect(trainerPrimary).not.toBeNull()
      expect(trainerActivity).not.toBeNull()
      if (testInfo.project.name === 'mobile-chromium') {
        expect(trainerActivity!.y).toBeGreaterThan(trainerPrimary!.y)
      }
      else {
        expect(trainerActivity!.x).toBeGreaterThan(trainerPrimary!.x)
      }

      await page.goto('/group-inventory')
      await page.getByRole('tab', { name: /Medical Kit/ }).click()
      await expect(rowFor(page, itemName)).toBeVisible()
      const sharedHistory = page.locator('.inventory-history')
      await expect(sharedHistory).toContainText(`${itemName} ×2 transferred`)
      await expect(sharedHistory.locator('.inventory-history__fact').filter({ hasText: itemName })).toHaveCount(1)
      await expect(sharedHistory).not.toContainText(trainer.privateRowId)

      const groupAxe = await new AxeBuilder({ page }).include('.group-inventory-panel__receipts-workspace').analyze()
      expect(groupAxe.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      const groupPrimary = await page.locator('.group-inventory-panel__primary-workspace').boundingBox()
      const groupActivity = await sharedHistory.boundingBox()
      expect(groupPrimary).not.toBeNull()
      expect(groupActivity).not.toBeNull()
      if (testInfo.project.name === 'mobile-chromium') {
        expect(groupActivity!.y).toBeGreaterThan(groupPrimary!.y)
      }
      else {
        expect(groupActivity!.x).toBeGreaterThan(groupPrimary!.x)
      }
    expect(browserProblems).toEqual([])
  })
})
