import { isSlug } from '../paths'
import {
  parseBreedingAdjudicationIdSyntax,
  parseBreedingCheckRecordIdSyntax,
  parseBreedingConsentIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingReadSetIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonEggIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
  type BreedingOperationId,
  type BreedingReadSetId,
} from './ids'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  breedingConflictScopeKey,
  parseBreedingConflictScopeV1,
  type BreedingConflictScopeV1,
  type BreedingOperationCommandKind,
} from './operations'

export const BREEDING_READ_SET_SCHEMA_VERSION = 1 as const
export const BREEDING_REFERENCE_SOURCE_IDS = Object.freeze([
  'abilities', 'capabilities', 'conditions', 'edges', 'features', 'items', 'maneuvers', 'moves',
  'poke-edges', 'pokedex', 'pokemon-experience-chart', 'rules', 'stat-rankings',
] as const)
export type BreedingReferenceSourceId = typeof BREEDING_REFERENCE_SOURCE_IDS[number]
export const BREEDING_READ_RESOURCE_KINDS = Object.freeze([
  'breeding-adjudication', 'breeding-check', 'breeding-offer', 'breeding-operation', 'breeding-project',
  'breeding-roll', 'campaign-clock', 'parent-consent', 'egg-transfer-consent', 'pokemon-egg', 'pokemon-sheet',
  'pokemon-sheet-allocation', 'species-acquisition', 'trainer-sheet',
] as const)
export type BreedingReadResourceKind = typeof BREEDING_READ_RESOURCE_KINDS[number]
export const BREEDING_READ_PURPOSES = Object.freeze([
  'authorization', 'campaign-time', 'conflict', 'consent', 'idempotency', 'mechanics', 'privacy',
  'random-input', 'reference', 'reward', 'snapshot', 'write-destination',
] as const)
export type BreedingReadPurpose = typeof BREEDING_READ_PURPOSES[number]
export const BREEDING_DEPENDENCY_PROVIDER_KINDS = Object.freeze([
  'ability', 'campaign-option', 'capability', 'edge', 'facility', 'feature', 'item', 'move', 'species-registry', 'system',
] as const)
export type BreedingDependencyProviderKind = typeof BREEDING_DEPENDENCY_PROVIDER_KINDS[number]
export const BREEDING_DEPENDENCY_SUBJECT_KINDS = Object.freeze(['campaign', 'pokemon-egg', 'pokemon-sheet', 'profile', 'project', 'trainer-sheet'] as const)
export type BreedingDependencySubjectKind = typeof BREEDING_DEPENDENCY_SUBJECT_KINDS[number]
export const BREEDING_DEPENDENCY_CHECKPOINTS = Object.freeze([
  'authorization', 'begin-hatch', 'campaign-clock-segment', 'egg-acceptance', 'hatch-transaction',
  'incubation-operation', 'inheritance-learning', 'project-check', 'project-creation', 'project-preview',
] as const)
export type BreedingDependencyCheckpoint = typeof BREEDING_DEPENDENCY_CHECKPOINTS[number]

export interface BreedingReadResourceV1 {
  readonly resourceKind: BreedingReadResourceKind
  readonly resourceId: string
  readonly existence: 'present' | 'absent'
  readonly revision: number | null
  readonly definitionSha256: string | null
  readonly observedCampaignMinute: number | null
  readonly purposes: readonly BreedingReadPurpose[]
}
export interface BreedingReferenceSourceVersionV1 { readonly sourceId: BreedingReferenceSourceId, readonly contentSha256: string }
export interface BreedingContractVersionV1 { readonly contractId: string, readonly definitionSha256: string }
export interface BreedingReferenceVersionSnapshotV1 {
  readonly schemaVersion: 1
  readonly rulesetId: string
  readonly rulesetDefinitionSha256: string
  readonly sourceManifestSha256: string
  readonly semanticRegistryDefinitionSha256: string
  readonly compiledRegistryDefinitionSha256: string
  readonly canonicalIdsDefinitionSha256: string
  readonly campaignOptionSnapshotDefinitionSha256: string
  readonly referenceSources: readonly BreedingReferenceSourceVersionV1[]
  readonly contractDefinitionHashes: readonly BreedingContractVersionV1[]
  readonly definitionSha256: string
}
export interface BreedingDependencyEvidenceV1 {
  readonly providerKind: BreedingDependencyProviderKind
  readonly providerId: string
  readonly subjectKind: BreedingDependencySubjectKind
  readonly subjectId: string
  readonly subjectRevision: number | null
  readonly checkpoint: BreedingDependencyCheckpoint
  readonly providerDefinitionSha256: string
  readonly effectiveEvidenceSha256: string
}
export interface BreedingOperationReadSetV1 {
  readonly schemaVersion: 1
  readonly readSetId: BreedingReadSetId
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly commandKind: BreedingOperationCommandKind
  readonly capturedAtCampaignMinute: number
  readonly resources: readonly BreedingReadResourceV1[]
  readonly referenceVersions: BreedingReferenceVersionSnapshotV1
  readonly dependencyEvidence: readonly BreedingDependencyEvidenceV1[]
  readonly dependencySetDefinitionSha256: string
  readonly writeExpectations: readonly BreedingConflictScopeV1[]
  readonly complete: true
  readonly definitionSha256: string
}

