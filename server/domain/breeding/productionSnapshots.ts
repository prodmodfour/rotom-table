import { createHash } from 'node:crypto'
import canonicalIdsJson from '../../../data/breeding-automation/canonical-ids.json'
import modifierInventoryJson from '../../../data/breeding-automation/modifier-inventory.json'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import semanticRegistryJson from '../../../data/breeding-automation/semantic-registry.json'
import sourceManifestJson from '../../../data/breeding-automation/source-manifest.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingAuthorizationReceiptV1,
  BreedingBreederAuthorityEvidenceV1,
  BreedingCrossOwnerConsentEvidenceV1,
} from '#shared/breeding/authorization'
import type { BreederSnapshotV1, BreedingParentSnapshotV1, PokemonEggKnownMoveEvidenceV1 } from '#shared/breeding/egg'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingProjectDocumentV1 } from '#shared/breeding/project'
import {
  breedingProviderContributionSnapshotKey,
  parseBreedingFrozenCampaignOptionSnapshotV1,
  parseBreedingProductionSnapshotProjectionV1,
  parseBreedingProductionSnapshotV1,
  parseBreedingProviderContributionSnapshotV1,
  parseBreedingProviderSnapshotV1,
  type BreedingFrozenCampaignOptionSnapshotV1,
  type BreedingProductionSnapshotProjectionV1,
  type BreedingProductionSnapshotV1,
  type BreedingProviderContributionSnapshotV1,
  type BreedingProviderSnapshotV1,
} from '#shared/breeding/productionSnapshots'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingBreederAuthorityEvidenceV1,
  parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1,
} from './authorization'
import { parseBreedingCampaignOptionSnapshotV1, type BreedingCampaignOptionSnapshotV1 } from './campaignOptions'
import {
  BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
  evaluateBreedingCompatibility,
  type BreedingParentRoleOverride,
} from './compatibility'
import { parseAuthoritativeBreedingCheckRecordV1 } from './ledgers'
import {
  parseAuthoritativeBreederSnapshotV1,
  parseAuthoritativeBreedingParentSnapshotV1,
} from './lineage'
import { createBreedingOperationCommandHash } from './operations'
import { breedingProjectDocumentDefinitionSha256 } from './projectInitialProgress'
import { parseBreedingProjectDocumentV1 } from '#shared/breeding/project'
import { compiledBreedingSpeciesSpec, COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from './registry'
import {
  parseAuthoritativeBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
} from './readSets'

interface ModifierInventoryEntry {
  readonly id: string
  readonly sourceKind: string
  readonly contributionIds: readonly string[]
  readonly snapshotCheckpoint: string
}
const inventoryEntries = (modifierInventoryJson.definition.entries as readonly ModifierInventoryEntry[])
const inventoryById = new Map(inventoryEntries.map(entry => [entry.id, entry]))
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-provider-snapshot-v1' as const,
  sourceInventoryDefinitionSha256: modifierInventoryJson.definitionSha256,
  authority: 'effective-provider-dependencies-and-authorized-typed-values' as const,
  unknownContribution: 'fail-closed' as const,
})
export const BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION_SHA256 = sha256(BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION)
export const BREEDING_PROVIDER_SNAPSHOT_DEPENDENCY_PROVIDER_ID = 'breeding-provider-snapshot-v1' as const
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _hash, ...definition } = value
  return definition
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export type BreedingProductionSnapshotAuthorityErrorCode =
  | 'breeding.production-snapshot.hash-mismatch'
  | 'breeding.production-snapshot.invalid-authority'
  | 'breeding.production-snapshot.stale-authority'
  | 'breeding.production-snapshot.unavailable'
  | 'breeding.production-snapshot.wrong-command'
