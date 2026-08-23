import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand } from '#shared/itemAutomation/equipmentActions'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteEquipmentActionOperationRepository } from '~~/server/storage/equipmentActionOperationRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'
import { activeEquipmentState } from '../fixtures/equipment'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const fixture = (
  canonicalItemId: 'Light Shield' | 'Heavy Shield' = 'Light Shield',
  path = ':memory:',
) => {
  database = openRotomDatabase({ path, enableWal: false })
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: 'equipment-action-use-case', name: 'Equipment Action Use Case', revision: 4,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [],
    placements: [{
      id: 'shield-actor', sheetKind: 'trainer', sheetSlug: 'shield-trainer',
      position: { x: 1, y: 0, z: 1 },
    }],
    encounterState: createEmptyEncounterState(),
  }
  const trainer: TrainerSheet = {
    slug: 'shield-trainer', name: 'Shield Trainer', revision: 2, updatedAt: 10,
    level: 20, currentHp: 50, skillBackground: { adept: 'combat' },
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'shield-trainer', slotId: 'offHand', canonicalItemId,
    }),
  }
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.save({ slug: map.slug, document: map, revision: 4, updatedAt: 10 })
  sheetRepository.save({ kind: 'trainer', slug: trainer.slug, document: trainer, revision: 2, updatedAt: 10 })
  const actionId = canonicalItemId === 'Light Shield'
    ? 'equipment.light-shield.ready' as const
    : 'equipment.heavy-shield.ready' as const
  const offer = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 4, pokemonSheets: [], trainerSheets: [trainer], generatedAt: 20,
  }).offers.find(candidate => candidate.intent.actionId === actionId)!
  const source = createEncounterEquipmentGrantQueries({
    map,
    sheets: [{ kind: 'trainer', slug: trainer.slug, sheet: trainer }],
  }).resolve('shield-actor')!.active.find(entry => (
    entry.grant.kind === 'action' && entry.grant.actionId === actionId
  ))!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: `equipment-action-use-case-${canonicalItemId.toLowerCase().replaceAll(' ', '-')}`,
    offerId: offer.offerId,
    mapSlug: map.slug,
    baseRevision: 4,
    actorPlacementId: 'shield-actor',
    actionId,
    equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null,
    targetEquipmentInstanceRevision: null,
    targetPlacementIds: [], cells: [], inventorySourceInstanceId: null, skillCheckId: null, gmAdjudication: null,
  })
  return { database, mapRepository, command }
}

describe('authoritative equipment action use case', () => {
  it.each(['Light Shield', 'Heavy Shield'] as const)(
    'atomically commits %s effects and returns an exact replay without reapplying',
    (canonicalItemId) => {
      const { database, mapRepository, command } = fixture(canonicalItemId)
      const first = executeEquipmentActionUseCase({ role: 'gm', command }, {
        database,
        now: () => 100,
      })
      expect(first).toMatchObject({ status: 'accepted', exactReplay: false, mapRevision: 5 })
      expect(mapRepository.getBySlug(command.mapSlug)?.encounterState?.effects
        .filter(effect => effect.tags.includes('equipment.shield.ready'))).toHaveLength(3)

      const replay = executeEquipmentActionUseCase({ role: 'gm', command }, {
        database,
        now: () => 200,
      })
      expect(replay).toMatchObject({ status: 'accepted', exactReplay: true, mapRevision: 5 })
      expect(mapRepository.getBySlug(command.mapSlug)?.revision).toBe(5)
      expect(createSqliteEquipmentActionOperationRepository(database).listForMap(command.mapSlug))
        .toMatchObject([{ result: { actionId: command.actionId, mapRevision: 5 } }])
    },
  )

  it('rejects operation identity reuse with changed private input', () => {
    const { database, command } = fixture()
    executeEquipmentActionUseCase({ role: 'gm', command }, { database, now: () => 100 })
    expect(() => executeEquipmentActionUseCase({
      role: 'gm',
      command: { ...command, equipmentInstanceRevision: command.equipmentInstanceRevision + 1 },
    }, { database, now: () => 200 })).toThrowError(expect.objectContaining({ statusCode: 409 }))
  })

  it('rejects stale map authority before writing any state', () => {
    const { database, mapRepository, command } = fixture()
    expect(() => executeEquipmentActionUseCase({
      role: 'gm', command: { ...command, baseRevision: 3 },
    }, { database, now: () => 90 })).toThrowError(expect.objectContaining({ statusCode: 409 }))
    expect(mapRepository.getBySlug(command.mapSlug)).toMatchObject({ revision: 4 })
    expect(createSqliteEquipmentActionOperationRepository(database).listForMap(command.mapSlug)).toEqual([])
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it.each(['map', 'operation', 'realtime'] as const)(
    'rolls an interrupted post-%s write fully back before a clean retry',
    (failureBoundary) => {
      const { database, mapRepository, command } = fixture()
      expect(() => executeEquipmentActionUseCase({ role: 'gm', command }, {
        database,
        now: () => 100,
        failAfterWrite: boundary => {
          if (boundary === failureBoundary) throw new Error(`injected equipment ${failureBoundary} failure`)
        },
      })).toThrow(`injected equipment ${failureBoundary} failure`)
      expect(mapRepository.getBySlug(command.mapSlug)).toMatchObject({ revision: 4 })
      expect(mapRepository.getBySlug(command.mapSlug)?.encounterState?.effects).toEqual([])
      expect(createSqliteEquipmentActionOperationRepository(database).listForMap(command.mapSlug)).toEqual([])
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toEqual([])

      expect(executeEquipmentActionUseCase({ role: 'gm', command }, { database, now: () => 101 }))
        .toMatchObject({ exactReplay: false, mapRevision: 5 })
    },
  )

  it('recovers the accepted operation after a database restart without another write or realtime event', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-equipment-restart-'))
    const path = join(directory, 'campaign.sqlite')
    try {
      const seeded = fixture('Heavy Shield', path)
      expect(executeEquipmentActionUseCase({
        role: 'gm', command: seeded.command, clientId: 'shield-client-a',
      }, { database: seeded.database, now: () => 100 })).toMatchObject({ exactReplay: false, mapRevision: 5 })
      const firstEvents = createSqliteRealtimeEventRepository({ database: seeded.database })
        .readAfter({ afterSequence: 0 }).events
      expect(firstEvents).toHaveLength(2)
      expect(firstEvents[0]).toMatchObject({
        event: { channel: 'map:equipment-action-use-case', clientId: 'shield-client-a', revision: 5 },
      })
      seeded.database.close()
      database = null

      database = openRotomDatabase({ path, enableWal: false })
      const replay = executeEquipmentActionUseCase({
        role: 'gm', command: seeded.command, clientId: 'shield-client-b',
      }, { database, now: () => 200 })
      expect(replay).toMatchObject({ exactReplay: true, mapRevision: 5 })
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events)
        .toEqual(firstEvents)
      expect(createSqliteMapRepository<TabletopMap>(database).getBySlug(seeded.command.mapSlug)
        ?.encounterState?.effects.filter(effect => effect.tags.includes('equipment.shield.ready'))).toHaveLength(3)
    }
    finally {
      database?.close()
      database = null
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
