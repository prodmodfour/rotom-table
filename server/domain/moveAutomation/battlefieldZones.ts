import {
  ENCOUNTER_ZONE_KINDS,
  ENCOUNTER_ZONE_LIMITS,
  isEncounterGlobalFieldZone,
  isEncounterGlobalFieldZoneActive,
  legacyEncounterZoneId,
  parseEncounterZone,
  parseEncounterZones,
  type EncounterZone,
  type EncounterZoneCell,
  type EncounterZoneDamageModifier,
  type EncounterZoneHook,
  type EncounterZoneKind,
  type EncounterZoneMovementModifier,
  type EncounterZoneSource,
  type EncounterZoneTargetingModifier,
} from '#shared/moveAutomation/encounterZones'
import {
  createEmptyEncounterState,
  isEncounterSideId,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'
import { canonicalBattlefieldZoneComponents } from './battlefieldZoneDefinitions'
import type {
  GridDimensions,
  MapHazardKind,
  MapHazardV2,
  MapRoomEffect,
  MapTerrainEffect,
  MapWeatherEffect,
  TabletopMap,
} from '~/types/map'

/**
 * Query-only compatibility projection for legacy hazard and field-effect lanes.
 * Native zones with the same deterministic legacy ID win, so a lazy migration
 * cannot make one battlefield fact apply twice.
 */
export interface BattlefieldZoneProjection {
  /** Complete canonical projection, including retained inactive global fields. */
  readonly zones: readonly EncounterZone[]
  /** Mechanics contributors after suppression and delayed Room activation. */
  readonly activeZones: readonly EncounterZone[]
  readonly inactiveGlobalFieldZoneIds: readonly string[]
  readonly nativeZoneCount: number
  readonly adaptedLegacyZoneCount: number
  readonly shadowedLegacyZoneIds: readonly string[]
}

export type BattlefieldZoneQuerySubject =
  | { readonly kind: 'all' }
  | { readonly kind: 'battlefield' }
  | { readonly kind: 'cell'; readonly cell: EncounterZoneCell }
  | {
      readonly kind: 'placement'
      readonly placementId: string
      readonly sideId: EncounterSideId | null
      readonly occupiedCells: readonly EncounterZoneCell[]
    }
  | { readonly kind: 'side'; readonly sideId: EncounterSideId }

export interface BattlefieldZoneQueryOptions {
  readonly kinds?: readonly EncounterZoneKind[]
  /** Audit/setup queries may inspect retained suppressed or not-yet-started fields. */
  readonly includeInactiveGlobalFields?: boolean
}

export interface BattlefieldZoneContribution<Value> {
  readonly zoneId: string
  readonly zoneKind: EncounterZoneKind
  readonly source: EncounterZoneSource
  readonly sideId: EncounterSideId | null
  readonly value: Value
}

export interface BattlefieldZoneContributions {
  readonly zones: readonly EncounterZone[]
  readonly hooks: {
    readonly entry: readonly BattlefieldZoneContribution<EncounterZoneHook>[]
    readonly exit: readonly BattlefieldZoneContribution<EncounterZoneHook>[]
  }
  readonly modifiers: {
    readonly targeting: readonly BattlefieldZoneContribution<EncounterZoneTargetingModifier>[]
    readonly damage: readonly BattlefieldZoneContribution<EncounterZoneDamageModifier>[]
    readonly movement: readonly BattlefieldZoneContribution<EncounterZoneMovementModifier>[]
  }
}

export type BattlefieldZoneQueryErrorCode =
  | 'invalid-query'
  | 'zone-limit-exceeded'
  | 'invalid-legacy-zone'

export class BattlefieldZoneQueryError extends Error {
  readonly code: BattlefieldZoneQueryErrorCode

  constructor(code: BattlefieldZoneQueryErrorCode, message: string) {
    super(message)
    this.name = 'BattlefieldZoneQueryError'
    this.code = code
  }
}

const fail = (code: BattlefieldZoneQueryErrorCode, message: string): never => {
  throw new BattlefieldZoneQueryError(code, message)
}

const HAZARD_KIND_SET = new Set<MapHazardKind>([
  'spikes',
  'toxic-spikes',
  'sticky-web',
  'stealth-rock',
  'fire',
])
const WEATHER_KIND_SET = new Set(['sunny', 'rainy', 'hail', 'sandstorm'])
const TERRAIN_KIND_SET = new Set(['electric', 'grassy', 'misty', 'psychic'])
const ROOM_KIND_SET = new Set(['magic', 'trick', 'wonder'])
const ZONE_KIND_SET = new Set<unknown>(ENCOUNTER_ZONE_KINDS)
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const emptyHooks = () => ({ entry: [], exit: [] })
const emptyModifiers = () => ({ targeting: [], damage: [], movement: [] })
const permanentDuration = () => ({ kind: 'permanent' as const, remaining: null })
const independentStacking = () => ({ kind: 'independent' as const, maxLayers: null })
const replaceStacking = () => ({ kind: 'replace' as const, maxLayers: null })

const finiteRoundDuration = (
  rounds: number | null | undefined,
): EncounterZone['duration'] | null => {
  if (rounds === null || rounds === undefined) return permanentDuration()
  if (!Number.isSafeInteger(rounds)) {
    return fail('invalid-legacy-zone', 'Legacy field-effect rounds must be a safe integer or null.')
  }
  if (rounds <= 0) return null
  return { kind: 'rounds', boundary: 'end', remaining: rounds }
}

const validLegacyCell = (
  value: Pick<MapHazardV2, 'x' | 'y' | 'z'>,
  dimensions: GridDimensions,
): value is EncounterZoneCell => (
  Number.isSafeInteger(value.x)
  && Number.isSafeInteger(value.y)
  && Number.isSafeInteger(value.z)
  && value.x >= 0
  && value.x < dimensions.x
  && value.y >= 0
  && value.y < dimensions.y
  && value.z >= 0
  && value.z < dimensions.z
)

const legacySource = (
  lane: 'hazards' | 'weather' | 'terrain' | 'room',
  key: string,
) => ({ kind: 'legacy-map' as const, lane, key })

const parseAdaptedZone = (value: unknown, label: string): EncounterZone => {
  try {
    return parseEncounterZone(value, label)
  }
  catch (error) {
    return fail(
      'invalid-legacy-zone',
      `${label} could not be adapted: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const adaptLegacyHazards = (
  hazards: readonly MapHazardV2[] | null | undefined,
  dimensions: GridDimensions,
): readonly EncounterZone[] => {
  const byId = new Map<string, EncounterZone>()
  for (const [index, hazard] of (hazards ?? []).entries()) {
    if (!HAZARD_KIND_SET.has(hazard.kind) || !validLegacyCell(hazard, dimensions)) continue
    const key = `${hazard.kind}.${hazard.x}.${hazard.y}.${hazard.z}`
    const id = legacyEncounterZoneId('hazards', key)
    const layer = hazard.kind === 'toxic-spikes'
      ? Math.min(2, Math.max(1, Number.isSafeInteger(hazard.layer) ? Number(hazard.layer) : 1))
      : 1
    const components = canonicalBattlefieldZoneComponents({
      kind: 'hazard',
      effectId: hazard.kind,
    })
    const candidate = parseAdaptedZone({
      id,
      kind: 'hazard',
      source: legacySource('hazards', key),
      // Legacy free-form owner labels are presentation data, never allegiance.
      sideId: null,
      geometry: {
        kind: 'cells',
        cells: [{ x: hazard.x, y: hazard.y, z: hazard.z }],
      },
      layer,
      duration: permanentDuration(),
      stacking: hazard.kind === 'toxic-spikes'
        ? { kind: 'add-layer', maxLayers: 2 }
        : independentStacking(),
      hooks: components.hooks,
      modifiers: components.modifiers,
      tags: ['legacy-map', 'hazard'],
      payload: {
        hazardId: hazard.kind,
        familyId: hazard.kind,
        charges: null,
        maxCharges: null,
      },
    }, `legacyMap.hazards[${index}]`)
    const existing = byId.get(id)
    if (!existing || candidate.layer > existing.layer) byId.set(id, candidate)
  }
  return [...byId.values()]
}

const adaptLegacyWeather = (
  effects: readonly MapWeatherEffect[] | null | undefined,
): readonly EncounterZone[] => {
  const byId = new Map<string, EncounterZone>()
  const coexisting = (effects?.length ?? 0) > 1
  for (const [index, effect] of (effects ?? []).entries()) {
    if (!WEATHER_KIND_SET.has(effect.kind)) continue
    const duration = finiteRoundDuration(effect.rounds)
    if (!duration) continue
    const key = effect.kind
    const id = legacyEncounterZoneId('weather', key)
    byId.set(id, parseAdaptedZone({
      id,
      kind: 'weather',
      source: legacySource('weather', key),
      sideId: null,
      geometry: { kind: 'battlefield' },
      layer: 1,
      duration,
      stacking: replaceStacking(),
      fieldPolicy: {
        priority: 0,
        replacementGroup: coexisting ? `field.weather.${effect.kind}` : 'field.weather',
        suppression: { sources: [] },
      },
      hooks: emptyHooks(),
      modifiers: emptyModifiers(),
      tags: ['legacy-map', 'weather'],
      payload: { weatherId: effect.kind },
    }, `legacyMap.fieldEffects.weather[${index}]`))
  }
  return [...byId.values()]
}

const adaptLegacyTerrains = (
  effects: readonly MapTerrainEffect[] | null | undefined,
): readonly EncounterZone[] => {
  const byId = new Map<string, EncounterZone>()
  for (const [index, effect] of (effects ?? []).entries()) {
    if (!TERRAIN_KIND_SET.has(effect.kind)) continue
    // The legacy area shape has no cells. Do not invent battlefield-wide mechanics.
    if (effect.scope === 'area') continue
    const duration = finiteRoundDuration(effect.rounds)
    if (!duration) continue
    const key = effect.kind
    const id = legacyEncounterZoneId('terrain', key)
    byId.set(id, parseAdaptedZone({
      id,
      kind: 'terrain',
      source: legacySource('terrain', key),
      sideId: null,
      geometry: { kind: 'battlefield' },
      layer: 1,
      duration,
      stacking: replaceStacking(),
      fieldPolicy: {
        priority: 0,
        replacementGroup: `field.terrain.${effect.kind}`,
        suppression: { sources: [] },
      },
      hooks: emptyHooks(),
      modifiers: emptyModifiers(),
      tags: ['legacy-map', 'terrain'],
      payload: { terrainId: effect.kind },
    }, `legacyMap.fieldEffects.terrains[${index}]`))
  }
  return [...byId.values()]
}

const adaptLegacyRooms = (
  effects: readonly MapRoomEffect[] | null | undefined,
): readonly EncounterZone[] => {
  const byId = new Map<string, EncounterZone>()
  for (const [index, effect] of (effects ?? []).entries()) {
    if (!ROOM_KIND_SET.has(effect.kind)) continue
    const duration = finiteRoundDuration(effect.rounds)
    if (!duration) continue
    const key = effect.kind
    const id = legacyEncounterZoneId('room', key)
    byId.set(id, parseAdaptedZone({
      id,
      kind: 'room',
      source: legacySource('room', key),
      sideId: null,
      geometry: { kind: 'battlefield' },
      layer: 1,
      duration,
      stacking: replaceStacking(),
      fieldPolicy: {
        priority: 0,
        replacementGroup: `field.room.${effect.kind}`,
        suppression: { sources: [] },
      },
      hooks: emptyHooks(),
      modifiers: emptyModifiers(),
      tags: ['legacy-map', 'room'],
      payload: {
        roomId: effect.kind,
        startsNextRound: effect.startsNextRound === true,
      },
    }, `legacyMap.fieldEffects.rooms[${index}]`))
  }
  return [...byId.values()]
}

/**
 * Convert current legacy map lanes to strict query records without persisting
 * them. Invalid/out-of-bounds hazard cells and unlocatable legacy area terrain
 * fail closed by contributing no mechanics zone.
 */
export const adaptLegacyMapStateToBattlefieldZones = (map: Pick<
  TabletopMap,
  'dimensions' | 'hazards' | 'fieldEffects'
>): readonly EncounterZone[] => deepFreeze([
  ...adaptLegacyHazards(map.hazards, map.dimensions),
  ...adaptLegacyWeather(map.fieldEffects?.weather),
  ...adaptLegacyTerrains(map.fieldEffects?.terrains),
  ...adaptLegacyRooms(map.fieldEffects?.rooms),
])

/**
 * Resolve one bounded canonical view. A native zone carrying an adapter's
 * deterministic ID shadows that legacy lane entry while unrelated legacy
 * entries remain queryable during the compatibility period.
 */
export const projectBattlefieldZones = (map: Pick<
  TabletopMap,
  'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'
>): BattlefieldZoneProjection => {
  const native = parseEncounterZones(
    map.encounterState?.zones ?? createEmptyEncounterState().zones,
    'map.encounterState.zones',
  )
  const legacy = adaptLegacyMapStateToBattlefieldZones(map)
  const nativeIds = new Set(native.map(zone => zone.id))
  const globalFieldIdentity = (zone: EncounterZone): string | null => {
    if (!isEncounterGlobalFieldZone(zone)) return null
    if (zone.kind === 'weather') return `weather:${zone.payload.weatherId}`
    if (zone.kind === 'terrain') return `terrain:${zone.payload.terrainId}`
    return `room:${zone.payload.roomId}`
  }
  const nativeGlobalFieldIds = new Set(native.flatMap(zone => {
    const identity = globalFieldIdentity(zone)
    return identity === null ? [] : [identity]
  }))
  const shadowedLegacyZoneIds: string[] = []
  const adaptedLegacy: EncounterZone[] = []
  for (const zone of legacy) {
    const identity = globalFieldIdentity(zone)
    if (nativeIds.has(zone.id) || (identity !== null && nativeGlobalFieldIds.has(identity))) {
      shadowedLegacyZoneIds.push(zone.id)
    }
    else adaptedLegacy.push(zone)
  }
  if (native.length + adaptedLegacy.length > ENCOUNTER_ZONE_LIMITS.count) {
    fail(
      'zone-limit-exceeded',
      `Native and adapted battlefield zones cannot exceed ${ENCOUNTER_ZONE_LIMITS.count} unique entries.`,
    )
  }
  const zones = [...native, ...adaptedLegacy]
  const activeZones = zones.filter(zone => (
    !isEncounterGlobalFieldZone(zone) || isEncounterGlobalFieldZoneActive(zone)
  ))
  return deepFreeze({
    zones,
    activeZones,
    inactiveGlobalFieldZoneIds: zones
      .filter(isEncounterGlobalFieldZone)
      .filter(zone => !isEncounterGlobalFieldZoneActive(zone))
      .map(zone => zone.id),
    nativeZoneCount: native.length,
    adaptedLegacyZoneCount: adaptedLegacy.length,
    shadowedLegacyZoneIds,
  })
}

const validCell = (cell: EncounterZoneCell): boolean => (
  typeof cell === 'object'
  && cell !== null
  && Number.isSafeInteger(cell.x)
  && Number.isSafeInteger(cell.y)
  && Number.isSafeInteger(cell.z)
  && cell.x >= 0
  && cell.y >= 0
  && cell.z >= 0
  && cell.x <= ENCOUNTER_ZONE_LIMITS.coordinate
  && cell.y <= ENCOUNTER_ZONE_LIMITS.coordinate
  && cell.z <= ENCOUNTER_ZONE_LIMITS.coordinate
)

const cellKey = (cell: EncounterZoneCell): string => `${cell.x}:${cell.y}:${cell.z}`

const assertQuery = (subject: BattlefieldZoneQuerySubject): void => {
  if (typeof subject !== 'object' || subject === null) {
    return fail('invalid-query', 'Battlefield zone query subject must be an object.')
  }
  if (subject.kind === 'all' || subject.kind === 'battlefield') return
  if (subject.kind === 'cell') {
    if (!validCell(subject.cell)) fail('invalid-query', 'Battlefield zone query cell is invalid.')
    return
  }
  if (subject.kind === 'side') {
    if (!isEncounterSideId(subject.sideId)) {
      fail('invalid-query', 'Battlefield zone query side is invalid.')
    }
    return
  }
  if (subject.kind !== 'placement') {
    return fail('invalid-query', 'Battlefield zone query kind is unsupported.')
  }
  if (
    typeof subject.placementId !== 'string'
    || subject.placementId.length === 0
    || subject.placementId.length > ENCOUNTER_ZONE_LIMITS.identifierChars
    || subject.placementId.trim() !== subject.placementId
    || CONTROL_CHARACTER_PATTERN.test(subject.placementId)
  ) {
    fail('invalid-query', 'Battlefield zone query placement ID is invalid.')
  }
  if (subject.sideId !== null && !isEncounterSideId(subject.sideId)) {
    fail('invalid-query', 'Battlefield zone query placement side is invalid.')
  }
  if (!Array.isArray(subject.occupiedCells) || subject.occupiedCells.length > ENCOUNTER_ZONE_LIMITS.cells) {
    fail('invalid-query', 'Battlefield zone query occupied cells are invalid or oversized.')
  }
  if (subject.occupiedCells.some(cell => !validCell(cell))) {
    fail('invalid-query', 'Battlefield zone query contains an invalid occupied cell.')
  }
  if (new Set(subject.occupiedCells.map(cellKey)).size !== subject.occupiedCells.length) {
    fail('invalid-query', 'Battlefield zone query occupied cells must be unique.')
  }
}

const queryKinds = (options: BattlefieldZoneQueryOptions): ReadonlySet<EncounterZoneKind> | null => {
  if (options.kinds === undefined) return null
  if (!Array.isArray(options.kinds) || options.kinds.some(kind => !ZONE_KIND_SET.has(kind))) {
    return fail('invalid-query', 'Battlefield zone kind filter is invalid.')
  }
  return new Set(options.kinds)
}

const geometryMatches = (
  zone: EncounterZone,
  subject: BattlefieldZoneQuerySubject,
): boolean => {
  if (subject.kind === 'all') return true
  const geometry = zone.geometry
  if (subject.kind === 'battlefield') return geometry.kind === 'battlefield'
  if (geometry.kind === 'battlefield') return true
  if (subject.kind === 'cell') {
    return geometry.kind === 'cells'
      && geometry.cells.some(cell => cellKey(cell) === cellKey(subject.cell))
  }
  if (subject.kind === 'side') {
    return geometry.kind === 'side' && geometry.sideId === subject.sideId
  }
  if (geometry.kind === 'placement') return geometry.placementId === subject.placementId
  if (geometry.kind === 'side') return subject.sideId !== null && geometry.sideId === subject.sideId
  if (geometry.kind === 'cells') {
    const occupied = new Set(subject.occupiedCells.map(cellKey))
    return geometry.cells.some(cell => occupied.has(cellKey(cell)))
  }
  return false
}

/** Query generalized and compatibility zones in deterministic native-then-legacy order. */
export const queryBattlefieldZones = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
  subject: BattlefieldZoneQuerySubject,
  options: BattlefieldZoneQueryOptions = {},
): readonly EncounterZone[] => {
  assertQuery(subject)
  const kinds = queryKinds(options)
  const projection = projectBattlefieldZones(map)
  const zones = options.includeInactiveGlobalFields
    ? projection.zones
    : projection.activeZones
  return deepFreeze(zones.filter(zone => (
    (kinds === null || kinds.has(zone.kind))
    && geometryMatches(zone, subject)
  )))
}

const contribution = <Value>(
  zone: EncounterZone,
  value: Value,
): BattlefieldZoneContribution<Value> => ({
  zoneId: zone.id,
  zoneKind: zone.kind,
  source: zone.source,
  sideId: zone.sideId,
  value,
})

/** Return all typed hooks and modifiers contributed by the matched zone set. */
export const queryBattlefieldZoneContributions = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
  subject: BattlefieldZoneQuerySubject,
  options: BattlefieldZoneQueryOptions = {},
): BattlefieldZoneContributions => {
  const zones = queryBattlefieldZones(map, subject, options)
  return deepFreeze({
    zones,
    hooks: {
      entry: zones.flatMap(zone => zone.hooks.entry.map(value => contribution(zone, value))),
      exit: zones.flatMap(zone => zone.hooks.exit.map(value => contribution(zone, value))),
    },
    modifiers: {
      targeting: zones.flatMap(zone => (
        zone.modifiers.targeting.map(value => contribution(zone, value))
      )),
      damage: zones.flatMap(zone => (
        zone.modifiers.damage.map(value => contribution(zone, value))
      )),
      movement: zones.flatMap(zone => (
        zone.modifiers.movement.map(value => contribution(zone, value))
      )),
    },
  })
}
