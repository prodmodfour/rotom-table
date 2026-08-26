import { createHash, createHmac } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseWildGenerationCommandV1,
  type WildGenerationCommandV1,
  type WildGenerationCommitCommandV1,
  type WildGenerationCommitProjectionV1,
  type WildGenerationPreviewCommandV1,
  type WildGenerationPreviewProjectionV1,
} from '#shared/gmToolkit/generation'
import { buildWildGenerationPreview } from '../domain/gmToolkit/wildGenerationEngine'
import {
  createWildGenerationPreviewToken,
  verifyWildGenerationPreviewToken,
} from '../domain/gmToolkit/generationPreviewToken'
import {
  createSqliteGmWildGenerationRepository,
  gmWildGenerationCommandSha256,
  gmWildGenerationPreviewCommandSha256,
  type GmWildGenerationRepository,
} from '../storage/gmWildGenerationRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { gmToolkitPreviewSigningKey } from '../storage/gmToolkitSecretRepository'
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

export class WildGenerationUseCaseError extends UseCaseHttpError<400 | 404 | 409> {
  readonly code: string
  constructor(statusCode: 400 | 404 | 409, code: string, message: string) { super(statusCode, message); this.code = code }
}

type WildSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'allocateSlug' | 'save' | 'getByRef'> & { readonly database?: RotomDatabase }
type WildRealtimeRepository = Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }

export interface ManageWildGenerationDependencies {
  readonly database?: RotomDatabase
  readonly generationRepository?: GmWildGenerationRepository
  readonly sheetRepository?: WildSheetRepository
  readonly realtimeRepository?: WildRealtimeRepository
  readonly now?: () => string
  readonly signingKey?: string
  readonly seedForCommand?: (command: WildGenerationPreviewCommandV1, signingKey: string) => string
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly publishToolkitInvalidation?: typeof publishGmCampaignToolkitInvalidation
  readonly afterSheetWrite?: (slug: string, index: number) => void
}

export type ManageWildGenerationResult = WildGenerationPreviewProjectionV1 | WildGenerationCommitProjectionV1

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const isoNow = (now?: () => string): string => {
  const value = (now ?? (() => new Date().toISOString()))()
  if (!Number.isFinite(Date.parse(value))) throw new Error('Wild generation clock returned an invalid instant')
  return new Date(value).toISOString()
}
const defaultSeed = (command: WildGenerationPreviewCommandV1, key: string): string => createHmac('sha256', key)
  .update(stableJsonStringify(command)).digest('hex')

const resolveDatabase = (dependencies: ManageWildGenerationDependencies): RotomDatabase => {
  const candidates = [
    dependencies.generationRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.realtimeRepository?.database,
  ].filter((value): value is RotomDatabase => Boolean(value))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('Wild generation repositories must share one RotomDatabase')
  return database
}

const normalizedError = (error: unknown): never => {
  if (error instanceof WildGenerationUseCaseError || error instanceof UseCaseHttpError) throw error
  const message = error instanceof Error ? error.message : 'Wild generation failed'
  if (/expired|signature|token|selected candidate|preview/i.test(message)) throw new WildGenerationUseCaseError(409, 'preview-conflict', message)
  throw error
}

const preview = (
  command: WildGenerationPreviewCommandV1,
  dependencies: ManageWildGenerationDependencies,
): WildGenerationPreviewProjectionV1 => {
  const database = resolveDatabase(dependencies)
  const repository = dependencies.generationRepository ?? createSqliteGmWildGenerationRepository(database)
  if (repository.get(command.operationId)) throw new WildGenerationUseCaseError(409, 'operation-settled', 'This generation operation is already committed.')
  const now = isoNow(dependencies.now)
  const signingKey = dependencies.signingKey ?? gmToolkitPreviewSigningKey(database)
  const seed = (dependencies.seedForCommand ?? defaultSeed)(command, signingKey)
  const built = buildWildGenerationPreview({ command, seed, database })
  const expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
  const previewToken = createWildGenerationPreviewToken({
    schemaVersion: 1,
    tokenKind: 'wild-generation-preview',
    command,
    seed,
    previewHash: built.previewHash,
    issuedAt: now,
    expiresAt,
  }, signingKey)
  return { ...built.projection, previewToken, expiresAt }
}

const exactRetryOrConflict = (
  command: WildGenerationCommitCommandV1,
  repository: GmWildGenerationRepository,
): WildGenerationCommitProjectionV1 | null => {
  const prior = repository.get(command.operationId)
  if (!prior) return null
  if (prior.commandSha256 !== gmWildGenerationCommandSha256(command)) {
    throw new WildGenerationUseCaseError(409, 'operation-reused', 'This operation ID was already committed with different material.')
  }
  return { ...prior.result, exactRetry: true }
}

