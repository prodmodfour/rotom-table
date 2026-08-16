import pokedexJson from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { isPlainJsonObject, type StrictJsonObject } from '~~/shared/automation/strictJson'
import {
  EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
  parseSheetEquipmentStateForOwner,
  type EquipmentItemConfigurationV1,
  type EquipmentSlotId,
  type SheetEquipmentStateV1,
} from '~~/shared/itemAutomation/equipment'
import type {
  EquipmentConfigurationDefinitionV1,
  EquipmentConfigurationFieldV1,
  EquipmentDefinitionV1,
} from '~~/shared/itemAutomation/equipmentDefinitions'
import {
  equipmentConfigurationDefinitionSha256,
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from './equipmentDefinitionRegistry'
import {
  reviewedItemFormChangeForId,
  reviewedItemFormChangesForSpecies,
} from './formChangeRegistry'

export type EquipmentCompatibilityOwner =
  | { readonly kind: 'trainer'; readonly slug: string; readonly sheet: TrainerSheet }
  | { readonly kind: 'pokemon'; readonly slug: string; readonly sheet: CharacterSheet }

export type EquipmentCompatibilityReasonCode =
  | 'equipment.definition-unavailable'
  | 'equipment.record-stale'
  | 'equipment.owner-incompatible'
  | 'equipment.slot-incompatible'
  | 'equipment.slot-occupied'
  | 'equipment.unresolved-slot'
  | 'equipment.exclusivity-conflict'
  | 'equipment.configuration-required'
  | 'equipment.configuration-unexpected'
  | 'equipment.configuration-invalid'
  | 'equipment.configuration-stale'
  | 'equipment.capability-required'
  | 'equipment.skill-required'
  | 'equipment.species-incompatible'
  | 'equipment.evolution-stage-incompatible'

export interface EquipmentCompatibilityReason {
  readonly code: EquipmentCompatibilityReasonCode
  /** Current reviewed definition hash when available; never an inventory identity. */
  readonly sourceId: string | null
  readonly message: string
}

export interface EquipmentCompatibilityResult {
  readonly eligible: boolean
  readonly canonicalItemId: string
  readonly requestedSlots: readonly EquipmentSlotId[]
  readonly equipmentDefinitionSha256: string | null
  readonly configurationDefinitionSha256: string | null
  readonly reasons: readonly EquipmentCompatibilityReason[]
  readonly unavailableReason: EquipmentCompatibilityReason | null
}

interface PokedexEntry {
  readonly species?: string
  readonly evolution_stage?: number
  readonly evolutions_remaining?: number
  readonly evolutions?: readonly { readonly stage?: number; readonly species?: string }[]
}
const pokedex = new Map((pokedexJson as readonly PokedexEntry[])
  .flatMap(entry => typeof entry.species === 'string' ? [[entry.species, entry] as const] : []))

const slotLabels: Readonly<Record<EquipmentSlotId, string>> = Object.freeze({
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
  head: 'Head',
  body: 'Body',
  feet: 'Feet',
  accessory: 'Accessory',
  held: 'Held Item',
  'held-secondary': 'Second Held Item',
})

const sameSlots = (left: readonly EquipmentSlotId[], right: readonly EquipmentSlotId[]): boolean =>
  left.length === right.length && left.every((slot, index) => slot === right[index])

const reason = (
  code: EquipmentCompatibilityReasonCode,
  message: string,
  sourceId: string | null,
): EquipmentCompatibilityReason => Object.freeze({ code, message, sourceId })

export interface EquipmentConfigurationCandidate {
  readonly configuration: EquipmentItemConfigurationV1 | null
  readonly label: string | null
}

const configurationKeyLabels: Readonly<Record<string, string>> = Object.freeze({
  statId: 'Stat',
  boostedStatIds: 'Boosted Stats',
  contestStatId: 'Contest Stat',
  typeId: 'Type',
  durabilityMaximum: 'Maximum Durability',
  familyAnchorSpeciesId: 'Evolution Family',
  baseSpeciesId: 'Base Species',
  megaFormSpeciesId: 'Mega Form',
})
const configurationValueLabels: Readonly<Record<string, string>> = Object.freeze({
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  satk: 'Special Attack',
  sdef: 'Special Defense',
  spd: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
  beauty: 'Beauty',
  cool: 'Cool',
  cute: 'Cute',
  smart: 'Smart',
  tough: 'Tough',
})
const displayConfigurationKey = (key: string): string => configurationKeyLabels[key] ?? key
  .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
  .replace(/^./u, value => value.toUpperCase())
const displayConfigurationScalar = (value: string | number): string => {
  if (typeof value === 'number') return String(value)
  return configurationValueLabels[value] ?? value
    .replace(/^mega-/u, 'Mega ')
    .replace(/-/gu, ' ')
    .replace(/\b\p{L}/gu, character => character.toUpperCase())
}
const displayConfigurationValue = (value: string | number | readonly string[]): string => (
  Array.isArray(value)
    ? value.map(entry => displayConfigurationScalar(entry)).join(' + ')
    : displayConfigurationScalar(value as string | number)
)
const distinctCombinations = (values: readonly string[], count: number): readonly (readonly string[])[] => {
  const results: string[][] = []
  const visit = (start: number, selected: readonly string[]): void => {
    if (selected.length === count) {
      results.push([...selected])
      return
    }
    for (let index = start; index < values.length; index += 1) visit(index + 1, [...selected, values[index]!])
  }
  visit(0, [])
  return results
}

/**
 * Bounded current choices for a reviewed configuration definition. Opaque
 * inventory offers bind one of these structured values; clients never author
 * arbitrary configuration JSON.
 */
export const equipmentConfigurationCandidatesForOwner = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly definition: EquipmentDefinitionV1
}): readonly EquipmentConfigurationCandidate[] => {
  const configuration = input.definition.configuration
  if (!configuration) return Object.freeze([Object.freeze({ configuration: null, label: null })])
  const definitionSha256 = equipmentConfigurationDefinitionSha256(input.definition.canonicalItemId)
  if (!definitionSha256) return Object.freeze([])

  const valuesFor = (field: EquipmentConfigurationFieldV1): readonly (string | number | readonly string[])[] => {
    if (field.kind === 'enum' || field.kind === 'integer-enum') return field.values
    if (field.kind === 'distinct-enum-array') return distinctCombinations(field.values, field.count)
    if (input.owner.kind !== 'pokemon') return []
    if (field.kind === 'owner-species') return input.owner.sheet.species ? [input.owner.sheet.species] : []
    if (field.kind === 'canonical-mega-form') {
      return reviewedItemFormChangesForSpecies(input.owner.sheet.species)
        .filter(form => form.requiresMegaStone)
        .map(form => form.formId)
    }
    if (field.kind === 'canonical-species') return [...pokedex.keys()].sort((left, right) => left.localeCompare(right))
    const entry = pokedex.get(input.owner.sheet.species)
    const anchor = entry?.evolutions
      ?.filter(evolution => evolution.stage === 1 && typeof evolution.species === 'string')
      .map(evolution => evolution.species as string)[0]
    return anchor ? [anchor] : []
  }

  let combinations: readonly Record<string, string | number | readonly string[]>[] = [Object.freeze({})]
  for (const field of configuration.fields) {
    const fieldValues = valuesFor(field)
    if (!fieldValues.length || combinations.length * fieldValues.length > 128) return Object.freeze([])
    combinations = combinations.flatMap(current => fieldValues.map(value => Object.freeze({
      ...current,
      [field.key]: value,
    })))
  }
  return Object.freeze(combinations.map((values): EquipmentConfigurationCandidate => Object.freeze({
    configuration: Object.freeze({
      schemaVersion: EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
      configurationId: configuration.configurationId,
      definitionSha256,
      values: values as StrictJsonObject,
    }),
    label: configuration.fields.map(field => (
      `${displayConfigurationKey(field.key)}: ${displayConfigurationValue(values[field.key]!)}`
    )).join(' · '),
  })))
}

