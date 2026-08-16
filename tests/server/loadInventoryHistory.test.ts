import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ItemOperationPlanV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { parseEquipmentOperationCommand } from '#shared/itemAutomation/equipmentOperations'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteShopCheckoutOperationRepository } from '../../server/storage/shopCheckoutOperationRepository'
import { createSqliteItemGuidedRequestRepository } from '../../server/storage/itemGuidedRequestRepository'
import { loadInventoryHistoryUseCase } from '../../server/useCases/loadInventoryHistory'
import { loadTrainerInventoryActionsUseCase } from '../../server/useCases/loadTrainerInventoryActions'
import { executeTrainerInventoryActionUseCase } from '../../server/useCases/executeTrainerInventoryAction'
import { executeEquipmentOperation } from '../../server/useCases/executeEquipmentOperation'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()?.close() })

const player = (trainerSlug: string): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_history1' as PlayerProfile['id'],
  displayName: 'History Player' as PlayerProfile['displayName'],
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})

const itemCommand = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_inventory_history_item_01',
  context: 'sheet',
  offerId: 'offer:history:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'trainer:ash',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 2 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 2 },
  targetIds: ['pokemon:pikachu'],
  choices: [{ choiceId: 'target', optionIds: ['pokemon:pikachu'] }],
  readSet: [
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 2 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 1 },
  ],
})
const itemPlan = (): ItemOperationPlanV1 => ({
  schemaVersion: 1,
  operationId: itemCommand().operationId,
  canonicalItemId: 'Potion',
  canonicalDefinitionSha256: 'a'.repeat(64),
  readSet: itemCommand().readSet,
  operations: [{
    operationId: 'inventory.consume', ordinal: 0, kind: 'inventory',
    aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 2 },
    subjectId: 'potion-row', payload: { action: 'consume', quantity: 1 },
    label: 'Consume one Potion',
  }],
  receiptFacts: [
    { factId: 'item-used', audience: 'public', label: 'Potion was used.' },
    { factId: 'healing', audience: 'owner', label: 'Pikachu recovered 20 HP.' },
  ],
})

const checkoutCommand = (): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_historycheckout1',
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'purchase' },
    { kind: 'shop', shopSlug: 'viridian-mart', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'money' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'viridian-mart', shopRevision: 2,
    paymentSource: { kind: 'trainer', slug: 'ash', revision: 2 },
    deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 2 },
    lines: [{ entryId: 'potion-entry', quantity: 2 }],
    origin: { kind: 'shopPage' },
  },
})
const checkoutResult = (command: ShopCheckoutLivePlayCommand): ShopCheckoutCommandAccepted => ({
  ok: true,
  opId: command.opId,
  shopSlug: command.payload.shopSlug,
  previousShopRevision: 2,
  shopRevision: 3,
  totalPrice: 600,
  lines: [{
    entryId: 'potion-entry', itemName: 'Potion', section: 'medicalKit',
    quantity: 2, unitPrice: 300, lineTotal: 600, stock: 8,
  }],
  documents: {
    shop: {
      slug: 'viridian-mart', revision: 3, updatedAt: 500,
      name: 'Viridian Mart', playerVisible: true, open: true,
      allowedPaymentSources: ['trainer'], allowedDeliveryTargets: ['trainer'],
      entries: [{ id: 'potion-entry', itemName: 'Potion', section: 'medicalKit', price: 300, stock: 8 }],
    },
  },
})

const seed = (database: RotomDatabase): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'ash', revision: 2, updatedAt: 50,
    document: {
      slug: 'ash', name: 'Ash', revision: 2, currentTeam: ['pikachu'], boxedPokemon: [],
      inventory: {
        medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }],
        equipment: [{ id: 'armor-row', name: 'Light Armor' }],
      },
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
    },
  })
  sheets.save({
    kind: 'pokemon', slug: 'pikachu', revision: 1, updatedAt: 50,
    document: { slug: 'pikachu', name: 'Pikachu', revision: 1 },
  })
  createSqliteGroupInventoryRepository(database).getOrCreate({ now: 50 })

  const items = createSqliteItemOperationRepository({ database, clock: () => 100 })
  const pending = items.createPending({
    command: itemCommand(), canonicalItemId: 'Potion',
    canonicalDefinitionSha256: 'a'.repeat(64), plan: itemPlan(),
  })
  items.complete({
    operationId: pending.operationId,
    commandSha256: pending.commandSha256,
    status: 'accepted',
    result: {
      schemaVersion: 1, operationId: pending.operationId, status: 'accepted', canonicalItemId: 'Potion',
      aggregateRefs: itemCommand().readSet, receiptId: 'item-receipt:history-potion', exactReplay: false,
    },
    updatedAt: 200,
  })

  const command = checkoutCommand()
  createSqliteShopCheckoutOperationRepository({ database, clock: () => 500 }).saveCommandResult({
    shopSlug: command.payload.shopSlug,
    opId: command.opId,
    command,
    result: checkoutResult(command),
  })
}

