import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingInheritanceLearningRecordIdSyntax,
  parsePokemonBreedingOriginIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingInheritanceLearningRecordId,
  type PokemonBreedingOriginId,
  type PokemonEggId,
} from '#shared/breeding/ids'
import type { BreedingInheritanceLearningRecordV1, PokemonBreedingOriginV1 } from '#shared/breeding/lineage'
import {
  parseAuthoritativeBreedingInheritanceLearningRecordV1,
  parseAuthoritativePokemonBreedingOriginV1,
} from '../domain/breeding/lineage'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

interface OriginRow {
  readonly origin_id: unknown
  readonly egg_id: unknown
  readonly child_sheet_slug: unknown
  readonly document_json: unknown
  readonly lineage_definition_sha256: unknown
  readonly hatch_operation_id: unknown
  readonly created_at_campaign_minute: unknown
}
interface LearningRow {
  readonly learning_record_id: unknown
  readonly origin_id: unknown
  readonly egg_id: unknown
  readonly child_sheet_slug: unknown
  readonly checkpoint_level: unknown
  readonly operation_id: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
  readonly created_at_campaign_minute: unknown
}
export interface BreedingLineageRepository {
  readonly database: RotomDatabase
  getOrigin(originId: PokemonBreedingOriginId | string): PokemonBreedingOriginV1 | null
  findOriginByEgg(eggId: PokemonEggId | string): PokemonBreedingOriginV1 | null
  findOriginByChild(childSheetSlug: string): PokemonBreedingOriginV1 | null
  insertOrigin(origin: PokemonBreedingOriginV1): PokemonBreedingOriginV1
  listLearningByOrigin(originId: PokemonBreedingOriginId | string): readonly BreedingInheritanceLearningRecordV1[]
  insertLearning(record: BreedingInheritanceLearningRecordV1): BreedingInheritanceLearningRecordV1
}
export class BreedingLineageRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding lineage mutation requires a caller-owned SQLite transaction.')
    this.name = 'BreedingLineageRepositoryTransactionError'
  }
}
const ORIGIN_TABLE = 'pokemon_breeding_origins'
const LEARNING_TABLE = 'breeding_inheritance_learning_records'
const ORIGIN_SELECT = `
  SELECT origin_id, egg_id, child_sheet_slug, document_json, lineage_definition_sha256,
         hatch_operation_id, created_at_campaign_minute
  FROM pokemon_breeding_origins
`
const LEARNING_SELECT = `
  SELECT learning_record_id, origin_id, egg_id, child_sheet_slug, checkpoint_level,
         operation_id, record_json, definition_sha256, created_at_campaign_minute
  FROM breeding_inheritance_learning_records
`
const originIdentity = (value: unknown): PokemonBreedingOriginId => parsePokemonBreedingOriginIdSyntax(value)
  ?? (() => { throw new Error('originId must be a Pokémon Breeding origin ID.') })()
const eggIdentity = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()
const learningIdentity = (value: unknown): BreedingInheritanceLearningRecordId => parseBreedingInheritanceLearningRecordIdSyntax(value)
  ?? (() => { throw new Error('learningRecordId must be a Breeding inheritance-learning ID.') })()
const childSlug = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value)
  ? value
  : (() => { throw new Error('childSheetSlug must be a canonical sheet slug.') })()
