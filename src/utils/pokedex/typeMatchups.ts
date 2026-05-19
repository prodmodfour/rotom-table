import {
  POKEMON_TYPES,
  isPokemonType,
  multiplierFromEffectivenessSteps,
  singleTypeMultiplier,
  type PokemonType,
} from '~/utils/typeChart'
import { applySheetPassiveTypeEffectiveness } from '~/utils/sheetPassiveAbilityEffects'
import type { SheetAbilityNameSource } from '~/utils/sheetAbilities'

export type TypeMatchupGroupKey = 'weaknesses' | 'resistances' | 'immunities'

export interface TypeMatchupItem {
  type: PokemonType
  multiplier: number
  label: string
}

export interface TypeMatchupGroup {
  key: TypeMatchupGroupKey
  label: string
  items: TypeMatchupItem[]
}

const TYPE_MATCHUP_ORDER = new Map<PokemonType, number>(
  POKEMON_TYPES.map((type, index) => [type, index] as const),
)

const compareTypeMatchupOrder = (a: TypeMatchupItem, b: TypeMatchupItem) => (
  (TYPE_MATCHUP_ORDER.get(a.type) ?? 0) - (TYPE_MATCHUP_ORDER.get(b.type) ?? 0)
)

export const computePtuTypeMultiplier = (
  attacker: PokemonType,
  defenders: PokemonType[],
  abilities?: readonly SheetAbilityNameSource[] | null,
): number => {
  let effectivenessSteps = 0

  for (const defender of defenders) {
    const singleTypeMatchup = singleTypeMultiplier(attacker, defender)

    if (singleTypeMatchup === 0) return 0
    if (singleTypeMatchup > 1) effectivenessSteps += 1
    if (singleTypeMatchup < 1) effectivenessSteps -= 1
  }

  return applySheetPassiveTypeEffectiveness(
    attacker,
    multiplierFromEffectivenessSteps(effectivenessSteps),
    abilities,
  )
}

export const formatPtuMultiplier = (multiplier: number): string => {
  if (multiplier === 0) return '0'
  if (multiplier === 0.125) return '1/8'
  if (multiplier === 0.25) return '1/4'
  if (multiplier === 0.5) return '1/2'
  return multiplier.toString()
}

export const buildTypeMatchupGroups = (
  rawDefendingTypes: readonly string[] | null | undefined,
  abilities?: readonly SheetAbilityNameSource[] | null,
): TypeMatchupGroup[] => {
  const defendingTypes = (rawDefendingTypes ?? []).filter(isPokemonType)
  if (defendingTypes.length === 0) return []

  const matchups = POKEMON_TYPES.map((type): TypeMatchupItem => {
    const multiplier = computePtuTypeMultiplier(type, defendingTypes, abilities)
    return {
      type,
      multiplier,
      label: formatPtuMultiplier(multiplier),
    }
  })

  const weaknesses = matchups
    .filter((matchup) => matchup.multiplier > 1)
    .sort((a, b) => (b.multiplier - a.multiplier) || compareTypeMatchupOrder(a, b))
  const resistances = matchups
    .filter((matchup) => matchup.multiplier > 0 && matchup.multiplier < 1)
    .sort((a, b) => (a.multiplier - b.multiplier) || compareTypeMatchupOrder(a, b))
  const immunities = matchups.filter((matchup) => matchup.multiplier === 0)

  const groups: TypeMatchupGroup[] = [
    { key: 'weaknesses', label: 'Weaknesses', items: weaknesses },
    { key: 'resistances', label: 'Resistances', items: resistances },
    { key: 'immunities', label: 'Immunities', items: immunities },
  ]

  return groups.filter((group) => group.items.length > 0)
}
