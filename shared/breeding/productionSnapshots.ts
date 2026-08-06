import {
  parseBreedingCheckRecordIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingCheckRecordId,
  type BreedingOperationId,
  type BreedingProjectId,
} from './ids'
import {
  parseBreederSnapshotV1,
  parseBreedingParentSnapshotV1,
  type BreederSnapshotV1,
  type BreedingParentSnapshotV1,
} from './egg'
import {
  BREEDING_DEPENDENCY_CHECKPOINTS,
  BREEDING_DEPENDENCY_PROVIDER_KINDS,
  BREEDING_DEPENDENCY_SUBJECT_KINDS,
  parseBreedingReferenceVersionSnapshotV1,
  type BreedingDependencyCheckpoint,
  type BreedingDependencyProviderKind,
  type BreedingDependencySubjectKind,
  type BreedingReferenceVersionSnapshotV1,
} from './readSets'

export const BREEDING_PRODUCTION_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const BREEDING_FROZEN_CAMPAIGN_OPTIONS_SCHEMA_VERSION = 1 as const
export const BREEDING_PROVIDER_CONTRIBUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const BREEDING_PROVIDER_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const BREEDING_PRODUCTION_SNAPSHOT_PROJECTION_SCHEMA_VERSION = 1 as const

export type BreedingProviderContributionValueV1 =
  | { readonly kind: 'evidence-only' }
  | { readonly kind: 'flag', readonly enabled: true }
  | { readonly kind: 'integer', readonly value: number }
  | { readonly kind: 'ratio', readonly numerator: number, readonly denominator: number }
  | { readonly kind: 'canonical-id-set', readonly values: readonly string[] }
export interface BreedingProviderContributionSnapshotV1 {
  readonly schemaVersion: 1
  readonly inventoryEntryId: string
  readonly contributionId: string
  readonly providerKind: BreedingDependencyProviderKind
  readonly providerId: string
  readonly subjectKind: BreedingDependencySubjectKind
  readonly subjectId: string
  readonly subjectRevision: number | null
  readonly checkpoint: BreedingDependencyCheckpoint
  readonly value: BreedingProviderContributionValueV1
  readonly providerDefinitionSha256: string
  readonly effectiveEvidenceSha256: string
  readonly definitionSha256: string
}
export interface BreedingProviderSnapshotV1 {
  readonly schemaVersion: 1
  readonly checkpoint: BreedingDependencyCheckpoint
  readonly capturedAtCampaignMinute: number
  readonly contributions: readonly BreedingProviderContributionSnapshotV1[]
  readonly definitionSha256: string
}
export interface BreedingFrozenCampaignOptionEntryV1 {
  readonly optionId: string
  readonly value: string | number
}
export interface BreedingFrozenCampaignOptionSnapshotV1 {
  readonly schemaVersion: 1
  readonly rulesetDefinitionSha256: string
  readonly entries: readonly BreedingFrozenCampaignOptionEntryV1[]
  readonly sourceSnapshotDefinitionSha256: string
  readonly definitionSha256: string
}
export interface BreedingProductionSnapshotV1 {
  readonly schemaVersion: 1
  readonly checkpoint: 'egg-acceptance'
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly projectDefinitionSha256: string
  readonly checkRecordId: BreedingCheckRecordId
  readonly checkDefinitionSha256: string
  readonly readSetDefinitionSha256: string
  readonly authorizationReceiptDefinitionSha256: string
  readonly capturedAtCampaignMinute: number
  readonly parents: readonly [BreedingParentSnapshotV1, BreedingParentSnapshotV1]
  readonly breeder: BreederSnapshotV1
  readonly providerSnapshot: BreedingProviderSnapshotV1
  readonly referenceSnapshot: BreedingReferenceVersionSnapshotV1
  readonly campaignOptionSnapshot: BreedingFrozenCampaignOptionSnapshotV1
  readonly acceptedDefinitionHashes: readonly string[]
  readonly definitionSha256: string
}
export interface BreedingProductionSnapshotProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'frozen'
  readonly checkpoint: 'egg-acceptance'
  readonly capturedAtCampaignMinute: number
  readonly snapshotKinds: readonly ['breeder', 'campaign-options', 'parents', 'providers', 'references']
}

export type BreedingProductionSnapshotValidationCode =
  | 'breeding.production-snapshot.invalid-document'
  | 'breeding.production-snapshot.unknown-field'
  | 'breeding.production-snapshot.invalid-id'
  | 'breeding.production-snapshot.invalid-invariant'
