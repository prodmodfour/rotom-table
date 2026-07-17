import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterSideId,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_ZONE_LIMITS,
  isEncounterGlobalFieldZone,
  type EncounterGlobalFieldKind,
  type EncounterGlobalFieldZone,
  type EncounterZoneDuration,
  type EncounterZoneOperationSource,
} from '#shared/moveAutomation/encounterZones'
import type {
  MapFieldEffects,
  MapRoomEffect,
  MapTerrainEffect,
  MapWeatherEffect,
  TabletopMap,
} from '~/types/map'
import {
  isMapRoomKind,
  isMapTerrainKind,
  isMapWeatherKind,
} from '~/utils/mapFieldEffectDefinitions'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { deepCloneJson } from '~/utils/serialization'
import { adaptLegacyMapStateToBattlefieldZones } from './battlefieldZones'
import {
  advanceEncounterGlobalFields,
  applyEncounterGlobalField,
  createEncounterGlobalFieldZone,
  encounterGlobalFieldId,
  removeEncounterGlobalFields,
  type GlobalFieldLifecycleEvent,
  type GlobalFieldLifecycleResult,
  type GlobalFieldReplacementScope,
} from './fieldLifecycle'

export interface MapGlobalFieldLifecycleResult {
  readonly map: TabletopMap
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly previousFieldEffects: Required<MapFieldEffects>
  readonly currentFieldEffects: Required<MapFieldEffects>
  readonly lifecycle: GlobalFieldLifecycleResult
}

const fieldIdentity = (kind: EncounterGlobalFieldKind, fieldId: string): string => (
  `${kind}:${fieldId}`
)

const zoneIdentity = (zone: EncounterGlobalFieldZone): string => (
  fieldIdentity(zone.kind, encounterGlobalFieldId(zone))
)

const durationRounds = (duration: EncounterZoneDuration): number | null => (
  duration.kind === 'rounds' ? duration.remaining : null
)

const sourceLabels = (
  effects: MapFieldEffects | null | undefined,
): ReadonlyMap<string, string> => {
  const normalized = cloneMapFieldEffects(effects)
  const labels = new Map<string, string>()
  for (const effect of normalized.weather) {
    if (effect.source) labels.set(fieldIdentity('weather', effect.kind), effect.source)
  }
  for (const effect of normalized.terrains) {
    if (effect.scope !== 'area' && effect.source) {
      labels.set(fieldIdentity('terrain', effect.kind), effect.source)
    }
  }
  for (const effect of normalized.rooms) {
    if (effect.source) labels.set(fieldIdentity('room', effect.kind), effect.source)
  }
  return labels
}

const sourceLabelForZone = (
  zone: EncounterGlobalFieldZone,
  labels: ReadonlyMap<string, string>,
): string | undefined => {
  const existing = labels.get(zoneIdentity(zone))
  if (existing) return existing
  if (zone.source.kind === 'operation' && zone.source.moveId) return zone.source.moveId
  return undefined
}

/**
 * Keep the existing renderer/editor lane as a compatibility projection. It is
 * not the mechanics owner: native zones retain source, side, priority,
 * replacement, suppression, and exact duration policy.
 */
export const projectGlobalFieldZonesToMapEffects = (input: {
  readonly previous: MapFieldEffects | null | undefined
  readonly state: EncounterState
  readonly preferredSource?: ReadonlyMap<string, string>
}): Required<MapFieldEffects> => {
  const previous = cloneMapFieldEffects(input.previous)
  const labels = new Map(sourceLabels(previous))
  for (const [identity, label] of input.preferredSource ?? []) labels.set(identity, label)

  const weather: MapWeatherEffect[] = []
  const terrains: MapTerrainEffect[] = previous.terrains
    .filter(effect => effect.scope === 'area')
    .map(effect => deepCloneJson(effect))
  const rooms: MapRoomEffect[] = []

  for (const zone of input.state.zones) {
    if (!isEncounterGlobalFieldZone(zone)) continue
    const source = sourceLabelForZone(zone, labels)
    const rounds = durationRounds(zone.duration)
    if (zone.kind === 'weather' && isMapWeatherKind(zone.payload.weatherId)) {
      weather.push({
        kind: zone.payload.weatherId,
        rounds,
        ...(source === undefined ? {} : { source }),
      })
      continue
    }
    if (zone.kind === 'terrain' && isMapTerrainKind(zone.payload.terrainId)) {
      terrains.push({
        kind: zone.payload.terrainId,
        scope: 'field',
        rounds,
        ...(source === undefined ? {} : { source }),
      })
      continue
    }
    if (zone.kind === 'room' && isMapRoomKind(zone.payload.roomId)) {
      rooms.push({
        kind: zone.payload.roomId,
        rounds,
        ...(zone.payload.roomId === 'trick' || zone.payload.startsNextRound
          ? { startsNextRound: zone.payload.startsNextRound }
          : {}),
        ...(source === undefined ? {} : { source }),
      })
    }
  }

  return { weather, terrains, rooms }
}

