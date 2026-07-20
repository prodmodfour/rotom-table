import {
  CELEBRATE_ABILITY_NAME,
  CUTE_CHARM_ABILITY_NAME,
  HEALER_ABILITY_NAME,
  INTIMIDATE_ABILITY_NAME,
  LEAF_GUARD_ABILITY_NAME,
  MOXIE_ABILITY_NAME,
  POISON_POINT_ABILITY_NAME,
  POISON_TOUCH_ABILITY_NAME,
  SHIELD_DUST_ABILITY_NAME,
  SWEET_VEIL_ABILITY_NAME,
} from '#shared/abilityAutomation/legacyNames'
import { normalizeCombatStages } from '~/utils/combatStages'
import {
  conditionBaseName,
  conditionByName,
  conditionDisplayName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { isSheetActivatableAbility } from '~/utils/sheetAbilityActivation'
import { resolveCanonicalSheetAbilityName, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import { QUICK_FEET_ABILITY_NAME } from '~/utils/sheetConditionEffects'
import {
  COMPOUND_EYES_ABILITY_NAME,
  ILLUMINATE_ABILITY_NAME,
  KEEN_EYE_ABILITY_NAME,
  NO_GUARD_ABILITY_NAME,
} from '~/utils/sheetAbilityCombatModifiers'
import { MUD_DWELLER_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import type { AbilityAutomationCategory, AbilityAutomationTransaction } from '~/types/abilityAutomation'
import type { MapFieldEffects } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'

export {
  CELEBRATE_ABILITY_NAME,
  CUTE_CHARM_ABILITY_NAME,
  HEALER_ABILITY_NAME,
  INTIMIDATE_ABILITY_NAME,
  LEAF_GUARD_ABILITY_NAME,
  MOXIE_ABILITY_NAME,
  POISON_POINT_ABILITY_NAME,
  POISON_TOUCH_ABILITY_NAME,
  SHIELD_DUST_ABILITY_NAME,
  SWEET_VEIL_ABILITY_NAME,
} from '#shared/abilityAutomation/legacyNames'

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
    CELEBRATE_ABILITY_NAME,
    {
      name: CELEBRATE_ABILITY_NAME,
      category: 'map',
      label: 'Assisted',
      targetMode: 'self',
      rangeLabel: 'self',
      rangeMeters: 0,
    },
  ],
  [
    HEALER_ABILITY_NAME,
    {
      name: HEALER_ABILITY_NAME,
      category: 'map',
      label: 'Map',
      targetMode: 'target',
      rangeLabel: 'the map',
      rangeMeters: MAP_WIDE_RANGE_METERS,
    },
  ],
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
    LEAF_GUARD_ABILITY_NAME,
    {
      name: LEAF_GUARD_ABILITY_NAME,
      category: 'map',
      label: 'Self',
      targetMode: 'self',
      rangeLabel: 'self',
      rangeMeters: 0,
    },
  ],
  [
    MOXIE_ABILITY_NAME,
    {
      name: MOXIE_ABILITY_NAME,
      category: 'map',
      label: 'Assisted',
      targetMode: 'self',
      rangeLabel: 'self',
      rangeMeters: 0,
    },
  ],
])

