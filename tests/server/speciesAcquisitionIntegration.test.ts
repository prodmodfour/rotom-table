import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import acquisitionIntegrationContractJson from '../../data/breeding-automation/species-acquisition-integration-contract.json'
import acquisitionRewardContractJson from '../../data/breeding-automation/species-acquisition-reward-contract.json'
import storageSchemaV27Json from '../../data/breeding-automation/storage-schema-v27.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteTrainerSpeciesAcquisitionRepository } from '../../server/storage/trainerSpeciesAcquisitionRepository'
import { createSqliteTrainerSpeciesAcquisitionSourceOperationRepository } from '../../server/storage/trainerSpeciesAcquisitionSourceOperationRepository'
import { BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'
import { saveSheetUseCase } from '../../server/useCases/saveSheet'
import {
  BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256,
  BreedingSpeciesAcquisitionIntegrationError,
  createBreedingSpeciesAcquisitionSourceEvidenceV1,
  createBreedingSpeciesAcquisitionSourceSettlementV1,
  parseBreedingSpeciesAcquisitionSourceEvidenceV1,
} from '../../server/domain/breeding/speciesAcquisitionIntegration'
import { recordSpeciesAcquisition } from '../../server/useCases/recordTrainerSpeciesAcquisition'
import {
  createReviewedSpeciesAcquisitionAuthorityV1,
  ReviewedSpeciesAcquisitionError,
  settleReviewedSpeciesAcquisition,
} from '../../server/useCases/settleReviewedSpeciesAcquisition'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length > 0) databases.pop()?.close()
})

const saveTrainer = (
  database: RotomDatabase,
  slug: string,
  overrides: Record<string, unknown> = {},
): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', slug, {
    slug,
    name: slug,
    level: 10,
    revision: 0,
    updatedAt: 100,
    dexExp: 0,
    currentTeam: [],
    boxedPokemon: [],
    ...overrides,
  })
}

const savePokemon = (
  database: RotomDatabase,
  slug: string,
  species: string,
  overrides: Record<string, unknown> = {},
): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('pokemon', slug, {
    slug,
    nickname: slug,
    species,
    level: 10,
    revision: 0,
    updatedAt: 100,
    ...overrides,
  })
}

const save = (
  database: RotomDatabase,
  input: {
    readonly kind: 'trainer' | 'pokemon'
    readonly slug: string
    readonly expectedRevision: number
    readonly sheet: Record<string, unknown>
    readonly now: number
  },
) => saveSheetUseCase({
  role: 'gm',
  interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
  kind: input.kind,
  slug: input.slug,
  expectedRevision: input.expectedRevision,
  sheet: input.sheet,
}, {
  database,
  now: () => input.now,
  publishPersistedRealtimeEvent: () => {},
})

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const tableCount = (database: RotomDatabase, table: string): number => Number((
  database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
).count)