export type BreedingReadSetValidationCode =
  | 'breeding.read-set.invalid-document'
  | 'breeding.read-set.unknown-field'
  | 'breeding.read-set.invalid-id'
  | 'breeding.read-set.invalid-invariant'
export class BreedingReadSetValidationError extends Error {
  readonly code: BreedingReadSetValidationCode
  readonly path: string
  constructor(code: BreedingReadSetValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingReadSetValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const COMMAND_KIND_SET = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const RESOURCE_KIND_SET = new Set<string>(BREEDING_READ_RESOURCE_KINDS)
const PURPOSE_SET = new Set<string>(BREEDING_READ_PURPOSES)
const PROVIDER_KIND_SET = new Set<string>(BREEDING_DEPENDENCY_PROVIDER_KINDS)
const SUBJECT_KIND_SET = new Set<string>(BREEDING_DEPENDENCY_SUBJECT_KINDS)
const CHECKPOINT_SET = new Set<string>(BREEDING_DEPENDENCY_CHECKPOINTS)
const VERSIONED_RESOURCE_KINDS = new Set<BreedingReadResourceKind>([
  'breeding-adjudication', 'breeding-offer', 'breeding-project', 'campaign-clock', 'parent-consent',
  'egg-transfer-consent', 'pokemon-egg', 'pokemon-sheet', 'pokemon-sheet-allocation', 'trainer-sheet',
])
const REQUIRED_CONTRACT_IDS = Object.freeze([
  'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract', 'breeding-operation-contract',
  'breeding-project-contract', 'breeding-read-set-contract', 'breeding-security-policy', 'pokemon-egg-contract',
] as const)
const fail = (code: BreedingReadSetValidationCode, path: string, message: string): never => { throw new BreedingReadSetValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.read-set.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.read-set.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.read-set.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.read-set.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.read-set.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.read-set.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
  }
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.read-set.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail('breeding.read-set.invalid-document', path, 'must be a nonnegative safe integer.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.read-set.invalid-document', path, 'must be a lowercase SHA-256 value.')
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const identifier = (value: unknown, path: string): string => typeof value === 'string' && IDENTIFIER.test(value) ? value : fail('breeding.read-set.invalid-id', path, 'must be a bounded stable identifier.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160 ? value : fail('breeding.read-set.invalid-id', path, 'must be a canonical sheet slug.')
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value) }
  return value
}
const sortedUnique = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail('breeding.read-set.invalid-invariant', path, 'must be unique in strict code-point order.')
  return Object.freeze([...values])
}
const resourceKey = (resource: Pick<BreedingReadResourceV1, 'resourceKind' | 'resourceId'>): string => `${resource.resourceKind}\u0000${resource.resourceId}`
export const breedingReadResourceKey = resourceKey
export const breedingDependencyEvidenceKey = (evidence: Pick<BreedingDependencyEvidenceV1, 'checkpoint' | 'providerKind' | 'providerId' | 'subjectKind' | 'subjectId'>): string => `${evidence.checkpoint}\u0000${evidence.providerKind}\u0000${evidence.providerId}\u0000${evidence.subjectKind}\u0000${evidence.subjectId}`

