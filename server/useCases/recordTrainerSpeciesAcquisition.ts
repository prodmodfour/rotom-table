import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseRecordTrainerSpeciesAcquisitionRequestV1,
  type RecordTrainerSpeciesAcquisitionRequestV1,
  type TrainerSpeciesAcquisitionSourceKind,
} from '#shared/speciesAcquisition'
import type { BreedingSpeciesAcquisitionArchiveRecordV1 } from '#shared/speciesAcquisitionHistory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createBreedingSpeciesAcquisitionArchiveRecordV1 } from '../domain/breeding/speciesAcquisitionHistory'
import { isCanonicalBreedingSpeciesId } from '../domain/breeding/canonicalIds'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import {
  createSqliteTrainerSpeciesAcquisitionRepository,
  type TrainerSpeciesAcquisitionRepository,
} from '../storage/trainerSpeciesAcquisitionRepository'
import { BreedingRepositoryIdentityCollisionError } from '../storage/breedingRepositorySupport'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { createSqliteTrainerSpeciesAcquisitionSourceOperationRepository } from '../storage/trainerSpeciesAcquisitionSourceOperationRepository'
import {
  breedingSpeciesIdFromSheetSpecies,
  BreedingSpeciesAcquisitionIntegrationError,
  createBreedingSpeciesAcquisitionSourceSettlementV1,
  parseBreedingSpeciesAcquisitionSourceEvidenceV1,
  type BreedingSpeciesAcquisitionSourceEvidenceV1,
  type BreedingSpeciesAcquisitionSourceSettlementV1,
} from '../domain/breeding/speciesAcquisitionIntegration'

export const TRAINER_FIRST_SPECIES_DEX_EXP_REWARD = 1 as const
export type TrainerSpeciesAcquisitionRewardOutcome = 'first-acquisition-rewarded' | 'already-acquired' | 'exact-replay'
export interface TrainerSpeciesAcquisitionRewardResult {
  readonly outcome: TrainerSpeciesAcquisitionRewardOutcome
  readonly sourceKind: TrainerSpeciesAcquisitionSourceKind
  readonly acquisition: BreedingSpeciesAcquisitionArchiveRecordV1
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly currentDexExp: number
  readonly historicalRewardAmount: 0 | 1
  readonly appliedRewardAmount: 0 | 1
}
export interface TrainerSpeciesAcquisitionRewardService {
  readonly database: RotomDatabase
  record(request: unknown): TrainerSpeciesAcquisitionRewardResult
}
export interface CreateTrainerSpeciesAcquisitionRewardServiceOptions {
  readonly database?: RotomDatabase
  readonly sheetRepository?: SheetRepository
  readonly acquisitionRepository?: TrainerSpeciesAcquisitionRepository
  /** Failure-injection hook proving acquisition and Trainer reward atomicity. */
  readonly afterAcquisitionInsert?: (record: BreedingSpeciesAcquisitionArchiveRecordV1) => void
}
export type TrainerSpeciesAcquisitionRewardErrorCode =
  | 'species-acquisition.unknown-species'
  | 'species-acquisition.trainer-missing'
  | 'species-acquisition.trainer-stale'
  | 'species-acquisition.trainer-malformed'
  | 'species-acquisition.timestamp-stale'
  | 'species-acquisition.reward-overflow'
  | 'species-acquisition.repository-mismatch'
