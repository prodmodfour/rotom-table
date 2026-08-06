import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseRecordTrainerSpeciesAcquisitionRequestV1,
  type RecordTrainerSpeciesAcquisitionRequestV1,
  type TrainerSpeciesAcquisitionSourceKind,
} from '#shared/speciesAcquisition'
import type { BreedingSpeciesAcquisitionArchiveRecordV1 } from '#shared/breeding/archives'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createBreedingSpeciesAcquisitionArchiveRecordV1 } from '../domain/breeding/archives'
import { isCanonicalBreedingSpeciesId } from '../domain/breeding/canonicalIds'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import {
  createSqliteTrainerSpeciesAcquisitionRepository,
  type TrainerSpeciesAcquisitionRepository,
} from '../storage/trainerSpeciesAcquisitionRepository'
import { BreedingRepositoryIdentityCollisionError } from '../storage/breedingRepositorySupport'

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
        if (!replaced || !replaced.changed || replaced.sheet.revision !== trainer.revision + 1 || replaced.sheet.sheet.dexExp !== nextDexExp) fail('species-acquisition.trainer-stale', 'trainer', 'reward compare-and-swap did not apply exactly once.')
        database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return freezeResult({ outcome: 'first-acquisition-rewarded', sourceKind: request.sourceKind, acquisition: inserted.record, trainerSheetSlug: trainer.slug, trainerRevision: replaced.sheet.revision, currentDexExp: nextDexExp, historicalRewardAmount: 1, appliedRewardAmount: 1 })
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
