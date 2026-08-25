import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBattleContestLiveplay } from '../../src/composables/useBattleContestLiveplay'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('optional Battle Contest liveplay context', () => {
  it('treats an ordinary Encounter without Battle authority as an absent rail, not an alert', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({
      statusCode: 404,
      statusMessage: 'Encounter was not found.',
    }))
    const scope = effectScope()
    const liveplay = scope.run(() => useBattleContestLiveplay(ref(null), ref(null)))!

    await liveplay.load('ordinary-map-slug')

    expect(liveplay.loading.value).toBe(false)
    expect(liveplay.battleContest.value).toBeNull()
    expect(liveplay.error.value).toBeNull()
    scope.stop()
  })

  it('clears optional context without waiting for a map-backed compatibility lookup', async () => {
    let resolveFetch: ((value: { ok: true, battleContest: null }) => void) | null = null
    vi.stubGlobal('$fetch', vi.fn().mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve })))
    const scope = effectScope()
    const liveplay = scope.run(() => useBattleContestLiveplay(ref(null), ref(null)))!

    const pending = liveplay.load('compatibility-map')
    expect(liveplay.loading.value).toBe(true)
    liveplay.clear()
    expect(liveplay.loading.value).toBe(false)
    resolveFetch?.({ ok: true, battleContest: null })
    await pending

    expect(liveplay.battleContest.value).toBeNull()
    expect(liveplay.error.value).toBeNull()
    scope.stop()
  })

  it('retains fail-closed errors for malformed or stale Battle authority', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({
      statusCode: 409,
      statusMessage: 'Encounter and Battle Contest linkage is stale.',
    }))
    const scope = effectScope()
    const liveplay = scope.run(() => useBattleContestLiveplay(ref(null), ref(null)))!

    await liveplay.load('linked-encounter')

    expect(liveplay.battleContest.value).toBeNull()
    expect(liveplay.error.value).toBe('Encounter and Battle Contest linkage is stale.')
    scope.stop()
  })
})
