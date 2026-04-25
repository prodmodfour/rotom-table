import pokedexData from '~/ptu-data/data/pokedex.json'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { folderFromGlobKey } from '~/utils/sheetFolders'

// ---------------------------------------------------------------------------
// Auto-discover every JSON sheet under ``data/sheets`` (recursively). Drop a
// new file there and it'll appear on the index page without any wiring.
//
// Subdirectories under ``data/sheets/`` become *folders* on the index, e.g.
// ``data/sheets/team-alpha/bolt-pikachu.json`` is grouped under
// ``"team-alpha"``. A sheet may set ``folder`` explicitly to override the
// auto-derived value.
// ---------------------------------------------------------------------------

const sheetModules = import.meta.glob<{ default: CharacterSheet }>(
  './sheets/**/*.json',
  { eager: true },
)

export const characterSheets: CharacterSheet[] = Object.entries(sheetModules)
  .map(([key, mod]) => {
    const sheet = mod.default
    return {
      ...sheet,
      // Honour an explicit folder override; otherwise derive from the path.
      folder: sheet.folder ?? folderFromGlobKey(key, 'sheets'),
    }
  })
  .sort((a, b) => {
    // Sort by folder first (so groups are stable), then by nickname.
    const folderCmp = (a.folder ?? '').localeCompare(b.folder ?? '')
    if (folderCmp !== 0) return folderCmp
    return a.nickname.localeCompare(b.nickname)
  })

export const characterSheetsBySlug = new Map(characterSheets.map((sheet) => [sheet.slug, sheet]))

// ---------------------------------------------------------------------------
// Species lookups so the renderer can layer personal sheet data over the
// canonical PTU species data (types, base stats, capabilities, skills…).
// ---------------------------------------------------------------------------

const pokedexBySpecies = new Map<string, PokedexRecord>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry]),
)

export const getPokedexEntry = (species: string): PokedexRecord | null =>
  pokedexBySpecies.get(species) ?? null

export const getSpriteUrl = (species: string): string | null =>
  pokemonCatalogBySpecies.get(species)?.spriteUrl ?? null

// Maps a PTU "Skill" name (as stored in pokedex.json) to the camelCase key on
// CharacterSheetSkills, so species defaults (e.g. ``"Athletics": "3d6+1"``)
// can populate the sheet skill grid out of the box.
const POKEDEX_SKILL_TO_SHEET_KEY: Record<string, keyof NonNullable<CharacterSheet['skills']>> = {
  Athletics: 'athletics',
  Acrobatics: 'acrobatics',
  Combat: 'combat',
  Stealth: 'stealth',
  Perception: 'perception',
  Focus: 'focus',
  Charm: 'charm',
  Command: 'command',
  Guile: 'guile',
  Intimidate: 'intimidate',
  Intuition: 'intuition',
  Survival: 'survival',
  'General Ed': 'generalEd',
  'Medicine Ed': 'medicineEd',
  'Occult Ed': 'occultEd',
  'Poké Ed': 'pokeEd',
  'Tech Ed': 'techEd',
}

const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

export interface ResolvedStat {
  key: StatKey
  label: string
  /** Base stat from the species. */
  species: number
  /** Nature modifier (+1 / -1 / 0). */
  mod: number
  /** Personal "Base" points spent. */
  base: number
  /** Stat points earned on level-up. */
  added: number
  /** Combat stage. */
  stage: number
  /** Sum displayed in the "Total" column (excluding stages). */
  total: number
}

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  satk: 'Sp. Atk',
  sdef: 'Sp. Def',
  spd: 'Speed',
}

const NATURE_DELTA = 1

export const resolveStats = (sheet: CharacterSheet): ResolvedStat[] => {
  const species = getPokedexEntry(sheet.species)
  const baseStats = species?.base_stats

  const speciesValueFor = (key: StatKey): number => {
    if (!baseStats) return 0
    switch (key) {
      case 'hp':   return baseStats.hp
      case 'atk':  return baseStats.atk
      case 'def':  return baseStats.def
      case 'satk': return baseStats.spatk
      case 'sdef': return baseStats.spdef
      case 'spd':  return baseStats.spd
    }
  }

  const plus  = sheet.natureMod?.plus
  const minus = sheet.natureMod?.minus

  return STAT_KEYS.map((key) => {
    const personal = sheet.stats?.[key] ?? {}
    const speciesValue = speciesValueFor(key)
    const mod = key === 'hp'
      ? 0
      : (plus === key ? NATURE_DELTA : 0) + (minus === key ? -NATURE_DELTA : 0)
    const base  = personal.base  ?? 0
    const added = personal.added ?? 0
    const stage = personal.stage ?? 0
    return {
      key,
      label: STAT_LABELS[key],
      species: speciesValue,
      mod,
      base,
      added,
      stage,
      total: speciesValue + mod + base + added,
    }
  })
}

