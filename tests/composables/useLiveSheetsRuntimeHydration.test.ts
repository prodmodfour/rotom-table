import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveSheets, teardownLiveSheets } from '~/composables/useLiveSheets'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
}))

const realtimeMocks = vi.hoisted(() => {
  const handlers: Array<(event: { type: string; data?: unknown }) => void> = []
  return {
    handlers,
    subscribeChannel: vi.fn((_channel: string, handler: (event: { type: string; data?: unknown }) => void) => {
      handlers.push(handler)
      return vi.fn()
    }),
  }
})

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: realtimeMocks.subscribeChannel,
}))

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('useLiveSheets runtime hydration', () => {
  beforeEach(() => {
    apiMocks.getJson.mockReset()
    realtimeMocks.handlers.length = 0
    realtimeMocks.subscribeChannel.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    delete (globalThis as { window?: unknown }).window
    teardownLiveSheets()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { window?: unknown }).window
    teardownLiveSheets()
  })

  it('hydrates runtime campaign sheets in production as well as development', () => {
    const source = readText('src/composables/useLiveSheets.ts')

    expect(source).toContain('if (!runtimeLoadStarted)')
    expect(source).not.toContain('import.meta.dev && !runtimeLoadStarted')
  })

  it('keeps background runtime sheet reloads best-effort by default', async () => {
    apiMocks.getJson.mockRejectedValueOnce(new Error('Runtime sheet list unavailable'))
    const liveSheets = useLiveSheets()

    await expect(liveSheets.reloadRuntimeSheets()).resolves.toBeUndefined()

    expect(apiMocks.getJson).toHaveBeenCalledWith(SHEET_API_PATHS.list, undefined)
    expect(console.warn).toHaveBeenCalledWith(
      '[live-sheets] failed to load runtime sheet list',
      expect.any(Error),
    )
  })

  it('reports runtime sheet reload failures when reconciliation requires fresh sheets', async () => {
    apiMocks.getJson.mockRejectedValueOnce(new Error('Runtime sheet list unavailable'))
    const liveSheets = useLiveSheets()

    await expect(liveSheets.reloadRuntimeSheets({ throwOnError: true })).rejects.toThrow('Runtime sheet list unavailable')

    expect(apiMocks.getJson).toHaveBeenCalledWith(SHEET_API_PATHS.list, undefined)
    expect(console.warn).toHaveBeenCalledWith(
      '[live-sheets] failed to load runtime sheet list',
      expect.any(Error),
    )
  })

  it('reports explicit reconciliation reloads that are superseded before applying fresh sheets', async () => {
    let resolveFirst!: (payload: unknown) => void
    apiMocks.getJson
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({
        pokemonSheets: [{ slug: 'newer-pikachu', nickname: 'Newer Pikachu', revision: 1 }],
        trainerSheets: [],
      })
    const liveSheets = useLiveSheets()

    const firstReload = liveSheets.reloadRuntimeSheets({ throwOnError: true })
    await liveSheets.reloadRuntimeSheets()
    resolveFirst({
      pokemonSheets: [{ slug: 'stale-pikachu', nickname: 'Stale Pikachu', revision: 0 }],
      trainerSheets: [],
    })

    await expect(firstReload).rejects.toThrow('Runtime sheet reload was superseded before fresh sheets could be applied')
    expect(liveSheets.pokemonBySlug.value.get('newer-pikachu')).toMatchObject({ nickname: 'Newer Pikachu' })
    expect(liveSheets.pokemonBySlug.value.has('stale-pikachu')).toBe(false)
  })

  it('reloads runtime sheets successfully for explicit reconciliation', async () => {
    apiMocks.getJson.mockResolvedValueOnce({
      pokemonSheets: [{ slug: 'runtime-pikachu', nickname: 'Runtime Pikachu', revision: 0 }],
      trainerSheets: [{ slug: 'runtime-trainer', name: 'Runtime Trainer', revision: 0 }],
    })
    const liveSheets = useLiveSheets()

    await expect(liveSheets.reloadRuntimeSheets({ throwOnError: true })).resolves.toBeUndefined()

    expect(liveSheets.pokemonBySlug.value.get('runtime-pikachu')).toMatchObject({ nickname: 'Runtime Pikachu' })
    expect(liveSheets.trainerBySlug.value.get('runtime-trainer')).toMatchObject({ name: 'Runtime Trainer' })
    expect(liveSheets.hydrated.value).toBe(true)
    expect(liveSheets.loadError.value).toBeNull()
  })

  it('coalesces incomplete realtime invalidations into one authoritative reload', async () => {
    ;(globalThis as { window?: unknown }).window = {}
    apiMocks.getJson.mockResolvedValueOnce({ pokemonSheets: [], trainerSheets: [] })
    const liveSheets = useLiveSheets()
    await Promise.resolve()
    await Promise.resolve()
    expect(realtimeMocks.subscribeChannel).toHaveBeenCalledTimes(1)

    let resolveReload!: (payload: unknown) => void
    apiMocks.getJson.mockClear()
    apiMocks.getJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveReload = resolve
    }))

    realtimeMocks.handlers[0]?.({ type: 'moved', data: { kind: 'pokemon', slug: 'bolt', folder: 'one' } })
    realtimeMocks.handlers[0]?.({ type: 'moved', data: { kind: 'pokemon', slug: 'bolt', folder: 'two' } })
    await Promise.resolve()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(liveSheets.reconciliationRequired.value).toBe(true)

    resolveReload({
      pokemonSheets: [{ slug: 'bolt', nickname: 'Bolt', species: 'Pikachu', level: 5, folder: 'two', revision: 1 }],
      trainerSheets: [],
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(liveSheets.pokemonBySlug.value.get('bolt')).toMatchObject({ folder: 'two', revision: 1 })
    expect(liveSheets.reconciliationRequired.value).toBe(false)
  })
})
