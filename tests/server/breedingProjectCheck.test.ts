import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseBreedingProjectDocumentV1 } from '../../shared/breeding/project'
import { parseBreedingReadResourceV1, BREEDING_REFERENCE_SOURCE_IDS, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  createBreedingAuthorizationReceiptV1,
  createBreedingBreederAuthorityEvidenceV1,
  createBreedingCrossOwnerConsentEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import { createBreedingConsentRecordV1 } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import { breedingProjectDocumentDefinitionSha256 } from '../../server/domain/breeding/projectInitialProgress'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingCheckLedgerRepository, BreedingCheckLedgerRepositoryTransactionError } from '../../server/storage/breedingCheckLedgerRepository'
import { createSqliteBreedingConsentRepository } from '../../server/storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import { createBreedingTransactionCoordinator } from '../../server/useCases/executeBreedingTransaction'
import { resolveBreedingProjectCheck } from '../../server/useCases/resolveBreedingProjectCheck'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const security = securityJson as { readonly definitionSha256: string }
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const PROJECTION_KEY = '0123456789abcdef0123456789abcdef'
const OPTION_SHA = '1'.repeat(64)
const EDGE_RECORD = 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4'
const EDGE_EFFECTIVE = '6'.repeat(64)
const AUTHORIZATION_POLICY = '08d98ea79e07355a87956a937637db442fd0b984be7abf51e2d731a926104c99'
const databases: RotomDatabase[] = []
const roots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  const index = databases.indexOf(database)
  if (index >= 0) databases.splice(index, 1)
  database.close()
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const checkId = (value: number): string => `breeding-check:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `breeding-consent:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const trainerHash = (revision = 5): string => sha256(`trainer-breeder:${revision}`)
const clockCommand = (value: number, expectedRevision: number, targetCampaignMinute: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: rulesetRef,
  scopes: [{ kind: 'campaign-clock', expectedRevision }],
  payload: { targetCampaignMinute },
})
const grantConsentCommand = (value: number, consentIdentity: string) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'grant-breeding-consent',
  actor: { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' },
  ruleset: rulesetRef,
  scopes: [
    { kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 0 },
    { kind: 'parent-consent', consentId: consentIdentity, expectedRevision: null },
  ],
  payload: {
    projectId: PROJECT_ID,
    consentId: consentIdentity,
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    consentScopes: [...BREEDING_CONSENT_SCOPES].sort(),
    expiresAtCampaignMinute: 400,
  },
})
const creationCommand = parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(2),
  commandKind: 'create-breeding-project',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: null }],
  payload: {
    projectId: PROJECT_ID,
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: OPTION_SHA,
    consentPolicy: 'same-owner-control',
  },
})
const resolveCommand = (value: number, revision = 0) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'resolve-breeding-check',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision }],
  payload: { projectId: PROJECT_ID, checkRecordId: checkId(value) },
})
const checkReadyProject = (crossOwner = false) => parseBreedingProjectDocumentV1({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 0,
  status: 'check-ready',
  ruleset: rulesetRef,
  projectCreationOptionSnapshotSha256: OPTION_SHA,
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
    additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: 0,
    checkReadyAtCampaignMinute: 240,
    additionalStartedAtCampaignMinute: null,
    readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null,
    lastAppliedClockRevision: 1,
    lastAppliedClockMinute: 300,
  },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 0,
  updatedAtCampaignMinute: 300,
  statusChangedAtCampaignMinute: 240,
  lastOperationId: creationCommand.operationId,
})
const seed = (database: RotomDatabase, crossOwner = false) => {
  const clock = createSqliteCampaignClockRepository(database).get()
  const advanced = advanceBreedingCampaignClock(clockCommand(1, clock.revision, 300), { database })
  expect(advanced.kind).toBe('executed')
  const project = checkReadyProject(crossOwner)
  const operations = createSqliteBreedingOperationRepository(database)
  database.withTransaction(() => {
    expect(operations.reserve(creationCommand, 300).kind).toBe('reserved')
    createSqliteBreedingProjectRepository(database).insert(project)
    operations.settle(creationCommand, createBreedingOperationAcceptedV1({
      operationId: creationCommand.operationId,
      commandHash: createBreedingOperationCommandHash(creationCommand),
      commandKind: creationCommand.commandKind,
      outcomeKind: 'project-created',
      aggregateRefs: [{ kind: 'breeding-project', id: PROJECT_ID, revision: 0 }],
      changedScopes: creationCommand.scopes,
      committedAtCampaignMinute: 300,
    }), 300)
  })
  return project
}
const otherProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_other_0001',
  displayName: 'Other Parent Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }],
}
const seedCrossOwnerConsent = (database: RotomDatabase) => {
  const identity = consentId(50)
  const command = grantConsentCommand(50, identity)
  const record = createBreedingConsentRecordV1({
    schemaVersion: 1,
    consentId: identity as never,
    projectId: PROJECT_ID as never,
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    ownerTrainerSlug: 'trainer-other',
    consentingProfileId: otherProfile.id,
    scopes: [...BREEDING_CONSENT_SCOPES].sort() as never,
    grantedAtCampaignMinute: 300,
    expiresAtCampaignMinute: 400,
    grantOperationId: command.operationId,
    grantCommandSha256: createBreedingOperationCommandHash(command),
  })
  const operations = createSqliteBreedingOperationRepository(database)
  database.withTransaction(() => {
    expect(operations.reserve(command, 300).kind).toBe('reserved')
    createSqliteBreedingConsentRepository(database).insert(record)
    operations.settle(command, createBreedingOperationAcceptedV1({
      operationId: command.operationId,
      commandHash: createBreedingOperationCommandHash(command),
      commandKind: command.commandKind,
      outcomeKind: 'consent-granted',
      aggregateRefs: [
        { kind: 'breeding-project', id: PROJECT_ID, revision: 0 },
        { kind: 'parent-consent', id: identity, revision: 0 },
      ],
      changedScopes: [command.scopes[1]!],
      committedAtCampaignMinute: 300,
    }), 300)
  })
  const trainerControl = createBreedingTrainerControlEvidenceV1({
    profile: otherProfile,
    trainerSheetSlug: 'trainer-other',
    trainerSheetRevision: 7,
    trainerSheetDefinitionSha256: sha256('trainer-other:7'),
    evaluatedAtCampaignMinute: 300,
  })
  const parentControl = createBreedingParentControlEvidenceV1({
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    parentSheetDefinitionSha256: sha256('pokemon-parent-b:3'),
    ownerTrainer: {
      slug: 'trainer-other',
      revision: 7,
      definitionSha256: sha256('trainer-other:7'),
      currentTeam: [],
      boxedPokemon: ['pokemon-parent-b'],
    },
    trainerControl,
    verificationMode: 'profile-control',
    evaluatedAtCampaignMinute: 300,
  })
  return { record, trainerControl, parentControl }
}
const breederAuthority = (skillTotal = 5, mandatedSkillId?: 'general-education' | 'perception') => createBreedingBreederAuthorityEvidenceV1({
  schemaVersion: 1,
  breederTrainerSlug: 'trainer-breeder',
  breederTrainerRevision: 5,
  breederTrainerDefinitionSha256: trainerHash(),
  accessMode: 'profile-control',
  accessEvidenceDefinitionSha256: 'a'.repeat(64),
  edgeCanonicalId: 'Breeder',
  edgeInstanceId: 'edge-instance:breeder',
  edgeRecordSha256: EDGE_RECORD,
  effectiveEdgeProjectionSha256: EDGE_EFFECTIVE,
  ...(mandatedSkillId ? { mandatedSkillId } : {}),
  pokemonEducationRank: 'Expert',
  pokemonEducationSkillTotal: skillTotal,
  evaluatedAtCampaignMinute: 300,
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
const references = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '2'.repeat(64),
  semanticRegistryDefinitionSha256: '3'.repeat(64),
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: '5'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: OPTION_SHA,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({
    sourceId,
    contentSha256: (index + 1).toString(16).padStart(64, '0'),
  })),
  contractDefinitionHashes: [
    'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract',
    'breeding-operation-contract', 'breeding-project-contract', 'breeding-read-set-contract',
    'breeding-security-policy', 'pokemon-egg-contract',
  ].map((contractId, index) => ({
    contractId,
    definitionSha256: (index + 20).toString(16).padStart(64, '0'),
  })),
})
const dependencySet = (actual: readonly BreedingDependencyEvidenceV1[]): readonly BreedingDependencyEvidenceV1[] => [{
  providerKind: 'system',
  providerId: 'breeding-effective-dependency-set-v1',
  subjectKind: 'campaign',
  subjectId: 'campaign',
  subjectRevision: null,
  checkpoint: 'authorization',
  providerDefinitionSha256: AUTHORIZATION_POLICY,
  effectiveEvidenceSha256: sha256(actual),
}, ...actual]
const authority = (database: RotomDatabase, command: ReturnType<typeof resolveCommand>, skillTotal = 5, mandatedSkillId?: 'general-education' | 'perception') => {
  const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
  const clock = createSqliteCampaignClockRepository(database).get()
  const breeder = breederAuthority(skillTotal, mandatedSkillId)
  const edge: BreedingDependencyEvidenceV1 = {
    providerKind: 'edge',
    providerId: 'Breeder',
    subjectKind: 'trainer-sheet',
    subjectId: breeder.breederTrainerSlug,
    subjectRevision: breeder.breederTrainerRevision,
    checkpoint: 'project-check',
    providerDefinitionSha256: breeder.edgeRecordSha256,
    effectiveEvidenceSha256: breeder.effectiveEdgeProjectionSha256,
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(Number.parseInt(command.operationId.slice(-2), 16)) as never,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      readResource('campaign-clock', 'campaign-clock', clock.revision, sha256(clock), ['campaign-time'], clock.campaignMinute),
      readResource('breeding-check', command.payload.checkRecordId, null, null, ['conflict']),
      readResource('breeding-project', project.projectId, project.revision, breedingProjectDocumentDefinitionSha256(project), ['conflict', 'mechanics']),
      ...project.parentRefs.map(parent => readResource(
        'pokemon-sheet', parent.pokemonSheetSlug, parent.expectedSheetRevision,
        sha256(`${parent.pokemonSheetSlug}:${parent.expectedSheetRevision}`), ['snapshot'],
      )),
      readResource('trainer-sheet', breeder.breederTrainerSlug, breeder.breederTrainerRevision, breeder.breederTrainerDefinitionSha256, ['mechanics']),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([edge]),
    writeExpectations: command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: 'b'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [breeder.definitionSha256],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { command, project, breeder, readSet, receipt }
}
const authorityWithConsent = (
  database: RotomDatabase,
  command: ReturnType<typeof resolveCommand>,
  consent: ReturnType<typeof seedCrossOwnerConsent>,
) => {
  const base = authority(database, command)
  const evidence = createBreedingCrossOwnerConsentEvidenceV1({
    consent: consent.record,
    projectId: PROJECT_ID,
    parentControl: consent.parentControl,
    trainerControl: consent.trainerControl,
    validationOperationId: command.operationId,
    validationCommandSha256: createBreedingOperationCommandHash(command),
    validatedAtCampaignMinute: 300,
  })
  const readSet = createBreedingOperationReadSetV1({
    readSetId: base.readSet.readSetId,
    operationId: base.readSet.operationId,
    commandSha256: base.readSet.commandSha256,
    commandKind: base.readSet.commandKind,
    capturedAtCampaignMinute: base.readSet.capturedAtCampaignMinute,
    resources: [
      ...base.readSet.resources,
      readResource('parent-consent', consent.record.consentId, consent.record.revision, consent.record.definitionSha256, ['consent']),
    ],
    referenceVersions: base.readSet.referenceVersions,
    dependencyEvidence: base.readSet.dependencyEvidence,
    writeExpectations: base.readSet.writeExpectations,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: 'b'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [base.breeder.definitionSha256, evidence.definitionSha256],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: 300,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { ...base, readSet, receipt, consentEvidence: [evidence] as const }
}
const execute = (input: ReturnType<typeof authority>, database: RotomDatabase, options: {
  readonly draw?: () => number
  readonly coordinator?: ReturnType<typeof createBreedingTransactionCoordinator>
  readonly resumePending?: boolean
  readonly beforeSettle?: (result: unknown) => void
  readonly consentEvidence?: readonly unknown[]
} = {}) => resolveBreedingProjectCheck({
  command: input.command,
  readSet: input.readSet,
  authorizationReceipt: input.receipt,
  breederAuthority: input.breeder,
  consentEvidence: options.consentEvidence ?? [],
  audience: 'owner',
}, {
  database,
  coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database, publish: vi.fn() }),
  campaignProjectionKey: PROJECTION_KEY,
  realtimeTimestamp: 2_000,
  drawBreederCheckD20: options.draw ?? (() => 7),
  ...(options.resumePending ? { resumePending: true } : {}),
  ...(options.beforeSettle ? { beforeSettle: options.beforeSettle as never } : {}),
})

describe('authoritative Breeder mandated Skill check', () => {
  it('persists one server d20 before the reducer and atomically starts additional time on DC 12 success', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(10), 5, 'general-education')
    const draw = vi.fn(() => 7)
    const publish = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({ database, publish })
    let observedBeforeSettlement = false
    const result = execute(input, database, {
      draw,
      coordinator,
      beforeSettle: () => {
        observedBeforeSettlement = true
        expect(database.connection.isTransaction).toBe(true)
        expect(createSqliteBreedingCheckLedgerRepository(database).getRollByOperation(input.command.operationId)?.values).toEqual([7])
        expect(createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)?.finalTotal).toBe(12)
        expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(1)
      },
    })
    expect(observedBeforeSettlement).toBe(true)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(result.execution.kind).toBe('executed')
    expect(result.project).toMatchObject({
      revision: 1,
      status: 'additional-time-in-progress',
      timeline: { additionalStartedAtCampaignMinute: 300, additionalAccumulatedCampaignMinutes: 0, lastAppliedClockMinute: 300 },
      check: { checkRecordId: checkId(10), outcome: 'success', resolvedAtCampaignMinute: 300 },
    })
    expect(result.check).toMatchObject({
      difficultyClass: 12,
      authoritativeSkillTotal: 5,
      dieTotal: 7,
      finalTotal: 12,
      outcome: 'success',
    })
    expect(result.projection).toEqual({
      schemaVersion: 1,
      audience: 'owner',
      status: 'additional-time-in-progress',
      skillId: 'general-education',
      difficultyClass: 12,
      finalTotal: 12,
      outcome: 'success',
      resolvedAtCampaignMinute: 300,
    })
    expect(JSON.stringify(result.projection)).not.toMatch(/project|trainer|profile|roll|hash|skillTotal/iu)
    expect(result.execution.committedRealtimeEvents).toHaveLength(4)
    expect(publish).toHaveBeenCalledTimes(4)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId))
      .toEqual({ readSet: input.readSet, authorizationReceipt: input.receipt })
  })

  it('uses exact DC boundaries and terminally fails the Project at final total 11', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(11))
    const result = execute(input, database, { draw: () => 6 })
    expect(result.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'check-resolved' })
    expect(result.project).toMatchObject({
      revision: 1,
      status: 'check-failed',
      check: { outcome: 'failure' },
      terminal: {
        reasonId: 'breeding.project-terminal.check-failed',
        atCampaignMinute: 300,
        operationId: input.command.operationId,
      },
    })
    expect(result.check).toMatchObject({ dieTotal: 6, authoritativeSkillTotal: 5, finalTotal: 11, outcome: 'failure' })
    expect(result.projection).toMatchObject({ status: 'check-failed', finalTotal: 11, outcome: 'failure' })
  })

  it('returns an exact retry without drawing, changing revisions, inserting events, or publishing', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(12))
    const publish = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({ database, publish })
    const first = execute(input, database, { draw: () => 10, coordinator })
    expect(first.execution.kind).toBe('executed')
    expect(publish).toHaveBeenCalledTimes(4)
    const replayDraw = vi.fn(() => { throw new Error('must not draw') })
    const replay = execute(input, database, { draw: replayDraw, coordinator })
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.execution.record.result).toEqual(first.execution.record.result)
    expect(replay.execution.committedRealtimeEvents).toEqual([])
    expect(replayDraw).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(4)
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(1)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(4)
  })

  it('retains the pending operation, authority, and one roll across phase-2 failure and reuses it on explicit recovery', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(13))
    const coordinator = createBreedingTransactionCoordinator({ database, publish: vi.fn() })
    const draw = vi.fn(() => 7)
    expect(() => execute(input, database, {
      draw,
      coordinator,
      beforeSettle: () => { throw new Error('injected-check-settlement-failure') },
    })).toThrow('injected-check-settlement-failure')
    expect(draw).toHaveBeenCalledTimes(1)
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId)).not.toBeNull()
    expect(createSqliteBreedingCheckLedgerRepository(database).getRollByOperation(input.command.operationId)?.values).toEqual([7])
    expect(createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)).toBeNull()
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(0)

    const duplicateDraw = vi.fn(() => 20)
    const pending = execute(input, database, { draw: duplicateDraw, coordinator })
    expect(pending.execution.kind).toBe('pending')
    expect(duplicateDraw).not.toHaveBeenCalled()
    const recoveryDraw = vi.fn(() => 20)
    const recovered = execute(input, database, { draw: recoveryDraw, coordinator, resumePending: true })
    expect(recovered.execution.kind).toBe('executed')
    expect(recoveryDraw).not.toHaveBeenCalled()
    expect(recovered.check?.dieTotal).toBe(7)
    expect(recovered.project?.revision).toBe(1)
  })

  it('settles stale and already-checked Projects without a second check or Project mutation', () => {
    const database = open()
    seed(database)
    const firstInput = authority(database, resolveCommand(14))
    execute(firstInput, database, { draw: () => 7 })
    const staleCommand = resolveCommand(15, 0)
    const staleInput = authorityForStale(database, staleCommand, firstInput.project)
    const staleDraw = vi.fn(() => 20)
    const stale = execute(staleInput, database, { draw: staleDraw })
    expect(stale.execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.stale-revision' })
    expect(staleDraw).not.toHaveBeenCalled()
    expect(createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)?.checkRecordId).toBe(checkId(14))
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(1)
  })

  it('requires current positive cross-owner consent and never substitutes a GM or authorized receipt for consent', () => {
    const database = open()
    seed(database, true)
    const input = authority(database, resolveCommand(19))
    const draw = vi.fn(() => 20)
    const result = execute(input, database, { draw })
    expect(result.execution.record.result).toMatchObject({
      ok: false,
      reasonId: 'breeding.operation.unavailable',
    })
    expect(draw).not.toHaveBeenCalled()
    expect(createSqliteBreedingCheckLedgerRepository(database).getRollByOperation(input.command.operationId)).toBeNull()
    expect(createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)).toBeNull()
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)).toMatchObject({ revision: 0, status: 'check-ready' })

    const consentDatabase = open()
    seed(consentDatabase, true)
    const consent = seedCrossOwnerConsent(consentDatabase)
    const consentInput = authorityWithConsent(consentDatabase, resolveCommand(20), consent)
    const accepted = execute(consentInput, consentDatabase, {
      draw: () => 7,
      consentEvidence: consentInput.consentEvidence,
    })
    expect(accepted.execution.record.result).toMatchObject({ ok: true, outcomeKind: 'check-resolved' })
    expect(accepted.project).toMatchObject({ revision: 1, status: 'additional-time-in-progress' })
    expect(accepted.check).toMatchObject({ finalTotal: 12, outcome: 'success' })
  })

  it('rejects malformed, extraneous, stale provider, receipt, and random-source authority fail closed', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(16))
    expect(() => resolveBreedingProjectCheck({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
      breederAuthority: input.breeder,
      consentEvidence: [],
      audience: 'owner',
      rollRecords: [],
    }, {
      database,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 2_000,
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-check.invalid-request' }))
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)).toBeNull()

    const badReceipt = createBreedingAuthorizationReceiptV1({ ...input.receipt, evidenceDefinitionHashes: ['f'.repeat(64)] })
    expect(() => resolveBreedingProjectCheck({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: badReceipt,
      breederAuthority: input.breeder,
      consentEvidence: [],
      audience: 'owner',
    }, {
      database,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 2_000,
    })).toThrowError(expect.objectContaining({ code: 'breeding.project-check.invalid-authority' }))
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)).toBeNull()

    expect(() => execute(input, database, { draw: () => 0 })).toThrowError(expect.objectContaining({ code: 'breeding.project-check.invalid-random-source' }))
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId)).toBeNull()
    expect(createSqliteBreedingCheckLedgerRepository(database).getRollByOperation(input.command.operationId)).toBeNull()
  })

  it('enforces caller-owned strict roll/check storage and exact replay only', () => {
    const database = open()
    seed(database)
    const input = authority(database, resolveCommand(17))
    const result = execute(input, database, { draw: () => 8 })
    const ledger = createSqliteBreedingCheckLedgerRepository(database)
    expect(() => ledger.insertRoll({ command: input.command, roll: resultCheckRoll(database, input.command.operationId) }))
      .toThrow(BreedingCheckLedgerRepositoryTransactionError)
    const replay = database.withTransaction(() => ledger.insertCheck({
      command: input.command,
      check: result.check!,
      roll: resultCheckRoll(database, input.command.operationId),
    }))
    expect(replay).toEqual(result.check)
    database.connection.exec('PRAGMA foreign_keys = OFF')
    database.connection.prepare('UPDATE breeding_checks SET outcome = ? WHERE check_record_id = ?').run('failure', result.check!.checkRecordId)
    expect(() => ledger.getCheck(result.check!.checkRecordId)).toThrowError(expect.objectContaining({
      table: 'breeding_checks',
      field: expect.stringContaining('duplicated'),
    }))
  })

  it('survives file-database restart and exact-retries without redrawing', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-breeding-check-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    let database = open(path)
    seed(database)
    const input = authority(database, resolveCommand(18))
    const first = execute(input, database, { draw: () => 9 })
    expect(first.check?.dieTotal).toBe(9)
    close(database)

    database = open(path)
    expect(createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)).toEqual(first.check)
    const draw = vi.fn(() => { throw new Error('must not redraw after restart') })
    const replay = execute(input, database, { draw })
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.execution.record.result).toEqual(first.execution.record.result)
    expect(draw).not.toHaveBeenCalled()
  })
})

