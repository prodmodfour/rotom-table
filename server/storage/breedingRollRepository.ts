import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type BreedingRollRecordId,
  type PokemonEggId,
} from '#shared/breeding/ids'
import type { BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  parseAuthoritativeBreedingRollRecordV1,
  validateBreedingOperationRollSet,
} from '../domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

interface RollRow {
  readonly roll_record_id: unknown
  readonly operation_id: unknown
  readonly operation_roll_ordinal: unknown
  readonly command_sha256: unknown
  readonly purpose: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
  readonly generated_at_campaign_minute: unknown
}
export interface BreedingRollRepository {
  readonly database: RotomDatabase
  get(rollRecordId: BreedingRollRecordId | string): BreedingRollRecordV1 | null
  listByOperation(operationId: BreedingOperationId | string): readonly BreedingRollRecordV1[]
  findHatchSpecialByEgg(eggId: PokemonEggId | string): BreedingRollRecordV1 | null
  findLatestEggWarmerCapabilityBySource(input: { readonly sourcePokemonSheetSlug: string, readonly excludeOperationId?: string }): BreedingRollRecordV1 | null
  insert(input: { readonly command: BreedingOperationCommandV1, readonly roll: BreedingRollRecordV1 }): BreedingRollRecordV1
}
export class BreedingRollRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding roll insertion requires a caller-owned SQLite transaction.')
    this.name = 'BreedingRollRepositoryTransactionError'
  }
}
const TABLE = 'breeding_rolls'
const SELECT = `
  SELECT roll_record_id, operation_id, operation_roll_ordinal, command_sha256,
         purpose, record_json, definition_sha256, generated_at_campaign_minute
  FROM breeding_rolls
`
const operationId = (value: unknown): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? (() => { throw new Error('operationId must be a Breeding operation ID.') })()
const rollId = (value: unknown): BreedingRollRecordId => parseBreedingRollRecordIdSyntax(value)
  ?? (() => { throw new Error('rollRecordId must be a Breeding roll record ID.') })()