export class TrainerSpeciesAcquisitionRewardError extends Error {
  readonly code: TrainerSpeciesAcquisitionRewardErrorCode
  readonly field: string
  constructor(code: TrainerSpeciesAcquisitionRewardErrorCode, field: string, message: string) {
    super(`Trainer Species acquisition ${field}: ${message}`)
    this.name = 'TrainerSpeciesAcquisitionRewardError'; this.code = code; this.field = field
  }
}
const fail = (code: TrainerSpeciesAcquisitionRewardErrorCode, field: string, message: string): never => { throw new TrainerSpeciesAcquisitionRewardError(code, field, message) }
const trainerDexExp = (sheet: Record<string, unknown>): number => {
  const value = sheet.dexExp ?? 0
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail('species-acquisition.trainer-malformed', 'trainer.dexExp', 'must be absent or a safe nonnegative integer.')
  return Number(value)
}
const requestedRecord = (request: RecordTrainerSpeciesAcquisitionRequestV1): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  if (!isCanonicalBreedingSpeciesId(request.speciesId)) fail('species-acquisition.unknown-species', 'request.speciesId', 'must exist in the app-owned canonical Species registry.')
  return createBreedingSpeciesAcquisitionArchiveRecordV1({
    trainerSheetSlug: request.trainerSheetSlug,
    trainerRevisionBeforeReward: request.expectedTrainerRevision,
    trainerSheetUpdatedAt: request.sheetUpdatedAt,
    speciesId: request.speciesId,
    sourceKind: request.sourceKind,
    firstAcquiredAtCampaignMinute: request.acquiredAtCampaignMinute,
    sourceEggId: request.sourceEggId,
    operationId: request.operationId,
  })
}
let savepointOrdinal = 0
const nextSavepoint = (): string => `trainer_species_reward_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`
const freezeResult = (value: TrainerSpeciesAcquisitionRewardResult): TrainerSpeciesAcquisitionRewardResult => Object.freeze(value)
export const createTrainerSpeciesAcquisitionRewardService = (options: CreateTrainerSpeciesAcquisitionRewardServiceOptions = {}): TrainerSpeciesAcquisitionRewardService => {
  const database = options.database ?? getRotomDatabase()
  const sheetRepository = options.sheetRepository ?? createSqliteSheetRepository(database)
  const acquisitionRepository = options.acquisitionRepository ?? createSqliteTrainerSpeciesAcquisitionRepository(database)
  if (sheetRepository.database && sheetRepository.database !== database) fail('species-acquisition.repository-mismatch', 'sheetRepository', 'must use the coordinator database connection.')
  if (acquisitionRepository.database !== database) fail('species-acquisition.repository-mismatch', 'acquisitionRepository', 'must use the coordinator database connection.')

  const record = (requestInput: unknown): TrainerSpeciesAcquisitionRewardResult => {
    const request = parseRecordTrainerSpeciesAcquisitionRequestV1(requestInput)
    const proposed = requestedRecord(request)
    return database.withTransaction(() => {
      const trainer = sheetRepository.getByRef('trainer', request.trainerSheetSlug)
        ?? fail('species-acquisition.trainer-missing', 'request.trainerSheetSlug', 'must identify an existing Trainer sheet.')
      const trainerSheet = trainer.sheet as unknown as TrainerSheet & Record<string, unknown>
      if (trainer.kind !== 'trainer' || trainer.slug !== request.trainerSheetSlug || trainerSheet.slug !== request.trainerSheetSlug || trainerSheet.revision !== trainer.revision) fail('species-acquisition.trainer-malformed', 'trainer', 'row and document authority fields must agree.')
      const currentDexExp = trainerDexExp(trainer.sheet)
      const existing = acquisitionRepository.get(request.trainerSheetSlug, request.speciesId)
      if (existing?.operationId === request.operationId) {
        if (stableJsonStringify(existing) !== stableJsonStringify(proposed)) throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition operation', request.operationId)
        if (existing.trainerRevisionBeforeReward !== request.expectedTrainerRevision || trainer.revision < existing.trainerRevisionBeforeReward + 1) fail('species-acquisition.trainer-malformed', 'trainer.revision', 'cannot precede its atomically committed acquisition reward.')
        return freezeResult({ outcome: 'exact-replay', sourceKind: existing.sourceKind, acquisition: existing, trainerSheetSlug: trainer.slug, trainerRevision: trainer.revision, currentDexExp, historicalRewardAmount: 1, appliedRewardAmount: 0 })
      }
      if (trainer.revision !== request.expectedTrainerRevision) fail('species-acquisition.trainer-stale', 'request.expectedTrainerRevision', 'does not match the current Trainer revision.')
      if (existing) return freezeResult({ outcome: 'already-acquired', sourceKind: existing.sourceKind, acquisition: existing, trainerSheetSlug: trainer.slug, trainerRevision: trainer.revision, currentDexExp, historicalRewardAmount: 0, appliedRewardAmount: 0 })
      if (request.sheetUpdatedAt < trainer.updatedAt) fail('species-acquisition.timestamp-stale', 'request.sheetUpdatedAt', 'cannot precede the current storage timestamp.')
      if (currentDexExp === Number.MAX_SAFE_INTEGER) fail('species-acquisition.reward-overflow', 'trainer.dexExp', 'cannot accept another bounded reward.')

      const savepoint = nextSavepoint()
      database.connection.exec(`SAVEPOINT ${savepoint}`)
      try {
        const inserted = acquisitionRepository.insert(proposed)
        if (inserted.kind !== 'inserted') fail('species-acquisition.trainer-malformed', 'acquisition', 'a missing historical identity must insert exactly once.')
        options.afterAcquisitionInsert?.(inserted.record)
        const nextDexExp = currentDexExp + TRAINER_FIRST_SPECIES_DEX_EXP_REWARD
        const replaced = sheetRepository.replaceSetupSheet({
          kind: 'trainer', slug: trainer.slug, expectedRevision: trainer.revision,
          sheet: { ...trainer.sheet, dexExp: nextDexExp }, now: request.sheetUpdatedAt,
        })
        const applied = replaced ?? fail('species-acquisition.trainer-stale', 'trainer', 'reward compare-and-swap did not apply exactly once.')
        if (!applied.changed || applied.sheet.revision !== trainer.revision + 1 || applied.sheet.sheet.dexExp !== nextDexExp) fail('species-acquisition.trainer-stale', 'trainer', 'reward compare-and-swap did not apply exactly once.')
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return freezeResult({ outcome: 'first-acquisition-rewarded', sourceKind: request.sourceKind, acquisition: inserted.record, trainerSheetSlug: trainer.slug, trainerRevision: applied.sheet.revision, currentDexExp: nextDexExp, historicalRewardAmount: 1, appliedRewardAmount: 1 })
      }
      catch (error) {
        database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        throw error
      }
    })
  }
  return Object.freeze({ database, record })
}

