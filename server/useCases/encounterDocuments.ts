import { createHash } from 'node:crypto'
import { createError } from 'h3'
import {
  EncounterDirectorCommandError,
  applyEncounterDirectorCommand,
  parseEncounterDirectorCommand,
  type EncounterDirectorCommand,
} from '#shared/encounterDocuments/commands'
import {
  ENCOUNTER_RECIPE_IDS,
  EncounterDocumentValidationError,
  createEncounterDocument,
  type EncounterDocument,
  type EncounterRecipeId,
} from '#shared/encounterDocuments/model'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ENCOUNTER_DOCUMENT_EXPORT_FORMAT,
  ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION,
  parseEncounterDocumentExport,
  type EncounterDocumentExport,
} from '#shared/encounterDocuments/export'
import { createSqliteEncounterDocumentRepository, type EncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import {
  createSqliteEncounterDirectorOperationRepository,
  type EncounterDirectorCommandResult,
  type EncounterDirectorOperationRepository,
} from '../storage/encounterDirectorOperationRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import type { TabletopMap } from '~/types/map'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { encounterDocumentRealtimeAppendInputs } from '../realtime/encounterDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'

export interface InitializeEncounterDocumentInput {
  readonly encounterId: string
  readonly mapSlug: string
  readonly name: string
  readonly recipe: EncounterRecipeId
}

export interface EncounterDocumentUseCaseDependencies {
  readonly database?: RotomDatabase
  readonly encounters?: EncounterDocumentRepository
  readonly operations?: EncounterDirectorOperationRepository
  readonly maps?: Pick<MapRepository<TabletopMap>, 'getBySlug'> & { readonly database?: RotomDatabase }
  readonly realtimeEvents?: Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly sheetExists?: (kind: 'pokemon' | 'trainer', slug: string) => boolean
  readonly now?: () => number
}

function httpFail(statusCode: number, statusMessage: string): never { throw createError({ statusCode, statusMessage }) }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const stableId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value)) httpFail(400, `${label} is invalid.`)
  return value
}
const boundedName = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) httpFail(400, 'Encounter name is invalid.')
  return value.trim()
}

export const parseInitializeEncounterDocumentInput = (value: unknown): InitializeEncounterDocumentInput => {
  if (!isRecord(value) || Object.keys(value).length !== 4
    || !['encounterId', 'mapSlug', 'name', 'recipe'].every(key => Object.prototype.hasOwnProperty.call(value, key))) {
    return httpFail(400, 'Encounter initialization payload is invalid.')
  }
  if (typeof value.recipe !== 'string' || !ENCOUNTER_RECIPE_IDS.includes(value.recipe as EncounterRecipeId)) {
    return httpFail(400, 'Encounter recipe is invalid.')
  }
  return {
    encounterId: stableId(value.encounterId, 'Encounter ID'),
    mapSlug: stableId(value.mapSlug, 'Map slug'),
    name: boundedName(value.name),
    recipe: value.recipe as EncounterRecipeId,
  }
}

const repositories = (dependencies: EncounterDocumentUseCaseDependencies) => {
  const database = dependencies.database
    ?? dependencies.encounters?.database
    ?? dependencies.operations?.database
    ?? dependencies.maps?.database
    ?? dependencies.realtimeEvents?.database
    ?? getRotomDatabase()
  for (const [label, candidate] of [
    ['encounter', dependencies.encounters?.database],
    ['operation', dependencies.operations?.database],
    ['map', dependencies.maps?.database],
    ['realtime event', dependencies.realtimeEvents?.database],
  ] as const) {
    if (candidate && candidate !== database) throw new Error(`${label} repository must share the encounter transaction database.`)
  }
  return {
    database,
    encounters: dependencies.encounters ?? createSqliteEncounterDocumentRepository(database),
    operations: dependencies.operations ?? createSqliteEncounterDirectorOperationRepository(database),
    maps: dependencies.maps ?? createSqliteMapRepository<TabletopMap>(database),
    realtimeEvents: dependencies.realtimeEvents ?? createSqliteRealtimeEventRepository({ database }),
    sheetExists: dependencies.sheetExists ?? ((kind: 'pokemon' | 'trainer', slug: string) => (
      createSqliteSheetRepository<Record<string, unknown>>(database).getByRef(kind, slug) !== null
    )),
  }
}

