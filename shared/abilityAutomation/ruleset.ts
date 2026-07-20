import rulesetJson from '../../data/ability-automation/ruleset.json'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'

export const ABILITY_RULESET_SCHEMA_VERSION = 1 as const
export const ABILITY_CANONICALIZATION_VERSION = 1 as const

export const ABILITY_SOURCE_INPUT_KINDS = [
  'checked-in-markdown',
  'documented-external-fill',
] as const

export type AbilitySourceInputKind = (typeof ABILITY_SOURCE_INPUT_KINDS)[number]

export type AbilityRulesetValidationCode =
  | 'invalid-provenance'
  | 'source-hash-mismatch'
  | 'invalid-source-json'
  | 'invalid-catalog'
  | 'source-gap-policy-mismatch'
  | 'canonical-count-mismatch'

export class AbilityRulesetValidationError extends Error {
  readonly code: AbilityRulesetValidationCode

  constructor(code: AbilityRulesetValidationCode, message: string) {
    super(message)
    this.name = 'AbilityRulesetValidationError'
    this.code = code
  }
}

export interface AbilityRulesSourceInput {
  readonly id: string
  readonly kind: AbilitySourceInputKind
  readonly location: string
}

export interface AbilityRulesetProvenance {
  readonly schemaVersion: typeof ABILITY_RULESET_SCHEMA_VERSION
  readonly rulesetId: string
  readonly sourceData: {
    readonly path: string
    readonly role: 'immediate-rules-data-authority'
    readonly sha256: string
  }
  readonly canonicalization: {
    readonly version: typeof ABILITY_CANONICALIZATION_VERSION
    readonly identity: 'source-key'
    readonly ordering: 'canonical-id-code-point'
    readonly expectedAbilityCount: number
    readonly knownSourceGaps: {
      readonly missingFrequency: readonly string[]
      readonly missingEffect: readonly string[]
    }
  }
  readonly sourceHierarchy: {
    readonly policy: 'immediate-cache-with-documented-upstream-priority'
    readonly orderedInputs: readonly AbilityRulesSourceInput[]
  }
  readonly homebrewNamespaces: {
    readonly policy: 'separate-explicit-namespace'
    readonly canonicalNamespace: 'canonical'
    readonly homebrewPrefix: string
    readonly includeInCanonicalCatalog: false
  }
}

export interface CanonicalAbilitySource {
  readonly name: string
  readonly frequency?: string
  readonly trigger?: string
  readonly effect?: string
  readonly bonus?: string
}

export interface CanonicalAbilityRecord {
  /** Stable identity from the authoritative source dictionary key. */
  readonly canonicalId: string
  readonly displayName: string
  readonly source: CanonicalAbilitySource
}

export interface CanonicalAbilityCatalog {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
  readonly abilities: readonly CanonicalAbilityRecord[]
  readonly knownSourceGaps: {
    readonly missingFrequency: readonly string[]
    readonly missingEffect: readonly string[]
  }
  readonly excludedHomebrewSourceKeys: readonly string[]
}

type UnknownRecord = Record<string, unknown>

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SOURCE_INPUT_KIND_SET = new Set<string>(ABILITY_SOURCE_INPUT_KINDS)
const ABILITY_SOURCE_FIELDS = ['name', 'frequency', 'trigger', 'effect', 'bonus'] as const
const MAX_IDENTIFIER_LENGTH = 160
const MAX_LOCATION_LENGTH = 500
const MAX_SOURCE_FIELD_LENGTH = 2_000
const MAX_CANONICAL_ABILITIES = 2_048
const MAX_SOURCE_INPUTS = 32

