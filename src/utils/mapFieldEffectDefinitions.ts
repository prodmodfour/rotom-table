import type {
  MapRoomKind,
  MapTerrainKind,
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
export const MAP_ROOM_KINDS = ['magic', 'trick', 'wonder', 'gravity'] as const satisfies readonly MapRoomKind[]

export const MAP_WEATHER_DEFINITIONS = {
  sunny: {
    kind: 'sunny',
    label: 'Sunny',
    shortLabel: 'Sun',
    color: '#ffcf4d',
    defaultRounds: 5,
    description: 'Fire attacks +5 damage; Water attacks -5 damage.',
    rules: 'Fire-Type attacks gain +5 Damage Rolls. Water-Type attacks suffer -5 Damage.',
  },
  rainy: {
    kind: 'rainy',
    label: 'Rainy',
    shortLabel: 'Rain',
    color: '#8fb8ff',
    defaultRounds: 5,
    description: 'Water attacks +5 damage; Fire attacks -5 damage.',
    rules: 'Water-Type attacks gain +5 Damage Rolls. Fire-Type attacks suffer -5 Damage.',
  },
  hail: {
    kind: 'hail',
    label: 'Hail',
    shortLabel: 'Hail',
    color: '#d7f4ff',
    defaultRounds: 5,
    description: 'Non-Ice Pokémon lose a Tick at the start of their turn.',
    rules: 'While Hailing, all non-Ice Type Pokémon lose a Tick of Hit Points at the beginning of their turn.',
  },
  sandstorm: {
    kind: 'sandstorm',
    label: 'Sandstorm',
    shortLabel: 'Sand',
    color: '#caa45a',
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
    color: '#ffe45e',
    defaultRounds: 5,
    description: 'Grounded targets cannot Sleep; grounded Electric attacks +10 damage.',
    rules: 'Grounded Pokémon and Trainers are immune to Sleep. Electric-Type attacks by grounded users gain +10 Damage Rolls.',
  },
  grassy: {
    kind: 'grassy',
    label: 'Grassy Terrain',
    shortLabel: 'Grass',
    color: '#64e676',
    defaultRounds: 5,
    description: 'Grounded targets heal a Tick; grounded Grass attacks +10 damage.',
    rules: 'Grounded Pokémon and Trainers recover a Tick at the start of every turn. Grass-Type attacks by grounded users gain +10 Damage Rolls.',
  },
  misty: {
    kind: 'misty',
    label: 'Misty Terrain',
    shortLabel: 'Misty',
    color: '#d88cff',
    defaultRounds: 5,
    description: 'Grounded targets ignore first status turn; grounded Dragon interactions -10 damage.',
    rules: 'Grounded Pokémon and Trainers ignore the first turn of all Status Afflictions. Dragon-Type attacks targeting or originating from grounded targets take -10 Damage Rolls.',
  },
  psychic: {
    kind: 'psychic',
    label: 'Psychic Terrain',
    shortLabel: 'Psy',
    color: '#b56cff',
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
    color: '#8eeedc',
    defaultRounds: 5,
    description: 'Held Items and Accessory-slot equipment stop granting static/triggered benefits.',
    rules: 'Pokémon may not benefit from Held Items, and Trainers cannot benefit from Accessory-slot equipment. Consumable and activated items still work.',
  },
  trick: {
    kind: 'trick',
    label: 'Trick Room',
    shortLabel: 'Trick',
    color: '#d88cff',
    defaultRounds: 5,
    description: 'Starting next round, Initiative order is reversed.',
    rules: 'Starting at the beginning of the next round, Initiative is reversed and participants act from lowest Initiative to highest.',
  },
  wonder: {
    kind: 'wonder',
    label: 'Wonder Room',
    shortLabel: 'Wonder',
    color: '#8fb8ff',
    defaultRounds: 5,
    description: 'Each Pokémon’s Defense and Special Defense are switched.',
    rules: 'Each individual Pokémon’s Defense and Special Defense Stats are switched.',
  },
  gravity: {
    kind: 'gravity',
    label: 'Gravity',
    shortLabel: 'Gravity',
    color: '#6f63d9',
    defaultRounds: 5,
    description: 'Grounds Pokémon, limits aerial endpoints, and grants +2 Accuracy.',
    rules: 'Pokémon are grounded; Sky and Levitate cannot end above 1 metre; Flying and Levitate Ground resistance and Groundsource immunity are suppressed; all Accuracy Rolls gain +2.',
  },
} as const satisfies Record<MapRoomKind, MapEffectDefinition<MapRoomKind>>

export const isMapWeatherKind = (value: unknown): value is MapWeatherKind =>
  typeof value === 'string' && MAP_WEATHER_KINDS.includes(value as MapWeatherKind)

export const isMapTerrainKind = (value: unknown): value is MapTerrainKind =>
  typeof value === 'string' && MAP_TERRAIN_KINDS.includes(value as MapTerrainKind)

export const isMapRoomKind = (value: unknown): value is MapRoomKind =>
  typeof value === 'string' && MAP_ROOM_KINDS.includes(value as MapRoomKind)
