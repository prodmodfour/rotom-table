import type { LivePlayPresenceAccent, LivePlayPresenceEntry } from '#shared/livePlayPresence'
import { livePlayPresenceAccentColor } from '~/utils/livePlayPresenceVisuals'

export type MapTokenRemoteAttentionKind = 'selected' | 'hovered'

export interface MapTokenRemoteAttention {
  readonly tokenId: string
  readonly selectedCount: number
  readonly hoveredCount: number
  readonly totalCount: number
  readonly accents: readonly LivePlayPresenceAccent[]
  readonly primaryAccent: LivePlayPresenceAccent
  readonly primaryColor: `#${string}`
}

interface MutableTokenAttentionBucket {
  readonly tokenId: string
  readonly selectedParticipantKeys: Set<string>
  readonly hoveredParticipantKeys: Set<string>
  readonly participantKeys: Set<string>
  readonly accents: LivePlayPresenceAccent[]
}

const participantKeyForPresenceEntry = (entry: LivePlayPresenceEntry): string => [
  entry.participant.role,
  entry.participant.profileDisplayName ?? 'anonymous',
  entry.participant.clientIdSuffix,
].join(':')

const ensureTokenAttentionBucket = (
  buckets: Map<string, MutableTokenAttentionBucket>,
  tokenId: string,
): MutableTokenAttentionBucket => {
  const existing = buckets.get(tokenId)
  if (existing) return existing

  const bucket: MutableTokenAttentionBucket = {
    tokenId,
    selectedParticipantKeys: new Set(),
    hoveredParticipantKeys: new Set(),
    participantKeys: new Set(),
    accents: [],
  }
  buckets.set(tokenId, bucket)
  return bucket
}

const addPresenceAttention = (
  buckets: Map<string, MutableTokenAttentionBucket>,
  entry: LivePlayPresenceEntry,
  tokenId: string | null,
  kind: MapTokenRemoteAttentionKind,
  visibleTokenIds: ReadonlySet<string> | null,
): void => {
  if (!tokenId) return
  if (visibleTokenIds && !visibleTokenIds.has(tokenId)) return

  const bucket = ensureTokenAttentionBucket(buckets, tokenId)
  const participantKey = participantKeyForPresenceEntry(entry)
  bucket.participantKeys.add(participantKey)

  if (kind === 'selected') bucket.selectedParticipantKeys.add(participantKey)
  else bucket.hoveredParticipantKeys.add(participantKey)

  if (!bucket.accents.includes(entry.participant.accent)) {
    bucket.accents.push(entry.participant.accent)
  }
}

const toTokenAttention = (bucket: MutableTokenAttentionBucket): MapTokenRemoteAttention | null => {
  const primaryAccent = bucket.accents[0]
  if (!primaryAccent) return null

  return {
    tokenId: bucket.tokenId,
    selectedCount: bucket.selectedParticipantKeys.size,
    hoveredCount: bucket.hoveredParticipantKeys.size,
    totalCount: bucket.participantKeys.size,
    accents: [...bucket.accents],
    primaryAccent,
    primaryColor: livePlayPresenceAccentColor(primaryAccent),
  }
}

export const buildMapTokenRemoteAttention = (
  entries: readonly LivePlayPresenceEntry[],
  visibleTokenIds: ReadonlySet<string> | null = null,
): readonly MapTokenRemoteAttention[] => {
  const buckets = new Map<string, MutableTokenAttentionBucket>()

  for (const entry of entries) {
    addPresenceAttention(buckets, entry, entry.selectedTokenId, 'selected', visibleTokenIds)
    addPresenceAttention(buckets, entry, entry.hoveredTokenId, 'hovered', visibleTokenIds)
  }

  return Array.from(buckets.values())
    .map(toTokenAttention)
    .filter((attention): attention is MapTokenRemoteAttention => attention !== null && attention.totalCount > 0)
    .sort((a, b) => a.tokenId.localeCompare(b.tokenId))
}
