import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { LATEST_STORAGE_SCHEMA_VERSION, getStorageSchemaVersion } from '../../server/storage/migrations'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import { createSqliteEncounterDirectorOperationRepository } from '../../server/storage/encounterDirectorOperationRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import {
  applyEncounterDirectorCommandUseCase,
  exportEncounterDocumentUseCase,
  initializeEncounterDocumentUseCase,
} from '../../server/useCases/encounterDocuments'
import { createEncounterDocument } from '../../shared/encounterDocuments/model'
import { parseEncounterDocumentExport } from '../../shared/encounterDocuments/export'
import { ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES } from '../../shared/realtime'
import { createItemChoiceMap, ITEM_CHOICE_TARGET_ID } from '../fixtures/moveAutomation/itemChoices'
import type { TabletopMap } from '~/types/map'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const runtime = () => {
  database = openRotomDatabase({ path: ':memory:', enableWal: false })
  const encounters = createSqliteEncounterDocumentRepository(database)
  const operations = createSqliteEncounterDirectorOperationRepository(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const realtimeEvents = createSqliteRealtimeEventRepository({ database, clock: () => 200 })
  const published: unknown[] = []
  maps.saveSetupMap({ ...createItemChoiceMap(), revision: 0, updatedAt: 100 })
  return {
    database, encounters, operations, maps, realtimeEvents, published, now: () => 200,
    publishPersistedRealtimeEvent: (event: unknown) => { published.push(event) },
  }
}

describe('encounter document SQLite authority', () => {
  it('migrates, stores, lists, reloads, and CAS-replaces strict documents', () => {
    const dependencies = runtime()
    expect(getStorageSchemaVersion(dependencies.database.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    const document = createEncounterDocument({
      encounterId: 'sqlite-ambush', name: 'SQLite ambush', linkedMapSlug: createItemChoiceMap().slug, now: 100,
    })
    expect(dependencies.encounters.create(document)).toEqual(document)
    expect(dependencies.encounters.get(document.encounterId)).toEqual(document)
    expect(dependencies.encounters.findByMapSlug(document.linkedMapSlug)?.encounterId).toBe(document.encounterId)
    expect(() => dependencies.encounters.replace({ expectedRevision: 1, document: { ...document, revision: 1, updatedAt: 101 } }))
      .toThrow('changed before')
    expect(dependencies.encounters.replace({ expectedRevision: 0, document: { ...document, revision: 1, updatedAt: 101 } })?.revision).toBe(1)
  })

  it('initializes from a battlefield and replays an identical Director command exactly once', () => {
    const dependencies = runtime()
    const document = initializeEncounterDocumentUseCase({
      encounterId: 'sqlite-director',
      mapSlug: createItemChoiceMap().slug,
      name: 'SQLite Director',
      recipe: 'ambush',
    }, dependencies)
    const command = {
      schemaVersion: 1,
      commandId: 'director-hide-target',
      encounterId: document.encounterId,
      baseRevision: document.revision,
      type: 'set-participant-visibility',
      payload: { participantId: ITEM_CHOICE_TARGET_ID, visibility: 'hidden' },
    }
    const accepted = applyEncounterDirectorCommandUseCase(command, dependencies)
    const replay = applyEncounterDirectorCommandUseCase(command, dependencies)
    expect(accepted).toEqual(replay)
    expect(accepted.revision).toBe(1)
    expect(accepted.document.hiddenParticipantIds).toEqual([ITEM_CHOICE_TARGET_ID])
    expect(dependencies.operations.get(command.commandId)?.result.revision).toBe(1)
    const realtime = dependencies.realtimeEvents.readAfter({ afterSequence: 0 }).events
    expect(realtime).toHaveLength(4)
    expect(realtime.map(event => event.event.type)).toEqual([
      ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.CREATED,
      ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.CREATED,
      ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.UPDATED,
      ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.UPDATED,
    ])
    expect(realtime.map(event => event.event.channel)).toEqual([
      'encounter:sqlite-director', 'encounters', 'encounter:sqlite-director', 'encounters',
    ])
    expect(realtime.every(event => event.access.kind === 'map-access')).toBe(true)
    expect(JSON.stringify(realtime)).not.toContain(ITEM_CHOICE_TARGET_ID)
    expect(dependencies.published).toHaveLength(4)
    expect(() => applyEncounterDirectorCommandUseCase({
      ...command,
      payload: { participantId: ITEM_CHOICE_TARGET_ID, visibility: 'revealed' },
    }, dependencies)).toThrow('different intent')
  })

  it('rolls back document and operation revisions when durable encounter realtime append fails', () => {
    const dependencies = runtime()
    const document = dependencies.encounters.create(createEncounterDocument({
      encounterId: 'atomic-director', name: 'Atomic Director', linkedMapSlug: createItemChoiceMap().slug, now: 100,
    }))
    const command = {
      schemaVersion: 1,
      commandId: 'director-atomic-failure',
      encounterId: document.encounterId,
      baseRevision: 0,
      type: 'set-participant-visibility',
      payload: { participantId: ITEM_CHOICE_TARGET_ID, visibility: 'hidden' },
    }
    expect(() => applyEncounterDirectorCommandUseCase(command, {
      ...dependencies,
      realtimeEvents: { database: dependencies.database, appendMany: () => { throw new Error('event append failed') } },
    })).toThrow('event append failed')
    expect(dependencies.encounters.get(document.encounterId)).toEqual(document)
    expect(dependencies.operations.get(command.commandId)).toBeNull()
  })

  it('exports a strict digest-bound private backup without changing authority', () => {
    const dependencies = runtime()
    const document = dependencies.encounters.create(createEncounterDocument({
      encounterId: 'export-director', name: 'Export Director', linkedMapSlug: createItemChoiceMap().slug, now: 100,
    }))
    const exported = exportEncounterDocumentUseCase(document.encounterId, dependencies)
    expect(parseEncounterDocumentExport(exported)).toEqual(exported)
    expect(exported).toMatchObject({
      schemaVersion: 1, format: 'rotom-table.encounter-document', exportedAt: 200, document,
    })
    expect(exported.documentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(dependencies.encounters.get(document.encounterId)).toEqual(document)
  })
})