const configurationValuesAreValid = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly configuration: EquipmentItemConfigurationV1
  readonly definition: EquipmentConfigurationDefinitionV1
}): boolean => {
  if (!isPlainJsonObject(input.configuration.values)) return false
  const values = input.configuration.values as Record<string, unknown>
  const expectedKeys = input.definition.fields.map(field => field.key)
  if (Object.keys(values).length !== expectedKeys.length
    || expectedKeys.some(key => !Object.hasOwn(values, key))) return false

  const fieldValid = (field: EquipmentConfigurationFieldV1): boolean => {
    const value = values[field.key]
    if (field.kind === 'enum') return typeof value === 'string' && field.values.includes(value)
    if (field.kind === 'integer-enum') {
      return typeof value === 'number' && Number.isSafeInteger(value) && field.values.includes(value)
    }
    if (field.kind === 'distinct-enum-array') {
      return Array.isArray(value)
        && value.length === field.count
        && new Set(value).size === value.length
        && value.every(entry => typeof entry === 'string' && field.values.includes(entry))
    }
    if (input.owner.kind !== 'pokemon' || typeof value !== 'string') return false
    if (field.kind === 'owner-species') return value === input.owner.sheet.species
    if (field.kind === 'canonical-species') return pokedex.has(value)
    if (field.kind === 'canonical-mega-form') {
      const form = reviewedItemFormChangeForId(value)
      return form !== null && form.requiresMegaStone && form.baseSpeciesId === input.owner.sheet.species
        && values.baseSpeciesId === form.baseSpeciesId
    }
    const entry = pokedex.get(input.owner.sheet.species)
    const firstStage = entry?.evolutions
      ?.filter(evolution => evolution.stage === 1 && typeof evolution.species === 'string')
      .map(evolution => evolution.species as string)[0]
    return typeof firstStage === 'string' && value === firstStage
  }
  return input.definition.fields.every(fieldValid)
}

