import { computed, getCurrentScope, onScopeDispose, readonly, ref, type ComputedRef, type DeepReadonly, type Ref } from 'vue'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_DEFAULT_PING_TTL_MS,
  LIVE_PLAY_PRESENCE_MAX_PING_ID_CHARS,
  LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS,
  LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  parseLivePlayPresenceRealtimeEvent,
  parseLivePlayPresenceSnapshot,
  parseLivePlayPresenceUpdate,
  sanitizeLivePlayPresencePingLabel,
  type LivePlayPresenceEntry,
  type LivePlayPresenceGridCell,
  type LivePlayPresenceIntentState,
  type LivePlayPresenceParticipantSummary,
  type LivePlayPresencePingPayload,
  type LivePlayPresenceSnapshot,
  type LivePlayPresenceUpdate,
} from '#shared/livePlayPresence'
import { mapChannel, type RealtimeEvent } from '#shared/realtime'
import { useApiClient } from '~/composables/useApiClient'
import { subscribeChannel } from '~/composables/useRealtime'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'

export type MapPresenceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface MapPresenceTransportFreshness {
  readonly lastSnapshotAt: number | null
  readonly lastHeartbeatAt: number | null
  readonly lastTransientAt: number | null
  readonly lastSuccessfulTransportAt: number | null
  readonly lastErrorAt: number | null
  readonly serverTimeOffsetMs: number
  readonly heartbeatIntervalMs: number
  readonly hidden: boolean
}

export interface MapPresenceOwnStatePatch {
  readonly selectedTokenId?: string | null
  readonly hoveredTokenId?: string | null
  readonly intent?: LivePlayPresenceIntentState
  readonly ping?: LivePlayPresencePingPayload | null
}

export interface MapPresencePlacePingOptions {
  readonly label?: unknown
  readonly ttlMs?: number
  readonly publish?: boolean
}

export interface MapPresencePing {
  readonly id: string
  readonly cell: LivePlayPresenceGridCell
  readonly label?: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly creator: LivePlayPresenceParticipantSummary
}

export type MapPresenceVisibleTokenIds = readonly string[] | ReadonlySet<string>

export interface UseMapPresenceOptions {
  readonly slug: string
  readonly profileId?: ReadonlyValueRef<string | null | undefined>
  readonly enabled?: ReadonlyValueRef<boolean>
  readonly visibleTokenIds?: ReadonlyValueRef<MapPresenceVisibleTokenIds | null | undefined>
  readonly autoStart?: boolean
  readonly heartbeatIntervalMs?: number
  readonly hiddenHeartbeatIntervalMs?: number
  readonly expirySweepIntervalMs?: number
  readonly pingTtlMs?: number
  readonly pingIdFactory?: () => string
  readonly now?: () => number
  readonly document?: MapPresenceDocumentLike | null
}

export interface UseMapPresenceReturn {
  readonly entries: ComputedRef<readonly LivePlayPresenceEntry[]>
  readonly pings: ComputedRef<readonly MapPresencePing[]>
  readonly ownPresence: DeepReadonly<Ref<LivePlayPresenceUpdate>>
  readonly status: Readonly<Ref<MapPresenceStatus>>
  readonly error: Readonly<Ref<string | null>>
  readonly transportFreshness: ComputedRef<MapPresenceTransportFreshness>
  readonly loadSnapshot: () => Promise<void>
  readonly sendHeartbeat: () => Promise<void>
  readonly updateOwnPresence: (patch: MapPresenceOwnStatePatch, options?: { readonly publish?: boolean }) => Promise<boolean>
  readonly placePing: (cell: LivePlayPresenceGridCell, options?: MapPresencePlacePingOptions) => Promise<boolean>
  readonly start: () => void
  readonly stop: () => void
  readonly dispose: () => void
}

interface MapPresenceDocumentLike {
  readonly hidden?: boolean
  readonly visibilityState?: string
  addEventListener?(type: 'visibilitychange', listener: () => void): void
  removeEventListener?(type: 'visibilitychange', listener: () => void): void
}

