import {
  isEncounterSideId,
  parseEncounterState,
  type EncounterState,
} from './moveAutomation/encounterState'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import { isSheetKind, type SheetKind } from './sheets'
import {
  parseLivePlayResolvedMoveResult,
  type LivePlayResolvedMoveResult,
} from './livePlayMoveResolution'
import {
  createLivePlayMovePresentationSummary,
  parseLivePlayMovePresentationSummary,
  type LivePlayMovePresentationSummary,
} from './livePlayMovePresentation'
import type {
  GridAnchor,
  InitiativeTrackerState,
  MapFieldEffects,
  MapHazardV2,
  MapSceneState,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'

export const LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT = 128 as const

export const LIVE_PLAY_MOVE_SHEET_CHANGED_FIELDS = [
  'moveUsage',
  'movelist',
  'hp',
  'combatStages',
  'conditions',
  'items',
  'inventory',
  'equipmentSlots',
  'digestion',
  'abilityUsage',
  'berryStorage',
] as const

export type LivePlayMoveSheetChangedField =
  (typeof LIVE_PLAY_MOVE_SHEET_CHANGED_FIELDS)[number]

export interface LivePlayMoveSheetChangeRef {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly placementIds: readonly string[]
  readonly changedFields: readonly LivePlayMoveSheetChangedField[]
}

export interface LivePlayMoveStatePatchChanges {
  readonly placements?: {
    readonly previous: readonly SheetPlacement[]
    readonly current: readonly SheetPlacement[]
  }

  readonly temporaryHitPoints?: {
    readonly previous: TabletopMap['temporaryHitPoints'] | null
    readonly current: TabletopMap['temporaryHitPoints'] | null
  }

  readonly moveUsage?: {
    readonly previous: TabletopMap['moveUsage'] | null
    readonly current: TabletopMap['moveUsage'] | null
  }

  readonly hazards?: {
    readonly previous: readonly MapHazardV2[]
    readonly current: readonly MapHazardV2[]
  }

  readonly fieldEffects?: {
    readonly previous: MapFieldEffects
    readonly current: MapFieldEffects
  }

  readonly metadata?: {
    readonly previous: Record<string, unknown> | null
    readonly current: Record<string, unknown> | null
  }

  readonly initiative?: {
    readonly previous: InitiativeTrackerState | null
    readonly current: InitiativeTrackerState | null
  }

  readonly encounterState?: {
    readonly previous: EncounterState
    readonly current: EncounterState
  }
}

export interface LivePlayMoveStatePatchPayload {
  readonly command: 'resolveMove'
  readonly updatedAt: number
  readonly move: LivePlayResolvedMoveResult
  readonly presentation: LivePlayMovePresentationSummary
  readonly sheets: readonly LivePlayMoveSheetChangeRef[]
  readonly changes: LivePlayMoveStatePatchChanges
}

export type LivePlayMoveStatePatchPayloadValidationCode =
  | 'not-object'
  | 'missing-field'
  | 'invalid-field'
  | 'duplicate-sheet-ref'
  | 'duplicate-placement-id'

export interface LivePlayMoveStatePatchPayloadValidationIssue {
  readonly path: string
  readonly code: LivePlayMoveStatePatchPayloadValidationCode
  readonly message: string
}

export interface ParseLivePlayMoveStatePatchPayloadSuccess {
  readonly valid: true
  readonly payload: LivePlayMoveStatePatchPayload
  readonly issues: readonly []
}

export interface ParseLivePlayMoveStatePatchPayloadFailure {
  readonly valid: false
  readonly issues: readonly LivePlayMoveStatePatchPayloadValidationIssue[]
}

export type ParseLivePlayMoveStatePatchPayloadResult =
  | ParseLivePlayMoveStatePatchPayloadSuccess
  | ParseLivePlayMoveStatePatchPayloadFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayMoveStatePatchPayloadValidationIssue[]
type JsonValue = null | string | number | boolean | JsonValue[] | { readonly [key: string]: JsonValue }

const SHEET_CHANGED_FIELDS = new Set<unknown>(LIVE_PLAY_MOVE_SHEET_CHANGED_FIELDS)
const TOKEN_FACING_DIRECTIONS = new Set<unknown>(['north-east', 'south-east', 'south-west', 'north-west'])
const HAZARD_KINDS = new Set<unknown>(['spikes', 'toxic-spikes', 'sticky-web', 'stealth-rock', 'fire'])
const WEATHER_KINDS = new Set<unknown>(['sunny', 'rainy', 'hail', 'sandstorm'])
const TERRAIN_KINDS = new Set<unknown>(['electric', 'grassy', 'misty', 'psychic'])
const ROOM_KINDS = new Set<unknown>(['magic', 'trick', 'wonder', 'gravity'])
const MAP_TRACKED_FREQUENCIES = new Set<unknown>(['eot', 'scene', 'daily'])

const PLACEMENT_FIELDS = new Set(['id', 'sheetKind', 'sheetSlug', 'position', 'sideId', 'initiative', 'facing', 'turned'])
const FIELD_EFFECT_FIELDS = new Set(['weather', 'terrains', 'rooms'])
const WEATHER_EFFECT_FIELDS = new Set(['kind', 'rounds', 'source'])
const TERRAIN_EFFECT_FIELDS = new Set(['kind', 'scope', 'rounds', 'source'])
const ROOM_EFFECT_FIELDS = new Set(['kind', 'rounds', 'startsNextRound', 'source'])

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: LivePlayMoveStatePatchPayloadValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const requireField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: MutableIssueList,
): boolean => {
  if (hasOwn(record, key)) return true
  addIssue(issues, path, 'missing-field', `${path} is required.`)
  return false
}

