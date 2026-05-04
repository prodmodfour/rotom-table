import type {
  MapFieldEffects,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
} from '~/types/map'

export interface MapEffectDefinition<Kind extends string = string> {
  kind: Kind
  label: string
  shortLabel: string
  color: string
  defaultRounds: number
  description: string
  rules: string
}

export const MAP_WEATHER_KINDS = ['sunny', 'rainy', 'hail', 'sandstorm'] as const satisfies readonly MapWeatherKind[]
export const MAP_TERRAIN_KINDS = ['electric', 'grassy', 'misty', 'psychic'] as const satisfies readonly MapTerrainKind[]
export const MAP_ROOM_KINDS = ['magic', 'trick', 'wonder'] as const satisfies readonly MapRoomKind[]

export const MAP_WEATHER_DEFINITIONS = {
  sunny: {
    kind: 'sunny',
    label: 'Sunny',
    shortLabel: 'Sun',
    color: '#fabd2f',
    defaultRounds: 5,
    description: 'Fire attacks +5 damage; Water attacks -5 damage.',
    rules: 'Fire-Type attacks gain +5 Damage Rolls. Water-Type attacks suffer -5 Damage.',
  },
  rainy: {
    kind: 'rainy',
    label: 'Rainy',
    shortLabel: 'Rain',
    color: '#83a598',
    defaultRounds: 5,
    description: 'Water attacks +5 damage; Fire attacks -5 damage.',
    rules: 'Water-Type attacks gain +5 Damage Rolls. Fire-Type attacks suffer -5 Damage.',
  },
  hail: {
    kind: 'hail',
    label: 'Hail',
    shortLabel: 'Hail',
    color: '#d5c4a1',
    defaultRounds: 5,
    description: 'Non-Ice Pokémon lose a Tick at the start of their turn.',
    rules: 'While Hailing, all non-Ice Type Pokémon lose a Tick of Hit Points at the beginning of their turn.',
  },
  sandstorm: {
    kind: 'sandstorm',
    label: 'Sandstorm',
    shortLabel: 'Sand',
    color: '#d79921',
    defaultRounds: 5,
    description: 'Non-Ground/Rock/Steel Pokémon lose a Tick at the start of their turn.',
    rules: 'While Sandstorming, all non-Ground, Rock, or Steel Type Pokémon lose a Tick of Hit Points at the beginning of their turn.',
  },
} as const satisfies Record<MapWeatherKind, MapEffectDefinition<MapWeatherKind>>

export const MAP_TERRAIN_DEFINITIONS = {
  electric: {
    kind: 'electric',
    label: 'Electric Terrain',
    shortLabel: 'Elec',
    color: '#fabd2f',
    defaultRounds: 5,
    description: 'Grounded targets cannot Sleep; grounded Electric attacks +10 damage.',
    rules: 'Grounded Pokémon and Trainers are immune to Sleep. Electric-Type attacks by grounded users gain +10 Damage Rolls.',
  },
  grassy: {
    kind: 'grassy',
    label: 'Grassy Terrain',
    shortLabel: 'Grass',
    color: '#b8bb26',
    defaultRounds: 5,
    description: 'Grounded targets heal a Tick; grounded Grass attacks +10 damage.',
    rules: 'Grounded Pokémon and Trainers recover a Tick at the start of every turn. Grass-Type attacks by grounded users gain +10 Damage Rolls.',
  },
  misty: {
    kind: 'misty',
    label: 'Misty Terrain',
    shortLabel: 'Misty',
    color: '#d3869b',
    defaultRounds: 5,
    description: 'Grounded targets ignore first status turn; grounded Dragon interactions -10 damage.',
    rules: 'Grounded Pokémon and Trainers ignore the first turn of all Status Afflictions. Dragon-Type attacks targeting or originating from grounded targets take -10 Damage Rolls.',
  },
  psychic: {
    kind: 'psychic',
    label: 'Psychic Terrain',
    shortLabel: 'Psy',
    color: '#b16286',
    defaultRounds: 5,
    description: 'Grounded Pokémon cannot declare Priority/Interrupt off-turn; Psychic damage +10.',
    rules: 'Non-Flying and non-Levitating Pokémon cannot declare Priority or Interrupt Moves outside their own Initiatives. Damaging Psychic-Type attacks deal +10 Damage.',
  },
} as const satisfies Record<MapTerrainKind, MapEffectDefinition<MapTerrainKind>>

export const MAP_ROOM_DEFINITIONS = {
  magic: {
    kind: 'magic',
    label: 'Magic Room',
    shortLabel: 'Magic',
    color: '#8ec07c',
    defaultRounds: 5,
    description: 'Held Items and Accessory-slot equipment stop granting static/triggered benefits.',
    rules: 'Pokémon may not benefit from Held Items, and Trainers cannot benefit from Accessory-slot equipment. Consumable and activated items still work.',
  },
  trick: {
    kind: 'trick',
    label: 'Trick Room',
    shortLabel: 'Trick',
    color: '#d3869b',
    defaultRounds: 5,
    description: 'Starting next round, Initiative order is reversed.',
    rules: 'Starting at the beginning of the next round, Initiative is reversed and participants act from lowest Initiative to highest.',
  },
  wonder: {
    kind: 'wonder',
    label: 'Wonder Room',
    shortLabel: 'Wonder',
    color: '#83a598',
    defaultRounds: 5,
    description: 'Each Pokémon’s Defense and Special Defense are switched.',
    rules: 'Each individual Pokémon’s Defense and Special Defense Stats are switched.',
  },
} as const satisfies Record<MapRoomKind, MapEffectDefinition<MapRoomKind>>

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

const isWeatherKind = (value: unknown): value is MapWeatherKind =>
  typeof value === 'string' && MAP_WEATHER_KINDS.includes(value as MapWeatherKind)

const isTerrainKind = (value: unknown): value is MapTerrainKind =>
  typeof value === 'string' && MAP_TERRAIN_KINDS.includes(value as MapTerrainKind)

const isRoomKind = (value: unknown): value is MapRoomKind =>
  typeof value === 'string' && MAP_ROOM_KINDS.includes(value as MapRoomKind)

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
  if (!isRecord(value) || !isWeatherKind(value.kind)) return null
  const out: MapWeatherEffect = {
    kind: value.kind,
    rounds: normalizeRounds(value.rounds, MAP_WEATHER_DEFINITIONS[value.kind].defaultRounds),
  }
  const source = normalizeSource(value.source)
  if (source) out.source = source
  return out
}

const normalizeTerrainEffect = (value: unknown): MapTerrainEffect | null => {
  if (!isRecord(value) || !isTerrainKind(value.kind)) return null
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
  if (!isRecord(value) || !isRoomKind(value.kind)) return null
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
