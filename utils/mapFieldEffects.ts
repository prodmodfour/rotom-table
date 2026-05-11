import type {
  MapFieldEffects,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
} from '~/types/map'
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
