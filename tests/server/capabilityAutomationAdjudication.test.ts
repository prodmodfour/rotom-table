import { afterEach, describe, expect, it } from 'vitest'
import { buildCapabilityClientCapabilityBundle } from '../../server/domain/capabilityAutomation/clientCapabilities'
import { executeCapabilityActionUseCase } from '../../server/useCases/executeCapabilityAction'
import { resolveCapabilityAdjudicationUseCase } from '../../server/useCases/resolveCapabilityAdjudication'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteCapabilityAdjudicationRepository } from '../../server/storage/capabilityAdjudicationRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const sheet: CharacterSheet = {
  slug: 'actor-sheet', name: 'Actor', species: 'Pikachu', level: 10, revision: 2,
  capabilities: { other: ['Sprouter'] },
}
const sourceMap: TabletopMap = {
  schemaVersion: 2, id: 'map', slug: 'arena', name: 'Arena', revision: 5, updatedAt: 100,
  dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, voxels: [], metadata: {
    capabilityContexts: ['plant-or-planted-berry'],
  }, placements: [{
    id: 'actor', sheetKind: 'pokemon', sheetSlug: sheet.slug, position: { x: 1, y: 1, z: 1 },
  }],
} as TabletopMap
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:' }); databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(sourceMap)
  sheetRepository.saveSetupSheet('pokemon', sheet.slug, sheet as unknown as Record<string, unknown>)
  const now = 1_000
  const offer = buildCapabilityClientCapabilityBundle({
    role: 'gm', map: mapRepository.getBySlug('arena')!, mapRevision: 5,
    pokemonSheets: [sheet], trainerSheets: [], now,
  }).placements[0]!.offers.find(candidate => candidate.actionId === 'sprout')!
  const command = {
    schemaVersion: 1, operationId: 'adjudication-request', mapSlug: 'arena', baseRevision: 5,
    offerId: offer.offerId, actorPlacementId: 'actor', capabilityInstanceId: offer.capabilityInstanceId,
    canonicalId: 'Sprouter', actionId: 'sprout', selections: {
      targetPlacementIds: [], cells: [{ x: 2, y: 0, z: 2 }], optionId: null, recipientTrainerSlug: null,
      canonicalItemId: null, description: null, gmConfirmed: false,
    },
  }
  const shared = { database, mapRepository, sheetRepository, publishPersistedRealtimeEvent: () => {} }
  return { database, mapRepository, sheetRepository, command, shared, now }
}

describe('durable Capability GM adjudication', () => {
  it('persists a hash-bound request and resumes one accepted atomic resolution', () => {
    const { command, shared, mapRepository, now } = setup()
    const pending = executeCapabilityActionUseCase({ role: 'gm', command }, { ...shared, now: () => now })
    expect(pending).toMatchObject({ outcome: 'adjudication-required', mapRevision: 6, changedMap: true })
    expect(mapRepository.getBySlug('arena')?.encounterState?.capabilityRuntime?.pendingAdjudications).toContainEqual(expect.objectContaining({
      requestId: 'adjudication-request', canonicalId: 'Sprouter', actionId: 'sprout',
    }))
    const resolveCommand = {
      schemaVersion: 1, operationId: 'adjudication-resolution', requestId: 'adjudication-request',
      mapSlug: 'arena', baseRevision: 6, decision: 'accept', optionId: 'growth',
      description: 'The selected plant blooms and grows one metre.',
    }
    const accepted = resolveCapabilityAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      ...shared, now: () => now + 10,
    })
    expect(accepted).toMatchObject({
      decision: 'accept', mapRevision: 7,
      resolution: { outcome: 'applied', reasonCode: 'capability.bounded-adjudication-accepted' },
    })
    expect(mapRepository.getBySlug('arena')?.metadata?.capabilityWorldChanges).toContainEqual(expect.objectContaining({
      canonicalId: 'Sprouter', description: 'The selected plant blooms and grows one metre.',
    }))
    expect(resolveCapabilityAdjudicationUseCase({ role: 'gm', command: resolveCommand }, { ...shared, now: () => now + 20 })).toEqual(accepted)
    expect(() => resolveCapabilityAdjudicationUseCase({
      role: 'gm',
      command: { ...resolveCommand, description: 'Changed replay input.' },
    }, { ...shared, now: () => now + 20 })).toThrow(/reused with changed input/i)
  })

  it('rejects a pending request without executing its mechanic and replays the exact terminal result', () => {
    const { command, shared, mapRepository, now } = setup()
    executeCapabilityActionUseCase({ role: 'gm', command }, { ...shared, now: () => now })
    const rejectCommand = {
      schemaVersion: 1, operationId: 'adjudication-rejection', requestId: 'adjudication-request',
      mapSlug: 'arena', baseRevision: 6, decision: 'reject', optionId: null, description: null,
    } as const
    const rejected = resolveCapabilityAdjudicationUseCase({ role: 'gm', command: rejectCommand }, {
      ...shared, now: () => now + 10,
    })
    expect(rejected).toMatchObject({ decision: 'reject', resolution: null, mapRevision: 7 })
    expect(mapRepository.getBySlug('arena')?.metadata?.capabilityWorldChanges).toBeUndefined()

    const revisionSeven = mapRepository.getBySlug('arena')!
    expect(mapRepository.applyLivePlayUpdate({
      slug: 'arena', expectedRevision: 7,
      nextMap: { ...revisionSeven, name: 'Advanced Arena', revision: 8, updatedAt: now + 15 },
    })).toBe('applied')
    expect(resolveCapabilityAdjudicationUseCase({ role: 'gm', command: rejectCommand }, {
      ...shared, now: () => now + 20,
    })).toEqual(rejected)

    expect(() => resolveCapabilityAdjudicationUseCase({ role: 'gm', command: {
      ...rejectCommand, baseRevision: 7, decision: 'accept', optionId: 'changed', description: 'Changed replay.',
    } }, { ...shared, now: () => now + 20 })).toThrow(/reused with changed input/i)
  })

  it('durably expires stale adjudications and removes their bounded map summaries', () => {
    const { command, shared, mapRepository, database, now } = setup()
    executeCapabilityActionUseCase({ role: 'gm', command }, { ...shared, now: () => now })
    const resolveCommand = {
      schemaVersion: 1, operationId: 'adjudication-expiry', requestId: 'adjudication-request',
      mapSlug: 'arena', baseRevision: 6, decision: 'reject', optionId: null, description: null,
    }
    expect(() => resolveCapabilityAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      ...shared, now: () => now + 24 * 60 * 60_000,
    })).toThrow(/expired/i)
    expect(mapRepository.getBySlug('arena')?.encounterState?.capabilityRuntime?.pendingAdjudications).toEqual([])
    expect(createSqliteCapabilityAdjudicationRepository(database).find('adjudication-request')).toMatchObject({
      status: 'expired', resolutionOperationId: 'adjudication-expiry',
    })
    expect(() => resolveCapabilityAdjudicationUseCase({ role: 'gm', command: resolveCommand }, {
      ...shared, now: () => now + 24 * 60 * 60_000 + 1,
    })).toThrow(/expired/i)
  })
})
