import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  BREEDING_AUTHORIZATION_REASON_IDS,
  BREEDING_GM_OVERRIDE_KINDS,
  BreedingAuthorizationValidationError,
  parseBreedingBreederAuthorityEvidenceV1,
  parseBreedingGmOverrideEvidenceV1,
} from '../../shared/breeding/authorization'
import { BREEDING_REFERENCE_SOURCE_IDS, parseBreedingReadResourceV1, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import {
  BreedingAuthorizationAuthorityError,
  assertBreedingAuthorizationReceiptExactReplay,
  authorizeBreedingProjectSetupV1,
  createBreedingActorAuthorityV1,
  createBreedingBreederAuthorityEvidenceV1,
  createBreedingCrossOwnerConsentEvidenceV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  validateBreedingCrossOwnerConsentEvidenceForOperationV1,
} from '../../server/domain/breeding/authorization'
import { createBreedingConsentRecordV1, createBreedingConsentRevisionV1 } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/authorization-contract.json')
const security = readJson<Record<string, any>>('data/breeding-automation/security-policy.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const EDGE_RECORD = 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4'
const EDGE_EFFECTIVE = '6'.repeat(64)
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const overrideId = (value: number): string => `breeding-override:v1:${value.toString(16).padStart(32, '0')}`
const consentId = 'breeding-consent:v1:33333333333333333333333333333333'
const projectId = 'breeding-project:v1:11111111111111111111111111111111'
const PROFILE_OWNER = 'profile_owner1234'
const PROFILE_OTHER = 'profile_other1234'
const hashes = {
  ownerTrainer: sha256('trainer-owner:5'),
  breederTrainer: sha256('trainer-breeder:6'),
  otherTrainer: sha256('trainer-other:7'),
  parentA: sha256('pokemon-parent-a:2'),
  parentB: sha256('pokemon-parent-b:3'),
}
const profile = (id: string, trainers: readonly string[]): PlayerProfile => ({
  schemaVersion: 1,
  id: id as any,
  displayName: (id === PROFILE_OWNER ? 'Owner' : 'Other') as any,
  linkedCharacters: trainers.map(sheetSlug => ({ sheetKind: 'trainer' as const, sheetSlug })),
})
const ownerProfile = profile(PROFILE_OWNER, ['trainer-breeder', 'trainer-owner'])
const otherProfile = profile(PROFILE_OTHER, ['trainer-other'])
const command = (kind: 'preview-breeding' | 'create-breeding-project', value = 1, actorProfileId = PROFILE_OWNER) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(value),
  commandKind: kind,
  actor: { profileId: actorProfileId, selectedTrainerSlug: 'trainer-owner' },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: kind === 'create-breeding-project' ? [{ kind: 'breeding-project', projectId, expectedRevision: null }] : [],
  payload: {
    ...(kind === 'create-breeding-project' ? { projectId } : {}),
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: '1'.repeat(64),
    ...(kind === 'create-breeding-project' ? { consentPolicy: 'cross-owner-current-revision-consent' } : {}),
  },
})
const referenceVersions = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '2'.repeat(64),
  semanticRegistryDefinitionSha256: '3'.repeat(64),
  compiledRegistryDefinitionSha256: '4'.repeat(64),
  canonicalIdsDefinitionSha256: '5'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: '1'.repeat(64),
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({ sourceId, contentSha256: (index + 1).toString(16).padStart(64, '0') })),
  contractDefinitionHashes: [
    'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract', 'breeding-operation-contract', 'breeding-project-contract',
    'breeding-read-set-contract', 'breeding-security-policy', 'pokemon-egg-contract',
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 20).toString(16).padStart(64, '0') })),
})
const readResource = (resourceKind: string, resourceId: string, revision: number | null, definitionSha256: string | null, purposes: readonly string[], observedCampaignMinute: number | null = null) => parseBreedingReadResourceV1({ resourceKind, resourceId, existence: definitionSha256 === null ? 'absent' : 'present', revision, definitionSha256, observedCampaignMinute, purposes: [...purposes].sort() })
const dependencies = (checkpoint: 'project-preview' | 'project-creation'): readonly BreedingDependencyEvidenceV1[] => {
  const edge: BreedingDependencyEvidenceV1 = { providerKind: 'edge', providerId: 'Breeder', subjectKind: 'trainer-sheet', subjectId: 'trainer-breeder', subjectRevision: 6, checkpoint, providerDefinitionSha256: EDGE_RECORD, effectiveEvidenceSha256: EDGE_EFFECTIVE }
  return [{ providerKind: 'system', providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign', subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization', providerDefinitionSha256: policy.definitionSha256, effectiveEvidenceSha256: sha256(stableJsonStringify([edge])) }, edge]
}
const setupReadSet = (setupCommand: ReturnType<typeof command>, crossOwner = false) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(setupCommand.operationId.slice(-2), 16) || 1) as any,
  operationId: setupCommand.operationId,
  commandSha256: createBreedingOperationCommandHash(setupCommand),
  commandKind: setupCommand.commandKind,
  capturedAtCampaignMinute: 100,
  resources: [
    readResource('campaign-clock', 'campaign-clock', 4, sha256('clock:4:100'), ['campaign-time'], 100),
    readResource('trainer-sheet', 'trainer-owner', 5, hashes.ownerTrainer, ['authorization']),
    readResource('trainer-sheet', 'trainer-breeder', 6, hashes.breederTrainer, ['mechanics']),
    readResource('pokemon-sheet', 'pokemon-parent-a', 2, hashes.parentA, ['snapshot']),
    readResource('pokemon-sheet', 'pokemon-parent-b', 3, hashes.parentB, ['snapshot']),
    ...(crossOwner ? [readResource('trainer-sheet', 'trainer-other', 7, hashes.otherTrainer, ['consent'])] : []),
    ...(setupCommand.commandKind === 'create-breeding-project' ? [readResource('breeding-project', projectId, null, null, ['conflict'])] : []),
  ],
  referenceVersions: referenceVersions(),
  dependencyEvidence: dependencies(setupCommand.commandKind === 'preview-breeding' ? 'project-preview' : 'project-creation'),
  writeExpectations: setupCommand.scopes,
})
const consentValidationCommand = (value: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(value),
  commandKind: 'advance-breeding-project-time',
  actor: { profileId: PROFILE_OWNER, selectedTrainerSlug: 'trainer-owner' },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [{ kind: 'breeding-project', projectId, expectedRevision: 1 }],
  payload: { projectId, throughClockRevision: 4, throughCampaignMinute: 100 },
})
const consentValidationReadSet = (validationCommand: ReturnType<typeof consentValidationCommand>, consent: ReturnType<typeof createBreedingConsentRecordV1>) => createBreedingOperationReadSetV1({
  readSetId: readSetId(Number.parseInt(validationCommand.operationId.slice(-2), 16)) as any,
  operationId: validationCommand.operationId,
  commandSha256: createBreedingOperationCommandHash(validationCommand),
  commandKind: validationCommand.commandKind,
  capturedAtCampaignMinute: 100,
  resources: [
    readResource('campaign-clock', 'campaign-clock', 4, sha256('clock:4:100'), ['campaign-time'], 100),
    readResource('breeding-project', projectId, 1, sha256('project:1'), ['conflict', 'mechanics']),
    readResource('parent-consent', consent.consentId, consent.revision, consent.definitionSha256, ['consent']),
    readResource('pokemon-sheet', 'pokemon-parent-b', 3, hashes.parentB, ['consent']),
    readResource('trainer-sheet', 'trainer-other', 7, hashes.otherTrainer, ['consent']),
  ],
  referenceVersions: referenceVersions(),
  dependencyEvidence: dependencies('project-creation'),
  writeExpectations: validationCommand.scopes,
})
const actor = (setupCommand: ReturnType<typeof command>, role: 'gm' | 'player' = 'player') => createBreedingActorAuthorityV1({ role, command: setupCommand, authenticatedPrincipalSha256: '7'.repeat(64), authenticationPolicyDefinitionSha256: '8'.repeat(64), profile: role === 'player' ? ownerProfile : null, evaluatedAtCampaignMinute: 100 })
const ownerControl = () => createBreedingTrainerControlEvidenceV1({ profile: ownerProfile, trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 5, trainerSheetDefinitionSha256: hashes.ownerTrainer, evaluatedAtCampaignMinute: 100 })
const breederControl = () => createBreedingTrainerControlEvidenceV1({ profile: ownerProfile, trainerSheetSlug: 'trainer-breeder', trainerSheetRevision: 6, trainerSheetDefinitionSha256: hashes.breederTrainer, evaluatedAtCampaignMinute: 100 })
const otherControl = () => createBreedingTrainerControlEvidenceV1({ profile: otherProfile, trainerSheetSlug: 'trainer-other', trainerSheetRevision: 7, trainerSheetDefinitionSha256: hashes.otherTrainer, evaluatedAtCampaignMinute: 100 })
const parent = (slug: 'pokemon-parent-a' | 'pokemon-parent-b', owner: 'owner' | 'other', control: ReturnType<typeof ownerControl> | ReturnType<typeof otherControl>) => createBreedingParentControlEvidenceV1({
  parentSheetSlug: slug,
  parentSheetRevision: slug.endsWith('a') ? 2 : 3,
  parentSheetDefinitionSha256: slug.endsWith('a') ? hashes.parentA : hashes.parentB,
  ownerTrainer: owner === 'owner'
    ? { slug: 'trainer-owner', revision: 5, definitionSha256: hashes.ownerTrainer, currentTeam: ['pokemon-parent-a', 'pokemon-parent-b'], boxedPokemon: [] }
    : { slug: 'trainer-other', revision: 7, definitionSha256: hashes.otherTrainer, currentTeam: [], boxedPokemon: ['pokemon-parent-b'] },
  trainerControl: control,
  verificationMode: 'profile-control',
  evaluatedAtCampaignMinute: 100,
})
const serverVerifiedOtherParent = () => createBreedingParentControlEvidenceV1({
  parentSheetSlug: 'pokemon-parent-b',
  parentSheetRevision: 3,
  parentSheetDefinitionSha256: hashes.parentB,
  ownerTrainer: { slug: 'trainer-other', revision: 7, definitionSha256: hashes.otherTrainer, currentTeam: [], boxedPokemon: ['pokemon-parent-b'] },
  trainerControl: null,
  verificationMode: 'server-verified-link',
  evaluatedAtCampaignMinute: 100,
})
const breeder = () => {
  const control = breederControl()
  return createBreedingBreederAuthorityEvidenceV1({ breederTrainerSlug: 'trainer-breeder', breederTrainerRevision: 6, breederTrainerDefinitionSha256: hashes.breederTrainer, accessMode: 'profile-control', accessEvidenceDefinitionSha256: control.definitionSha256, edgeCanonicalId: 'Breeder', edgeInstanceId: 'edge-instance:breeder', edgeRecordSha256: EDGE_RECORD, effectiveEdgeProjectionSha256: EDGE_EFFECTIVE, pokemonEducationRank: 'Expert', pokemonEducationSkillTotal: 5, evaluatedAtCampaignMinute: 100 })
}

