import type {
  MapFieldEffects,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
} from '~/types/map'
import type { MoveAutomationFieldEffectApply } from '~/types/moveAutomation'
import {
  MAP_ROOM_DEFINITIONS,
  MAP_TERRAIN_DEFINITIONS,
  MAP_WEATHER_DEFINITIONS,
  isMapRoomKind,
  isMapTerrainKind,
  isMapWeatherKind,
} from '~/utils/mapFieldEffectDefinitions'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeRounds = (value: unknown, fallback: number): number | null => {
  if (value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

const normalizeSource = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

export const createMapWeatherEffect = (kind: MapWeatherKind): MapWeatherEffect => ({
  kind,
  rounds: MAP_WEATHER_DEFINITIONS[kind].defaultRounds,
})

export const createMapTerrainEffect = (kind: MapTerrainKind): MapTerrainEffect => ({
  kind,
  rounds: MAP_TERRAIN_DEFINITIONS[kind].defaultRounds,
  scope: 'field',
})

export const createMapRoomEffect = (kind: MapRoomKind): MapRoomEffect => ({
  kind,
  rounds: MAP_ROOM_DEFINITIONS[kind].defaultRounds,
  startsNextRound: kind === 'trick' ? true : undefined,
})

const normalizeWeatherEffect = (value: unknown): MapWeatherEffect | null => {
  if (!isRecord(value) || !isMapWeatherKind(value.kind)) return null
  const out: MapWeatherEffect = {
    kind: value.kind,
    rounds: normalizeRounds(value.rounds, MAP_WEATHER_DEFINITIONS[value.kind].defaultRounds),
  }
  const source = normalizeSource(value.source)
  if (source) out.source = source
  return out
}

const normalizeTerrainEffect = (value: unknown): MapTerrainEffect | null => {
  if (!isRecord(value) || !isMapTerrainKind(value.kind)) return null
  const out: MapTerrainEffect = {
    kind: value.kind,
    rounds: normalizeRounds(value.rounds, MAP_TERRAIN_DEFINITIONS[value.kind].defaultRounds),
    scope: value.scope === 'field' || value.scope === 'area' ? value.scope : 'field',
  }
  const source = normalizeSource(value.source)
  if (source) out.source = source
  return out
}

const normalizeRoomEffect = (value: unknown): MapRoomEffect | null => {
  if (!isRecord(value) || !isMapRoomKind(value.kind)) return null
  const out: MapRoomEffect = {
    kind: value.kind,
    rounds: normalizeRounds(value.rounds, MAP_ROOM_DEFINITIONS[value.kind].defaultRounds),
  }
  if (typeof value.startsNextRound === 'boolean') out.startsNextRound = value.startsNextRound
  else if (value.kind === 'trick') out.startsNextRound = true
  const source = normalizeSource(value.source)
  if (source) out.source = source
  return out
}

const dedupeByKind = <T extends { kind: string }>(effects: T[]): T[] => {
  const byKind = new Map<string, T>()
  for (const effect of effects) byKind.set(effect.kind, effect)
  return Array.from(byKind.values())
}

export const normalizeMapFieldEffects = (value: unknown): MapFieldEffects => {
  const record = isRecord(value) ? value : {}
  const weather = Array.isArray(record.weather)
    ? dedupeByKind(record.weather.map(normalizeWeatherEffect).filter((item): item is MapWeatherEffect => Boolean(item)))
    : []
  const terrains = Array.isArray(record.terrains)
    ? dedupeByKind(record.terrains.map(normalizeTerrainEffect).filter((item): item is MapTerrainEffect => Boolean(item)))
    : []
  const rooms = Array.isArray(record.rooms)
    ? dedupeByKind(record.rooms.map(normalizeRoomEffect).filter((item): item is MapRoomEffect => Boolean(item)))
    : []

  return { weather, terrains, rooms }
}

export const mapFieldEffectCount = (effects: MapFieldEffects | null | undefined): number =>
  (effects?.weather?.length ?? 0) + (effects?.terrains?.length ?? 0) + (effects?.rooms?.length ?? 0)

export type MoveFieldEffectApplicationFailureCode = 'invalid-field-effect'

export interface ApplyMoveFieldEffectSuccess {
  readonly ok: true
  readonly fieldEffects: MapFieldEffects
}

export interface ApplyMoveFieldEffectFailure {
  readonly ok: false
  readonly code: MoveFieldEffectApplicationFailureCode
  readonly message: string
}

export type ApplyMoveFieldEffectResult = ApplyMoveFieldEffectSuccess | ApplyMoveFieldEffectFailure

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

export const cloneMapFieldEffects = (effects: MapFieldEffects | null | undefined): Required<MapFieldEffects> => {
  const normalized = normalizeMapFieldEffects(effects)
  return {
    weather: (normalized.weather ?? []).map(cloneWeatherEffect),
    terrains: (normalized.terrains ?? []).map(cloneTerrainEffect),
    rooms: (normalized.rooms ?? []).map(cloneRoomEffect),
  }
}

const withMoveAutomationSource = <TEffect extends { source?: string }>(
  effect: TEffect,
  source: string | undefined,
): TEffect => ({
  ...effect,
  source: source?.trim() || 'Move automation',
})

export const applyMoveFieldEffectToFieldEffects = (
  effects: MapFieldEffects | null | undefined,
  effect: MoveAutomationFieldEffectApply,
): ApplyMoveFieldEffectResult => {
  const current = cloneMapFieldEffects(effects)
  const source = effect.source

  if (effect.kind === 'weather') {
    if (!isMapWeatherKind(effect.value)) {
      return { ok: false, code: 'invalid-field-effect', message: `Invalid generated weather effect ${String(effect.value)}.` }
    }
    current.weather = [withMoveAutomationSource(createMapWeatherEffect(effect.value), source)]
    return { ok: true, fieldEffects: current }
  }

  if (effect.kind === 'terrain') {
    if (!isMapTerrainKind(effect.value)) {
      return { ok: false, code: 'invalid-field-effect', message: `Invalid generated terrain effect ${String(effect.value)}.` }
    }
    const terrain = withMoveAutomationSource(createMapTerrainEffect(effect.value), source)
    current.terrains = [...current.terrains.filter((item) => item.kind !== terrain.kind), terrain]
    return { ok: true, fieldEffects: current }
  }

  if (effect.kind === 'room') {
    if (!isMapRoomKind(effect.value)) {
      return { ok: false, code: 'invalid-field-effect', message: `Invalid generated room effect ${String(effect.value)}.` }
    }
    const room = withMoveAutomationSource(createMapRoomEffect(effect.value), source)
    current.rooms = [...current.rooms.filter((item) => item.kind !== room.kind), room]
    return { ok: true, fieldEffects: current }
  }

  return { ok: false, code: 'invalid-field-effect', message: `Invalid generated field effect kind ${String((effect as { kind?: unknown }).kind)}.` }
}
