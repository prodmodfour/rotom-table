import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type FieldEffectCategory,
  type FieldEffectKind,
  type FieldEffectRemoveCategory,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapEffectCommand,
  type LivePlayMapScope,
  type LivePlayPatch,
  type PlaceHazardPayload,
  type RemoveFieldEffectPayload,
  type RemoveHazardPayload,
  type SetFieldEffectPayload,
  type TickFieldEffectDurationsPayload,
} from '#shared/livePlayCommands'
import {
  parseClearFieldEffectsPayload,
  parseClearHazardsPayload,
  type ClearFieldEffectsPayload,
  type ClearHazardsPayload,
} from '#shared/livePlayBatchCommands'
import type { AuthRole } from '#shared/auth'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type {
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
  TabletopMap,
} from '~/types/map'
import {
  hazardInBounds,
  mapHazardCellKey,
  mapHazardKey,
  normalizeMapHazardLayer,
} from '~/utils/mapHazards'
import {
  createMapRoomEffect,
  createMapTerrainEffect,
  createMapWeatherEffect,
  normalizeMapFieldEffects,
} from '~/utils/mapFieldEffects'
import { isMapHazardKind } from '~/utils/mapHazardDefinitions'
import {
  isMapRoomKind,
  isMapTerrainKind,
  isMapWeatherKind,
} from '~/utils/mapFieldEffectDefinitions'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { commitLivePlayMapUpdate } from './livePlayMapPersistence'
import { toPersistedMap } from './saveMap'

export class LivePlayMapEffectsCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlayMapEffectsCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
  | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS
  | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS
  | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT
  | typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS

export interface HazardCellState {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface HazardCellPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
  readonly cell: HazardCellState
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

export interface ClearHazardsPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS
  readonly mode: ClearHazardsPayload['mode']
  readonly kind?: MapHazardKind
  readonly cells?: readonly HazardCellState[]
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly removed: readonly MapHazardV2[]
}

export type HazardPatchPayload = HazardCellPatchPayload | ClearHazardsPatchPayload

export interface FieldEffectsPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS
    | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: FieldEffectRemoveCategory
  readonly kind?: FieldEffectKind
  readonly kinds?: readonly FieldEffectKind[]
  readonly tickAmount?: number
}

export interface LivePlayMapEffectsCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
}

export interface ExecuteLivePlayMapEffectsCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: LivePlayMapEffectsCommandType
}

export interface LivePlayMapEffectsCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly hazards?: readonly MapHazardV2[]
  readonly fieldEffects?: MapFieldEffects
}

export interface LivePlayMapEffectsCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedMapEffectsContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
}

interface AppliedHazardCellChange {
  readonly lane: 'hazards'
  readonly changeKind: 'cell'
  readonly nextMap: TabletopMap
  readonly cell: HazardCellState
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

interface AppliedHazardsClearChange {
  readonly lane: 'hazards'
  readonly changeKind: 'clear'
  readonly nextMap: TabletopMap
  readonly mode: ClearHazardsPayload['mode']
  readonly kind?: MapHazardKind
  readonly cells?: readonly HazardCellState[]
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly removed: readonly MapHazardV2[]
}

type AppliedHazardChange = AppliedHazardCellChange | AppliedHazardsClearChange

interface AppliedFieldEffectsChange {
  readonly lane: 'fieldEffects'
  readonly nextMap: TabletopMap
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: FieldEffectRemoveCategory
  readonly kind?: FieldEffectKind
  readonly kinds?: readonly FieldEffectKind[]
  readonly tickAmount?: number
}

type AppliedMapEffectsChange = AppliedHazardChange | AppliedFieldEffectsChange

type UnknownRecord = Record<string, unknown>
type LivePlayMapEffectsDependencySet = ReturnType<typeof actionDependencies>

const livePlayMapEffectsCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const mapEffectsCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
])

const reservedMapEffectsCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
])

const hazardCellCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
])

const hazardCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
])

const fieldEffectCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
])

const actionDependencies = (dependencies: LivePlayMapEffectsCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayMapEffectsCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? ((path: string) => path),
})

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const safeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value)
)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const mapScope = (lane: LivePlayMapScope['lane']): LivePlayMapScope => ({ kind: 'map', lane })

const commandHasMapScope = (command: LivePlayMapEffectCommand, lane: LivePlayMapScope['lane']): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === lane
))

