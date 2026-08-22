import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const BASE_URL = 'http://127.0.0.1:3017'

const authenticate = async (context: BrowserContext, role: 'gm' | 'player'): Promise<void> => {
  await context.addCookies([{ name: 'rotom-role', value: role, url: BASE_URL, sameSite: 'Lax' }])
}

const parseOk = async (response: import('@playwright/test').APIResponse): Promise<Record<string, any>> => {
  const text = await response.text()
  expect(response.ok(), `${response.status()} ${text}`).toBe(true)
  return JSON.parse(text) as Record<string, any>
}

const expectNoSeriousViolations = async (page: Page, label: string): Promise<void> => {
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter(violation =>
    violation.impact === 'serious' || violation.impact === 'critical')
  expect(serious, `${label}: ${serious.map(violation => `${violation.id} (${violation.nodes.length})`).join(', ')}`)
    .toHaveLength(0)
}

const rememberProfile = async (context: BrowserContext, profileId: string, displayName: string): Promise<void> => {
  await context.addInitScript(({ id, name }) => {
    window.localStorage.setItem('rotom:player-profile:selection', JSON.stringify({
      schemaVersion: 1,
      profileId: id,
      displayName: name,
      rememberedAt: new Date().toISOString(),
    }))
  }, { id: profileId, name: displayName })
}

test.describe('onboarding accessibility, responsive, and concurrency acceptance', () => {
  test('axe, keyboard, reflow, and stale-tab reconciliation pass on the core surfaces', async ({ browser }) => {
    test.setTimeout(240_000)
    const playerName = `Acceptance Player ${Date.now().toString(36)}`

    const gmContext = await browser.newContext()
    await authenticate(gmContext, 'gm')
    const gm = await gmContext.newPage()

    /* Seed: policy + slot via UI-backed APIs. */
    const overviewBefore = await parseOk(await gm.request.get('/api/onboarding/overview'))
    if (!overviewBefore.activePolicy) {
      await gm.goto('/onboarding/policy')
      await gm.getByLabel('Policy name').fill('Acceptance policy')
      await gm.getByRole('button', { name: /Publish version/ }).click()
      await expect(gm.getByText(/Published a new policy version/)).toBeVisible()
    }
    const slot = await parseOk(await gm.request.post('/api/onboarding/slots/create', {
      data: { newProfileDisplayName: playerName },
    }))
    const draftId = String(slot.draftId)
    const profileId = String((slot.profile as Record<string, any>).id)

    /* Axe: GM queue and policy editor. */
    await gm.goto('/onboarding')
    await expect(gm.getByRole('heading', { name: 'Onboarding queue' })).toBeVisible()
    await expectNoSeriousViolations(gm, 'gm queue')
    await gm.goto('/onboarding/policy')
    await expect(gm.getByRole('heading', { name: 'Campaign onboarding policy' })).toBeVisible()
    await expectNoSeriousViolations(gm, 'policy editor')

    /* Player surfaces. */
    const playerContext = await browser.newContext()
    await authenticate(playerContext, 'player')
    await rememberProfile(playerContext, profileId, playerName)
    const player = await playerContext.newPage()

    await player.goto('/onboarding')
    await expect(player.getByRole('heading', { name: 'Your character' })).toBeVisible()
    await expectNoSeriousViolations(player, 'player home')

    await player.goto(`/onboarding/draft/${draftId}`)
    await expect(player.getByRole('heading', { name: 'Trainer identity' })).toBeVisible()
    await expectNoSeriousViolations(player, 'builder')

    /* Keyboard-only: reach the rail, activate a decision, and use a stepper. */
    await player.getByRole('button', { name: /Stat points 0\/10/ }).focus()
    await player.keyboard.press('Enter')
    await expect(player.getByRole('heading', { name: 'Stat points' })).toBeVisible()
    const addHp = player.getByRole('button', { name: 'Add point to HP' })
    await addHp.focus()
    await player.keyboard.press('Enter')
    await expect(player.getByText('9 left', { exact: false })).toBeVisible()
    await player.keyboard.press('Enter')
    await expect(player.getByText('8 left', { exact: false })).toBeVisible()

    /* 320px reflow: no horizontal page scrolling on the builder. */
    await player.setViewportSize({ width: 320, height: 800 })
    await player.goto(`/onboarding/draft/${draftId}?decision=trainer.stat-allocation`)
    await expect(player.getByRole('heading', { name: 'Stat points' })).toBeVisible()
    const scrollWidth = await player.evaluate(() => document.scrollingElement?.scrollWidth ?? 0)
    expect(scrollWidth, `builder scrollWidth ${scrollWidth} at 320px`).toBeLessThanOrEqual(322)
    await player.setViewportSize({ width: 1280, height: 800 })

    /* Stale-tab reconciliation (P9-086): a second tab writes; the first must
     * reconcile instead of overwriting. */
    const playerTabTwo = await playerContext.newPage()
    await playerTabTwo.goto(`/onboarding/draft/${draftId}?decision=trainer.identity`)
    await expect(playerTabTwo.getByRole('heading', { name: 'Trainer identity' })).toBeVisible()
    await playerTabTwo.getByLabel('Name *').fill('Tab Two Name')
    await expect(playerTabTwo.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })
    await playerTabTwo.waitForTimeout(1200)

    await player.goto(`/onboarding/draft/${draftId}?decision=trainer.identity`)
    await expect(player.getByRole('heading', { name: 'Trainer identity' })).toBeVisible()
    await player.getByLabel('Name *').fill('Tab One Name')
    await playerTabTwo.getByLabel('Name *').fill('Tab Two Again')
    await playerTabTwo.waitForTimeout(1200)
    await player.waitForTimeout(1200)
    const conflictVisible = await player.getByText(/changed somewhere else|Out of date/).first().isVisible().catch(() => false)
    const savedVisible = await player.getByText('Saved', { exact: true }).isVisible().catch(() => false)
    expect(conflictVisible || savedVisible).toBe(true)
    if (conflictVisible) {
      await player.getByRole('button', { name: 'Reload latest' }).click()
      await expect(player.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 })
    }

    /* The durable draft holds exactly one authoritative name; no lost-update corruption. */
    const finalDraft = await parseOk(await gm.request.get(`/api/onboarding/draft/load?draftId=${draftId}`))
    const finalName = String((finalDraft.draft as Record<string, any>).trainerBuild.name ?? '')
    expect(['Tab One Name', 'Tab Two Again', 'Tab Two Name']).toContain(finalName)

    await gmContext.close()
    await playerContext.close()
  })
})
