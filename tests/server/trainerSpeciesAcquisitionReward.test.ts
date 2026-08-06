import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import acquisitionContractJson from '../../data/breeding-automation/species-acquisition-reward-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { TrainerSpeciesAcquisitionContractError } from '../../shared/speciesAcquisition'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import { BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'
import {
  TRAINER_FIRST_SPECIES_DEX_EXP_REWARD,
  TrainerSpeciesAcquisitionRewardError,
  createTrainerSpeciesAcquisitionRewardService,
} from '../../server/useCases/recordTrainerSpeciesAcquisition'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => { const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database); return database }
afterEach(() => { while (databases.length > 0) databases.pop()?.close() })
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const insertOperation = (database: RotomDatabase, value: number): string => {
  const id = operationId(value)
  database.connection.prepare(`
    INSERT INTO breeding_operations (
      operation_id, command_sha256, command_kind, command_json, status,
      result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) VALUES (?, ?, 'recover-breeding-operation', '{}', 'pending', NULL, NULL, 100, NULL)
  `).run(id, value.toString(16).padStart(64, '0'))
  return id
}
const saveTrainer = (database: RotomDatabase, overrides: Record<string, unknown> = {}): void => {
  createSqliteSheetRepository(database).save({
    kind: 'trainer', slug: 'trainer-owner', revision: Number(overrides.revision ?? 4), updatedAt: Number(overrides.updatedAt ?? 1_000),
    document: { slug: 'trainer-owner', name: 'Owner', level: 10, dexExp: 7, currentTeam: ['old-partner'], boxedPokemon: [], ...overrides },
  })
}
const request = (operation: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  trainerSheetSlug: 'trainer-owner', expectedTrainerRevision: 4, speciesId: 'bulbasaur',
  sourceKind: 'migration', sourceEggId: null, acquiredAtCampaignMinute: 120,
  operationId: operation, sheetUpdatedAt: 1_001,
  ...overrides,
})
const acquisitionCount = (database: RotomDatabase): number => Number((database.connection.prepare('SELECT COUNT(*) AS count FROM trainer_species_acquisitions').get() as { count: number }).count)

