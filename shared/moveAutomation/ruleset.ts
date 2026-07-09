import rulesetJson from '../../data/move-automation/ruleset.json'

export const MOVE_RULESET_SCHEMA_VERSION = 1 as const
export const MOVE_CANONICALIZATION_VERSION = 1 as const

export const CANONICAL_MOVE_TYPES = [
  'Normal',
  'Fighting',
  'Flying',
  'Poison',
  'Ground',
  'Rock',
  'Bug',
  'Ghost',
  'Steel',
  'Fire',
  'Water',
  'Grass',
  'Electric',
  'Psychic',
  'Ice',
  'Dragon',
  'Dark',
  'Fairy',
] as const

export type CanonicalMoveType = (typeof CANONICAL_MOVE_TYPES)[number]

export type MoveRulesetValidationCode =
  | 'invalid-provenance'
  | 'source-hash-mismatch'
  | 'invalid-source-json'
  | 'invalid-catalog'
  | 'parser-junk-policy-mismatch'
  | 'struggle-policy-mismatch'
  | 'canonical-count-mismatch'

export class MoveRulesetValidationError extends Error {
  readonly code: MoveRulesetValidationCode

  constructor(code: MoveRulesetValidationCode, message: string) {
    super(message)
    this.name = 'MoveRulesetValidationError'
    this.code = code
  }
}

export interface MoveRulesSourceReference {
  readonly id: string
  readonly citation: string
  readonly verifiedAt: string
  readonly sourceDataSha256: string
}

export interface MoveRulesetProvenance {
  readonly schemaVersion: typeof MOVE_RULESET_SCHEMA_VERSION
  readonly rulesetId: string
  readonly sourceData: {
    readonly path: string
    readonly role: 'immediate-rules-data-authority'
    readonly sha256: string
  }
  readonly canonicalization: {
    readonly version: typeof MOVE_CANONICALIZATION_VERSION
    readonly identity: 'source-key'
    readonly ordering: 'canonical-id-code-point'
    readonly expectedMoveCount: number
    readonly includedTypes: readonly CanonicalMoveType[]
    readonly excludedParserJunk: {
      readonly policy: 'exclude-records-with-noncanonical-types'
      readonly expectedSourceKeys: readonly string[]
    }
  }
  readonly struggleVariants: {
    readonly policy: 'distinct-canonical-records'
    readonly canonicalSourceKeys: readonly string[]
  }
  readonly homebrewNamespaces: {
    readonly policy: 'separate-explicit-namespace'
    readonly canonicalNamespace: 'canonical'
    readonly homebrewPrefix: string
    readonly includeInCanonicalCatalog: false
  }
  readonly verifiedSupplementSources: readonly MoveRulesSourceReference[]
  readonly verifiedErrataSources: readonly MoveRulesSourceReference[]
}

export interface CanonicalMoveRecord {
  /** Stable identity from the authoritative source dictionary key. */
  readonly canonicalId: string
  readonly displayName: string
  readonly type: CanonicalMoveType
  readonly source: Readonly<Record<string, unknown>>
}

export interface CanonicalMoveCatalog {
  readonly rulesetId: string
  readonly canonicalizationVersion: number
  readonly sourceDataSha256: string
  readonly moves: readonly CanonicalMoveRecord[]
  readonly excludedParserJunkSourceKeys: readonly string[]
  readonly excludedHomebrewSourceKeys: readonly string[]
}

