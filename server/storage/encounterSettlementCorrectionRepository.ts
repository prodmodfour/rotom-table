import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  parseEncounterSettlementCorrectionCommand,
  parseEncounterSettlementCorrectionResult,
  type EncounterSettlementCorrectionCommand,
  type EncounterSettlementCorrectionResult,
} from '#shared/encounterSettlement/correction'
import {
  assertEncounterSettlementCorrectionPlanCurrent,
  assertEncounterSettlementCorrectionPlanIntegrity,
  type EncounterSettlementCorrectionAuthoritySnapshot,
  type EncounterSettlementCorrectionPlan,
  type EncounterSettlementCorrectionReasonCode,
} from '../domain/encounterSettlement/correction'
import { encounterSettlementAtomicDefinitionSha256 } from '../domain/encounterSettlement/atomicCommit'
import { encounterSettlementRealtimeAppendInputs } from '../realtime/encounterSettlementRealtime'
import { getRotomDatabase, type RotomDatabase } from './database'
import { createSqliteCampaignClockRepository } from './campaignClockRepository'
import { createSqliteEncounterSettlementRepository } from './encounterSettlementRepository'
import { createSqliteRealtimeEventRepository } from './realtimeEventRepository'

export interface StoredEncounterSettlementCorrection {
  readonly operationId: string
  readonly settlementId: string
  readonly principalKey: string
  readonly sourceReceiptId: string
  readonly reasonCode: EncounterSettlementCorrectionReasonCode
  readonly commandSha256: string
  readonly command: EncounterSettlementCorrectionCommand
  readonly offerDefinitionSha256: string
  readonly authorityDefinitionSha256: string
  readonly result: EncounterSettlementCorrectionResult
  readonly resultDefinitionSha256: string
  readonly settlementRevision: number
  readonly createdAt: number
  readonly acceptedAtCampaignMinute: number
}

export type EncounterSettlementCorrectionWriteBoundary =
  | 'after-settlement-write'
  | 'after-correction-write'
  | 'after-realtime-write'
  | 'before-commit'

export interface ApplyEncounterSettlementCorrectionInput {
  readonly principalKey: string
  readonly command: EncounterSettlementCorrectionCommand
  readonly plan: EncounterSettlementCorrectionPlan
  readonly reauthorize: () => EncounterSettlementCorrectionAuthoritySnapshot
  readonly onWriteBoundary?: (boundary: EncounterSettlementCorrectionWriteBoundary) => void
}

export interface ApplyEncounterSettlementCorrectionResult {
  readonly replayed: boolean
  readonly result: EncounterSettlementCorrectionResult
  readonly persistedRealtimeEvents: readonly PersistedRealtimeEvent[]
}

export interface EncounterSettlementCorrectionRepository {
  readonly database: RotomDatabase
  getOperation(operationId: string): StoredEncounterSettlementCorrection | null
  listBySettlement(settlementId: string): readonly StoredEncounterSettlementCorrection[]
  apply(input: ApplyEncounterSettlementCorrectionInput): ApplyEncounterSettlementCorrectionResult
}

export type EncounterSettlementCorrectionRepositoryErrorCode =
  | 'invalid-input'
  | 'corrupt-record'
  | 'duplicate-operation'
  | 'stale-authority'
  | 'write-drift'

export class EncounterSettlementCorrectionRepositoryError extends Error {
  constructor(readonly code: EncounterSettlementCorrectionRepositoryErrorCode, message: string) {
    super(message)
    this.name = 'EncounterSettlementCorrectionRepositoryError'
  }
}

