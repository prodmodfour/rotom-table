import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const evidenceRoot = resolve('.pi/artifacts/ui-validation/campaign-day-continuation')
const preflightId = `campaign-day-preflight:v1:${'a'.repeat(64)}`

const authenticate = async (context: BrowserContext, role: 'gm' | 'player'): Promise<void> => {
  await context.addCookies([{
    name: 'rotom-role', value: role, url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
}
const json = (route: Route, body: unknown) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(body),
})

const remainingItem = {
  schemaVersion: 1,
  itemId: `campaign-attention:v1:${'1'.repeat(64)}`,
  reason: 'trainer-advancement', audience: 'owner', urgency: 'normal',
  entity: { kind: 'trainer-sheet', id: 'mira' },
  sourceEvent: { kind: 'sheet-authority', eventId: `campaign-attention-source:v1:${'2'.repeat(64)}`, campaignMinute: 1540 },
  authority: { kind: 'sheet', id: 'mira', revision: 5 },
  requiredDecision: {
    decisionId: `campaign-attention-decision:v1:${'3'.repeat(64)}`,
    kind: 'review-trainer-build', authority: { kind: 'sheet', id: 'mira', revision: 5 },
  },
  legalActions: [{
    actionId: `campaign-attention-action:v1:${'4'.repeat(64)}`,
    intent: 'review-trainer', href: '/sheets/trainers/mira',
    authority: { kind: 'sheet', id: 'mira', revision: 5 }, requiresConfirmation: false,
  }],
  resolution: { state: 'open', revision: 0, code: null, resolutionEventId: null, resolvedAtCampaignMinute: null },
  createdAtCampaignMinute: 1540,
} as const

const continuation = (role: 'gm' | 'player', committed: boolean) => ({
  schemaVersion: 1,
  snapshotId: `campaign-continuation-snapshot:v1:${(committed ? 'd' : 'c').repeat(64)}`,
  attention: {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${(committed ? 'd' : 'c').repeat(64)}`,
    scope: role === 'gm' ? 'gm' : 'owner',
    campaignMinute: committed ? 1540 : 100,
    items: committed ? [remainingItem] : [],
    summary: committed
      ? { total: 1, blocking: 0, urgent: 0, normal: 1, informational: 0 }
      : { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
  },
  activeEncounter: null,
  additionalActiveEncounters: 0,
  unfinishedSettlement: null,
  additionalUnfinishedSettlements: 0,
  eggs: { active: 0, incubating: 0, ready: 0, needsAdjudication: 0, hatching: 0, href: '/breeding' },
})

const preflight = {
  schemaVersion: 1,
  state: 'ready',
  preflightId,
  clock: { currentCampaignMinute: 100, targetCampaignMinute: 1540, minutesAdvanced: 1440 },
  blockers: [],
  impact: {
    totalSheets: 3,
    affectedSheetCount: 2,
    affectedSheets: [
      { kind: 'pokemon', label: 'Sparky', href: '/sheets/pokemon/sparky', changes: ['hit-points', 'injury', 'daily-moves'] },
      { kind: 'trainer', label: 'Mira', href: '/sheets/trainers/mira', changes: ['injury', 'conditions', 'trainer-ap'] },
    ],
    additionalAffectedSheets: 0,
    pokemonAffected: 1, trainerAffected: 1,
    hitPointsRestored: 24, injuriesHealed: 2, conditionsCleared: 3,
    dailyMoveUsesCleared: 1, dailyMoveEntriesCleared: 1, trainerApRestored: 4,
    reconciledEggs: 1, creditedEggCampaignMinutes: 1440,
    skippedPausedEggCampaignMinutes: 0, expiredEffects: 1,
  },
  accepted: null,
} as const

const accepted = (operationId: string) => ({
  schemaVersion: 1, operationId, commandSha256: 'b'.repeat(64), ok: true,
  totalSheets: 3, updatedSheets: 2, pokemonSheets: 2, trainerSheets: 1,
  pokemonUpdated: 1, trainerUpdated: 1, hitPointsRestored: 24, injuriesHealed: 2,
  dailyMoveUsesCleared: 1, dailyMoveEntriesCleared: 1, conditionsCleared: 3, trainerApRestored: 4,
  campaignClock: {
    previousRevision: 0, revision: 1, previousCampaignMinute: 100, campaignMinute: 1540,
    minutesAdvanced: 1440,
    clockOperationId: 'breeding-operation:v1:55555555555555555555555555555555',
    reconciledEggs: 1, creditedEggCampaignMinutes: 1440,
    skippedPausedEggCampaignMinutes: 0, eggBatchComplete: true,
  },
  expiredEffects: [{
    mapSlug: 'harbor', effectId: 'effect.daily', durationKind: 'campaign-time', expiresAtCampaignMinute: 1540,
  }],
  replayed: false,
})

const wireContinuation = async (page: Page, role: 'gm' | 'player', state: { committed: boolean }): Promise<void> => {
  await page.route('**/api/campaign/continuation*', async route => json(route, continuation(role, state.committed)))
}

test('GM preflight and postflight converge remaining continuation work with a player client', async ({ page, browser }, testInfo) => {
  const state = { committed: false }
  await authenticate(page.context(), 'gm')
  await wireContinuation(page, 'gm', state)
  await page.route('**/api/campaign/next-day/preflight', async route => json(route, preflight))
  let commitBody: Record<string, unknown> | null = null
  await page.route('**/api/campaign/next-day', async (route) => {
    commitBody = route.request().postDataJSON() as Record<string, unknown>
    expect(commitBody.preflightId).toBe(preflightId)
    expect(commitBody.kind).toBe('advance-one-day')
    expect(commitBody.days).toBe(1)
    state.committed = true
    await json(route, accepted(String(commitBody.operationId)))
  })

  const profileResponse = await page.request.post('/api/player-profiles/create', {
    data: { displayName: `Continuation Player ${testInfo.project.name}` },
  })
  expect(profileResponse.ok()).toBe(true)
  const profile = (await profileResponse.json()).profile as { id: string, displayName: string }
  const playerContext = await browser.newContext({ viewport: page.viewportSize() ?? { width: 393, height: 851 } })
  await authenticate(playerContext, 'player')
  await playerContext.addInitScript(({ id, displayName }) => {
    localStorage.setItem('rotom:player-profile:selection', JSON.stringify({
      schemaVersion: 1, profileId: id, displayName, rememberedAt: new Date().toISOString(),
    }))
  }, profile)
  const player = await playerContext.newPage()
  await wireContinuation(player, 'player', state)

  try {
    await player.goto('/campaign')
    const playerDashboard = player.getByRole('region', { name: 'What needs attention' })
    await expect(playerDashboard).toContainText('Campaign ready')
    await expect(playerDashboard.getByRole('heading', { name: 'Next day' })).toHaveCount(0)

    if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('/campaign')
    const dashboard = page.getByRole('region', { name: 'What needs attention' })
    const origin = dashboard.getByRole('button', { name: 'Review next day' })
    await origin.click()
    const dialog = page.getByRole('dialog', { name: 'Review next day' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Campaign minute 100')
    await expect(dialog).toContainText('1,540')
    await expect(dialog).toContainText('Ready to advance')
    await expect(dialog).toContainText('Sparky')
    await expect(dialog).toContainText('HP · Injury · Daily Moves')
    await expect(dialog).not.toContainText(preflightId)
    await expect(dialog.getByRole('button', { name: 'Advance one day' })).toBeDisabled()

    const axe = await new AxeBuilder({ page })
      .include('.day-preflight')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(axe.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])

    mkdirSync(evidenceRoot, { recursive: true })
    await page.screenshot({
      path: resolve(evidenceRoot, `${testInfo.project.name}-ready.png`),
      fullPage: true, animations: 'disabled', caret: 'hide',
    })

    await dialog.getByLabel('I reviewed these campaign-wide changes.').check()
    const commit = dialog.getByRole('button', { name: 'Advance one day' })
    await expect(commit).toBeEnabled()
    expect((await commit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    await commit.click()
    await expect(page.getByRole('dialog', { name: 'Next day complete' })).toContainText('Authoritative day advancement accepted')
    await expect(page.getByRole('dialog', { name: 'Next day complete' })).toContainText('1 open · 0 blocking · 0 urgent')
    expect(commitBody).not.toBeNull()
    await expect(dashboard).toContainText('Trainer advancement')

    await page.screenshot({
      path: resolve(evidenceRoot, `${testInfo.project.name}-accepted.png`),
      fullPage: true, animations: 'disabled', caret: 'hide',
    })

    await page.getByRole('dialog', { name: 'Next day complete' }).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(origin).toBeFocused()

    await playerDashboard.getByRole('button', { name: 'Refresh' }).click()
    await expect(playerDashboard).toContainText('Trainer advancement')
    await expect(playerDashboard).toContainText('1 open item is waiting before play continues.')

    await expect.poll(async () => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
  }
  finally {
    await playerContext.close()
  }
})
