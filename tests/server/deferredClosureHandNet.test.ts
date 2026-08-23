import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand, type EquipmentActionRollV1 } from '#shared/itemAutomation/equipmentActions'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { reconcileCapabilityRuntimeSourceLoss } from '~~/server/domain/capabilityAutomation/sourceLoss'
import { resolveMovement } from '~~/server/domain/movement/resolveMovement'
import { placementToSpawned } from '~/utils/placement'
import { buildPokeballCaptureBreakdown } from '~/utils/pokeballCapture'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'
import { activeEquipmentState } from '../fixtures/equipment'

const setup = (input: { readonly species?: string, readonly targetX?: number } = {}) => {
  const actor: TrainerSheet = {
    slug: 'hand-net-actor', name: 'Hand Net Actor', level: 20, currentHp: 50,
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'hand-net-actor', slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Hand Net',
      configuration: { configurationId: 'equipment.hand-net.v1', values: { durabilityMaximum: 50 } },
    }),
  }
  const target: CharacterSheet = {
    slug: 'hand-net-target', nickname: 'Hand Net Target', species: input.species ?? 'Pikachu', level: 10,
    combat: { currentHp: 40 },
  }
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'hand-net-map', name: 'Hand Net', revision: 5,
    dimensions: { x: 10, y: 4, z: 10 }, playerVisible: true, voxels: [],
    placements: [
      { id: 'hand-net-actor-token', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 0, y: 0, z: 0 } },
      { id: 'hand-net-target-token', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: input.targetX ?? 1, y: 0, z: 0 } },
    ],
    encounterState: createEmptyEncounterState(),
  }
  const sheets = [
    { kind: 'trainer' as const, slug: actor.slug, sheet: actor },
    { kind: 'pokemon' as const, slug: target.slug, sheet: target },
  ]
  const queries = createEncounterEquipmentGrantQueries({ map, sheets })
  const source = queries.resolve('hand-net-actor-token')!.active.find(entry => (
    entry.grant.kind === 'action' && entry.grant.actionId === 'equipment.hand-net.attack'
  ))!
  const offer = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 5, pokemonSheets: [target], trainerSheets: [actor], generatedAt: 100,
  }).offers.find(candidate => candidate.actor.participantId === 'hand-net-actor-token'
    && candidate.intent.actionId === 'equipment.hand-net.attack')!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1, operationId: 'hand-net-operation', offerId: offer.offerId,
    mapSlug: map.slug, baseRevision: 5, actorPlacementId: 'hand-net-actor-token',
    actionId: 'equipment.hand-net.attack', equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null, targetEquipmentInstanceRevision: null,
    targetPlacementIds: ['hand-net-target-token'], cells: [], inventorySourceInstanceId: null,
    skillCheckId: null, gmAdjudication: null,
  })
  return { actor, target, map, queries, source, offer, command }
}
const roll = (naturalResult: number): EquipmentActionRollV1 => ({
  rollId: 'hand-net-roll', expression: '1d20', naturalResult, modifier: 0, total: naturalResult,
})
const execute = (fixture: ReturnType<typeof setup>, naturalResult: number, roller = vi.fn(() => roll(naturalResult))) => ({
  roller,
  result: executeDeferredEquipmentActionMechanic({
    command: fixture.command,
    source: fixture.source,
    map: fixture.map,
    actorPlacement: fixture.map.placements[0]!,
    actorSheet: fixture.actor,
    pokemonSheets: new Map([[fixture.target.slug, fixture.target]]),
    trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
    rollD20: roller,
    equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
  }),
})

