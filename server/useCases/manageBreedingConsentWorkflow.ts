import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AuthRole } from '#shared/auth'
import type { BreedingActorAuthorityV1, BreedingTrainerControlEvidenceV1 } from '#shared/breeding/authorization'
import {
  BREEDING_CONSENT_WORKFLOW_CARD_LIMIT,
  BREEDING_CONSENT_WORKFLOW_CONSENT_DURATION,
  parseBreedingConsentWorkflowRequestV1,
  type BreedingConsentWorkflowEggTransferV1,
  type BreedingConsentWorkflowProjectRequestV1,
  type BreedingConsentWorkflowProjectionV1,
  type BreedingConsentWorkflowTransition,
} from '#shared/breeding/consentWorkflow'
import type { BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import {
  parseBreedingConsentIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingOverrideIdSyntax,
  parseBreedingReadSetIdSyntax,
  parsePokemonEggTransferConsentIdSyntax,
} from '#shared/breeding/ids'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { BREEDING_PROJECT_ACTIVE_STATUSES, parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '#shared/breeding/project'
import type { BreedingDependencyEvidenceV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { breedingDependencyEvidenceKey } from '#shared/breeding/readSets'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import {
  authorizeBreedingConsentGrantV1,
  authorizeBreedingLifecycleControlV1,
  authorizePokemonEggTransferConsentSettlementV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../domain/breeding/authorization'
import { DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT } from '../domain/breeding/campaignOptions'
import { createBreedingConsentWorkflowProjectionV1 } from '../domain/breeding/consentWorkflow'
import { createCurrentBreedingReferenceVersionSnapshotV1 } from '../domain/breeding/currentReferences'
import {
  POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
  authorizePokemonEggTransferV1,
  pokemonEggTransferConsentDefinitionSha256,
  pokemonEggTransferEffectiveEvidenceSha256,
  projectPokemonEggTransferV1,
  resolvePokemonEggTransferAgreementV1,
  settlePokemonEggTransferConsentV1,
} from '../domain/breeding/eggTransfer'
import { createBreedingConsentRecordV1, isBreedingConsentCurrentlyUsable } from '../domain/breeding/ledgers'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { validateBreedingProjectRevisionSuccessor } from '../domain/breeding/projectLifecycle'
import { createBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { breedingRealtimeRefreshAppendInputs } from '../realtime/breedingRealtime'
import { resolvePlayerProfileForPolicy } from '../policies/playerProfilePolicy'
import { createSqliteBreedingConsentRepository } from '../storage/breedingConsentRepository'
import { createSqliteBreedingOperationRepository } from '../storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqlitePokemonEggRepository } from '../storage/pokemonEggRepository'
import { createSqlitePokemonEggTransferConsentRepository } from '../storage/pokemonEggTransferConsentRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import { createBreedingTransactionCoordinator, type BreedingTransactionCoordinator } from './executeBreedingTransaction'
import { grantPokemonEggTransferConsent } from './managePokemonEggTransferConsent'
import { manageBreedingLifecycle } from './manageBreedingLifecycleRecovery'
import { transferPokemonEggOwnership } from './transferPokemonEggOwnership'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ManageBreedingConsentWorkflowError extends UseCaseHttpError<400 | 403 | 409> {}

export interface ManageBreedingConsentWorkflowInput {
  readonly role: AuthRole
  readonly playerProfile: unknown | null
  readonly request: unknown
}
export interface ManageBreedingConsentWorkflowDependencies {
  readonly database?: RotomDatabase
  readonly coordinator?: BreedingTransactionCoordinator
  readonly resolveCurrentPlayerProfile?: (profileId: string) => unknown
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
  readonly campaignProjectionKey?: Buffer | string
  readonly realtimeTimestamp?: number
}

const AUTHENTICATION_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-consent-workflow-authentication-v1' as const,
  roleSource: 'authenticated-http-role' as const,
  playerSource: 'current-selected-Profile' as const,
  gmSource: 'current-campaign-role' as const,
})
const ACTIVE_PROJECT_STATUSES = new Set<string>(BREEDING_PROJECT_ACTIVE_STATUSES)
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const AUTHENTICATION_POLICY_DEFINITION_SHA256 = sha256(AUTHENTICATION_POLICY)
const fail = (status: 400 | 403 | 409, message: string): never => {
  throw new ManageBreedingConsentWorkflowError(status, message)
}
const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.getOwnPropertyNames(value).every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function') && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)
const strictProfile = (value: unknown): PlayerProfile => {
  if (!plainRecord(value)
    || Object.keys(value).sort(compare).join('\0') !== ['displayName', 'id', 'linkedCharacters', 'schemaVersion'].sort(compare).join('\0')
    || !Array.isArray(value.linkedCharacters)
    || Object.getPrototypeOf(value.linkedCharacters) !== Array.prototype
    || value.linkedCharacters.length > 128
    || Object.getOwnPropertySymbols(value.linkedCharacters).length > 0
    || Object.getOwnPropertyNames(value.linkedCharacters).length !== value.linkedCharacters.length + 1) {
    return fail(400, 'Selected player Profile authority is malformed')
  }
  for (let index = 0; index < value.linkedCharacters.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.linkedCharacters, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor) || !plainRecord(descriptor.value)
      || Object.keys(descriptor.value).sort(compare).join('\0') !== ['sheetKind', 'sheetSlug'].sort(compare).join('\0')) {
      return fail(400, 'Selected player Profile authority is malformed')
    }
  }
  try { return normalizePlayerProfile(value) }
  catch { return fail(400, 'Selected player Profile authority is malformed') }
}
const operationId = (kind: string, material: unknown) => parseBreedingOperationIdSyntax(
  `breeding-operation:v1:${sha256({ kind, material }).slice(0, 32)}`,
) ?? fail(409, 'Consent workflow operation identity is unavailable')
const readSetId = (operation: string) => parseBreedingReadSetIdSyntax(
  `breeding-read-set:v1:${sha256({ kind: 'breeding-consent-workflow-read-set-v1', operation }).slice(0, 32)}`,
) ?? fail(409, 'Consent workflow read-set identity is unavailable')
const projectConsentId = (material: unknown) => parseBreedingConsentIdSyntax(
  `breeding-consent:v1:${sha256({ kind: 'breeding-project-consent-workflow-v1', material }).slice(0, 32)}`,
) ?? fail(409, 'Project consent identity is unavailable')
const transferConsentId = (kind: string, material: unknown) => parsePokemonEggTransferConsentIdSyntax(
  `egg-transfer-consent:v1:${sha256({ kind, material }).slice(0, 32)}`,
) ?? fail(409, 'Egg-transfer consent identity is unavailable')
const overrideId = (material: unknown) => parseBreedingOverrideIdSyntax(
  `breeding-override:v1:${sha256({ kind: 'breeding-consent-workflow-override-v1', material }).slice(0, 32)}`,
) ?? fail(409, 'Consent workflow override identity is unavailable')
const safeName = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value : ''
  return Array.from(raw.normalize('NFKC')
    .replace(/[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim() || fallback).slice(0, 120).join('').trim() || fallback
}
const trainerDocument = (value: StoredSheetDocument<Record<string, unknown>> | null, expectedSlug: string) => {
  if (!value || value.kind !== 'trainer' || value.slug !== expectedSlug || !plainRecord(value.document)
    || value.document.slug !== value.slug || value.document.revision !== value.revision
    || value.document.updatedAt !== value.updatedAt || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    return fail(409, 'Current consent Trainer authority is unavailable or malformed')
  }
  return value
}
const pokemonDocument = (value: StoredSheetDocument<Record<string, unknown>> | null, expectedSlug: string) => {
  if (!value || value.kind !== 'pokemon' || value.slug !== expectedSlug || !plainRecord(value.document)
    || value.document.slug !== value.slug || value.document.revision !== value.revision
    || value.document.updatedAt !== value.updatedAt || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    return fail(409, 'Current participating parent authority is unavailable or malformed')
  }
  return value
}
const strictRoster = (document: Record<string, unknown>): { readonly currentTeam: readonly string[], readonly boxedPokemon: readonly string[] } => {
  const parse = (field: 'currentTeam' | 'boxedPokemon'): readonly string[] => {
    const value = document[field]
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 256
      || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {
      return fail(409, 'Current Trainer roster authority is malformed')
    }
    const output = value.map((entry, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string'
        || !/^[a-z0-9-]+$/.test(descriptor.value)) return fail(409, 'Current Trainer roster authority is malformed')
      return descriptor.value
    })
    if (new Set(output).size !== output.length) return fail(409, 'Current Trainer roster authority is ambiguous')
    return Object.freeze(output)
  }
  const currentTeam = parse('currentTeam')
  const boxedPokemon = parse('boxedPokemon')
  if (currentTeam.some(slug => boxedPokemon.includes(slug))) return fail(409, 'Current Trainer roster authority is ambiguous')
  return Object.freeze({ currentTeam, boxedPokemon })
}
const actor = (input: {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly command: unknown
  readonly campaignMinute: number
}): BreedingActorAuthorityV1 => createBreedingActorAuthorityV1({
  role: input.role,
  command: input.command,
  authenticatedPrincipalSha256: sha256({
    role: input.role,
    profileId: input.profile?.id ?? null,
    authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
  }),
  authenticationPolicyDefinitionSha256: AUTHENTICATION_POLICY_DEFINITION_SHA256,
  profile: input.profile,
  evaluatedAtCampaignMinute: input.campaignMinute,
})
const control = (profile: PlayerProfile, trainer: StoredSheetDocument<Record<string, unknown>>, minute: number): BreedingTrainerControlEvidenceV1 => (
  createBreedingTrainerControlEvidenceV1({
    profile,
    trainerSheetSlug: trainer.slug,
    trainerSheetRevision: trainer.revision,
    trainerSheetDefinitionSha256: sha256(trainer.document),
    evaluatedAtCampaignMinute: minute,
  })
)
const resource = (input: {
  readonly resourceKind: BreedingReadResourceV1['resourceKind']
  readonly resourceId: string
  readonly existence: 'present' | 'absent'
  readonly revision: number | null
  readonly definitionSha256: string | null
  readonly observedCampaignMinute?: number | null
  readonly purposes: readonly BreedingReadResourceV1['purposes'][number][]
}): BreedingReadResourceV1 => ({
  ...input,
  observedCampaignMinute: input.observedCampaignMinute ?? null,
  purposes: Object.freeze([...new Set(input.purposes)].sort(compare)),
})
const clockResource = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): BreedingReadResourceV1 => resource({
  resourceKind: 'campaign-clock', resourceId: 'campaign-clock', existence: 'present', revision: clock.revision,
  definitionSha256: sha256(clock), observedCampaignMinute: clock.campaignMinute, purposes: ['campaign-time'],
})
const dependencies = (rows: readonly BreedingDependencyEvidenceV1[]): readonly BreedingDependencyEvidenceV1[] => {
  const effective = [...rows].sort((left, right) => compare(breedingDependencyEvidenceKey(left), breedingDependencyEvidenceKey(right)))
  const attestation: BreedingDependencyEvidenceV1 = {
    providerKind: 'system', providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign', subjectId: 'campaign',
    subjectRevision: null, checkpoint: 'authorization', providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha256(effective),
  }
  return Object.freeze([...effective, attestation].sort((left, right) => compare(breedingDependencyEvidenceKey(left), breedingDependencyEvidenceKey(right))))
}
const referenceVersions = () => createCurrentBreedingReferenceVersionSnapshotV1(DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT)
const projectAudienceTargets = (project: BreedingProjectDocumentV1) => {
  const participants = [...new Set(project.parentRefs.map(parent => parent.ownerTrainerSlug)
    .filter(slug => slug !== project.ownerTrainerSlug))].sort(compare)
  return Object.freeze([
    { audience: 'diagnostic' as const, trainerSheetSlug: null },
    { audience: 'gm' as const, trainerSheetSlug: null },
    { audience: 'owner' as const, trainerSheetSlug: project.ownerTrainerSlug },
    ...participants.map(trainerSheetSlug => ({ audience: 'participating-owner' as const, trainerSheetSlug })),
    { audience: 'public' as const, trainerSheetSlug: null },
  ])
}
const currentProjectStatus = (project: BreedingProjectDocumentV1): BreedingConsentWorkflowProjectRequestV1['coarseStatus'] => {
  if (!ACTIVE_PROJECT_STATUSES.has(project.status)) return 'ended'
  if (project.status === 'awaiting-parent-consent' || project.status === 'draft') return 'awaiting-consent'
  if (project.status === 'ready-to-produce') return 'ready'
  return 'in-progress'
}
const latestProjectConsent = (
  project: BreedingProjectDocumentV1,
  parentSlug: string,
  values: readonly BreedingConsentRecordV1[],
): BreedingConsentRecordV1 | null => values.filter(value => value.projectId === project.projectId
  && value.parentSheetSlug === parentSlug).sort((left, right) => right.grantedAtCampaignMinute - left.grantedAtCampaignMinute
    || compare(right.consentId, left.consentId))[0] ?? null
