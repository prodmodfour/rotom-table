/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useTrainerItemExploration } from '~/composables/sheets/useTrainerItemExploration'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingItemExplorationOperation } from '~/utils/itemExplorationOperationStorage'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const realtimeMocks = vi.hoisted(() => ({ callbacks: new Map<string, (event: any) => void>() }))
vi.mock('~/utils/clientId', () => ({ getClientId: () => 'exploration-client' }))
vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: (channel: string, callback: (event: any) => void) => {
    realtimeMocks.callbacks.set(channel, callback)
    return () => realtimeMocks.callbacks.delete(channel)
  },
}))

const trainer = (): TrainerSheet => ({ slug: 'explorer', name: 'Explorer', level: 10, revision: 3 })
const authority = (revision = 3, canResolveCheck = true) => ({
  schemaVersion: 1,
  kind: 'trainer',
  trainerSlug: 'explorer',
  trainerRevision: revision,
  campaignClockRevision: 2,
  campaignMinute: 115,
  generatedAt: 500,
  projection: {
    schemaVersion: 1,
    routeLures: [{
      activityId: 'item-route-lure:v1:22222222222222222222222222222222',
      itemLabel: 'Bait',
      status: canResolveCheck ? 'active' : 'awaiting-encounter',
      attemptsResolved: canResolveCheck ? 0 : 1,
      maximumAttempts: 3,
      nextCheckAtCampaignMinute: canResolveCheck ? 115 : null,
      outcome: null,
      canResolveCheck,
      needsGmEncounter: !canResolveCheck,
      reusable: false,
    }],
    repels: [{ itemLabel: 'Repel', maximumAffectedWildLevel: 15, expiresAtCampaignMinute: 160, active: true }],
    dowsing: { campaignDayIndex: 0, uses: 0, maximumUses: 2, latest: null },
  },
  permissions: {
    canResolveChecks: true,
    canCancelOwnLure: true,
    canSettleEncounter: false,
    canAdjudicateLureLoss: false,
  },
})
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  window.localStorage.clear()
  realtimeMocks.callbacks.clear()
  vi.restoreAllMocks()
})

describe('useTrainerItemExploration', () => {
  it('loads only at a clean save boundary, retains an uncertain check, and exact-retries it once', async () => {
    const saveStatus: Ref<SaveStatus> = ref('saving')
    const posted: unknown[] = []
    let postAttempts = 0
    let accepted = false
    const getJson = vi.fn(async () => authority(accepted ? 4 : 3, !accepted))
    const postJson = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      expect(path).toBe(ITEM_API_PATHS.exploration)
      posted.push(body)
      postAttempts += 1
      if (postAttempts === 1) throw new TypeError('accepted response was lost')
      accepted = true
      const command = (body as { command: { operationId: string; kind: string } }).command
      return { result: {
        schemaVersion: 1,
        operationId: command.operationId,
        kind: command.kind,
        status: 'accepted',
        exactReplay: true,
        message: 'Recovered route check.',
        trainerSlug: 'explorer',
        trainerRevision: 4,
        mapSlug: null,
        mapRevision: null,
        activity: {
          activityId: authority().projection.routeLures[0]!.activityId,
          itemLabel: 'Bait', status: 'awaiting-encounter', attemptsResolved: 1,
          maximumAttempts: 3, nextCheckAtCampaignMinute: null, outcome: null,
          canResolveCheck: false, needsGmEncounter: true, reusable: false,
        },
      } }
    })
    configureApiClientForTests({ getJson, postJson })
    const prepare = vi.fn(async () => undefined)
    let exploration!: ReturnType<typeof useTrainerItemExploration>
    const wrapper = mount(defineComponent({
      setup() {
        exploration = useTrainerItemExploration({
          sheet: trainer(), saveStatus, profileId: 'profile_explorer01', prepareForAction: prepare,
        })
        return () => h('div')
      },
    }))
    await flush()
    expect(getJson).not.toHaveBeenCalled()

    saveStatus.value = 'saved'
    await flush()
    expect(getJson).toHaveBeenCalledWith(ITEM_API_PATHS.exploration, {
      params: { trainerSlug: 'explorer', profileId: 'profile_explorer01' },
    })
    expect(exploration.activeRouteLure.value?.canResolveCheck).toBe(true)
    const clockEvent = realtimeMocks.callbacks.get('sheet:trainer:explorer')!
    clockEvent({
      type: 'item-exploration-clock-updated', clientId: 'other-client', timestamp: 501,
      channel: 'sheet:trainer:explorer',
    })
    await flush()
    expect(getJson).toHaveBeenCalledTimes(2)
    clockEvent({
      type: 'item-exploration-clock-updated', clientId: 'exploration-client', timestamp: 502,
      channel: 'sheet:trainer:explorer',
    })
    await flush()
    expect(getJson).toHaveBeenCalledTimes(2)
    await exploration.resolveCheck()
    expect(exploration.status.value).toBe('uncertain')
    const pending = loadPendingItemExplorationOperation('trainer:explorer')
    expect(pending).toMatchObject({ profileId: 'profile_explorer01', command: {
      kind: 'resolve-route-lure-check', trainerSlug: 'explorer', trainerRevision: 3,
      campaignClockRevision: 2, activityId: authority().projection.routeLures[0]!.activityId,
    } })
    expect(String(pending?.command.operationId)).toMatch(/^item-exploration:v1:[0-9a-f]{32}$/)

    await exploration.retryExact()
    expect((posted[1] as { command: unknown }).command).toEqual((posted[0] as { command: unknown }).command)
    expect(exploration.status.value).toBe('accepted')
    expect(exploration.message.value).toContain('recovered without resolving or consuming anything twice')
    expect(exploration.activeRouteLure.value?.needsGmEncounter).toBe(true)
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toBeNull()
    expect(prepare).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('clears retained authority after a definitive conflict and never submits a replacement command', async () => {
    configureApiClientForTests({
      getJson: vi.fn(async () => authority()),
      postJson: vi.fn(async () => { throw { statusCode: 409, statusMessage: 'The campaign clock changed.' } }),
    })
    let exploration!: ReturnType<typeof useTrainerItemExploration>
    const wrapper = mount(defineComponent({
      setup() {
        exploration = useTrainerItemExploration({ sheet: trainer(), saveStatus: 'saved', profileId: null })
        return () => h('div')
      },
    }))
    await flush()
    await exploration.resolveCheck()
    expect(exploration.status.value).toBe('conflict')
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toBeNull()
    expect(exploration.lastCommand.value).toBeNull()
    wrapper.unmount()
  })
})
