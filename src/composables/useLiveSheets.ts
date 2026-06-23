/**
 * Reactive store of every Pokémon + trainer campaign sheet, kept in sync with
 * the server via SQLite-backed runtime APIs and SSE events. The store starts
 * empty/loading; it never seeds from build-time campaign JSON.
 */
import { reactive, ref, type Ref } from 'vue'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { sheetsChannel } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import {
  DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY,
  buildLiveSheetAccessScopeKey,
  buildLiveSheetMaps,
  createLiveSheetCacheController,
  type LiveSheetAccessScopeKey,
  type LiveSheetAuthoritativeLoadToken,
  type LiveSheetAuthoritativeSetResult,
  type LiveSheetCacheController,
  type LiveSheetListPayload,
  type SheetAdoptionResult,
} from '~/utils/liveSheetCache'
import { useApiClient } from './useApiClient'
import { subscribeChannel } from './useRealtime'

export interface ReloadRuntimeSheetsOptions {
  readonly profileId?: PlayerProfileId | null
  /** Caller-owned scope key. Distinguish GM, player-without-profile, and every selected player profile. */
  readonly accessScopeKey?: LiveSheetAccessScopeKey | null
  /** Optional role/profile convenience for callers that do not prebuild accessScopeKey. */
  readonly role?: AuthRole | null
  /** Explicit reconciliation must fail closed when the runtime sheet list cannot be refreshed. */
  readonly throwOnError?: boolean
}

export interface LiveSheetUpdateAdoptionInput {
  readonly kind: SheetKind
  readonly slug?: string
  readonly sheet: unknown
  readonly preserveClientAccessAnnotations?: boolean
}

interface LiveSheetsApi {
  pokemonBySlug: Ref<Map<string, CharacterSheet>>
  trainerBySlug: Ref<Map<string, TrainerSheet>>
  loading: Ref<boolean>
  loadError: Ref<string | null>
  hydrated: Ref<boolean>
  accessScopeKey: Ref<LiveSheetAccessScopeKey | null>
  reconciliationRequired: Ref<boolean>
  reloadRuntimeSheets: (options?: ReloadRuntimeSheetsOptions) => Promise<void>
  adoptSheetUpdate: (input: LiveSheetUpdateAdoptionInput) => SheetAdoptionResult
  beginAuthoritativeLoad: (accessScopeKey: LiveSheetAccessScopeKey) => LiveSheetAuthoritativeLoadToken
  adoptAuthoritativeSet: (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ) => LiveSheetAuthoritativeSetResult
  reportReconciliationRequired: (reason?: string, options?: { readonly reload?: boolean }) => void
}

let cached: LiveSheetsApi | null = null
let controller: LiveSheetCacheController | null = null
let unsubscribe: (() => void) | null = null
let runtimeLoadStarted = false
let reconciliationReloadQueued = false
let reconciliationReloadRunning = false

const buildInitial = () => buildLiveSheetMaps([], [])

const optionAccessScopeKey = (options: ReloadRuntimeSheetsOptions = {}): LiveSheetAccessScopeKey => {
  if (options.accessScopeKey) return options.accessScopeKey
  if (options.role || options.profileId !== undefined) {
    return buildLiveSheetAccessScopeKey({
      role: options.role ?? (options.profileId !== undefined ? 'player' : null),
      profileId: options.profileId ?? null,
    })
  }
  return DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY
}

const syncControllerState = (api: LiveSheetsApi): void => {
  if (!controller) return
  api.accessScopeKey.value = controller.accessScopeKey
  api.hydrated.value = controller.hydrated
  api.reconciliationRequired.value = controller.reconciliationRequired
}

const setReconciliationError = (api: LiveSheetsApi, message: string): void => {
  api.loadError.value = message
  controller?.requireReconciliation(message)
  syncControllerState(api)
}

const runScheduledReconciliationReloads = async (): Promise<void> => {
  if (reconciliationReloadRunning || !cached) return
  reconciliationReloadRunning = true
  try {
    while (reconciliationReloadQueued && cached) {
      reconciliationReloadQueued = false
      const scopeKey = cached.accessScopeKey.value ?? DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY
      try {
        await cached.reloadRuntimeSheets({ accessScopeKey: scopeKey, throwOnError: true })
      } catch {
        // hydrateRuntimeSheets already records loadError and logs the failure.
      }
    }
  } finally {
    reconciliationReloadRunning = false
    if (reconciliationReloadQueued) void runScheduledReconciliationReloads()
  }
}

const scheduleReconciliationReload = (): void => {
  if (reconciliationReloadQueued) return
  reconciliationReloadQueued = true
  void Promise.resolve().then(() => runScheduledReconciliationReloads())
}

