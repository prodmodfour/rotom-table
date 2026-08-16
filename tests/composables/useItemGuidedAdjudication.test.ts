// @vitest-environment happy-dom

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useItemGuidedAdjudication } from '~/composables/items/useItemGuidedAdjudication'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingItemGuidedOperation } from '~/utils/itemGuidedOperationStorage'

const realtime = vi.hoisted(() => ({ callbacks: new Map<string, () => void>() }))
vi.mock('~/utils/clientId', () => ({ getClientId: () => 'guided-client' }))
vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: (channel: string, callback: () => void) => {
    realtime.callbacks.set(channel, callback)
    return () => realtime.callbacks.delete(channel)
  },
}))

const requestId = 'item-guided:v1:11111111111111111111111111111111'
const pendingRequest = {
  schemaVersion: 1, requestId, revision: 0, status: 'pending', requestKind: 'loyalty-consequence',
  canonicalItemId: 'Energy Powder', itemLabel: 'Energy Powder', actorLabel: 'Mira', targetLabel: 'Sparky',
  targetKindLabel: 'Pokémon', timingLabel: 'Standard Action', prompt: 'How does this use affect Loyalty?',
  canonicalFacts: ['Restores 25 HP when accepted.'],
  choices: [
    { optionId: 'record-no-loyalty-change', label: 'Record use; no Loyalty Rank change', description: 'No change.' },
    { optionId: 'lower-loyalty-by-one', label: 'Lower Loyalty by 1', description: 'Lower by exactly 1.' },
  ],
  settlementFacts: ['Consume one reserved Energy Powder.'], reservationLabel: '1 Energy Powder reserved',
  boundaryLabel: 'No HP, Loyalty, or inventory change until accepted.', canCancel: true, acceptedSummary: null,
} as const
const projection = { schemaVersion: 1, requests: [pendingRequest], reBreatherOffers: [] } as const
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  realtime.callbacks.clear()
  vi.restoreAllMocks()
})

describe('useItemGuidedAdjudication', () => {
  it('makes exact retry dominant after an uncertain response and reuses the identical bounded command', async () => {
    const posts: any[] = []
    const getJson = vi.fn(async () => projection)
    const postJson = vi.fn(async (path: string, body: any) => {
      expect(path).toBe(ITEM_API_PATHS.guided)
      posts.push(structuredClone(body))
      if (posts.length === 1) throw new TypeError('response lost after acceptance')
      return {
        result: {
          schemaVersion: 1,
          operationId: body.command.operationId,
          exactReplay: true,
          request: {
            ...pendingRequest,
            revision: 1,
            status: 'accepted',
            choices: [],
            canCancel: false,
            acceptedSummary: 'Energy Powder accepted. No Loyalty Rank change recorded.',
          },
        },
        sheets: [],
      }
    })
    configureApiClientForTests({ getJson, postJson })
    let guided!: ReturnType<typeof useItemGuidedAdjudication>
    const wrapper = mount(defineComponent({
      setup() { guided = useItemGuidedAdjudication({ mode: 'gm' }); return () => h('div') },
    }))
    await flush()
    expect(guided.requests.value).toHaveLength(1)
    await guided.resolve(guided.requests.value[0]!, guided.requests.value[0]!.choices[0]!)
    expect(guided.status.value).toBe('uncertain')
    const pending = loadPendingItemGuidedOperation('gm')
    expect(pending?.command).toMatchObject({
      action: 'resolve', requestId, expectedRevision: 0, optionId: 'record-no-loyalty-change',
    })
    const getCalls = getJson.mock.calls.length
    await guided.load()
    realtime.callbacks.get('item-guided:gm')?.()
    await flush()
    expect(getJson).toHaveBeenCalledTimes(getCalls)
    expect(guided.canRefresh.value).toBe(false)

    await guided.retryExact()
    expect(posts).toHaveLength(2)
    expect(posts[1]).toEqual(posts[0])
    expect(guided.status.value).toBe('accepted')
    expect(guided.lastAcceptedRequest.value?.status).toBe('accepted')
    expect(loadPendingItemGuidedOperation('gm')).toBeNull()
    wrapper.unmount()
  })

  it('clears one definitively rejected cancellation and permits an authoritative refresh', async () => {
    const getJson = vi.fn(async () => projection)
    configureApiClientForTests({
      getJson,
      postJson: vi.fn(async () => { throw { statusCode: 409, statusMessage: 'The request changed.' } }),
    })
    let guided!: ReturnType<typeof useItemGuidedAdjudication>
    const wrapper = mount(defineComponent({
      setup() { guided = useItemGuidedAdjudication({ mode: 'gm' }); return () => h('div') },
    }))
    await flush()
    await guided.cancel(guided.requests.value[0]!)
    expect(guided.status.value).toBe('conflict')
    expect(loadPendingItemGuidedOperation('gm')).toBeNull()
    expect(guided.canRefresh.value).toBe(true)
    await guided.load()
    expect(guided.status.value).toBe('ready')
    wrapper.unmount()
  })
})
