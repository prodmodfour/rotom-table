import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingSpeciesIdSyntax, type BreedingSpeciesId } from '#shared/breeding/ids'
import { type BreedingSpeciesAcquisitionArchiveRecordV1 } from '#shared/breeding/archives'
import { isSlug } from '#shared/paths'
import { isCanonicalBreedingSpeciesId } from '../domain/breeding/canonicalIds'
import { parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1 } from '../domain/breeding/archives'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

interface SpeciesAcquisitionRow {
  readonly trainer_sheet_slug: unknown
  readonly species_id: unknown
  readonly first_acquired_at_campaign_minute: unknown
  readonly source_egg_id: unknown
  readonly operation_id: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
}
export type TrainerSpeciesAcquisitionInsertResult =
  | { readonly kind: 'inserted', readonly record: BreedingSpeciesAcquisitionArchiveRecordV1 }
  | { readonly kind: 'exact-replay', readonly record: BreedingSpeciesAcquisitionArchiveRecordV1 }
export interface TrainerSpeciesAcquisitionRepository {
  readonly database: RotomDatabase
  get(trainerSheetSlug: string, speciesId: BreedingSpeciesId | string): BreedingSpeciesAcquisitionArchiveRecordV1 | null
  listByTrainer(trainerSheetSlug: string, limit?: number): readonly BreedingSpeciesAcquisitionArchiveRecordV1[]
  listBySpecies(speciesId: BreedingSpeciesId | string, limit?: number): readonly BreedingSpeciesAcquisitionArchiveRecordV1[]
  insert(record: BreedingSpeciesAcquisitionArchiveRecordV1): TrainerSpeciesAcquisitionInsertResult
}
const TABLE = 'trainer_species_acquisitions'
const SELECT = `
  SELECT trainer_sheet_slug, species_id, first_acquired_at_campaign_minute,
         source_egg_id, operation_id, record_json, definition_sha256
  FROM trainer_species_acquisitions
`
const slug = (value: unknown): string => isSlug(value) && value.length <= 160 ? value : (() => { throw new Error('trainerSheetSlug must be a canonical bounded sheet slug.') })()
const speciesId = (value: unknown): BreedingSpeciesId => {
  const id = parseBreedingSpeciesIdSyntax(value)
  if (!id || !isCanonicalBreedingSpeciesId(id)) throw new Error('speciesId must exist in the app-owned canonical Species catalog.')
  return id
}
const identity = (trainer: string, species: string): string => `${trainer}/${species}`
const authoritativeRecord = (value: unknown, rowIdentity: string): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  const record = parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1(value)
  if (!isCanonicalBreedingSpeciesId(record.speciesId)) throw new BreedingRepositoryCorruptionError(TABLE, rowIdentity, 'app-owned canonical Species membership')
  return record
}
const rowToRecord = (row: SpeciesAcquisitionRow): BreedingSpeciesAcquisitionArchiveRecordV1 => {
  const trainer = slug(row.trainer_sheet_slug); const species = speciesId(row.species_id); const id = identity(trainer, species)
  const record = authoritativeRecord(parseStrictStoredBreedingJson({ table: TABLE, identity: id, json: row.record_json, parse: parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1 }), id)
  const acquiredAt = parseBreedingRepositoryCampaignMinute(row.first_acquired_at_campaign_minute, `${TABLE}.${id}.first_acquired_at_campaign_minute`)
  assertBreedingStoredColumn(record.trainerSheetSlug === trainer, TABLE, id, 'trainer_sheet_slug')
  assertBreedingStoredColumn(record.speciesId === species, TABLE, id, 'species_id')
  assertBreedingStoredColumn(record.firstAcquiredAtCampaignMinute === acquiredAt, TABLE, id, 'first_acquired_at_campaign_minute')
  assertBreedingStoredColumn(record.sourceEggId === row.source_egg_id, TABLE, id, 'source_egg_id')
  assertBreedingStoredColumn(record.operationId === row.operation_id, TABLE, id, 'operation_id')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, TABLE, id, 'definition_sha256')
  return record
}
export const createSqliteTrainerSpeciesAcquisitionRepository = (database: RotomDatabase = getRotomDatabase()): TrainerSpeciesAcquisitionRepository => {
  const get = (trainerInput: string, speciesInput: BreedingSpeciesId | string): BreedingSpeciesAcquisitionArchiveRecordV1 | null => {
    const trainer = slug(trainerInput); const species = speciesId(speciesInput)
    const row = database.connection.prepare(`${SELECT} WHERE trainer_sheet_slug = ? AND species_id = ?`).get(trainer, species) as unknown as SpeciesAcquisitionRow | undefined
    return row ? rowToRecord(row) : null
  }
  const listByTrainer = (trainerInput: string, limitInput?: number): readonly BreedingSpeciesAcquisitionArchiveRecordV1[] => {
    const trainer = slug(trainerInput); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE trainer_sheet_slug = ? ORDER BY first_acquired_at_campaign_minute ASC, species_id ASC LIMIT ?`).all(trainer, limit) as unknown as SpeciesAcquisitionRow[]).map(rowToRecord)
  }
  const listBySpecies = (speciesInput: BreedingSpeciesId | string, limitInput?: number): readonly BreedingSpeciesAcquisitionArchiveRecordV1[] => {
    const species = speciesId(speciesInput); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE species_id = ? ORDER BY first_acquired_at_campaign_minute ASC, trainer_sheet_slug ASC LIMIT ?`).all(species, limit) as unknown as SpeciesAcquisitionRow[]).map(rowToRecord)
  }
  const insert = (input: BreedingSpeciesAcquisitionArchiveRecordV1): TrainerSpeciesAcquisitionInsertResult => {
    const record = authoritativeRecord(input, 'new-record')
    const trainer = slug(record.trainerSheetSlug); const species = speciesId(record.speciesId); const id = identity(trainer, species)
    const existing = get(trainer, species)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, record)) return Object.freeze({ kind: 'exact-replay', record: existing })
      throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition', id)
    }
    try {
      database.connection.prepare(`
        INSERT INTO trainer_species_acquisitions (
          trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
          operation_id, record_json, definition_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(trainer, species, record.firstAcquiredAtCampaignMinute, record.sourceEggId, record.operationId, stableJsonStringify(record), record.definitionSha256)
    }
    catch (error) {
      const raced = get(trainer, species)
      if (raced && exactBreedingDocumentReplay(raced, record)) return Object.freeze({ kind: 'exact-replay', record: raced })
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition', id)
      throw error
    }
    return Object.freeze({ kind: 'inserted', record: get(trainer, species) ?? (() => { throw new Error('Inserted Species acquisition was not readable.') })() })
  }
  return Object.freeze({ database, get, listByTrainer, listBySpecies, insert })
}