export class BreedingProductionSnapshotValidationError extends Error {
  readonly code: BreedingProductionSnapshotValidationCode
  readonly path: string
  constructor(code: BreedingProductionSnapshotValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProductionSnapshotValidationError'
    this.code = code
    this.path = path
  }
}
type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,200}$/u
const PROVIDER_KINDS = new Set<string>(BREEDING_DEPENDENCY_PROVIDER_KINDS)
const SUBJECT_KINDS = new Set<string>(BREEDING_DEPENDENCY_SUBJECT_KINDS)
const CHECKPOINTS = new Set<string>(BREEDING_DEPENDENCY_CHECKPOINTS)
const fail = (code: BreedingProductionSnapshotValidationCode, path: string, message: string): never => {
  throw new BreedingProductionSnapshotValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.production-snapshot.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.production-snapshot.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.production-snapshot.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.production-snapshot.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.production-snapshot.invalid-document', path, `must be a plain non-enriched array of at most ${maximum} entries.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.production-snapshot.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('breeding.production-snapshot.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.production-snapshot.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value)
  ? value
  : fail('breeding.production-snapshot.invalid-id', path, 'must be a bounded stable identifier.')
const safeText = (value: unknown, path: string): string => typeof value === 'string' && value.trim() === value && SAFE_TEXT.test(value)
  ? value
  : fail('breeding.production-snapshot.invalid-id', path, 'must be bounded trimmed control-free text.')
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      fail('breeding.production-snapshot.invalid-invariant', path, 'must be unique in strict code-point order.')
    }
  }
  return Object.freeze([...values])
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const contributionValue = (value: unknown, path: string): BreedingProviderContributionValueV1 => {
  const row = record(value, path)
  if (row.kind === 'evidence-only') {
    exact(row, ['kind'], path)
    return Object.freeze({ kind: 'evidence-only' })
  }
  if (row.kind === 'flag') {
    const parsed = exact(row, ['kind', 'enabled'], path)
    if (parsed.enabled !== true) fail('breeding.production-snapshot.invalid-invariant', `${path}.enabled`, 'an effective flag contribution must equal true.')
    return Object.freeze({ kind: 'flag', enabled: true })
  }
  if (row.kind === 'integer') {
    const parsed = exact(row, ['kind', 'value'], path)
    return Object.freeze({ kind: 'integer', value: integer(parsed.value, `${path}.value`, -1_000_000, 1_000_000) })
  }
  if (row.kind === 'ratio') {
    const parsed = exact(row, ['kind', 'numerator', 'denominator'], path)
    return Object.freeze({
      kind: 'ratio',
      numerator: integer(parsed.numerator, `${path}.numerator`, 1, 1_000_000),
      denominator: integer(parsed.denominator, `${path}.denominator`, 1, 1_000_000),
    })
  }
  if (row.kind === 'canonical-id-set') {
    const parsed = exact(row, ['kind', 'values'], path)
    const values = array(parsed.values, `${path}.values`, 64).map((entry, index) => identifier(entry, `${path}.values[${index}]`))
    if (values.length < 1) fail('breeding.production-snapshot.invalid-invariant', `${path}.values`, 'cannot be empty.')
    return Object.freeze({ kind: 'canonical-id-set', values: sortedUnique(values, `${path}.values`) })
  }
  return fail('breeding.production-snapshot.invalid-document', `${path}.kind`, 'must be a closed contribution value kind.')
}
export const breedingProviderContributionSnapshotKey = (value: Pick<BreedingProviderContributionSnapshotV1, 'providerKind' | 'providerId' | 'subjectKind' | 'subjectId' | 'contributionId'>): string => (
  `${value.providerKind}\u0000${value.providerId}\u0000${value.subjectKind}\u0000${value.subjectId}\u0000${value.contributionId}`
)
export const parseBreedingProviderContributionSnapshotV1 = (
  value: unknown,
  path = 'breedingProviderContributionSnapshot',
): BreedingProviderContributionSnapshotV1 => {
  const row = exact(value, [
    'schemaVersion', 'inventoryEntryId', 'contributionId', 'providerKind', 'providerId',
    'subjectKind', 'subjectId', 'subjectRevision', 'checkpoint', 'value',
    'providerDefinitionSha256', 'effectiveEvidenceSha256', 'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || typeof row.providerKind !== 'string' || !PROVIDER_KINDS.has(row.providerKind)
    || typeof row.subjectKind !== 'string' || !SUBJECT_KINDS.has(row.subjectKind)
    || typeof row.checkpoint !== 'string' || !CHECKPOINTS.has(row.checkpoint)) {
    fail('breeding.production-snapshot.invalid-document', path, 'must use schema v1 closed provider, subject, and checkpoint kinds.')
  }
  const subjectRevision = row.subjectRevision === null ? null
    : integer(row.subjectRevision, `${path}.subjectRevision`, 0, 2_147_483_647)
  const revisioned = row.subjectKind === 'project' || row.subjectKind === 'pokemon-egg'
    || row.subjectKind === 'pokemon-sheet' || row.subjectKind === 'trainer-sheet'
  if (revisioned !== (subjectRevision !== null)) {
    fail('breeding.production-snapshot.invalid-invariant', `${path}.subjectRevision`, 'must match whether the subject is revisioned.')
  }
  return freeze({
    schemaVersion: 1,
    inventoryEntryId: safeText(row.inventoryEntryId, `${path}.inventoryEntryId`),
    contributionId: identifier(row.contributionId, `${path}.contributionId`),
    providerKind: row.providerKind as BreedingDependencyProviderKind,
    providerId: identifier(row.providerId, `${path}.providerId`),
    subjectKind: row.subjectKind as BreedingDependencySubjectKind,
    subjectId: identifier(row.subjectId, `${path}.subjectId`),
    subjectRevision,
    checkpoint: row.checkpoint as BreedingDependencyCheckpoint,
    value: contributionValue(row.value, `${path}.value`),
    providerDefinitionSha256: hash(row.providerDefinitionSha256, `${path}.providerDefinitionSha256`),
    effectiveEvidenceSha256: hash(row.effectiveEvidenceSha256, `${path}.effectiveEvidenceSha256`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
export const parseBreedingProviderSnapshotV1 = (
  value: unknown,
  path = 'breedingProviderSnapshot',
): BreedingProviderSnapshotV1 => {
  const row = exact(value, ['schemaVersion', 'checkpoint', 'capturedAtCampaignMinute', 'contributions', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || typeof row.checkpoint !== 'string' || !CHECKPOINTS.has(row.checkpoint)) {
    fail('breeding.production-snapshot.invalid-document', path, 'must use one schema v1 dependency checkpoint.')
  }
  const contributions = array(row.contributions, `${path}.contributions`, 256)
    .map((entry, index) => parseBreedingProviderContributionSnapshotV1(entry, `${path}.contributions[${index}]`))
  if (contributions.some(entry => entry.checkpoint !== row.checkpoint)) {
    fail('breeding.production-snapshot.invalid-invariant', `${path}.contributions`, 'must all belong to the snapshot checkpoint.')
  }
  sortedUnique(contributions.map(breedingProviderContributionSnapshotKey), `${path}.contributions`)
  return freeze({
    schemaVersion: 1,
    checkpoint: row.checkpoint as BreedingDependencyCheckpoint,
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    contributions: Object.freeze(contributions),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
const optionEntry = (value: unknown, path: string): BreedingFrozenCampaignOptionEntryV1 => {
  const row = exact(value, ['optionId', 'value'], path)
  if (typeof row.value !== 'string' && !Number.isSafeInteger(row.value)) {
    fail('breeding.production-snapshot.invalid-document', `${path}.value`, 'must be one bounded option string or integer.')
  }
  if (typeof row.value === 'string' && (!IDENTIFIER.test(row.value) || row.value.length > 160)) {
    fail('breeding.production-snapshot.invalid-id', `${path}.value`, 'must be a bounded canonical option value.')
  }
  return Object.freeze({ optionId: identifier(row.optionId, `${path}.optionId`), value: row.value as string | number })
}
export const parseBreedingFrozenCampaignOptionSnapshotV1 = (
  value: unknown,
  path = 'breedingFrozenCampaignOptionSnapshot',
): BreedingFrozenCampaignOptionSnapshotV1 => {
  const row = exact(value, ['schemaVersion', 'rulesetDefinitionSha256', 'entries', 'sourceSnapshotDefinitionSha256', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.production-snapshot.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  const entries = array(row.entries, `${path}.entries`, 64).map((entry, index) => optionEntry(entry, `${path}.entries[${index}]`))
  if (entries.length < 1) fail('breeding.production-snapshot.invalid-invariant', `${path}.entries`, 'cannot be empty.')
  sortedUnique(entries.map(entry => entry.optionId), `${path}.entries`)
  return freeze({
    schemaVersion: 1,
    rulesetDefinitionSha256: hash(row.rulesetDefinitionSha256, `${path}.rulesetDefinitionSha256`),
    entries: Object.freeze(entries),
    sourceSnapshotDefinitionSha256: hash(row.sourceSnapshotDefinitionSha256, `${path}.sourceSnapshotDefinitionSha256`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
export const parseBreedingProductionSnapshotV1 = (
  value: unknown,
  path = 'breedingProductionSnapshot',
): BreedingProductionSnapshotV1 => {
  const row = exact(value, [
    'schemaVersion', 'checkpoint', 'operationId', 'commandSha256', 'projectId', 'projectRevision',
    'projectDefinitionSha256', 'checkRecordId', 'checkDefinitionSha256', 'readSetDefinitionSha256',
    'authorizationReceiptDefinitionSha256', 'capturedAtCampaignMinute', 'parents', 'breeder',
    'providerSnapshot', 'referenceSnapshot', 'campaignOptionSnapshot', 'acceptedDefinitionHashes',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || row.checkpoint !== 'egg-acceptance') {
    fail('breeding.production-snapshot.invalid-document', path, 'must be the schema-v1 Egg-acceptance snapshot.')
  }
  const parents = array(row.parents, `${path}.parents`, 2).map((entry, index) => parseBreedingParentSnapshotV1(entry, `${path}.parents[${index}]`))
  const breeder = parseBreederSnapshotV1(row.breeder, `${path}.breeder`)
  if (parents.length !== 2 || parents[0]!.parentIndex !== 0 || parents[1]!.parentIndex !== 1) {
    fail('breeding.production-snapshot.invalid-invariant', path, 'must retain ordered two-parent snapshots.')
  }
  if (breeder === null) {
    fail('breeding.production-snapshot.invalid-invariant', path, 'must retain one Breeder snapshot.')
  }
  const acceptedDefinitionHashes = array(row.acceptedDefinitionHashes, `${path}.acceptedDefinitionHashes`, 256)
    .map((entry, index) => hash(entry, `${path}.acceptedDefinitionHashes[${index}]`))
  if (acceptedDefinitionHashes.length < 1) fail('breeding.production-snapshot.invalid-invariant', `${path}.acceptedDefinitionHashes`, 'cannot be empty.')
  sortedUnique(acceptedDefinitionHashes, `${path}.acceptedDefinitionHashes`)
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
    ?? fail('breeding.production-snapshot.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.')
  const projectId = parseBreedingProjectIdSyntax(row.projectId)
    ?? fail('breeding.production-snapshot.invalid-id', `${path}.projectId`, 'must be a Breeding Project ID.')
  const checkRecordId = parseBreedingCheckRecordIdSyntax(row.checkRecordId)
    ?? fail('breeding.production-snapshot.invalid-id', `${path}.checkRecordId`, 'must be a Breeding check record ID.')
  return freeze({
    schemaVersion: 1,
    checkpoint: 'egg-acceptance',
    operationId,
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    projectId,
    projectRevision: integer(row.projectRevision, `${path}.projectRevision`, 0, 2_147_483_647),
    projectDefinitionSha256: hash(row.projectDefinitionSha256, `${path}.projectDefinitionSha256`),
    checkRecordId,
    checkDefinitionSha256: hash(row.checkDefinitionSha256, `${path}.checkDefinitionSha256`),
    readSetDefinitionSha256: hash(row.readSetDefinitionSha256, `${path}.readSetDefinitionSha256`),
    authorizationReceiptDefinitionSha256: hash(row.authorizationReceiptDefinitionSha256, `${path}.authorizationReceiptDefinitionSha256`),
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    parents: Object.freeze(parents) as unknown as readonly [BreedingParentSnapshotV1, BreedingParentSnapshotV1],
    breeder: breeder as BreederSnapshotV1,
    providerSnapshot: parseBreedingProviderSnapshotV1(row.providerSnapshot, `${path}.providerSnapshot`),
    referenceSnapshot: parseBreedingReferenceVersionSnapshotV1(row.referenceSnapshot, `${path}.referenceSnapshot`),
    campaignOptionSnapshot: parseBreedingFrozenCampaignOptionSnapshotV1(row.campaignOptionSnapshot, `${path}.campaignOptionSnapshot`),
    acceptedDefinitionHashes: Object.freeze(acceptedDefinitionHashes),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  })
}
export const parseBreedingProductionSnapshotProjectionV1 = (
  value: unknown,
  path = 'breedingProductionSnapshotProjection',
): BreedingProductionSnapshotProjectionV1 => {
  const row = exact(value, ['schemaVersion', 'audience', 'status', 'checkpoint', 'capturedAtCampaignMinute', 'snapshotKinds'], path)
  const expected = ['breeder', 'campaign-options', 'parents', 'providers', 'references']
  const kinds = array(row.snapshotKinds, `${path}.snapshotKinds`, 5)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || row.status !== 'frozen' || row.checkpoint !== 'egg-acceptance'
    || kinds.length !== expected.length || kinds.some((entry, index) => entry !== expected[index])) {
    fail('breeding.production-snapshot.invalid-invariant', path, 'must be the bounded frozen snapshot summary.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience as 'gm' | 'owner',
    status: 'frozen',
    checkpoint: 'egg-acceptance',
    capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`),
    snapshotKinds: Object.freeze(expected) as unknown as BreedingProductionSnapshotProjectionV1['snapshotKinds'],
  })
}
