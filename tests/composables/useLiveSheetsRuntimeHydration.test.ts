import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveSheets, teardownLiveSheets } from '~/composables/useLiveSheets'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
  }),
}))

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('useLiveSheets runtime hydration', () => {
  beforeEach(() => {
    apiMocks.getJson.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    teardownLiveSheets()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        pokemonSheets: [{ slug: 'newer-pikachu', nickname: 'Newer Pikachu' }],
        trainerSheets: [],
      })
    const liveSheets = useLiveSheets()

    const firstReload = liveSheets.reloadRuntimeSheets({ throwOnError: true })
    await liveSheets.reloadRuntimeSheets()
    resolveFirst({
      pokemonSheets: [{ slug: 'stale-pikachu', nickname: 'Stale Pikachu' }],
      trainerSheets: [],
    })

    await expect(firstReload).rejects.toThrow('Runtime sheet reload was superseded before fresh sheets could be applied')
    expect(liveSheets.pokemonBySlug.value.get('newer-pikachu')).toMatchObject({ nickname: 'Newer Pikachu' })
    expect(liveSheets.pokemonBySlug.value.has('stale-pikachu')).toBe(false)
  })

  it('reloads runtime sheets successfully for explicit reconciliation', async () => {
    apiMocks.getJson.mockResolvedValueOnce({
      pokemonSheets: [{ slug: 'runtime-pikachu', nickname: 'Runtime Pikachu' }],
      trainerSheets: [{ slug: 'runtime-trainer', name: 'Runtime Trainer' }],
    })
    const liveSheets = useLiveSheets()

    await expect(liveSheets.reloadRuntimeSheets({ throwOnError: true })).resolves.toBeUndefined()

    expect(liveSheets.pokemonBySlug.value.get('runtime-pikachu')).toMatchObject({ nickname: 'Runtime Pikachu' })
    expect(liveSheets.trainerBySlug.value.get('runtime-trainer')).toMatchObject({ name: 'Runtime Trainer' })
  })
})