describe('Breeding actor, control, consent, and GM override contracts', () => {
  it('binds the reviewed authorization policy and narrow Breeder Edge boundary', () => {
    expect(policy).toMatchObject({ schemaVersion: 1, contractId: 'ptu-1.05-breeding-authorization-contract-v1', rulesetDefinitionSha256: ruleset.definitionSha256, sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))) })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.gmOverride.kinds).toEqual(BREEDING_GM_OVERRIDE_KINDS)
    expect(policy.definition.authorizationReceipt.reasonIds).toEqual(BREEDING_AUTHORIZATION_REASON_IDS)
    expect(policy.definition.authority).toMatchObject({ serverDerivedOnly: true, clientEvidence: 'reject', mapEncounter: 'not-consulted' })
  })

  it('derives current Profile-to-Trainer and Trainer-to-parent control without map authority', () => {
    const control = ownerControl()
    const parentEvidence = parent('pokemon-parent-a', 'owner', control)
    expect(control).toMatchObject({ profileId: PROFILE_OWNER, trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 5 })
    expect(parentEvidence).toMatchObject({ ownerTrainerSlug: 'trainer-owner', rosterField: 'current-team', verificationMode: 'profile-control', trainerControlEvidenceDefinitionSha256: control.definitionSha256 })
    expect(() => createBreedingTrainerControlEvidenceV1({ profile: ownerProfile, trainerSheetSlug: 'trainer-other', trainerSheetRevision: 7, trainerSheetDefinitionSha256: hashes.otherTrainer, evaluatedAtCampaignMinute: 100 })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.profile-stale' }))
    expect(() => createBreedingParentControlEvidenceV1({ parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 2, parentSheetDefinitionSha256: hashes.parentA, ownerTrainer: { slug: 'trainer-owner', revision: 5, definitionSha256: hashes.ownerTrainer, currentTeam: ['pokemon-parent-a'], boxedPokemon: ['pokemon-parent-a'] }, trainerControl: control, verificationMode: 'profile-control', evaluatedAtCampaignMinute: 100 })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.parent-link-stale' }))
  })

  it('authorizes same-owner setup only with exact actor, owner, breeder, parent, read-set, and Edge evidence', () => {
    const setupCommand = command('preview-breeding', 10)
    const control = ownerControl()
    const breederAccess = breederControl()
    const result = authorizeBreedingProjectSetupV1({ command: setupCommand, readSet: setupReadSet(setupCommand), actorAuthority: actor(setupCommand), ownerTrainerControl: control, breederAuthority: createBreedingBreederAuthorityEvidenceV1({ ...breeder(), accessEvidenceDefinitionSha256: breederAccess.definitionSha256 }), breederTrainerControl: breederAccess, parents: [{ parentControl: parent('pokemon-parent-a', 'owner', control), ownerTrainerControl: control, consentEvidence: null }, { parentControl: parent('pokemon-parent-b', 'owner', control), ownerTrainerControl: control, consentEvidence: null }], gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(result).toMatchObject({ authorized: true, reasonId: 'breeding.authorization.authorized', commandKind: 'preview-breeding' })
    expect(parseAuthoritativeBreedingAuthorizationReceiptV1(result)).toEqual(result)
    expect(assertBreedingAuthorizationReceiptExactReplay(result, structuredClone(result))).toEqual(result)
    const withoutBreeder = authorizeBreedingProjectSetupV1({ command: setupCommand, readSet: setupReadSet(setupCommand), actorAuthority: actor(setupCommand), ownerTrainerControl: control, breederAuthority: null, breederTrainerControl: null, parents: [{ parentControl: parent('pokemon-parent-a', 'owner', control), ownerTrainerControl: control, consentEvidence: null }, { parentControl: parent('pokemon-parent-b', 'owner', control), ownerTrainerControl: control, consentEvidence: null }], gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(withoutBreeder).toMatchObject({ authorized: false, reasonId: 'breeding.authorization.breeder-edge-required' })
  })

  it('denies cross-owner mechanics preview before a consent-bearing project exists', () => {
    const preview = command('preview-breeding', 11)
    const owner = ownerControl(); const breederAccess = breederControl()
    const result = authorizeBreedingProjectSetupV1({ command: preview, readSet: setupReadSet(preview, true), actorAuthority: actor(preview), ownerTrainerControl: owner, breederAuthority: createBreedingBreederAuthorityEvidenceV1({ ...breeder(), accessEvidenceDefinitionSha256: breederAccess.definitionSha256 }), breederTrainerControl: breederAccess, parents: [{ parentControl: parent('pokemon-parent-a', 'owner', owner), ownerTrainerControl: owner, consentEvidence: null }, { parentControl: serverVerifiedOtherParent(), ownerTrainerControl: null, consentEvidence: null }], gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(result).toMatchObject({ authorized: false, reasonId: 'breeding.authorization.consent-required' })
  })

  it('creates an awaiting-consent project, then revalidates positive consent for the exact later operation', () => {
    const create = command('create-breeding-project', 12)
    const owner = ownerControl(); const other = otherControl(); const breederAccess = breederControl()
    const parentA = parent('pokemon-parent-a', 'owner', owner); const controlledParentB = parent('pokemon-parent-b', 'other', other)
    const result = authorizeBreedingProjectSetupV1({ command: create, readSet: setupReadSet(create, true), actorAuthority: actor(create), ownerTrainerControl: owner, breederAuthority: createBreedingBreederAuthorityEvidenceV1({ ...breeder(), accessEvidenceDefinitionSha256: breederAccess.definitionSha256 }), breederTrainerControl: breederAccess, parents: [{ parentControl: parentA, ownerTrainerControl: owner, consentEvidence: null }, { parentControl: serverVerifiedOtherParent(), ownerTrainerControl: null, consentEvidence: null }], gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(result).toMatchObject({ authorized: true, reasonId: 'breeding.authorization.authorized' })
    const consent = createBreedingConsentRecordV1({ schemaVersion: 1, consentId: consentId as any, projectId: projectId as any, parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3, ownerTrainerSlug: 'trainer-other', consentingProfileId: PROFILE_OTHER, scopes: [...BREEDING_CONSENT_SCOPES].sort() as any, grantedAtCampaignMinute: 90, expiresAtCampaignMinute: 200, grantOperationId: op(90) as any, grantCommandSha256: '9'.repeat(64) })
    const laterCommand = consentValidationCommand(92); const laterCommandHash = createBreedingOperationCommandHash(laterCommand)
    const consentEvidence = createBreedingCrossOwnerConsentEvidenceV1({ consent, projectId, parentControl: controlledParentB, trainerControl: other, validationOperationId: laterCommand.operationId, validationCommandSha256: laterCommandHash, validatedAtCampaignMinute: 100 })
    expect(validateBreedingCrossOwnerConsentEvidenceForOperationV1({ consentEvidence, projectId, parentControl: controlledParentB, trainerControl: other, command: laterCommand, readSet: consentValidationReadSet(laterCommand, consent) })).toEqual(consentEvidence)
    const otherCommand = consentValidationCommand(93)
    expect(() => validateBreedingCrossOwnerConsentEvidenceForOperationV1({ consentEvidence, projectId, parentControl: controlledParentB, trainerControl: other, command: otherCommand, readSet: consentValidationReadSet(otherCommand, consent) })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.consent-stale' }))
    const revoked = createBreedingConsentRevisionV1({ ...consent, revision: 1, status: 'revoked', settledAtCampaignMinute: 99, settlementOperationId: op(91) as any, settlementCommandSha256: 'a'.repeat(64), settlementReasonId: 'breeding.consent.revoked' })
    expect(() => createBreedingCrossOwnerConsentEvidenceV1({ consent: revoked, projectId, parentControl: controlledParentB, trainerControl: other, validationOperationId: laterCommand.operationId, validationCommandSha256: laterCommandHash, validatedAtCampaignMinute: 100 })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.consent-stale' }))
  })

  it('requires command-bound, reasoned, target-typed GM override evidence', () => {
    const gmCommand = command('preview-breeding', 13, 'campaign-gm')
    const gmActor = actor(gmCommand, 'gm')
    const override = createBreedingGmOverrideEvidenceV1({ overrideId: overrideId(1) as any, command: gmCommand, actorAuthority: gmActor, overrideKind: 'owner-control', target: { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-owner' }, reasonId: 'breeding.override.owner-approved', createdAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(override).toMatchObject({ overrideKind: 'owner-control', operationId: gmCommand.operationId, actorAuthorityDefinitionSha256: gmActor.definitionSha256 })
    const gmOverride = (value: number, overrideKind: 'breeder-access' | 'cross-owner-consent' | 'parent-control', target: { kind: 'trainer-sheet', trainerSheetSlug: string } | { kind: 'parent-sheet', parentSheetSlug: string, parentSheetRevision: number }) => createBreedingGmOverrideEvidenceV1({ overrideId: overrideId(value) as any, command: gmCommand, actorAuthority: gmActor, overrideKind, target, reasonId: `breeding.override.${overrideKind}`, createdAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })
    const breederAccessOverride = gmOverride(2, 'breeder-access', { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-breeder' })
    const parentAOverride = gmOverride(3, 'parent-control', { kind: 'parent-sheet', parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 2 })
    const parentBOverride = gmOverride(4, 'parent-control', { kind: 'parent-sheet', parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 3 })
    const gmParent = (slug: 'pokemon-parent-a' | 'pokemon-parent-b') => createBreedingParentControlEvidenceV1({ parentSheetSlug: slug, parentSheetRevision: slug.endsWith('a') ? 2 : 3, parentSheetDefinitionSha256: slug.endsWith('a') ? hashes.parentA : hashes.parentB, ownerTrainer: { slug: 'trainer-owner', revision: 5, definitionSha256: hashes.ownerTrainer, currentTeam: ['pokemon-parent-a', 'pokemon-parent-b'], boxedPokemon: [] }, trainerControl: null, verificationMode: 'gm-verified', evaluatedAtCampaignMinute: 100 })
    const gmBreeder = createBreedingBreederAuthorityEvidenceV1({ ...breeder(), accessMode: 'gm-authority', accessEvidenceDefinitionSha256: gmActor.definitionSha256 })
    const authorized = authorizeBreedingProjectSetupV1({ command: gmCommand, readSet: setupReadSet(gmCommand), actorAuthority: gmActor, ownerTrainerControl: null, breederAuthority: gmBreeder, breederTrainerControl: null, parents: [{ parentControl: gmParent('pokemon-parent-a'), ownerTrainerControl: null, consentEvidence: null }, { parentControl: gmParent('pokemon-parent-b'), ownerTrainerControl: null, consentEvidence: null }], gmOverrides: [override, breederAccessOverride, parentAOverride, parentBOverride], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(authorized).toMatchObject({ authorized: true, reasonId: 'breeding.authorization.authorized' })
    const extraneous = gmOverride(5, 'cross-owner-consent', { kind: 'parent-sheet', parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 2 })
    const denied = authorizeBreedingProjectSetupV1({ command: gmCommand, readSet: setupReadSet(gmCommand), actorAuthority: gmActor, ownerTrainerControl: null, breederAuthority: gmBreeder, breederTrainerControl: null, parents: [{ parentControl: gmParent('pokemon-parent-a'), ownerTrainerControl: null, consentEvidence: null }, { parentControl: gmParent('pokemon-parent-b'), ownerTrainerControl: null, consentEvidence: null }], gmOverrides: [override, breederAccessOverride, parentAOverride, parentBOverride, extraneous], securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(denied).toMatchObject({ authorized: false, reasonId: 'breeding.authorization.gm-override-invalid' })
    expect(() => parseBreedingGmOverrideEvidenceV1({ ...override, target: { kind: 'parent-sheet', parentSheetSlug: 'pokemon-parent-a', parentSheetRevision: 2 } })).toThrow(BreedingAuthorizationValidationError)
    expect(() => createBreedingGmOverrideEvidenceV1({ overrideId: overrideId(2) as any, command: gmCommand, actorAuthority: actor(gmCommand), overrideKind: 'owner-control', target: { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-owner' }, reasonId: 'breeding.override.owner-approved', createdAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })).toThrow(BreedingAuthorizationAuthorityError)
  })

  it('rejects actor drift, invented Breeder labels, unknown fields, and hash tampering', () => {
    const setupCommand = command('preview-breeding', 14)
    const drift = structuredClone(setupCommand)
    ;(drift.actor as any).profileId = PROFILE_OTHER
    expect(() => createBreedingActorAuthorityV1({ role: 'player', command: drift, authenticatedPrincipalSha256: '7'.repeat(64), authenticationPolicyDefinitionSha256: '8'.repeat(64), profile: ownerProfile, evaluatedAtCampaignMinute: 100 })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.actor-mismatch' }))
    expect(() => parseBreedingBreederAuthorityEvidenceV1({ ...breeder(), edgeCanonicalId: 'Super Breeder' })).toThrow(BreedingAuthorizationValidationError)
    expect(() => parseBreedingBreederAuthorityEvidenceV1({ ...breeder(), mapSlug: 'arena' })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.unknown-field' }))
    const valid = actor(setupCommand)
    expect(() => authorizeBreedingProjectSetupV1({ command: setupCommand, readSet: setupReadSet(setupCommand), actorAuthority: { ...valid, definitionSha256: '0'.repeat(64) }, ownerTrainerControl: null, breederAuthority: null, breederTrainerControl: null, parents: [] as any, gmOverrides: [], securityPolicyDefinitionSha256: security.definitionSha256 })).toThrowError(expect.objectContaining({ code: 'breeding.authorization.hash-mismatch' }))
  })
})
