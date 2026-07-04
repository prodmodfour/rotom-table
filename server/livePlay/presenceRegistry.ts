import { createHash } from 'node:crypto'
import {
  LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  LIVE_PLAY_PRESENCE_AUTHORITY,
  buildLivePlayPresenceParticipantSummary,
  isLivePlayPresenceRole,
  parseLivePlayPresenceUpdate,
  type LivePlayPresenceAttentionRequest,
  type LivePlayPresenceAttentionTarget,
  type LivePlayPresenceEntry,
  type LivePlayPresenceIntentState,
  type LivePlayPresenceParticipantSummary,
  type LivePlayPresencePingPayload,
  type LivePlayPresenceRole,
  type LivePlayPresenceUpdate,
  type LivePlayPresenceValidationIssue,
} from '#shared/livePlayPresence'
import { validateSlug } from '#shared/paths'

export const LIVE_PLAY_PRESENCE_DEFAULT_TTL_MS = 15_000 as const
export const LIVE_PLAY_PRESENCE_PRINCIPAL_CONTEXT_MAX_CHARS = 256 as const

export type LivePlayPresenceRegistryErrorCode =
  | 'invalid-map-slug'
  | 'invalid-principal'
  | 'invalid-presence-update'
  | 'invalid-clock'
  | 'invalid-ttl'
  | 'invalid-options'

export class LivePlayPresenceRegistryError extends Error {
  readonly code: LivePlayPresenceRegistryErrorCode
  readonly issues: readonly LivePlayPresenceValidationIssue[]

  constructor(
    code: LivePlayPresenceRegistryErrorCode,
    message: string,
    issues: readonly LivePlayPresenceValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'LivePlayPresenceRegistryError'
    this.code = code
    this.issues = issues
  }
}

export interface LivePlayPresenceRegistryPrincipalContext {
  readonly role: LivePlayPresenceRole
  /** Server-observed client/session id. Only a display-safe suffix is exposed. */
  readonly clientId: string
  /** Server-observed profile or session discriminator. Hashed for the in-memory key and never exposed. */
  readonly profileContextKey?: string | null
  /** Display-safe profile name source; sanitized before it reaches entries. */
  readonly profileDisplayName?: unknown
  /** Optional stable, non-exposed seed for the visual accent. */
  readonly accentSeed?: string | null
}

export interface LivePlayPresenceRegistryOptions {
  readonly ttlMs?: number
  readonly maxEntriesPerMap?: number
  readonly now?: () => number
}

export interface LivePlayPresenceRegistryUpdateInput {
  readonly mapSlug: string
  readonly principal: LivePlayPresenceRegistryPrincipalContext
  readonly update: unknown
  readonly now?: number
}

export interface LivePlayPresenceRegistryListInput {
  readonly mapSlug: string
  readonly now?: number
}

export interface LivePlayPresenceRegistryRemoveInput {
  readonly mapSlug: string
  readonly principal: LivePlayPresenceRegistryPrincipalContext
}

export interface LivePlayPresenceRegistryPruneInput {
  readonly now?: number
}

export interface LivePlayPresenceRegistry {
  update(input: LivePlayPresenceRegistryUpdateInput): LivePlayPresenceEntry
  list(input: LivePlayPresenceRegistryListInput): readonly LivePlayPresenceEntry[]
  remove(input: LivePlayPresenceRegistryRemoveInput): boolean
  prune(input?: LivePlayPresenceRegistryPruneInput): number
}

interface NormalizedPrincipalContext {
  readonly role: LivePlayPresenceRole
  readonly clientId: string
  readonly profileContextKey: string | null
  readonly profileDisplayName?: unknown
  readonly accentSeed: string
}

interface StoredPresenceEntry {
  readonly principalKey: string
  readonly principalClientKey: string
  readonly entry: LivePlayPresenceEntry
}

type PresenceMap = Map<string, StoredPresenceEntry>

const ttlFromOptions = (ttlMs: number | undefined): number => {
  const ttl = ttlMs ?? LIVE_PLAY_PRESENCE_DEFAULT_TTL_MS
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new LivePlayPresenceRegistryError('invalid-ttl', 'Presence registry TTL must be a positive safe integer.')
  }
  return ttl
}

const maxEntriesFromOptions = (maxEntriesPerMap: number | undefined): number => {
  const maxEntries = maxEntriesPerMap ?? LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES) {
    throw new LivePlayPresenceRegistryError(
      'invalid-options',
      `Presence registry maxEntriesPerMap must be between 1 and ${LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES}.`,
    )
  }
  return maxEntries
}

const normalizeNow = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LivePlayPresenceRegistryError('invalid-clock', 'Presence registry time must be a safe non-negative integer timestamp.')
  }
  return value
}