const rejectUnknownFields = (
  record: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: MutableIssueList,
): void => {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue
    addIssue(issues, path ? `${path}.${key}` : key, 'invalid-field', `${path ? `${path}.` : ''}${key} is not a supported field.`)
  }
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const parseNonEmptyString = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): string | null => {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  const text = value.trim()
  if (!text) {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty string.`)
    return null
  }
  return text
}

const parseSlug = (value: unknown, path: string, issues: MutableIssueList): string | null => {
  if (!isSlug(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must match ${SLUG_PATTERN_DESCRIPTION}.`)
    return null
  }
  return value
}

const parseRevision = (value: unknown, path: string, issues: MutableIssueList): number | null => {
  if (!isSafeNonNegativeInteger(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a safe non-negative integer revision.`)
    return null
  }
  return value
}

const parseGridAnchor = (value: unknown, path: string, issues: MutableIssueList): GridAnchor | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an object with x, y, and z.`)
    return null
  }
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)) {
    addIssue(issues, path, 'invalid-field', `${path} must contain safe integer x, y, and z values.`)
    return null
  }
  return { x: value.x as number, y: value.y as number, z: value.z as number }
}

const parseSheetPlacement = (value: unknown, path: string, issues: MutableIssueList): SheetPlacement | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a placement object.`)
    return null
  }
  rejectUnknownFields(value, PLACEMENT_FIELDS, path, issues)

  const id = parseNonEmptyString(value.id, `${path}.id`, issues)
  const sheetKind = isSheetKind(value.sheetKind) ? value.sheetKind : null
  if (!sheetKind) addIssue(issues, `${path}.sheetKind`, 'invalid-field', `${path}.sheetKind must be pokemon or trainer.`)
  const sheetSlug = parseSlug(value.sheetSlug, `${path}.sheetSlug`, issues)
  const position = parseGridAnchor(value.position, `${path}.position`, issues)

  if (hasOwn(value, 'sideId') && !isEncounterSideId(value.sideId)) {
    addIssue(issues, `${path}.sideId`, 'invalid-field', `${path}.sideId must be a valid encounter side ID.`)
  }
  if (hasOwn(value, 'initiative') && value.initiative !== null && !Number.isFinite(value.initiative)) {
    addIssue(issues, `${path}.initiative`, 'invalid-field', `${path}.initiative must be a finite number or null.`)
  }
  if (hasOwn(value, 'facing') && !TOKEN_FACING_DIRECTIONS.has(value.facing)) {
    addIssue(issues, `${path}.facing`, 'invalid-field', `${path}.facing must be a token-facing direction.`)
  }
  if (hasOwn(value, 'turned') && typeof value.turned !== 'boolean') {
    addIssue(issues, `${path}.turned`, 'invalid-field', `${path}.turned must be boolean when present.`)
  }

  if (!id || !sheetKind || !sheetSlug || !position) return null
  return {
    id,
    sheetKind,
    sheetSlug,
    position,
    ...(isEncounterSideId(value.sideId) ? { sideId: value.sideId } : {}),
    ...(hasOwn(value, 'initiative') && (typeof value.initiative === 'number' || value.initiative === null) ? { initiative: value.initiative } : {}),
    ...(TOKEN_FACING_DIRECTIONS.has(value.facing) ? { facing: value.facing as SheetPlacement['facing'] } : {}),
    ...(typeof value.turned === 'boolean' ? { turned: value.turned } : {}),
  }
}

const parsePlacementArray = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): SheetPlacement[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array of placements.`)
    return null
  }
  const placements: SheetPlacement[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const placement = parseSheetPlacement(item, `${path}[${index}]`, issues)
    if (!placement) continue
    if (seen.has(placement.id)) {
      addIssue(issues, `${path}[${index}].id`, 'duplicate-placement-id', `Placement id ${placement.id} appears more than once.`)
      continue
    }
    seen.add(placement.id)
    placements.push(placement)
  }
  return placements
}