const expectMapScope = (command: LivePlayMapEffectCommand, lane: LivePlayMapScope['lane']): void => {
  if (!commandHasMapScope(command, lane)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map ${lane} scope`)
  }
}

const assertMapEffectsCommandType = (
  command: LivePlayMapEffectCommand,
  expectedType?: LivePlayMapEffectsCommandType,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (reservedMapEffectsCommandTypes.has(command.type)) {
    rejectLivePlayCommand(
      'invalid',
      'editHazards is a reserved live-play batch contract; hazard batch execution is not available until the hazard batch server route is implemented.',
    )
  }
  if (!mapEffectsCommandTypes.has(command.type)) {
    rejectLivePlayCommand(
      'invalid',
      'Map effects live-play routes support placeHazard, removeHazard, clearHazards, clearFieldEffects, setFieldEffect, removeFieldEffect, and tickFieldEffectDurations commands only',
    )
  }
}

const cloneHazard = (hazard: MapHazardV2): MapHazardV2 => ({
  kind: hazard.kind,
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
  ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
  ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
})

const cloneHazards = (hazards: readonly MapHazardV2[] | null | undefined): MapHazardV2[] => (
  (hazards ?? []).map(cloneHazard)
)

const cloneCell = (cell: HazardCellState): HazardCellState => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cellMatchesHazard = (
  hazard: Pick<MapHazardV2, 'x' | 'y' | 'z'>,
  cell: Pick<HazardCellState, 'x' | 'y' | 'z'>,
): boolean => hazard.x === cell.x && hazard.y === cell.y && hazard.z === cell.z

const hazardsAtCell = (
  map: TabletopMap,
  cell: HazardCellState,
): readonly MapHazardV2[] => cloneHazards(map.hazards).filter((hazard) => cellMatchesHazard(hazard, cell))

const sameHazardLane = (
  left: MapHazardV2,
  right: Pick<MapHazardV2, 'kind' | 'x' | 'y' | 'z'>,
): boolean => mapHazardKey(left) === mapHazardKey(right)

const expectRecord = (value: unknown, label: string): UnknownRecord => {
  if (isRecord(value)) return value
  return rejectLivePlayCommand('invalid', `${label} must be an object`)
}

const expectCoordinate = (record: UnknownRecord, key: 'x' | 'y' | 'z', label: string): number => {
  const value = record[key]
  if (safeInteger(value)) return value
  return rejectLivePlayCommand('invalid', `${label}.${key} must be a safe integer`)
}

const expectHazardPlacement = (value: unknown, label: string): MapHazardV2 => {
  const record = expectRecord(value, label)
  if (!isMapHazardKind(record.kind)) {
    return rejectLivePlayCommand('invalid', `${label}.kind must be a supported hazard kind`)
  }

  const kind = record.kind
  const x = expectCoordinate(record, 'x', label)
  const y = expectCoordinate(record, 'y', label)
  const z = expectCoordinate(record, 'z', label)

  if (hasOwn(record, 'layer') && (!safeInteger(record.layer) || record.layer < 1 || record.layer > 2)) {
    return rejectLivePlayCommand('invalid', `${label}.layer must be 1 or 2 when provided`)
  }
  if (hasOwn(record, 'owner') && !nonEmptyString(record.owner)) {
    return rejectLivePlayCommand('invalid', `${label}.owner must be a non-empty string when provided`)
  }

  const hazard: MapHazardV2 = { kind, x, y, z }
  const layer = normalizeMapHazardLayer(kind, record.layer)
  if (layer !== undefined) hazard.layer = layer
  if (typeof record.owner === 'string') hazard.owner = record.owner.trim()
  return hazard
}

const expectHazardCell = (value: unknown, label: string): RemoveHazardPayload['cell'] => {
  const record = expectRecord(value, label)
  const cell = {
    x: expectCoordinate(record, 'x', label),
    y: expectCoordinate(record, 'y', label),
    z: expectCoordinate(record, 'z', label),
  }
  if (hasOwn(record, 'kind') && !isMapHazardKind(record.kind)) {
    return rejectLivePlayCommand('invalid', `${label}.kind must be a supported hazard kind when provided`)
  }
  return {
    ...cell,
    ...(isMapHazardKind(record.kind) ? { kind: record.kind } : {}),
  }
}

const expectPlaceHazardPayload = (payload: unknown): PlaceHazardPayload => {
  const record = expectRecord(payload, 'placeHazard payload')
  return { hazard: expectHazardPlacement(record.hazard, 'placeHazard payload.hazard') }
}

const expectRemoveHazardPayload = (payload: unknown): RemoveHazardPayload => {
  const record = expectRecord(payload, 'removeHazard payload')
  return { cell: expectHazardCell(record.cell, 'removeHazard payload.cell') }
}

const batchIssueSummary = (issues: readonly { readonly path: string; readonly message: string }[]): string => (
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
)

const expectClearHazardsPayload = (payload: unknown): ClearHazardsPayload => {
  const result = parseClearHazardsPayload(payload)
  if (result.valid) return result.value
  return rejectLivePlayCommand('invalid', `clearHazards payload is invalid: ${batchIssueSummary(result.issues)}`)
}

const expectClearFieldEffectsPayload = (payload: unknown): ClearFieldEffectsPayload => {
  const result = parseClearFieldEffectsPayload(payload)
  if (result.valid) return result.value
  return rejectLivePlayCommand('invalid', `clearFieldEffects payload is invalid: ${batchIssueSummary(result.issues)}`)
}

const sameCell = (
  left: Pick<HazardCellState, 'x' | 'y' | 'z'>,
  right: Pick<HazardCellState, 'x' | 'y' | 'z'>,
): boolean => left.x === right.x && left.y === right.y && left.z === right.z

const scopeHasCell = (scope: LivePlayMapEffectCommand['scopes'][number]): scope is LivePlayMapEffectCommand['scopes'][number] & { readonly cell: HazardCellState } => {
  const record = scope as unknown as UnknownRecord
  return isRecord(record.cell)
}

const hasBroadHazardsScope = (command: LivePlayMapEffectCommand): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'hazards' && !scopeHasCell(scope)
))

const hasHazardCellScope = (
  command: LivePlayMapEffectCommand,
  cell: HazardCellState,
): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'hazards' && scopeHasCell(scope) && sameCell(scope.cell, cell)
))

const expectClearHazardsScopes = (
  command: LivePlayMapEffectCommand,
  payload: ClearHazardsPayload,
): void => {
  if (payload.mode === 'cells') {
    if (hasBroadHazardsScope(command)) return

    const missingCell = payload.cells.find((cell) => !hasHazardCellScope(command, cell))
    if (!missingCell) return

    rejectLivePlayCommand(
      'invalid',
      `clearHazards cells mode scopes must include every requested hazard cell or the broad map hazards scope; missing ${missingCell.x},${missingCell.y},${missingCell.z}`,
    )
  }

  if (hasBroadHazardsScope(command)) return
  rejectLivePlayCommand('invalid', `clearHazards ${payload.mode} mode scopes must include the broad map hazards scope`)
}

const cloneWeatherEffect = (effect: MapWeatherEffect): MapWeatherEffect => ({
  kind: effect.kind,
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneTerrainEffect = (effect: MapTerrainEffect): MapTerrainEffect => ({
  kind: effect.kind,
  ...(effect.scope === undefined ? {} : { scope: effect.scope }),
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneRoomEffect = (effect: MapRoomEffect): MapRoomEffect => ({
  kind: effect.kind,
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.startsNextRound === undefined ? {} : { startsNextRound: effect.startsNextRound }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneFieldEffects = (effects: MapFieldEffects | null | undefined): Required<MapFieldEffects> => {
  const normalized = normalizeMapFieldEffects(effects)
  return {
    weather: (normalized.weather ?? []).map(cloneWeatherEffect),
    terrains: (normalized.terrains ?? []).map(cloneTerrainEffect),
    rooms: (normalized.rooms ?? []).map(cloneRoomEffect),
  }
}

const fieldEffectsEqual = (
  left: MapFieldEffects,
  right: MapFieldEffects,
): boolean => JSON.stringify(cloneFieldEffects(left)) === JSON.stringify(cloneFieldEffects(right))

const expectFieldEffectCategory = (value: unknown, label: string): FieldEffectCategory => {
  if (value === 'weather' || value === 'terrain' || value === 'room') return value
  return rejectLivePlayCommand('invalid', `${label} must be weather, terrain, or room`)
}

const expectRemoveFieldEffectCategory = (value: unknown, label: string): FieldEffectRemoveCategory => {
  if (value === 'all') return value
  return expectFieldEffectCategory(value, label)
}

const fieldEffectKindMatchesCategory = (category: FieldEffectCategory, kind: unknown): kind is FieldEffectKind => {
  if (category === 'weather') return isMapWeatherKind(kind)
  if (category === 'terrain') return isMapTerrainKind(kind)
  return isMapRoomKind(kind)
}

const fieldEffectKindLabel = (category: FieldEffectCategory): string => {
  if (category === 'weather') return 'weather'
  if (category === 'terrain') return 'terrain'
  return 'room'
}

const expectFieldEffectKind = (
  category: FieldEffectCategory,
  value: unknown,
  label: string,
): FieldEffectKind => {
  if (fieldEffectKindMatchesCategory(category, value)) return value
  return rejectLivePlayCommand('invalid', `${label} must be a supported ${fieldEffectKindLabel(category)} effect kind`)
}

const expectRounds = (value: unknown, label: string): number | null => {
  if (value === null) return null
  if (safeInteger(value) && value >= 0) return value
  return rejectLivePlayCommand('invalid', `${label} must be a safe non-negative integer or null when provided`)
}

const expectOptionalSource = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (nonEmptyString(value)) return value.trim().slice(0, 80)
  return rejectLivePlayCommand('invalid', `${label} must be a non-empty string when provided`)
}

const expectSetFieldEffectPayload = (payload: unknown): SetFieldEffectPayload => {
  const record = expectRecord(payload, 'setFieldEffect payload')
  const category = expectFieldEffectCategory(record.category, 'setFieldEffect payload.category')
  const kind = expectFieldEffectKind(category, record.kind, 'setFieldEffect payload.kind')

  let rounds: number | null | undefined
  if (hasOwn(record, 'rounds')) rounds = expectRounds(record.rounds, 'setFieldEffect payload.rounds')

  if (hasOwn(record, 'weatherMode') && category !== 'weather') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.weatherMode is only valid for weather effects')
  }
  if (hasOwn(record, 'weatherMode') && record.weatherMode !== 'replace' && record.weatherMode !== 'append') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.weatherMode must be replace or append')
  }

  if (hasOwn(record, 'terrainScope') && category !== 'terrain') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.terrainScope is only valid for terrain effects')
  }
  if (hasOwn(record, 'terrainScope') && record.terrainScope !== 'field' && record.terrainScope !== 'area') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.terrainScope must be field or area')
  }

  if (hasOwn(record, 'startsNextRound') && category !== 'room') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.startsNextRound is only valid for room effects')
  }
  if (hasOwn(record, 'startsNextRound') && typeof record.startsNextRound !== 'boolean') {
    return rejectLivePlayCommand('invalid', 'setFieldEffect payload.startsNextRound must be boolean when provided')
  }

  const source = expectOptionalSource(record.source, 'setFieldEffect payload.source')
  return {
    category,
    kind,
    ...(rounds === undefined ? {} : { rounds }),
    ...(source === undefined ? {} : { source }),
    ...(record.weatherMode === undefined ? {} : { weatherMode: record.weatherMode as 'replace' | 'append' }),
    ...(record.terrainScope === undefined ? {} : { terrainScope: record.terrainScope as 'field' | 'area' }),
    ...(record.startsNextRound === undefined ? {} : { startsNextRound: record.startsNextRound as boolean }),
  }
}

const expectRemoveFieldEffectPayload = (payload: unknown): RemoveFieldEffectPayload => {
  const record = expectRecord(payload, 'removeFieldEffect payload')
  const category = expectRemoveFieldEffectCategory(record.category, 'removeFieldEffect payload.category')
  if (category === 'all') {
    if (hasOwn(record, 'kind')) return rejectLivePlayCommand('invalid', 'removeFieldEffect payload.kind is not valid when category is all')
    return { category }
  }
  if (hasOwn(record, 'kind')) {
    return { category, kind: expectFieldEffectKind(category, record.kind, 'removeFieldEffect payload.kind') }
  }
  return { category }
}

const expectTickFieldEffectDurationsPayload = (payload: unknown): TickFieldEffectDurationsPayload => {
  const record = expectRecord(payload, 'tickFieldEffectDurations payload')
  if (!hasOwn(record, 'amount')) return {}
  if (safeInteger(record.amount) && record.amount >= 1) return { amount: record.amount }
  return rejectLivePlayCommand('invalid', 'tickFieldEffectDurations payload.amount must be a safe integer greater than or equal to 1 when provided')
}

const validateCommandPayloadAndScopes = (command: LivePlayMapEffectCommand): void => {
  if (hazardCommandTypes.has(command.type)) expectMapScope(command, 'hazards')
  else if (fieldEffectCommandTypes.has(command.type)) expectMapScope(command, 'fieldEffects')

  if (command.type === LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD) {
    expectPlaceHazardPayload(command.payload)
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD) {
    expectRemoveHazardPayload(command.payload)
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS) {
    expectClearHazardsScopes(command, expectClearHazardsPayload(command.payload))
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS) {
    expectClearFieldEffectsPayload(command.payload)
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT) {
    expectSetFieldEffectPayload(command.payload)
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT) {
    expectRemoveFieldEffectPayload(command.payload)
  } else if (command.type === LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS) {
    expectTickFieldEffectDurationsPayload(command.payload)
  }
}

const timestampedMap = (map: TabletopMap, timestamp: number): TabletopMap => ({
  ...map,
  updatedAt: timestamp,
})

const applyPlaceHazard = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedHazardChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD) {
    rejectLivePlayCommand('invalid', 'applyPlaceHazard only handles placeHazard commands')
  }

  const payload = expectPlaceHazardPayload(command.payload)
  const hazard = payload.hazard
  const cell = cloneCell(hazard)
  const previous = hazardsAtCell(context.map, cell)

  if (!hazardInBounds(hazard, context.map.dimensions)) {
    rejectLivePlayCommand(
      'invalid',
      `Hazard ${hazard.kind} cannot be placed at ${hazard.x},${hazard.y},${hazard.z}; the cell is outside map ${command.mapSlug}.`,
      { currentState: { cell, hazards: previous } },
    )
  }

  let placed: MapHazardV2 | undefined
  let changed = false
  const hazards = cloneHazards(context.map.hazards)
  const nextHazards = hazards.map((existing) => {
    if (!sameHazardLane(existing, hazard)) return existing
    if (hazard.kind !== 'toxic-spikes') {
      placed = cloneHazard(existing)
      return existing
    }

    const nextLayer = Math.min(2, Math.max(existing.layer ?? 1, hazard.layer ?? 1) + 1)
    placed = { ...existing, layer: nextLayer }
    if (nextLayer !== (existing.layer ?? 1)) changed = true
    return cloneHazard(placed)
  })

  if (placed === undefined) {
    placed = cloneHazard(hazard)
    nextHazards.push(cloneHazard(hazard))
    changed = true
  }

  if (!changed) {
    rejectLivePlayCommand(
      'no-op',
      hazard.kind === 'toxic-spikes'
        ? `Toxic Spikes at ${hazard.x},${hazard.y},${hazard.z} already has the maximum layer count.`
        : `Hazard ${hazard.kind} is already present at ${hazard.x},${hazard.y},${hazard.z}.`,
      { currentState: { cell, hazards: previous } },
    )
  }

  const nextMap = timestampedMap({
    ...context.map,
    hazards: nextHazards,
  }, timestamp)
  return {
    lane: 'hazards',
    changeKind: 'cell',
    nextMap,
    cell,
    previous,
    current: hazardsAtCell(nextMap, cell),
    placed: cloneHazard(placed),
    removed: [],
  }
}

const applyRemoveHazard = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedHazardChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD) {
    rejectLivePlayCommand('invalid', 'applyRemoveHazard only handles removeHazard commands')
  }

  const payload = expectRemoveHazardPayload(command.payload)
  const cell = cloneCell(payload.cell)
  const previous = hazardsAtCell(context.map, cell)

  if (!hazardInBounds(cell, context.map.dimensions)) {
    rejectLivePlayCommand(
      'invalid',
      `Hazards cannot be removed at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${command.mapSlug}.`,
      { currentState: { cell, hazards: previous } },
    )
  }

  const removed: MapHazardV2[] = []
  const nextHazards = cloneHazards(context.map.hazards).filter((hazard) => {
    const sameCell = cellMatchesHazard(hazard, cell)
    const sameKind = payload.cell.kind === undefined || hazard.kind === payload.cell.kind
    if (sameCell && sameKind) {
      removed.push(cloneHazard(hazard))
      return false
    }
    return true
  })

  if (removed.length === 0) {
    rejectLivePlayCommand(
      'no-op',
      payload.cell.kind === undefined
        ? `No hazards are present at ${cell.x},${cell.y},${cell.z}.`
        : `Hazard ${payload.cell.kind} is not present at ${cell.x},${cell.y},${cell.z}.`,
      { currentState: { cell, hazards: previous } },
    )
  }

  const nextMap = timestampedMap({
    ...context.map,
    hazards: nextHazards,
  }, timestamp)
  return {
    lane: 'hazards',
    changeKind: 'cell',
    nextMap,
    cell,
    previous,
    current: hazardsAtCell(nextMap, cell),
    removed,
  }
}

const clearHazardsCells = (payload: ClearHazardsPayload): readonly HazardCellState[] | undefined => (
  payload.mode === 'cells' ? payload.cells.map(cloneCell) : undefined
)

const clearHazardsNoOpMessage = (payload: ClearHazardsPayload, mapSlug: string): string => {
  if (payload.mode === 'all') return `No hazards are present on map ${mapSlug}.`
  if (payload.mode === 'kind') return `No ${payload.kind} hazards are present on map ${mapSlug}.`
  return payload.kind === undefined
    ? `No hazards are present in the requested cells on map ${mapSlug}.`
    : `No ${payload.kind} hazards are present in the requested cells on map ${mapSlug}.`
}

const matchesClearHazardsPayload = (
  hazard: MapHazardV2,
  payload: ClearHazardsPayload,
  cellKeys: ReadonlySet<string>,
): boolean => {
  if (payload.mode === 'all') return true
  if (payload.mode === 'kind') return hazard.kind === payload.kind
  if (!cellKeys.has(mapHazardCellKey(hazard))) return false
  return payload.kind === undefined || hazard.kind === payload.kind
}

const assertClearHazardsCellsInBounds = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  payload: ClearHazardsPayload,
): void => {
  if (payload.mode !== 'cells') return
  for (const cell of payload.cells) {
    if (hazardInBounds(cell, context.map.dimensions)) continue
    rejectLivePlayCommand(
      'invalid',
      `Hazards cannot be cleared at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${command.mapSlug}.`,
      { currentState: { cell: cloneCell(cell), hazards: hazardsAtCell(context.map, cell) } },
    )
  }
}

const applyClearHazards = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedHazardChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS) {
    rejectLivePlayCommand('invalid', 'applyClearHazards only handles clearHazards commands')
  }

  const payload = expectClearHazardsPayload(command.payload)
  assertClearHazardsCellsInBounds(command, context, payload)

  const previous = cloneHazards(context.map.hazards)
  const cellKeys = new Set((payload.mode === 'cells' ? payload.cells : []).map(mapHazardCellKey))
  const removed: MapHazardV2[] = []
  const current = previous.filter((hazard) => {
    if (!matchesClearHazardsPayload(hazard, payload, cellKeys)) return true
    removed.push(cloneHazard(hazard))
    return false
  })

  if (removed.length === 0) {
    rejectLivePlayCommand('no-op', clearHazardsNoOpMessage(payload, command.mapSlug), {
      currentState: { hazards: previous },
    })
  }

  const nextMap = timestampedMap({
    ...context.map,
    hazards: current.map(cloneHazard),
  }, timestamp)

  const clearKind = payload.mode === 'all' ? undefined : payload.kind
  const cells = payload.mode === 'cells' ? clearHazardsCells(payload) : undefined

  return {
    lane: 'hazards',
    changeKind: 'clear',
    nextMap,
    mode: payload.mode,
    ...(clearKind === undefined ? {} : { kind: clearKind }),
    ...(cells === undefined ? {} : { cells }),
    previous,
    current: current.map(cloneHazard),
    removed,
  }
}

const setEffectSource = <TEffect extends { source?: string }>(
  effect: TEffect,
  source: string | undefined,
): TEffect => source === undefined ? effect : { ...effect, source }

const weatherEffectFromPayload = (payload: SetFieldEffectPayload): MapWeatherEffect => {
  const effect = createMapWeatherEffect(payload.kind as MapWeatherKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  return setEffectSource(effect, payload.source)
}

const terrainEffectFromPayload = (payload: SetFieldEffectPayload): MapTerrainEffect => {
  const effect = createMapTerrainEffect(payload.kind as MapTerrainKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  if (payload.terrainScope !== undefined) effect.scope = payload.terrainScope
  return setEffectSource(effect, payload.source)
}

const roomEffectFromPayload = (payload: SetFieldEffectPayload): MapRoomEffect => {
  const effect = createMapRoomEffect(payload.kind as MapRoomKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  if (payload.startsNextRound !== undefined) effect.startsNextRound = payload.startsNextRound
  return setEffectSource(effect, payload.source)
}

const withFieldEffects = (
  map: TabletopMap,
  fieldEffects: MapFieldEffects,
  timestamp: number,
): TabletopMap => timestampedMap({
  ...map,
  fieldEffects: cloneFieldEffects(fieldEffects),
}, timestamp)

const clearFieldEffectsKinds = (payload: ClearFieldEffectsPayload): readonly FieldEffectKind[] | undefined => (
  'kinds' in payload && payload.kinds !== undefined ? [...payload.kinds] as readonly FieldEffectKind[] : undefined
)

const clearFieldEffectsNoOpMessage = (payload: ClearFieldEffectsPayload, mapSlug: string): string => {
  if (payload.category === 'all') return `No field effects are active on map ${mapSlug}.`
  const kinds = clearFieldEffectsKinds(payload)
  if (kinds === undefined) return `No ${payload.category} field effects are active on map ${mapSlug}.`
  if (kinds.length === 1) return `${payload.category} effect ${kinds[0]} is not active on map ${mapSlug}.`
  return `None of the requested ${payload.category} field effects are active on map ${mapSlug}.`
}

const applyClearFieldEffects = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedFieldEffectsChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS) {
    rejectLivePlayCommand('invalid', 'applyClearFieldEffects only handles clearFieldEffects commands')
  }

  const payload = expectClearFieldEffectsPayload(command.payload)
  const previous = cloneFieldEffects(context.map.fieldEffects)
  const current = cloneFieldEffects(previous)
  const kinds = clearFieldEffectsKinds(payload)
  const kindSet = new Set(kinds ?? [])

  if (payload.category === 'all') {
    current.weather = []
    current.terrains = []
    current.rooms = []
  } else if (payload.category === 'weather') {
    current.weather = kinds === undefined
      ? []
      : current.weather.filter((effect) => !kindSet.has(effect.kind))
  } else if (payload.category === 'terrain') {
    current.terrains = kinds === undefined
      ? []
      : current.terrains.filter((effect) => !kindSet.has(effect.kind))
  } else {
    current.rooms = kinds === undefined
      ? []
      : current.rooms.filter((effect) => !kindSet.has(effect.kind))
  }

  if (fieldEffectsEqual(previous, current)) {
    rejectLivePlayCommand('no-op', clearFieldEffectsNoOpMessage(payload, command.mapSlug), { currentState: previous })
  }

  return {
    lane: 'fieldEffects',
    nextMap: withFieldEffects(context.map, current, timestamp),
    previous,
    current,
    category: payload.category,
    ...(kinds === undefined ? {} : { kinds }),
  }
}

const applySetFieldEffect = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedFieldEffectsChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT) {
    rejectLivePlayCommand('invalid', 'applySetFieldEffect only handles setFieldEffect commands')
  }

  const payload = expectSetFieldEffectPayload(command.payload)
  const previous = cloneFieldEffects(context.map.fieldEffects)
  const current = cloneFieldEffects(previous)

  if (payload.rounds === 0) {
    if (payload.category === 'weather') current.weather = current.weather.filter((effect) => effect.kind !== payload.kind)
    else if (payload.category === 'terrain') current.terrains = current.terrains.filter((effect) => effect.kind !== payload.kind)
    else current.rooms = current.rooms.filter((effect) => effect.kind !== payload.kind)
  } else if (payload.category === 'weather') {
    const effect = weatherEffectFromPayload(payload)
    if (payload.weatherMode === 'append') {
      current.weather = [...current.weather.filter((item) => item.kind !== effect.kind), effect].slice(-2)
    } else {
      current.weather = [effect]
    }
  } else if (payload.category === 'terrain') {
    const effect = terrainEffectFromPayload(payload)
    current.terrains = [...current.terrains.filter((item) => item.kind !== effect.kind), effect]
  } else {
    const effect = roomEffectFromPayload(payload)
    current.rooms = [...current.rooms.filter((item) => item.kind !== effect.kind), effect]
  }

  if (fieldEffectsEqual(previous, current)) {
    rejectLivePlayCommand(
      'no-op',
      payload.rounds === 0
        ? `${payload.category} effect ${payload.kind} is not active on map ${command.mapSlug}.`
        : `${payload.category} effect ${payload.kind} is already current on map ${command.mapSlug}.`,
      { currentState: previous },
    )
  }

  return {
    lane: 'fieldEffects',
    nextMap: withFieldEffects(context.map, current, timestamp),
    previous,
    current,
    category: payload.category,
    kind: payload.kind,
  }
}

const applyRemoveFieldEffect = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedFieldEffectsChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT) {
    rejectLivePlayCommand('invalid', 'applyRemoveFieldEffect only handles removeFieldEffect commands')
  }

  const payload = expectRemoveFieldEffectPayload(command.payload)
  const previous = cloneFieldEffects(context.map.fieldEffects)
  const current = cloneFieldEffects(previous)

  if (payload.category === 'all') {
    current.weather = []
    current.terrains = []
    current.rooms = []
  } else if (payload.category === 'weather') {
    current.weather = payload.kind === undefined
      ? []
      : current.weather.filter((effect) => effect.kind !== payload.kind)
  } else if (payload.category === 'terrain') {
    current.terrains = payload.kind === undefined
      ? []
      : current.terrains.filter((effect) => effect.kind !== payload.kind)
  } else {
    current.rooms = payload.kind === undefined
      ? []
      : current.rooms.filter((effect) => effect.kind !== payload.kind)
  }

  if (fieldEffectsEqual(previous, current)) {
    const label = payload.category === 'all'
      ? 'No field effects are active'
      : payload.kind === undefined
        ? `No ${payload.category} field effects are active`
        : `${payload.category} effect ${payload.kind} is not active`
    rejectLivePlayCommand('no-op', `${label} on map ${command.mapSlug}.`, { currentState: previous })
  }

  return {
    lane: 'fieldEffects',
    nextMap: withFieldEffects(context.map, current, timestamp),
    previous,
    current,
    category: payload.category,
    ...(payload.kind === undefined ? {} : { kind: payload.kind }),
  }
}

const tickEffects = <TEffect extends { rounds?: number | null }>(
  effects: readonly TEffect[],
  amount: number,
  clone: (effect: TEffect) => TEffect,
): TEffect[] => {
  const next: TEffect[] = []
  for (const effect of effects) {
    if (effect.rounds === null || effect.rounds === undefined) {
      next.push(clone(effect))
      continue
    }
    const rounds = Math.max(0, effect.rounds - amount)
    if (rounds > 0) next.push({ ...clone(effect), rounds })
  }
  return next
}

const applyTickFieldEffectDurations = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedFieldEffectsChange => {
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS) {
    rejectLivePlayCommand('invalid', 'applyTickFieldEffectDurations only handles tickFieldEffectDurations commands')
  }

  const payload = expectTickFieldEffectDurationsPayload(command.payload)
  const amount = payload.amount ?? 1
  const previous = cloneFieldEffects(context.map.fieldEffects)
  const current: Required<MapFieldEffects> = {
    weather: tickEffects(previous.weather, amount, cloneWeatherEffect),
    terrains: tickEffects(previous.terrains, amount, cloneTerrainEffect),
    rooms: tickEffects(previous.rooms, amount, cloneRoomEffect),
  }

  if (fieldEffectsEqual(previous, current)) {
    rejectLivePlayCommand('no-op', `No finite field-effect durations changed on map ${command.mapSlug}.`, {
      currentState: previous,
    })
  }

  return {
    lane: 'fieldEffects',
    nextMap: withFieldEffects(context.map, current, timestamp),
    previous,
    current,
    tickAmount: amount,
  }
}

const applyMapEffectsChange = (
  command: LivePlayMapEffectCommand,
  context: ResolvedMapEffectsContext,
  timestamp: number,
): AppliedMapEffectsChange => {
  if (command.type === LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD) return applyPlaceHazard(command, context, timestamp)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD) return applyRemoveHazard(command, context, timestamp)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS) return applyClearHazards(command, context, timestamp)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS) return applyClearFieldEffects(command, context, timestamp)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT) return applySetFieldEffect(command, context, timestamp)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT) return applyRemoveFieldEffect(command, context, timestamp)
  return applyTickFieldEffectDurations(command, context, timestamp)
}

const hazardPatch = (
  command: LivePlayMapEffectCommand,
  revision: number,
  change: AppliedHazardChange,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS, HazardPatchPayload, LivePlayMapScope> => {
  if (!hazardCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Hazard patches require a hazard command')
  }

  if (change.changeKind === 'clear') {
    return {
      schemaVersion: command.schemaVersion,
      type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
      mapSlug: command.mapSlug,
      revision,
      scopes: [mapScope('hazards')],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
        mode: change.mode,
        ...(change.kind === undefined ? {} : { kind: change.kind }),
        ...(change.cells === undefined ? {} : { cells: change.cells.map(cloneCell) }),
        previous: change.previous.map(cloneHazard),
        current: change.current.map(cloneHazard),
        removed: change.removed.map(cloneHazard),
      },
    }
  }

  if (!hazardCellCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Hazard cell patches require a single-cell hazard command')
  }

  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
    mapSlug: command.mapSlug,
    revision,
    scopes: [mapScope('hazards')],
    payload: {
      command: command.type as typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
      cell: cloneCell(change.cell),
      previous: change.previous.map(cloneHazard),
      current: change.current.map(cloneHazard),
      ...(change.placed === undefined ? {} : { placed: cloneHazard(change.placed) }),
      removed: change.removed.map(cloneHazard),
    },
  }
}

const fieldEffectsPatch = (
  command: LivePlayMapEffectCommand,
  revision: number,
  change: AppliedFieldEffectsChange,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS, FieldEffectsPatchPayload, LivePlayMapScope> => {
  if (!fieldEffectCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Field-effect patches require a field-effect command')
  }
  return {
    schemaVersion: command.schemaVersion,
    type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
    mapSlug: command.mapSlug,
    revision,
    scopes: [mapScope('fieldEffects')],
    payload: {
      command: command.type as FieldEffectsPatchPayload['command'],
      previous: cloneFieldEffects(change.previous),
      current: cloneFieldEffects(change.current),
      ...(change.category === undefined ? {} : { category: change.category }),
      ...(change.kind === undefined ? {} : { kind: change.kind }),
      ...(change.kinds === undefined ? {} : { kinds: [...change.kinds] }),
      ...(change.tickAmount === undefined ? {} : { tickAmount: change.tickAmount }),
    },
  }
}

const commandPatch = (
  command: LivePlayMapEffectCommand,
  revision: number,
  change: AppliedMapEffectsChange,
): LivePlayPatch => change.lane === 'hazards'
  ? hazardPatch(command, revision, change)
  : fieldEffectsPatch(command, revision, change)

const resolveContext = async (
  command: LivePlayMapEffectCommand,
  dependencies: LivePlayMapEffectsDependencySet,
): Promise<ResolvedMapEffectsContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlayMapEffectsCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedMapEffectsContext | null,
): LivePlayMapEffectsCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    hazards: cloneHazards(context.map.hazards),
    fieldEffects: cloneFieldEffects(context.map.fieldEffects),
  } : {}),
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  dependencies: LivePlayMapEffectsDependencySet,
): Promise<ResolvedMapEffectsContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map) return null
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
    }
  } catch {
    return null
  }
}

export const executeLivePlayMapEffectsCommandUseCase = async (
  input: ExecuteLivePlayMapEffectsCommandInput,
  dependencies: LivePlayMapEffectsCommandDependencies = {},
): Promise<LivePlayMapEffectsCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedMapEffectsContext | null = null

  const result = await deps.commandExecutor.execute<LivePlayMapEffectCommand, ResolvedMapEffectsContext, LivePlayMapEffectsCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
    },
    readMap: ({ command }) => resolveContext(command, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertMapEffectsCommandType(command, input.expectedType)
      validateCommandPayloadAndScopes(command)
      if (actor.role !== 'gm') {
        rejectLivePlayCommand('unauthorized', 'Only GMs can manage hazards and field effects')
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const change = applyMapEffectsChange(command, map, deps.now())
      const revision = nextRevision(currentRevision)
      const nextMap = {
        ...map,
        map: {
          ...change.nextMap,
          revision,
        },
      }

      return {
        status: 'accepted',
        nextMap,
        previousRevision: currentRevision,
        revision,
        patches: [commandPatch(command, revision, change)],
      }
    },
    persist: () => {
      throw new Error('live-play map-effects commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, currentRevision, nextMap, result, saveOpResult }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.map.folder ?? '', deps.now(), { revision: result.revision })
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        staleError: () => new LivePlayMapEffectsCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play map-effects command could be persisted`),
        missingMapError: () => new LivePlayMapEffectsCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play map-effects command`),
        saveOpResult,
      })
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: authoritativeMap,
      }
      void actor
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, deps) : null)
  return responseFromContext(result, responseContext)
}