const PASSIVE_ABILITY_AUTOMATIONS = new Map<string, PassiveAbilityAutomationDefinition>([
  [
    COMPOUND_EYES_ABILITY_NAME,
    {
      name: COMPOUND_EYES_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    CUTE_CHARM_ABILITY_NAME,
    {
      name: CUTE_CHARM_ABILITY_NAME,
      category: 'passive',
      label: 'Assisted',
    },
  ],
  [
    ILLUMINATE_ABILITY_NAME,
    {
      name: ILLUMINATE_ABILITY_NAME,
      category: 'passive',
      label: 'Auto',
    },
  ],
  [
    KEEN_EYE_ABILITY_NAME,
    {
      name: KEEN_EYE_ABILITY_NAME,
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
    POISON_POINT_ABILITY_NAME,
    {
      name: POISON_POINT_ABILITY_NAME,
      category: 'passive',
      label: 'Assisted',
    },
  ],
  [
    POISON_TOUCH_ABILITY_NAME,
    {
      name: POISON_TOUCH_ABILITY_NAME,
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
    MUD_DWELLER_ABILITY_NAME,
    {
      name: MUD_DWELLER_ABILITY_NAME,
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

const STATUS_AFFLICTION_CATEGORIES = new Set(['Persistent Affliction', 'Volatile Affliction'])

interface StatusAfflictionCureResult {
  nextConditions: string[]
  curedConditions: string[]
}

const isStatusAfflictionCondition = (condition: string): boolean => {
  const canonicalName = conditionBaseName(condition) ?? condition
  const category = conditionByName.get(canonicalName)?.category
  return category ? STATUS_AFFLICTION_CATEGORIES.has(category) : false
}

const cureAllStatusAfflictions = (
  conditions: readonly string[] | null | undefined,
): StatusAfflictionCureResult => {
  const previousConditions = normalizeConditionNames(conditions)
  const curedConditions = previousConditions.filter(isStatusAfflictionCondition)
  const nextConditions = previousConditions.filter((condition) => !isStatusAfflictionCondition(condition))
  return { nextConditions, curedConditions }
}

const cureOneStatusAffliction = (
  conditions: readonly string[] | null | undefined,
): StatusAfflictionCureResult => {
  const previousConditions = normalizeConditionNames(conditions)
  const curedIndex = previousConditions.findIndex(isStatusAfflictionCondition)
  if (curedIndex === -1) return { nextConditions: previousConditions, curedConditions: [] }

  return {
    nextConditions: previousConditions.filter((_, index) => index !== curedIndex),
    curedConditions: [previousConditions[curedIndex]],
  }
}

const formatConditionList = (conditions: readonly string[]): string => {
  const labels = conditions.map(conditionDisplayName).filter(Boolean)
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

const conditionUpdatesForCure = (
  token: SpawnedPokemon,
  cure: StatusAfflictionCureResult,
): AbilityAutomationTransaction['conditionUpdates'] => cure.curedConditions.length
  ? [{ id: token.id, conditions: cure.nextConditions }]
  : []

const statusCureLogLine = (targetName: string, cure: StatusAfflictionCureResult): string => {
  if (!cure.curedConditions.length) return `${targetName} has no status afflictions to cure.`
  return `${targetName} was cured of ${formatConditionList(cure.curedConditions)}.`
}

const hasSunnyWeather = (fieldEffects: MapFieldEffects | null | undefined): boolean =>
  (fieldEffects?.weather ?? []).some((weather) => weather.kind === 'sunny')

export const resolveMapAbilityAutomationTransaction = (options: {
  abilityName: string
  user: SpawnedPokemon
  target?: SpawnedPokemon | null
  fieldEffects?: MapFieldEffects | null
}): AbilityAutomationTransaction | null => {
  const definition = getMapAbilityAutomation(options.abilityName)
  if (!definition) return null

  if (definition.name === CELEBRATE_ABILITY_NAME) {
    const triggerLine = options.target
      ? `${options.user.species} triggered ${definition.name} after hitting ${options.target.species}.`
      : `${options.user.species} used ${definition.name}.`
    return {
      userId: options.user.id,
      userName: options.user.species,
      abilityName: definition.name,
      category: definition.category,
      combatStageUpdates: [],
      conditionUpdates: [],
      logLines: [
        triggerLine,
        `${options.user.species} may immediately Disengage 1 meter as a Free Action without provoking an Attack of Opportunity.`,
      ],
    }
  }

  if (definition.name === HEALER_ABILITY_NAME) {
    if (!options.target) return null
    const cure = cureAllStatusAfflictions(options.target.conditions)
    return {
      userId: options.user.id,
      userName: options.user.species,
      abilityName: definition.name,
      category: definition.category,
      combatStageUpdates: [],
      conditionUpdates: conditionUpdatesForCure(options.target, cure),
      logLines: [
        `${options.user.species} used ${definition.name} on ${options.target.species}.`,
        statusCureLogLine(options.target.species, cure),
      ],
    }
  }

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
      conditionUpdates: [],
      logLines: [
        `${options.user.species} used ${definition.name} on ${options.target.species}.`,
        `${options.target.species}'s Attack fell by 1 Combat Stage.`,
      ],
    }
  }

  if (definition.name === LEAF_GUARD_ABILITY_NAME) {
    const cure = cureOneStatusAffliction(options.user.conditions)
    const sunnyLine = hasSunnyWeather(options.fieldEffects)
      ? `${definition.name}'s frequency is ignored during Sunny Weather.`
      : null
    return {
      userId: options.user.id,
      userName: options.user.species,
      abilityName: definition.name,
      category: definition.category,
      combatStageUpdates: [],
      conditionUpdates: conditionUpdatesForCure(options.user, cure),
      logLines: [
        `${options.user.species} used ${definition.name}.`,
        statusCureLogLine(options.user.species, cure),
        sunnyLine,
      ].filter((line): line is string => Boolean(line)),
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
      conditionUpdates: [],
      logLines: [triggerLine, stageLine],
    }
  }

  return null
}
