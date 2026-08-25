import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const evidenceRoot = resolve('.pi/artifacts/ui-validation/campaign-continuation-dashboard')
const preserveAcceptedScreenshot = async (page: Page, path: string): Promise<void> => {
  if (existsSync(path) && process.env.ROTOM_REFRESH_UI_EVIDENCE !== '1') return
  await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' })
}

const authenticateGm = async (page: Page): Promise<void> => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'gm', url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
}

const authority = (id: string) => ({ kind: 'sheet', id, revision: 4 })
const attentionItem = (input: {
  key: string
  reason: 'team-overflow' | 'medical-review' | 'equipment-review'
  urgency: 'blocking' | 'urgent' | 'normal'
  entityKind: 'trainer-sheet' | 'pokemon-sheet'
  entityId: string
  decisionKind: 'repair-team' | 'choose-treatment' | 'repair-equipment'
  actionIntent: 'review-team' | 'start-treatment' | 'review-equipment'
  href: string
}) => ({
  schemaVersion: 1,
  itemId: `campaign-attention:v1:${input.key.repeat(64).slice(0, 64)}`,
  reason: input.reason,
  audience: 'owner',
  urgency: input.urgency,
  entity: { kind: input.entityKind, id: input.entityId },
  sourceEvent: {
    kind: 'sheet-authority',
    eventId: `campaign-attention-source:v1:${input.key.repeat(64).slice(0, 64)}`,
    campaignMinute: 90,
  },
  authority: authority(input.entityId),
  requiredDecision: {
    decisionId: `campaign-attention-decision:v1:${input.key.repeat(64).slice(0, 64)}`,
    kind: input.decisionKind,
    authority: authority(input.entityId),
  },
  legalActions: [{
    actionId: `campaign-attention-action:v1:${input.key.repeat(64).slice(0, 64)}`,
    intent: input.actionIntent,
    href: input.href,
    authority: authority(input.entityId),
    requiresConfirmation: false,
  }],
  resolution: {
    state: 'open', revision: 0, code: null,
    resolutionEventId: null, resolvedAtCampaignMinute: null,
  },
  createdAtCampaignMinute: 90,
})

const team = attentionItem({
  key: 'a', reason: 'team-overflow', urgency: 'blocking', entityKind: 'trainer-sheet', entityId: 'mira',
  decisionKind: 'repair-team', actionIntent: 'review-team', href: '/sheets/trainers/mira',
})
const care = attentionItem({
  key: 'b', reason: 'medical-review', urgency: 'urgent', entityKind: 'pokemon-sheet', entityId: 'sparky',
  decisionKind: 'choose-treatment', actionIntent: 'start-treatment', href: '/sheets/pokemon/sparky?tab=healing',
})
const equipment = attentionItem({
  key: 'c', reason: 'equipment-review', urgency: 'normal', entityKind: 'trainer-sheet', entityId: 'rook',
  decisionKind: 'repair-equipment', actionIntent: 'review-equipment', href: '/sheets/trainers/rook?tab=inventory',
})

const projection = (resolvedTeam: boolean) => {
  const items = resolvedTeam ? [care, equipment] : [team, care, equipment]
  return {
    schemaVersion: 1,
    snapshotId: `campaign-continuation-snapshot:v1:${(resolvedTeam ? 'e' : 'd').repeat(64)}`,
    attention: {
      schemaVersion: 1,
      snapshotId: `campaign-attention-snapshot:v1:${(resolvedTeam ? 'e' : 'd').repeat(64)}`,
      scope: 'gm',
      campaignMinute: 100,
      items,
      summary: {
        total: items.length,
        blocking: resolvedTeam ? 0 : 1,
        urgent: 1,
        normal: 1,
        informational: 0,
      },
    },
    activeEncounter: {
      label: 'Harbor duel', state: 'active', round: 3, participantCount: 4, href: '/play/harbor-duel',
    },
    additionalActiveEncounters: 0,
    unfinishedSettlement: {
      label: 'Old lighthouse', state: 'needs-review', openWorkCount: 2, href: '/play/old-lighthouse',
    },
    additionalUnfinishedSettlements: 0,
    eggs: { active: 2, incubating: 1, ready: 1, needsAdjudication: 0, hatching: 0, href: '/breeding' },
  }
}

