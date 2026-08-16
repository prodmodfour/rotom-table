// @vitest-environment happy-dom

import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useBreedingItemWorkflows } from '~/composables/breeding/useBreedingItemWorkflows'
import { BREEDING_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingItemBreedingOperation } from '~/utils/itemBreedingOperationStorage'

const realtimeMocks = vi.hoisted(() => ({ callbacks: new Map<string, (event: any) => void>() }))
vi.mock('~/utils/clientId', () => ({ getClientId: () => 'breeding-client' }))
vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: (channel: string, callback: (event: any) => void) => {
    realtimeMocks.callbacks.set(channel, callback)
    return () => realtimeMocks.callbacks.delete(channel)
  },
}))
const optionId = (value: string) => `breeding-item-option:v1:${value.repeat(32)}`
const projection = (revision = 3) => ({
  schemaVersion: 1,
  audience: 'owner',
  trainer: { trainerSheetSlug: 'trainer-mira', trainerRevision: revision, displayName: 'Mira' },
  generatedAtCampaignMinute: 1_440,
  commandsBlocked: false,
  eggWarmer: {
    availability: { enabled: true, unavailableReason: null }, capacity: 4,
    progressRateNumerator: 2, progressRateDenominator: 1,
    units: [{ optionId: optionId('a'), label: 'Egg Warmer', description: null, disabled: false, unavailableReason: null, assignedEggOptionIds: [] }],
    eggs: [{ optionId: optionId('b'), label: 'Eevee Egg', description: null, disabled: false, unavailableReason: null,
      status: 'incubating', accumulatedCampaignMinutes: 0, targetCampaignMinutes: 2_880, percent: 0 }],
  },
  fossil: { availability: { enabled: false, unavailableReason: 'A GM must designate and restore Fossils.' }, sourceOptions: [], machineOptions: [], speciesOptions: [], consumesFossilSource: 1, consumesMachine: 0 },
  artificial: { availability: { enabled: false, unavailableReason: 'A GM must authorize Playing God creation.' }, chemistryOptions: [], moneyCost: 3500, consumesChemistrySet: 0 },
})
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  realtimeMocks.callbacks.clear()
  vi.restoreAllMocks()
})

describe('useBreedingItemWorkflows', () => {
  it('retains an uncertain exact assignment and recovers it without creating a replacement command', async () => {
    let accepted = false
    const posts: unknown[] = []
    const getJson = vi.fn(async () => projection(accepted ? 4 : 3))
    const postJson = vi.fn(async (path: string, body: unknown) => {
      expect(path).toBe(BREEDING_API_PATHS.items)
      posts.push(body)
      if (posts.length === 1) throw new TypeError('accepted response was lost')
      accepted = true
      const command = body as { operationId: string }
      return {
        schemaVersion: 1, operationId: command.operationId, kind: 'assign-egg-warmer', status: 'accepted',
        trainerSheetSlug: 'trainer-mira', trainerRevision: 4, egg: null,
        assignment: { warmerLabel: 'Egg Warmer', assignedEggLabels: ['Eevee Egg'], capacity: 4, progressRateNumerator: 2, progressRateDenominator: 1 },
        message: '1 Egg assigned. Each campaign day now counts as two hatch-rate days.',
      }
    })
    configureApiClientForTests({ getJson, postJson })
    const slug = ref<string | null>('trainer-mira')
    const profileId = ref<string | null>('profile_mira0001')
    let workflows!: ReturnType<typeof useBreedingItemWorkflows>
    const wrapper = mount(defineComponent({
      setup() { workflows = useBreedingItemWorkflows({ trainerSheetSlug: slug, profileId }); return () => h('div') },
    }))
    await flush()
    expect(workflows.projection.value?.trainer.trainerRevision).toBe(3)

    await workflows.saveWarmerAssignment(optionId('a'), [optionId('b')])
    expect(workflows.status.value).toBe('uncertain')
    expect(loadPendingItemBreedingOperation('trainer-mira')).toMatchObject({ profileId: 'profile_mira0001', command: {
      kind: 'assign-egg-warmer', expectedTrainerRevision: 3, warmerUnitOptionId: optionId('a'), eggOptionIds: [optionId('b')],
    } })
    profileId.value = 'profile_other001'
    await flush()
    expect(workflows.status.value).toBe('uncertain')
    expect(workflows.message.value).toContain('another Profile')
    await workflows.retryExact()
    expect(posts).toHaveLength(1)
    profileId.value = 'profile_mira0001'
    await flush()
    await workflows.retryExact()
    expect(posts[1]).toEqual(posts[0])
    expect(workflows.status.value).toBe('accepted')
    expect(workflows.projection.value?.trainer.trainerRevision).toBe(4)
    expect(loadPendingItemBreedingOperation('trainer-mira')).toBeNull()
    wrapper.unmount()
  })

  it('clears a definitively rejected command and reloads on non-echo Trainer updates', async () => {
    const getJson = vi.fn(async () => projection())
    configureApiClientForTests({
      getJson,
      postJson: vi.fn(async () => { throw { statusCode: 409, statusMessage: 'The Trainer changed.' } }),
    })
    let workflows!: ReturnType<typeof useBreedingItemWorkflows>
    const wrapper = mount(defineComponent({
      setup() { workflows = useBreedingItemWorkflows({ trainerSheetSlug: 'trainer-mira', profileId: null }); return () => h('div') },
    }))
    await flush()
    await workflows.saveWarmerAssignment(optionId('a'), [optionId('b')])
    expect(workflows.status.value).toBe('conflict')
    expect(workflows.lastCommand.value).toBeNull()
    expect(loadPendingItemBreedingOperation('trainer-mira')).toBeNull()
    const callback = realtimeMocks.callbacks.get('sheet:trainer:trainer-mira')!
    const calls = getJson.mock.calls.length
    callback({ type: 'updated', clientId: 'other-client', channel: 'sheet:trainer:trainer-mira', timestamp: 2 })
    await flush()
    expect(getJson.mock.calls.length).toBe(calls + 1)
    callback({ type: 'updated', clientId: 'breeding-client', channel: 'sheet:trainer:trainer-mira', timestamp: 3 })
    await flush()
    expect(getJson.mock.calls.length).toBe(calls + 1)
    wrapper.unmount()
  })
})
