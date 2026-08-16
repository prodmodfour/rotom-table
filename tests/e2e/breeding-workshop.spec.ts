import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fixtures from '../fixtures/breeding/workshop-browser-projections-v1.json' with { type: 'json' }

const BASE_URL = 'http://127.0.0.1:3017'
const PROFILE_SELECTION_KEY = 'rotom:player-profile:selection'
type Audience = 'gm' | 'player'

interface WorkshopRouteOptions {
  readonly failFirstActivity?: boolean
}
interface InstalledWorkshopRoutes {
  readonly requestBodies: Record<string, unknown>[]
  readonly restoreActivity: () => void
}

const fulfillJson = async (route: Route, value: unknown, status = 200): Promise<void> => {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
}

const installWorkshopRoutes = async (
  page: Page,
  audience: Audience,
  options: WorkshopRouteOptions = {},
): Promise<InstalledWorkshopRoutes> => {
  const fixture = fixtures[audience]
  const requestBodies: Record<string, unknown>[] = []
  let activityUnavailable = options.failFirstActivity === true

  await page.route('**/api/player-profiles/list**', route => fulfillJson(route, { profiles: [fixtures.profile] }))
  await page.route('**/api/breeding/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      requestBodies.push({ pathname, body })
    }
    if (pathname === '/api/breeding/items') {
      if (request.method() === 'GET') return fulfillJson(route, fixture.items)
      const body = request.postDataJSON() as Record<string, unknown>
      if (body.action === 'preview-fossil') {
        const option = (suffix: string, label: string) => ({
          optionId: `breeding-item-option:v1:${suffix.repeat(32)}`,
          label,
          description: null,
          disabled: false,
          unavailableReason: null,
        })
        return fulfillJson(route, {
          schemaVersion: 1,
          kind: 'fossil',
          operationId: body.operationId,
          trainerSheetSlug: 'trainer-mira',
          expectedTrainerRevision: 7,
          title: 'Restore a Fossil',
          summary: [
            'Exactly one GM-designated source unit is consumed.',
            'The Reanimation Machine remains in inventory.',
            'The result is an ordinary incubating Egg in the shared lifecycle.',
          ],
          choices: [
            { choiceId: `breeding-item-choice:v1:${'a'.repeat(32)}`, label: 'Nature', minimum: 1, maximum: 1, options: [option('b', 'Cuddly')] },
            { choiceId: `breeding-item-choice:v1:${'c'.repeat(32)}`, label: 'Basic Ability', minimum: 1, maximum: 1, options: [option('d', 'Shell Armor')] },
            { choiceId: `breeding-item-choice:v1:${'e'.repeat(32)}`, label: 'Gender', minimum: 1, maximum: 1, options: [option('f', 'Female')] },
          ],
        })
      }
      if (body.kind === 'assign-egg-warmer') {
        return fulfillJson(route, {
          schemaVersion: 1,
          operationId: body.operationId,
          kind: 'assign-egg-warmer',
          status: 'accepted',
          trainerSheetSlug: 'trainer-mira',
          trainerRevision: 8,
          egg: null,
          assignment: {
            warmerLabel: 'Egg Warmer',
            assignedEggLabels: ['Bulbasaur Egg', 'Eevee Egg', 'Castform Egg'],
            capacity: 4,
            progressRateNumerator: 2,
            progressRateDenominator: 1,
          },
          message: '3 Eggs assigned. Each campaign day now counts as two hatch-rate days.',
        })
      }
      return fulfillJson(route, { statusMessage: 'Unexpected item workflow request.' }, 400)
    }
    if (pathname === '/api/breeding/workshop') return fulfillJson(route, fixture.workshop)
    if (pathname === '/api/breeding/workshop/activity') {
      if (activityUnavailable) {
        return fulfillJson(route, { statusMessage: 'Connection interrupted before current activity loaded.' }, 503)
      }
      return fulfillJson(route, fixture.activity)
    }
    if (pathname === '/api/breeding/consent') return fulfillJson(route, fixture.consent)
    if (pathname === '/api/breeding/hatch' && audience === 'player') return fulfillJson(route, fixtures.player.hatch)
    return fulfillJson(route, { statusMessage: 'Unexpected browser-fixture route.' }, 404)
  })
  return {
    requestBodies,
    restoreActivity: () => { activityUnavailable = false },
  }
}

const prepareContext = async (page: Page, audience: Audience): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: audience, url: BASE_URL, sameSite: 'Lax',
  }])
  if (audience === 'player') {
    await page.addInitScript(({ key, profile }) => {
      localStorage.setItem(key, JSON.stringify({
        schemaVersion: 1,
        profileId: profile.id,
        displayName: profile.displayName,
        rememberedAt: '2026-08-04T00:00:00.000Z',
      }))
    }, { key: PROFILE_SELECTION_KEY, profile: fixtures.profile })
  }
}

