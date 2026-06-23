/**
 * Reactive store of every Pokémon + trainer campaign sheet, kept in sync with
 * the server via SQLite-backed runtime APIs and SSE events. The store starts
 * empty/loading; it never seeds from build-time campaign JSON.
 */
import { reactive, ref, type Ref } from 'vue'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { sheetsChannel } from '#shared/realtime'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import {
  applyLiveSheetRealtimeEvent,
  buildLiveSheetMaps,
  replaceLiveSheetMaps,
  type LiveSheetListPayload,
} from '~/utils/liveSheets'
import { useApiClient } from './useApiClient'
import { subscribeChannel } from './useRealtime'

export interface ReloadRuntimeSheetsOptions {
  readonly profileId?: PlayerProfileId | null
  /** Explicit reconciliation must fail closed when the runtime sheet list cannot be refreshed. */
  readonly throwOnError?: boolean
}

interface LiveSheetsApi {
  pokemonBySlug: Ref<Map<string, CharacterSheet>>
  trainerBySlug: Ref<Map<string, TrainerSheet>>
  loading: Ref<boolean>
  loadError: Ref<string | null>
  reloadRuntimeSheets: (options?: ReloadRuntimeSheetsOptions) => Promise<void>
}

let cached: LiveSheetsApi | null = null
let unsubscribe: (() => void) | null = null
let runtimeLoadStarted = false
let runtimeLoadSequence = 0

const buildInitial = () => buildLiveSheetMaps([], [])

const hydrateRuntimeSheets = async (
  api: LiveSheetsApi,
  options: ReloadRuntimeSheetsOptions = {},
): Promise<void> => {
  const loadSequence = ++runtimeLoadSequence
  api.loading.value = true
  api.loadError.value = null
  try {
    const requestOptions = options.profileId ? { params: { profileId: options.profileId } } : undefined
    const payload = await useApiClient().getJson<LiveSheetListPayload>(SHEET_API_PATHS.list, requestOptions)
    if (loadSequence !== runtimeLoadSequence) {
      if (options.throwOnError) {
        throw new Error('Runtime sheet reload was superseded before fresh sheets could be applied')
      }
      return
    }
    replaceLiveSheetMaps({
      pokemonBySlug: api.pokemonBySlug.value,
      trainerBySlug: api.trainerBySlug.value,
    }, payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    api.loadError.value = message
    console.warn('[live-sheets] failed to load runtime sheet list', err)
    if (options.throwOnError) throw err
  } finally {
    if (loadSequence === runtimeLoadSequence) api.loading.value = false
  }
}

export const useLiveSheets = (): LiveSheetsApi => {
  if (cached) return cached

  const initial = buildInitial()
  const pokemonBySlug = ref<Map<string, CharacterSheet>>(reactive(initial.pokemonBySlug) as Map<string, CharacterSheet>)
  const trainerBySlug = ref<Map<string, TrainerSheet>>(reactive(initial.trainerBySlug) as Map<string, TrainerSheet>)
  const loading = ref(false)
  const loadError = ref<string | null>(null)

  const reloadRuntimeSheets = async (options: ReloadRuntimeSheetsOptions = {}): Promise<void> => {
    if (!cached) return
    await hydrateRuntimeSheets(cached, options)
  }

  cached = { pokemonBySlug, trainerBySlug, loading, loadError, reloadRuntimeSheets }

  if (typeof window !== 'undefined') {
    const liveMaps = {
      pokemonBySlug: pokemonBySlug.value,
      trainerBySlug: trainerBySlug.value,
    }
    const handler = (event: { type: string; data?: unknown }) => {
      applyLiveSheetRealtimeEvent(liveMaps, event)
    }
    unsubscribe = subscribeChannel(sheetsChannel, handler)

    if (!runtimeLoadStarted) {
      runtimeLoadStarted = true
      void hydrateRuntimeSheets(cached)
    }
  }

  return cached
}

export const teardownLiveSheets = (): void => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  cached = null
  runtimeLoadStarted = false
  runtimeLoadSequence = 0
}
