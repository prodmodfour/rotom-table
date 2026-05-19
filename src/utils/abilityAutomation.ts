import { normalizeCombatStages } from '~/utils/combatStages'
import { isSheetActivatableAbility } from '~/utils/sheetAbilityActivation'
import { resolveCanonicalSheetAbilityName, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import { QUICK_FEET_ABILITY_NAME } from '~/utils/sheetConditionEffects'
import { NO_GUARD_ABILITY_NAME } from '~/utils/sheetAbilityCombatModifiers'
import type { AbilityAutomationCategory, AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const CUTE_CHARM_ABILITY_NAME = 'Cute Charm'
export const INTIMIDATE_ABILITY_NAME = 'Intimidate'
export const MOXIE_ABILITY_NAME = 'Moxie'
export const SHIELD_DUST_ABILITY_NAME = 'Shield Dust'
export const SWEET_VEIL_ABILITY_NAME = 'Sweet Veil'

export interface SheetAbilityAutomationDefinition {
  readonly name: string
  readonly category: 'sheet'
  readonly label: string
}

export type MapAbilityTargetMode = 'target' | 'self'

export interface MapAbilityAutomationDefinition {
  readonly name: string
  readonly category: 'map'
  readonly label: string
  readonly targetMode: MapAbilityTargetMode
  readonly rangeLabel: string
  readonly rangeMeters: number
}

export interface PassiveAbilityAutomationDefinition {
  readonly name: string
  readonly category: 'passive'
  readonly label: string
}

export type AbilityAutomationDefinition =
  | SheetAbilityAutomationDefinition
  | MapAbilityAutomationDefinition
  | PassiveAbilityAutomationDefinition

const MAP_WIDE_RANGE_METERS = Number.POSITIVE_INFINITY

const MAP_ABILITY_AUTOMATIONS = new Map<string, MapAbilityAutomationDefinition>([
  [
    INTIMIDATE_ABILITY_NAME,
    {
      name: INTIMIDATE_ABILITY_NAME,
      category: 'map',
      label: 'Map',
      targetMode: 'target',
      rangeLabel: 'the map',
      rangeMeters: MAP_WIDE_RANGE_METERS,
    },
  ],
  [
    MOXIE_ABILITY_NAME,
    {
      name: MOXIE_ABILITY_NAME,
      category: 'map',
      label: 'Self',
      targetMode: 'self',
      rangeLabel: 'self',
      rangeMeters: 0,
    },
  ],
])

const PASSIVE_ABILITY_AUTOMATIONS = new Map<string, PassiveAbilityAutomationDefinition>([
  [
    CUTE_CHARM_ABILITY_NAME,
    {
      name: CUTE_CHARM_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    QUICK_FEET_ABILITY_NAME,
    {
      name: QUICK_FEET_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    NO_GUARD_ABILITY_NAME,
    {
      name: NO_GUARD_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    SHIELD_DUST_ABILITY_NAME,
    {
      name: SHIELD_DUST_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    SWEET_VEIL_ABILITY_NAME,
    {
      name: SWEET_VEIL_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
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

export const getPassiveAbilityAutomation = (
  ability: SheetAbilityNameSource,
): PassiveAbilityAutomationDefinition | null => {
  const canonicalName = resolveCanonicalSheetAbilityName(ability)
  return canonicalName ? PASSIVE_ABILITY_AUTOMATIONS.get(canonicalName) ?? null : null
}

export const getAbilityAutomation = (
  ability: SheetAbilityNameSource,
): AbilityAutomationDefinition | null =>
  getSheetAbilityAutomation(ability) ?? getMapAbilityAutomation(ability) ?? getPassiveAbilityAutomation(ability)

export const getAbilityAutomationCategory = (
  ability: SheetAbilityNameSource,
): AbilityAutomationCategory | null => getAbilityAutomation(ability)?.category ?? null

export const isMapAbilityAutomationName = (abilityName: string): boolean =>
  getMapAbilityAutomation(abilityName) != null

export const mapAbilityTargetCandidates = (
  user: SpawnedPokemon,
  tokens: readonly SpawnedPokemon[],
  ability?: SheetAbilityNameSource,
): SpawnedPokemon[] => {
  const definition = ability ? getMapAbilityAutomation(ability) : null
  if (definition?.targetMode === 'self') return []
  return tokens.filter((token) => token.id !== user.id)
}

export const resolveMapAbilityAutomationTransaction = (options: {
  abilityName: string
  user: SpawnedPokemon
  target?: SpawnedPokemon | null
}): AbilityAutomationTransaction | null => {
  const definition = getMapAbilityAutomation(options.abilityName)
  if (!definition) return null

  if (definition.name === INTIMIDATE_ABILITY_NAME) {
    if (!options.target) return null
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

  if (definition.name === MOXIE_ABILITY_NAME) {
    const currentStages = normalizeCombatStages(options.user.combatStages)
    const nextStages = normalizeCombatStages({
      ...currentStages,
      atk: currentStages.atk + 1,
    })
    const triggerLine = options.target
      ? `${options.user.species} triggered ${definition.name} after causing ${options.target.species} to faint.`
      : `${options.user.species} triggered ${definition.name}.`
    const stageLine = nextStages.atk > currentStages.atk
      ? `${options.user.species}'s Attack rose by 1 Combat Stage.`
      : `${options.user.species}'s Attack is already at +6 Combat Stages.`
    return {
      userId: options.user.id,
      userName: options.user.species,
      abilityName: definition.name,
      category: definition.category,
      combatStageUpdates: [{ id: options.user.id, stages: nextStages }],
      logLines: [triggerLine, stageLine],
    }
  }

  return null
}
