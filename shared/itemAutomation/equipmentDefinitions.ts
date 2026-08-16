import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import {
  POKEMON_EQUIPMENT_SLOT_IDS,
  TRAINER_EQUIPMENT_SLOT_IDS,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
} from './equipment'

export const EQUIPMENT_DEFINITION_SCHEMA_VERSION = 1 as const

export interface EquipmentOwnerRuleV1 {
  readonly ownerKind: EquipmentOwnerKind
  /** Each option is the complete slot set occupied by one whole item instance. */
  readonly slotOptions: readonly (readonly EquipmentSlotId[])[]
}

export type EquipmentPrerequisiteV1 =
  | {
    readonly kind: 'capability'
    readonly ownerKind: 'pokemon'
    readonly canonicalId: string
  }
  | {
    readonly kind: 'trainer-skill-any'
    readonly ownerKind: 'trainer'
    readonly skillIds: readonly string[]
    readonly minimumRankValue: number
  }
  | {
    readonly kind: 'pokemon-not-fully-evolved'
    readonly ownerKind: 'pokemon'
  }
  | {
    readonly kind: 'pokemon-species'
    readonly ownerKind: 'pokemon'
    readonly speciesIds: readonly string[]
  }

interface EquipmentConfigurationFieldBaseV1 {
  readonly key: string
  readonly required: true
}

export type EquipmentConfigurationFieldV1 =
  | (EquipmentConfigurationFieldBaseV1 & {
    readonly kind: 'enum'
    readonly values: readonly string[]
  })
  | (EquipmentConfigurationFieldBaseV1 & {
    readonly kind: 'distinct-enum-array'
    readonly values: readonly string[]
    readonly count: number
  })
  | (EquipmentConfigurationFieldBaseV1 & {
    readonly kind: 'integer-enum'
    readonly values: readonly number[]
  })
  | (EquipmentConfigurationFieldBaseV1 & {
    readonly kind: 'evolution-family-anchor' | 'owner-species' | 'canonical-species' | 'canonical-mega-form'
  })

export interface EquipmentConfigurationDefinitionV1 {
  readonly configurationId: string
  readonly fields: readonly EquipmentConfigurationFieldV1[]
}

export interface EquipmentDefinitionV1 {
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly ownerRules: readonly EquipmentOwnerRuleV1[]
  readonly prerequisites: readonly EquipmentPrerequisiteV1[]
  readonly exclusivityFamilies: readonly string[]
  readonly configuration: EquipmentConfigurationDefinitionV1 | null
}

export interface EquipmentDefinitionDocumentV1 {
  readonly schemaVersion: typeof EQUIPMENT_DEFINITION_SCHEMA_VERSION
  readonly ticket: 'P8-043'
  readonly catalogSha256: string
  readonly definitionCount: number
  readonly classificationPolicy: {
    readonly status: 'reviewed'
    readonly runtimeProseParsing: false
    readonly definitionSource: string
    readonly unknownOrStalePolicy: 'fail-closed-no-equip'
  }
  readonly slotPolicy: {
    readonly wholeItemMayOccupyMultipleSlots: true
    readonly twoHandedSlots: readonly ['mainHand', 'offHand']
    readonly pokemonHeldSlot: 'held'
    readonly occupiedSlotConflict: 'reject-before-inventory-movement'
  }
  readonly definitions: readonly EquipmentDefinitionV1[]
}

