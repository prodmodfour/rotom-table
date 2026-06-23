import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import type { RealtimeEvent } from '#shared/realtime'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'

export type LiveSheetKey = `${SheetKind}:${string}`
export type LiveSheetAccessScopeKey = string
type AnyLiveSheet = CharacterSheet | TrainerSheet

export interface LiveSheetMaps {
  pokemonBySlug: Map<string, CharacterSheet>
  trainerBySlug: Map<string, TrainerSheet>
}

export interface LiveSheetListPayload {
  pokemonSheets: readonly CharacterSheet[]
  trainerSheets: readonly TrainerSheet[]
}

export type SheetAdoptionResult =
  | { status: 'adopted' }
  | { status: 'unchanged' }
  | { status: 'ignored-stale' }
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; message: string }

export interface LiveSheetAuthoritativeLoadToken {
  readonly requestId: number
  readonly mutationSequence: number
  readonly accessScopeKey: LiveSheetAccessScopeKey
}

export type LiveSheetAuthoritativeSetResult =
  | {
    status: 'applied'
    adopted: number
    unchanged: number
    ignoredStale: number
    removed: number
  }
  | { status: 'ignored-superseded'; message: string }
  | { status: 'ignored-scope'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; message: string }

export type LiveSheetRealtimeApplicationResult =
  | { status: 'ignored' }
  | { status: 'adopted'; result: SheetAdoptionResult }
  | { status: 'unchanged'; result: SheetAdoptionResult }
  | { status: 'ignored-stale'; result: SheetAdoptionResult }
  | { status: 'deleted' }
  | { status: 'invalidated'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; message: string }

interface SheetRealtimePayload {
  readonly kind?: unknown
  readonly slug?: unknown
  readonly oldSlug?: unknown
  readonly newSlug?: unknown
  readonly sheet?: unknown
}

export interface TombstoneMetadata {
  readonly sequence: number
  readonly revision?: number
  readonly accessScopeKey: LiveSheetAccessScopeKey | null
  readonly reason: 'deleted' | 'renamed-away' | 'authoritative-absent'
}

export interface SheetAdoptionOptions {
  readonly expectedSlug?: string
  readonly preserveClientAccessAnnotations?: boolean
  readonly ignoreRecentTombstoneAfterSequence?: number
  readonly respectTombstoneRevision?: boolean
}

interface PreparedAdoption {
  readonly result: SheetAdoptionResult
  readonly kind?: SheetKind
  readonly slug?: string
  readonly key?: LiveSheetKey
  readonly sheet?: AnyLiveSheet
}

interface PreparedSetOperation {
  readonly kind: SheetKind
  readonly slug: string
  readonly key: LiveSheetKey
  readonly sheet: AnyLiveSheet
}

interface PreparedRemoveOperation {
  readonly kind: SheetKind
  readonly slug: string
  readonly key: LiveSheetKey
  readonly reason: TombstoneMetadata['reason']
}

export interface LiveSheetCacheController {
  readonly maps: LiveSheetMaps
  readonly mutationSequence: number
  readonly accessScopeKey: LiveSheetAccessScopeKey | null
  readonly hydrated: boolean
  readonly reconciliationRequired: boolean
  readonly reconciliationReason: string | null
  readonly latestRequestId: number
  buildKey: (kind: SheetKind, slug: string) => LiveSheetKey
  beginAuthoritativeLoad: (accessScopeKey: LiveSheetAccessScopeKey) => LiveSheetAuthoritativeLoadToken
  adoptAuthoritativeSet: (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ) => LiveSheetAuthoritativeSetResult
  isCurrentAuthoritativeLoad: (token: LiveSheetAuthoritativeLoadToken) => boolean
  adoptCompleteSheet: (
    kind: SheetKind,
    sheet: unknown,
    options?: SheetAdoptionOptions,
  ) => SheetAdoptionResult
  renameSheet: (
    kind: SheetKind,
    oldSlug: string,
    sheet: unknown,
    options?: SheetAdoptionOptions,
  ) => SheetAdoptionResult
  deleteSheet: (kind: SheetKind, slug: string) => boolean
  invalidateSheet: (kind: SheetKind, slug: string, reason?: string) => void
  requireReconciliation: (reason: string) => void
  applyRealtimeEvent: (event: Pick<RealtimeEvent, 'type' | 'data'>) => LiveSheetRealtimeApplicationResult
  lastMutationSequenceForKey: (key: LiveSheetKey) => number | undefined
  tombstoneForKey: (key: LiveSheetKey) => TombstoneMetadata | undefined
}

