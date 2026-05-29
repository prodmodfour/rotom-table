import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, sheetChannel, sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import { findMove } from '~~/data/ptuReference'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { TabletopMap } from '~/types/map'
import type { ParsedMoveFrequency, MoveFrequencyKind } from '~/utils/moveUsage'
import {
  eotMoveUsageState,
  getMapMoveUsageEntry,
  getSheetDailyMoveUsageEntry,
  limitedMoveUsageState,
  moveUsageKey,
  normalizeMoveUsageRound,
  normalizeSheetMoveUsage,
  parseMoveFrequency,
  recordMapMoveUsage,
  recordSheetDailyMoveUsage,
} from '~/utils/moveUsage'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { summarizeMap } from '../utils/mapSummaries'
import { canSaveMap } from '../policies/mapPolicy'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import {
  readSheetFile,
  stripDerivedSheetFields,
  writeSheetFile,
} from '../utils/sheetStorage'
import { toPersistedMap } from './saveMap'

export class RecordMoveUsageUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface RecordMoveUsageInput {
  role: AuthRole
  slug: string
  placementId: string
  moveName: string
  clientId?: string
  playerProfile?: PlayerProfile | null
}

interface SheetFileRecord {
  path: string
  sheet: Record<string, unknown>
}

export interface RecordMoveUsageDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (path: string) => TabletopMap
  writeMap?: (path: string, map: TabletopMap) => void
  readSheet?: (kind: SheetKind, slug: string) => SheetFileRecord | null
  writeSheet?: (path: string, sheet: Record<string, unknown>) => void
  now?: () => number
  relativePath?: (path: string) => string
}

export interface MoveUsageResultSummary {
  moveName: string
  moveKey: string
  frequency: string
  frequencyKind: MoveFrequencyKind
  tracking: 'map' | 'sheet' | 'none'
  uses: number
  maxUses?: number
  remainingUses?: number
  lastUsedRound?: number | null
  nextAvailableRound?: number | null
  available: boolean
}