const normalizeMapSlug = (mapSlug: string): string => {
  try {
    return validateSlug(mapSlug, 'mapSlug')
  } catch (error) {
    throw new LivePlayPresenceRegistryError(
      'invalid-map-slug',
      error instanceof Error ? error.message : String(error),
    )
  }
}

const normalizeContextString = (value: string | null | undefined, label: string): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > LIVE_PLAY_PRESENCE_PRINCIPAL_CONTEXT_MAX_CHARS) {
    throw new LivePlayPresenceRegistryError(
      'invalid-principal',
      `${label} must be a non-empty string no longer than ${LIVE_PLAY_PRESENCE_PRINCIPAL_CONTEXT_MAX_CHARS} characters when present.`,
    )
  }
  return value
}

const normalizePrincipalContext = (
  principal: LivePlayPresenceRegistryPrincipalContext,
): NormalizedPrincipalContext => {
  if (!isLivePlayPresenceRole(principal.role)) {
    throw new LivePlayPresenceRegistryError('invalid-principal', 'Presence principal role must be gm or player.')
  }

  if (
    typeof principal.clientId !== 'string'
    || principal.clientId.length === 0
    || principal.clientId.length > LIVE_PLAY_PRESENCE_PRINCIPAL_CONTEXT_MAX_CHARS
  ) {
    throw new LivePlayPresenceRegistryError(
      'invalid-principal',
      `Presence principal clientId must be a non-empty string no longer than ${LIVE_PLAY_PRESENCE_PRINCIPAL_CONTEXT_MAX_CHARS} characters.`,
    )
  }

  const profileContextKey = normalizeContextString(principal.profileContextKey, 'profileContextKey')
  const accentSeed = normalizeContextString(principal.accentSeed, 'accentSeed')
    ?? profileContextKey
    ?? principal.clientId

  return {
    role: principal.role,
    clientId: principal.clientId,
    profileContextKey,
    profileDisplayName: principal.profileDisplayName,
    accentSeed,
  }
}

const principalKeyForContext = (principal: NormalizedPrincipalContext): string => createHash('sha256')
  .update(JSON.stringify({
    role: principal.role,
    clientId: principal.clientId,
    profileContextKey: principal.profileContextKey,
  }))
  .digest('hex')

const principalClientKeyForContext = (principal: NormalizedPrincipalContext): string => createHash('sha256')
  .update(JSON.stringify({
    role: principal.role,
    clientId: principal.clientId,
  }))
  .digest('hex')

const removeSupersededClientPresence = (
  presenceMap: PresenceMap,
  principalKey: string,
  principalClientKey: string,
): void => {
  for (const [storedPrincipalKey, stored] of presenceMap.entries()) {
    if (storedPrincipalKey === principalKey) continue
    if (stored.principalClientKey !== principalClientKey) continue
    presenceMap.delete(storedPrincipalKey)
  }
}

const participantForContext = (principal: NormalizedPrincipalContext): LivePlayPresenceParticipantSummary => (
  buildLivePlayPresenceParticipantSummary({
    role: principal.role,
    clientId: principal.clientId,
    profileDisplayName: principal.profileDisplayName,
    accentSeed: principal.accentSeed,
  })
)

const parseUpdateOrThrow = (value: unknown): LivePlayPresenceUpdate => {
  const parsed = parseLivePlayPresenceUpdate(value)
  if (!parsed.valid) {
    throw new LivePlayPresenceRegistryError(
      'invalid-presence-update',
      'Presence update failed shared live-play presence validation.',
      parsed.issues,
    )
  }
  return parsed.payload
}

const clonePing = (ping: LivePlayPresencePingPayload | null): LivePlayPresencePingPayload | null => {
  if (ping === null) return null
  return {
    id: ping.id,
    cell: { ...ping.cell },
    ...(ping.label === undefined ? {} : { label: ping.label }),
    createdAt: ping.createdAt,
    expiresAt: ping.expiresAt,
  }
}

const cloneAttentionTarget = (target: LivePlayPresenceAttentionTarget): LivePlayPresenceAttentionTarget => (
  target.kind === 'token'
    ? { kind: 'token', tokenId: target.tokenId }
    : { kind: 'cell', cell: { ...target.cell } }
)

const cloneAttention = (attention: LivePlayPresenceAttentionRequest | null): LivePlayPresenceAttentionRequest | null => {
  if (attention === null) return null
  return {
    id: attention.id,
    target: cloneAttentionTarget(attention.target),
    ...(attention.label === undefined ? {} : { label: attention.label }),
    createdAt: attention.createdAt,
    expiresAt: attention.expiresAt,
  }
}

const cloneIntent = (intent: LivePlayPresenceIntentState): LivePlayPresenceIntentState => ({
  kind: intent.kind,
  ...(intent.sourceTokenId === undefined ? {} : { sourceTokenId: intent.sourceTokenId }),
  ...(intent.candidateCount === undefined ? {} : { candidateCount: intent.candidateCount }),
  ...(intent.targetCount === undefined ? {} : { targetCount: intent.targetCount }),
  ...(intent.cell === undefined ? {} : { cell: { ...intent.cell } }),
  ...(intent.area === undefined ? {} : { area: { ...intent.area } }),
})

