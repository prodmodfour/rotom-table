import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import canonicalIdsJson from '../../data/breeding-automation/canonical-ids.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityJson from '../../data/breeding-automation/security-policy.json'
import semanticRegistryJson from '../../data/breeding-automation/semantic-registry.json'
import sourceManifestJson from '../../data/breeding-automation/source-manifest.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingProductionSnapshotProjectionV1, parseBreedingProductionSnapshotV1 } from '../../shared/breeding/productionSnapshots'
import { BREEDING_REFERENCE_SOURCE_IDS, breedingDependencyEvidenceKey, parseBreedingReadResourceV1, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  createBreedingAuthorizationReceiptV1,
  createBreedingBreederAuthorityEvidenceV1,
  createBreedingCrossOwnerConsentEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import { BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256 } from '../../server/domain/breeding/compatibility'
import { createBreedingCheckRecordFromRoll, createBreedingConsentRecordV1, createBreedingRollRecordFromInjectedValues } from '../../server/domain/breeding/ledgers'
import { createBreederSnapshotV1, createBreedingParentSnapshotV1 } from '../../server/domain/breeding/lineage'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { breedingProjectDocumentDefinitionSha256 } from '../../server/domain/breeding/projectInitialProgress'
import {
  BREEDING_PROVIDER_SNAPSHOT_DEPENDENCY_PROVIDER_ID,
  BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION_SHA256,
  createBreedingProductionSnapshotV1,
  createBreedingProviderContributionSnapshotV1,
  createBreedingProviderSnapshotV1,
  parseAuthoritativeBreedingProductionSnapshotV1,
  projectBreedingProductionSnapshotV1,
} from '../../server/domain/breeding/productionSnapshots'
import { compiledBreedingSpeciesSpec, COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { parseBreedingProjectDocumentV1 } from '../../shared/breeding/project'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const security = securityJson as { readonly definitionSha256: string }
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const PROJECT_ID = 'breeding-project:v1:33333333333333333333333333333333'
const EGG_ID = 'pokemon-egg:v1:44444444444444444444444444444444'
const OPTION = resolveBreedingCampaignOptionSnapshot({
  'breeding.maturity-policy': 'minimum-level',
  'breeding.minimum-maturity-level': 20,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const checkId = (value: number): string => `breeding-check:v1:${value.toString(16).padStart(32, '0')}`
const rollId = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `breeding-consent:v1:${value.toString(16).padStart(32, '0')}`
const resolveCommand = parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(9),
  commandKind: 'resolve-breeding-check',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 0 }],
  payload: { projectId: PROJECT_ID, checkRecordId: checkId(9) },
})
const produceCommand = (revision = 2) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(20),
  commandKind: 'produce-egg',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [
    { kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision },
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null },
  ],
  payload: { projectId: PROJECT_ID, eggId: EGG_ID, resolutions: { selectedOptionIds: [], requestedRollKinds: [] } },
})
const successfulCheck = () => {
  const commandSha256 = createBreedingOperationCommandHash(resolveCommand)
  const roll = createBreedingRollRecordFromInjectedValues({
    schemaVersion: 1,
    rollRecordId: rollId(9) as never,
    operationId: resolveCommand.operationId,
    commandSha256,
    operationRollOrdinal: 0,
    purpose: 'breeder-check-d20',
    target: { kind: 'breeding-project', projectId: PROJECT_ID as never, revision: 0 },
    formula: '1d20',
    dieCount: 1,
    dieSides: 20,
    ordered: false,
    modifier: 0,
    values: [7],
    generatorId: 'server-rng-v1',
    sourceDefinitionHashes: [ruleset.definitionSha256],
    generatedAtCampaignMinute: 300,
  })
  return createBreedingCheckRecordFromRoll({
    checkRecordId: checkId(9) as never,
    operationId: resolveCommand.operationId,
    commandSha256,
    projectId: PROJECT_ID as never,
    projectRevision: 0,
    breederSnapshotDefinitionSha256: 'a'.repeat(64),
    authoritativeSkillTotal: 5,
    roll,
    rulesetDefinitionSha256: ruleset.definitionSha256,
    resolvedAtCampaignMinute: 300,
  })
}
const readyProject = (crossOwner = false) => {
  const check = successfulCheck()
  return parseBreedingProjectDocumentV1({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    revision: 2,
    status: 'ready-to-produce',
    ruleset: rulesetRef,
    projectCreationOptionSnapshotSha256: OPTION.definitionSha256,
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', ownerTrainerSlug: crossOwner ? 'trainer-other' : 'trainer-owner', expectedSheetRevision: 3 },
    ],
    consentPolicy: crossOwner ? 'cross-owner-current-revision-consent' : 'same-owner-control',
    timeline: {
      initialRequiredCampaignMinutes: 240,
      initialAccumulatedCampaignMinutes: 240,
      additionalRequiredCampaignMinutes: 240,
      additionalAccumulatedCampaignMinutes: 240,
      initialStartedAtCampaignMinute: 0,
      checkReadyAtCampaignMinute: 240,
      additionalStartedAtCampaignMinute: 300,
      readyToProduceAtCampaignMinute: 540,
      eggProducedAtCampaignMinute: null,
      lastAppliedClockRevision: 3,
      lastAppliedClockMinute: 600,
    },
    check: { checkRecordId: check.checkRecordId, outcome: 'success', resolvedAtCampaignMinute: 300 },
    producedEggId: null,
    terminal: null,
    createdAtCampaignMinute: 0,
    updatedAtCampaignMinute: 600,
    statusChangedAtCampaignMinute: 600,
    lastOperationId: operationId(8),
  })
}
const parentSnapshot = (index: 0 | 1, crossOwner = false, controlEvidenceDefinitionSha256?: string) => {
  const spec = compiledBreedingSpeciesSpec('bulbasaur')!
  const sourceHash = index === 0 ? '2'.repeat(64) : '3'.repeat(64)
  return createBreedingParentSnapshotV1({
    schemaVersion: 1,
    parentIndex: index,
    pokemonSheetSlug: index === 0 ? 'pokemon-parent-a' : 'pokemon-parent-b',
    displayNameAtSnapshot: index === 0 ? 'Garden Parent' : 'Meadow Parent',
    ownerTrainerSlug: index === 1 && crossOwner ? 'trainer-other' : 'trainer-owner',
    sheetRevision: index === 0 ? 2 : 3,
    sourceSheetSha256: sourceHash,
    speciesId: 'bulbasaur',
    familyRootSpeciesId: spec.familyRootSpeciesId,
    speciesSpecDefinitionSha256: spec.definitionSha256,
    genderId: index === 0 ? 'female' : 'male',
    roleId: index === 0 ? 'female-parent' : 'male-parent',
    roleEvidenceDefinitionSha256: BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
    level: 25,
    maturity: {
      policyId: 'minimum-level', minimumLevel: 20, gmConfirmed: null, eligible: true,
      evidenceDefinitionSha256: OPTION.definitionSha256,
    },
    eggGroupIds: spec.eggGroupIds,
    effectiveKnownMoves: [],
    controlEvidenceDefinitionSha256: controlEvidenceDefinitionSha256 ?? (index === 0 ? 'c'.repeat(64) : 'd'.repeat(64)),
    capturedAtCampaignMinute: 600,
  })
}
const breederAuthority = () => createBreedingBreederAuthorityEvidenceV1({
  schemaVersion: 1,
  breederTrainerSlug: 'trainer-breeder',
  breederTrainerRevision: 5,
  breederTrainerDefinitionSha256: '5'.repeat(64),
  accessMode: 'profile-control',
  accessEvidenceDefinitionSha256: '6'.repeat(64),
  edgeCanonicalId: 'Breeder',
  edgeInstanceId: 'edge-instance:breeder',
  edgeRecordSha256: '7'.repeat(64),
  effectiveEdgeProjectionSha256: '8'.repeat(64),
  pokemonEducationRank: 'Expert',
  pokemonEducationSkillTotal: 5,
  evaluatedAtCampaignMinute: 600,
})
const readResource = (
  resourceKind: string,
  resourceId: string,
  revision: number | null,
  definitionSha256: string | null,
  purposes: readonly string[],
  observedCampaignMinute: number | null = null,
) => parseBreedingReadResourceV1({
  resourceKind,
  resourceId,
  existence: definitionSha256 === null ? 'absent' : 'present',
  revision,
  definitionSha256,
  observedCampaignMinute,
  purposes: [...purposes].sort(),
})
const manifestHashBySource = new Map((sourceManifestJson.runtimeSources as readonly { readonly path: string, readonly sha256: string }[])
  .map(entry => [entry.path.split('/').at(-1)!.replace('pokemonExperienceChart', 'pokemon-experience-chart').replace(/\.json$/u, ''), entry.sha256]))