const CLIENT_ACCESS_ANNOTATIONS = ['sessionPlayerAccessible', 'playerProfileAccessible'] as const

export const DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY = 'default'
export const GM_LIVE_SHEET_ACCESS_SCOPE_KEY = 'gm'
export const PLAYER_NO_PROFILE_LIVE_SHEET_ACCESS_SCOPE_KEY = 'player:no-profile'
export const GUEST_LIVE_SHEET_ACCESS_SCOPE_KEY = 'guest'

export const buildLiveSheetAccessScopeKey = (input: {
  readonly role?: AuthRole | null
  readonly profileId?: PlayerProfileId | null
}): LiveSheetAccessScopeKey => {
  if (input.role === 'gm') return GM_LIVE_SHEET_ACCESS_SCOPE_KEY
  if (input.role === 'player') {
    return input.profileId ? `player:${input.profileId}` : PLAYER_NO_PROFILE_LIVE_SHEET_ACCESS_SCOPE_KEY
  }
  return GUEST_LIVE_SHEET_ACCESS_SCOPE_KEY
}

export const normalizeLiveSheetSlug = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
)

export const buildLiveSheetKey = (kind: SheetKind, slug: string): LiveSheetKey => (
  `${kind}:${normalizeLiveSheetSlug(slug)}` as LiveSheetKey
)

export const isSafeSheetRevision = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

