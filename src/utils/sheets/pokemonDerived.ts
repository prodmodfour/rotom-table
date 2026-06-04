import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { adjustedNatureModForStat, resolveNatureMod } from '~/utils/ptuNatures'
import { computeInjuryAdjustedMaxHp, computePokemonFormulaMaxHp } from '~/utils/ptuHp'
import { resolveLevitateAbilitySpeed } from '~/utils/sheetPassiveAbilityEffects'
import {
  resolvePokemonNaturewalk,
  resolvePokemonOtherCapabilities,
} from '~/utils/sheets/pokemonCapabilities'
import {
  applyJumpCapabilityBonuses,
  applyNumberedCapabilityBonus,
  resolveMoveGrantedCapabilities,
} from '~/utils/sheets/pokemonMoveGrantedCapabilities'

const pokedexBySpecies = new Map<string, PokedexRecord>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry]),
)

const getPokedexEntry = (species: string): PokedexRecord | null =>
  pokedexBySpecies.get(species) ?? null

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

export const POKEMON_STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  satk: 'Sp. Atk',
  sdef: 'Sp. Def',
  spd: 'Speed',
}

export interface ResolvedStat {
  key: StatKey
  label: string
  /** Base stat from the species reference, or the sheet's manual Base fallback when reference stats are unavailable. */
  species: number
  /** Effective Nature modifier after PTU's stat-specific delta and minimum-1 floor. */
  mod: number
  /** Nature-adjusted Base Stat (Species + Mod). */
  base: number
  /** Stat points earned on level-up. */
  added: number
  /** Sheet-authored Combat Stage before temporary condition effects. */
  stage: number
  /** Alias for the sheet-authored Combat Stage, useful when an effective stage is displayed. */
  manualStage: number
  /** Condition-supplied Combat Stage delta, such as Burned's Defense -2. */
  conditionStageModifier: number
  /** Combat Stage after temporary condition effects. */
  effectiveStage: number
  /** Stat sum before Combat Stages; used for permanent build math such as Base Relations. */
  baseTotal: number
  /** Current sheet Total. Raw resolution initializes this to baseTotal; sheet views apply Combat Stages. */
  total: number
}

export interface BaseRelationViolation {
  /** The stat that starts higher in the nature-adjusted Base order. */
  higher: ResolvedStat
  /** The stat that starts lower in the nature-adjusted Base order. */
  lower: ResolvedStat
}

export const validateBaseRelations = (stats: ResolvedStat[]): BaseRelationViolation[] => {
  const violations: BaseRelationViolation[] = []
  const knownStats = stats.filter((row) => row.base > 0)

  for (const higher of knownStats) {
    for (const lower of knownStats) {
      if (higher.key === lower.key) continue
      if (higher.base <= lower.base) continue
      if (higher.baseTotal > lower.baseTotal) continue
      violations.push({ higher, lower })
    }
  }

  return violations.sort(
    (a, b) =>
      (b.higher.base - b.lower.base) - (a.higher.base - a.lower.base)
      || a.higher.label.localeCompare(b.higher.label)
      || a.lower.label.localeCompare(b.lower.label),
  )
}

export const resolveStats = (sheet: CharacterSheet): ResolvedStat[] => {
  const species = getPokedexEntry(sheet.species)
  const baseStats = species?.base_stats

  const speciesValueFor = (key: StatKey): number => {
    if (!baseStats) {
      const manualBase = sheet.stats?.[key]?.base
      return typeof manualBase === 'number' && Number.isFinite(manualBase) ? manualBase : 0
    }
    switch (key) {
      case 'hp':   return baseStats.hp
      case 'atk':  return baseStats.atk
      case 'def':  return baseStats.def
      case 'satk': return baseStats.spatk
      case 'sdef': return baseStats.spdef
      case 'spd':  return baseStats.spd
    }
  }

  const chartNatureMod = resolveNatureMod(sheet.nature)
  const plus = chartNatureMod?.plus
  const minus = chartNatureMod?.minus

  return POKEMON_STAT_KEYS.map((key) => {
    const personal = sheet.stats?.[key] ?? {}
    const speciesValue = speciesValueFor(key)
    const mod = baseStats ? adjustedNatureModForStat(speciesValue, key, plus, minus) : 0
    const base = speciesValue + mod
    const added = personal.added ?? 0
    const stage = personal.stage ?? 0
    const baseTotal = base + added
    return {
      key,
      label: STAT_LABELS[key],
      species: speciesValue,
      mod,
      base,
      added,
      stage,
      manualStage: stage,
      conditionStageModifier: 0,
      effectiveStage: stage,
      baseTotal,
      total: baseTotal,
    }
  })
}

