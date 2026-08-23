import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand } from '#shared/itemAutomation/equipmentActions'
import { parseSheetEquipmentStateForOwner, type SheetEquipmentStateV1 } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { attachEncounterEquipmentActionCommandTemplate } from '~~/server/domain/itemAutomation/equipmentActionCommandTemplate'
import { recordActivelyCommandedPokemon } from '~~/server/domain/moveAutomation/activePokemonCommands'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteEquipmentActionOperationRepository } from '~~/server/storage/equipmentActionOperationRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'
import { activeEquipmentState } from '../fixtures/equipment'

const withPair = (
  state: SheetEquipmentStateV1,
  role: 'remote' | 'collar',
  groundCapable = false,
): SheetEquipmentStateV1 => parseSheetEquipmentStateForOwner({
  ...state,
  instances: state.instances.map(instance => ({
    ...instance,
    serializedState: {
      shockCollarPair: {
        schemaVersion: 1,
        role,
        pairId: 'fixture-shock-pair',
        groundCapable,
      },
    },
  })),
}, state.owner)

const setup = (input: {
  readonly groundTarget?: boolean
  readonly groundCapable?: boolean
  readonly press?: boolean
} = {}) => {
  const actor: TrainerSheet = {
    slug: 'shock-operator', name: 'Shock Operator', level: 20, currentHp: 60,
    ...(input.press ? { features: [{ name: 'Press' }] } : {}),
    equipmentState: withPair(activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'shock-operator', slotId: 'accessory', canonicalItemId: 'Shock Collar',
    }), 'remote'),
  }
  const target: CharacterSheet = {
    slug: 'shock-wearer', nickname: 'Shock Wearer', species: input.groundTarget ? 'Geodude' : 'Pikachu', level: 20,
    types: input.groundTarget ? ['Ground', 'Rock'] : ['Electric'],
    stats: { hp: { added: 6 } },
    combat: { currentHp: 50, conditions: ['Sleep'] },
    equipmentState: withPair(activeEquipmentState({
      ownerKind: 'pokemon', ownerSlug: 'shock-wearer', slotId: 'held', canonicalItemId: 'Shock Collar',
    }), 'collar', input.groundCapable),
  }
  let map: TabletopMap = {
    schemaVersion: 2, slug: 'shock-collar-map', name: 'Shock Collar', revision: 8,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0, playerVisible: true, voxels: [],
    placements: [
      { id: 'shock-operator-token', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 1, y: 0, z: 1 } },
      { id: 'shock-wearer-token', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: 9, y: 0, z: 9 } },
    ],
    encounterState: createEmptyEncounterState(),
  }
  if (input.press) map = recordActivelyCommandedPokemon({
    map,
    trainerPlacementId: 'shock-operator-token',
    pokemonPlacementId: 'shock-wearer-token',
    operationId: 'shock-command-pokemon',
  })
  const sheets = [
    { kind: 'trainer' as const, slug: actor.slug, sheet: actor },
    { kind: 'pokemon' as const, slug: target.slug, sheet: target },
  ]
  const queries = createEncounterEquipmentGrantQueries({ map, sheets })
  const remote = queries.resolve('shock-operator-token')!.active.find(entry => (
    entry.grant.kind === 'action' && entry.grant.actionId === 'equipment.shock-collar.activate'
  ))!
  const collar = queries.resolve('shock-wearer-token')!.active.find(entry => entry.canonicalItemId === 'Shock Collar')!
  const projection = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 8, pokemonSheets: [target], trainerSheets: [actor], generatedAt: 100,
  })
  const offer = projection.offers.find(candidate => (
    candidate.actor.participantId === 'shock-operator-token'
    && candidate.intent.actionId === 'equipment.shock-collar.activate'
  ))!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1,
    operationId: 'shock-collar-operation',
    offerId: offer.offerId,
    mapSlug: map.slug,
    baseRevision: 8,
    actorPlacementId: 'shock-operator-token',
    actionId: 'equipment.shock-collar.activate',
    equipmentInstanceId: remote.instanceId,
    equipmentInstanceRevision: remote.instanceRevision,
    targetEquipmentInstanceId: collar.instanceId,
    targetEquipmentInstanceRevision: collar.instanceRevision,
    targetPlacementIds: ['shock-wearer-token'],
    cells: [], inventorySourceInstanceId: null, skillCheckId: null, gmAdjudication: null,
  })
  return { actor, target, map, queries, remote, collar, projection, offer, command }
}