const parseResourceId = (kind: BreedingReadResourceKind, value: unknown, path: string): string => {
  if (kind === 'breeding-project') return parseBreedingProjectIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding project ID.')
  if (kind === 'pokemon-egg') return parsePokemonEggIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a Pokémon Egg ID.')
  if (kind === 'parent-consent') return parseBreedingConsentIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding consent ID.')
  if (kind === 'egg-transfer-consent') return parsePokemonEggTransferConsentIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be an Egg-transfer consent ID.')
  if (kind === 'breeding-roll') return parseBreedingRollRecordIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding roll ID.')
  if (kind === 'breeding-check') return parseBreedingCheckRecordIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding check ID.')
  if (kind === 'breeding-offer') return parseBreedingOfferIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding offer ID.')
  if (kind === 'breeding-adjudication') return parseBreedingAdjudicationIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding adjudication ID.')
  if (kind === 'breeding-operation') return parseBreedingOperationIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding operation ID.')
  if (kind === 'pokemon-sheet' || kind === 'trainer-sheet') return slug(value, path)
  if (kind === 'campaign-clock') return value === 'campaign-clock' ? value : fail('breeding.read-set.invalid-id', path, 'must be campaign-clock.')
  if (kind === 'pokemon-sheet-allocation') return value === 'pokemon' ? value : fail('breeding.read-set.invalid-id', path, 'must be the pokemon allocation namespace.')
  if (kind === 'species-acquisition') {
    if (typeof value !== 'string') return fail('breeding.read-set.invalid-id', path, 'must identify trainer/species acquisition state.')
    const parts = value.split('/')
    if (parts.length !== 2) return fail('breeding.read-set.invalid-id', path, 'must identify trainer/species acquisition state.')
    return `${slug(parts[0], `${path}.trainerSheetSlug`)}/${parseBreedingSpeciesIdSyntax(parts[1]) ?? fail('breeding.read-set.invalid-id', `${path}.speciesId`, 'must be a breeding Species ID.')}`
  }
  return fail('breeding.read-set.invalid-id', path, 'has no supported resource identity.')
}
export const parseBreedingReadResourceV1 = (value: unknown, path = 'resource'): BreedingReadResourceV1 => {
  const row = exact(value, ['resourceKind', 'resourceId', 'existence', 'revision', 'definitionSha256', 'observedCampaignMinute', 'purposes'], path)
  if (typeof row.resourceKind !== 'string' || !RESOURCE_KIND_SET.has(row.resourceKind)) fail('breeding.read-set.invalid-document', `${path}.resourceKind`, 'must be a closed read resource kind.')
  const kind = row.resourceKind as BreedingReadResourceKind
  if (row.existence !== 'present' && row.existence !== 'absent') fail('breeding.read-set.invalid-document', `${path}.existence`, 'must be present or absent.')
  const revision = row.revision === null ? null : integer(row.revision, `${path}.revision`)
  const definitionSha256 = nullableHash(row.definitionSha256, `${path}.definitionSha256`)
  const observedCampaignMinute = row.observedCampaignMinute === null ? null : integer(row.observedCampaignMinute, `${path}.observedCampaignMinute`)
  if ((kind === 'campaign-clock' && row.existence === 'present') !== (observedCampaignMinute !== null)) fail('breeding.read-set.invalid-invariant', `${path}.observedCampaignMinute`, 'is required only for the present campaign clock resource.')
  if (row.existence === 'absent' && (revision !== null || definitionSha256 !== null)) fail('breeding.read-set.invalid-invariant', path, 'absent resource cannot carry a revision or definition hash.')
  if (row.existence === 'present' && (definitionSha256 === null || (VERSIONED_RESOURCE_KINDS.has(kind) ? revision === null : revision !== null))) fail('breeding.read-set.invalid-invariant', path, 'present resource must carry its declared version shape and definition hash.')
  const purposes = array(row.purposes, `${path}.purposes`, BREEDING_READ_PURPOSES.length).map((entry, index) => typeof entry === 'string' && PURPOSE_SET.has(entry) ? entry as BreedingReadPurpose : fail('breeding.read-set.invalid-document', `${path}.purposes[${index}]`, 'must be a closed read purpose.'))
  if (purposes.length < 1) fail('breeding.read-set.invalid-invariant', `${path}.purposes`, 'cannot be empty.')
  return freeze({ resourceKind: kind, resourceId: parseResourceId(kind, row.resourceId, `${path}.resourceId`), existence: row.existence, revision, definitionSha256, observedCampaignMinute, purposes: sortedUnique(purposes, `${path}.purposes`) }) as BreedingReadResourceV1
}
const parseReferenceSource = (value: unknown, path: string): BreedingReferenceSourceVersionV1 => {
  const row = exact(value, ['sourceId', 'contentSha256'], path)
  if (typeof row.sourceId !== 'string' || !BREEDING_REFERENCE_SOURCE_IDS.includes(row.sourceId as BreedingReferenceSourceId)) fail('breeding.read-set.invalid-id', `${path}.sourceId`, 'must be an app-owned authoritative reference source ID.')
  return freeze({ sourceId: row.sourceId as BreedingReferenceSourceId, contentSha256: hash(row.contentSha256, `${path}.contentSha256`) })
}
const parseContractVersion = (value: unknown, path: string): BreedingContractVersionV1 => {
  const row = exact(value, ['contractId', 'definitionSha256'], path)
  return freeze({ contractId: identifier(row.contractId, `${path}.contractId`), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
export const parseBreedingReferenceVersionSnapshotV1 = (value: unknown, path = 'referenceVersions'): BreedingReferenceVersionSnapshotV1 => {
  const row = exact(value, ['schemaVersion', 'rulesetId', 'rulesetDefinitionSha256', 'sourceManifestSha256', 'semanticRegistryDefinitionSha256', 'compiledRegistryDefinitionSha256', 'canonicalIdsDefinitionSha256', 'campaignOptionSnapshotDefinitionSha256', 'referenceSources', 'contractDefinitionHashes', 'definitionSha256'], path)
  if (row.schemaVersion !== 1) fail('breeding.read-set.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  const sources = array(row.referenceSources, `${path}.referenceSources`, BREEDING_REFERENCE_SOURCE_IDS.length).map((entry, index) => parseReferenceSource(entry, `${path}.referenceSources[${index}]`))
  if (sources.length !== BREEDING_REFERENCE_SOURCE_IDS.length || sources.some((entry, index) => entry.sourceId !== BREEDING_REFERENCE_SOURCE_IDS[index])) fail('breeding.read-set.invalid-invariant', `${path}.referenceSources`, 'must contain every app-owned reference source exactly once in canonical order.')
  const contracts = array(row.contractDefinitionHashes, `${path}.contractDefinitionHashes`, 32).map((entry, index) => parseContractVersion(entry, `${path}.contractDefinitionHashes[${index}]`))
  if (contracts.length < REQUIRED_CONTRACT_IDS.length) fail('breeding.read-set.invalid-invariant', `${path}.contractDefinitionHashes`, 'must bind all required breeding contracts.')
  sortedUnique(contracts.map(entry => entry.contractId), `${path}.contractDefinitionHashes`)
  const contractIds = new Set(contracts.map(entry => entry.contractId))
  if (REQUIRED_CONTRACT_IDS.some(id => !contractIds.has(id))) fail('breeding.read-set.invalid-invariant', `${path}.contractDefinitionHashes`, 'is missing a required breeding contract.')
  return freeze({ schemaVersion: 1, rulesetId: identifier(row.rulesetId, `${path}.rulesetId`), rulesetDefinitionSha256: hash(row.rulesetDefinitionSha256, `${path}.rulesetDefinitionSha256`), sourceManifestSha256: hash(row.sourceManifestSha256, `${path}.sourceManifestSha256`), semanticRegistryDefinitionSha256: hash(row.semanticRegistryDefinitionSha256, `${path}.semanticRegistryDefinitionSha256`), compiledRegistryDefinitionSha256: hash(row.compiledRegistryDefinitionSha256, `${path}.compiledRegistryDefinitionSha256`), canonicalIdsDefinitionSha256: hash(row.canonicalIdsDefinitionSha256, `${path}.canonicalIdsDefinitionSha256`), campaignOptionSnapshotDefinitionSha256: hash(row.campaignOptionSnapshotDefinitionSha256, `${path}.campaignOptionSnapshotDefinitionSha256`), referenceSources: Object.freeze(sources), contractDefinitionHashes: Object.freeze(contracts), definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
const parseSubjectId = (kind: BreedingDependencySubjectKind, value: unknown, path: string): string => {
  if (kind === 'campaign') return value === 'campaign' ? value : fail('breeding.read-set.invalid-id', path, 'must be campaign.')
  if (kind === 'project') return parseBreedingProjectIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a breeding project ID.')
  if (kind === 'pokemon-egg') return parsePokemonEggIdSyntax(value) ?? fail('breeding.read-set.invalid-id', path, 'must be a Pokémon Egg ID.')
  if (kind === 'pokemon-sheet' || kind === 'trainer-sheet') return slug(value, path)
  return identifier(value, path)
}
export const parseBreedingDependencyEvidenceV1 = (value: unknown, path = 'dependencyEvidence'): BreedingDependencyEvidenceV1 => {
  const row = exact(value, ['providerKind', 'providerId', 'subjectKind', 'subjectId', 'subjectRevision', 'checkpoint', 'providerDefinitionSha256', 'effectiveEvidenceSha256'], path)
  if (typeof row.providerKind !== 'string' || !PROVIDER_KIND_SET.has(row.providerKind)) fail('breeding.read-set.invalid-document', `${path}.providerKind`, 'must be a closed provider kind.')
  if (typeof row.subjectKind !== 'string' || !SUBJECT_KIND_SET.has(row.subjectKind)) fail('breeding.read-set.invalid-document', `${path}.subjectKind`, 'must be a closed dependency subject kind.')
  if (typeof row.checkpoint !== 'string' || !CHECKPOINT_SET.has(row.checkpoint)) fail('breeding.read-set.invalid-document', `${path}.checkpoint`, 'must be a closed dependency checkpoint.')
  const subjectKind = row.subjectKind as BreedingDependencySubjectKind
  const subjectRevision = row.subjectRevision === null ? null : integer(row.subjectRevision, `${path}.subjectRevision`)
  const needsRevision = subjectKind === 'project' || subjectKind === 'pokemon-egg' || subjectKind === 'pokemon-sheet' || subjectKind === 'trainer-sheet'
  if (needsRevision !== (subjectRevision !== null)) fail('breeding.read-set.invalid-invariant', `${path}.subjectRevision`, 'must match whether the dependency subject is revisioned.')
  return freeze({ providerKind: row.providerKind as BreedingDependencyProviderKind, providerId: identifier(row.providerId, `${path}.providerId`), subjectKind, subjectId: parseSubjectId(subjectKind, row.subjectId, `${path}.subjectId`), subjectRevision, checkpoint: row.checkpoint as BreedingDependencyCheckpoint, providerDefinitionSha256: hash(row.providerDefinitionSha256, `${path}.providerDefinitionSha256`), effectiveEvidenceSha256: hash(row.effectiveEvidenceSha256, `${path}.effectiveEvidenceSha256`) })
}
export const parseBreedingOperationReadSetV1 = (value: unknown, path = 'readSet'): BreedingOperationReadSetV1 => {
  const row = exact(value, ['schemaVersion', 'readSetId', 'operationId', 'commandSha256', 'commandKind', 'capturedAtCampaignMinute', 'resources', 'referenceVersions', 'dependencyEvidence', 'dependencySetDefinitionSha256', 'writeExpectations', 'complete', 'definitionSha256'], path)
  if (row.schemaVersion !== 1 || row.complete !== true) fail('breeding.read-set.invalid-document', path, 'must be a complete schema v1 read set.')
  if (typeof row.commandKind !== 'string' || !COMMAND_KIND_SET.has(row.commandKind)) fail('breeding.read-set.invalid-document', `${path}.commandKind`, 'must be a breeding command kind.')
  const resources = array(row.resources, `${path}.resources`, 256).map((entry, index) => parseBreedingReadResourceV1(entry, `${path}.resources[${index}]`))
  if (resources.length < 1) fail('breeding.read-set.invalid-invariant', `${path}.resources`, 'must include at least the campaign clock read.')
  sortedUnique(resources.map(resourceKey), `${path}.resources`)
  const dependencies = array(row.dependencyEvidence, `${path}.dependencyEvidence`, 256).map((entry, index) => parseBreedingDependencyEvidenceV1(entry, `${path}.dependencyEvidence[${index}]`))
  sortedUnique(dependencies.map(breedingDependencyEvidenceKey), `${path}.dependencyEvidence`)
  const expectations = array(row.writeExpectations, `${path}.writeExpectations`, 128).map((entry, index) => parseBreedingConflictScopeV1(entry, `${path}.writeExpectations[${index}]`))
  sortedUnique(expectations.map(breedingConflictScopeKey), `${path}.writeExpectations`)
  return freeze({ schemaVersion: 1, readSetId: parseBreedingReadSetIdSyntax(row.readSetId) ?? fail('breeding.read-set.invalid-id', `${path}.readSetId`, 'must be a breeding read-set ID.'), operationId: parseBreedingOperationIdSyntax(row.operationId) ?? fail('breeding.read-set.invalid-id', `${path}.operationId`, 'must be a breeding operation ID.'), commandSha256: hash(row.commandSha256, `${path}.commandSha256`), commandKind: row.commandKind as BreedingOperationCommandKind, capturedAtCampaignMinute: integer(row.capturedAtCampaignMinute, `${path}.capturedAtCampaignMinute`), resources: Object.freeze(resources), referenceVersions: parseBreedingReferenceVersionSnapshotV1(row.referenceVersions, `${path}.referenceVersions`), dependencyEvidence: Object.freeze(dependencies), dependencySetDefinitionSha256: hash(row.dependencySetDefinitionSha256, `${path}.dependencySetDefinitionSha256`), writeExpectations: Object.freeze(expectations), complete: true, definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`) })
}
