import type {
  BreedingOperationCommandV1,
  BreedingOperationResultV1,
} from '#shared/breeding/operations'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  createSqliteBreedingCheckLedgerRepository,
  type BreedingCheckLedgerRepository,
} from '../storage/breedingCheckLedgerRepository'
import {
  createSqliteBreedingConsentRepository,
  type BreedingConsentRepository,
} from '../storage/breedingConsentRepository'
import {
  createSqliteBreedingOptionOfferRepository,
  type BreedingOptionOfferRepository,
} from '../storage/breedingOptionOfferRepository'
import {
  createSqliteBreedingIncubationSegmentRepository,
  type BreedingIncubationSegmentRepository,
} from '../storage/breedingIncubationSegmentRepository'
import {
  createSqliteBreedingGmAdjudicationRepository,
  type BreedingGmAdjudicationRepository,
} from '../storage/breedingGmAdjudicationRepository'
import {
  createSqliteBreedingLineageRepository,
  type BreedingLineageRepository,
} from '../storage/breedingLineageRepository'
import {
  createSqliteBreedingRollRepository,
  type BreedingRollRepository,
} from '../storage/breedingRollRepository'
import {
  createSqliteBreedingOperationRepository,
  type BreedingOperationLedgerRecord,
  type BreedingOperationRepository,
} from '../storage/breedingOperationRepository'
import {
  createSqliteBreedingOperationEvidenceRepository,
  type BreedingOperationEvidenceRepository,
} from '../storage/breedingOperationEvidenceRepository'
import {
  createSqliteBreedingProjectRepository,
  type BreedingProjectRepository,
} from '../storage/breedingProjectRepository'
import {
  createSqliteCampaignClockRepository,
  type CampaignClockRepository,
} from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteInitializedPokemonSheetRepository,
  type InitializedPokemonSheetRepository,
} from '../storage/initializedPokemonSheetRepository'
import {
  createSqlitePokemonEggRepository,
  type PokemonEggRepository,
} from '../storage/pokemonEggRepository'
import {
  createSqlitePokemonEggTransferConsentRepository,
  type PokemonEggTransferConsentRepository,
} from '../storage/pokemonEggTransferConsentRepository'
import {
  createSqliteRealtimeEventRepository,
  type AppendRealtimeEventInput,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqliteTrainerSpeciesAcquisitionRepository,
  type TrainerSpeciesAcquisitionRepository,
} from '../storage/trainerSpeciesAcquisitionRepository'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import {
  createTrainerSpeciesAcquisitionRewardService,
  type TrainerSpeciesAcquisitionRewardService,
} from './recordTrainerSpeciesAcquisition'
import { executeCampaignOperation } from './executeCampaignOperation'

export const BREEDING_TRANSACTION_REALTIME_EVENT_MAXIMUM = 1_000 as const

type TransactionRepository<Repository extends { readonly database: RotomDatabase }> = Omit<Repository, 'database'>
type BreedingSheetRepository = Pick<SheetRepository,
  | 'get'
  | 'getByRef'
  | 'list'
  | 'save'
  | 'replaceSetupSheet'
  | 'assertRevisions'
  | 'applyLivePlayUpdate'
>

export interface BreedingTransactionRepositories {
  readonly projects: TransactionRepository<BreedingProjectRepository>
  readonly eggs: TransactionRepository<PokemonEggRepository>
  readonly transferConsents: TransactionRepository<PokemonEggTransferConsentRepository>
  readonly consents: TransactionRepository<BreedingConsentRepository>
  readonly sheets: BreedingSheetRepository
  readonly initializedPokemonSheets: TransactionRepository<InitializedPokemonSheetRepository>
  readonly speciesAcquisitions: TransactionRepository<TrainerSpeciesAcquisitionRepository>
  readonly speciesAcquisitionRewards: TransactionRepository<TrainerSpeciesAcquisitionRewardService>
  readonly campaignClock: TransactionRepository<CampaignClockRepository>
  readonly checkLedger: TransactionRepository<BreedingCheckLedgerRepository>
  readonly rolls: TransactionRepository<BreedingRollRepository>
  readonly optionOffers: TransactionRepository<BreedingOptionOfferRepository>
  readonly gmAdjudications: TransactionRepository<BreedingGmAdjudicationRepository>
  readonly lineage: TransactionRepository<BreedingLineageRepository>
  readonly incubationSegments: TransactionRepository<BreedingIncubationSegmentRepository>
  readonly operationEvidence: TransactionRepository<BreedingOperationEvidenceRepository>
}

