import { normalizeCombatStages } from '~/utils/combatStages'
import { isSheetActivatableAbility } from '~/utils/sheetAbilityActivation'
import { resolveCanonicalSheetAbilityName, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import type { AbilityAutomationCategory, AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const INTIMIDATE_ABILITY_NAME = 'Intimidate'

export interface SheetAbilityAutomationDefinition {
  readonly name: string
  readonly category: 'sheet'
  readonly label: string
}

export interface MapAbilityAutomationDefinition {
  readonly name: string
  readonly category: 'map'
  readonly label: string
  readonly rangeLabel: string
  readonly rangeMeters: number
}

export type AbilityAutomationDefinition =
  | SheetAbilityAutomationDefinition
  | MapAbilityAutomationDefinition

const MAP_WIDE_RANGE_METERS = Number.POSITIVE_INFINITY

const MAP_ABILITY_AUTOMATIONS = new Map<string, MapAbilityAutomationDefinition>([
  [
    INTIMIDATE_ABILITY_NAME,
    {
      name: INTIMIDATE_ABILITY_NAME,
      category: 'map',
      label: 'Map',
      rangeLabel: 'the map',
      rangeMeters: MAP_WIDE_RANGE_METERS,
    },
  ],
])

const sheetAbilityAutomationForName = (name: string): SheetAbilityAutomationDefinition => ({
  name,
  category: 'sheet',
  label: 'Sheet',
})

export const getSheetAbilityAutomation = (
  ability: SheetAbilityNameSource,
): SheetAbilityAutomationDefinition | null => {
  const canonicalName = resolveCanonicalSheetAbilityName(ability)
  if (!canonicalName || !isSheetActivatableAbility(canonicalName)) return null
  return sheetAbilityAutomationForName(canonicalName)
}

export const getMapAbilityAutomation = (
  ability: SheetAbilityNameSource,
): MapAbilityAutomationDefinition | null => {
  const canonicalName = resolveCanonicalSheetAbilityName(ability)
  return canonicalName ? MAP_ABILITY_AUTOMATIONS.get(canonicalName) ?? null : null
}

export const getAbilityAutomation = (
  ability: SheetAbilityNameSource,
): AbilityAutomationDefinition | null =>
  getSheetAbilityAutomation(ability) ?? getMapAbilityAutomation(ability)

export const getAbilityAutomationCategory = (
  ability: SheetAbilityNameSource,
): AbilityAutomationCategory | null => getAbilityAutomation(ability)?.category ?? null

export const isMapAbilityAutomationName = (abilityName: string): boolean =>
  getMapAbilityAutomation(abilityName) != null

export const mapAbilityTargetCandidates = (
  user: SpawnedPokemon,
  tokens: readonly SpawnedPokemon[],
): SpawnedPokemon[] => tokens.filter((token) => token.id !== user.id)

export const resolveMapAbilityAutomationTransaction = (options: {
  abilityName: string
  user: SpawnedPokemon
  target: SpawnedPokemon
}): AbilityAutomationTransaction | null => {
  const definition = getMapAbilityAutomation(options.abilityName)
  if (!definition) return null

  if (definition.name === INTIMIDATE_ABILITY_NAME) {
    const nextStages = normalizeCombatStages({
      ...options.target.combatStages,
      atk: (options.target.combatStages.atk ?? 0) - 1,
    })
    return {
      userId: options.user.id,
      userName: options.user.species,
      abilityName: definition.name,
      category: definition.category,
      combatStageUpdates: [{ id: options.target.id, stages: nextStages }],
      logLines: [
        `${options.user.species} used ${definition.name} on ${options.target.species}.`,
        `${options.target.species}'s Attack fell by 1 Combat Stage.`,
      ],
    }
  }

  return null
}
