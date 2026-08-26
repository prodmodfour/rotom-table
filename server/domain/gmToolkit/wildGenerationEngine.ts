import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { EncounterTableDocumentV1, EncounterTableRowV1 } from '#shared/gmToolkit/encounterTables'
import type {
  WildGenerationPreviewCommandV1,
  WildGenerationPreviewProjectionV1,
} from '#shared/gmToolkit/generation'
import { createSqliteGmEncounterTableRepository } from '../../storage/gmEncounterTableRepository'
import { createSqliteSheetRepository } from '../../storage/sheetRepository'
import type { RotomDatabase } from '../../storage/database'
import { UseCaseHttpError } from '../../utils/useCaseErrors'
import { activeGenerationRouteRepel } from './routeRepel'
import { constructWildPokemon, GM_WILD_GENERATION_SOURCE_DEFINITION_HASHES, type ConstructedWildPokemon } from './wildPokemonConstruction'
import { createGmToolkitSeededRng } from './seededRng'

export interface WildGenerationBuiltPreview {
  readonly command: WildGenerationPreviewCommandV1
  readonly commandSha256: string
  readonly seed: string
  readonly table: EncounterTableDocumentV1
  readonly candidates: readonly ConstructedWildPokemon[]
  readonly projection: Omit<WildGenerationPreviewProjectionV1, 'previewToken' | 'expiresAt'>
  readonly sourceDefinitionHashes: readonly string[]
  readonly previewHash: string
}

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const predicateMatches = <T extends string>(accepted: readonly T[], current: T | null): boolean => (
  accepted.length === 0 || (current !== null && accepted.includes(current))
)

const eligibleRows = (table: EncounterTableDocumentV1, command: WildGenerationPreviewCommandV1): readonly EncounterTableRowV1[] => {
  if (!predicateMatches(table.predicates.timeOfDay, command.environment.timeOfDay)
    || !predicateMatches(table.predicates.weather, command.environment.weather)) {
    throw new UseCaseHttpError(409, 'The table is not available for the selected time or weather.')
  }
  const rows = table.rows.filter(row => predicateMatches(row.predicates.timeOfDay, command.environment.timeOfDay)
    && predicateMatches(row.predicates.weather, command.environment.weather))
  if (!rows.some(row => row.kind === 'species')) throw new UseCaseHttpError(409, 'No species rows are eligible for the selected time or weather.')
  return rows
}

const validateParty = (command: WildGenerationPreviewCommandV1, database: RotomDatabase): number => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (const ref of command.party.trainerRefs) {
    const trainer = sheets.getByRef('trainer', ref.trainerSlug)
    if (!trainer) throw new UseCaseHttpError(404, `Party Trainer ${ref.trainerSlug} is missing.`)
    if (trainer.revision !== ref.expectedRevision) throw new UseCaseHttpError(409, `Party Trainer ${ref.trainerSlug} changed. Refresh before generation.`)
  }
  return Math.max(1, command.party.trainerRefs.length)
}

const slotCount = (table: EncounterTableDocumentV1, command: WildGenerationPreviewCommandV1, trainerCount: number): number => {
  const policy = table.groupSizePolicy
  const suggested = policy.kind === 'fixed'
    ? policy.minimum
    : Math.min(policy.maximum, policy.minimum + Math.max(0, trainerCount - 1) * policy.perAdditionalTrainer)
  const count = command.requestedSlots ?? suggested
  if (count < policy.minimum || count > policy.maximum) {
    throw new UseCaseHttpError(400, `Requested slots must be from ${policy.minimum} to ${policy.maximum} for this table.`)
  }
  return count
}

const selectRow = (
  rows: readonly EncounterTableRowV1[],
  slot: number,
  rng: ReturnType<typeof createGmToolkitSeededRng>,
): EncounterTableRowV1 => {
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  if (!Number.isSafeInteger(total) || total < 1 || total > 0xffff_ffff) throw new UseCaseHttpError(409, 'Eligible table weights exceed the deterministic generation range.')
  const roll = rng.int(1, total, `slot-${slot}.weighted-row`)
  let ceiling = 0
  for (const row of rows) {
    ceiling += row.weight
    if (roll <= ceiling) return row
  }
  throw new Error('Weighted row selection did not resolve inside its total')
}