export const buildLiveSheetMaps = (
  pokemonSheets: readonly CharacterSheet[],
  trainerSheets: readonly TrainerSheet[],
): LiveSheetMaps => ({
  pokemonBySlug: new Map(pokemonSheets.map((sheet) => [sheet.slug, sheet])),
  trainerBySlug: new Map(trainerSheets.map((sheet) => [sheet.slug, sheet])),
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const mapForKind = (maps: LiveSheetMaps, kind: SheetKind): Map<string, AnyLiveSheet> => (
  kind === 'pokemon'
    ? maps.pokemonBySlug as Map<string, AnyLiveSheet>
    : maps.trainerBySlug as Map<string, AnyLiveSheet>
)

const invalidResult = (message: string): SheetAdoptionResult => ({ status: 'invalid', message })

const conflictResult = (message: string): SheetAdoptionResult => ({ status: 'conflict', message })

const cloneSheet = <TSheet extends AnyLiveSheet>(sheet: TSheet): TSheet => deepCloneJson(sheet)

const persistedComparableSheet = (sheet: AnyLiveSheet): Record<string, unknown> => {
  const comparable = deepCloneJson(sheet as unknown as Record<string, unknown>)
  for (const field of CLIENT_ACCESS_ANNOTATIONS) delete comparable[field]
  return comparable
}

const realtimeResultFromAdoption = (result: SheetAdoptionResult): LiveSheetRealtimeApplicationResult => {
  switch (result.status) {
    case 'adopted':
      return { status: 'adopted', result }
    case 'unchanged':
      return { status: 'unchanged', result }
    case 'ignored-stale':
      return { status: 'ignored-stale', result }
    case 'conflict':
      return { status: 'conflict', message: result.message }
    case 'invalid':
      return { status: 'invalid', message: result.message }
  }
}

export const createLiveSheetCacheController = (
  maps: LiveSheetMaps = buildLiveSheetMaps([], []),
): LiveSheetCacheController => {
  let mutationSequence = 0
  let currentAccessScopeKey: LiveSheetAccessScopeKey | null = null
  let hydratedScopeKey: LiveSheetAccessScopeKey | null = null
  let latestRequestId = 0
  let reconciliationRequired = false
  let reconciliationReason: string | null = null
  const keyMutationSequences = new Map<LiveSheetKey, number>()
  const tombstones = new Map<LiveSheetKey, TombstoneMetadata>()

  const nextMutationSequence = (): number => {
    mutationSequence += 1
    return mutationSequence
  }

  const recordKeyMutation = (key: LiveSheetKey): number => {
    const sequence = nextMutationSequence()
    keyMutationSequences.set(key, sequence)
    return sequence
  }

  const markNotHydrated = (): void => {
    hydratedScopeKey = null
  }

  const markReconciliationRequired = (reason: string): void => {
    reconciliationRequired = true
    reconciliationReason = reason
  }

  const clearForAccessScope = (accessScopeKey: LiveSheetAccessScopeKey): void => {
    if (currentAccessScopeKey === accessScopeKey) return
    currentAccessScopeKey = accessScopeKey
    markNotHydrated()
    reconciliationRequired = false
    reconciliationReason = null
    maps.pokemonBySlug.clear()
    maps.trainerBySlug.clear()
    keyMutationSequences.clear()
    tombstones.clear()
    nextMutationSequence()
  }

  const prepareIncomingSheet = (
    kind: SheetKind,
    sheet: unknown,
    expectedSlug?: string,
  ): { ok: true; sheet: AnyLiveSheet; slug: string; revision: number } | { ok: false; result: SheetAdoptionResult } => {
    if (!isRecord(sheet)) return { ok: false, result: invalidResult(`${kind} sheet update must be an object.`) }
    const slug = normalizeLiveSheetSlug(sheet.slug)
    if (!slug) return { ok: false, result: invalidResult(`${kind} sheet update must include a non-empty slug.`) }
    const normalizedExpectedSlug = normalizeLiveSheetSlug(expectedSlug)
    if (normalizedExpectedSlug && slug !== normalizedExpectedSlug) {
      return {
        ok: false,
        result: invalidResult(`${kind} sheet update slug ${slug} does not match expected slug ${normalizedExpectedSlug}.`),
      }
    }
    if (!isSafeSheetRevision(sheet.revision)) {
      return {
        ok: false,
        result: invalidResult(`${kind} sheet ${slug} revision must be a safe non-negative integer.`),
      }
    }
    return { ok: true, sheet: sheet as unknown as AnyLiveSheet, slug, revision: sheet.revision }
  }

  const sheetWithPreservedClientAnnotations = (
    incoming: AnyLiveSheet,
    previous: AnyLiveSheet | undefined,
    preserveClientAccessAnnotations: boolean,
  ): AnyLiveSheet => {
    const next = cloneSheet(incoming)
    if (!preserveClientAccessAnnotations || !previous) return next
    const nextRecord = next as unknown as Record<string, unknown>
    const previousRecord = previous as unknown as Record<string, unknown>
    for (const field of CLIENT_ACCESS_ANNOTATIONS) {
      if (nextRecord[field] === undefined && previousRecord[field] !== undefined) {
        nextRecord[field] = deepCloneJson(previousRecord[field])
      }
    }
    return next
  }

  const prepareAdoption = (
    kind: SheetKind,
    sheet: unknown,
    options: SheetAdoptionOptions = {},
  ): PreparedAdoption => {
    const prepared = prepareIncomingSheet(kind, sheet, options.expectedSlug)
    if (!prepared.ok) return { result: prepared.result }

    const key = buildLiveSheetKey(kind, prepared.slug)
    const map = mapForKind(maps, kind)
    const previous = map.get(prepared.slug)
    const tombstone = tombstones.get(key)
    const preserveClientAccessAnnotations = options.preserveClientAccessAnnotations !== false

    if (!previous) {
      if (
        typeof options.ignoreRecentTombstoneAfterSequence === 'number'
        && tombstone
        && tombstone.sequence > options.ignoreRecentTombstoneAfterSequence
      ) {
        return { result: { status: 'ignored-stale' }, kind, slug: prepared.slug, key }
      }
      if (
        options.respectTombstoneRevision !== false
        && tombstone?.revision !== undefined
        && prepared.revision <= tombstone.revision
      ) {
        return { result: { status: 'ignored-stale' }, kind, slug: prepared.slug, key }
      }
      return {
        result: { status: 'adopted' },
        kind,
        slug: prepared.slug,
        key,
        sheet: sheetWithPreservedClientAnnotations(prepared.sheet, undefined, preserveClientAccessAnnotations),
      }
    }

    if (!isSafeSheetRevision(previous.revision)) {
      return {
        result: conflictResult(`Cached ${kind} sheet ${prepared.slug} has an invalid local revision.`),
        kind,
        slug: prepared.slug,
        key,
      }
    }

    if (prepared.revision < previous.revision) {
      return { result: { status: 'ignored-stale' }, kind, slug: prepared.slug, key }
    }

    const candidate = sheetWithPreservedClientAnnotations(
      prepared.sheet,
      previous,
      preserveClientAccessAnnotations,
    )

    if (prepared.revision === previous.revision) {
      if (!sameJsonValue(persistedComparableSheet(previous), persistedComparableSheet(prepared.sheet))) {
        return {
          result: conflictResult(`${kind} sheet ${prepared.slug} has divergent contents at revision ${prepared.revision}.`),
          kind,
          slug: prepared.slug,
          key,
        }
      }
      if (sameJsonValue(previous, candidate)) {
        return { result: { status: 'unchanged' }, kind, slug: prepared.slug, key }
      }
      return { result: { status: 'adopted' }, kind, slug: prepared.slug, key, sheet: candidate }
    }

    return { result: { status: 'adopted' }, kind, slug: prepared.slug, key, sheet: candidate }
  }

  const commitSet = (operation: PreparedSetOperation): void => {
    mapForKind(maps, operation.kind).set(operation.slug, operation.sheet)
    tombstones.delete(operation.key)
    recordKeyMutation(operation.key)
  }

  const commitRemove = (operation: PreparedRemoveOperation): boolean => {
    const map = mapForKind(maps, operation.kind)
    const previous = map.get(operation.slug)
    const previousTombstone = tombstones.get(operation.key)
    if (!previous && previousTombstone) return false

    if (previous) map.delete(operation.slug)
    const sequence = recordKeyMutation(operation.key)
    const revision = previous && isSafeSheetRevision(previous.revision)
      ? previous.revision
      : previousTombstone?.revision
    tombstones.set(operation.key, {
      sequence,
      ...(revision === undefined ? {} : { revision }),
      accessScopeKey: currentAccessScopeKey,
      reason: operation.reason,
    })
    return true
  }

  const adoptPrepared = (prepared: PreparedAdoption): SheetAdoptionResult => {
    if (prepared.result.status !== 'adopted') return prepared.result
    if (!prepared.kind || !prepared.slug || !prepared.key || !prepared.sheet) {
      return invalidResult('Prepared sheet adoption is missing its committed sheet.')
    }
    commitSet({ kind: prepared.kind, slug: prepared.slug, key: prepared.key, sheet: prepared.sheet })
    return prepared.result
  }

  const adoptCompleteSheet = (
    kind: SheetKind,
    sheet: unknown,
    options: SheetAdoptionOptions = {},
  ): SheetAdoptionResult => adoptPrepared(prepareAdoption(kind, sheet, options))

  const deleteSheet = (kind: SheetKind, slugInput: string): boolean => {
    const slug = normalizeLiveSheetSlug(slugInput)
    if (!slug) return false
    return commitRemove({ kind, slug, key: buildLiveSheetKey(kind, slug), reason: 'deleted' })
  }

  const renameSheet = (
    kind: SheetKind,
    oldSlugInput: string,
    sheet: unknown,
    options: SheetAdoptionOptions = {},
  ): SheetAdoptionResult => {
    const oldSlug = normalizeLiveSheetSlug(oldSlugInput)
    const expectedSlug = normalizeLiveSheetSlug(options.expectedSlug)
    const prepared = prepareAdoption(kind, sheet, {
      ...options,
      ...(expectedSlug ? { expectedSlug } : {}),
    })
    if (prepared.result.status === 'conflict' || prepared.result.status === 'invalid') return prepared.result

    let removedOldKey = false
    if (oldSlug && oldSlug !== prepared.slug) {
      removedOldKey = commitRemove({
        kind,
        slug: oldSlug,
        key: buildLiveSheetKey(kind, oldSlug),
        reason: 'renamed-away',
      })
    }

    const adoptionResult = adoptPrepared(prepared)
    if (removedOldKey && adoptionResult.status !== 'conflict' && adoptionResult.status !== 'invalid') {
      return { status: 'adopted' }
    }
    return adoptionResult
  }

  const invalidateSheet = (kind: SheetKind, slugInput: string, reason = 'Sheet cache requires authoritative reconciliation.'): void => {
    const slug = normalizeLiveSheetSlug(slugInput)
    if (slug) recordKeyMutation(buildLiveSheetKey(kind, slug))
    else nextMutationSequence()
    markNotHydrated()
    markReconciliationRequired(reason)
  }

  const applyRealtimeEvent = (event: Pick<RealtimeEvent, 'type' | 'data'>): LiveSheetRealtimeApplicationResult => {
    const payload = event.data as SheetRealtimePayload | undefined
    if (!payload || !isSheetKind(payload.kind)) return { status: 'ignored' }

    const kind = payload.kind
    const slug = normalizeLiveSheetSlug(payload.slug)

    if (event.type === 'deleted') {
      if (!slug) {
        invalidateSheet(kind, '', 'Sheet delete event did not include a slug; authoritative reconciliation is required.')
        return { status: 'invalidated', message: reconciliationReason ?? 'Authoritative reconciliation is required.' }
      }
      deleteSheet(kind, slug)
      return { status: 'deleted' }
    }

    if (event.type === 'moved') {
      invalidateSheet(
        kind,
        slug,
        `${kind} sheet ${slug || '(unknown)'} moved without a complete revisioned document; authoritative reconciliation is required.`,
      )
      return { status: 'invalidated', message: reconciliationReason ?? 'Authoritative reconciliation is required.' }
    }

    if (event.type === 'renamed') {
      const oldSlug = normalizeLiveSheetSlug(payload.oldSlug)
      const newSlug = normalizeLiveSheetSlug(payload.newSlug ?? payload.slug)
      if (!oldSlug || !newSlug || !payload.sheet) {
        invalidateSheet(
          kind,
          oldSlug || newSlug || slug,
          `${kind} sheet rename event did not include enough revisioned sheet data; authoritative reconciliation is required.`,
        )
        return { status: 'invalidated', message: reconciliationReason ?? 'Authoritative reconciliation is required.' }
      }
      const result = renameSheet(kind, oldSlug, payload.sheet, {
        expectedSlug: newSlug,
        preserveClientAccessAnnotations: true,
      })
      if (result.status === 'conflict' || result.status === 'invalid') {
        invalidateSheet(kind, oldSlug || newSlug, result.message)
      }
      return realtimeResultFromAdoption(result)
    }

    if (event.type === 'created' || event.type === 'updated') {
      if (!slug || !payload.sheet) {
        invalidateSheet(
          kind,
          slug,
          `${kind} sheet ${event.type} event did not include a complete revisioned document; authoritative reconciliation is required.`,
        )
        return { status: 'invalidated', message: reconciliationReason ?? 'Authoritative reconciliation is required.' }
      }
      const result = adoptCompleteSheet(kind, payload.sheet, {
        expectedSlug: slug,
        preserveClientAccessAnnotations: true,
      })
      if (result.status === 'conflict' || result.status === 'invalid') {
        invalidateSheet(kind, slug, result.message)
      }
      return realtimeResultFromAdoption(result)
    }

    return { status: 'ignored' }
  }

  const beginAuthoritativeLoad = (accessScopeKeyInput: LiveSheetAccessScopeKey): LiveSheetAuthoritativeLoadToken => {
    const accessScopeKey = accessScopeKeyInput || DEFAULT_LIVE_SHEET_ACCESS_SCOPE_KEY
    clearForAccessScope(accessScopeKey)
    const requestId = latestRequestId + 1
    latestRequestId = requestId
    return { requestId, mutationSequence, accessScopeKey }
  }

  const isCurrentAuthoritativeLoad = (token: LiveSheetAuthoritativeLoadToken): boolean => (
    token.requestId === latestRequestId && token.accessScopeKey === currentAccessScopeKey
  )

  const adoptAuthoritativeSet = (
    payload: LiveSheetListPayload,
    token: LiveSheetAuthoritativeLoadToken,
  ): LiveSheetAuthoritativeSetResult => {
    if (token.requestId !== latestRequestId) {
      return {
        status: 'ignored-superseded',
        message: 'Runtime sheet reload was superseded before fresh sheets could be applied',
      }
    }
    if (token.accessScopeKey !== currentAccessScopeKey) {
      return {
        status: 'ignored-scope',
        message: `Runtime sheet reload for ${token.accessScopeKey} cannot apply to current sheet scope ${currentAccessScopeKey ?? '(none)'}.`,
      }
    }

    const returnedKeys = new Set<LiveSheetKey>()
    const setOperations: PreparedSetOperation[] = []
    let unchanged = 0
    let ignoredStale = 0

    const prepareReturnedSheet = (kind: SheetKind, sheet: unknown): LiveSheetAuthoritativeSetResult | null => {
      const prepared = prepareAdoption(kind, sheet, {
        preserveClientAccessAnnotations: false,
        ignoreRecentTombstoneAfterSequence: token.mutationSequence,
      })
      if (prepared.key) returnedKeys.add(prepared.key)
      switch (prepared.result.status) {
        case 'adopted':
          if (!prepared.kind || !prepared.slug || !prepared.key || !prepared.sheet) {
            return { status: 'invalid', message: 'Prepared sheet adoption is missing its committed sheet.' }
          }
          setOperations.push({
            kind: prepared.kind,
            slug: prepared.slug,
            key: prepared.key,
            sheet: prepared.sheet,
          })
          return null
        case 'unchanged':
          unchanged += 1
          return null
        case 'ignored-stale':
          ignoredStale += 1
          return null
        case 'conflict':
          return { status: 'conflict', message: prepared.result.message }
        case 'invalid':
          return { status: 'invalid', message: prepared.result.message }
      }
    }

    for (const sheet of payload.pokemonSheets) {
      const error = prepareReturnedSheet('pokemon', sheet)
      if (error) return error
    }
    for (const sheet of payload.trainerSheets) {
      const error = prepareReturnedSheet('trainer', sheet)
      if (error) return error
    }

    const removeOperations: PreparedRemoveOperation[] = []
    const prepareAbsentRemovals = (kind: SheetKind, map: Map<string, AnyLiveSheet>): void => {
      for (const slug of map.keys()) {
        const key = buildLiveSheetKey(kind, slug)
        if (returnedKeys.has(key)) continue
        const lastMutationSequence = keyMutationSequences.get(key) ?? 0
        const tombstoneSequence = tombstones.get(key)?.sequence ?? 0
        if (lastMutationSequence > token.mutationSequence || tombstoneSequence > token.mutationSequence) continue
        removeOperations.push({ kind, slug, key, reason: 'authoritative-absent' })
      }
    }

    prepareAbsentRemovals('pokemon', maps.pokemonBySlug as Map<string, AnyLiveSheet>)
    prepareAbsentRemovals('trainer', maps.trainerBySlug as Map<string, AnyLiveSheet>)

    for (const operation of setOperations) commitSet(operation)
    let removed = 0
    for (const operation of removeOperations) {
      if (commitRemove(operation)) removed += 1
    }

    hydratedScopeKey = token.accessScopeKey
    reconciliationRequired = false
    reconciliationReason = null

    return {
      status: 'applied',
      adopted: setOperations.length,
      unchanged,
      ignoredStale,
      removed,
    }
  }

  return {
    maps,
    get mutationSequence() {
      return mutationSequence
    },
    get accessScopeKey() {
      return currentAccessScopeKey
    },
    get hydrated() {
      return hydratedScopeKey !== null && hydratedScopeKey === currentAccessScopeKey
    },
    get reconciliationRequired() {
      return reconciliationRequired
    },
    get reconciliationReason() {
      return reconciliationReason
    },
    get latestRequestId() {
      return latestRequestId
    },
    buildKey: buildLiveSheetKey,
    beginAuthoritativeLoad,
    adoptAuthoritativeSet,
    isCurrentAuthoritativeLoad,
    adoptCompleteSheet,
    renameSheet,
    deleteSheet,
    invalidateSheet,
    requireReconciliation: markReconciliationRequired,
    applyRealtimeEvent,
    lastMutationSequenceForKey: (key: LiveSheetKey) => keyMutationSequences.get(key),
    tombstoneForKey: (key: LiveSheetKey) => tombstones.get(key),
  }
}

export const applyLiveSheetRealtimeEvent = (
  controller: LiveSheetCacheController,
  event: Pick<RealtimeEvent, 'type' | 'data'>,
): LiveSheetRealtimeApplicationResult => controller.applyRealtimeEvent(event)