const publishEncounterEvents = (
  events: readonly PersistedRealtimeEvent[],
  operation: string,
  dependencies: EncounterDocumentUseCaseDependencies,
): void => publishPersistedRealtimeEventsAfterCommit({
  events,
  operation,
  publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
  reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
})

export const initializeEncounterDocumentUseCase = (
  value: unknown,
  dependencies: EncounterDocumentUseCaseDependencies = {},
): EncounterDocument => {
  const input = parseInitializeEncounterDocumentInput(value)
  const runtime = repositories(dependencies)
  const map = runtime.maps.getBySlug(input.mapSlug) ?? httpFail(404, 'Battlefield not found.')
  const existing = runtime.encounters.get(input.encounterId)
  if (existing) {
    if (existing.linkedMapSlug !== input.mapSlug) httpFail(409, 'Encounter ID already belongs to another battlefield.')
    return existing
  }
  const activeForMap = runtime.encounters.findByMapSlug(input.mapSlug)
  if (activeForMap && ['active', 'paused'].includes(activeForMap.lifecycle)) {
    httpFail(409, 'This battlefield already has an active encounter.')
  }
  const timestamp = dependencies.now?.() ?? Date.now()
  let realtimeEvents: readonly PersistedRealtimeEvent[] = []
  const document = runtime.database.withTransaction(() => {
    const concurrent = runtime.encounters.get(input.encounterId)
    if (concurrent) {
      if (concurrent.linkedMapSlug !== input.mapSlug) httpFail(409, 'Encounter ID already belongs to another battlefield.')
      return concurrent
    }
    const concurrentForMap = runtime.encounters.findByMapSlug(input.mapSlug)
    if (concurrentForMap && ['active', 'paused'].includes(concurrentForMap.lifecycle)) {
      httpFail(409, 'This battlefield already has an active encounter.')
    }
    const created = runtime.encounters.create(createEncounterDocument({
      encounterId: input.encounterId,
      name: input.name || map.name,
      linkedMapSlug: input.mapSlug,
      recipe: input.recipe,
      now: timestamp,
    }))
    realtimeEvents = runtime.realtimeEvents.appendMany(encounterDocumentRealtimeAppendInputs({
      document: created,
      kind: 'created',
      previousRevision: null,
      operationId: null,
      timestamp,
    }))
    return created
  })
  publishEncounterEvents(realtimeEvents, 'encounter-document-initialize', dependencies)
  return document
}

const commandHash = (command: EncounterDirectorCommand): string => createHash('sha256')
  .update(stableJsonStringify(command))
  .digest('hex')

const validateCommandReferences = (input: {
  readonly command: EncounterDirectorCommand
  readonly document: EncounterDocument
  readonly map: TabletopMap
  readonly sheetExists?: EncounterDocumentUseCaseDependencies['sheetExists']
}): void => {
  const participantIds = new Set(input.map.placements.map(placement => placement.id))
  const { command } = input
  if (command.type === 'set-participant-visibility' && !participantIds.has(command.payload.participantId)) {
    httpFail(409, 'Participant is no longer present on the linked battlefield.')
  }
  if (command.type === 'upsert-wave' && !command.payload.wave.participantIds.every(id => participantIds.has(id))) {
    httpFail(409, 'Wave references a participant absent from the linked battlefield.')
  }
  if (command.type === 'upsert-reserve') {
    const reserve = command.payload.reserve
    if (reserve.placementId && !participantIds.has(reserve.placementId)) httpFail(409, 'Deployed reserve placement is absent from the linked battlefield.')
    if (input.sheetExists && !input.sheetExists(reserve.sheetKind, reserve.sheetSlug)) httpFail(409, 'Reserve sheet no longer exists.')
  }
}