export const buildWildGenerationPreview = (input: {
  readonly command: WildGenerationPreviewCommandV1
  readonly seed: string
  readonly database: RotomDatabase
  /** NPC roster assembly may require an exact candidate count while still honoring journaled Nothing rows. */
  readonly targetCandidateCount?: number
}): WildGenerationBuiltPreview => {
  const table = createSqliteGmEncounterTableRepository(input.database).get(input.command.tableId)
  if (!table || table.status !== 'active') throw new UseCaseHttpError(404, 'Campaign encounter table is missing or archived.')
  if (table.revision !== input.command.expectedTableRevision) throw new UseCaseHttpError(409, 'Campaign encounter table changed. Refresh before generation.')
  const trainerCount = validateParty(input.command, input.database)
  const count = slotCount(table, input.command, trainerCount)
  if (input.targetCandidateCount !== undefined && (!Number.isSafeInteger(input.targetCandidateCount) || input.targetCandidateCount < 1 || input.targetCandidateCount > 6 || input.targetCandidateCount > count)) {
    throw new UseCaseHttpError(400, 'Target candidate count must fit the requested NPC roster slots.')
  }
  const rows = eligibleRows(table, input.command)
  const repel = activeGenerationRouteRepel(input.command.exploration, input.database)
  const rng = createGmToolkitSeededRng(input.seed)
  const candidates: ConstructedWildPokemon[] = []
  let nothingSlots = 0
  let repelledSlots = 0
  const idRoot = sha256({ operationId: input.command.operationId, tableId: table.tableId, seed: input.seed }).slice(0, 24)

  const attemptLimit = input.targetCandidateCount === undefined ? count : 30
  let completedSlots = 0
  for (let slot = 1; slot <= attemptLimit; slot += 1) {
    completedSlots = slot
    const row = selectRow(rows, slot, rng)
    if (row.kind === 'nothing') {
      nothingSlots += 1
      continue
    }
    const level = rng.int(row.minLevel, row.maxLevel, `slot-${slot}.level`)
    if (repel && level <= repel.maximumAffectedWildLevel) {
      repelledSlots += 1
      continue
    }
    candidates.push(constructWildPokemon({
      operationId: input.command.operationId,
      candidateId: `wild-candidate:v1:${idRoot}:${slot}`,
      slot,
      speciesId: row.speciesId,
      level,
      shinyChancePercent: input.command.policy.shinyChancePercent,
      heldItemName: input.command.policy.heldItemName,
      tableId: table.tableId,
      tableRevision: table.revision,
      rng,
    }))
    if (input.targetCandidateCount !== undefined && candidates.length === input.targetCandidateCount) break
  }
  if (input.targetCandidateCount !== undefined && candidates.length !== input.targetCandidateCount) {
    throw new UseCaseHttpError(409, `The table could not produce ${input.targetCandidateCount} eligible roster Pokémon within 30 journaled slots.`)
  }

  const sourceDefinitionHashes = [...new Set([
    ...GM_WILD_GENERATION_SOURCE_DEFINITION_HASHES,
    sha256(table),
    ...candidates.flatMap(candidate => candidate.sourceDefinitionHashes),
  ])].sort()
  const commandSha256 = sha256(input.command)
  const previewMaterial = {
    schemaVersion: 1,
    operationId: input.command.operationId,
    commandSha256,
    tableId: table.tableId,
    tableRevision: table.revision,
    requestedSlots: completedSlots,
    nothingSlots,
    repelledSlots,
    candidates: candidates.map(candidate => ({
      projection: candidate.projection,
      definitionSha256: candidate.definitionSha256,
    })),
    journal: rng.journal,
    sourceDefinitionHashes,
  }
  const previewHash = sha256(previewMaterial)
  const projection = Object.freeze({
    schemaVersion: 1 as const,
    operationId: input.command.operationId,
    table: Object.freeze({ name: table.name, revision: table.revision }),
    requestedSlots: completedSlots,
    nothingSlots,
    repelledSlots,
    candidates: Object.freeze(candidates.map(candidate => candidate.projection)),
    journal: Object.freeze([...rng.journal]),
    sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
    previewHash,
  })
  return Object.freeze({
    command: input.command,
    commandSha256,
    seed: input.seed,
    table,
    candidates: Object.freeze(candidates),
    projection,
    sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
    previewHash,
  })
}
