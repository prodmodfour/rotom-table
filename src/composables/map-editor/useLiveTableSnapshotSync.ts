import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AuthRole } from '#shared/auth'
import {
  parseAbilityClientCapabilityBundle,
  type AbilityClientCapabilityBundle,
} from '#shared/abilityAutomation/clientCapabilities'
import {
  LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
  type LiveTableSnapshot,
} from '#shared/liveTableSnapshot'
import { isMapInteractionMode, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { isMapRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  buildLiveSheetAccessScopeKey,
  isSafeSheetRevision,
  type LiveSheetAccessScopeKey,
  type LiveSheetAuthoritativeLoadToken,
  type LiveSheetAuthoritativeSetResult,
  type LiveSheetListPayload,
} from '~/utils/liveSheetCache'
import { useApiClient } from '~/composables/useApiClient'
import type { LiveSheetAccessRequestContext } from '~/composables/useLiveSheets'

export type LiveTableSnapshotSyncStatus = 'idle' | 'loading' | 'ready' | 'reconciling' | 'error'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface ApplyAuthoritativeMapInteractionModeInput {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export interface LiveTableSnapshotSheetCacheController {
  readonly beginAuthoritativeLoad: (context: LiveSheetAccessRequestContext) => LiveSheetAuthoritativeLoadToken
  readonly isCurrentAuthoritativeLoad: (token: LiveSheetAuthoritativeLoadToken) => boolean
  readonly adoptAuthoritativeSet: (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ) => LiveSheetAuthoritativeSetResult
}

export interface UseLiveTableSnapshotSyncOptions {
  readonly slug: string
  readonly role: ReadonlyValueRef<AuthRole | null | undefined>
  readonly playerProfileId: ReadonlyValueRef<PlayerProfileId | null | undefined>
  readonly sheetCache: LiveTableSnapshotSheetCacheController
  readonly applyMap: (map: TabletopMap) => void
  readonly applyInteractionMode: (state: ApplyAuthoritativeMapInteractionModeInput) => void
  readonly applyAbilityCapabilities?: (capabilities: AbilityClientCapabilityBundle) => void
}

export interface UseLiveTableSnapshotSyncReturn {
  readonly status: Ref<LiveTableSnapshotSyncStatus>
  readonly error: Ref<string | null>
  readonly ready: ComputedRef<boolean>
  readonly currentAccessScopeKey: ComputedRef<LiveSheetAccessScopeKey>
  readonly requestSnapshot: (reason?: string) => Promise<void>
}

interface ActiveSnapshotRequest {
  readonly requestId: number
  readonly context: LiveSheetAccessRequestContext
  readonly promise: Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isSafeTimestamp = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
)

const validateRevisionedSheetDocuments = (
  sheets: unknown,
  label: string,
): void => {
  if (!Array.isArray(sheets)) throw new Error(`${label} must be an array.`)
  for (const sheet of sheets) {
    if (!isRecord(sheet)) throw new Error(`${label} entries must be objects.`)
    if (typeof sheet.slug !== 'string' || !sheet.slug.trim()) {
      throw new Error(`${label} entries must include a slug.`)
    }
    if (!isSafeSheetRevision(sheet.revision)) {
      throw new Error(`${label} entry ${sheet.slug} must include a safe non-negative revision.`)
    }
  }
}

const validateSnapshot = (snapshot: LiveTableSnapshot, slug: string): void => {
  if (!isRecord(snapshot)) throw new Error('Live table snapshot must be an object.')
  if (snapshot.schemaVersion !== LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported live table snapshot schema version ${String(snapshot.schemaVersion)}.`)
  }
  if (!isRecord(snapshot.map)) throw new Error('Live table snapshot map must be an object.')
  if (snapshot.map.slug !== slug) {
    throw new Error(`Live table snapshot returned map ${String(snapshot.map.slug)} for ${slug}.`)
  }
  if (!isMapRevision(snapshot.map.revision)) {
    throw new Error('Live table snapshot map revision must be a safe non-negative integer.')
  }
  if (!isMapRevision(snapshot.mapRevision)) {
    throw new Error('Live table snapshot mapRevision must be a safe non-negative integer.')
  }
  if (snapshot.mapRevision !== snapshot.map.revision) {
    throw new Error('Live table snapshot mapRevision does not match the embedded map revision.')
  }
  if (!isMapInteractionMode(snapshot.interactionMode)) {
    throw new Error('Live table snapshot interaction mode is invalid.')
  }
  if (!isSafeTimestamp(snapshot.interactionModeUpdatedAt)) {
    throw new Error('Live table snapshot interaction mode timestamp is invalid.')
  }
  validateRevisionedSheetDocuments(snapshot.pokemonSheets, 'Live table snapshot Pokémon sheets')
  validateRevisionedSheetDocuments(snapshot.trainerSheets, 'Live table snapshot trainer sheets')
  const capabilities = parseAbilityClientCapabilityBundle(snapshot.abilityCapabilities)
  if (capabilities.mapSlug !== slug || capabilities.mapRevision !== snapshot.mapRevision) {
    throw new Error('Live table snapshot ability capabilities do not match its map revision.')
  }
}

const sameAccessContext = (
  left: LiveSheetAccessRequestContext,
  right: LiveSheetAccessRequestContext,
): boolean => (
  left.accessScopeKey === right.accessScopeKey
  && (left.role ?? null) === (right.role ?? null)
  && (left.profileId ?? null) === (right.profileId ?? null)
)

const adoptionFailureMessage = (result: LiveSheetAuthoritativeSetResult): string => {
  if (result.status === 'applied') return ''
  return result.message
}

export const useLiveTableSnapshotSync = (
  options: UseLiveTableSnapshotSyncOptions,
): UseLiveTableSnapshotSyncReturn => {
  const status = ref<LiveTableSnapshotSyncStatus>('idle')
  const error = ref<string | null>(null)
  const { getJson } = useApiClient()
  let latestRequestId = 0
  let activeRequest: ActiveSnapshotRequest | null = null

  const buildAccessContext = (): LiveSheetAccessRequestContext => {
    const role = options.role.value ?? null
    const profileId = role === 'player' ? options.playerProfileId.value ?? null : null
    return {
      accessScopeKey: buildLiveSheetAccessScopeKey({ role, profileId }),
      role,
      profileId,
    }
  }

  const currentAccessScopeKey = computed(() => buildAccessContext().accessScopeKey)
  const ready = computed(() => status.value === 'ready')

  const requestParamsForContext = (context: LiveSheetAccessRequestContext): { slug: string; profileId?: PlayerProfileId } => ({
    slug: options.slug,
    ...(context.role === 'player' && context.profileId ? { profileId: context.profileId } : {}),
  })

  const ignoreSupersededResponse = (
    requestId: number,
    context: LiveSheetAccessRequestContext,
    token: LiveSheetAuthoritativeLoadToken,
  ): boolean => (
    requestId !== latestRequestId
    || !sameAccessContext(buildAccessContext(), context)
    || !options.sheetCache.isCurrentAuthoritativeLoad(token)
  )

  const applySnapshot = (
    snapshot: LiveTableSnapshot,
    token: LiveSheetAuthoritativeLoadToken,
  ): boolean => {
    const sheetResult = options.sheetCache.adoptAuthoritativeSet({
      pokemonSheets: snapshot.pokemonSheets,
      trainerSheets: snapshot.trainerSheets,
    }, token)

    if (sheetResult.status === 'ignored-superseded' || sheetResult.status === 'ignored-scope') return false
    if (sheetResult.status !== 'applied') throw new Error(adoptionFailureMessage(sheetResult))

    options.applyInteractionMode({
      slug: snapshot.map.slug,
      interactionMode: snapshot.interactionMode,
      updatedAt: snapshot.interactionModeUpdatedAt,
    })
    options.applyAbilityCapabilities?.(parseAbilityClientCapabilityBundle(snapshot.abilityCapabilities))
    options.applyMap({
      ...snapshot.map,
      revision: snapshot.mapRevision,
    })
    return true
  }

  const requestSnapshot = (reason = 'Loading live table snapshot.'): Promise<void> => {
    const context = buildAccessContext()
    if (activeRequest && sameAccessContext(activeRequest.context, context)) return activeRequest.promise

    const requestId = latestRequestId + 1
    latestRequestId = requestId
    const token = options.sheetCache.beginAuthoritativeLoad(context)
    status.value = status.value === 'idle' ? 'loading' : 'reconciling'
    error.value = null

    const promise = (async () => {
      try {
        const snapshot = await getJson<LiveTableSnapshot>(MAP_API_PATHS.liveState, {
          params: requestParamsForContext(context),
        })
        if (ignoreSupersededResponse(requestId, context, token)) return

        validateSnapshot(snapshot, options.slug)
        if (ignoreSupersededResponse(requestId, context, token)) return

        if (!applySnapshot(snapshot, token)) return
        if (ignoreSupersededResponse(requestId, context, token)) return

        status.value = 'ready'
        error.value = null
      } catch (err) {
        if (!sameAccessContext(buildAccessContext(), context) || requestId !== latestRequestId) return
        const message = getErrorMessage(err, { fallback: reason })
        status.value = 'error'
        error.value = message
        throw err
      } finally {
        if (activeRequest?.requestId === requestId) activeRequest = null
      }
    })()

    activeRequest = { requestId, context, promise }
    return promise
  }

  return {
    status,
    error,
    ready,
    currentAccessScopeKey,
    requestSnapshot,
  }
}
