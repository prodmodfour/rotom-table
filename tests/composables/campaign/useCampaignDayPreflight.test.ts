// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApiClientForTests, resetApiClientForTests } from '../../../src/composables/useApiClient'
import { useCampaignDayPreflight } from '../../../src/composables/campaign/useCampaignDayPreflight'
import { CAMPAIGN_API_PATHS } from '../../../src/utils/apiRoutes'
import { CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY } from '../../../src/utils/campaignDayOperationStorage'

vi.mock('~/utils/clientId', () => ({ getClientId: () => 'campaign-day-client' }))

const impact = {
  totalSheets: 2, affectedSheetCount: 1,
  affectedSheets: [{ kind: 'pokemon', label: 'Sparky', href: '/sheets/pokemon/sparky', changes: ['hit-points', 'injury'] }],
  additionalAffectedSheets: 0, pokemonAffected: 1, trainerAffected: 0,
  hitPointsRestored: 10, injuriesHealed: 1, conditionsCleared: 1,
  dailyMoveUsesCleared: 1, dailyMoveEntriesCleared: 1, trainerApRestored: 0,
  reconciledEggs: 1, creditedEggCampaignMinutes: 1440,
  skippedPausedEggCampaignMinutes: 0, expiredEffects: 1,
} as const
const ready = {
  schemaVersion: 1, state: 'ready', preflightId: `campaign-day-preflight:v1:${'a'.repeat(64)}`,
  clock: { currentCampaignMinute: 5760, targetCampaignMinute: 7200, minutesAdvanced: 1440 },
  blockers: [], impact, accepted: null,
} as const
const result = {
  schemaVersion: 1,
  operationId: 'campaign-day:v1:11111111111111111111111111111111',
  commandSha256: 'b'.repeat(64), ok: true,
  totalSheets: 2, updatedSheets: 1, pokemonSheets: 1, trainerSheets: 1,
  pokemonUpdated: 1, trainerUpdated: 0, hitPointsRestored: 10, injuriesHealed: 1,
  dailyMoveUsesCleared: 1, dailyMoveEntriesCleared: 1, conditionsCleared: 1, trainerApRestored: 0,
  campaignClock: {
    previousRevision: 4, revision: 5, previousCampaignMinute: 5760, campaignMinute: 7200,
    minutesAdvanced: 1440,
    clockOperationId: 'breeding-operation:v1:22222222222222222222222222222222',
    reconciledEggs: 1, creditedEggCampaignMinutes: 1440,
    skippedPausedEggCampaignMinutes: 0, eggBatchComplete: true,
  },
  expiredEffects: [{
    mapSlug: 'arena', effectId: 'effect.daily', durationKind: 'campaign-time', expiresAtCampaignMinute: 7000,
  }],
  replayed: false,
} as const
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

const harness = (onAccepted = vi.fn()) => {
  let value!: ReturnType<typeof useCampaignDayPreflight>
  const wrapper = mount(defineComponent({
    setup() {
      value = useCampaignDayPreflight({ onAccepted })
      return () => h('div')
    },
  }))
  return { wrapper, value, onAccepted }
}

