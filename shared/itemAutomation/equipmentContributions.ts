import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION = 1 as const

export const EQUIPMENT_CONTRIBUTION_METRICS = [
  'stat-after-stages',
  'combat-stage-default',
  'skill-check-modifier',
  'capability-value',
  'evasion',
  'initiative',
  'accuracy-roll',
  'damage-reduction',
  'direct-damage',
  'critical-range',
] as const
export type EquipmentContributionMetric = typeof EQUIPMENT_CONTRIBUTION_METRICS[number]
export type EquipmentContributionOperation = 'add' | 'set' | 'multiply-floor'

export type EquipmentContributionTargetV1 =
  | { readonly kind: 'fixed'; readonly ids: readonly string[] }
  | { readonly kind: 'configuration' | 'configuration-array'; readonly field: string }

export type EquipmentContributionPredicateV1 =
  | { readonly kind: 'environment'; readonly environmentId: 'ice-or-deep-snow' | 'fully-submerged' }
  | { readonly kind: 'effectiveness'; readonly effectivenessId: 'super-effective' }
  | { readonly kind: 'critical-hit' }
  | { readonly kind: 'owner-untransformed' }
  | { readonly kind: 'move-type'; readonly typeId: string }
  | { readonly kind: 'move-type-configuration'; readonly field: string }
  | { readonly kind: 'owner-species'; readonly speciesIds: readonly string[] }
  | { readonly kind: 'configuration-equals'; readonly field: string; readonly value: string }
  | { readonly kind: 'configuration-in'; readonly field: string; readonly values: readonly string[] }

export interface EquipmentContributionV1 {
  readonly contributionId: string
  readonly metric: EquipmentContributionMetric
  readonly target: EquipmentContributionTargetV1
  readonly operation: EquipmentContributionOperation
  readonly value: number
  /** Maximum final modifier for capped skill-check contributions. */
  readonly cap: number | null
  readonly predicates: readonly EquipmentContributionPredicateV1[]
}

export interface EquipmentContributionDefinitionV1 {
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly equipmentDefinitionSha256: string
  readonly contributions: readonly EquipmentContributionV1[]
  readonly deferredMechanics: readonly string[]
}

export interface EquipmentContributionProjectionSourceV1 {
  readonly sourceLabel: string
  readonly contributionId: string
  readonly operation: EquipmentContributionOperation
  readonly value: number
  readonly applied: number
  readonly cap: number | null
  /** Safe human-readable facts that must be true before this contextual source applies. */
  readonly conditionLabels: readonly string[]
}

export interface EquipmentContributionProjectionValueV1 {
  readonly metricId: string
  readonly metric: EquipmentContributionMetric
  readonly targetId: string
  readonly label: string
  readonly base: number
  readonly sources: readonly EquipmentContributionProjectionSourceV1[]
  readonly final: number
  readonly conflict: boolean
  readonly unavailableReason: string | null
}

export interface EquipmentContributionProjectionV1 {
  readonly schemaVersion: typeof EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION
  readonly owner: { readonly kind: 'trainer' | 'pokemon'; readonly slug: string }
  readonly equipmentRevision: number
  readonly values: readonly EquipmentContributionProjectionValueV1[]
  readonly inactiveSourceCount: number
}

export interface EquipmentContributionDocumentV1 {
  readonly schemaVersion: typeof EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION
  readonly ticket: 'P8-046'
  readonly catalogSha256: string
  readonly equipmentDefinitionsSha256: string
  readonly definitionCount: number
  readonly contributingItemCount: number
  readonly classificationPolicy: {
    readonly status: 'reviewed'
    readonly runtimeProseParsing: false
    readonly unknownOrStalePolicy: 'fail-closed-no-contribution'
    readonly inactiveOrSuppressedPolicy: 'no-contribution'
    readonly deferredMechanicsRemainInert: true
  }
  readonly definitions: readonly EquipmentContributionDefinitionV1[]
}

export class EquipmentContributionValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentContributionValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const CONFIGURATION_KEY = /^[a-z][a-zA-Z0-9]*$/
const METRICS = new Set<string>(EQUIPMENT_CONTRIBUTION_METRICS)
const OPERATIONS = new Set(['add', 'set', 'multiply-floor'])
const TARGET_KINDS = new Set(['fixed', 'configuration', 'configuration-array'])
const PREDICATE_KINDS = new Set([
  'environment', 'effectiveness', 'critical-hit', 'owner-untransformed',
  'move-type', 'move-type-configuration', 'owner-species',
  'configuration-equals', 'configuration-in',
])