const projectConsentStatus = (
  record: BreedingConsentRecordV1 | null,
  current: boolean,
  minute: number,
): BreedingConsentWorkflowProjectRequestV1['consent']['status'] => {
  if (!current) return 'stale'
  if (!record) return 'waiting'
  if (record.status === 'active') return record.expiresAtCampaignMinute !== null && minute >= record.expiresAtCampaignMinute ? 'expired' : 'active'
  return record.status === 'expired' ? 'expired' : 'revoked'
}
const projectSuccessorAfterGrant = (input: {
  readonly project: BreedingProjectDocumentV1
  readonly operationId: string
  readonly campaignMinute: number
  readonly clockRevision: number
  readonly allConsentsActive: boolean
}): BreedingProjectDocumentV1 => {
  const starts = input.project.status === 'awaiting-parent-consent' && input.allConsentsActive
  const next = parseBreedingProjectDocumentV1({
    ...input.project,
    revision: input.project.revision + 1,
    status: starts ? 'initial-time-in-progress' : input.project.status,
    timeline: starts ? {
      ...input.project.timeline,
      initialStartedAtCampaignMinute: input.project.timeline.initialStartedAtCampaignMinute ?? input.campaignMinute,
      lastAppliedClockRevision: input.clockRevision,
      lastAppliedClockMinute: input.campaignMinute,
    } : input.project.timeline,
    updatedAtCampaignMinute: input.campaignMinute,
    statusChangedAtCampaignMinute: starts ? input.campaignMinute : input.project.statusChangedAtCampaignMinute,
    lastOperationId: input.operationId,
  })
  return validateBreedingProjectRevisionSuccessor(input.project, next)
}
const ensureCoordinator = (database: RotomDatabase, dependenciesInput: ManageBreedingConsentWorkflowDependencies): BreedingTransactionCoordinator => {
  const coordinator = dependenciesInput.coordinator ?? createBreedingTransactionCoordinator({ database })
  if (coordinator.database !== database) return fail(409, 'Consent workflow coordinator must share one database connection')
  return coordinator
}
const invokeProfileResolver = (profileId: string, dependenciesInput: ManageBreedingConsentWorkflowDependencies): PlayerProfile => {
  let value: unknown
  try { value = (dependenciesInput.resolveCurrentPlayerProfile ?? resolvePlayerProfileForPolicy)(profileId) }
  catch { return fail(409, 'Current transfer participant Profile authority is unavailable') }
  if (promiseLike(value)) return fail(409, 'Current transfer participant Profile authority must resolve synchronously')
  return strictProfile(value)
}

