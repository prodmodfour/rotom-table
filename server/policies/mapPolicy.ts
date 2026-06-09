import type { AuthRole } from '#shared/auth'
import type { GridAnchor, GridDimensions, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import { COMBAT_LOG_METADATA_KEYS } from '~/utils/combatLog'
import {
  isTokenFacingDirection,
  legacyTokenFacingFromTurned,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'

export type SheetAccessPredicate = (kind: SheetKind, slug: string) => boolean

const PLAYER_COMBAT_LOG_MAX_ENTRIES = 100
const PLAYER_COMBAT_LOG_MAX_NEW_ENTRIES_PER_SAVE = 10
const PLAYER_COMBAT_LOG_MAX_ENTRY_BYTES = 8 * 1024
const PLAYER_COMBAT_LOG_MAX_LINES = 40
const PLAYER_COMBAT_LOG_MAX_LINE_LENGTH = 1000

type PlayerCombatLogMetadataKey = (typeof COMBAT_LOG_METADATA_KEYS)[number]

export const canSaveMap = (role: AuthRole, existing: TabletopMap): boolean =>
  role === 'gm' || existing.playerVisible === true

export const clampAnchorToDimensions = (
  value: unknown,
  fallback: GridAnchor,
  dimensions: GridDimensions,
): GridAnchor => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof GridAnchor, unknown>>
    : {}

  const clampAxis = (axis: keyof GridAnchor, max: number): number => {
    const n = Number(record[axis])
    if (!Number.isFinite(n)) return fallback[axis]
    return Math.min(Math.max(0, Math.floor(max) - 1), Math.max(0, Math.round(n)))
  }

  return {
    x: clampAxis('x', dimensions.x ?? 1),
    y: clampAxis('y', dimensions.y ?? 1),
    z: clampAxis('z', dimensions.z ?? 1),
  }
}

const mergedPlacementFacing = (current: SheetPlacement, next: SheetPlacement) => {
  if (isTokenFacingDirection(next.facing)) return next.facing
  if (typeof next.turned === 'boolean') return legacyTokenFacingFromTurned(next.turned)
  return tokenFacingForPlacement(current)
}

export const mergePlayerPlacementEdits = (
  existing: TabletopMap,
  incoming: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): SheetPlacement[] => {
  const incomingById = new Map(
    (Array.isArray(incoming.placements) ? incoming.placements : []).map((placement) => [placement.id, placement]),
  )

  return (existing.placements ?? []).map((placement) => {
    if (!canControlSheet(placement.sheetKind, placement.sheetSlug)) return placement

    const next = incomingById.get(placement.id)
    if (!next || next.sheetKind !== placement.sheetKind || next.sheetSlug !== placement.sheetSlug) return placement

    const facing = mergedPlacementFacing(placement, next)

    return {
      ...placement,
      position: clampAnchorToDimensions(next.position, placement.position, existing.dimensions),
      facing,
      turned: tokenFacingStoresLegacyTurned(facing),
    }
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const metadataRecord = (value: unknown): Record<string, unknown> | undefined => (
  isRecord(value) ? value : undefined
)

const metadataArray = (
  metadata: Record<string, unknown> | undefined,
  key: PlayerCombatLogMetadataKey,
): unknown[] => {
  const value = metadata?.[key]
  return Array.isArray(value) ? value : []
}

const jsonSignature = (value: unknown): string | null => {
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : null
  } catch {
    return null
  }
}

const jsonSizeBytes = (value: unknown): number => {
  const json = jsonSignature(value)
  return json === null ? Number.POSITIVE_INFINITY : Buffer.byteLength(json, 'utf8')
}

const hasDisplayableLogLines = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length > 0
  && value.length <= PLAYER_COMBAT_LOG_MAX_LINES
  && value.every((line) => typeof line === 'string' && line.trim().length > 0 && line.length <= PLAYER_COMBAT_LOG_MAX_LINE_LENGTH)
)

const playerCanAppendCombatLogEntry = (
  entry: unknown,
  controlledPlacementIds: ReadonlySet<string>,
): entry is Record<string, unknown> => {
  if (!isRecord(entry)) return false
  if (typeof entry.userId !== 'string' || !controlledPlacementIds.has(entry.userId)) return false
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at) || entry.at < 0) return false
  if (!hasDisplayableLogLines(entry.lines)) return false
  return jsonSizeBytes(entry) <= PLAYER_COMBAT_LOG_MAX_ENTRY_BYTES
}

const controlledPlayerPlacementIds = (
  existing: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): ReadonlySet<string> => new Set(
  (existing.placements ?? [])
    .filter((placement) => canControlSheet(placement.sheetKind, placement.sheetSlug))
    .map((placement) => placement.id),
)

const mergeCombatLogEntriesForKey = (
  existingMetadata: Record<string, unknown> | undefined,
  incomingMetadata: Record<string, unknown>,
  key: PlayerCombatLogMetadataKey,
  controlledPlacementIds: ReadonlySet<string>,
): { entries: unknown[]; changed: boolean } => {
  const existingEntries = metadataArray(existingMetadata, key)
  const existingSignatures = new Set(
    existingEntries
      .map(jsonSignature)
      .filter((signature): signature is string => signature !== null),
  )
  const acceptedEntries: unknown[] = []

  for (const entry of metadataArray(incomingMetadata, key)) {
    if (acceptedEntries.length >= PLAYER_COMBAT_LOG_MAX_NEW_ENTRIES_PER_SAVE) break
    if (!playerCanAppendCombatLogEntry(entry, controlledPlacementIds)) continue

    const signature = jsonSignature(entry)
    if (signature === null || existingSignatures.has(signature)) continue

    existingSignatures.add(signature)
    acceptedEntries.push(entry)
  }

  if (acceptedEntries.length === 0) return { entries: existingEntries, changed: false }
  return {
    entries: [...existingEntries, ...acceptedEntries].slice(-PLAYER_COMBAT_LOG_MAX_ENTRIES),
    changed: true,
  }
}

export const mergePlayerCombatLogMetadata = (
  existing: TabletopMap,
  incoming: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): Record<string, unknown> | undefined => {
  const incomingMetadata = metadataRecord(incoming.metadata)
  if (!incomingMetadata) return existing.metadata

  const controlledPlacementIds = controlledPlayerPlacementIds(existing, canControlSheet)
  if (controlledPlacementIds.size === 0) return existing.metadata

  const existingMetadata = metadataRecord(existing.metadata)
  let changed = false
  const nextMetadata: Record<string, unknown> = { ...(existingMetadata ?? {}) }

  for (const key of COMBAT_LOG_METADATA_KEYS) {
    const result = mergeCombatLogEntriesForKey(existingMetadata, incomingMetadata, key, controlledPlacementIds)
    if (!result.changed) continue
    nextMetadata[key] = result.entries
    changed = true
  }

  return changed ? nextMetadata : existing.metadata
}

export const applyPlayerMapSavePolicy = (
  existing: TabletopMap,
  incoming: TabletopMap,
  canControlSheet: SheetAccessPredicate,
): TabletopMap => {
  const next: TabletopMap = {
    ...existing,
    placements: mergePlayerPlacementEdits(existing, incoming, canControlSheet),
  }
  const metadata = mergePlayerCombatLogMetadata(existing, incoming, canControlSheet)
  if (metadata === undefined) delete next.metadata
  else next.metadata = metadata
  return next
}