afterEach(() => {
  resetApiClientForTests()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('useCampaignDayPreflight', () => {
  it('requires one reviewed ready preflight before posting its exact retained command', async () => {
    const posts: Array<{ path: string, body: any }> = []
    configureApiClientForTests({
      getJson: vi.fn(),
      postJson: vi.fn(async (path, body) => {
        posts.push({ path, body })
        return path === CAMPAIGN_API_PATHS.nextDayPreflight ? ready : result
      }),
    })
    const { wrapper, value, onAccepted } = harness()
    await value.show()
    await flush()
    expect(value.phase.value).toBe('ready')
    expect(value.canCommit.value).toBe(false)
    value.confirmed.value = true
    expect(value.canCommit.value).toBe(true)
    await value.commit()
    await flush()
    expect(posts.map(row => row.path)).toEqual([
      CAMPAIGN_API_PATHS.nextDayPreflight,
      CAMPAIGN_API_PATHS.nextDay,
    ])
    expect(posts[1]!.body).toMatchObject({
      schemaVersion: 1, kind: 'advance-one-day', days: 1,
      preflightId: ready.preflightId, clientId: 'campaign-day-client',
    })
    expect(value.phase.value).toBe('accepted')
    expect(value.postflight.value).toMatchObject({
      clock: { targetCampaignMinute: 7200 },
      accepted: { replayed: false, impact: { affectedSheetCount: 1, injuriesHealed: 1 } },
    })
    expect(window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)).toBeNull()
    expect(onAccepted).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('never commits a blocked preflight and keeps server-issued blocker links intact', async () => {
    const postJson = vi.fn(async () => ({
      ...ready,
      state: 'blocked',
      blockers: [{
        kind: 'attention', reason: 'team-overflow', label: 'Team capacity work',
        count: 1, href: '/sheets/trainers/mira',
      }],
    }))
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const { wrapper, value } = harness()
    await value.show()
    await flush()
    expect(value.phase.value).toBe('blocked')
    value.confirmed.value = true
    expect(value.canCommit.value).toBe(false)
    await value.commit()
    expect(postJson).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('discards a delayed preflight response after the review closes', async () => {
    let resolve!: (value: unknown) => void
    const delayed = new Promise<unknown>((done) => { resolve = done })
    configureApiClientForTests({ getJson: vi.fn(), postJson: vi.fn(() => delayed) })
    const { wrapper, value } = harness()
    const showing = value.show()
    await flush()
    expect(value.phase.value).toBe('loading')
    value.close()
    expect(value.phase.value).toBe('idle')
    resolve(ready)
    await showing
    await flush()
    expect(value.phase.value).toBe('idle')
    expect(value.projection.value).toBeNull()
    wrapper.unmount()
  })

  it('fails closed when another tab loses the retained command and requires a fresh exact check', async () => {
    const postJson = vi.fn(async () => ready)
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const { wrapper, value } = harness()
    await value.show()
    await flush()
    value.confirmed.value = true
    window.localStorage.removeItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)
    window.dispatchEvent(new StorageEvent('storage', {
      key: CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY,
      oldValue: JSON.stringify({ schemaVersion: 1 }),
      newValue: null,
    }))
    expect(value.phase.value).toBe('error')
    expect(value.uncertain.value).toBe(true)
    expect(value.canCommit.value).toBe(false)
    await value.commit()
    expect(postJson).toHaveBeenCalledOnce()

    await value.check()
    await flush()
    expect(value.phase.value).toBe('ready')
    expect(window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)).not.toBeNull()
    wrapper.unmount()
  })

  it('does not send preflight or commit commands while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const postJson = vi.fn()
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const { wrapper, value } = harness()
    await value.show()
    expect(value.phase.value).toBe('error')
    expect(value.online.value).toBe(false)
    expect(value.error.value).toContain('offline')
    expect(postJson).not.toHaveBeenCalled()
    await value.commit()
    expect(postJson).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('retains an uncertain exact command and clears it only after explicit accepted-status recovery', async () => {
    let preflightCalls = 0
    const postJson = vi.fn(async (path: string) => {
      if (path === CAMPAIGN_API_PATHS.nextDayPreflight) {
        preflightCalls += 1
        if (preflightCalls === 1) return ready
        const acceptedImpact = { ...impact, affectedSheets: [], additionalAffectedSheets: 1 }
        return {
          ...ready, state: 'already-accepted', preflightId: null,
          impact: acceptedImpact,
          accepted: { replayed: true, impact: acceptedImpact },
        }
      }
      throw new TypeError('Response lost after acceptance')
    })
    configureApiClientForTests({ getJson: vi.fn(), postJson })
    const { wrapper, value } = harness()
    await value.show()
    value.confirmed.value = true
    await value.commit()
    expect(value.phase.value).toBe('error')
    expect(value.uncertain.value).toBe(true)
    expect(window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)).not.toBeNull()
    await value.check()
    await flush()
    expect(value.phase.value).toBe('accepted')
    expect(value.postflight.value?.accepted.replayed).toBe(true)
    expect(window.localStorage.getItem(CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY)).toBeNull()
    wrapper.unmount()
  })
})
