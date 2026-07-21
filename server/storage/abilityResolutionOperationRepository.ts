import { parseAbilityDeclarationIntent, type AbilityDeclarationIntent } from '#shared/abilityAutomation/declarationIntent'
import { parseAbilityResolutionPublicResult, type AbilityResolutionPublicResult } from '#shared/abilityAutomation/results'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredAbilityResolutionOperation {
  readonly intentSha256: string
  readonly intent: AbilityDeclarationIntent
  readonly result: AbilityResolutionPublicResult
  readonly audit: StrictJsonValue
  readonly createdAt: number
}
export interface AbilityResolutionOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (intentId: string) => StoredAbilityResolutionOperation | null
  readonly insert: (input: StoredAbilityResolutionOperation) => StoredAbilityResolutionOperation
}
interface Row {
  readonly intent_sha256: unknown
  readonly intent_json: unknown
  readonly result_json: unknown
  readonly audit_json: unknown
  readonly map_slug: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA = /^[a-f0-9]{64}$/
const parseId = (value: unknown): string => {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Ability resolution intent ID must be stable.')
  return value
}
const parseAudit = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(value, 'abilityResolutionAudit', {
  limits: { depth: 64, nodes: 250_000, objectFields: 2_048, arrayEntries: 8_192, stringLength: 100_000, objectKeyLength: 200 },
  rootLabel: 'ability resolution audit', valueLabel: 'ability resolution audit values',
  failNotJson: (_path, detail) => { throw new Error(detail) },
  failLimit: (_path, detail) => { throw new Error(detail) },
}))
const rowRecord = (row: Row | undefined): StoredAbilityResolutionOperation | null => {
  if (!row) return null
  if (typeof row.intent_sha256 !== 'string' || !SHA.test(row.intent_sha256)
    || typeof row.intent_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.audit_json !== 'string' || !Number.isSafeInteger(row.created_at)) {
    throw new Error('Stored ability resolution operation is malformed.')
  }
  const intent = parseAbilityDeclarationIntent(JSON.parse(row.intent_json))
  const result = parseAbilityResolutionPublicResult(JSON.parse(row.result_json))
  const audit = parseAudit(JSON.parse(row.audit_json))
  if (row.map_slug !== intent.mapSlug || row.map_slug !== result.mapSlug
    || row.result_revision !== result.revision
    || row.intent_json !== stableJsonStringify(intent)
    || row.result_json !== stableJsonStringify(result)
    || row.audit_json !== stableJsonStringify(audit)) {
    throw new Error('Stored ability resolution operation indexes or canonical JSON disagree.')
  }
  return Object.freeze({ intentSha256: row.intent_sha256, intent, result, audit, createdAt: Number(row.created_at) })
}
export const createSqliteAbilityResolutionOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): AbilityResolutionOperationRepository => {
  const find = (intentId: string): StoredAbilityResolutionOperation | null => {
    const id = parseId(intentId)
    return rowRecord(database.connection.prepare(`
      SELECT intent_sha256, intent_json, result_json, audit_json, map_slug, result_revision, created_at
      FROM ability_resolution_ops WHERE intent_id = ?
    `).get(id) as unknown as Row | undefined)
  }
  const insert: AbilityResolutionOperationRepository['insert'] = input => database.withTransaction(() => {
    const intent = parseAbilityDeclarationIntent(input.intent)
    if (!SHA.test(input.intentSha256)) throw new Error('Ability resolution intent hash must be SHA-256.')
    const result = parseAbilityResolutionPublicResult(input.result)
    const audit = parseAudit(input.audit)
    database.connection.prepare(`
      INSERT INTO ability_resolution_ops (
        intent_id, intent_sha256, map_slug, intent_json, result_json, audit_json,
        result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(intent.intentId, input.intentSha256, intent.mapSlug, stableJsonStringify(intent),
      stableJsonStringify(result), stableJsonStringify(audit), result.revision, input.createdAt)
    return find(intent.intentId)!
  })
  return { database, find, insert }
}