const hydrateRuntimeSheets = async (
  api: LiveSheetsApi,
  options: ReloadRuntimeSheetsOptions = {},
): Promise<void> => {
  if (!controller) return
  const accessScopeKey = optionAccessScopeKey(options)
  const token = api.beginAuthoritativeLoad(accessScopeKey)
  api.loading.value = true
  api.loadError.value = null
  try {
    const requestOptions = options.profileId ? { params: { profileId: options.profileId } } : undefined
    const payload = await useApiClient().getJson<LiveSheetListPayload>(SHEET_API_PATHS.list, requestOptions)
    const result = api.adoptAuthoritativeSet(payload, token)
    if (result.status === 'ignored-superseded' || result.status === 'ignored-scope') {
      if (options.throwOnError) throw new Error(result.message)
      return
    }
    if (result.status === 'conflict' || result.status === 'invalid') {
      setReconciliationError(api, result.message)
      throw new Error(result.message)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    api.loadError.value = message
    console.warn('[live-sheets] failed to load runtime sheet list', err)
    if (options.throwOnError) throw err
  } finally {
    if (controller.isCurrentAuthoritativeLoad(token)) api.loading.value = false
    syncControllerState(api)
  }
}

export const useLiveSheets = (): LiveSheetsApi => {
  if (cached) return cached

  const initial = buildInitial()
  const pokemonBySlug = ref<Map<string, CharacterSheet>>(reactive(initial.pokemonBySlug) as Map<string, CharacterSheet>)
  const trainerBySlug = ref<Map<string, TrainerSheet>>(reactive(initial.trainerBySlug) as Map<string, TrainerSheet>)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const hydrated = ref(false)
  const accessScopeKey = ref<LiveSheetAccessScopeKey | null>(null)
  const reconciliationRequired = ref(false)

  controller = createLiveSheetCacheController({
    pokemonBySlug: pokemonBySlug.value,
    trainerBySlug: trainerBySlug.value,
  })

  const beginAuthoritativeLoad = (scopeKey: LiveSheetAccessScopeKey): LiveSheetAuthoritativeLoadToken => {
    if (!controller) throw new Error('Live sheet cache controller is not initialised.')
    const token = controller.beginAuthoritativeLoad(scopeKey)
    syncControllerState(cached ?? api)
    return token
  }

  const adoptAuthoritativeSet = (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ): LiveSheetAuthoritativeSetResult => {
    if (!controller) return { status: 'invalid', message: 'Live sheet cache controller is not initialised.' }
    const result = controller.adoptAuthoritativeSet(payload, token)
    if (result.status === 'applied') loadError.value = null
    else if (result.status === 'conflict' || result.status === 'invalid') loadError.value = result.message
    syncControllerState(cached ?? api)
    return result
  }

  const adoptSheetUpdate = (input: LiveSheetUpdateAdoptionInput): SheetAdoptionResult => {
    if (!controller) return { status: 'invalid', message: 'Live sheet cache controller is not initialised.' }
    const result = controller.adoptCompleteSheet(input.kind, input.sheet, {
      expectedSlug: input.slug,
      preserveClientAccessAnnotations: input.preserveClientAccessAnnotations !== false,
    })
    if (result.status === 'conflict' || result.status === 'invalid') {
      setReconciliationError(cached ?? api, result.message)
    } else {
      syncControllerState(cached ?? api)
    }
    return result
  }

  const reportReconciliationRequired = (
    reason = 'Live sheet cache requires authoritative reconciliation.',
    options: { readonly reload?: boolean } = {},
  ): void => {
    if (!controller) return
    controller.requireReconciliation(reason)
    syncControllerState(cached ?? api)
    if (options.reload !== false) scheduleReconciliationReload()
  }

  const reloadRuntimeSheets = async (options: ReloadRuntimeSheetsOptions = {}): Promise<void> => {
    if (!cached) return
    await hydrateRuntimeSheets(cached, options)
  }

  const api: LiveSheetsApi = {
    pokemonBySlug,
    trainerBySlug,
    loading,
    loadError,
    hydrated,
    accessScopeKey,
    reconciliationRequired,
    reloadRuntimeSheets,
    adoptSheetUpdate,
    beginAuthoritativeLoad,
    adoptAuthoritativeSet,
    reportReconciliationRequired,
  }

  cached = api

  if (typeof window !== 'undefined') {
    const handler = (event: { type: string; data?: unknown }) => {
      if (!controller || !cached) return
      const result = controller.applyRealtimeEvent(event)
      if (result.status === 'conflict' || result.status === 'invalid' || result.status === 'invalidated') {
        cached.loadError.value = result.message
        scheduleReconciliationReload()
      }
      syncControllerState(cached)
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
  controller = null
  runtimeLoadStarted = false
  reconciliationReloadQueued = false
  reconciliationReloadRunning = false
}
