import { POKEMON_TYPES, type PokemonType } from '~/utils/typeChart'

export type MoveVfxHexColor = `#${string}`

export interface MoveVfxPaletteEntry {
  /** Stable palette key used by planners/renderers; not persisted campaign data. */
  readonly key: PokemonType | MoveVfxTone
  /** Human-readable palette label for tests, debug output, or future tooling. */
  readonly label: string
  /** Main hue used for projectile cores, rings, pulses, or area overlays. */
  readonly primary: MoveVfxHexColor
  /** Brighter contrast accent for small cores, outlines, or highlights. */
  readonly accent: MoveVfxHexColor
  /** Soft glow colour for transparent outer shells or trails on dark maps. */
  readonly glow: MoveVfxHexColor
}

export const MOVE_VFX_TONE = {
  neutral: 'neutral',
  healing: 'healing',
  status: 'status',
  buff: 'buff',
  debuff: 'debuff',
  miss: 'miss',
  crit: 'crit',
} as const

export type MoveVfxTone = (typeof MOVE_VFX_TONE)[keyof typeof MOVE_VFX_TONE]

/**
 * Type colours are intentionally VFX-specific readability colours for the dark
 * tactical map, not exact official palette reproductions. Keep generic
 * primitive files pointed at this table instead of duplicating type hues.
 */
export const MOVE_VFX_TYPE_COLORS = {
  Normal: {
    key: 'Normal',
    label: 'Normal',
    primary: '#d6d2c4',
    accent: '#fff7df',
    glow: '#8b8796',
  },
  Fighting: {
    key: 'Fighting',
    label: 'Fighting',
    primary: '#ff8655',
    accent: '#ffd0a6',
    glow: '#b84732',
  },
  Flying: {
    key: 'Flying',
    label: 'Flying',
    primary: '#9bdcff',
    accent: '#effbff',
    glow: '#6aa7ff',
  },
  Poison: {
    key: 'Poison',
    label: 'Poison',
    primary: '#c77dff',
    accent: '#f0c5ff',
    glow: '#7a4ac7',
  },
  Ground: {
    key: 'Ground',
    label: 'Ground',
    primary: '#d99a62',
    accent: '#ffd8a8',
    glow: '#8c613a',
  },
  Rock: {
    key: 'Rock',
    label: 'Rock',
    primary: '#c8b96f',
    accent: '#fff1a8',
    glow: '#85743e',
  },
  Bug: {
    key: 'Bug',
    label: 'Bug',
    primary: '#b7e35f',
    accent: '#eaff9b',
    glow: '#759d35',
  },
  Ghost: {
    key: 'Ghost',
    label: 'Ghost',
    primary: '#a98cff',
    accent: '#dfd4ff',
    glow: '#5e4ac7',
  },
  Steel: {
    key: 'Steel',
    label: 'Steel',
    primary: '#a9c5d6',
    accent: '#e6f4ff',
    glow: '#647e91',
  },
  Fire: {
    key: 'Fire',
    label: 'Fire',
    primary: '#ff6b35',
    accent: '#ffd166',
    glow: '#bf2f1f',
  },
  Water: {
    key: 'Water',
    label: 'Water',
    primary: '#4da3ff',
    accent: '#bde7ff',
    glow: '#1f5fbf',
  },
  Grass: {
    key: 'Grass',
    label: 'Grass',
    primary: '#62d36b',
    accent: '#c6f59a',
    glow: '#2d8b4f',
  },
  Electric: {
    key: 'Electric',
    label: 'Electric',
    primary: '#ffd84d',
    accent: '#fff6a8',
    glow: '#d99100',
  },
  Psychic: {
    key: 'Psychic',
    label: 'Psychic',
    primary: '#ff6fae',
    accent: '#ffc3de',
    glow: '#b83775',
  },
  Ice: {
    key: 'Ice',
    label: 'Ice',
    primary: '#74e4ff',
    accent: '#dcfbff',
    glow: '#3aa7c7',
  },
  Dragon: {
    key: 'Dragon',
    label: 'Dragon',
    primary: '#8d90ff',
    accent: '#d6d8ff',
    glow: '#474ad6',
  },
  Dark: {
    key: 'Dark',
    label: 'Dark',
    primary: '#9aa3b2',
    accent: '#d7deea',
    glow: '#4a5266',
  },
  Fairy: {
    key: 'Fairy',
    label: 'Fairy',
    primary: '#ff9ee7',
    accent: '#ffe0f6',
    glow: '#c94a9d',
  },
} as const satisfies Record<PokemonType, MoveVfxPaletteEntry>

