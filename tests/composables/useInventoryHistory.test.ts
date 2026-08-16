import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useInventoryHistory } from '~/composables/inventory/useInventoryHistory'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'

const projection = (kind: 'trainer' | 'group', label: string, occurredAt = 100) => ({
  schemaVersion: 1,
  generatedAt: occurredAt + 1,
  scope: { kind, label },
  facts: [{
    kind: 'transfer', occurredAt, headline: 'Potion transferred',
    item: { label: 'Potion', quantity: 1 },
    custody: { sourceLabel: 'Trainer inventory', destinationLabel: 'Shared inventory' },
    details: ['Moved from Trainer inventory to Shared inventory.'],
  }],
  truncated: false,
})

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { while (scopes.length) scopes.pop()?.stop() })

describe('useInventoryHistory', () => {
  it('loads and strictly adopts the current scoped projection with Profile-bound query authority', async () => {
    const vueScope = effectScope()
    scopes.push(vueScope)
    const getJson = vi.fn(async () => projection('trainer', 'Ash inventory'))
    const history = vueScope.run(() => useInventoryHistory({
      scope: ref({ kind: 'trainer' as const, slug: 'ash' }),
      profileId: ref('profile_abcdefgh'),
      apiClient: { getJson },
      autoLoadOnMounted: false,
    }))!

    await history.load()
    expect(getJson).toHaveBeenCalledWith(INVENTORY_ACTION_API_PATHS.history, {
      params: { trainerSlug: 'ash', profileId: 'profile_abcdefgh', limit: 20 },
    })
    expect(history.status.value).toBe('ready')
    expect(history.projection.value?.scope).toEqual({ kind: 'trainer', label: 'Ash inventory' })
  })

  it('retains accepted receipts on refresh failure but clears them immediately when scope authority changes', async () => {
    const vueScope = effectScope()
    scopes.push(vueScope)
    const clientScope = ref<{ kind: 'trainer' | 'group', slug: string }>({ kind: 'trainer', slug: 'ash' })
    const profileId = ref<string | null>('profile_abcdefgh')
    const getJson = vi.fn()
      .mockResolvedValueOnce(projection('trainer', 'Ash inventory'))
      .mockRejectedValueOnce(new Error('Network unavailable.'))
      .mockResolvedValueOnce(projection('group', 'Shared inventory', 200))
    const history = vueScope.run(() => useInventoryHistory({
      scope: clientScope,
      profileId,
      apiClient: { getJson },
      autoLoadOnMounted: false,
    }))!

    await history.load()
    await history.refresh()
    expect(history.status.value).toBe('error')
    expect(history.error.value).toContain('Network unavailable')
    expect(history.projection.value?.facts[0]?.headline).toBe('Potion transferred')

    clientScope.value = { kind: 'group', slug: 'main' }
    profileId.value = null
    await nextTick()
    expect(history.status.value).toBe('idle')
    expect(history.projection.value).toBeNull()
    await history.load()
    expect(history.projection.value?.scope.kind).toBe('group')
    expect(getJson).toHaveBeenLastCalledWith(INVENTORY_ACTION_API_PATHS.history, {
      params: { groupSlug: 'main', profileId: undefined, limit: 20 },
    })
  })

  it('rejects malformed server projections instead of rendering partial private data', async () => {
    const vueScope = effectScope()
    scopes.push(vueScope)
    const history = vueScope.run(() => useInventoryHistory({
      scope: ref({ kind: 'group' as const, slug: 'main' }),
      apiClient: { getJson: async () => ({ ...projection('group', 'Shared inventory'), operationId: 'private' }) },
      autoLoadOnMounted: false,
    }))!
    await history.load()
    expect(history.status.value).toBe('error')
    expect(history.projection.value).toBeNull()
  })
})