export interface RecordSpeciesAcquisitionInputV1 { readonly sourceEvidence: unknown }
export interface RecordSpeciesAcquisitionResultV1 {
  readonly kind: 'executed' | 'exact-retry'
  readonly sourceOperation: BreedingSpeciesAcquisitionSourceSettlementV1
  readonly acquisition: BreedingSpeciesAcquisitionArchiveRecordV1
  readonly trainerSheet: PersistedSheet
  readonly reward: TrainerSpeciesAcquisitionRewardResult | null
  readonly appliedRewardAmount: 0 | 1
}
export interface RecordSpeciesAcquisitionOptions {
  readonly database?: RotomDatabase
  readonly sheetUpdatedAt: number
  readonly validateCurrentSourceAuthority: (evidence: BreedingSpeciesAcquisitionSourceEvidenceV1) => true
  readonly beforeSettle?: (input: { readonly evidence: BreedingSpeciesAcquisitionSourceEvidenceV1, readonly reward: TrainerSpeciesAcquisitionRewardResult }) => void
}
const integrationFail = (field: string, message: string): never => { throw new BreedingSpeciesAcquisitionIntegrationError('breeding.species-acquisition-integration.stale-authority', field, message) }
const parseIntegrationInput = (value: unknown): RecordSpeciesAcquisitionInputV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) integrationFail('input', 'must be one plain exact object.')
  const row = value as Record<string, unknown>; const names = Object.getOwnPropertyNames(row)
  const descriptor = Object.getOwnPropertyDescriptor(row, 'sourceEvidence')
  if (names.length !== 1 || names[0] !== 'sourceEvidence' || !descriptor?.enumerable || !('value' in descriptor)) integrationFail('input', 'must contain exactly one enumerable sourceEvidence data field.')
  return { sourceEvidence: row.sourceEvidence }
}
const integrationInteger = (value: unknown, field: string): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER ? Number(value) : integrationFail(field, 'must be a bounded safe nonnegative integer.')
const integrationTrainer = (repository: SheetRepository<Record<string, unknown>>, slug: string) => {
  const trainer = repository.getByRef('trainer', slug) ?? integrationFail('trainerSheet', 'must exist.')
  if (trainer.kind !== 'trainer' || trainer.slug !== slug || trainer.sheet.slug !== slug || trainer.sheet.revision !== trainer.revision) integrationFail('trainerSheet', 'row and document authority must agree.')
  return trainer
}
const validateIntegrationPokemon = (repository: SheetRepository<Record<string, unknown>>, evidence: BreedingSpeciesAcquisitionSourceEvidenceV1): void => {
  if (evidence.pokemonSheetSlug === null || evidence.pokemonSheetRevision === null) return
  const pokemon = repository.getByRef('pokemon', evidence.pokemonSheetSlug) ?? integrationFail('pokemonSheet', 'must exist for this source.')
  if (pokemon.revision !== evidence.pokemonSheetRevision || pokemon.sheet.slug !== pokemon.slug
    || pokemon.sheet.revision !== pokemon.revision || breedingSpeciesIdFromSheetSpecies(pokemon.sheet.species) !== evidence.speciesId) integrationFail('pokemonSheet', 'must match the exact current Pokémon revision and canonical Species.')
}

let integrationSavepointOrdinal = 0
const nextIntegrationSavepoint = (): string => (
  `trainer_species_source_${integrationSavepointOrdinal = (integrationSavepointOrdinal + 1) % 1_000_000}`
)

