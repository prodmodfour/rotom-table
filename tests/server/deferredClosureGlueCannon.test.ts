import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseExecuteEquipmentActionCommand, type EquipmentActionRollV1 } from '#shared/itemAutomation/equipmentActions'
import { parseGlueCannonState, withGlueCannonCharges } from '#shared/itemAutomation/glueCannon'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '~~/server/domain/moveAutomation/equipmentGrantQueries'
import { executeDeferredEquipmentActionMechanic } from '~~/server/domain/itemAutomation/deferredEquipmentActions'
import { activeEquipmentState } from '../fixtures/equipment'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { executeEquipmentActionUseCase } from '~~/server/useCases/executeEquipmentAction'

const trainer = (charges = 3): TrainerSheet => {
  const state = activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'glue-actor', slotId: 'mainHand', additionalSlotIds: ['offHand'],
    canonicalItemId: 'Glue Cannon',
  })
  return {
    slug: 'glue-actor', name: 'Glue Actor', level: 20, currentHp: 50,
    equipmentState: parseSheetEquipmentStateForOwner({
      ...state,
      instances: state.instances.map(instance => ({
        ...instance,
        serializedState: charges === 3
          ? instance.serializedState
          : withGlueCannonCharges(instance.serializedState, charges),
      })),
    }, state.owner),
  }
}

const setup = (input: { readonly charges?: number, readonly targetX?: number, readonly blocked?: boolean } = {}) => {
  const actor = trainer(input.charges ?? 3)
  const target: CharacterSheet = {
    slug: 'glue-target', nickname: 'Glue Target', species: 'Pikachu', level: 10,
    combat: { currentHp: 40 },
  }
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'glue-cannon-map', name: 'Glue Cannon', revision: 6,
    dimensions: { x: 12, y: 4, z: 12 }, playerVisible: true,
    voxels: input.blocked ? [{
      x: 2, y: 0, z: 0, materialId: 'stone', blocksSight: true, blocksMovement: true,
    }] : [],
    placements: [
      { id: 'glue-actor-token', sheetKind: 'trainer', sheetSlug: actor.slug, position: { x: 0, y: 0, z: 0 } },
      { id: 'glue-target-token', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: input.targetX ?? 4, y: 0, z: 0 } },
    ],
    encounterState: createEmptyEncounterState(),
  }
  const sheets = [
    { kind: 'trainer' as const, slug: actor.slug, sheet: actor },
    { kind: 'pokemon' as const, slug: target.slug, sheet: target },
  ]
  const queries = createEncounterEquipmentGrantQueries({ map, sheets })
  const source = queries.resolve('glue-actor-token')!.active.find(entry => (
    entry.grant.kind === 'action' && entry.grant.actionId === 'equipment.glue-cannon.attack'
  ))!
  const offer = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 6, pokemonSheets: [target], trainerSheets: [actor], generatedAt: 100,
  }).offers.find(candidate => candidate.actor.participantId === 'glue-actor-token'
    && candidate.intent.actionId === 'equipment.glue-cannon.attack')!
  const command = parseExecuteEquipmentActionCommand({
    schemaVersion: 1, operationId: 'glue-cannon-operation', offerId: offer.offerId,
    mapSlug: map.slug, baseRevision: 6, actorPlacementId: 'glue-actor-token',
    actionId: 'equipment.glue-cannon.attack', equipmentInstanceId: source.instanceId,
    equipmentInstanceRevision: source.instanceRevision,
    targetEquipmentInstanceId: null, targetEquipmentInstanceRevision: null,
    targetPlacementIds: ['glue-target-token'], cells: [], inventorySourceInstanceId: null,
    skillCheckId: null, gmAdjudication: null,
  })
  return { actor, target, map, queries, source, offer, command }
}

