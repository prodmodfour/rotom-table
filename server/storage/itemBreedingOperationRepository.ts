import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import {
  parseItemBreedingOperationCommand,
  parseItemBreedingOperationResult,
  type ItemBreedingOperationCommandV1,
  type ItemBreedingOperationResultV1,
} from '#shared/breeding/itemWorkflows'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredItemBreedingOperation {
  readonly commandSha256: string
  readonly principalKey: string
  readonly command: ItemBreedingOperationCommandV1
  readonly result: ItemBreedingOperationResultV1
  readonly evidence: StrictJsonValue
  readonly createdAt: number
}

export interface ItemBreedingOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (operationId: string) => StoredItemBreedingOperation | null
  readonly insert: (input: StoredItemBreedingOperation) => StoredItemBreedingOperation
}

interface Row {
  readonly command_sha256: unknown
  readonly command_kind: unknown
  readonly principal_key: unknown
  readonly trainer_slug: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly evidence_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const SHA256 = /^[a-f0-9]{64}$/
const parseEvidence = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(
  value,
  'itemBreedingEvidence',
  {
    limits: { depth: 16, nodes: 20_000, objectFields: 256, arrayEntries: 1_024, stringLength: 2_000, objectKeyLength: 160 },
    rootLabel: 'item breeding evidence', valueLabel: 'item breeding evidence values',
    failNotJson: (_path, detail) => { throw new Error(detail) },
    failLimit: (_path, detail) => { throw new Error(detail) },
  },
))

const rowRecord = (row: Row | undefined): StoredItemBreedingOperation | null => {
  if (!row) return null
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.principal_key !== 'string' || !row.principal_key
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.evidence_json !== 'string' || !Number.isSafeInteger(row.result_revision)
    || !Number.isSafeInteger(row.created_at)) {
    throw new Error('Stored item breeding operation is malformed.')
  }
  const command = parseItemBreedingOperationCommand(JSON.parse(row.command_json))
  const result = parseItemBreedingOperationResult(JSON.parse(row.result_json))
  const evidence = parseEvidence(JSON.parse(row.evidence_json))
  if (row.command_kind !== command.kind || row.trainer_slug !== command.trainerSheetSlug
    || row.result_revision !== result.trainerRevision
    || command.operationId !== result.operationId || command.kind !== result.kind
    || command.trainerSheetSlug !== result.trainerSheetSlug
    || row.command_json !== stableJsonStringify(command)
    || row.result_json !== stableJsonStringify(result)
    || row.evidence_json !== stableJsonStringify(evidence)) {
    throw new Error('Stored item breeding operation indexes or canonical JSON disagree.')
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

export const createSqliteItemBreedingOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): ItemBreedingOperationRepository => {
  const find = (operationId: string): StoredItemBreedingOperation | null => rowRecord(
    database.connection.prepare(`
      SELECT command_sha256, command_kind, principal_key, trainer_slug,
             command_json, result_json, evidence_json, result_revision, created_at
      FROM item_breeding_operations
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )

  const insert: ItemBreedingOperationRepository['insert'] = input => database.withTransaction(() => {
    const command = parseItemBreedingOperationCommand(input.command)
    const result = parseItemBreedingOperationResult(input.result)
    const evidence = parseEvidence(input.evidence)
    if (!SHA256.test(input.commandSha256) || !input.principalKey.trim() || input.principalKey.length > 160
      || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0
      || command.operationId !== result.operationId || command.kind !== result.kind
      || command.trainerSheetSlug !== result.trainerSheetSlug) {
      throw new Error('Item breeding operation identity is invalid.')
    }
    database.connection.prepare(`
      INSERT INTO item_breeding_operations (
        operation_id, command_sha256, command_kind, principal_key,
        trainer_slug, command_json, result_json, evidence_json,
        result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      input.commandSha256,
      command.kind,
      input.principalKey,
      command.trainerSheetSlug,
      stableJsonStringify(command),
      stableJsonStringify(result),
      stableJsonStringify(evidence),
      result.trainerRevision,
      input.createdAt,
    )
    const stored = find(command.operationId)
    if (!stored) throw new Error('Item breeding operation was not readable after insert.')
    return stored
  })

  return { database, find, insert }
}
