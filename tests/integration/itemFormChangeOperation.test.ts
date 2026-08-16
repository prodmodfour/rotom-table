import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteItemFormChangeOperationRepository } from '../../server/storage/itemFormChangeOperationRepository'
import { executeItemFormChangeUseCase } from '../../server/useCases/executeItemFormChange'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { redactRealtimeEventForPrincipal } from '../../server/realtime/realtimeEventRedaction'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseExecuteItemFormChangeCommand, type ExecuteItemFormChangeCommandV1 } from '#shared/itemAutomation/formChanges'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  FORM_CHANGE_MAP_SLUG,
  FORM_CHANGE_POKEMON_PLACEMENT_ID,
  FORM_CHANGE_TRAINER_PLACEMENT_ID,
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeProfile,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

const authoritativeMap = (): TabletopMap => {
  const map = createFormChangeMap()
  map.encounterState = {
    ...map.encounterState!,
    turnResources: {
      [FORM_CHANGE_TRAINER_PLACEMENT_ID]: createEncounterTurnResourceLedger({
        placementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
        round: 2,
      }),
    },
  }
  return map
}

const seed = (database: RotomDatabase, input: {
  readonly map?: TabletopMap
  readonly pokemon?: CharacterSheet
  readonly trainer?: TrainerSheet
} = {}) => {
  const map = input.map ?? authoritativeMap()
  const pokemon = input.pokemon ?? createFormChangePokemon()
  const trainer = input.trainer ?? createFormChangeTrainer()
  createSqliteMapRepository<TabletopMap>(database).save({
    slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt,
  })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'pokemon', slug: pokemon.slug, document: pokemon as unknown as Record<string, unknown>,
    revision: pokemon.revision ?? 0, updatedAt: 5_100,
  })
  sheets.save({
    kind: 'trainer', slug: trainer.slug, document: trainer as unknown as Record<string, unknown>,
    revision: trainer.revision ?? 0, updatedAt: 5_100,
  })
  return { map, pokemon, trainer }
}

const commandFor = (input: {
  readonly map?: TabletopMap
  readonly pokemon?: CharacterSheet
  readonly trainer?: TrainerSheet
  readonly operationId?: string
  readonly abilityOptionId?: string | null
} = {}): ExecuteItemFormChangeCommandV1 => {
  const map = input.map ?? authoritativeMap()
  const pokemon = input.pokemon ?? createFormChangePokemon()
  const trainer = input.trainer ?? createFormChangeTrainer()
  const projection = buildEncounterPresentationProjection({
    role: 'player', playerProfile: createFormChangeProfile(), map,
    mapRevision: map.revision ?? 0, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 5_200,
  })
  const offer = projection.offers.find(row => row.intent.actionId === 'item.form-change.mega-evolve')!
  return parseExecuteItemFormChangeCommand({
    schemaVersion: 1,
    operationId: input.operationId ?? 'item-form-change-operation-0001',
    offerId: offer.offerId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    actorPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
    targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    abilityOptionId: input.abilityOptionId ?? null,
    readSet: [
      { kind: 'map', sheetKind: null, id: map.slug, revision: map.revision ?? 0 },
      { kind: 'sheet', sheetKind: 'pokemon', id: pokemon.slug, revision: pokemon.revision ?? 0 },
      { kind: 'sheet', sheetKind: 'trainer', id: trainer.slug, revision: trainer.revision ?? 0 },
    ],
  })
}

const readMap = (database: RotomDatabase): TabletopMap => (
  createSqliteMapRepository<TabletopMap>(database).get(FORM_CHANGE_MAP_SLUG)!.document
)