/**
 * PTU Max HP formula (PHB p. 25):
 *   Max HP = (HP base × Level / 5) + HP base + Level + 10  (rounded down)
 * ``HP base`` here is the resolved Total HP stat from the sheet.
 */
export const computeMaxHp = (sheet: CharacterSheet, hpTotal: number): number => {
  if (sheet.combat?.maxHp != null) return sheet.combat.maxHp
  const level = sheet.level ?? 1
  return Math.floor((hpTotal * level) / 5) + hpTotal + level + 10
}

/** Resolved skill row (label + value). Mixes species defaults and overrides. */
export interface ResolvedSkill {
  key: keyof NonNullable<CharacterSheet['skills']>
  label: string
  value: string
  /** True when the species pokédex marked this skill explicitly (bolded in the sheet). */
  speciesGiven: boolean
}

const SHEET_SKILL_ORDER: Array<[keyof NonNullable<CharacterSheet['skills']>, string]> = [
  ['acrobatics',  'Acrobatics'],
  ['athletics',   'Athletics'],
  ['charm',       'Charm'],
  ['combat',      'Combat'],
  ['command',     'Command'],
  ['generalEd',   'General Ed'],
  ['medicineEd',  'Medicine Ed'],
  ['occultEd',    'Occult Ed'],
  ['pokeEd',      'Poké Ed'],
  ['techEd',      'Tech Ed'],
  ['focus',       'Focus'],
  ['guile',       'Guile'],
  ['intimidate',  'Intimidate'],
  ['intuition',   'Intuition'],
  ['perception',  'Perception'],
  ['stealth',     'Stealth'],
  ['survival',    'Survival'],
]

const EDU_KEYS = new Set(['generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd'])

const DEFAULT_SKILL = '2d6'
const DEFAULT_EDU_SKILL = '1d6'

export const resolveSkills = (sheet: CharacterSheet): ResolvedSkill[] => {
  const species = getPokedexEntry(sheet.species)
  const speciesSkills = species?.skills ?? {}

  // Build a map of sheet-skill-key → species value via POKEDEX_SKILL_TO_SHEET_KEY.
  const speciesByKey = new Map<keyof NonNullable<CharacterSheet['skills']>, string>()
  for (const [pokedexLabel, value] of Object.entries(speciesSkills)) {
    const key = POKEDEX_SKILL_TO_SHEET_KEY[pokedexLabel]
    if (key) speciesByKey.set(key, value)
  }

  return SHEET_SKILL_ORDER.map(([key, label]) => {
    const override = sheet.skills?.[key]
    const speciesValue = speciesByKey.get(key)
    const value = override
      ?? speciesValue
      ?? (EDU_KEYS.has(key) ? DEFAULT_EDU_SKILL : DEFAULT_SKILL)
    return {
      key,
      label,
      value,
      speciesGiven: Boolean(speciesValue),
    }
  })
}

export interface ResolvedCapability {
  label: string
  value: string | number
}

export const resolveCapabilities = (sheet: CharacterSheet) => {
  const species = getPokedexEntry(sheet.species)
  const speciesCaps = species?.capabilities ?? {}
  const sheetCaps = sheet.capabilities ?? {}

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', sheetCaps.overland ?? speciesCaps.overland],
    ['Sky',      sheetCaps.sky      ?? speciesCaps.sky],
    ['Swim',     sheetCaps.swim     ?? speciesCaps.swim],
    ['Levitate', sheetCaps.levitate ?? speciesCaps.levitate],
    ['Burrow',   sheetCaps.burrow   ?? speciesCaps.burrow],
    ['Jump',     sheetCaps.jump     ?? speciesCaps.jump],
    ['Power',    sheetCaps.power    ?? speciesCaps.power],
    ['Weight',   sheetCaps.weight   ?? species?.weight],
    ['Size',     sheetCaps.size     ?? species?.size],
  ]

  const rows: ResolvedCapability[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === '' || value === 0) continue
    rows.push({ label, value })
  }

  const other = sheetCaps.other ?? speciesCaps.other ?? []
  return { rows, naturewalk: sheetCaps.naturewalk, other }
}