const configurationReasons = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly configuration: EquipmentItemConfigurationV1 | null
  readonly definition: EquipmentDefinitionV1
  readonly definitionHash: string
}): EquipmentCompatibilityReason[] => {
  const expected = input.definition.configuration
  if (!expected) {
    return input.configuration === null ? [] : [reason(
      'equipment.configuration-unexpected',
      'This item does not accept equipment configuration.',
      input.definitionHash,
    )]
  }
  if (!input.configuration) return [reason(
    'equipment.configuration-required',
    'Choose the required item configuration before equipping this item.',
    input.definitionHash,
  )]
  const expectedHash = equipmentConfigurationDefinitionSha256(input.definition.canonicalItemId)
  if (!expectedHash || input.configuration.definitionSha256 !== expectedHash) return [reason(
    'equipment.configuration-stale',
    'This item configuration is no longer current. Review it before equipping.',
    input.definitionHash,
  )]
  if (input.configuration.configurationId !== expected.configurationId
    || !configurationValuesAreValid({
      owner: input.owner,
      configuration: input.configuration,
      definition: expected,
    })) return [reason(
      'equipment.configuration-invalid',
      'This item configuration is not valid for its current owner.',
      input.definitionHash,
    )]
  return []
}

const prerequisiteReasons = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly definition: EquipmentDefinitionV1
  readonly definitionHash: string
}): EquipmentCompatibilityReason[] => input.definition.prerequisites.flatMap((prerequisite) => {
  if (prerequisite.ownerKind !== input.owner.kind) return []
  if (prerequisite.kind === 'capability') {
    if (input.owner.kind === 'pokemon'
      && pokemonHasResolvedCapability(input.owner.sheet, prerequisite.canonicalId)) return []
    return [reason(
      'equipment.capability-required',
      `This Pokémon requires the ${prerequisite.canonicalId} Capability to equip this item.`,
      input.definitionHash,
    )]
  }
  if (prerequisite.kind === 'trainer-skill-any') {
    const ranks = input.owner.kind === 'trainer'
      ? new Map(resolveTrainerSkills(input.owner.sheet).map(skill => [skill.key, skill.rankValue]))
      : new Map<string, number>()
    if (prerequisite.skillIds.some(skillId => (ranks.get(skillId) ?? 0) >= prerequisite.minimumRankValue)) return []
    return [reason(
      'equipment.skill-required',
      'This item requires Expert Medicine Education or Technology Education.',
      input.definitionHash,
    )]
  }
  if (input.owner.kind !== 'pokemon') return []
  const ownerSpecies = input.owner.sheet.species
  if (prerequisite.kind === 'pokemon-species') {
    if (prerequisite.speciesIds.includes(ownerSpecies)) return []
    return [reason(
      'equipment.species-incompatible',
      `This held item is restricted to ${prerequisite.speciesIds.join(' or ')}.`,
      input.definitionHash,
    )]
  }
  const entry = pokedex.get(ownerSpecies)
  const remaining = entry?.evolutions_remaining
  const stage = entry?.evolution_stage
  const evolutionStages = entry?.evolutions
    ?.flatMap(evolution => Number.isSafeInteger(evolution.stage) ? [Number(evolution.stage)] : []) ?? []
  const maximumStage = evolutionStages.length ? Math.max(...evolutionStages) : null
  const exactStageEvidence = entry?.evolutions?.some(evolution =>
    evolution.species === ownerSpecies && evolution.stage === stage) ?? false
  if (typeof remaining === 'number' && Number.isSafeInteger(remaining) && remaining > 0
    && typeof stage === 'number' && Number.isSafeInteger(stage)
    && maximumStage !== null && stage < maximumStage && exactStageEvidence) return []
  return [reason(
    'equipment.evolution-stage-incompatible',
    'This held item requires a Pokémon that is not fully evolved.',
    input.definitionHash,
  )]
})