type UnknownRecord = Record<string, unknown>

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const STRUGGLE_CANONICAL_ID_PATTERN = /^Struggle(?:$| \()/

const fail = (code: MoveRulesetValidationCode, message: string): never => {
  throw new MoveRulesetValidationError(code, message)
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void => {
  const expected = new Set(expectedKeys)
  const missing = expectedKeys.filter((key) => !hasOwn(record, key))
  const unknown = Object.keys(record).filter((key) => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-provenance',
      `${path} has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('invalid-provenance', `${path} must be an object.`)
  return value
}

const parseNonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return fail('invalid-provenance', `${path} must be a non-empty, trimmed string.`)
  }
  return value
}

const parseSha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-provenance', `${path} must be a lowercase SHA-256 digest.`)
  }
  return value
}

const parseUniqueStrings = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) return fail('invalid-provenance', `${path} must be an array.`)
  const strings = value.map((entry, index) => parseNonEmptyString(entry, `${path}[${index}]`))
  if (new Set(strings).size !== strings.length) {
    fail('invalid-provenance', `${path} must not contain duplicates.`)
  }
  return strings
}

const parseRulesSourceReferences = (
  value: unknown,
  path: string,
): readonly MoveRulesSourceReference[] => {
  if (!Array.isArray(value)) return fail('invalid-provenance', `${path} must be an array.`)

  const references = value.map((entry, index): MoveRulesSourceReference => {
    const entryPath = `${path}[${index}]`
    const record = parseRecord(entry, entryPath)
    assertExactKeys(record, ['id', 'citation', 'verifiedAt', 'sourceDataSha256'], entryPath)
    const verifiedAt = parseNonEmptyString(record.verifiedAt, `${entryPath}.verifiedAt`)
    if (!ISO_DATE_PATTERN.test(verifiedAt)) {
      fail('invalid-provenance', `${entryPath}.verifiedAt must use YYYY-MM-DD.`)
    }
    return {
      id: parseNonEmptyString(record.id, `${entryPath}.id`),
      citation: parseNonEmptyString(record.citation, `${entryPath}.citation`),
      verifiedAt,
      sourceDataSha256: parseSha256(record.sourceDataSha256, `${entryPath}.sourceDataSha256`),
    }
  })

  const ids = references.map(({ id }) => id)
  if (new Set(ids).size !== ids.length) {
    fail('invalid-provenance', `${path} must not contain duplicate source IDs.`)
  }
  return references
}

const parseIncludedTypes = (value: unknown): readonly CanonicalMoveType[] => {
  const types = parseUniqueStrings(value, 'canonicalization.includedTypes')
  if (
    types.length !== CANONICAL_MOVE_TYPES.length
    || types.some((type, index) => type !== CANONICAL_MOVE_TYPES[index])
  ) {
    fail(
      'invalid-provenance',
      'canonicalization.includedTypes must list the 18 canonical move types in canonical order.',
    )
  }
  return types as readonly CanonicalMoveType[]
}

export const parseMoveRulesetProvenance = (value: unknown): MoveRulesetProvenance => {
  const root = parseRecord(value, 'ruleset')
  assertExactKeys(root, [
    'schemaVersion',
    'rulesetId',
    'sourceData',
    'canonicalization',
    'struggleVariants',
    'homebrewNamespaces',
    'verifiedSupplementSources',
    'verifiedErrataSources',
  ], 'ruleset')

  if (root.schemaVersion !== MOVE_RULESET_SCHEMA_VERSION) {
    fail('invalid-provenance', `schemaVersion must be ${MOVE_RULESET_SCHEMA_VERSION}.`)
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
    'expectedMoveCount',
    'includedTypes',
    'excludedParserJunk',
  ], 'canonicalization')
  if (canonicalization.version !== MOVE_CANONICALIZATION_VERSION) {
    fail('invalid-provenance', `canonicalization.version must be ${MOVE_CANONICALIZATION_VERSION}.`)
  }
  if (canonicalization.identity !== 'source-key') {
    fail('invalid-provenance', 'canonicalization.identity must be source-key.')
  }
  if (canonicalization.ordering !== 'canonical-id-code-point') {
    fail('invalid-provenance', 'canonicalization.ordering must be canonical-id-code-point.')
  }
  if (!Number.isSafeInteger(canonicalization.expectedMoveCount) || Number(canonicalization.expectedMoveCount) < 1) {
    fail('invalid-provenance', 'canonicalization.expectedMoveCount must be a positive safe integer.')
  }

  const excludedParserJunk = parseRecord(
    canonicalization.excludedParserJunk,
    'canonicalization.excludedParserJunk',
  )
  assertExactKeys(excludedParserJunk, ['policy', 'expectedSourceKeys'], 'canonicalization.excludedParserJunk')
  if (excludedParserJunk.policy !== 'exclude-records-with-noncanonical-types') {
    fail('invalid-provenance', 'canonicalization.excludedParserJunk.policy is unsupported.')
  }

  const struggleVariants = parseRecord(root.struggleVariants, 'struggleVariants')
  assertExactKeys(struggleVariants, ['policy', 'canonicalSourceKeys'], 'struggleVariants')
  if (struggleVariants.policy !== 'distinct-canonical-records') {
    fail('invalid-provenance', 'struggleVariants.policy must keep each variant distinct.')
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
    fail('invalid-provenance', 'homebrewNamespaces must keep explicit homebrew IDs outside the canonical catalog.')
  }

  return {
    schemaVersion: MOVE_RULESET_SCHEMA_VERSION,
    rulesetId: parseNonEmptyString(root.rulesetId, 'rulesetId'),
    sourceData: {
      path: parseNonEmptyString(sourceData.path, 'sourceData.path'),
      role: 'immediate-rules-data-authority',
      sha256: parseSha256(sourceData.sha256, 'sourceData.sha256'),
    },
    canonicalization: {
      version: MOVE_CANONICALIZATION_VERSION,
      identity: 'source-key',
      ordering: 'canonical-id-code-point',
      expectedMoveCount: Number(canonicalization.expectedMoveCount),
      includedTypes: parseIncludedTypes(canonicalization.includedTypes),
      excludedParserJunk: {
        policy: 'exclude-records-with-noncanonical-types',
        expectedSourceKeys: parseUniqueStrings(
          excludedParserJunk.expectedSourceKeys,
          'canonicalization.excludedParserJunk.expectedSourceKeys',
        ),
      },
    },
    struggleVariants: {
      policy: 'distinct-canonical-records',
      canonicalSourceKeys: parseUniqueStrings(
        struggleVariants.canonicalSourceKeys,
        'struggleVariants.canonicalSourceKeys',
      ),
    },
    homebrewNamespaces: {
      policy: 'separate-explicit-namespace',
      canonicalNamespace: 'canonical',
      homebrewPrefix: parseNonEmptyString(homebrewNamespaces.homebrewPrefix, 'homebrewNamespaces.homebrewPrefix'),
      includeInCanonicalCatalog: false,
    },
    verifiedSupplementSources: parseRulesSourceReferences(
      root.verifiedSupplementSources,
      'verifiedSupplementSources',
    ),
    verifiedErrataSources: parseRulesSourceReferences(root.verifiedErrataSources, 'verifiedErrataSources'),
  }
}

export const MOVE_RULESET_PROVENANCE = parseMoveRulesetProvenance(rulesetJson)

const sourceBytes = (sourceData: string | Uint8Array): Uint8Array<ArrayBuffer> => {
  if (typeof sourceData === 'string') return new TextEncoder().encode(sourceData)
  const copy = new Uint8Array(new ArrayBuffer(sourceData.byteLength))
  copy.set(sourceData)
  return copy
}

export const sha256Hex = async (sourceData: string | Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    fail('invalid-catalog', 'SHA-256 is unavailable in this runtime.')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', sourceBytes(sourceData))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const decodeSource = (sourceData: string | Uint8Array): string => {
  if (typeof sourceData === 'string') return sourceData
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(sourceData)
  }
  catch {
    return fail('invalid-source-json', 'The canonical move source must be valid UTF-8 JSON.')
  }
}

const sortedStrings = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left === right ? 0 : left < right ? -1 : 1)

const assertSameIdentities = (
  actual: readonly string[],
  expected: readonly string[],
  code: MoveRulesetValidationCode,
  label: string,
): void => {
  const sortedActual = sortedStrings(actual)
  const sortedExpected = sortedStrings(expected)
  if (
    sortedActual.length !== sortedExpected.length
    || sortedActual.some((identity, index) => identity !== sortedExpected[index])
  ) {
    fail(
      code,
      `${label} changed (expected: ${sortedExpected.join(', ') || 'none'}; actual: ${sortedActual.join(', ') || 'none'}).`,
    )
  }
}

const canonicalizeMoveCatalog = (
  source: unknown,
  provenance: MoveRulesetProvenance,
  sourceDataSha256: string,
): CanonicalMoveCatalog => {
  if (!isRecord(source)) {
    return fail('invalid-catalog', 'The canonical move source must be a JSON object keyed by move identity.')
  }

  const includedTypes = new Set<string>(provenance.canonicalization.includedTypes)
  const moves: CanonicalMoveRecord[] = []
  const parserJunkSourceKeys: string[] = []
  const homebrewSourceKeys: string[] = []

  for (const [canonicalId, value] of Object.entries(source)) {
    if (!canonicalId || canonicalId.trim() !== canonicalId) {
      fail('invalid-catalog', 'Canonical move source keys must be non-empty and trimmed.')
    }
    if (!isRecord(value)) return fail('invalid-catalog', `Canonical move ${canonicalId} must be an object.`)
    if (value.name !== canonicalId) {
      fail('invalid-catalog', `Canonical move ${canonicalId} must repeat its source key in the name field.`)
    }

    if (canonicalId.startsWith(provenance.homebrewNamespaces.homebrewPrefix)) {
      homebrewSourceKeys.push(canonicalId)
      continue
    }

    if (typeof value.type !== 'string' || !includedTypes.has(value.type)) {
      parserJunkSourceKeys.push(canonicalId)
      continue
    }

    moves.push({
      canonicalId,
      displayName: canonicalId,
      type: value.type as CanonicalMoveType,
      source: Object.freeze({ ...value }),
    })
  }

  assertSameIdentities(
    parserJunkSourceKeys,
    provenance.canonicalization.excludedParserJunk.expectedSourceKeys,
    'parser-junk-policy-mismatch',
    'Excluded parser-junk source identities',
  )

  const struggleSourceKeys = moves
    .map(({ canonicalId }) => canonicalId)
    .filter((canonicalId) => STRUGGLE_CANONICAL_ID_PATTERN.test(canonicalId))
  assertSameIdentities(
    struggleSourceKeys,
    provenance.struggleVariants.canonicalSourceKeys,
    'struggle-policy-mismatch',
    'Canonical Struggle identities',
  )

  if (moves.length !== provenance.canonicalization.expectedMoveCount) {
    fail(
      'canonical-count-mismatch',
      `Canonical move count changed (expected ${provenance.canonicalization.expectedMoveCount}, actual ${moves.length}).`,
    )
  }

  moves.sort((left, right) => left.canonicalId === right.canonicalId ? 0 : left.canonicalId < right.canonicalId ? -1 : 1)

  return {
    rulesetId: provenance.rulesetId,
    canonicalizationVersion: provenance.canonicalization.version,
    sourceDataSha256,
    moves,
    excludedParserJunkSourceKeys: sortedStrings(parserJunkSourceKeys),
    excludedHomebrewSourceKeys: sortedStrings(homebrewSourceKeys),
  }
}

/**
 * Load the frozen canonical move catalog after checking the exact source bytes
 * against the reviewed provenance record. Catalog edits therefore require an
 * intentional provenance hash update before canonicalization can proceed.
 */
export const loadCanonicalMoveCatalog = async (
  sourceData: string | Uint8Array,
  provenanceInput: unknown = MOVE_RULESET_PROVENANCE,
): Promise<CanonicalMoveCatalog> => {
  const provenance = parseMoveRulesetProvenance(provenanceInput)
  const actualSha256 = await sha256Hex(sourceData)
  if (actualSha256 !== provenance.sourceData.sha256) {
    fail(
      'source-hash-mismatch',
      `${provenance.sourceData.path} SHA-256 changed; expected ${provenance.sourceData.sha256}, received ${actualSha256}. Update the provenance record only after intentional rules review.`,
    )
  }

  let source: unknown
  try {
    source = JSON.parse(decodeSource(sourceData))
  }
  catch (error) {
    if (error instanceof MoveRulesetValidationError) throw error
    fail('invalid-source-json', `${provenance.sourceData.path} must contain valid JSON.`)
  }

  return canonicalizeMoveCatalog(source, provenance, actualSha256)
}
