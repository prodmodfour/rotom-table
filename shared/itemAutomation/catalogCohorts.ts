import { cloneStrictJson, deepFreezeStrictJson } from '../automation/strictJson'

export const ITEM_CATALOG_COHORT_SCHEMA_VERSION = 1 as const
export const ITEM_CATALOG_COHORT_MEMBER_LIMIT_MAXIMUM = 64 as const
export const ITEM_CATALOG_COHORT_COUNT_MAXIMUM = 64 as const
export const ITEM_CATALOG_IMPLEMENTATION_STATES = [
  'native', 'guided', 'passive', 'reference-only', 'not-applicable', 'blocked',
] as const
export type ItemCatalogImplementationState = typeof ITEM_CATALOG_IMPLEMENTATION_STATES[number]

export const ITEM_CATALOG_PROVIDER_IDS = [
  'machine-move', 'evolution', 'permanent-advancement', 'exploration', 'breeding',
  'guided-adjudication', 'equipment', 'core-item-spec', 'capture',
  'interpretive-campaign-tool', 'canonical-data-defect',
] as const
export type ItemCatalogProviderId = typeof ITEM_CATALOG_PROVIDER_IDS[number]

export interface ItemCatalogCohortEvidenceV1 {
  readonly path: string
  readonly sha256: string
}

export interface ItemCatalogCohortMemberV1 {
  readonly canonicalId: string
  readonly recordSha256: string
  readonly effectSha256: string
}

export interface ItemCatalogCohortV1 {
  readonly cohortId: string
  readonly sequence: number
  readonly providerId: ItemCatalogProviderId
  readonly implementationState: ItemCatalogImplementationState
  readonly memberCount: number
  readonly sourceFingerprint: string
  readonly members: readonly ItemCatalogCohortMemberV1[]
  readonly providerRequirements: readonly string[]
  readonly sourceEvidence: readonly ItemCatalogCohortEvidenceV1[]
  readonly executableEvidence: readonly ItemCatalogCohortEvidenceV1[]
  readonly uiProjectionEvidence: readonly ItemCatalogCohortEvidenceV1[]
  readonly recoveryEvidence: readonly ItemCatalogCohortEvidenceV1[]
  readonly unresolvedRequirements: readonly string[]
}

export interface ItemCatalogCohortRegistryV1 {
  readonly schemaVersion: 1
  readonly ticket: 'P8-092'
  readonly status: 'reviewed'
  readonly catalogSha256: string
  readonly policySha256: string
  readonly runtimeProseParsing: false
  readonly cohortMemberLimit: number
  readonly cohortCount: number
  readonly itemCount: number
  readonly implementationStateCounts: Readonly<Partial<Record<ItemCatalogImplementationState, number>>>
  readonly providerCounts: Readonly<Record<ItemCatalogProviderId, number>>
  readonly registrySha256: string
  readonly cohorts: readonly ItemCatalogCohortV1[]
}

export class ItemCatalogCohortContractError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ItemCatalogCohortContractError'
    this.path = path
  }
}

