import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { NpcGenerationPreviewCommandV1, NpcGenerationPreviewProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import type { WildGenerationPreviewCommandV1 } from '#shared/gmToolkit/generation'
import type { NpcArchetypePolicyV1 } from '#shared/gmToolkit/npcArchetypes'
import type { RotomDatabase } from '../../storage/database'
import { createSqliteGmNpcArchetypeRepository } from '../../storage/gmNpcArchetypeRepository'
import { UseCaseHttpError } from '../../utils/useCaseErrors'
import { buildWildGenerationPreview, type WildGenerationBuiltPreview } from './wildGenerationEngine'
import { constructNpcTrainer, type ConstructedNpcTrainer } from './npcTrainerConstruction'
import { createGmToolkitSeededRng } from './seededRng'

export interface NpcGenerationBuiltPreview {
  readonly command: NpcGenerationPreviewCommandV1
  readonly commandSha256: string
  readonly seed: string
  readonly archetype: NpcArchetypePolicyV1
  readonly trainer: ConstructedNpcTrainer
  readonly wild: WildGenerationBuiltPreview | null
  readonly projection: Omit<NpcGenerationPreviewProjectionV1, 'previewToken' | 'expiresAt'>
  readonly previewHash: string
}
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

export const buildNpcGenerationPreview = (input: {
  readonly command: NpcGenerationPreviewCommandV1
  readonly seed: string
  readonly database: RotomDatabase
}): NpcGenerationBuiltPreview => {
  const archetype = createSqliteGmNpcArchetypeRepository(input.database).get(input.command.archetypeId)
  if (!archetype || archetype.status !== 'active') throw new UseCaseHttpError(404, 'NPC archetype is missing or archived.')
  if (archetype.revision !== input.command.expectedArchetypeRevision) throw new UseCaseHttpError(409, 'NPC archetype changed. Refresh before generation.')
  if (input.command.rosterCount > archetype.roster.count) throw new UseCaseHttpError(400, `This archetype permits at most ${archetype.roster.count} roster Pokémon.`)
  const idRoot = sha256({ operationId: input.command.operationId, archetypeId: archetype.archetypeId, seed: input.seed }).slice(0, 24)
  const trainer = constructNpcTrainer({
    operationId: input.command.operationId,
    candidateId: `npc-trainer-candidate:v1:${idRoot}`,
    archetype,
    guided: input.command.guided,
    rng: createGmToolkitSeededRng(input.seed),
  })
  let wild: WildGenerationBuiltPreview | null = null
  if (input.command.rosterCount > 0) {
    const wildCommand: WildGenerationPreviewCommandV1 = {
      schemaVersion: 1,
      mode: 'preview',
      operationId: input.command.operationId,
      tableId: archetype.roster.tableId,
      expectedTableRevision: archetype.roster.expectedTableRevision,
      requestedSlots: input.command.rosterCount,
      party: { trainerRefs: [] },
      environment: { timeOfDay: null, weather: null },
      policy: { shinyChancePercent: archetype.roster.shinyChancePercent, heldItemName: archetype.roster.heldItemName },
      exploration: null,
    }
    wild = buildWildGenerationPreview({ command: wildCommand, seed: input.seed, database: input.database, targetCandidateCount: input.command.rosterCount })
  }
  const journal = wild?.projection.journal ?? []
  const sourceDefinitionHashes = [...new Set([
    sha256(archetype),
    ...trainer.sourceDefinitionHashes,
    ...(wild?.sourceDefinitionHashes ?? []),
  ])].sort()
  const material = {
    schemaVersion: 1,
    operationId: input.command.operationId,
    commandSha256: sha256(input.command),
    archetypeId: archetype.archetypeId,
    archetypeRevision: archetype.revision,
    trainer: { projection: trainer.projection, definitionSha256: trainer.definitionSha256 },
    roster: wild?.candidates.map(candidate => ({ projection: candidate.projection, definitionSha256: candidate.definitionSha256 })) ?? [],
    journal,
    sourceDefinitionHashes,
  }
  const previewHash = sha256(material)
  return Object.freeze({
    command: input.command,
    commandSha256: sha256(input.command),
    seed: input.seed,
    archetype,
    trainer,
    wild,
    projection: Object.freeze({
      schemaVersion: 1 as const,
      operationId: input.command.operationId,
      archetype: Object.freeze({ name: archetype.name, revision: archetype.revision }),
      trainer: trainer.projection,
      roster: Object.freeze(wild?.candidates.map(candidate => candidate.projection) ?? []),
      journal: Object.freeze([...journal]),
      sourceDefinitionHashes: Object.freeze(sourceDefinitionHashes),
      previewHash,
    }),
    previewHash,
  })
}