const exclusivityReasons = (input: {
  readonly state: SheetEquipmentStateV1
  readonly definition: EquipmentDefinitionV1
  readonly definitionHash: string
  readonly currentInstanceId?: string
}): EquipmentCompatibilityReason[] => {
  if (!input.definition.exclusivityFamilies.length) return []
  const requestedFamilies = new Set(input.definition.exclusivityFamilies)
  const conflict = input.state.instances.some((instance) => {
    if (instance.instanceId === input.currentInstanceId) return false
    const otherDefinition = equipmentDefinitionFor(instance.canonicalItemId)
    return otherDefinition?.exclusivityFamilies.some(family => requestedFamilies.has(family)) ?? false
  })
  if (!conflict) return []
  return [reason(
    'equipment.exclusivity-conflict',
    input.definition.exclusivityFamilies.includes('focus')
      ? 'Only one Focus can be equipped at a time.'
      : 'This item conflicts with other equipped gear.',
    input.definitionHash,
  )]
}

/**
 * Resolve compatibility from current authoritative sheet and reviewed data.
 * This function never moves inventory; callers must require eligible=true
 * before planning any custody mutation.
 */
export const evaluateEquipmentCompatibility = (input: {
  readonly owner: EquipmentCompatibilityOwner
  readonly equipmentState: SheetEquipmentStateV1
  readonly canonicalItemId: string
  /** When revalidating serialized gear, this must match the current app-owned item record. */
  readonly canonicalRecordSha256?: string
  readonly requestedSlots: readonly EquipmentSlotId[]
  readonly configuration: EquipmentItemConfigurationV1 | null
  /** Existing instance being revalidated; its own slot claims and family are ignored. */
  readonly currentInstanceId?: string
}): EquipmentCompatibilityResult => {
  const state = parseSheetEquipmentStateForOwner(input.equipmentState, {
    kind: input.owner.kind,
    slug: input.owner.slug,
  })
  const definition = equipmentDefinitionFor(input.canonicalItemId)
  const definitionHash = equipmentDefinitionSha256(input.canonicalItemId)
  const compatibilitySlots = input.owner.kind === 'pokemon'
    ? input.requestedSlots.map(slot => slot === 'held-secondary' ? 'held' as const : slot)
    : input.requestedSlots
  const reasons: EquipmentCompatibilityReason[] = []
  if (!definition || !definitionHash) {
    reasons.push(reason(
      'equipment.definition-unavailable',
      'This item does not have a current reviewed equipment definition.',
      null,
    ))
  }
  else {
    if (input.canonicalRecordSha256 !== undefined
      && input.canonicalRecordSha256 !== definition.canonicalRecordSha256) reasons.push(reason(
      'equipment.record-stale',
      'This equipped item is stale against current canonical item data. Review it before continuing.',
      definitionHash,
    ))
    const ownerRule = definition.ownerRules.find(rule => rule.ownerKind === input.owner.kind)
    if (!ownerRule) reasons.push(reason(
      'equipment.owner-incompatible',
      input.owner.kind === 'trainer'
        ? 'This item cannot be equipped by a Trainer.'
        : 'This item cannot be equipped by a Pokémon.',
      definitionHash,
    ))
    else if (!ownerRule.slotOptions.some(option => sameSlots(option, compatibilitySlots))) {
      reasons.push(reason(
        'equipment.slot-incompatible',
        input.requestedSlots.length
          ? `This item cannot occupy ${input.requestedSlots.map(slot => slotLabels[slot]).join(' + ')}.`
          : 'Choose a compatible equipment slot.',
        definitionHash,
      ))
    }
    else {
      const unresolved = input.requestedSlots.find(slotId =>
        state.unresolved.some(issue => issue.slotId === slotId))
      if (unresolved) reasons.push(reason(
        'equipment.unresolved-slot',
        `${slotLabels[unresolved]} has unresolved legacy equipment. Ask the GM to resolve it first.`,
        definitionHash,
      ))
      const occupied = input.requestedSlots.find((slotId) => {
        const assigned = state.slots.find(slot => slot.slotId === slotId)?.instanceId ?? null
        return assigned !== null && assigned !== input.currentInstanceId
      })
      if (occupied) reasons.push(reason(
        'equipment.slot-occupied',
        `${slotLabels[occupied]} is already occupied. Unequip it before continuing.`,
        definitionHash,
      ))
    }
    reasons.push(...configurationReasons({
      owner: input.owner,
      configuration: input.configuration,
      definition,
      definitionHash,
    }))
    reasons.push(...prerequisiteReasons({ owner: input.owner, definition, definitionHash }))
    reasons.push(...exclusivityReasons({
      state,
      definition,
      definitionHash,
      currentInstanceId: input.currentInstanceId,
    }))
  }
  const frozenReasons = Object.freeze(reasons)
  return Object.freeze({
    eligible: reasons.length === 0,
    canonicalItemId: input.canonicalItemId,
    requestedSlots: Object.freeze([...input.requestedSlots]),
    equipmentDefinitionSha256: definitionHash,
    configurationDefinitionSha256: equipmentConfigurationDefinitionSha256(input.canonicalItemId),
    reasons: frozenReasons,
    unavailableReason: frozenReasons[0] ?? null,
  })
}
