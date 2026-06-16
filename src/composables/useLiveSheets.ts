/**
 * Reactive store of every Pokémon + trainer character sheet, kept in
 * sync with the server via SSE.
 *
 * Bootstrapped from the static `import.meta.glob` data so the first
 * paint has full info, then hydrated from the runtime sheet list so
 * external campaign sheets or files missed by the glob are present. Thereafter, save /
 * rename / move / delete events mutate the store so any component reading
 * from it (map editor, sheet links, etc.) stays current with cross-tab edits.
 *
 * Returned refs are reactive — placements can simply read
 * `pokemonBySlug.value.get(slug)` inside a `computed` and Vue will
 * track the dependency.
 */
import { reactive, ref, type Ref } from 'vue'
import { characterSheets } from '~~/data/characterSheets'
import { trainerSheets } from '~~/data/trainerSheets'
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
  /**
   * Background hydration is best-effort, but explicit reconciliation must fail
   * closed when the runtime sheet list cannot be refreshed.
   */
  readonly throwOnError?: boolean
}

interface LiveSheetsApi {
  pokemonBySlug: Ref<Map<string, CharacterSheet>>
  trainerBySlug: Ref<Map<string, TrainerSheet>>
  reloadRuntimeSheets: (options?: ReloadRuntimeSheetsOptions) => Promise<void>
}

let cached: LiveSheetsApi | null = null
let unsubscribe: (() => void) | null = null
let runtimeLoadStarted = false
let runtimeLoadSequence = 0

const buildInitial = () => buildLiveSheetMaps(characterSheets, trainerSheets)

const hydrateRuntimeSheets = async (
  api: LiveSheetsApi,
  options: ReloadRuntimeSheetsOptions = {},
): Promise<void> => {
  const loadSequence = ++runtimeLoadSequence
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
    console.warn('[live-sheets] failed to load runtime sheet list', err)
    if (options.throwOnError) throw err
  }
}

export const useLiveSheets = (): LiveSheetsApi => {
  if (cached) return cached

  const initial = buildInitial()
  // Use reactive() so per-key mutations propagate to consumers without
  // having to clone the whole Map on every event.
  const pokemonBySlug = ref<Map<string, CharacterSheet>>(reactive(initial.pokemonBySlug) as Map<string, CharacterSheet>)
  const trainerBySlug = ref<Map<string, TrainerSheet>>(reactive(initial.trainerBySlug) as Map<string, TrainerSheet>)

  const reloadRuntimeSheets = async (options: ReloadRuntimeSheetsOptions = {}): Promise<void> => {
    if (!cached) return
    await hydrateRuntimeSheets(cached, options)
  }

  cached = { pokemonBySlug, trainerBySlug, reloadRuntimeSheets }

  if (typeof window !== 'undefined') {
    const liveMaps = {
      pokemonBySlug: pokemonBySlug.value,
      trainerBySlug: trainerBySlug.value,
    }
    const handler = (event: { type: string; data?: unknown }) => {
      applyLiveSheetRealtimeEvent(liveMaps, event)
    }
    unsubscribe = subscribeChannel(sheetsChannel, handler)

    // The static import glob is baked when Vite builds the client module, and
    // production private hosts can keep campaign sheets outside the app checkout
    // via ROTOM_CAMPAIGN_ROOT. Hydrate from the runtime list endpoint whenever
    // the client store first starts so Link Pokémon and map spawners see the
    // active campaign sheets in both dev and production.
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