/** Settles a server-proven capture/evolution/trade/migration through shared immutable history. */
export const recordSpeciesAcquisition = (
  inputValue: RecordSpeciesAcquisitionInputV1,
  options: RecordSpeciesAcquisitionOptions,
): RecordSpeciesAcquisitionResultV1 => {
  const evidence = parseBreedingSpeciesAcquisitionSourceEvidenceV1(
    parseIntegrationInput(inputValue).sourceEvidence,
  )
  const sheetUpdatedAt = integrationInteger(options.sheetUpdatedAt, 'options.sheetUpdatedAt')
  const database = options.database ?? getRotomDatabase()
  return database.withTransaction(() => {
    const savepoint = nextIntegrationSavepoint()
    database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      let verification: unknown
      try {
        verification = options.validateCurrentSourceAuthority(evidence)
      }
      catch {
        integrationFail('sourceEvidence', 'current source authority verification failed.')
      }
      if (verification !== true) {
        integrationFail(
          'sourceEvidence',
          'current source authority verifier must synchronously return exact true.',
        )
      }

      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      const acquisitions = createSqliteTrainerSpeciesAcquisitionRepository(database)
      const sourceOperations = createSqliteTrainerSpeciesAcquisitionSourceOperationRepository(database)
      const existing = sourceOperations.get(evidence.operationId)
      if (existing) {
        if (stableJsonStringify(existing.evidence) !== stableJsonStringify(evidence)) {
          integrationFail(
            'sourceEvidence',
            'operation identity is already bound to different source evidence.',
          )
        }
        const acquisition = acquisitions.get(evidence.trainerSheetSlug, evidence.speciesId)
          ?? integrationFail(
            'acquisition',
            'terminal source operation lost immutable acquisition history.',
          )
        if ((existing.outcome === 'first-acquisition-rewarded')
          !== (acquisition.operationId === evidence.operationId)
          || existing.acquisitionDefinitionSha256 !== acquisition.definitionSha256) {
          integrationFail(
            'acquisition',
            'terminal source outcome contradicts immutable first history.',
          )
        }
        const trainerSheet = integrationTrainer(sheets, evidence.trainerSheetSlug)
        if (trainerSheet.revision < existing.trainerRevisionAfterReward) {
          integrationFail(
            'trainerSheet',
            'current Trainer revision cannot precede its terminal source settlement.',
          )
        }
        const result = Object.freeze({
          kind: 'exact-retry' as const,
          sourceOperation: existing,
          acquisition,
          trainerSheet,
          reward: null,
          appliedRewardAmount: 0 as const,
        })
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return result
      }
      if (createSqliteCampaignClockRepository(database).get().campaignMinute
        !== evidence.campaignMinute) {
        integrationFail('campaignClock', 'must match the source evidence checkpoint.')
      }
      const trainerBefore = integrationTrainer(sheets, evidence.trainerSheetSlug)
      if (trainerBefore.revision !== evidence.trainerRevisionBeforeReward) {
        integrationFail('trainerSheet', 'revision changed before the reward transaction.')
      }
      validateIntegrationPokemon(sheets, evidence)
      const reward = createTrainerSpeciesAcquisitionRewardService({
        database,
        sheetRepository: sheets,
        acquisitionRepository: acquisitions,
      }).record({
        schemaVersion: 1,
        trainerSheetSlug: evidence.trainerSheetSlug,
        expectedTrainerRevision: evidence.trainerRevisionBeforeReward,
        speciesId: evidence.speciesId,
        sourceKind: evidence.sourceKind,
        sourceEggId: null,
        acquiredAtCampaignMinute: evidence.campaignMinute,
        operationId: evidence.operationId,
        sheetUpdatedAt,
      })
      const outcome = reward.outcome === 'first-acquisition-rewarded'
        ? reward.outcome
        : reward.outcome === 'already-acquired'
          ? reward.outcome
          : integrationFail(
              'acquisition',
              'a fresh source operation cannot replay first history without its settlement.',
            )
      options.beforeSettle?.({ evidence, reward })
      const trainerAfter = integrationTrainer(sheets, evidence.trainerSheetSlug)
      const settlement = createBreedingSpeciesAcquisitionSourceSettlementV1({
        evidence,
        outcome,
        acquisitionDefinitionSha256: reward.acquisition.definitionSha256,
        trainerRevisionAfterReward: trainerAfter.revision,
        trainerDexExpAfterReward: reward.currentDexExp,
        appliedRewardAmount: reward.appliedRewardAmount,
        settledAtCampaignMinute: evidence.campaignMinute,
      })
      const inserted = sourceOperations.insert(settlement)
      if (inserted.kind !== 'inserted') {
        integrationFail('sourceOperation', 'fresh source settlement must insert exactly once.')
      }
      const result = Object.freeze({
        kind: 'executed' as const,
        sourceOperation: inserted.record,
        acquisition: reward.acquisition,
        trainerSheet: trainerAfter,
        reward,
        appliedRewardAmount: reward.appliedRewardAmount,
      })
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    }
    catch (error) {
      database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      throw error
    }
  })
}