export class EquipmentDefinitionValidationError extends Error {
  readonly path: string

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentDefinitionValidationError'
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const CONFIGURATION_KEY = /^[a-z][a-zA-Z0-9]*$/
const SKILL_IDS = new Set(['medicineEd', 'techEd'])
const OWNER_KINDS = new Set(['trainer', 'pokemon'])
const PREREQUISITE_KINDS = new Set([
  'capability', 'trainer-skill-any', 'pokemon-not-fully-evolved', 'pokemon-species',
])
const CONFIGURATION_FIELD_KINDS = new Set([
  'enum', 'distinct-enum-array', 'integer-enum',
  'evolution-family-anchor', 'owner-species', 'canonical-species', 'canonical-mega-form',
])

const fail = (path: string, detail: string): never => {
  throw new EquipmentDefinitionValidationError(path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !allowed.has(field))
  if (missing.length || unknown.length) {
    fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
  }
}
const array = (value: unknown, path: string, maximum = 256): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `must be an array with at most ${maximum} entries.`)
  return value as readonly unknown[]
}
const text = (value: unknown, path: string, maximum = 200): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(path, `must be non-empty trimmed text of at most ${maximum} characters.`)
  }
  return value as string
}
const stableId = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!STABLE_ID.test(result)) fail(path, 'must be a lowercase stable identity.')
  return result
}
const hash = (value: unknown, path: string): string => {
  const result = text(value, path, 64)
  if (!SHA256.test(result)) fail(path, 'must be a lowercase SHA-256 digest.')
  return result
}
const safeInteger = (value: unknown, path: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(path, `must be a safe integer of at least ${minimum}.`)
  return Number(value)
}
const unique = (values: readonly (string | number)[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must contain unique values.')
}

const parseOwnerRules = (value: unknown, path: string): readonly EquipmentOwnerRuleV1[] => {
  const rules = array(value, path, 2).map((entry, index): EquipmentOwnerRuleV1 => {
    const rowPath = `${path}[${index}]`
    const row = record(entry, rowPath)
    exact(row, ['ownerKind', 'slotOptions'], rowPath)
    if (typeof row.ownerKind !== 'string' || !OWNER_KINDS.has(row.ownerKind)) fail(`${rowPath}.ownerKind`, 'is unsupported.')
    const ownerKind = row.ownerKind as EquipmentOwnerKind
    const expectedOrder: readonly EquipmentSlotId[] = ownerKind === 'trainer'
      ? TRAINER_EQUIPMENT_SLOT_IDS
      : POKEMON_EQUIPMENT_SLOT_IDS
    const allowed = new Set<EquipmentSlotId>(expectedOrder)
    const slotOptions = array(row.slotOptions, `${rowPath}.slotOptions`, 8).map((option, optionIndex) => {
      const optionPath = `${rowPath}.slotOptions[${optionIndex}]`
      const slots = array(option, optionPath, expectedOrder.length).map((slot, slotIndex) => {
        if (typeof slot !== 'string' || !allowed.has(slot as EquipmentSlotId)) fail(`${optionPath}[${slotIndex}]`, 'is not an owner-compatible slot.')
        return slot as EquipmentSlotId
      })
      if (!slots.length) fail(optionPath, 'must occupy at least one slot.')
      unique(slots, optionPath)
      if (slots.some((slot, slotIndex) => slotIndex > 0
        && expectedOrder.indexOf(slot) <= expectedOrder.indexOf(slots[slotIndex - 1]!))) {
        fail(optionPath, 'must use canonical slot order.')
      }
      return slots
    })
    if (!slotOptions.length) fail(`${rowPath}.slotOptions`, 'must contain at least one option.')
    unique(slotOptions.map(slots => slots.join('\u0000')), `${rowPath}.slotOptions`)
    return { ownerKind, slotOptions }
  })
  if (!rules.length) fail(path, 'must contain at least one owner rule.')
  unique(rules.map(rule => rule.ownerKind), path)
  return rules
}

const parsePrerequisites = (value: unknown, path: string): readonly EquipmentPrerequisiteV1[] => array(value, path, 16)
  .map((entry, index): EquipmentPrerequisiteV1 => {
    const rowPath = `${path}[${index}]`
    const row = record(entry, rowPath)
    if (typeof row.kind !== 'string' || !PREREQUISITE_KINDS.has(row.kind)) fail(`${rowPath}.kind`, 'is unsupported.')
    if (row.kind === 'capability') {
      exact(row, ['kind', 'ownerKind', 'canonicalId'], rowPath)
      if (row.ownerKind !== 'pokemon') fail(`${rowPath}.ownerKind`, 'must be pokemon.')
      return { kind: 'capability', ownerKind: 'pokemon', canonicalId: text(row.canonicalId, `${rowPath}.canonicalId`) }
    }
    if (row.kind === 'trainer-skill-any') {
      exact(row, ['kind', 'ownerKind', 'skillIds', 'minimumRankValue'], rowPath)
      if (row.ownerKind !== 'trainer') fail(`${rowPath}.ownerKind`, 'must be trainer.')
      const skillIds = array(row.skillIds, `${rowPath}.skillIds`, 8).map((skill, skillIndex) => {
        if (typeof skill !== 'string' || !SKILL_IDS.has(skill)) fail(`${rowPath}.skillIds[${skillIndex}]`, 'is unsupported.')
        return skill as string
      })
      if (!skillIds.length) fail(`${rowPath}.skillIds`, 'must contain at least one skill.')
      unique(skillIds, `${rowPath}.skillIds`)
      return {
        kind: 'trainer-skill-any', ownerKind: 'trainer', skillIds,
        minimumRankValue: safeInteger(row.minimumRankValue, `${rowPath}.minimumRankValue`, 1),
      }
    }
    if (row.kind === 'pokemon-not-fully-evolved') {
      exact(row, ['kind', 'ownerKind'], rowPath)
      if (row.ownerKind !== 'pokemon') fail(`${rowPath}.ownerKind`, 'must be pokemon.')
      return { kind: 'pokemon-not-fully-evolved', ownerKind: 'pokemon' }
    }
    exact(row, ['kind', 'ownerKind', 'speciesIds'], rowPath)
    if (row.ownerKind !== 'pokemon') fail(`${rowPath}.ownerKind`, 'must be pokemon.')
    const speciesIds = array(row.speciesIds, `${rowPath}.speciesIds`, 32)
      .map((species, speciesIndex) => text(species, `${rowPath}.speciesIds[${speciesIndex}]`))
    if (!speciesIds.length) fail(`${rowPath}.speciesIds`, 'must contain at least one species.')
    unique(speciesIds, `${rowPath}.speciesIds`)
    return { kind: 'pokemon-species', ownerKind: 'pokemon', speciesIds }
  })

const parseConfiguration = (value: unknown, path: string): EquipmentConfigurationDefinitionV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, ['configurationId', 'fields'], path)
  const fields = array(input.fields, `${path}.fields`, 16).map((entry, index): EquipmentConfigurationFieldV1 => {
    const fieldPath = `${path}.fields[${index}]`
    const field = record(entry, fieldPath)
    if (typeof field.kind !== 'string' || !CONFIGURATION_FIELD_KINDS.has(field.kind)) fail(`${fieldPath}.kind`, 'is unsupported.')
    if (field.required !== true) fail(`${fieldPath}.required`, 'must be true in schema v1.')
    const key = text(field.key, `${fieldPath}.key`)
    if (!CONFIGURATION_KEY.test(key)) fail(`${fieldPath}.key`, 'must be a stable lower-camel-case key.')
    if (field.kind === 'enum') {
      exact(field, ['key', 'kind', 'required', 'values'], fieldPath)
      const values = array(field.values, `${fieldPath}.values`, 64).map((entry, valueIndex) => text(entry, `${fieldPath}.values[${valueIndex}]`))
      if (!values.length) fail(`${fieldPath}.values`, 'must not be empty.')
      unique(values, `${fieldPath}.values`)
      return { key, kind: 'enum', required: true, values }
    }
    if (field.kind === 'distinct-enum-array') {
      exact(field, ['key', 'kind', 'required', 'values', 'count'], fieldPath)
      const values = array(field.values, `${fieldPath}.values`, 64).map((entry, valueIndex) => text(entry, `${fieldPath}.values[${valueIndex}]`))
      unique(values, `${fieldPath}.values`)
      const count = safeInteger(field.count, `${fieldPath}.count`, 1)
      if (count > values.length) fail(`${fieldPath}.count`, 'cannot exceed the number of values.')
      return { key, kind: 'distinct-enum-array', required: true, values, count }
    }
    if (field.kind === 'integer-enum') {
      exact(field, ['key', 'kind', 'required', 'values'], fieldPath)
      const values = array(field.values, `${fieldPath}.values`, 32).map((entry, valueIndex) => safeInteger(entry, `${fieldPath}.values[${valueIndex}]`, 1))
      unique(values, `${fieldPath}.values`)
      return { key, kind: 'integer-enum', required: true, values }
    }
    exact(field, ['key', 'kind', 'required'], fieldPath)
    return {
      key,
      kind: field.kind as 'evolution-family-anchor' | 'owner-species' | 'canonical-species' | 'canonical-mega-form',
      required: true,
    }
  })
  if (!fields.length) fail(`${path}.fields`, 'must contain at least one field.')
  unique(fields.map(field => field.key), `${path}.fields`)
  return { configurationId: stableId(input.configurationId, `${path}.configurationId`), fields }
}

