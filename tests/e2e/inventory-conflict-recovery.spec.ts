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
const createTrainer = async (page: Page): Promise<string> => {
  const created = await parseOk(await page.request.post('/api/sheets/create', { data: { kind: 'trainer', folder: '' } }))
  const slug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${slug}`))
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug, expectedRevision: loaded.sheet.revision, interactionMode: 'setup-edit',
      sheet: {
        ...loaded.sheet,
        name: unique('Recovery Trainer'),
        level: 10,
        ap: { ...(loaded.sheet.ap ?? {}), left: loaded.sheet.ap?.left ?? 5 },
        currentInjuries: loaded.sheet.currentInjuries ?? 0,
        money: loaded.sheet.money ?? 0,
        equipmentSlots: loaded.sheet.equipmentSlots ?? {},
        equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: slug }),
        inventory: {
          ...(loaded.sheet.inventory ?? {}),
          medicalKit: [{ id: unique('private-recovery-row'), name: 'Potion', qty: 3 }],
        },
      },
    },
  }))
  return slug
}
const potionRow = (page: Page) => page.getByRole('row').filter({ hasText: 'Potion' })
const openMedicalInventory = async (page: Page, slug: string): Promise<void> => {
  await page.goto(`/sheets/trainers/${slug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  await page.getByRole('tab', { name: /Medical Kit/ }).click()
  await expect(potionRow(page)).toBeVisible()
}
const recordBrowserProblems = (page: Page): string[] => {
  const problems: string[] = []
  page.on('console', message => {
    const text = message.text()
    const knownOuterSheetCacheDiagnostic = message.type() === 'warning'
      && text.includes('[live-sheets] failed to load runtime sheet list')
      && text.includes('divergent contents at revision')
    if (!knownOuterSheetCacheDiagnostic && (message.type() === 'error' || message.type() === 'warning')) {
      problems.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  return problems
}

test.describe('inventory conflict and recovery', () => {
  test('offline exact retry, browser restart storage, and concurrent tabs reconcile one accepted transfer', async ({ page, context }, testInfo) => {
    test.setTimeout(150_000)
    await authenticateGm(page)
    const slug = await createTrainer(page)
    const firstProblems = recordBrowserProblems(page)
    await openMedicalInventory(page, slug)
    await page.waitForTimeout(750)
    firstProblems.length = 0

    const operationIds: string[] = []
    let executeRequests = 0
    await context.route('**/api/inventory/actions/execute', async (route) => {
      executeRequests += 1
      const body = route.request().postDataJSON() as { declaration?: { operationId?: string } }
      if (body.declaration?.operationId) operationIds.push(body.declaration.operationId)
      if (executeRequests === 1) {
        const committed = await route.fetch()
        expect(committed.ok()).toBe(true)
        await committed.body()
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    const row = potionRow(page)
    await row.getByRole('button', { name: 'Transfer', exact: true }).click()
    const decision = page.locator('.inventory-action-decision')
    await decision.getByRole('spinbutton', { name: /Quantity/ }).fill('2')
    await decision.getByRole('button', { name: 'Transfer items' }).click()

    const firstRecovery = page.locator('.inventory-recovery-card')
    await expect(firstRecovery).toContainText('Inventory result uncertain')
    await expect(firstRecovery).toContainText('The original action is retained. No new inventory action will be created.')
    await expect(firstRecovery.getByRole('button', { name: 'Retry exact action' })).toBeEnabled()
    await expect(firstRecovery).not.toContainText(/inventory-action:v1:|profile_|private-recovery-row|revision|sha256/i)
    expect(executeRequests).toBe(1)

    await context.setOffline(true)
    await expect(firstRecovery).toContainText('Offline — waiting to reconnect')
    await expect(firstRecovery.getByRole('button', { name: 'Retry exact action' })).toBeDisabled()
    await expect(firstRecovery).toContainText('Available after reconnection.')
    const offlineScreenshot = await page.screenshot({ fullPage: true, animations: 'disabled' })
    await testInfo.attach(`inventory-recovery-${testInfo.project.name}-offline`, {
      body: offlineScreenshot,
      contentType: 'image/png',
    })
    if (process.env.P8068_UI_ARTIFACT_DIR) {
      await page.screenshot({
        path: `${process.env.P8068_UI_ARTIFACT_DIR}/${testInfo.project.name}-offline.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }

    await context.setOffline(false)
    await expect(firstRecovery).toContainText('Online — ready for exact retry')
    await page.waitForTimeout(500)
    expect(executeRequests).toBe(1)

    const second = await context.newPage()
    const secondProblems = recordBrowserProblems(second)
    await openMedicalInventory(second, slug)
    await second.waitForTimeout(750)
    // P8-070 owns the outer live-sheets bootstrap mismatch. Establish a clean
    // baseline after hydration so this recovery path still fails on any new
    // console or page error caused by the retained command UI.
    expect(secondProblems.every(problem => problem === 'error: Hydration completed but contains mismatches.')).toBe(true)
    secondProblems.length = 0
    const secondRecovery = second.locator('.inventory-recovery-card')
    await expect(secondRecovery).toContainText('A previous inventory action may have reached the server.')
    await expect(secondRecovery.getByRole('button', { name: 'Retry exact action' })).toBeEnabled()

    const axe = await new AxeBuilder({ page: second }).include('.inventory-recovery-card').analyze()
    expect(axe.violations).toEqual([])
    expect(await second.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    const restoredScreenshot = await second.screenshot({ fullPage: true, animations: 'disabled' })
    await testInfo.attach(`inventory-recovery-${testInfo.project.name}-restored`, {
      body: restoredScreenshot,
      contentType: 'image/png',
    })
    if (process.env.P8068_UI_ARTIFACT_DIR) {
      await second.screenshot({
        path: `${process.env.P8068_UI_ARTIFACT_DIR}/${testInfo.project.name}-restored.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }

    await secondRecovery.getByRole('button', { name: 'Retry exact action' }).click()
    await expect(second.locator('.inventory-action-decision')).toContainText('without moving the item twice')
    expect(executeRequests).toBe(2)
    expect(operationIds).toHaveLength(2)
    expect(operationIds[1]).toBe(operationIds[0])

    await expect(firstRecovery).toContainText('Inventory changed elsewhere')
    await expect(firstRecovery).toContainText('resolved in another tab')
    await expect(firstRecovery.getByRole('button', { name: 'Reload authoritative inventory' })).toBeEnabled()
    await firstRecovery.getByRole('button', { name: 'Reload authoritative inventory' }).click()
    await expect(firstRecovery).toHaveCount(0)
    await expect(potionRow(page)).toContainText('1')
    expect(executeRequests).toBe(2)

    const intentionalLostResponseDiagnostics = firstProblems.filter(problem => (
      problem === 'error: Failed to load resource: net::ERR_FAILED'
    ))
    expect(intentionalLostResponseDiagnostics).toHaveLength(1)
    expect(firstProblems.filter(problem => !intentionalLostResponseDiagnostics.includes(problem))).toEqual([])
    expect(secondProblems).toEqual([])
    await second.close()
  })
})
