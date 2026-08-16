import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterSettlementCommitCommand,
  type EncounterSettlementCommitCommand,
} from '#shared/encounterSettlement/atomicCommit'
import {
  parseEncounterSettlementCorrectionCommand,
  type EncounterSettlementCorrectionCommand,
} from '#shared/encounterSettlement/correction'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteEncounterSettlementRepository,
  type EncounterSettlementRepository,
} from '../storage/encounterSettlementRepository'
import {
  createSqliteEncounterSettlementCorrectionRepository,
  type EncounterSettlementCorrectionRepository,
} from '../storage/encounterSettlementCorrectionRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GetEncounterSettlementOperationStatusUseCaseError
  extends UseCaseHttpError<400 | 403 | 409> {}

export type EncounterSettlementOperationStatusResponse =
  | {
      readonly status: 'unknown'
      readonly retry: 'explicit-only'
    }
  | {
      readonly status: 'accepted'
      readonly operationKind: 'commit' | 'correction'
      readonly settlementRevision: number
      readonly acceptedAtCampaignMinute: number
      readonly retry: 'not-needed'
    }

export interface GetEncounterSettlementOperationStatusDependencies {
  readonly database?: RotomDatabase
  readonly settlementRepository?: Pick<EncounterSettlementRepository, 'getOperation'>
  readonly correctionRepository?: Pick<EncounterSettlementCorrectionRepository, 'getOperation'>
}

type RecoveryCommand = EncounterSettlementCommitCommand | EncounterSettlementCorrectionCommand

const parseCommand = (value: unknown): RecoveryCommand => {
  try { return parseEncounterSettlementCommitCommand(value) }
  catch {
    try { return parseEncounterSettlementCorrectionCommand(value) }
    catch { throw new GetEncounterSettlementOperationStatusUseCaseError(400, 'Invalid settlement recovery command.') }
  }
}
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

export const getEncounterSettlementOperationStatus = (input: {
  readonly role: AuthRole
  readonly principalKey: string
  readonly command: unknown
}, dependencies: GetEncounterSettlementOperationStatusDependencies = {}): EncounterSettlementOperationStatusResponse => {
  if (input.role !== 'gm') {
    throw new GetEncounterSettlementOperationStatusUseCaseError(403, 'Only the GM may recover settlement operations.')
  }
  if (typeof input.principalKey !== 'string' || input.principalKey.length < 1 || input.principalKey.length > 160) {
    throw new GetEncounterSettlementOperationStatusUseCaseError(400, 'Settlement recovery principal is invalid.')
  }
  const command = parseCommand(input.command)
  const commandSha256 = hash(command)
  const database = dependencies.database ?? getRotomDatabase()
  const settlementRepository = dependencies.settlementRepository
    ?? createSqliteEncounterSettlementRepository(database)
  const correctionRepository = dependencies.correctionRepository
    ?? createSqliteEncounterSettlementCorrectionRepository(database)
  const committed = settlementRepository.getOperation(command.operationId)
  const corrected = correctionRepository.getOperation(command.operationId)
  if (committed && corrected) {
    throw new GetEncounterSettlementOperationStatusUseCaseError(409, 'Settlement operation identity is ambiguous.')
  }
  if (committed) {
    if (committed.commandSha256 !== commandSha256 || committed.principalKey !== input.principalKey) {
      throw new GetEncounterSettlementOperationStatusUseCaseError(409, 'Settlement operation identity belongs to another exact command authority.')
    }
    return Object.freeze({
      status: 'accepted',
      operationKind: 'commit',
      settlementRevision: committed.settlementRevision,
      acceptedAtCampaignMinute: committed.acceptedAtCampaignMinute,
      retry: 'not-needed',
    })
  }
  if (corrected) {
    if (corrected.commandSha256 !== commandSha256 || corrected.principalKey !== input.principalKey) {
      throw new GetEncounterSettlementOperationStatusUseCaseError(409, 'Settlement operation identity belongs to another exact command authority.')
    }
    return Object.freeze({
      status: 'accepted',
      operationKind: 'correction',
      settlementRevision: corrected.settlementRevision,
      acceptedAtCampaignMinute: corrected.acceptedAtCampaignMinute,
      retry: 'not-needed',
    })
  }
  return Object.freeze({ status: 'unknown', retry: 'explicit-only' })
}