const resultCheckRoll = (database: RotomDatabase, operation: string) => (
  createSqliteBreedingCheckLedgerRepository(database).getRollByOperation(operation)!
)
const authorityForStale = (
  database: RotomDatabase,
  command: ReturnType<typeof resolveCommand>,
  oldProject: ReturnType<typeof checkReadyProject>,
) => {
  const clock = createSqliteCampaignClockRepository(database).get()
  const breeder = breederAuthority()
  const edge: BreedingDependencyEvidenceV1 = {
    providerKind: 'edge', providerId: 'Breeder', subjectKind: 'trainer-sheet',
    subjectId: breeder.breederTrainerSlug, subjectRevision: breeder.breederTrainerRevision,
    checkpoint: 'project-check', providerDefinitionSha256: breeder.edgeRecordSha256,
    effectiveEvidenceSha256: breeder.effectiveEdgeProjectionSha256,
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(15) as never,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      readResource('campaign-clock', 'campaign-clock', clock.revision, sha256(clock), ['campaign-time'], clock.campaignMinute),
      readResource('breeding-check', command.payload.checkRecordId, null, null, ['conflict']),
      readResource('breeding-project', oldProject.projectId, oldProject.revision, breedingProjectDocumentDefinitionSha256(oldProject), ['conflict', 'mechanics']),
      ...oldProject.parentRefs.map(parent => readResource(
        'pokemon-sheet', parent.pokemonSheetSlug, parent.expectedSheetRevision,
        sha256(`${parent.pokemonSheetSlug}:${parent.expectedSheetRevision}`), ['snapshot'],
      )),
      readResource('trainer-sheet', breeder.breederTrainerSlug, breeder.breederTrainerRevision, breeder.breederTrainerDefinitionSha256, ['mechanics']),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([edge]),
    writeExpectations: command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: 'b'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [breeder.definitionSha256],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { command, project: oldProject, breeder, readSet, receipt }
}
