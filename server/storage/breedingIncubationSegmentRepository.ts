import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from '#shared/breeding/ids'
import type { BreedingIncubationSegmentResultV1 } from '#shared/breeding/incubation'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import { parseAuthoritativeBreedingIncubationSegmentResultV1 } from '../domain/breeding/incubation'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

interface IncubationSegmentRow {
  readonly operation_id: unknown
  readonly egg_id: unknown
  readonly egg_revision_before: unknown
  readonly egg_revision_after: unknown
  readonly command_kind: unknown
  readonly through_clock_revision: unknown
  readonly through_campaign_minute: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
}

export interface BreedingIncubationSegmentRepository {
  readonly database: RotomDatabase
  get(operationId: BreedingOperationId | string): BreedingIncubationSegmentResultV1 | null
  listByEgg(eggId: PokemonEggId | string, limit?: number): readonly BreedingIncubationSegmentResultV1[]
  insert(input: {
    readonly command: BreedingOperationCommandV1
    readonly segment: BreedingIncubationSegmentResultV1
  }): BreedingIncubationSegmentResultV1
}

export class BreedingIncubationSegmentRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding incubation-segment insertion requires a caller-owned SQLite transaction.')
    this.name = 'BreedingIncubationSegmentRepositoryTransactionError'
  }
}

const TABLE = 'breeding_incubation_segments'
const SELECT = `
  SELECT operation_id, egg_id, egg_revision_before, egg_revision_after,
         command_kind, through_clock_revision, through_campaign_minute,
         record_json, definition_sha256
  FROM breeding_incubation_segments
`
const operationId = (value: unknown): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? (() => { throw new Error('operationId must be a Breeding operation ID.') })()
const eggId = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()

const rowToSegment = (row: IncubationSegmentRow): BreedingIncubationSegmentResultV1 => {
  const identity = operationId(row.operation_id)
  const segment = parseStrictStoredBreedingJson({
    table: TABLE,
    identity,
    json: row.record_json,
    parse: parseAuthoritativeBreedingIncubationSegmentResultV1,
  })
  const revisionBefore = parseBreedingRepositoryRevision(row.egg_revision_before, `${TABLE}.${identity}.egg_revision_before`)
  const revisionAfter = parseBreedingRepositoryRevision(row.egg_revision_after, `${TABLE}.${identity}.egg_revision_after`)
  const clockRevision = parseBreedingRepositoryRevision(row.through_clock_revision, `${TABLE}.${identity}.through_clock_revision`)
  const campaignMinute = parseBreedingRepositoryCampaignMinute(row.through_campaign_minute, `${TABLE}.${identity}.through_campaign_minute`)
  assertBreedingStoredColumn(segment.operationId === identity, TABLE, identity, 'operation_id')
  assertBreedingStoredColumn(segment.eggId === row.egg_id, TABLE, identity, 'egg_id')
  assertBreedingStoredColumn(segment.eggRevisionBefore === revisionBefore, TABLE, identity, 'egg_revision_before')
  assertBreedingStoredColumn(segment.eggRevisionAfter === revisionAfter, TABLE, identity, 'egg_revision_after')
  assertBreedingStoredColumn(segment.commandKind === row.command_kind, TABLE, identity, 'command_kind')
  assertBreedingStoredColumn(segment.throughClockRevision === clockRevision, TABLE, identity, 'through_clock_revision')
  assertBreedingStoredColumn(segment.throughCampaignMinute === campaignMinute, TABLE, identity, 'through_campaign_minute')
  assertBreedingStoredColumn(segment.definitionSha256 === row.definition_sha256, TABLE, identity, 'definition_sha256')
  return segment
}

const commandMatches = (
  command: BreedingOperationCommandV1,
  segment: BreedingIncubationSegmentResultV1,
): boolean => {
  if ((command.commandKind !== 'advance-egg-incubation' && command.commandKind !== 'set-egg-incubation-pause')
    || command.commandKind !== segment.commandKind || command.operationId !== segment.operationId
    || command.payload.eggId !== segment.eggId) return false
  const scope = command.scopes[0]
  if (scope?.kind !== 'pokemon-egg' || scope.eggId !== segment.eggId
    || scope.expectedRevision !== segment.eggRevisionBefore) return false
  return command.commandKind !== 'advance-egg-incubation'
    || (command.payload.throughClockRevision === segment.throughClockRevision
      && command.payload.throughCampaignMinute === segment.throughCampaignMinute)
}

export const createSqliteBreedingIncubationSegmentRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingIncubationSegmentRepository => {
  const get = (input: BreedingOperationId | string): BreedingIncubationSegmentResultV1 | null => {
    const identity = operationId(input)
    const row = database.connection.prepare(`${SELECT} WHERE operation_id = ?`).get(identity) as unknown as IncubationSegmentRow | undefined
    return row ? rowToSegment(row) : null
  }
  const listByEgg = (
    input: PokemonEggId | string,
    limitInput?: number,
  ): readonly BreedingIncubationSegmentResultV1[] => {
    const identity = eggId(input)
    const limit = parseBreedingRepositoryLimit(limitInput)
    const rows = database.connection.prepare(`${SELECT}
      WHERE egg_id = ?
      ORDER BY egg_revision_after ASC, operation_id ASC
      LIMIT ?
    `).all(identity, limit) as unknown as IncubationSegmentRow[]
    const segments = rows.map(rowToSegment)
    for (let index = 1; index < segments.length; index += 1) {
      if (segments[index - 1]!.eggRevisionAfter >= segments[index]!.eggRevisionAfter) {
        throw new BreedingRepositoryCorruptionError(TABLE, identity, 'strictly increasing Egg revisions')
      }
    }
    return Object.freeze(segments)
  }
  const insert: BreedingIncubationSegmentRepository['insert'] = input => {
    if (!database.connection.isTransaction) throw new BreedingIncubationSegmentRepositoryTransactionError()
    const command = parseBreedingOperationCommandV1(input.command)
    const segment = parseAuthoritativeBreedingIncubationSegmentResultV1(input.segment)
    if (!commandMatches(command, segment)) {
      throw new BreedingRepositoryIdentityCollisionError('Breeding incubation segment command authority', segment.operationId)
    }
    const existing = get(segment.operationId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, segment)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding incubation segment', segment.operationId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_incubation_segments (
          operation_id, egg_id, egg_revision_before, egg_revision_after,
          command_kind, through_clock_revision, through_campaign_minute,
          record_json, definition_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        segment.operationId,
        segment.eggId,
        segment.eggRevisionBefore,
        segment.eggRevisionAfter,
        segment.commandKind,
        segment.throughClockRevision,
        segment.throughCampaignMinute,
        stableJsonStringify(segment),
        segment.definitionSha256,
      )
    }
    catch (error) {
      const raced = get(segment.operationId)
      if (raced && exactBreedingDocumentReplay(raced, segment)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding incubation segment', segment.operationId)
      throw error
    }
    return get(segment.operationId)
      ?? (() => { throw new Error('Inserted Breeding incubation segment was not readable.') })()
  }
  return Object.freeze({ database, get, listByEgg, insert })
}