const roll = (naturalResult: number): EquipmentActionRollV1 => ({
  rollId: 'glue-roll', expression: '1d20', naturalResult, modifier: 0, total: naturalResult,
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

const remainingCharges = (sheet: TrainerSheet): number => {
  const instance = sheet.equipmentState!.instances[0]!
  return parseGlueCannonState(instance.serializedState).charges
}

describe('P11-034 native Glue Cannon status attack', () => {
  it('projects a two-hand AC 8 short-range action with owner-safe charge count and target choices', () => {
    const fixture = setup()
    expect(fixture.offer).toMatchObject({
      availability: { status: 'available' },
      timing: { kind: 'standard' },
      targeting: [expect.objectContaining({ rangeLabel: 'Within 4 meters', requiresLineOfSight: true })],
      selectionOptions: [expect.objectContaining({ value: 'glue-target-token' })],
    })
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: fixture.map, mapRevision: 6,
      pokemonSheets: [fixture.target], trainerSheets: [fixture.actor], generatedAt: 100,
    })
    expect(projection.passives.flatMap(passive => passive.facts).some(fact => fact.label === '3 charges remaining'))
      .toBe(true)
  })

  it('consumes one packet on an ordinary hit and applies Slowed as a typed Scene condition', () => {
    const fixture = setup()
    const { result } = execute(fixture, 10)
    expect(result.rolls).toEqual([expect.objectContaining({ naturalResult: 10 })])
    expect(remainingCharges(result.sheetMutations[0]!.current as TrainerSheet)).toBe(2)
    expect(result.map.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition', payload: expect.objectContaining({ conditionId: 'slowed' }),
        duration: { kind: 'scene', remaining: null },
      }),
    ]))
    expect(result.receipts.map(entry => entry.kind)).toEqual([
      'item-declaration', 'charge-consumption', 'accuracy', 'condition', 'accepted-result',
    ])
  })

  it('applies Stuck and Trapped instead of Slowed on a natural critical', () => {
    const { result } = execute(setup(), 20)
    const conditions = result.map.encounterState?.effects
      .filter(effect => effect.tags.includes('equipment.glue-cannon'))
      .map(effect => effect.kind === 'condition' ? effect.payload.conditionId : null)
    expect(conditions).toEqual(['stuck', 'trapped'])
    expect(conditions).not.toContain('slowed')
  })

  it('still spends one packet on a miss but installs no condition', () => {
    const { result } = execute(setup(), 2)
    expect(remainingCharges(result.sheetMutations[0]!.current as TrainerSheet)).toBe(2)
    expect(result.map.encounterState?.effects).toEqual([])
    expect(result.receipts).toContainEqual(expect.objectContaining({ reasonCode: 'equipment.glue-cannon.miss' }))
  })

  it('returns the original accepted roll and charge spend on duplicate delivery', () => {
    const fixture = setup()
    const database = openRotomDatabase({ path: ':memory:', enableWal: false })
    try {
      const maps = createSqliteMapRepository<TabletopMap>(database)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      maps.save({ slug: fixture.map.slug, document: fixture.map, revision: 6, updatedAt: 1 })
      sheets.save({
        kind: 'trainer', slug: fixture.actor.slug,
        document: { ...fixture.actor, revision: 2, updatedAt: 1 }, revision: 2, updatedAt: 1,
      })
      sheets.save({
        kind: 'pokemon', slug: fixture.target.slug,
        document: { ...fixture.target, revision: 3, updatedAt: 1 }, revision: 3, updatedAt: 1,
      })
      const randomInt = vi.fn(() => 10)
      const first = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 10,
      })
      const replay = executeEquipmentActionUseCase({ role: 'gm', command: fixture.command }, {
        database, randomInt, now: () => 20,
      })
      expect(first).toMatchObject({ status: 'accepted', exactReplay: false, mapRevision: 7 })
      expect(replay).toMatchObject({ status: 'accepted', exactReplay: true, mapRevision: 7 })
      expect(replay.rolls).toEqual(first.rolls)
      expect(randomInt).toHaveBeenCalledTimes(1)
      const storedActor = sheets.getByRef('trainer', fixture.actor.slug)!.sheet as TrainerSheet
      expect(remainingCharges(storedActor)).toBe(2)
      expect(maps.getBySlug(fixture.map.slug)?.encounterState?.effects
        .filter(effect => effect.tags.includes('equipment.glue-cannon'))).toHaveLength(1)
    }
    finally { database.close() }
  })

  it('rejects no-charge, out-of-range, and blocked-LoS declarations before rolling or spending', () => {
    for (const [fixture, code] of [
      [setup({ charges: 0 }), 'glue-cannon.no-charge'],
      [setup({ targetX: 5 }), 'glue-cannon.target-out-of-range'],
      [setup({ blocked: true }), 'glue-cannon.line-of-sight-blocked'],
    ] as const) {
      const roller = vi.fn(() => roll(20))
      expect(() => execute(fixture, 20, roller)).toThrowError(expect.objectContaining({ code }))
      expect(roller).not.toHaveBeenCalled()
      expect(remainingCharges(fixture.actor)).toBe(code === 'glue-cannon.no-charge' ? 0 : 3)
    }
    expect(setup({ charges: 0 }).offer).toMatchObject({
      availability: { status: 'unavailable', reasons: [expect.objectContaining({ code: 'source.item-unavailable' })] },
      presentation: { description: 'No Glue Cannon charge packet remains.' },
    })
    expect(setup({ targetX: 5 }).offer).toMatchObject({
      availability: { status: 'unavailable', reasons: [expect.objectContaining({ code: 'target.out-of-range' })] },
      selectionOptions: [expect.objectContaining({
        disabled: true,
        unavailableReason: expect.objectContaining({ code: 'target.out-of-range' }),
      })],
    })
    expect(setup({ blocked: true }).offer).toMatchObject({
      availability: { status: 'unavailable', reasons: [expect.objectContaining({ code: 'target.not-visible' })] },
      selectionOptions: [expect.objectContaining({
        disabled: true,
        unavailableReason: expect.objectContaining({ code: 'target.not-visible' }),
      })],
    })
  })
})
