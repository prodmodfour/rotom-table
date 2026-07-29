import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { reconcileCapabilityRuntimeSourceLoss } from '../../server/domain/capabilityAutomation/sourceLoss'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import { redactRealtimeEventForPrincipal } from '../../server/realtime/realtimeEventRedaction'
import { createSqliteRealtimeEventAccessDependencies } from '../../server/realtime/sqliteRealtimeEventAccessAdapter'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadLiveTableSnapshotUseCase } from '../../server/useCases/loadLiveTableSnapshot'
import { CapabilitySourceLossLoadConflictError } from '../../server/useCases/persistCapabilitySourceLossOnLoad'

const actorPlacement: SheetPlacement = {
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'actor-sheet',
  position: { x: 1, y: 0, z: 1 },
}
const partnerPlacement: SheetPlacement = {
  id: 'partner-token',
  sheetKind: 'pokemon',
  sheetSlug: 'partner-sheet',
  position: { x: 2, y: 0, z: 1 },
}
const actorWithSources = (revision = 1): CharacterSheet => ({
  slug: actorPlacement.sheetSlug,
  nickname: 'Source Actor',
  species: 'Pikachu',
  level: 30,
  revision,
  updatedAt: revision * 100,
  capabilities: { other: ['Inflatable', 'Illusionist', 'As One', 'Magnetic'] },
})
const actorWithoutSources = (revision = 2): CharacterSheet => ({
  ...actorWithSources(revision),
  capabilities: { other: [] },
})
const partnerSheet: CharacterSheet = {
  slug: partnerPlacement.sheetSlug,
  nickname: 'Partner',
  species: 'Ponyta',
  level: 20,
  revision: 1,
  updatedAt: 100,
}

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'source-loss-arena',
  name: 'Source Loss Arena',
  folder: '',
  revision: 5,
  createdAt: 50,
  updatedAt: 100,
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  placements: [actorPlacement, partnerPlacement],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: createEmptyEncounterState(),
  ...overrides,
})

