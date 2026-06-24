/**
 * Reactive store of every Pokémon + trainer campaign sheet, kept in sync with
 * the server via SQLite-backed runtime APIs and SSE events. The store starts
 * empty/loading; it never seeds from build-time campaign JSON.
 */
import { getCurrentScope, onScopeDispose, reactive, ref, type Ref } from 'vue'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { sheetsChannel } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import {
  DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY,
  GM_LIVE_SHEET_ACCESS_SCOPE_KEY,
  GUEST_LIVE_SHEET_ACCESS_SCOPE_KEY,
  PLAYER_NO_PROFILE_LIVE_SHEET_ACCESS_SCOPE_KEY,
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

export interface LiveSheetAccessRequestContext {
  readonly accessScopeKey: LiveSheetAccessScopeKey
  readonly role?: AuthRole | null
  readonly profileId?: PlayerProfileId | null
}

export interface ReloadRuntimeSheetsOptions {
  readonly profileId?: PlayerProfileId | null
  /** Caller-owned scope key. Distinguish GM, player-without-profile, and every selected player profile. */
  readonly accessScopeKey?: LiveSheetAccessScopeKey | null
  /** Optional role/profile convenience for callers that do not prebuild accessScopeKey. */
  readonly role?: AuthRole | null
  /** Explicit reconciliation must fail closed when the runtime sheet list cannot be refreshed. */
  readonly throwOnError?: boolean
}

export interface UseLiveSheetsOptions {
  /**
   * Whether this caller permits the singleton to hydrate itself from
   * /api/sheets/list. Map pages set this to false because they hydrate sheets
   * from /api/maps/live-state instead.
   */
  readonly autoHydrate?: boolean
  /** Stable owner key for an external authoritative hydration owner. */
  readonly hydrationOwner?: string
}

export type LiveSheetsAuthoritativeReconciler = (reason: string) => Promise<void> | void

export interface LiveSheetUpdateAdoptionInput {
  readonly kind: SheetKind
  readonly slug?: string
  readonly sheet: unknown
  readonly preserveClientAccessAnnotations?: boolean
}

export interface LiveSheetsApi {
  pokemonBySlug: Ref<Map<string, CharacterSheet>>
  trainerBySlug: Ref<Map<string, TrainerSheet>>
  loading: Ref<boolean>
  loadError: Ref<string | null>
  hydrated: Ref<boolean>
  accessScopeKey: Ref<LiveSheetAccessScopeKey | null>
  accessRequestContext: Ref<LiveSheetAccessRequestContext | null>
  reconciliationRequired: Ref<boolean>
  reloadRuntimeSheets: (options?: ReloadRuntimeSheetsOptions) => Promise<void>
  adoptSheetUpdate: (input: LiveSheetUpdateAdoptionInput) => SheetAdoptionResult
  beginAuthoritativeLoad: (
    context: LiveSheetAccessScopeKey | LiveSheetAccessRequestContext,
  ) => LiveSheetAuthoritativeLoadToken
  isCurrentAuthoritativeLoad: (token: LiveSheetAuthoritativeLoadToken) => boolean
  adoptAuthoritativeSet: (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ) => LiveSheetAuthoritativeSetResult
  reportReconciliationRequired: (reason?: string, options?: { readonly reload?: boolean }) => void
  registerAuthoritativeReconciler: (handler: LiveSheetsAuthoritativeReconciler) => () => void
}

let cached: LiveSheetsApi | null = null
let controller: LiveSheetCacheController | null = null
let unsubscribe: (() => void) | null = null
let runtimeLoadStarted = false
let reconciliationReloadQueued = false
let reconciliationReloadRunning = false
let currentAccessRequestContext: LiveSheetAccessRequestContext | null = null
let externalHydrationOwner: string | null = null
let authoritativeReconciliationQueued = false
let authoritativeReconciliationRunning = false
let authoritativeReconciliationReason: string | null = null
const authoritativeReconcilers = new Set<LiveSheetsAuthoritativeReconciler>()

const buildInitial = () => buildLiveSheetMaps([], [])

const isProfileScopedKey = (accessScopeKey: LiveSheetAccessScopeKey): boolean => (
  accessScopeKey.startsWith('player:') && accessScopeKey !== PLAYER_NO_PROFILE_LIVE_SHEET_ACCESS_SCOPE_KEY
)

const inferContextFromAccessScopeKey = (
  accessScopeKey: LiveSheetAccessScopeKey,
): LiveSheetAccessRequestContext => {
  if (accessScopeKey === GM_LIVE_SHEET_ACCESS_SCOPE_KEY) {
    return { accessScopeKey, role: 'gm', profileId: null }
  }
  if (accessScopeKey === PLAYER_NO_PROFILE_LIVE_SHEET_ACCESS_SCOPE_KEY) {
    return { accessScopeKey, role: 'player', profileId: null }
  }
  if (isProfileScopedKey(accessScopeKey)) {
    return {
      accessScopeKey,
      role: 'player',
      profileId: accessScopeKey.slice('player:'.length) as PlayerProfileId,
    }
  }
  if (accessScopeKey === GUEST_LIVE_SHEET_ACCESS_SCOPE_KEY) {
    return { accessScopeKey, role: null, profileId: null }
  }
  return { accessScopeKey, role: null, profileId: null }
}

const expectedScopeKeyForContext = (
  context: Pick<LiveSheetAccessRequestContext, 'accessScopeKey' | 'role' | 'profileId'>,
): LiveSheetAccessScopeKey => {
  const role = context.role ?? null
  const profileId = context.profileId ?? null
  if (context.accessScopeKey === DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY && role === null && profileId === null) {
    return DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY
  }
  return buildLiveSheetAccessScopeKey({ role, profileId })
}

const validateAccessRequestContext = (
  context: LiveSheetAccessRequestContext,
): LiveSheetAccessRequestContext => {
  const role = context.role ?? null
  const profileId = context.profileId ?? null
  if (profileId && role !== 'player') {
    throw new Error('A live sheet player profile can only be requested with the player role.')
  }
  if (isProfileScopedKey(context.accessScopeKey) && !profileId) {
    throw new Error(`Profile-scoped live sheet cache ${context.accessScopeKey} requires its exact profileId.`)
  }
  const expectedScopeKey = expectedScopeKeyForContext(context)
  if (context.accessScopeKey !== expectedScopeKey) {
    throw new Error(
      `Live sheet access scope ${context.accessScopeKey} is inconsistent with role/profile context ${expectedScopeKey}.`,
    )
  }
  return {
    accessScopeKey: context.accessScopeKey || DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY,
    role,
    profileId,
  }
}

const accessRequestContextFromOptions = (
  options: ReloadRuntimeSheetsOptions = {},
): LiveSheetAccessRequestContext => {
  const hasExplicitScopeKey = !!options.accessScopeKey
  const hasExplicitRole = options.role !== undefined
  const hasExplicitProfile = options.profileId !== undefined
  const inferred = hasExplicitScopeKey
    ? inferContextFromAccessScopeKey(options.accessScopeKey as LiveSheetAccessScopeKey)
    : null

  let role: AuthRole | null = hasExplicitRole ? options.role ?? null : inferred?.role ?? null
  let profileId: PlayerProfileId | null = hasExplicitProfile
    ? options.profileId ?? null
    : inferred?.profileId ?? null

  if (!hasExplicitRole && hasExplicitProfile && profileId) role = 'player'

  const accessScopeKey = hasExplicitScopeKey
    ? options.accessScopeKey as LiveSheetAccessScopeKey
    : (role === null && profileId === null
        ? DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY
        : buildLiveSheetAccessScopeKey({ role, profileId }))

  return validateAccessRequestContext({ accessScopeKey, role, profileId })
}

const accessRequestContextFromInput = (
  input: LiveSheetAccessScopeKey | LiveSheetAccessRequestContext,
): LiveSheetAccessRequestContext => {
  if (typeof input === 'string') return accessRequestContextFromOptions({ accessScopeKey: input })
  return validateAccessRequestContext(input)
}

const sameAccessRequestContext = (
  left: LiveSheetAccessRequestContext | null,
  right: LiveSheetAccessRequestContext | null,
): boolean => (
  !!left
  && !!right
  && left.accessScopeKey === right.accessScopeKey
  && (left.role ?? null) === (right.role ?? null)
  && (left.profileId ?? null) === (right.profileId ?? null)
)

const requestOptionsForContext = (
  context: LiveSheetAccessRequestContext,
): { params: { profileId: PlayerProfileId } } | undefined => {
  if (isProfileScopedKey(context.accessScopeKey) && !context.profileId) {
    throw new Error(`Refusing to issue an unprofiled sheet request for ${context.accessScopeKey}.`)
  }
  return context.role === 'player' && context.profileId
    ? { params: { profileId: context.profileId } }
    : undefined
}

const syncControllerState = (api: LiveSheetsApi): void => {
  if (!controller) return
  api.accessScopeKey.value = controller.accessScopeKey
  api.accessRequestContext.value = currentAccessRequestContext
  api.hydrated.value = controller.hydrated
  api.reconciliationRequired.value = controller.reconciliationRequired
}

const setReconciliationError = (api: LiveSheetsApi, message: string): void => {
  api.loadError.value = message
  controller?.requireReconciliation(message)
  syncControllerState(api)
}

const fallbackReconciliationContext = (api: LiveSheetsApi): LiveSheetAccessRequestContext => {
  if (currentAccessRequestContext) return currentAccessRequestContext
  return accessRequestContextFromOptions({
    accessScopeKey: api.accessScopeKey.value ?? DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY,
  })
}

const runScheduledReconciliationReloads = async (): Promise<void> => {
  if (reconciliationReloadRunning || !cached) return
  reconciliationReloadRunning = true
  try {
    while (reconciliationReloadQueued && cached) {
      reconciliationReloadQueued = false
      const context = fallbackReconciliationContext(cached)
      try {
        await cached.reloadRuntimeSheets({
          accessScopeKey: context.accessScopeKey,
          role: context.role ?? null,
          profileId: context.profileId ?? null,
          throwOnError: true,
        })
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

const runScheduledAuthoritativeReconciliation = async (): Promise<void> => {
  if (authoritativeReconciliationRunning || !cached) return
  authoritativeReconciliationRunning = true
  try {
    while (authoritativeReconciliationQueued && cached) {
      authoritativeReconciliationQueued = false
      const reason = authoritativeReconciliationReason
        ?? 'Live sheet cache requires authoritative reconciliation.'
      authoritativeReconciliationReason = null
      const handlers = Array.from(authoritativeReconcilers)
      if (!handlers.length) {
        scheduleReconciliationReload()
        continue
      }
      try {
        await Promise.all(handlers.map((handler) => Promise.resolve(handler(reason))))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setReconciliationError(cached, message)
      }
    }
  } finally {
    authoritativeReconciliationRunning = false
    if (authoritativeReconciliationQueued) void runScheduledAuthoritativeReconciliation()
  }
}

const scheduleAuthoritativeReconciliation = (reason: string): boolean => {
  if (!authoritativeReconcilers.size) return false
  authoritativeReconciliationReason = reason
  if (authoritativeReconciliationQueued) return true
  authoritativeReconciliationQueued = true
  void Promise.resolve().then(() => runScheduledAuthoritativeReconciliation())
  return true
}

const configureHydrationOwnership = (options: UseLiveSheetsOptions): void => {
  if (options.autoHydrate !== false) return
  const ownerKey = options.hydrationOwner ?? 'external-live-sheet-hydration'
  externalHydrationOwner = ownerKey
  if (!getCurrentScope()) return
  onScopeDispose(() => {
    if (externalHydrationOwner === ownerKey) externalHydrationOwner = null
  })
}

const ensureRuntimeHydration = (api: LiveSheetsApi, options: UseLiveSheetsOptions): void => {
  if (options.autoHydrate === false) return
  if (externalHydrationOwner) return
  if (typeof window === 'undefined') return
  if (runtimeLoadStarted) return
  runtimeLoadStarted = true
  void hydrateRuntimeSheets(api)
}

const hydrateRuntimeSheets = async (
  api: LiveSheetsApi,
  options: ReloadRuntimeSheetsOptions = {},
): Promise<void> => {
  if (!controller) return
  let requestContext: LiveSheetAccessRequestContext
  try {
    requestContext = accessRequestContextFromOptions(options)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setReconciliationError(api, message)
    if (options.throwOnError) throw err
    return
  }

  const token = api.beginAuthoritativeLoad(requestContext)
  api.loading.value = true
  api.loadError.value = null
  try {
    const payload = await useApiClient().getJson<LiveSheetListPayload>(
      SHEET_API_PATHS.list,
      requestOptionsForContext(requestContext),
    )
    if (!sameAccessRequestContext(currentAccessRequestContext, requestContext)) {
      throw new Error(
        `Runtime sheet reload for ${requestContext.accessScopeKey} was superseded before fresh sheets could be applied.`,
      )
    }
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

export const useLiveSheets = (options: UseLiveSheetsOptions = {}): LiveSheetsApi => {
  configureHydrationOwnership(options)
  if (cached) {
    ensureRuntimeHydration(cached, options)
    return cached
  }

  const initial = buildInitial()
  const pokemonBySlug = ref<Map<string, CharacterSheet>>(reactive(initial.pokemonBySlug) as Map<string, CharacterSheet>)
  const trainerBySlug = ref<Map<string, TrainerSheet>>(reactive(initial.trainerBySlug) as Map<string, TrainerSheet>)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const hydrated = ref(false)
  const accessScopeKey = ref<LiveSheetAccessScopeKey | null>(null)
  const accessRequestContext = ref<LiveSheetAccessRequestContext | null>(null)
  const reconciliationRequired = ref(false)

  controller = createLiveSheetCacheController({
    pokemonBySlug: pokemonBySlug.value,
    trainerBySlug: trainerBySlug.value,
  })

  const beginAuthoritativeLoad = (
    input: LiveSheetAccessScopeKey | LiveSheetAccessRequestContext,
  ): LiveSheetAuthoritativeLoadToken => {
    if (!controller) throw new Error('Live sheet cache controller is not initialised.')
    const requestContext = accessRequestContextFromInput(input)
    const token = controller.beginAuthoritativeLoad(requestContext.accessScopeKey)
    currentAccessRequestContext = requestContext
    syncControllerState(cached ?? api)
    return token
  }

  const isCurrentAuthoritativeLoad = (token: LiveSheetAuthoritativeLoadToken): boolean => (
    controller?.isCurrentAuthoritativeLoad(token) ?? false
  )

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
    if (options.reload === false) return
    if (scheduleAuthoritativeReconciliation(reason)) return
    scheduleReconciliationReload()
  }

  const reloadRuntimeSheets = async (options: ReloadRuntimeSheetsOptions = {}): Promise<void> => {
    if (!cached) return
    await hydrateRuntimeSheets(cached, options)
  }

  const registerAuthoritativeReconciler = (handler: LiveSheetsAuthoritativeReconciler): (() => void) => {
    authoritativeReconcilers.add(handler)
    const unregister = () => {
      authoritativeReconcilers.delete(handler)
    }
    if (getCurrentScope()) onScopeDispose(unregister)
    return unregister
  }

  const api: LiveSheetsApi = {
    pokemonBySlug,
    trainerBySlug,
    loading,
    loadError,
    hydrated,
    accessScopeKey,
    accessRequestContext,
    reconciliationRequired,
    reloadRuntimeSheets,
    adoptSheetUpdate,
    beginAuthoritativeLoad,
    isCurrentAuthoritativeLoad,
    adoptAuthoritativeSet,
    reportReconciliationRequired,
    registerAuthoritativeReconciler,
  }

  cached = api

  if (typeof window !== 'undefined') {
    const handler = (event: { type: string; data?: unknown }) => {
      if (!controller || !cached) return
      const result = controller.applyRealtimeEvent(event)
      if (result.status === 'conflict' || result.status === 'invalid' || result.status === 'invalidated') {
        cached.loadError.value = result.message
        if (!scheduleAuthoritativeReconciliation(result.message)) scheduleReconciliationReload()
      }
      syncControllerState(cached)
    }
    unsubscribe = subscribeChannel(sheetsChannel, handler)
  }

  ensureRuntimeHydration(api, options)

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
  currentAccessRequestContext = null
  externalHydrationOwner = null
  authoritativeReconciliationQueued = false
  authoritativeReconciliationRunning = false
  authoritativeReconciliationReason = null
  authoritativeReconcilers.clear()
}
