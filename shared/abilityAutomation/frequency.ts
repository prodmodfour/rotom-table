import type { CanonicalAbilityCatalog } from './ruleset'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_FREQUENCY_EXCEPTION_SCHEMA_VERSION = 1 as const
export const ABILITY_FREQUENCY_PERIODS = ['at-will', 'scene', 'daily', 'round'] as const
export type AbilityFrequencyPeriod = (typeof ABILITY_FREQUENCY_PERIODS)[number]

export interface AbilityFrequencyExceptionClause {
  readonly id: string
  readonly period: AbilityFrequencyPeriod
  readonly uses: number | null
}

export interface AbilityFrequencyException {
  readonly canonicalId: string
  readonly rawFrequency: string
  readonly exceptionId: string
  readonly clauses: readonly AbilityFrequencyExceptionClause[]
}

export interface AbilityFrequencyExceptionCatalog {
  readonly schemaVersion: typeof ABILITY_FREQUENCY_EXCEPTION_SCHEMA_VERSION
  readonly sourceDataSha256: string
  readonly entries: readonly AbilityFrequencyException[]
}

interface AbilityFrequencyDeclarationBase {
  readonly raw: string
  /** Preserved for AA-021 action-economy parsing; never interpreted here. */
  readonly actionText: string | null
}

export type AbilityFrequencyDeclaration =
  | (AbilityFrequencyDeclarationBase & {
      readonly kind: 'static'
      readonly uses: null
      readonly exceptionId: null
    })
  | (AbilityFrequencyDeclarationBase & {
      readonly kind: 'at-will'
      readonly uses: null
      readonly exceptionId: null
    })
  | (AbilityFrequencyDeclarationBase & {
      readonly kind: 'scene' | 'daily'
      readonly uses: number
      readonly exceptionId: null
    })
  | (AbilityFrequencyDeclarationBase & {
      readonly kind: 'exceptional'
      readonly uses: null
      readonly exceptionId: string
    })

export type AbilityFrequencyValidationCode =
  | 'invalid-frequency'
  | 'invalid-exception-catalog'
  | 'unknown-ability'
  | 'source-mismatch'
  | 'duplicate-id'
  | 'missing-exception'
  | 'unexpected-exception'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityFrequencyValidationError extends Error {
  readonly code: AbilityFrequencyValidationCode
  readonly path: string

  constructor(code: AbilityFrequencyValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityFrequencyValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sourceDataSha256', 'entries'] as const
const ENTRY_FIELDS = ['canonicalId', 'rawFrequency', 'exceptionId', 'clauses'] as const
const CLAUSE_FIELDS = ['id', 'period', 'uses'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PERIOD_SET = new Set<string>(ABILITY_FREQUENCY_PERIODS)
const FREQUENCY_PATTERN = /^(At-Will|Scene|Daily)(?:\s*x(\d+))?(?:\s*(?:–|-)\s*(.+))?$/

const fail = (code: AbilityFrequencyValidationCode, path: string, detail: string): never => {
  throw new AbilityFrequencyValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 6,
    nodes: 1_024,
    objectFields: 8,
    arrayEntries: 64,
    stringLength: 500,
    objectKeyLength: 160,
  },
  rootLabel: 'ability frequency data',
  valueLabel: 'ability frequency declarations',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-exception-catalog', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) {
    fail('invalid-exception-catalog', path, 'has an invalid shape.')
  }
}

const text = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 500
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail('invalid-exception-catalog', path, 'must be bounded trimmed text.')
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path)
  if (id.length > 160 || !STABLE_ID_PATTERN.test(id)) {
    fail('invalid-exception-catalog', path, 'must be a stable identifier.')
  }
  return id
}