const grantProjectConsent = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly profile: PlayerProfile
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
}): BreedingConsentWorkflowTransition => {
  const projects = createSqliteBreedingProjectRepository(input.database)
  const consentRepository = createSqliteBreedingConsentRepository(input.database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const project = projects.get(input.request.projectId!) ?? fail(409, 'Current Project consent request is unavailable')
  const identityMaterial = {
    projectId: input.request.projectId,
    expectedProjectRevision: input.request.expectedProjectRevision,
    parentSheetSlug: input.request.parentSheetSlug,
    profileId: input.profile.id,
  }
  const consentIdentity = projectConsentId(identityMaterial)
  const existingConsent = consentRepository.get(consentIdentity)
  if (existingConsent) {
    if (existingConsent.projectId === input.request.projectId && existingConsent.parentSheetSlug === input.request.parentSheetSlug
      && existingConsent.consentingProfileId === input.profile.id) return 'exact-replay'
    return fail(409, 'Project consent identity is already bound to different facts')
  }
  if (project.revision !== input.request.expectedProjectRevision || !ACTIVE_PROJECT_STATUSES.has(project.status)) {
    return fail(409, 'Project consent request is stale')
  }
  const parentRef = project.parentRefs.find(ref => ref.pokemonSheetSlug === input.request.parentSheetSlug
    && ref.ownerTrainerSlug === input.request.trainerSheetSlug)
    ?? fail(403, 'Selected Trainer is not the requested participating parent owner')
  const trainer = trainerDocument(sheets.get('trainer', input.request.trainerSheetSlug), input.request.trainerSheetSlug)
  const parent = pokemonDocument(sheets.get('pokemon', parentRef.pokemonSheetSlug), parentRef.pokemonSheetSlug)
  if (parent.revision !== parentRef.expectedSheetRevision) return fail(409, 'Participating parent revision changed before consent')
  const roster = strictRoster(trainer.document)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const active = consentRepository.findActiveForParent(project.projectId, parent.slug)
  if (active) {
    if (isBreedingConsentCurrentlyUsable(active, {
      projectId: project.projectId, parentSheetSlug: parent.slug, parentSheetRevision: parent.revision,
      ownerTrainerSlug: trainer.slug, consentingProfileId: input.profile.id, atCampaignMinute: clock.campaignMinute,
    })) return 'exact-replay'
    return fail(409, 'The prior consent must be settled before a fresh grant')
  }
  const operationIdentity = operationId('grant-project-consent', identityMaterial)
  const expiresAt = clock.campaignMinute + BREEDING_CONSENT_WORKFLOW_CONSENT_DURATION
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationIdentity,
    commandKind: 'grant-breeding-consent',
    actor: { profileId: input.profile.id, selectedTrainerSlug: trainer.slug },
    ruleset: project.ruleset,
    scopes: [
      { kind: 'breeding-project', projectId: project.projectId, expectedRevision: project.revision },
      { kind: 'parent-consent', consentId: consentIdentity, expectedRevision: null },
    ],
    payload: {
      projectId: project.projectId,
      consentId: consentIdentity,
      parentSheetSlug: parent.slug,
      parentSheetRevision: parent.revision,
      consentScopes: [...BREEDING_CONSENT_SCOPES].sort(compare),
      expiresAtCampaignMinute: expiresAt,
    },
  })
  const currentActor = actor({ role: 'player', profile: input.profile, command, campaignMinute: clock.campaignMinute })
  const trainerControl = control(input.profile, trainer, clock.campaignMinute)
  const parentControl = createBreedingParentControlEvidenceV1({
    parentSheetSlug: parent.slug,
    parentSheetRevision: parent.revision,
    parentSheetDefinitionSha256: sha256(parent.document),
    ownerTrainer: { slug: trainer.slug, revision: trainer.revision, definitionSha256: sha256(trainer.document), ...roster },
    trainerControl,
    verificationMode: 'profile-control',
    evaluatedAtCampaignMinute: clock.campaignMinute,
  })
  const policyDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system', providerId: 'breeding.project-consent-policy-v1', subjectKind: 'project',
    subjectId: project.projectId, subjectRevision: project.revision, checkpoint: 'authorization',
    providerDefinitionSha256: securityPolicyJson.definitionSha256,
    effectiveEvidenceSha256: sha256({ project: sha256(project), parentControl: parentControl.definitionSha256, expiry: expiresAt }),
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId), operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      clockResource(clock),
      resource({ resourceKind: 'breeding-project', resourceId: project.projectId, existence: 'present', revision: project.revision, definitionSha256: sha256(project), purposes: ['conflict', 'mechanics'] }),
      resource({ resourceKind: 'parent-consent', resourceId: consentIdentity, existence: 'absent', revision: null, definitionSha256: null, purposes: ['conflict'] }),
      resource({ resourceKind: 'pokemon-sheet', resourceId: parent.slug, existence: 'present', revision: parent.revision, definitionSha256: sha256(parent.document), purposes: ['consent'] }),
      resource({ resourceKind: 'trainer-sheet', resourceId: trainer.slug, existence: 'present', revision: trainer.revision, definitionSha256: sha256(trainer.document), purposes: ['authorization'] }),
    ],
    referenceVersions: referenceVersions(), dependencyEvidence: dependencies([policyDependency]), writeExpectations: command.scopes,
  })
  const receipt = authorizeBreedingConsentGrantV1({
    command, readSet, actorAuthority: currentActor, trainerControl, parentControl, project,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current positive Project consent authority is unavailable')
  const execution = input.coordinator.execute({
    command,
    createdAtCampaignMinute: clock.campaignMinute,
    settledAtCampaignMinute: clock.campaignMinute,
    execute: (canonical, _operation, context) => {
      context.repositories.operationEvidence.insert({ command: canonical, readSet, authorizationReceipt: receipt })
      const currentClock = context.repositories.campaignClock.get()
      const currentProject = context.repositories.projects.get(project.projectId)
      const currentParent = context.repositories.sheets.get('pokemon', parent.slug)
      const currentTrainer = context.repositories.sheets.get('trainer', trainer.slug)
      if (!currentProject || !currentParent || !currentTrainer || currentClock.revision !== clock.revision
        || currentClock.campaignMinute !== clock.campaignMinute || currentProject.revision !== project.revision
        || sha256(currentProject) !== sha256(project) || currentParent.revision !== parent.revision
        || sha256(currentParent.document) !== sha256(parent.document) || currentTrainer.revision !== trainer.revision
        || sha256(currentTrainer.document) !== sha256(trainer.document)
        || context.repositories.consents.get(consentIdentity) !== null) {
        return fail(409, 'Project consent authority changed during settlement')
      }
      const consent = createBreedingConsentRecordV1({
        schemaVersion: 1,
        consentId: consentIdentity,
        projectId: currentProject.projectId,
        parentSheetSlug: currentParent.slug,
        parentSheetRevision: currentParent.revision,
        ownerTrainerSlug: currentTrainer.slug,
        consentingProfileId: input.profile.id,
        scopes: [...BREEDING_CONSENT_SCOPES].sort(compare),
        grantedAtCampaignMinute: currentClock.campaignMinute,
        expiresAtCampaignMinute: expiresAt,
        grantOperationId: canonical.operationId,
        grantCommandSha256: createBreedingOperationCommandHash(canonical),
      })
      context.repositories.consents.insert(consent)
      const allConsents = context.repositories.consents.listByProject(currentProject.projectId, 10)
      const allActive = currentProject.parentRefs.filter(ref => ref.ownerTrainerSlug !== currentProject.ownerTrainerSlug)
        .every(ref => allConsents.some(value => isBreedingConsentCurrentlyUsable(value, {
          projectId: currentProject.projectId,
          parentSheetSlug: ref.pokemonSheetSlug,
          parentSheetRevision: ref.expectedSheetRevision,
          ownerTrainerSlug: ref.ownerTrainerSlug,
          consentingProfileId: value.consentingProfileId,
          atCampaignMinute: currentClock.campaignMinute,
        })))
      const successor = projectSuccessorAfterGrant({
        project: currentProject,
        operationId: canonical.operationId,
        campaignMinute: currentClock.campaignMinute,
        clockRevision: currentClock.revision,
        allConsentsActive: allActive,
      })
      const replaced = context.repositories.projects.replace({ expectedRevision: currentProject.revision, document: successor })
      if (replaced.kind !== 'applied') return fail(409, 'Project changed during consent settlement')
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'breeding-project', aggregateId: replaced.document.projectId, revision: replaced.document.revision,
        operationKind: 'grant-breeding-consent', audienceTargets: projectAudienceTargets(replaced.document),
        campaignProjectionKey: input.campaignProjectionKey, timestamp: input.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: createBreedingOperationCommandHash(canonical),
        commandKind: canonical.commandKind,
        outcomeKind: 'consent-granted',
        aggregateRefs: [
          { kind: 'breeding-project', id: replaced.document.projectId, revision: replaced.document.revision },
          { kind: 'parent-consent', id: consent.consentId, revision: consent.revision },
        ],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
  })
  if (execution.record.status === 'pending') return 'none'
  if (execution.record.result?.ok !== true) return fail(409, 'Project consent settlement was rejected')
  return execution.kind === 'exact-retry' ? 'exact-replay' : 'project-consent-granted'
}

const lifecycleReadSet = (input: {
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly project: BreedingProjectDocumentV1
  readonly consent: BreedingConsentRecordV1 | null
  readonly trainer: StoredSheetDocument<Record<string, unknown>> | null
  readonly clock: ReturnType<ReturnType<typeof createSqliteCampaignClockRepository>['get']>
}) => createBreedingOperationReadSetV1({
  readSetId: readSetId(input.command.operationId), operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command), commandKind: input.command.commandKind,
  capturedAtCampaignMinute: input.clock.campaignMinute,
  resources: [
    clockResource(input.clock),
    resource({ resourceKind: 'breeding-project', resourceId: input.project.projectId, existence: 'present', revision: input.project.revision, definitionSha256: sha256(input.project), purposes: ['conflict', 'mechanics'] }),
    ...(input.consent ? [resource({ resourceKind: 'parent-consent' as const, resourceId: input.consent.consentId, existence: 'present' as const, revision: input.consent.revision, definitionSha256: input.consent.definitionSha256, purposes: ['conflict', 'consent'] as const })] : []),
    ...(input.trainer ? [resource({ resourceKind: 'trainer-sheet' as const, resourceId: input.trainer.slug, existence: 'present' as const, revision: input.trainer.revision, definitionSha256: sha256(input.trainer.document), purposes: ['authorization'] as const })] : []),
  ],
  referenceVersions: referenceVersions(),
  dependencyEvidence: dependencies([{
    providerKind: 'system', providerId: 'breeding.lifecycle-consent-policy-v1', subjectKind: 'project',
    subjectId: input.project.projectId, subjectRevision: input.project.revision, checkpoint: 'authorization',
    providerDefinitionSha256: securityPolicyJson.definitionSha256, effectiveEvidenceSha256: sha256({ project: input.project.projectId, revision: input.project.revision }),
  }]),
  writeExpectations: input.command.scopes,
})

const revokeProjectConsent = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly profile: PlayerProfile
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
}): BreedingConsentWorkflowTransition => {
  const consent = createSqliteBreedingConsentRepository(input.database).get(input.request.consentId!)
    ?? fail(409, 'Current Project consent is unavailable')
  if (consent.projectId !== input.request.projectId || consent.consentingProfileId !== input.profile.id
    || consent.ownerTrainerSlug !== input.request.trainerSheetSlug) {
    return fail(409, 'Project consent revocation authority is stale')
  }
  if (consent.status !== 'active') return 'exact-replay'
  const project = createSqliteBreedingProjectRepository(input.database).get(input.request.projectId!)
    ?? fail(409, 'Current Project is unavailable')
  if (project.revision !== input.request.expectedProjectRevision) {
    return fail(409, 'Project consent revocation authority is stale')
  }
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const trainer = trainerDocument(sheets.get('trainer', consent.ownerTrainerSlug), consent.ownerTrainerSlug)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  if (consent.expiresAtCampaignMinute !== null && clock.campaignMinute >= consent.expiresAtCampaignMinute) {
    return fail(409, 'Expired Project consent requires campaign-time expiry settlement')
  }
  const identity = operationId('revoke-project-consent', {
    projectId: project.projectId, expectedProjectRevision: project.revision, consentId: consent.consentId,
  })
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: identity, commandKind: 'revoke-breeding-consent',
    actor: { profileId: input.profile.id, selectedTrainerSlug: trainer.slug }, ruleset: project.ruleset,
    scopes: [
      { kind: 'breeding-project', projectId: project.projectId, expectedRevision: project.revision },
      { kind: 'parent-consent', consentId: consent.consentId, expectedRevision: consent.revision },
    ],
    payload: { projectId: project.projectId, consentId: consent.consentId, reasonId: 'breeding.consent.revoked' },
  })
  const currentActor = actor({ role: 'player', profile: input.profile, command, campaignMinute: clock.campaignMinute })
  const trainerControl = control(input.profile, trainer, clock.campaignMinute)
  const readSet = lifecycleReadSet({ command, project, consent, trainer, clock })
  const receipt = authorizeBreedingLifecycleControlV1({
    command, readSet, actorAuthority: currentActor, trainerControl, project, consent, gmOverrides: [],
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current Project consent revocation authority is unavailable')
  const result = manageBreedingLifecycle({
    command, readSet, authorizationReceipt: receipt, actorAuthority: currentActor,
    trainerControl, gmOverrides: [], audience: 'participating-owner',
  }, {
    database: input.database, coordinator: input.coordinator, campaignProjectionKey: input.campaignProjectionKey,
    realtimeTimestamp: input.realtimeTimestamp,
  })
  if (result.execution.record.status === 'pending') return 'none'
  if (result.execution.record.result?.ok !== true) return fail(409, 'Project consent revocation was rejected')
  return result.execution.kind === 'exact-retry' ? 'exact-replay' : 'project-consent-revoked'
}

const gmCancelProject = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly validateCurrentGmAuthority?: (actor: BreedingActorAuthorityV1) => boolean
}): BreedingConsentWorkflowTransition => {
  const project = createSqliteBreedingProjectRepository(input.database).get(input.request.projectId!)
    ?? fail(409, 'Current Project is unavailable')
  if (!ACTIVE_PROJECT_STATUSES.has(project.status)) return 'exact-replay'
  if (project.revision !== input.request.expectedProjectRevision) return fail(409, 'GM Project review is stale')
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const identity = operationId('gm-cancel-cross-owner-project', { projectId: project.projectId, revision: project.revision })
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: identity, commandKind: 'cancel-breeding-project',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null }, ruleset: project.ruleset,
    scopes: [{ kind: 'breeding-project', projectId: project.projectId, expectedRevision: project.revision }],
    payload: { projectId: project.projectId, reasonId: 'breeding.project-terminal.abandoned' },
  })
  const currentActor = actor({ role: 'gm', profile: null, command, campaignMinute: clock.campaignMinute })
  let verified: unknown = true
  try { verified = input.validateCurrentGmAuthority?.(currentActor) ?? true }
  catch { verified = false }
  if (promiseLike(verified) || verified !== true) return fail(403, 'Current GM consent-review authority is unavailable')
  const readSet = lifecycleReadSet({ command, project, consent: null, trainer: null, clock })
  const gmOverride = createBreedingGmOverrideEvidenceV1({
    overrideId: overrideId({ operationId: command.operationId, projectId: project.projectId }),
    command, actorAuthority: currentActor, overrideKind: 'operation-recovery',
    target: { kind: 'breeding-operation', operationId: command.operationId },
    reasonId: 'breeding.override.consent-workflow.project-abandonment',
    createdAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const receipt = authorizeBreedingLifecycleControlV1({
    command, readSet, actorAuthority: currentActor, trainerControl: null, project, consent: null,
    gmOverrides: [gmOverride], securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'GM Project cancellation override is unavailable')
  const result = manageBreedingLifecycle({
    command, readSet, authorizationReceipt: receipt, actorAuthority: currentActor,
    trainerControl: null, gmOverrides: [gmOverride], audience: 'gm',
  }, {
    database: input.database, coordinator: input.coordinator, campaignProjectionKey: input.campaignProjectionKey,
    realtimeTimestamp: input.realtimeTimestamp,
  })
  if (result.execution.record.status === 'pending') return 'none'
  if (result.execution.record.result?.ok !== true) return fail(409, 'GM Project cancellation was rejected')
  return result.execution.kind === 'exact-retry' ? 'exact-replay' : 'project-cancelled-by-gm'
}

const syntheticTransferCommand = (input: {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly selectedTrainerSlug: string
  readonly eggId: string
  readonly destinationTrainerSlug: string
  readonly sourceConsentId: string
  readonly recipientConsentId: string
  readonly identityKind: string
}) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(input.identityKind, {
    eggId: input.eggId, destinationTrainerSlug: input.destinationTrainerSlug,
    sourceConsentId: input.sourceConsentId, recipientConsentId: input.recipientConsentId,
  }),
  commandKind: 'transfer-egg',
  actor: { profileId: input.role === 'gm' ? 'campaign-gm' : input.profile!.id, selectedTrainerSlug: input.role === 'gm' ? null : input.selectedTrainerSlug },
  ruleset: { rulesetId: 'ptu-1.05-breeding-v1', definitionSha256: DEFAULT_BREEDING_CAMPAIGN_OPTION_SNAPSHOT.rulesetDefinitionSha256 },
  scopes: [
    { kind: 'pokemon-egg' as const, eggId: input.eggId, expectedRevision: 0 },
    ...[input.sourceConsentId, input.recipientConsentId].sort(compare).map(consentId => ({
      kind: 'egg-transfer-consent' as const, consentId, expectedRevision: 0,
    })),
  ],
  payload: {
    eggId: input.eggId,
    destinationTrainerSlug: input.destinationTrainerSlug,
    consentEvidenceIds: [input.sourceConsentId, input.recipientConsentId].sort(compare),
  },
})