const parseJsonValue = (value: unknown, path: string, issues: MutableIssueList): JsonValue | null => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      addIssue(issues, path, 'invalid-field', `${path} must be JSON-serializable.`)
      return null
    }
    return value
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = []
    for (const [index, item] of value.entries()) {
      const parsed = parseJsonValue(item, `${path}[${index}]`, issues)
      if (parsed !== null || item === null) items.push(parsed)
    }
    return items
  }
  if (isRecord(value)) {
    const record: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value)) {
      const parsed = parseJsonValue(item, `${path}.${key}`, issues)
      if (parsed !== null || item === null) record[key] = parsed
    }
    return record
  }
  addIssue(issues, path, 'invalid-field', `${path} must be JSON-serializable.`)
  return null
}

const parseJsonRecordOrNull = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): Record<string, unknown> | null => {
  if (value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an object or null.`)
    return null
  }
  const parsed = parseJsonValue(value, path, issues)
  return isRecord(parsed) ? cloneJson(parsed) : null
}

const parseEncounterStateValue = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): EncounterState | null => {
  try {
    return parseEncounterState(value)
  }
  catch (error) {
    addIssue(
      issues,
      path,
      'invalid-field',
      `${path} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

const parseSceneState = (value: unknown, path: string, issues: MutableIssueList): MapSceneState | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a scene object.`)
    return null
  }
  const name = parseNonEmptyString(value.name, `${path}.name`, issues)
  if (hasOwn(value, 'startedAt') && !isSafeNonNegativeInteger(value.startedAt)) {
    addIssue(issues, `${path}.startedAt`, 'invalid-field', `${path}.startedAt must be a safe non-negative integer when present.`)
  }
  if (!name) return null
  return {
    name,
    ...(isSafeNonNegativeInteger(value.startedAt) ? { startedAt: value.startedAt } : {}),
  }
}

const parseTemporaryHitPointsState = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): TabletopMap['temporaryHitPoints'] | null => {
  if (value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a temporary-HP object or null.`)
    return null
  }
  const scene = parseSceneState(value.scene, `${path}.scene`, issues)
  if (!isRecord(value.byPlacementId)) {
    addIssue(issues, `${path}.byPlacementId`, 'invalid-field', `${path}.byPlacementId must be an object.`)
    return null
  }
  const byPlacementId: Record<string, number> = {}
  for (const [placementId, amount] of Object.entries(value.byPlacementId)) {
    if (!placementId.trim()) {
      addIssue(issues, `${path}.byPlacementId`, 'invalid-field', `${path}.byPlacementId keys must be non-empty placement ids.`)
      continue
    }
    if (!isSafeNonNegativeInteger(amount)) {
      addIssue(issues, `${path}.byPlacementId.${placementId}`, 'invalid-field', `${path}.byPlacementId.${placementId} must be a safe non-negative integer.`)
      continue
    }
    byPlacementId[placementId] = amount
  }
  if (!scene) return null
  return { scene, byPlacementId }
}

