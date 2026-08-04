import { parseEncounterDirectorCommand, type EncounterDirectorCommand } from '#shared/encounterDocuments/commands'
import { parseEncounterDocument, type EncounterDocument } from '#shared/encounterDocuments/model'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface EncounterDirectorCommandResult {
  readonly ok: true
  readonly encounterId: string
  readonly revision: number
  readonly document: EncounterDocument
}

export interface EncounterDirectorOperationRecord {
  readonly commandId: string
  readonly encounterId: string
  readonly commandSha256: string
  readonly command: EncounterDirectorCommand
  readonly result: EncounterDirectorCommandResult
  readonly createdAt: number
}

export interface EncounterDirectorOperationRepository {
  readonly database?: RotomDatabase
  get(commandId: string): EncounterDirectorOperationRecord | null
  save(record: EncounterDirectorOperationRecord): EncounterDirectorOperationRecord
}

interface OperationRow {
  readonly command_id: unknown
  readonly encounter_id: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}
const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be non-empty text.`)
  return value
}
const sha256 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 digest.`)
  return value
}
const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer.`)
  return Number(value)
}
const parseResult = (value: unknown): EncounterDirectorCommandResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Encounter Director result must be an object.')
  const root = value as Record<string, unknown>
  const keys = ['ok', 'encounterId', 'revision', 'document']
  if (Object.keys(root).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(root, key)) || root.ok !== true) {
    throw new Error('Encounter Director result has unsupported or missing fields.')
  }
  const document = parseEncounterDocument(root.document)
  const encounterId = string(root.encounterId, 'Director result encounterId')
  const revision = integer(root.revision, 'Director result revision')
  if (document.encounterId !== encounterId || document.revision !== revision) throw new Error('Encounter Director result has contradictory document identity.')
  return { ok: true, encounterId, revision, document }
}
const rowToRecord = (row: OperationRow): EncounterDirectorOperationRecord => {
  const commandId = string(row.command_id, 'encounter_director_ops.command_id')
  const encounterId = string(row.encounter_id, 'encounter_director_ops.encounter_id')
  const command = parseEncounterDirectorCommand(JSON.parse(string(row.command_json, 'encounter_director_ops.command_json')))
  const result = parseResult(JSON.parse(string(row.result_json, 'encounter_director_ops.result_json')))
  const resultRevision = integer(row.result_revision, 'encounter_director_ops.result_revision')
  if (command.commandId !== commandId || command.encounterId !== encounterId
    || result.encounterId !== encounterId || result.revision !== resultRevision) {
    throw new Error(`Encounter Director operation ${commandId} has contradictory stored identity.`)
  }
  return {
    commandId,
    encounterId,
    commandSha256: sha256(row.command_sha256, 'encounter_director_ops.command_sha256'),
    command,
    result,
    createdAt: integer(row.created_at, 'encounter_director_ops.created_at'),
  }
}

export const createSqliteEncounterDirectorOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterDirectorOperationRepository => {
  const get = (commandId: string): EncounterDirectorOperationRecord | null => {
    const row = database.connection.prepare(`
      SELECT command_id, encounter_id, command_sha256, command_json, result_json, result_revision, created_at
      FROM encounter_director_ops
      WHERE command_id = ?
    `).get(commandId) as unknown as OperationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const save = (record: EncounterDirectorOperationRecord): EncounterDirectorOperationRecord => {
    database.connection.prepare(`
      INSERT INTO encounter_director_ops (
        command_id, encounter_id, command_sha256, command_json, result_json, result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.commandId,
      record.encounterId,
      record.commandSha256,
      stableJsonStringify(record.command),
      stableJsonStringify(record.result),
      record.result.revision,
      record.createdAt,
    )
    return record
  }
  return { database, get, save }
}