const offerEggTransfer = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly profile: PlayerProfile
  readonly database: RotomDatabase
}): BreedingConsentWorkflowTransition => {
  const eggs = createSqlitePokemonEggRepository(input.database)
  const egg = eggs.get(input.request.eggId!) ?? fail(409, 'Current Egg is unavailable')
  if (egg.revision !== input.request.expectedEggRevision || egg.ownerTrainerSlug !== input.request.trainerSheetSlug) {
    return fail(409, 'Egg transfer setup is stale')
  }
  const transferRepository = createSqlitePokemonEggTransferConsentRepository(input.database)
  const existing = transferRepository.listByEgg(egg.eggId, 32).find(value => value.role === 'source-gift'
    && value.status === 'active' && value.eggRevision === egg.revision)
  if (existing) {
    if (existing.destinationTrainerSlug === input.request.destinationTrainerSlug
      && existing.consentingProfileId === input.profile.id
      && existing.consentingTrainerSlug === input.request.trainerSheetSlug) return 'exact-replay'
    return fail(409, 'Another current transfer offer already exists for this Egg')
  }
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const sourceTrainer = trainerDocument(sheets.get('trainer', egg.ownerTrainerSlug), egg.ownerTrainerSlug)
  trainerDocument(sheets.get('trainer', input.request.destinationTrainerSlug!), input.request.destinationTrainerSlug!)
  if (sourceTrainer.slug === input.request.destinationTrainerSlug) return fail(409, 'Egg transfer requires a different destination Trainer')
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const material = {
    eggId: egg.eggId, eggRevision: egg.revision, sourceTrainerSlug: sourceTrainer.slug,
    destinationTrainerSlug: input.request.destinationTrainerSlug, profileId: input.profile.id,
    grantedAtCampaignMinute: clock.campaignMinute,
  }
  const sourceId = transferConsentId('egg-transfer-source-gift-v1', material)
  const recipientId = transferConsentId('egg-transfer-recipient-placeholder-v1', { sourceId })
  const command = syntheticTransferCommand({
    role: 'player', profile: input.profile, selectedTrainerSlug: sourceTrainer.slug, eggId: egg.eggId,
    destinationTrainerSlug: input.request.destinationTrainerSlug!, sourceConsentId: sourceId,
    recipientConsentId: recipientId, identityKind: 'offer-egg-transfer',
  })
  const currentActor = actor({ role: 'player', profile: input.profile, command, campaignMinute: clock.campaignMinute })
  const trainerControl = control(input.profile, sourceTrainer, clock.campaignMinute)
  grantPokemonEggTransferConsent({
    consentId: sourceId,
    role: 'source-gift',
    eggId: egg.eggId,
    destinationTrainerSlug: input.request.destinationTrainerSlug,
    sourceConsentId: null,
    expiresAtCampaignMinute: clock.campaignMinute + BREEDING_CONSENT_WORKFLOW_CONSENT_DURATION,
    actorAuthority: currentActor,
    trainerControl,
  }, { database: input.database, validateCurrentProfileControl: () => true })
  return 'egg-transfer-offered'
}

