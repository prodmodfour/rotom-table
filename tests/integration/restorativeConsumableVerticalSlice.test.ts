import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { itemCommandFromAuthorizedOffer, parseAuthorizedItemActionOffer } from '#shared/itemAutomation/projection'
import type { ItemOperationRecoveryCommandV1 } from '#shared/itemAutomation/recovery'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { ShopEntry } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import { buildShopCheckoutCommand } from '~/utils/shopCheckoutCommandBuilder'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteShopTableRepository } from '../../server/storage/shopTableRepository'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID } from '../../server/domain/moveAutomation/reduceEncounterResources'
import { createShopTableUseCase, saveShopTableUseCase } from '../../server/useCases/shopTableMutations'
import { executeShopCheckoutCommandUseCase } from '../../server/useCases/executeShopCheckoutCommand'
import { declareEncounterActionUseCase } from '../../server/useCases/declareEncounterAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { loadLiveTableSnapshotUseCase } from '../../server/useCases/loadLiveTableSnapshot'
import { loadEncounterWorkspaceUseCase } from '../../server/useCases/loadEncounterWorkspace'
import { recoverItemOperationUseCase } from '../../server/useCases/recoverItemOperation'

const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const emptyInventory = (): TrainerInventory => ({
  keyItems: [], pokemonItems: [], medicalKit: [], pokeBalls: [], foodStuff: [], equipment: [],
})

const trainerFixture = (): TrainerSheet => ({
  slug: 'fixture-trainer', name: 'Fixture Trainer', level: 10, revision: 3, money: 1_000,
  currentTeam: ['fixture-pokemon'], inventory: emptyInventory(),
})

const pokemonFixture = (): CharacterSheet => ({
  slug: 'fixture-pokemon', nickname: 'Fixture Pokémon', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7, injuries: 0, conditions: [] },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2, slug: 'fixture-arena', name: 'Fixture Arena', revision: 4,
  dimensions: { x: 6, y: 3, z: 6 }, voxels: [], playerVisible: true, createdAt: 1, updatedAt: 10,
  placements: [
    {
      id: 'fixture-trainer-placement', sheetKind: 'trainer', sheetSlug: 'fixture-trainer',
      position: { x: 1, y: 0, z: 1 }, sideId: 'allies',
    },
    {
      id: 'fixture-pokemon-placement', sheetKind: 'pokemon', sheetSlug: 'fixture-pokemon',
      position: { x: 2, y: 0, z: 1 }, sideId: 'allies',
    },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: { allies: { id: 'allies', label: 'Allies', status: 'active' } },
    turnResources: {
      'fixture-trainer-placement': createEncounterTurnResourceLedger({
        placementId: 'fixture-trainer-placement', round: 1,
      }),
    },
  },
  initiative: { activeId: 'fixture-trainer-placement', round: 1 },
})

const playerProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_vertical01',
  displayName: 'Fixture Player',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'fixture-trainer' },
    { sheetKind: 'pokemon', sheetSlug: 'fixture-pokemon' },
  ],
})

const potionShopEntry = (): ShopEntry => ({
  id: 'shop-potion-row', itemName: 'Potion', section: 'medicalKit', price: 300,
  stock: 4, maxPerPurchase: 2, playerDescription: 'Restores HP.',
})