describe('shared historical Trainer Species acquisition reward', () => {
  it('binds a reviewed shared-history and exactly-once reward contract', () => {
    const policy = acquisitionContractJson as Record<string, any>
    expect(policy.definitionSha256).toBe(createHash('sha256').update(stableJsonStringify(policy.definition)).digest('hex'))
    expect(policy.definition.history).toMatchObject({ identity: ['trainerSheetSlug', 'speciesId'], deletion: 'forbidden', dexExpInference: 'forbidden' })
    expect(policy.definition.reward).toMatchObject({ trainerField: 'dexExp', amount: TRAINER_FIRST_SPECIES_DEX_EXP_REWARD, onlyWhenHistoricalInsertIsNew: true })
    expect(policy.definition.sources).toEqual(['capture', 'hatch', 'evolution', 'trade', 'migration', 'gm-reviewed'])
    expect(policy.definition.transaction).toMatchObject({ acquisitionAndTrainerReward: 'single-SQLite-savepoint', callerOwnedParticipation: true })
  })

  it('records the first historical identity and increments dexExp and revision exactly once', () => {
    const database = open(); saveTrainer(database); const operation = insertOperation(database, 1)
    const service = createTrainerSpeciesAcquisitionRewardService({ database })
    const result = service.record(request(operation))
    expect(result).toMatchObject({
      outcome: 'first-acquisition-rewarded', sourceKind: 'migration', trainerSheetSlug: 'trainer-owner',
      trainerRevision: 5, currentDexExp: 8, historicalRewardAmount: 1, appliedRewardAmount: 1,
      acquisition: { trainerRevisionBeforeReward: 4, speciesId: 'bulbasaur', sourceKind: 'migration', operationId: operation },
    })
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 5, sheet: { dexExp: 8 } })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database).get('trainer-owner', 'bulbasaur')).toEqual(result.acquisition)
  })

  it('returns no reward for a later source and exact replay never applies a second reward', () => {
    const database = open(); saveTrainer(database); const firstOperation = insertOperation(database, 2); const laterOperation = insertOperation(database, 3)
    const service = createTrainerSpeciesAcquisitionRewardService({ database })
    const first = service.record(request(firstOperation))
    const replay = service.record(request(firstOperation))
    const later = service.record(request(laterOperation, { expectedTrainerRevision: 5, acquiredAtCampaignMinute: 130, sourceKind: 'trade', sheetUpdatedAt: 1_002 }))
    expect(first.appliedRewardAmount).toBe(1)
    expect(replay).toMatchObject({ outcome: 'exact-replay', historicalRewardAmount: 1, appliedRewardAmount: 0, trainerRevision: 5, currentDexExp: 8 })
    expect(later).toMatchObject({ outcome: 'already-acquired', historicalRewardAmount: 0, appliedRewardAmount: 0, trainerRevision: 5, currentDexExp: 8 })
    expect(later.acquisition.operationId).toBe(firstOperation)
    expect(acquisitionCount(database)).toBe(1)
  })

  it('rejects changed source or revision facts under the first operation identity', () => {
    const database = open(); saveTrainer(database); const operation = insertOperation(database, 4)
    const service = createTrainerSpeciesAcquisitionRewardService({ database })
    service.record(request(operation))
    expect(() => service.record(request(operation, { sourceKind: 'trade' }))).toThrow(BreedingRepositoryIdentityCollisionError)
    expect(() => service.record(request(operation, { expectedTrainerRevision: 5 }))).toThrow(BreedingRepositoryIdentityCollisionError)
    expect(() => service.record(request(operation, { sheetUpdatedAt: 1_002 }))).toThrow(BreedingRepositoryIdentityCollisionError)
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 5, sheet: { dexExp: 8 } })
  })

  it('rolls back both history and reward at a savepoint when a caller catches injected failure', () => {
    const database = open(); saveTrainer(database, { revision: 0, dexExp: 0 }); const operation = insertOperation(database, 5)
    const service = createTrainerSpeciesAcquisitionRewardService({ database, afterAcquisitionInsert: () => { throw new Error('injected acquisition failure') } })
    database.withTransaction(() => {
      try { service.record(request(operation, { expectedTrainerRevision: 0 })) } catch (error) { expect(String(error)).toContain('injected acquisition failure') }
      createSqliteSheetRepository(database).save({ kind: 'trainer', slug: 'survivor', revision: 0, updatedAt: 1_001, document: { slug: 'survivor', name: 'Survivor', level: 1 } })
    })
    expect(acquisitionCount(database)).toBe(0)
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 0, sheet: { dexExp: 0 } })
    expect(createSqliteSheetRepository(database).getByRef('trainer', 'survivor')).not.toBeNull()
  })

  it('fails closed on stale, malformed, unknown, accessor-backed, and source/Egg-inconsistent requests', () => {
    const database = open(); saveTrainer(database); const operation = insertOperation(database, 6)
    const service = createTrainerSpeciesAcquisitionRewardService({ database })
    expect(() => service.record(request(operation, { expectedTrainerRevision: 3 }))).toThrowError(expect.objectContaining({ code: 'species-acquisition.trainer-stale' }))
    expect(() => service.record(request(operation, { speciesId: 'missingno' }))).toThrowError(expect.objectContaining({ code: 'species-acquisition.unknown-species' }))
    expect(() => service.record(request(operation, { sourceKind: 'hatch', sourceEggId: null }))).toThrow(TrainerSpeciesAcquisitionContractError)
    expect(() => service.record(request(operation, { sourceKind: 'trade', sourceEggId: 'pokemon-egg:v1:00000000000000000000000000000001' }))).toThrow(TrainerSpeciesAcquisitionContractError)
    expect(() => service.record({ ...request(operation), unknown: true })).toThrow(TrainerSpeciesAcquisitionContractError)
    const accessor = request(operation)
    Object.defineProperty(accessor, 'speciesId', { enumerable: true, get: () => 'bulbasaur' })
    expect(() => service.record(accessor)).toThrow(TrainerSpeciesAcquisitionContractError)

    saveTrainer(database, { revision: 4, dexExp: -1 })
    expect(() => service.record(request(operation))).toThrow(TrainerSpeciesAcquisitionRewardError)
    expect(acquisitionCount(database)).toBe(0)
  })

  it('keeps acquisition history after roster removal and never infers identities from dexExp', () => {
    const database = open(); saveTrainer(database, { dexExp: 40, currentTeam: ['bulbasaur-child'], boxedPokemon: [] }); const operation = insertOperation(database, 7)
    const service = createTrainerSpeciesAcquisitionRewardService({ database })
    expect(service.record(request(operation))).toMatchObject({ currentDexExp: 41, outcome: 'first-acquisition-rewarded' })
    const sheets = createSqliteSheetRepository(database)
    const current = sheets.getByRef('trainer', 'trainer-owner')!
    sheets.replaceSetupSheet({ kind: 'trainer', slug: 'trainer-owner', expectedRevision: current.revision, sheet: { ...current.sheet, currentTeam: [], boxedPokemon: [] }, now: 1_002 })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database).get('trainer-owner', 'bulbasaur')).not.toBeNull()
    expect(service.record(request(insertOperation(database, 8), { expectedTrainerRevision: 6, acquiredAtCampaignMinute: 140, sheetUpdatedAt: 1_003 }))).toMatchObject({ outcome: 'already-acquired', currentDexExp: 41 })
  })
})
