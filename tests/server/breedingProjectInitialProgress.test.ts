import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { PlayerProfile } from '../../shared/playerProfiles'
import { parseBreedingReadResourceV1, BREEDING_REFERENCE_SOURCE_IDS, type BreedingDependencyEvidenceV1 } from '../../shared/breeding/readSets'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createBreedingAuthorizationReceiptV1, createBreedingParentControlEvidenceV1, createBreedingTrainerControlEvidenceV1 } from '../../server/domain/breeding/authorization'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import {
  BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION_SHA256,
  BREEDING_INITIAL_PROGRESS_SEGMENT_PROVIDER_ID,
  BreedingInitialProgressAuthorityError,
  breedingProjectDocumentDefinitionSha256,
  createBreedingInitialProgressSegmentAuthorityV1,
  parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1,
  planBreedingInitialProgressSegmentV1,
  projectBreedingInitialProgressV1,
} from '../../server/domain/breeding/projectInitialProgress'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256 } from '../../server/domain/breeding/compatibility'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import { parseAuthoritativeBreedingProjectSetupValidationV1 } from '../../server/domain/breeding/projectSetupValidation'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingOperationEvidenceRepository, BreedingOperationEvidenceRepositoryTransactionError } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import { createBreedingTransactionCoordinator } from '../../server/useCases/executeBreedingTransaction'
import {
  advanceBreedingProjectInitialTime,
  createBreedingProjectFromValidatedSetup,
} from '../../server/useCases/manageBreedingProjectInitialTime'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const security = securityJson as { readonly definitionSha256: string }
const rulesetRef = { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const PROJECTION_KEY = '0123456789abcdef0123456789abcdef'
const EDGE_RECORD = 'd303cbe8c377ec9bb2a305ee5626e3c80f9c1ebd77975623c985bce741a321f4'
const EDGE_EFFECTIVE = '6'.repeat(64)
const AUTHORIZATION_POLICY = '08d98ea79e07355a87956a937637db442fd0b984be7abf51e2d731a926104c99'
const OPTION_SNAPSHOT = resolveBreedingCampaignOptionSnapshot({
  'breeding.maturity-policy': 'minimum-level',
  'breeding.minimum-maturity-level': 20,
})
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
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const trainerHash = (slug: string, revision: number): string => sha256(`${slug}:${revision}`)
const pokemonHash = (slug: string, revision: number): string => sha256(`${slug}:${revision}`)
const ownerProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_owner_0001',
  displayName: 'Owner',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
}
const otherProfile: PlayerProfile = {
  schemaVersion: 1,
  id: 'profile_other_0001',
  displayName: 'Other',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-other' }],
}
const trainerControl = (profile: PlayerProfile, slug: string, revision: number, minute: number) => (
  createBreedingTrainerControlEvidenceV1({
    profile,
    trainerSheetSlug: slug,
    trainerSheetRevision: revision,
    trainerSheetDefinitionSha256: trainerHash(slug, revision),
    evaluatedAtCampaignMinute: minute,
  })
)
const parentControl = (input: {
  readonly slug: 'pokemon-parent-a' | 'pokemon-parent-b'
  readonly revision: number
  readonly owner: 'owner' | 'other'
  readonly minute: number
  readonly serverVerified?: boolean
}) => {
  const ownerSlug = input.owner === 'owner' ? 'trainer-owner' : 'trainer-other'
  const ownerRevision = input.owner === 'owner' ? 5 : 7
  const control = input.serverVerified
    ? null
    : trainerControl(input.owner === 'owner' ? ownerProfile : otherProfile, ownerSlug, ownerRevision, input.minute)
  return createBreedingParentControlEvidenceV1({
    parentSheetSlug: input.slug,
    parentSheetRevision: input.revision,
    parentSheetDefinitionSha256: pokemonHash(input.slug, input.revision),
    ownerTrainer: {
      slug: ownerSlug,
      revision: ownerRevision,
      definitionSha256: trainerHash(ownerSlug, ownerRevision),
      currentTeam: input.slug === 'pokemon-parent-a' ? [input.slug] : [],
      boxedPokemon: input.slug === 'pokemon-parent-b' ? [input.slug] : [],
    },
    trainerControl: control,
    verificationMode: input.serverVerified ? 'server-verified-link' : 'profile-control',
    evaluatedAtCampaignMinute: input.minute,
  })
}
const createCommand = (value: number, crossOwner = false) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'create-breeding-project',
  actor: { profileId: ownerProfile.id, selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: null }],
  payload: {
    projectId: PROJECT_ID,
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-owner',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: OPTION_SNAPSHOT.definitionSha256,
    consentPolicy: crossOwner ? 'cross-owner-current-revision-consent' : 'same-owner-control',
  },
})
const progressCommand = (value: number, revision: number, throughClockRevision: number, throughCampaignMinute: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'advance-breeding-project-time',
  actor: { profileId: ownerProfile.id, selectedTrainerSlug: 'trainer-owner' },
  ruleset: rulesetRef,
  scopes: [{ kind: 'breeding-project', projectId: PROJECT_ID, expectedRevision: revision }],
  payload: { projectId: PROJECT_ID, throughClockRevision, throughCampaignMinute },
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
  campaignOptionSnapshotDefinitionSha256: OPTION_SNAPSHOT.definitionSha256,
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
const dependencySet = (
  actual: readonly BreedingDependencyEvidenceV1[],
): readonly BreedingDependencyEvidenceV1[] => [{
  providerKind: 'system',
  providerId: 'breeding-effective-dependency-set-v1',
  subjectKind: 'campaign',
  subjectId: 'campaign',
  subjectRevision: null,
  checkpoint: 'authorization',
  providerDefinitionSha256: AUTHORIZATION_POLICY,
  effectiveEvidenceSha256: sha256(actual),
}, ...actual]
const clockDefinitionSha256 = (database: RotomDatabase): string => sha256(
  createSqliteCampaignClockRepository(database).get(),
)
const creationAuthority = (input: {
  readonly database: RotomDatabase
  readonly command: ReturnType<typeof createCommand>
  readonly parentControls: readonly [ReturnType<typeof parentControl>, ReturnType<typeof parentControl>]
  readonly status: 'awaiting-consent' | 'ready'
}) => {
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const edge: BreedingDependencyEvidenceV1 = {
    providerKind: 'edge',
    providerId: 'Breeder',
    subjectKind: 'trainer-sheet',
    subjectId: 'trainer-owner',
    subjectRevision: 5,
    checkpoint: 'project-creation',
    providerDefinitionSha256: EDGE_RECORD,
    effectiveEvidenceSha256: EDGE_EFFECTIVE,
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(Number.parseInt(input.command.operationId.slice(-2), 16)) as never,
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      readResource('campaign-clock', 'campaign-clock', clock.revision, clockDefinitionSha256(input.database), ['campaign-time'], clock.campaignMinute),
      readResource('breeding-project', PROJECT_ID, null, null, ['conflict']),
      readResource('trainer-sheet', 'trainer-owner', 5, trainerHash('trainer-owner', 5), ['authorization', 'mechanics']),
      ...(input.status === 'awaiting-consent'
        ? [readResource('trainer-sheet', 'trainer-other', 7, trainerHash('trainer-other', 7), ['consent'])]
        : []),
      readResource('pokemon-sheet', 'pokemon-parent-a', 2, pokemonHash('pokemon-parent-a', 2), ['snapshot']),
      readResource('pokemon-sheet', 'pokemon-parent-b', 3, pokemonHash('pokemon-parent-b', 3), ['snapshot']),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([edge]),
    writeExpectations: input.command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    actorAuthorityDefinitionSha256: 'a'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: input.parentControls.map(value => value.definitionSha256),
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  const definition = {
    schemaVersion: 1 as const,
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: 'create-breeding-project' as const,
    status: input.status,
    reasonIds: input.status === 'ready' ? [] : ['breeding.setup.awaiting-consent'],
    checks: input.status === 'ready'
      ? { ownership: 'satisfied', consent: 'satisfied', maturity: 'satisfied', locationFacility: 'satisfied', compatibility: 'satisfied' }
      : { ownership: 'satisfied', consent: 'awaiting', maturity: 'not-evaluated', locationFacility: 'not-evaluated', compatibility: 'not-evaluated' },
    compatibility: input.status === 'ready'
      ? { status: 'compatible', compatibilityKind: 'conventional', reasonIds: [] }
      : { status: 'not-evaluated', compatibilityKind: null, reasonIds: [] },
    authorizationReceiptDefinitionSha256: receipt.definitionSha256,
    parentFactsDefinitionHashes: input.status === 'ready' ? ['b'.repeat(64), 'c'.repeat(64)] : [],
    maturityAdjudicationIds: [],
    roleAdjudicationId: null,
    campaignOptionSnapshotDefinitionSha256: OPTION_SNAPSHOT.definitionSha256,
    compatibilityPolicyDefinitionSha256: BREEDING_COMPATIBILITY_POLICY_DEFINITION_SHA256,
    locationPolicyId: 'campaign-workshop-off-map-v1' as const,
    facilityId: null,
    evaluatedAtCampaignMinute: clock.campaignMinute,
  }
  const setupValidation = parseAuthoritativeBreedingProjectSetupValidationV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
  return { readSet, receipt, setupValidation }
}
const coordinator = (database: RotomDatabase, publish = vi.fn()) => createBreedingTransactionCoordinator({ database, publish })
const creationInput = (database: RotomDatabase, crossOwner = false) => {
  const command = createCommand(1, crossOwner)
  const parents = [
    parentControl({ slug: 'pokemon-parent-a', revision: 2, owner: 'owner', minute: 0 }),
    parentControl({ slug: 'pokemon-parent-b', revision: 3, owner: crossOwner ? 'other' : 'owner', minute: 0, serverVerified: crossOwner }),
  ] as const
  return { command, parents, ...creationAuthority({ database, command, parentControls: parents, status: crossOwner ? 'awaiting-consent' : 'ready' }) }
}
const executeCreation = (database: RotomDatabase, coordinatorValue = coordinator(database), crossOwner = false) => {
  const input = creationInput(database, crossOwner)
  const result = createBreedingProjectFromValidatedSetup({
    command: input.command,
    readSet: input.readSet,
    authorizationReceipt: input.receipt,
    setupValidation: input.setupValidation,
    parentControls: input.parents,
    audience: 'owner',
  }, {
    database,
    coordinator: coordinatorValue,
    campaignProjectionKey: PROJECTION_KEY,
    realtimeTimestamp: 1_000,
  })
  return { input, result }
}
const advanceClock = (database: RotomDatabase, value: number, target: number) => {
  const clock = createSqliteCampaignClockRepository(database).get()
  return advanceBreedingCampaignClock(clockCommand(value, clock.revision, target), { database })
}
const segmentAuthority = (input: {
  readonly project: NonNullable<ReturnType<typeof createSqliteBreedingProjectRepository> extends never ? never : ReturnType<ReturnType<typeof createSqliteBreedingProjectRepository>['get']>>
  readonly command: ReturnType<typeof progressCommand>
  readonly mode?: 'accrue' | 'interrupt'
  readonly interruptedAtCampaignMinute?: number
  readonly reasonId?: 'breeding.project-interruption.consent-expired' | 'breeding.project-interruption.parent-revision-changed'
  readonly secondParentRevision?: number
}) => createBreedingInitialProgressSegmentAuthorityV1({
  operationId: input.command.operationId,
  commandSha256: createBreedingOperationCommandHash(input.command),
  projectId: input.project.projectId,
  projectRevision: input.project.revision,
  projectDefinitionSha256: breedingProjectDocumentDefinitionSha256(input.project),
  throughClockRevision: input.command.payload.throughClockRevision,
  throughCampaignMinute: input.command.payload.throughCampaignMinute,
  mode: input.mode ?? 'accrue',
  interruptionReasonId: input.mode === 'interrupt'
    ? input.reasonId ?? 'breeding.project-interruption.consent-expired'
    : null,
  interruptedAtCampaignMinute: input.mode === 'interrupt'
    ? input.interruptedAtCampaignMinute ?? input.command.payload.throughCampaignMinute
    : null,
  parentRefs: [
    input.project.parentRefs[0],
    { ...input.project.parentRefs[1], expectedSheetRevision: input.secondParentRevision ?? input.project.parentRefs[1].expectedSheetRevision },
  ],
})
const progressAuthority = (input: {
  readonly database: RotomDatabase
  readonly command: ReturnType<typeof progressCommand>
  readonly project: NonNullable<ReturnType<ReturnType<typeof createSqliteBreedingProjectRepository>['get']>>
  readonly segment: ReturnType<typeof segmentAuthority>
}) => {
  const clock = createSqliteCampaignClockRepository(input.database).get()
  const segmentDependency: BreedingDependencyEvidenceV1 = {
    providerKind: 'system',
    providerId: BREEDING_INITIAL_PROGRESS_SEGMENT_PROVIDER_ID,
    subjectKind: 'project',
    subjectId: input.project.projectId,
    subjectRevision: input.project.revision,
    checkpoint: 'campaign-clock-segment',
    providerDefinitionSha256: BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION_SHA256,
    effectiveEvidenceSha256: input.segment.definitionSha256,
  }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(Number.parseInt(input.command.operationId.slice(-2), 16)) as never,
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: clock.campaignMinute,
    resources: [
      readResource('campaign-clock', 'campaign-clock', clock.revision, clockDefinitionSha256(input.database), ['campaign-time'], clock.campaignMinute),
      readResource('breeding-project', input.project.projectId, input.project.revision, breedingProjectDocumentDefinitionSha256(input.project), ['conflict', 'mechanics']),
      ...input.segment.parentRefs.map(parent => readResource(
        'pokemon-sheet', parent.pokemonSheetSlug, parent.expectedSheetRevision,
        pokemonHash(parent.pokemonSheetSlug, parent.expectedSheetRevision), ['snapshot'],
      )),
    ],
    referenceVersions: references(),
    dependencyEvidence: dependencySet([segmentDependency]),
    writeExpectations: input.command.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: input.command.operationId,
    commandSha256: createBreedingOperationCommandHash(input.command),
    commandKind: input.command.commandKind,
    actorAuthorityDefinitionSha256: 'a'.repeat(64),
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [input.segment.definitionSha256],
    gmOverrideIds: [],
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: clock.campaignMinute,
    securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { readSet, receipt }
}
const progressInput = (database: RotomDatabase, value: number, options: {
  readonly mode?: 'accrue' | 'interrupt'
  readonly interruptedAtCampaignMinute?: number
  readonly reasonId?: 'breeding.project-interruption.consent-expired' | 'breeding.project-interruption.parent-revision-changed'
  readonly secondParentRevision?: number
} = {}) => {
  const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
  const clock = createSqliteCampaignClockRepository(database).get()
  const command = progressCommand(value, project.revision, clock.revision, clock.campaignMinute)
  const segment = segmentAuthority({ project, command, ...options })
  return { command, segment, project, ...progressAuthority({ database, command, project, segment }) }
}
const executeProgress = (database: RotomDatabase, value: number, coordinatorValue: ReturnType<typeof coordinator>, options: Parameters<typeof progressInput>[2] = {}, resumePending = false) => {
  const input = progressInput(database, value, options)
  const result = advanceBreedingProjectInitialTime({
    command: input.command,
    readSet: input.readSet,
    authorizationReceipt: input.receipt,
    segmentAuthority: input.segment,
    audience: 'owner',
  }, {
    database,
    coordinator: coordinatorValue,
    campaignProjectionKey: PROJECTION_KEY,
    realtimeTimestamp: 1_000 + value,
    ...(resumePending ? { resumePending: true } : {}),
  })
  return { input, result }
}

describe('durable Breeding Project initial four-hour progress', () => {
  it('creates a ready Project, persists operation authority, emits bounded refresh rows, and exact-retries silently', () => {
    const database = open()
    const publish = vi.fn()
    const coordinatorValue = coordinator(database, publish)
    const { input, result } = executeCreation(database, coordinatorValue)
    expect(result.execution.kind).toBe('executed')
    expect(result.project).toMatchObject({
      revision: 0,
      status: 'initial-time-in-progress',
      timeline: {
        initialRequiredCampaignMinutes: 240,
        initialAccumulatedCampaignMinutes: 0,
        initialStartedAtCampaignMinute: 0,
        lastAppliedClockRevision: 0,
        lastAppliedClockMinute: 0,
      },
    })
    expect(result.execution.committedRealtimeEvents).toHaveLength(4)
    expect(publish).toHaveBeenCalledTimes(4)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId))
      .toEqual({ readSet: input.readSet, authorizationReceipt: input.receipt, gmOverrides: [] })
    expect(JSON.stringify(result.projection)).not.toMatch(/project:v1|pokemon-parent|trainer-|profile|definitionSha256|consent/iu)

    const replay = createBreedingProjectFromValidatedSetup({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
      setupValidation: input.setupValidation,
      parentControls: input.parents,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_000,
    })
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.execution.committedRealtimeEvents).toEqual([])
    expect(publish).toHaveBeenCalledTimes(4)
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)
  })

  it('creates a cross-owner Project only as awaiting consent with no started clock or private projection', () => {
    const database = open()
    const { result } = executeCreation(database, coordinator(database), true)
    expect(result.project).toMatchObject({
      status: 'awaiting-parent-consent',
      consentPolicy: 'cross-owner-current-revision-consent',
      timeline: {
        initialAccumulatedCampaignMinutes: 0,
        initialStartedAtCampaignMinute: null,
        lastAppliedClockRevision: null,
        lastAppliedClockMinute: null,
      },
    })
    expect(result.projection).toEqual({
      schemaVersion: 1,
      audience: 'owner',
      status: 'awaiting-parent-consent',
      initialRequiredCampaignMinutes: 240,
      initialAccumulatedCampaignMinutes: 0,
      initialRemainingCampaignMinutes: 240,
      interrupted: true,
      checkReadyAtCampaignMinute: null,
    })
    expect(JSON.stringify(result.projection)).not.toMatch(/trainer-other|pokemon-parent|profile_|consentId/iu)
  })

  it('durably accumulates exactly 240 campaign minutes and records the exact threshold on overshoot', () => {
    const database = open()
    const coordinatorValue = coordinator(database)
    executeCreation(database, coordinatorValue)
    advanceClock(database, 20, 100)
    const first = executeProgress(database, 21, coordinatorValue)
    expect(first.result.project).toMatchObject({
      revision: 1,
      status: 'initial-time-in-progress',
      timeline: { initialAccumulatedCampaignMinutes: 100, lastAppliedClockRevision: 1, lastAppliedClockMinute: 100 },
    })
    expect(first.result.execution.committedRealtimeEvents).toHaveLength(4)

    const replay = advanceBreedingProjectInitialTime({
      command: first.input.command,
      readSet: first.input.readSet,
      authorizationReceipt: first.input.receipt,
      segmentAuthority: first.input.segment,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_021,
    })
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.execution.committedRealtimeEvents).toEqual([])

    advanceClock(database, 22, 300)
    const completed = executeProgress(database, 23, coordinatorValue)
    expect(completed.result.project).toMatchObject({
      revision: 2,
      status: 'check-ready',
      timeline: {
        initialAccumulatedCampaignMinutes: 240,
        checkReadyAtCampaignMinute: 240,
        lastAppliedClockRevision: 2,
        lastAppliedClockMinute: 300,
      },
    })
    expect(completed.result.projection).toMatchObject({
      status: 'check-ready',
      initialRemainingCampaignMinutes: 0,
      checkReadyAtCampaignMinute: 240,
    })
  })

  it('preserves partial work, credits only the valid prefix, skips paused time, and resumes cumulatively', () => {
    const database = open()
    const coordinatorValue = coordinator(database)
    executeCreation(database, coordinatorValue)
    let project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
    const to100 = progressCommand(30, project.revision, 1, 100)
    project = planBreedingInitialProgressSegmentV1({
      project,
      command: to100,
      segmentAuthority: segmentAuthority({ project, command: to100 }),
    }).project
    expect(project.timeline.initialAccumulatedCampaignMinutes).toBe(100)

    const interrupt = progressCommand(31, project.revision, 2, 200)
    project = planBreedingInitialProgressSegmentV1({
      project,
      command: interrupt,
      segmentAuthority: segmentAuthority({
        project,
        command: interrupt,
        mode: 'interrupt',
        interruptedAtCampaignMinute: 150,
      }),
    }).project
    expect(project).toMatchObject({
      status: 'awaiting-parent-consent',
      timeline: { initialAccumulatedCampaignMinutes: 150, lastAppliedClockMinute: 200 },
    })

    const resume = progressCommand(32, project.revision, 3, 250)
    project = planBreedingInitialProgressSegmentV1({
      project,
      command: resume,
      segmentAuthority: segmentAuthority({ project, command: resume }),
    }).project
    expect(project).toMatchObject({
      status: 'initial-time-in-progress',
      timeline: { initialAccumulatedCampaignMinutes: 150, lastAppliedClockMinute: 250 },
    })

    const finish = progressCommand(33, project.revision, 4, 350)
    project = planBreedingInitialProgressSegmentV1({
      project,
      command: finish,
      segmentAuthority: segmentAuthority({ project, command: finish }),
    }).project
    expect(project).toMatchObject({
      status: 'check-ready',
      timeline: { initialAccumulatedCampaignMinutes: 240, checkReadyAtCampaignMinute: 340 },
    })
    expect(projectBreedingInitialProgressV1({ project, audience: 'gm' })).toMatchObject({ interrupted: false, initialRemainingCampaignMinutes: 0 })
  })

  it('allows parent revision refresh only through interruption and rejects backward or hash-stale segment authority', () => {
    const database = open()
    executeCreation(database, coordinator(database))
    const project = createSqliteBreedingProjectRepository(database).get(PROJECT_ID)!
    const command = progressCommand(40, 0, 1, 100)
    const accrueWithDrift = segmentAuthority({ project, command, secondParentRevision: 4 })
    expect(() => planBreedingInitialProgressSegmentV1({ project, command, segmentAuthority: accrueWithDrift }))
      .toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.stale-authority' }))

    const interrupted = planBreedingInitialProgressSegmentV1({
      project,
      command,
      segmentAuthority: segmentAuthority({
        project,
        command,
        mode: 'interrupt',
        reasonId: 'breeding.project-interruption.parent-revision-changed',
        interruptedAtCampaignMinute: 0,
        secondParentRevision: 4,
      }),
    }).project
    expect(interrupted).toMatchObject({
      status: 'awaiting-parent-consent',
      parentRefs: [{ expectedSheetRevision: 2 }, { expectedSheetRevision: 4 }],
      timeline: { initialAccumulatedCampaignMinutes: 0, lastAppliedClockMinute: 100 },
    })
    const regressedParent = progressCommand(42, interrupted.revision, 2, 101)
    expect(() => planBreedingInitialProgressSegmentV1({
      project: interrupted,
      command: regressedParent,
      segmentAuthority: segmentAuthority({
        project: interrupted,
        command: regressedParent,
        mode: 'interrupt',
        secondParentRevision: 3,
      }),
    })).toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.stale-authority' }))

    const completedWhileInterruptedCommand = progressCommand(43, project.revision, 1, 300)
    const completedWhileInterrupted = planBreedingInitialProgressSegmentV1({
      project,
      command: completedWhileInterruptedCommand,
      segmentAuthority: segmentAuthority({
        project,
        command: completedWhileInterruptedCommand,
        mode: 'interrupt',
        interruptedAtCampaignMinute: 240,
      }),
    }).project
    expect(completedWhileInterrupted).toMatchObject({
      status: 'awaiting-parent-consent',
      timeline: { initialAccumulatedCampaignMinutes: 240, checkReadyAtCampaignMinute: 240 },
    })
    expect(projectBreedingInitialProgressV1({ project: completedWhileInterrupted, audience: 'owner' }))
      .toMatchObject({ interrupted: true, initialRemainingCampaignMinutes: 0, checkReadyAtCampaignMinute: 240 })

    const backward = progressCommand(41, interrupted.revision, 0, 50)
    expect(() => planBreedingInitialProgressSegmentV1({
      project: interrupted,
      command: backward,
      segmentAuthority: segmentAuthority({ project: interrupted, command: backward }),
    })).toThrow(BreedingInitialProgressAuthorityError)
    const valid = segmentAuthority({ project, command })
    expect(() => parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1({
      ...valid,
      throughCampaignMinute: 101,
    })).toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.hash-mismatch' }))
  })

  it('rolls project, evidence, and realtime rows back on settlement failure, then resumes the one pending command', () => {
    const database = open()
    const coordinatorValue = coordinator(database)
    executeCreation(database, coordinatorValue)
    advanceClock(database, 50, 100)
    const input = progressInput(database, 51)
    expect(() => advanceBreedingProjectInitialTime({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
      segmentAuthority: input.segment,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_051,
      beforeSettle: () => { throw new Error('injected-before-settlement') },
    })).toThrow('injected-before-settlement')
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(input.command.operationId)).toBeNull()
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(4)
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)?.status).toBe('pending')

    const resumed = advanceBreedingProjectInitialTime({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
      segmentAuthority: input.segment,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_051,
      resumePending: true,
    })
    expect(resumed.execution.kind).toBe('executed')
    expect(resumed.project).toMatchObject({ revision: 1, timeline: { initialAccumulatedCampaignMinutes: 100 } })
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)?.status).toBe('accepted')
    expect(createSqliteRealtimeEventRepository({ database }).cursorState().latestSequence).toBe(8)
  })

  it('survives process-style database restart and returns the same terminal operation without reaccrual', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-breeding-initial-progress-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    let database = open(path)
    let coordinatorValue = coordinator(database)
    executeCreation(database, coordinatorValue)
    advanceClock(database, 70, 100)
    const first = executeProgress(database, 71, coordinatorValue)
    expect(first.result.project?.timeline.initialAccumulatedCampaignMinutes).toBe(100)
    close(database)

    database = open(path)
    coordinatorValue = coordinator(database)
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)).toMatchObject({
      revision: 1,
      timeline: { initialAccumulatedCampaignMinutes: 100, lastAppliedClockMinute: 100 },
    })
    expect(createSqliteBreedingOperationEvidenceRepository(database).get(first.input.command.operationId))
      .toEqual({ readSet: first.input.readSet, authorizationReceipt: first.input.receipt, gmOverrides: [] })
    const replay = advanceBreedingProjectInitialTime({
      command: first.input.command,
      readSet: first.input.readSet,
      authorizationReceipt: first.input.receipt,
      segmentAuthority: first.input.segment,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_071,
    })
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.execution.committedRealtimeEvents).toEqual([])
    expect(replay.project).toMatchObject({ revision: 1, timeline: { initialAccumulatedCampaignMinutes: 100 } })
  })

  it('requires caller-owned evidence transactions and permits only exact evidence replay', () => {
    const database = open()
    const { input } = executeCreation(database, coordinator(database))
    const repository = createSqliteBreedingOperationEvidenceRepository(database)
    expect(() => repository.insert({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
    })).toThrow(BreedingOperationEvidenceRepositoryTransactionError)
    const replay = database.withTransaction(() => repository.insert({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: input.receipt,
    }))
    expect(replay).toEqual({ readSet: input.readSet, authorizationReceipt: input.receipt, gmOverrides: [] })
    expect(() => database.withTransaction(() => repository.insert({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: { ...input.receipt, definitionSha256: '0'.repeat(64) },
    }))).toThrow()
  })

  it('rejects missing segment bindings, unknown fields, and tampering before reserving or mutating', () => {
    const database = open()
    const coordinatorValue = coordinator(database)
    executeCreation(database, coordinatorValue)
    advanceClock(database, 60, 100)
    const input = progressInput(database, 61)
    const unboundReceipt = createBreedingAuthorizationReceiptV1({
      ...input.receipt,
      evidenceDefinitionHashes: [],
    })
    expect(() => advanceBreedingProjectInitialTime({
      command: input.command,
      readSet: input.readSet,
      authorizationReceipt: unboundReceipt,
      segmentAuthority: input.segment,
      audience: 'owner',
    }, {
      database,
      coordinator: coordinatorValue,
      campaignProjectionKey: PROJECTION_KEY,
      realtimeTimestamp: 1_061,
    })).toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.invalid-authority' }))
    expect(createSqliteBreedingOperationRepository(database).get(input.command.operationId)).toBeNull()
    expect(createSqliteBreedingProjectRepository(database).get(PROJECT_ID)?.revision).toBe(0)

    expect(() => parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1({
      ...input.segment,
      mapSlug: 'arena',
    })).toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.unknown-field' }))
    const enriched = [...input.segment.parentRefs]
    Object.defineProperty(enriched, 'encounterId', { value: 'encounter', enumerable: true })
    expect(() => parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1({
      ...input.segment,
      parentRefs: enriched,
    })).toThrowError(expect.objectContaining({ code: 'breeding.initial-progress.invalid-document' }))
  })
})
