import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand, type EquipmentActionRollV1 } from '#shared/itemAutomation/equipmentActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { reconcileCapabilityRuntimeSourceLoss } from '~~/server/domain/capabilityAutomation/sourceLoss'
import { placementToSpawned } from '~/utils/placement'
import { activeEquipmentState } from '../fixtures/equipment'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'

const setup = (input: { readonly targetX?: number, readonly pullBlocked?: boolean } = {}) => {
  const actor: TrainerSheet = {
    slug: 'weighted-net-actor', name: 'Weighted Net Actor', level: 20, currentHp: 50,
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'weighted-net-actor', slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Weighted Nets',
      configuration: { configurationId: 'equipment.weighted-nets.v1', values: { durabilityMaximum: 50 } },
    }),
  }
  const target: CharacterSheet = {
    slug: 'weighted-net-target', nickname: 'Weighted Net Target', species: 'Pidgey', level: 10,
    combat: { currentHp: 40 }, capabilities: { sky: 6, levitate: 4 },
  }
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'weighted-net-map', name: 'Weighted Net', revision: 9,
    dimensions: { x: 12, y: 4, z: 12 }, playerVisible: true,
    voxels: input.pullBlocked ? [{
      x: 3, y: 0, z: 0, materialId: 'stone', blocksMovement: true, blocksSight: false,
    }] : [],
    placements: [
      { id: 'weighted-net-actor-token', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 0, y: 0, z: 0 } },
      { id: 'weighted-net-target-token', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: input.targetX ?? 4, y: 0, z: 0 } },
    ],
    encounterState: createEmptyEncounterState(),
  }
  const sheets = [
    { kind: 'trainer' as const, slug: actor.slug, sheet: actor },
    { kind: 'pokemon' as const, slug: target.slug, sheet: target },
  ]
  const queries = createEncounterEquipmentGrantQueries({ map, sheets })
  const active = queries.resolve('weighted-net-actor-token')!.active
  const throwSource = active.find(entry => entry.grant.kind === 'action'
    && entry.grant.actionId === 'equipment.weighted-nets.throw')!
  const pullSource = active.find(entry => entry.grant.kind === 'action'
    && entry.grant.actionId === 'equipment.weighted-nets.pull')!
  const projection = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 9, pokemonSheets: [target], trainerSheets: [actor], generatedAt: 100,
  })
  const throwOffer = projection.offers.find(offer => offer.actor.participantId === 'weighted-net-actor-token'
    && offer.intent.actionId === 'equipment.weighted-nets.throw')!
  const pullOffer = projection.offers.find(offer => offer.actor.participantId === 'weighted-net-actor-token'
    && offer.intent.actionId === 'equipment.weighted-nets.pull')!
  const command = (actionId: 'equipment.weighted-nets.throw' | 'equipment.weighted-nets.pull', offerId: string) => {
    const source = actionId.endsWith('.throw') ? throwSource : pullSource
    return parseExecuteEquipmentActionCommand({
      schemaVersion: 1, operationId: `${actionId}-operation`, offerId,
      mapSlug: map.slug, baseRevision: 9, actorPlacementId: 'weighted-net-actor-token', actionId,
      equipmentInstanceId: source.instanceId, equipmentInstanceRevision: source.instanceRevision,
      targetEquipmentInstanceId: null, targetEquipmentInstanceRevision: null,
      targetPlacementIds: ['weighted-net-target-token'], cells: [], inventorySourceInstanceId: null,
      skillCheckId: null, gmAdjudication: null,
    })
  }
  return {
    actor, target, map, queries, throwSource, pullSource, projection, throwOffer, pullOffer,
    throwCommand: command('equipment.weighted-nets.throw', throwOffer.offerId),
    pullCommand: command('equipment.weighted-nets.pull', pullOffer.offerId),
  }
}
const roll = (naturalResult: number): EquipmentActionRollV1 => ({
  rollId: 'weighted-net-roll', expression: '1d20', naturalResult, modifier: 0, total: naturalResult,
})
const executeThrow = (fixture: ReturnType<typeof setup>, natural = 10) => executeDeferredEquipmentActionMechanic({
  command: fixture.throwCommand,
  source: fixture.throwSource,
  map: fixture.map,
  actorPlacement: fixture.map.placements[0]!,
  actorSheet: fixture.actor,
  pokemonSheets: new Map([[fixture.target.slug, fixture.target]]),
  trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
  rollD20: () => roll(natural),
  equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
})
const executePull = (fixture: ReturnType<typeof setup>, map: TabletopMap) => executeDeferredEquipmentActionMechanic({
  command: fixture.pullCommand,
  source: fixture.pullSource,
  map,
  actorPlacement: map.placements[0]!,
  actorSheet: fixture.actor,
  pokemonSheets: new Map([[fixture.target.slug, fixture.target]]),
  trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
  rollD20: () => { throw new Error('Weighted Net pull does not roll.') },
  equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
})