describe('BR-069 Species acquisition integrations', () => {
  it('binds the reviewed integration policy, shared reward flow, and v27 settlement schema', () => {
    expect(sha256(acquisitionIntegrationContractJson.definition))
      .toBe(acquisitionIntegrationContractJson.definitionSha256)
    expect(acquisitionIntegrationContractJson.definition).toMatchObject({
      ticket: 'BR-069',
      sharedRewardContractDefinitionSha256: acquisitionRewardContractJson.definitionSha256,
      runtimePolicy: {
        definitionSha256: BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256,
        clientAuthority: 'none',
      },
      sourceSettlement: {
        storageSchemaDefinitionSha256: storageSchemaV27Json.definitionSha256,
        externalBreedingOperationForgery: 'forbidden',
      },
    })
    expect(sha256(storageSchemaV27Json.definition)).toBe(storageSchemaV27Json.definitionSha256)
    expect(storageSchemaV27Json.definition).toMatchObject({
      fromVersion: 26,
      toVersion: 27,
      invariants: {
        existingHistoryRowsPreserved: true,
        sourceSettlementRequiresHistory: true,
        offlineParity: true,
      },
    })
  })

  it('rejects enriched, accessor-backed, policy-stale, and contradictory source evidence', () => {
    const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
      sourceKind: 'migration',
      sourceAuthorityKind: 'reviewed-migration',
      sourceEventId: 'review:strict-evidence',
      sourceAuthorityDefinitionSha256: '1'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 0,
      speciesId: 'bulbasaur' as never,
      pokemonSheetSlug: null,
      pokemonSheetRevision: null,
      campaignMinute: 0,
    })
    expect(() => parseBreedingSpeciesAcquisitionSourceEvidenceV1({
      ...evidence,
      extra: true,
    })).toThrow(BreedingSpeciesAcquisitionIntegrationError)
    const accessor = { ...evidence }
    Object.defineProperty(accessor, 'sourceEventId', {
      enumerable: true,
      get: () => evidence.sourceEventId,
    })
    expect(() => parseBreedingSpeciesAcquisitionSourceEvidenceV1(accessor))
      .toThrow(BreedingSpeciesAcquisitionIntegrationError)
    expect(() => parseBreedingSpeciesAcquisitionSourceEvidenceV1({
      ...evidence,
      integrationPolicyDefinitionSha256: 'f'.repeat(64),
    })).toThrowError(expect.objectContaining({
      code: 'breeding.species-acquisition-integration.invalid-authority',
    }))
    expect(() => createBreedingSpeciesAcquisitionSourceEvidenceV1({
      sourceKind: 'migration',
      sourceAuthorityKind: 'reviewed-migration',
      sourceEventId: 'review/../private',
      sourceAuthorityDefinitionSha256: '1'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 0,
      speciesId: 'bulbasaur' as never,
      pokemonSheetSlug: null,
      pokemonSheetRevision: null,
      campaignMinute: 0,
    })).toThrow(BreedingSpeciesAcquisitionIntegrationError)
    expect(() => createBreedingSpeciesAcquisitionSourceSettlementV1({
      evidence,
      outcome: 'first-acquisition-rewarded',
      acquisitionDefinitionSha256: '2'.repeat(64),
      trainerRevisionAfterReward: 0,
      trainerDexExpAfterReward: 1,
      appliedRewardAmount: 1,
      settledAtCampaignMinute: 0,
    })).toThrowError(expect.objectContaining({
      code: 'breeding.species-acquisition-integration.invalid-authority',
    }))
  })

  it('settles a current owned evolution with one history row, one Dex Exp, and both sheet refreshes', () => {
    const database = open()
    savePokemon(database, 'starter', 'Bulbasaur')
    saveTrainer(database, 'trainer-owner', { currentTeam: ['starter'] })
    const pokemon = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('pokemon', 'starter')!

    const result = save(database, {
      kind: 'pokemon',
      slug: 'starter',
      expectedRevision: 0,
      sheet: { ...pokemon.sheet, species: 'Ivysaur' },
      now: 200,
    })

    expect(result.sheet).toMatchObject({ slug: 'starter', species: 'Ivysaur', revision: 1 })
    expect(result.realtimeEvents.map(event => event.event.channel)).toEqual([
      'sheet:pokemon:starter',
      'sheets',
      'sheet:trainer:trainer-owner',
      'sheets',
    ])
    expect(createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 1, sheet: { dexExp: 1 } })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database)
      .get('trainer-owner', 'ivysaur')).toMatchObject({
      sourceKind: 'evolution',
      speciesId: 'ivysaur',
      trainerRevisionBeforeReward: 0,
      firstAcquiredAtCampaignMinute: 0,
    })
    const sourceRows = createSqliteTrainerSpeciesAcquisitionSourceOperationRepository(database)
      .listByTrainer('trainer-owner')
    expect(sourceRows).toHaveLength(1)
    expect(sourceRows[0]).toMatchObject({
      outcome: 'first-acquisition-rewarded',
      appliedRewardAmount: 1,
      evidence: { sourceKind: 'evolution', pokemonSheetSlug: 'starter', pokemonSheetRevision: 1 },
    })
  })

  it('rewards a destination trade once, retains history after release, and gives zero on reacquisition', () => {
    const database = open()
    savePokemon(database, 'partner', 'Bulbasaur')
    saveTrainer(database, 'trainer-destination')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    const first = save(database, {
      kind: 'trainer',
      slug: 'trainer-destination',
      expectedRevision: 0,
      sheet: { ...sheets.getByRef('trainer', 'trainer-destination')!.sheet, currentTeam: ['partner'] },
      now: 200,
    })
    expect(first.sheet).toMatchObject({ revision: 2, dexExp: 1, currentTeam: ['partner'] })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database)
      .get('trainer-destination', 'bulbasaur')).toMatchObject({ sourceKind: 'trade' })

    const released = save(database, {
      kind: 'trainer',
      slug: 'trainer-destination',
      expectedRevision: 2,
      sheet: { ...sheets.getByRef('trainer', 'trainer-destination')!.sheet, currentTeam: [] },
      now: 300,
    })
    expect(released.sheet).toMatchObject({ revision: 3, dexExp: 1, currentTeam: [] })
    expect(createSqliteTrainerSpeciesAcquisitionRepository(database)
      .get('trainer-destination', 'bulbasaur')).not.toBeNull()

    const repeated = save(database, {
      kind: 'trainer',
      slug: 'trainer-destination',
      expectedRevision: 3,
      sheet: { ...sheets.getByRef('trainer', 'trainer-destination')!.sheet, boxedPokemon: ['partner'] },
      now: 400,
    })
    expect(repeated.sheet).toMatchObject({ revision: 4, dexExp: 1, boxedPokemon: ['partner'] })
    const settlements = createSqliteTrainerSpeciesAcquisitionSourceOperationRepository(database)
      .listByTrainer('trainer-destination')
    expect(settlements.map(row => [row.outcome, row.appliedRewardAmount])).toEqual(expect.arrayContaining([
      ['first-acquisition-rewarded', 1],
      ['already-acquired', 0],
    ]))
    expect(tableCount(database, 'trainer_species_acquisitions')).toBe(1)
  })

  it('rejects duplicate trade ownership and unknown Species atomically', () => {
    const duplicateDatabase = open()
    savePokemon(duplicateDatabase, 'partner', 'Bulbasaur')
    saveTrainer(duplicateDatabase, 'trainer-source', { currentTeam: ['partner'] })
    saveTrainer(duplicateDatabase, 'trainer-destination')
    const duplicateSheets = createSqliteSheetRepository<Record<string, unknown>>(duplicateDatabase)
    expect(() => save(duplicateDatabase, {
      kind: 'trainer', slug: 'trainer-destination', expectedRevision: 0,
      sheet: { ...duplicateSheets.getByRef('trainer', 'trainer-destination')!.sheet, currentTeam: ['partner'] },
      now: 200,
    })).toThrow(/must belong exactly once/i)
    expect(duplicateSheets.getByRef('trainer', 'trainer-destination')).toMatchObject({
      revision: 0,
      sheet: { currentTeam: [] },
    })
    expect(tableCount(duplicateDatabase, 'trainer_species_acquisitions')).toBe(0)

    const unknownDatabase = open()
    savePokemon(unknownDatabase, 'unknown', 'Missingno')
    saveTrainer(unknownDatabase, 'trainer-owner')
    const unknownSheets = createSqliteSheetRepository<Record<string, unknown>>(unknownDatabase)
    expect(() => save(unknownDatabase, {
      kind: 'trainer', slug: 'trainer-owner', expectedRevision: 0,
      sheet: { ...unknownSheets.getByRef('trainer', 'trainer-owner')!.sheet, currentTeam: ['unknown'] },
      now: 200,
    })).toThrow(/no canonical Species authority/i)
    expect(unknownSheets.getByRef('trainer', 'trainer-owner')).toMatchObject({
      revision: 0,
      sheet: { currentTeam: [] },
    })
    expect(tableCount(unknownDatabase, 'trainer_species_acquisition_source_operations')).toBe(0)
  })

  it('settles reviewed migration and GM sources with exact replay and logical-review collision protection', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    const migration = createReviewedSpeciesAcquisitionAuthorityV1({
      sourceKind: 'migration',
      reviewId: 'migration-review:legacy-bulbasaur',
      sourceArtifactDefinitionSha256: '1'.repeat(64),
      reviewerAuthorityDefinitionSha256: '2'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 0,
      speciesId: 'bulbasaur' as never,
      campaignMinute: 0,
    })
    const resolveMigration = vi.fn(() => migration)
    const first = settleReviewedSpeciesAcquisition(migration, {
      database,
      sheetUpdatedAt: 200,
      resolveCurrentReviewAuthority: resolveMigration,
    })
    const replay = settleReviewedSpeciesAcquisition(migration, {
      database,
      sheetUpdatedAt: 200,
      resolveCurrentReviewAuthority: resolveMigration,
    })
    expect(first.settlement).toMatchObject({ kind: 'executed', appliedRewardAmount: 1 })
    expect(replay.settlement).toMatchObject({
      kind: 'exact-retry',
      appliedRewardAmount: 0,
      sourceOperation: { appliedRewardAmount: 1 },
    })
    expect(createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 1, sheet: { dexExp: 1 } })

    const gmReview = createReviewedSpeciesAcquisitionAuthorityV1({
      sourceKind: 'gm-reviewed',
      reviewId: 'gm-review:repeat-bulbasaur',
      sourceArtifactDefinitionSha256: '3'.repeat(64),
      reviewerAuthorityDefinitionSha256: '4'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 1,
      speciesId: 'bulbasaur' as never,
      campaignMinute: 0,
    })
    expect(settleReviewedSpeciesAcquisition(gmReview, {
      database,
      sheetUpdatedAt: 300,
      resolveCurrentReviewAuthority: () => gmReview,
    }).settlement).toMatchObject({ kind: 'executed', appliedRewardAmount: 0 })

    const changedLogicalReview = createReviewedSpeciesAcquisitionAuthorityV1({
      sourceKind: 'migration',
      reviewId: 'migration-review:legacy-bulbasaur',
      sourceArtifactDefinitionSha256: '5'.repeat(64),
      reviewerAuthorityDefinitionSha256: '2'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 1,
      speciesId: 'bulbasaur' as never,
      campaignMinute: 0,
    })
    expect(() => settleReviewedSpeciesAcquisition(changedLogicalReview, {
      database,
      sheetUpdatedAt: 400,
      resolveCurrentReviewAuthority: () => changedLogicalReview,
    })).toThrow(BreedingRepositoryIdentityCollisionError)
    expect(createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 1, sheet: { dexExp: 1 } })
    expect(tableCount(database, 'trainer_species_acquisitions')).toBe(1)
    expect(tableCount(database, 'trainer_species_acquisition_source_operations')).toBe(2)
  })

  it('rolls history, reward, and source settlement back when a nested caller catches failure', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
      sourceKind: 'migration',
      sourceAuthorityKind: 'reviewed-migration',
      sourceEventId: 'review:rollback-proof',
      sourceAuthorityDefinitionSha256: '1'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 0,
      speciesId: 'bulbasaur' as never,
      pokemonSheetSlug: null,
      pokemonSheetRevision: null,
      campaignMinute: 0,
    })
    database.withTransaction(() => {
      expect(() => recordSpeciesAcquisition({ sourceEvidence: evidence }, {
        database,
        sheetUpdatedAt: 200,
        validateCurrentSourceAuthority: () => true,
        beforeSettle: () => { throw new Error('injected source settlement failure') },
      })).toThrow(/injected source settlement failure/)
      saveTrainer(database, 'survivor')
    })
    expect(createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'trainer-owner')).toMatchObject({ revision: 0, sheet: { dexExp: 0 } })
    expect(createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'survivor')).not.toBeNull()
    expect(tableCount(database, 'trainer_species_acquisitions')).toBe(0)
    expect(tableCount(database, 'trainer_species_acquisition_source_operations')).toBe(0)
  })

  it('fails closed on stale clock, asynchronous review authority, and enriched review input', () => {
    const database = open()
    saveTrainer(database, 'trainer-owner')
    const authority = createReviewedSpeciesAcquisitionAuthorityV1({
      sourceKind: 'migration',
      reviewId: 'migration-review:strict',
      sourceArtifactDefinitionSha256: '1'.repeat(64),
      reviewerAuthorityDefinitionSha256: '2'.repeat(64),
      trainerSheetSlug: 'trainer-owner',
      trainerRevisionBeforeReward: 0,
      speciesId: 'bulbasaur' as never,
      campaignMinute: 0,
    })
    expect(() => settleReviewedSpeciesAcquisition({ ...authority, extra: true }, {
      database, sheetUpdatedAt: 200, resolveCurrentReviewAuthority: () => authority,
    })).toThrow(ReviewedSpeciesAcquisitionError)
    expect(() => settleReviewedSpeciesAcquisition(authority, {
      database, sheetUpdatedAt: 200, resolveCurrentReviewAuthority: () => Promise.resolve(authority),
    })).toThrow()
    database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 1 WHERE singleton = 1').run()
    expect(() => settleReviewedSpeciesAcquisition(authority, {
      database, sheetUpdatedAt: 200, resolveCurrentReviewAuthority: () => authority,
    })).toThrowError(expect.objectContaining({ code: 'breeding.species-acquisition-review.stale-authority' }))
    expect(tableCount(database, 'trainer_species_acquisitions')).toBe(0)
  })
})