const eggId = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()
const rowToRoll = (row: RollRow): BreedingRollRecordV1 => {
  const identity = rollId(row.roll_record_id)
  const roll = parseStrictStoredBreedingJson({ table: TABLE, identity, json: row.record_json, parse: parseAuthoritativeBreedingRollRecordV1 })
  const ordinal = parseBreedingRepositoryRevision(row.operation_roll_ordinal, `${TABLE}.${identity}.operation_roll_ordinal`)
  const generatedAt = parseBreedingRepositoryCampaignMinute(row.generated_at_campaign_minute, `${TABLE}.${identity}.generated_at_campaign_minute`)
  assertBreedingStoredColumn(roll.rollRecordId === identity, TABLE, identity, 'roll_record_id')
  assertBreedingStoredColumn(roll.operationId === row.operation_id, TABLE, identity, 'operation_id')
  assertBreedingStoredColumn(roll.operationRollOrdinal === ordinal, TABLE, identity, 'operation_roll_ordinal')
  assertBreedingStoredColumn(roll.commandSha256 === row.command_sha256, TABLE, identity, 'command_sha256')
  assertBreedingStoredColumn(roll.purpose === row.purpose, TABLE, identity, 'purpose')
  assertBreedingStoredColumn(roll.definitionSha256 === row.definition_sha256, TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(roll.generatedAtCampaignMinute === generatedAt, TABLE, identity, 'generated_at_campaign_minute')
  return roll
}
const PURPOSE_BY_REQUEST = Object.freeze({
  'offspring-family': 'offspring-family-d20',
  nature: 'nature-ordered-2d6',
  ability: 'ability-uniform-index',
  gender: 'gender-d100',
  'hatch-duration': 'hatch-duration-percentage',
  provider: 'provider-bounded',
} as const)
const commandAllowsRoll = (command: BreedingOperationCommandV1, roll: BreedingRollRecordV1): boolean => {
  if (command.commandKind === 'apply-egg-warmer-capability') {
    const scope = command.scopes[0]
    return command.scopes.length === 1 && roll.operationRollOrdinal === 0
      && roll.purpose === 'provider-bounded' && roll.formula === 'provider-bounded'
      && roll.dieCount === 1 && roll.dieSides === 10 && roll.ordered === false && roll.modifier === 0
      && roll.target.kind === 'pokemon-egg' && roll.target.eggId === command.payload.eggId
      && scope?.kind === 'pokemon-egg' && scope.eggId === roll.target.eggId
      && scope.expectedRevision === roll.target.revision
  }
  if (command.commandKind === 'begin-hatch') {
    const scope = command.scopes[0]
    return command.scopes.length === 1 && roll.operationRollOrdinal === 0
      && roll.purpose === 'hatch-special-d100'
      && roll.target.kind === 'pokemon-egg'
      && roll.target.eggId === command.payload.eggId
      && scope?.kind === 'pokemon-egg' && scope.eggId === roll.target.eggId
      && scope.expectedRevision === roll.target.revision
  }
  if (command.commandKind !== 'produce-egg' && command.commandKind !== 'create-source-egg') return false
  const request = command.payload.resolutions.requestedRollKinds[roll.operationRollOrdinal]
  if (!request || PURPOSE_BY_REQUEST[request] !== roll.purpose) return false
  if (command.commandKind === 'produce-egg') {
    return roll.target.kind === 'breeding-project'
      && roll.target.projectId === command.payload.projectId
      && command.scopes.some(scope => scope.kind === 'breeding-project'
        && scope.projectId === roll.target.projectId && scope.expectedRevision === roll.target.revision)
  }
  return roll.target.kind === 'pokemon-egg' && roll.target.eggId === command.payload.eggId && roll.target.revision === 0
}
export const createSqliteBreedingRollRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingRollRepository => {
  const get = (input: BreedingRollRecordId | string): BreedingRollRecordV1 | null => {
    const identity = rollId(input)
    const row = database.connection.prepare(`${SELECT} WHERE roll_record_id = ?`).get(identity) as unknown as RollRow | undefined
    return row ? rowToRoll(row) : null
  }
  const listByOperation = (input: BreedingOperationId | string): readonly BreedingRollRecordV1[] => {
    const identity = operationId(input)
    const rows = database.connection.prepare(`${SELECT} WHERE operation_id = ? ORDER BY operation_roll_ordinal, roll_record_id LIMIT 33`).all(identity) as unknown as RollRow[]
    if (rows.length > 32) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'at most 32 operation rolls')
    return validateBreedingOperationRollSet(rows.map(rowToRoll))
  }
  const findHatchSpecialByEgg = (input: PokemonEggId | string): BreedingRollRecordV1 | null => {
    const identity = eggId(input)
    const rows = database.connection.prepare(`${SELECT}
      WHERE purpose = 'hatch-special-d100'
        AND json_extract(record_json, '$.target.kind') = 'pokemon-egg'
        AND json_extract(record_json, '$.target.eggId') = ?
      ORDER BY roll_record_id
      LIMIT 2
    `).all(identity) as unknown as RollRow[]
    if (rows.length > 1) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'exactly zero or one hatch-special roll per Egg')
    return rows[0] ? rowToRoll(rows[0]) : null
  }
  const findLatestEggWarmerCapabilityBySource: BreedingRollRepository['findLatestEggWarmerCapabilityBySource'] = input => {
    const { sourcePokemonSheetSlug, excludeOperationId } = input
    if (typeof sourcePokemonSheetSlug !== 'string' || sourcePokemonSheetSlug.length < 1 || sourcePokemonSheetSlug.length > 160
      || (excludeOperationId !== undefined && !parseBreedingOperationIdSyntax(excludeOperationId))) {
      throw new Error('sourcePokemonSheetSlug must be one bounded sheet slug.')
    }
    const row = database.connection.prepare(`${SELECT}
      WHERE purpose = 'provider-bounded'
        AND operation_id IN (
          SELECT operation_id FROM breeding_operations
          WHERE status IN ('pending', 'accepted')
            AND json_extract(command_json, '$.commandKind') = 'apply-egg-warmer-capability'
            AND json_extract(command_json, '$.payload.sourcePokemonSheetSlug') = ?
            AND (? IS NULL OR operation_id <> ?)
        )
      ORDER BY generated_at_campaign_minute DESC, roll_record_id DESC
      LIMIT 1
    `).get(sourcePokemonSheetSlug, excludeOperationId ?? null, excludeOperationId ?? null) as unknown as RollRow | undefined
    return row ? rowToRoll(row) : null
  }
  const insert: BreedingRollRepository['insert'] = input => {
    if (!database.connection.isTransaction) throw new BreedingRollRepositoryTransactionError()
    const command = parseBreedingOperationCommandV1(input.command)
    const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
    const commandSha256 = createBreedingOperationCommandHash(command)
    if (roll.operationId !== command.operationId || roll.commandSha256 !== commandSha256 || !commandAllowsRoll(command, roll)) {
      throw new BreedingRepositoryIdentityCollisionError('Breeding roll command authority', roll.rollRecordId)
    }
    const existing = get(roll.rollRecordId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, roll)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding roll', roll.rollRecordId)
    }
    const operationRolls = listByOperation(command.operationId)
    const sameOrdinal = operationRolls.find(value => value.operationRollOrdinal === roll.operationRollOrdinal)
    if (sameOrdinal) {
      if (exactBreedingDocumentReplay(sameOrdinal, roll)) return sameOrdinal
      throw new BreedingRepositoryIdentityCollisionError('Breeding roll operation ordinal', command.operationId)
    }
    if (roll.operationRollOrdinal !== operationRolls.length) {
      throw new BreedingRepositoryIdentityCollisionError('Breeding roll gap-free ordinal', command.operationId)
    }
    if (roll.purpose === 'hatch-special-d100' && roll.target.kind === 'pokemon-egg') {
      const existingForEgg = findHatchSpecialByEgg(roll.target.eggId)
      if (existingForEgg) throw new BreedingRepositoryIdentityCollisionError('Egg hatch-special roll', roll.target.eggId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_rolls (
          roll_record_id, operation_id, operation_roll_ordinal, command_sha256, purpose,
          record_json, definition_sha256, generated_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(roll.rollRecordId, roll.operationId, roll.operationRollOrdinal, roll.commandSha256, roll.purpose,
        stableJsonStringify(roll), roll.definitionSha256, roll.generatedAtCampaignMinute)
    }
    catch (error) {
      const raced = get(roll.rollRecordId) ?? listByOperation(command.operationId)
        .find(value => value.operationRollOrdinal === roll.operationRollOrdinal)
      if (raced && exactBreedingDocumentReplay(raced, roll)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding roll', roll.rollRecordId)
      throw error
    }
    return get(roll.rollRecordId) ?? (() => { throw new Error('Inserted Breeding roll was not readable.') })()
  }
  return Object.freeze({ database, get, listByOperation, findHatchSpecialByEgg, findLatestEggWarmerCapabilityBySource, insert })
}
