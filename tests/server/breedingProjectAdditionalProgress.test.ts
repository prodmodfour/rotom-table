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
import { parseBreedingAdditionalProgressProjectionV1, parseBreedingAdditionalProgressSegmentAuthorityV1 } from '../../shared/breeding/projectAdditionalProgress'
import { BREEDING_REFERENCE_SOURCE_IDS, parseBreedingReadResourceV1, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import type { PlayerProfile } from '../../shared/playerProfiles'
import {
  createBreedingAuthorizationReceiptV1,
  createBreedingCrossOwnerConsentEvidenceV1,
  createBreedingParentControlEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION_SHA256,
  BREEDING_ADDITIONAL_PROGRESS_SEGMENT_PROVIDER_ID,
  createBreedingAdditionalProgressSegmentAuthorityV1,
  planBreedingAdditionalProgressSegmentV1,
} from '../../server/domain/breeding/projectAdditionalProgress'
import { createBreedingCheckRecordFromRoll, createBreedingConsentRecordV1, createBreedingRollRecordFromInjectedValues } from '../../server/domain/breeding/ledgers'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { breedingProjectDocumentDefinitionSha256 } from '../../server/domain/breeding/projectInitialProgress'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingCheckLedgerRepository } from '../../server/storage/breedingCheckLedgerRepository'
import { createSqliteBreedingConsentRepository } from '../../server/storage/breedingConsentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import { advanceBreedingProjectAdditionalTime } from '../../server/useCases/advanceBreedingProjectAdditionalTime'
import { createBreedingTransactionCoordinator } from '../../server/useCases/executeBreedingTransaction'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const security = securityJson as { readonly definitionSha256: string }
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const PROJECT_ID = 'breeding-project:v1:22222222222222222222222222222222'
const OPTION_SHA = '1'.repeat(64)
const PROJECTION_KEY = '0123456789abcdef0123456789abcdef'
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
const rollId = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `breeding-consent:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const resolveCommand = parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(9),
  commandKind: 'resolve-breeding-check',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 0 }],
  payload: { projectId: PROJECT_ID, checkRecordId: checkId(9) },
})
const clockCommand = (value: number, expectedRevision: number, targetCampaignMinute: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: rulesetRef,
  scopes: [{ kind: 'campaign-clock', expectedRevision }],
  payload: { targetCampaignMinute },
})
const progressCommand = (value: number, revision: number, clockRevision: number, through: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'advance-breeding-project-time',
  actor: { profileId: 'profile_owner_0001', selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision }],
  payload: { projectId: PROJECT_ID, throughClockRevision: clockRevision, throughCampaignMinute: through },
})
const grantConsentCommand = (value: number, identity: string, grantedAt: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'grant-breeding-consent',
  actor: { profileId: 'profile_other_0001', selectedTrainerSlug: 'trainer-other' },
  ruleset: rulesetRef,
  scopes: [
    { kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: 0 },
    { kind: 'parent-consent', consentId: identity, expectedRevision: null },
  ],
  payload: {
    projectId: PROJECT_ID,
    consentId: identity,
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    consentScopes: [...BREEDING_CONSENT_SCOPES].sort(),
    expiresAtCampaignMinute: grantedAt + 200,
  },
})
const advanceClock = (database: RotomDatabase, minute: number, id: number): void => {
  const clock = createSqliteCampaignClockRepository(database).get()
  expect(advanceBreedingCampaignClock(clockCommand(id, clock.revision, minute), { database }).kind).toBe('executed')
}
const successfulCheck = () => {
  const commandHash = createBreedingOperationCommandHash(resolveCommand)
  const roll = createBreedingRollRecordFromInjectedValues({
    schemaVersion: 1,
    rollRecordId: rollId(9) as never,
    operationId: resolveCommand.operationId,
    commandSha256: commandHash,
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
  const check = createBreedingCheckRecordFromRoll({
    checkRecordId: checkId(9) as never,
    operationId: resolveCommand.operationId,
    commandSha256: commandHash,
    projectId: PROJECT_ID as never,
    projectRevision: 0,
    breederSnapshotDefinitionSha256: 'a'.repeat(64),
    authoritativeSkillTotal: 5,
    roll,
    rulesetDefinitionSha256: ruleset.definitionSha256,
    resolvedAtCampaignMinute: 300,
  })
  return { roll, check }
}
const additionalProject = (crossOwner = false) => {
  const { check } = successfulCheck()
  return parseBreedingProjectDocumentV1({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    revision: 0,
    status: 'additional-time-in-progress',
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
      additionalStartedAtCampaignMinute: 300,
      readyToProduceAtCampaignMinute: null,
      eggProducedAtCampaignMinute: null,
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 300,
    },
    check: { checkRecordId: check.checkRecordId, outcome: 'success', resolvedAtCampaignMinute: 300 },
    producedEggId: null,
    terminal: null,
    createdAtCampaignMinute: 0,
    updatedAtCampaignMinute: 300,
    statusChangedAtCampaignMinute: 300,
    lastOperationId: resolveCommand.operationId,
  })
}
const seed = (database: RotomDatabase, crossOwner = false) => {
  advanceClock(database, 300, 1)
  const project = additionalProject(crossOwner)
  const { roll, check } = successfulCheck()
  const operations = createSqliteBreedingOperationRepository(database)
  const ledger = createSqliteBreedingCheckLedgerRepository(database)
  database.withTransaction(() => {
    expect(operations.reserve(resolveCommand, 300).kind).toBe('reserved')
    ledger.insertRoll({ command: resolveCommand, roll })
    createSqliteBreedingProjectRepository(database).insert(project)
    ledger.insertCheck({ command: resolveCommand, check, roll })
    operations.settle(resolveCommand, createBreedingOperationAcceptedV1({
      operationId: resolveCommand.operationId,
      commandHash: createBreedingOperationCommandHash(resolveCommand),
      commandKind: resolveCommand.commandKind,
      outcomeKind: 'check-resolved',
      aggregateRefs: [{ kind: 'breeding-project', id: PROJECT_ID, revision: 0 }],
      changedScopes: resolveCommand.scopes,
      committedAtCampaignMinute: 300,
    }), 300)
  })
  return { project, check }
}
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
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 20).toString(16).padStart(64, '0') })),
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
interface ConsentFixture {
  readonly record: ReturnType<typeof createBreedingConsentRecordV1>
  readonly trainerControl: ReturnType<typeof createBreedingTrainerControlEvidenceV1>
  readonly parentControl: ReturnType<typeof createBreedingParentControlEvidenceV1>
}
const otherProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_other_0001',
  displayName: 'Other Parent Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }],
}
const seedConsent = (database: RotomDatabase, grantedAt: number): ConsentFixture => {
  const identity = consentId(50)
  const command = grantConsentCommand(50, identity, grantedAt)
  const record = createBreedingConsentRecordV1({
    schemaVersion: 1,
    consentId: identity as never,
    projectId: PROJECT_ID as never,
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    ownerTrainerSlug: 'trainer-other',
    consentingProfileId: otherProfile.id,
    scopes: [...BREEDING_CONSENT_SCOPES].sort() as never,
    grantedAtCampaignMinute: grantedAt,
    expiresAtCampaignMinute: grantedAt + 200,
    grantOperationId: command.operationId,
    grantCommandSha256: createBreedingOperationCommandHash(command),
  })
  const operations = createSqliteBreedingOperationRepository(database)
  database.withTransaction(() => {
    expect(operations.reserve(command, grantedAt).kind).toBe('reserved')
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
      committedAtCampaignMinute: grantedAt,
    }), grantedAt)
  })
  const trainerControl = createBreedingTrainerControlEvidenceV1({
    profile: otherProfile,
    trainerSheetSlug: 'trainer-other',
    trainerSheetRevision: 7,
    trainerSheetDefinitionSha256: sha256('trainer-other:7'),
    evaluatedAtCampaignMinute: grantedAt,
  })
  const parentControl = createBreedingParentControlEvidenceV1({
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    parentSheetDefinitionSha256: sha256('pokemon-parent-b:3'),
    ownerTrainer: {
      slug: 'trainer-other', revision: 7, definitionSha256: sha256('trainer-other:7'),
      currentTeam: [], boxedPokemon: ['pokemon-parent-b'],
    },
    trainerControl,
    verificationMode: 'profile-control',
    evaluatedAtCampaignMinute: grantedAt,
  })
  return { record, trainerControl, parentControl }
}
const authority = (database: RotomDatabase, command: ReturnType<typeof progressCommand>, creditedFrom: number, consent?: ConsentFixture) => {
  const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
  const check = createSqliteBreedingCheckLedgerRepository(database).getCheckByProject(PROJECT_ID)!
  const clock = createSqliteCampaignClockRepository(database).get()
  const segment = createBreedingAdditionalProgressSegmentAuthorityV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    projectId: project.projectId,
    projectRevision: project.revision,
    projectDefinitionSha256: breedingProjectDocumentDefinitionSha256(project),
    throughClockRevision: clock.revision,
    creditedFromCampaignMinute: creditedFrom,
    throughCampaignMinute: clock.campaignMinute,
    parentRefs: project.parentRefs,
  })
  const dependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system',
    providerId: BREEDING_ADDITIONAL_PROGRESS_SEGMENT_PROVIDER_ID,
    subjectKind: 'project',
    subjectId: project.projectId,
    subjectRevision: project.revision,
    checkpoint: 'campaign-clock-segment',
    providerDefinitionSha256: BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: segment.definitionSha256,
  }
  let consentEvidence: readonly ReturnType<typeof createBreedingCrossOwnerConsentEvidenceV1>[] = []
  if (consent) {
    const trainerControl = createBreedingTrainerControlEvidenceV1({
      profile: otherProfile,
      trainerSheetSlug: 'trainer-other',
      trainerSheetRevision: 7,
      trainerSheetDefinitionSha256: sha256('trainer-other:7'),
      evaluatedAtCampaignMinute: clock.campaignMinute,
    })
    const parentControl = createBreedingParentControlEvidenceV1({
      parentSheetSlug: 'pokemon-parent-b',
      parentSheetRevision: 3,
      parentSheetDefinitionSha256: sha256('pokemon-parent-b:3'),
      ownerTrainer: {
        slug: 'trainer-other', revision: 7, definitionSha256: sha256('trainer-other:7'),
        currentTeam: [], boxedPokemon: ['pokemon-parent-b'],
      },
      trainerControl,
      verificationMode: 'profile-control',
      evaluatedAtCampaignMinute: clock.campaignMinute,
    })
    consentEvidence = [createBreedingCrossOwnerConsentEvidenceV1({
      consent: consent.record,
      projectId: PROJECT_ID,
      parentControl,
      trainerControl,
      validationOperationId: command.operationId,
      validationCommandSha256: createBreedingOperationCommandHash(command),
      validatedAtCampaignMinute: clock.campaignMinute,
    })]
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(Number.parseInt(command.operationId.slice(-2), 16)) as never,
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      readResource('campaign-clock', 'campaign-clock', clock.revision, sha256(clock), ['campaign-time'], clock.campaignMinute),
      readResource('breeding-check', check.checkRecordId, null, check.definitionSha256, ['mechanics']),
      readResource('breeding-project', project.projectId, project.revision, breedingProjectDocumentDefinitionSha256(project), ['conflict', 'mechanics']),
      ...project.parentRefs.map(parent => readResource(
        'pokemon-sheet', parent.pokemonSheetSlug, parent.expectedSheetRevision,
        sha256(`${parent.pokemonSheetSlug}:${parent.expectedSheetRevision}`), ['snapshot'],
      )),
      ...consentEvidence.map(evidence => readResource(
        'parent-consent', evidence.consentId, evidence.consentRevision,
        evidence.consentRecordDefinitionSha256, ['consent'],
      )),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([dependency]),
    writeExpectations: command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: command.operationId,
    commandSha256: createBreedingOperationCommandHash(command),
    commandKind: command.commandKind,
    actorAuthorityDefinitionSha256: 'b'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [segment.definitionSha256, ...consentEvidence.map(value => value.definitionSha256)],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { command, project, check, segment, readSet, receipt, consentEvidence }
}
const execute = (input: ReturnType<typeof authority>, database: RotomDatabase, options: {
  readonly coordinator?: ReturnType<typeof createBreedingTransactionCoordinator>
  readonly resumePending?: boolean
  readonly beforeSettle?: () => void
} = {}) => advanceBreedingProjectAdditionalTime({
  command: input.command,
  readSet: input.readSet,
  authorizationReceipt: input.receipt,
  segmentAuthority: input.segment,
  consentEvidence: input.consentEvidence,
  audience: 'owner',
}, {
  database,
  coordinator: options.coordinator ?? createBreedingTransactionCoordinator({ database, publish: vi.fn() }),
  campaignProjectionKey: PROJECTION_KEY,
  realtimeTimestamp: 2_000,
  ...(options.resumePending ? { resumePending: true } : {}),
  ...(options.beforeSettle ? { beforeSettle: options.beforeSettle } : {}),
})

describe('durable additional Breeding Project progress', () => {
  it('accrues one current campaign-clock segment and persists a bounded private projection atomically', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(10, 0, 2, 400), 300)
    const publish = vi.fn()
    const result = execute(input, database, { coordinator: createBreedingTransactionCoordinator({ database, publish }) })
    expect(result.execution.kind).toBe('executed')
    expect(result.project).toMatchObject({
      revision: 1,
      status: 'additional-time-in-progress',
      timeline: { additionalAccumulatedCampaignMinutes: 100, lastAppliedClockRevision: 2, lastAppliedClockMinute: 400 },
    })
    expect(result.projection).toEqual({
      schemaVersion: 1,
      audience: 'owner',
      status: 'additional-time-in-progress',
      additionalRequiredCampaignMinutes: 240,
      additionalAccumulatedCampaignMinutes: 100,
      additionalRemainingCampaignMinutes: 140,
      readyToProduceAtCampaignMinute: null,
    })
    expect(JSON.stringify(result.projection)).not.toMatch(/project|trainer|profile|parent|consent|command|hash|check|roll/iu)
    expect(result.execution.committedRealtimeEvents).toHaveLength(4)
    expect(publish).toHaveBeenCalledTimes(4)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId))
      .toEqual({ readSet: input.readSet, authorizationReceipt: input.receipt })
  })

  it('accumulates across durable commands and records the exact readiness threshold under overshoot', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const first = authority(database, progressCommand(11, 0, 2, 400), 300)
    expect(execute(first, database).project?.timeline.additionalAccumulatedCampaignMinutes).toBe(100)

    advanceClock(database, 600, 3)
    const second = authority(database, progressCommand(18, 1, 3, 600), 400)
    const result = execute(second, database)
    expect(result.project).toMatchObject({
      revision: 2,
      status: 'ready-to-produce',
      timeline: {
        additionalAccumulatedCampaignMinutes: 240,
        readyToProduceAtCampaignMinute: 540,
        lastAppliedClockMinute: 600,
      },
    })
    expect(result.projection).toMatchObject({
      status: 'ready-to-produce',
      additionalAccumulatedCampaignMinutes: 240,
      additionalRemainingCampaignMinutes: 0,
      readyToProduceAtCampaignMinute: 540,
    })
  })

  it('skips a consent gap and credits only from the fresh durable grant minute', () => {
    const database = open()
    seed(database, true)
    advanceClock(database, 350, 2)
    const consent = seedConsent(database, 350)
    advanceClock(database, 400, 3)
    const input = authority(database, progressCommand(12, 0, 3, 400), 350, consent)
    const result = execute(input, database)
    expect(result.project?.timeline).toMatchObject({
      additionalAccumulatedCampaignMinutes: 50,
      lastAppliedClockMinute: 400,
    })
    expect(result.projection?.additionalRemainingCampaignMinutes).toBe(190)
  })

  it('rejects a client-selected skipped interval and stale parent/check/clock authority without progress', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(13, 0, 2, 400), 301)
    const result = execute(input, database)
    expect(result.execution.record.result).toMatchObject({ ok: false, reasonId: 'breeding.operation.unavailable' })
    expect(result.project?.revision).toBe(0)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(0)

    const stale = structuredClone(input.segment) as Record<string, unknown>
    stale.projectDefinitionSha256 = 'f'.repeat(64)
    const definition = { ...stale }
    delete definition.definitionSha256
    stale.definitionSha256 = sha256(definition)
    expect(() => planBreedingAdditionalProgressSegmentV1({
      project: input.project,
      check: input.check,
      command: input.command,
      segmentAuthority: stale,
    })).toThrow(/exact current Project authority/)
  })

  it('returns an exact retry without revision, evidence, event, or publication duplication', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(14, 0, 2, 400), 300)
    const publish = vi.fn()
    const coordinator = createBreedingTransactionCoordinator({ database, publish })
    const first = execute(input, database, { coordinator })
    const retry = execute(input, database, { coordinator })
    expect(first.execution.kind).toBe('executed')
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.execution.record.result).toEqual(first.execution.record.result)
    expect(retry.execution.committedRealtimeEvents).toEqual([])
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(1)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(4)
    expect(publish).toHaveBeenCalledTimes(4)
  })

  it('rolls back Project, evidence, result, and realtime rows on phase-2 failure and resumes the one pending command explicitly', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(15, 0, 2, 400), 300)
    const coordinator = createBreedingTransactionCoordinator({ database, publish: vi.fn() })
    expect(() => execute(input, database, {
      coordinator,
      beforeSettle: () => { throw new Error('injected-additional-settlement-failure') },
    })).toThrow('injected-additional-settlement-failure')
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId)).toBeNull()
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(0)
    expect(execute(input, database, { coordinator }).execution.kind).toBe('pending')
    const recovered = execute(input, database, { coordinator, resumePending: true })
    expect(recovered.execution.kind).toBe('executed')
    expect(recovered.project?.revision).toBe(1)
  })

  it('survives a process-style database restart with exact terminal replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-additional-progress-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    let database = open(path)
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(16, 0, 2, 400), 300)
    expect(execute(input, database).execution.kind).toBe('executed')
    close(database)
    database = open(path)
    const replay = execute(input, database)
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.project?.timeline.additionalAccumulatedCampaignMinutes).toBe(100)
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(4)
  })

  it('fails closed on unknown fields, sparse arrays, forged hashes, and enriched projections', () => {
    const database = open()
    seed(database)
    advanceClock(database, 400, 2)
    const input = authority(database, progressCommand(17, 0, 2, 400), 300)
    expect(() => parseBreedingAdditionalProgressSegmentAuthorityV1({ ...input.segment, extra: true }))
      .toThrow(/exactly the declared fields/)
    const sparse = { ...input.segment, parentRefs: new Array(2) }
    expect(() => parseBreedingAdditionalProgressSegmentAuthorityV1(sparse)).toThrow(/plain two-parent tuple/)
    expect(() => execute({ ...input, segment: { ...input.segment, definitionSha256: 'f'.repeat(64) } } as never, database))
      .toThrow(/hash does not match/)
    expect(() => parseBreedingAdditionalProgressProjectionV1({
      schemaVersion: 1,
      audience: 'owner',
      status: 'additional-time-in-progress',
      additionalRequiredCampaignMinutes: 240,
      additionalAccumulatedCampaignMinutes: 100,
      additionalRemainingCampaignMinutes: 140,
      readyToProduceAtCampaignMinute: null,
      projectId: PROJECT_ID,
    })).toThrow(/exactly the declared fields/)
  })
})