const parseMoveUsageState = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): TabletopMap['moveUsage'] | null => {
  if (value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a move-usage object or null.`)
    return null
  }
  const scene = hasOwn(value, 'scene') ? parseSceneState(value.scene, `${path}.scene`, issues) : null
  if (!isRecord(value.byPlacementId)) {
    addIssue(issues, `${path}.byPlacementId`, 'invalid-field', `${path}.byPlacementId must be an object.`)
    return null
  }
  const byPlacementId: NonNullable<TabletopMap['moveUsage']>['byPlacementId'] = {}
  for (const [placementId, moves] of Object.entries(value.byPlacementId)) {
    if (!placementId.trim()) {
      addIssue(issues, `${path}.byPlacementId`, 'invalid-field', `${path}.byPlacementId keys must be non-empty placement ids.`)
      continue
    }
    if (!isRecord(moves)) {
      addIssue(issues, `${path}.byPlacementId.${placementId}`, 'invalid-field', `${path}.byPlacementId.${placementId} must be an object.`)
      continue
    }
    const entries: Record<string, NonNullable<TabletopMap['moveUsage']>['byPlacementId'][string][string]> = {}
    for (const [moveKey, entry] of Object.entries(moves)) {
      if (!moveKey.trim()) {
        addIssue(issues, `${path}.byPlacementId.${placementId}`, 'invalid-field', 'Move usage keys must be non-empty strings.')
        continue
      }
      if (!isRecord(entry)) {
        addIssue(issues, `${path}.byPlacementId.${placementId}.${moveKey}`, 'invalid-field', 'Move usage entries must be objects.')
        continue
      }
      const moveName = parseNonEmptyString(entry.moveName, `${path}.byPlacementId.${placementId}.${moveKey}.moveName`, issues)
      if (!MAP_TRACKED_FREQUENCIES.has(entry.frequency)) {
        addIssue(issues, `${path}.byPlacementId.${placementId}.${moveKey}.frequency`, 'invalid-field', 'Move usage frequency must be eot, scene, or daily.')
      }
      if (!isSafeNonNegativeInteger(entry.uses)) {
        addIssue(issues, `${path}.byPlacementId.${placementId}.${moveKey}.uses`, 'invalid-field', 'Move usage uses must be a safe non-negative integer.')
      }
      if (hasOwn(entry, 'lastUsedRound') && entry.lastUsedRound !== null && !isSafeNonNegativeInteger(entry.lastUsedRound)) {
        addIssue(issues, `${path}.byPlacementId.${placementId}.${moveKey}.lastUsedRound`, 'invalid-field', 'Move usage lastUsedRound must be null or a safe non-negative integer.')
      }
      if (hasOwn(entry, 'updatedAt') && !isSafeNonNegativeInteger(entry.updatedAt)) {
        addIssue(issues, `${path}.byPlacementId.${placementId}.${moveKey}.updatedAt`, 'invalid-field', 'Move usage updatedAt must be a safe non-negative integer.')
      }
      if (!moveName || !MAP_TRACKED_FREQUENCIES.has(entry.frequency) || !isSafeNonNegativeInteger(entry.uses)) continue
      entries[moveKey] = {
        moveName,
        frequency: entry.frequency as NonNullable<TabletopMap['moveUsage']>['byPlacementId'][string][string]['frequency'],
        uses: entry.uses,
        ...(entry.lastUsedRound === null || isSafeNonNegativeInteger(entry.lastUsedRound) ? { lastUsedRound: entry.lastUsedRound } : {}),
        ...(isSafeNonNegativeInteger(entry.updatedAt) ? { updatedAt: entry.updatedAt } : {}),
      }
    }
    byPlacementId[placementId] = entries
  }
  return {
    ...(scene ? { scene } : {}),
    byPlacementId,
  }
}

const parseHazard = (value: unknown, path: string, issues: MutableIssueList): MapHazardV2 | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a hazard object.`)
    return null
  }
  if (!HAZARD_KINDS.has(value.kind)) addIssue(issues, `${path}.kind`, 'invalid-field', `${path}.kind is not a supported hazard kind.`)
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)) {
    addIssue(issues, path, 'invalid-field', `${path} must contain safe integer x, y, and z.`)
  }
  if (hasOwn(value, 'layer') && !isSafeNonNegativeInteger(value.layer)) {
    addIssue(issues, `${path}.layer`, 'invalid-field', `${path}.layer must be a safe non-negative integer when present.`)
  }
  if (hasOwn(value, 'owner') && typeof value.owner !== 'string') {
    addIssue(issues, `${path}.owner`, 'invalid-field', `${path}.owner must be a string when present.`)
  }
  if (!HAZARD_KINDS.has(value.kind) || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) || !Number.isSafeInteger(value.z)) return null
  return {
    kind: value.kind as MapHazardV2['kind'],
    x: value.x as number,
    y: value.y as number,
    z: value.z as number,
    ...(isSafeNonNegativeInteger(value.layer) ? { layer: value.layer } : {}),
    ...(typeof value.owner === 'string' ? { owner: value.owner } : {}),
  }
}