const fail = (code: AbilityRulesetValidationCode, message: string): never => {
  throw new AbilityRulesetValidationError(code, message)
}

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
  code: AbilityRulesetValidationCode = 'invalid-provenance',
): void => {
  const expected = new Set(expectedKeys)
  const missing = expectedKeys.filter(key => !hasOwn(record, key))
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  if (missing.length === 0 && unknown.length === 0) return
  fail(
    code,
    `${path} has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseRecord = (
  value: unknown,
  path: string,
  code: AbilityRulesetValidationCode = 'invalid-provenance',
): UnknownRecord => {
  if (!isRecord(value)) return fail(code, `${path} must be a plain object.`)
  return value
}

const parseBoundedString = (
  value: unknown,
  path: string,
  maximumLength: number,
  code: AbilityRulesetValidationCode = 'invalid-provenance',
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumLength
    || value.trim() !== value
  ) {
    return fail(code, `${path} must be a non-empty, trimmed string of at most ${maximumLength} characters.`)
  }
  return value
}

const parseIdentifier = (value: unknown, path: string): string => {
  const identifier = parseBoundedString(value, path, MAX_IDENTIFIER_LENGTH)
  if (CONTROL_CHARACTER_PATTERN.test(identifier)) {
    fail('invalid-provenance', `${path} must not contain control characters.`)
  }
  return identifier
}

const parseSha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-provenance', `${path} must be a lowercase SHA-256 digest.`)
  }
  return value
}

const compareCodePoints = (left: string, right: string): number => (
  left === right ? 0 : left < right ? -1 : 1
)

const sortedStrings = (values: readonly string[]): string[] => [...values].sort(compareCodePoints)

const parseSortedUniqueIdentifiers = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail('invalid-provenance', `${path} must be an array.`)
  const identifiers = value.map((entry, index) => parseIdentifier(entry, `${path}[${index}]`))
  if (new Set(identifiers).size !== identifiers.length) {
    fail('invalid-provenance', `${path} must not contain duplicates.`)
  }
  if (identifiers.some((identifier, index) => identifier !== sortedStrings(identifiers)[index])) {
    fail('invalid-provenance', `${path} must use canonical code-point order.`)
  }
  return identifiers
}

const parseSourceInputs = (value: unknown): readonly AbilityRulesSourceInput[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_INPUTS) {
    return fail(
      'invalid-provenance',
      `sourceHierarchy.orderedInputs must contain 1 through ${MAX_SOURCE_INPUTS} entries.`,
    )
  }
  const inputs = value.map((entry, index): AbilityRulesSourceInput => {
    const path = `sourceHierarchy.orderedInputs[${index}]`
    const record = parseRecord(entry, path)
    assertExactKeys(record, ['id', 'kind', 'location'], path)
    if (typeof record.kind !== 'string' || !SOURCE_INPUT_KIND_SET.has(record.kind)) {
      fail('invalid-provenance', `${path}.kind must be a supported source-input kind.`)
    }
    return {
      id: parseIdentifier(record.id, `${path}.id`),
      kind: record.kind as AbilitySourceInputKind,
      location: parseBoundedString(record.location, `${path}.location`, MAX_LOCATION_LENGTH),
    }
  })
  if (new Set(inputs.map(input => input.id)).size !== inputs.length) {
    fail('invalid-provenance', 'sourceHierarchy.orderedInputs must not repeat source IDs.')
  }
  if (new Set(inputs.map(input => input.location)).size !== inputs.length) {
    fail('invalid-provenance', 'sourceHierarchy.orderedInputs must not repeat source locations.')
  }
  return inputs
}

export const parseAbilityRulesetProvenance = (value: unknown): AbilityRulesetProvenance => {
  const root = parseRecord(value, 'abilityRuleset')
  assertExactKeys(root, [
    'schemaVersion',
    'rulesetId',
    'sourceData',
    'canonicalization',
    'sourceHierarchy',
    'homebrewNamespaces',
  ], 'abilityRuleset')
  if (root.schemaVersion !== ABILITY_RULESET_SCHEMA_VERSION) {
    fail('invalid-provenance', `schemaVersion must be ${ABILITY_RULESET_SCHEMA_VERSION}.`)
  }

  const sourceData = parseRecord(root.sourceData, 'sourceData')
  assertExactKeys(sourceData, ['path', 'role', 'sha256'], 'sourceData')
  if (sourceData.role !== 'immediate-rules-data-authority') {
    fail('invalid-provenance', 'sourceData.role must identify the immediate repository authority.')
  }

  const canonicalization = parseRecord(root.canonicalization, 'canonicalization')
  assertExactKeys(canonicalization, [
    'version',
    'identity',
    'ordering',
    'expectedAbilityCount',
    'knownSourceGaps',
  ], 'canonicalization')
  if (canonicalization.version !== ABILITY_CANONICALIZATION_VERSION) {
    fail(
      'invalid-provenance',
      `canonicalization.version must be ${ABILITY_CANONICALIZATION_VERSION}.`,
    )
  }
  if (canonicalization.identity !== 'source-key') {
    fail('invalid-provenance', 'canonicalization.identity must be source-key.')
  }
  if (canonicalization.ordering !== 'canonical-id-code-point') {
    fail('invalid-provenance', 'canonicalization.ordering must be canonical-id-code-point.')
  }
  if (
    !Number.isSafeInteger(canonicalization.expectedAbilityCount)
    || Number(canonicalization.expectedAbilityCount) < 1
    || Number(canonicalization.expectedAbilityCount) > MAX_CANONICAL_ABILITIES
  ) {
    fail(
      'invalid-provenance',
      `canonicalization.expectedAbilityCount must be from 1 through ${MAX_CANONICAL_ABILITIES}.`,
    )
  }
  const gaps = parseRecord(canonicalization.knownSourceGaps, 'canonicalization.knownSourceGaps')
  assertExactKeys(gaps, ['missingFrequency', 'missingEffect'], 'canonicalization.knownSourceGaps')

  const sourceHierarchy = parseRecord(root.sourceHierarchy, 'sourceHierarchy')
  assertExactKeys(sourceHierarchy, ['policy', 'orderedInputs'], 'sourceHierarchy')
  if (sourceHierarchy.policy !== 'immediate-cache-with-documented-upstream-priority') {
    fail('invalid-provenance', 'sourceHierarchy.policy is unsupported.')
  }

  const homebrewNamespaces = parseRecord(root.homebrewNamespaces, 'homebrewNamespaces')
  assertExactKeys(homebrewNamespaces, [
    'policy',
    'canonicalNamespace',
    'homebrewPrefix',
    'includeInCanonicalCatalog',
  ], 'homebrewNamespaces')
  if (
    homebrewNamespaces.policy !== 'separate-explicit-namespace'
    || homebrewNamespaces.canonicalNamespace !== 'canonical'
    || homebrewNamespaces.includeInCanonicalCatalog !== false
  ) {
    fail(
      'invalid-provenance',
      'homebrewNamespaces must keep explicit homebrew IDs outside the canonical catalog.',
    )
  }

  return {
    schemaVersion: ABILITY_RULESET_SCHEMA_VERSION,
    rulesetId: parseIdentifier(root.rulesetId, 'rulesetId'),
    sourceData: {
      path: parseBoundedString(sourceData.path, 'sourceData.path', MAX_LOCATION_LENGTH),
      role: 'immediate-rules-data-authority',
      sha256: parseSha256(sourceData.sha256, 'sourceData.sha256'),
    },
    canonicalization: {
      version: ABILITY_CANONICALIZATION_VERSION,
      identity: 'source-key',
      ordering: 'canonical-id-code-point',
      expectedAbilityCount: Number(canonicalization.expectedAbilityCount),
      knownSourceGaps: {
        missingFrequency: parseSortedUniqueIdentifiers(
          gaps.missingFrequency,
          'canonicalization.knownSourceGaps.missingFrequency',
        ),
        missingEffect: parseSortedUniqueIdentifiers(
          gaps.missingEffect,
          'canonicalization.knownSourceGaps.missingEffect',
        ),
      },
    },
    sourceHierarchy: {
      policy: 'immediate-cache-with-documented-upstream-priority',
      orderedInputs: parseSourceInputs(sourceHierarchy.orderedInputs),
    },
    homebrewNamespaces: {
      policy: 'separate-explicit-namespace',
      canonicalNamespace: 'canonical',
      homebrewPrefix: parseIdentifier(homebrewNamespaces.homebrewPrefix, 'homebrewNamespaces.homebrewPrefix'),
      includeInCanonicalCatalog: false,
    },
  }
}

export const ABILITY_RULESET_PROVENANCE = parseAbilityRulesetProvenance(rulesetJson)

export const abilityRulesSourceSha256 = async (
  sourceData: string | Uint8Array,
): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    fail('invalid-catalog', 'SHA-256 is unavailable in this runtime.')
  }
  return computeRulesetSourceSha256(sourceData)
}

const decodeSource = (sourceData: string | Uint8Array): string => {
  if (typeof sourceData === 'string') return sourceData
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(sourceData)
  }
  catch {
    return fail('invalid-source-json', 'The canonical ability source must be valid UTF-8 JSON.')
  }
}

const assertSameIdentities = (
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void => {
  const sortedActual = sortedStrings(actual)
  const sortedExpected = sortedStrings(expected)
  if (
    sortedActual.length === sortedExpected.length
    && sortedActual.every((identity, index) => identity === sortedExpected[index])
  ) return
  fail(
    'source-gap-policy-mismatch',
    `${label} changed (expected: ${sortedExpected.join(', ') || 'none'}; actual: ${sortedActual.join(', ') || 'none'}).`,
  )
}

const optionalAbilityField = (
  source: UnknownRecord,
  field: 'frequency' | 'trigger' | 'effect' | 'bonus',
  canonicalId: string,
): string | undefined => {
  if (!hasOwn(source, field)) return undefined
  return parseBoundedString(
    source[field],
    `abilities[${JSON.stringify(canonicalId)}].${field}`,
    MAX_SOURCE_FIELD_LENGTH,
    'invalid-catalog',
  )
}

const canonicalizeAbilityCatalog = (
  source: unknown,
  provenance: AbilityRulesetProvenance,
  sourceDataSha256: string,
): CanonicalAbilityCatalog => {
  if (!isRecord(source)) {
    return fail('invalid-catalog', 'The canonical ability source must be a JSON object keyed by ability identity.')
  }

  const abilities: CanonicalAbilityRecord[] = []
  const missingFrequency: string[] = []
  const missingEffect: string[] = []
  const homebrewSourceKeys: string[] = []

  for (const [canonicalId, value] of Object.entries(source)) {
    if (
      canonicalId.length === 0
      || canonicalId.length > MAX_IDENTIFIER_LENGTH
      || canonicalId.trim() !== canonicalId
      || CONTROL_CHARACTER_PATTERN.test(canonicalId)
    ) {
      fail('invalid-catalog', 'Canonical ability source keys must be bounded, non-empty, and trimmed.')
    }
    const record = parseRecord(
      value,
      `abilities[${JSON.stringify(canonicalId)}]`,
      'invalid-catalog',
    )
    assertExactKeys(
      record,
      ABILITY_SOURCE_FIELDS.filter(field => hasOwn(record, field)),
      `abilities[${JSON.stringify(canonicalId)}]`,
      'invalid-catalog',
    )
    if (!hasOwn(record, 'name')) {
      fail('invalid-catalog', `Canonical ability ${canonicalId} must have a name field.`)
    }
    if (record.name !== canonicalId) {
      fail('invalid-catalog', `Canonical ability ${canonicalId} must repeat its source key in the name field.`)
    }

    if (canonicalId.startsWith(provenance.homebrewNamespaces.homebrewPrefix)) {
      homebrewSourceKeys.push(canonicalId)
      continue
    }

    const frequency = optionalAbilityField(record, 'frequency', canonicalId)
    const trigger = optionalAbilityField(record, 'trigger', canonicalId)
    const effect = optionalAbilityField(record, 'effect', canonicalId)
    const bonus = optionalAbilityField(record, 'bonus', canonicalId)
    if (frequency === undefined) missingFrequency.push(canonicalId)
    if (effect === undefined) missingEffect.push(canonicalId)

    abilities.push({
      canonicalId,
      displayName: canonicalId,
      source: Object.freeze({
        name: canonicalId,
        ...(frequency === undefined ? {} : { frequency }),
        ...(trigger === undefined ? {} : { trigger }),
        ...(effect === undefined ? {} : { effect }),
        ...(bonus === undefined ? {} : { bonus }),
      }),
    })
  }

  assertSameIdentities(
    missingFrequency,
    provenance.canonicalization.knownSourceGaps.missingFrequency,
    'Canonical abilities missing frequency',
  )
  assertSameIdentities(
    missingEffect,
    provenance.canonicalization.knownSourceGaps.missingEffect,
    'Canonical abilities missing effect',
  )

  if (abilities.length !== provenance.canonicalization.expectedAbilityCount) {
    fail(
      'canonical-count-mismatch',
      `Canonical ability count changed (expected ${provenance.canonicalization.expectedAbilityCount}, actual ${abilities.length}).`,
    )
  }

  abilities.sort((left, right) => compareCodePoints(left.canonicalId, right.canonicalId))
  return {
    rulesetId: provenance.rulesetId,
    canonicalizationVersion: provenance.canonicalization.version,
    sourceDataSha256,
    abilities,
    knownSourceGaps: {
      missingFrequency: sortedStrings(missingFrequency),
      missingEffect: sortedStrings(missingEffect),
    },
    excludedHomebrewSourceKeys: sortedStrings(homebrewSourceKeys),
  }
}

/** Load the frozen ability catalog only after exact source-byte verification. */
export const loadCanonicalAbilityCatalog = async (
  sourceData: string | Uint8Array,
  provenanceInput: unknown = ABILITY_RULESET_PROVENANCE,
): Promise<CanonicalAbilityCatalog> => {
  const provenance = parseAbilityRulesetProvenance(provenanceInput)
  const actualSha256 = await abilityRulesSourceSha256(sourceData)
  if (actualSha256 !== provenance.sourceData.sha256) {
    fail(
      'source-hash-mismatch',
      `${provenance.sourceData.path} SHA-256 changed; expected ${provenance.sourceData.sha256}, received ${actualSha256}. Update provenance only after intentional rules review.`,
    )
  }

  let source: unknown
  try {
    source = JSON.parse(decodeSource(sourceData))
  }
  catch (error) {
    if (error instanceof AbilityRulesetValidationError) throw error
    fail('invalid-source-json', `${provenance.sourceData.path} must contain valid JSON.`)
  }
  return canonicalizeAbilityCatalog(source, provenance, actualSha256)
}
