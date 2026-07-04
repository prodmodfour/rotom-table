import type {
  LivePlayPresenceEntry,
  LivePlayPresenceGridCell,
  LivePlayPresenceIntentKind,
  LivePlayPresenceIntentState,
  LivePlayPresenceParticipantSummary,
  LivePlayPresenceUpdate,
} from '#shared/livePlayPresence'
import { livePlayPresenceAccentColor } from '~/utils/livePlayPresenceVisuals'

export type MapPresenceIntentOverlayKind = Extract<
  LivePlayPresenceIntentKind,
  'moving-token' | 'targeting' | 'measuring'
>

export type MapPresenceIntentOverlayAnchor =
  | { readonly kind: 'token'; readonly tokenId: string }
  | { readonly kind: 'cell'; readonly cell: LivePlayPresenceGridCell }

export interface MapPresenceIntentOverlay {
  readonly id: string
  readonly kind: MapPresenceIntentOverlayKind
  readonly label: string
  readonly detail: string
  readonly participantLabel: string
  readonly participant: LivePlayPresenceParticipantSummary
  readonly anchor: MapPresenceIntentOverlayAnchor
  readonly anchorKey: string
  readonly stackIndex: number
  readonly accentColor: `#${string}`
  readonly lastSeenAt: number
  readonly expiresAt: number
}

export interface BuildMapPresenceIntentOverlaysOptions {
  readonly visibleTokenIds?: ReadonlySet<string> | readonly string[] | null
  readonly ownPresence?: Pick<
    LivePlayPresenceUpdate,
    'clientSequence' | 'selectedTokenId' | 'hoveredTokenId' | 'intent' | 'ping'
  > | null
  readonly ownClientIdSuffix?: string | null
  readonly serverNowMs?: number
  readonly staleAfterMs?: number
  readonly maxOverlays?: number
}

const DEFAULT_STALE_AFTER_MS = 12_000
const DEFAULT_MAX_OVERLAYS = 12

const RENDERABLE_INTENT_KIND_SET = new Set<LivePlayPresenceIntentKind>([
  'moving-token',
  'targeting',
  'measuring',
])

const INTENT_LABELS: Readonly<Record<MapPresenceIntentOverlayKind, string>> = {
  'moving-token': 'Moving',
  targeting: 'Targeting',
  measuring: 'Measuring',
}

const FALLBACK_DETAILS: Readonly<Record<MapPresenceIntentOverlayKind, string>> = {
  'moving-token': 'previewing a route',
  targeting: 'choosing an action',
  measuring: 'checking distance',
}

export const isMapPresenceIntentOverlayKind = (
  kind: LivePlayPresenceIntentKind,
): kind is MapPresenceIntentOverlayKind => RENDERABLE_INTENT_KIND_SET.has(kind)

const toVisibleTokenSet = (
  visibleTokenIds: BuildMapPresenceIntentOverlaysOptions['visibleTokenIds'],
): ReadonlySet<string> | null => {
  if (visibleTokenIds === undefined || visibleTokenIds === null) return null
  if (Array.isArray(visibleTokenIds)) {
    const tokenIds = visibleTokenIds as readonly unknown[]
    return new Set(tokenIds.filter((tokenId): tokenId is string => typeof tokenId === 'string'))
  }
  return visibleTokenIds as ReadonlySet<string>
}

const isVisibleTokenId = (tokenId: string | undefined, visibleTokenIds: ReadonlySet<string> | null): tokenId is string => (
  typeof tokenId === 'string'
  && tokenId.length > 0
  && (visibleTokenIds === null || visibleTokenIds.has(tokenId))
)

const gridCellsEqual = (a: LivePlayPresenceGridCell | undefined, b: LivePlayPresenceGridCell | undefined): boolean => (
  a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.z === b.z)
)

const presenceIntentsEqual = (a: LivePlayPresenceIntentState, b: LivePlayPresenceIntentState): boolean => (
  a.kind === b.kind
  && a.sourceTokenId === b.sourceTokenId
  && a.candidateCount === b.candidateCount
  && a.targetCount === b.targetCount
  && gridCellsEqual(a.cell, b.cell)
  && a.area?.cellCount === b.area?.cellCount
)

const pingIdsEqual = (
  a: LivePlayPresenceEntry['ping'],
  b: LivePlayPresenceUpdate['ping'] | undefined,
): boolean => {
  if (a === null || b === null || b === undefined) return a === b
  return a.id === b.id
}

const entryMatchesOwnPresence = (
  entry: LivePlayPresenceEntry,
  ownPresence: BuildMapPresenceIntentOverlaysOptions['ownPresence'],
): boolean => Boolean(
  ownPresence
  && entry.clientSequence === ownPresence.clientSequence
  && entry.selectedTokenId === ownPresence.selectedTokenId
  && entry.hoveredTokenId === ownPresence.hoveredTokenId
  && presenceIntentsEqual(entry.intent, ownPresence.intent)
  && pingIdsEqual(entry.ping, ownPresence.ping),
)

const shouldSuppressEntry = (
  entry: LivePlayPresenceEntry,
  options: Pick<BuildMapPresenceIntentOverlaysOptions, 'ownClientIdSuffix' | 'ownPresence'>,
): boolean => (
  (typeof options.ownClientIdSuffix === 'string'
    && options.ownClientIdSuffix.length > 0
    && entry.participant.clientIdSuffix === options.ownClientIdSuffix)
  || entryMatchesOwnPresence(entry, options.ownPresence)
)

