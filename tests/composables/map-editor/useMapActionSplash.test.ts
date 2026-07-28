import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMapActionSplash, type UseMapActionSplashOptions } from '~/composables/map-editor/useMapActionSplash'

const actorSprite = {
  url: '/actor.png',
  isSpriteSheet: false,
  frameWidth: 96,
  frameHeight: 96,
  scale: 1,
}

const buildSplash = (
  publishActionSplash = vi.fn(),
  timingOptions: Pick<UseMapActionSplashOptions, 'durationMs' | 'leadInMs'> = {
    durationMs: 200,
    leadInMs: 75,
  },
) => {
  const actors = ref([
    { id: 'actor-1', species: 'Pikachu', accentColor: '#f8d030' },
  ])
  const rows = ref([
    { id: 'actor-1', name: 'Pikachu', profileUrl: '/sheets/pikachu', sprite: actorSprite },
  ])

  return {
    publishActionSplash,
    ...useMapActionSplash({
      spawnedPokemon: computed(() => actors.value),
      initiativeRows: computed(() => rows.value),
      publishActionSplash,
      ...timingOptions,
    }),
  }
}

describe('useMapActionSplash', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders a local splash and broadcasts the visual payload without waiting on publish', async () => {
    vi.useFakeTimers()
    const publishActionSplash = vi.fn(() => new Promise((resolve) => { setTimeout(resolve, 5_000) }))
    const splash = buildSplash(publishActionSplash)

    let leadInResolved = false
    const leadIn = splash.showActionSplash({ userId: 'actor-1', actionName: ' Quick Attack ', verb: ' uses ' })
      .then(() => {
        leadInResolved = true
      })

    expect(splash.actionSplash.value).toMatchObject({
      userId: 'actor-1',
      actorName: 'Pikachu',
      actionLabel: 'uses Quick Attack',
      profileEntry: expect.objectContaining({ name: 'Pikachu' }),
      accentColor: '#f8d030',
    })
    expect(publishActionSplash).toHaveBeenCalledWith({
      actorPlacementId: 'actor-1',
      payload: { actionName: 'Quick Attack', verb: 'uses' },
    })

    await vi.advanceTimersByTimeAsync(75)
    expect(leadInResolved).toBe(true)
    await leadIn

    await vi.advanceTimersByTimeAsync(125)
    expect(splash.actionSplash.value).toBeNull()
  })

  it('uses the latest reactive duration as the default lead-in', async () => {
    vi.useFakeTimers()
    const durationMs = ref(120)
    const splash = buildSplash(vi.fn(), { durationMs })

    let firstLeadInResolved = false
    const firstLeadIn = splash.showActionSplash({ userId: 'actor-1', actionName: 'Thunderbolt' })
      .then(() => {
        firstLeadInResolved = true
      })

    await vi.advanceTimersByTimeAsync(119)
    expect(firstLeadInResolved).toBe(false)
    expect(splash.actionSplash.value).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(firstLeadInResolved).toBe(true)
    expect(splash.actionSplash.value).toBeNull()
    await firstLeadIn

    durationMs.value = 300
    let secondLeadInResolved = false
    const secondLeadIn = splash.showActionSplash({ userId: 'actor-1', actionName: 'Iron Tail' })
      .then(() => {
        secondLeadInResolved = true
      })

    await vi.advanceTimersByTimeAsync(299)
    expect(secondLeadInResolved).toBe(false)
    expect(splash.actionSplash.value).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect(secondLeadInResolved).toBe(true)
    expect(splash.actionSplash.value).toBeNull()
    await secondLeadIn
  })

  it('replays remote splashes locally without publishing another event', async () => {
    vi.useFakeTimers()
    const publishActionSplash = vi.fn()
    const splash = buildSplash(publishActionSplash)

    const leadIn = splash.replayActionSplash({ userId: 'actor-1', actionName: 'Spite' })

    expect(splash.actionSplash.value).toMatchObject({
      userId: 'actor-1',
      actionLabel: 'uses Spite',
    })
    expect(publishActionSplash).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(75)
    await leadIn
  })

  it('ignores invalid splash requests before publishing or rendering', async () => {
    vi.useFakeTimers()
    const publishActionSplash = vi.fn()
    const splash = buildSplash(publishActionSplash)

    await splash.showActionSplash({ userId: 'missing', actionName: 'Tackle' })
    await splash.showActionSplash({ userId: 'actor-1', actionName: '   ' })

    expect(splash.actionSplash.value).toBeNull()
    expect(publishActionSplash).not.toHaveBeenCalled()
  })
})
