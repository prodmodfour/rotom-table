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

export interface MoveVfxPaletteReviewBackground {
  readonly key: string
  readonly label: string
  readonly color: MoveVfxHexColor
}

/**
 * Representative dark or saturated map surfaces used for VFX-073 palette review.
 * These swatches mirror common terrain/cage colours without importing renderer
 * material modules into the palette helper.
 */
export const MOVE_VFX_DARK_MAP_REVIEW_BACKGROUNDS = [
  { key: 'airship-hull-dark', label: 'Airship hull dark', color: '#2f3542' },
  { key: 'cage-floor-shadow', label: 'Cage floor shadow', color: '#29303a' },
  { key: 'cave-shadow-stone', label: 'Cave shadow stone', color: '#4f5058' },
  { key: 'wetland-peat-muck', label: 'Wetland peat muck', color: '#4f4537' },
  { key: 'deep-water', label: 'Deep water', color: '#2376a8' },
  { key: 'engineering-floor', label: 'Engineering floor metal', color: '#5e6570' },
  { key: 'biosecure-poison-floor', label: 'Biosecure poison floor', color: '#5f7d42' },
  { key: 'cave-stone', label: 'Cave stone', color: '#64656b' },
] as const satisfies readonly MoveVfxPaletteReviewBackground[]

/**
 * Type colours are intentionally VFX-specific readability colours for the dark
 * tactical map, not exact official palette reproductions. The VFX-073 pass
 * lifts low-luminance official-like hues into brighter in-game variants so
 * primary, accent, and glow layers stay visible over the review backgrounds
 * above. Keep generic primitive files pointed at this table instead of
 * duplicating type hues.
 */
export const MOVE_VFX_TYPE_COLORS = {
  Normal: {
    key: 'Normal',
    label: 'Normal',
    primary: '#e2ded2',
    accent: '#fff9e8',
    glow: '#b8b2c4',
  },
  Fighting: {
    key: 'Fighting',
    label: 'Fighting',
    primary: '#ffa06f',
    accent: '#ffe0c2',
    glow: '#ff704d',
  },
  Flying: {
    key: 'Flying',
    label: 'Flying',
    primary: '#aee6ff',
    accent: '#f4fdff',
    glow: '#82c0ff',
  },
  Poison: {
    key: 'Poison',
    label: 'Poison',
    primary: '#e0a0ff',
    accent: '#f6d8ff',
    glow: '#b96cff',
  },
  Ground: {
    key: 'Ground',
    label: 'Ground',
    primary: '#e6aa73',
    accent: '#ffe3bd',
    glow: '#c98045',
  },
  Rock: {
    key: 'Rock',
    label: 'Rock',
    primary: '#d8cb82',
    accent: '#fff5bd',
    glow: '#b09a54',
  },
  Bug: {
    key: 'Bug',
    label: 'Bug',
    primary: '#c9f06d',
    accent: '#f0ffb5',
    glow: '#9fcb45',
  },
  Ghost: {
    key: 'Ghost',
    label: 'Ghost',
    primary: '#c3aeff',
    accent: '#e9e0ff',
    glow: '#8870ff',
  },
  Steel: {
    key: 'Steel',
    label: 'Steel',
    primary: '#bdd4e4',
    accent: '#edf8ff',
    glow: '#8fa8bb',
  },
  Fire: {
    key: 'Fire',
    label: 'Fire',
    primary: '#ffa566',
    accent: '#ffe08a',
    glow: '#ff6645',
  },
  Water: {
    key: 'Water',
    label: 'Water',
    primary: '#82c9ff',
    accent: '#d4f2ff',
    glow: '#4baeff',
  },
  Grass: {
    key: 'Grass',
    label: 'Grass',
    primary: '#78e27f',
    accent: '#d6f7aa',
    glow: '#48bd68',
  },
  Electric: {
    key: 'Electric',
    label: 'Electric',
    primary: '#ffdf5c',
    accent: '#fff8b8',
    glow: '#f0af16',
  },
  Psychic: {
    key: 'Psychic',
    label: 'Psychic',
    primary: '#ff9bcb',
    accent: '#ffd5e9',
    glow: '#ff5aa8',
  },
  Ice: {
    key: 'Ice',
    label: 'Ice',
    primary: '#90edff',
    accent: '#e6fdff',
    glow: '#58cbe5',
  },
  Dragon: {
    key: 'Dragon',
    label: 'Dragon',
    primary: '#b4b8ff',
    accent: '#e2e4ff',
    glow: '#777dff',
  },
  Dark: {
    key: 'Dark',
    label: 'Dark',
    primary: '#b8c4d6',
    accent: '#f1f5ff',
    glow: '#7e8da4',
  },
  Fairy: {
    key: 'Fairy',
    label: 'Fairy',
    primary: '#ffacec',
    accent: '#ffe4f8',
    glow: '#e46abd',
  },
} as const satisfies Record<PokemonType, MoveVfxPaletteEntry>

/** Semantic fallback colours for outcomes where type colour would mislead. */
export const MOVE_VFX_TONE_COLORS = {
  neutral: {
    key: MOVE_VFX_TONE.neutral,
    label: 'Neutral',
    primary: '#d7e2ee',
    accent: '#ffffff',
    glow: '#92a2b7',
  },
  healing: {
    key: MOVE_VFX_TONE.healing,
    label: 'Healing',
    primary: '#7cf2b0',
    accent: '#e2fff0',
    glow: '#3dd58a',
  },
  status: {
    key: MOVE_VFX_TONE.status,
    label: 'Status',
    primary: '#cfa2ff',
    accent: '#f1ddff',
    glow: '#9c72ff',
  },
  buff: {
    key: MOVE_VFX_TONE.buff,
    label: 'Buff',
    primary: '#8bf2ff',
    accent: '#defdff',
    glow: '#39cde8',
  },
  debuff: {
    key: MOVE_VFX_TONE.debuff,
    label: 'Debuff',
    primary: '#ff90a3',
    accent: '#ffe0e7',
    glow: '#ff5874',
  },
  miss: {
    key: MOVE_VFX_TONE.miss,
    label: 'Miss',
    primary: '#b5c1d0',
    accent: '#edf2f7',
    glow: '#7c8798',
  },
  crit: {
    key: MOVE_VFX_TONE.crit,
    label: 'Critical hit',
    primary: '#ffea70',
    accent: '#ffffff',
    glow: '#ffb238',
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