const cloneEntry = (entry: LivePlayPresenceEntry): LivePlayPresenceEntry => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: entry.clientSequence,
  selectedTokenId: entry.selectedTokenId,
  hoveredTokenId: entry.hoveredTokenId,
  intent: cloneIntent(entry.intent),
  ping: clonePing(entry.ping),
  attention: cloneAttention(entry.attention),
  participant: { ...entry.participant },
  lastSeenAt: entry.lastSeenAt,
  expiresAt: entry.expiresAt,
})

const entryIsExpired = (entry: LivePlayPresenceEntry, now: number): boolean => entry.expiresAt <= now

const oldestStoredPresence = (presenceMap: PresenceMap): StoredPresenceEntry | null => {
  let oldest: StoredPresenceEntry | null = null
  for (const candidate of presenceMap.values()) {
    if (oldest === null || candidate.entry.lastSeenAt < oldest.entry.lastSeenAt) oldest = candidate
  }
  return oldest
}

const prunePresenceMap = (presenceMap: PresenceMap, now: number): number => {
  let pruned = 0
  for (const [principalKey, stored] of presenceMap.entries()) {
    if (!entryIsExpired(stored.entry, now)) continue
    presenceMap.delete(principalKey)
    pruned += 1
  }
  return pruned
}

const enforceMaxPresenceMapEntries = (presenceMap: PresenceMap, maxEntries: number): void => {
  while (presenceMap.size > maxEntries) {
    const oldest = oldestStoredPresence(presenceMap)
    if (oldest === null) return
    presenceMap.delete(oldest.principalKey)
  }
}

export const createLivePlayPresenceRegistry = (
  options: LivePlayPresenceRegistryOptions = {},
): LivePlayPresenceRegistry => {
  const ttlMs = ttlFromOptions(options.ttlMs)
  const maxEntriesPerMap = maxEntriesFromOptions(options.maxEntriesPerMap)
  const clock = options.now ?? Date.now
  const maps = new Map<string, PresenceMap>()

  const currentTime = (override: number | undefined): number => normalizeNow(override ?? clock())

  const getPresenceMap = (mapSlug: string): PresenceMap => {
    const existing = maps.get(mapSlug)
    if (existing) return existing
    const created: PresenceMap = new Map()
    maps.set(mapSlug, created)
    return created
  }

  const removeEmptyMap = (mapSlug: string, presenceMap: PresenceMap): void => {
    if (presenceMap.size === 0) maps.delete(mapSlug)
  }

  return {
    update(input) {
      const mapSlug = normalizeMapSlug(input.mapSlug)
      const principal = normalizePrincipalContext(input.principal)
      const update = parseUpdateOrThrow(input.update)
      const now = currentTime(input.now)
      const principalKey = principalKeyForContext(principal)
      const principalClientKey = principalClientKeyForContext(principal)
      const presenceMap = getPresenceMap(mapSlug)

      prunePresenceMap(presenceMap, now)
      removeSupersededClientPresence(presenceMap, principalKey, principalClientKey)
      const entry: LivePlayPresenceEntry = {
        ...update,
        participant: participantForContext(principal),
        lastSeenAt: now,
        expiresAt: now + ttlMs,
      }
      presenceMap.set(principalKey, { principalKey, principalClientKey, entry })
      enforceMaxPresenceMapEntries(presenceMap, maxEntriesPerMap)
      return cloneEntry(entry)
    },

    list(input) {
      const mapSlug = normalizeMapSlug(input.mapSlug)
      const presenceMap = maps.get(mapSlug)
      if (!presenceMap) return []

      const now = currentTime(input.now)
      prunePresenceMap(presenceMap, now)
      removeEmptyMap(mapSlug, presenceMap)
      return Array.from(presenceMap.values(), ({ entry }) => cloneEntry(entry))
    },

    remove(input) {
      const mapSlug = normalizeMapSlug(input.mapSlug)
      const presenceMap = maps.get(mapSlug)
      if (!presenceMap) return false

      const principal = normalizePrincipalContext(input.principal)
      const removed = presenceMap.delete(principalKeyForContext(principal))
      removeEmptyMap(mapSlug, presenceMap)
      return removed
    },

    prune(input: LivePlayPresenceRegistryPruneInput = {}) {
      const now = currentTime(input.now)
      let pruned = 0
      for (const [mapSlug, presenceMap] of maps.entries()) {
        pruned += prunePresenceMap(presenceMap, now)
        removeEmptyMap(mapSlug, presenceMap)
      }
      return pruned
    },
  }
}

export const livePlayPresenceRegistry = createLivePlayPresenceRegistry()