const openWorkshop = async (
  page: Page,
  audience: Audience,
  options: WorkshopRouteOptions = {},
): Promise<InstalledWorkshopRoutes> => {
  await prepareContext(page, audience)
  const routes = await installWorkshopRoutes(page, audience, options)
  await page.goto('/breeding?trainer=trainer-mira')
  await expect(page.getByRole('heading', { name: 'Breeding Workshop', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Projects and Eggs' })).toBeVisible()
  return routes
}

const seriousAxeViolations = async (page: Page) => (await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
  .analyze()).violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))

test('player Workshop is axe-clean, keyboard-contained, selector-only, and visually stable', async ({ page }) => {
  test.setTimeout(90_000)
  const { requestBodies } = await openWorkshop(page, 'player')
  const main = page.locator('main[data-rt-context="workshop"]')
  await expect(main).toContainText('Leaf × Participating parent')
  await expect(main).toContainText('Bulbasaur Egg')
  await expect(main).toContainText('Your decision is required')
  const initialText = await main.innerText()
  expect(initialText).not.toContain('Secret Parent')
  for (const id of Object.values(fixtures.aggregateIds)) expect(initialText).not.toContain(id)
  expect(await seriousAxeViolations(page)).toEqual([])

  await expect(main).toHaveScreenshot('breeding-workshop-overview.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  })

  const transferDetails = main.locator('details').filter({ hasText: 'Transfer Egg' })
  await transferDetails.getByText('Transfer Egg', { exact: true }).click()
  const transferOrigin = transferDetails.getByRole('button', { name: 'Open transfer setup' })
  await transferOrigin.focus()
  await transferOrigin.click()
  const transferDialog = page.getByRole('dialog', { name: 'Offer an Egg gift' })
  const recipient = transferDialog.getByLabel('Recipient Trainer slug')
  await expect(recipient).toBeFocused()
  await recipient.fill('trainer-recipient')
  await page.keyboard.press('Shift+Tab')
  await expect(transferDialog.getByRole('button', { name: 'Close transfer setup' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(transferDialog).toHaveCount(0)
  await expect(transferOrigin).toBeFocused()

  const accept = main.getByRole('button', { name: 'Accept this Egg gift' })
  await accept.click()
  await expect.poll(() => requestBodies.filter(entry => entry.pathname === '/api/breeding/consent').length).toBeGreaterThan(1)
  const consentRequest = requestBodies.filter(entry => entry.pathname === '/api/breeding/consent').at(-1)?.body as Record<string, unknown>
  expect(consentRequest).toMatchObject({
    schemaVersion: 1,
    profileId: fixtures.profile.id,
    trainerSheetSlug: 'trainer-mira',
    intent: 'accept-egg-transfer',
    confirmed: true,
  })
  for (const forbidden of ['command', 'scopes', 'readSet', 'receipt', 'roll', 'mechanics']) {
    expect(consentRequest).not.toHaveProperty(forbidden)
  }

  const hatchOrigin = main.getByRole('button', { name: 'Open hatch decision' })
  await hatchOrigin.focus()
  await hatchOrigin.click()
  const hatchDialog = page.getByRole('dialog', { name: 'Bulbasaur hatch' })
  await expect(hatchDialog.getByRole('heading', { name: 'Bulbasaur hatch' })).toBeFocused()
  await expect(hatchDialog).toHaveScreenshot('breeding-hatch-decision.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  })
  const hatchRequest = requestBodies.find(entry => entry.pathname === '/api/breeding/hatch')?.body as Record<string, unknown>
  expect(hatchRequest).toMatchObject({
    profileId: fixtures.profile.id,
    trainerSheetSlug: 'trainer-mira',
    intent: 'inspect',
  })
  expect(hatchRequest).not.toHaveProperty('command')
  await page.keyboard.press('Escape')
  await expect(hatchDialog).toHaveCount(0)
  await expect(hatchOrigin).toBeFocused()

  const persisted = await page.evaluate(() => JSON.stringify(localStorage))
  for (const id of Object.values(fixtures.aggregateIds)) expect(persisted).not.toContain(id)
})

test('GM uses Egg Warmer and reviews Fossil restoration without private custody leakage', async ({ page }) => {
  const { requestBodies } = await openWorkshop(page, 'gm')
  const tools = page.getByRole('region', { name: 'Egg & restoration tools' })
  await expect(tools.getByRole('heading', { name: 'Egg Warmer assignment' })).toBeVisible()
  await expect(tools).toContainText('2 / 4 assigned')
  await tools.getByRole('checkbox', { name: /Castform Egg/u }).check()
  await expect(tools).toContainText('3 / 4 assigned')
  await tools.getByRole('button', { name: 'Save assignment' }).click()
  await expect(tools).toContainText('3 Eggs assigned. Each campaign day now counts as two hatch-rate days.')
  const assignment = requestBodies.find(entry => (entry.body as Record<string, unknown>).kind === 'assign-egg-warmer')?.body
  expect(assignment).toMatchObject({
    schemaVersion: 1,
    kind: 'assign-egg-warmer',
    trainerSheetSlug: 'trainer-mira',
    expectedTrainerRevision: 7,
  })
  expect(JSON.stringify(assignment)).not.toContain('inventoryEntryId')
  expect(JSON.stringify(assignment)).not.toContain('eggId')

  await tools.getByRole('button', { name: 'Review restoration' }).click()
  await expect(tools.getByRole('heading', { name: 'Restore a Fossil' })).toBeVisible()
  await tools.getByLabel('Nature').selectOption({ label: 'Cuddly' })
  await tools.getByLabel('Basic Ability').selectOption({ label: 'Shell Armor' })
  await tools.getByLabel('Gender').selectOption({ label: 'Female' })
  await expect(tools.getByRole('button', { name: 'Confirm & create Egg' })).toBeEnabled()
  const visibleText = await tools.innerText()
  expect(visibleText).not.toContain('breeding-item-option')
  expect(visibleText).not.toContain('operationId')
  expect(await seriousAxeViolations(page)).toEqual([])
})

test('Workshop reflows at acceptance widths and honors reduced motion without horizontal essential-content overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One browser engine covers the explicit CSS-width matrix; mobile has its own visual project.')
  await openWorkshop(page, 'player')
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 800 : 900 })
    await expect.poll(async () => page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .map(element => ({
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          cssWidth: getComputedStyle(element).width,
          boxSizing: getComputedStyle(element).boxSizing,
          parentClass: element.parentElement?.className ?? '',
          parentClientWidth: element.parentElement?.clientWidth ?? 0,
        }))
        .filter(row => row.left < 0 || row.right > document.documentElement.clientWidth),
    }))).toMatchObject({ client: width, scroll: width, offenders: [] })
    const targets = page.locator('main[data-rt-context="workshop"] .breeding-workshop-button:visible, main[data-rt-context="workshop"] .breeding-activity-button:visible, main[data-rt-context="workshop"] .breeding-consent-button:visible, main[data-rt-context="workshop"] .breeding-items__button:visible')
    for (let index = 0; index < await targets.count(); index += 1) {
      const box = await targets.nth(index).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5)
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Open hatch decision' }).click()
  const revealMotion = await page.locator('.hatch-flow').evaluate(element => getComputedStyle(element).transitionDuration)
  expect(revealMotion === '0s' || revealMotion === '0.01ms').toBe(true)
})

