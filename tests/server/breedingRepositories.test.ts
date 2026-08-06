import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import { parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1 } from '../../shared/breeding/project'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { createBreedingConsentRecordV1, createBreedingConsentRevisionV1 } from '../../server/domain/breeding/ledgers'
import { createPokemonEggOffspringBlueprintV1 } from '../../server/domain/breeding/lineage'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { validateBreedingProjectRevisionSuccessor } from '../../server/domain/breeding/projectLifecycle'
import { validatePokemonEggRevisionSuccessor } from '../../server/domain/breeding/eggLifecycle'
import { createBreedingSpeciesAcquisitionArchiveRecordV1 } from '../../server/domain/breeding/archives'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingProjectRepository } from '../../server/storage/breedingProjectRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteBreedingConsentRepository } from '../../server/storage/breedingConsentRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import { BreedingRepositoryCorruptionError, BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'

const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const roll = (value: number): string => `breeding-roll:v1:${value.toString(16).padStart(32, '0')}`
const projectId = (value: number): string => `breeding-project:v1:${value.toString(16).padStart(32, '0')}`
const eggId = (value: number): string => `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `breeding-consent:v1:${value.toString(16).padStart(32, '0')}`
const ruleset = rulesetJson as Record<string, any>
const eggContract = eggContractJson as Record<string, any>
const insertOperation = (database: RotomDatabase, value: number, kind = 'create-breeding-project'): string => {
  const operationId = op(value)
  database.connection.prepare(`
    INSERT INTO breeding_operations (
      operation_id, command_sha256, command_kind, command_json, status,
      result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) VALUES (?, ?, ?, '{}', 'pending', NULL, NULL, 100, NULL)
  `).run(operationId, 'a'.repeat(64), kind)
  return operationId
}
const project = (identity = projectId(1), operationId = op(1), owner = 'trainer-owner'): BreedingProjectDocumentV1 => parseBreedingProjectDocumentV1({
  schemaVersion: 1,
  projectId: identity,
  revision: 0,
  status: 'draft',
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  projectCreationOptionSnapshotSha256: 'b'.repeat(64),
  ownerTrainerSlug: owner,
  breederTrainerSlug: 'trainer-breeder',
  parentRefs: [
    { pokemonSheetSlug: 'pokemon-parent-a', ownerTrainerSlug: owner, expectedSheetRevision: 3 },
    { pokemonSheetSlug: 'pokemon-parent-b', ownerTrainerSlug: owner, expectedSheetRevision: 5 },
  ],
  consentPolicy: 'same-owner-control',
  timeline: {
    initialRequiredCampaignMinutes: 240, initialAccumulatedCampaignMinutes: 0,
    additionalRequiredCampaignMinutes: 240, additionalAccumulatedCampaignMinutes: 0,
    initialStartedAtCampaignMinute: null, checkReadyAtCampaignMinute: null,
    additionalStartedAtCampaignMinute: null, readyToProduceAtCampaignMinute: null,
    eggProducedAtCampaignMinute: null, lastAppliedClockRevision: null, lastAppliedClockMinute: null,
  },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: operationId,
})
const projectSuccessor = (current: BreedingProjectDocumentV1, operationId = op(2)): BreedingProjectDocumentV1 => validateBreedingProjectRevisionSuccessor(current, {
  ...current,
  revision: current.revision + 1,
  status: 'awaiting-parent-consent',
  parentRefs: current.parentRefs.map(value => ({ ...value })),
  timeline: { ...current.timeline },
  updatedAtCampaignMinute: 101,
  statusChangedAtCampaignMinute: 101,
  lastOperationId: operationId,
})
const egg = (identity = eggId(1), operationId = op(3), speciesId = 'bulbasaur'): PokemonEggDocumentV1 => {
  const spec = compiledBreedingSpeciesSpec(speciesId)
  const specHash = spec?.definitionSha256 ?? 'c'.repeat(64)
  const root = spec?.familyRootSpeciesId ?? speciesId
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: speciesId as any,
    familyRootSpeciesId: root as any,
    speciesSpecDefinitionSha256: specHash,
    nature: { valueId: 'cuddly', resolutionKind: 'random', rollRecordId: roll(1) as any, optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'overgrow' as any, resolutionKind: 'random', rollRecordId: roll(2) as any, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'random', rollRecordId: roll(3) as any, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parsePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: identity,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: 'trainer-owner',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'd'.repeat(64) },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    definitionHashes: [eggContract.definitionSha256, ruleset.definitionSha256].sort(),
    parents: [],
    breeder: null,
    offspring,
    incubation: {
      averageCampaignMinutes: 14_400, targetCampaignMinutes: 14_400, accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average', durationResultDefinitionSha256: 'e'.repeat(64),
      lastAppliedClockRevision: 0, lastAppliedClockMinute: 100,
      readyAtCampaignMinute: null, readinessKind: null, readyOperationId: null,
      paused: false, pauseReasonId: null, pauseOperationId: null,
    },
    special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 100,
    statusChangedAtCampaignMinute: 100,
    lastOperationId: operationId,
  })
}
const eggSuccessor = (current: PokemonEggDocumentV1, operationId = op(4)): PokemonEggDocumentV1 => validatePokemonEggRevisionSuccessor(current, {
  ...current,
  revision: current.revision + 1,
  incubation: { ...current.incubation, accumulatedCampaignMinutes: 1, lastAppliedClockRevision: 1, lastAppliedClockMinute: 101 },
  special: { ...current.special, triggerIds: [...current.special.triggerIds] },
  updatedAtCampaignMinute: 101,
  lastOperationId: operationId,
})

describe('breeding aggregate repositories', () => {
  it('binds strict parsing, optimistic replacement, exact replay, privacy, and caller-owned transaction policy', () => {
    const policy = JSON.parse(readFileSync(new URL('../../data/breeding-automation/repository-contract.json', import.meta.url), 'utf8'))
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(policy.definitionSha256).toBe(digest(stableJsonStringify(policy.definition)))
    expect(policy.definition.repositories).toHaveLength(5)
    expect(policy.definition.repositories.map((entry: { id: string }) => entry.id)).toContain('pokemon-egg-transfer-consent')
    expect(policy.definition.transferConsent).toMatchObject({ activeRevision: 0, terminalRevision: 1, mutation: 'caller-owned-transaction-only' })
    expect(policy.definition.replace).toMatchObject({ expectedRevision: 'required-safe-integer', compareAndSwap: 'UPDATE-WHERE-identity-and-expected-revision', outcomes: ['applied', 'missing', 'stale'] })
    expect(policy.definition.transaction).toMatchObject({ owner: 'use-case', repositoryBeginsIndependentTransaction: false, callerOwnedSQLiteTransactionParticipation: true })
    expect(policy.definition.authority).toMatchObject({ mapDependency: 'none', encounterDependency: 'none', eggSheetKind: 'none', legacyFields: 'none' })
  })

  it('strictly stores, lists, exactly replays, and optimistically replaces projects', () => {
    const database = open(); insertOperation(database, 1); insertOperation(database, 2, 'advance-breeding-project-time')
    const repository = createSqliteBreedingProjectRepository(database)
    const initial = project()
    expect(repository.insert(initial)).toEqual(initial)
    expect(repository.insert(structuredClone(initial))).toEqual(initial)
    expect(repository.get(initial.projectId)).toEqual(initial)
    expect(repository.listByOwner('trainer-owner')).toEqual([initial])
    expect(repository.listByParent('pokemon-parent-a')).toEqual([initial])
    const next = projectSuccessor(initial)
    expect(repository.replace({ expectedRevision: 0, document: next })).toEqual({ kind: 'applied', document: next })
    expect(repository.replace({ expectedRevision: 0, document: next })).toEqual({ kind: 'stale', expectedRevision: 0, currentRevision: 1 })
    expect(repository.replace({ expectedRevision: 0, document: { ...next, projectId: projectId(99) } as any })).toEqual({ kind: 'missing', expectedRevision: 0, currentRevision: null })
    expect(() => repository.insert(project(initial.projectId, op(1), 'trainer-other'))).toThrow(BreedingRepositoryIdentityCollisionError)
  })

  it('strictly stores canonical Eggs and applies only legal optimistic successors', () => {
    const database = open(); insertOperation(database, 3, 'create-source-egg'); insertOperation(database, 4, 'advance-egg-incubation')
    const repository = createSqlitePokemonEggRepository(database)
    const initial = egg()
    expect(repository.insert(initial)).toEqual(initial)
    expect(repository.insert(structuredClone(initial))).toEqual(initial)
    expect(repository.listByOwner('trainer-owner')).toEqual([initial])
    expect(repository.listByStatuses(['incubating'])).toEqual([initial])
    const next = eggSuccessor(initial)
    expect(repository.replace({ expectedRevision: 0, document: next })).toEqual({ kind: 'applied', document: next })
    expect(repository.replace({ expectedRevision: 0, document: next })).toEqual({ kind: 'stale', expectedRevision: 0, currentRevision: 1 })
    expect(() => repository.insert(egg(eggId(2), op(3), 'unknown-species'))).toThrow(BreedingRepositoryCorruptionError)
  })

  it('stores revision-bound consent, filters strict expiry, and settles once', () => {
    const database = open(); insertOperation(database, 1); insertOperation(database, 5, 'grant-breeding-consent'); insertOperation(database, 6, 'revoke-breeding-consent')
    const projects = createSqliteBreedingProjectRepository(database); const initialProject = project(); projects.insert(initialProject)
    const repository = createSqliteBreedingConsentRepository(database)
    const initial = createBreedingConsentRecordV1({
      schemaVersion: 1,
      consentId: consentId(1) as any,
      projectId: initialProject.projectId,
      parentSheetSlug: 'pokemon-parent-a',
      parentSheetRevision: 3,
      ownerTrainerSlug: 'trainer-owner',
      consentingProfileId: 'profile_owner1234',
      scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'],
      grantedAtCampaignMinute: 100,
      expiresAtCampaignMinute: 200,
      grantOperationId: op(5) as any,
      grantCommandSha256: '5'.repeat(64),
    })
    expect(repository.insert(initial)).toEqual(initial)
    expect(repository.findActiveForParent(initial.projectId, initial.parentSheetSlug)).toEqual(initial)
    expect(repository.listCurrentlyUsableByProfile('profile_owner1234', 199)).toEqual([initial])
    expect(repository.listCurrentlyUsableByProfile('profile_owner1234', 200)).toEqual([])
    const revoked = createBreedingConsentRevisionV1({ ...initial, revision: 1, status: 'revoked', settlementOperationId: op(6) as any, settlementCommandSha256: '6'.repeat(64), settledAtCampaignMinute: 150, settlementReasonId: 'breeding.consent.revoked' })
    expect(repository.replace({ expectedRevision: 0, record: revoked })).toEqual({ kind: 'applied', document: revoked })
    expect(repository.findActiveForParent(initial.projectId, initial.parentSheetSlug)).toBeNull()
    expect(repository.replace({ expectedRevision: 0, record: revoked })).toEqual({ kind: 'stale', expectedRevision: 0, currentRevision: 1 })
  })

  it('records first Species acquisition once with exact replay and collision failure', () => {
    const database = open(); insertOperation(database, 7, 'complete-hatch'); insertOperation(database, 8, 'complete-hatch')
    const repository = createSqliteTrainerSpeciesAcquisitionRepository(database)
    const initial = createBreedingSpeciesAcquisitionArchiveRecordV1({ trainerSheetSlug: 'trainer-owner', trainerRevisionBeforeReward: 0, trainerSheetUpdatedAt: 150, speciesId: 'bulbasaur' as any, sourceKind: 'migration', firstAcquiredAtCampaignMinute: 150, sourceEggId: null, operationId: op(7) as any })
    expect(repository.insert(initial)).toEqual({ kind: 'inserted', record: initial })
    expect(repository.insert(structuredClone(initial))).toEqual({ kind: 'exact-replay', record: initial })
    expect(repository.get('trainer-owner', 'bulbasaur')).toEqual(initial)
    expect(repository.listByTrainer('trainer-owner')).toEqual([initial])
    const collision = createBreedingSpeciesAcquisitionArchiveRecordV1({ trainerSheetSlug: 'trainer-owner', trainerRevisionBeforeReward: 0, trainerSheetUpdatedAt: 151, speciesId: 'bulbasaur' as any, sourceKind: 'migration', firstAcquiredAtCampaignMinute: 151, sourceEggId: null, operationId: op(8) as any })
    expect(() => repository.insert(collision)).toThrow(BreedingRepositoryIdentityCollisionError)
    const unknown = createBreedingSpeciesAcquisitionArchiveRecordV1({ trainerSheetSlug: 'trainer-owner', trainerRevisionBeforeReward: 0, trainerSheetUpdatedAt: 151, speciesId: 'unknown-species' as any, sourceKind: 'migration', firstAcquiredAtCampaignMinute: 151, sourceEggId: null, operationId: op(8) as any })
    expect(() => repository.insert(unknown)).toThrow(BreedingRepositoryCorruptionError)
  })

  it('fails closed on column drift and non-canonical stored JSON without exposing the payload', () => {
    const database = open(); insertOperation(database, 1)
    const repository = createSqliteBreedingProjectRepository(database); const initial = project(); repository.insert(initial)
    database.connection.prepare(`UPDATE breeding_projects SET status = 'awaiting-parent-consent' WHERE project_id = ?`).run(initial.projectId)
    expect(() => repository.get(initial.projectId)).toThrowError(expect.objectContaining({ name: 'BreedingRepositoryCorruptionError', field: 'status' }))
    database.connection.prepare(`UPDATE breeding_projects SET status = 'draft', document_json = document_json || ' ' WHERE project_id = ?`).run(initial.projectId)
    let error: unknown = null
    try { repository.get(initial.projectId) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(BreedingRepositoryCorruptionError)
    expect((error as Error).message).not.toContain('trainer-owner')
    expect((error as Error).message).not.toContain('pokemon-parent-a')
  })

  it('participates in caller-owned transactions and rolls back repository writes together', () => {
    const database = open(); insertOperation(database, 9)
    const repository = createSqliteBreedingProjectRepository(database); const document = project(projectId(9), op(9))
    expect(() => database.withTransaction(() => { repository.insert(document); throw new Error('planned rollback') })).toThrow('planned rollback')
    expect(repository.get(document.projectId)).toBeNull()
  })

  it('reconstructs strict repositories after a database restart without document drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-repository-')); tempRoots.push(root)
    const path = join(root, 'campaign.sqlite'); const first = open(path); insertOperation(first, 1)
    const initial = project(); createSqliteBreedingProjectRepository(first).insert(initial); first.close(); databases.splice(databases.indexOf(first), 1)
    const reopened = open(path)
    expect(createSqliteBreedingProjectRepository(reopened).get(initial.projectId)).toEqual(initial)
  })
})