const parseHazards = (value: unknown, path: string, issues: MutableIssueList): MapHazardV2[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a hazard array.`)
    return null
  }
  const hazards: MapHazardV2[] = []
  for (const [index, item] of value.entries()) {
    const hazard = parseHazard(item, `${path}[${index}]`, issues)
    if (hazard) hazards.push(hazard)
  }
  return hazards
}

const parseOptionalRounds = (value: unknown, path: string, issues: MutableIssueList): number | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!isSafeNonNegativeInteger(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be null or a safe non-negative integer.`)
    return undefined
  }
  return value
}

const parseSource = (value: unknown, path: string, issues: MutableIssueList): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    addIssue(issues, path, 'invalid-field', `${path} must be a string when present.`)
    return undefined
  }
  return value
}

const parseFieldEffectArray = <TKind extends string, TEffect extends Record<string, unknown>>(
  value: unknown,
  path: string,
  kindSet: ReadonlySet<unknown>,
  allowedFields: ReadonlySet<string>,
  create: (record: UnknownRecord, kind: TKind, rounds: number | null | undefined, source: string | undefined) => TEffect | null,
  issues: MutableIssueList,
): TEffect[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }
  const effects: TEffect[] = []
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) {
      addIssue(issues, itemPath, 'invalid-field', `${itemPath} must be an object.`)
      continue
    }
    rejectUnknownFields(item, allowedFields, itemPath, issues)
    if (!kindSet.has(item.kind)) {
      addIssue(issues, `${itemPath}.kind`, 'invalid-field', `${itemPath}.kind is not supported.`)
      continue
    }
    const rounds = parseOptionalRounds(item.rounds, `${itemPath}.rounds`, issues)
    const source = parseSource(item.source, `${itemPath}.source`, issues)
    const effect = create(item, item.kind as TKind, rounds, source)
    if (effect) effects.push(effect)
  }
  return effects
}

const parseFieldEffects = (value: unknown, path: string, issues: MutableIssueList): MapFieldEffects | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a field-effects object.`)
    return null
  }
  rejectUnknownFields(value, FIELD_EFFECT_FIELDS, path, issues)
  const fieldEffects: MapFieldEffects = {}
  if (hasOwn(value, 'weather')) {
    const weather = parseFieldEffectArray(
      value.weather,
      `${path}.weather`,
      WEATHER_KINDS,
      WEATHER_EFFECT_FIELDS,
      (_record, kind: MapFieldEffects['weather'] extends (infer T)[] | undefined ? T extends { kind: infer K } ? K & string : never : never, rounds, source) => ({
        kind,
        ...(rounds !== undefined ? { rounds } : {}),
        ...(source !== undefined ? { source } : {}),
      }),
      issues,
    )
    if (weather) fieldEffects.weather = weather as MapFieldEffects['weather']
  }
  if (hasOwn(value, 'terrains')) {
    const terrains = parseFieldEffectArray(
      value.terrains,
      `${path}.terrains`,
      TERRAIN_KINDS,
      TERRAIN_EFFECT_FIELDS,
      (record, kind: MapFieldEffects['terrains'] extends (infer T)[] | undefined ? T extends { kind: infer K } ? K & string : never : never, rounds, source) => {
        if (hasOwn(record, 'scope') && record.scope !== 'field' && record.scope !== 'area') {
          addIssue(issues, `${path}.terrains.scope`, 'invalid-field', 'Terrain scope must be field or area when present.')
          return null
        }
        return {
          kind,
          ...(record.scope === 'field' || record.scope === 'area' ? { scope: record.scope } : {}),
          ...(rounds !== undefined ? { rounds } : {}),
          ...(source !== undefined ? { source } : {}),
        }
      },
      issues,
    )
    if (terrains) fieldEffects.terrains = terrains as MapFieldEffects['terrains']
  }
  if (hasOwn(value, 'rooms')) {
    const rooms = parseFieldEffectArray(
      value.rooms,
      `${path}.rooms`,
      ROOM_KINDS,
      ROOM_EFFECT_FIELDS,
      (record, kind: MapFieldEffects['rooms'] extends (infer T)[] | undefined ? T extends { kind: infer K } ? K & string : never : never, rounds, source) => {
        if (hasOwn(record, 'startsNextRound') && typeof record.startsNextRound !== 'boolean') {
          addIssue(issues, `${path}.rooms.startsNextRound`, 'invalid-field', 'Room startsNextRound must be boolean when present.')
          return null
        }
        return {
          kind,
          ...(rounds !== undefined ? { rounds } : {}),
          ...(record.startsNextRound === true || record.startsNextRound === false ? { startsNextRound: record.startsNextRound } : {}),
          ...(source !== undefined ? { source } : {}),
        }
      },
      issues,
    )
    if (rooms) fieldEffects.rooms = rooms as MapFieldEffects['rooms']
  }
  return fieldEffects
}

const parseStringArray = (value: unknown, path: string, issues: MutableIssueList): string[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array of non-empty strings.`)
    return null
  }
  const strings: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const text = parseNonEmptyString(item, `${path}[${index}]`, issues)
    if (!text) continue
    if (seen.has(text)) {
      addIssue(issues, `${path}[${index}]`, 'duplicate-placement-id', `${path} contains duplicate value ${text}.`)
      continue
    }
    seen.add(text)
    strings.push(text)
  }
  return strings
}

