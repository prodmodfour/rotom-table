import type { CanonicalAbilityCatalog } from './ruleset'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_TIMING_CONSTRAINT_SCHEMA_VERSION = 1 as const
export const ABILITY_TIMING_CONSTRAINT_KINDS = ['round', 'turn', 'cooldown'] as const
export type AbilityTimingConstraintKind = (typeof ABILITY_TIMING_CONSTRAINT_KINDS)[number]

export interface AbilityTimingConstraintRecord {
  readonly canonicalId: string
  readonly constraintId: string
  readonly kind: AbilityTimingConstraintKind
  readonly limit: number | null
  readonly cooldownUnit: 'round' | 'turn' | null
  readonly cooldownDelay: number | null
  readonly sourceField: 'effect' | 'trigger'
  readonly sourcePhrase: string
}

export interface AbilityTimingConstraintCatalog {
  readonly schemaVersion: typeof ABILITY_TIMING_CONSTRAINT_SCHEMA_VERSION
  readonly sourceDataSha256: string
  readonly entries: readonly AbilityTimingConstraintRecord[]
}

export type AbilityTimingConstraintValidationCode =
  | 'invalid-catalog'
  | 'source-mismatch'
  | 'unknown-ability'
  | 'duplicate-id'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityTimingConstraintValidationError extends Error {
  readonly code: AbilityTimingConstraintValidationCode
  readonly path: string

  constructor(code: AbilityTimingConstraintValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityTimingConstraintValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sourceDataSha256', 'entries'] as const
const ENTRY_FIELDS = [
  'canonicalId',
  'constraintId',
  'kind',
  'limit',
  'cooldownUnit',
  'cooldownDelay',
  'sourceField',
  'sourcePhrase',
] as const
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const KIND_SET = new Set<string>(ABILITY_TIMING_CONSTRAINT_KINDS)

const fail = (
  code: AbilityTimingConstraintValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityTimingConstraintValidationError(code, path, detail)
}

const clone = (value: unknown) => cloneStrictJson(value, 'timingConstraints', {
  limits: {
    depth: 5,
    nodes: 4_096,
    objectFields: 12,
    arrayEntries: 512,
    stringLength: 1_000,
    objectKeyLength: 160,
  },
  rootLabel: 'ability timing constraints',
  valueLabel: 'ability timing constraints',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-catalog', path, 'must be an object.')
  return value
}

const exact = (input: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
  ) fail('invalid-catalog', path, 'has an invalid shape.')
}

const text = (value: unknown, path: string, maximum = 1_000): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-catalog', path, 'must be bounded trimmed text.')
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path, 160)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-catalog', path, 'must be a stable identifier.')
  return id
}

export const parseAbilityTimingConstraintCatalog = (
  value: unknown,
  canonical: CanonicalAbilityCatalog,
): AbilityTimingConstraintCatalog => {
  const input = record(clone(value), 'timingConstraints')
  exact(input, ROOT_FIELDS, 'timingConstraints')
  if (input.schemaVersion !== ABILITY_TIMING_CONSTRAINT_SCHEMA_VERSION) {
    fail('invalid-catalog', 'timingConstraints.schemaVersion', 'is unsupported.')
  }
  if (
    typeof input.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(input.sourceDataSha256)
    || input.sourceDataSha256 !== canonical.sourceDataSha256
  ) fail('source-mismatch', 'timingConstraints.sourceDataSha256', 'must match canonical data.')
  if (!Array.isArray(input.entries) || input.entries.length > 512) {
    fail('limit-exceeded', 'timingConstraints.entries', 'must be a bounded array.')
  }
  const canonicalById = new Map(canonical.abilities.map((ability, index) => [
    ability.canonicalId,
    { ability, index },
  ]))
  const entries = (input.entries as readonly unknown[]).map((value, index): AbilityTimingConstraintRecord => {
    const path = `timingConstraints.entries[${index}]`
    const row = record(value, path)
    exact(row, ENTRY_FIELDS, path)
    const canonicalId = text(row.canonicalId, `${path}.canonicalId`, 160)
    const source = canonicalById.get(canonicalId)
      ?? fail('unknown-ability', `${path}.canonicalId`, 'is not canonical.')
    if (typeof row.kind !== 'string' || !KIND_SET.has(row.kind)) {
      fail('invalid-catalog', `${path}.kind`, 'is unsupported.')
    }
    const kind = row.kind as AbilityTimingConstraintKind
    const limit = row.limit === null ? null : Number(row.limit)
    const cooldownDelay = row.cooldownDelay === null ? null : Number(row.cooldownDelay)
    const cooldownUnit = row.cooldownUnit === null
      ? null
      : row.cooldownUnit === 'round' || row.cooldownUnit === 'turn'
        ? row.cooldownUnit
        : fail('invalid-catalog', `${path}.cooldownUnit`, 'must be round, turn, or null.')
    if (
      kind === 'cooldown'
        ? limit !== null || cooldownUnit === null || !Number.isSafeInteger(cooldownDelay)
          || cooldownDelay! < 1 || cooldownDelay! > 10_000
        : !Number.isSafeInteger(limit) || limit! < 1 || limit! > 10
          || cooldownUnit !== null || cooldownDelay !== null
    ) fail('invalid-catalog', path, 'constraint parameters do not match its kind.')
    if (row.sourceField !== 'effect' && row.sourceField !== 'trigger') {
      fail('invalid-catalog', `${path}.sourceField`, 'must be effect or trigger.')
    }
    const sourceField = row.sourceField as 'effect' | 'trigger'
    const sourcePhrase = text(row.sourcePhrase, `${path}.sourcePhrase`)
    const sourceText = source.ability.source[sourceField]
    if (typeof sourceText !== 'string' || !sourceText.includes(sourcePhrase)) {
      fail('source-mismatch', `${path}.sourcePhrase`, 'must occur in canonical source text.')
    }
    return Object.freeze({
      canonicalId,
      constraintId: stableId(row.constraintId, `${path}.constraintId`),
      kind,
      limit,
      cooldownUnit,
      cooldownDelay,
      sourceField,
      sourcePhrase,
    })
  })
  const keys = entries.map(entry => `${entry.canonicalId}\u0000${entry.constraintId}`)
  if (new Set(keys).size !== entries.length) {
    fail('duplicate-id', 'timingConstraints.entries', 'must not repeat ability/constraint IDs.')
  }
  if (entries.some((entry, index) => index > 0 && (
    canonicalById.get(entry.canonicalId)!.index < canonicalById.get(entries[index - 1]!.canonicalId)!.index
    || (
      entry.canonicalId === entries[index - 1]!.canonicalId
      && entry.constraintId <= entries[index - 1]!.constraintId
    )
  ))) fail('invalid-catalog', 'timingConstraints.entries', 'must use canonical deterministic order.')
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_TIMING_CONSTRAINT_SCHEMA_VERSION,
    sourceDataSha256: input.sourceDataSha256 as string,
    entries,
  })
}