const fail = (path: string, detail: string): never => {
  throw new EquipmentContributionValidationError(path, detail)
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
const configurationKey = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!CONFIGURATION_KEY.test(result)) fail(path, 'must be a stable lower-camel-case key.')
  return result
}
const hash = (value: unknown, path: string): string => {
  const result = text(value, path, 64)
  if (!SHA256.test(result)) fail(path, 'must be a lowercase SHA-256 digest.')
  return result
}
const safeInteger = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, 'must be a safe non-negative integer.')
  return Number(value)
}
const finiteNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000) {
    return fail(path, 'must be a finite number between -1000 and 1000.')
  }
  return value
}
const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail(path, 'must contain unique values.')
}
const texts = (value: unknown, path: string, maximum = 64): readonly string[] => {
  const values = array(value, path, maximum).map((entry, index) => text(entry, `${path}[${index}]`))
  if (values.length === 0) fail(path, 'must not be empty.')
  unique(values, path)
  return values
}

const parseTarget = (value: unknown, path: string): EquipmentContributionTargetV1 => {
  const input = record(value, path)
  if (typeof input.kind !== 'string' || !TARGET_KINDS.has(input.kind)) fail(`${path}.kind`, 'is unsupported.')
  if (input.kind === 'fixed') {
    exact(input, ['kind', 'ids'], path)
    return { kind: 'fixed', ids: texts(input.ids, `${path}.ids`, 16) }
  }
  exact(input, ['kind', 'field'], path)
  return {
    kind: input.kind as 'configuration' | 'configuration-array',
    field: configurationKey(input.field, `${path}.field`),
  }
}

const parsePredicate = (value: unknown, path: string): EquipmentContributionPredicateV1 => {
  const input = record(value, path)
  if (typeof input.kind !== 'string' || !PREDICATE_KINDS.has(input.kind)) fail(`${path}.kind`, 'is unsupported.')
  if (input.kind === 'environment') {
    exact(input, ['kind', 'environmentId'], path)
    if (input.environmentId !== 'ice-or-deep-snow' && input.environmentId !== 'fully-submerged') {
      fail(`${path}.environmentId`, 'is unsupported.')
    }
    return {
      kind: 'environment',
      environmentId: input.environmentId as 'ice-or-deep-snow' | 'fully-submerged',
    }
  }
  if (input.kind === 'effectiveness') {
    exact(input, ['kind', 'effectivenessId'], path)
    if (input.effectivenessId !== 'super-effective') fail(`${path}.effectivenessId`, 'is unsupported.')
    return { kind: 'effectiveness', effectivenessId: 'super-effective' }
  }
  if (input.kind === 'critical-hit' || input.kind === 'owner-untransformed') {
    exact(input, ['kind'], path)
    return { kind: input.kind }
  }
  if (input.kind === 'move-type') {
    exact(input, ['kind', 'typeId'], path)
    return { kind: 'move-type', typeId: text(input.typeId, `${path}.typeId`) }
  }
  if (input.kind === 'move-type-configuration') {
    exact(input, ['kind', 'field'], path)
    return { kind: 'move-type-configuration', field: configurationKey(input.field, `${path}.field`) }
  }
  if (input.kind === 'owner-species') {
    exact(input, ['kind', 'speciesIds'], path)
    return { kind: 'owner-species', speciesIds: texts(input.speciesIds, `${path}.speciesIds`, 32) }
  }
  if (input.kind === 'configuration-equals') {
    exact(input, ['kind', 'field', 'value'], path)
    return {
      kind: 'configuration-equals',
      field: configurationKey(input.field, `${path}.field`),
      value: text(input.value, `${path}.value`),
    }
  }
  exact(input, ['kind', 'field', 'values'], path)
  return {
    kind: 'configuration-in',
    field: configurationKey(input.field, `${path}.field`),
    values: texts(input.values, `${path}.values`, 32),
  }
}

const parseContribution = (value: unknown, path: string): EquipmentContributionV1 => {
  const input = record(value, path)
  exact(input, ['contributionId', 'metric', 'target', 'operation', 'value', 'cap', 'predicates'], path)
  if (typeof input.metric !== 'string' || !METRICS.has(input.metric)) fail(`${path}.metric`, 'is unsupported.')
  if (typeof input.operation !== 'string' || !OPERATIONS.has(input.operation)) fail(`${path}.operation`, 'is unsupported.')
  const metric = input.metric as EquipmentContributionMetric
  const operation = input.operation as EquipmentContributionOperation
  const cap = input.cap === null ? null : finiteNumber(input.cap, `${path}.cap`)
  if (cap !== null && metric !== 'skill-check-modifier') fail(`${path}.cap`, 'is supported only for skill-check modifiers.')
  if (operation === 'set' && metric !== 'combat-stage-default') fail(`${path}.operation`, 'set is supported only for default Combat Stages.')
  if (operation === 'multiply-floor' && metric !== 'stat-after-stages') fail(`${path}.operation`, 'multiply-floor is supported only for after-stage Stats.')
  return {
    contributionId: stableId(input.contributionId, `${path}.contributionId`),
    metric,
    target: parseTarget(input.target, `${path}.target`),
    operation,
    value: finiteNumber(input.value, `${path}.value`),
    cap,
    predicates: array(input.predicates, `${path}.predicates`, 8)
      .map((entry, index) => parsePredicate(entry, `${path}.predicates[${index}]`)),
  }
}