export class BreedingProductionSnapshotAuthorityError extends Error {
  readonly code: BreedingProductionSnapshotAuthorityErrorCode
  constructor(code: BreedingProductionSnapshotAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingProductionSnapshotAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingProductionSnapshotAuthorityErrorCode, message: string): never => {
  throw new BreedingProductionSnapshotAuthorityError(code, message)
}
const authoritativeHash = <Value extends { readonly definitionSha256: string }>(value: Value, label: string): Value => {
  if (sha256(withoutHash(value)) !== value.definitionSha256) {
    return fail('breeding.production-snapshot.hash-mismatch', `${label} definition hash does not match its exact frozen data.`)
  }
  return value
}
const sourceKindToProviderKind: Readonly<Record<string, BreedingProviderContributionSnapshotV1['providerKind'] | null>> = Object.freeze({
  'trainer-edge': 'edge',
  'poke-edge': 'edge',
  feature: 'feature',
  item: 'item',
  ability: 'ability',
  capability: 'capability',
  rule: 'system',
  facility: 'facility',
})
const inventoryCheckpointToRuntime = (checkpoint: string): BreedingProviderContributionSnapshotV1['checkpoint'] | null => {
  if (checkpoint === 'post-hatch-operation') return 'inheritance-learning'
  return ['project-creation', 'egg-acceptance', 'begin-hatch', 'hatch-transaction', 'campaign-clock-segment', 'incubation-operation']
    .includes(checkpoint)
    ? checkpoint as BreedingProviderContributionSnapshotV1['checkpoint']
    : null
}
export type BreedingProviderContributionSnapshotDefinitionV1 = Omit<BreedingProviderContributionSnapshotV1, 'schemaVersion' | 'definitionSha256'>
export const parseAuthoritativeBreedingProviderContributionSnapshotV1 = (
  value: unknown,
  path = 'providerContribution',
): BreedingProviderContributionSnapshotV1 => {
  const contribution = authoritativeHash(parseBreedingProviderContributionSnapshotV1(value, path), path)
  const inventory = inventoryById.get(contribution.inventoryEntryId)
  if (!inventory || sourceKindToProviderKind[inventory.sourceKind] !== contribution.providerKind
    || !inventory.contributionIds.includes(contribution.contributionId)
    || inventoryCheckpointToRuntime(inventory.snapshotCheckpoint) !== contribution.checkpoint) {
    return fail('breeding.production-snapshot.invalid-authority', `${path} is not a reviewed modifier-inventory contribution at this checkpoint.`)
  }
  return contribution
}
export const createBreedingProviderContributionSnapshotV1 = (
  value: BreedingProviderContributionSnapshotDefinitionV1,
): BreedingProviderContributionSnapshotV1 => {
  const definition = Object.freeze({ schemaVersion: 1 as const, ...value })
  return parseAuthoritativeBreedingProviderContributionSnapshotV1({ ...definition, definitionSha256: sha256(definition) })
}
export const parseAuthoritativeBreedingProviderSnapshotV1 = (
  value: unknown,
  path = 'providerSnapshot',
): BreedingProviderSnapshotV1 => {
  const snapshot = authoritativeHash(parseBreedingProviderSnapshotV1(value, path), path)
  for (let index = 0; index < snapshot.contributions.length; index += 1) {
    parseAuthoritativeBreedingProviderContributionSnapshotV1(snapshot.contributions[index], `${path}.contributions[${index}]`)
  }
  return snapshot
}
export const createBreedingProviderSnapshotV1 = (input: {
  readonly checkpoint: BreedingProviderSnapshotV1['checkpoint']
  readonly capturedAtCampaignMinute: number
  readonly contributions: readonly BreedingProviderContributionSnapshotV1[]
}): BreedingProviderSnapshotV1 => {
  const contributions = [...input.contributions]
    .map((entry, index) => parseAuthoritativeBreedingProviderContributionSnapshotV1(entry, `contributions[${index}]`))
    .sort((left, right) => compare(breedingProviderContributionSnapshotKey(left), breedingProviderContributionSnapshotKey(right)))
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    checkpoint: input.checkpoint,
    capturedAtCampaignMinute: input.capturedAtCampaignMinute,
    contributions: Object.freeze(contributions),
  })
  return parseAuthoritativeBreedingProviderSnapshotV1({ ...definition, definitionSha256: sha256(definition) })
}
export const parseAuthoritativeBreedingFrozenCampaignOptionSnapshotV1 = (
  value: unknown,
  path = 'campaignOptionSnapshot',
): BreedingFrozenCampaignOptionSnapshotV1 => authoritativeHash(
  parseBreedingFrozenCampaignOptionSnapshotV1(value, path),
  path,
)
export const createBreedingFrozenCampaignOptionSnapshotV1 = (
  value: unknown,
): BreedingFrozenCampaignOptionSnapshotV1 => {
  const source = parseBreedingCampaignOptionSnapshotV1(value)
  const entries = Object.entries(source.values)
    .map(([optionId, optionValue]) => Object.freeze({ optionId, value: optionValue }))
    .sort((left, right) => compare(left.optionId, right.optionId))
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    rulesetDefinitionSha256: source.rulesetDefinitionSha256,
    entries: Object.freeze(entries),
    sourceSnapshotDefinitionSha256: source.definitionSha256,
  })
  return parseAuthoritativeBreedingFrozenCampaignOptionSnapshotV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}