/** Semantic fallback colours for outcomes where type colour would mislead. */
export const MOVE_VFX_TONE_COLORS = {
  neutral: {
    key: MOVE_VFX_TONE.neutral,
    label: 'Neutral',
    primary: '#c8d3e0',
    accent: '#ffffff',
    glow: '#6c7a8f',
  },
  healing: {
    key: MOVE_VFX_TONE.healing,
    label: 'Healing',
    primary: '#68e39d',
    accent: '#d7ffe8',
    glow: '#2ea86f',
  },
  status: {
    key: MOVE_VFX_TONE.status,
    label: 'Status',
    primary: '#b486ff',
    accent: '#ead8ff',
    glow: '#6d4fc2',
  },
  buff: {
    key: MOVE_VFX_TONE.buff,
    label: 'Buff',
    primary: '#70e6ff',
    accent: '#d7fbff',
    glow: '#259fbd',
  },
  debuff: {
    key: MOVE_VFX_TONE.debuff,
    label: 'Debuff',
    primary: '#ff7a90',
    accent: '#ffd6de',
    glow: '#b93a55',
  },
  miss: {
    key: MOVE_VFX_TONE.miss,
    label: 'Miss',
    primary: '#9ca8b8',
    accent: '#e2e8f0',
    glow: '#566170',
  },
  crit: {
    key: MOVE_VFX_TONE.crit,
    label: 'Critical hit',
    primary: '#ffea70',
    accent: '#ffffff',
    glow: '#ff9f1c',
  },
} as const satisfies Record<MoveVfxTone, MoveVfxPaletteEntry>

export const DEFAULT_MOVE_VFX_COLOR = MOVE_VFX_TONE_COLORS.neutral

const normalizePaletteLookupKey = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase()
  : ''

const POKEMON_TYPE_BY_NORMALIZED_NAME = new Map<string, PokemonType>(
  POKEMON_TYPES.map((type) => [normalizePaletteLookupKey(type), type]),
)

const MOVE_VFX_TONE_BY_NORMALIZED_NAME = new Map<string, MoveVfxTone>([
  [MOVE_VFX_TONE.neutral, MOVE_VFX_TONE.neutral],
  [MOVE_VFX_TONE.healing, MOVE_VFX_TONE.healing],
  ['heal', MOVE_VFX_TONE.healing],
  [MOVE_VFX_TONE.status, MOVE_VFX_TONE.status],
  [MOVE_VFX_TONE.buff, MOVE_VFX_TONE.buff],
  [MOVE_VFX_TONE.debuff, MOVE_VFX_TONE.debuff],
  [MOVE_VFX_TONE.miss, MOVE_VFX_TONE.miss],
  [MOVE_VFX_TONE.crit, MOVE_VFX_TONE.crit],
  ['critical', MOVE_VFX_TONE.crit],
])

export const normalizeMoveVfxType = (type: unknown): PokemonType | null => {
  const normalized = normalizePaletteLookupKey(type)
  return POKEMON_TYPE_BY_NORMALIZED_NAME.get(normalized) ?? null
}

export const normalizeMoveVfxTone = (tone: unknown): MoveVfxTone => {
  const normalized = normalizePaletteLookupKey(tone)
  return MOVE_VFX_TONE_BY_NORMALIZED_NAME.get(normalized) ?? MOVE_VFX_TONE.neutral
}

export const moveVfxColorForType = (type: unknown): MoveVfxPaletteEntry => {
  const canonicalType = normalizeMoveVfxType(type)
  return canonicalType ? MOVE_VFX_TYPE_COLORS[canonicalType] : DEFAULT_MOVE_VFX_COLOR
}

export const moveVfxColorForTone = (tone: unknown): MoveVfxPaletteEntry => (
  MOVE_VFX_TONE_COLORS[normalizeMoveVfxTone(tone)]
)
