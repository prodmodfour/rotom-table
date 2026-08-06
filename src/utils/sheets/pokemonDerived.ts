import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { adjustedNatureModForStat, resolveNatureMod } from '~/utils/ptuNatures'
import { computeInjuryAdjustedMaxHp, computePokemonFormulaMaxHp } from '~/utils/ptuHp'
import {
  resolvePokemonNaturewalk,
  resolvePokemonOtherCapabilities,
} from '~/utils/sheets/pokemonCapabilities'
import {
  applyJumpCapabilityBonuses,
  applyNumberedCapabilityBonus,
  resolveMoveGrantedCapabilities,
} from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import { resolvePokemonVitaminSummary } from '~/utils/sheets/pokemonVitamins'
import { parseCapabilityLabel } from '#shared/capabilityAutomation/catalog'
import { sheetEdgeChoiceValues, sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import {
  parseBreedingBabyTemplateMechanicsV1,
  resolveBreedingBabyTemplateStageV1,
  type BreedingBabyTemplateStageV1,
} from '#shared/breeding/babyTemplate'

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
  /** Net Base Stat adjustment from Vitamins minus stat suppressants. */
  vitaminAdjustment: number
  /** Permanent Base Stat adjustment from Capability state such as Letter Press. */
  capabilityAdjustment: number
  /** Permanent Base Stat adjustment from effective Poké Edges. */
  edgeAdjustment: number
  /** Nature-, Vitamin-, Capability-, and Edge-adjusted Base Stat. */
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

export const validateBaseRelations = (
  stats: ResolvedStat[],
  waivedHigherStats: ReadonlySet<StatKey> = new Set(),
): BaseRelationViolation[] => {
  const violations: BaseRelationViolation[] = []
  const knownStats = stats.filter((row) => row.base > 0)

  for (const higher of knownStats) {
    for (const lower of knownStats) {
      if (higher.key === lower.key || waivedHigherStats.has(higher.key)) continue
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

export const realizedPotentialBonusStatPoints = (sheet: CharacterSheet): number => {
  if (!sheetHasCanonicalEdge(sheet, 'poke', 'Realized Potential')) return 0
  const baseStats = getPokedexEntry(sheet.species)?.base_stats
  if (!baseStats) return 0
  const total = baseStats.hp + baseStats.atk + baseStats.def + baseStats.spatk + baseStats.spdef + baseStats.spd
  return Math.max(0, 45 - total)
}

export const pokemonAddedStatPointBudget = (sheet: CharacterSheet): number => (
  computePokemonLevelUpStatPointBudget(sheet.level) + realizedPotentialBonusStatPoints(sheet)
)

export const resolvePokemonBabyTemplateStage = (sheet: CharacterSheet): BreedingBabyTemplateStageV1 | null => {
  const privateAuthority = sheet.serverPrivate?.breedingBabyTemplate
  const rawMechanics = privateAuthority
    ? { schemaVersion: 1, applicationKind: privateAuthority.applicationKind, effects: privateAuthority.effects }
    : sheet.babyTemplateMechanics
  if (rawMechanics) {
    try {
      const mechanics = parseBreedingBabyTemplateMechanicsV1(rawMechanics)
      return resolveBreedingBabyTemplateStageV1({ mechanics, currentLevel: sheet.level })
    }
    catch {
      // A malformed projected mirror never gains mechanic authority. Server
      // storage validates private authority before it reaches this boundary.
    }
  }
  // Editable and legacy booleans never prove origin or mechanics. Owner-safe
  // projected mechanics may drive presentation, while every server mutation
  // restores and validates the private authority before using this reducer.
  return null
}

export const pokemonHasActiveBabyTemplate = (sheet: CharacterSheet): boolean => (
  resolvePokemonBabyTemplateStage(sheet)?.active === true
)

/**
 * Marsupial's command, movement, and pouch restrictions are not generic Baby
 * Template rules. Keep that capability-owned behavior scoped to an active
 * server-authored Marsupial application so an optional campaign template does
 * not silently acquire Kangaskhan-only restrictions.
 */
export const pokemonHasActiveMarsupialBabyTemplate = (sheet: CharacterSheet): boolean => {
  if (!pokemonHasActiveBabyTemplate(sheet)) return false
  const privateAuthority = sheet.serverPrivate?.breedingBabyTemplate
  const rawMechanics = privateAuthority
    ? { schemaVersion: 1, applicationKind: privateAuthority.applicationKind, effects: privateAuthority.effects }
    : sheet.babyTemplateMechanics
  if (!rawMechanics) return false
  try { return parseBreedingBabyTemplateMechanicsV1(rawMechanics).applicationKind === 'marsupial' }
  catch { return false }
}

export const pokemonMarsupialBabyActionRestricted = (
  sheet: CharacterSheet,
  effectiveAbilityIds: readonly string[],
): boolean => pokemonHasActiveMarsupialBabyTemplate(sheet)
  && !effectiveAbilityIds.includes('Parental Bond')

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
  const vitaminSummary = resolvePokemonVitaminSummary(sheet)
  const babyTemplateStage = resolvePokemonBabyTemplateStage(sheet)

  return POKEMON_STAT_KEYS.map((key) => {
    const personal = sheet.stats?.[key] ?? {}
    const speciesValue = speciesValueFor(key)
    const mod = baseStats ? adjustedNatureModForStat(speciesValue, key, plus, minus) : 0
    const vitaminAdjustment = vitaminSummary.statNetAdjustments[key]
    const capabilityBaseStatBonus = (sheet.capabilityCampaignState?.letterPress?.statBonuses[key] ?? 0)
      - (babyTemplateStage?.remainingBaseStatPenaltyEach ?? 0)
    const edgeAdjustment = sheetHasCanonicalEdge(sheet, 'poke', 'Underdog’s Strength') ? 1 : 0
    const rawBase = speciesValue + mod + vitaminAdjustment + capabilityBaseStatBonus + edgeAdjustment
    const base = speciesValue > 0 ? Math.max(1, rawBase) : Math.max(0, rawBase)
    const added = personal.added ?? 0
    const stage = personal.stage ?? 0
    const baseTotal = base + added
    return {
      key,
      label: STAT_LABELS[key],
      species: speciesValue,
      mod,
      vitaminAdjustment,
      capabilityAdjustment: capabilityBaseStatBonus,
      edgeAdjustment,
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
const capabilityGrantingMoves = (sheet: CharacterSheet) => [
  ...(sheet.movelist ?? []),
  ...(sheet.appliedMoves ?? []),
]

export const pokemonHasResolvedCapability = (
  sheet: CharacterSheet,
  canonicalId: string,
): boolean => resolvePokemonOtherCapabilities(
  getPokedexEntry(sheet.species),
  sheet.capabilities,
  { other: resolveMoveGrantedCapabilities(capabilityGrantingMoves(sheet)).other },
).some((capability) => {
  const normalized = capability.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
  const requested = canonicalId.toLocaleLowerCase('en-US')
  if (normalized === 'tracker underdog' && (requested === 'tracker' || requested === 'underdog')) return true
  return parseCapabilityLabel(capability).canonicalId?.toLocaleLowerCase('en-US') === requested
})

export const computeFullMaxHp = (sheet: CharacterSheet, hpTotal: number): number =>
  pokemonHasResolvedCapability(sheet, 'Soulless')
    ? 1
    : computePokemonFormulaMaxHp(sheet.level ?? 1, hpTotal)

/** Effective Max HP / healing cap after Injuries (Core Combat p.250). */
export const computeMaxHp = (sheet: CharacterSheet, hpTotal: number): number =>
  pokemonHasResolvedCapability(sheet, 'Soulless')
    ? 1
    : computeInjuryAdjustedMaxHp(computeFullMaxHp(sheet, hpTotal), sheet.combat?.injuries)

/** Resolved skill row (label + value). Mixes species defaults and overrides. */
export interface ResolvedSkill {
  key: keyof NonNullable<CharacterSheet['skills']>
  label: string
  value: string
  /** True when the species pokédex marked this skill explicitly (bolded in the sheet). */
  speciesGiven: boolean
}

export const SHEET_SKILL_ORDER = [
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
] as const satisfies ReadonlyArray<readonly [keyof NonNullable<CharacterSheet['skills']>, string]>

export type PokemonSheetSkillLabel = typeof SHEET_SKILL_ORDER[number][1]

const EDU_KEYS = new Set(['generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd'])

const DEFAULT_SKILL = '2d6'
const DEFAULT_EDU_SKILL = '1d6'

const rankUpPokemonSkill = (value: string, steps: number): string => {
  const match = /^\s*(\d+)d6(?:\s*([+-])\s*(\d+))?\s*$/i.exec(value)
  if (!match || steps <= 0) return value
  const dice = Math.min(6, Number.parseInt(match[1] ?? '0', 10) + steps)
  const modifier = match[2] && match[3] ? `${match[2]}${match[3]}` : ''
  return `${dice}d6${modifier}`
}

const rankDownPokemonSkill = (value: string, steps: number): string => {
  const match = /^\s*(\d+)d6(?:\s*([+-])\s*(\d+))?\s*$/iu.exec(value)
  if (!match || steps <= 0) return value
  const dice = Math.max(1, Number.parseInt(match[1] ?? '1', 10) - steps)
  const modifier = match[2] && match[3] ? `${match[2]}${match[3]}` : ''
  return `${dice}d6${modifier}`
}

export const pokemonBaseRelationWaivers = (sheet: CharacterSheet): ReadonlySet<StatKey> => {
  const choices = sheetEdgeChoiceValues({ sheet, family: 'poke', canonicalId: 'Attack Conflict', choiceId: 'choice-1' })
  return new Set(choices.flatMap(value => value === 'Attack' ? ['atk' as const] : value === 'Special Attack' ? ['satk' as const] : []))
}

export const resolveSkills = (sheet: CharacterSheet): ResolvedSkill[] => {
  const species = getPokedexEntry(sheet.species)
  const speciesSkills = species?.skills ?? {}

  // Build a map of sheet-skill-key → species value via POKEDEX_SKILL_TO_SHEET_KEY.
  const speciesByKey = new Map<keyof NonNullable<CharacterSheet['skills']>, string>()
  for (const [pokedexLabel, value] of Object.entries(speciesSkills)) {
    const key = POKEDEX_SKILL_TO_SHEET_KEY[pokedexLabel]
    if (key) speciesByKey.set(key, value)
  }

  const babyTemplateStage = resolvePokemonBabyTemplateStage(sheet)
  return SHEET_SKILL_ORDER.map(([key, label]) => {
    const override = sheet.skills?.[key]
    const speciesValue = speciesByKey.get(key)
    const baseValue = override
      ?? speciesValue
      ?? (EDU_KEYS.has(key) ? DEFAULT_EDU_SKILL : DEFAULT_SKILL)
    const improvementCount = sheetEdgeChoiceValues({ sheet, family: 'poke', canonicalId: 'Skill Improvement', choiceId: 'choice-1' })
      .filter(selected => selected === key).length
    const value = rankDownPokemonSkill(
      rankUpPokemonSkill(baseValue, improvementCount),
      babyTemplateStage?.skillRankPenalty ?? 0,
    )
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
  const moveGrantedCapabilities = resolveMoveGrantedCapabilities(capabilityGrantingMoves(sheet))
  const babyTemplateStage = resolvePokemonBabyTemplateStage(sheet)
  const babyCapabilityPenalty = babyTemplateStage?.capabilityPenalty ?? 0
  const babyAdjusted = (value: number | undefined): number | undefined => value === undefined
    ? undefined
    : value <= 0
      ? value
      : Math.max(1, value - babyCapabilityPenalty)

  const baseLevitate = applyNumberedCapabilityBonus(
    sheetCaps.levitate ?? speciesCaps.levitate,
    moveGrantedCapabilities.numberedBonuses.levitate,
  )
  // Ability-granted Levitate is projected from exact effective abilities at
  // the authoritative token boundary; this value remains native/species/sheet/Move-only.
  const nativeLevitate = baseLevitate

  const advancedMobility = new Set(sheetEdgeChoiceValues({ sheet, family: 'poke', canonicalId: 'Advanced Mobility', choiceId: 'choice-1' }))
  const capabilityTraining = new Set(sheetEdgeChoiceValues({ sheet, family: 'poke', canonicalId: 'Capability Training', choiceId: 'choice-1' }))
  const edgeNumberBonus = (label: string): number => (advancedMobility.has(label) ? 2 : 0)
    + (capabilityTraining.has(label) ? 1 : 0)
  const withEdgeBonus = (value: number | undefined, bonus: number): number | undefined => (
    value === undefined && bonus === 0 ? undefined : (value ?? 0) + bonus
  )
  const edgeJump = (value: string | number | undefined): string | number | undefined => {
    if (typeof value !== 'string') return typeof value === 'number' && value > 0 ? Math.max(1, value - babyCapabilityPenalty) : value
    const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value)
    if (!match) return value
    const adjustedJump = (base: number, edgeBonus: number): number => {
      const value = base + edgeBonus
      return value <= 0 ? value : Math.max(1, value - babyCapabilityPenalty)
    }
    const long = adjustedJump(Number.parseInt(match[1] ?? '0', 10), edgeNumberBonus('Long Jump'))
    const high = adjustedJump(Number.parseInt(match[2] ?? '0', 10), edgeNumberBonus('High Jump'))
    return `${long}/${high}`
  }

  const numbered: Array<[string, number | string | undefined]> = [
    ['Overland', babyAdjusted(withEdgeBonus(applyNumberedCapabilityBonus(
      sheetCaps.overland ?? speciesCaps.overland,
      moveGrantedCapabilities.numberedBonuses.overland,
    ), edgeNumberBonus('Overland')))],
    ['Sky',      babyAdjusted(withEdgeBonus(applyNumberedCapabilityBonus(
      sheetCaps.sky      ?? speciesCaps.sky,
      moveGrantedCapabilities.numberedBonuses.sky,
    ), edgeNumberBonus('Sky')))],
    ['Swim',     babyAdjusted(withEdgeBonus(applyNumberedCapabilityBonus(
      sheetCaps.swim     ?? speciesCaps.swim,
      moveGrantedCapabilities.numberedBonuses.swim,
    ), edgeNumberBonus('Swim')))],
    ['Levitate', babyAdjusted(withEdgeBonus(nativeLevitate, edgeNumberBonus('Levitate')))],
    ['Burrow',   babyAdjusted(withEdgeBonus(applyNumberedCapabilityBonus(
      sheetCaps.burrow   ?? speciesCaps.burrow,
      moveGrantedCapabilities.numberedBonuses.burrow,
    ), edgeNumberBonus('Burrow')))],
    ['Jump',     edgeJump(applyJumpCapabilityBonuses(
      sheetCaps.jump     ?? speciesCaps.jump,
      moveGrantedCapabilities.jumpBonuses,
    ))],
    ['Power',    babyAdjusted(withEdgeBonus(applyNumberedCapabilityBonus(
      sheetCaps.power    ?? speciesCaps.power,
      moveGrantedCapabilities.numberedBonuses.power,
    ), edgeNumberBonus('Power')))],
    ['Weight',   sheetCaps.weight   ?? species?.weight],
    ['Size',     babyTemplateStage?.active
      ? `${sheetCaps.size ?? species?.size ?? 'Unknown'} (${babyTemplateStage.sizePercentOfAdult}% adult)`
      : sheetCaps.size ?? species?.size],
  ]

  const rows: ResolvedCapability[] = []
  for (const [label, value] of numbered) {
    if (value === undefined || value === null || value === '' || value === 0) continue
    rows.push({ label, value })
  }

  const naturewalk = resolvePokemonNaturewalk(species, sheetCaps)
  const other = resolvePokemonOtherCapabilities(species, sheetCaps, {
    other: [
      ...moveGrantedCapabilities.other,
      ...(sheetHasCanonicalEdge(sheet, 'poke', 'Aura Pulse') ? ['Aura Pulse'] : []),
    ],
    valuedBonuses: moveGrantedCapabilities.valuedOtherBonuses,
  })
  return { rows, naturewalk, other }
}