const acceptedHashesFor = (snapshot: Omit<BreedingProductionSnapshotV1, 'acceptedDefinitionHashes' | 'definitionSha256'>): readonly string[] => Object.freeze([
  snapshot.projectDefinitionSha256,
  snapshot.checkDefinitionSha256,
  snapshot.breeder.definitionSha256,
  snapshot.providerSnapshot.definitionSha256,
  snapshot.referenceSnapshot.definitionSha256,
  snapshot.referenceSnapshot.rulesetDefinitionSha256,
  snapshot.referenceSnapshot.compiledRegistryDefinitionSha256,
  snapshot.campaignOptionSnapshot.definitionSha256,
  snapshot.campaignOptionSnapshot.sourceSnapshotDefinitionSha256,
  ...snapshot.parents.flatMap(parent => [
    parent.definitionSha256,
    parent.speciesSpecDefinitionSha256,
    parent.effectiveMoveSnapshotDefinitionSha256,
  ]),
].filter((value, index, values) => values.indexOf(value) === index).sort(compare))
export const parseAuthoritativeBreedingProductionSnapshotV1 = (
  value: unknown,
  path = 'productionSnapshot',
): BreedingProductionSnapshotV1 => {
  const snapshot = authoritativeHash(parseBreedingProductionSnapshotV1(value, path), path)
  snapshot.parents.forEach((parent, index) => parseAuthoritativeBreedingParentSnapshotV1(parent, `${path}.parents[${index}]`))
  parseAuthoritativeBreederSnapshotV1(snapshot.breeder, `${path}.breeder`)
  parseAuthoritativeBreedingProviderSnapshotV1(snapshot.providerSnapshot, `${path}.providerSnapshot`)
  parseAuthoritativeBreedingReferenceVersionSnapshotV1(snapshot.referenceSnapshot, `${path}.referenceSnapshot`)
  parseAuthoritativeBreedingFrozenCampaignOptionSnapshotV1(snapshot.campaignOptionSnapshot, `${path}.campaignOptionSnapshot`)
  if (!same(snapshot.acceptedDefinitionHashes, acceptedHashesFor(snapshot))) {
    return fail('breeding.production-snapshot.hash-mismatch', 'Accepted definition hashes must equal every frozen Project, check, parent, Breeder, provider, reference, registry, ruleset, and option definition.')
  }
  return snapshot
}
const resource = (
  readSet: BreedingOperationReadSetV1,
  kind: BreedingReadResourceV1['resourceKind'],
  id: string,
): BreedingReadResourceV1 | null => readSet.resources.find(entry => entry.resourceKind === kind && entry.resourceId === id) ?? null
const presentResource = (input: {
  readonly readSet: BreedingOperationReadSetV1
  readonly kind: BreedingReadResourceV1['resourceKind']
  readonly id: string
  readonly revision: number | null
  readonly definitionSha256: string
  readonly purpose: BreedingReadResourceV1['purposes'][number]
}): boolean => {
  const found = resource(input.readSet, input.kind, input.id)
  return found?.existence === 'present' && found.revision === input.revision
    && found.definitionSha256 === input.definitionSha256 && found.purposes.includes(input.purpose)
}
const expectedReferenceSourceHashes = new Map((sourceManifestJson.runtimeSources as readonly { readonly path: string, readonly sha256: string }[])
  .map(entry => [entry.path.split('/').at(-1)!.replace('pokemonExperienceChart', 'pokemon-experience-chart').replace(/\.json$/u, ''), entry.sha256]))