interface CorrectionRow {
  readonly operation_id: unknown
  readonly settlement_id: unknown
  readonly principal_key: unknown
  readonly source_receipt_id: unknown
  readonly reason_code: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly offer_definition_sha256: unknown
  readonly authority_definition_sha256: unknown
  readonly evidence_json: unknown
  readonly result_json: unknown
  readonly result_definition_sha256: unknown
  readonly settlement_revision: unknown
  readonly created_at: unknown
  readonly accepted_at_campaign_minute: unknown
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/
const fail = (code: EncounterSettlementCorrectionRepositoryErrorCode, message: string): never => {
  throw new EncounterSettlementCorrectionRepositoryError(code, message)
}
const id = (value: unknown, label: string): string => (
  typeof value === 'string' && ID.test(value)
    ? value
    : fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid.`)
)
const text = (value: unknown, label: string, max: number): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= max
    ? value
    : fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid.`)
)
const integer = (value: unknown, label: string): number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid.`)
)
const hash = (value: unknown, label: string): string => (
  typeof value === 'string' && HASH.test(value)
    ? value
    : fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid.`)
)
const json = <Value>(value: unknown, label: string): Value => {
  const serialized = typeof value === 'string'
    ? value
    : fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid.`)
  try { return JSON.parse(serialized) as Value }
  catch { return fail('corrupt-record', `Stored encounter settlement correction ${label} is invalid JSON.`) }
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const principal = (value: unknown): string => (
  typeof value === 'string' && value.length >= 1 && value.length <= 160
    ? value
    : fail('invalid-input', 'Encounter settlement correction principal is invalid.')
)
const reason = (value: unknown): EncounterSettlementCorrectionReasonCode => {
  const parsed = text(value, 'reason code', 100)
  if (!['reward-adjusted', 'capture-corrected', 'outcome-corrected', 'cleanup-corrected', 'clerical-corrected', 'authority-linked'].includes(parsed)) {
    fail('corrupt-record', 'Stored encounter settlement correction reason code is invalid.')
  }
  return parsed as EncounterSettlementCorrectionReasonCode
}

const columns = `
  operation_id, settlement_id, principal_key, source_receipt_id, reason_code,
  command_sha256, command_json, offer_definition_sha256, authority_definition_sha256,
  evidence_json, result_json, result_definition_sha256, settlement_revision, created_at,
  accepted_at_campaign_minute
`

const fromRow = (row: CorrectionRow): StoredEncounterSettlementCorrection => {
  const command = parseEncounterSettlementCorrectionCommand(json(row.command_json, 'command'))
  const evidence = assertEncounterSettlementCorrectionPlanIntegrity(
    json(row.evidence_json, 'plan evidence'),
  )
  const result = parseEncounterSettlementCorrectionResult(json(row.result_json, 'result'))
  const operationId = id(row.operation_id, 'operation identity')
  const settlementId = id(row.settlement_id, 'settlement identity')
  const commandSha256 = hash(row.command_sha256, 'command hash')
  const offerDefinitionSha256 = hash(row.offer_definition_sha256, 'offer hash')
  const authorityDefinitionSha256 = hash(row.authority_definition_sha256, 'authority hash')
  const settlementRevision = integer(row.settlement_revision, 'settlement revision')
  const acceptedAtCampaignMinute = integer(row.accepted_at_campaign_minute, 'accepted minute')
  const sourceReceiptId = id(row.source_receipt_id, 'source receipt identity')
  const reasonCode = reason(row.reason_code)
  const resultDefinitionSha256 = hash(row.result_definition_sha256, 'result hash')
  if (command.operationId !== operationId || command.settlementId !== settlementId
    || command.offerDefinitionSha256 !== offerDefinitionSha256
    || evidence.operationId !== operationId || evidence.settlementId !== settlementId
    || evidence.sourceReceiptId !== sourceReceiptId || evidence.reasonCode !== reasonCode
    || evidence.offerDefinitionSha256 !== offerDefinitionSha256
    || evidence.authorityDefinitionSha256 !== authorityDefinitionSha256
    || result.operationId !== operationId || result.settlementId !== settlementId
    || result.reasonCode !== reasonCode || result.settlementRevision !== settlementRevision
    || result.correctedAtCampaignMinute !== acceptedAtCampaignMinute
    || sha256(command) !== commandSha256 || sha256(result) !== resultDefinitionSha256) {
    fail('corrupt-record', 'Stored encounter settlement correction columns do not match immutable evidence.')
  }
  return Object.freeze({
    operationId,
    settlementId,
    principalKey: text(row.principal_key, 'principal', 160),
    sourceReceiptId,
    reasonCode,
    commandSha256,
    command,
    offerDefinitionSha256,
    authorityDefinitionSha256,
    result,
    resultDefinitionSha256,
    settlementRevision,
    createdAt: integer(row.created_at, 'created timestamp'),
    acceptedAtCampaignMinute,
  })
}

export const createSqliteEncounterSettlementCorrectionRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterSettlementCorrectionRepository => {
  const getOperation = (operationIdInput: string): StoredEncounterSettlementCorrection | null => {
    if (!ID.test(operationIdInput)) fail('invalid-input', 'Encounter settlement correction operation identity is invalid.')
    const row = database.connection.prepare(`
      SELECT ${columns} FROM encounter_settlement_corrections WHERE operation_id = ?
    `).get(operationIdInput) as unknown as CorrectionRow | undefined
    return row ? fromRow(row) : null
  }

  const listBySettlement = (settlementIdInput: string): readonly StoredEncounterSettlementCorrection[] => {
    if (!ID.test(settlementIdInput)) fail('invalid-input', 'Encounter settlement identity is invalid.')
    return (database.connection.prepare(`
      SELECT ${columns} FROM encounter_settlement_corrections
      WHERE settlement_id = ?
      ORDER BY settlement_revision DESC, operation_id DESC
    `).all(settlementIdInput) as unknown as CorrectionRow[]).map(fromRow)
  }

  const apply = (input: ApplyEncounterSettlementCorrectionInput): ApplyEncounterSettlementCorrectionResult => {
    const command = parseEncounterSettlementCorrectionCommand(input.command)
    const actor = principal(input.principalKey)
    const plan = assertEncounterSettlementCorrectionPlanIntegrity(input.plan)
    if (command.operationId !== plan.operationId || command.settlementId !== plan.settlementId
      || command.expectedSettlementRevision !== plan.expectedSettlementRevision
      || command.offerDefinitionSha256 !== plan.offerDefinitionSha256) {
      fail('invalid-input', 'Encounter settlement correction command does not match its server-owned offer.')
    }
    const commandSha256 = sha256(command)
    return database.withTransaction(() => {
      const replay = getOperation(command.operationId)
      const collidingCommit = database.connection.prepare(`
        SELECT 1 AS present FROM encounter_settlement_operations WHERE operation_id = ?
      `).get(command.operationId)
      if (replay && collidingCommit) {
        fail('duplicate-operation', 'Correction operation identity is ambiguous across settlement journals.')
      }
      if (replay) {
        if (replay.commandSha256 !== commandSha256 || replay.principalKey !== actor) {
          fail('duplicate-operation', 'Correction operation identity is already bound to another command authority.')
        }
        return Object.freeze({ replayed: true, result: replay.result, persistedRealtimeEvents: [] })
      }
      if (collidingCommit) {
        fail('duplicate-operation', 'Correction operation identity is already bound to a settlement commit.')
      }
      const authority = input.reauthorize()
      assertEncounterSettlementCorrectionPlanCurrent({ plan, authority })
      if (createSqliteCampaignClockRepository(database).get().campaignMinute !== plan.campaignMinute) {
        fail('stale-authority', 'Campaign clock changed before encounter settlement correction.')
      }
      const settlementRepository = createSqliteEncounterSettlementRepository(database)
      const current = settlementRepository.get(plan.settlementId)
      if (!current || current.revision !== plan.expectedSettlementRevision
        || encounterSettlementAtomicDefinitionSha256(current) !== plan.beforeDefinitionSha256) {
        fail('stale-authority', 'Encounter settlement changed before correction commit.')
      }
      const next = settlementRepository.replace({
        expectedRevision: plan.expectedSettlementRevision,
        document: plan.nextDocument,
      })
      if (!next || encounterSettlementAtomicDefinitionSha256(next) !== plan.afterDefinitionSha256) {
        fail('write-drift', 'Encounter settlement correction did not persist its exact successor.')
      }
      input.onWriteBoundary?.('after-settlement-write')
      const result = parseEncounterSettlementCorrectionResult({
        schemaVersion: 1,
        operationId: plan.operationId,
        settlementId: plan.settlementId,
        settlementRevision: plan.nextDocument.revision,
        reasonCode: plan.reasonCode,
        correctedAtCampaignMinute: plan.campaignMinute,
      })
      database.connection.prepare(`
        INSERT INTO encounter_settlement_corrections (
          operation_id, settlement_id, principal_key, source_receipt_id, reason_code,
          command_sha256, command_json, offer_definition_sha256, authority_definition_sha256,
          evidence_json, result_json, result_definition_sha256, settlement_revision,
          created_at, accepted_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.operationId,
        plan.settlementId,
        actor,
        plan.sourceReceiptId,
        plan.reasonCode,
        commandSha256,
        stableJsonStringify(command),
        plan.offerDefinitionSha256,
        plan.authorityDefinitionSha256,
        stableJsonStringify(plan),
        stableJsonStringify(result),
        sha256(result),
        plan.nextDocument.revision,
        plan.committedAt,
        plan.campaignMinute,
      )
      input.onWriteBoundary?.('after-correction-write')
      const history = settlementRepository.listHistoryFacts(plan.settlementId)
      const persistedRealtimeEvents = createSqliteRealtimeEventRepository({
        database,
        clock: () => plan.committedAt,
      }).appendMany(encounterSettlementRealtimeAppendInputs({
        settlement: plan.nextDocument,
        history,
        kind: 'corrected',
        timestamp: plan.committedAt,
      }))
      input.onWriteBoundary?.('after-realtime-write')
      input.onWriteBoundary?.('before-commit')
      return Object.freeze({ replayed: false, result, persistedRealtimeEvents })
    })
  }

  return Object.freeze({ database, getOperation, listBySettlement, apply })
}