const parseChangedFields = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayMoveSheetChangedField[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, path, 'invalid-field', `${path} must be a non-empty array of changed sheet fields.`)
    return null
  }
  const fields: LivePlayMoveSheetChangedField[] = []
  const seen = new Set<LivePlayMoveSheetChangedField>()
  for (const [index, item] of value.entries()) {
    if (!SHEET_CHANGED_FIELDS.has(item)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'invalid-field',
        `${path}[${index}] must be one of ${LIVE_PLAY_MOVE_SHEET_CHANGED_FIELDS.join(', ')}.`,
      )
      continue
    }
    const field = item as LivePlayMoveSheetChangedField
    if (seen.has(field)) {
      addIssue(issues, `${path}[${index}]`, 'invalid-field', `${path} contains duplicate field ${field}.`)
      continue
    }
    seen.add(field)
    fields.push(field)
  }
  return fields
}

const parseSheetRef = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayMoveSheetChangeRef | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be a sheet-change object.`)
    return null
  }
  if (!isSheetKind(value.kind)) addIssue(issues, `${path}.kind`, 'invalid-field', `${path}.kind must be pokemon or trainer.`)
  const slug = parseSlug(value.slug, `${path}.slug`, issues)
  const expectedRevision = parseRevision(value.expectedRevision, `${path}.expectedRevision`, issues)
  const revision = parseRevision(value.revision, `${path}.revision`, issues)
  const placementIds = parseStringArray(value.placementIds, `${path}.placementIds`, issues)
  const changedFields = parseChangedFields(value.changedFields, `${path}.changedFields`, issues)
  if (!isSheetKind(value.kind) || !slug || expectedRevision === null || revision === null || !placementIds || !changedFields) return null
  return {
    kind: value.kind,
    slug,
    expectedRevision,
    revision,
    placementIds,
    changedFields,
  }
}

const parseSheetRefs = (value: unknown, path: string, issues: MutableIssueList): LivePlayMoveSheetChangeRef[] | null => {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an array.`)
    return null
  }
  const refs: LivePlayMoveSheetChangeRef[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const ref = parseSheetRef(item, `${path}[${index}]`, issues)
    if (!ref) continue
    const key = `${ref.kind}:${ref.slug}`
    if (seen.has(key)) {
      addIssue(issues, `${path}[${index}]`, 'duplicate-sheet-ref', `Sheet ${key} appears more than once.`)
      continue
    }
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

export type ParseLivePlayMoveSheetChangeRefsResult =
  | {
      readonly valid: true
      readonly sheets: readonly LivePlayMoveSheetChangeRef[]
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly LivePlayMoveStatePatchPayloadValidationIssue[]
    }

/** Reusable strict sheet-reference boundary for move-derived state patches. */
export const parseLivePlayMoveSheetChangeRefs = (
  value: unknown,
): ParseLivePlayMoveSheetChangeRefsResult => {
  const issues: MutableIssueList = []
  const sheets = parseSheetRefs(value, 'sheets', issues)
  return issues.length > 0 || sheets === null
    ? { valid: false, issues }
    : { valid: true, sheets: cloneJson(sheets), issues: [] }
}

const parseLaneChange = <T>(
  record: UnknownRecord,
  key: string,
  path: string,
  parseValue: (value: unknown, valuePath: string, issues: MutableIssueList) => T | null,
  issues: MutableIssueList,
): { readonly previous: T; readonly current: T } | undefined => {
  if (!hasOwn(record, key)) return undefined
  const lanePath = `${path}.${key}`
  const lane = record[key]
  if (!isRecord(lane)) {
    addIssue(issues, lanePath, 'invalid-field', `${lanePath} must be an object with previous and current.`)
    return undefined
  }
  requireField(lane, 'previous', `${lanePath}.previous`, issues)
  requireField(lane, 'current', `${lanePath}.current`, issues)
  const previous = parseValue(lane.previous, `${lanePath}.previous`, issues)
  const current = parseValue(lane.current, `${lanePath}.current`, issues)
  if (previous === null && lane.previous !== null) return undefined
  if (current === null && lane.current !== null) return undefined
  return { previous: previous as T, current: current as T }
}

const parseInitiativeState = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): InitiativeTrackerState | null => {
  if (value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an initiative object or null.`)
    return null
  }
  rejectUnknownFields(value, new Set(['activeId', 'round', 'manualOrderIds']), path, issues)
  if (
    hasOwn(value, 'activeId')
    && value.activeId !== null
    && (typeof value.activeId !== 'string' || !value.activeId.trim())
  ) {
    addIssue(issues, `${path}.activeId`, 'invalid-field', `${path}.activeId must be a placement ID or null.`)
  }
  if (hasOwn(value, 'round') && (!Number.isSafeInteger(value.round) || Number(value.round) < 1)) {
    addIssue(issues, `${path}.round`, 'invalid-field', `${path}.round must be a positive safe integer.`)
  }
  const manualOrderIds = hasOwn(value, 'manualOrderIds')
    ? parseStringArray(value.manualOrderIds, `${path}.manualOrderIds`, issues)
    : undefined
  if (
    (hasOwn(value, 'activeId')
      && value.activeId !== null
      && (typeof value.activeId !== 'string' || !value.activeId.trim()))
    || (hasOwn(value, 'round') && (!Number.isSafeInteger(value.round) || Number(value.round) < 1))
    || (hasOwn(value, 'manualOrderIds') && manualOrderIds === null)
  ) return null
  return {
    ...(hasOwn(value, 'activeId')
      ? { activeId: value.activeId as string | null }
      : {}),
    ...(hasOwn(value, 'round') ? { round: Number(value.round) } : {}),
    ...(manualOrderIds === undefined || manualOrderIds === null
      ? {}
      : { manualOrderIds }),
  }
}

const parseChanges = (value: unknown, path: string, issues: MutableIssueList): LivePlayMoveStatePatchChanges | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-field', `${path} must be an object.`)
    return null
  }
  const changes: LivePlayMoveStatePatchChanges = {}
  const placements = parseLaneChange(value, 'placements', path, parsePlacementArray, issues)
  if (placements) Object.assign(changes, { placements })
  const temporaryHitPoints = parseLaneChange(value, 'temporaryHitPoints', path, parseTemporaryHitPointsState, issues)
  if (temporaryHitPoints) Object.assign(changes, { temporaryHitPoints })
  const moveUsage = parseLaneChange(value, 'moveUsage', path, parseMoveUsageState, issues)
  if (moveUsage) Object.assign(changes, { moveUsage })
  const hazards = parseLaneChange(value, 'hazards', path, parseHazards, issues)
  if (hazards) Object.assign(changes, { hazards })
  const fieldEffects = parseLaneChange(value, 'fieldEffects', path, parseFieldEffects, issues)
  if (fieldEffects) Object.assign(changes, { fieldEffects })
  const metadata = parseLaneChange(value, 'metadata', path, parseJsonRecordOrNull, issues)
  if (metadata) Object.assign(changes, { metadata })
  const initiative = parseLaneChange(value, 'initiative', path, parseInitiativeState, issues)
  if (initiative) Object.assign(changes, { initiative })
  const encounterState = parseLaneChange(
    value,
    'encounterState',
    path,
    parseEncounterStateValue,
    issues,
  )
  if (encounterState) Object.assign(changes, { encounterState })
  return changes
}

export type ParseLivePlayMoveStatePatchChangesResult =
  | {
      readonly valid: true
      readonly changes: LivePlayMoveStatePatchChanges
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly LivePlayMoveStatePatchPayloadValidationIssue[]
    }

/** Reusable strict map-change boundary for move and correction patches. */
export const parseLivePlayMoveStatePatchChanges = (
  value: unknown,
): ParseLivePlayMoveStatePatchChangesResult => {
  const issues: MutableIssueList = []
  const changes = parseChanges(value, 'changes', issues)
  return issues.length > 0 || changes === null
    ? { valid: false, issues }
    : { valid: true, changes: cloneJson(changes), issues: [] }
}

export const parseLivePlayMoveStatePatchPayload = (
  value: unknown,
): ParseLivePlayMoveStatePatchPayloadResult => {
  const issues: MutableIssueList = []
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: '', code: 'not-object', message: 'MOVE_STATE payload must be an object.' }],
    }
  }

  requireField(value, 'command', 'command', issues)
  requireField(value, 'updatedAt', 'updatedAt', issues)
  requireField(value, 'move', 'move', issues)
  requireField(value, 'presentation', 'presentation', issues)
  requireField(value, 'sheets', 'sheets', issues)
  requireField(value, 'changes', 'changes', issues)

  if (value.command !== 'resolveMove') {
    addIssue(issues, 'command', 'invalid-field', 'command must be exactly resolveMove.')
  }
  if (!isSafeNonNegativeInteger(value.updatedAt)) {
    addIssue(issues, 'updatedAt', 'invalid-field', 'updatedAt must be a safe non-negative integer timestamp.')
  }

  const moveResult = parseLivePlayResolvedMoveResult(value.move)
  if (!moveResult.valid) {
    for (const issue of moveResult.issues) {
      addIssue(issues, issue.path ? `move.${issue.path}` : 'move', 'invalid-field', issue.message)
    }
  }
  const presentationResult = parseLivePlayMovePresentationSummary(value.presentation)
  if (!presentationResult.valid) {
    for (const issue of presentationResult.issues) {
      addIssue(
        issues,
        issue.path ? `presentation.${issue.path}` : 'presentation',
        'invalid-field',
        issue.message,
      )
    }
  }
  if (moveResult.valid && presentationResult.valid) {
    try {
      const expectedPresentation = createLivePlayMovePresentationSummary({
        operationId: presentationResult.presentation.operationId,
        move: moveResult.move,
      })
      if (JSON.stringify(expectedPresentation) !== JSON.stringify(presentationResult.presentation)) {
        addIssue(
          issues,
          'presentation',
          'invalid-field',
          'presentation must exactly summarize the resolved move result.',
        )
      }
    } catch (error) {
      addIssue(
        issues,
        'presentation',
        'invalid-field',
        error instanceof Error ? error.message : 'presentation could not summarize the resolved move result.',
      )
    }
  }
  const sheets = parseSheetRefs(value.sheets, 'sheets', issues)
  const changes = parseChanges(value.changes, 'changes', issues)

  if (
    issues.length > 0
    || !moveResult.valid
    || !presentationResult.valid
    || !sheets
    || !changes
    || !isSafeNonNegativeInteger(value.updatedAt)
  ) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    payload: {
      command: 'resolveMove',
      updatedAt: value.updatedAt,
      move: cloneJson(moveResult.move),
      presentation: cloneJson(presentationResult.presentation),
      sheets: cloneJson(sheets),
      changes: cloneJson(changes),
    },
    issues: [],
  }
}

export const isLivePlayMoveStatePatchPayload = (value: unknown): value is LivePlayMoveStatePatchPayload => (
  parseLivePlayMoveStatePatchPayload(value).valid
)