type Row = Record<string, unknown>
const ROOT_FIELDS = [
  'schemaVersion', 'ticket', 'status', 'catalogSha256', 'policySha256',
  'runtimeProseParsing', 'cohortMemberLimit', 'cohortCount', 'itemCount',
  'implementationStateCounts', 'providerCounts', 'registrySha256', 'cohorts',
] as const
const COHORT_FIELDS = [
  'cohortId', 'sequence', 'providerId', 'implementationState', 'memberCount',
  'sourceFingerprint', 'members', 'providerRequirements', 'sourceEvidence',
  'executableEvidence', 'uiProjectionEvidence', 'recoveryEvidence',
  'unresolvedRequirements',
] as const
const MEMBER_FIELDS = ['canonicalId', 'recordSha256', 'effectSha256'] as const
const EVIDENCE_FIELDS = ['path', 'sha256'] as const
const SHA256 = /^[a-f0-9]{64}$/
const COHORT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const fail = (path: string, message: string): never => {
  throw new ItemCatalogCohortContractError(path, message)
}
const clone = (value: unknown, path: string): unknown => cloneStrictJson(value, path, {
  limits: {
    depth: 8,
    nodes: 100_000,
    objectFields: 32,
    arrayEntries: 1_000,
    stringLength: 1_000,
    objectKeyLength: 100,
  },
  rootLabel: path,
  valueLabel: 'item catalog cohort data',
  failNotJson: (at, detail) => fail(at, detail),
  failLimit: (at, detail) => fail(at, detail),
})
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  const row = value as Row
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    fail(path, `must contain exactly: ${fields.join(', ')}.`)
  }
  return row
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : fail(path, `must be a safe integer from ${minimum} through ${maximum}.`)
)
const sha256 = (value: unknown, path: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail(path, 'must be a lowercase SHA-256.')
)
const boundedText = (value: unknown, path: string, maximum = 300): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= maximum
  && value.trim() === value && !/\p{C}/u.test(value)
    ? value
    : fail(path, `must be bounded visible text of at most ${maximum} characters.`)
)
const repositoryPath = (value: unknown, path: string): string => {
  const parsed = boundedText(value, path, 500)
  if (parsed.startsWith('/') || parsed.includes('\\') || parsed.split('/').includes('..')) {
    fail(path, 'must be an app-relative repository path.')
  }
  return parsed
}
const stringArray = (
  value: unknown,
  path: string,
  options: { readonly minimum: number, readonly maximum: number },
): readonly string[] => {
  if (!Array.isArray(value) || value.length < options.minimum || value.length > options.maximum) {
    fail(path, `must contain from ${options.minimum} through ${options.maximum} entries.`)
  }
  const entries = value as unknown[]
  const parsed = entries.map((entry, index) => boundedText(entry, `${path}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(path, 'must contain unique entries.')
  return Object.freeze(parsed)
}
const parseEvidence = (value: unknown, path: string): ItemCatalogCohortEvidenceV1 => {
  const row = exact(value, EVIDENCE_FIELDS, path)
  return Object.freeze({
    path: repositoryPath(row.path, `${path}.path`),
    sha256: sha256(row.sha256, `${path}.sha256`),
  })
}
const evidenceArray = (value: unknown, path: string): readonly ItemCatalogCohortEvidenceV1[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    fail(path, 'must contain from 1 through 16 evidence references.')
  }
  const entries = value as unknown[]
  const parsed = entries.map((entry, index) => parseEvidence(entry, `${path}[${index}]`))
  if (new Set(parsed.map(entry => entry.path)).size !== parsed.length) fail(path, 'must contain unique evidence paths.')
  return Object.freeze(parsed)
}
const parseMember = (value: unknown, path: string): ItemCatalogCohortMemberV1 => {
  const row = exact(value, MEMBER_FIELDS, path)
  return Object.freeze({
    canonicalId: boundedText(row.canonicalId, `${path}.canonicalId`, 160),
    recordSha256: sha256(row.recordSha256, `${path}.recordSha256`),
    effectSha256: sha256(row.effectSha256, `${path}.effectSha256`),
  })
}
const implementationState = (value: unknown, path: string): ItemCatalogImplementationState => (
  typeof value === 'string' && (ITEM_CATALOG_IMPLEMENTATION_STATES as readonly string[]).includes(value)
    ? value as ItemCatalogImplementationState
    : fail(path, 'must be one reviewed implementation state.')
)
const providerId = (value: unknown, path: string): ItemCatalogProviderId => (
  typeof value === 'string' && (ITEM_CATALOG_PROVIDER_IDS as readonly string[]).includes(value)
    ? value as ItemCatalogProviderId
    : fail(path, 'must be one reviewed provider identity.')
)

const parseCohort = (
  value: unknown,
  path: string,
  memberLimit: number,
): ItemCatalogCohortV1 => {
  const row = exact(value, COHORT_FIELDS, path)
  const cohortId = typeof row.cohortId === 'string' && COHORT_ID.test(row.cohortId)
    ? row.cohortId
    : fail(`${path}.cohortId`, 'must be a lowercase kebab identity.')
  const state = implementationState(row.implementationState, `${path}.implementationState`)
  if (!Array.isArray(row.members) || row.members.length < 1 || row.members.length > memberLimit) {
    fail(`${path}.members`, `must contain from 1 through ${memberLimit} members.`)
  }
  const memberEntries = row.members as unknown[]
  const members: readonly ItemCatalogCohortMemberV1[] = Object.freeze(memberEntries.map(
    (entry, index) => parseMember(entry, `${path}.members[${index}]`),
  ))
  if (new Set(members.map(member => member.canonicalId)).size !== members.length) {
    fail(`${path}.members`, 'must contain unique canonical identities.')
  }
  const memberCount = integer(row.memberCount, `${path}.memberCount`, 1, memberLimit)
  if (memberCount !== members.length) fail(`${path}.memberCount`, 'must equal the exact member array length.')
  const unresolvedRequirements = stringArray(row.unresolvedRequirements, `${path}.unresolvedRequirements`, {
    minimum: state === 'blocked' ? 1 : 0,
    maximum: 16,
  })
  if (state !== 'blocked' && unresolvedRequirements.length !== 0) {
    fail(`${path}.unresolvedRequirements`, 'must be empty for a non-blocked implementation decision.')
  }
  return Object.freeze({
    cohortId,
    sequence: integer(row.sequence, `${path}.sequence`, 1, ITEM_CATALOG_COHORT_COUNT_MAXIMUM),
    providerId: providerId(row.providerId, `${path}.providerId`),
    implementationState: state,
    memberCount,
    sourceFingerprint: sha256(row.sourceFingerprint, `${path}.sourceFingerprint`),
    members,
    providerRequirements: stringArray(row.providerRequirements, `${path}.providerRequirements`, { minimum: 1, maximum: 16 }),
    sourceEvidence: evidenceArray(row.sourceEvidence, `${path}.sourceEvidence`),
    executableEvidence: evidenceArray(row.executableEvidence, `${path}.executableEvidence`),
    uiProjectionEvidence: evidenceArray(row.uiProjectionEvidence, `${path}.uiProjectionEvidence`),
    recoveryEvidence: evidenceArray(row.recoveryEvidence, `${path}.recoveryEvidence`),
    unresolvedRequirements,
  })
}

const parseCountMap = <TKey extends string>(input: {
  readonly value: unknown
  readonly path: string
  readonly allowed: readonly TKey[]
  readonly requireEvery: boolean
}): Readonly<Partial<Record<TKey, number>>> => {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) fail(input.path, 'must be an object.')
  const row = input.value as Row
  if (Object.keys(row).some(key => !input.allowed.includes(key as TKey))
    || (input.requireEvery && input.allowed.some(key => !Object.hasOwn(row, key)))) {
    fail(input.path, 'contains an unknown or missing count key.')
  }
  const result: Partial<Record<TKey, number>> = {}
  for (const key of input.allowed) {
    if (Object.hasOwn(row, key)) result[key] = integer(row[key], `${input.path}.${key}`)
  }
  return Object.freeze(result)
}

export const parseItemCatalogCohortRegistryV1 = (
  value: unknown,
  path = 'itemCatalogCohortRegistry',
): ItemCatalogCohortRegistryV1 => {
  const row = exact(clone(value, path), ROOT_FIELDS, path)
  if (row.schemaVersion !== 1 || row.ticket !== 'P8-092' || row.status !== 'reviewed'
    || row.runtimeProseParsing !== false) {
    fail(path, 'must be the reviewed P8-092 schema-v1 registry without runtime prose parsing.')
  }
  const cohortMemberLimit = integer(
    row.cohortMemberLimit,
    `${path}.cohortMemberLimit`,
    1,
    ITEM_CATALOG_COHORT_MEMBER_LIMIT_MAXIMUM,
  )
  if (!Array.isArray(row.cohorts) || row.cohorts.length < 1
    || row.cohorts.length > ITEM_CATALOG_COHORT_COUNT_MAXIMUM) {
    fail(`${path}.cohorts`, `must contain from 1 through ${ITEM_CATALOG_COHORT_COUNT_MAXIMUM} cohorts.`)
  }
  const cohortEntries = row.cohorts as unknown[]
  const cohorts: readonly ItemCatalogCohortV1[] = Object.freeze(cohortEntries.map(
    (entry, index) => parseCohort(
      entry,
      `${path}.cohorts[${index}]`,
      cohortMemberLimit,
    ),
  ))
  const cohortCount = integer(row.cohortCount, `${path}.cohortCount`, 1, ITEM_CATALOG_COHORT_COUNT_MAXIMUM)
  if (cohortCount !== cohorts.length) fail(`${path}.cohortCount`, 'must equal the exact cohort array length.')
  const itemCount = integer(row.itemCount, `${path}.itemCount`, 1, 10_000)
  const memberTotal = cohorts.reduce((total, cohort) => total + cohort.memberCount, 0)
  if (itemCount !== memberTotal) fail(`${path}.itemCount`, 'must equal the complete cohort member total.')
  if (new Set(cohorts.map(cohort => cohort.cohortId)).size !== cohorts.length) {
    fail(`${path}.cohorts`, 'must contain unique cohort identities.')
  }
  const canonicalIds = cohorts.flatMap(cohort => cohort.members.map(member => member.canonicalId))
  if (new Set(canonicalIds).size !== canonicalIds.length) {
    fail(`${path}.cohorts`, 'must assign every canonical identity at most once.')
  }
  cohorts.forEach((cohort, index) => {
    if (cohort.sequence !== index + 1) fail(`${path}.cohorts[${index}].sequence`, 'must be contiguous in registry order.')
  })
  const stateCounts = parseCountMap({
    value: row.implementationStateCounts,
    path: `${path}.implementationStateCounts`,
    allowed: ITEM_CATALOG_IMPLEMENTATION_STATES,
    requireEvery: false,
  })
  const providerCounts = parseCountMap({
    value: row.providerCounts,
    path: `${path}.providerCounts`,
    allowed: ITEM_CATALOG_PROVIDER_IDS,
    requireEvery: true,
  }) as Readonly<Record<ItemCatalogProviderId, number>>
  for (const state of ITEM_CATALOG_IMPLEMENTATION_STATES) {
    const expected = cohorts.filter(cohort => cohort.implementationState === state)
      .reduce((total, cohort) => total + cohort.memberCount, 0)
    if ((stateCounts[state] ?? 0) !== expected) {
      fail(`${path}.implementationStateCounts.${state}`, 'does not match cohort membership.')
    }
  }
  for (const provider of ITEM_CATALOG_PROVIDER_IDS) {
    const expected = cohorts.filter(cohort => cohort.providerId === provider)
      .reduce((total, cohort) => total + cohort.memberCount, 0)
    if (providerCounts[provider] !== expected) {
      fail(`${path}.providerCounts.${provider}`, 'does not match cohort membership.')
    }
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    ticket: 'P8-092',
    status: 'reviewed',
    catalogSha256: sha256(row.catalogSha256, `${path}.catalogSha256`),
    policySha256: sha256(row.policySha256, `${path}.policySha256`),
    runtimeProseParsing: false,
    cohortMemberLimit,
    cohortCount,
    itemCount,
    implementationStateCounts: stateCounts,
    providerCounts,
    registrySha256: sha256(row.registrySha256, `${path}.registrySha256`),
    cohorts,
  })
}
