import {
  parseCapabilityActionPublicResult,
  parseExecuteCapabilityActionCommand,
  type CapabilityActionPublicResult,
  type ExecuteCapabilityActionCommand,
} from '#shared/capabilityAutomation/clientCommands'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredCapabilityResolutionOperation {
  readonly commandSha256: string
  readonly command: ExecuteCapabilityActionCommand
  readonly result: CapabilityActionPublicResult
  readonly audit: StrictJsonValue
  readonly createdAt: number
}

export interface CapabilityResolutionOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (operationId: string) => StoredCapabilityResolutionOperation | null
  readonly insert: (input: StoredCapabilityResolutionOperation) => StoredCapabilityResolutionOperation
}

interface Row {
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly audit_json: unknown
  readonly map_slug: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const SHA256 = /^[0-9a-f]{64}$/
const parseAudit = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(
  value,
  'capabilityResolutionAudit',
  {
    limits: { depth: 32, nodes: 50_000, objectFields: 512, arrayEntries: 2_048, stringLength: 10_000, objectKeyLength: 200 },
    rootLabel: 'capability resolution audit',
    valueLabel: 'capability resolution audit values',
    failNotJson: (_path, detail) => { throw new Error(detail) },
    failLimit: (_path, detail) => { throw new Error(detail) },
  },
))

const rowRecord = (row: Row | undefined): StoredCapabilityResolutionOperation | null => {
  if (!row) return null
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.audit_json !== 'string' || !Number.isSafeInteger(row.created_at)) {
    throw new Error('Stored capability resolution operation is malformed.')
  }
  const command = parseExecuteCapabilityActionCommand(JSON.parse(row.command_json))
  const result = parseCapabilityActionPublicResult(JSON.parse(row.result_json))
  const audit = parseAudit(JSON.parse(row.audit_json))
  if (row.map_slug !== command.mapSlug || row.map_slug !== result.mapSlug
    || row.result_revision !== result.mapRevision
    || command.operationId !== result.operationId
    || row.command_json !== stableJsonStringify(command)
    || row.result_json !== stableJsonStringify(result)
    || row.audit_json !== stableJsonStringify(audit)) {
    throw new Error('Stored capability resolution operation indexes or canonical JSON disagree.')
  }
  return Object.freeze({
    commandSha256: row.command_sha256,
    command,
    result,
    audit,
    createdAt: Number(row.created_at),
  })
}

export const createSqliteCapabilityResolutionOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): CapabilityResolutionOperationRepository => {
  const find = (operationId: string): StoredCapabilityResolutionOperation | null => rowRecord(
    database.connection.prepare(`
      SELECT command_sha256, command_json, result_json, audit_json,
             map_slug, result_revision, created_at
      FROM capability_resolution_ops
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )

  const insert: CapabilityResolutionOperationRepository['insert'] = input => database.withTransaction(() => {
    const command = parseExecuteCapabilityActionCommand(input.command)
    const result = parseCapabilityActionPublicResult(input.result)
    const audit = parseAudit(input.audit)
    if (!SHA256.test(input.commandSha256)) throw new Error('Capability command hash must be SHA-256.')
    if (result.operationId !== command.operationId || result.mapSlug !== command.mapSlug) {
      throw new Error('Capability result identity must match its command.')
    }
    database.connection.prepare(`
      INSERT INTO capability_resolution_ops (
        operation_id, command_sha256, map_slug, command_json, result_json,
        audit_json, result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      input.commandSha256,
      command.mapSlug,
      stableJsonStringify(command),
      stableJsonStringify(result),
      stableJsonStringify(audit),
      result.mapRevision,
      input.createdAt,
    )
    const stored = find(command.operationId)
    if (!stored) throw new Error('Capability operation was not readable after insert.')
    return stored
  })
  return { database, find, insert }
}
