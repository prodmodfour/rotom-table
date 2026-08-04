import { createHash } from 'node:crypto'
import rulesetJson from '../../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingCampaignOptionId } from '#shared/breeding/ids'
import { canonicalBreedingCampaignOptionIdentity } from './canonicalIds'

export const BREEDING_CAMPAIGN_OPTION_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const BREEDING_CAMPAIGN_OPTION_COUNT = 15 as const
export const BREEDING_RULESET_DEFINITION_SHA256 = rulesetJson.definitionSha256

export type BreedingParentFamilyPolicy = 'core-d20' | 'maternal-family' | 'gm-family-choice'
export type BreedingMaturityPolicy = 'gm-confirmed-per-parent' | 'minimum-level'
export type BreedingGenderlessPolicy = 'ditto-only' | 'gm-role-override'
export type BreedingSameSexPolicy = 'incompatible' | 'gm-role-override'
export type BreedingFormRootPolicyOption = 'compiled-form-root-only' | 'gm-species-override'
export type BreedingHatchDurationVariation = 'fixed-average' | 'server-random-half-to-double' | 'gm-within-half-to-double'
export type BreedingMissingHatchDurationPolicy = 'unavailable' | 'gm-explicit-minutes'
export type BreedingHatchSpecialPolicy = 'bounded-gm-adjudication' | 'configured-bounded-table'
export type BreedingBabyTemplatePolicy = 'disabled' | 'per-egg-gm-choice'
export type BreedingFossilInheritancePolicy = 'none' | 'gm-bounded-canonical-list'
export type BreedingCheckFailurePolicy = 'terminal-no-egg' | 'new-project-required'
export type BreedingCampaignOptionValue = string | number

export interface BreedingCampaignOptionValues {
  readonly 'breeding.parent-family-policy': BreedingParentFamilyPolicy
  readonly 'breeding.maturity-policy': BreedingMaturityPolicy
  readonly 'breeding.minimum-maturity-level': number
  readonly 'breeding.genderless-policy': BreedingGenderlessPolicy
  readonly 'breeding.same-sex-policy': BreedingSameSexPolicy
  readonly 'breeding.form-root-policy': BreedingFormRootPolicyOption
  readonly 'breeding.hatch-duration-variation': BreedingHatchDurationVariation
  readonly 'breeding.missing-hatch-duration-policy': BreedingMissingHatchDurationPolicy
  readonly 'breeding.gm-hatch-duration-minutes': number
  readonly 'breeding.hatch-special-policy': BreedingHatchSpecialPolicy
  readonly 'breeding.baby-template-policy': BreedingBabyTemplatePolicy
  readonly 'breeding.baby-template-stat-penalty': number
  readonly 'breeding.fossil-inheritance-policy': BreedingFossilInheritancePolicy
  readonly 'breeding.fossil-hatch-level': number
  readonly 'breeding.check-failure-policy': BreedingCheckFailurePolicy
}
export interface BreedingCampaignOptionSnapshotV1 {
  readonly schemaVersion: 1
  readonly rulesetDefinitionSha256: string
  readonly values: Readonly<BreedingCampaignOptionValues>
  readonly definitionSha256: string
}

export type BreedingCampaignOptionValidationCode =
  | 'breeding.options.not-object'
  | 'breeding.options.unknown-field'
  | 'breeding.options.invalid-value'
  | 'breeding.options.inactive-value'
  | 'breeding.options.invalid-hash'
  | 'breeding.options.invalid-version'

export class BreedingCampaignOptionValidationError extends Error {
  readonly code: BreedingCampaignOptionValidationCode
  readonly path: string
  constructor(code: BreedingCampaignOptionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingCampaignOptionValidationError'
    this.code = code
    this.path = path
  }
}

