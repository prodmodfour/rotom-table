import type { AuthRole } from '#shared/auth'
import {
  EncounterSettlementCorrectionParseError,
  parseEncounterSettlementCorrectionCommand,
  type EncounterSettlementCorrectionCommand,
} from '#shared/encounterSettlement/correction'
import type {
  EncounterSettlementCorrectionAuthoritySnapshot,
  EncounterSettlementCorrectionPlan,
} from '../domain/encounterSettlement/correction'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteEncounterSettlementCorrectionRepository,
  EncounterSettlementCorrectionRepositoryError,
  type EncounterSettlementCorrectionRepository,
} from '../storage/encounterSettlementCorrectionRepository'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class CorrectEncounterSettlementUseCaseError
  extends UseCaseHttpError<400 | 403 | 409> {}

export interface CorrectEncounterSettlementResponse {
  readonly replayed: boolean
  readonly status: 'accepted'
  readonly settlementRevision: number
  readonly reasonCode: string
  readonly correctedAtCampaignMinute: number
}

export interface CorrectEncounterSettlementDependencies {
  readonly database?: RotomDatabase
  readonly repository?: Pick<EncounterSettlementCorrectionRepository, 'apply'>
  readonly loadPreparedPlan: (
    command: EncounterSettlementCorrectionCommand,
  ) => EncounterSettlementCorrectionPlan | null
  readonly loadCurrentAuthority: (
    plan: EncounterSettlementCorrectionPlan,
    command: EncounterSettlementCorrectionCommand,
  ) => EncounterSettlementCorrectionAuthoritySnapshot
  readonly publishRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportRealtimePublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const repositoryError = (error: EncounterSettlementCorrectionRepositoryError): never => {
  if (error.code === 'invalid-input') {
    throw new CorrectEncounterSettlementUseCaseError(400, 'Invalid encounter settlement correction command.')
  }
  if (error.code === 'duplicate-operation') {
    throw new CorrectEncounterSettlementUseCaseError(409, 'Correction identity is already bound to another command.')
  }
  if (error.code === 'stale-authority') {
    throw new CorrectEncounterSettlementUseCaseError(409, 'Correction authority changed; review a fresh correction offer.')
  }
  throw error
}

export const correctEncounterSettlement = (
  input: { readonly role: AuthRole, readonly principalKey: string, readonly command: unknown },
  dependencies: CorrectEncounterSettlementDependencies,
): CorrectEncounterSettlementResponse => {
  if (input.role !== 'gm') {
    throw new CorrectEncounterSettlementUseCaseError(403, 'Only the GM may correct encounter settlement.')
  }
  let command: EncounterSettlementCorrectionCommand
  try { command = parseEncounterSettlementCorrectionCommand(input.command) }
  catch (error) {
    if (error instanceof EncounterSettlementCorrectionParseError) {
      throw new CorrectEncounterSettlementUseCaseError(400, 'Invalid encounter settlement correction command.')
    }
    throw error
  }
  const plan = dependencies.loadPreparedPlan(command)
  if (!plan) throw new CorrectEncounterSettlementUseCaseError(409, 'Correction offer is unavailable or stale.')
  const database = dependencies.database ?? getRotomDatabase()
  const repository = dependencies.repository ?? createSqliteEncounterSettlementCorrectionRepository(database)
  try {
    const applied = repository.apply({
      principalKey: input.principalKey,
      command,
      plan,
      reauthorize: () => dependencies.loadCurrentAuthority(plan, command),
    })
    if (!applied.replayed) {
      publishPersistedRealtimeEventsAfterCommit({
        events: applied.persistedRealtimeEvents,
        operation: 'encounter-settlement-correction',
        publish: dependencies.publishRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
        reportFailure: dependencies.reportRealtimePublicationFailure
          ?? defaultPersistedRealtimePublicationFailureReporter,
      })
    }
    return Object.freeze({
      replayed: applied.replayed,
      status: 'accepted',
      settlementRevision: applied.result.settlementRevision,
      reasonCode: applied.result.reasonCode,
      correctedAtCampaignMinute: applied.result.correctedAtCampaignMinute,
    })
  }
  catch (error) {
    if (error instanceof EncounterSettlementCorrectionRepositoryError) return repositoryError(error)
    throw error
  }
}