describe('P8-040 restorative consumable vertical slice', () => {
  it('certifies buy → offer → target → cost/effect → feed/reconnect → exact replay → correction for GM and player', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const shops = createSqliteShopTableRepository(database)
    let realtimeClock = 1_000
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => ++realtimeClock })
    const published: PersistedRealtimeEvent[] = []
    const publish = (event: PersistedRealtimeEvent) => { published.push(event) }
    const profile = playerProfile()

    maps.save({ slug: 'fixture-arena', document: mapFixture(), revision: 4, updatedAt: 10 })
    sheets.save({
      kind: 'trainer', slug: 'fixture-trainer', revision: 3, updatedAt: 10,
      document: trainerFixture() as unknown as Record<string, unknown>,
    })
    sheets.save({
      kind: 'pokemon', slug: 'fixture-pokemon', revision: 2, updatedAt: 10,
      document: pokemonFixture() as unknown as Record<string, unknown>,
    })
    const createdShop = createShopTableUseCase({
      role: 'gm', slug: 'fixture-mart', document: {
        name: 'Fixture Mart', playerVisible: false, open: false,
        allowedPaymentSources: ['trainer'], allowedDeliveryTargets: ['trainer'], entries: [potionShopEntry()],
      },
    }, { database, shopTableRepository: shops, now: () => 20 })
    const openedShop = saveShopTableUseCase({
      role: 'gm', slug: 'fixture-mart', expectedRevision: createdShop.shop.revision,
      document: { ...createdShop.shop, playerVisible: true, open: true },
    }, { database, shopTableRepository: shops, now: () => 30 }).shop

    const checkoutCommand = buildShopCheckoutCommand({
      shopSlug: openedShop.slug,
      shopRevision: openedShop.revision,
      paymentSource: { kind: 'trainer', slug: 'fixture-trainer', revision: 3 },
      deliveryTarget: { kind: 'trainer', slug: 'fixture-trainer', revision: 3 },
      lines: [{ entryId: 'shop-potion-row', quantity: 2 }],
      clientId: 'vertical-player-client', profileId: profile.id, opId: 'op_vertical01',
    })
    const checkout = executeShopCheckoutCommandUseCase({
      role: 'player', playerProfile: profile, clientId: 'vertical-player-client', command: checkoutCommand,
    }, {
      database, shopTableRepository: shops, sheetRepository: sheets,
      realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish,
      createGroupInventoryRowId: () => 'fixture-potion-row', now: () => 40,
    })
    expect(checkout.result).toMatchObject({
      ok: true, totalPrice: 600,
      lines: [{ entryId: 'shop-potion-row', itemName: 'Potion', quantity: 2, unitPrice: 300 }],
    })
    expect(sheets.getByRef('trainer', 'fixture-trainer')?.sheet).toMatchObject({
      revision: 4, money: 400,
      inventory: { medicalKit: [{ id: 'fixture-potion-row', name: 'Potion', qty: 2 }] },
    })
    const checkoutEventCount = realtime.readAfter({ afterSequence: 0, limit: 100 }).events.length
    const checkoutReplay = executeShopCheckoutCommandUseCase({
      role: 'player', playerProfile: profile, clientId: 'vertical-player-client', command: checkoutCommand,
    }, { database, now: () => 41 })
    expect(checkoutReplay.result).toMatchObject({ ok: true, totalPrice: 600 })
    expect(sheets.getByRef('trainer', 'fixture-trainer')?.sheet).toMatchObject({
      revision: 4, money: 400,
      inventory: { medicalKit: [{ id: 'fixture-potion-row', name: 'Potion', qty: 2 }] },
    })
    expect(realtime.readAfter({ afterSequence: 0, limit: 100 }).events).toHaveLength(checkoutEventCount)

    const authority = () => {
      const storedMap = maps.get('fixture-arena')!
      const storedTrainer = sheets.getByRef('trainer', 'fixture-trainer')!
      const storedPokemon = sheets.getByRef('pokemon', 'fixture-pokemon')!
      return {
        map: storedMap.document,
        mapRevision: storedMap.revision,
        trainer: storedTrainer.sheet as unknown as TrainerSheet,
        pokemon: storedPokemon.sheet as unknown as CharacterSheet,
      }
    }
    const current = authority()
    const gmProjection = buildEncounterPresentationProjection({
      role: 'gm', map: current.map, mapRevision: current.mapRevision,
      trainerSheets: [current.trainer], pokemonSheets: [current.pokemon], generatedAt: 50,
    })
    const playerProjection = buildEncounterPresentationProjection({
      role: 'player', playerProfile: profile, map: current.map, mapRevision: current.mapRevision,
      trainerSheets: [current.trainer], pokemonSheets: [current.pokemon], generatedAt: 50,
    })
    const gmOffer = gmProjection.offers.find(offer => offer.source.canonicalId === 'Potion')!
    const playerOffer = playerProjection.offers.find(offer => offer.source.canonicalId === 'Potion')!
    expect(playerOffer.offerId).toBe(gmOffer.offerId)
    expect(playerOffer).toMatchObject({
      actor: { participantId: 'fixture-trainer-placement' },
      sourceContextLabel: 'Fixture Trainer · Medical Kit',
      availability: { status: 'available' },
      costs: expect.arrayContaining([
        expect.objectContaining({ kind: 'standard-action', amount: 1 }),
        expect.objectContaining({ kind: 'item', amount: 1 }),
      ]),
    })
    const targetOption = playerOffer.selectionOptions?.find(option => option.value === 'fixture-pokemon-placement')
    expect(targetOption).toMatchObject({
      disabled: false,
      description: expect.stringMatching(/20 HP restored.*Target forfeits next Standard \+ Shift/),
      costs: expect.arrayContaining([expect.objectContaining({
        resourceId: ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID,
        label: 'Target forfeits next Standard + Shift',
      })]),
    })

    const declared = parseAuthorizedItemActionOffer(declareEncounterActionUseCase({
      role: 'player', playerProfile: profile,
      intent: {
        schemaVersion: 1,
        intentId: 'intent:vertical-potion',
        offerId: playerOffer.offerId,
        mapSlug: 'fixture-arena',
        baseRevision: current.mapRevision,
        actorParticipantId: 'fixture-trainer-placement',
        actionId: playerOffer.intent.actionId,
        selections: [],
      },
    }, {
      loadProjection: () => playerProjection,
      loadItemAuthority: () => ({
        map: current.map, mapRevision: current.mapRevision,
        trainerSheets: [current.trainer], pokemonSheets: [current.pokemon],
      }),
    }))
    const itemCommand = itemCommandFromAuthorizedOffer({
      offer: declared,
      operationId: 'op_item_vertical_slice01',
      choices: [{ choiceId: 'target', optionIds: ['fixture-pokemon-placement'] }],
    })
    expect(itemCommand).toMatchObject({
      context: 'encounter', offerId: playerOffer.offerId,
      source: {
        kind: 'trainer', slug: 'fixture-trainer', section: 'medicalKit',
        rowId: 'fixture-potion-row', expectedRevision: 4,
      },
      targetIds: ['fixture-pokemon-placement'],
      readSet: expect.arrayContaining([
        { kind: 'map', id: 'fixture-arena', revision: 4 },
        { kind: 'encounter', id: 'fixture-arena', revision: 4 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 4 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 2 },
      ]),
    })

    const beforeItemEvents = realtime.readAfter({ afterSequence: 0, limit: 100 }).events.length
    const accepted = executeItemOperationUseCase({
      role: 'player', playerProfile: profile, command: itemCommand, clientId: 'vertical-player-client',
    }, {
      database, realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish, now: () => 60,
    })
    expect(accepted.result).toMatchObject({
      status: 'accepted', canonicalItemId: 'Potion', exactReplay: false,
      receiptId: expect.any(String),
    })
    expect(accepted.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`).sort()).toEqual([
      'pokemon:fixture-pokemon', 'trainer:fixture-trainer',
    ])
    const afterUse = authority()
    expect(afterUse.trainer).toMatchObject({
      revision: 5, money: 400,
      inventory: { medicalKit: [{ id: 'fixture-potion-row', name: 'Potion', qty: 1 }] },
    })
    expect(afterUse.pokemon).toMatchObject({ revision: 3, combat: { currentHp: 27 } })
    expect(afterUse.map.revision).toBe(5)
    expect(afterUse.map.encounterState?.turnResources['fixture-trainer-placement']?.actions.standard.spent).toBe(1)
    expect(afterUse.map.encounterState?.turnResources['fixture-pokemon-placement']?.oncePerTurnFlags).toEqual([
      expect.objectContaining({ id: ITEM_RESTORATIVE_NEXT_TURN_FLAG_ID }),
    ])
    const itemEvents = realtime.readAfter({ afterSequence: 0, limit: 100 }).events.slice(beforeItemEvents)
    expect(itemEvents.map(event => event.event.channel)).toEqual([
      'map:fixture-arena', 'maps',
      'sheet:pokemon:fixture-pokemon', 'sheets',
      'sheet:trainer:fixture-trainer', 'sheets',
    ])
    expect(published.map(event => event.sequence)).toEqual(
      realtime.readAfter({ afterSequence: 0, limit: 100 }).events.map(event => event.sequence),
    )

    const itemRecords = createSqliteItemOperationRepository({ database })
    const loadWorkspace = (role: 'gm' | 'player') => loadEncounterWorkspaceUseCase({
      role,
      slug: 'fixture-arena',
      playerProfile: role === 'player' ? profile : null,
      audience: role === 'gm' ? 'gm' : 'player-owner',
    }, {
      loadSnapshot: input => loadLiveTableSnapshotUseCase(input, {
        database, mapRepository: maps, sheetRepository: sheets,
        realtimeEventRepository: realtime, now: () => 70,
      }),
      loadEncounterDocument: () => null,
      findEncounterDocumentByMap: () => null,
      listItemOperations: mapSlug => itemRecords.listForMap(mapSlug),
    })
    const gmReconnect = loadWorkspace('gm')
    const playerReconnect = loadWorkspace('player')
    for (const workspace of [gmReconnect, playerReconnect]) {
      expect(workspace.source.mapRevision).toBe(5)
      expect(workspace.accepted).toEqual(expect.arrayContaining([expect.objectContaining({
        operationId: itemCommand.operationId,
        source: expect.objectContaining({ sourceKind: 'item', canonicalId: 'Potion', instanceId: null }),
        headline: expect.objectContaining({ label: 'Potion restored 20 HP', tone: 'positive' }),
        affectedParticipants: expect.arrayContaining([
          expect.objectContaining({ participantId: 'fixture-pokemon-placement' }),
        ]),
        changes: expect.arrayContaining([
          expect.objectContaining({ kind: 'hp', delta: 20, label: '20 HP restored' }),
          expect.objectContaining({ kind: 'resource' }),
        ]),
      })]))
      const acceptedJson = JSON.stringify(workspace.accepted)
      expect(acceptedJson).not.toContain('fixture-potion-row')
      expect(acceptedJson).not.toContain('inventory.consume')
      expect(acceptedJson).not.toContain('sourceInstanceId')
    }

    const eventsBeforeReplay = realtime.readAfter({ afterSequence: 0, limit: 100 }).events.length
    const replay = executeItemOperationUseCase({
      role: 'player', playerProfile: profile, command: itemCommand, clientId: 'vertical-reconnect-client',
    }, { database, realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish, now: () => 80 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(replay.sheets).toEqual([])
    expect(authority()).toMatchObject({
      mapRevision: 5,
      trainer: { revision: 5, inventory: { medicalKit: [{ qty: 1 }] } },
      pokemon: { revision: 3, combat: { currentHp: 27 } },
    })
    expect(realtime.readAfter({ afterSequence: 0, limit: 100 }).events).toHaveLength(eventsBeforeReplay)

    const recoveryCommand: ItemOperationRecoveryCommandV1 = {
      schemaVersion: 1,
      operationId: itemCommand.operationId,
      action: 'correct',
      correctionOperationId: 'op_item_vertical_correction01',
      reason: 'Fixture GM reversed the accepted restorative use.',
    }
    expect(() => recoverItemOperationUseCase({
      role: 'player', playerProfile: profile, command: recoveryCommand,
    }, { database, now: () => 89 })).toThrow('GM authorization is required')
    const corrected = recoverItemOperationUseCase({
      role: 'gm', command: recoveryCommand, clientId: 'vertical-gm-client',
    }, { database, publishPersistedRealtimeEvent: publish, now: () => 90 })
    expect(corrected.result).toMatchObject({
      action: 'correct', status: 'corrected', inventoryDisposition: 'restored',
      correctionOperationId: recoveryCommand.correctionOperationId, exactReplay: false,
    })
    const afterCorrection = authority()
    expect(afterCorrection.trainer).toMatchObject({
      revision: 6, money: 400,
      inventory: { medicalKit: [{ id: 'fixture-potion-row', name: 'Potion', qty: 2 }] },
    })
    expect(afterCorrection.pokemon).toMatchObject({ revision: 4, combat: { currentHp: 7 } })
    expect(afterCorrection.map.revision).toBe(6)
    expect(afterCorrection.map.encounterState?.turnResources['fixture-trainer-placement']?.actions.standard.spent).toBe(0)
    expect(afterCorrection.map.encounterState?.turnResources['fixture-pokemon-placement']).toBeUndefined()
    expect(shops.get('fixture-mart')?.document.entries[0]?.stock).toBe(2)

    const correctedGmWorkspace = loadWorkspace('gm')
    const correctedPlayerWorkspace = loadWorkspace('player')
    expect(correctedGmWorkspace.accepted).toEqual(expect.arrayContaining([expect.objectContaining({
      operationId: recoveryCommand.correctionOperationId,
      headline: expect.objectContaining({ label: 'Potion use corrected — inventory restored', tone: 'warning' }),
      correction: expect.objectContaining({
        correctsPresentationId: expect.stringContaining(itemCommand.operationId),
        reasonLabel: recoveryCommand.reason,
      }),
    })]))
    expect(JSON.stringify(correctedPlayerWorkspace.accepted)).toContain(recoveryCommand.reason)
    expect(JSON.stringify(correctedPlayerWorkspace.accepted)).not.toContain('fixture-potion-row')

    const eventsBeforeCorrectionReplay = realtime.readAfter({ afterSequence: 0, limit: 100 }).events.length
    const correctionReplay = recoverItemOperationUseCase({
      role: 'gm', command: recoveryCommand, clientId: 'vertical-gm-reconnect',
    }, { database, publishPersistedRealtimeEvent: publish, now: () => 100 })
    expect(correctionReplay.result).toMatchObject({ status: 'corrected', exactReplay: true })
    expect(correctionReplay.sheets).toEqual([])
    expect(realtime.readAfter({ afterSequence: 0, limit: 100 }).events).toHaveLength(eventsBeforeCorrectionReplay)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 2 })
  })
})