const modeEffect = (id: string, operationId: string) => parseEncounterEffect({
  id,
  kind: 'numeric-modifier',
  source: {
    operationId,
    moveId: 'capability.inflatable',
    placementId: actorPlacement.id,
  },
  affected: { placementIds: [actorPlacement.id], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'permanent', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['capability-mode', 'capability-mode.inflated'],
  payload: { attribute: 'evasion', operation: 'add', value: -1, rounding: 'none' },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const sourceInstances = (map: TabletopMap, actor = actorWithSources()) => {
  const sheets = {
    pokemon: new Map([[actor.slug, actor], [partnerSheet.slug, partnerSheet]]),
    trainer: new Map(),
  }
  const instances = resolveEffectiveCapabilities({
    map,
    placement: actorPlacement,
    sheet: actor,
    sheets,
  }).instances
  const id = (canonicalId: string): string => {
    const instance = instances.find(candidate => candidate.canonicalId === canonicalId)
    if (!instance) throw new Error(`Missing test Capability ${canonicalId}.`)
    return instance.instanceId
  }
  return { sheets, id }
}

const mapWithSourceOwnedState = (): TabletopMap => {
  const map = baseMap()
  const { id } = sourceInstances(map)
  const encounter = createEmptyEncounterState()
  return baseMap({
    metadata: {
      capabilityPrivateNotices: [{
        id: 'private-source-loss-sentinel',
        summary: 'must remain server-only',
      }],
      capabilityIllusions: [{
        id: 'old-illusion',
        ownerPlacementId: actorPlacement.id,
        position: { x: 3, y: 0, z: 1 },
        description: 'old image',
        sourceOperationId: 'operation-old-illusion',
      }],
      capabilityObjects: [{
        id: 'old-magnetic-object',
        position: { x: 1, y: 0, z: 1 },
        material: 'iron',
        attachedToPlacementId: actorPlacement.id,
        attachedCapabilityInstanceId: id('Magnetic'),
      }],
    },
    encounterState: {
      ...encounter,
      effects: [modeEffect('old-inflated-mode', 'operation-old-inflated')],
      capabilityRuntime: {
        ...encounter.capabilityRuntime!,
        modes: [{
          id: 'old-inflated-mode',
          actorPlacementId: actorPlacement.id,
          capabilityInstanceId: id('Inflatable'),
          canonicalId: 'Inflatable',
          mode: 'inflated',
          description: null,
          configurationId: null,
          activatedAt: 90,
          expiresAt: null,
          sourceOperationId: 'operation-old-inflated',
        }, {
          id: 'old-illusion-mode',
          actorPlacementId: actorPlacement.id,
          capabilityInstanceId: id('Illusionist'),
          canonicalId: 'Illusionist',
          mode: 'illusion',
          description: 'old image',
          configurationId: 'motion:minor',
          activatedAt: 90,
          expiresAt: null,
          sourceOperationId: 'operation-old-illusion',
        }],
        links: [{
          id: 'old-as-one-link',
          kind: 'as-one-mount',
          ownerPlacementId: actorPlacement.id,
          participantPlacementIds: [partnerPlacement.id],
          capabilityInstanceId: id('As One'),
          canonicalId: 'As One',
          establishedAt: 90,
          configurationId: 'Run Away',
          sourceOperationId: 'operation-old-link',
        }],
      },
    },
  })
}

let databases: RotomDatabase[] = []
const db = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('Capability source-loss durability', () => {
  it('removes only missing exact source instances and preserves unrelated exact authority', () => {
    const map = baseMap()
    const { sheets, id } = sourceInstances(map)
    const encounter = createEmptyEncounterState()
    const runtimeMap = baseMap({
      metadata: {
        capabilityIllusions: [{
          id: 'valid-illusion', ownerPlacementId: actorPlacement.id,
          sourceOperationId: 'operation-valid-illusion', description: 'valid',
        }, {
          id: 'stale-illusion', ownerPlacementId: actorPlacement.id,
          sourceOperationId: 'operation-stale-illusion', description: 'stale',
        }],
        capabilityObjects: [{
          id: 'valid-attachment', attachedToPlacementId: actorPlacement.id,
          attachedCapabilityInstanceId: id('Magnetic'), material: 'iron',
        }, {
          id: 'stale-attachment', attachedToPlacementId: actorPlacement.id,
          attachedCapabilityInstanceId: `${id('Magnetic')}:old`, material: 'iron',
        }],
      },
      encounterState: {
        ...encounter,
        effects: [
          modeEffect('valid-inflated', 'operation-valid-inflated'),
          modeEffect('stale-inflated', 'operation-stale-inflated'),
        ],
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'valid-inflated', actorPlacementId: actorPlacement.id,
            capabilityInstanceId: id('Inflatable'), canonicalId: 'Inflatable', mode: 'inflated',
            description: null, configurationId: null, activatedAt: 10, expiresAt: null,
            sourceOperationId: 'operation-valid-inflated',
          }, {
            id: 'stale-inflated', actorPlacementId: actorPlacement.id,
            capabilityInstanceId: `${id('Inflatable')}:old`, canonicalId: 'Inflatable', mode: 'inflated',
            description: null, configurationId: null, activatedAt: 10, expiresAt: null,
            sourceOperationId: 'operation-stale-inflated',
          }, {
            id: 'valid-illusion-mode', actorPlacementId: actorPlacement.id,
            capabilityInstanceId: id('Illusionist'), canonicalId: 'Illusionist', mode: 'illusion',
            description: 'valid', configurationId: null, activatedAt: 10, expiresAt: null,
            sourceOperationId: 'operation-valid-illusion',
          }, {
            id: 'stale-illusion-mode', actorPlacementId: actorPlacement.id,
            capabilityInstanceId: `${id('Illusionist')}:old`, canonicalId: 'Illusionist', mode: 'illusion',
            description: 'stale', configurationId: null, activatedAt: 10, expiresAt: null,
            sourceOperationId: 'operation-stale-illusion',
          }],
          links: [{
            id: 'valid-link', kind: 'as-one-mount', ownerPlacementId: actorPlacement.id,
            participantPlacementIds: [partnerPlacement.id], capabilityInstanceId: id('As One'),
            canonicalId: 'As One', establishedAt: 10, configurationId: null,
            sourceOperationId: 'operation-valid-link',
          }, {
            id: 'stale-link', kind: 'as-one-mount', ownerPlacementId: actorPlacement.id,
            participantPlacementIds: [partnerPlacement.id], capabilityInstanceId: `${id('As One')}:old`,
            canonicalId: 'As One', establishedAt: 10, configurationId: null,
            sourceOperationId: 'operation-stale-link',
          }],
        },
      },
    })

    const reconciled = reconcileCapabilityRuntimeSourceLoss({ map: runtimeMap, sheets })

    expect(reconciled.encounterState?.capabilityRuntime?.modes.map(mode => mode.id)).toEqual([
      'valid-inflated',
      'valid-illusion-mode',
    ])
    expect(reconciled.encounterState?.capabilityRuntime?.links.map(link => link.id)).toEqual(['valid-link'])
    expect(reconciled.encounterState?.effects.map(effect => effect.id)).toEqual(['valid-inflated'])
    expect(reconciled.metadata?.capabilityIllusions).toEqual([
      expect.objectContaining({ id: 'valid-illusion', sourceOperationId: 'operation-valid-illusion' }),
    ])
    expect(reconciled.metadata?.capabilityObjects).toEqual([
      expect.objectContaining({
        id: 'valid-attachment',
        attachedToPlacementId: actorPlacement.id,
        attachedCapabilityInstanceId: id('Magnetic'),
      }),
      expect.objectContaining({
        id: 'stale-attachment',
        attachedToPlacementId: null,
        attachedCapabilityInstanceId: null,
      }),
    ])
  })

  it('durably closes source loss on load so regaining the same source cannot resurrect old state', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    const sourceMap = mapWithSourceOwnedState()
    const originalInstanceIds = sourceInstances(sourceMap).id

    maps.saveSetupMap(sourceMap)
    modes.set({
      slug: sourceMap.slug,
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 100,
    })
    sheets.saveSetupSheet('pokemon', actorPlacement.sheetSlug, actorWithSources() as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', partnerPlacement.sheetSlug, partnerSheet as unknown as Record<string, unknown>)
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: actorPlacement.sheetSlug,
      expectedRevision: 1,
      nextSheet: actorWithoutSources() as unknown as Record<string, unknown>,
    })).toBe('applied')

    const lostSnapshot = loadLiveTableSnapshotUseCase({
      role: 'player',
      slug: sourceMap.slug,
    }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 300,
      publishPersistedRealtimeEvent: publish,
    })

    expect(lostSnapshot.mapRevision).toBe(6)
    expect(lostSnapshot.map.revision).toBe(6)
    expect(JSON.stringify(lostSnapshot)).not.toContain('operation-old-illusion')
    expect(JSON.stringify(lostSnapshot)).not.toContain('private-source-loss-sentinel')
    expect(JSON.stringify(lostSnapshot)).not.toContain('capabilityObjects')
    const persistedAfterLoss = maps.getBySlug(sourceMap.slug)!
    expect(persistedAfterLoss).toMatchObject({ revision: 6, updatedAt: 300 })
    expect(persistedAfterLoss.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(persistedAfterLoss.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(persistedAfterLoss.encounterState?.effects).toEqual([])
    expect(persistedAfterLoss.metadata?.capabilityIllusions).toEqual([])
    expect(persistedAfterLoss.metadata?.capabilityObjects).toEqual([
      expect.objectContaining({
        id: 'old-magnetic-object',
        attachedToPlacementId: null,
        attachedCapabilityInstanceId: null,
      }),
    ])

    const replay = realtime.readAfter({ afterSequence: 0, limit: 100 })
    expect(replay.events).toHaveLength(2)
    const replayedMap = replay.events.find(record => {
      const document = record.event.data as Record<string, unknown> | undefined
      return document?.slug === sourceMap.slug && document.revision === 6
        && Array.isArray(document.placements)
    })
    expect(replayedMap).toBeDefined()
    expect(JSON.stringify(replayedMap)).toContain('private-source-loss-sentinel')
    const playerReplay = redactRealtimeEventForPrincipal(
      replayedMap!.event,
      { role: 'player' },
      createSqliteRealtimeEventAccessDependencies({ database, mapRepository: maps, sheetRepository: sheets }),
    )
    expect(JSON.stringify(playerReplay)).not.toContain('private-source-loss-sentinel')
    expect(JSON.stringify(playerReplay)).not.toContain('capabilityObjects')
    expect(publish).toHaveBeenCalledTimes(2)

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: actorPlacement.sheetSlug,
      expectedRevision: 2,
      nextSheet: actorWithSources(3) as unknown as Record<string, unknown>,
    })).toBe('applied')
    const regainedSheet = sheets.getByRef('pokemon', actorPlacement.sheetSlug)!.sheet as unknown as CharacterSheet
    const regainedInstances = sourceInstances(persistedAfterLoss, regainedSheet).id
    expect(regainedInstances('Inflatable')).toBe(originalInstanceIds('Inflatable'))
    expect(regainedInstances('Illusionist')).toBe(originalInstanceIds('Illusionist'))
    expect(regainedInstances('As One')).toBe(originalInstanceIds('As One'))
    expect(regainedInstances('Magnetic')).toBe(originalInstanceIds('Magnetic'))

    const regainedSnapshot = loadLiveTableSnapshotUseCase({
      role: 'player',
      slug: sourceMap.slug,
    }, {
      database,
      mapRepository: maps,
      modeRepository: modes,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 400,
      publishPersistedRealtimeEvent: publish,
    })

    expect(regainedSnapshot.mapRevision).toBe(6)
    expect(regainedSnapshot.map.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(regainedSnapshot.map.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(regainedSnapshot.map.encounterState?.effects).toEqual([])
    expect(regainedSnapshot.map.metadata?.capabilityIllusions).toBeUndefined()
    expect(regainedSnapshot.map.metadata?.capabilityObjects).toBeUndefined()
    const persistedAfterRegain = maps.getBySlug(sourceMap.slug)!
    expect(persistedAfterRegain).toMatchObject({ revision: 6, updatedAt: 300 })
    expect(persistedAfterRegain.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(persistedAfterRegain.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(persistedAfterRegain.encounterState?.effects).toEqual([])
    expect(persistedAfterRegain.metadata?.capabilityIllusions).toEqual([])
    expect(persistedAfterRegain.metadata?.capabilityObjects).toEqual([
      expect.objectContaining({
        id: 'old-magnetic-object',
        attachedToPlacementId: null,
        attachedCapabilityInstanceId: null,
      }),
    ])
    expect(realtime.readAfter({ afterSequence: 0, limit: 100 }).events).toHaveLength(2)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the load-time map CAS loses a race', () => {
    const database = db()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    const sourceMap = mapWithSourceOwnedState()
    maps.saveSetupMap(sourceMap)
    modes.set({
      slug: sourceMap.slug,
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 100,
    })
    sheets.saveSetupSheet('pokemon', actorPlacement.sheetSlug, actorWithoutSources(2) as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', partnerPlacement.sheetSlug, partnerSheet as unknown as Record<string, unknown>)
    const racingMaps = {
      get: maps.get,
      list: maps.list,
      getBySlug: maps.getBySlug,
      applyLivePlayUpdate: vi.fn(() => 'stale' as const),
    }

    expect(() => loadLiveTableSnapshotUseCase({
      role: 'gm',
      slug: sourceMap.slug,
    }, {
      database,
      mapRepository: racingMaps,
      modeRepository: modes,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 300,
      publishPersistedRealtimeEvent: publish,
    })).toThrow(CapabilitySourceLossLoadConflictError)

    expect(racingMaps.applyLivePlayUpdate).toHaveBeenCalledOnce()
    expect(maps.getBySlug(sourceMap.slug)).toMatchObject({
      revision: 5,
      encounterState: {
        capabilityRuntime: {
          modes: expect.arrayContaining([expect.objectContaining({ id: 'old-inflated-mode' })]),
        },
      },
    })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })
})