const participantLabel = (participant: LivePlayPresenceParticipantSummary): string => {
  if (participant.profileDisplayName) return participant.profileDisplayName
  return participant.role === 'gm' ? 'GM' : `Player ${participant.clientIdSuffix}`
}

const anchorKey = (anchor: MapPresenceIntentOverlayAnchor): string => (
  anchor.kind === 'token'
    ? `token:${anchor.tokenId}`
    : `cell:${anchor.cell.x}:${anchor.cell.y}:${anchor.cell.z}`
)

const cloneCell = (cell: LivePlayPresenceGridCell): LivePlayPresenceGridCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const resolveIntentAnchor = (
  intent: LivePlayPresenceIntentState,
  visibleTokenIds: ReadonlySet<string> | null,
): MapPresenceIntentOverlayAnchor | null => {
  if (intent.cell) return { kind: 'cell', cell: cloneCell(intent.cell) }
  if (isVisibleTokenId(intent.sourceTokenId, visibleTokenIds)) return { kind: 'token', tokenId: intent.sourceTokenId }
  return null
}

const plural = (count: number, singular: string, pluralLabel = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : pluralLabel}`
)

const intentCountDetails = (intent: LivePlayPresenceIntentState): string[] => {
  const details: string[] = []
  if (intent.targetCount !== undefined) details.push(plural(intent.targetCount, 'target'))
  else if (intent.candidateCount !== undefined) details.push(plural(intent.candidateCount, 'option'))
  if (intent.area?.cellCount !== undefined) details.push(plural(intent.area.cellCount, 'cell'))
  return details
}

const intentDetail = (intent: LivePlayPresenceIntentState, kind: MapPresenceIntentOverlayKind): string => {
  const details = intentCountDetails(intent)
  return details.length > 0 ? details.join(' · ') : FALLBACK_DETAILS[kind]
}

interface UnstackedMapPresenceIntentOverlay extends Omit<MapPresenceIntentOverlay, 'stackIndex'> {}

const overlayId = (
  entry: LivePlayPresenceEntry,
  kind: MapPresenceIntentOverlayKind,
  key: string,
): string => [
  entry.participant.role,
  entry.participant.profileDisplayName ?? 'anonymous',
  entry.participant.clientIdSuffix,
  entry.clientSequence,
  kind,
  key,
].join(':')

const entryIsFresh = (
  entry: LivePlayPresenceEntry,
  serverNowMs: number,
  staleAfterMs: number,
): boolean => (
  entry.expiresAt > serverNowMs
  && Math.max(0, serverNowMs - entry.lastSeenAt) <= staleAfterMs
)

const safePositiveInteger = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
)

export const buildMapPresenceIntentOverlays = (
  entries: readonly LivePlayPresenceEntry[],
  options: BuildMapPresenceIntentOverlaysOptions = {},
): readonly MapPresenceIntentOverlay[] => {
  const visibleTokenIds = toVisibleTokenSet(options.visibleTokenIds)
  const serverNowMs = typeof options.serverNowMs === 'number' && Number.isFinite(options.serverNowMs)
    ? options.serverNowMs
    : Date.now()
  const staleAfterMs = safePositiveInteger(options.staleAfterMs, DEFAULT_STALE_AFTER_MS)
  const maxOverlays = safePositiveInteger(options.maxOverlays, DEFAULT_MAX_OVERLAYS)
  if (maxOverlays === 0) return []

  const overlays: UnstackedMapPresenceIntentOverlay[] = []
  for (const entry of entries) {
    if (!entryIsFresh(entry, serverNowMs, staleAfterMs)) continue
    if (shouldSuppressEntry(entry, options)) continue
    if (!isMapPresenceIntentOverlayKind(entry.intent.kind)) continue

    const anchor = resolveIntentAnchor(entry.intent, visibleTokenIds)
    if (anchor === null) continue

    const key = anchorKey(anchor)
    overlays.push({
      id: overlayId(entry, entry.intent.kind, key),
      kind: entry.intent.kind,
      label: INTENT_LABELS[entry.intent.kind],
      detail: intentDetail(entry.intent, entry.intent.kind),
      participantLabel: participantLabel(entry.participant),
      participant: { ...entry.participant },
      anchor,
      anchorKey: key,
      accentColor: livePlayPresenceAccentColor(entry.participant.accent),
      lastSeenAt: entry.lastSeenAt,
      expiresAt: entry.expiresAt,
    })
  }

  overlays.sort((a, b) => (
    a.anchorKey.localeCompare(b.anchorKey)
    || a.kind.localeCompare(b.kind)
    || a.participantLabel.localeCompare(b.participantLabel)
    || a.participant.clientIdSuffix.localeCompare(b.participant.clientIdSuffix)
    || a.id.localeCompare(b.id)
  ))

  const stackCounts = new Map<string, number>()
  return overlays.slice(0, maxOverlays).map((overlay) => {
    const stackIndex = stackCounts.get(overlay.anchorKey) ?? 0
    stackCounts.set(overlay.anchorKey, stackIndex + 1)
    return { ...overlay, stackIndex }
  })
}