const references = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: canonicalIdsJson.sourceManifestSha256,
  semanticRegistryDefinitionSha256: semanticRegistryJson.definitionSha256,
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: canonicalIdsJson.definitionSha256,
  campaignOptionSnapshotDefinitionSha256: OPTION.definitionSha256,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map(sourceId => ({ sourceId, contentSha256: manifestHashBySource.get(sourceId)! })),
  contractDefinitionHashes: [
    'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract',
    'breeding-operation-contract', 'breeding-project-contract', 'breeding-read-set-contract',
    'breeding-security-policy', 'pokemon-egg-contract',
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 20).toString(16).padStart(64, '0') })),
})
const dependencySet = (actual: readonly BreedingDependencyEvidenceV1[]): readonly BreedingDependencyEvidenceV1[] => {
  const ordered = [...actual].sort((left, right) => breedingDependencyEvidenceKey(left).localeCompare(breedingDependencyEvidenceKey(right)))
  return [{
    providerKind: 'system',
    providerId: 'breeding-effective-dependency-set-v1',
    subjectKind: 'campaign',
    subjectId: 'campaign',
    subjectRevision: null,
    checkpoint: 'authorization',
    providerDefinitionSha256: '08d98ea79e07355a87956a937637db442fd0b984be7abf51e2d731a926104c99',
    effectiveEvidenceSha256: sha256(ordered),
  }, ...ordered]
}
const otherProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_other_0001',
  displayName: 'Other Parent Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }],
}
const crossOwnerConsent = (command: ReturnType<typeof produceCommand>) => {
  const grantCommand = parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: operationId(21),
    commandKind: 'grant-breeding-consent',
    actor: { profileId: otherProfile.id, selectedTrainerSlug: 'trainer-other' },
    ruleset: rulesetRef,
    scopes: [
      { kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 2 },
      { kind: 'parent-consent', consentId: consentId(1), expectedRevision: null },
    ],
    payload: {
      projectId: PROJECT_ID,
      consentId: consentId(1),
      parentSheetSlug: 'pokemon-parent-b',
      parentSheetRevision: 3,
      consentScopes: [...BREEDING_CONSENT_SCOPES].sort(),
      expiresAtCampaignMinute: 700,
    },
  })
  const record = createBreedingConsentRecordV1({
    schemaVersion: 1,
    consentId: consentId(1) as never,
    projectId: PROJECT_ID as never,
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    ownerTrainerSlug: 'trainer-other',
    consentingProfileId: otherProfile.id,
    scopes: [...BREEDING_CONSENT_SCOPES].sort() as never,
    grantedAtCampaignMinute: 500,
    expiresAtCampaignMinute: 700,
    grantOperationId: grantCommand.operationId,
    grantCommandSha256: createBreedingOperationCommandHash(grantCommand),
  })
  const trainerControl = createBreedingTrainerControlEvidenceV1({
    profile: otherProfile,
    trainerSheetSlug: 'trainer-other',
    trainerSheetRevision: 7,
    trainerSheetDefinitionSha256: 'f'.repeat(64),
    evaluatedAtCampaignMinute: 600,
  })
  const parentControl = createBreedingParentControlEvidenceV1({
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    parentSheetDefinitionSha256: '3'.repeat(64),
    ownerTrainer: {
      slug: 'trainer-other', revision: 7, definitionSha256: 'f'.repeat(64),
      currentTeam: ['pokemon-parent-b'], boxedPokemon: [],
    },
    trainerControl,
    verificationMode: 'profile-control',
    evaluatedAtCampaignMinute: 600,
  })
  const evidence = createBreedingCrossOwnerConsentEvidenceV1({
    consent: record,
    projectId: PROJECT_ID,
    parentControl,
    trainerControl,
    validationOperationId: command.operationId,
    validationCommandSha256: createBreedingOperationCommandHash(command),
    validatedAtCampaignMinute: 600,
  })
  return { record, evidence }
}
const build = (options: { readonly crossOwner?: boolean, readonly withConsent?: boolean, readonly withProvider?: boolean } = {}) => {
  const project = readyProject(options.crossOwner)
  const check = successfulCheck()
  const command = produceCommand(project.revision)
  const authority = breederAuthority()
  const consent = options.crossOwner && options.withConsent ? crossOwnerConsent(command) : null
  const providerDependency: BreedingDependencyEvidenceV1 | null = options.withProvider ? {
    providerKind: 'feature',
    providerId: 'playing-god',
    subjectKind: 'trainer-sheet',
    subjectId: 'trainer-breeder',
    subjectRevision: 5,
    checkpoint: 'egg-acceptance',
    providerDefinitionSha256: '9'.repeat(64),
    effectiveEvidenceSha256: 'a'.repeat(64),
  } : null
  const contribution = providerDependency ? createBreedingProviderContributionSnapshotV1({
    inventoryEntryId: 'feature:Playing God',
    contributionId: 'nature-choice',
    providerKind: providerDependency.providerKind,
    providerId: providerDependency.providerId,
    subjectKind: providerDependency.subjectKind,
    subjectId: providerDependency.subjectId,
    subjectRevision: providerDependency.subjectRevision,
    checkpoint: providerDependency.checkpoint,
    value: { kind: 'flag', enabled: true },
    providerDefinitionSha256: providerDependency.providerDefinitionSha256,
    effectiveEvidenceSha256: providerDependency.effectiveEvidenceSha256,
  }) : null
  const providerSnapshot = createBreedingProviderSnapshotV1({
    checkpoint: 'egg-acceptance',
    capturedAtCampaignMinute: 600,
    contributions: contribution ? [contribution] : [],
  })
  const breeder = createBreederSnapshotV1({
    schemaVersion: 1,
    trainerSheetSlug: authority.breederTrainerSlug,
    sheetRevision: authority.breederTrainerRevision,
    sourceSheetSha256: authority.breederTrainerDefinitionSha256,
    pokemonEducationRank: authority.pokemonEducationRank,
    permissionEvidenceIds: [authority.edgeInstanceId],
    providerSnapshotDefinitionSha256: providerSnapshot.definitionSha256,
    capturedAtCampaignMinute: 600,
  })
  const parents = [
    parentSnapshot(0, options.crossOwner),
    parentSnapshot(1, options.crossOwner, consent?.evidence.definitionSha256),
  ] as const
  const edgeDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'edge',
    providerId: 'Breeder',
    subjectKind: 'trainer-sheet',
    subjectId: authority.breederTrainerSlug,
    subjectRevision: authority.breederTrainerRevision,
    checkpoint: 'egg-acceptance',
    providerDefinitionSha256: authority.edgeRecordSha256,
    effectiveEvidenceSha256: authority.effectiveEdgeProjectionSha256,
  }
  const snapshotDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system',
    providerId: BREEDING_PROVIDER_SNAPSHOT_DEPENDENCY_PROVIDER_ID,
    subjectKind: 'project',
    subjectId: project.projectId,
    subjectRevision: project.revision,
    checkpoint: 'egg-acceptance',
    providerDefinitionSha256: BREEDING_PROVIDER_SNAPSHOT_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: providerSnapshot.definitionSha256,
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(20) as never,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: 600,
    resources: [
      readResource('campaign-clock', 'campaign-clock', 3, sha256({ schemaVersion: 1, revision: 3, campaignMinute: 600, lastOperationId: operationId(8) }), ['campaign-time'], 600),
      readResource('breeding-check', check.checkRecordId, null, check.definitionSha256, ['mechanics']),
      readResource('breeding-project', project.projectId, project.revision, breedingProjectDocumentDefinitionSha256(project), ['conflict', 'mechanics']),
      readResource('pokemon-egg', EGG_ID, null, null, ['conflict']),
      ...parents.map(parent => readResource('pokemon-sheet', parent.pokemonSheetSlug, parent.sheetRevision, parent.sourceSheetSha256, ['snapshot'])),
      readResource('trainer-sheet', authority.breederTrainerSlug, authority.breederTrainerRevision, authority.breederTrainerDefinitionSha256, ['mechanics']),
      ...(consent ? [readResource('parent-consent', consent.record.consentId, consent.record.revision, consent.record.definitionSha256, ['consent'])] : []),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([edgeDependency, snapshotDependency, ...(providerDependency ? [providerDependency] : [])]),
    writeExpectations: command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: 'b'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [
      authority.definitionSha256,
      providerSnapshot.definitionSha256,
      ...parents.map(parent => parent.controlEvidenceDefinitionSha256),
      ...(contribution ? [contribution.definitionSha256] : []),
    ],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: 600,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  const input = {
    project,
    check,
    command,
    readSet,
    authorizationReceipt: receipt,
    campaignOptionSnapshot: OPTION,
    parents,
    breeder,
    breederAuthority: authority,
    providerSnapshot,
    consentEvidence: consent ? [consent.evidence] : [],
    roleOverride: null,
    roleOverrideEvidenceDefinitionSha256: null,
  }
  return { ...input, receipt, contribution }
}