type TimerHandle = ReturnType<typeof setTimeout>

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000
const DEFAULT_HIDDEN_HEARTBEAT_INTERVAL_MS = 12_000
const DEFAULT_EXPIRY_SWEEP_INTERVAL_MS = 1_000
const CLIENT_ID_MAX_SAFE_CHARS = 64
const PRESENCE_HTTP_CLIENT_ID_PREFIX = 'client_'
const CLIENT_ID_SAFE_CHARS_RE = /[^A-Za-z0-9_-]/g
const PING_ID_RANDOM_BYTES = 4

const defaultPresenceUpdate = (): LivePlayPresenceUpdate => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 0,
  selectedTokenId: null,
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
})

const mapPresenceRoute = (slug: string): string => `/api/maps/${encodeURIComponent(slug)}/presence`

const safeInterval = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
)

const safePingTtlMs = (
  value: number | undefined,
  fallback: number = LIVE_PLAY_PRESENCE_DEFAULT_PING_TTL_MS,
): number => {
  const ttlMs = typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
  return Math.min(ttlMs, LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS)
}

const randomPingIdSegment = (): string => {
  const cryptoObject = globalThis.crypto
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    const bytes = new Uint8Array(PING_ID_RANDOM_BYTES)
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0')
}

const createPresencePingId = (timestamp: number): string => (
  `p${Math.max(0, Math.floor(timestamp)).toString(36)}_${randomPingIdSegment()}`.slice(
    0,
    LIVE_PLAY_PRESENCE_MAX_PING_ID_CHARS,
  )
)