interface EnumDefinition {
  readonly id: keyof BreedingCampaignOptionValues
  readonly kind: 'enum'
  readonly default: string
  readonly allowed: readonly string[]
  readonly activeWhen?: { readonly optionId: keyof BreedingCampaignOptionValues, readonly equals: string | number }
}
interface IntegerDefinition {
  readonly id: keyof BreedingCampaignOptionValues
  readonly kind: 'integer'
  readonly default: number
  readonly minimum: number
  readonly maximum: number
  readonly activeWhen?: { readonly optionId: keyof BreedingCampaignOptionValues, readonly equals: string | number }
}
type OptionDefinition = EnumDefinition | IntegerDefinition
const definitions = rulesetJson.definition.campaignOptions as readonly OptionDefinition[]
if (definitions.length !== BREEDING_CAMPAIGN_OPTION_COUNT
  || new Set(definitions.map(definition => definition.id)).size !== definitions.length
  || definitions.some(definition => !canonicalBreedingCampaignOptionIdentity(definition.id))) {
  throw new Error('Breeding campaign-option definitions are incomplete or non-canonical.')
}
const OPTION_IDS = Object.freeze(definitions.map(definition => definition.id))
const OPTION_ID_SET = new Set<string>(OPTION_IDS)
const hashDefinition = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const fail = (code: BreedingCampaignOptionValidationCode, path: string, message: string): never => {
  throw new BreedingCampaignOptionValidationError(code, path, message)
}
const plainDataRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('breeding.options.not-object', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.options.not-object', path, 'must be a plain data object.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.options.not-object', path, 'must contain enumerable data fields only.')
    }
  }
  return value as Record<string, unknown>
}
const exactRecord = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  const row = plainDataRecord(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    return fail('breeding.options.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const parseValue = (definition: OptionDefinition, value: unknown, path: string): BreedingCampaignOptionValue => {
  if (definition.kind === 'enum') {
    if (typeof value !== 'string' || !definition.allowed.includes(value)) {
      return fail('breeding.options.invalid-value', path, 'must be a declared option value.')
    }
    return value
  }
  if (!Number.isSafeInteger(value)
    || (value as number) < definition.minimum
    || (value as number) > definition.maximum) {
    return fail('breeding.options.invalid-value', path, 'must be a bounded integer option value.')
  }
  return value as number
}
const parseValues = (value: unknown, requireAll: boolean, path: string): BreedingCampaignOptionValues => {
  const row = plainDataRecord(value, path)
  if (Object.keys(row).some(field => !OPTION_ID_SET.has(field))
    || (requireAll && OPTION_IDS.some(id => !Object.hasOwn(row, id)))) {
    return fail('breeding.options.unknown-field', path, 'contains unknown or missing campaign options.')
  }
  const output: Record<string, BreedingCampaignOptionValue> = {}
  for (const definition of definitions) {
    const input = Object.hasOwn(row, definition.id) ? row[definition.id] : definition.default
    output[definition.id] = parseValue(definition, input, `${path}.${definition.id}`)
  }
  for (const definition of definitions) {
    if (definition.activeWhen
      && output[definition.activeWhen.optionId] !== definition.activeWhen.equals
      && output[definition.id] !== definition.default) {
      return fail('breeding.options.inactive-value', `${path}.${definition.id}`, 'must remain at its reviewed default while inactive.')
    }
  }
  return Object.freeze(output) as unknown as BreedingCampaignOptionValues
}

const snapshotFromValues = (values: BreedingCampaignOptionValues): BreedingCampaignOptionSnapshotV1 => {
  const definition = Object.freeze({
    schemaVersion: BREEDING_CAMPAIGN_OPTION_SNAPSHOT_SCHEMA_VERSION,
    rulesetDefinitionSha256: BREEDING_RULESET_DEFINITION_SHA256,
    values,
  })
  return Object.freeze({ ...definition, definitionSha256: hashDefinition(definition) })
}

export const resolveBreedingCampaignOptionSnapshot = (overrides: unknown = {}): BreedingCampaignOptionSnapshotV1 => (
  snapshotFromValues(parseValues(overrides, false, 'breedingOptions'))
)

export const parseBreedingCampaignOptionSnapshotV1 = (value: unknown): BreedingCampaignOptionSnapshotV1 => {
  const row = exactRecord(value, ['schemaVersion', 'rulesetDefinitionSha256', 'values', 'definitionSha256'], 'breedingOptionSnapshot')
  if (row.schemaVersion !== BREEDING_CAMPAIGN_OPTION_SNAPSHOT_SCHEMA_VERSION) {
    return fail('breeding.options.invalid-version', 'breedingOptionSnapshot.schemaVersion', 'must be schema version 1.')
  }
  if (row.rulesetDefinitionSha256 !== BREEDING_RULESET_DEFINITION_SHA256) {
    return fail('breeding.options.invalid-version', 'breedingOptionSnapshot.rulesetDefinitionSha256', 'must match the active breeding ruleset definition.')
  }
  const values = parseValues(row.values, true, 'breedingOptionSnapshot.values')
  const definition = Object.freeze({
    schemaVersion: BREEDING_CAMPAIGN_OPTION_SNAPSHOT_SCHEMA_VERSION,
    rulesetDefinitionSha256: BREEDING_RULESET_DEFINITION_SHA256,
    values,
  })
  if (typeof row.definitionSha256 !== 'string' || row.definitionSha256 !== hashDefinition(definition)) {
    return fail('breeding.options.invalid-hash', 'breedingOptionSnapshot.definitionSha256', 'does not match the parsed campaign-option snapshot.')
  }
  return Object.freeze({ ...definition, definitionSha256: row.definitionSha256 })
}

export const DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT = resolveBreedingCampaignOptionSnapshot()
export const BREEDING_CAMPAIGN_OPTION_IDS: readonly BreedingCampaignOptionId[] = OPTION_IDS as readonly BreedingCampaignOptionId[]