const currentReferences = (reference: BreedingOperationReadSetV1['referenceVersions']): boolean => {
  if (reference.rulesetId !== rulesetId || reference.rulesetDefinitionSha256 !== rulesetDefinitionSha256
    || reference.sourceManifestSha256 !== canonicalIdsJson.sourceManifestSha256
    || reference.semanticRegistryDefinitionSha256 !== semanticRegistryJson.definitionSha256
    || reference.compiledRegistryDefinitionSha256 !== COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256
    || reference.canonicalIdsDefinitionSha256 !== canonicalIdsJson.definitionSha256) return false
  return reference.referenceSources.every(entry => expectedReferenceSourceHashes.get(entry.sourceId) === entry.contentSha256)
}
const rulesetId = 'ptu-1.05-breeding-v1'
const rulesetDefinitionSha256 = canonicalIdsJson.rulesetDefinitionSha256
const checkedProviderSnapshot = (input: {
  readonly snapshot: BreedingProviderSnapshotV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
}): BreedingProviderSnapshotV1 => {
  const snapshot = parseAuthoritativeBreedingProviderSnapshotV1(input.snapshot)
  if (snapshot.checkpoint !== 'egg-acceptance' || snapshot.capturedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute) {
    return fail('breeding.production-snapshot.stale-authority', 'Provider snapshot must be captured at this exact Egg-acceptance campaign checkpoint.')
  }
  const snapshotDependency = input.readSet.dependencyEvidence.find(entry => entry.providerKind === 'system'
    && entry.providerId === BREEDING_PROVIDER_SNAPSHOT_DEPENDENCY_PROVIDER_ID
    && entry.subjectKind === 'project' && entry.subjectId === input.readSet.writeExpectations
      .find(scope => scope.kind === 'breeding-project')?.projectId
    && entry.subjectRevision === input.readSet.writeExpectations
      .find(scope => scope.kind === 'breeding-project')?.expectedRevision
    && entry.checkpoint === 'egg-acceptance'
    && entry.providerDefinitionSha256 === BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION_SHA256
    && entry.effectiveEvidenceSha256 === snapshot.definitionSha256)
  if (!snapshotDependency || !input.receipt.evidenceDefinitionHashes.includes(snapshot.definitionSha256)) {
    return fail('breeding.production-snapshot.invalid-authority', 'The complete provider snapshot must be attested by one exact Project dependency and authorization-receipt hash.')
  }
  for (const contribution of snapshot.contributions) {
    const dependency = input.readSet.dependencyEvidence.find(entry => entry.providerKind === contribution.providerKind
      && entry.providerId === contribution.providerId && entry.subjectKind === contribution.subjectKind
      && entry.subjectId === contribution.subjectId && entry.subjectRevision === contribution.subjectRevision
      && entry.checkpoint === contribution.checkpoint
      && entry.providerDefinitionSha256 === contribution.providerDefinitionSha256
      && entry.effectiveEvidenceSha256 === contribution.effectiveEvidenceSha256)
    if (!dependency || !input.receipt.evidenceDefinitionHashes.includes(contribution.definitionSha256)) {
      return fail('breeding.production-snapshot.invalid-authority', 'Every frozen provider value must match one exact effective dependency and authorization-receipt evidence hash.')
    }
  }
  return snapshot
}
const knownMoveEvidenceCurrent = (input: {
  readonly evidence: PokemonEggKnownMoveEvidenceV1
  readonly parent: BreedingParentSnapshotV1
  readonly provider: BreedingProviderSnapshotV1
  readonly readSet: BreedingOperationReadSetV1
}): boolean => {
  if (input.evidence.sourceKind === 'sheet-known-move') {
    return input.evidence.sourceDefinitionSha256 === input.parent.sourceSheetSha256
  }
  return input.provider.contributions.some(contribution => contribution.definitionSha256 === input.evidence.sourceDefinitionSha256
    || contribution.effectiveEvidenceSha256 === input.evidence.sourceDefinitionSha256)
    || input.readSet.dependencyEvidence.some(dependency => dependency.effectiveEvidenceSha256 === input.evidence.sourceDefinitionSha256
      || dependency.providerDefinitionSha256 === input.evidence.sourceDefinitionSha256)
}
const validateParentSnapshots = (input: {
  readonly parents: readonly [BreedingParentSnapshotV1, BreedingParentSnapshotV1]
  readonly project: BreedingProjectDocumentV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly provider: BreedingProviderSnapshotV1
  readonly options: BreedingCampaignOptionSnapshotV1
  readonly roleOverride: BreedingParentRoleOverride | null
  readonly roleOverrideEvidenceDefinitionSha256: string | null
}): readonly [BreedingParentSnapshotV1, BreedingParentSnapshotV1] => {
  const parents = input.parents.map((value, index) => parseAuthoritativeBreedingParentSnapshotV1(value, `parents[${index}]`)) as [BreedingParentSnapshotV1, BreedingParentSnapshotV1]
  for (let index = 0; index < 2; index += 1) {
    const parent = parents[index]!
    const expected = input.project.parentRefs[index]!
    const spec = compiledBreedingSpeciesSpec(parent.speciesId)
    if (parent.parentIndex !== index || parent.pokemonSheetSlug !== expected.pokemonSheetSlug
      || parent.ownerTrainerSlug !== expected.ownerTrainerSlug || parent.sheetRevision !== expected.expectedSheetRevision
      || parent.capturedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute
      || !presentResource({ readSet: input.readSet, kind: 'pokemon-sheet', id: parent.pokemonSheetSlug,
        revision: parent.sheetRevision, definitionSha256: parent.sourceSheetSha256, purpose: 'snapshot' })
      || !spec || parent.familyRootSpeciesId !== spec.familyRootSpeciesId
      || parent.speciesSpecDefinitionSha256 !== spec.definitionSha256
      || !same(parent.eggGroupIds, spec.eggGroupIds)
      || !input.receipt.evidenceDefinitionHashes.includes(parent.controlEvidenceDefinitionSha256)
      || parent.effectiveKnownMoves.some(move => move.evidence.some(evidence => !knownMoveEvidenceCurrent({
        evidence, parent, provider: input.provider, readSet: input.readSet,
      })))) {
      return fail('breeding.production-snapshot.stale-authority', 'Parent snapshots must match the exact Project order, sheet revisions, compiled specs, effective Moves, control evidence, and Egg-acceptance read set.')
    }
    if (input.options.values['breeding.maturity-policy'] === 'minimum-level') {
      if (parent.maturity.policyId !== 'minimum-level'
        || parent.maturity.minimumLevel !== input.options.values['breeding.minimum-maturity-level']
        || parent.maturity.gmConfirmed !== null || !parent.maturity.eligible
        || parent.maturity.evidenceDefinitionSha256 !== input.options.definitionSha256) {
        return fail('breeding.production-snapshot.unavailable', 'Minimum-Level maturity must be frozen from the exact campaign-option snapshot.')
      }
    }
    else if (parent.maturity.policyId !== 'gm-confirmed-per-parent' || parent.maturity.gmConfirmed !== true
      || !parent.maturity.eligible
      || !input.receipt.evidenceDefinitionHashes.includes(parent.maturity.evidenceDefinitionSha256)) {
      return fail('breeding.production-snapshot.unavailable', 'GM-confirmed maturity requires one positive current evidence hash per parent.')
    }
  }
  const compatibility = evaluateBreedingCompatibility({
    parents: parents.map(parent => ({
      parentRef: parent.pokemonSheetSlug,
      speciesId: parent.speciesId,
      genderId: parent.genderId,
      level: parent.level,
      eggGroupIds: parent.eggGroupIds,
      gmMaturityConfirmed: parent.maturity.policyId === 'gm-confirmed-per-parent' && parent.maturity.gmConfirmed === true,
    })) as never,
    options: input.options,
    roleOverride: input.roleOverride,
  })
  if (compatibility.status !== 'compatible') {
    return fail('breeding.production-snapshot.unavailable', 'Current parent snapshots are not compatible under the frozen campaign options.')
  }
  for (let index = 0; index < 2; index += 1) {
    const assignment = compatibility.parentRoles[index]
    const expectedEvidence = assignment.assignmentKind === 'gm-override'
      ? input.roleOverrideEvidenceDefinitionSha256
      : BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256
    if (parents[index]!.roleId !== assignment.roleId || expectedEvidence === null
      || parents[index]!.roleEvidenceDefinitionSha256 !== expectedEvidence
      || (assignment.assignmentKind === 'gm-override'
        && !input.receipt.evidenceDefinitionHashes.includes(expectedEvidence))) {
      return fail('breeding.production-snapshot.stale-authority', 'Parent roles must equal the current bounded compatibility result and its exact evidence.')
    }
  }
  return Object.freeze(parents)
}
const validateBreederSnapshot = (input: {
  readonly breeder: BreederSnapshotV1
  readonly authority: BreedingBreederAuthorityEvidenceV1
  readonly project: BreedingProjectDocumentV1
  readonly readSet: BreedingOperationReadSetV1
  readonly receipt: BreedingAuthorizationReceiptV1
  readonly provider: BreedingProviderSnapshotV1
}): BreederSnapshotV1 => {
  const breeder = parseAuthoritativeBreederSnapshotV1(input.breeder)
  const authority = parseAuthoritativeBreedingBreederAuthorityEvidenceV1(input.authority)
  const edge = input.readSet.dependencyEvidence.find(entry => entry.providerKind === 'edge'
    && entry.providerId === 'Breeder' && entry.subjectKind === 'trainer-sheet'
    && entry.subjectId === authority.breederTrainerSlug
    && entry.subjectRevision === authority.breederTrainerRevision
    && entry.providerDefinitionSha256 === authority.edgeRecordSha256
    && entry.effectiveEvidenceSha256 === authority.effectiveEdgeProjectionSha256)
  if (authority.breederTrainerSlug !== input.project.breederTrainerSlug
    || authority.evaluatedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute
    || !input.receipt.evidenceDefinitionHashes.includes(authority.definitionSha256)
    || !edge || !presentResource({ readSet: input.readSet, kind: 'trainer-sheet', id: authority.breederTrainerSlug,
      revision: authority.breederTrainerRevision, definitionSha256: authority.breederTrainerDefinitionSha256, purpose: 'mechanics' })
    || breeder.trainerSheetSlug !== authority.breederTrainerSlug
    || breeder.sheetRevision !== authority.breederTrainerRevision
    || breeder.sourceSheetSha256 !== authority.breederTrainerDefinitionSha256
    || breeder.pokemonEducationRank !== authority.pokemonEducationRank
    || !same(breeder.permissionEvidenceIds, [authority.edgeInstanceId])
    || breeder.providerSnapshotDefinitionSha256 !== input.provider.definitionSha256
    || breeder.capturedAtCampaignMinute !== input.readSet.capturedAtCampaignMinute) {
    return fail('breeding.production-snapshot.stale-authority', 'Breeder snapshot must match the current effective Breeder Edge, Trainer revision, rank, provider snapshot, read set, and receipt.')
  }
  return breeder
}
export interface CreateBreedingProductionSnapshotInputV1 {
  readonly project: unknown
  readonly check: unknown
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly campaignOptionSnapshot: unknown
  readonly parents: readonly [BreedingParentSnapshotV1, BreedingParentSnapshotV1]
  readonly breeder: BreederSnapshotV1
  readonly breederAuthority: BreedingBreederAuthorityEvidenceV1
  readonly providerSnapshot: BreedingProviderSnapshotV1
  readonly consentEvidence: readonly BreedingCrossOwnerConsentEvidenceV1[]
  readonly roleOverride: BreedingParentRoleOverride | null
  readonly roleOverrideEvidenceDefinitionSha256: string | null
}
export const createBreedingProductionSnapshotV1 = (
  input: CreateBreedingProductionSnapshotInputV1,
): BreedingProductionSnapshotV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const check = parseAuthoritativeBreedingCheckRecordV1(input.check)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'produce-egg') {
    return fail('breeding.production-snapshot.wrong-command', 'Production snapshots require one produce-egg command.')
  }
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const options = parseBreedingCampaignOptionSnapshotV1(input.campaignOptionSnapshot)
  const commandSha256 = createBreedingOperationCommandHash(command)
  const projectScope = command.scopes.find(scope => scope.kind === 'breeding-project')
  if (project.status !== 'ready-to-produce' || projectScope?.kind !== 'breeding-project'
    || projectScope.projectId !== project.projectId || projectScope.expectedRevision !== project.revision
    || command.payload.projectId !== project.projectId
    || command.ruleset.rulesetId !== project.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== project.ruleset.definitionSha256
    || project.check?.checkRecordId !== check.checkRecordId || project.check.outcome !== 'success'
    || project.check.resolvedAtCampaignMinute !== check.resolvedAtCampaignMinute
    || check.projectId !== project.projectId || check.outcome !== 'success'
    || options.definitionSha256 !== project.projectCreationOptionSnapshotSha256
    || readSet.referenceVersions.campaignOptionSnapshotDefinitionSha256 !== options.definitionSha256
    || !presentResource({ readSet, kind: 'breeding-project', id: project.projectId, revision: project.revision,
      definitionSha256: breedingProjectDocumentDefinitionSha256(project), purpose: 'mechanics' })
    || !presentResource({ readSet, kind: 'breeding-check', id: check.checkRecordId, revision: null,
      definitionSha256: check.definitionSha256, purpose: 'mechanics' })) {
    return fail('breeding.production-snapshot.stale-authority', 'Project, successful check, ruleset, campaign options, command scopes, and complete read set must match exactly at readiness.')
  }
  if (!receipt.authorized || receipt.reasonId !== 'breeding.authorization.authorized'
    || receipt.operationId !== command.operationId || receipt.commandSha256 !== commandSha256
    || receipt.commandKind !== command.commandKind || receipt.readSetDefinitionSha256 !== readSet.definitionSha256
    || receipt.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
    || receipt.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256) {
    return fail('breeding.production-snapshot.invalid-authority', 'Production snapshots require one exact current authorized receipt and security policy.')
  }
  const referenceSnapshot = parseAuthoritativeBreedingReferenceVersionSnapshotV1(readSet.referenceVersions)
  if (!currentReferences(referenceSnapshot)) {
    return fail('breeding.production-snapshot.stale-authority', 'Reference snapshot must match every current app-owned reference and compiled Breeding definition.')
  }
  const providerSnapshot = checkedProviderSnapshot({ snapshot: input.providerSnapshot, readSet, receipt })
  const parents = validateParentSnapshots({
    parents: input.parents,
    project,
    readSet,
    receipt,
    provider: providerSnapshot,
    options,
    roleOverride: input.roleOverride,
    roleOverrideEvidenceDefinitionSha256: input.roleOverrideEvidenceDefinitionSha256,
  })
  const breeder = validateBreederSnapshot({
    breeder: input.breeder,
    authority: input.breederAuthority,
    project,
    readSet,
    receipt,
    provider: providerSnapshot,
  })
  const crossOwnerParents = project.parentRefs.filter(parent => parent.ownerTrainerSlug !== project.ownerTrainerSlug)
  if (!Array.isArray(input.consentEvidence) || Object.getPrototypeOf(input.consentEvidence) !== Array.prototype
    || Object.getOwnPropertySymbols(input.consentEvidence).length > 0
    || Object.getOwnPropertyNames(input.consentEvidence).length !== input.consentEvidence.length + 1
    || input.consentEvidence.length !== crossOwnerParents.length) {
    return fail('breeding.production-snapshot.invalid-authority', 'Every cross-owner parent requires one exact current positive consent evidence row; GM override is not consent.')
  }
  for (let index = 0; index < crossOwnerParents.length; index += 1) {
    const parent = crossOwnerParents[index]!
    const evidence = parseAuthoritativeBreedingCrossOwnerConsentEvidenceV1(input.consentEvidence[index], `consentEvidence[${index}]`)
    const parentSnapshot = parents.find(snapshot => snapshot.pokemonSheetSlug === parent.pokemonSheetSlug)!
    if (evidence.projectId !== project.projectId || evidence.parentSheetSlug !== parent.pokemonSheetSlug
      || evidence.parentSheetRevision !== parent.expectedSheetRevision || evidence.ownerTrainerSlug !== parent.ownerTrainerSlug
      || evidence.validationOperationId !== command.operationId || evidence.validationCommandSha256 !== commandSha256
      || evidence.validatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
      || (evidence.expiresAtCampaignMinute !== null && readSet.capturedAtCampaignMinute >= evidence.expiresAtCampaignMinute)
      || parentSnapshot.controlEvidenceDefinitionSha256 !== evidence.definitionSha256
      || !receipt.evidenceDefinitionHashes.includes(evidence.definitionSha256)
      || !presentResource({ readSet, kind: 'parent-consent', id: evidence.consentId,
        revision: evidence.consentRevision, definitionSha256: evidence.consentRecordDefinitionSha256, purpose: 'consent' })) {
      return fail('breeding.production-snapshot.invalid-authority', 'Cross-owner consent must bind the exact Project, parent owner/revision, operation, strict expiry, snapshot, read set, and receipt.')
    }
  }
  const frozenOptions = createBreedingFrozenCampaignOptionSnapshotV1(options)
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    checkpoint: 'egg-acceptance' as const,
    operationId: command.operationId,
    commandSha256,
    projectId: project.projectId,
    projectRevision: project.revision,
    projectDefinitionSha256: breedingProjectDocumentDefinitionSha256(project),
    checkRecordId: check.checkRecordId,
    checkDefinitionSha256: check.definitionSha256,
    readSetDefinitionSha256: readSet.definitionSha256,
    authorizationReceiptDefinitionSha256: receipt.definitionSha256,
    capturedAtCampaignMinute: readSet.capturedAtCampaignMinute,
    parents,
    breeder,
    providerSnapshot,
    referenceSnapshot,
    campaignOptionSnapshot: frozenOptions,
  })
  const withHashes = Object.freeze({ ...definition, acceptedDefinitionHashes: acceptedHashesFor(definition) })
  return parseAuthoritativeBreedingProductionSnapshotV1({
    ...withHashes,
    definitionSha256: sha256(withHashes),
  })
}
export const projectBreedingProductionSnapshotV1 = (input: {
  readonly snapshot: unknown
  readonly audience: 'gm' | 'owner'
}): BreedingProductionSnapshotProjectionV1 => {
  const snapshot = parseAuthoritativeBreedingProductionSnapshotV1(input.snapshot)
  return parseBreedingProductionSnapshotProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    status: 'frozen',
    checkpoint: 'egg-acceptance',
    capturedAtCampaignMinute: snapshot.capturedAtCampaignMinute,
    snapshotKinds: ['breeder', 'campaign-options', 'parents', 'providers', 'references'],
  })
}

