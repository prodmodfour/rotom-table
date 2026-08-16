import type { AuthRole } from '#shared/auth'
import {
  EncounterSettlementCommitCommandParseError,
  parseEncounterSettlementCommitCommand,
  type EncounterSettlementCommitCommand,
} from '#shared/encounterSettlement/atomicCommit'
import type {
  EncounterSettlementAtomicAuthoritySnapshot,
  EncounterSettlementAtomicCommitPlan,
} from '../domain/encounterSettlement/atomicCommit'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteEncounterSettlementRepository,
  EncounterSettlementRepositoryError,
  type EncounterSettlementRepository,
} from '../storage/encounterSettlementRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'

export class CommitEncounterSettlementUseCaseError
  extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface CommitEncounterSettlementInput {
  readonly role: AuthRole
  readonly principalKey: string
  readonly command: unknown
}

export interface CommitEncounterSettlementResponse {
  readonly replayed: boolean
  readonly status: 'accepted'
  readonly settlementRevision: number
  readonly encounterRevision: number
  readonly mapRevision: number | null
  readonly changedSheetCount: number
  readonly changedGroupCount: number
  readonly historyFactCount: number
  readonly attentionSourceCount: number
  readonly completedAtCampaignMinute: number
}

export interface CommitEncounterSettlementDependencies {
  readonly database?: RotomDatabase
  readonly repository?: Pick<EncounterSettlementRepository, 'applyAtomicCommit'>
  /** Loads the exact server-owned preview selected by the opaque command hash. */
  readonly loadPreparedPlan: (
    command: EncounterSettlementCommitCommand,
  ) => EncounterSettlementAtomicCommitPlan | null
  /** Rebuilds all current eligibility, participant, destination, map, and document reads under lock. */
  readonly loadCurrentAuthority: (
    plan: EncounterSettlementAtomicCommitPlan,
    command: EncounterSettlementCommitCommand,
  ) => EncounterSettlementAtomicAuthoritySnapshot
  readonly publishRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportRealtimePublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const parseCommand = (value: unknown): EncounterSettlementCommitCommand => {
  try { return parseEncounterSettlementCommitCommand(value) }
  catch (error) {
    if (error instanceof EncounterSettlementCommitCommandParseError) {
      throw new CommitEncounterSettlementUseCaseError(400, 'Invalid encounter settlement commit command.')
    }
    throw error
  }
}

const mapRepositoryError = (error: EncounterSettlementRepositoryError): never => {
  if (error.code === 'invalid-input') {
    throw new CommitEncounterSettlementUseCaseError(400, 'Invalid encounter settlement commit command.')
  }
  if (error.code === 'duplicate-operation') {
    throw new CommitEncounterSettlementUseCaseError(409, 'Encounter settlement operation identity is already bound to another command.')
  }
  if (error.code === 'stale-authority') {
    throw new CommitEncounterSettlementUseCaseError(409, 'Encounter settlement authority changed; review and confirm the current preview.')
  }
  throw error
}

export const commitEncounterSettlement = (
  input: CommitEncounterSettlementInput,
  dependencies: CommitEncounterSettlementDependencies,
): CommitEncounterSettlementResponse => {
  if (input.role !== 'gm') {
    throw new CommitEncounterSettlementUseCaseError(403, 'Only the GM may commit encounter settlement.')
  }
  const command = parseCommand(input.command)
  const plan = dependencies.loadPreparedPlan(command)
  if (!plan) {
    throw new CommitEncounterSettlementUseCaseError(409, 'The selected encounter settlement preview is unavailable or stale.')
  }
  const database = dependencies.database ?? getRotomDatabase()
  const repository = dependencies.repository ?? createSqliteEncounterSettlementRepository(database)
  try {
    const applied = repository.applyAtomicCommit({
      principalKey: input.principalKey,
      command,
      plan,
      reauthorize: () => dependencies.loadCurrentAuthority(plan, command),
    })
    if (!applied.replayed) {
      publishPersistedRealtimeEventsAfterCommit({
        events: applied.persistedRealtimeEvents,
        operation: 'encounter-settlement-commit',
        publish: dependencies.publishRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
        reportFailure: dependencies.reportRealtimePublicationFailure
          ?? defaultPersistedRealtimePublicationFailureReporter,
      })
    }
    return Object.freeze({
      replayed: applied.replayed,
      status: 'accepted',
      settlementRevision: applied.result.settlementRevision,
      encounterRevision: applied.result.encounterRevision,
      mapRevision: applied.result.mapRevision,
      changedSheetCount: applied.result.sheetRevisions.length,
      changedGroupCount: applied.result.groupRevisions.length,
      historyFactCount: applied.result.historyFactIds.length,
      attentionSourceCount: applied.result.attentionSourceIds.length,
      completedAtCampaignMinute: applied.result.completedAtCampaignMinute,
    })
  }
  catch (error) {
    if (error instanceof EncounterSettlementRepositoryError) return mapRepositoryError(error)
    throw error
  }
}
