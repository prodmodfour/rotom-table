import { randomBytes } from 'node:crypto'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { itemCommandFromAuthorizedSheetAction } from '#shared/itemAutomation/sheetActions'

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

const id = (prefix: string): string => `${prefix}${randomBytes(16).toString('hex')}`

const executeSheetExplorationItem = async (
  page: Page,
  trainerSlug: string,
  canonicalId: string,
  mode: string,
): Promise<Record<string, any>> => {
  const actions = await parseOk(await page.request.get(`/api/items/sheet-actions?trainerSlug=${trainerSlug}`))
  const offer = (actions.offers as Record<string, any>[])
    .find(candidate => candidate.source?.canonicalId === canonicalId)
  expect(offer, `${canonicalId} offer`).toBeTruthy()
  const target = (offer!.targeting.options as Record<string, any>[])
    .find(candidate => candidate.sheetKind === 'trainer' && candidate.sheetSlug === trainerSlug)
  expect(target?.enabled, `${canonicalId} self target`).toBe(true)
  const declared = await parseOk(await page.request.post('/api/items/sheet-actions/declare', {
    data: {
      intent: {
        schemaVersion: 1,
        trainerSlug,
        trainerRevision: actions.trainerRevision,
        offerId: offer!.offerId,
        action: 'use',
      },
    },
  }))
  const command = itemCommandFromAuthorizedSheetAction({
    offer: declared as any,
    operationId: id('sheet-item:v1:'),
    targetIds: [target!.targetId],
    choices: [{ choiceId: 'exploration-use-mode', optionIds: [mode] }],
  })
  return parseOk(await page.request.post('/api/items/use', {
    data: { command, clientId: 'playwright-exploration' },
  }))
}

test('exploration items converge through Trainer activity, route generation, and inert Dowsing UI', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await authenticateGm(page)

  const created = await parseOk(await page.request.post('/api/sheets/create', {
    data: { kind: 'trainer', folder: '' },
  }))
  const trainerSlug = String(created.slug)
  const loaded = await parseOk(await page.request.get(`/api/sheets/load?kind=trainer&slug=${trainerSlug}`))
  const trainer = loaded.sheet as Record<string, any>
  await parseOk(await page.request.post('/api/sheets/save', {
    data: {
      kind: 'trainer', slug: trainerSlug, expectedRevision: trainer.revision,
      interactionMode: 'setup-edit',
      sheet: {
        ...trainer,
        name: 'Mira', level: 10,
        skillBackground: { ...(trainer.skillBackground ?? {}), adept: 'occultEd' },
        inventory: {
          ...(trainer.inventory ?? {}),
          foodStuff: [{ id: `bait-${randomBytes(8).toString('hex')}`, name: 'Bait', qty: 1 }],
          medicalKit: [{ id: `repel-${randomBytes(8).toString('hex')}`, name: 'Repel', qty: 1 }],
          keyItems: [{ id: `dowsing-${randomBytes(8).toString('hex')}`, name: 'Dowsing Rod', qty: 1 }],
        },
      },
    },
  }))

  const bait = await executeSheetExplorationItem(page, trainerSlug, 'Bait', 'route-lure')
  expect(bait.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Bait', exactReplay: false })
  const repel = await executeSheetExplorationItem(page, trainerSlug, 'Repel', 'route-ward')
  expect(repel.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Repel', exactReplay: false })

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  const exploration = page.locator('.exploration-card')
  await expect(exploration).toBeVisible()
  await expect(exploration).toContainText('Exploration activity')
  await expect(exploration).toContainText('Bait')
  await expect(exploration).toContainText('Attempt 1 of 3')
  await expect(exploration).toContainText('Repel')
  await expect(exploration).toContainText('Level 15 or lower')
  await expect(exploration).not.toContainText('canonicalDefinitionSha256')
  await expect(exploration).not.toContainText('sourceOperationId')

  const generateLink = exploration.getByRole('link', { name: 'Generate route encounter' })
  await expect(generateLink).toBeVisible()
  await generateLink.click()
  await expect(page).toHaveURL(new RegExp(`/generate\\?.*trainer=${trainerSlug}`))
  const routeRepel = page.getByRole('region', { name: 'Route Repel' })
  await expect(routeRepel).toBeVisible()
  await expect(routeRepel).toContainText('Exploration authority')
  await expect(routeRepel).toContainText('Repel')
  await expect(routeRepel).toContainText('Level 15 or lower')
  await expect(routeRepel).not.toContainText('canonicalDefinitionSha256')
  await expect(routeRepel).not.toContainText('sourceInstanceId')
  expect((await routeRepel.boundingBox())?.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth))
  expect((await new AxeBuilder({ page }).include('.repel-context').analyze()).violations).toEqual([])

  const currentActions = await parseOk(await page.request.get(`/api/items/sheet-actions?trainerSlug=${trainerSlug}`))
  const dowsingOffer = (currentActions.offers as Record<string, any>[])
    .find(candidate => candidate.source?.canonicalId === 'Dowsing Rod')
  expect(dowsingOffer).toBeTruthy()
  const dowsingTarget = (dowsingOffer!.targeting.options as Record<string, any>[])
    .find(candidate => candidate.sheetKind === 'trainer' && candidate.sheetSlug === trainerSlug)
  expect(dowsingTarget?.enabled).toBe(true)
  const terrain = (dowsingTarget!.choices as Record<string, any>[])
    .find(choice => choice.choiceId === 'dowsing-terrain')
  const stunt = (dowsingTarget!.choices as Record<string, any>[])
    .find(choice => choice.choiceId === 'dowsing-skill-stunt')
  expect(terrain?.options.some((option: Record<string, any>) => option.optionId === 'ordinary')).toBe(true)
  expect(stunt).toBeUndefined()
  await parseOk(await page.request.post('/api/items/extended-actions', {
    data: {
      command: {
        schemaVersion: 1,
        kind: 'start',
        operationId: id('item-activity-operation:v1:'),
        activityId: id('item-activity:v1:'),
        settlementOperationId: id('sheet-item:v1:'),
        trainerSlug,
        trainerRevision: currentActions.trainerRevision,
        offerId: dowsingOffer!.offerId,
        targetIds: [dowsingTarget!.targetId],
        choices: [
          { choiceId: 'dowsing-terrain', optionIds: ['ordinary'] },
        ],
      },
      clientId: 'playwright-exploration',
    },
  }))

  await page.goto(`/sheets/trainers/${trainerSlug}`)
  await page.getByRole('button', { name: 'Inventory', exact: true }).click()
  const dowsing = page.locator('.extended-treatment')
  await expect(page.getByRole('heading', { name: 'Dowsing search in progress' })).toBeVisible()
  await expect(dowsing).toContainText('10 campaign minutes · reusable Dowsing Rod')
  await expect(dowsing).toContainText('No Dowsing roll, daily use, Shard award, or inventory change has been applied yet.')
  await expect(dowsing).toContainText('The Dowsing Rod remains in inventory after accepted completion.')
  await expect(dowsing.getByRole('button', { name: 'Complete Dowsing Search' })).toBeDisabled()
  await expect(dowsing).not.toContainText('canonicalDefinitionSha256')
  await expect(dowsing).not.toContainText('sourceOperationId')
  expect((await new AxeBuilder({ page }).include('.extended-treatment').analyze()).violations).toEqual([])
  await testInfo.attach('exploration-items-liveplay', {
    body: await dowsing.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})