const originFromRow = (row: OriginRow): PokemonBreedingOriginV1 => {
  const identity = originIdentity(row.origin_id)
  const origin = parseStrictStoredBreedingJson({
    table: ORIGIN_TABLE,
    identity,
    json: row.document_json,
    parse: parseAuthoritativePokemonBreedingOriginV1,
  })
  const createdAt = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${ORIGIN_TABLE}.${identity}.created_at_campaign_minute`)
  assertBreedingStoredColumn(origin.eggId === row.egg_id, ORIGIN_TABLE, identity, 'egg_id')
  assertBreedingStoredColumn(origin.childSheetSlug === row.child_sheet_slug, ORIGIN_TABLE, identity, 'child_sheet_slug')
  assertBreedingStoredColumn(origin.lineageDefinitionSha256 === row.lineage_definition_sha256, ORIGIN_TABLE, identity, 'lineage_definition_sha256')
  assertBreedingStoredColumn(origin.hatchOperationId === row.hatch_operation_id, ORIGIN_TABLE, identity, 'hatch_operation_id')
  assertBreedingStoredColumn(origin.hatchedAtCampaignMinute === createdAt, ORIGIN_TABLE, identity, 'created_at_campaign_minute')
  return origin
}
const learningFromRow = (row: LearningRow): BreedingInheritanceLearningRecordV1 => {
  const identity = learningIdentity(row.learning_record_id)
  const record = parseStrictStoredBreedingJson({
    table: LEARNING_TABLE,
    identity,
    json: row.record_json,
    parse: parseAuthoritativeBreedingInheritanceLearningRecordV1,
  })
  const createdAt = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${LEARNING_TABLE}.${identity}.created_at_campaign_minute`)
  assertBreedingStoredColumn(record.originId === row.origin_id && record.eggId === row.egg_id, LEARNING_TABLE, identity, 'origin_id/egg_id')
  assertBreedingStoredColumn(record.childSheetSlug === row.child_sheet_slug, LEARNING_TABLE, identity, 'child_sheet_slug')
  assertBreedingStoredColumn(record.checkpointLevel === row.checkpoint_level, LEARNING_TABLE, identity, 'checkpoint_level')
  assertBreedingStoredColumn(record.operationId === row.operation_id, LEARNING_TABLE, identity, 'operation_id')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, LEARNING_TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(record.recordedAtCampaignMinute === createdAt, LEARNING_TABLE, identity, 'created_at_campaign_minute')
  return record
}
export const createSqliteBreedingLineageRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingLineageRepository => {
  const getOrigin = (input: PokemonBreedingOriginId | string): PokemonBreedingOriginV1 | null => {
    const identity = originIdentity(input)
    const row = database.connection.prepare(`${ORIGIN_SELECT} WHERE origin_id = ?`).get(identity) as unknown as OriginRow | undefined
    return row ? originFromRow(row) : null
  }
  const findUniqueOrigin = (field: 'egg_id' | 'child_sheet_slug', value: string): PokemonBreedingOriginV1 | null => {
    const rows = database.connection.prepare(`${ORIGIN_SELECT} WHERE ${field} = ? LIMIT 2`).all(value) as unknown as OriginRow[]
    if (rows.length > 1) throw new BreedingRepositoryCorruptionError(ORIGIN_TABLE, value, `one unique ${field} origin`)
    return rows[0] ? originFromRow(rows[0]) : null
  }
  const findOriginByEgg = (input: PokemonEggId | string): PokemonBreedingOriginV1 | null => findUniqueOrigin('egg_id', eggIdentity(input))
  const findOriginByChild = (input: string): PokemonBreedingOriginV1 | null => findUniqueOrigin('child_sheet_slug', childSlug(input))
  const insertOrigin = (input: PokemonBreedingOriginV1): PokemonBreedingOriginV1 => {
    if (!database.connection.isTransaction) throw new BreedingLineageRepositoryTransactionError()
    const origin = parseAuthoritativePokemonBreedingOriginV1(input)
    const existing = getOrigin(origin.originId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, origin)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Pokémon Breeding origin', origin.originId)
    }
    const eggOrigin = findOriginByEgg(origin.eggId)
    const childOrigin = findOriginByChild(origin.childSheetSlug)
    if (eggOrigin || childOrigin) throw new BreedingRepositoryIdentityCollisionError('Pokémon Breeding origin target', eggOrigin ? origin.eggId : origin.childSheetSlug)
    try {
      database.connection.prepare(`
        INSERT INTO pokemon_breeding_origins (
          origin_id, egg_id, child_sheet_slug, document_json, lineage_definition_sha256,
          hatch_operation_id, created_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(origin.originId, origin.eggId, origin.childSheetSlug, stableJsonStringify(origin),
        origin.lineageDefinitionSha256, origin.hatchOperationId, origin.hatchedAtCampaignMinute)
    }
    catch (error) {
      const raced = getOrigin(origin.originId)
      if (raced && exactBreedingDocumentReplay(raced, origin)) return raced
      if (raced || findOriginByEgg(origin.eggId) || findOriginByChild(origin.childSheetSlug)) {
        throw new BreedingRepositoryIdentityCollisionError('Pokémon Breeding origin', origin.originId)
      }
      throw error
    }
    return getOrigin(origin.originId) ?? (() => { throw new Error('Inserted Pokémon Breeding origin was not readable.') })()
  }
  const listLearningByOrigin = (input: PokemonBreedingOriginId | string): readonly BreedingInheritanceLearningRecordV1[] => {
    const identity = originIdentity(input)
    const rows = database.connection.prepare(`${LEARNING_SELECT} WHERE origin_id = ? ORDER BY checkpoint_level LIMIT 10`).all(identity) as unknown as LearningRow[]
    if (rows.length > 9) throw new BreedingRepositoryCorruptionError(LEARNING_TABLE, identity, 'at most nine inheritance checkpoints')
    return Object.freeze(rows.map(learningFromRow))
  }
  const insertLearning = (input: BreedingInheritanceLearningRecordV1): BreedingInheritanceLearningRecordV1 => {
    if (!database.connection.isTransaction) throw new BreedingLineageRepositoryTransactionError()
    const record = parseAuthoritativeBreedingInheritanceLearningRecordV1(input)
    const row = database.connection.prepare(`${LEARNING_SELECT} WHERE learning_record_id = ?`).get(record.learningRecordId) as unknown as LearningRow | undefined
    if (row) {
      const existing = learningFromRow(row)
      if (exactBreedingDocumentReplay(existing, record)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding inheritance learning record', record.learningRecordId)
    }
    const origin = getOrigin(record.originId)
    if (!origin || origin.eggId !== record.eggId || origin.childSheetSlug !== record.childSheetSlug) {
      throw new BreedingRepositoryIdentityCollisionError('Breeding inheritance learning origin', record.originId)
    }
    const checkpoint = listLearningByOrigin(record.originId).find(entry => entry.checkpointLevel === record.checkpointLevel)
    if (checkpoint) throw new BreedingRepositoryIdentityCollisionError('Breeding inheritance checkpoint', `${record.originId}:${record.checkpointLevel}`)
    database.connection.prepare(`
      INSERT INTO breeding_inheritance_learning_records (
        learning_record_id, origin_id, egg_id, child_sheet_slug, checkpoint_level,
        operation_id, record_json, definition_sha256, created_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.learningRecordId, record.originId, record.eggId, record.childSheetSlug,
      record.checkpointLevel, record.operationId, stableJsonStringify(record), record.definitionSha256,
      record.recordedAtCampaignMinute)
    const inserted = database.connection.prepare(`${LEARNING_SELECT} WHERE learning_record_id = ?`).get(record.learningRecordId) as unknown as LearningRow | undefined
    return inserted ? learningFromRow(inserted) : (() => { throw new Error('Inserted inheritance-learning record was not readable.') })()
  }
  return Object.freeze({ database, getOrigin, findOriginByEgg, findOriginByChild, insertOrigin, listLearningByOrigin, insertLearning })
}
