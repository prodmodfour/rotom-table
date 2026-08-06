import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggIdSyntax, type PokemonEggId } from '#shared/breeding/ids'
import { POKEMON_EGG_STATUSES, type PokemonEggDocumentV1, type PokemonEggStatus } from '#shared/breeding/egg'
import { isSlug } from '#shared/paths'
import { isCanonicalBreedingAbilityId, isCanonicalBreedingEggGroupId, isCanonicalBreedingMoveId } from '../domain/breeding/canonicalIds'
import { validatePokemonEggRevisionSuccessor } from '../domain/breeding/eggLifecycle'
import { parseAuthoritativePokemonEggDocumentV1 } from '../domain/breeding/lineage'
import { breedingNature } from '../domain/breeding/natures'
import { compiledBreedingSpeciesSpec } from '../domain/breeding/registry'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
  type BreedingRepositoryReplaceResult,
} from './breedingRepositorySupport'

interface PokemonEggRow {
  readonly egg_id: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly owner_trainer_slug: unknown
  readonly source_kind: unknown
  readonly source_project_id: unknown
  readonly child_sheet_slug: unknown
  readonly last_operation_id: unknown
  readonly created_at_campaign_minute: unknown
  readonly updated_at_campaign_minute: unknown
}
export interface PokemonEggRepository {
  readonly database: RotomDatabase
  get(eggId: PokemonEggId | string): PokemonEggDocumentV1 | null
  listByOwner(ownerTrainerSlug: string, limit?: number): readonly PokemonEggDocumentV1[]
  listBySourceProject(projectId: string, limit?: number): readonly PokemonEggDocumentV1[]
  listByStatuses(statuses: readonly PokemonEggStatus[], limit?: number): readonly PokemonEggDocumentV1[]
  listIncubatingBehindClock(input: { readonly revision: number, readonly campaignMinute: number, readonly limit?: number }): readonly PokemonEggDocumentV1[]
  insert(document: PokemonEggDocumentV1): PokemonEggDocumentV1
  replace(input: { readonly expectedRevision: number, readonly document: PokemonEggDocumentV1 }): BreedingRepositoryReplaceResult<PokemonEggDocumentV1>
}
const TABLE = 'pokemon_eggs'
const SELECT = `
  SELECT egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
         source_project_id, child_sheet_slug, last_operation_id,
         created_at_campaign_minute, updated_at_campaign_minute
  FROM pokemon_eggs
`
const STATUS_SET = new Set<string>(POKEMON_EGG_STATUSES)
const eggId = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value) ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()
const slug = (value: unknown, label: string): string => isSlug(value) && value.length <= 160 ? value : (() => { throw new Error(`${label} must be a canonical bounded sheet slug.`) })()
const assertCanonicalEggReferences = (document: PokemonEggDocumentV1, identity = document.eggId): PokemonEggDocumentV1 => {
  const unavailable = (): never => { throw new BreedingRepositoryCorruptionError(TABLE, identity, 'app-owned canonical reference membership') }
  for (const parent of document.parents) {
    const spec = compiledBreedingSpeciesSpec(parent.speciesId)
    if (!spec || spec.familyRootSpeciesId !== parent.familyRootSpeciesId || spec.definitionSha256 !== parent.speciesSpecDefinitionSha256) unavailable()
    if (parent.eggGroupIds.some(value => !isCanonicalBreedingEggGroupId(value))) unavailable()
    if (parent.effectiveKnownMoves.some(value => !isCanonicalBreedingMoveId(value.moveId))) unavailable()
  }
  const offspringSpec = compiledBreedingSpeciesSpec(document.offspring.speciesId)
  if (!offspringSpec || offspringSpec.familyRootSpeciesId !== document.offspring.familyRootSpeciesId || offspringSpec.definitionSha256 !== document.offspring.speciesSpecDefinitionSha256) unavailable()
  if (!breedingNature(document.offspring.nature.valueId)
    || !isCanonicalBreedingAbilityId(document.offspring.ability.valueId)
    || !offspringSpec.basicAbilityIds.includes(document.offspring.ability.valueId)) unavailable()
  for (const candidate of document.offspring.inheritanceCandidates) {
    if (!isCanonicalBreedingMoveId(candidate.moveId)) unavailable()
    for (const source of candidate.sources) {
      if (source.kind === 'parent') {
        const eligible = source.pathwayId === 'child-egg-move'
          ? offspringSpec.eggMoveIds.includes(candidate.moveId)
          : offspringSpec.machineCompatibleMoveIds.includes(candidate.moveId)
        if (!eligible) unavailable()
      }
    }
  }
  return document
}
const rowToEgg = (row: PokemonEggRow): PokemonEggDocumentV1 => {
  const id = eggId(row.egg_id)
  const document = assertCanonicalEggReferences(parseStrictStoredBreedingJson({ table: TABLE, identity: id, json: row.document_json, parse: parseAuthoritativePokemonEggDocumentV1 }), id)
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${id}.revision`)
  const created = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${TABLE}.${id}.created_at_campaign_minute`)
  const updated = parseBreedingRepositoryCampaignMinute(row.updated_at_campaign_minute, `${TABLE}.${id}.updated_at_campaign_minute`)
  const sourceProjectId = document.source.kind === 'breeding' ? document.source.projectId : null
  assertBreedingStoredColumn(document.eggId === id, TABLE, id, 'egg_id')
  assertBreedingStoredColumn(document.revision === revision, TABLE, id, 'revision')
  assertBreedingStoredColumn(document.status === row.status, TABLE, id, 'status')
  assertBreedingStoredColumn(document.ownerTrainerSlug === row.owner_trainer_slug, TABLE, id, 'owner_trainer_slug')
  assertBreedingStoredColumn(document.source.kind === row.source_kind, TABLE, id, 'source_kind')
  assertBreedingStoredColumn(sourceProjectId === row.source_project_id, TABLE, id, 'source_project_id')
  assertBreedingStoredColumn(document.childSheetSlug === row.child_sheet_slug, TABLE, id, 'child_sheet_slug')
  assertBreedingStoredColumn(document.lastOperationId === row.last_operation_id, TABLE, id, 'last_operation_id')
  assertBreedingStoredColumn(document.createdAtCampaignMinute === created, TABLE, id, 'created_at_campaign_minute')
  assertBreedingStoredColumn(document.updatedAtCampaignMinute === updated, TABLE, id, 'updated_at_campaign_minute')
  return document
}
const parseStatuses = (values: readonly PokemonEggStatus[]): readonly PokemonEggStatus[] => {
  if (!Array.isArray(values) || values.length < 1 || values.length > POKEMON_EGG_STATUSES.length) throw new Error('Egg status query must be a nonempty bounded array.')
  const statuses = [...values]
  if (statuses.some(value => !STATUS_SET.has(value)) || new Set(statuses).size !== statuses.length) throw new Error('Egg status query contains an unknown or duplicate status.')
  return statuses.sort()
}
export const createSqlitePokemonEggRepository = (database: RotomDatabase = getRotomDatabase()): PokemonEggRepository => {
  const get = (value: PokemonEggId | string): PokemonEggDocumentV1 | null => {
    const id = eggId(value)
    const row = database.connection.prepare(`${SELECT} WHERE egg_id = ?`).get(id) as unknown as PokemonEggRow | undefined
    return row ? rowToEgg(row) : null
  }
  const listByOwner = (ownerInput: string, limitInput?: number): readonly PokemonEggDocumentV1[] => {
    const owner = slug(ownerInput, 'ownerTrainerSlug'); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE owner_trainer_slug = ? ORDER BY updated_at_campaign_minute DESC, egg_id ASC LIMIT ?`).all(owner, limit) as unknown as PokemonEggRow[]).map(rowToEgg)
  }
  const listBySourceProject = (projectInput: string, limitInput?: number): readonly PokemonEggDocumentV1[] => {
    if (typeof projectInput !== 'string' || !/^breeding-project:v1:[0-9a-f]{32}$/.test(projectInput)) throw new Error('projectId must be a breeding project ID.')
    const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE source_project_id = ? ORDER BY created_at_campaign_minute ASC, egg_id ASC LIMIT ?`).all(projectInput, limit) as unknown as PokemonEggRow[]).map(rowToEgg)
  }
  const listByStatuses = (statusInput: readonly PokemonEggStatus[], limitInput?: number): readonly PokemonEggDocumentV1[] => {
    const statuses = parseStatuses(statusInput); const limit = parseBreedingRepositoryLimit(limitInput); const placeholders = statuses.map(() => '?').join(', ')
    return (database.connection.prepare(`${SELECT} WHERE status IN (${placeholders}) ORDER BY updated_at_campaign_minute ASC, egg_id ASC LIMIT ?`).all(...statuses, limit) as unknown as PokemonEggRow[]).map(rowToEgg)
  }
  const listIncubatingBehindClock: PokemonEggRepository['listIncubatingBehindClock'] = input => {
    const revision = parseBreedingRepositoryRevision(input.revision, 'clockRevision')
    const campaignMinute = parseBreedingRepositoryCampaignMinute(input.campaignMinute, 'campaignMinute')
    const limit = parseBreedingRepositoryLimit(input.limit)
    return (database.connection.prepare(`${SELECT}
      WHERE status = 'incubating'
        AND (
          json_extract(document_json, '$.incubation.lastAppliedClockRevision') < ?
          OR (
            json_extract(document_json, '$.incubation.lastAppliedClockRevision') = ?
            AND json_extract(document_json, '$.incubation.lastAppliedClockMinute') < ?
          )
        )
      ORDER BY egg_id ASC
      LIMIT ?
    `).all(revision, revision, campaignMinute, limit) as unknown as PokemonEggRow[]).map(rowToEgg)
  }
  const insert = (input: PokemonEggDocumentV1): PokemonEggDocumentV1 => {
    const document = assertCanonicalEggReferences(parseAuthoritativePokemonEggDocumentV1(input))
    if (document.revision !== 0) throw new Error('A new Pokémon Egg must begin at revision 0.')
    const existing = get(document.eggId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, document)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Pokémon Egg', document.eggId)
    }
    const sourceProjectId = document.source.kind === 'breeding' ? document.source.projectId : null
    try {
      database.connection.prepare(`
        INSERT INTO pokemon_eggs (
          egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
          source_project_id, child_sheet_slug, last_operation_id,
          created_at_campaign_minute, updated_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(document.eggId, stableJsonStringify(document), document.revision, document.status, document.ownerTrainerSlug, document.source.kind, sourceProjectId, document.childSheetSlug, document.lastOperationId, document.createdAtCampaignMinute, document.updatedAtCampaignMinute)
    }
    catch (error) {
      const raced = get(document.eggId)
      if (raced && exactBreedingDocumentReplay(raced, document)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Pokémon Egg', document.eggId)
      throw error
    }
    return get(document.eggId) ?? (() => { throw new Error('Inserted Pokémon Egg was not readable.') })()
  }
  const replace: PokemonEggRepository['replace'] = input => {
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = assertCanonicalEggReferences(parseAuthoritativePokemonEggDocumentV1(input.document))
    const current = get(proposed.eggId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    const document = assertCanonicalEggReferences(validatePokemonEggRevisionSuccessor(current, proposed))
    const sourceProjectId = document.source.kind === 'breeding' ? document.source.projectId : null
    const result = database.connection.prepare(`
      UPDATE pokemon_eggs SET
        document_json = ?, revision = ?, status = ?, owner_trainer_slug = ?, source_kind = ?,
        source_project_id = ?, child_sheet_slug = ?, last_operation_id = ?,
        created_at_campaign_minute = ?, updated_at_campaign_minute = ?
      WHERE egg_id = ? AND revision = ?
    `).run(stableJsonStringify(document), document.revision, document.status, document.ownerTrainerSlug, document.source.kind, sourceProjectId, document.childSheetSlug, document.lastOperationId, document.createdAtCampaignMinute, document.updatedAtCampaignMinute, document.eggId, expectedRevision)
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document })
    const raced = get(document.eggId)
    return raced ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision }) : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listByOwner, listBySourceProject, listByStatuses, listIncubatingBehindClock, insert, replace })
}