export interface RecordMoveUsageResult {
  ok: true
  usage: MoveUsageResultSummary
  map?: TabletopMap
  mapPath?: string
  sheet?: Record<string, unknown>
  sheetPath?: string
  sheetKind?: SheetKind
  sheetSlug?: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface SheetMoveRecord {
  name: string
  frequency?: string
}

interface ResolvedSheetMove {
  moveName: string
  moveKey: string
  frequency: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const nonEmptyString = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const sheetMoves = (sheet: Record<string, unknown>): SheetMoveRecord[] => {
  const movelist = sheet.movelist
  if (!Array.isArray(movelist)) return []
  return movelist.flatMap((move): SheetMoveRecord[] => {
    if (!isRecord(move)) return []
    const name = nonEmptyString(move.name)
    if (!name) return []
    const frequency = nonEmptyString(move.frequency)
    return [{ name, ...(frequency ? { frequency } : {}) }]
  })
}

const resolveSheetMove = (
  sheet: Record<string, unknown>,
  requestedMoveName: string,
): ResolvedSheetMove | null => {
  const requestedKey = moveUsageKey(requestedMoveName)
  if (!requestedKey) return null

  for (const move of sheetMoves(sheet)) {
    const reference = findMove(move.name)
    const canonicalName = reference?.name ?? move.name
    const candidateKeys = new Set([
      moveUsageKey(move.name),
      moveUsageKey(canonicalName),
    ])
    if (!candidateKeys.has(requestedKey)) continue

    const frequency = nonEmptyString(reference?.frequency) ?? nonEmptyString(move.frequency)
    return {
      moveName: canonicalName,
      moveKey: moveUsageKey(canonicalName) || requestedKey,
      frequency: frequency ?? '',
    }
  }

  return null
}

const maxUsesFor = (frequency: ParsedMoveFrequency): number =>
  Math.max(1, frequency.usesPerPeriod ?? 1)

const untrackedUsageResult = (
  move: ResolvedSheetMove,
  frequency: ParsedMoveFrequency,
): MoveUsageResultSummary => ({
  moveName: move.moveName,
  moveKey: move.moveKey,
  frequency: frequency.raw,
  frequencyKind: frequency.kind,
  tracking: 'none',
  uses: 0,
  available: true,
})

const mapUsageEvents = (
  map: TabletopMap,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => [
  {
    channel: mapChannel(map.slug),
    type: 'updated',
    clientId,
    data: map,
  },
  {
    channel: mapsChannel,
    type: 'updated',
    clientId,
    data: summarizeMap(map),
  },
]

const sheetUsageEvents = (
  kind: SheetKind,
  slug: string,
  sheet: Record<string, unknown>,
  clientId: string | undefined,
): Array<Omit<RealtimeEvent, 'timestamp'>> => {
  const data = { kind, slug, sheet }
  return [
    { channel: sheetChannel(kind, slug), type: 'updated', clientId, data },
    { channel: sheetsChannel, type: 'updated', clientId, data },
  ]
}

const recordEotUsage = (
  input: RecordMoveUsageInput,
  mapPath: string,
  map: TabletopMap,
  move: ResolvedSheetMove,
  dependencies: Required<Pick<RecordMoveUsageDependencies, 'writeMap' | 'now' | 'relativePath'>>,
): RecordMoveUsageResult => {
  const currentRound = normalizeMoveUsageRound(map.initiative?.round)
  const previous = getMapMoveUsageEntry(map.moveUsage, input.placementId, move.moveKey)
  const before = eotMoveUsageState(previous, currentRound)
  if (!before.available) {
    const roundText = before.nextAvailableRound == null ? 'later' : `round ${before.nextAvailableRound}`
    throw new RecordMoveUsageUseCaseError(409, `${move.moveName} is EOT and is not available until ${roundText}`)
  }

  const timestamp = dependencies.now()
  const moveUsage = recordMapMoveUsage({
    usage: map.moveUsage,
    placementId: input.placementId,
    moveKey: move.moveKey,
    moveName: move.moveName,
    frequency: 'eot',
    currentRound,
    usedAt: timestamp,
  })
  const persistedMap = toPersistedMap({ ...map, moveUsage }, mapPath, timestamp)
  dependencies.writeMap(mapPath, persistedMap)
  const after = eotMoveUsageState(
    getMapMoveUsageEntry(persistedMap.moveUsage, input.placementId, move.moveKey),
    currentRound,
  )

  return {
    ok: true,
    usage: {
      moveName: move.moveName,
      moveKey: move.moveKey,
      frequency: 'EOT',
      frequencyKind: 'eot',
      tracking: 'map',
      uses: after.uses,
      lastUsedRound: after.lastUsedRound,
      nextAvailableRound: after.nextAvailableRound,
      available: after.available,
    },
    map: persistedMap,
    mapPath: dependencies.relativePath(mapPath),
    events: mapUsageEvents(persistedMap, input.clientId),
  }
}

const recordSceneUsage = (
  input: RecordMoveUsageInput,
  mapPath: string,
  map: TabletopMap,
  move: ResolvedSheetMove,
  frequency: ParsedMoveFrequency,
  dependencies: Required<Pick<RecordMoveUsageDependencies, 'writeMap' | 'now' | 'relativePath'>>,
): RecordMoveUsageResult => {
  const maxUses = maxUsesFor(frequency)
  const previous = getMapMoveUsageEntry(map.moveUsage, input.placementId, move.moveKey)
  const before = limitedMoveUsageState(previous?.frequency === 'scene' ? previous : null, maxUses)
  if (!before.available) {
    throw new RecordMoveUsageUseCaseError(409, `${move.moveName} has no remaining Scene uses`)
  }

  const timestamp = dependencies.now()
  const currentRound = normalizeMoveUsageRound(map.initiative?.round)
  const moveUsage = recordMapMoveUsage({
    usage: map.moveUsage,
    placementId: input.placementId,
    moveKey: move.moveKey,
    moveName: move.moveName,
    frequency: 'scene',
    currentRound,
    usedAt: timestamp,
  })
  const persistedMap = toPersistedMap({ ...map, moveUsage }, mapPath, timestamp)
  dependencies.writeMap(mapPath, persistedMap)
  const after = limitedMoveUsageState(
    getMapMoveUsageEntry(persistedMap.moveUsage, input.placementId, move.moveKey),
    maxUses,
  )

  return {
    ok: true,
    usage: {
      moveName: move.moveName,
      moveKey: move.moveKey,
      frequency: frequency.raw,
      frequencyKind: 'scene',
      tracking: 'map',
      uses: after.uses,
      maxUses: after.maxUses,
      remainingUses: after.remainingUses,
      available: after.available,
    },
    map: persistedMap,
    mapPath: dependencies.relativePath(mapPath),
    events: mapUsageEvents(persistedMap, input.clientId),
  }
}

const recordDailyUsage = (
  input: RecordMoveUsageInput,
  sheetFile: SheetFileRecord,
  sheetKind: SheetKind,
  sheetSlug: string,
  move: ResolvedSheetMove,
  frequency: ParsedMoveFrequency,
  dependencies: Required<Pick<RecordMoveUsageDependencies, 'writeSheet' | 'now' | 'relativePath'>>,
): RecordMoveUsageResult => {
  const maxUses = maxUsesFor(frequency)
  const previousUsage = normalizeSheetMoveUsage(sheetFile.sheet.moveUsage)
  const previous = getSheetDailyMoveUsageEntry(previousUsage, move.moveKey)
  const before = limitedMoveUsageState(previous, maxUses)
  if (!before.available) {
    throw new RecordMoveUsageUseCaseError(409, `${move.moveName} has no remaining Daily uses`)
  }

  const timestamp = dependencies.now()
  const moveUsage = recordSheetDailyMoveUsage({
    usage: previousUsage,
    moveKey: move.moveKey,
    moveName: move.moveName,
    usedAt: timestamp,
  })
  const sheet = stripDerivedSheetFields({ ...sheetFile.sheet, moveUsage })
  dependencies.writeSheet(sheetFile.path, sheet)
  const after = limitedMoveUsageState(getSheetDailyMoveUsageEntry(moveUsage, move.moveKey), maxUses)

  return {
    ok: true,
    usage: {
      moveName: move.moveName,
      moveKey: move.moveKey,
      frequency: frequency.raw,
      frequencyKind: 'daily',
      tracking: 'sheet',
      uses: after.uses,
      maxUses: after.maxUses,
      remainingUses: after.remainingUses,
      available: after.available,
    },
    sheet,
    sheetPath: dependencies.relativePath(sheetFile.path),
    sheetKind,
    sheetSlug,
    events: sheetUsageEvents(sheetKind, sheetSlug, sheet, input.clientId),
  }
}

export const recordMoveUsageUseCase = (
  input: RecordMoveUsageInput,
  dependencies: RecordMoveUsageDependencies = {},
): RecordMoveUsageResult => {
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile
  const writeMap = dependencies.writeMap ?? writeMapFile
  const readSheet = dependencies.readSheet ?? ((kind: SheetKind, slug: string) => readSheetFile<Record<string, unknown>>(kind, slug))
  const writeSheet = dependencies.writeSheet ?? writeSheetFile
  const now = dependencies.now ?? Date.now
  const relativePath = dependencies.relativePath ?? campaignPathLabel

  const mapPath = findMapPath(input.slug)
  if (!mapPath) throw new RecordMoveUsageUseCaseError(404, `Map ${input.slug}.json not found`)

  const map = readMap(mapPath)
  if (!canSaveMap(input.role, map)) {
    throw new RecordMoveUsageUseCaseError(403, 'Map is not player visible')
  }

  const placement = map.placements.find((item) => item.id === input.placementId)
  if (!placement) {
    throw new RecordMoveUsageUseCaseError(404, `Placement ${input.placementId} not found`)
  }

  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement,
  })) {
    const message = input.role === 'player' && !input.playerProfile
      ? 'Select a player profile to control linked map tokens'
      : 'Token is not linked to selected player profile'
    throw new RecordMoveUsageUseCaseError(403, message)
  }

  const sheetFile = readSheet(placement.sheetKind, placement.sheetSlug)
  if (!sheetFile) {
    throw new RecordMoveUsageUseCaseError(404, `Sheet ${placement.sheetSlug}.json not found`)
  }

  const move = resolveSheetMove(sheetFile.sheet, input.moveName)
  if (!move) {
    throw new RecordMoveUsageUseCaseError(404, `Move ${input.moveName} not found on ${placement.sheetSlug}`)
  }

  const frequency = parseMoveFrequency(move.frequency)
  const commonDependencies = { writeMap, writeSheet, now, relativePath }

  if (frequency.kind === 'eot') {
    return recordEotUsage(input, mapPath, map, move, commonDependencies)
  }

  if (frequency.kind === 'scene') {
    return recordSceneUsage(input, mapPath, map, move, frequency, commonDependencies)
  }

  if (frequency.kind === 'daily') {
    return recordDailyUsage(input, sheetFile, placement.sheetKind, placement.sheetSlug, move, frequency, commonDependencies)
  }

  return {
    ok: true,
    usage: untrackedUsageResult(move, frequency),
    events: [],
  }
}
