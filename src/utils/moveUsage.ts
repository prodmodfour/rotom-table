import type {
  MapMoveUsageEntry,
  MapMoveUsageSceneAnchor,
  MapMoveUsageState,
  MapTrackedMoveFrequency,
  SheetDailyMoveUsageEntry,
  SheetMoveUsageState,
} from '~/types/moveUsage'

export type MoveFrequencyKind =
  | 'at-will'
  | 'eot'
  | 'scene'
  | 'daily'
  | 'static'
  | 'see-text'
  | 'unknown'

export interface ParsedMoveFrequency {
  raw: string
  kind: MoveFrequencyKind
  /** For Scene/Daily frequencies, the number of uses available per period. */
  usesPerPeriod: number | null
}

export interface MoveUsageLimitState {
  uses: number
  maxUses: number
  remainingUses: number
  available: boolean
}

export interface EotMoveUsageState {
  uses: number
  lastUsedRound: number | null
  nextAvailableRound: number | null
  available: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const finiteInteger = (value: unknown): number | null => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

const nonNegativeInteger = (value: unknown): number => {
  const n = finiteInteger(value)
  return n == null ? 0 : Math.max(0, n)
}

const positiveRound = (value: unknown): number | null => {
  const n = finiteInteger(value)
  return n == null || n < 1 ? null : n
}

const optionalTimestamp = (value: unknown): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const normalizedFrequencyText = (value: unknown): string =>
  String(value ?? '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

export const moveUsageKey = (moveName: string): string =>
  moveName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const parseMoveFrequency = (value: unknown): ParsedMoveFrequency => {
  const raw = normalizedFrequencyText(value)
  const lower = raw.toLowerCase()
  const multiplier = /(?:^|\s)x\s*(\d+)\b/i.exec(raw)?.[1]
  const usesPerPeriod = multiplier ? Math.max(1, Number.parseInt(multiplier, 10)) : 1

  if (/^at\s*-?\s*will\b/.test(lower)) return { raw, kind: 'at-will', usesPerPeriod: null }
  if (/^eot\b/.test(lower)) return { raw, kind: 'eot', usesPerPeriod: 1 }
  if (/^scene\b/.test(lower)) return { raw, kind: 'scene', usesPerPeriod }
  if (/^daily\b/.test(lower)) return { raw, kind: 'daily', usesPerPeriod }
  if (/^static\b/.test(lower)) return { raw, kind: 'static', usesPerPeriod: null }
  if (/^see\s+text\b/.test(lower)) return { raw, kind: 'see-text', usesPerPeriod: null }
  return { raw, kind: 'unknown', usesPerPeriod: null }
}

export const moveFrequencyTracksOnMap = (frequency: ParsedMoveFrequency): frequency is ParsedMoveFrequency & { kind: MapTrackedMoveFrequency } =>
  frequency.kind === 'eot' || frequency.kind === 'scene' || frequency.kind === 'daily'

export const moveFrequencyTracksOnSheet = (frequency: ParsedMoveFrequency): boolean =>
  frequency.kind === 'daily'

export const normalizeMoveUsageRound = positiveRound

const normalizeMapMoveUsageScene = (value: unknown): MapMoveUsageSceneAnchor | null => {
  if (!isRecord(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!name) return null
  const startedAt = optionalTimestamp(value.startedAt)
  return {
    name,
    ...(startedAt === undefined ? {} : { startedAt }),
  }
}

export const mapMoveUsageSceneMatches = (
  usage: Pick<MapMoveUsageState, 'scene'> | null | undefined,
  scene: unknown,
): boolean => {
  const left = normalizeMapMoveUsageScene(usage?.scene)
  const right = normalizeMapMoveUsageScene(scene)
  if (!left || !right) return left === null && right === null
  return left.name === right.name && left.startedAt === right.startedAt
}

const normalizeMapMoveUsageEntry = (value: unknown): MapMoveUsageEntry | null => {
  if (!isRecord(value)) return null
  const frequency = value.frequency === 'eot' || value.frequency === 'scene' || value.frequency === 'daily'
    ? value.frequency
    : null
  const moveName = typeof value.moveName === 'string' ? value.moveName.trim() : ''
  const uses = nonNegativeInteger(value.uses)
  if (!frequency || !moveName || uses < 1) return null

  const entry: MapMoveUsageEntry = {
    moveName,
    frequency,
    uses,
  }
  const lastUsedRound = positiveRound(value.lastUsedRound)
  if (lastUsedRound != null) entry.lastUsedRound = lastUsedRound
  else if (value.lastUsedRound === null) entry.lastUsedRound = null
  const updatedAt = optionalTimestamp(value.updatedAt)
  if (updatedAt !== undefined) entry.updatedAt = updatedAt
  return entry
}

export const normalizeMapMoveUsage = (value: unknown): MapMoveUsageState | undefined => {
  if (!isRecord(value) || !isRecord(value.byPlacementId)) return undefined

  const byPlacementId: MapMoveUsageState['byPlacementId'] = {}
  for (const [placementId, rawMoves] of Object.entries(value.byPlacementId)) {
    if (!placementId || !isRecord(rawMoves)) continue
    const moves: Record<string, MapMoveUsageEntry> = {}
    for (const [rawMoveKey, rawEntry] of Object.entries(rawMoves)) {
      const moveKey = moveUsageKey(rawMoveKey) || rawMoveKey.trim()
      if (!moveKey) continue
      const entry = normalizeMapMoveUsageEntry(rawEntry)
      if (entry) moves[moveKey] = entry
    }
    if (Object.keys(moves).length) byPlacementId[placementId] = moves
  }

  const scene = normalizeMapMoveUsageScene(value.scene)
  return Object.keys(byPlacementId).length
    ? {
        ...(scene === null ? {} : { scene }),
        byPlacementId,
      }
    : undefined
}

export const getMapMoveUsageEntry = (
  usage: MapMoveUsageState | undefined,
  placementId: string,
  moveKey: string,
  scene?: unknown,
): MapMoveUsageEntry | null => {
  const normalized = normalizeMapMoveUsage(usage)
  if (!normalized || !mapMoveUsageSceneMatches(normalized, scene)) return null
  return normalized.byPlacementId[placementId]?.[moveKey] ?? null
}

const cloneMapMoveUsage = (usage: MapMoveUsageState | undefined): MapMoveUsageState => ({
  ...(usage?.scene === undefined ? {} : { scene: { ...usage.scene } }),
  byPlacementId: Object.fromEntries(
    Object.entries(usage?.byPlacementId ?? {}).map(([placementId, moves]) => [placementId, { ...moves }]),
  ),
})

export interface RecordMapMoveUsageInput {
  usage: MapMoveUsageState | undefined
  placementId: string
  moveKey: string
  moveName: string
  frequency: MapTrackedMoveFrequency
  currentRound?: number | null
  usedAt?: number
  scene?: unknown
}

export const recordMapMoveUsage = ({
  usage,
  placementId,
  moveKey,
  moveName,
  frequency,
  currentRound,
  usedAt,
  scene,
}: RecordMapMoveUsageInput): MapMoveUsageState => {
  const sceneAnchor = normalizeMapMoveUsageScene(scene)
  const normalized = normalizeMapMoveUsage(usage)
  const base = normalized && mapMoveUsageSceneMatches(normalized, sceneAnchor) ? normalized : { byPlacementId: {} }
  const next = cloneMapMoveUsage(base)
  if (sceneAnchor) next.scene = sceneAnchor
  const moves = next.byPlacementId[placementId] ? { ...next.byPlacementId[placementId] } : {}
  const previous = moves[moveKey]
  const previousUses = previous?.frequency === frequency ? previous.uses : 0
  const entry: MapMoveUsageEntry = {
    moveName,
    frequency,
    uses: previousUses + 1,
  }
  const round = positiveRound(currentRound)
  if (round != null) entry.lastUsedRound = round
  const timestamp = optionalTimestamp(usedAt)
  if (timestamp !== undefined) entry.updatedAt = timestamp
  moves[moveKey] = entry
  next.byPlacementId[placementId] = moves
  return next
}

export const eotMoveUsageState = (
  entry: MapMoveUsageEntry | null | undefined,
  currentRound: number | null | undefined,
): EotMoveUsageState => {
  const lastUsedRound = entry?.frequency === 'eot'
    ? positiveRound(entry.lastUsedRound)
    : null
  const round = positiveRound(currentRound)
  const nextAvailableRound = lastUsedRound == null ? null : lastUsedRound + 2
  const available = lastUsedRound == null || round == null || round >= lastUsedRound + 2
  return {
    uses: entry?.frequency === 'eot' ? entry.uses : 0,
    lastUsedRound,
    nextAvailableRound,
    available,
  }
}

export const limitedMoveUsageState = (
  entry: { uses?: unknown } | null | undefined,
  maxUses: number,
): MoveUsageLimitState => {
  const finiteMaxUses = Number.isFinite(maxUses) ? Math.trunc(maxUses) : 1
  const limit = Math.max(1, finiteMaxUses)
  const uses = nonNegativeInteger(entry?.uses)
  const remainingUses = Math.max(0, limit - uses)
  return {
    uses,
    maxUses: limit,
    remainingUses,
    available: remainingUses > 0,
  }
}

const normalizeSheetDailyMoveUsageEntry = (value: unknown): SheetDailyMoveUsageEntry | null => {
  if (!isRecord(value)) return null
  const moveName = typeof value.moveName === 'string' ? value.moveName.trim() : ''
  const uses = nonNegativeInteger(value.uses)
  if (!moveName || uses < 1) return null
  const entry: SheetDailyMoveUsageEntry = { moveName, uses }
  const updatedAt = optionalTimestamp(value.updatedAt)
  if (updatedAt !== undefined) entry.updatedAt = updatedAt
  return entry
}

export const normalizeSheetMoveUsage = (value: unknown): SheetMoveUsageState | undefined => {
  if (!isRecord(value) || !isRecord(value.daily)) return undefined
  const daily: SheetMoveUsageState['daily'] = {}
  for (const [rawMoveKey, rawEntry] of Object.entries(value.daily)) {
    const moveKey = moveUsageKey(rawMoveKey) || rawMoveKey.trim()
    if (!moveKey) continue
    const entry = normalizeSheetDailyMoveUsageEntry(rawEntry)
    if (entry) daily[moveKey] = entry
  }
  return Object.keys(daily).length ? { daily } : undefined
}

export const getSheetDailyMoveUsageEntry = (
  usage: SheetMoveUsageState | undefined,
  moveKey: string,
): SheetDailyMoveUsageEntry | null => usage?.daily?.[moveKey] ?? null

export interface RecordSheetDailyMoveUsageInput {
  usage: SheetMoveUsageState | undefined
  moveKey: string
  moveName: string
  usedAt?: number
}

export const recordSheetDailyMoveUsage = ({
  usage,
  moveKey,
  moveName,
  usedAt,
}: RecordSheetDailyMoveUsageInput): SheetMoveUsageState => {
  const normalized = normalizeSheetMoveUsage(usage) ?? { daily: {} }
  const previous = normalized.daily[moveKey]
  const entry: SheetDailyMoveUsageEntry = {
    moveName,
    uses: nonNegativeInteger(previous?.uses) + 1,
  }
  const timestamp = optionalTimestamp(usedAt)
  if (timestamp !== undefined) entry.updatedAt = timestamp
  return {
    daily: {
      ...normalized.daily,
      [moveKey]: entry,
    },
  }
}