/**
 * PTU Pokémon real/formula Max HP (Core, Pokémon chapter p.198):
 *   Max HP = Level + (HP × 3) + 10
 * ``HP`` here is the resolved Total HP stat from the sheet. Legacy
 * ``combat.maxHp`` values are ignored so the sheet always derives HP.
 */
export const computeFullMaxHp = (sheet: CharacterSheet, hpTotal: number): number =>
  computePokemonFormulaMaxHp(sheet.level ?? 1, hpTotal)

/** Effective Max HP / healing cap after Injuries (Core Combat p.250). */
export const computeMaxHp = (sheet: CharacterSheet, hpTotal: number): number =>
  computeInjuryAdjustedMaxHp(computeFullMaxHp(sheet, hpTotal), sheet.combat?.injuries)

/** Resolved skill row (label + value). Mixes species defaults and overrides. */
export interface ResolvedSkill {
  key: keyof NonNullable<CharacterSheet['skills']>
  label: string
  value: string
  /** True when the species pokédex marked this skill explicitly (bolded in the sheet). */
  speciesGiven: boolean
}

export const SHEET_SKILL_ORDER: Array<[keyof NonNullable<CharacterSheet['skills']>, string]> = [
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
  const moveGrantedCapabilities = resolveMoveGrantedCapabilities(sheet.movelist)

  const baseLevitate = applyNumberedCapabilityBonus(
    sheetCaps.levitate ?? speciesCaps.levitate,
    moveGrantedCapabilities.numberedBonuses.levitate,
  )
  const effectiveLevitate = resolveLevitateAbilitySpeed(baseLevitate, sheet.abilities)

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', applyNumberedCapabilityBonus(
      sheetCaps.overland ?? speciesCaps.overland,
      moveGrantedCapabilities.numberedBonuses.overland,
    )],
    ['Sky',      applyNumberedCapabilityBonus(
      sheetCaps.sky      ?? speciesCaps.sky,
      moveGrantedCapabilities.numberedBonuses.sky,
    )],
    ['Swim',     applyNumberedCapabilityBonus(
      sheetCaps.swim     ?? speciesCaps.swim,
      moveGrantedCapabilities.numberedBonuses.swim,
    )],
    ['Levitate', effectiveLevitate],
    ['Burrow',   applyNumberedCapabilityBonus(
      sheetCaps.burrow   ?? speciesCaps.burrow,
      moveGrantedCapabilities.numberedBonuses.burrow,
    )],
    ['Jump',     applyJumpCapabilityBonuses(
      sheetCaps.jump     ?? speciesCaps.jump,
      moveGrantedCapabilities.jumpBonuses,
    )],
    ['Power',    applyNumberedCapabilityBonus(
      sheetCaps.power    ?? speciesCaps.power,
      moveGrantedCapabilities.numberedBonuses.power,
    )],
    ['Weight',   sheetCaps.weight   ?? species?.weight],
    ['Size',     sheetCaps.size     ?? species?.size],
  ]

  const rows: ResolvedCapability[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === '' || value === 0) continue
    rows.push({ label, value })
  }

  const naturewalk = resolvePokemonNaturewalk(species, sheetCaps)
  const other = resolvePokemonOtherCapabilities(species, sheetCaps, {
    other: moveGrantedCapabilities.other,
    valuedBonuses: moveGrantedCapabilities.valuedOtherBonuses,
  })
  return { rows, naturewalk, other }
}
