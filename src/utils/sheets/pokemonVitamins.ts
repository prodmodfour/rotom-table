import type { CharacterSheet, CharacterSheetVitaminTracking, StatKey } from '~/types/characterSheet'

export const POKEMON_VITAMIN_LIMIT = 5
export const POKEMON_RARE_CANDY_LIMIT = 5
export const HEART_BOOSTER_TUTOR_POINT_BONUS = 2

export type PokemonVitaminStatCountKind = 'statBoosts' | 'statSuppressants'
export type PokemonVitaminFlagKey = 'heartBooster' | 'ppUp'
export type PokemonVitaminNumberKey = 'rareCandies' | 'heartScales'
export type PokemonVitaminTextKey = 'ppUpMove' | 'notes'

export interface PokemonVitaminStatItemDefinition {
  stat: StatKey
  label: string
  vitaminName: string
  suppressantName: string
}

export const POKEMON_VITAMIN_STAT_ITEMS: readonly PokemonVitaminStatItemDefinition[] = [
  { stat: 'hp', label: 'HP', vitaminName: 'HP Up', suppressantName: 'HP Suppressant' },
  { stat: 'atk', label: 'Attack', vitaminName: 'Protein', suppressantName: 'Attack Suppressant' },
  { stat: 'def', label: 'Defense', vitaminName: 'Iron', suppressantName: 'Defense Suppressant' },
  { stat: 'satk', label: 'Sp. Atk', vitaminName: 'Calcium', suppressantName: 'Special Attack Suppressant' },
  { stat: 'sdef', label: 'Sp. Def', vitaminName: 'Zinc', suppressantName: 'Special Defense Suppressant' },
  { stat: 'spd', label: 'Speed', vitaminName: 'Carbos', suppressantName: 'Speed Suppressant' },
]

export const POKEMON_VITAMIN_STAT_KEYS: readonly StatKey[] = POKEMON_VITAMIN_STAT_ITEMS.map((item) => item.stat)

export interface PokemonVitaminSummary {
  statBoosts: Record<StatKey, number>
  statSuppressants: Record<StatKey, number>
  statNetAdjustments: Record<StatKey, number>
  statVitaminCount: number
  vitaminSlotsUsed: number
  vitaminSlotsLeft: number
  exceedsVitaminLimit: boolean
  heartBoosterUsed: boolean
  heartBoosterTutorPointBonus: number
  ppUpUsed: boolean
  rareCandies: number
  rareCandiesLeft: number
  heartScales: number
}

const emptyStatCounts = (): Record<StatKey, number> => ({
  hp: 0,
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
})

export const coercePokemonVitaminCount = (
  value: unknown,
  options: { min?: number; max?: number } = {},
): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return options.min ?? 0

  const min = options.min ?? 0
  const max = options.max
  const wholeValue = Math.trunc(numericValue)
  const boundedBelow = Math.max(min, wholeValue)
  return max == null ? boundedBelow : Math.min(max, boundedBelow)
}

export const pokemonVitaminStatCount = (
  vitamins: CharacterSheetVitaminTracking | null | undefined,
  kind: PokemonVitaminStatCountKind,
  stat: StatKey,
): number => coercePokemonVitaminCount(vitamins?.[kind]?.[stat])

const countStatBoosts = (
  vitamins: CharacterSheetVitaminTracking | null | undefined,
  kind: PokemonVitaminStatCountKind,
): Record<StatKey, number> => {
  const counts = emptyStatCounts()
  for (const stat of POKEMON_VITAMIN_STAT_KEYS) {
    counts[stat] = pokemonVitaminStatCount(vitamins, kind, stat)
  }
  return counts
}

const sumStatCounts = (counts: Record<StatKey, number>): number =>
  POKEMON_VITAMIN_STAT_KEYS.reduce((sum, stat) => sum + counts[stat], 0)

export const resolvePokemonVitaminSummary = (sheet: CharacterSheet | null | undefined): PokemonVitaminSummary => {
  const vitamins = sheet?.vitamins
  const statBoosts = countStatBoosts(vitamins, 'statBoosts')
  const statSuppressants = countStatBoosts(vitamins, 'statSuppressants')
  const statNetAdjustments = emptyStatCounts()

  for (const stat of POKEMON_VITAMIN_STAT_KEYS) {
    statNetAdjustments[stat] = statBoosts[stat] - statSuppressants[stat]
  }

  const statVitaminCount = sumStatCounts(statBoosts)
  const heartBoosterUsed = vitamins?.heartBooster === true
  const ppUpUsed = vitamins?.ppUp === true
  const vitaminSlotsUsed = statVitaminCount + (heartBoosterUsed ? 1 : 0) + (ppUpUsed ? 1 : 0)
  const rareCandies = coercePokemonVitaminCount(vitamins?.rareCandies, { max: POKEMON_RARE_CANDY_LIMIT })

  return {
    statBoosts,
    statSuppressants,
    statNetAdjustments,
    statVitaminCount,
    vitaminSlotsUsed,
    vitaminSlotsLeft: POKEMON_VITAMIN_LIMIT - vitaminSlotsUsed,
    exceedsVitaminLimit: vitaminSlotsUsed > POKEMON_VITAMIN_LIMIT,
    heartBoosterUsed,
    heartBoosterTutorPointBonus: heartBoosterUsed ? HEART_BOOSTER_TUTOR_POINT_BONUS : 0,
    ppUpUsed,
    rareCandies,
    rareCandiesLeft: POKEMON_RARE_CANDY_LIMIT - rareCandies,
    heartScales: coercePokemonVitaminCount(vitamins?.heartScales),
  }
}

export const resolvePokemonStatVitaminAdjustment = (
  sheet: CharacterSheet | null | undefined,
  stat: StatKey,
): number => resolvePokemonVitaminSummary(sheet).statNetAdjustments[stat]
