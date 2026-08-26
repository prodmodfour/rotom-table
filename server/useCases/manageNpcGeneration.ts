import { createHash, createHmac } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseNpcGenerationCommandV1,
  type NpcGenerationCommitCommandV1,
  type NpcGenerationCommitProjectionV1,
  type NpcGenerationPreviewCommandV1,
  type NpcGenerationPreviewProjectionV1,
} from '#shared/gmToolkit/npcGeneration'
import { buildNpcGenerationPreview } from '../domain/gmToolkit/npcGenerationEngine'
import { createNpcPreviewToken, verifyNpcPreviewToken } from '../domain/gmToolkit/npcPreviewToken'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { gmToolkitPreviewSigningKey } from '../storage/gmToolkitSecretRepository'
import {
  createSqliteGmNpcGenerationRepository,
  npcGenerationCommandSha256,
  npcPreviewCommandSha256,
  type GmNpcGenerationRepository,
} from '../storage/gmNpcGenerationRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { sheetLibraryGeneratedIdentityRealtimeAppendInputs } from '../realtime/libraryMutationRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { publishGmCampaignToolkitInvalidation } from '../utils/gmToolkitRealtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class NpcGenerationUseCaseError extends UseCaseHttpError<400 | 404 | 409> {
  readonly code: string
  constructor(statusCode: 400 | 404 | 409, code: string, message: string) { super(statusCode, message); this.code = code }
}
type NpcSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'allocateSlug' | 'save' | 'getByRef'> & { readonly database?: RotomDatabase }
type NpcRealtimeRepository = Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
export interface ManageNpcGenerationDependencies {
  readonly database?: RotomDatabase
  readonly generationRepository?: GmNpcGenerationRepository
  readonly sheetRepository?: NpcSheetRepository
  readonly realtimeRepository?: NpcRealtimeRepository
  readonly now?: () => string
  readonly signingKey?: string
  readonly seedForCommand?: (command: NpcGenerationPreviewCommandV1, key: string) => string
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly publishToolkitInvalidation?: typeof publishGmCampaignToolkitInvalidation
  readonly afterSheetWrite?: (kind: 'trainer' | 'pokemon', slug: string, index: number) => void
}
export type ManageNpcGenerationResult = NpcGenerationPreviewProjectionV1 | NpcGenerationCommitProjectionV1
const sha = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const nowIso = (clock?: () => string): string => {
  const value = (clock ?? (() => new Date().toISOString()))()
  if (!Number.isFinite(Date.parse(value))) throw new Error('NPC generation clock returned an invalid instant')
  return new Date(value).toISOString()
}
const resolveDatabase = (deps: ManageNpcGenerationDependencies): RotomDatabase => {
  const candidates = [deps.generationRepository?.database, deps.sheetRepository?.database, deps.realtimeRepository?.database].filter((value): value is RotomDatabase => Boolean(value))
  const database = deps.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('NPC generation repositories must share one RotomDatabase')
  return database
}
const exactRetry = (command: NpcGenerationCommitCommandV1, repository: GmNpcGenerationRepository): NpcGenerationCommitProjectionV1 | null => {
  const prior = repository.get(command.operationId)
  if (!prior) return null
  if (prior.commandSha256 !== npcGenerationCommandSha256(command)) throw new NpcGenerationUseCaseError(409, 'operation-reused', 'This NPC generation operation was already committed with different material.')
  return { ...prior.result, exactRetry: true }
}
const preview = (command: NpcGenerationPreviewCommandV1, deps: ManageNpcGenerationDependencies): NpcGenerationPreviewProjectionV1 => {
  const database = resolveDatabase(deps)
  const repository = deps.generationRepository ?? createSqliteGmNpcGenerationRepository(database)
  if (repository.get(command.operationId)) throw new NpcGenerationUseCaseError(409, 'operation-settled', 'This NPC generation operation is already committed.')
  const now = nowIso(deps.now)
  const key = deps.signingKey ?? gmToolkitPreviewSigningKey(database)
  const seed = (deps.seedForCommand ?? ((value, secret) => createHmac('sha256', secret).update(`npc:${stableJsonStringify(value)}`).digest('hex')))(command, key)
  const built = buildNpcGenerationPreview({ command, seed, database })
  const expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
  return {
    ...built.projection,
    previewToken: createNpcPreviewToken({ schemaVersion: 1, tokenKind: 'npc-generation-preview', command, seed, previewHash: built.previewHash, issuedAt: now, expiresAt }, key),
    expiresAt,
  }
}
const commit = (command: NpcGenerationCommitCommandV1, deps: ManageNpcGenerationDependencies): NpcGenerationCommitProjectionV1 => {
  const database = resolveDatabase(deps)
  const generation = deps.generationRepository ?? createSqliteGmNpcGenerationRepository(database)
  const retry = exactRetry(command, generation)
  if (retry) return retry
  const now = nowIso(deps.now)
  const token = verifyNpcPreviewToken(command.previewToken, deps.signingKey ?? gmToolkitPreviewSigningKey(database), now)
  if (token.command.operationId !== command.operationId) throw new NpcGenerationUseCaseError(409, 'operation-mismatch', 'NPC preview and commit operation identities do not match.')
  const sheets = deps.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtime = deps.realtimeRepository ?? createSqliteRealtimeEventRepository({ database })
  let events: readonly PersistedRealtimeEvent[] = []
  const result = database.withTransaction(() => {
    const concurrent = exactRetry(command, generation)
    if (concurrent) return concurrent
    const built = buildNpcGenerationPreview({ command: token.command, seed: token.seed, database })
    if (built.previewHash !== token.previewHash) throw new NpcGenerationUseCaseError(409, 'preview-drift', 'NPC preview authority changed; request a fresh preview.')
    const timestamp = Date.parse(now)
    const trainerSlug = sheets.allocateSlug('trainer', token.command.guided.name)
    const pokemonRows = built.wild?.candidates ?? []
    const reservedPokemonSlugs = new Set<string>()
    const pokemonPlans = pokemonRows.map((candidate) => {
      const base = sheets.allocateSlug('pokemon', `${candidate.projection.speciesId}-${trainerSlug}`)
      let slug = base
      let suffix = 2
      while (reservedPokemonSlugs.has(slug) || sheets.getByRef('pokemon', slug)) {
        slug = `${base}-${suffix}`
        suffix += 1
      }
      reservedPokemonSlugs.add(slug)
      return { candidate, slug }
    })
    const trainerStored = sheets.save({
      kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: timestamp,
      document: { ...structuredClone(built.trainer.document), slug: trainerSlug, folder: command.trainerFolder, revision: 0, updatedAt: timestamp, currentTeam: pokemonPlans.map(row => row.slug), boxedPokemon: [] },
    })
    deps.afterSheetWrite?.('trainer', trainerSlug, 0)
    const inputs = []
    const trainerPersisted = sheets.getByRef('trainer', trainerSlug)
    if (!trainerPersisted || trainerStored.revision !== 0) throw new Error('Generated NPC Trainer was not readable after insert')
    inputs.push(...sheetLibraryGeneratedIdentityRealtimeAppendInputs(trainerPersisted))
    const rosterRefs: NpcGenerationCommitProjectionV1['roster'][number][] = []
    for (const [index, plan] of pokemonPlans.entries()) {
      const stored = sheets.save({
        kind: 'pokemon', slug: plan.slug, revision: 0, updatedAt: timestamp,
        document: { ...structuredClone(plan.candidate.document), slug: plan.slug, folder: command.pokemonFolder, revision: 0, updatedAt: timestamp },
      })
      deps.afterSheetWrite?.('pokemon', plan.slug, index + 1)
      const persisted = sheets.getByRef('pokemon', plan.slug)
      if (!persisted || stored.revision !== 0) throw new Error(`Generated NPC roster sheet ${plan.slug} was not readable after insert`)
      inputs.push(...sheetLibraryGeneratedIdentityRealtimeAppendInputs(persisted))
      rosterRefs.push({ kind: 'pokemon', slug: plan.slug, revision: 0, candidateId: plan.candidate.candidateId, custody: 'npc-roster', ownerTrainerSlug: trainerSlug })
    }
    const projection: NpcGenerationCommitProjectionV1 = {
      schemaVersion: 1, operationId: command.operationId, exactRetry: false, committedAt: now,
      packageId: `npc-package:v1:${sha(command.operationId).slice(0, 32)}`,
      archetype: { name: built.archetype.name, revision: built.archetype.revision },
      trainer: { kind: 'trainer', slug: trainerSlug, revision: 0, candidateId: built.trainer.candidateId, custody: 'gm-campaign' },
      roster: rosterRefs,
      trainerCandidate: built.trainer.projection,
      pokemonCandidates: pokemonRows.map(row => row.projection),
    }
    generation.create({ command, commandSha256: npcGenerationCommandSha256(command), previewCommand: token.command, previewCommandSha256: npcPreviewCommandSha256(token.command), previewHash: built.previewHash, seed: token.seed, journal: built.projection.journal, result: projection, createdAt: now })
    events = realtime.appendMany(inputs)
    return projection
  })
  if (!result.exactRetry) {
    publishPersistedRealtimeEventsAfterCommit({ events, operation: `NPC generation ${result.operationId}`, publish: deps.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher, reportFailure: deps.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter })
    ;(deps.publishToolkitInvalidation ?? publishGmCampaignToolkitInvalidation)({ schemaVersion: 1, domain: 'npc-generation', documentId: result.packageId, revision: 0 })
  }
  return result
}
export const manageNpcGenerationUseCase = (input: unknown, deps: ManageNpcGenerationDependencies = {}): ManageNpcGenerationResult => {
  try {
    const command = parseNpcGenerationCommandV1(input)
    return command.mode === 'preview' ? preview(command, deps) : commit(command, deps)
  } catch (error) {
    if (error instanceof NpcGenerationUseCaseError || error instanceof UseCaseHttpError) throw error
    const message = error instanceof Error ? error.message : 'NPC generation failed'
    if (/token|preview|signature|expired/i.test(message)) throw new NpcGenerationUseCaseError(409, 'preview-conflict', message)
    throw error
  }
}