const resolveProfileId = (profileId: ReadonlyValueRef<string | null | undefined> | undefined): string | undefined => {
  const value = profileId?.value
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const normalizePresenceHttpClientId = (clientId: string): string => {
  const sanitized = clientId.replace(CLIENT_ID_SAFE_CHARS_RE, '')
  const padded = sanitized.length >= 8 ? sanitized : `${sanitized}00000000`.slice(0, 8)
  return `${PRESENCE_HTTP_CLIENT_ID_PREFIX}${padded}`.slice(0, CLIENT_ID_MAX_SAFE_CHARS)
}

const clonePresencePingPayload = (ping: LivePlayPresencePingPayload): LivePlayPresencePingPayload => ({
  ...ping,
  cell: { ...ping.cell },
})

const clonePresenceIntentState = (intent: LivePlayPresenceIntentState): LivePlayPresenceIntentState => ({
  kind: intent.kind,
  ...(intent.sourceTokenId === undefined ? {} : { sourceTokenId: intent.sourceTokenId }),
  ...(intent.candidateCount === undefined ? {} : { candidateCount: intent.candidateCount }),
  ...(intent.targetCount === undefined ? {} : { targetCount: intent.targetCount }),
  ...(intent.cell === undefined ? {} : { cell: { ...intent.cell } }),
  ...(intent.area === undefined ? {} : { area: { ...intent.area } }),
})

const clonePresenceEntry = (entry: LivePlayPresenceEntry): LivePlayPresenceEntry => ({
  schemaVersion: entry.schemaVersion,
  authority: entry.authority,
  clientSequence: entry.clientSequence,
  selectedTokenId: entry.selectedTokenId,
  hoveredTokenId: entry.hoveredTokenId,
  intent: clonePresenceIntentState(entry.intent),
  ping: entry.ping === null ? null : clonePresencePingPayload(entry.ping),
  participant: { ...entry.participant },
  lastSeenAt: entry.lastSeenAt,
  expiresAt: entry.expiresAt,
})

const clonePresenceEntries = (entries: readonly LivePlayPresenceEntry[]): readonly LivePlayPresenceEntry[] => (
  entries.map(clonePresenceEntry)
)

const clonePresencePing = (entry: LivePlayPresenceEntry, ping: LivePlayPresencePingPayload): MapPresencePing => ({
  ...clonePresencePingPayload(ping),
  creator: { ...entry.participant },
})

const firstPresenceIssueMessage = (issues: readonly { readonly message: string }[], fallback: string): string => (
  issues[0]?.message ?? fallback
)

const documentIsHidden = (documentRef: MapPresenceDocumentLike | null): boolean => (
  documentRef?.hidden === true || documentRef?.visibilityState === 'hidden'
)

const browserDocument = (): MapPresenceDocumentLike | null => (
  typeof document === 'undefined' ? null : document
)

const isReadonlySetLike = (value: MapPresenceVisibleTokenIds): value is ReadonlySet<string> => (
  typeof (value as { readonly has?: unknown }).has === 'function'
)

const visibleTokenIdSetFromSource = (
  source: MapPresenceVisibleTokenIds | null | undefined,
): ReadonlySet<string> | null => {
  if (source === undefined || source === null) return null
  if (isReadonlySetLike(source)) return source
  return new Set(source.filter((tokenId): tokenId is string => typeof tokenId === 'string'))
}

export const useMapPresence = (options: UseMapPresenceOptions): UseMapPresenceReturn => {
  const heartbeatIntervalMs = safeInterval(options.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS)
  const hiddenHeartbeatIntervalMs = safeInterval(options.hiddenHeartbeatIntervalMs, DEFAULT_HIDDEN_HEARTBEAT_INTERVAL_MS)
  const expirySweepIntervalMs = safeInterval(options.expirySweepIntervalMs, DEFAULT_EXPIRY_SWEEP_INTERVAL_MS)
  const defaultPingTtlMs = safePingTtlMs(options.pingTtlMs)
  const now = options.now ?? Date.now
  const apiClient = useApiClient()
  const presencePath = mapPresenceRoute(options.slug)
  const httpClientId = normalizePresenceHttpClientId(getClientId())
  const documentRef = options.document === undefined ? browserDocument() : options.document

  const storedEntries = ref<readonly LivePlayPresenceEntry[]>([])
  const ownPresenceState = ref<LivePlayPresenceUpdate>(defaultPresenceUpdate())
  const status = ref<MapPresenceStatus>('idle')
  const error = ref<string | null>(null)
  const lastSnapshotAt = ref<number | null>(null)
  const lastHeartbeatAt = ref<number | null>(null)
  const lastTransientAt = ref<number | null>(null)
  const lastSuccessfulTransportAt = ref<number | null>(null)
  const lastErrorAt = ref<number | null>(null)
  const serverTimeOffsetMs = ref(0)
  const hidden = ref(documentIsHidden(documentRef))
  const expiryClockTick = ref(0)

  let heartbeatTimer: TimerHandle | null = null
  let expiryTimer: TimerHandle | null = null
  let active = false
  let disposed = false
  let heartbeatInFlight: Promise<void> | null = null
  let unsubscribeRealtime: (() => void) | null = null
  let visibilityListenerAttached = false

  const enabled = (): boolean => options.enabled?.value !== false
  const localServerNow = (): number => now() + serverTimeOffsetMs.value
  const visibleTokenIds = (): ReadonlySet<string> | null => visibleTokenIdSetFromSource(options.visibleTokenIds?.value)
  const sanitizeOwnPresenceTokenId = (tokenId: string | null | undefined): string | null => {
    if (!tokenId) return null
    const visibleIds = visibleTokenIds()
    return visibleIds === null || visibleIds.has(tokenId) ? tokenId : null
  }
  const sanitizeOwnPresenceIntent = (intent: LivePlayPresenceIntentState): LivePlayPresenceIntentState => {
    if (intent.sourceTokenId === undefined) return intent
    const sourceTokenId = sanitizeOwnPresenceTokenId(intent.sourceTokenId)
    if (sourceTokenId === intent.sourceTokenId) return intent
    return {
      kind: intent.kind,
      ...(intent.candidateCount === undefined ? {} : { candidateCount: intent.candidateCount }),
      ...(intent.targetCount === undefined ? {} : { targetCount: intent.targetCount }),
      ...(intent.cell === undefined ? {} : { cell: { ...intent.cell } }),
      ...(intent.area === undefined ? {} : { area: { ...intent.area } }),
    }
  }
  const sanitizeOwnPresenceTokens = (
    presence: LivePlayPresenceUpdate,
    sanitizeOptions: { readonly incrementSequenceOnChange: boolean },
  ): LivePlayPresenceUpdate => {
    const selectedTokenId = sanitizeOwnPresenceTokenId(presence.selectedTokenId)
    const hoveredTokenId = sanitizeOwnPresenceTokenId(presence.hoveredTokenId)
    const intent = sanitizeOwnPresenceIntent(presence.intent)
    if (
      selectedTokenId === presence.selectedTokenId
      && hoveredTokenId === presence.hoveredTokenId
      && intent === presence.intent
    ) return presence
    return {
      ...presence,
      selectedTokenId,
      hoveredTokenId,
      intent,
      clientSequence: presence.clientSequence + (sanitizeOptions.incrementSequenceOnChange ? 1 : 0),
    }
  }

  const visibleEntries = computed<readonly LivePlayPresenceEntry[]>(() => {
    expiryClockTick.value
    return clonePresenceEntries(storedEntries.value)
  })
  const activePings = computed<readonly MapPresencePing[]>(() => {
    expiryClockTick.value
    const serverNow = localServerNow()
    return storedEntries.value
      .filter((entry) => entry.ping !== null && entry.ping.expiresAt > serverNow)
      .map((entry) => clonePresencePing(entry, entry.ping!))
  })
  const transportFreshness = computed<MapPresenceTransportFreshness>(() => ({
    lastSnapshotAt: lastSnapshotAt.value,
    lastHeartbeatAt: lastHeartbeatAt.value,
    lastTransientAt: lastTransientAt.value,
    lastSuccessfulTransportAt: lastSuccessfulTransportAt.value,
    lastErrorAt: lastErrorAt.value,
    serverTimeOffsetMs: serverTimeOffsetMs.value,
    heartbeatIntervalMs: hidden.value ? hiddenHeartbeatIntervalMs : heartbeatIntervalMs,
    hidden: hidden.value,
  }))

  const clearHeartbeatTimer = (): void => {
    if (heartbeatTimer === null) return
    clearTimeout(heartbeatTimer)
    heartbeatTimer = null
  }

  const clearExpiryTimer = (): void => {
    if (expiryTimer === null) return
    clearTimeout(expiryTimer)
    expiryTimer = null
  }

  const expireEntryPing = (entry: LivePlayPresenceEntry, serverNow: number): LivePlayPresenceEntry | null => {
    if (entry.expiresAt <= serverNow) return null
    if (entry.ping === null || entry.ping.expiresAt > serverNow) return entry
    return { ...entry, ping: null }
  }

  const clearExpiredOwnPing = (serverNow: number): void => {
    const ownPing = ownPresenceState.value.ping
    if (ownPing === null || ownPing.expiresAt > serverNow) return
    ownPresenceState.value = {
      ...ownPresenceState.value,
      ping: null,
      intent: ownPresenceState.value.intent.kind === 'placing-ping'
        ? { kind: 'idle' }
        : ownPresenceState.value.intent,
      clientSequence: ownPresenceState.value.clientSequence + 1,
    }
  }

  const pruneExpiredEntries = (): void => {
    const serverNow = localServerNow()
    clearExpiredOwnPing(serverNow)
    expiryClockTick.value += 1

    const nextEntries: LivePlayPresenceEntry[] = []
    let changed = false
    for (const entry of storedEntries.value) {
      const nextEntry = expireEntryPing(entry, serverNow)
      if (nextEntry === null) {
        changed = true
        continue
      }
      if (nextEntry !== entry) changed = true
      nextEntries.push(nextEntry)
    }
    if (changed) storedEntries.value = nextEntries
  }

  const scheduleExpirySweep = (): void => {
    clearExpiryTimer()
    if (!active || disposed) return
    expiryTimer = setTimeout(() => {
      expiryTimer = null
      pruneExpiredEntries()
      scheduleExpirySweep()
    }, expirySweepIntervalMs)
  }

  const markTransportSuccess = (observedAt: number): void => {
    lastSuccessfulTransportAt.value = observedAt
    error.value = null
    status.value = 'ready'
  }

  const markTransportError = (err: unknown, fallback: string): void => {
    error.value = getErrorMessage(err, { fallback })
    lastErrorAt.value = now()
    status.value = 'error'
  }

  const applyPresenceSnapshot = (
    snapshot: LivePlayPresenceSnapshot,
    source: 'snapshot' | 'heartbeat' | 'transient',
    observedAt: number,
  ): boolean => {
    if (snapshot.mapSlug !== options.slug) return false
    serverTimeOffsetMs.value = snapshot.serverTime - observedAt
    storedEntries.value = snapshot.entries
      .filter((entry) => entry.expiresAt > snapshot.serverTime)
      .map(clonePresenceEntry)
    pruneExpiredEntries()

    if (source === 'snapshot') lastSnapshotAt.value = observedAt
    else if (source === 'heartbeat') lastHeartbeatAt.value = observedAt
    else lastTransientAt.value = observedAt
    markTransportSuccess(observedAt)
    return true
  }

  const parseAndApplyPresenceSnapshot = (
    value: unknown,
    source: 'snapshot' | 'heartbeat' | 'transient',
    fallback: string,
  ): boolean => {
    const parsed = parseLivePlayPresenceSnapshot(value)
    if (!parsed.valid) {
      markTransportError(
        new Error(firstPresenceIssueMessage(parsed.issues, fallback)),
        fallback,
      )
      return false
    }
    return applyPresenceSnapshot(parsed.payload, source, now())
  }

  const loadSnapshot = async (): Promise<void> => {
    if (!enabled()) return
    status.value = status.value === 'ready' ? 'ready' : 'loading'
    try {
      const profileId = resolveProfileId(options.profileId)
      const snapshot = await apiClient.getJson<LivePlayPresenceSnapshot>(presencePath, {
        ...(profileId === undefined ? {} : { params: { profileId } }),
      })
      parseAndApplyPresenceSnapshot(snapshot, 'snapshot', 'Presence snapshot could not be loaded')
    } catch (err) {
      markTransportError(err, 'Presence snapshot could not be loaded')
    }
  }

  const validatedOwnPresence = (): LivePlayPresenceUpdate | null => {
    pruneExpiredEntries()
    const sanitizedPresence = sanitizeOwnPresenceTokens(ownPresenceState.value, { incrementSequenceOnChange: true })
    if (sanitizedPresence !== ownPresenceState.value) ownPresenceState.value = sanitizedPresence
    const parsed = parseLivePlayPresenceUpdate(sanitizedPresence)
    if (!parsed.valid) {
      markTransportError(
        new Error(firstPresenceIssueMessage(parsed.issues, 'Own presence state is invalid')),
        'Own presence state is invalid',
      )
      return null
    }
    return parsed.payload
  }

  const heartbeatBody = (presence: LivePlayPresenceUpdate): Record<string, unknown> => {
    const profileId = resolveProfileId(options.profileId)
    return {
      presence,
      clientId: httpClientId,
      ...(profileId === undefined ? {} : { profileId }),
    }
  }

  const sendHeartbeat = async (): Promise<void> => {
    if (!enabled()) return
    if (heartbeatInFlight !== null) return heartbeatInFlight

    const presence = validatedOwnPresence()
    if (presence === null) return

    heartbeatInFlight = (async () => {
      try {
        const snapshot = await apiClient.postJson<LivePlayPresenceSnapshot>(presencePath, heartbeatBody(presence))
        parseAndApplyPresenceSnapshot(snapshot, 'heartbeat', 'Presence heartbeat could not be sent')
      } catch (err) {
        markTransportError(err, 'Presence heartbeat could not be sent')
      } finally {
        heartbeatInFlight = null
      }
    })()

    return heartbeatInFlight
  }

  const scheduleHeartbeat = (): void => {
    clearHeartbeatTimer()
    if (!active || disposed) return
    if (!enabled()) return

    const delay = hidden.value ? hiddenHeartbeatIntervalMs : heartbeatIntervalMs
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null
      void sendHeartbeat().finally(scheduleHeartbeat)
    }, delay)
  }

  const handleVisibilityChange = (): void => {
    hidden.value = documentIsHidden(documentRef)
    if (active) scheduleHeartbeat()
  }

  const attachVisibilityListener = (): void => {
    if (visibilityListenerAttached || !documentRef?.addEventListener) return
    documentRef.addEventListener('visibilitychange', handleVisibilityChange)
    visibilityListenerAttached = true
  }

  const detachVisibilityListener = (): void => {
    if (!visibilityListenerAttached || !documentRef?.removeEventListener) return
    documentRef.removeEventListener('visibilitychange', handleVisibilityChange)
    visibilityListenerAttached = false
  }

  const handleRealtimeEvent = (event: RealtimeEvent): void => {
    if (event.type !== LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE) return
    const parsed = parseLivePlayPresenceRealtimeEvent(event)
    if (!parsed.valid) return
    if (parsed.payload.mapSlug !== options.slug) return
    parseAndApplyPresenceSnapshot(
      parsed.payload.data,
      'transient',
      'Presence realtime update could not be applied',
    )
  }

  const subscribeRealtime = (): void => {
    if (unsubscribeRealtime !== null) return
    unsubscribeRealtime = subscribeChannel(mapChannel(options.slug), handleRealtimeEvent)
  }

  const unsubscribeRealtimeChannel = (): void => {
    if (unsubscribeRealtime === null) return
    unsubscribeRealtime()
    unsubscribeRealtime = null
  }

  const start = (): void => {
    if (disposed || active) return
    active = true
    hidden.value = documentIsHidden(documentRef)
    attachVisibilityListener()
    subscribeRealtime()
    scheduleHeartbeat()
    scheduleExpirySweep()
    void loadSnapshot()
    void sendHeartbeat()
  }

  const stop = (): void => {
    active = false
    clearHeartbeatTimer()
    clearExpiryTimer()
  }

  const dispose = (): void => {
    if (disposed) return
    stop()
    disposed = true
    detachVisibilityListener()
    unsubscribeRealtimeChannel()
  }

  const buildPresencePingPayload = (
    cell: LivePlayPresenceGridCell,
    pingOptions: MapPresencePlacePingOptions,
  ): LivePlayPresencePingPayload => {
    const createdAt = Math.max(0, Math.floor(localServerNow()))
    const ttlMs = safePingTtlMs(pingOptions.ttlMs, defaultPingTtlMs)
    const label = sanitizeLivePlayPresencePingLabel(pingOptions.label)
    return {
      id: options.pingIdFactory?.() ?? createPresencePingId(createdAt),
      cell: { x: cell.x, y: cell.y, z: cell.z },
      ...(label === undefined ? {} : { label }),
      createdAt,
      expiresAt: createdAt + ttlMs,
    }
  }

  const updateOwnPresence = async (
    patch: MapPresenceOwnStatePatch,
    updateOptions: { readonly publish?: boolean } = {},
  ): Promise<boolean> => {
    pruneExpiredEntries()
    const candidate: LivePlayPresenceUpdate = sanitizeOwnPresenceTokens({
      ...ownPresenceState.value,
      ...(Object.prototype.hasOwnProperty.call(patch, 'selectedTokenId') ? { selectedTokenId: patch.selectedTokenId ?? null } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'hoveredTokenId') ? { hoveredTokenId: patch.hoveredTokenId ?? null } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'intent') && patch.intent ? { intent: { ...patch.intent } } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'ping') ? { ping: patch.ping ?? null } : {}),
      clientSequence: ownPresenceState.value.clientSequence + 1,
    }, { incrementSequenceOnChange: false })
    const parsed = parseLivePlayPresenceUpdate(candidate)
    if (!parsed.valid) {
      markTransportError(
        new Error(firstPresenceIssueMessage(parsed.issues, 'Own presence update is invalid')),
        'Own presence update is invalid',
      )
      return false
    }

    ownPresenceState.value = parsed.payload
    if (updateOptions.publish !== false) await sendHeartbeat()
    return true
  }

  const placePing = async (
    cell: LivePlayPresenceGridCell,
    pingOptions: MapPresencePlacePingOptions = {},
  ): Promise<boolean> => {
    if (!enabled()) return false
    return updateOwnPresence(
      {
        ping: buildPresencePingPayload(cell, pingOptions),
        intent: { kind: 'placing-ping' },
      },
      { publish: pingOptions.publish },
    )
  }

  if (options.autoStart !== false && documentRef !== null) start()
  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    entries: visibleEntries,
    pings: activePings,
    ownPresence: readonly(ownPresenceState),
    status: readonly(status),
    error: readonly(error),
    transportFreshness,
    loadSnapshot,
    sendHeartbeat,
    updateOwnPresence,
    placePing,
    start,
    stop,
    dispose,
  }
}
