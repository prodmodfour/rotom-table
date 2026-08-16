import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import {
  parseItemExplorationOperationCommand,
  parseItemExplorationOperationResult,
  type ItemExplorationOperationCommandV1,
  type ItemExplorationOperationResultV1,
} from '#shared/itemAutomation/exploration'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredItemExplorationOperation {
  readonly commandSha256: string
  readonly principalKey: string
  readonly command: ItemExplorationOperationCommandV1
  readonly result: ItemExplorationOperationResultV1
  readonly evidence: StrictJsonValue
  readonly createdAt: number
}

export interface ItemExplorationOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (operationId: string) => StoredItemExplorationOperation | null
  readonly insert: (input: StoredItemExplorationOperation) => StoredItemExplorationOperation
}

interface Row {
  readonly command_sha256: unknown
  readonly command_kind: unknown
  readonly principal_key: unknown
  readonly aggregate_kind: unknown
  readonly aggregate_id: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly evidence_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const SHA256 = /^[a-f0-9]{64}$/
const parseEvidence = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(
  value,
  'itemExplorationEvidence',
  {
    limits: { depth: 16, nodes: 20_000, objectFields: 256, arrayEntries: 1_024, stringLength: 2_000, objectKeyLength: 160 },
    rootLabel: 'item exploration evidence', valueLabel: 'item exploration evidence values',
    failNotJson: (_path, detail) => { throw new Error(detail) },
    failLimit: (_path, detail) => { throw new Error(detail) },
  },
))

const aggregateIdentity = (command: ItemExplorationOperationCommandV1): {
  readonly kind: 'trainer' | 'map'
  readonly id: string
} => command.kind === 'settle-direct-repel'
  ? { kind: 'map', id: command.mapSlug }
  : { kind: 'trainer', id: command.trainerSlug }

const resultRevision = (result: ItemExplorationOperationResultV1): number => (
  result.kind === 'settle-direct-repel' ? result.mapRevision! : result.trainerRevision!
)

const rowRecord = (row: Row | undefined): StoredItemExplorationOperation | null => {
  if (!row) return null
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.principal_key !== 'string' || !row.principal_key
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.evidence_json !== 'string' || !Number.isSafeInteger(row.result_revision)
    || !Number.isSafeInteger(row.created_at)) {
    throw new Error('Stored item exploration operation is malformed.')
  }
  const command = parseItemExplorationOperationCommand(JSON.parse(row.command_json))
  const result = parseItemExplorationOperationResult(JSON.parse(row.result_json))
  const evidence = parseEvidence(JSON.parse(row.evidence_json))
  const aggregate = aggregateIdentity(command)
  if (row.command_kind !== command.kind || row.aggregate_kind !== aggregate.kind
    || row.aggregate_id !== aggregate.id || row.result_revision !== resultRevision(result)
    || command.operationId !== result.operationId || command.kind !== result.kind
    || row.command_json !== stableJsonStringify(command)
    || row.result_json !== stableJsonStringify(result)
    || row.evidence_json !== stableJsonStringify(evidence)) {
    throw new Error('Stored item exploration operation indexes or canonical JSON disagree.')
  }
  return Object.freeze({
    commandSha256: row.command_sha256,
    principalKey: row.principal_key,
    command,
    result,
    evidence,
    createdAt: Number(row.created_at),
  })
}

export const createSqliteItemExplorationOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): ItemExplorationOperationRepository => {
  const find = (operationId: string): StoredItemExplorationOperation | null => rowRecord(
    database.connection.prepare(`
      SELECT command_sha256, command_kind, principal_key, aggregate_kind, aggregate_id,
             command_json, result_json, evidence_json, result_revision, created_at
      FROM item_exploration_operations
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )

  const insert: ItemExplorationOperationRepository['insert'] = input => database.withTransaction(() => {
    const command = parseItemExplorationOperationCommand(input.command)
    const result = parseItemExplorationOperationResult(input.result)
    const evidence = parseEvidence(input.evidence)
    const aggregate = aggregateIdentity(command)
    if (!SHA256.test(input.commandSha256) || !input.principalKey.trim()
      || command.operationId !== result.operationId || command.kind !== result.kind) {
      throw new Error('Item exploration operation identity is invalid.')
    }
    database.connection.prepare(`
      INSERT INTO item_exploration_operations (
        operation_id, command_sha256, command_kind, principal_key,
        aggregate_kind, aggregate_id, command_json, result_json,
        evidence_json, result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      input.commandSha256,
      command.kind,
      input.principalKey,
      aggregate.kind,
      aggregate.id,
      stableJsonStringify(command),
      stableJsonStringify(result),
      stableJsonStringify(evidence),
      resultRevision(result),
      input.createdAt,
    )
    const stored = find(command.operationId)
    if (!stored) throw new Error('Item exploration operation was not readable after insert.')
    return stored
  })

  return { database, find, insert }
}
