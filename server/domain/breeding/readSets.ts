import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  breedingDependencyEvidenceKey,
  breedingReadResourceKey,
  parseBreedingDependencyEvidenceV1,
  parseBreedingOperationReadSetV1,
  parseBreedingReadResourceV1,
  parseBreedingReferenceVersionSnapshotV1,
  type BreedingDependencyEvidenceV1,
  type BreedingOperationReadSetV1,
  type BreedingReadResourceKind,
  type BreedingReadResourceV1,
  type BreedingReferenceVersionSnapshotV1,
} from '#shared/breeding/readSets'
import {
  breedingConflictScopeKey,
  parseBreedingOperationCommandV1,
  type BreedingConflictScopeV1,
  type BreedingOperationCommandV1,
} from '#shared/breeding/operations'
import { createBreedingOperationCommandHash } from './operations'

export type BreedingReferenceVersionSnapshotDefinitionV1 = Omit<BreedingReferenceVersionSnapshotV1, 'definitionSha256'>
export type BreedingOperationReadSetDefinitionV1 = Omit<BreedingOperationReadSetV1, 'schemaVersion' | 'dependencySetDefinitionSha256' | 'complete' | 'definitionSha256'>
export type BreedingReadSetAuthorityErrorCode =
  | 'breeding.read-set.hash-mismatch'
  | 'breeding.read-set.command-mismatch'
  | 'breeding.read-set.incomplete'
  | 'breeding.read-set.identity-collision'