describe('reviewed Breeding production snapshots', () => {
  it('freezes exact parent, Breeder, provider, reference, and full campaign-option facts at Egg acceptance', () => {
    const fixture = build({ withProvider: true })
    const snapshot = createBreedingProductionSnapshotV1(fixture)
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      checkpoint: 'egg-acceptance',
      projectId: PROJECT_ID,
      projectRevision: 2,
      checkRecordId: checkId(9),
      capturedAtCampaignMinute: 600,
      parents: [{ parentIndex: 0, sheetRevision: 2 }, { parentIndex: 1, sheetRevision: 3 }],
      breeder: { trainerSheetSlug: 'trainer-breeder', sheetRevision: 5, pokemonEducationRank: 'Expert' },
      providerSnapshot: { checkpoint: 'egg-acceptance', contributions: [{ contributionId: 'nature-choice' }] },
    })
    expect(snapshot.campaignOptionSnapshot.entries).toHaveLength(15)
    expect(snapshot.referenceSnapshot.referenceSources).toHaveLength(13)
    expect(snapshot.acceptedDefinitionHashes).toContain(snapshot.campaignOptionSnapshot.definitionSha256)
    expect(snapshot.acceptedDefinitionHashes).toContain(snapshot.parents[0].definitionSha256)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.parents[0].effectiveKnownMoves)).toBe(true)
  })

  it('emits only a bounded owner/GM summary and never projects private snapshot mechanics or identities', () => {
    const snapshot = createBreedingProductionSnapshotV1(build({ withProvider: true }))
    const projection = projectBreedingProductionSnapshotV1({ snapshot, audience: 'owner' })
    expect(projection).toEqual({
      schemaVersion: 1,
      audience: 'owner',
      status: 'frozen',
      checkpoint: 'egg-acceptance',
      capturedAtCampaignMinute: 600,
      snapshotKinds: ['breeder', 'campaign-options', 'parents', 'providers', 'references'],
    })
    expect(JSON.stringify(projection)).not.toMatch(/project|pokemon-|trainer|profile|consent|move|species|rank|edge|feature|item|hash|command|readSet/iu)
  })

  it('accepts only reviewed inventory contributions matched to exact read-set dependencies and receipt evidence', () => {
    const fixture = build({ withProvider: true })
    expect(() => createBreedingProductionSnapshotV1(fixture)).not.toThrow()
    expect(() => createBreedingProviderContributionSnapshotV1({
      inventoryEntryId: 'feature:Playing God',
      contributionId: 'free-text-patch',
      providerKind: 'feature',
      providerId: 'playing-god',
      subjectKind: 'trainer-sheet',
      subjectId: 'trainer-breeder',
      subjectRevision: 5,
      checkpoint: 'egg-acceptance',
      value: { kind: 'flag', enabled: true },
      providerDefinitionSha256: '9'.repeat(64),
      effectiveEvidenceSha256: 'a'.repeat(64),
    })).toThrow(/not a reviewed modifier-inventory contribution/)
    const missingReceipt = { ...fixture, authorizationReceipt: createBreedingAuthorizationReceiptV1({
      ...fixture.receipt,
      evidenceDefinitionHashes: fixture.receipt.evidenceDefinitionHashes.filter(hash => hash !== fixture.contribution!.definitionSha256),
    }) }
    expect(() => createBreedingProductionSnapshotV1(missingReceipt)).toThrow(/authorization-receipt evidence hash/)
  })

  it('fails closed on stale parent revisions, source hashes, compiled specs, roles, and Move-provider evidence', () => {
    const fixture = build()
    expect(() => createBreedingProductionSnapshotV1({
      ...fixture,
      parents: [{ ...fixture.parents[0], sheetRevision: 99 }, fixture.parents[1]],
    } as never)).toThrow(/does not match|Parent snapshots/)
    expect(() => createBreedingProductionSnapshotV1({
      ...fixture,
      parents: [{ ...fixture.parents[0], speciesSpecDefinitionSha256: 'f'.repeat(64) }, fixture.parents[1]],
    } as never)).toThrow(/does not match|Parent snapshots/)
    const {
      definitionSha256: _parentHash,
      effectiveMoveSnapshotDefinitionSha256: _moveHash,
      ...parentDefinition
    } = fixture.parents[0]
    const enrichedMoveParent = createBreedingParentSnapshotV1({
      ...parentDefinition,
      effectiveKnownMoves: [{ moveId: 'light-screen', evidence: [{
        evidenceId: 'forged-provider-move', sourceKind: 'effective-provider', sourceId: 'forged-provider', sourceDefinitionSha256: 'f'.repeat(64),
      }] }],
    })
    expect(() => createBreedingProductionSnapshotV1({ ...fixture, parents: [enrichedMoveParent, fixture.parents[1]] }))
      .toThrow(/effective Moves/)
  })

  it('rejects stale Breeder rank, Trainer revision, provider hash, or effective Edge authority', () => {
    const fixture = build()
    const { definitionSha256: _breederHash, ...breederDefinition } = fixture.breeder
    const staleBreeder = createBreederSnapshotV1({
      ...breederDefinition,
      pokemonEducationRank: 'Master',
    })
    expect(() => createBreedingProductionSnapshotV1({ ...fixture, breeder: staleBreeder })).toThrow(/Breeder snapshot/)
    expect(() => createBreedingProductionSnapshotV1({
      ...fixture,
      breederAuthority: { ...fixture.breederAuthority, effectiveEdgeProjectionSha256: 'f'.repeat(64) },
    } as never)).toThrow(/does not match|Breeder snapshot/)
  })

  it('requires current positive cross-owner consent reads even when GM override IDs are present', () => {
    const missing = build({ crossOwner: true })
    expect(() => createBreedingProductionSnapshotV1(missing)).toThrow(/positive consent/)
    const current = build({ crossOwner: true, withConsent: true })
    expect(() => createBreedingProductionSnapshotV1(current)).not.toThrow()
    const overrideOnly = {
      ...missing,
      authorizationReceipt: createBreedingAuthorizationReceiptV1({
        ...missing.receipt,
        gmOverrideIds: ['breeding-override:v1:11111111111111111111111111111111'] as never,
      }),
    }
    expect(() => createBreedingProductionSnapshotV1(overrideOnly)).toThrow(/positive consent/)
  })

  it('rejects changed campaign options and stale app-owned reference snapshots', () => {
    const fixture = build()
    expect(() => createBreedingProductionSnapshotV1({
      ...fixture,
      campaignOptionSnapshot: resolveBreedingCampaignOptionSnapshot(),
    })).toThrow(/campaign options|Project/)
    const staleReference = createBreedingReferenceVersionSnapshotV1({
      ...fixture.readSet.referenceVersions,
      semanticRegistryDefinitionSha256: 'f'.repeat(64),
    })
    const staleReadSet = createBreedingOperationReadSetV1({ ...fixture.readSet, referenceVersions: staleReference })
    const receipt = createBreedingAuthorizationReceiptV1({ ...fixture.receipt, readSetDefinitionSha256: staleReadSet.definitionSha256 })
    expect(() => createBreedingProductionSnapshotV1({ ...fixture, readSet: staleReadSet, authorizationReceipt: receipt }))
      .toThrow(/Reference snapshot/)
  })

  it('deeply detaches accepted values so later source mutation cannot rewrite the frozen checkpoint', () => {
    const fixture = build({ withProvider: true })
    const snapshot = createBreedingProductionSnapshotV1(fixture)
    const mutable = structuredClone(snapshot)
    mutable.parents[0]!.displayNameAtSnapshot = 'Changed Later'
    mutable.campaignOptionSnapshot.entries[0]!.value = 'changed'
    expect(snapshot.parents[0].displayNameAtSnapshot).toBe('Garden Parent')
    expect(snapshot.campaignOptionSnapshot.entries[0]!.value).not.toBe('changed')
    expect(() => parseAuthoritativeBreedingProductionSnapshotV1(mutable)).toThrow(/hash does not match/)
  })

  it('fails closed on wrong status/command/check, unknown fields, sparse arrays, and enriched projections', () => {
    const fixture = build()
    expect(() => createBreedingProductionSnapshotV1({
      ...fixture,
      project: { ...fixture.project, status: 'additional-time-in-progress' },
    } as never)).toThrow()
    expect(() => createBreedingProductionSnapshotV1({ ...fixture, check: { ...fixture.check, outcome: 'failure' } } as never)).toThrow()
    const snapshot = createBreedingProductionSnapshotV1(fixture)
    expect(() => parseBreedingProductionSnapshotV1({ ...snapshot, arbitraryPatch: true })).toThrow(/exactly the declared fields/)
    expect(() => parseBreedingProductionSnapshotV1({ ...snapshot, parents: new Array(2) })).toThrow(/plain non-enriched array/)
    expect(() => parseBreedingProductionSnapshotProjectionV1({
      ...projectBreedingProductionSnapshotV1({ snapshot, audience: 'gm' }),
      parentSlugs: ['pokemon-parent-a'],
    })).toThrow(/exactly the declared fields/)
  })
})