const commandError = (error: unknown): never => {
  if (error instanceof EncounterDirectorCommandError) {
    const statusCode = error.code === 'not-found' ? 404 : error.code === 'invalid-command' || error.code === 'limit-exceeded' ? 400 : 409
    return httpFail(statusCode, error.message)
  }
  if (error instanceof EncounterDocumentValidationError) return httpFail(400, error.message)
  throw error
}

export const exportEncounterDocumentUseCase = (
  encounterIdValue: unknown,
  dependencies: EncounterDocumentUseCaseDependencies = {},
): EncounterDocumentExport => {
  const encounterId = stableId(encounterIdValue, 'Encounter ID')
  const runtime = repositories(dependencies)
  const document = runtime.encounters.get(encounterId) ?? httpFail(404, 'Encounter document not found.')
  return parseEncounterDocumentExport({
    schemaVersion: ENCOUNTER_DOCUMENT_EXPORT_SCHEMA_VERSION,
    format: ENCOUNTER_DOCUMENT_EXPORT_FORMAT,
    exportedAt: dependencies.now?.() ?? Date.now(),
    documentSha256: createHash('sha256').update(stableJsonStringify(document)).digest('hex'),
    document,
  })
}

export const applyEncounterDirectorCommandUseCase = (
  value: unknown,
  dependencies: EncounterDocumentUseCaseDependencies = {},
): EncounterDirectorCommandResult => {
  let command: EncounterDirectorCommand
  try { command = parseEncounterDirectorCommand(value) }
  catch (error) { return commandError(error) }
  const runtime = repositories(dependencies)
  const hash = commandHash(command)
  const prior = runtime.operations.get(command.commandId)
  if (prior) {
    if (prior.commandSha256 !== hash) httpFail(409, 'Director command ID was already used for different intent.')
    return prior.result
  }
  const document = runtime.encounters.get(command.encounterId) ?? httpFail(404, 'Encounter document not found.')
  const map = runtime.maps.getBySlug(document.linkedMapSlug) ?? httpFail(409, 'Linked battlefield is unavailable.')
  validateCommandReferences({ command, document, map, sheetExists: runtime.sheetExists })
  try {
    let realtimeEvents: readonly PersistedRealtimeEvent[] = []
    let replayedInsideTransaction = false
    const result = runtime.database.withTransaction(() => {
      const concurrentPrior = runtime.operations.get(command.commandId)
      if (concurrentPrior) {
        if (concurrentPrior.commandSha256 !== hash) httpFail(409, 'Director command ID was already used for different intent.')
        replayedInsideTransaction = true
        return concurrentPrior.result
      }
      const current = runtime.encounters.get(command.encounterId) ?? httpFail(404, 'Encounter document not found.')
      const timestamp = dependencies.now?.() ?? Date.now()
      const next = applyEncounterDirectorCommand({ document: current, command, now: timestamp })
      const saved = runtime.encounters.replace({ expectedRevision: command.baseRevision, document: next })
        ?? httpFail(404, 'Encounter document not found.')
      const accepted: EncounterDirectorCommandResult = {
        ok: true,
        encounterId: saved.encounterId,
        revision: saved.revision,
        document: saved,
      }
      runtime.operations.save({
        commandId: command.commandId,
        encounterId: command.encounterId,
        commandSha256: hash,
        command,
        result: accepted,
        createdAt: timestamp,
      })
      realtimeEvents = runtime.realtimeEvents.appendMany(encounterDocumentRealtimeAppendInputs({
        document: saved,
        kind: 'updated',
        previousRevision: current.revision,
        operationId: command.commandId,
        timestamp,
      }))
      return accepted
    })
    if (!replayedInsideTransaction) publishEncounterEvents(realtimeEvents, 'encounter-director-command', dependencies)
    return result
  }
  catch (error) { return commandError(error) }
}