export interface BreedingTransactionContext {
  readonly repositories: BreedingTransactionRepositories
  appendRealtime(inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[]
}

export interface ExecuteBreedingTransactionInput {
  readonly command: unknown
  readonly createdAtCampaignMinute: number
  readonly settledAtCampaignMinute: number | (() => number)
  readonly resumePending?: boolean
  readonly execute: (
    command: BreedingOperationCommandV1,
    operation: BreedingOperationLedgerRecord,
    context: BreedingTransactionContext,
  ) => BreedingOperationResultV1
  /** Failure injection and final validation immediately before terminal settlement. */
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}

export interface BreedingTransactionExecutionDecision {
  readonly kind: 'exact-retry' | 'executed' | 'pending'
  readonly record: BreedingOperationLedgerRecord
  readonly committedRealtimeEvents: readonly PersistedRealtimeEvent[]
  readonly publicationFailureCount: number
}

export interface BreedingTransactionCoordinator {
  readonly database: RotomDatabase
  execute(input: ExecuteBreedingTransactionInput): BreedingTransactionExecutionDecision
}

export interface CreateBreedingTransactionCoordinatorOptions {
  readonly database?: RotomDatabase
  readonly projectRepository?: BreedingProjectRepository
  readonly eggRepository?: PokemonEggRepository
  readonly transferConsentRepository?: PokemonEggTransferConsentRepository
  readonly consentRepository?: BreedingConsentRepository
  readonly sheetRepository?: SheetRepository
  readonly initializedPokemonSheetRepository?: InitializedPokemonSheetRepository
  readonly speciesAcquisitionRepository?: TrainerSpeciesAcquisitionRepository
  readonly speciesAcquisitionRewardService?: TrainerSpeciesAcquisitionRewardService
  readonly campaignClockRepository?: CampaignClockRepository
  readonly checkLedgerRepository?: BreedingCheckLedgerRepository
  readonly rollRepository?: BreedingRollRepository
  readonly optionOfferRepository?: BreedingOptionOfferRepository
  readonly gmAdjudicationRepository?: BreedingGmAdjudicationRepository
  readonly lineageRepository?: BreedingLineageRepository
  readonly incubationSegmentRepository?: BreedingIncubationSegmentRepository
  readonly operationRepository?: BreedingOperationRepository
  readonly operationEvidenceRepository?: BreedingOperationEvidenceRepository
  readonly realtimeEventRepository?: RealtimeEventRepository
  readonly publish?: PersistedRealtimeEventPublisher
  readonly reportPublicationFailure?: PersistedRealtimePublicationFailureReporter
}

export type BreedingTransactionCoordinatorErrorCode =
  | 'breeding.transaction.repository-mismatch'
  | 'breeding.transaction.nested-boundary'
  | 'breeding.transaction.inactive-context'
  | 'breeding.transaction.async-executor'
  | 'breeding.transaction.invalid-event-batch'
  | 'breeding.transaction.event-replay'

export class BreedingTransactionCoordinatorError extends Error {
  readonly code: BreedingTransactionCoordinatorErrorCode
  readonly field: string

