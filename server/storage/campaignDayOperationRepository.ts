import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseCampaignDayOperationAcceptedV1,
  parseCampaignDayOperationCommandV1,
  parseCampaignDayOperationId,
  type CampaignDayOperationAcceptedV1,
  type CampaignDayOperationCommandV1,
  type CampaignDayOperationId,
} from '#shared/campaignDay'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface CampaignDayOperationRecord {
  readonly operationId: CampaignDayOperationId
  readonly commandSha256: string
  readonly command: CampaignDayOperationCommandV1
  readonly result: CampaignDayOperationAcceptedV1
  readonly createdAt: number
}

export interface CampaignDayOperationRepository {
  readonly database: RotomDatabase
  get(operationId: string): CampaignDayOperationRecord | null
  insertAccepted(input: {
    readonly command: CampaignDayOperationCommandV1
    readonly result: CampaignDayOperationAcceptedV1
    readonly createdAt: number
  }): CampaignDayOperationRecord
}

interface Row {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly created_at: unknown
}

export class CampaignDayOperationCollisionError extends Error {
  constructor(operationId: string) {
    super(`Campaign-day operation ${operationId} is already bound to different immutable evidence.`)
    this.name = 'CampaignDayOperationCollisionError'
  }
}

export const campaignDayOperationCommandSha256 = (command: CampaignDayOperationCommandV1): string => (
  createHash('sha256').update(stableJsonStringify(parseCampaignDayOperationCommandV1(command))).digest('hex')
)

const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const rowToRecord = (row: Row): CampaignDayOperationRecord => {
  const operationId = parseCampaignDayOperationId(row.operation_id, 'campaign_day_operations.operation_id')
  if (typeof row.command_json !== 'string' || typeof row.result_json !== 'string') {
    throw new Error(`Campaign-day operation ${operationId} has invalid stored JSON.`)
  }
  let rawCommand: unknown
  let rawResult: unknown
  try {
    rawCommand = JSON.parse(row.command_json)
    rawResult = JSON.parse(row.result_json)
  }
  catch {
    throw new Error(`Campaign-day operation ${operationId} has malformed stored JSON.`)
  }
  const command = parseCampaignDayOperationCommandV1(rawCommand)
  const result = parseCampaignDayOperationAcceptedV1(rawResult)
  const commandSha256 = campaignDayOperationCommandSha256(command)
  if (row.command_sha256 !== commandSha256 || result.commandSha256 !== commandSha256
    || command.operationId !== operationId || result.operationId !== operationId) {
    throw new Error(`Campaign-day operation ${operationId} failed immutable command/result binding.`)
  }
  if (!Number.isSafeInteger(row.created_at) || Number(row.created_at) < 0) {
    throw new Error(`Campaign-day operation ${operationId} has an invalid created_at value.`)
  }
  return Object.freeze({ operationId, commandSha256, command, result, createdAt: Number(row.created_at) })
}

export const createSqliteCampaignDayOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): CampaignDayOperationRepository => {
  const get = (operationIdValue: string): CampaignDayOperationRecord | null => {
    const operationId = parseCampaignDayOperationId(operationIdValue)
    const row = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_json, result_json, created_at
      FROM campaign_day_operations WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined
    return row ? rowToRecord(row) : null
  }

  const insertAccepted = (input: {
    readonly command: CampaignDayOperationCommandV1
    readonly result: CampaignDayOperationAcceptedV1
    readonly createdAt: number
  }): CampaignDayOperationRecord => {
    if (!database.connection.isTransaction) {
      throw new Error('Campaign-day operation insertion requires a caller-owned SQLite transaction.')
    }
    const command = parseCampaignDayOperationCommandV1(input.command)
    const result = parseCampaignDayOperationAcceptedV1(input.result)
    const commandSha256 = campaignDayOperationCommandSha256(command)
    if (result.operationId !== command.operationId || result.commandSha256 !== commandSha256) {
      throw new Error('Campaign-day result must bind its exact immutable command.')
    }
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      throw new Error('Campaign-day operation createdAt must be a nonnegative safe integer.')
    }
    const existing = get(command.operationId)
    if (existing) {
      if (existing.commandSha256 !== commandSha256 || !same(existing.command, command) || !same(existing.result, result)) {
        throw new CampaignDayOperationCollisionError(command.operationId)
      }
      return existing
    }
    database.connection.prepare(`
      INSERT INTO campaign_day_operations (
        operation_id, command_sha256, command_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      commandSha256,
      stableJsonStringify(command),
      stableJsonStringify(result),
      input.createdAt,
    )
    return get(command.operationId)
      ?? (() => { throw new Error(`Campaign-day operation ${command.operationId} was not readable after insertion.`) })()
  }

  return Object.freeze({ database, get, insertAccepted })
}
