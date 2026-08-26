import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { assertSessionPreparationReady, parseSessionPreparationDocumentV1, projectSessionPreparationForLibrary, type SessionPreparationDocumentV1, type SessionPreparationLifecycleV1, type SessionPreparationSceneV1 } from '#shared/gmToolkit/sessionPreparation'
import { parseSessionPreparationCommandV1, type SessionPreparationCommandV1, type SessionPreparationMutationProjectionV1 } from '#shared/gmToolkit/sessionPreparationOperations'
import { createSqliteGmSessionPreparationRepository, type GmSessionPreparationRepository, type GmSessionPreparationOperationKind } from '../storage/gmSessionPreparationRepository'
import { createSqliteGmEncounterTableRepository } from '../storage/gmEncounterTableRepository'
import { createSqliteGmWildGenerationRepository } from '../storage/gmWildGenerationRepository'
import { createSqliteGmNpcGenerationRepository } from '../storage/gmNpcGenerationRepository'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { createSqliteMapRepository } from '../storage/mapRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class SessionPreparationUseCaseError extends UseCaseHttpError<400 | 404 | 409> {
  constructor(statusCode: 400 | 404 | 409, readonly code: string, message: string) { super(statusCode, message) }
}
export interface ManageSessionPreparationDependencies { readonly repository?: GmSessionPreparationRepository; readonly now?: () => string }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const nowIso = (clock?: () => string): string => { const value = (clock ?? (() => new Date().toISOString()))(); if (!Number.isFinite(Date.parse(value))) throw new Error('Session preparation clock returned an invalid instant'); return new Date(value).toISOString() }
const preparationIdFor = (operationId: string): string => `session-preparation:v1:${sha256(operationId).slice(0, 24)}`
const operationKind = (command: SessionPreparationCommandV1): GmSessionPreparationOperationKind => command.kind
const currentOrFail = (repository: GmSessionPreparationRepository, id: string): SessionPreparationDocumentV1 => repository.get(id) ?? (() => { throw new SessionPreparationUseCaseError(404, 'not-found', 'Session preparation not found.') })()
const revisionOrFail = (document: SessionPreparationDocumentV1, expected: number, label = 'Session preparation'): void => { if (document.revision !== expected) throw new SessionPreparationUseCaseError(409, 'stale-revision', `${label} changed. Refresh before continuing.`) }
const projection = (command: SessionPreparationCommandV1, document: SessionPreparationDocumentV1, exactRetry: boolean): SessionPreparationMutationProjectionV1 => ({ schemaVersion: 1, operationId: command.operationId, commandKind: command.kind, exactRetry, preparation: document })
const remapImportedScenes = (scenes: readonly SessionPreparationSceneV1[], operationId: string): readonly SessionPreparationSceneV1[] => scenes.map((scene, sceneIndex) => ({
  ...structuredClone(scene),
  sceneId: `scene:${sha256(`${operationId}:scene:${sceneIndex}`).slice(0, 24)}`,
  encounterCandidates: scene.encounterCandidates.map((candidate, candidateIndex) => ({ ...structuredClone(candidate), candidateId: `candidate:${sha256(`${operationId}:candidate:${sceneIndex}:${candidateIndex}`).slice(0, 24)}` })),
}))
const allowedTransition = (from: SessionPreparationLifecycleV1, target: 'draft' | 'review' | 'ready'): boolean => (
  (from === 'draft' && target === 'review') || (from === 'review' && (target === 'draft' || target === 'ready')) || (from === 'ready' && target === 'review')
)
const validateReferences = (document: SessionPreparationDocumentV1, repository: GmSessionPreparationRepository): void => {
  const database = repository.database
  const tables = createSqliteGmEncounterTableRepository(database)
  const wildPackages = createSqliteGmWildGenerationRepository(database)
  const npcPackages = createSqliteGmNpcGenerationRepository(database)
  const sheets = createSqliteSheetRepository(database)
  const maps = createSqliteMapRepository(database)
  for (const scene of document.scenes) {
    if (scene.map) {
      const map = maps.get(scene.map.slug)
      if (!map || map.revision !== scene.map.revision) throw new SessionPreparationUseCaseError(409, 'stale-map', `Scene “${scene.title}” references a missing or changed map.`)
    }
    for (const candidate of scene.encounterCandidates) {
      const source = candidate.source
      if (source.kind === 'wild-package' && !wildPackages.getByPackageId(source.packageId)) throw new SessionPreparationUseCaseError(409, 'missing-package', `Candidate “${candidate.label}” references a missing wild package.`)
      if (source.kind === 'npc-package' && !npcPackages.getByPackageId(source.packageId)) throw new SessionPreparationUseCaseError(409, 'missing-package', `Candidate “${candidate.label}” references a missing NPC package.`)
      if (source.kind === 'encounter-table') {
        const table = tables.get(source.tableId)
        if (!table || table.status !== 'active' || table.revision !== source.revision) throw new SessionPreparationUseCaseError(409, 'stale-table', `Candidate “${candidate.label}” references a missing, archived, or changed encounter table.`)
      }
      if (source.kind === 'existing-sheets') for (const ref of source.sheets) {
        const sheet = sheets.getByRef(ref.kind, ref.slug)
        if (!sheet || sheet.revision !== ref.revision) throw new SessionPreparationUseCaseError(409, 'stale-sheet', `Candidate “${candidate.label}” references a missing or changed ${ref.kind} sheet.`)
      }
    }
  }
}
const settle = (command: SessionPreparationCommandV1, dependencies: ManageSessionPreparationDependencies): SessionPreparationMutationProjectionV1 => {
  const repository = dependencies.repository ?? createSqliteGmSessionPreparationRepository()
  const commandHash = sha256(command)
  const prior = repository.getOperation(command.operationId)
  if (prior) {
    if (prior.commandSha256 !== commandHash) throw new SessionPreparationUseCaseError(409, 'operation-reused', 'This operation ID was already accepted with different preparation material.')
    return projection(command, prior.result, true)
  }
  const now = nowIso(dependencies.now)
  return repository.database.withTransaction(() => {
    const concurrent = repository.getOperation(command.operationId)
    if (concurrent) {
      if (concurrent.commandSha256 !== commandHash) throw new SessionPreparationUseCaseError(409, 'operation-reused', 'This operation ID was already accepted with different preparation material.')
      return projection(command, concurrent.result, true)
    }
    let result: SessionPreparationDocumentV1
    if (command.kind === 'create') {
      result = repository.create(parseSessionPreparationDocumentV1({ schemaVersion: 1, preparationId: preparationIdFor(command.operationId), revision: 0, lifecycle: 'draft', title: command.title, scheduledFor: command.scheduledFor, playerOverview: '', gmNotes: '', scenes: [], handouts: [], unresolvedDecisions: [], launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null }, createdAt: now, updatedAt: now }))
    } else if (command.kind === 'copy') {
      const source = currentOrFail(repository, command.sourcePreparationId); revisionOrFail(source, command.expectedSourceRevision, 'Source preparation')
      if (source.lifecycle === 'cancelled') throw new SessionPreparationUseCaseError(409, 'source-cancelled', 'A cancelled preparation cannot be copied.')
      const copied = parseSessionPreparationDocumentV1({ ...structuredClone(source), preparationId: preparationIdFor(command.operationId), revision: 0, lifecycle: 'draft', title: command.title, launches: [], provenance: { kind: 'copy', sourcePreparationId: source.preparationId, sourceRevision: source.revision }, createdAt: now, updatedAt: now })
      validateReferences(copied, repository)
      result = repository.create(copied)
    } else {
      const current = currentOrFail(repository, command.preparationId); revisionOrFail(current, command.expectedRevision)
      if (command.kind === 'save') {
        if (current.lifecycle !== 'draft' && current.lifecycle !== 'review') throw new SessionPreparationUseCaseError(409, 'lifecycle-locked', 'Move this preparation back to review before editing it.')
        result = parseSessionPreparationDocumentV1({ ...current, ...structuredClone(command.content), revision: current.revision + 1, updatedAt: now })
        validateReferences(result, repository)
      } else if (command.kind === 'transition') {
        if (!allowedTransition(current.lifecycle, command.target)) throw new SessionPreparationUseCaseError(409, 'invalid-transition', `A ${current.lifecycle} preparation cannot move directly to ${command.target}.`)
        const transitioned = parseSessionPreparationDocumentV1({ ...current, revision: current.revision + 1, lifecycle: command.target, updatedAt: now })
        result = command.target === 'ready' ? assertSessionPreparationReady(transitioned) : transitioned
        if (command.target !== 'draft') validateReferences(result, repository)
      } else if (command.kind === 'import-scenes') {
        if (current.lifecycle !== 'draft' && current.lifecycle !== 'review') throw new SessionPreparationUseCaseError(409, 'lifecycle-locked', 'Only draft or review preparations can import scenes.')
        if (current.preparationId === command.sourcePreparationId) throw new SessionPreparationUseCaseError(400, 'same-source', 'Import scenes from a different preparation.')
        const source = currentOrFail(repository, command.sourcePreparationId); revisionOrFail(source, command.expectedSourceRevision, 'Source preparation')
        const selected = command.sceneIds.map((sceneId) => source.scenes.find(scene => scene.sceneId === sceneId) ?? (() => { throw new SessionPreparationUseCaseError(404, 'scene-not-found', `Source scene ${sceneId} no longer exists.`) })())
        result = parseSessionPreparationDocumentV1({ ...current, revision: current.revision + 1, scenes: [...current.scenes, ...remapImportedScenes(selected, command.operationId)], updatedAt: now })
        validateReferences(result, repository)
      } else if (command.kind === 'archive') {
        if (current.lifecycle === 'archived' || current.lifecycle === 'cancelled') throw new SessionPreparationUseCaseError(409, 'terminal', `A ${current.lifecycle} preparation cannot be archived.`)
        result = parseSessionPreparationDocumentV1({ ...current, revision: current.revision + 1, lifecycle: 'archived', updatedAt: now })
      } else {
        if (!['draft', 'review', 'ready'].includes(current.lifecycle)) throw new SessionPreparationUseCaseError(409, 'terminal', `A ${current.lifecycle} preparation cannot be cancelled.`)
        result = parseSessionPreparationDocumentV1({ ...current, revision: current.revision + 1, lifecycle: 'cancelled', updatedAt: now })
      }
      const stored = repository.replace(result, current.revision)
      if (!stored) throw new SessionPreparationUseCaseError(409, 'stale-revision', 'Session preparation changed. Refresh before continuing.')
      result = stored
    }
    repository.createOperation({ operationId: command.operationId, commandSha256: commandHash, commandKind: operationKind(command), preparationId: result.preparationId, expectedRevision: command.kind === 'create' || command.kind === 'copy' ? null : command.expectedRevision, command, result, createdAt: now })
    return projection(command, result, false)
  })
}
export const manageSessionPreparationUseCase = (input: unknown, dependencies: ManageSessionPreparationDependencies = {}): SessionPreparationMutationProjectionV1 => {
  try { return settle(parseSessionPreparationCommandV1(input), dependencies) }
  catch (error) {
    if (error instanceof SessionPreparationUseCaseError || error instanceof UseCaseHttpError) throw error
    const message = error instanceof Error ? error.message : 'Session preparation command is invalid.'
    if (/UNIQUE constraint/.test(message)) throw new SessionPreparationUseCaseError(409, 'identity-conflict', 'That session preparation operation already exists.')
    if (/sessionPreparation|command\./.test(message)) throw new SessionPreparationUseCaseError(400, 'invalid-preparation', message)
    throw error
  }
}
export const listSessionPreparationsUseCase = (dependencies: ManageSessionPreparationDependencies = {}) => ({ schemaVersion: 1 as const, preparations: (dependencies.repository ?? createSqliteGmSessionPreparationRepository()).list().map(projectSessionPreparationForLibrary) })
export const getSessionPreparationUseCase = (preparationId: string, dependencies: ManageSessionPreparationDependencies = {}) => ({ schemaVersion: 1 as const, preparation: currentOrFail(dependencies.repository ?? createSqliteGmSessionPreparationRepository(), preparationId) })