  constructor(code: BreedingTransactionCoordinatorErrorCode, field: string, message: string) {
    super(`Breeding transaction ${field}: ${message}`)
    this.name = 'BreedingTransactionCoordinatorError'
    this.code = code
    this.field = field
  }
}

const fail = (
  code: BreedingTransactionCoordinatorErrorCode,
  field: string,
  message: string,
): never => {
  throw new BreedingTransactionCoordinatorError(code, field, message)
}

const promiseLike = (value: unknown): value is PromiseLike<unknown> => (
  (typeof value === 'object' || typeof value === 'function')
  && value !== null
  && typeof (value as { readonly then?: unknown }).then === 'function'
)

const requireRepositoryDatabase = (
  database: RotomDatabase,
  repository: { readonly database?: RotomDatabase },
  field: string,
): void => {
  if (repository.database !== database) {
    fail(
      'breeding.transaction.repository-mismatch',
      field,
      'must use the coordinator database connection.',
    )
  }
}

/**
 * Owns the only top-level phase-2 Breeding transaction boundary.
 *
 * The generic operation reservation commits first. The planner then writes all
 * aggregates, sheets, history, event-log rows, and the terminal operation result
 * on one SQLite connection. Event publication begins only after that top-level
 * transaction has returned successfully. Calling this coordinator inside another
 * transaction is rejected because no nested callback can prove outer commit.
 */
export const createBreedingTransactionCoordinator = (
  options: CreateBreedingTransactionCoordinatorOptions = {},
): BreedingTransactionCoordinator => {
  const database = options.database ?? getRotomDatabase()
  const projects = options.projectRepository ?? createSqliteBreedingProjectRepository(database)
  const eggs = options.eggRepository ?? createSqlitePokemonEggRepository(database)
  const transferConsents = options.transferConsentRepository
    ?? createSqlitePokemonEggTransferConsentRepository(database)
  const consents = options.consentRepository ?? createSqliteBreedingConsentRepository(database)
  const sheetRepository = options.sheetRepository ?? createSqliteSheetRepository(database)
  const initializedPokemonSheets = options.initializedPokemonSheetRepository
    ?? createSqliteInitializedPokemonSheetRepository({ database })
  const speciesAcquisitions = options.speciesAcquisitionRepository
    ?? createSqliteTrainerSpeciesAcquisitionRepository(database)
  const speciesAcquisitionRewards = options.speciesAcquisitionRewardService
    ?? createTrainerSpeciesAcquisitionRewardService({
      database,
      sheetRepository,
      acquisitionRepository: speciesAcquisitions,
    })
  const campaignClock = options.campaignClockRepository
    ?? createSqliteCampaignClockRepository(database)
  const checkLedger = options.checkLedgerRepository
    ?? createSqliteBreedingCheckLedgerRepository(database)
  const rolls = options.rollRepository ?? createSqliteBreedingRollRepository(database)
  const optionOffers = options.optionOfferRepository ?? createSqliteBreedingOptionOfferRepository(database)
  const gmAdjudications = options.gmAdjudicationRepository ?? createSqliteBreedingGmAdjudicationRepository(database)
  const lineage = options.lineageRepository ?? createSqliteBreedingLineageRepository(database)
  const incubationSegments = options.incubationSegmentRepository
    ?? createSqliteBreedingIncubationSegmentRepository(database)
  const operations = options.operationRepository
    ?? createSqliteBreedingOperationRepository(database)
  const operationEvidence = options.operationEvidenceRepository
    ?? createSqliteBreedingOperationEvidenceRepository(database)
  const realtimeEvents = options.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })

  for (const [field, repository] of [
    ['projectRepository', projects],
    ['eggRepository', eggs],
    ['transferConsentRepository', transferConsents],
    ['consentRepository', consents],
    ['sheetRepository', sheetRepository],
    ['initializedPokemonSheetRepository', initializedPokemonSheets],
    ['speciesAcquisitionRepository', speciesAcquisitions],
    ['speciesAcquisitionRewardService', speciesAcquisitionRewards],
    ['campaignClockRepository', campaignClock],
    ['checkLedgerRepository', checkLedger],
    ['rollRepository', rolls],
    ['optionOfferRepository', optionOffers],
    ['gmAdjudicationRepository', gmAdjudications],
    ['lineageRepository', lineage],
    ['incubationSegmentRepository', incubationSegments],
    ['operationRepository', operations],
    ['operationEvidenceRepository', operationEvidence],
    ['realtimeEventRepository', realtimeEvents],
  ] as const) requireRepositoryDatabase(database, repository, field)

  const publish = options.publish ?? defaultPersistedRealtimeEventPublisher
  const reportPublicationFailure = options.reportPublicationFailure
    ?? defaultPersistedRealtimePublicationFailureReporter

  const execute = (
    input: ExecuteBreedingTransactionInput,
  ): BreedingTransactionExecutionDecision => {
    if (database.connection.isTransaction) {
      return fail(
        'breeding.transaction.nested-boundary',
        'execute',
        'must own the top-level transaction so publication cannot precede an outer commit.',
      )
    }

    let committedRealtimeEvents: PersistedRealtimeEvent[] = []
    const decision = executeCampaignOperation<
      BreedingOperationCommandV1,
      BreedingOperationResultV1,
      BreedingOperationLedgerRecord
    >({
      repository: operations,
      command: input.command,
      createdAtCampaignMinute: input.createdAtCampaignMinute,
      settledAtCampaignMinute: input.settledAtCampaignMinute,
      ...(input.resumePending === true ? { resumePending: true } : {}),
      execute: (command, operation) => {
        let active = true
        const staged: PersistedRealtimeEvent[] = []
        const stagedSequences = new Set<number>()
        const requireActiveContext = (field: string): void => {
          if (!active || !database.connection.isTransaction) {
            fail(
              'breeding.transaction.inactive-context',
              field,
              'is usable only inside the active aggregate planner transaction.',
            )
          }
        }
        const guarded = <Arguments extends readonly unknown[], Result>(
          field: string,
          action: (...arguments_: Arguments) => Result,
        ) => (...arguments_: Arguments): Result => {
          requireActiveContext(field)
          return action(...arguments_)
        }
        const repositories: BreedingTransactionRepositories = Object.freeze({
          projects: Object.freeze({
            get: guarded('repositories.projects.get', projects.get.bind(projects)),
            listByOwner: guarded('repositories.projects.listByOwner', projects.listByOwner.bind(projects)),
            listByParent: guarded('repositories.projects.listByParent', projects.listByParent.bind(projects)),
            listByStatuses: guarded('repositories.projects.listByStatuses', projects.listByStatuses.bind(projects)),
            insert: guarded('repositories.projects.insert', projects.insert.bind(projects)),
            replace: guarded('repositories.projects.replace', projects.replace.bind(projects)),
          }),
          eggs: Object.freeze({
            get: guarded('repositories.eggs.get', eggs.get.bind(eggs)),
            listByOwner: guarded('repositories.eggs.listByOwner', eggs.listByOwner.bind(eggs)),
            listBySourceProject: guarded('repositories.eggs.listBySourceProject', eggs.listBySourceProject.bind(eggs)),
            listByStatuses: guarded('repositories.eggs.listByStatuses', eggs.listByStatuses.bind(eggs)),
            insert: guarded('repositories.eggs.insert', eggs.insert.bind(eggs)),
            replace: guarded('repositories.eggs.replace', eggs.replace.bind(eggs)),
          }),
          transferConsents: Object.freeze({
            get: guarded('repositories.transferConsents.get', transferConsents.get.bind(transferConsents)),
            listByEgg: guarded('repositories.transferConsents.listByEgg', transferConsents.listByEgg.bind(transferConsents)),
            listActiveByParticipant: guarded('repositories.transferConsents.listActiveByParticipant', transferConsents.listActiveByParticipant.bind(transferConsents)),
            insert: guarded('repositories.transferConsents.insert', transferConsents.insert.bind(transferConsents)),
            replace: guarded('repositories.transferConsents.replace', transferConsents.replace.bind(transferConsents)),
          }),
          consents: Object.freeze({
            get: guarded('repositories.consents.get', consents.get.bind(consents)),
            listByProject: guarded('repositories.consents.listByProject', consents.listByProject.bind(consents)),
            listCurrentlyUsableByProfile: guarded('repositories.consents.listCurrentlyUsableByProfile', consents.listCurrentlyUsableByProfile.bind(consents)),
            findActiveForParent: guarded('repositories.consents.findActiveForParent', consents.findActiveForParent.bind(consents)),
            insert: guarded('repositories.consents.insert', consents.insert.bind(consents)),
            replace: guarded('repositories.consents.replace', consents.replace.bind(consents)),
          }),
          sheets: Object.freeze({
            get: guarded('repositories.sheets.get', sheetRepository.get.bind(sheetRepository)),
            getByRef: guarded('repositories.sheets.getByRef', sheetRepository.getByRef.bind(sheetRepository)),
            list: guarded('repositories.sheets.list', sheetRepository.list.bind(sheetRepository)),
            save: guarded('repositories.sheets.save', sheetRepository.save.bind(sheetRepository)),
            replaceSetupSheet: guarded('repositories.sheets.replaceSetupSheet', sheetRepository.replaceSetupSheet.bind(sheetRepository)),
            assertRevisions: guarded('repositories.sheets.assertRevisions', sheetRepository.assertRevisions.bind(sheetRepository)),
            applyLivePlayUpdate: guarded('repositories.sheets.applyLivePlayUpdate', sheetRepository.applyLivePlayUpdate.bind(sheetRepository)),
          }),
          initializedPokemonSheets: Object.freeze({
            create: guarded('repositories.initializedPokemonSheets.create', initializedPokemonSheets.create.bind(initializedPokemonSheets)),
          }),
          speciesAcquisitions: Object.freeze({
            get: guarded('repositories.speciesAcquisitions.get', speciesAcquisitions.get.bind(speciesAcquisitions)),
            listByTrainer: guarded('repositories.speciesAcquisitions.listByTrainer', speciesAcquisitions.listByTrainer.bind(speciesAcquisitions)),
            listBySpecies: guarded('repositories.speciesAcquisitions.listBySpecies', speciesAcquisitions.listBySpecies.bind(speciesAcquisitions)),
            insert: guarded('repositories.speciesAcquisitions.insert', speciesAcquisitions.insert.bind(speciesAcquisitions)),
          }),
          speciesAcquisitionRewards: Object.freeze({
            record: guarded('repositories.speciesAcquisitionRewards.record', speciesAcquisitionRewards.record.bind(speciesAcquisitionRewards)),
          }),
          campaignClock: Object.freeze({
            get: guarded('repositories.campaignClock.get', campaignClock.get.bind(campaignClock)),
            advance: guarded('repositories.campaignClock.advance', campaignClock.advance.bind(campaignClock)),
          }),
          checkLedger: Object.freeze({
            getRoll: guarded('repositories.checkLedger.getRoll', checkLedger.getRoll.bind(checkLedger)),
            getRollByOperation: guarded('repositories.checkLedger.getRollByOperation', checkLedger.getRollByOperation.bind(checkLedger)),
            insertRoll: guarded('repositories.checkLedger.insertRoll', checkLedger.insertRoll.bind(checkLedger)),
            getCheck: guarded('repositories.checkLedger.getCheck', checkLedger.getCheck.bind(checkLedger)),
            getCheckByProject: guarded('repositories.checkLedger.getCheckByProject', checkLedger.getCheckByProject.bind(checkLedger)),
            insertCheck: guarded('repositories.checkLedger.insertCheck', checkLedger.insertCheck.bind(checkLedger)),
          }),
          rolls: Object.freeze({
            get: guarded('repositories.rolls.get', rolls.get.bind(rolls)),
            listByOperation: guarded('repositories.rolls.listByOperation', rolls.listByOperation.bind(rolls)),
            findHatchSpecialByEgg: guarded('repositories.rolls.findHatchSpecialByEgg', rolls.findHatchSpecialByEgg.bind(rolls)),
            findLatestEggWarmerCapabilityBySource: guarded('repositories.rolls.findLatestEggWarmerCapabilityBySource', rolls.findLatestEggWarmerCapabilityBySource.bind(rolls)),
            insert: guarded('repositories.rolls.insert', rolls.insert.bind(rolls)),
          }),
          optionOffers: Object.freeze({
            get: guarded('repositories.optionOffers.get', optionOffers.get.bind(optionOffers)),
            listByProject: guarded('repositories.optionOffers.listByProject', optionOffers.listByProject.bind(optionOffers)),
            findByProjectOptionIds: guarded('repositories.optionOffers.findByProjectOptionIds', optionOffers.findByProjectOptionIds.bind(optionOffers)),
            findByTargetOptionIds: guarded('repositories.optionOffers.findByTargetOptionIds', optionOffers.findByTargetOptionIds.bind(optionOffers)),
            insert: guarded('repositories.optionOffers.insert', optionOffers.insert.bind(optionOffers)),
            replace: guarded('repositories.optionOffers.replace', optionOffers.replace.bind(optionOffers)),
          }),
          gmAdjudications: Object.freeze({
            get: guarded('repositories.gmAdjudications.get', gmAdjudications.get.bind(gmAdjudications)),
            listHatchSpecialByEgg: guarded('repositories.gmAdjudications.listHatchSpecialByEgg', gmAdjudications.listHatchSpecialByEgg.bind(gmAdjudications)),
            insert: guarded('repositories.gmAdjudications.insert', gmAdjudications.insert.bind(gmAdjudications)),
            replace: guarded('repositories.gmAdjudications.replace', gmAdjudications.replace.bind(gmAdjudications)),
          }),
          lineage: Object.freeze({
            getOrigin: guarded('repositories.lineage.getOrigin', lineage.getOrigin.bind(lineage)),
            findOriginByEgg: guarded('repositories.lineage.findOriginByEgg', lineage.findOriginByEgg.bind(lineage)),
            findOriginByChild: guarded('repositories.lineage.findOriginByChild', lineage.findOriginByChild.bind(lineage)),
            insertOrigin: guarded('repositories.lineage.insertOrigin', lineage.insertOrigin.bind(lineage)),
            listLearningByOrigin: guarded('repositories.lineage.listLearningByOrigin', lineage.listLearningByOrigin.bind(lineage)),
            insertLearning: guarded('repositories.lineage.insertLearning', lineage.insertLearning.bind(lineage)),
          }),
          incubationSegments: Object.freeze({
            get: guarded('repositories.incubationSegments.get', incubationSegments.get.bind(incubationSegments)),
            listByEgg: guarded('repositories.incubationSegments.listByEgg', incubationSegments.listByEgg.bind(incubationSegments)),
            insert: guarded('repositories.incubationSegments.insert', incubationSegments.insert.bind(incubationSegments)),
          }),
          operationEvidence: Object.freeze({
            get: guarded('repositories.operationEvidence.get', operationEvidence.get.bind(operationEvidence)),
            insert: guarded('repositories.operationEvidence.insert', operationEvidence.insert.bind(operationEvidence)),
          }),
        })
        const context: BreedingTransactionContext = Object.freeze({
          repositories,
          appendRealtime: (eventInputs): readonly PersistedRealtimeEvent[] => {
            requireActiveContext('appendRealtime')
            if (!Array.isArray(eventInputs) || eventInputs.length < 1
              || staged.length + eventInputs.length > BREEDING_TRANSACTION_REALTIME_EVENT_MAXIMUM) {
              return fail(
                'breeding.transaction.invalid-event-batch',
                'appendRealtime',
                `must stage 1-${BREEDING_TRANSACTION_REALTIME_EVENT_MAXIMUM} total events.`,
              )
            }
            const latestBeforeAppend = realtimeEvents.cursorState().latestSequence
            const persisted = realtimeEvents.appendMany(eventInputs)
            if (persisted.some(event => (
              event.sequence <= latestBeforeAppend || stagedSequences.has(event.sequence)
            ))) {
              return fail(
                'breeding.transaction.event-replay',
                'appendRealtime',
                'must create fresh unique event rows for this terminal settlement.',
              )
            }
            for (const event of persisted) {
              stagedSequences.add(event.sequence)
              staged.push(event)
            }
            return Object.freeze([...persisted])
          },
        })

        try {
          const result = input.execute(command, operation, context)
          if (promiseLike(result)) {
            return fail(
              'breeding.transaction.async-executor',
              'execute',
              'must be synchronous; asynchronous work belongs outside the transaction.',
            )
          }
          committedRealtimeEvents = staged
          return result
        } finally {
          active = false
        }
      },
      ...(input.beforeSettle ? {
        beforeSettle: (result: BreedingOperationResultV1): void => {
          const validation = input.beforeSettle?.(result)
          if (promiseLike(validation)) {
            fail(
              'breeding.transaction.async-executor',
              'beforeSettle',
              'must be synchronous; asynchronous work belongs outside the transaction.',
            )
          }
        },
      } : {}),
    })

    if (decision.kind !== 'executed') {
      return Object.freeze({
        kind: decision.kind,
        record: decision.record,
        committedRealtimeEvents: Object.freeze([]),
        publicationFailureCount: 0,
      })
    }

    const committed = Object.freeze([...committedRealtimeEvents].sort(
      (left, right) => left.sequence - right.sequence,
    ))
    let publicationFailureCount = 0
    publishPersistedRealtimeEventsAfterCommit({
      events: committed,
      operation: 'breeding-transaction',
      publish,
      reportFailure: context => {
        publicationFailureCount += 1
        try {
          reportPublicationFailure(context)
        }
        catch {
          // A broken observer cannot reinterpret an already committed operation as failed.
        }
      },
    })
    return Object.freeze({
      kind: decision.kind,
      record: decision.record,
      committedRealtimeEvents: committed,
      publicationFailureCount,
    })
  }

  return Object.freeze({ database, execute })
}
