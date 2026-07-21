import type { CanonicalAbilityCatalog } from './ruleset'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_PROTECTION_SCHEMA_VERSION = 1 as const

export interface AbilityProtection {
  readonly canonicalId: string
  readonly copyable: boolean
  readonly disableable: boolean
  readonly transferable: boolean
  readonly sourcePhrase: string
}

export interface AbilityProtectionCatalog {
  readonly schemaVersion: typeof ABILITY_PROTECTION_SCHEMA_VERSION
  readonly sourceDataSha256: string
  readonly entries: readonly AbilityProtection[]
}

export const DEFAULT_ABILITY_PROTECTION = Object.freeze({
  copyable: true,
  disableable: true,
  transferable: true,
})

export type AbilityProtectionValidationCode =
  | 'invalid-catalog'
  | 'source-mismatch'
  | 'unknown-ability'
  | 'duplicate-id'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityProtectionValidationError extends Error {
  readonly code: AbilityProtectionValidationCode
  readonly path: string

  constructor(code: AbilityProtectionValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityProtectionValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'sourceDataSha256', 'entries'] as const
const ENTRY_FIELDS = [
  'canonicalId',
  'copyable',
  'disableable',
  'transferable',
  'sourcePhrase',
] as const
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const fail = (
  code: AbilityProtectionValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityProtectionValidationError(code, path, detail)
}

const clone = (value: unknown) => cloneStrictJson(value, 'abilityProtections', {
  limits: {
    depth: 4,
    nodes: 2_048,
    objectFields: 8,
    arrayEntries: 64,
    stringLength: 1_000,
    objectKeyLength: 160,
  },
  rootLabel: 'ability protections',
  valueLabel: 'ability protections',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-catalog', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail('invalid-catalog', path, 'has an invalid shape.')
}

const text = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return fail('invalid-catalog', path, 'must be bounded trimmed text.')
  return value
}

export const parseAbilityProtectionCatalog = (
  value: unknown,
  canonical: CanonicalAbilityCatalog,
): AbilityProtectionCatalog => {
  const input = record(clone(value), 'abilityProtections')
  exact(input, ROOT_FIELDS, 'abilityProtections')
  if (input.schemaVersion !== ABILITY_PROTECTION_SCHEMA_VERSION) {
    fail('invalid-catalog', 'abilityProtections.schemaVersion', 'is unsupported.')
  }
  if (
    typeof input.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(input.sourceDataSha256)
    || input.sourceDataSha256 !== canonical.sourceDataSha256
  ) fail('source-mismatch', 'abilityProtections.sourceDataSha256', 'must match canonical data.')
  if (!Array.isArray(input.entries) || input.entries.length > 64) {
    fail('limit-exceeded', 'abilityProtections.entries', 'must be a bounded array.')
  }
  const canonicalById = new Map(canonical.abilities.map((ability, index) => [
    ability.canonicalId,
    { ability, index },
  ]))
  const entries = (input.entries as readonly unknown[]).map((value, index): AbilityProtection => {
    const path = `abilityProtections.entries[${index}]`
    const row = record(value, path)
    exact(row, ENTRY_FIELDS, path)
    const canonicalId = text(row.canonicalId, `${path}.canonicalId`, 160)
    const canonicalRecord = canonicalById.get(canonicalId)
      ?? fail('unknown-ability', `${path}.canonicalId`, 'is not canonical.')
    for (const field of ['copyable', 'disableable', 'transferable'] as const) {
      if (typeof row[field] !== 'boolean') fail('invalid-catalog', `${path}.${field}`, 'must be boolean.')
    }
    if (row.copyable === true && row.disableable === true && row.transferable === true) {
      fail('invalid-catalog', path, 'must differ from the default protection policy.')
    }
    const sourcePhrase = text(row.sourcePhrase, `${path}.sourcePhrase`, 1_000)
    if (!canonicalRecord.ability.source.effect?.includes(sourcePhrase)) {
      fail('source-mismatch', `${path}.sourcePhrase`, 'must occur in canonical effect text.')
    }
    return Object.freeze({
      canonicalId,
      copyable: row.copyable as boolean,
      disableable: row.disableable as boolean,
      transferable: row.transferable as boolean,
      sourcePhrase,
    })
  })
  if (new Set(entries.map(entry => entry.canonicalId)).size !== entries.length) {
    fail('duplicate-id', 'abilityProtections.entries', 'must not repeat abilities.')
  }
  if (entries.some((entry, index) => index > 0 && (
    canonicalById.get(entry.canonicalId)!.index
      <= canonicalById.get(entries[index - 1]!.canonicalId)!.index
  ))) fail('invalid-catalog', 'abilityProtections.entries', 'must use canonical order.')
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_PROTECTION_SCHEMA_VERSION,
    sourceDataSha256: input.sourceDataSha256 as string,
    entries,
  })
}

export const abilityProtectionFor = (
  catalog: AbilityProtectionCatalog,
  canonicalId: string,
): Readonly<Omit<AbilityProtection, 'canonicalId' | 'sourcePhrase'>> => {
  const match = catalog.entries.find(entry => entry.canonicalId === canonicalId)
  return match
    ? Object.freeze({
        copyable: match.copyable,
        disableable: match.disableable,
        transferable: match.transferable,
      })
    : DEFAULT_ABILITY_PROTECTION
}