const acceptEggTransfer = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly profile: PlayerProfile
  readonly database: RotomDatabase
}): BreedingConsentWorkflowTransition => {
  const transfers = createSqlitePokemonEggTransferConsentRepository(input.database)
  const source = transfers.get(input.request.transferConsentId!) ?? fail(409, 'Current Egg transfer invitation is unavailable')
  if (source.role !== 'source-gift' || source.destinationTrainerSlug !== input.request.trainerSheetSlug
    || source.status !== 'active' || source.eggRevision !== input.request.expectedEggRevision) {
    return fail(409, 'Egg transfer invitation is stale')
  }
  const linked = transfers.listByEgg(source.eggId, 32).find(value => value.role === 'recipient-acceptance'
    && value.counterpartConsentId === source.consentId && value.status === 'active')
  if (linked) return linked.consentingProfileId === input.profile.id ? 'exact-replay' : fail(409, 'Egg transfer invitation is already accepted')
  const egg = createSqlitePokemonEggRepository(input.database).get(source.eggId) ?? fail(409, 'Current Egg is unavailable')
  if (egg.revision !== source.eggRevision || egg.ownerTrainerSlug !== source.sourceTrainerSlug) return fail(409, 'Egg transfer invitation no longer matches the Egg')
  const trainer = trainerDocument(createSqliteSheetRepository<Record<string, unknown>>(input.database).get('trainer', source.destinationTrainerSlug), source.destinationTrainerSlug)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const recipientId = transferConsentId('egg-transfer-recipient-acceptance-v1', {
    sourceConsentId: source.consentId, profileId: input.profile.id,
  })
  const command = syntheticTransferCommand({
    role: 'player', profile: input.profile, selectedTrainerSlug: trainer.slug, eggId: source.eggId,
    destinationTrainerSlug: source.destinationTrainerSlug, sourceConsentId: source.consentId,
    recipientConsentId: recipientId, identityKind: 'accept-egg-transfer',
  })
  const currentActor = actor({ role: 'player', profile: input.profile, command, campaignMinute: clock.campaignMinute })
  grantPokemonEggTransferConsent({
    consentId: recipientId,
    role: 'recipient-acceptance',
    eggId: source.eggId,
    destinationTrainerSlug: source.destinationTrainerSlug,
    sourceConsentId: source.consentId,
    expiresAtCampaignMinute: source.expiresAtCampaignMinute,
    actorAuthority: currentActor,
    trainerControl: control(input.profile, trainer, clock.campaignMinute),
  }, { database: input.database, validateCurrentProfileControl: () => true })
  return 'egg-transfer-accepted'
}