/** Lazily copy query-only legacy global fields into canonical encounter state. */
export const materializeMapGlobalFieldZones = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): EncounterState => {
  const previous = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const nativeIdentities = new Set(
    previous.zones.filter(isEncounterGlobalFieldZone).map(zoneIdentity),
  )
  const adapted = adaptLegacyMapStateToBattlefieldZones(map)
    .filter(isEncounterGlobalFieldZone)
    .filter(zone => !nativeIdentities.has(zoneIdentity(zone)))
  if (adapted.length === 0) return previous
  if (previous.zones.length + adapted.length > ENCOUNTER_ZONE_LIMITS.count) {
    throw new Error(
      `Materializing global fields would exceed ${ENCOUNTER_ZONE_LIMITS.count} encounter zones.`,
    )
  }
  return parseEncounterState({
    ...previous,
    zones: [...previous.zones, ...adapted],
  })
}

const resultFor = (input: {
  readonly map: TabletopMap
  readonly previousEncounterState: EncounterState
  readonly previousFieldEffects: Required<MapFieldEffects>
  readonly currentEncounterState: EncounterState
  readonly lifecycle: GlobalFieldLifecycleResult
  readonly preferredSource?: ReadonlyMap<string, string>
}): MapGlobalFieldLifecycleResult => {
  const currentFieldEffects = projectGlobalFieldZonesToMapEffects({
    previous: input.map.fieldEffects,
    state: input.currentEncounterState,
    preferredSource: input.preferredSource,
  })
  return {
    map: {
      ...deepCloneJson(input.map),
      fieldEffects: deepCloneJson(currentFieldEffects),
      encounterState: deepCloneJson(input.currentEncounterState),
    },
    previousEncounterState: input.previousEncounterState,
    currentEncounterState: input.currentEncounterState,
    previousFieldEffects: input.previousFieldEffects,
    currentFieldEffects,
    lifecycle: input.lifecycle,
  }
}

const assertKnownField = (kind: EncounterGlobalFieldKind, fieldId: string): void => {
  const valid = kind === 'weather'
    ? isMapWeatherKind(fieldId)
    : kind === 'terrain'
      ? isMapTerrainKind(fieldId)
      : isMapRoomKind(fieldId)
  if (!valid) throw new Error(`Unsupported ${kind} global field ${fieldId}.`)
}

/** Apply one field and update its compatibility presentation in the same pure result. */
export const applyMapGlobalField = (input: {
  readonly map: TabletopMap
  readonly kind: EncounterGlobalFieldKind
  readonly fieldId: string
  readonly source: EncounterZoneOperationSource
  readonly sideId: EncounterSideId | null
  readonly duration: EncounterZoneDuration
  readonly replacementGroup: string
  readonly replacementScope: GlobalFieldReplacementScope
  readonly priority?: number
  readonly startsNextRound?: boolean
  readonly sourceLabel?: string
}): MapGlobalFieldLifecycleResult => {
  assertKnownField(input.kind, input.fieldId)
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const previousFieldEffects = cloneMapFieldEffects(input.map.fieldEffects)
  const materialized = materializeMapGlobalFieldZones(input.map)
  const incoming = createEncounterGlobalFieldZone({
    kind: input.kind,
    fieldId: input.fieldId,
    source: input.source,
    sideId: input.sideId,
    duration: input.duration,
    replacementGroup: input.replacementGroup,
    priority: input.priority,
    startsNextRound: input.startsNextRound,
  })
  const lifecycle = applyEncounterGlobalField({
    zones: materialized.zones,
    incoming,
    replacementScope: input.replacementScope,
  })
  const currentEncounterState = parseEncounterState({
    ...materialized,
    zones: lifecycle.zones,
  })
  const preferredSource = input.sourceLabel
    ? new Map([[fieldIdentity(input.kind, input.fieldId), input.sourceLabel]])
    : undefined
  return resultFor({
    map: input.map,
    previousEncounterState,
    previousFieldEffects,
    currentEncounterState,
    lifecycle,
    preferredSource,
  })
}

/** Remove a typed field set while retaining unrelated local Terrain compatibility rows. */
export const removeMapGlobalFields = (input: {
  readonly map: TabletopMap
  readonly matches: (zone: EncounterGlobalFieldZone) => boolean
}): MapGlobalFieldLifecycleResult => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const previousFieldEffects = cloneMapFieldEffects(input.map.fieldEffects)
  const materialized = materializeMapGlobalFieldZones(input.map)
  const lifecycle = removeEncounterGlobalFields({
    zones: materialized.zones,
    matches: input.matches,
  })
  const currentEncounterState = parseEncounterState({
    ...materialized,
    zones: lifecycle.zones,
  })
  return resultFor({
    map: input.map,
    previousEncounterState,
    previousFieldEffects,
    currentEncounterState,
    lifecycle,
  })
}

/** Advance global fields without advancing any unrelated encounter resource. */
export const advanceMapGlobalFields = (input: {
  readonly map: TabletopMap
  readonly event: GlobalFieldLifecycleEvent
}): MapGlobalFieldLifecycleResult => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const previousFieldEffects = cloneMapFieldEffects(input.map.fieldEffects)
  const materialized = materializeMapGlobalFieldZones(input.map)
  const lifecycle = advanceEncounterGlobalFields({
    zones: materialized.zones,
    event: input.event,
  })
  const currentEncounterState = parseEncounterState({
    ...materialized,
    zones: lifecycle.zones,
  })
  return resultFor({
    map: input.map,
    previousEncounterState,
    previousFieldEffects,
    currentEncounterState,
    lifecycle,
  })
}

export const globalFieldMapIdentity = fieldIdentity