export const parseEquipmentDefinitionDocument = (value: unknown): EquipmentDefinitionDocumentV1 => {
  const input = record(cloneStrictJson(value, 'equipmentDefinitions', {
    limits: { depth: 12, nodes: 20_000, objectFields: 32, arrayEntries: 512, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'equipment definition data', valueLabel: 'equipment definitions',
    failNotJson: (failurePath, detail) => fail(failurePath, detail),
    failLimit: (failurePath, detail) => fail(failurePath, detail),
  }), 'equipmentDefinitions')
  exact(input, ['schemaVersion', 'ticket', 'catalogSha256', 'definitionCount', 'classificationPolicy', 'slotPolicy', 'definitions'], 'equipmentDefinitions')
  if (input.schemaVersion !== EQUIPMENT_DEFINITION_SCHEMA_VERSION) fail('equipmentDefinitions.schemaVersion', 'is unsupported.')
  if (input.ticket !== 'P8-043') fail('equipmentDefinitions.ticket', 'must be P8-043.')
  const classification = record(input.classificationPolicy, 'equipmentDefinitions.classificationPolicy')
  exact(classification, ['status', 'runtimeProseParsing', 'definitionSource', 'unknownOrStalePolicy'], 'equipmentDefinitions.classificationPolicy')
  if (classification.status !== 'reviewed' || classification.runtimeProseParsing !== false || classification.unknownOrStalePolicy !== 'fail-closed-no-equip') {
    fail('equipmentDefinitions.classificationPolicy', 'must retain the reviewed fail-closed policy.')
  }
  const slots = record(input.slotPolicy, 'equipmentDefinitions.slotPolicy')
  exact(slots, ['wholeItemMayOccupyMultipleSlots', 'twoHandedSlots', 'pokemonHeldSlot', 'occupiedSlotConflict'], 'equipmentDefinitions.slotPolicy')
  const twoHanded = array(slots.twoHandedSlots, 'equipmentDefinitions.slotPolicy.twoHandedSlots', 2)
  if (slots.wholeItemMayOccupyMultipleSlots !== true || twoHanded[0] !== 'mainHand' || twoHanded[1] !== 'offHand'
    || slots.pokemonHeldSlot !== 'held' || slots.occupiedSlotConflict !== 'reject-before-inventory-movement') {
    fail('equipmentDefinitions.slotPolicy', 'must retain whole-item and fail-before-movement semantics.')
  }
  const definitions = array(input.definitions, 'equipmentDefinitions.definitions', 256).map((entry, index): EquipmentDefinitionV1 => {
    const path = `equipmentDefinitions.definitions[${index}]`
    const row = record(entry, path)
    exact(row, ['canonicalItemId', 'canonicalRecordSha256', 'ownerRules', 'prerequisites', 'exclusivityFamilies', 'configuration'], path)
    const exclusivityFamilies = array(row.exclusivityFamilies, `${path}.exclusivityFamilies`, 8)
      .map((family, familyIndex) => stableId(family, `${path}.exclusivityFamilies[${familyIndex}]`))
    unique(exclusivityFamilies, `${path}.exclusivityFamilies`)
    return {
      canonicalItemId: text(row.canonicalItemId, `${path}.canonicalItemId`),
      canonicalRecordSha256: hash(row.canonicalRecordSha256, `${path}.canonicalRecordSha256`),
      ownerRules: parseOwnerRules(row.ownerRules, `${path}.ownerRules`),
      prerequisites: parsePrerequisites(row.prerequisites, `${path}.prerequisites`),
      exclusivityFamilies,
      configuration: parseConfiguration(row.configuration, `${path}.configuration`),
    }
  })
  const definitionCount = safeInteger(input.definitionCount, 'equipmentDefinitions.definitionCount')
  if (definitionCount !== definitions.length) fail('equipmentDefinitions.definitionCount', 'does not match definitions.')
  unique(definitions.map(definition => definition.canonicalItemId), 'equipmentDefinitions.definitions.canonicalItemId')
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_DEFINITION_SCHEMA_VERSION,
    ticket: 'P8-043',
    catalogSha256: hash(input.catalogSha256, 'equipmentDefinitions.catalogSha256'),
    definitionCount,
    classificationPolicy: {
      status: 'reviewed', runtimeProseParsing: false,
      definitionSource: text(classification.definitionSource, 'equipmentDefinitions.classificationPolicy.definitionSource', 500),
      unknownOrStalePolicy: 'fail-closed-no-equip',
    },
    slotPolicy: {
      wholeItemMayOccupyMultipleSlots: true,
      twoHandedSlots: ['mainHand', 'offHand'],
      pokemonHeldSlot: 'held',
      occupiedSlotConflict: 'reject-before-inventory-movement',
    },
    definitions,
  })
}