export class BreedingReadSetAuthorityError extends Error {
  readonly code: BreedingReadSetAuthorityErrorCode
  readonly path: string
  constructor(code: BreedingReadSetAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingReadSetAuthorityError'
    this.code = code
    this.path = path
  }
}
const fail = (code: BreedingReadSetAuthorityErrorCode, path: string, message: string): never => { throw new BreedingReadSetAuthorityError(code, path, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const compareCodePoint = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const referenceDefinitionSha256 = (value: BreedingReferenceVersionSnapshotV1): string => sha256(withoutHash(value))
export const breedingReferenceVersionSnapshotDefinitionSha256 = referenceDefinitionSha256
export const breedingDependencySetDefinitionSha256 = (evidence: readonly BreedingDependencyEvidenceV1[]): string => sha256(evidence)
export const breedingOperationReadSetDefinitionSha256 = (value: BreedingOperationReadSetV1): string => sha256(withoutHash(value))

export const parseAuthoritativeBreedingReferenceVersionSnapshotV1 = (value: unknown, path = 'referenceVersions'): BreedingReferenceVersionSnapshotV1 => {
  const parsed = parseBreedingReferenceVersionSnapshotV1(value, path)
  if (referenceDefinitionSha256(parsed) !== parsed.definitionSha256) fail('breeding.read-set.hash-mismatch', `${path}.definitionSha256`, 'does not match the strict reference-version snapshot.')
  return parsed
}
const validateDependencyResolverAttestation = (evidence: readonly BreedingDependencyEvidenceV1[], path: string): void => {
  const attestations = evidence.filter(entry => entry.providerKind === 'system' && entry.providerId === 'breeding-effective-dependency-set-v1' && entry.subjectKind === 'campaign' && entry.subjectId === 'campaign' && entry.subjectRevision === null && entry.checkpoint === 'authorization')
  if (attestations.length !== 1) fail('breeding.read-set.incomplete', path, 'must contain exactly one effective-dependency-set resolver attestation.')
  const resolvedEvidence = evidence.filter(entry => entry !== attestations[0])
  if (attestations[0]!.effectiveEvidenceSha256 !== sha256(resolvedEvidence)) fail('breeding.read-set.hash-mismatch', path, 'resolver attestation does not match the complete dependency evidence set.')
}
const parseDependencySet = (values: readonly unknown[], path: string): readonly BreedingDependencyEvidenceV1[] => {
  const parsed = values.map((value, index) => parseBreedingDependencyEvidenceV1(value, `${path}[${index}]`))
  for (let index = 1; index < parsed.length; index += 1) if (breedingDependencyEvidenceKey(parsed[index - 1]!) >= breedingDependencyEvidenceKey(parsed[index]!)) fail('breeding.read-set.incomplete', path, 'must be unique in canonical dependency order.')
  validateDependencyResolverAttestation(parsed, path)
  return Object.freeze(parsed)
}
export const parseAuthoritativeBreedingOperationReadSetV1 = (value: unknown, path = 'readSet'): BreedingOperationReadSetV1 => {
  const parsed = parseBreedingOperationReadSetV1(value, path)
  parseAuthoritativeBreedingReferenceVersionSnapshotV1(parsed.referenceVersions, `${path}.referenceVersions`)
  const dependencies = parseDependencySet(parsed.dependencyEvidence, `${path}.dependencyEvidence`)
  if (breedingDependencySetDefinitionSha256(dependencies) !== parsed.dependencySetDefinitionSha256) fail('breeding.read-set.hash-mismatch', `${path}.dependencySetDefinitionSha256`, 'does not match the dependency evidence set.')
  if (breedingOperationReadSetDefinitionSha256(parsed) !== parsed.definitionSha256) fail('breeding.read-set.hash-mismatch', `${path}.definitionSha256`, 'does not match the complete operation read set.')
  return parsed
}
export const createBreedingReferenceVersionSnapshotV1 = (value: BreedingReferenceVersionSnapshotDefinitionV1): BreedingReferenceVersionSnapshotV1 => {
  const { definitionSha256: _definitionSha256, ...input } = value as BreedingReferenceVersionSnapshotDefinitionV1 & { readonly definitionSha256?: unknown }
  const definition: BreedingReferenceVersionSnapshotDefinitionV1 = {
    ...input,
    referenceSources: Object.freeze([...input.referenceSources].sort((left, right) => compareCodePoint(left.sourceId, right.sourceId))),
    contractDefinitionHashes: Object.freeze([...input.contractDefinitionHashes].sort((left, right) => compareCodePoint(left.contractId, right.contractId))),
  }
  return parseAuthoritativeBreedingReferenceVersionSnapshotV1({ ...definition, definitionSha256: sha256(definition) })
}
export const createBreedingOperationReadSetV1 = (value: BreedingOperationReadSetDefinitionV1): BreedingOperationReadSetV1 => {
  const { schemaVersion: _schemaVersion, dependencySetDefinitionSha256: _dependencySetDefinitionSha256, complete: _complete, definitionSha256: _definitionSha256, ...input } = value as BreedingOperationReadSetDefinitionV1 & Partial<Pick<BreedingOperationReadSetV1, 'schemaVersion' | 'dependencySetDefinitionSha256' | 'complete' | 'definitionSha256'>>
  const resources = Object.freeze([...input.resources].sort((left, right) => compareCodePoint(breedingReadResourceKey(left), breedingReadResourceKey(right))))
  const dependencyEvidence = Object.freeze([...input.dependencyEvidence].sort((left, right) => compareCodePoint(breedingDependencyEvidenceKey(left), breedingDependencyEvidenceKey(right))))
  const writeExpectations = Object.freeze([...input.writeExpectations].sort((left, right) => compareCodePoint(breedingConflictScopeKey(left), breedingConflictScopeKey(right))))
  const definition = {
    schemaVersion: 1 as const,
    ...input,
    resources,
    referenceVersions: parseAuthoritativeBreedingReferenceVersionSnapshotV1(input.referenceVersions),
    dependencyEvidence,
    dependencySetDefinitionSha256: breedingDependencySetDefinitionSha256(dependencyEvidence),
    writeExpectations,
    complete: true as const,
  }
  return parseAuthoritativeBreedingOperationReadSetV1({ ...definition, definitionSha256: sha256(definition) })
}

const resource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceKind, id: string): BreedingReadResourceV1 | undefined => readSet.resources.find(entry => entry.resourceKind === kind && entry.resourceId === id)
const requireResource = (readSet: BreedingOperationReadSetV1, requirement: {
  readonly kind: BreedingReadResourceKind
  readonly id: string
  readonly existence?: 'present' | 'absent'
  readonly revision?: number
  readonly purpose: BreedingReadResourceV1['purposes'][number]
}, path: string): BreedingReadResourceV1 => {
  const found = resource(readSet, requirement.kind, requirement.id)
  if (!found || (requirement.existence !== undefined && found.existence !== requirement.existence)
    || (requirement.revision !== undefined && found.revision !== requirement.revision) || !found.purposes.includes(requirement.purpose)) {
    fail('breeding.read-set.incomplete', path, `must include ${requirement.existence ?? 'current'} ${requirement.kind}:${requirement.id} for ${requirement.purpose}.`)
  }
  return found
}
const scopeResourceRequirement = (scope: BreedingConflictScopeV1): { kind: BreedingReadResourceKind, id: string, existence?: 'present' | 'absent', revision?: number } => {
  if (scope.kind === 'campaign-clock') return { kind: 'campaign-clock', id: 'campaign-clock', existence: 'present', revision: scope.expectedRevision }
  if (scope.kind === 'breeding-project') return { kind: 'breeding-project', id: scope.projectId, existence: scope.expectedRevision === null ? 'absent' : 'present', revision: scope.expectedRevision ?? undefined }
  if (scope.kind === 'pokemon-egg') return { kind: 'pokemon-egg', id: scope.eggId, existence: scope.expectedRevision === null ? 'absent' : 'present', revision: scope.expectedRevision ?? undefined }
  if (scope.kind === 'parent-consent') return { kind: 'parent-consent', id: scope.consentId, existence: scope.expectedRevision === null ? 'absent' : 'present', revision: scope.expectedRevision ?? undefined }
  if (scope.kind === 'trainer-sheet') return { kind: 'trainer-sheet', id: scope.sheetSlug, existence: 'present', revision: scope.expectedRevision }
  if (scope.kind === 'pokemon-sheet') return { kind: 'pokemon-sheet', id: scope.sheetSlug, existence: 'present', revision: scope.expectedRevision }
  if (scope.kind === 'pokemon-sheet-allocation') return { kind: 'pokemon-sheet-allocation', id: 'pokemon', existence: 'present' }
  if (scope.kind === 'species-acquisition') return { kind: 'species-acquisition', id: `${scope.trainerSheetSlug}/${scope.speciesId}` }
  if (scope.kind === 'egg-transfer-consent') return { kind: 'egg-transfer-consent', id: scope.consentId, existence: 'present', revision: scope.expectedRevision }
  return { kind: 'breeding-operation', id: scope.targetOperationId, existence: 'present' }
}
const revisionFromScope = (command: BreedingOperationCommandV1, kind: 'breeding-project' | 'pokemon-egg' | 'parent-consent' | 'egg-transfer-consent', id: string): number | undefined => {
  const scope = command.scopes.find(entry => entry.kind === kind && (kind === 'breeding-project' ? entry.kind === 'breeding-project' && entry.projectId === id : kind === 'pokemon-egg' ? entry.kind === 'pokemon-egg' && entry.eggId === id : kind === 'parent-consent' ? entry.kind === 'parent-consent' && entry.consentId === id : entry.kind === 'egg-transfer-consent' && entry.consentId === id))
  if (!scope || !('expectedRevision' in scope) || scope.expectedRevision === null) return undefined
  return scope.expectedRevision
}
const requireProject = (readSet: BreedingOperationReadSetV1, command: BreedingOperationCommandV1, projectId: string): void => { requireResource(readSet, { kind: 'breeding-project', id: projectId, existence: 'present', revision: revisionFromScope(command, 'breeding-project', projectId), purpose: 'mechanics' }, 'readSet.resources') }
const requireEgg = (readSet: BreedingOperationReadSetV1, command: BreedingOperationCommandV1, eggId: string): void => { requireResource(readSet, { kind: 'pokemon-egg', id: eggId, existence: 'present', revision: revisionFromScope(command, 'pokemon-egg', eggId), purpose: 'mechanics' }, 'readSet.resources') }
const validateCommandPayloadReads = (command: BreedingOperationCommandV1, readSet: BreedingOperationReadSetV1): void => {
  const payload = command.payload as any
  if (command.commandKind === 'preview-breeding' || command.commandKind === 'create-breeding-project') {
    requireResource(readSet, { kind: 'trainer-sheet', id: payload.ownerTrainerSlug, existence: 'present', purpose: 'authorization' }, 'readSet.resources')
    requireResource(readSet, { kind: 'trainer-sheet', id: payload.breederTrainerSlug, existence: 'present', purpose: 'mechanics' }, 'readSet.resources')
    for (const parent of payload.parentRefs as readonly { pokemonSheetSlug: string, expectedSheetRevision: number }[]) requireResource(readSet, { kind: 'pokemon-sheet', id: parent.pokemonSheetSlug, existence: 'present', revision: parent.expectedSheetRevision, purpose: 'snapshot' }, 'readSet.resources')
    if (readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256 !== payload.optionSnapshotDefinitionSha256) fail('breeding.read-set.command-mismatch', 'readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256', 'must match the command option snapshot.')
    if (command.commandKind === 'create-breeding-project') requireResource(readSet, { kind: 'breeding-project', id: payload.projectId, existence: 'absent', purpose: 'conflict' }, 'readSet.resources')
    return
  }
  if (command.commandKind === 'grant-breeding-consent') {
    requireProject(readSet, command, payload.projectId)
    requireResource(readSet, { kind: 'pokemon-sheet', id: payload.parentSheetSlug, existence: 'present', revision: payload.parentSheetRevision, purpose: 'consent' }, 'readSet.resources')
    requireResource(readSet, { kind: 'parent-consent', id: payload.consentId, existence: 'absent', purpose: 'conflict' }, 'readSet.resources')
    return
  }
  if (command.commandKind === 'revoke-breeding-consent') {
    requireProject(readSet, command, payload.projectId)
    requireResource(readSet, { kind: 'parent-consent', id: payload.consentId, existence: 'present', revision: revisionFromScope(command, 'parent-consent', payload.consentId), purpose: 'consent' }, 'readSet.resources')
    return
  }
  if (['advance-breeding-project-time', 'resolve-breeding-check', 'cancel-breeding-project'].includes(command.commandKind)) {
    requireProject(readSet, command, payload.projectId)
    if (command.commandKind === 'resolve-breeding-check') requireResource(readSet, { kind: 'breeding-check', id: payload.checkRecordId, existence: 'absent', purpose: 'conflict' }, 'readSet.resources')
    return
  }
  if (command.commandKind === 'produce-egg') {
    requireProject(readSet, command, payload.projectId)
    requireResource(readSet, { kind: 'pokemon-egg', id: payload.eggId, existence: 'absent', purpose: 'conflict' }, 'readSet.resources')
    return
  }
  if (command.commandKind === 'create-source-egg') {
    requireResource(readSet, { kind: 'pokemon-egg', id: payload.eggId, existence: 'absent', purpose: 'conflict' }, 'readSet.resources')
    requireResource(readSet, { kind: 'trainer-sheet', id: payload.ownerTrainerSlug, existence: 'present', purpose: 'authorization' }, 'readSet.resources')
    return
  }
  if (['transfer-egg', 'advance-egg-incubation', 'set-egg-incubation-pause', 'apply-egg-warmer-capability', 'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special', 'complete-hatch', 'cancel-egg'].includes(command.commandKind)) requireEgg(readSet, command, payload.eggId)
  if (command.commandKind === 'apply-egg-warmer-capability') requireResource(readSet, { kind: 'pokemon-sheet', id: payload.sourcePokemonSheetSlug, existence: 'present', revision: payload.expectedSourcePokemonSheetRevision, purpose: 'mechanics' }, 'readSet.resources')
  if (command.commandKind === 'transfer-egg') {
    requireResource(readSet, { kind: 'trainer-sheet', id: payload.destinationTrainerSlug, existence: 'present', purpose: 'write-destination' }, 'readSet.resources')
    for (const consentId of payload.consentEvidenceIds as readonly string[]) {
      requireResource(readSet, { kind: 'egg-transfer-consent', id: consentId, existence: 'present', revision: revisionFromScope(command, 'egg-transfer-consent', consentId), purpose: 'consent' }, 'readSet.resources')
    }
  }
  if (command.commandKind === 'begin-hatch' || command.commandKind === 'complete-hatch') requireResource(readSet, { kind: 'trainer-sheet', id: payload.destination.trainerSheetSlug, existence: 'present', purpose: 'write-destination' }, 'readSet.resources')
  if (command.commandKind === 'complete-hatch') requireResource(readSet, { kind: 'pokemon-sheet-allocation', id: 'pokemon', existence: 'present', purpose: 'write-destination' }, 'readSet.resources')
  if (command.commandKind === 'record-inheritance-learning') {
    requireResource(readSet, { kind: 'pokemon-egg', id: payload.eggId, existence: 'present', purpose: 'snapshot' }, 'readSet.resources')
    requireResource(readSet, { kind: 'pokemon-sheet', id: payload.childSheetSlug, existence: 'present', purpose: 'mechanics' }, 'readSet.resources')
  }
  if (command.commandKind === 'recover-breeding-operation') requireResource(readSet, { kind: 'breeding-operation', id: payload.targetOperationId, existence: 'present', purpose: 'idempotency' }, 'readSet.resources')
}
/** A persisted operation/read-set identity permits exact replay only; stale evidence is never rewritten in place. */
export const assertBreedingOperationReadSetExactReplay = (existingValue: unknown, attemptedValue: unknown): BreedingOperationReadSetV1 => {
  const existing = parseAuthoritativeBreedingOperationReadSetV1(existingValue, 'existingReadSet')
  const attempted = parseAuthoritativeBreedingOperationReadSetV1(attemptedValue, 'attemptedReadSet')
  if (existing.readSetId !== attempted.readSetId || existing.operationId !== attempted.operationId || !same(existing, attempted)) fail('breeding.read-set.identity-collision', 'readSet', 'operation read-set identity is already bound to different evidence.')
  return existing
}
export const validateBreedingOperationReadSetCardinality = (values: readonly unknown[]): readonly BreedingOperationReadSetV1[] => {
  if (!Array.isArray(values) || values.length > 1) fail('breeding.read-set.identity-collision', 'readSets', 'an operation may persist exactly zero or one immutable read set.')
  return Object.freeze(values.map((value, index) => parseAuthoritativeBreedingOperationReadSetV1(value, `readSets[${index}]`)))
}

export const validateBreedingOperationReadSetCompleteness = (commandValue: unknown, readSetValue: unknown): BreedingOperationReadSetV1 => {
  const command = parseBreedingOperationCommandV1(commandValue)
  const readSet = parseAuthoritativeBreedingOperationReadSetV1(readSetValue)
  const commandHash = createBreedingOperationCommandHash(command)
  if (readSet.operationId !== command.operationId || readSet.commandKind !== command.commandKind || readSet.commandSha256 !== commandHash) fail('breeding.read-set.command-mismatch', 'readSet', 'must bind the exact full command envelope.')
  if (readSet.referenceVersions.rulesetId !== command.ruleset.rulesetId || readSet.referenceVersions.rulesetDefinitionSha256 !== command.ruleset.definitionSha256) fail('breeding.read-set.command-mismatch', 'readSet.referenceVersions', 'must bind the command ruleset exactly.')
  if (!same(readSet.writeExpectations, command.scopes)) fail('breeding.read-set.command-mismatch', 'readSet.writeExpectations', 'must equal every declared write expectation.')
  const clock = requireResource(readSet, { kind: 'campaign-clock', id: 'campaign-clock', existence: 'present', purpose: 'campaign-time' }, 'readSet.resources')
  if (clock.observedCampaignMinute !== readSet.capturedAtCampaignMinute) fail('breeding.read-set.incomplete', 'readSet.capturedAtCampaignMinute', 'must equal the observed campaign clock minute.')
  for (const scope of command.scopes) {
    const requirement = scopeResourceRequirement(scope)
    requireResource(readSet, { ...requirement, purpose: 'conflict' }, 'readSet.resources')
  }
  const payload = command.payload as any
  if (command.commandKind === 'advance-breeding-project-time' || command.commandKind === 'advance-egg-incubation') {
    if (clock.revision !== payload.throughClockRevision || clock.observedCampaignMinute !== payload.throughCampaignMinute) fail('breeding.read-set.command-mismatch', 'readSet.resources', 'campaign-clock read must match the requested through checkpoint.')
  }
  validateCommandPayloadReads(command, readSet)
  return readSet
}

export const BREEDING_READ_SET_STALE_REASON_IDS = Object.freeze([
  'breeding.read-set.resource-created', 'breeding.read-set.resource-deleted', 'breeding.read-set.revision-changed',
  'breeding.read-set.definition-changed', 'breeding.read-set.reference-changed', 'breeding.read-set.dependency-changed',
] as const)
export type BreedingReadSetStaleReasonId = typeof BREEDING_READ_SET_STALE_REASON_IDS[number]
export interface BreedingReadSetStaleReasonV1 { readonly reasonId: BreedingReadSetStaleReasonId, readonly resourceKey: string | null }
export type BreedingReadSetFreshnessResultV1 = { readonly ok: true } | { readonly ok: false, readonly reasons: readonly BreedingReadSetStaleReasonV1[] }
export const validateBreedingOperationReadSetFreshness = (readSetValue: unknown, current: {
  readonly resources: readonly unknown[]
  readonly referenceVersions: unknown
  readonly dependencyEvidence: readonly unknown[]
}): BreedingReadSetFreshnessResultV1 => {
  const readSet = parseAuthoritativeBreedingOperationReadSetV1(readSetValue)
  const currentResources = current.resources.map((value, index) => parseBreedingReadResourceV1(value, `current.resources[${index}]`)).sort((left, right) => compareCodePoint(breedingReadResourceKey(left), breedingReadResourceKey(right)))
  for (let index = 1; index < currentResources.length; index += 1) if (breedingReadResourceKey(currentResources[index - 1]!) === breedingReadResourceKey(currentResources[index]!)) fail('breeding.read-set.incomplete', 'current.resources', 'cannot contain duplicate resource identities.')
  const currentMap = new Map(currentResources.map(entry => [breedingReadResourceKey(entry), entry]))
  const reasons: BreedingReadSetStaleReasonV1[] = []
  for (const expected of readSet.resources) {
    const key = breedingReadResourceKey(expected)
    const actual = currentMap.get(key)
    if (!actual) { reasons.push({ reasonId: expected.existence === 'absent' ? 'breeding.read-set.resource-created' : 'breeding.read-set.resource-deleted', resourceKey: key }); continue }
    if (expected.existence !== actual.existence) { reasons.push({ reasonId: actual.existence === 'present' ? 'breeding.read-set.resource-created' : 'breeding.read-set.resource-deleted', resourceKey: key }); continue }
    if (expected.revision !== actual.revision) reasons.push({ reasonId: 'breeding.read-set.revision-changed', resourceKey: key })
    else if (expected.definitionSha256 !== actual.definitionSha256 || expected.observedCampaignMinute !== actual.observedCampaignMinute) reasons.push({ reasonId: 'breeding.read-set.definition-changed', resourceKey: key })
  }
  const referenceVersions = parseAuthoritativeBreedingReferenceVersionSnapshotV1(current.referenceVersions, 'current.referenceVersions')
  if (referenceVersions.definitionSha256 !== readSet.referenceVersions.definitionSha256) reasons.push({ reasonId: 'breeding.read-set.reference-changed', resourceKey: null })
  const dependencies = parseDependencySet(current.dependencyEvidence, 'current.dependencyEvidence')
  if (breedingDependencySetDefinitionSha256(dependencies) !== readSet.dependencySetDefinitionSha256) reasons.push({ reasonId: 'breeding.read-set.dependency-changed', resourceKey: null })
  reasons.sort((left, right) => compareCodePoint(`${left.reasonId}\u0000${left.resourceKey ?? ''}`, `${right.reasonId}\u0000${right.resourceKey ?? ''}`))
  return reasons.length === 0 ? Object.freeze({ ok: true }) : Object.freeze({ ok: false, reasons: Object.freeze(reasons.map(reason => Object.freeze(reason))) })
}
