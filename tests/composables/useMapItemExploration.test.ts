/**
 * @vitest-environment happy-dom
 */
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { useMapItemExploration } from '~/composables/encounter/useMapItemExploration'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { loadPendingItemExplorationOperation } from '~/utils/itemExplorationOperationStorage'

const realtimeMocks = vi.hoisted(() => ({ callbacks: new Map<string, (event: any) => void>() }))
vi.mock('~/utils/clientId', () => ({ getClientId: () => 'repel-client' }))
vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: (channel: string, callback: (event: any) => void) => {
    realtimeMocks.callbacks.set(channel, callback)
    return () => realtimeMocks.callbacks.delete(channel)
  },
}))

const decisionId = 'item-repel-position:v1:44444444444444444444444444444444'
const authority = (revision = 7, pending = true) => ({
  schemaVersion: 1,
  kind: 'map',
  mapSlug: 'route-map',
  mapRevision: revision,
  generatedAt: 500,
  repelPositioning: pending ? [{
    decisionId,
    itemLabel: 'Repel',
    sourcePlacementId: 'trainer-placement',
    sourceLabel: 'Explorer',
    sourcePosition: { x: 1, y: 0, z: 1 },
    targetPlacementId: 'wild-placement',
    targetLabel: 'Wild Rattata',
    targetPosition: { x: 2, y: 0, z: 1 },
    destinationBounds: { x: [0, 9], y: [0, 2], z: [0, 5] },
    maximumAffectedWildLevel: 15,
    prompt: 'Choose one legal Shift endpoint farther from the source.',
  }] : [],
})
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetApiClientForTests()
  window.sessionStorage.clear()
  realtimeMocks.callbacks.clear()
  vi.restoreAllMocks()
})

describe('useMapItemExploration', () => {
  it('retains and exact-retries uncertain GM Repel positioning, then converges to the new map revision', async () => {
    const revision = ref(7)
    const posted: unknown[] = []
    let attempts = 0
    let accepted = false
    const getJson = vi.fn(async () => authority(accepted ? 8 : 7, !accepted))
    const postJson = vi.fn(async (path: string, body: unknown): Promise<unknown> => {
      expect(path).toBe(ITEM_API_PATHS.exploration)
      posted.push(body)
      attempts += 1
      if (attempts === 1) throw new TypeError('response lost')
      accepted = true
      revision.value = 8
      const command = (body as { command: { operationId: string; kind: string } }).command
      return { result: {
        schemaVersion: 1,
        operationId: command.operationId,
        kind: command.kind,
        status: 'accepted', exactReplay: true,
        message: 'Recovered direct Repel settlement.',
        trainerSlug: null, trainerRevision: null,
        mapSlug: 'route-map', mapRevision: 8, activity: null,
      } }
    })
    configureApiClientForTests({ getJson, postJson })
    const afterAccepted = vi.fn()
    let exploration!: ReturnType<typeof useMapItemExploration>
    const wrapper = mount(defineComponent({
      setup() {
        exploration = useMapItemExploration({
          mapSlug: 'route-map', mapRevision: revision, enabled: true, afterAccepted,
        })
        return () => h('div')
      },
    }))
    await flush()
    expect(exploration.decisions.value).toHaveLength(1)
    const mapEvent = realtimeMocks.callbacks.get('map:route-map')!
    mapEvent({ type: 'updated', clientId: 'other-client', timestamp: 501, channel: 'map:route-map' })
    await flush()
    expect(getJson).toHaveBeenCalledTimes(2)
    mapEvent({ type: 'updated', clientId: 'repel-client', timestamp: 502, channel: 'map:route-map' })
    await flush()
    expect(getJson).toHaveBeenCalledTimes(2)
    await exploration.settle(decisionId, { x: 5, y: 0, z: 1 })
    expect(exploration.status.value).toBe('uncertain')
    const pending = loadPendingItemExplorationOperation('map:route-map')
    expect(pending).toMatchObject({ profileId: null, command: {
      kind: 'settle-direct-repel', mapSlug: 'route-map', mapRevision: 7,
      decisionId, destination: { x: 5, y: 0, z: 1 },
    } })

    await exploration.retryExact()
    expect((posted[1] as { command: unknown }).command).toEqual((posted[0] as { command: unknown }).command)
    expect(afterAccepted).toHaveBeenCalledWith(expect.objectContaining({ mapRevision: 8, exactReplay: true }))
    expect(exploration.decisions.value).toEqual([])
    expect(exploration.status.value).toBe('accepted')
    expect(exploration.message.value).toContain('recovered without moving or forfeiting twice')
    expect(loadPendingItemExplorationOperation('map:route-map')).toBeNull()
    wrapper.unmount()
  })

  it('does not load or settle without GM-enabled authority and blocks new commands while uncertain', async () => {
    const enabled = ref(false)
    const getJson = vi.fn(async () => authority())
    const postJson = vi.fn(async () => { throw new TypeError('offline') })
    configureApiClientForTests({ getJson, postJson })
    let exploration!: ReturnType<typeof useMapItemExploration>
    const wrapper = mount(defineComponent({
      setup() {
        exploration = useMapItemExploration({ mapSlug: 'route-map', mapRevision: 7, enabled })
        return () => h('div')
      },
    }))
    await flush()
    expect(getJson).not.toHaveBeenCalled()
    await exploration.settle(decisionId, { x: 5, y: 0, z: 1 })
    expect(postJson).not.toHaveBeenCalled()

    enabled.value = true
    await flush()
    await exploration.settle(decisionId, { x: 5, y: 0, z: 1 })
    expect(exploration.status.value).toBe('uncertain')
    await exploration.settle(decisionId, { x: 6, y: 0, z: 1 })
    expect(postJson).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