const execute = (fixture: ReturnType<typeof setup>) => executeDeferredEquipmentActionMechanic({
  command: fixture.command,
  source: fixture.remote,
  map: fixture.map,
  actorPlacement: fixture.map.placements[0]!,
  actorSheet: fixture.actor,
  pokemonSheets: new Map([[fixture.target.slug, fixture.target]]),
  trainerSheets: new Map([[fixture.actor.slug, fixture.actor]]),
  rollD20: () => { throw new Error('Shock Collar activation does not roll.') },
  equipmentGrantsForPlacement: placementId => fixture.queries.resolve(placementId),
})

describe('P11-033 native Shock Collar activation', () => {
  it('projects only the configured remote with one role-safe paired wearer choice', () => {
    const fixture = setup()
    expect(fixture.offer).toMatchObject({
      availability: { status: 'available' },
      timing: { kind: 'standard' },
      targeting: [expect.objectContaining({ kind: 'participant', minSelections: 1, maxSelections: 1 })],
      selectionOptions: [expect.objectContaining({ value: 'shock-wearer-token', label: 'Shock Wearer' })],
    })
    expect(fixture.projection.offers.filter(offer => offer.intent.actionId === 'equipment.shock-collar.activate'))
      .toHaveLength(1)
    expect(JSON.stringify(fixture.projection)).not.toContain(fixture.remote.instanceId)
    expect(JSON.stringify(fixture.projection)).not.toContain(fixture.collar.instanceId)
  })

  it('derives the bundled remote from ordinary trainer-origin collar custody without manual pairing state', () => {
    const actor: TrainerSheet = { slug: 'bundled-remote-owner', name: 'Bundled Remote Owner', level: 20, currentHp: 50 }
    const target: CharacterSheet = {
      slug: 'bundled-collar-wearer', nickname: 'Bundled Collar Wearer', species: 'Pikachu', level: 20,
      combat: { currentHp: 42 },
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'bundled-collar-wearer', slotId: 'held',
        canonicalItemId: 'Shock Collar', sourceTrainerSlug: actor.slug,
      }),
    }
    const map: TabletopMap = {
      schemaVersion: 2, slug: 'bundled-shock-map', name: 'Bundled Shock Map', revision: 3,
      dimensions: { x: 6, y: 3, z: 6 }, voxels: [], playerVisible: true,
      placements: [
        { id: 'bundled-actor', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 0, y: 0, z: 0 } },
        { id: 'bundled-target', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: 5, y: 0, z: 5 } },
      ],
      encounterState: createEmptyEncounterState(),
    }
    const sheets = [
      { kind: 'trainer' as const, slug: actor.slug, sheet: actor },
      { kind: 'pokemon' as const, slug: target.slug, sheet: target },
    ]
    const queries = createEncounterEquipmentGrantQueries({ map, sheets })
    const collar = queries.resolve('bundled-target')!.active.find(entry => entry.canonicalItemId === 'Shock Collar')!
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map, mapRevision: 3, pokemonSheets: [target], trainerSheets: [actor], generatedAt: 10,
    }).offers.find(candidate => candidate.actor.participantId === 'bundled-actor'
      && candidate.intent.actionId === 'equipment.shock-collar.activate')!
    expect(offer.availability.status).toBe('available')
    const authorized = attachEncounterEquipmentActionCommandTemplate({
      offer,
      intent: {
        schemaVersion: 1, intentId: 'bundled-shock-intent', offerId: offer.offerId,
        mapSlug: map.slug, baseRevision: 3, actorParticipantId: 'bundled-actor',
        actionId: 'equipment.shock-collar.activate',
        selections: [{ choiceId: 'equipment-shock-collar-target', optionIds: ['bundled-target'] }],
      },
      map, mapRevision: 3, pokemonSheets: [target], trainerSheets: [actor],
    })
    const command = authorized.equipmentActionCommand!
    expect(command.equipmentInstanceId).not.toBe(collar.instanceId)
    expect(command.targetEquipmentInstanceId).toBe(collar.instanceId)
    const result = executeDeferredEquipmentActionMechanic({
      command,
      source: collar,
      map,
      actorPlacement: map.placements[0]!,
      actorSheet: actor,
      pokemonSheets: new Map([[target.slug, target]]),
      trainerSheets: new Map([[actor.slug, actor]]),
      rollD20: () => { throw new Error('Shock Collar activation does not roll.') },
      equipmentGrantsForPlacement: placementId => queries.resolve(placementId),
    })
    expect(result.status).toBe('accepted')
    expect((result.sheetMutations[0]!.current as CharacterSheet).combat!.currentHp).toBeLessThan(42)
  })

  it('binds both exact private component identities in the declaration receipt', () => {
    const fixture = setup()
    const authorized = attachEncounterEquipmentActionCommandTemplate({
      offer: fixture.offer,
      intent: {
        schemaVersion: 1,
        intentId: 'shock-private-declaration',
        offerId: fixture.offer.offerId,
        mapSlug: fixture.map.slug,
        baseRevision: 8,
        actorParticipantId: 'shock-operator-token',
        actionId: 'equipment.shock-collar.activate',
        selections: [{ choiceId: 'equipment-shock-collar-target', optionIds: ['shock-wearer-token'] }],
      },
      map: fixture.map,
      mapRevision: 8,
      pokemonSheets: [fixture.target],
      trainerSheets: [fixture.actor],
    })
    expect(authorized.equipmentActionCommand).toMatchObject({
      equipmentInstanceId: fixture.remote.instanceId,
      targetEquipmentInstanceId: fixture.collar.instanceId,
      targetPlacementIds: ['shock-wearer-token'],
    })
  })

  it('loses floor one-sixth of real Max HP, wakes Sleep, and journals the Press trigger fact', () => {
    const fixture = setup({ press: true })
    expect(pokemonHpSnapshot(fixture.target).fullMaxHp).toBe(60)
    const result = execute(fixture)
    const mutation = result.sheetMutations[0]!
    expect((mutation.current as CharacterSheet).combat?.currentHp).toBe(40)
    expect((mutation.current as CharacterSheet).combat?.conditions).not.toContain('Sleep')
    expect(result.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hp-loss', safeDetail: '10 HP' }),
      expect.objectContaining({ kind: 'feature-trigger-fact', reasonCode: 'equipment.shock-collar.press-triggered' }),
    ]))
  })

  it('rolls target-sheet failure back, then retries and replays without a second HP spend', () => {
    const fixture = setup()
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const maps = createSqliteMapRepository<TabletopMap>(database)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      maps.save({ slug: fixture.map.slug, document: fixture.map, revision: 8, updatedAt: 1 })
      sheets.save({
        kind: 'trainer', slug: fixture.actor.slug,
        document: { ...fixture.actor, revision: 2 }, revision: 2, updatedAt: 1,
      })
      sheets.save({
        kind: 'pokemon', slug: fixture.target.slug,
        document: { ...fixture.target, revision: 3 }, revision: 3, updatedAt: 1,
      })
      expect(() => executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database,
        now: () => 10,
        failAfterWrite: boundary => {
          if (boundary === 'sheet') throw new Error('injected shock sheet failure')
        },
      })).toThrow('injected shock sheet failure')
      expect(maps.getBySlug(fixture.map.slug)).toMatchObject({ revision: 8 })
      expect((sheets.getByRef('pokemon', fixture.target.slug)?.sheet as CharacterSheet).combat?.currentHp).toBe(50)
      expect(createSqliteEquipmentActionOperationRepository(database).listForMap(fixture.map.slug)).toEqual([])
      expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 }).events).toEqual([])

      const first = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, now: () => 11,
      })
      const replay = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, now: () => 12,
      })
      expect(first).toMatchObject({ exactReplay: false, mapRevision: 9 })
      expect(replay).toMatchObject({ exactReplay: true, mapRevision: 9 })
      expect((sheets.getByRef('pokemon', fixture.target.slug)?.sheet as CharacterSheet).combat?.currentHp).toBe(40)
    }
    finally { database.close() }
  })

  it('fails closed for stale paired custody and for a Ground target without the priced variant', () => {
    const stale = setup()
    expect(() => executeDeferredEquipmentActionMechanic({
      command: { ...stale.command, targetEquipmentInstanceRevision: stale.command.targetEquipmentInstanceRevision! + 1 },
      source: stale.remote,
      map: stale.map,
      actorPlacement: stale.map.placements[0]!,
      actorSheet: stale.actor,
      pokemonSheets: new Map([[stale.target.slug, stale.target]]),
      trainerSheets: new Map([[stale.actor.slug, stale.actor]]),
      rollD20: () => { throw new Error('Shock Collar activation does not roll.') },
      equipmentGrantsForPlacement: placementId => stale.queries.resolve(placementId),
    })).toThrowError(expect.objectContaining({ code: 'shock-collar.target-not-wearing-source' }))

    expect(() => execute(setup({ groundTarget: true, groundCapable: false })))
      .toThrowError(expect.objectContaining({ code: 'shock-collar.ground-variant-required' }))
    expect(execute(setup({ groundTarget: true, groundCapable: true })).status).toBe('accepted')
  })
})