describe('P11-035 native Hand Net attack', () => {
  it('projects only Small Pokémon with melee/LoS targeting from exact two-hand custody', () => {
    const small = setup()
    expect(small.offer).toMatchObject({
      availability: { status: 'available' },
      targeting: [expect.objectContaining({ rangeLabel: 'Melee, 1 meter', relationshipLabel: 'Small Pokémon' })],
      selectionOptions: [expect.objectContaining({ value: 'hand-net-target-token' })],
    })
    const medium = setup({ species: 'Charizard' })
    expect(medium.offer).toMatchObject({
      availability: { status: 'unavailable' },
      selectionOptions: [expect.objectContaining({
        disabled: true,
        description: 'Unavailable; Hand Net requires a Small Pokémon',
        unavailableReason: expect.objectContaining({ code: 'target.invalid' }),
      })],
    })
  })

  it('nets a hit target with typed Trapped/restraint state and a -20 capture marker', () => {
    const { result } = execute(setup(), 10)
    const effects = result.map.encounterState?.effects.filter(effect => effect.tags.includes('equipment.hand-net')) ?? []
    expect(effects).toHaveLength(2)
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: 'equipment.restraint.netted', action: 'grant' },
        duration: { kind: 'until-triggered', remaining: null },
      }),
      expect.objectContaining({
        kind: 'condition', payload: expect.objectContaining({ conditionId: 'trapped' }),
      }),
    ]))
    expect(effects.every(effect => effect.tags.includes('capture-roll-modifier.minus-20'))).toBe(true)
    expect(result.receipts.map(entry => entry.kind)).toEqual([
      'item-declaration', 'accuracy', 'restraint', 'accepted-result',
    ])
  })

  it('feeds the canonical -20 net bonus into authoritative capture breakdowns', () => {
    const fixture = setup()
    const { result } = execute(fixture, 10)
    const lookup = {
      pokemon: new Map([[fixture.target.slug, fixture.target]]),
      trainer: new Map([[fixture.actor.slug, fixture.actor]]),
    }
    const user = placementToSpawned(fixture.map.placements[0]!, lookup, result.map)!
    const target = placementToSpawned(fixture.map.placements[1]!, lookup, result.map)!
    const breakdown = buildPokeballCaptureBreakdown({
      trainer: fixture.actor,
      user,
      target,
      targetSheet: fixture.target,
      pokeball: {
        sourceInstanceId: 'capture-ball-source',
        source: { kind: 'trainer', slug: fixture.actor.slug, section: 'pokeballs', rowId: 'ball-row', expectedRevision: 1 },
        name: 'Basic Ball', quantity: 1, rollModifier: 0, modifierLabel: '+0', description: '', item: null,
      },
      pokemonBySlug: new Map([[fixture.target.slug, fixture.target]]),
      currentRound: 1,
      map: result.map,
    })
    expect(breakdown.rollModifierLines).toContainEqual({ label: 'Netted target', value: -20 })
  })

  it('includes the netted Pokémon in authoritative wielder co-movement', () => {
    const fixture = setup()
    const { result } = execute(fixture, 10)
    const movement = resolveMovement({
      map: result.map,
      sheets: {
        pokemon: new Map([[fixture.target.slug, fixture.target]]),
        trainer: new Map([[fixture.actor.slug, fixture.actor]]),
      },
      placementId: 'hand-net-actor-token',
      mode: 'shift',
      destination: { x: 2, y: 0, z: 0 },
    })
    expect(movement).toMatchObject({
      ok: true,
      linkedCompanionPlacementIds: ['hand-net-target-token'],
    })
  })

  it('projects role-safe restraint facts and clears the whole family on release or partial condition cleanup', () => {
    const fixture = setup()
    const accepted = execute(fixture, 10).result
    const projection = buildEncounterPresentationProjection({
      role: 'player', map: accepted.map, mapRevision: 6,
      pokemonSheets: [fixture.target], trainerSheets: [fixture.actor], generatedAt: 101,
    })
    const restraint = projection.passives.find(passive => passive.source.canonicalId === 'Hand Net'
      && passive.participant.participantId === 'hand-net-target-token')
    expect(restraint?.facts.map(fact => fact.label)).toEqual(expect.arrayContaining([
      'Netted', 'Capture rolls −20', 'Trapped; moves with the net wielder',
    ]))
    expect(JSON.stringify(restraint)).not.toContain(fixture.source.instanceId)

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
      map: accepted.map,
      sheets: {
        pokemon: new Map([[fixture.target.slug, fixture.target]]),
        trainer: new Map([[releasedActor.slug, releasedActor]]),
      },
    })
    expect(released.encounterState?.effects.filter(effect => effect.tags.includes('equipment.hand-net')))
      .toEqual([])

    const netInstance = state.instances[0]!
    const brokenActor: TrainerSheet = {
      ...fixture.actor,
      equipmentState: parseSheetEquipmentStateForOwner({
        ...state,
        revision: state.revision + 1,
        instances: state.instances.map(instance => instance.instanceId === netInstance.instanceId ? {
          ...instance,
          revision: instance.revision + 1,
          serializedState: {
            ...instance.serializedState,
            equipmentDurability: { schemaVersion: 1, current: 0, maximum: 50 },
          },
          activity: {
            status: 'broken',
            reasons: [{ code: 'equipment.breakage.durability', sourceId: instance.instanceId }],
          },
        } : instance),
      }, state.owner),
    }
    const escapedByBreakage = reconcileCapabilityRuntimeSourceLoss({
      map: accepted.map,
      sheets: {
        pokemon: new Map([[fixture.target.slug, fixture.target]]),
        trainer: new Map([[brokenActor.slug, brokenActor]]),
      },
    })
    expect(escapedByBreakage.encounterState?.effects.filter(effect => effect.tags.includes('equipment.hand-net')))
      .toEqual([])

    const partiallyCleared = {
      ...accepted.map,
      encounterState: {
        ...accepted.map.encounterState!,
        effects: accepted.map.encounterState!.effects.filter(effect => !(
          effect.kind === 'condition' && effect.payload.conditionId === 'trapped'
        )),
      },
    }
    const reconciled = reconcileCapabilityRuntimeSourceLoss({
      map: partiallyCleared,
      sheets: {
        pokemon: new Map([[fixture.target.slug, fixture.target]]),
        trainer: new Map([[fixture.actor.slug, fixture.actor]]),
      },
    })
    expect(reconciled.encounterState?.effects.filter(effect => effect.tags.includes('equipment.hand-net')))
      .toEqual([])
  })

  it('retains no restraint on a miss and replaces same-net restraint rather than stacking', () => {
    expect(execute(setup(), 2).result.map.encounterState?.effects).toEqual([])
    const first = setup()
    const accepted = execute(first, 10).result
    const repeat = executeDeferredEquipmentActionMechanic({
      command: { ...first.command, operationId: 'hand-net-operation-repeat' },
      source: first.source,
      map: accepted.map,
      actorPlacement: first.map.placements[0]!,
      actorSheet: first.actor,
      pokemonSheets: new Map([[first.target.slug, first.target]]),
      trainerSheets: new Map([[first.actor.slug, first.actor]]),
      rollD20: () => roll(10),
      equipmentGrantsForPlacement: placementId => first.queries.resolve(placementId),
    })
    expect(repeat.map.encounterState?.effects.filter(effect => effect.tags.includes('equipment.hand-net')))
      .toHaveLength(2)
  })

  it('converges the durable restraint to another client and returns an exact retry without rerolling', () => {
    const fixture = setup()
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const maps = createSqliteMapRepository<TabletopMap>(database)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      maps.save({ slug: fixture.map.slug, document: fixture.map, revision: 5, updatedAt: 1 })
      sheets.save({
        kind: 'trainer', slug: fixture.actor.slug,
        document: { ...fixture.actor, revision: 2 }, revision: 2, updatedAt: 1,
      })
      sheets.save({
        kind: 'pokemon', slug: fixture.target.slug,
        document: { ...fixture.target, revision: 3 }, revision: 3, updatedAt: 1,
      })
      const randomInt = vi.fn(() => 10)
      const first = executeEquipmentActionUseCase({
        role: 'gm', command: fixture.command, clientId: 'hand-net-client-a',
      }, { database, randomInt, now: () => 10 })
      const replay = executeEquipmentActionUseCase({
        role: 'gm', command: fixture.command, clientId: 'hand-net-client-b',
      }, { database, randomInt, now: () => 11 })
      expect(first).toMatchObject({ exactReplay: false, mapRevision: 6 })
      expect(replay).toMatchObject({ exactReplay: true, mapRevision: 6, rolls: first.rolls })
      expect(randomInt).toHaveBeenCalledTimes(1)

      const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({
        event: {
          channel: 'map:hand-net-map', clientId: 'hand-net-client-a', revision: 6,
          data: { encounterState: { effects: expect.arrayContaining([
            expect.objectContaining({ tags: expect.arrayContaining(['equipment.hand-net']) }),
          ]) } },
        },
      })
      const reconnectedMap = maps.getBySlug(fixture.map.slug)!
      const projection = buildEncounterPresentationProjection({
        role: 'gm', map: reconnectedMap, mapRevision: 6,
        pokemonSheets: [{ ...fixture.target, revision: 3 }],
        trainerSheets: [{ ...fixture.actor, revision: 2 }], generatedAt: 12,
      })
      expect(projection.passives.find(passive => passive.source.canonicalId === 'Hand Net'
        && passive.participant.participantId === 'hand-net-target-token'))
        .toBeDefined()
    }
    finally { database.close() }
  })

  it('rejects Medium, stale, and non-adjacent targets before RNG or state change', () => {
    for (const [fixture, command, code] of [
      (() => { const row = setup({ species: 'Charizard' }); return [row, row.command, 'hand-net.target-not-small'] as const })(),
      (() => { const row = setup({ targetX: 2 }); return [row, row.command, 'hand-net.target-out-of-range'] as const })(),
      (() => { const row = setup(); return [row, { ...row.command, targetPlacementIds: ['missing-target'] }, 'hand-net.target-stale'] as const })(),
    ]) {
      const roller = vi.fn(() => roll(20))
      expect(() => executeDeferredEquipmentActionMechanic({
        command,
        source: fixture.source,
        map: fixture.map,
        actorPlacement: fixture.map.placements[0]!,
        actorSheet: fixture.actor,
        pokemonSheets: new Map([[fixture.target.slug, fixture.target]]),
        trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
        rollD20: roller,
        equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
      })).toThrowError(expect.objectContaining({ code }))
      expect(roller).not.toHaveBeenCalled()
      expect(fixture.map.encounterState?.effects).toEqual([])
    }
  })
})