test('Campaign continuation prioritizes safe authoritative work and replaces complete snapshots responsively', async ({ page }, testInfo) => {
  await authenticateGm(page)
  let resolvedTeam = false
  await page.route('**/api/campaign/continuation*', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(projection(resolvedTeam)),
  }))

  await page.goto('/campaign')
  const dashboard = page.getByRole('region', { name: 'What needs attention' })
  await expect(dashboard).toBeVisible()
  await expect(dashboard.getByRole('heading', { name: 'What needs attention' })).toBeVisible()
  await expect(dashboard).toContainText('3 open items are waiting before play continues.')
  await expect(dashboard).toContainText('Harbor duel')
  await expect(dashboard).toContainText('Old lighthouse')
  await expect(dashboard).toContainText('Recommended next action')
  await expect(dashboard).toContainText('Team over capacity')
  await expect(dashboard.getByRole('link', { name: 'Review team' }).first()).toBeVisible()
  await expect(dashboard).toContainText('Recovery & care')
  await expect(dashboard).toContainText('Growth & training')
  await expect(dashboard).toContainText('Team, captures & eggs')
  await expect(dashboard).toContainText('2 active Eggs')
  await expect(dashboard).toContainText('Equipment review')
  await expect(dashboard.getByRole('heading', { name: 'Next day' })).toBeVisible()

  const text = await dashboard.innerText()
  for (const privateValue of [
    team.itemId, team.sourceEvent.eventId,
    team.requiredDecision.decisionId, team.legalActions[0]!.actionId, 'sha256', 'profileId',
  ]) expect(text).not.toContain(privateValue)

  const recommendationTop = (await dashboard.locator('.recommendation').boundingBox())?.y ?? 0
  const groupsTop = (await dashboard.locator('.attention-groups').boundingBox())?.y ?? 0
  expect(recommendationTop).toBeLessThan(groupsTop)
  const target = dashboard.getByRole('link', { name: 'Review team' }).first()
  expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
  await target.focus()
  expect(await target.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')

  const layoutColumns = await dashboard.locator('.continuation__layout').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
  ))
  if (testInfo.project.name.includes('mobile')) expect(layoutColumns).toBe(1)
  else expect(layoutColumns).toBe(2)
  await expect.poll(async () => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true)
  await expect(page.getByRole('region', { name: 'Guided item adjudication' })).toContainText('No guided item decisions are waiting.')

  mkdirSync(evidenceRoot, { recursive: true })
  await preserveAcceptedScreenshot(page, resolve(evidenceRoot, `${testInfo.project.name}-open.png`))

  const axe = await new AxeBuilder({ page })
    .include('.continuation')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(axe.violations.filter(value => ['serious', 'critical'].includes(value.impact ?? ''))).toEqual([])

  resolvedTeam = true
  await dashboard.locator('.continuation__refresh').click()
  await expect(dashboard).toContainText('2 open items are waiting before play continues.')
  await expect(dashboard.locator('.recommendation')).toContainText('Medical attention')
  await expect(dashboard.locator('.attention-summary')).toContainText('Blocking0')
  await expect(dashboard.getByText('Team over capacity', { exact: true })).toHaveCount(0)

  if (testInfo.project.name.includes('mobile')) {
    await page.setViewportSize({ width: 320, height: 900 })
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await preserveAcceptedScreenshot(page, resolve(evidenceRoot, `${testInfo.project.name}-320-resolved.png`))
  }
})

test('Campaign continuation keeps campaign-day authority GM-only for an owner projection', async ({ page }) => {
  await page.context().addCookies([{
    name: 'rotom-role', value: 'player', url: 'http://127.0.0.1:3017', sameSite: 'Lax',
  }])
  const ownerProjection = {
    ...projection(true),
    snapshotId: `campaign-continuation-snapshot:v1:${'f'.repeat(64)}`,
    attention: {
      ...projection(true).attention,
      snapshotId: `campaign-attention-snapshot:v1:${'f'.repeat(64)}`,
      scope: 'owner',
      items: [],
      summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
    },
    activeEncounter: null,
    unfinishedSettlement: null,
    eggs: { active: 0, incubating: 0, ready: 0, needsAdjudication: 0, hatching: 0, href: '/breeding' },
  }
  await page.route('**/api/campaign/continuation*', async route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(ownerProjection),
  }))
  await page.goto('/campaign')
  const dashboard = page.getByRole('region', { name: 'What needs attention' })
  await expect(dashboard).toContainText('Campaign ready')
  await expect(dashboard).toContainText('Choose a Player Profile')
  await expect(dashboard.getByRole('heading', { name: 'Next day' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Guided item adjudication' })).toHaveCount(0)
})