describe('P11-036 native Weighted Net throw and pull', () => {
  it('projects throw first and exposes pull only after this exact source nets a target', () => {
    const fixture = setup()
    expect(fixture.throwOffer).toMatchObject({
      availability: { status: 'available' },
      targeting: [expect.objectContaining({ rangeLabel: 'Within 4 meters', requiresLineOfSight: true })],
    })
    expect(fixture.pullOffer.availability.status).toBe('unavailable')
    const thrown = executeThrow(fixture)
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: thrown.map, mapRevision: 10,
      pokemonSheets: [fixture.target], trainerSheets: [fixture.actor], generatedAt: 101,
    })
    expect(projection.offers.find(offer => offer.intent.actionId === 'equipment.weighted-nets.throw')?.availability.status)
      .toBe('unavailable')
    expect(projection.offers.find(offer => offer.intent.actionId === 'equipment.weighted-nets.pull'))
      .toMatchObject({
        availability: { status: 'available' },
        selectionOptions: [expect.objectContaining({ value: 'weighted-net-target-token' })],
      })
  })

  it('installs netted, Slowed, Sky/Levitate suppression, and capture authority on hit', () => {
    const fixture = setup()
    const thrown = executeThrow(fixture)
    const effects = thrown.map.encounterState?.effects.filter(effect => effect.tags.includes('equipment.weighted-net')) ?? []
    expect(effects).toHaveLength(4)
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'condition', payload: expect.objectContaining({ conditionId: 'slowed' }) }),
      expect.objectContaining({ kind: 'capability', payload: { capabilityId: 'movement.sky', action: 'suppress' } }),
      expect.objectContaining({ kind: 'capability', payload: { capabilityId: 'movement.levitate', action: 'suppress' } }),
      expect.objectContaining({ kind: 'capability', payload: { capabilityId: 'equipment.restraint.netted', action: 'grant' } }),
    ]))
    expect(effects.every(effect => effect.tags.includes('capture-roll-modifier.minus-20'))).toBe(true)
    const token = placementToSpawned(thrown.map.placements[1]!, {
      pokemon: new Map([[fixture.target.slug, fixture.target]]),
      trainer: new Map([[fixture.actor.slug, fixture.actor]]),
    }, thrown.map)!
    expect(token.creatureRules?.capabilityIds).not.toContain('movement.sky')
    expect(token.creatureRules?.capabilityIds).not.toContain('movement.levitate')
  })

  it('projects the unified family and releases every linked effect on exact source loss', () => {
    const fixture = setup()
    const thrown = executeThrow(fixture)
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: thrown.map, mapRevision: 10,
      pokemonSheets: [fixture.target], trainerSheets: [fixture.actor], generatedAt: 101,
    })
    expect(projection.passives.find(passive => passive.source.canonicalId === 'Weighted Nets'
      && passive.participant.participantId === 'weighted-net-target-token')?.facts.map(fact => fact.label))
      .toEqual(expect.arrayContaining(['Netted', 'Slowed', 'Sky and Levitate suppressed', 'Capture rolls −20']))
    const state = fixture.actor.equipmentState!
    const releasedActor: TrainerSheet = {
      ...fixture.actor,
      equipmentState: {
        ...state,
        revision: state.revision + 1,
        slots: state.slots.map(slot => ({ ...slot, instanceId: null })),
        instances: [],
      },
    }
    const released = reconcileCapabilityRuntimeSourceLoss({
      map: thrown.map,
      sheets: {
        pokemon: new Map([[fixture.target.slug, fixture.target]]),
        trainer: new Map([[releasedActor.slug, releasedActor]]),
      },
    })
    expect(released.encounterState?.effects.filter(effect => effect.tags.includes('equipment.weighted-net')))
      .toEqual([])
    const token = placementToSpawned(released.placements[1]!, {
      pokemon: new Map([[fixture.target.slug, fixture.target]]),
      trainer: new Map([[releasedActor.slug, releasedActor]]),
    }, released)!
    expect(token.creatureRules?.capabilityIds).toEqual(expect.arrayContaining(['movement.sky', 'movement.levitate']))
  })

  it('pulls the same-source netted target exactly one meter through forced-movement authority', () => {
    const fixture = setup()
    const thrown = executeThrow(fixture)
    const pulled = executePull(fixture, thrown.map)
    expect(pulled.map.placements.find(placement => placement.id === 'weighted-net-target-token')?.position)
      .toEqual({ x: 3, y: 0, z: 0 })
    expect(pulled.receipts.map(entry => entry.kind)).toEqual([
      'item-declaration', 'forced-movement', 'accepted-result',
    ])
    expect(pulled.map.encounterState?.effects.filter(effect => effect.tags.includes('equipment.weighted-net')))
      .toHaveLength(4)
  })

  it('rejects pull-before-throw, blocked pull, out-of-range throw, and redeployment', () => {
    const before = setup()
    expect(() => executePull(before, before.map))
      .toThrowError(expect.objectContaining({ code: 'weighted-net.target-not-netted-by-source' }))

    const blocked = setup({ pullBlocked: true })
    expect(() => executePull(blocked, executeThrow(blocked).map))
      .toThrowError(expect.objectContaining({ code: 'weighted-net.pull-blocked' }))

    const distant = setup({ targetX: 5 })
    const roller = vi.fn(() => roll(20))
    expect(() => executeDeferredEquipmentActionMechanic({
      command: distant.throwCommand, source: distant.throwSource, map: distant.map,
      actorPlacement: distant.map.placements[0]!, actorSheet: distant.actor,
      pokemonSheets: new Map([[distant.target.slug, distant.target]]),
      trainerSheets: new Map([[distant.actor.slug, distant.actor]]),
      rollD20: roller,
      equipmentGrantsForPlacement: placementId => distant.queries.resolve(placementId),
    })).toThrowError(expect.objectContaining({ code: 'weighted-net.target-out-of-range' }))
    expect(roller).not.toHaveBeenCalled()

    const deployed = setup()
    const thrown = executeThrow(deployed)
    expect(() => executeDeferredEquipmentActionMechanic({
      command: { ...deployed.throwCommand, operationId: 'weighted-net-redeploy' },
      source: deployed.throwSource, map: thrown.map,
      actorPlacement: thrown.map.placements[0]!, actorSheet: deployed.actor,
      pokemonSheets: new Map([[deployed.target.slug, deployed.target]]),
      trainerSheets: new Map([[deployed.actor.slug, deployed.actor]]),
      rollD20: () => roll(20),
      equipmentGrantsForPlacement: placementId => deployed.queries.resolve(placementId),
    })).toThrowError(expect.objectContaining({ code: 'weighted-net.already-deployed' }))
  })

  it('returns exact retries for both throw and pull without a second roll or meter', () => {
    const fixture = setup()
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const maps = createSqliteMapRepository<TabletopMap>(database)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      maps.save({ slug: fixture.map.slug, document: fixture.map, revision: 9, updatedAt: 1 })
      sheets.save({ kind: 'trainer', slug: fixture.actor.slug, document: { ...fixture.actor, revision: 2 }, revision: 2, updatedAt: 1 })
      sheets.save({ kind: 'pokemon', slug: fixture.target.slug, document: { ...fixture.target, revision: 3 }, revision: 3, updatedAt: 1 })
      const randomInt = vi.fn(() => 10)
      const thrown = executeEquipmentActionUseCase({
        role: 'gm', command: fixture.throwCommand, clientId: 'weighted-net-client-a',
      }, {
        database, randomInt, now: () => 10,
      })
      const throwReplay = executeEquipmentActionUseCase({
        role: 'gm', command: fixture.throwCommand, clientId: 'weighted-net-client-b',
      }, {
        database, randomInt, now: () => 11,
      })
      expect(thrown).toMatchObject({ mapRevision: 10, exactReplay: false })
      expect(throwReplay).toMatchObject({ mapRevision: 10, exactReplay: true })
      expect(randomInt).toHaveBeenCalledTimes(1)
      const throwEvents = createSqliteRealtimeEventRepository({ database })
        .readAfter({ afterSequence: 0 }).events
      expect(throwEvents).toHaveLength(2)
      expect(throwEvents[0]).toMatchObject({
        event: {
          channel: 'map:weighted-net-map', clientId: 'weighted-net-client-a', revision: 10,
          data: { encounterState: { effects: expect.arrayContaining([
            expect.objectContaining({ tags: expect.arrayContaining(['equipment.weighted-net']) }),
          ]) } },
        },
      })

      const nettedMap = maps.getBySlug(fixture.map.slug)!
      const pullOffer = buildEncounterPresentationProjection({
        role: 'gm', map: nettedMap, mapRevision: 10,
        pokemonSheets: [{ ...fixture.target, revision: 3 }],
        trainerSheets: [{ ...fixture.actor, revision: 2 }], generatedAt: 12,
      }).offers.find(offer => offer.intent.actionId === 'equipment.weighted-nets.pull')!
      const pullCommand = parseExecuteEquipmentActionCommand({
        ...fixture.pullCommand,
        operationId: 'weighted-net-pull-replay-operation',
        offerId: pullOffer.offerId,
        baseRevision: 10,
      })
      const pulled = executeEquipmentActionUseCase({
        role: 'gm', command: pullCommand, clientId: 'weighted-net-client-b',
      }, {
        database, randomInt, now: () => 20,
      })
      const pullReplay = executeEquipmentActionUseCase({
        role: 'gm', command: pullCommand, clientId: 'weighted-net-client-a',
      }, {
        database, randomInt, now: () => 21,
      })
      expect(pulled).toMatchObject({ mapRevision: 11, exactReplay: false })
      expect(pullReplay).toMatchObject({ mapRevision: 11, exactReplay: true })
      expect(maps.getBySlug(fixture.map.slug)?.placements
        .find(placement => placement.id === 'weighted-net-target-token')?.position).toEqual({ x: 3, y: 0, z: 0 })
      expect(randomInt).toHaveBeenCalledTimes(1)
      const allEvents = createSqliteRealtimeEventRepository({ database })
        .readAfter({ afterSequence: 0 }).events
      expect(allEvents).toHaveLength(4)
      expect(allEvents[2]).toMatchObject({
        event: { channel: 'map:weighted-net-map', clientId: 'weighted-net-client-b', revision: 11 },
      })
    }
    finally { database.close() }
  })

  it('spends no restraint on a miss and leaves pull unavailable', () => {
    const fixture = setup()
    const missed = executeThrow(fixture, 2)
    expect(missed.map.encounterState?.effects).toEqual([])
    expect(missed.receipts).toContainEqual(expect.objectContaining({ reasonCode: 'equipment.weighted-net.miss' }))
  })
})