describe('P8-056 item form-change operation transaction', () => {
  it('spends one Swift Action, commits one Scene form, journals private evidence, and publishes durable map updates', () => {
    const database = open()
    const seeded = seed(database)
    const command = commandFor(seeded)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_200 })
    const published: number[] = []
    const result = executeItemFormChangeUseCase({
      role: 'player', playerProfile: createFormChangeProfile(), command,
    }, {
      database, realtimeEventRepository: realtime, now: () => 5_200,
      publishPersistedRealtimeEvent: event => published.push(event.sequence),
    })

    expect(result).toMatchObject({
      operationId: command.operationId,
      mapSlug: FORM_CHANGE_MAP_SLUG,
      mapRevision: 8,
      actorPlacementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      targetPlacementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
      formName: 'Mega Charizard X', abilityName: 'Tough Claws',
      durationLabel: 'Scene', status: 'accepted', exactReplay: false,
    })
    const map = readMap(database)
    expect(map.revision).toBe(8)
    expect(map.encounterState?.turnResources[FORM_CHANGE_TRAINER_PLACEMENT_ID]?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.itemFormChanges?.entries).toEqual([
      expect.objectContaining({
        placementId: FORM_CHANGE_POKEMON_PLACEMENT_ID,
        formId: 'mega-charizard-x', sourceOperationId: command.operationId,
      }),
    ])
    const stored = createSqliteItemFormChangeOperationRepository(database).find(command.operationId)
    expect(stored).toMatchObject({
      principalKey: `player:${createFormChangeProfile().id}`,
      result: { mapRevision: 8, exactReplay: false },
      evidence: {
        kind: 'item-form-change-accepted', formId: 'mega-charizard-x',
        targetSheetRevision: 4, trainerSheetRevision: 3,
      },
    })
    const events = realtime.readAfter({ afterSequence: 0, limit: 10 }).events
    expect(events.map(event => event.event.channel)).toEqual([`map:${FORM_CHANGE_MAP_SLUG}`, 'maps'])
    expect(published).toEqual(events.map(event => event.sequence))
  })

  it('persists and revalidates the exact opaque replacement Ability choice', () => {
    const database = open()
    const pokemon = createFormChangePokemon('mega-charizard-x', {
      abilities: [{ name: 'Blaze' }, { name: 'Tough Claws' }],
    })
    const map = authoritativeMap()
    const trainer = createFormChangeTrainer()
    const projection = buildEncounterPresentationProjection({
      role: 'player', playerProfile: createFormChangeProfile(), map,
      mapRevision: 7, pokemonSheets: [pokemon], trainerSheets: [trainer], generatedAt: 5_200,
    })
    const offer = projection.offers.find(row => row.intent.actionId === 'item.form-change.mega-evolve')!
    const abilityOptionId = offer.selectionOptions?.find(option => option.label === 'Intimidate')?.value
    expect(abilityOptionId).toMatch(/^mega-ability:v1:/)
    const seeded = seed(database, { map, pokemon, trainer })
    const command = commandFor({ ...seeded, abilityOptionId })
    const result = executeItemFormChangeUseCase({
      role: 'player', playerProfile: createFormChangeProfile(), command,
    }, { database, now: () => 5_200 })
    expect(result.abilityName).toBe('Intimidate')
    expect(readMap(database).encounterState?.itemFormChanges?.entries[0]?.abilityId).toBe('Intimidate')
    expect(createSqliteItemFormChangeOperationRepository(database).find(command.operationId)?.evidence)
      .toMatchObject({ abilityId: 'Intimidate' })
  })

  it('returns an exact replay without spending twice or republishing, and rejects payload or principal drift', () => {
    const database = open()
    const seeded = seed(database)
    const command = commandFor(seeded)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_200 })
    const first = executeItemFormChangeUseCase({ role: 'gm', command }, {
      database, realtimeEventRepository: realtime, now: () => 5_200,
    })
    const replay = executeItemFormChangeUseCase({ role: 'gm', command }, {
      database, realtimeEventRepository: realtime, now: () => 5_300,
    })
    expect(first.exactReplay).toBe(false)
    expect(replay).toMatchObject({ ...first, exactReplay: true })
    expect(readMap(database).encounterState?.turnResources[FORM_CHANGE_TRAINER_PLACEMENT_ID]?.actions.swift.spent).toBe(1)
    expect(realtime.readAfter({ afterSequence: 0, limit: 10 }).events).toHaveLength(2)

    expect(() => executeItemFormChangeUseCase({
      role: 'gm', command: { ...command, targetPlacementId: 'changed-target' },
    }, { database })).toThrow(/operation ID was reused with changed input/i)
    expect(() => executeItemFormChangeUseCase({
      role: 'player', playerProfile: createFormChangeProfile(), command,
    }, { database })).toThrow(/different principal/i)
  })

  it('rejects stale revisions, forged offers, unavailable action economy, and unauthorized actors without mutation', () => {
    const cases: readonly {
      readonly name: string
      readonly command: (seeded: ReturnType<typeof seed>) => ExecuteItemFormChangeCommandV1
      readonly profile?: ReturnType<typeof createFormChangeProfile>
      readonly message: RegExp
    }[] = [{
      name: 'stale sheet',
      command: seeded => ({
        ...commandFor(seeded),
        readSet: commandFor(seeded).readSet.map(read => read.kind === 'sheet' && read.sheetKind === 'pokemon'
          ? { ...read, revision: read.revision - 1 }
          : read),
      }),
      message: /authority changed after declaration/i,
    }, {
      name: 'forged offer',
      command: seeded => ({ ...commandFor(seeded), offerId: 'offer:forged' }),
      message: /offer is unavailable or stale/i,
    }, {
      name: 'unauthorized actor',
      command: seeded => commandFor(seeded),
      profile: { ...createFormChangeProfile(), id: 'profile_other', linkedCharacters: [] },
      message: /not controlled/i,
    }]
    for (const testCase of cases) {
      const database = open()
      const seeded = seed(database)
      const before = JSON.stringify(readMap(database))
      expect(() => executeItemFormChangeUseCase({
        role: 'player', playerProfile: testCase.profile ?? createFormChangeProfile(),
        command: testCase.command(seeded),
      }, { database, now: () => 5_200 }), testCase.name).toThrow(testCase.message)
      expect(JSON.stringify(readMap(database))).toBe(before)
    }

    const database = open()
    const map = authoritativeMap()
    const exhaustedLedger = createEncounterTurnResourceLedger({
      placementId: FORM_CHANGE_TRAINER_PLACEMENT_ID,
      round: 2,
    })
    map.encounterState = {
      ...map.encounterState!,
      turnResources: {
        [FORM_CHANGE_TRAINER_PLACEMENT_ID]: {
          ...exhaustedLedger,
          actions: {
            ...exhaustedLedger.actions,
            swift: { spent: 1, maximum: 1 },
          },
        },
      },
    }
    const seeded = seed(database, { map })
    expect(() => executeItemFormChangeUseCase({
      role: 'gm', command: commandFor(seeded),
    }, { database, now: () => 5_200 })).toThrow(/Swift Action|swift/i)
    expect(readMap(database).revision).toBe(7)
  })

  it('converges connected clients and reconnects on one durable accepted revision without leaking private state in workspace projection', () => {
    const database = open()
    const seeded = seed(database)
    const command = commandFor(seeded)
    const connected = [{ map: structuredClone(seeded.map) }, { map: structuredClone(seeded.map) }]
    const disconnected = { map: structuredClone(seeded.map) }
    executeItemFormChangeUseCase({
      role: 'player', playerProfile: createFormChangeProfile(), command,
    }, {
      database, now: () => 5_200,
      publishPersistedRealtimeEvent: (persisted) => {
        if (persisted.event.channel === `map:${FORM_CHANGE_MAP_SLUG}`) {
          for (const client of connected) client.map = structuredClone(persisted.event.data as TabletopMap)
        }
      },
    })
    expect(connected.map(client => client.map.revision)).toEqual([8, 8])
    expect(connected.map(client => client.map.encounterState?.itemFormChanges?.entries[0]?.formId))
      .toEqual(['mega-charizard-x', 'mega-charizard-x'])
    expect(disconnected.map.revision).toBe(7)
    disconnected.map = readMap(database)
    expect(disconnected.map.revision).toBe(8)
    expect(disconnected.map.encounterState?.itemFormChanges?.entries[0]?.formId).toBe('mega-charizard-x')

    const projection = buildEncounterPresentationProjection({
      role: 'player', playerProfile: createFormChangeProfile(), map: disconnected.map,
      mapRevision: 8, pokemonSheets: [seeded.pokemon], trainerSheets: [seeded.trainer], generatedAt: 5_300,
    })
    expect(projection.passives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        active: true,
        participant: expect.objectContaining({ participantId: FORM_CHANGE_POKEMON_PLACEMENT_ID }),
        presentation: expect.objectContaining({ label: 'Mega Charizard X' }),
        facts: expect.arrayContaining([
          expect.objectContaining({ factKey: 'effective-types', label: 'Types: Fire / Dragon' }),
          expect.objectContaining({ factKey: 'effective-ability', label: 'Ability: Tough Claws' }),
        ]),
      }),
    ]))
    expect(JSON.stringify(projection)).not.toContain('ringInstanceId')
    expect(JSON.stringify(projection)).not.toContain('stoneInstanceId')
    expect(JSON.stringify(projection)).not.toContain(command.operationId)

    const persistedMapEvent = createSqliteRealtimeEventRepository({ database }).readAfter({
      afterSequence: 0, limit: 10,
    }).events.find(event => event.event.channel === `map:${FORM_CHANGE_MAP_SLUG}`)
    expect(persistedMapEvent).toBeDefined()
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const projectedEvent = redactRealtimeEventForPrincipal(
      persistedMapEvent!.event,
      { role: 'player', playerProfile: createFormChangeProfile() },
      {
        getMap: slug => createSqliteMapRepository<TabletopMap>(database).getBySlug(slug),
        getSheet: (kind, slug) => {
          const stored = sheetRepository.get(kind, slug)
          return stored ? {
            slug: stored.slug, revision: stored.revision,
            sheet: stored.document as Record<string, unknown>,
          } : null
        },
        listTrainerSheets: () => [seeded.trainer],
        playerVisibleMapSheetAccessKeys: () => new Set(),
      },
    )
    expect(projectedEvent).not.toBeNull()
    expect(JSON.stringify(projectedEvent)).not.toContain('itemFormChanges')
    expect(JSON.stringify(projectedEvent)).not.toContain(command.operationId)
  })

  it('rolls back the map, action spend, evidence, and realtime rows when journaling fails', () => {
    const database = open()
    const seeded = seed(database)
    const command = commandFor(seeded)
    const baseOperations = createSqliteItemFormChangeOperationRepository(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_200 })
    expect(() => executeItemFormChangeUseCase({ role: 'gm', command }, {
      database,
      realtimeEventRepository: realtime,
      operationRepository: {
        database,
        find: baseOperations.find,
        insert: () => { throw new Error('simulated journal failure') },
      },
      now: () => 5_200,
    })).toThrow('simulated journal failure')
    expect(readMap(database).revision).toBe(7)
    expect(readMap(database).encounterState?.itemFormChanges?.entries ?? []).toEqual([])
    expect(baseOperations.find(command.operationId)).toBeNull()
    expect(realtime.readAfter({ afterSequence: 0, limit: 10 }).events).toEqual([])
  })
})