const revokeEggTransferConsent = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly profile: PlayerProfile
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
}): BreedingConsentWorkflowTransition => {
  const repository = createSqlitePokemonEggTransferConsentRepository(input.database)
  const consent = repository.get(input.request.transferConsentId!) ?? fail(409, 'Egg-transfer consent is unavailable')
  if (consent.consentingProfileId !== input.profile.id || consent.consentingTrainerSlug !== input.request.trainerSheetSlug) {
    return fail(403, 'Only the current consenting participant may revoke this transfer consent')
  }
  if (consent.status !== 'active') return 'exact-replay'
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const trainer = trainerDocument(sheets.get('trainer', consent.consentingTrainerSlug), consent.consentingTrainerSlug)
  const egg = createSqlitePokemonEggRepository(input.database).get(consent.eggId)
    ?? fail(409, 'The Egg bound to this transfer consent is unavailable')
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const trainerControl = control(input.profile, trainer, clock.campaignMinute)
  const settlementOperationId = operationId('settle-egg-transfer-consent', { consentId: consent.consentId, revision: consent.revision })
  const expired = clock.campaignMinute >= consent.expiresAtCampaignMinute
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: settlementOperationId,
    commandKind: 'settle-egg-transfer-consent',
    actor: { profileId: input.profile.id, selectedTrainerSlug: trainer.slug },
    ruleset: egg.ruleset,
    scopes: [{ kind: 'egg-transfer-consent', consentId: consent.consentId, expectedRevision: consent.revision }],
    payload: {
      consentId: consent.consentId,
      reasonId: expired ? 'breeding.egg-transfer-consent.expired' : 'breeding.egg-transfer-consent.revoked',
    },
  })
  const currentActor = actor({ role: 'player', profile: input.profile, command, campaignMinute: clock.campaignMinute })
  const settlementDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system',
    providerId: 'breeding.egg-transfer-consent-settlement-policy-v1',
    subjectKind: 'pokemon-egg',
    subjectId: consent.eggId,
    subjectRevision: consent.eggRevision,
    checkpoint: 'authorization',
    providerDefinitionSha256: POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: sha256({ consentDefinitionSha256: consent.definitionSha256, trainerControl: trainerControl.definitionSha256, expired }),
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId),
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      clockResource(clock),
      resource({ resourceKind: 'egg-transfer-consent', resourceId: consent.consentId, existence: 'present', revision: consent.revision, definitionSha256: consent.definitionSha256, purposes: ['conflict', 'consent'] }),
      resource({ resourceKind: 'trainer-sheet', resourceId: trainer.slug, existence: 'present', revision: trainer.revision, definitionSha256: sha256(trainer.document), purposes: ['authorization'] }),
    ],
    referenceVersions: referenceVersions(),
    dependencyEvidence: dependencies([settlementDependency]),
    writeExpectations: command.scopes,
  })
  const receipt = authorizePokemonEggTransferConsentSettlementV1({
    command,
    readSet,
    actorAuthority: currentActor,
    trainerControl,
    consent,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current Egg-transfer consent settlement authority is unavailable')
  const execution = input.coordinator.execute({
    command,
    createdAtCampaignMinute: clock.campaignMinute,
    settledAtCampaignMinute: clock.campaignMinute,
    execute: (canonical, _operation, context) => {
      context.repositories.operationEvidence.insert({ command: canonical, readSet, authorizationReceipt: receipt })
      const currentClock = context.repositories.campaignClock.get()
      const currentConsent = context.repositories.transferConsents.get(consent.consentId)
      const currentTrainer = context.repositories.sheets.get('trainer', trainer.slug)
      if (!currentConsent || currentConsent.status !== 'active' || !currentTrainer
        || currentClock.revision !== clock.revision || currentClock.campaignMinute !== clock.campaignMinute
        || currentConsent.revision !== consent.revision || currentConsent.definitionSha256 !== consent.definitionSha256
        || currentTrainer.revision !== trainer.revision || sha256(currentTrainer.document) !== sha256(trainer.document)
        || !authorizePokemonEggTransferConsentSettlementV1({
          command: canonical,
          readSet,
          actorAuthority: currentActor,
          trainerControl,
          consent: currentConsent,
          securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
        }).authorized) {
        return fail(409, 'Egg-transfer consent authority changed during settlement')
      }
      const next = settlePokemonEggTransferConsentV1({
        consent: currentConsent,
        status: expired ? 'expired' : 'revoked',
        operationId: canonical.operationId,
        settledAtCampaignMinute: currentClock.campaignMinute,
      })
      const replaced = context.repositories.transferConsents.replace({ expectedRevision: currentConsent.revision, consent: next })
      if (replaced.kind !== 'applied') return fail(409, 'Egg-transfer consent changed during settlement')
      context.appendRealtime(breedingRealtimeRefreshAppendInputs({
        aggregateKind: 'pokemon-egg',
        aggregateId: consent.eggId,
        revision: egg.revision,
        operationKind: canonical.commandKind,
        audienceTargets: [
          { audience: 'diagnostic', trainerSheetSlug: null },
          { audience: 'gm', trainerSheetSlug: null },
          { audience: 'owner', trainerSheetSlug: consent.sourceTrainerSlug },
          { audience: 'owner', trainerSheetSlug: consent.destinationTrainerSlug },
          { audience: 'public', trainerSheetSlug: null },
        ],
        campaignProjectionKey: input.campaignProjectionKey,
        timestamp: input.realtimeTimestamp,
      }))
      return createBreedingOperationAcceptedV1({
        operationId: canonical.operationId,
        commandHash: createBreedingOperationCommandHash(canonical),
        commandKind: canonical.commandKind,
        outcomeKind: 'egg-transfer-consent-settled',
        aggregateRefs: [{ kind: 'egg-transfer-consent', id: replaced.document.consentId, revision: replaced.document.revision }],
        changedScopes: canonical.scopes,
        committedAtCampaignMinute: currentClock.campaignMinute,
      })
    },
  })
  if (execution.record.status === 'pending') return 'none'
  if (execution.record.result?.ok !== true) return fail(409, 'Egg-transfer consent settlement was rejected')
  return execution.kind === 'exact-retry' ? 'exact-replay' : 'egg-transfer-consent-revoked'
}

const completeEggTransfer = (input: {
  readonly request: ReturnType<typeof parseBreedingConsentWorkflowRequestV1>
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly database: RotomDatabase
  readonly coordinator: BreedingTransactionCoordinator
  readonly campaignProjectionKey: Buffer | string
  readonly realtimeTimestamp: number
  readonly dependencies: ManageBreedingConsentWorkflowDependencies
}): BreedingConsentWorkflowTransition => {
  const transfers = createSqlitePokemonEggTransferConsentRepository(input.database)
  const source = transfers.get(input.request.transferConsentId!) ?? fail(409, 'Egg transfer agreement is unavailable')
  if (source.role !== 'source-gift') return fail(409, 'Transfer selector must identify the source gift')
  const recipientHistory = transfers.listByEgg(source.eggId, 32).filter(value => value.role === 'recipient-acceptance'
    && value.counterpartConsentId === source.consentId)
  if (recipientHistory.length > 1) return fail(409, 'Egg transfer recipient consent history is ambiguous')
  const historicalRecipient = recipientHistory[0] ?? null
  if (input.role === 'player') {
    const selectedConsent = input.request.trainerSheetSlug === source.sourceTrainerSlug
      ? source
      : input.request.trainerSheetSlug === source.destinationTrainerSlug
        ? historicalRecipient
        : null
    if (!selectedConsent || selectedConsent.consentingProfileId !== input.profile?.id) {
      return fail(403, 'Selected Trainer and Profile are not the exact transfer participant')
    }
  }
  if (source.status === 'consumed') {
    if (!historicalRecipient || historicalRecipient.status !== 'consumed'
      || historicalRecipient.settlementOperationId !== source.settlementOperationId) {
      return fail(409, 'Terminal Egg transfer lost immutable dual-consent evidence')
    }
    const terminalEgg = createSqlitePokemonEggRepository(input.database).get(source.eggId)
      ?? fail(409, 'Transferred Egg is unavailable')
    if (terminalEgg.ownerTrainerSlug !== source.destinationTrainerSlug || terminalEgg.revision !== source.eggRevision + 1) {
      return fail(409, 'Terminal Egg transfer lost immutable ownership evidence')
    }
    const currentSheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
    const currentMinute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
    const sourceTrainer = trainerDocument(currentSheets.get('trainer', source.sourceTrainerSlug), source.sourceTrainerSlug)
    const destinationTrainer = trainerDocument(currentSheets.get('trainer', source.destinationTrainerSlug), source.destinationTrainerSlug)
    control(invokeProfileResolver(source.consentingProfileId, input.dependencies), sourceTrainer, currentMinute)
    control(invokeProfileResolver(historicalRecipient.consentingProfileId, input.dependencies), destinationTrainer, currentMinute)
    if (input.role === 'gm') {
      const terminalOperation = source.settlementOperationId
        ? createSqliteBreedingOperationRepository(input.database).get(source.settlementOperationId)
        : null
      if (!terminalOperation || terminalOperation.status !== 'accepted') return fail(409, 'Terminal Egg transfer operation evidence is unavailable')
      const terminalActor = actor({ role: 'gm', profile: null, command: terminalOperation.command, campaignMinute: currentMinute })
      let verified: unknown = true
      try { verified = input.dependencies.validateCurrentGmAuthority?.(terminalActor) ?? true }
      catch { verified = false }
      if (promiseLike(verified) || verified !== true) return fail(403, 'Current GM transfer replay authority is unavailable')
    }
    return 'exact-replay'
  }
  const recipient = historicalRecipient?.status === 'active' ? historicalRecipient
    : fail(409, 'Both current positive transfer consents are required')
  const egg = createSqlitePokemonEggRepository(input.database).get(source.eggId) ?? fail(409, 'Current Egg is unavailable')
  if (egg.revision !== input.request.expectedEggRevision || egg.revision !== source.eggRevision) return fail(409, 'Egg transfer agreement is stale')
  if (input.role === 'player' && input.request.trainerSheetSlug !== source.sourceTrainerSlug
    && input.request.trainerSheetSlug !== source.destinationTrainerSlug) return fail(403, 'Selected Trainer is not a transfer participant')
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const sourceTrainer = trainerDocument(sheets.get('trainer', source.sourceTrainerSlug), source.sourceTrainerSlug)
  const destinationTrainer = trainerDocument(sheets.get('trainer', source.destinationTrainerSlug), source.destinationTrainerSlug)
  const sourceProfile = invokeProfileResolver(source.consentingProfileId, input.dependencies)
  const destinationProfile = invokeProfileResolver(recipient.consentingProfileId, input.dependencies)
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const sourceControl = control(sourceProfile, sourceTrainer, clock.campaignMinute)
  const destinationControl = control(destinationProfile, destinationTrainer, clock.campaignMinute)
  const command = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationId('complete-egg-transfer', { sourceConsentId: source.consentId, recipientConsentId: recipient.consentId }),
    commandKind: 'transfer-egg',
    actor: { profileId: input.role === 'gm' ? 'campaign-gm' : input.profile!.id, selectedTrainerSlug: input.role === 'gm' ? null : input.request.trainerSheetSlug },
    ruleset: egg.ruleset,
    scopes: [
      { kind: 'pokemon-egg' as const, eggId: egg.eggId, expectedRevision: egg.revision },
      ...[source, recipient].sort((left, right) => compare(left.consentId, right.consentId)).map(consent => ({
        kind: 'egg-transfer-consent' as const, consentId: consent.consentId, expectedRevision: consent.revision,
      })),
    ],
    payload: { eggId: egg.eggId, destinationTrainerSlug: source.destinationTrainerSlug, consentEvidenceIds: [source.consentId, recipient.consentId].sort(compare) },
  })
  const currentActor = actor({ role: input.role, profile: input.profile, command, campaignMinute: clock.campaignMinute })
  let gmVerified: unknown = input.role === 'gm'
  if (input.role === 'gm' && input.dependencies.validateCurrentGmAuthority) {
    try { gmVerified = input.dependencies.validateCurrentGmAuthority(currentActor) }
    catch { gmVerified = false }
  }
  if (promiseLike(gmVerified) || gmVerified !== (input.role === 'gm')) return fail(403, 'Current transfer actor authority is unavailable')
  const agreement = resolvePokemonEggTransferAgreementV1({
    egg, destinationTrainerSlug: source.destinationTrainerSlug, consents: [source, recipient], atCampaignMinute: clock.campaignMinute,
  })
  const transferDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system', providerId: 'breeding.egg-transfer-policy-v1', subjectKind: 'pokemon-egg',
    subjectId: egg.eggId, subjectRevision: egg.revision, checkpoint: 'authorization',
    providerDefinitionSha256: POKEMON_EGG_TRANSFER_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: pokemonEggTransferEffectiveEvidenceSha256({ egg, agreement, sourceControl, destinationControl }),
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(command.operationId), operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      clockResource(clock),
      resource({ resourceKind: 'pokemon-egg', resourceId: egg.eggId, existence: 'present', revision: egg.revision, definitionSha256: sha256(egg), purposes: ['conflict', 'mechanics'] }),
      resource({ resourceKind: 'egg-transfer-consent', resourceId: source.consentId, existence: 'present', revision: source.revision, definitionSha256: pokemonEggTransferConsentDefinitionSha256(source), purposes: ['conflict', 'consent'] }),
      resource({ resourceKind: 'egg-transfer-consent', resourceId: recipient.consentId, existence: 'present', revision: recipient.revision, definitionSha256: pokemonEggTransferConsentDefinitionSha256(recipient), purposes: ['conflict', 'consent'] }),
      resource({ resourceKind: 'trainer-sheet', resourceId: sourceTrainer.slug, existence: 'present', revision: sourceTrainer.revision, definitionSha256: sha256(sourceTrainer.document), purposes: ['authorization'] }),
      resource({ resourceKind: 'trainer-sheet', resourceId: destinationTrainer.slug, existence: 'present', revision: destinationTrainer.revision, definitionSha256: sha256(destinationTrainer.document), purposes: ['authorization', 'write-destination'] }),
    ],
    referenceVersions: referenceVersions(), dependencyEvidence: dependencies([transferDependency]), writeExpectations: command.scopes,
  })
  const receipt = authorizePokemonEggTransferV1({
    command, readSet, actorAuthority: currentActor, egg, agreement, sourceControl, destinationControl,
    gmAuthorityVerified: input.role === 'gm', securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  if (!receipt.authorized) return fail(403, 'Current dual-positive transfer authority is unavailable')
  const audience = input.request.trainerSheetSlug === source.destinationTrainerSlug ? 'recipient' as const : 'source-owner' as const
  const result = transferPokemonEggOwnership({ command, readSet, authorizationReceipt: receipt, actorAuthority: currentActor, audience }, {
    database: input.database,
    coordinator: input.coordinator,
    campaignProjectionKey: input.campaignProjectionKey,
    realtimeTimestamp: input.realtimeTimestamp,
    resolveCurrentTrainerControl: ({ trainerSlug }) => trainerSlug === sourceTrainer.slug ? sourceControl : destinationControl,
    ...(input.role === 'gm' ? { validateCurrentGmAuthority: () => true } : {}),
  })
  if (result.execution.record.status === 'pending') return 'none'
  if (result.execution.record.result?.ok !== true) return fail(409, 'Egg transfer settlement was rejected')
  return result.execution.kind === 'exact-retry' ? 'exact-replay' : 'egg-transferred'
}

const projectDirectory = (input: {
  readonly role: AuthRole
  readonly trainerSlug: string
  readonly trainerRoster: ReturnType<typeof strictRoster>
  readonly database: RotomDatabase
}): { readonly rows: readonly { readonly project: BreedingProjectDocumentV1, readonly parentSlug: string, readonly participantTrainerSlug: string }[], readonly truncated: boolean } => {
  const repository = createSqliteBreedingProjectRepository(input.database)
  const byIdentity = new Map<string, { readonly project: BreedingProjectDocumentV1, readonly parentSlug: string, readonly participantTrainerSlug: string }>()
  if (input.role === 'gm') {
    const values = repository.listByStatuses([...BREEDING_PROJECT_ACTIVE_STATUSES], BREEDING_CONSENT_WORKFLOW_CARD_LIMIT + 1)
    for (const project of values) for (const parent of project.parentRefs) {
      if (parent.ownerTrainerSlug !== project.ownerTrainerSlug) byIdentity.set(`${project.projectId}\0${parent.pokemonSheetSlug}`, {
        project, parentSlug: parent.pokemonSheetSlug, participantTrainerSlug: parent.ownerTrainerSlug,
      })
    }
  }
  else {
    for (const parentSlug of [...input.trainerRoster.currentTeam, ...input.trainerRoster.boxedPokemon]) {
      for (const project of repository.listByParent(parentSlug, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT + 1)) {
        const parent = project.parentRefs.find(ref => ref.pokemonSheetSlug === parentSlug && ref.ownerTrainerSlug === input.trainerSlug)
        if (parent && parent.ownerTrainerSlug !== project.ownerTrainerSlug) byIdentity.set(`${project.projectId}\0${parentSlug}`, {
          project, parentSlug, participantTrainerSlug: input.trainerSlug,
        })
      }
    }
  }
  const values = [...byIdentity.values()].sort((left, right) => right.project.updatedAtCampaignMinute - left.project.updatedAtCampaignMinute
    || compare(left.project.projectId, right.project.projectId) || compare(left.parentSlug, right.parentSlug))
  return Object.freeze({ rows: Object.freeze(values.slice(0, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT)), truncated: values.length > BREEDING_CONSENT_WORKFLOW_CARD_LIMIT })
}

const buildProjection = (input: {
  readonly role: AuthRole
  readonly profile: PlayerProfile | null
  readonly trainer: StoredSheetDocument<Record<string, unknown>>
  readonly database: RotomDatabase
  readonly transition: BreedingConsentWorkflowTransition
}): BreedingConsentWorkflowProjectionV1 => {
  const minute = createSqliteCampaignClockRepository(input.database).get().campaignMinute
  const roster = strictRoster(input.trainer.document)
  const directory = projectDirectory({ role: input.role, trainerSlug: input.trainer.slug, trainerRoster: roster, database: input.database })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const consents = createSqliteBreedingConsentRepository(input.database)
  const operations = createSqliteBreedingOperationRepository(input.database)
  const projectCards = directory.rows.map(({ project, parentSlug, participantTrainerSlug }) => {
    const parent = sheets.get('pokemon', parentSlug)
    const current = Boolean(parent && parent.revision === project.parentRefs.find(ref => ref.pokemonSheetSlug === parentSlug)?.expectedSheetRevision)
    const records = consents.listByProject(project.projectId, 100)
    if (records.length === 100) return fail(409, 'Project consent history exceeds the bounded private view')
    const latest = latestProjectConsent(project, parentSlug, records)
    const status = projectConsentStatus(latest, current, minute)
    const active = ACTIVE_PROJECT_STATUSES.has(project.status)
    const candidateOperationId = input.role === 'gm'
      ? operationId('gm-cancel-cross-owner-project', { projectId: project.projectId, revision: project.revision })
      : status === 'active' && latest
        ? operationId('revoke-project-consent', {
            projectId: project.projectId, expectedProjectRevision: project.revision, consentId: latest.consentId,
          })
        : operationId('grant-project-consent', {
            projectId: project.projectId,
            expectedProjectRevision: project.revision,
            parentSheetSlug: parentSlug,
            profileId: input.profile!.id,
          })
    const pending = operations.get(candidateOperationId)
    const recovery = pending?.status === 'pending'
      ? Object.freeze({ state: 'pending' as const, pendingSinceCampaignMinute: pending.createdAtCampaignMinute })
      : Object.freeze({ state: 'none' as const, pendingSinceCampaignMinute: null })
    return Object.freeze({
      projectId: project.projectId,
      projectRevision: project.revision,
      coarseStatus: currentProjectStatus(project),
      ownParent: {
        pokemonSheetSlug: parentSlug,
        expectedSheetRevision: project.parentRefs.find(ref => ref.pokemonSheetSlug === parentSlug)!.expectedSheetRevision,
        displayName: safeName(parent && plainRecord(parent.document) ? parent.document.nickname ?? parent.document.name : null, 'Participating parent'),
        current,
      },
      breederDisplayName: safeName(sheets.get('trainer', project.breederTrainerSlug)?.document.name, 'Breeder'),
      consent: {
        consentId: latest?.consentId ?? null,
        status,
        scopes: Object.freeze([...BREEDING_CONSENT_SCOPES].sort(compare)),
        expiresAtCampaignMinute: latest?.expiresAtCampaignMinute ?? null,
      },
      canGrant: recovery.state === 'none' && input.role === 'player' && active && current && (status === 'waiting' || status === 'revoked'),
      canRevoke: recovery.state === 'none' && input.role === 'player' && active && current && status === 'active',
      ownerTrainerSlug: input.role === 'gm' ? project.ownerTrainerSlug : null,
      participantTrainerSlug: input.role === 'gm' ? participantTrainerSlug : null,
      recovery,
      gmReview: input.role === 'gm' ? {
        setupOverrideKind: 'cross-owner-consent' as const,
        setupOverrideOnly: true as const,
        consentSubstitutionAllowed: false as const,
        canCancelProject: recovery.state === 'none' && active,
      } : null,
    })
  })
  const transferRepository = createSqlitePokemonEggTransferConsentRepository(input.database)
  const activeTransferRows = transferRepository.listActiveByParticipant(input.trainer.slug, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT * 2)
  if (activeTransferRows.length === BREEDING_CONSENT_WORKFLOW_CARD_LIMIT * 2) return fail(409, 'Private Egg-transfer directory reaches its fail-closed bound')
  const sourceIds = new Set<string>()
  for (const row of activeTransferRows) sourceIds.add(row.role === 'source-gift' ? row.consentId : row.counterpartConsentId!)
  const transferCards: BreedingConsentWorkflowEggTransferV1[] = []
  for (const sourceId of [...sourceIds].sort(compare)) {
    const source = transferRepository.get(sourceId) ?? fail(409, 'Egg-transfer source consent is unavailable')
    const recipient = transferRepository.listByEgg(source.eggId, 32).find(row => row.role === 'recipient-acceptance'
      && row.counterpartConsentId === source.consentId) ?? null
    const audience = input.trainer.slug === source.sourceTrainerSlug ? 'source-owner' as const
      : input.trainer.slug === source.destinationTrainerSlug ? 'recipient' as const
        : fail(409, 'Egg-transfer directory returned a foreign participant')
    const projected = projectPokemonEggTransferV1({ sourceConsent: source, recipientConsent: recipient, audience, generatedAtCampaignMinute: minute })
    const ownConsentId = audience === 'source-owner' ? source.consentId : recipient?.consentId ?? source.consentId
    const completeOperation = recipient ? operations.get(operationId('complete-egg-transfer', {
      sourceConsentId: source.consentId, recipientConsentId: recipient.consentId,
    })) : null
    const ownConsent = audience === 'source-owner' ? source : recipient
    const settlementOperation = ownConsent?.status === 'active'
      ? operations.get(operationId('settle-egg-transfer-consent', { consentId: ownConsent.consentId, revision: ownConsent.revision }))
      : null
    const pendingOperation = [completeOperation, settlementOperation].find(value => value?.status === 'pending') ?? null
    const recovery = pendingOperation
      ? Object.freeze({ state: 'pending' as const, pendingSinceCampaignMinute: pendingOperation.createdAtCampaignMinute })
      : Object.freeze({ state: 'none' as const, pendingSinceCampaignMinute: null })
    const mayRevoke = (projected.state === 'offered' || projected.state === 'accepted' || projected.state === 'expired')
      && ownConsent?.status === 'active'
    transferCards.push({
      offerConsentId: source.consentId,
      ownConsentId,
      eggId: source.eggId,
      eggRevision: source.eggRevision,
      audience,
      state: projected.state,
      expiresAtCampaignMinute: projected.expiresAtCampaignMinute,
      canAccept: recovery.state === 'none' && projected.canAccept,
      canTransfer: recovery.state === 'none' && projected.canTransfer,
      canRevoke: recovery.state === 'none' && mayRevoke,
      ownConsentActive: ownConsent?.status === 'active',
      recovery,
    })
  }
  transferCards.sort((left, right) => left.expiresAtCampaignMinute - right.expiresAtCampaignMinute || compare(left.offerConsentId, right.offerConsentId))
  const boundedTransfers = transferCards.slice(0, BREEDING_CONSENT_WORKFLOW_CARD_LIMIT)
  const projectRequests = projectCards.filter(card => card.canGrant).length
  const transferInvitations = boundedTransfers.filter(card => card.canAccept).length
  const readyTransfers = boundedTransfers.filter(card => card.canTransfer).length
  return createBreedingConsentWorkflowProjectionV1({
    audience: input.role === 'gm' ? 'gm' : 'player',
    context: { trainerSheetSlug: input.trainer.slug, trainerRevision: input.trainer.revision, displayName: safeName(input.trainer.document.name, input.trainer.slug) },
    generatedAtCampaignMinute: minute,
    notifications: { projectRequests, transferInvitations, readyTransfers, total: projectRequests + transferInvitations + readyTransfers },
    projectRequestsTruncated: directory.truncated,
    eggTransfersTruncated: transferCards.length > BREEDING_CONSENT_WORKFLOW_CARD_LIMIT,
    projectRequests: Object.freeze(projectCards),
    eggTransfers: Object.freeze(boundedTransfers),
    gmPolicy: input.role === 'gm' ? { setupOverrideOnly: true, positiveConsentSubstitutionAllowed: false, transferRequiresTwoPositiveConsents: true } : null,
    transition: input.transition,
  })
}

/**
 * Rebuilds every private consent view and mutation from current campaign
 * storage. Browser input contains selectors and an explicit confirmation only;
 * positive consent always belongs to the currently Profile-controlled
 * participant, and a GM setup/recovery override never substitutes for it.
 */
export const manageBreedingConsentWorkflow = (
  rawInput: ManageBreedingConsentWorkflowInput,
  dependenciesInput: ManageBreedingConsentWorkflowDependencies = {},
): BreedingConsentWorkflowProjectionV1 => {
  if (!plainRecord(rawInput)
    || Object.keys(rawInput).sort(compare).join('\0') !== ['playerProfile', 'request', 'role'].sort(compare).join('\0')) {
    return fail(400, 'Breeding consent workflow request is malformed')
  }
  if (rawInput.role !== 'gm' && rawInput.role !== 'player') return fail(403, 'Breeding consent workflow requires an authenticated campaign role')
  const request = (() => {
    try { return parseBreedingConsentWorkflowRequestV1(rawInput.request) }
    catch { return fail(400, 'Breeding consent workflow request is malformed') }
  })()
  if ((rawInput.role === 'gm') !== (request.profileId === null) || (rawInput.role === 'gm') !== (rawInput.playerProfile === null)) {
    return fail(400, 'Consent workflow Profile context is contradictory')
  }
  const profile = rawInput.role === 'player' ? strictProfile(rawInput.playerProfile) : null
  if (profile && (profile.id !== request.profileId || profile.linkedCharacters.filter(link => link.sheetKind === 'trainer'
    && link.sheetSlug === request.trainerSheetSlug).length !== 1)) {
    return fail(403, 'Selected consent workflow Trainer is not controlled by the current Profile')
  }
  const database = dependenciesInput.database ?? dependenciesInput.coordinator?.database ?? getRotomDatabase()
  const coordinator = ensureCoordinator(database, dependenciesInput)
  const trainer = trainerDocument(createSqliteSheetRepository<Record<string, unknown>>(database).get('trainer', request.trainerSheetSlug), request.trainerSheetSlug)
  const campaignProjectionKey = dependenciesInput.campaignProjectionKey ?? securityPolicyJson.definitionSha256
  const realtimeTimestamp = dependenciesInput.realtimeTimestamp ?? Date.now()
  let transition: BreedingConsentWorkflowTransition = 'none'
  if (request.intent === 'grant-project-consent') {
    if (!profile) return fail(403, 'A GM cannot create positive Project consent')
    transition = grantProjectConsent({ request, profile, database, coordinator, campaignProjectionKey, realtimeTimestamp })
  }
  else if (request.intent === 'revoke-project-consent') {
    if (!profile) return fail(403, 'A GM cannot impersonate participant consent revocation')
    transition = revokeProjectConsent({ request, profile, database, coordinator, campaignProjectionKey, realtimeTimestamp })
  }
  else if (request.intent === 'gm-cancel-project') {
    if (rawInput.role !== 'gm') return fail(403, 'Only a current GM may use the audited Project cancellation control')
    transition = gmCancelProject({ request, database, coordinator, campaignProjectionKey, realtimeTimestamp, validateCurrentGmAuthority: dependenciesInput.validateCurrentGmAuthority })
  }
  else if (request.intent === 'offer-egg-transfer') {
    if (!profile) return fail(403, 'A GM cannot create a source owner gift consent')
    transition = offerEggTransfer({ request, profile, database })
  }
  else if (request.intent === 'accept-egg-transfer') {
    if (!profile) return fail(403, 'A GM cannot create recipient acceptance')
    transition = acceptEggTransfer({ request, profile, database })
  }
  else if (request.intent === 'revoke-egg-transfer-consent') {
    if (!profile) return fail(403, 'A GM cannot impersonate participant transfer revocation')
    transition = revokeEggTransferConsent({
      request, profile, database, coordinator, campaignProjectionKey, realtimeTimestamp,
    })
  }
  else if (request.intent === 'complete-egg-transfer') {
    transition = completeEggTransfer({
      request, role: rawInput.role, profile, database, coordinator, campaignProjectionKey,
      realtimeTimestamp, dependencies: dependenciesInput,
    })
  }
  return buildProjection({ role: rawInput.role, profile, trainer, database, transition })
}