export const parseEquipmentContributionDocument = (value: unknown): EquipmentContributionDocumentV1 => {
  const input = record(cloneStrictJson(value, 'equipmentContributions', {
    limits: { depth: 14, nodes: 30_000, objectFields: 32, arrayEntries: 512, stringLength: 500, objectKeyLength: 100 },
    rootLabel: 'equipment contribution data', valueLabel: 'equipment contributions',
    failNotJson: (path, detail) => fail(path, detail),
    failLimit: (path, detail) => fail(path, detail),
  }), 'equipmentContributions')
  exact(input, [
    'schemaVersion', 'ticket', 'catalogSha256', 'equipmentDefinitionsSha256',
    'definitionCount', 'contributingItemCount', 'classificationPolicy', 'definitions',
  ], 'equipmentContributions')
  if (input.schemaVersion !== EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION || input.ticket !== 'P8-046') {
    fail('equipmentContributions.schemaVersion', 'is unsupported.')
  }
  const policy = record(input.classificationPolicy, 'equipmentContributions.classificationPolicy')
  exact(policy, [
    'status', 'runtimeProseParsing', 'unknownOrStalePolicy',
    'inactiveOrSuppressedPolicy', 'deferredMechanicsRemainInert',
  ], 'equipmentContributions.classificationPolicy')
  if (policy.status !== 'reviewed' || policy.runtimeProseParsing !== false
    || policy.unknownOrStalePolicy !== 'fail-closed-no-contribution'
    || policy.inactiveOrSuppressedPolicy !== 'no-contribution'
    || policy.deferredMechanicsRemainInert !== true) {
    fail('equipmentContributions.classificationPolicy', 'must retain reviewed fail-closed semantics.')
  }
  const definitions = array(input.definitions, 'equipmentContributions.definitions', 256)
    .map((entry, index): EquipmentContributionDefinitionV1 => {
      const path = `equipmentContributions.definitions[${index}]`
      const row = record(entry, path)
      exact(row, [
        'canonicalItemId', 'canonicalRecordSha256', 'equipmentDefinitionSha256',
        'contributions', 'deferredMechanics',
      ], path)
      const contributions = array(row.contributions, `${path}.contributions`, 16)
        .map((value, contributionIndex) => parseContribution(value, `${path}.contributions[${contributionIndex}]`))
      unique(contributions.map(value => value.contributionId), `${path}.contributions.contributionId`)
      const deferredMechanics = array(row.deferredMechanics, `${path}.deferredMechanics`, 8)
        .map((value, deferredIndex) => text(value, `${path}.deferredMechanics[${deferredIndex}]`))
      unique(deferredMechanics, `${path}.deferredMechanics`)
      return {
        canonicalItemId: text(row.canonicalItemId, `${path}.canonicalItemId`),
        canonicalRecordSha256: hash(row.canonicalRecordSha256, `${path}.canonicalRecordSha256`),
        equipmentDefinitionSha256: hash(row.equipmentDefinitionSha256, `${path}.equipmentDefinitionSha256`),
        contributions,
        deferredMechanics,
      }
    })
  const definitionCount = safeInteger(input.definitionCount, 'equipmentContributions.definitionCount')
  const contributingItemCount = safeInteger(input.contributingItemCount, 'equipmentContributions.contributingItemCount')
  if (definitionCount !== definitions.length) fail('equipmentContributions.definitionCount', 'does not match definitions.')
  if (contributingItemCount !== definitions.filter(row => row.contributions.length > 0).length) {
    fail('equipmentContributions.contributingItemCount', 'does not match contributing definitions.')
  }
  unique(definitions.map(row => row.canonicalItemId), 'equipmentContributions.definitions.canonicalItemId')
  unique(definitions.flatMap(row => row.contributions.map(value => value.contributionId)), 'equipmentContributions.contributionIds')
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_CONTRIBUTION_SCHEMA_VERSION,
    ticket: 'P8-046',
    catalogSha256: hash(input.catalogSha256, 'equipmentContributions.catalogSha256'),
    equipmentDefinitionsSha256: hash(input.equipmentDefinitionsSha256, 'equipmentContributions.equipmentDefinitionsSha256'),
    definitionCount,
    contributingItemCount,
    classificationPolicy: {
      status: 'reviewed',
      runtimeProseParsing: false,
      unknownOrStalePolicy: 'fail-closed-no-contribution',
      inactiveOrSuppressedPolicy: 'no-contribution',
      deferredMechanicsRemainInert: true,
    },
    definitions,
  })
}