describe('load inventory history', () => {
  it('derives one bounded readable receipt per committed source and keeps replay/internal authority out of output', () => {
    const database = open()
    seed(database)
    const first = loadInventoryHistoryUseCase({ role: 'gm', trainerSlug: 'ash', limit: 20 }, {
      database, now: () => 1_000,
    })
    // Repository idempotency returns the original checkout and does not add a second journal row.
    const command = checkoutCommand()
    createSqliteShopCheckoutOperationRepository({ database }).saveCommandResult({
      shopSlug: command.payload.shopSlug, opId: command.opId,
      command, result: checkoutResult(command),
    })
    const replayed = loadInventoryHistoryUseCase({ role: 'gm', trainerSlug: 'ash', limit: 20 }, {
      database, now: () => 1_001,
    })

    expect(first.facts.map(fact => fact.kind)).toEqual(['purchase', 'item-use'])
    expect(first.facts[0]).toMatchObject({ headline: 'Potion ×2', item: { label: 'Potion', quantity: 2 } })
    expect(first.facts[1]?.details).toContain('Pikachu recovered 20 HP.')
    expect(replayed.facts).toEqual(first.facts)
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain(command.opId)
    expect(serialized).not.toContain(itemCommand().operationId)
    expect(serialized).not.toContain('potion-row')
    expect(serialized).not.toContain('profile_')
    expect(serialized).not.toContain('a'.repeat(64))
  })

  it('projects a non-item-backed guided terminal outcome exactly once', () => {
    const database = open()
    seed(database)
    const guided = createSqliteItemGuidedRequestRepository({ database, now: () => 600 })
    const requestId = `item-guided:v1:${'4'.repeat(32)}`
    guided.create({
      requestId,
      requestKind: 're-breather-activation',
      canonicalItemId: 'Re-Breather',
      canonicalDefinitionSha256: 'c'.repeat(64),
      declarationPrincipalKey: 'gm',
      actorKind: 'trainer', actorSlug: 'ash',
      targetKind: 'trainer', targetSlug: 'ash',
      itemOperationId: null,
      declarationOperationId: `item-guided-operation:v1:${'3'.repeat(32)}`,
      declarationCommand: { schemaVersion: 1, marker: 'history declaration' },
      authority: {
        schemaVersion: 1,
        sourceKind: 'equipped-re-breather',
        actorLabel: 'Ash', targetLabel: 'Ash', timingLabel: 'Standard Action',
        prompt: 'Confirm activation.', canonicalFacts: ['One hour.'], settlementFacts: ['Activate Gilled.'],
        reservationLabel: 'Exact equipped Re-Breather reserved', boundaryLabel: 'No change before acceptance.',
        trainerSlug: 'ash', ownerKind: 'trainer', ownerSlug: 'ash',
        sheetRevision: 2, equipmentRevision: 0,
        instanceId: `equipped-item:v1:${'d'.repeat(32)}`, instanceRevision: 0,
        campaignClockRevision: 0, campaignMinute: 0, offerId: 'history-offer', actionKind: 'activate',
      },
    })
    guided.settle({
      requestId,
      expectedRevision: 0,
      status: 'accepted',
      terminalPrincipalKey: 'gm',
      command: {
        schemaVersion: 1,
        operationId: `item-guided-operation:v1:${'5'.repeat(32)}`,
        action: 'resolve', requestId, expectedRevision: 0, optionId: 'activate-for-one-hour',
      },
      outcomeOptionId: 'activate-for-one-hour',
      result: { schemaVersion: 1, status: 'accepted', acceptedSummary: 'Re-Breather activated for one hour.' },
      updatedAt: 610,
    })
    const history = loadInventoryHistoryUseCase({ role: 'gm', trainerSlug: 'ash' }, { database })
    expect(history.facts.filter(fact => fact.kind === 'guided-outcome')).toEqual([
      expect.objectContaining({
        headline: 'Re-Breather guided outcome accepted',
        details: ['Re-Breather activated for one hour.'],
      }),
    ])
    expect(JSON.stringify(history)).not.toContain(requestId)
  })

  it('loads the exact accepted equipment journal while ignoring its delegated inventory-action wrapper', () => {
    const database = open()
    seed(database)
    const command = parseEquipmentOperationCommand({
      schemaVersion: 1,
      operationId: `equipment-operation:v1:${'6'.repeat(32)}`,
      commandKind: 'equip',
      actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash',
        section: 'equipment', rowId: 'armor-row',
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: 'armor-row',
        }),
        expectedRevision: 2,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
        expectedSheetRevision: 2, expectedEquipmentRevision: 0,
      },
      replacedInstanceId: null,
      swapReturnDestination: null,
      configuration: null,
    })
    executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 650 })
    const history = loadInventoryHistoryUseCase({ role: 'gm', trainerSlug: 'ash' }, { database })
    expect(history.facts.filter(fact => fact.kind === 'equipment-change')).toEqual([
      expect.objectContaining({ headline: 'Light Armor equipped', item: { label: 'Light Armor', quantity: 1 } }),
    ])
  })

  it('attributes one multi-document transfer receipt to both affected scopes and deduplicates exact replay', () => {
    const database = open()
    seed(database)
    const offers = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, {
      database, now: () => 600,
    })
    const offer = offers.offers.find(candidate => candidate.action === 'transfer'
      && candidate.source.canonicalItemId === 'Potion')!
    const destination = offer.destination.options.find(candidate => candidate.enabled)!
    const declaration = {
      schemaVersion: 1 as const,
      operationId: `inventory-action:v1:${'7'.repeat(32)}`,
      offerId: offer.offerId,
      action: offer.action,
      sourceSelectionId: offer.source.sourceSelectionId,
      quantity: 1,
      destinationId: destination.destinationId,
      confirmationOptionId: null,
      expectedRevisions: [...offer.revisionRequirements, ...destination.revisionRequirements]
        .map(requirement => ({
          requirementId: requirement.requirementId,
          expectedRevision: requirement.expectedRevision,
        })),
    }
    const first = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration,
    }, { database, now: () => 700 })
    const replay = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration,
    }, { database, now: () => 701 })
    expect(first.result.exactReplay).toBe(false)
    expect(replay.result.exactReplay).toBe(true)

    const trainerHistory = loadInventoryHistoryUseCase({ role: 'gm', trainerSlug: 'ash' }, { database })
    const groupHistory = loadInventoryHistoryUseCase({ role: 'gm', groupSlug: 'main' }, { database })
    expect(trainerHistory.facts.filter(fact => fact.kind === 'transfer')).toHaveLength(1)
    expect(groupHistory.facts.filter(fact => fact.kind === 'transfer')).toHaveLength(1)
    expect(groupHistory.facts.find(fact => fact.kind === 'transfer')).toMatchObject({
      headline: 'Potion transferred',
      item: { label: 'Potion', quantity: 1 },
      custody: { sourceLabel: 'Trainer inventory', destinationLabel: 'Shared inventory' },
    })
  })

  it('authorizes Trainer history to the exact linked profile while keeping shared history player-readable', () => {
    const database = open()
    seed(database)
    expect(loadInventoryHistoryUseCase({
      role: 'player', playerProfile: player('ash'), trainerSlug: 'ash', limit: '5',
    }, { database }).scope).toEqual({ kind: 'trainer', label: 'Ash inventory' })

    expect(() => loadInventoryHistoryUseCase({
      role: 'player', playerProfile: player('misty'), trainerSlug: 'ash',
    }, { database })).toThrow('does not control this Trainer inventory history')

    const shared = loadInventoryHistoryUseCase({
      role: 'player', playerProfile: player('misty'), groupSlug: 'main',
    }, { database })
    expect(shared.scope).toEqual({ kind: 'group', label: 'Shared inventory' })
    expect(shared.facts).toEqual([])
  })

  it.each([
    [{ role: 'gm' as const }, 'exactly one'],
    [{ role: 'gm' as const, trainerSlug: 'ash', groupSlug: 'main' }, 'exactly one'],
    [{ role: 'gm' as const, trainerSlug: 'Bad Slug' }, 'valid campaign slug'],
    [{ role: 'gm' as const, trainerSlug: 'ash', limit: 51 }, 'from 1 through 50'],
  ])('rejects malformed scope or limits', (input, message) => {
    const database = open()
    seed(database)
    expect(() => loadInventoryHistoryUseCase(input, { database })).toThrow(message)
  })
})