const commit = (
  command: WildGenerationCommitCommandV1,
  dependencies: ManageWildGenerationDependencies,
): WildGenerationCommitProjectionV1 => {
  const database = resolveDatabase(dependencies)
  const generationRepository = dependencies.generationRepository ?? createSqliteGmWildGenerationRepository(database)
  const retry = exactRetryOrConflict(command, generationRepository)
  if (retry) return retry
  const now = isoNow(dependencies.now)
  const signingKey = dependencies.signingKey ?? gmToolkitPreviewSigningKey(database)
  const token = verifyWildGenerationPreviewToken(command.previewToken, signingKey, now)
  if (token.command.operationId !== command.operationId) throw new WildGenerationUseCaseError(409, 'operation-mismatch', 'Preview and commit operation identities do not match.')
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeRepository = dependencies.realtimeRepository ?? createSqliteRealtimeEventRepository({ database })

  let events: readonly PersistedRealtimeEvent[] = []
  const result = database.withTransaction(() => {
    const concurrent = exactRetryOrConflict(command, generationRepository)
    if (concurrent) return concurrent
    const rebuilt = buildWildGenerationPreview({ command: token.command, seed: token.seed, database })
    if (rebuilt.previewHash !== token.previewHash) throw new WildGenerationUseCaseError(409, 'preview-drift', 'Preview authority changed; request a fresh preview.')
    const candidateById = new Map(rebuilt.candidates.map(candidate => [candidate.candidateId, candidate]))
    const selected = command.selectedCandidateIds.map((candidateId) => {
      const candidate = candidateById.get(candidateId)
      if (!candidate) throw new WildGenerationUseCaseError(409, 'candidate-mismatch', 'A selected candidate is not part of this exact preview.')
      return candidate
    })
    const updatedAt = Date.parse(now)
    const sheetRefs: WildGenerationCommitProjectionV1['sheets'][number][] = []
    const realtimeInputs = []
    for (const [index, candidate] of selected.entries()) {
      const slug = sheetRepository.allocateSlug('pokemon', `${candidate.projection.speciesId}-${command.operationId.slice(-12)}`)
      const stored = sheetRepository.save({
        kind: 'pokemon',
        slug,
        revision: 0,
        updatedAt,
        document: {
          ...structuredClone(candidate.document),
          slug,
          folder: command.folder,
          revision: 0,
          updatedAt,
        },
      })
      dependencies.afterSheetWrite?.(slug, index)
      const persisted = sheetRepository.getByRef('pokemon', slug)
      if (!persisted || persisted.revision !== 0 || stored.revision !== 0) throw new Error(`Generated Pokémon sheet ${slug} was not readable after insert`)
      sheetRefs.push({ kind: 'pokemon', slug, revision: 0, candidateId: candidate.candidateId, custody: 'gm-campaign', ownerTrainerSlug: null })
      realtimeInputs.push(...sheetLibraryGeneratedIdentityRealtimeAppendInputs(persisted))
    }
    const projection: WildGenerationCommitProjectionV1 = {
      schemaVersion: 1,
      operationId: command.operationId,
      exactRetry: false,
      committedAt: now,
      packageId: `wild-package:v1:${sha256(command.operationId).slice(0, 32)}`,
      table: { name: rebuilt.table.name, revision: rebuilt.table.revision },
      sheets: sheetRefs,
      candidates: selected.map(candidate => candidate.projection),
    }
    generationRepository.create({
      command,
      commandSha256: gmWildGenerationCommandSha256(command),
      previewCommand: token.command,
      previewCommandSha256: gmWildGenerationPreviewCommandSha256(token.command),
      previewHash: rebuilt.previewHash,
      seed: token.seed,
      journal: rebuilt.projection.journal,
      result: projection,
      createdAt: now,
    })
    events = realtimeRepository.appendMany(realtimeInputs)
    return projection
  })

  if (!result.exactRetry) {
    publishPersistedRealtimeEventsAfterCommit({
      events,
      operation: `wild generation ${result.operationId}`,
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    ;(dependencies.publishToolkitInvalidation ?? publishGmCampaignToolkitInvalidation)({
      schemaVersion: 1,
      domain: 'wild-generation',
      documentId: result.packageId,
      revision: 0,
    })
  }
  return result
}

export const manageWildGenerationUseCase = (
  input: unknown,
  dependencies: ManageWildGenerationDependencies = {},
): ManageWildGenerationResult => {
  try {
    const command: WildGenerationCommandV1 = parseWildGenerationCommandV1(input)
    return command.mode === 'preview' ? preview(command, dependencies) : commit(command, dependencies)
  } catch (error) {
    return normalizedError(error)
  }
}