export const parseAbilityFrequencyExceptionCatalog = (
  value: unknown,
  catalog: CanonicalAbilityCatalog,
): AbilityFrequencyExceptionCatalog => {
  const root = record(clone(value, 'frequencyExceptions'), 'frequencyExceptions')
  exact(root, ROOT_FIELDS, 'frequencyExceptions')
  if (root.schemaVersion !== ABILITY_FREQUENCY_EXCEPTION_SCHEMA_VERSION) {
    fail('invalid-exception-catalog', 'frequencyExceptions.schemaVersion', 'is unsupported.')
  }
  if (
    typeof root.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(root.sourceDataSha256)
    || root.sourceDataSha256 !== catalog.sourceDataSha256
  ) {
    fail('source-mismatch', 'frequencyExceptions.sourceDataSha256', 'must match the canonical catalog.')
  }
  if (!Array.isArray(root.entries) || root.entries.length > 32) {
    fail('limit-exceeded', 'frequencyExceptions.entries', 'must be a bounded array.')
  }
  const canonicalById = new Map(catalog.abilities.map((ability, index) => [ability.canonicalId, { ability, index }]))
  const entries = (root.entries as readonly unknown[]).map((value, index): AbilityFrequencyException => {
    const path = `frequencyExceptions.entries[${index}]`
    const input = record(value, path)
    exact(input, ENTRY_FIELDS, path)
    const canonicalId = text(input.canonicalId, `${path}.canonicalId`)
    const canonical = canonicalById.get(canonicalId)
      ?? fail('unknown-ability', `${path}.canonicalId`, 'does not identify a canonical ability.')
    const rawFrequency = text(input.rawFrequency, `${path}.rawFrequency`)
    if (canonical.ability.source.frequency !== rawFrequency) {
      fail('source-mismatch', `${path}.rawFrequency`, 'must match canonical frequency text exactly.')
    }
    if (!Array.isArray(input.clauses) || input.clauses.length === 0 || input.clauses.length > 16) {
      fail('limit-exceeded', `${path}.clauses`, 'must be a bounded non-empty array.')
    }
    const clauses = (input.clauses as readonly unknown[]).map((value, clauseIndex) => {
      const clausePath = `${path}.clauses[${clauseIndex}]`
      const clause = record(value, clausePath)
      exact(clause, CLAUSE_FIELDS, clausePath)
      if (typeof clause.period !== 'string' || !PERIOD_SET.has(clause.period)) {
        fail('invalid-exception-catalog', `${clausePath}.period`, 'is unsupported.')
      }
      const uses = clause.uses === null
        ? null
        : Number.isSafeInteger(clause.uses) && Number(clause.uses) >= 1 && Number(clause.uses) <= 10
          ? Number(clause.uses)
          : fail('invalid-exception-catalog', `${clausePath}.uses`, 'must be null or 1 through 10.')
      if ((clause.period === 'at-will') !== (uses === null)) {
        fail('invalid-exception-catalog', clausePath, 'only at-will clauses use null uses.')
      }
      return Object.freeze({
        id: stableId(clause.id, `${clausePath}.id`),
        period: clause.period as AbilityFrequencyPeriod,
        uses,
      })
    })
    if (new Set(clauses.map(clause => clause.id)).size !== clauses.length) {
      fail('duplicate-id', `${path}.clauses`, 'must not repeat clause IDs.')
    }
    return Object.freeze({
      canonicalId,
      rawFrequency,
      exceptionId: stableId(input.exceptionId, `${path}.exceptionId`),
      clauses: Object.freeze(clauses),
    })
  })
  if (new Set(entries.map(entry => entry.canonicalId)).size !== entries.length) {
    fail('duplicate-id', 'frequencyExceptions.entries', 'must not repeat abilities.')
  }
  const order = entries.map(entry => canonicalById.get(entry.canonicalId)!.index)
  if (order.some((value, index) => index > 0 && value <= order[index - 1]!)) {
    fail('invalid-exception-catalog', 'frequencyExceptions.entries', 'must use canonical order.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_FREQUENCY_EXCEPTION_SCHEMA_VERSION,
    sourceDataSha256: root.sourceDataSha256 as string,
    entries,
  })
}

export const parseAbilityFrequency = (
  rawValue: unknown,
  canonicalId: string,
  exceptions: AbilityFrequencyExceptionCatalog,
): AbilityFrequencyDeclaration => {
  if (typeof rawValue !== 'string' || rawValue.trim() !== rawValue || rawValue.length === 0) {
    return fail('invalid-frequency', `frequency.${canonicalId}`, 'must be canonical non-empty text.')
  }
  const raw = rawValue
  const exception = exceptions.entries.find(entry => entry.canonicalId === canonicalId) ?? null
  if (raw === 'Static') {
    if (exception) fail('unexpected-exception', `frequency.${canonicalId}`, 'Static cannot use an exception.')
    return Object.freeze({ raw, actionText: null, kind: 'static', uses: null, exceptionId: null })
  }
  const special = /^Special(?:\s*(?:–|-)\s*(.+))?$/.exec(raw)
  if (special) {
    if (!exception || exception.rawFrequency !== raw) {
      return fail('missing-exception', `frequency.${canonicalId}`, 'Special requires reviewed exception data.')
    }
    return Object.freeze({
      raw,
      actionText: special[1]?.trim() || null,
      kind: 'exceptional',
      uses: null,
      exceptionId: exception.exceptionId,
    })
  }
  if (exception) {
    fail('unexpected-exception', `frequency.${canonicalId}`, 'non-Special frequency has exception data.')
  }
  const match = FREQUENCY_PATTERN.exec(raw)
  if (!match) return fail('invalid-frequency', `frequency.${canonicalId}`, 'has an unsupported canonical form.')
  const baseKind = match[1]!
  const count = match[2] === undefined ? 1 : Number(match[2])
  const parsedAction = match[3]?.trim() || null
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
    fail('invalid-frequency', `frequency.${canonicalId}`, 'use count must be 1 through 10.')
  }
  if (baseKind === 'At-Will') {
    if (match[2] !== undefined) fail('invalid-frequency', `frequency.${canonicalId}`, 'At-Will cannot have a use count.')
    return Object.freeze({ raw, actionText: parsedAction, kind: 'at-will', uses: null, exceptionId: null })
  }
  return Object.freeze({
    raw,
    actionText: parsedAction,
    kind: baseKind === 'Scene' ? 'scene' : 'daily',
    uses: count,
    exceptionId: null,
  })
}

export const parseCanonicalAbilityFrequencies = (
  catalog: CanonicalAbilityCatalog,
  exceptions: AbilityFrequencyExceptionCatalog,
): ReadonlyMap<string, AbilityFrequencyDeclaration> => {
  const result = new Map<string, AbilityFrequencyDeclaration>()
  for (const ability of catalog.abilities) {
    result.set(
      ability.canonicalId,
      parseAbilityFrequency(ability.source.frequency, ability.canonicalId, exceptions),
    )
  }
  for (const exception of exceptions.entries) {
    if (result.get(exception.canonicalId)?.kind !== 'exceptional') {
      fail('unexpected-exception', `frequency.${exception.canonicalId}`, 'exception is not consumed.')
    }
  }
  return result
}