test('GM and player browser contexts receive structurally different private Workshop views', async ({ browser }) => {
  const gmContext = await browser.newContext({ baseURL: BASE_URL })
  const playerContext = await browser.newContext({ baseURL: BASE_URL })
  const gm = await gmContext.newPage()
  const player = await playerContext.newPage()
  try {
    await Promise.all([prepareContext(gm, 'gm'), prepareContext(player, 'player')])
    await Promise.all([installWorkshopRoutes(gm, 'gm'), installWorkshopRoutes(player, 'player')])
    await Promise.all([gm.goto('/breeding?trainer=trainer-mira'), player.goto('/breeding?trainer=trainer-mira')])
    await Promise.all([
      expect(gm.getByRole('heading', { name: 'Projects and Eggs' })).toBeVisible(),
      expect(player.getByRole('heading', { name: 'Projects and Eggs' })).toBeVisible(),
    ])
    const gmText = await gm.locator('main').innerText()
    const playerText = await player.locator('main').innerText()
    expect(gmText).toContain('Secret Parent')
    expect(gmText).toContain('GM authority has a strict boundary')
    expect(playerText).toContain('Participating parent')
    expect(playerText).not.toContain('Secret Parent')
    expect(playerText).not.toContain('trainer-secret')
    for (const id of Object.values(fixtures.aggregateIds)) {
      expect(gmText).not.toContain(id)
      expect(playerText).not.toContain(id)
    }
  }
  finally {
    await gmContext.close()
    await playerContext.close()
  }
})

test('interrupted activity load reconnects through visible retry without duplicate cards or private leakage', async ({ page }) => {
  const routes = await openWorkshop(page, 'player', { failFirstActivity: true })
  const alert = page.getByRole('alert').filter({ hasText: 'Current activity is unavailable' })
  await expect(alert).toContainText('Service Unavailable')
  routes.restoreActivity()
  await alert.getByRole('button', { name: 'Retry activity' }).click()
  await expect(page.getByRole('heading', { name: 'Bulbasaur Egg' })).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Bulbasaur Egg' })).toHaveCount(1)
  const text = await page.locator('main').innerText()
  for (const id of Object.values(fixtures.aggregateIds)) expect(text).not.toContain(id)
})
