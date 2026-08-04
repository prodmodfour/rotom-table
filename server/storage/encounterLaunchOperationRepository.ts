import {
  parseLaunchEncounterBuilderRequest,
  parseLaunchEncounterBuilderResult,
  type LaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderResult,
} from '#shared/encounterDocuments/builder'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface EncounterLaunchOperationRecord {
  readonly launchId: string
  readonly encounterId: string
  readonly requestSha256: string
  readonly request: LaunchEncounterBuilderRequest
  readonly result: LaunchEncounterBuilderResult
  readonly createdAt: number
}
export interface EncounterLaunchOperationRepository {
  readonly database?: RotomDatabase
  get(launchId: string): EncounterLaunchOperationRecord | null
  save(record: EncounterLaunchOperationRecord): EncounterLaunchOperationRecord
}
interface Row {
  readonly launch_id: unknown
  readonly encounter_id: unknown
  readonly request_sha256: unknown
  readonly request_json: unknown
  readonly result_json: unknown
  readonly created_at: unknown
}
const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be non-empty text.`)
  return value
}
const sha256 = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('encounter_launch_ops.request_sha256 is invalid.')
  return value
}
const timestamp = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('encounter_launch_ops.created_at is invalid.')
  return Number(value)
}
const rowToRecord = (row: Row): EncounterLaunchOperationRecord => {
  const launchId = string(row.launch_id, 'launch_id')
  const encounterId = string(row.encounter_id, 'encounter_id')
  const request = parseLaunchEncounterBuilderRequest(JSON.parse(string(row.request_json, 'request_json')))
  const result = parseLaunchEncounterBuilderResult(JSON.parse(string(row.result_json, 'result_json')))
  if (request.launchId !== launchId || request.encounterId !== encounterId
    || result.launchId !== launchId || result.encounterId !== encounterId) {
    throw new Error(`Encounter launch ${launchId} has contradictory stored identity.`)
  }
  return {
    launchId,
    encounterId,
    requestSha256: sha256(row.request_sha256),
    request,
    result,
    createdAt: timestamp(row.created_at),
  }
}

export const createSqliteEncounterLaunchOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterLaunchOperationRepository => {
  const get = (launchId: string): EncounterLaunchOperationRecord | null => {
    const row = database.connection.prepare(`
      SELECT launch_id, encounter_id, request_sha256, request_json, result_json, created_at
      FROM encounter_launch_ops WHERE launch_id = ?
    `).get(launchId) as unknown as Row | undefined
    return row ? rowToRecord(row) : null
  }
  const save = (record: EncounterLaunchOperationRecord): EncounterLaunchOperationRecord => {
    database.connection.prepare(`
      INSERT INTO encounter_launch_ops (
        launch_id, encounter_id, request_sha256, request_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.launchId,
      record.encounterId,
      record.requestSha256,
      stableJsonStringify(record.request),
      stableJsonStringify(record.result),
      record.createdAt,
    )
    return record
  }
  return { database, get, save }
}
